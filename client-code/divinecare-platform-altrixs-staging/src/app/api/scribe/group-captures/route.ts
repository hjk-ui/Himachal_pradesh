import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { CONSENT_SCRIPT_VERSION } from '@/lib/scribe/consent';
import { captureEngineFor } from '@/lib/scribe/settings';
import { SCRIBE_LANGUAGES, streamEngineForLanguage } from '@/lib/scribe/language';
import { groupMembers, groupRecordingConsentCheck } from '@/lib/scribe/group';
import { groupCaptureView, groupSessionForScribe, presentAttendees } from '@/lib/scribe/groupStore';
import { aiConsentFor, isStreamingConfigured, loadScribeSettings, practiceAiConsentRequired, trialScribeAllowanceFor } from '@/lib/scribe/store';
import { TRIAL_SCRIBE_LIMIT_CODE, TRIAL_SCRIBE_LIMIT_MESSAGE } from '@/lib/scribe/trialCap';
import { jsonError, scribeGate } from '../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  language: z.enum(SCRIBE_LANGUAGES).optional(),
  consent: z.object({
    /** One row per person present: members by clientId; members you cannot see (protected) as clientId null */
    rows: z.array(z.object({ clientId: z.string().max(128).nullable(), label: z.string().max(60).optional(), agreed: z.boolean() })).min(1).max(40),
    scriptRead: z.literal(true),
  }),
});

/**
 * POST /api/scribe/group-captures — open a group capture (in-person group; one microphone).
 * Recording consent is all-party: every member present (including members hidden from this
 * clinician) must be ticked as agreed. AI consent is checked per member: members without it are
 * excluded (their speech is never used and they get no AI text). Nothing is captured until /control start.
 */
export async function POST(req: Request) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid request: sessionId and the recording consent of everyone present are required');
  }
  const detail = await groupSessionForScribe(actor, body.sessionId);
  if (!detail) return jsonError(404, 'Group session not found');
  if (!detail.canDocument) return jsonError(403, 'Only this session’s facilitators can use the AI Scribe for it');
  if (detail.session.telehealth) return jsonError(409, 'AI Scribe for telehealth groups is not available yet: use it for in-person groups, or document the group yourself.');
  const settings = await loadScribeSettings(actor.organizationId);
  if (!settings.enabled) return jsonError(403, 'AI Scribe is turned off in practice settings.');
  if (!isStreamingConfigured()) return jsonError(503, 'AWS transcription is not configured on this server. Nothing was captured.', { code: 'transcription_not_configured' });

  const { visible, hidden } = presentAttendees(detail.attendees);
  if (!visible.length) return jsonError(409, 'No members are present on this session.');
  // Every visible member present and every hidden one has a row, and every row agreed
  const rows = body.consent.rows.map((r) => ({ clientId: r.clientId ?? null, agreed: r.agreed === true }));
  const missing = visible.filter((a) => !rows.some((r) => r.clientId === a.clientId));
  if (missing.length || rows.filter((r) => !r.clientId).length < hidden) {
    return jsonError(422, 'Tick each person present (every member, and anyone else who can be heard) before recording.', { code: 'participant_missing' });
  }
  const check = groupRecordingConsentCheck(rows);
  if (check.ok === false) {
    await auditPhiAccess({ gate, req, action: 'SCRIBE_CAPTURE_START', resourceType: 'scribeGroupCapture', outcome: 'DENIED', metadata: { sessionId: body.sessionId, reason: check.code } });
    return jsonError(403, check.message, { code: check.code });
  }
  const trial = await trialScribeAllowanceFor(actor.organizationId);
  if (trial.limited && trial.exhausted) return jsonError(403, TRIAL_SCRIBE_LIMIT_MESSAGE, { code: TRIAL_SCRIBE_LIMIT_CODE });

  const requires = await practiceAiConsentRequired(actor.organizationId);
  const consents = await Promise.all(visible.map((a) => aiConsentFor(actor.organizationId, a.clientId)));
  const members = groupMembers(
    visible.map((a, i) => ({ clientId: a.clientId, aiConsent: consents[i], part2: a.part2 })),
    requires
  );
  if (!members.some((m) => m.included)) return jsonError(403, 'No member present has AI consent on file, so nothing can be drafted. Document the group yourself.', { code: 'ai_consent_missing' });

  const language = body.language ?? 'en-US';
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const cap = await prisma.scribeGroupCapture.create({
    data: {
      organizationId: actor.organizationId,
      groupSessionId: body.sessionId,
      groupId: detail.session.groupId,
      clinicianId: actor.userId,
      engine: captureEngineFor('in_person', streamEngineForLanguage(settings.transcriptionEngine, language)),
      language,
      part2: detail.session.kind === 'sud',
      members,
      consentParticipants: rows.map((r) => ({ clientId: r.clientId, agreed: r.agreed })),
      consentScriptVersion: CONSENT_SCRIPT_VERSION,
      consentAttestedById: actor.userId,
      consentAttestedByName: user?.name ?? null,
    },
  });
  await auditPhiAccess({
    gate,
    req,
    action: 'SCRIBE_CONSENT_ATTESTED',
    resourceType: 'scribeGroupCapture',
    resourceId: cap.id,
    metadata: { sessionId: body.sessionId, people: rows.length, included: members.filter((m) => m.included).length, excluded: members.filter((m) => !m.included).length, language, scriptVersion: CONSENT_SCRIPT_VERSION },
  });
  return NextResponse.json({ success: true, capture: groupCaptureView(cap) }, { status: 201 });
}

/** GET /api/scribe/group-captures?sessionId= — the session's open (not discarded) group capture, if any. */
export async function GET(req: Request) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const sessionId = new URL(req.url).searchParams.get('sessionId')?.trim() || '';
  if (!sessionId || sessionId.length > 128) return jsonError(400, 'sessionId is required');
  const detail = await groupSessionForScribe(g.actor, sessionId);
  if (!detail?.canDocument) return jsonError(404, 'Group session not found');
  const cap = await prisma.scribeGroupCapture
    .findFirst({ where: { organizationId: g.actor.organizationId, groupSessionId: sessionId, status: { not: 'discarded' } }, orderBy: { createdAt: 'desc' } })
    .catch(() => null);
  const settings = await loadScribeSettings(g.actor.organizationId);
  return NextResponse.json(
    { success: true, capture: cap ? groupCaptureView(cap) : null, configured: { streaming: isStreamingConfigured() }, settings: { enabled: settings.enabled, deleteTranscriptOnSign: settings.deleteTranscriptOnSign } },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
