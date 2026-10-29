/**
 * Group AI Scribe persistence and access (server only). See group.ts for the rules.
 * Only a clinician who may document the session (facilitator, co-facilitator, group leadership)
 * opens or uses a group capture; the capture is org-scoped on every query.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSessionDetail, groupActor } from '@/lib/groups/store';
import { isGroupKind, isAttended, type GroupKind } from '@/lib/groups/types';
import type { ScribeActor } from './store';
import type { RawSegment } from './diarization';
import type { GroupMember } from './group';

/** Session detail for the scribe (roster with visibility, Part 2, canDocument). */
export async function groupSessionForScribe(actor: ScribeActor, sessionId: string) {
  const s = await prisma.clinicalGroupSession.findFirst({ where: { id: sessionId, organizationId: actor.organizationId }, select: { group: { select: { kind: true } } } });
  if (!s || !isGroupKind(s.group.kind)) return null;
  const detail = await getSessionDetail(groupActor({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role as Role }), sessionId, s.group.kind as GroupKind);
  if (!detail.ok) return null;
  return detail;
}

/** Members who can be heard: visible attendees not marked absent / excused. Hidden members count as people present. */
export function presentAttendees<T extends { clientId: string | null; status: string; visible: boolean }>(attendees: T[]): { visible: (T & { clientId: string })[]; hidden: number } {
  const here = attendees.filter((a) => a.status === 'unmarked' || isAttended(a.status));
  return {
    visible: here.filter((a): a is T & { clientId: string } => a.visible && Boolean(a.clientId)),
    hidden: here.filter((a) => !a.visible).length,
  };
}

export async function findGroupCapture(actor: ScribeActor, id: string) {
  const cap = await prisma.scribeGroupCapture.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!cap) return null;
  if (cap.clinicianId !== actor.userId) {
    const detail = await groupSessionForScribe(actor, cap.groupSessionId);
    if (!detail?.canDocument) return null;
  }
  return cap;
}

export function groupMembersOf(cap: { members: unknown }): GroupMember[] {
  return Array.isArray(cap.members) ? (cap.members as GroupMember[]) : [];
}

export async function loadGroupSegments(captureId: string) {
  return prisma.scribeGroupSegment.findMany({
    where: { captureId },
    orderBy: { seq: 'asc' },
    select: { seq: true, speakerLabel: true, startMs: true, endMs: true, text: true },
    take: 8000,
  });
}

/** Append under a share lock on the capture row (same guard as individual captures). */
export async function appendGroupSegmentsIfOpen(capture: { id: string; organizationId: string }, segments: (RawSegment & { seq: number })[]): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    const open = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "scribe_group_captures" WHERE "id" = $1 AND "status" NOT IN ('discarded', 'ready') AND "consent_withdrawn_at" IS NULL AND "transcript_purged_at" IS NULL FOR SHARE`,
      capture.id
    );
    if (!open.length) return null;
    const res = await tx.scribeGroupSegment.createMany({
      data: segments.map((s) => ({
        captureId: capture.id,
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

/** Speaker labels with turn counts and a short sample (for the quick mapping step). */
export function speakerSummary(segments: { speakerLabel: string; text: string }[]): { label: string; turns: number; sample: string }[] {
  const by = new Map<string, { turns: number; sample: string }>();
  for (const s of segments) {
    const cur = by.get(s.speakerLabel) ?? { turns: 0, sample: '' };
    cur.turns++;
    if (cur.sample.length < 140) cur.sample = `${cur.sample} ${s.text}`.trim().slice(0, 160);
    by.set(s.speakerLabel, cur);
  }
  return [...by].map(([label, v]) => ({ label, ...v })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function groupCaptureView(cap: {
  id: string;
  groupSessionId: string;
  status: string;
  engine: string;
  language: string;
  part2: boolean;
  members: unknown;
  speakerMap: unknown;
  draft: unknown;
  captureSeconds: number;
  consentAttestedAt: Date;
  consentAttestedByName: string | null;
  transcriptPurgedAt: Date | null;
}) {
  return {
    id: cap.id,
    sessionId: cap.groupSessionId,
    status: cap.status,
    engine: cap.engine,
    language: cap.language,
    part2: cap.part2,
    members: groupMembersOf(cap),
    speakerMap: (cap.speakerMap as Record<string, string> | null) ?? {},
    draft: cap.draft ?? null,
    captureSeconds: cap.captureSeconds,
    consent: { attestedAt: cap.consentAttestedAt.toISOString(), attestedBy: cap.consentAttestedByName },
    purged: Boolean(cap.transcriptPurgedAt),
  };
}
