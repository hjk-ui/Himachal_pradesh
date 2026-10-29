import { prisma } from '@/lib/db/prisma';
import { attendedCount, groupClaimFindings } from './rules';

/**
 * Group billing rule inside the existing claim builder (generateClaimFromNote): when a signed note
 * was written from a group session, the claim line exists only for an attendee who attended with
 * enough minutes, for a per-session group with a code, within the recorded group-size cap.
 * Returns null when the note is not a group note. `info` is stored on the claim (submissionData.group).
 */
export async function groupNoteBilling(noteId: string): Promise<{
  errors: string[];
  warnings: string[];
  info: { sessionId: string; groupId: string; kind: string; groupSize: number; attendance: string; minutesAttended: number | null; part2: boolean };
} | null> {
  let row;
  try {
    row = await prisma.clinicalGroupAttendance.findUnique({
      where: { progressNoteId: noteId },
      select: {
        status: true,
        minutesAttended: true,
        session: {
          select: {
            id: true,
            durationMinutes: true,
            part2: true,
            attendance: { select: { status: true } },
            group: { select: { id: true, kind: true, billingCode: true, billingMode: true, minBillableMinutes: true, maxBillableGroupSize: true } },
          },
        },
      },
    });
  } catch {
    // Group tables not migrated yet: no group notes can exist
    return null;
  }
  if (!row) return null;
  const groupSize = attendedCount(row.session.attendance);
  const findings = groupClaimFindings({
    group: row.session.group,
    attendance: { status: row.status, minutesAttended: row.minutesAttended },
    groupSize,
    scheduledMinutes: row.session.durationMinutes,
  });
  return {
    errors: findings.filter((f) => f.severity === 'error').map((f) => f.message),
    warnings: findings.filter((f) => f.severity === 'warning').map((f) => f.message),
    info: {
      sessionId: row.session.id,
      groupId: row.session.group.id,
      kind: row.session.group.kind,
      groupSize,
      attendance: row.status,
      minutesAttended: row.minutesAttended,
      part2: row.session.part2,
    },
  };
}
