import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import {
  CAPTURE_MODES,
  CONSENT_METHODS,
  CONSENT_SCRIPT_VERSION,
  PARTICIPANT_ROLES,
  captureGate,
  normalizeParticipants,
} from '@/lib/scribe/consent';
import { SCRIBE_FORMATS, captureEngineFor } from '@/lib/scribe/settings';
import { SCRIBE_LANGUAGES, streamEngineForLanguage } from '@/lib/scribe/language';
import { uploadCaptureEngine } from '@/lib/scribe/upload';
import { isUploadConfigured } from '@/lib/scribe/uploadAws';
import { PART2_FORMATS, defaultScribeFormat } from '@/lib/scribe/formatCatalog';
import { TRIAL_SCRIBE_LIMIT_CODE, TRIAL_SCRIBE_LIMIT_MESSAGE } from '@/lib/scribe/trialCap';
import {
  aiConsentFor,
  findAccessibleClient,
  isPart2Client,
  loadPreferences,
  loadScribeSettings,
  practiceAiConsentRequired,
  transcriptionConfiguredFor,
  trialScribeAllowanceFor,
} from '@/lib/scribe/store';
import { captureView, jsonError, scribeGate } from '../_lib/gate';
import { recordingConsentRevoked } from '@/lib/consents/library/store2';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  mode: z.enum(CAPTURE_MODES),
  appointmentId: z.string().max(128).optional().nullable(),
  telehealthSessionId: z.string().max(128).optional().nullable(),
  noteFormat: z.enum(SCRIBE_FORMATS).optional().nullable(),
  /** Clinician marks the session as SUD (42 CFR Part 2) even when the chart is not flagged */
  part2: z.boolean().optional(),
  liveCues: z.boolean().optional(),
  /** Language spoken in the session (stored on the capture; the note is drafted in English) */
  language: z.enum(SCRIBE_LANGUAGES).optional(),
  /** live (default) | upload (audio file → Transcribe batch) | recap (post-session dictated recap; mode dictation) */
  source: z.enum(['live', 'upload', 'recap']).optional(),
  consent: z.object({
    method: z.enum(CONSENT_METHODS),
    participants: z
      .array(z.object({ role: z.enum(PARTICIPANT_ROLES), label: z.string().max(60).optional(), consented: z.boolean() }))
      .max(12),
    allPartiesConfirmed: z.boolean(),
    scriptRead: z.boolean(),
    clinicianOnly: z.boolean().optional(),
  }),
});

/**
 * POST /api/scribe/captures — record the recording-consent attestation and open a capture.
 * Nothing is captured here: audio starts only through /control {action:"start"} on this capture.
 * Blocks when the client declined AI, when AI consent is missing and the practice requires it,
 * when any participant has not agreed (Maryland all-party consent), or when transcription is not
 * configured (demo honesty: no capture, no canned transcript).
 */
