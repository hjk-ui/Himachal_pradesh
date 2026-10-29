import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { awsRegion, resolveAwsCredentials } from '@/lib/aws/credentials';
import { presignTranscribeUrl, scribeVocabularyName, TRANSCRIBE_SAMPLE_RATE, TRANSCRIBE_URL_EXPIRES_S } from '@/lib/scribe/transcribeUrl';
import { sanitizeGaps } from '@/lib/scribe/recordingMonitor';
import { startChimeTranscription, stopChimeTranscription } from '@/lib/scribe/chimeTranscription';
import { aiConsentFor, findCapture, transcriptionConfiguredFor, trialScribeAllowanceFor } from '@/lib/scribe/store';
import { pauseUpdate } from '@/lib/scribe/sessionClock';
import { transcriptionEngineOfCapture } from '@/lib/scribe/settings';
import { TRIAL_SCRIBE_LIMIT_CODE, TRIAL_SCRIBE_LIMIT_MESSAGE } from '@/lib/scribe/trialCap';
import type { CaptureMode } from '@/lib/scribe/consent';
import { captureView, jsonError, scribeGate } from '../../../_lib/gate';
import { recordingConsentRevoked } from '@/lib/consents/library/store2';
import { DISMISS_REASONS, dismissBlocker, DISMISSED_CAPTURE_DATA } from '@/lib/scribe/dismiss';
import { normalizeScribeLanguage, streamEngineForLanguage } from '@/lib/scribe/language';
import { RECAP_MAX_SECONDS } from '@/lib/scribe/sessionStart';
import { transcriptOutputKey } from '@/lib/scribe/upload';
import { deleteUploadArtifacts } from '@/lib/scribe/uploadAws';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['start', 'resume', 'reconnect', 'gaps', 'pause', 'stop', 'withdraw', 'dismiss']),
  /** Recording gaps on the capture clock (numbers + reason enum only; recordingMonitor.ts) */
  gaps: z.array(z.object({ startMs: z.number(), endMs: z.number(), reason: z.string().max(40) })).max(200).optional(),
  /** dismiss only: why the clinician discarded the capture (an enum, never free text) */
  reason: z.enum(DISMISS_REASONS).optional(),
  /** Seconds of audio the browser streamed since the last control call (usage metering) */
  capturedSeconds: z.number().int().min(0).max(4 * 3600).optional(),
});

const AUDIT_ACTION = {
  start: 'SCRIBE_CAPTURE_START',
  resume: 'SCRIBE_CAPTURE_RESUME',
  reconnect: 'SCRIBE_CAPTURE_RECONNECT',
  gaps: 'SCRIBE_CAPTURE_GAPS',
  pause: 'SCRIBE_CAPTURE_PAUSE',
  stop: 'SCRIBE_CAPTURE_STOP',
  withdraw: 'SCRIBE_CONSENT_WITHDRAWN',
  dismiss: 'SCRIBE_CAPTURE_DISMISSED',
} as const;

