import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceToday } from '@/lib/time/practiceTime';
import { addDaysYmd, practiceDayBounds } from '@/lib/dashboard/practiceDay';
import { loadResidentialCapacity } from '@/lib/residential/capacityServer';
import { buildPracticeCensus, CENSUS_TREND_DAYS, type CensusSession, type PracticeCensus } from './census';
import { buildClientFacilityResolver, importedSites } from './facilityOverview';
import { hasClientValantFacilityColumn } from './overviewServer';

/**
 * Server side of the daily practice census. Every query is organization scoped; the shape and the
 * math live in census.ts (pure, tested). Leadership-gated and audited by GET /api/locations/census.
 */

export class CensusInputError extends Error {}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const utcDay = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

async function appointmentLocationColumn(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'Appointment' AND column_name = 'location_id'`;
  return (rows[0]?.n ?? 0) > 0;
}

export async function loadPracticeCensus(
  organizationId: string,
  opts: { date?: string | null; locationId?: string | null; now?: Date; grouping?: 'location' | 'facility'; facility?: string | null } = {}
): Promise<PracticeCensus> {
  if (opts.grouping === 'facility') return loadFacilityCensus(organizationId, opts);
  const now = opts.now ?? new Date();
  const timeZone = await getPracticeTimeZone(organizationId);
  const date = opts.date?.trim() || practiceToday(timeZone, now);
  if (!YMD.test(date) || Number.isNaN(utcDay(date).getTime()) || utcDay(date).toISOString().slice(0, 10) !== date) {
    throw new CensusInputError('Date must be YYYY-MM-DD');
  }
  const window = practiceDayBounds(date, timeZone);
  const firstDay = addDaysYmd(date, -(CENSUS_TREND_DAYS - 1));
  const trendStart = practiceDayBounds(firstDay, timeZone).start;
  // date-only columns are stored at 00:00 UTC; widen by a day each side, census.ts picks the exact day
  const storedFrom = utcDay(addDaysYmd(firstDay, -1));
  const storedTo = utcDay(addDaysYmd(date, 2));

  const locations = await prisma.location.findMany({
    where: { organizationId },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, active: true },
  });
  const locationId = opts.locationId?.trim() || null;
  if (locationId && !locations.some((l) => l.id === locationId)) throw new CensusInputError('Unknown location');

  const [hasCol, appts, prp, tms, spravato, residentsRaw, crisis, capacity, activeClients, primaryCare, prpActive, tmsActive, spravatoActive] =
    await Promise.all([
      appointmentLocationColumn(),
      prisma.appointment.findMany({
        where: { AND: [appointmentOrgWhere(organizationId), { startsAt: { gte: trendStart, lt: window.end } }] },
        take: 50_000,
        select: {
          id: true, clientId: true, clinicianId: true, clinicianName: true, type: true, notes: true, isVirtual: true, status: true, startsAt: true,
          clinician: { select: { name: true, role: true } },
          client: { select: { locationId: true, sensitiveRecord: { select: { id: true } } } },
        },
      }),
      prisma.prpAttendance.findMany({
        where: { organizationId, serviceDate: { gte: storedFrom, lt: storedTo } },
        select: { clientId: true, serviceDate: true },
      }),
      prisma.tmsSession.findMany({
        where: { course: { organizationId }, sessionDate: { gte: storedFrom, lt: storedTo } },
        select: { sessionDate: true, course: { select: { clientId: true, client: { select: { locationId: true } } } } },
      }),
      prisma.spravatoSession.findMany({
        where: { enrollment: { organizationId }, sessionDate: { gte: storedFrom, lt: storedTo } },
        select: { sessionDate: true, enrollment: { select: { clientId: true, client: { select: { locationId: true } } } } },
      }),
      prisma.residentialResident.findMany({
        where: { OR: [{ active: true }, { updatedAt: { gte: trendStart } }, { admitDate: { gte: storedFrom } }] },
        select: { clientId: true, program: true, admitDate: true, active: true, updatedAt: true },
      }),
      prisma.crisisEpisode.findMany({
        where: { organizationId, startedAt: { gte: window.start, lt: window.end } },
        select: { clientId: true, startedAt: true, priority: true },
      }),
      loadResidentialCapacity(organizationId),
      // same organization rule as the overview, the schedule and the appointments API (clientOrgFilter)
      prisma.client.groupBy({ by: ['locationId'], where: { AND: [clientOrgFilter(organizationId), { status: 'ACTIVE' }] }, _count: { _all: true } }),
      prisma.client.groupBy({ by: ['locationId'], where: { AND: [clientOrgFilter(organizationId), { status: 'ACTIVE' }, primaryCarePatientWhere()] }, _count: { _all: true } }),
      prisma.$queryRaw<{ locationId: string | null; count: number }[]>`
        SELECT c."locationId" AS "locationId", COUNT(DISTINCT e."clientId")::int AS "count"
        FROM "PrpEnrollment" e JOIN "Client" c ON c."id" = e."clientId"
        WHERE e."organizationId" = ${organizationId} AND e."status" = 'active'
        GROUP BY 1`,
      prisma.$queryRaw<{ locationId: string | null; count: number }[]>`
        SELECT c."locationId" AS "locationId", COUNT(DISTINCT t."clientId")::int AS "count"
        FROM "TmsCourse" t JOIN "Client" c ON c."id" = t."clientId"
        WHERE t."organizationId" = ${organizationId} AND t."status" = 'active'
        GROUP BY 1`,
      prisma.$queryRaw<{ locationId: string | null; count: number }[]>`
        SELECT c."locationId" AS "locationId", COUNT(DISTINCT s."clientId")::int AS "count"
        FROM "SpravatoEnrollment" s JOIN "Client" c ON c."id" = s."clientId"
        WHERE s."organizationId" = ${organizationId} AND s."status" = 'active'
        GROUP BY 1`,
    ]);

  // Appointment's own location (raw column, not in the Prisma model)
  const own = new Map<string, string | null>();
  if (hasCol && appts.length) {
    const ids = appts.map((a) => a.id);
    for (let i = 0; i < ids.length; i += 5000) {
      const chunk = ids.slice(i, i + 5000);
      const rows = await prisma.$queryRaw<{ id: string; loc: string | null }[]>`
        SELECT "id", "location_id"::text AS "loc" FROM "Appointment" WHERE "id" = ANY(${chunk}::text[])`;
      for (const r of rows) own.set(r.id, r.loc);
    }
  }

  // Home locations of the org's clients referenced by PRP attendance, residents and crisis episodes
  const lookupIds = [
    ...new Set([...prp.map((p) => p.clientId), ...residentsRaw.map((r) => r.clientId), ...crisis.map((c) => c.clientId)].filter((v): v is string => !!v)),
  ];
  const clientLoc = new Map<string, string | null>();
  for (let i = 0; i < lookupIds.length; i += 5000) {
    const rows = await prisma.client.findMany({
      where: { id: { in: lookupIds.slice(i, i + 5000) }, AND: [clientOrgFilter(organizationId)] },
      select: { id: true, locationId: true },
    });
    for (const r of rows) clientLoc.set(r.id, r.locationId);
  }

  // ResidentialResident has no organizationId: keep residents linked to this org's clients only
  const residents = residentsRaw.filter((r) => r.clientId && clientLoc.has(r.clientId));
  const unlinkedResidents = residentsRaw.filter((r) => !r.clientId && r.active).length;

  const session = (clientId: string, loc: string | null, d: Date): CensusSession => ({ clientId, clientLocationId: loc, date: d });

  return buildPracticeCensus({
    now,
    date,
    timeZone,
    window,
    locations,
    locationId,
    appointments: appts.map((a) => ({
      clientId: a.clientId,
      clinicianId: a.clinicianId,
      clinicianName: a.clinician?.name?.trim() || a.clinicianName?.trim() || null,
      clinicianRole: a.clinician?.role ? String(a.clinician.role) : null,
      type: a.type,
      notes: a.notes,
      isVirtual: a.isVirtual,
      status: String(a.status),
      startsAt: a.startsAt,
      appointmentLocation: own.get(a.id) ?? null,
      clientLocationId: a.client.locationId,
      protected: Boolean(a.client.sensitiveRecord),
    })),
    prpAttendance: prp.filter((p) => clientLoc.has(p.clientId)).map((p) => session(p.clientId, clientLoc.get(p.clientId) ?? null, p.serviceDate)),
    tmsSessions: tms.map((s) => session(s.course.clientId, s.course.client.locationId, s.sessionDate)),
    spravatoSessions: spravato.map((s) => session(s.enrollment.clientId, s.enrollment.client.locationId, s.sessionDate)),
    residents: residents.map((r) => ({
      clientLocationId: clientLoc.get(r.clientId as string) ?? null,
      program: r.program,
      admitDate: r.admitDate,
      active: r.active,
      updatedAt: r.updatedAt,
    })),
    unlinkedResidents,
    capacity: capacity.rows,
    capacityMigrationPending: capacity.migrationPending,
    crisisEpisodes: crisis.map((c) => ({ clientLocationId: c.clientId ? clientLoc.get(c.clientId) ?? null : null, startedAt: c.startedAt, priority: c.priority })),
    caseload: {
      activeClients: activeClients.map((g) => ({ locationId: g.locationId, count: g._count._all })),
      primaryCareActive: primaryCare.map((g) => ({ locationId: g.locationId, count: g._count._all })),
      prpActive,
      tmsActive,
      spravatoActive,
    },
    appointmentLocationColumn: hasCol,
  });
}

/**
 * Census with the practice's Valant facilities as rows (Practice overview "By facility"). Sites are the
 * facility list import rows; each client counts at its Valant facility (Client.valantFacility resolved
 * against the list: facility name, else a billing entity with one facility; ambiguous = no facility).
 * Built by handing census.ts the facilities as its "locations", so the math is the same as by location.
 */
async function loadFacilityCensus(
  organizationId: string,
  opts: { date?: string | null; now?: Date; facility?: string | null }
): Promise<PracticeCensus> {
  if (!(await hasClientValantFacilityColumn())) {
    throw new CensusInputError('Client facility is not available yet: apply migration 20261019_client_valant_facility.sql, then re-import the Valant client file.');
  }
  const now = opts.now ?? new Date();
  const timeZone = await getPracticeTimeZone(organizationId);
  const date = opts.date?.trim() || practiceToday(timeZone, now);
  if (!YMD.test(date) || Number.isNaN(utcDay(date).getTime()) || utcDay(date).toISOString().slice(0, 10) !== date) {
    throw new CensusInputError('Date must be YYYY-MM-DD');
  }
  const window = practiceDayBounds(date, timeZone);
  const firstDay = addDaysYmd(date, -(CENSUS_TREND_DAYS - 1));
  const trendStart = practiceDayBounds(firstDay, timeZone).start;
  const storedFrom = utcDay(addDaysYmd(firstDay, -1));
  const storedTo = utcDay(addDaysYmd(date, 2));

  const facilityRows = await prisma.facilityLocationMap.findMany({
    where: { organizationId, sourceSystem: 'valant' },
    select: { facilityName: true, billingEntityName: true, timezone: true, sourceActive: true, kind: true, locationId: true, programKey: true, needsConfirmation: true, facilityImportedAt: true },
  });
  const sites = importedSites(facilityRows);
  const facility = opts.facility?.trim() || null;
  if (facility && !sites.some((s) => s.facilityName === facility)) throw new CensusInputError('Unknown facility');
  const resolve = buildClientFacilityResolver(sites);
  const facOf = (raw: string | null | undefined) => resolve(raw).facilityName;
  const scope = clientOrgFilter(organizationId);

  const [appts, prp, tms, spravato, residentsRaw, crisis, capacity, activeClients, primaryCare, prpActive, tmsActive, spravatoActive] =
    await Promise.all([
      prisma.appointment.findMany({
        where: { AND: [appointmentOrgWhere(organizationId), { startsAt: { gte: trendStart, lt: window.end } }] },
        take: 50_000,
        select: {
          id: true, clientId: true, clinicianId: true, clinicianName: true, type: true, notes: true, isVirtual: true, status: true, startsAt: true,
          clinician: { select: { name: true, role: true } },
          client: { select: { valantFacility: true, sensitiveRecord: { select: { id: true } } } },
        },
      }),
      prisma.prpAttendance.findMany({
        where: { organizationId, serviceDate: { gte: storedFrom, lt: storedTo } },
        select: { clientId: true, serviceDate: true },
      }),
      prisma.tmsSession.findMany({
        where: { course: { organizationId }, sessionDate: { gte: storedFrom, lt: storedTo } },
        select: { sessionDate: true, course: { select: { clientId: true, client: { select: { valantFacility: true } } } } },
      }),
      prisma.spravatoSession.findMany({
        where: { enrollment: { organizationId }, sessionDate: { gte: storedFrom, lt: storedTo } },
        select: { sessionDate: true, enrollment: { select: { clientId: true, client: { select: { valantFacility: true } } } } },
      }),
      prisma.residentialResident.findMany({
        where: { OR: [{ active: true }, { updatedAt: { gte: trendStart } }, { admitDate: { gte: storedFrom } }] },
        select: { clientId: true, program: true, admitDate: true, active: true, updatedAt: true },
      }),
      prisma.crisisEpisode.findMany({
        where: { organizationId, startedAt: { gte: window.start, lt: window.end } },
        select: { clientId: true, startedAt: true, priority: true },
      }),
      loadResidentialCapacity(organizationId),
      prisma.client.groupBy({ by: ['valantFacility'], where: { AND: [scope, { status: 'ACTIVE' }] }, _count: { _all: true } }),
      prisma.client.groupBy({ by: ['valantFacility'], where: { AND: [scope, { status: 'ACTIVE' }, primaryCarePatientWhere()] }, _count: { _all: true } }),
      prisma.$queryRaw<{ valantFacility: string | null; count: number }[]>`
        SELECT c."valantFacility" AS "valantFacility", COUNT(DISTINCT e."clientId")::int AS "count"
        FROM "PrpEnrollment" e JOIN "Client" c ON c."id" = e."clientId"
        WHERE e."organizationId" = ${organizationId} AND e."status" = 'active'
        GROUP BY 1`,
      prisma.$queryRaw<{ valantFacility: string | null; count: number }[]>`
        SELECT c."valantFacility" AS "valantFacility", COUNT(DISTINCT t."clientId")::int AS "count"
        FROM "TmsCourse" t JOIN "Client" c ON c."id" = t."clientId"
        WHERE t."organizationId" = ${organizationId} AND t."status" = 'active'
        GROUP BY 1`,
      prisma.$queryRaw<{ valantFacility: string | null; count: number }[]>`
        SELECT c."valantFacility" AS "valantFacility", COUNT(DISTINCT s."clientId")::int AS "count"
        FROM "SpravatoEnrollment" s JOIN "Client" c ON c."id" = s."clientId"
        WHERE s."organizationId" = ${organizationId} AND s."status" = 'active'
        GROUP BY 1`,
    ]);

  const lookupIds = [
    ...new Set([...prp.map((p) => p.clientId), ...residentsRaw.map((r) => r.clientId), ...crisis.map((c) => c.clientId)].filter((v): v is string => !!v)),
  ];
  const clientFac = new Map<string, string | null>();
  for (let i = 0; i < lookupIds.length; i += 5000) {
    const rows = await prisma.client.findMany({
      where: { id: { in: lookupIds.slice(i, i + 5000) }, AND: [scope] },
      select: { id: true, valantFacility: true },
    });
    for (const r of rows) clientFac.set(r.id, facOf(r.valantFacility));
  }
  const residents = residentsRaw.filter((r) => r.clientId && clientFac.has(r.clientId));
  const unlinkedResidents = residentsRaw.filter((r) => !r.clientId && r.active).length;
  const session = (clientId: string, fac: string | null, d: Date): CensusSession => ({ clientId, clientLocationId: fac, date: d });
  const regroup = (rows: { valantFacility: string | null; count: number }[]) => {
    const m = new Map<string | null, number>();
    for (const r of rows) {
      const k = facOf(r.valantFacility);
      m.set(k, (m.get(k) ?? 0) + r.count);
    }
    return [...m.entries()].map(([locationId, count]) => ({ locationId, count }));
  };
  const facilityNotes: string[] = [];
  if (!sites.length) facilityNotes.push('The Valant facility list has not been imported (Admin › Data import › Import Facilities): every client is under "No Valant facility".');
  facilityNotes.push('Clients without a Valant facility (not re-imported yet, created in Altrixs, or a billing entity shared by several facilities) are under "No Valant facility".');
  facilityNotes.push('Residential beds are configured per Altrixs location: bed counts appear for all facilities together only.');

  return buildPracticeCensus({
    now,
    date,
    timeZone,
    window,
    grouping: 'facility',
    facilityNotes,
    locations: sites.map((s) => ({ id: s.facilityName, name: s.facilityName, active: s.sourceActive !== false })),
    locationId: facility,
    appointments: appts.map((a) => ({
      clientId: a.clientId,
      clinicianId: a.clinicianId,
      clinicianName: a.clinician?.name?.trim() || a.clinicianName?.trim() || null,
      clinicianRole: a.clinician?.role ? String(a.clinician.role) : null,
      type: a.type,
      notes: a.notes,
      isVirtual: a.isVirtual,
      status: String(a.status),
      startsAt: a.startsAt,
      appointmentLocation: null,
      clientLocationId: facOf(a.client.valantFacility),
      protected: Boolean(a.client.sensitiveRecord),
    })),
    prpAttendance: prp.filter((p) => clientFac.has(p.clientId)).map((p) => session(p.clientId, clientFac.get(p.clientId) ?? null, p.serviceDate)),
    tmsSessions: tms.map((t) => session(t.course.clientId, facOf(t.course.client.valantFacility), t.sessionDate)),
    spravatoSessions: spravato.map((t) => session(t.enrollment.clientId, facOf(t.enrollment.client.valantFacility), t.sessionDate)),
    residents: residents.map((r) => ({
      clientLocationId: clientFac.get(r.clientId as string) ?? null,
      program: r.program,
      admitDate: r.admitDate,
      active: r.active,
      updatedAt: r.updatedAt,
    })),
    unlinkedResidents,
    capacity: capacity.rows,
    capacityMigrationPending: capacity.migrationPending,
    crisisEpisodes: crisis.map((c) => ({ clientLocationId: c.clientId ? clientFac.get(c.clientId) ?? null : null, startedAt: c.startedAt, priority: c.priority })),
    caseload: {
      activeClients: regroup(activeClients.map((g) => ({ valantFacility: g.valantFacility, count: g._count._all }))),
      primaryCareActive: regroup(primaryCare.map((g) => ({ valantFacility: g.valantFacility, count: g._count._all }))),
      prpActive: regroup(prpActive),
      tmsActive: regroup(tmsActive),
      spravatoActive: regroup(spravatoActive),
    },
    appointmentLocationColumn: false,
  });
}
