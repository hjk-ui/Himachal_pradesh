/**
 * READ-ONLY. Prints the Practice overview / Census numbers next to independent SQL counts so they can
 * be compared on staging after a deploy. Never writes (SELECT only; no audit rows either: it calls the
 * loaders directly, not the API routes).
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/check-practice-overview.ts
 *   ... --org=<organizationId>    required when the database has more than one organization
 *   ... --date=YYYY-MM-DD         census day (practice clock), default today
 *
 * Output: counts and Location names only (no client names or ids).
 * Sections:
 *   1. Clients per location (total / ACTIVE): overview vs SQL on "Client"
 *   2. Appointments on the census day by status: census vs SQL (organization rule shared by the overview,
 *      census, schedule and appointments API; the old narrow rule is shown for reference)
 *   3. Appointments in the 90 practice days ending today: overview (sum of locations + unassigned) vs SQL
 *   4. Valant charges / payments for the 90 calendar days ending today by facility mapping: overview vs SQL
 *      joined to "FacilityLocationMap"
 *
 * Organization rule (clientOrgFilter / appointmentOrgWhere): appointment.organizationId = org, or the client's
 * organizationId = org, or the client's location belongs to org, or (no location and the assigned clinician is in org).
 * Windows are practice-clock days (PracticeSettings.timeZone, DST-safe); Valant serviceDate is a calendar date.
 */
import { prisma } from '@/lib/db/prisma';
import { loadPracticeOverview } from '@/lib/locations/overviewServer';
import { loadPracticeCensus } from '@/lib/locations/censusServer';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceToday } from '@/lib/time/practiceTime';
import { addDaysYmd, practiceDayBounds } from '@/lib/dashboard/practiceDay';

const utcDay = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (n: number | bigint | null | undefined) => Number(n ?? 0);
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const flag = (a: number, b: number) => (a === b ? 'ok' : `DIFF ${a - b > 0 ? '+' : ''}${a - b}`);

function table(title: string, header: string[], rows: (string | number)[][]) {
  console.log(`\n=== ${title} ===`);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)) + 2);
  console.log(header.map((h, i) => pad(h, widths[i])).join(''));
  for (const r of rows) console.log(r.map((c, i) => pad(c, widths[i])).join(''));
}

