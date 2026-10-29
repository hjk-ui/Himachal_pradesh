/**
 * READ-ONLY. Counts duplicate appointments: same organization + client + clinician + startsAt,
 * not cancelled (CANCELLED / LATE_CANCEL excluded), more than one row. The calendar's
 * "Edit Details" used to open the create form, so saving booked a second copy.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/find-duplicate-appointments.ts
 *   ... --org=<organizationId>   only one org
 *   ... --json                   machine-readable output
 *
 * Prints ids and counts only (no names, notes or times beyond the slot instant). Never writes.
 */
import { prisma } from '@/lib/db/prisma';
import { CANCELLED_APPOINTMENT_STATUSES } from '@/lib/appointments/duplicates';

type Group = {
  organizationId: string | null;
  clientId: string;
  clinicianId: string | null;
  startsAt: string;
  count: number;
  appointmentIds: string[];
  /** Seconds between the first and last copy being created (double-click ≈ 0-5s; edit-bug ≈ minutes+). */
  createdSpreadSeconds: number;
  statuses: string[];
};

async function main() {
  const args = process.argv.slice(2);
  const orgArg = args.find((a) => a.startsWith('--org='))?.slice(6) || null;
  const asJson = args.includes('--json');

  const grouped = await prisma.appointment.groupBy({
    by: ['organizationId', 'clientId', 'clinicianId', 'startsAt'],
    where: {
      status: { notIn: CANCELLED_APPOINTMENT_STATUSES },
      ...(orgArg ? { organizationId: orgArg } : {}),
    },
    _count: { _all: true },
    having: { id: { _count: { gt: 1 } } },
    orderBy: { startsAt: 'asc' },
  });

  const groups: Group[] = [];
  for (const g of grouped) {
    const rows = await prisma.appointment.findMany({
      where: {
        organizationId: g.organizationId,
        clientId: g.clientId,
        clinicianId: g.clinicianId,
        startsAt: g.startsAt,
        status: { notIn: CANCELLED_APPOINTMENT_STATUSES },
      },
      select: { id: true, createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    const first = rows[0]?.createdAt.getTime() ?? 0;
    const last = rows[rows.length - 1]?.createdAt.getTime() ?? 0;
    groups.push({
      organizationId: g.organizationId,
      clientId: g.clientId,
      clinicianId: g.clinicianId,
      startsAt: g.startsAt.toISOString(),
      count: rows.length,
      appointmentIds: rows.map((r) => r.id),
      createdSpreadSeconds: Math.round((last - first) / 1000),
      statuses: [...new Set(rows.map((r) => r.status))],
    });
  }

  const byOrg = new Map<string, { groups: number; extraRows: number }>();
  for (const g of groups) {
    const k = g.organizationId ?? '(no organizationId)';
    const cur = byOrg.get(k) ?? { groups: 0, extraRows: 0 };
    cur.groups += 1;
    cur.extraRows += g.count - 1;
    byOrg.set(k, cur);
  }
  const summary = {
    duplicateGroups: groups.length,
    extraRows: groups.reduce((n, g) => n + g.count - 1, 0),
    groupsCreatedWithin10s: groups.filter((g) => g.createdSpreadSeconds <= 10).length,
    groupsCreatedMoreThan10sApart: groups.filter((g) => g.createdSpreadSeconds > 10).length,
    byOrganization: Object.fromEntries(byOrg),
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, groups }, null, 2));
    return;
  }
  console.log('Duplicate appointments (same org + client + clinician + startsAt, not cancelled) — READ ONLY');
  console.log(JSON.stringify(summary, null, 2));
  for (const g of groups) {
    console.log(
      `org=${g.organizationId ?? '-'} client=${g.clientId} clinician=${g.clinicianId ?? '-'} startsAt=${g.startsAt} ` +
        `count=${g.count} spread=${g.createdSpreadSeconds}s statuses=${g.statuses.join('/')} ids=${g.appointmentIds.join(',')}`
    );
  }
  if (!groups.length) console.log('No duplicates found.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
