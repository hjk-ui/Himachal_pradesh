/**
 * AI Scribe persistence (server only): practice settings, clinician preferences, captures,
 * transcript segments. Org-scoped on every query; callers pass the gate's organizationId.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { hasAwsRoleOrKeys } from '@/lib/aws/credentials';
import { isDemoMode as chimeDemo } from '@/lib/services/chimeService';
import {
  normalizePreferences,
  normalizeScribeSettings,
  type ScribePreferences,
  type ScribeSettingsValue,
} from './settings';
import { defaultSpeakerMap, resolveSpeakerMap, transcriptLines, type RawSegment, type StoredSegment, type TranscriptLine } from './diarization';
import type { CaptureMode } from './consent';
import { getOrgAccess } from '@/lib/billing/entitlementsServer';
import { trialScribeAllowance, type TrialScribeAllowance } from './trialCap';

export type ScribeActor = { organizationId: string; userId: string; role: Role | string };

/** Transcribe streaming (browser mic, either engine) needs AWS credentials: static keys or AWS_LIVE instance role. */
export function isStreamingConfigured(): boolean {
  return hasAwsRoleOrKeys();
}
/** Chime live transcription runs only on real (non-demo) Chime meetings. */
export function isChimeTranscriptionConfigured(): boolean {
  return !chimeDemo();
}
export function transcriptionConfiguredFor(mode: CaptureMode): boolean {
  return mode === 'telehealth' ? isChimeTranscriptionConfigured() : isStreamingConfigured();
}

export async function loadScribeSettings(organizationId: string): Promise<ScribeSettingsValue> {
  try {
    return normalizeScribeSettings(await prisma.scribeSettings.findUnique({ where: { organizationId } }));
  } catch {
    // Table missing before 20261019_scribe_core runs: defaults
    return normalizeScribeSettings(null);
  }
}

export async function saveScribeSettings(organizationId: string, userId: string, patch: Partial<ScribeSettingsValue>) {
  const { requireRecordingConsent: _ignored, ...data } = patch;
  void _ignored;
  await prisma.scribeSettings.upsert({
    where: { organizationId },
    create: { organizationId, updatedById: userId, ...data },
    update: { ...data, updatedById: userId },
  });
  return loadScribeSettings(organizationId);
}

export async function loadPreferences(organizationId: string, userId: string): Promise<ScribePreferences> {
  try {
    return normalizePreferences(await prisma.scribePreference.findUnique({ where: { organizationId_userId: { organizationId, userId } } }));
  } catch {
    return normalizePreferences(null);
  }
}

export async function savePreferences(organizationId: string, userId: string, patch: Partial<ScribePreferences>) {
  await prisma.scribePreference.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, ...patch },
    update: patch,
  });
  return loadPreferences(organizationId, userId);
}

export async function practiceAiConsentRequired(organizationId: string): Promise<boolean> {
  try {
    const s = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { aiNoteConsentRequired: true } });
    return s?.aiNoteConsentRequired ?? true;
  } catch {
    return true;
  }
}

/** Client in org and (for caseload roles) assigned to the actor. */
export async function findAccessibleClient(actor: ScribeActor, clientId: string) {
  return prisma.client.findFirst({
    where: { id: clientId, ...clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role }) },
    select: { id: true, name: true, dateOfBirth: true },
  });
}

/** Part 2 client: protected record classified Part 2 / SUD, or any Part 2 progress note. */
export async function isPart2Client(organizationId: string, clientId: string): Promise<boolean> {
  const [rec, note] = await Promise.all([
    prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { noteClassification: true } }),
    prisma.progressNote.findFirst({ where: { clientId, part2: true, client: { organizationId } }, select: { id: true } }),
  ]);
  return isPart2Classification(rec?.noteClassification) || Boolean(note);
}

/** Signed, unexpired 42 CFR Part 2 consent that names the patient portal / the patient as recipient. */
export async function part2PortalConsent(organizationId: string, clientId: string): Promise<boolean> {
  const now = new Date();
  const rows = await prisma.consentForm.findMany({
    where: { organizationId, clientId, status: 'SIGNED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { type: true },
    take: 50,
  });
  return rows.some((r) => /42\s*cfr|part\s*2/i.test(r.type) && /portal|patient|self/i.test(r.type));
}

export async function aiConsentFor(organizationId: string, clientId: string) {
  return (await checkAiNoteConsent(organizationId, clientId)).status;
}

/** Capture in the actor's org; clinicians see their own, leadership may see the org's. */
export async function findCapture(actor: ScribeActor, id: string) {
  const cap = await prisma.scribeCapture.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!cap) return null;
  if (cap.clinicianId !== actor.userId) {
    const client = await findAccessibleClient(actor, cap.clientId);
    if (!client) return null;
  }
  return cap;
}

