import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { awsRegion, resolveAwsCredentials } from '@/lib/aws/credentials';
import { presignTranscribeUrl, scribeVocabularyName, TRANSCRIBE_SAMPLE_RATE, TRANSCRIBE_URL_EXPIRES_S } from '@/lib/scribe/transcribeUrl';
import { transcriptionEngineOfCapture } from '@/lib/scribe/settings';
import { normalizeScribeLanguage, streamEngineForLanguage } from '@/lib/scribe/language';
import { isStreamingConfigured, trialScribeAllowanceFor } from '@/lib/scribe/store';
import { findGroupCapture, groupCaptureView } from '@/lib/scribe/groupStore';
import { TRIAL_SCRIBE_LIMIT_CODE, TRIAL_SCRIBE_LIMIT_MESSAGE } from '@/lib/scribe/trialCap';
import { DISMISS_REASONS } from '@/lib/scribe/dismiss';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['start', 'resume', 'pause', 'stop', 'withdraw', 'dismiss']),
  reason: z.enum(DISMISS_REASONS).optional(),
  capturedSeconds: z.number().int().min(0).max(4 * 3600).optional(),
});

const AUDIT_ACTION = {
  start: 'SCRIBE_CAPTURE_START',
  resume: 'SCRIBE_CAPTURE_RESUME',
  pause: 'SCRIBE_CAPTURE_PAUSE',
  stop: 'SCRIBE_CAPTURE_STOP',
  withdraw: 'SCRIBE_CONSENT_WITHDRAWN',
  dismiss: 'SCRIBE_CAPTURE_DISMISSED',
} as const;

/**
 * POST /api/scribe/group-captures/[id]/control — same contract as individual captures
 * (useTranscribeStream with apiBase): start / resume return a presigned Transcribe streaming URL
 * (conversation, speaker labels); withdraw / dismiss stop and delete every segment and the draft.
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
  const cap = await findGroupCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the clinician who opened this capture can control it');
  if (cap.status === 'discarded' || cap.consentWithdrawnAt || cap.transcriptPurgedAt) return jsonError(409, 'This capture is closed; start a new one.');
  const audit = (outcome: 'SUCCESS' | 'FAILURE' | 'DENIED', metadata: Record<string, unknown> = {}) =>
    auditPhiAccess({ gate, req, action: AUDIT_ACTION[body.action], resourceType: 'scribeGroupCapture', resourceId: cap.id, outcome, metadata: { engine: cap.engine, ...metadata } });
  const metered = cap.captureSeconds + (body.capturedSeconds ?? 0);

  if (body.action === 'start' || body.action === 'resume') {
    if (body.action === 'start' && cap.status !== 'ready') return jsonError(409, 'Capture already started; use resume.');
    if (body.action === 'resume' && cap.status !== 'paused' && cap.status !== 'stopped' && cap.status !== 'drafted' && cap.status !== 'capturing') return jsonError(409, 'Capture is not paused.');
    if (!isStreamingConfigured()) return jsonError(503, 'AWS transcription is not configured on this server. Nothing was captured.', { code: 'transcription_not_configured' });
    const trial = await trialScribeAllowanceFor(actor.organizationId, body.capturedSeconds ?? 0);
    if (trial.limited && trial.exhausted) {
      await prisma.scribeGroupCapture.update({ where: { id: cap.id }, data: { captureSeconds: metered } });
      await audit('DENIED', { reason: TRIAL_SCRIBE_LIMIT_CODE });
      return jsonError(403, TRIAL_SCRIBE_LIMIT_MESSAGE, { code: TRIAL_SCRIBE_LIMIT_CODE });
    }
    const creds = await resolveAwsCredentials().catch(() => null);
    if (!creds) return jsonError(503, 'AWS credentials are not available on this server. Nothing was captured.', { code: 'transcription_not_configured' });
    const language = normalizeScribeLanguage(cap.language);
    const engine = streamEngineForLanguage(transcriptionEngineOfCapture(cap.engine), language);
    const stream = {
      kind: 'websocket' as const,
      url: presignTranscribeUrl({ creds, region: awsRegion(), kind: 'conversation', engine, languageCode: language, vocabularyName: engine === 'standard' && language === 'en-US' ? scribeVocabularyName() : undefined }),
      sampleRate: TRANSCRIBE_SAMPLE_RATE,
      expiresInSeconds: TRANSCRIBE_URL_EXPIRES_S,
      type: 'CONVERSATION' as const,
      engine,
      maxSeconds: trial.limited ? trial.remainingSeconds : null,
    };
    const updated = await prisma.scribeGroupCapture.update({
      where: { id: cap.id },
      data: { status: 'capturing', startedAt: cap.startedAt ?? new Date(), streamCount: { increment: 1 }, captureSeconds: metered },
    });
    await audit('SUCCESS', { transcription: engine, language });
    return NextResponse.json({ success: true, capture: groupCaptureView(updated), stream }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  if (body.action === 'dismiss' || body.action === 'withdraw') {
    const now = new Date();
    const updated = await prisma.scribeGroupCapture.update({
      where: { id: cap.id },
      data: { status: 'discarded', stoppedAt: now, captureSeconds: metered, transcriptPurgedAt: now, draft: Prisma.DbNull, ...(body.action === 'withdraw' ? { consentWithdrawnAt: now } : {}) },
    });
    const deleted = await prisma.scribeGroupSegment.deleteMany({ where: { captureId: cap.id } });
    await audit('SUCCESS', { segmentsDeleted: deleted.count, ...(body.reason ? { reason: body.reason } : {}) });
    return NextResponse.json({ success: true, capture: groupCaptureView(updated) });
  }

  const updated = await prisma.scribeGroupCapture.update({
    where: { id: cap.id },
    data: {
      status: body.action === 'pause' ? 'paused' : cap.status === 'drafted' ? cap.status : 'stopped',
      ...(body.action === 'stop' ? { stoppedAt: new Date() } : {}),
      captureSeconds: metered,
    },
  });
  await audit('SUCCESS', { capturedSeconds: body.capturedSeconds ?? 0 });
  return NextResponse.json({ success: true, capture: groupCaptureView(updated) });
}
