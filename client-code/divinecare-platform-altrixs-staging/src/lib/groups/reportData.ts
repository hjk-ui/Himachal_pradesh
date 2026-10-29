import { prisma } from '@/lib/db/prisma';
import type { ReportAttendance, ReportSession } from './rules';
import { canUseGroupKind } from './access';
import { GROUP_KINDS, type GroupKind } from './types';

/**
 * Data for the report library's Group attendance / Group utilization reports. Kinds are limited
 * to the areas the viewer's role can open (SUD Group Counseling is Part 2); attendance rows are
 * limited by the report's client scope (caseload roles: their clients; protected records the
 * viewer cannot open are left out).
 */
export async function loadGroupReportData(input: {
  organizationId: string;
  role: string;
  kind: 'all' | GroupKind;
  from: Date;
  toExclusive: Date;
  clientFilter: { in: string[] } | { notIn: string[] } | null;
}) {
  const kinds = (input.kind === 'all' ? [...GROUP_KINDS] : [input.kind]).filter((k) => canUseGroupKind(input.role, k));
  if (!kinds.length) return { kinds, groups: [], sessions: [] as ReportSession[], attendance: [] as ReportAttendance[] };
  const groups = await prisma.clinicalGroup.findMany({
    where: { organizationId: input.organizationId, kind: { in: kinds } },
    select: { id: true, name: true, kind: true, groupType: true, capacity: true, facilitatorId: true, status: true },
  });
  const sessions = await prisma.clinicalGroupSession.findMany({
    where: { organizationId: input.organizationId, groupId: { in: groups.map((g) => g.id) }, startsAt: { gte: input.from, lt: input.toExclusive } },
    select: {
      id: true,
      groupId: true,
      status: true,
      groupSize: true,
      attendance: {
        where: input.clientFilter ? { clientId: input.clientFilter } : {},
        select: { clientId: true, status: true, progressNoteId: true },
      },
    },
  });
  const noteIds = sessions.flatMap((s) => s.attendance.map((a) => a.progressNoteId).filter((x): x is string => Boolean(x)));
  const [signed, claims] = await Promise.all([
    prisma.progressNoteWorkflow.findMany({ where: { noteId: { in: noteIds }, status: { in: ['SIGNED', 'LOCKED'] } }, select: { noteId: true } }),
    prisma.claim.findMany({ where: { progressNoteId: { in: noteIds } }, select: { id: true, progressNoteId: true } }),
  ]);
  const signedSet = new Set(signed.map((s) => s.noteId));
  const claimBy = new Map(claims.map((c) => [c.progressNoteId, c.id]));
  return {
    kinds,
    groups,
    sessions: sessions.map((s) => ({ id: s.id, groupId: s.groupId, status: s.status, groupSize: s.groupSize })),
    attendance: sessions.flatMap((s) =>
      s.attendance.map((a) => ({
        sessionId: s.id,
        groupId: s.groupId,
        clientId: a.clientId,
        status: a.status,
        hasNote: Boolean(a.progressNoteId),
        noteSigned: a.progressNoteId ? signedSet.has(a.progressNoteId) : false,
        claimId: a.progressNoteId ? claimBy.get(a.progressNoteId) ?? null : null,
      }))
    ),
  };
}