/**
 * POST /api/scribe/captures/[id]/control
 *   start / resume: in person + dictation → a presigned Transcribe streaming WebSocket URL
 *                   (60 s to connect); telehealth → Chime live transcription. The engine (standard
 *                   Transcribe + practice vocabulary, or Transcribe Medical) is the one recorded on the
 *                   capture when it was created. During the free trial the organization's live
 *                   minutes are capped (trialCap.ts); `stream.maxSeconds` tells the browser when to stop.
 *   reconnect:      the browser's stream dropped while recording (socket closed, mic / device, network):
 *                   a new presigned URL for the SAME capture, no clock change (status must be capturing).
 *   gaps:           the browser reports recording gaps (capture-clock ms + reason enum) for the transcript.
 *   pause / stop:   telehealth stops Chime transcription; browser streams close client-side.
 *   withdraw:       a participant withdrew consent: capture stops and every segment is deleted.
 *   dismiss:        the clinician dismissed the scribe ("Dismiss scribe") before a draft note was
 *                   created: capture stops (Chime transcription too), transcript segments, AI drafts
 *                   and the summary are deleted; only the capture row (ids, times, counts) and an
 *                   audit row (who, when, capture id, optional reason enum) remain. No transcript text.
 * Every call is audited (ids / enums / counts only).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid action');
  }
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the clinician who opened this capture can control it');
  if (body.action === 'dismiss') {
    const blocked = dismissBlocker(cap);
    if (blocked) return jsonError(409, blocked);
  } else if (cap.consentWithdrawnAt || cap.status === 'discarded') {
    return jsonError(409, cap.consentWithdrawnAt ? 'Consent was withdrawn for this capture; start a new one with fresh consent.' : 'This capture was dismissed; start a new one.');
  }
  if (cap.transcriptPurgedAt && body.action !== 'dismiss') return jsonError(409, 'This capture has been purged.');

  const audit = (outcome: 'SUCCESS' | 'FAILURE' | 'DENIED', metadata: Record<string, unknown> = {}) =>
    auditPhiAccess({
      gate,
      req,
      action: AUDIT_ACTION[body.action],
      resourceType: 'scribeCapture',
      resourceId: cap.id,
      patientId: cap.clientId,
      outcome,
      metadata: { mode: cap.mode, engine: cap.engine, ...metadata },
    });
  const meteredSeconds = cap.captureSeconds + (body.capturedSeconds ?? 0);
  const mode = cap.mode as CaptureMode;

  let meetingId: string | null = null;
  if (mode === 'telehealth' && cap.telehealthSessionId) {
    const ts = await prisma.telehealthSession.findUnique({ where: { id: cap.telehealthSessionId }, select: { chimeMeetingId: true } });
    meetingId = ts?.chimeMeetingId ?? null;
  }

  const gaps = body.gaps ? sanitizeGaps(body.gaps) : null;
  if (body.action === 'gaps') {
    if (!gaps) return jsonError(400, 'No gaps');
    await prisma.scribeCapture.update({ where: { id: cap.id }, data: { recordingGaps: JSON.parse(JSON.stringify(gaps)) } });
    await audit('SUCCESS', { gaps: gaps.length, gapSeconds: Math.round(gaps.reduce((t, g) => t + (g.endMs - g.startMs), 0) / 1000) });
    return NextResponse.json({ success: true });
  }
  if (body.action === 'reconnect') {
    if (mode === 'telehealth') return jsonError(409, 'Telehealth transcription runs in the meeting; it does not reconnect from the browser.');
    if (cap.status !== 'capturing') return jsonError(409, 'The capture is not recording; press Resume.');
  }

  if (body.action === 'start' || body.action === 'resume' || body.action === 'reconnect') {
    if (cap.source === 'upload') return jsonError(409, 'This capture is an uploaded recording: upload the file instead of streaming.');
    if (body.action === 'start' && cap.status !== 'ready') return jsonError(409, 'Capture already started; use resume.');
    if (body.action === 'resume' && cap.status !== 'paused' && cap.status !== 'stopped') return jsonError(409, 'Capture is not paused.');
    // AI consent may have changed since the attestation
    const consent = await aiConsentFor(actor.organizationId, cap.clientId);
    if (consent === 'declined') {
      await audit('DENIED', { reason: 'ai_consent_declined' });
      return jsonError(403, 'This client declined AI use. Nothing is captured.', { code: 'ai_consent_declined' });
    }
    if (mode !== 'dictation' && (await recordingConsentRevoked(actor.organizationId, cap.clientId))) {
      await audit('DENIED', { reason: 'recording_consent_revoked' });
      return jsonError(403, 'This client revoked consent to session recording and transcription. Nothing is captured.', { code: 'recording_consent_revoked' });
    }
    if (!transcriptionConfiguredFor(mode)) {
      await audit('FAILURE', { reason: 'not_configured' });
      return jsonError(503, 'AWS transcription is not configured on this server. Nothing was captured.', { code: 'transcription_not_configured' });
    }

    // Free trial cap (includes the seconds this call reports)
    const trial = await trialScribeAllowanceFor(actor.organizationId, body.capturedSeconds ?? 0);
    if (trial.limited && trial.exhausted) {
      // Keep the metering; the capture stays as it was (its transcript can still be drafted)
      await prisma.scribeCapture.update({ where: { id: cap.id }, data: { captureSeconds: meteredSeconds } });
      await audit('DENIED', { reason: TRIAL_SCRIBE_LIMIT_CODE });
      return jsonError(403, TRIAL_SCRIBE_LIMIT_MESSAGE, { code: TRIAL_SCRIBE_LIMIT_CODE });
    }
    // A dictated recap is short (RECAP_MAX_SECONDS in all)
    const recapLeft = cap.source === 'recap' ? Math.max(0, RECAP_MAX_SECONDS - meteredSeconds) : null;
    if (recapLeft === 0) return jsonError(409, 'A recap is limited to 10 minutes. Draft from what you dictated.');
    const trialLeft = trial.limited ? trial.remainingSeconds : null;
    const maxSeconds = trialLeft == null ? recapLeft : recapLeft == null ? trialLeft : Math.min(trialLeft, recapLeft);
    const language = normalizeScribeLanguage(cap.language);
    const engine = streamEngineForLanguage(transcriptionEngineOfCapture(cap.engine), language);

    let stream:
      | { kind: 'websocket'; url: string; sampleRate: number; expiresInSeconds: number; type: 'CONVERSATION' | 'DICTATION'; engine: typeof engine; maxSeconds: number | null }
      | { kind: 'chime'; engine: typeof engine; maxSeconds: number | null };
    if (mode === 'telehealth') {
      if (!meetingId) return jsonError(409, 'The telehealth meeting is not running.');
      const started = await startChimeTranscription(meetingId, engine, language);
      if (started.ok === false) {
        await audit('FAILURE', { reason: 'chime_start_failed' });
        return jsonError(502, started.error);
      }
      stream = { kind: 'chime', engine, maxSeconds };
    } else {
      const creds = await resolveAwsCredentials().catch(() => null);
      if (!creds) {
        await audit('FAILURE', { reason: 'no_credentials' });
        return jsonError(503, 'AWS credentials are not available on this server. Nothing was captured.', { code: 'transcription_not_configured' });
      }
      const kind = mode === 'dictation' ? 'dictation' : 'conversation';
      stream = {
        kind: 'websocket',
        url: presignTranscribeUrl({
          creds,
          region: awsRegion(),
          kind,
          engine,
          languageCode: language,
          vocabularyName: engine === 'standard' && language === 'en-US' ? scribeVocabularyName() : undefined,
        }),
        sampleRate: TRANSCRIBE_SAMPLE_RATE,
        expiresInSeconds: TRANSCRIBE_URL_EXPIRES_S,
        type: kind === 'dictation' ? 'DICTATION' : 'CONVERSATION',
        engine,
        maxSeconds,
      };
    }
    const updated = await prisma.scribeCapture.update({
      where: { id: cap.id },
      data: {
        status: 'capturing',
        startedAt: cap.startedAt ?? new Date(),
        // Session clock: a pause (or a stop that is resumed) does not count as session time
        ...(body.action === 'resume' ? resumeClock(cap) : {}),
        streamCount: { increment: 1 },
        captureSeconds: meteredSeconds,
      },
    });
    await audit('SUCCESS', { stream: stream.kind, transcription: engine, language, source: cap.source, ...(body.action === 'reconnect' ? { reconnect: true } : {}) });
    return NextResponse.json(
      { success: true, capture: captureView(updated), stream },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  // pause / stop / withdraw
  if (mode === 'telehealth' && meetingId && cap.status === 'capturing') await stopChimeTranscription(meetingId);
  // Upload dismissed / withdrawn before its transcript existed: delete the audio file and the job too
  if ((body.action === 'dismiss' || body.action === 'withdraw') && (cap.audioObjectKey || cap.batchJobName)) {
    const del = await deleteUploadArtifacts({
      objectKey: cap.audioObjectKey,
      outputKey: transcriptOutputKey(cap.organizationId, cap.id),
      jobName: cap.batchJobName,
      medical: cap.engine === 'transcribe_medical_batch',
    }).catch(() => null);
    if (del?.audioDeleted) await prisma.scribeCapture.update({ where: { id: cap.id }, data: { audioObjectKey: null, audioDeletedAt: new Date(), batchJobName: del.jobDeleted ? null : cap.batchJobName } });
  }
  if (body.action === 'dismiss') {
    // Mark discarded first so a segment upload still in flight is refused, then delete the text
    const updated = await prisma.scribeCapture.update({ where: { id: cap.id }, data: { ...DISMISSED_CAPTURE_DATA(new Date()), captureSeconds: meteredSeconds } });
    const deleted = await prisma.scribeSegment.deleteMany({ where: { sessionId: cap.id } });
    const drafts = await prisma.scribeDraft.deleteMany({ where: { sessionId: cap.id } });
    await audit('SUCCESS', { segmentsDeleted: deleted.count, draftsDeleted: drafts.count, ...(body.reason ? { reason: body.reason } : {}) });
    return NextResponse.json({ success: true, capture: captureView(updated) });
  }
  if (body.action === 'withdraw') {
    // Close the capture first (late uploads are refused), then delete the text
    const updated = await prisma.scribeCapture.update({
      where: { id: cap.id },
      data: { status: 'discarded', consentWithdrawnAt: new Date(), stoppedAt: new Date(), captureSeconds: meteredSeconds, transcriptPurgedAt: new Date(), clientSummary: null, clientSummaryStatus: null },
    });
    const deleted = await prisma.scribeSegment.deleteMany({ where: { sessionId: cap.id } });
    await prisma.scribeDraft.deleteMany({ where: { sessionId: cap.id } });
    await audit('SUCCESS', { segmentsDeleted: deleted.count });
    return NextResponse.json({ success: true, capture: captureView(updated) });
  }
  const updated = await prisma.scribeCapture.update({
    where: { id: cap.id },
    data: {
      status: body.action === 'pause' ? 'paused' : cap.status === 'drafted' || cap.status === 'note_created' ? cap.status : 'stopped',
      ...(body.action === 'stop' ? { stoppedAt: new Date() } : {}),
      ...(body.action === 'pause' ? pauseUpdate('pause', { pausedAt: cap.pausedAt, pausedSeconds: cap.pausedSeconds }, new Date()) : {}),
      ...(gaps ? { recordingGaps: JSON.parse(JSON.stringify(gaps)) } : {}),
      captureSeconds: meteredSeconds,
    },
  });
  await audit('SUCCESS', { capturedSeconds: body.capturedSeconds ?? 0 });
  return NextResponse.json({ success: true, capture: captureView(updated) });
}

/** Resume after a pause (or after a stop): the gap is added to the paused seconds. */
function resumeClock(cap: { pausedAt: Date | null; pausedSeconds: number; stoppedAt: Date | null; status: string }) {
  const since = cap.pausedAt ?? (cap.status === 'stopped' ? cap.stoppedAt : null);
  if (!since) return {};
  return { ...pauseUpdate('resume', { pausedAt: since, pausedSeconds: cap.pausedSeconds }, new Date()), ...(cap.pausedAt ? {} : { stoppedAt: null }) };
}
