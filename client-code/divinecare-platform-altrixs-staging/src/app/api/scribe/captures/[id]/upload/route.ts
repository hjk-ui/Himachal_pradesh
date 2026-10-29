import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { aiConsentFor, appendSegmentsIfOpen, findCapture, loadLines, trialScribeAllowanceFor } from '@/lib/scribe/store';
import { recordingConsentRevoked } from '@/lib/consents/library/store2';
import { normalizeScribeLanguage } from '@/lib/scribe/language';
import { scribeVocabularyName } from '@/lib/scribe/transcribeUrl';
import { TRIAL_SCRIBE_LIMIT_CODE, TRIAL_SCRIBE_LIMIT_MESSAGE } from '@/lib/scribe/trialCap';
import { batchJobName, checkUpload, transcriptOutputKey, transcriptSeconds, uploadExtension, uploadObjectKey, UPLOAD_MAX_SECONDS } from '@/lib/scribe/upload';
import { deleteUploadArtifacts, isUploadConfigured, presignAudioPut, readBatchJob, startBatchJob } from '@/lib/scribe/uploadAws';
import { captureView, jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('presign'),
    fileName: z.string().trim().min(1).max(200),
    bytes: z.number().int().min(1),
    /** Read by the browser from the file's metadata (checked again from the transcript) */
    durationSeconds: z.number().min(0).max(24 * 3600).optional().nullable(),
  }),
  z.object({ action: z.literal('transcribe') }),
]);

const isMedical = (engine: string) => engine === 'transcribe_medical_batch';