async function main() {
  const args = process.argv.slice(2);
  let orgId = args.find((a) => a.startsWith('--org='))?.slice(6) || null;
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice(7) || null;
  if (!orgId) {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    if (orgs.length !== 1) {
      console.log('More than one organization; pass --org=<id>:');
      for (const o of orgs) console.log(`  ${o.id}  ${o.name}`);
      return;
    }
    orgId = orgs[0].id;
  }
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const now = new Date();
  const tz = await getPracticeTimeZone(orgId);
  const date = dateArg || practiceToday(tz, now);
  console.log(`Organization: ${org?.name ?? '?'} (${orgId})  now=${now.toISOString()}  practice tz=${tz}  census date=${date}`);

  const [overview, census] = await Promise.all([loadPracticeOverview(orgId, now), loadPracticeCensus(orgId, { date, now })]);
  const locations = await prisma.location.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  // 1. Clients per location
  const clientSql = await prisma.$queryRaw<{ locationId: string | null; total: number; active: number }[]>`
    SELECT c."locationId", COUNT(*)::int AS total, COUNT(*) FILTER (WHERE c."status" = 'ACTIVE')::int AS active
    FROM "Client" c
    LEFT JOIN "Location" l ON l."id" = c."locationId"
    LEFT JOIN "User" u ON u."id" = c."assignedToId"
    WHERE c."organizationId" = ${orgId} OR l."organizationId" = ${orgId} OR (c."locationId" IS NULL AND u."organizationId" = ${orgId})
    GROUP BY 1`;
  const narrowClients = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "Client" WHERE "organizationId" = ${orgId}`;
  const sqlBy = new Map(clientSql.map((r) => [r.locationId && locName.has(r.locationId) ? r.locationId : '__none__', r]));
  const orphan = clientSql.filter((r) => r.locationId && !locName.has(r.locationId));
  const rows1: (string | number)[][] = overview.locations.map((l) => {
    const s = sqlBy.get(l.id);
    return [l.name, l.clients.total, num(s?.total), flag(l.clients.total, num(s?.total)), l.clients.active, num(s?.active), flag(l.clients.active, num(s?.active))];
  });
  const noneSql = clientSql.filter((r) => !r.locationId || !locName.has(r.locationId));
  const noneTotal = noneSql.reduce((s, r) => s + r.total, 0);
  const noneActive = noneSql.reduce((s, r) => s + r.active, 0);
  rows1.push(['(no location)', overview.unassigned.clients, noneTotal, flag(overview.unassigned.clients, noneTotal), overview.unassigned.activeClients, noneActive, flag(overview.unassigned.activeClients, noneActive)]);
  table('1. Clients per home location (overview vs SQL)', ['Location', 'Total(ov)', 'Total(sql)', '', 'Active(ov)', 'Active(sql)', ''], rows1);
  console.log(`   clients matched by the broader rule only (no organizationId = org): ${clientSql.reduce((s, r) => s + r.total, 0) - (narrowClients[0]?.n ?? 0)}`);
  if (orphan.length) console.log(`   note: ${orphan.reduce((s, r) => s + r.total, 0)} clients point at a location id outside this org (counted as no location)`);
  const caseActive = census.caseload.totals.activeClients;
  console.log(`   census caseload active clients = ${caseActive} vs SQL ${clientSql.reduce((s, r) => s + r.active, 0)} (${flag(caseActive, clientSql.reduce((s, r) => s + r.active, 0))})`);

  // 2. Appointments on the census day by status
  const { start, end } = practiceDayBounds(date, tz);
  const apptNarrowRule = await prisma.$queryRaw<{ status: string; n: number }[]>`
    SELECT a."status"::text AS status, COUNT(*)::int AS n
    FROM "Appointment" a JOIN "Client" c ON c."id" = a."clientId"
    WHERE (a."organizationId" = ${orgId} OR (a."organizationId" IS NULL AND c."organizationId" = ${orgId}))
      AND a."startsAt" >= ${start} AND a."startsAt" < ${end}
    GROUP BY 1`;
  const apptOrgRule = await prisma.$queryRaw<{ status: string; n: number }[]>`
    SELECT a."status"::text AS status, COUNT(*)::int AS n
    FROM "Appointment" a JOIN "Client" c ON c."id" = a."clientId"
    LEFT JOIN "Location" l ON l."id" = c."locationId"
    LEFT JOIN "User" u ON u."id" = c."assignedToId"
    WHERE (a."organizationId" = ${orgId} OR c."organizationId" = ${orgId} OR l."organizationId" = ${orgId}
           OR (c."locationId" IS NULL AND u."organizationId" = ${orgId}))
      AND a."startsAt" >= ${start} AND a."startsAt" < ${end}
    GROUP BY 1`;
  const byStatus = (rows: { status: string; n: number }[]) => new Map(rows.map((r) => [r.status, r.n]));
  const ovRule = byStatus(apptNarrowRule);
  const ceRule = byStatus(apptOrgRule);
  const c = census.totals.appointments.counts;
  const censusBy: Record<string, number> = {
    SCHEDULED: c.notArrived, CHECKED_IN: c.checkedIn, IN_SESSION: c.inSession, COMPLETED: c.completed,
    NO_SHOW: c.noShow, LATE_CANCEL: c.lateCancel, CANCELLED: c.cancelled,
  };
  table(
    `2. Appointments ${date} [${start.toISOString()} .. ${end.toISOString()}) by status`,
    ['Status', 'Census', 'SQL(org rule)', '', 'SQL(old narrow rule)'],
    Object.keys(censusBy).map((s) => [s, censusBy[s], ceRule.get(s) ?? 0, flag(censusBy[s], ceRule.get(s) ?? 0), ovRule.get(s) ?? 0])
  );
  console.log(`   census: booked ${c.booked}, remaining ${c.remaining}, unique clients seen ${census.totals.uniqueClientsSeen}, walk-ins ${census.totals.walkIns}, protected appts ${census.totals.protectedAppointments}`);
  for (const l of census.locations) console.log(`   census ${l.name}: booked ${l.appointments.counts.booked}, completed ${l.appointments.counts.completed}, inferred location ${l.inferredAppointments}`);
  const prpSql = await prisma.$queryRaw<{ n: number; clients: number }[]>`
    SELECT COUNT(*)::int AS n, COUNT(DISTINCT "clientId")::int AS clients FROM prp_attendance
    WHERE "organizationId" = ${orgId} AND "serviceDate" = ${new Date(`${date}T00:00:00.000Z`)}`;
  console.log(`   PRP attendance ${date}: census ${census.totals.prp.encounters} encounters / ${census.totals.prp.clients} clients vs SQL ${prpSql[0]?.n ?? 0} / ${prpSql[0]?.clients ?? 0} (SQL: rows stored exactly at 00:00 UTC; census also keeps only org clients)`);
  const crisisSql = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM "CrisisEpisode" WHERE "organizationId" = ${orgId} AND "startedAt" >= ${start} AND "startedAt" < ${end}`;
  console.log(`   crisis episodes opened: census ${census.crisis.opened} vs SQL ${crisisSql[0]?.n ?? 0} (${flag(census.crisis.opened, crisisSql[0]?.n ?? 0)})`);
  console.log(`   residential: residents ${census.residential.total.residents}, beds ${census.residential.total.beds ?? 'not configured'}, unlinked residents excluded ${census.residential.unlinkedExcluded}`);

  // 3. Appointments in the 90 practice days ending today (up to now)
  const today = practiceToday(tz, now);
  const since90 = practiceDayBounds(addDaysYmd(today, -89), tz).start;
  const appt90 = await prisma.$queryRaw<{ status: string; n: number }[]>`
    SELECT a."status"::text AS status, COUNT(*)::int AS n
    FROM "Appointment" a JOIN "Client" c ON c."id" = a."clientId"
    LEFT JOIN "Location" l ON l."id" = c."locationId"
    LEFT JOIN "User" u ON u."id" = c."assignedToId"
    WHERE (a."organizationId" = ${orgId} OR c."organizationId" = ${orgId} OR l."organizationId" = ${orgId}
           OR (c."locationId" IS NULL AND u."organizationId" = ${orgId}))
      AND a."startsAt" >= ${since90} AND a."startsAt" <= ${now}
    GROUP BY 1`;
  const s90 = byStatus(appt90);
  const ovSum = (f: (a: (typeof overview.locations)[number]['appointments']['last90']) => number) => overview.locations.reduce((s, l) => s + f(l.appointments.last90), 0);
  const ovTotal = ovSum((a) => a.total) + overview.unassigned.appointments90;
  const sqlTotal = [...s90.values()].reduce((s, n) => s + n, 0);
  table(`3. Appointments ${addDaysYmd(today, -89)} .. now (practice days)`, ['Metric', 'Overview', 'SQL', ''], [
    ['total', ovTotal, sqlTotal, flag(ovTotal, sqlTotal)],
    ['COMPLETED (located)', ovSum((a) => a.completed), s90.get('COMPLETED') ?? 0, 'unassigned not split by status'],
    ['NO_SHOW (located)', ovSum((a) => a.noShow), s90.get('NO_SHOW') ?? 0, ''],
    ['LATE_CANCEL (located)', ovSum((a) => a.lateCancel), s90.get('LATE_CANCEL') ?? 0, ''],
    ['CANCELLED (located)', ovSum((a) => a.cancelled), s90.get('CANCELLED') ?? 0, ''],
  ]);
  for (const l of overview.locations) console.log(`   ${l.name}: ${l.appointments.last90.total} appts (${l.appointments.last90.inferred} inferred location), completed ${l.appointments.last90.completed}`);

  // 4. Valant last 90 days by facility mapping
  const valant = await prisma.$queryRaw<{ facility: string | null; kind: string | null; locationId: string | null; programKey: string | null; homeLocationId: string | null; category: string; cents: bigint | number | null; n: number }[]>`
    SELECT t."facility", m."kind", m."locationId", m."programKey", c."locationId" AS "homeLocationId", t."category",
           SUM(t."amountCents")::bigint AS cents, COUNT(*)::int AS n
    FROM "ValantTransaction" t
    LEFT JOIN "Client" c ON c."id" = t."clientId"
    LEFT JOIN "FacilityLocationMap" m
      ON m."organizationId" = t."organizationId" AND m."sourceSystem" = 'valant'
     AND lower(regexp_replace(trim(m."facilityName"), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(t."facility"), '\\s+', ' ', 'g'))
    WHERE t."organizationId" = ${orgId} AND t."serviceDate" >= ${utcDay(addDaysYmd(today, -89))} AND t."serviceDate" < ${utcDay(addDaysYmd(today, 1))}
    GROUP BY 1, 2, 3, 4, 5, 6`;
  const sqlLoc = new Map<string, { charges: number; payments: number }>();
  const facRows: (string | number)[][] = [];
  const facAgg = new Map<string, { kind: string; target: string; charges: number; payments: number; rows: number }>();
  for (const r of valant) {
    const cents = num(r.cents);
    const fac = r.facility?.trim() || '(no facility)';
    const kind = r.facility?.trim() ? r.kind ?? 'unmapped' : '-';
    const target = r.kind === 'location' ? locName.get(r.locationId ?? '') ?? 'unknown location' : r.kind === 'program' ? r.programKey ?? '?' : '';
    const fa = facAgg.get(fac) ?? { kind, target, charges: 0, payments: 0, rows: 0 };
    fa.rows += r.n;
    if (r.category === 'charge') fa.charges += cents;
    if (r.category === 'insurance_payment' || r.category === 'patient_payment') fa.payments -= cents;
    facAgg.set(fac, fa);
    // Same rule as the overview: location facilities by mapping; program facilities at the
    // mapped location, else the client's home location
    const locTarget =
      r.kind === 'location' ? r.locationId : r.kind === 'program' ? r.locationId ?? (r.homeLocationId && locName.has(r.homeLocationId) ? r.homeLocationId : null) : null;
    if (locTarget) {
      const l = sqlLoc.get(locTarget) ?? { charges: 0, payments: 0 };
      if (r.category === 'charge') l.charges += cents;
      if (r.category === 'insurance_payment' || r.category === 'patient_payment') l.payments -= cents;
      sqlLoc.set(locTarget, l);
    }
  }
  for (const [fac, a] of [...facAgg.entries()].sort((x, y) => y[1].rows - x[1].rows)) facRows.push([fac, a.kind, a.target, a.rows, usd(a.charges), usd(a.payments)]);
  table('4a. Valant last 90 days by facility (SQL)', ['Facility', 'Mapping', 'Maps to', 'Rows', 'Charges', 'Payments'], facRows);
  table(
    '4b. Valant last 90 days by location (overview vs SQL)',
    ['Location', 'Charges(ov)', 'Charges(sql)', '', 'Payments(ov)', 'Payments(sql)', ''],
    overview.locations.map((l) => {
      const s = sqlLoc.get(l.id) ?? { charges: 0, payments: 0 };
      return [l.name, usd(l.valant.last90.chargesCents), usd(s.charges), flag(l.valant.last90.chargesCents, s.charges), usd(l.valant.last90.paymentsCents), usd(s.payments), flag(l.valant.last90.paymentsCents, s.payments)];
    })
  );
  for (const p of overview.programs) console.log(`   program ${p.label}: overview charges ${usd(p.last90.chargesCents)}, clients ${p.clients}${p.enrollments ? `, PRP enrollments ${p.enrollments.total}` : ''}`);
  console.log(`   overview rows without facility (90 d): ${overview.noFacilityRows90}; journal imported: ${overview.journalImported}`);
  if (overview.warnings.length) {
    console.log('\nOverview data checks:');
    for (const w of overview.warnings) console.log(`  [${w.level}] ${w.code}: ${w.message}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
