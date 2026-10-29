import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { loadSessionTranscript } from '@/lib/ai/sessionTranscript';
import { CAPTURE_MODES } from '@/lib/scribe/consent';
import { SCRIBE_FORMATS } from '@/lib/scribe/settings';
import { PART2_FORMATS, defaultScribeFormat } from '@/lib/scribe/formatCatalog';
import { PASTE_KINDS, PASTE_MAX_CHARS, parsePastedText, pasteCaptureGate, segmentsFromImportedLines } from '@/lib/scribe/paste';
import {
  aiConsentFor,
  appendSegments,
  findAccessibleClient,
  isPart2Client,
  loadLines,
  loadPreferences,
  loadScribeSettings,
  practiceAiConsentRequired,
} from '@/lib/scribe/store';
import { recordingConsentRevoked } from '@/lib/consents/library/store2';
import { captureView, jsonError, scribeGate } from '../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('paste'),
    clientId: z.string().min(1).max(128),
    /** A pasted transcript or the clinician's own session summary */
    kind: z.enum(PASTE_KINDS),
    text: z.string().max(PASTE_MAX_CHARS + 2000),
    parseSpeakers: z.boolean().optional(),
    /** Where the session happened (POS hint and the draft's session label) */
    setting: z.enum(CAPTURE_MODES),
    appointmentId: z.string().max(128).optional().nullable(),
    noteFormat: z.enum(SCRIBE_FORMATS).optional().nullable(),
    part2: z.boolean().optional(),
  }),
  z.object({
    source: z.literal('import'),
    clientId: z.string().min(1).max(128),
    telehealthSessionId: z.string().min(1).max(128),
    noteFormat: z.enum(SCRIBE_FORMATS).optional().nullable(),
    part2: z.boolean().optional(),
  }),
]);

/**
 * GET /api/scribe/captures/import?clientId= — completed telehealth sessions for this client whose
 * Transcribe Medical batch transcript can be imported. Dates and ids only (no transcript text).
 */