/**
 * Upload audio (source 'upload'; src/lib/scribe/upload.ts):
 *   POST {action:'presign'}     presigned S3 PUT (15 min, SSE) for the recording
 *   POST {action:'transcribe'}  start the Transcribe batch job (standard or Medical per the capture)
 *   GET                         job status; on completion the transcript turns are stored and the
 *                               audio object, the output JSON and the job are deleted at once
 * Same gates as live capture: AI consent, recording consent not revoked, trial minutes. Audited.
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
    return jsonError(400, 'Invalid upload request');
  }
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the clinician who opened this capture can upload to it');
  if (cap.source !== 'upload') return jsonError(409, 'This capture is not an upload.');
  if (cap.status === 'discarded' || cap.consentWithdrawnAt || cap.transcriptPurgedAt) return jsonError(409, 'This capture is closed.');
  if (!isUploadConfigured()) return jsonError(503, 'Audio upload is not configured on this server (SCRIBE_UPLOAD_BUCKET). Nothing was uploaded.', { code: 'transcription_not_configured' });
  const audit = (outcome: 'SUCCESS' | 'FAILURE' | 'DENIED', metadata: Record<string, unknown>) =>
    auditPhiAccess({ gate, req, action: 'SCRIBE_CAPTURE_START', resourceType: 'scribeCapture', resourceId: cap.id, patientId: cap.clientId, outcome, metadata: { source: 'upload', engine: cap.engine, ...metadata } });

  if ((await aiConsentFor(actor.organizationId, cap.clientId)) === 'declined') {
    await audit('DENIED', { reason: 'ai_consent_declined' });
    return jsonError(403, 'This client declined AI use. Nothing is uploaded or transcribed.', { code: 'ai_consent_declined' });
  }
  if (await recordingConsentRevoked(actor.organizationId, cap.clientId)) {
    await audit('DENIED', { reason: 'recording_consent_revoked' });
    return jsonError(403, 'This client revoked consent to session recording and transcription. Nothing is uploaded.', { code: 'recording_consent_revoked' });
  }

  if (body.action === 'presign') {
    if (cap.status !== 'ready') return jsonError(409, 'A file was already uploaded for this capture.');
    const check = checkUpload({ fileName: body.fileName, bytes: body.bytes, durationSeconds: body.durationSeconds ?? null });
    if (check.ok === false) return jsonError(422, check.message, { code: check.code });
    const trial = await trialScribeAllowanceFor(actor.organizationId, Math.ceil(body.durationSeconds ?? 0));
    if (trial.limited && trial.exhausted) {
      await audit('DENIED', { reason: TRIAL_SCRIBE_LIMIT_CODE });
      return jsonError(403, TRIAL_SCRIBE_LIMIT_MESSAGE, { code: TRIAL_SCRIBE_LIMIT_CODE });
    }
    const key = uploadObjectKey(actor.organizationId, cap.id, check.ext);
    const put = await presignAudioPut(key, check.ext).catch(() => null);
    if (!put) {
      await audit('FAILURE', { reason: 'presign_failed' });
      return jsonError(502, 'The upload could not be prepared. Nothing was uploaded.');
    }
    await prisma.scribeCapture.update({ where: { id: cap.id }, data: { audioObjectKey: key, status: 'uploading' } });
    await audit('SUCCESS', { step: 'presign', ext: check.ext, bytes: body.bytes });
    return NextResponse.json({ success: true, upload: put }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  // transcribe
  if (cap.status !== 'uploading' || !cap.audioObjectKey) return jsonError(409, 'Upload the file first.');
  const ext = uploadExtension(cap.audioObjectKey);
  if (!ext) return jsonError(409, 'Unknown file type.');
  const language = normalizeScribeLanguage(cap.language);
  const jobName = batchJobName(cap.id);
  try {
    await startBatchJob({
      engine: isMedical(cap.engine) ? 'medical' : 'standard',
      language,
      jobName,
      objectKey: cap.audioObjectKey,
      outputKey: transcriptOutputKey(actor.organizationId, cap.id),
      ext,
      vocabularyName: scribeVocabularyName(),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    await audit('FAILURE', { reason: 'batch_start_failed', error: name });
    // Nothing will read the file: delete it now
    const del = await deleteUploadArtifacts({ objectKey: cap.audioObjectKey, outputKey: transcriptOutputKey(actor.organizationId, cap.id), jobName: null, medical: false });
    await prisma.scribeCapture.update({ where: { id: cap.id }, data: { status: 'ready', ...(del.audioDeleted ? { audioObjectKey: null, audioDeletedAt: new Date() } : {}) } });
    return jsonError(502, name === 'AccessDeniedException' ? 'AWS denied the transcription job (the server role needs transcribe:StartTranscriptionJob). The file was deleted.' : 'Transcription could not start. The file was deleted; try again.');
  }
  const updated = await prisma.scribeCapture.update({ where: { id: cap.id }, data: { batchJobName: jobName, status: 'transcribing', startedAt: new Date(), streamCount: { increment: 1 } } });
  await audit('SUCCESS', { step: 'transcribe', language });
  return NextResponse.json({ success: true, capture: captureView(updated) });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  const { id } = await ctx.params;
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the capturing clinician');
  if (cap.source !== 'upload') return jsonError(409, 'This capture is not an upload.');
  if (cap.status !== 'transcribing' || !cap.batchJobName) {
    const { lines } = await loadLines(cap);
    return NextResponse.json({ success: true, status: cap.status === 'stopped' ? 'COMPLETED' : cap.status.toUpperCase(), capture: captureView(cap), lines });
  }
  const outputKey = transcriptOutputKey(actor.organizationId, cap.id);
  const medical = isMedical(cap.engine);
  let result;
  try {
    result = await readBatchJob({ jobName: cap.batchJobName, medical, outputKey });
  } catch {
    return jsonError(502, 'Could not read the transcription status; try again shortly.');
  }
  if (result.status === 'IN_PROGRESS' || result.status === 'QUEUED') {
    return NextResponse.json({ success: true, status: result.status, capture: captureView(cap) }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const audit = (outcome: 'SUCCESS' | 'FAILURE', metadata: Record<string, unknown>) =>
    auditPhiAccess({ gate, req, action: 'SCRIBE_CAPTURE_STOP', resourceType: 'scribeCapture', resourceId: cap.id, patientId: cap.clientId, outcome, metadata: { source: 'upload', ...metadata } });

  let added = 0;
  let seconds = 0;
  if (result.status === 'COMPLETED') {
    seconds = transcriptSeconds(result.segments);
    if (seconds <= UPLOAD_MAX_SECONDS + 60) {
      added = (await appendSegmentsIfOpen(cap, result.segments.map((s, i) => ({ ...s, seq: i })))) ?? 0;
    }
  }
  // The transcript exists (or the job failed): delete the audio, the output JSON and the job now
  const del = await deleteUploadArtifacts({ objectKey: cap.audioObjectKey, outputKey, jobName: cap.batchJobName, medical });
  const tooLong = result.status === 'COMPLETED' && seconds > UPLOAD_MAX_SECONDS + 60;
  const ok = result.status === 'COMPLETED' && !tooLong && added > 0;
  const updated = await prisma.scribeCapture.update({
    where: { id: cap.id },
    data: {
      status: ok ? 'stopped' : 'ready',
      stoppedAt: new Date(),
      captureSeconds: cap.captureSeconds + (ok ? seconds : 0),
      ...(del.audioDeleted ? { audioObjectKey: null, audioDeletedAt: new Date() } : {}),
      ...(del.jobDeleted ? { batchJobName: null } : {}),
    },
  });
  await audit(ok ? 'SUCCESS' : 'FAILURE', { segments: added, seconds, audioDeleted: del.audioDeleted, outputDeleted: del.transcriptDeleted, jobDeleted: del.jobDeleted, ...(ok ? {} : { reason: tooLong ? 'too_long' : result.status === 'FAILED' ? 'transcription_failed' : 'empty' }) });
  if (!ok) {
    return jsonError(
      422,
      tooLong
        ? 'The recording is longer than 2 hours, so it was not used. The file was deleted.'
        : result.status === 'FAILED'
          ? 'Amazon Transcribe could not transcribe this file (format or audio problem). The file was deleted.'
          : 'No speech was found in the recording. The file was deleted.',
      { status: 'FAILED', audioDeleted: del.audioDeleted }
    );
  }
  const { lines } = await loadLines(updated);
  return NextResponse.json({ success: true, status: 'COMPLETED', capture: captureView(updated), lines, audioDeleted: del.audioDeleted }, { headers: { 'Cache-Control': 'private, no-store' } });
}