export async function loadSegments(captureId: string): Promise<StoredSegment[]> {
  const rows = await prisma.scribeSegment.findMany({
    where: { sessionId: captureId },
    orderBy: { seq: 'asc' },
    select: { seq: true, speakerLabel: true, startMs: true, endMs: true, text: true },
    take: 5000,
  });
  return rows;
}

export async function loadLines(cap: {
  id: string;
  mode: string;
  speakerMap: unknown;
  telehealthSessionId: string | null;
  /** Recording-consent participants: a third speaker takes the one non-client role listed */
  consentParticipants?: unknown;
}): Promise<{ lines: TranscriptLine[]; speakerMap: Record<string, string>; labels: string[] }> {
  const segments = await loadSegments(cap.id);
  let attendees: { clinicianAttendeeId: string | null; patientAttendeeId: string | null } = { clinicianAttendeeId: null, patientAttendeeId: null };
  if (cap.telehealthSessionId) {
    attendees =
      (await prisma.telehealthSession.findUnique({
        where: { id: cap.telehealthSessionId },
        select: { clinicianAttendeeId: true, patientAttendeeId: true },
      })) ?? attendees;
  }
  const participants = Array.isArray(cap.consentParticipants) ? (cap.consentParticipants as { role?: string }[]) : null;
  const defaults = defaultSpeakerMap(segments as RawSegment[], { mode: cap.mode as CaptureMode, ...attendees, participants });
  const map = resolveSpeakerMap(defaults, cap.speakerMap);
  return { lines: transcriptLines(segments, map), speakerMap: map, labels: [...new Set(segments.map((s) => s.speakerLabel))] };
}

/** Append finalized segments; duplicates (same seq) are ignored so client retries are safe. */
export async function appendSegments(capture: { id: string; organizationId: string }, segments: (RawSegment & { seq: number })[]) {
  if (!segments.length) return 0;
  const res = await prisma.scribeSegment.createMany({
    data: segments.map((s) => ({
      sessionId: capture.id,
      organizationId: capture.organizationId,
      seq: s.seq,
      speakerLabel: s.speakerLabel.slice(0, 80),
      startMs: Math.max(0, Math.round(s.startMs)),
      endMs: Math.max(0, Math.round(s.endMs)),
      text: s.text.slice(0, 4000),
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/** SQL guard: the capture still accepts transcript (not dismissed / withdrawn / purged / not started). */
export const OPEN_CAPTURE_GUARD_SQL = `"status" NOT IN ('discarded', 'ready') AND "consent_withdrawn_at" IS NULL AND "transcript_purged_at" IS NULL`;

/**
 * Live upload path: re-check the capture inside the insert's transaction, holding a share lock on
 * the capture row. Dismiss / withdraw mark the capture first (a row update, which waits for this
 * lock) and delete the segments after, so a late upload either sees the capture closed and adds
 * nothing, or commits before the update and is removed by the delete that follows it.
 * Returns null when the capture no longer accepts transcript.
 */
export async function appendSegmentsIfOpen(capture: { id: string; organizationId: string }, segments: (RawSegment & { seq: number })[]): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    const open = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "scribe_captures" WHERE "id" = $1 AND ${OPEN_CAPTURE_GUARD_SQL} FOR SHARE`, capture.id);
    if (!open.length) return null;
    if (!segments.length) return 0;
    const res = await tx.scribeSegment.createMany({
      data: segments.map((s) => ({
        sessionId: capture.id,
        organizationId: capture.organizationId,
        seq: s.seq,
        speakerLabel: s.speakerLabel.slice(0, 80),
        startMs: Math.max(0, Math.round(s.startMs)),
        endMs: Math.max(0, Math.round(s.endMs)),
        text: s.text.slice(0, 4000),
      })),
      skipDuplicates: true,
    });
    return res.count;
  });
}

/** Live-audio seconds metered across the organization's captures (paste / import use none). */
export async function orgScribeSecondsUsed(organizationId: string): Promise<number> {
  const [agg, group] = await Promise.all([
    prisma.scribeCapture.aggregate({
      where: { organizationId, engine: { notIn: ['paste', 'import'] } },
      _sum: { captureSeconds: true },
    }),
    // Group captures (20261023_scribe_session_start); 0 before that migration runs
    prisma.scribeGroupCapture.aggregate({ where: { organizationId }, _sum: { captureSeconds: true } }).catch(() => null),
  ]);
  return (agg._sum.captureSeconds ?? 0) + (group?._sum.captureSeconds ?? 0);
}

/** Trial AI Scribe minutes for the organization; `pendingSeconds` = audio reported but not yet saved. */
export async function trialScribeAllowanceFor(organizationId: string, pendingSeconds = 0): Promise<TrialScribeAllowance> {
  const access = await getOrgAccess(organizationId);
  if (access.unlimited || access.status !== 'trialing') return { limited: false };
  return trialScribeAllowance(access, (await orgScribeSecondsUsed(organizationId)) + pendingSeconds);
}