export async function POST(req: Request) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid request: clientId, mode and the consent attestation are required');
  }
  const source = body.source ?? 'live';
  if (source === 'recap' && body.mode !== 'dictation') return jsonError(400, 'A recap is a dictation (mode "dictation").');
  if (source === 'upload' && body.mode !== 'in_person') return jsonError(400, 'An uploaded recording is captured as an in-person session (mode "in_person").');
  const language = body.language ?? 'en-US';

  const client = await findAccessibleClient(actor, body.clientId);
  if (!client) return jsonError(404, 'Client not found');
  try {
    await assertClientPhiAccess({ ...actor, clientId: body.clientId, path: '/api/scribe/captures' });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }

  let telehealth: { id: string; chimeMeetingId: string | null; clinicianId: string | null } | null = null;
  if (body.mode === 'telehealth') {
    if (!body.telehealthSessionId) return jsonError(400, 'telehealthSessionId is required for telehealth capture');
    telehealth = await prisma.telehealthSession.findFirst({
      where: { id: body.telehealthSessionId, organizationId: actor.organizationId, clientId: body.clientId },
      select: { id: true, chimeMeetingId: true, clinicianId: true },
    });
    if (!telehealth) return jsonError(404, 'Telehealth session not found for this client');
  }

  const [settings, aiConsent, requiresAiConsent, part2Client, prefs, recordingRevoked] = await Promise.all([
    loadScribeSettings(actor.organizationId),
    aiConsentFor(actor.organizationId, body.clientId),
    practiceAiConsentRequired(actor.organizationId),
    isPart2Client(actor.organizationId, body.clientId),
    loadPreferences(actor.organizationId, actor.userId),
    recordingConsentRevoked(actor.organizationId, body.clientId),
  ]);
  const check = captureGate({
    mode: body.mode,
    scribeEnabled: settings.enabled,
    entitled: true,
    aiConsent,
    practiceRequiresAiConsent: requiresAiConsent,
    recordingConsent: body.consent,
    recordingConsentRevoked: recordingRevoked,
    transcriptionConfigured:
      source === 'upload'
        ? isUploadConfigured()
        : transcriptionConfiguredFor(body.mode) && (body.mode !== 'telehealth' || Boolean(telehealth?.chimeMeetingId)),
  });
  if (check.ok === false) {
    await auditPhiAccess({
      gate,
      req,
      action: 'SCRIBE_CAPTURE_START',
      resourceType: 'scribeCapture',
      patientId: body.clientId,
      outcome: 'DENIED',
      metadata: { mode: body.mode, reason: check.code },
    });
    return jsonError(check.code === 'transcription_not_configured' ? 503 : 403, check.message, { code: check.code });
  }

  // Free trial: live capture stops at TRIAL_AI_SCRIBE_MINUTES per organization (paste/import stay available)
  const trial = await trialScribeAllowanceFor(actor.organizationId);
  if (trial.limited && trial.exhausted) {
    await auditPhiAccess({
      gate,
      req,
      action: 'SCRIBE_CAPTURE_START',
      resourceType: 'scribeCapture',
      patientId: body.clientId,
      outcome: 'DENIED',
      metadata: { mode: body.mode, reason: TRIAL_SCRIBE_LIMIT_CODE },
    });
    return jsonError(403, TRIAL_SCRIBE_LIMIT_MESSAGE, { code: TRIAL_SCRIBE_LIMIT_CODE });
  }

  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const participants = body.mode === 'dictation' ? [] : normalizeParticipants(body.consent.participants);
  const format = body.noteFormat ?? defaultScribeFormat({ role: actor.role, preferred: prefs.defaultFormat, practiceDefault: settings.defaultFormat }).format;
  const cap = await prisma.scribeCapture.create({
    data: {
      organizationId: actor.organizationId,
      clientId: body.clientId,
      clinicianId: actor.userId,
      appointmentId: body.appointmentId || null,
      telehealthSessionId: telehealth?.id ?? null,
      mode: body.mode,
      engine:
        source === 'upload'
          ? uploadCaptureEngine(settings.transcriptionEngine, language)
          : language === 'en-US'
            ? captureEngineFor(body.mode, settings.transcriptionEngine)
            : captureEngineFor(body.mode, streamEngineForLanguage(settings.transcriptionEngine, language)),
      language,
      source,
      noteFormat: format,
      part2: Boolean(body.part2) || part2Client || PART2_FORMATS.has(format),
      aiConsentStatus: aiConsent,
      consentMethod: body.mode === 'dictation' ? null : body.consent.method,
      consentParticipants: participants,
      consentClinicianOnly: body.mode === 'dictation',
      consentScriptVersion: CONSENT_SCRIPT_VERSION,
      consentAttestedById: actor.userId,
      consentAttestedByName: user?.name ?? null,
      liveCues: body.liveCues ?? prefs.liveCues ?? settings.liveCuesDefault,
    },
  });

  await auditPhiAccess({
    gate,
    req,
    action: 'SCRIBE_CONSENT_ATTESTED',
    resourceType: 'scribeCapture',
    resourceId: cap.id,
    patientId: body.clientId,
    metadata: {
      mode: body.mode,
      method: cap.consentMethod,
      participants: participants.length,
      source,
      language,
      clinicianOnly: cap.consentClinicianOnly,
      scriptVersion: CONSENT_SCRIPT_VERSION,
      aiConsent,
      part2: cap.part2,
    },
  });

  return NextResponse.json({ success: true, capture: captureView(cap) }, { status: 201 });
}
