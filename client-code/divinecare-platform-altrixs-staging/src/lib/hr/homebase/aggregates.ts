/**
 * Documentation aggregates for the payroll reconciliation: COUNTS and MINUTES per clinician per
 * practice day, computed in SQL (GROUP BY). No row-level visit or note data leaves the database:
 * every SELECT list here is clinician id, day, and aggregates.
 *
 * Organization scope goes through the clinician's own staff account ("User"."organizationId"),
 * plus the visit's organizationId when it is set.
 *
 * tests/homebase-connector.test.ts reads this file and fails if it ever names a person-level
 * chart column or table, so keep it that way.
 */
import { prisma } from '@/lib/db/prisma';
import type { NoteCounts, VisitDay } from './reconcile';

const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

/** Visits per clinician per practice day in [from, to). */
export async function visitDayAggregates(organizationId: string, from: Date, to: Date, timeZone: string): Promise<VisitDay[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: string; day: string; completed: bigint; scheduled: bigint; minutes: bigint | number | null }>>`
    SELECT a."clinicianId" AS "userId",
      to_char((a."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS "day",
      COUNT(*) FILTER (WHERE a."status" = 'COMPLETED') AS "completed",
      COUNT(*) FILTER (WHERE a."status" NOT IN ('CANCELLED', 'NO_SHOW', 'LATE_CANCEL')) AS "scheduled",
      COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (a."endsAt" - a."startsAt")) / 60)) FILTER (WHERE a."status" NOT IN ('CANCELLED', 'NO_SHOW', 'LATE_CANCEL')), 0)::bigint AS "minutes"
    FROM "Appointment" a
    JOIN "User" u ON u."id" = a."clinicianId" AND u."organizationId" = ${organizationId}
    WHERE a."startsAt" >= ${from} AND a."startsAt" < ${to}
      AND (a."organizationId" IS NULL OR a."organizationId" = ${organizationId})
    GROUP BY 1, 2`;
  return rows.map((r) => ({ userId: r.userId, day: r.day, completedVisits: n(r.completed), scheduledVisits: n(r.scheduled), scheduledMinutes: n(r.minutes) }));
}

/**
 * Notes per clinician with service date in [from, to): signed, unsigned, and unsigned past the
 * practice signing deadline (dismissed notes excluded).
 */
export async function noteCountAggregates(organizationId: string, from: Date, to: Date, deadlineHours: number): Promise<NoteCounts[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: string; signed: bigint; unsigned: bigint; pastDue: bigint }>>`
    SELECT pn."clinicianId" AS "userId",
      COUNT(*) FILTER (WHERE w."signedAt" IS NOT NULL) AS "signed",
      COUNT(*) FILTER (WHERE w."signedAt" IS NULL AND pn."dismissedAt" IS NULL) AS "unsigned",
      COUNT(*) FILTER (WHERE w."signedAt" IS NULL AND pn."dismissedAt" IS NULL
        AND COALESCE(pn."dateOfService", pn."createdAt") + make_interval(hours => ${deadlineHours}::int) < NOW()) AS "pastDue"
    FROM "ProgressNote" pn
    JOIN "User" u ON u."id" = pn."clinicianId" AND u."organizationId" = ${organizationId}
    LEFT JOIN "ProgressNoteWorkflow" w ON w."noteId" = pn."id"
    WHERE COALESCE(pn."dateOfService", pn."createdAt") >= ${from} AND COALESCE(pn."dateOfService", pn."createdAt") < ${to}
    GROUP BY 1`;
  return rows.map((r) => ({ userId: r.userId, signedNotes: n(r.signed), unsignedNotes: n(r.unsigned), unsignedPastDue: n(r.pastDue) }));
}