export async function GET(req: Request) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const clientId = new URL(req.url).searchParams.get('clientId') || '';
  if (!clientId) return jsonError(400, 'clientId is required');
  const client = await findAccessibleClient(g.actor, clientId);
  if (!client) return jsonError(404, 'Client not found');
  const rows = await prisma.telehealthSession.findMany({
    where: { organizationId: g.actor.organizationId, clientId, transcriptionStatus: 'COMPLETED', transcriptUri: { not: null } },
    orderBy: { scheduledAt: 'desc' },
    select: { id: true, scheduledAt: true, createdAt: true },
    take: 20,
  });
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'READ',
    resourceType: 'telehealthTranscriptList',
    patientId: clientId,
    metadata: { sessions: rows.length, countsOnly: true },
  });
  return NextResponse.json(
    { success: true, sessions: rows.map((r) => ({ id: r.id, at: (r.scheduledAt ?? r.createdAt).toISOString() })) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

/**
 * POST /api/scribe/captures/import — "Paste or import" capture. Turns pasted text, or a completed
 * telehealth batch transcript, into a ScribeCapture with ScribeSegments (engine "paste" / "import")
 * that then goes through the same grounded draft, review and "Create draft note" flow as a live
 * capture. No audio is involved, so there is no recording-consent attestation; the client's AI
 * consent applies (declined blocks; missing blocks when the practice requires it). The stored text
 * follows the same transcript retention rules (status "stopped" → purge N days after the note is
 * signed, or after creation when no note is made).
 */
export async function POST(req: Request) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid request: clientId, source and the text (or telehealth session) are required');
  }

  const client = await findAccessibleClient(actor, body.clientId);
  if (!client) return jsonError(404, 'Client not found');
  try {
    await assertClientPhiAccess({ ...actor, clientId: body.clientId, path: '/api/scribe/captures/import' });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }

  const [settings, aiConsent, requiresAiConsent, part2Client, prefs, revoked] = await Promise.all([
    loadScribeSettings(actor.organizationId),
    aiConsentFor(actor.organizationId, body.clientId),
    practiceAiConsentRequired(actor.organizationId),
    isPart2Client(actor.organizationId, body.clientId),
    loadPreferences(actor.organizationId, actor.userId),
    body.source === 'import' ? recordingConsentRevoked(actor.organizationId, body.clientId) : Promise.resolve(false),
  ]);
  const deny = async (status: number, code: string, message: string) => {
    await auditPhiAccess({
      gate,
      req,
      action: 'SCRIBE_CAPTURE_START',
      resourceType: 'scribeCapture',
      patientId: body.clientId,
      outcome: 'DENIED',
      metadata: { engine: body.source, reason: code },
    });
    return jsonError(status, message, { code });
  };

  // Gate before the transcript is read, so a declined consent never touches the text
  const pre = pasteCaptureGate({
    engine: body.source,
    scribeEnabled: settings.enabled,
    entitled: true,
    aiConsent,
    practiceRequiresAiConsent: requiresAiConsent,
    recordingConsentRevoked: revoked,
    chars: body.source === 'paste' ? body.text.trim().length : PASTE_MAX_CHARS,
  });
  if (pre.ok === false) return deny(pre.code === 'too_short' || pre.code === 'too_long' ? 422 : 403, pre.code, pre.message);

  let parsed: ReturnType<typeof parsePastedText>;
  let telehealthSessionId: string | null = null;
  let mode: (typeof CAPTURE_MODES)[number];
  if (body.source === 'paste') {
    parsed = parsePastedText(body.text.trim(), { kind: body.kind, parseSpeakers: body.kind === 'transcript' && body.parseSpeakers !== false });
    mode = body.kind === 'summary' ? 'dictation' : body.setting;
  } else {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: body.telehealthSessionId, organizationId: actor.organizationId, clientId: body.clientId },
      select: { id: true, transcriptionStatus: true, transcriptUri: true },
    });
    if (!session) return jsonError(404, 'Telehealth session not found for this client');
    const transcript = await loadSessionTranscript(session);
    if (transcript.ok === false) {
      return jsonError(transcript.status === 'ERROR' ? 502 : 409, `${transcript.message} Nothing was imported.`, { code: transcript.status });
    }
    parsed = segmentsFromImportedLines(transcript.lines);
    telehealthSessionId = session.id;
    mode = 'telehealth';
  }
  if (parsed.segments.length < 1) return deny(422, 'too_short', 'No usable text was found. Nothing was saved.');

  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const format = body.noteFormat ?? defaultScribeFormat({ role: actor.role, preferred: prefs.defaultFormat, practiceDefault: settings.defaultFormat }).format;
  const now = new Date();
  const cap = await prisma.scribeCapture.create({
    data: {
      organizationId: actor.organizationId,
      clientId: body.clientId,
      clinicianId: actor.userId,
      appointmentId: body.source === 'paste' ? body.appointmentId || null : null,
      telehealthSessionId,
      mode,
      engine: body.source,
      status: 'stopped',
      startedAt: now,
      stoppedAt: now,
      noteFormat: format,
      part2: Boolean(body.part2) || part2Client || PART2_FORMATS.has(format),
      aiConsentStatus: aiConsent,
      // No recording: no consent method, participants or script. The creator is recorded as the
      // person who supplied the text (consentAttestedBy* columns are required on every capture).
      consentMethod: null,
      consentParticipants: [],
      consentClinicianOnly: body.source === 'paste' && body.kind === 'summary',
      consentScriptVersion: null,
      consentAttestedById: actor.userId,
      consentAttestedByName: user?.name ?? null,
      liveCues: false,
    },
  });
  const stored = await appendSegments(cap, parsed.segments);
  const { lines } = await loadLines(cap);

  await auditPhiAccess({
    gate,
    req,
    action: 'SCRIBE_TEXT_IMPORTED',
    resourceType: 'scribeCapture',
    resourceId: cap.id,
    patientId: body.clientId,
    metadata: {
      engine: body.source,
      kind: body.source === 'paste' ? body.kind : 'telehealth_transcript',
      telehealthSessionId,
      segments: stored,
      labeledTurns: parsed.labeledTurns,
      truncated: parsed.truncated,
      aiConsent,
      part2: cap.part2,
    },
  });

  return NextResponse.json({ success: true, capture: captureView(cap), lines }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
