import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceToday } from '@/lib/time/practiceTime';
import { addDaysYmd, practiceDayBounds } from '@/lib/dashboard/practiceDay';
import { primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import type { FacilityKind, FacilityMapRow } from './facilityMapping';
import { buildPracticeOverview, type PracticeOverview } from './overview';
import { buildFacilityOverview } from './facilityOverview';
import { summarizeAltrixsClaims, summarizeAltrixsPayments } from '@/lib/billing/overviewValant';

/**
 * Practice overview data loaders (org-scoped queries). Kept free of auth / next-auth imports so
 * scripts (scripts/check-practice-overview.ts) can load it outside Next; the leadership gate lives
 * in server.ts, which re-exports these.
 */

export async function locationsOf(organizationId: string) {
  return prisma.location.findMany({
    where: { organizationId },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, code: true, addressLine1: true, addressLine2: true, city: true, state: true,
      postalCode: true, phone: true, timezone: true, active: true, isPrimary: true,
    },
  });
}

export type SavedMapping = FacilityMapRow & {
  id: string;
  origin: string;
  updatedAt: Date;
  billingEntityName: string | null;
  timezone: string | null;
  sourceActive: boolean | null;
  facilityImportedAt: Date | null;
};

export async function mappingsOf(organizationId: string): Promise<SavedMapping[]> {
  const rows = await prisma.facilityLocationMap.findMany({
    where: { organizationId, sourceSystem: 'valant' },
    orderBy: { facilityName: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    facilityName: r.facilityName,
    kind: (['location', 'program', 'ignore'].includes(r.kind) ? r.kind : 'location') as FacilityKind,
    locationId: r.locationId,
    programKey: r.programKey,
    needsConfirmation: r.needsConfirmation,
    note: r.note,
    origin: r.origin,
    updatedAt: r.updatedAt,
    billingEntityName: r.billingEntityName,
    timezone: r.timezone,
    sourceActive: r.sourceActive,
    facilityImportedAt: r.facilityImportedAt,
  }));
}

/** Client.valantFacility exists only where 20261019_client_valant_facility.sql ran. */
export async function hasClientValantFacilityColumn(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'Client' AND column_name = 'valantFacility'`;
  return (rows[0]?.n ?? 0) > 0;
}

/** Appointment.location_id exists only where 20261015_practice_locations.sql ran (not in the Prisma model). */
export async function hasAppointmentLocationColumn(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'Appointment' AND column_name = 'location_id'`;
  return (rows[0]?.n ?? 0) > 0;
}

export async function loadPracticeOverview(organizationId: string, now = new Date()): Promise<PracticeOverview> {
  // Practice-clock days (DST-safe), same as the census: "last 90 days" = the 90 practice days ending today
  const timeZone = await getPracticeTimeZone(organizationId);
  const today = practiceToday(timeZone, now);
  const since30 = practiceDayBounds(addDaysYmd(today, -29), timeZone).start;
  const since90 = practiceDayBounds(addDaysYmd(today, -89), timeZone).start;
  const [ty, tm] = today.split('-').map(Number);
  const firstMonth = new Date(Date.UTC(ty, tm - 1 - 5, 1)).toISOString().slice(0, 10);
  const since180 = practiceDayBounds(firstMonth, timeZone).start;
  const until30 = practiceDayBounds(addDaysYmd(today, 30), timeZone).end;
  // ValantTransaction.serviceDate is a date-only column (00:00 UTC): compare calendar dates
  const utcDay = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
  const valantFrom = utcDay(firstMonth);
  const valant90 = utcDay(addDaysYmd(today, -89));
  const valantTo = utcDay(addDaysYmd(today, 1));
  // Same organization rule as the schedule / appointments API and the census (clientOrgFilter)
  const clientScope = clientOrgFilter(organizationId);
  const [apptCol, facCol] = await Promise.all([hasAppointmentLocationColumn(), hasClientValantFacilityColumn()]);
  const apptLocSql = apptCol ? Prisma.sql`a."location_id"::text` : Prisma.sql`NULL::text`;
  const clientFacSql = facCol ? Prisma.sql`c."valantFacility"` : Prisma.sql`NULL::text`;

  const [org, locations, clientGroups, new30, new90, pcFlag, appointments, valantGroups, facilityHome, journalRowCount, mappings, staffLinks, prpGroups] =
    await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      locationsOf(organizationId),
      prisma.client.groupBy({ by: ['locationId', 'status', 'sourcePlatform'], where: clientScope, _count: { _all: true } }),
      prisma.client.groupBy({ by: ['locationId'], where: { AND: [clientScope, { importedAt: null, createdAt: { gte: since30 } }] }, _count: { _all: true } }),
      prisma.client.groupBy({ by: ['locationId'], where: { AND: [clientScope, { importedAt: null, createdAt: { gte: since90 } }] }, _count: { _all: true } }),
      prisma.client.groupBy({ by: ['locationId'], where: { AND: [clientScope, { primaryCare: true }] }, _count: { _all: true } }),
      prisma.$queryRaw<{ status: string; startsAt: Date; clientLocationId: string | null; appointmentLocation: string | null; clientValantFacility: string | null }[]>`
        SELECT a."status"::text AS "status", a."startsAt" AS "startsAt", c."locationId" AS "clientLocationId",
               ${apptLocSql} AS "appointmentLocation", ${clientFacSql} AS "clientValantFacility"
        FROM "Appointment" a
        JOIN "Client" c ON c."id" = a."clientId"
        LEFT JOIN "Location" cl ON cl."id" = c."locationId"
        LEFT JOIN "User" ca ON ca."id" = c."assignedToId"
        WHERE (a."organizationId" = ${organizationId} OR c."organizationId" = ${organizationId} OR cl."organizationId" = ${organizationId}
               OR (c."locationId" IS NULL AND ca."organizationId" = ${organizationId}))
          AND a."startsAt" >= ${since180} AND a."startsAt" < ${until30}`,
      // homeLocationId: program facilities (Family Practice, IOP, PRP) carry no site in Valant, so the
      // location view places them by the client's home site (labelled inferred).
      prisma.$queryRaw<{ facility: string | null; category: string; month: string | null; in90: boolean; homeLocationId: string | null; cents: bigint | number | null; count: number }[]>`
        SELECT t."facility", t."category",
               to_char(date_trunc('month', t."serviceDate"), 'YYYY-MM') AS "month",
               (t."serviceDate" >= ${valant90} AND t."serviceDate" < ${valantTo}) AS "in90",
               c."locationId" AS "homeLocationId",
               SUM(t."amountCents")::bigint AS "cents", COUNT(*)::int AS "count"
        FROM "ValantTransaction" t
        LEFT JOIN "Client" c ON c."id" = t."clientId"
        WHERE t."organizationId" = ${organizationId} AND t."serviceDate" >= ${valantFrom} AND t."serviceDate" < ${valantTo}
        GROUP BY 1, 2, 3, 4, 5`,
      prisma.$queryRaw<{ facility: string | null; homeLocationId: string | null; clients: number; rows: number }[]>`
        SELECT t."facility" AS "facility", c."locationId" AS "homeLocationId",
               COUNT(DISTINCT t."clientId")::int AS "clients", COUNT(*)::int AS "rows"
        FROM "ValantTransaction" t
        LEFT JOIN "Client" c ON c."id" = t."clientId"
        WHERE t."organizationId" = ${organizationId} AND t."facility" IS NOT NULL
        GROUP BY 1, 2`,
      prisma.valantTransaction.count({ where: { organizationId, facility: { not: null } } }),
      mappingsOf(organizationId),
      prisma.userLocation.findMany({ where: { location: { organizationId } }, select: { userId: true, locationId: true } }),
      prisma.$queryRaw<{ status: string; homeLocationId: string | null; count: number }[]>`
        SELECT e."status" AS "status", c."locationId" AS "homeLocationId", COUNT(DISTINCT e."clientId")::int AS "count"
        FROM "PrpEnrollment" e
        JOIN "Client" c ON c."id" = e."clientId"
        WHERE e."organizationId" = ${organizationId}
        GROUP BY 1, 2`,
    ]);
  const staff = await prisma.user.findMany({
    where: { organizationId, id: { in: [...new Set(staffLinks.map((s) => s.userId))] } },
    select: { id: true, name: true, role: true, status: true },
  });

  // "By facility": the practice's Valant facilities (facility list import). Exact facility name on journal rows.
  const [clientFacilityGroups, visitGroups, payerGroups, firstChargeGroups, journalFirst, prpAttendance90, primaryCareActive, medicalVisits90, billedAll, claimGroups, paymentGroups] =
    await Promise.all([
      facCol
        ? prisma.$queryRaw<{ valantFacility: string | null; status: string; count: number }[]>`
            SELECT c."valantFacility" AS "valantFacility", c."status"::text AS "status", COUNT(*)::int AS "count"
            FROM "Client" c
            LEFT JOIN "Location" cl ON cl."id" = c."locationId"
            LEFT JOIN "User" ca ON ca."id" = c."assignedToId"
            WHERE (c."organizationId" = ${organizationId} OR cl."organizationId" = ${organizationId}
                   OR (c."locationId" IS NULL AND ca."organizationId" = ${organizationId}))
            GROUP BY 1, 2`
        : Promise.resolve([] as { valantFacility: string | null; status: string; count: number }[]),
      prisma.$queryRaw<{ facility: string | null; visits: number; clients: number }[]>`
        SELECT "facility",
               COUNT(DISTINCT ("valantPatientId" || '|' || "serviceDate"::date::text))::int AS "visits",
               COUNT(DISTINCT "valantPatientId")::int AS "clients"
        FROM "ValantTransaction"
        WHERE "organizationId" = ${organizationId} AND "category" = 'charge' AND "amountCents" > 0
          AND "serviceDate" >= ${valant90} AND "serviceDate" < ${valantTo}
        GROUP BY 1`,
      prisma.$queryRaw<{ facility: string | null; insurance: string | null; category: string; cents: bigint | number | null; count: number }[]>`
        SELECT "facility", "insurance", "category", SUM("amountCents")::bigint AS "cents", COUNT(*)::int AS "count"
        FROM "ValantTransaction"
        WHERE "organizationId" = ${organizationId}
          AND "serviceDate" >= ${valant90} AND "serviceDate" < ${valantTo}
        GROUP BY 1, 2, 3`,
      prisma.$queryRaw<{ facility: string | null; first30: number; first90: number }[]>`
        SELECT "facility",
               COUNT(*) FILTER (WHERE "first" >= ${utcDay(addDaysYmd(today, -29))} AND "first" < ${valantTo})::int AS "first30",
               COUNT(*) FILTER (WHERE "first" >= ${valant90} AND "first" < ${valantTo})::int AS "first90"
        FROM (
          SELECT "facility", "valantPatientId", MIN("serviceDate") AS "first"
          FROM "ValantTransaction"
          WHERE "organizationId" = ${organizationId} AND "facility" IS NOT NULL AND "category" = 'charge' AND "serviceDate" IS NOT NULL
          GROUP BY 1, 2
        ) f
        GROUP BY 1`,
      prisma.valantTransaction.aggregate({ where: { organizationId, facility: { not: null } }, _min: { serviceDate: true } }),
      prisma.$queryRaw<{ encounters: number; clients: number }[]>`
        SELECT COUNT(*)::int AS "encounters", COUNT(DISTINCT "clientId")::int AS "clients"
        FROM "prp_attendance"
        WHERE "organizationId" = ${organizationId} AND "serviceDate" >= ${valant90} AND "serviceDate" < ${valantTo}`,
      prisma.client.count({ where: { AND: [clientScope, { status: 'ACTIVE' }, primaryCarePatientWhere()] } }),
      prisma.medicalVisit.count({ where: { client: clientScope, visitDate: { gte: since90 } } }),
      prisma.$queryRaw<{ clients: number }[]>`
        SELECT COUNT(DISTINCT "valantPatientId")::int AS "clients"
        FROM "ValantTransaction"
        WHERE "organizationId" = ${organizationId} AND "category" = 'charge' AND "amountCents" > 0
          AND "serviceDate" >= ${valant90} AND "serviceDate" < ${valantTo}`,
      // Altrixs live billing, last 90 days (empty before go-live); shown beside Valant, never summed
      prisma.claim
        .groupBy({ by: ['status'], where: { organizationId, createdAt: { gte: since90 } }, _count: { _all: true }, _sum: { amountCents: true, paidAmount: true } })
        .catch(() => null),
      prisma.payment
        .groupBy({ by: ['method'], where: { organizationId, paidAt: { gte: since90 } }, _count: { _all: true }, _sum: { amountCents: true } })
        .catch(() => null),
    ]);

  const overview = buildPracticeOverview({
    now,
    timeZone,
    organizationName: org?.name ?? 'Practice',
    locations,
    clientGroups: clientGroups.map((g) => ({ locationId: g.locationId, status: g.status, sourcePlatform: g.sourcePlatform, count: g._count._all })),
    newClientGroups: [
      ...new30.map((g) => ({ locationId: g.locationId, days: 30 as const, count: g._count._all })),
      ...new90.map((g) => ({ locationId: g.locationId, days: 90 as const, count: g._count._all })),
    ],
    primaryCareFlagGroups: pcFlag.map((g) => ({ locationId: g.locationId, count: g._count._all })),
    appointments: appointments.map((a) => ({ ...a, startsAt: new Date(a.startsAt) })),
    appointmentLocationColumn: apptCol,
    valantGroups: valantGroups.map((g) => ({ ...g, cents: Number(g.cents ?? 0) })),
    facilityHomeGroups: facilityHome,
    journalRowCount,
    mappings,
    staffLinks,
    prpEnrollmentGroups: prpGroups,
    staff: staff.map((s) => ({ id: s.id, name: s.name, role: String(s.role), status: String(s.status) })),
  });
  const prpByStatus = new Map<string, number>();
  for (const g of prpGroups) prpByStatus.set(g.status, (prpByStatus.get(g.status) ?? 0) + g.count);
  overview.facilityView = buildFacilityOverview({
    now,
    timeZone,
    facilityRows: mappings,
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
    clientFacilityColumn: facCol,
    clientFacilityGroups,
    valantGroups: valantGroups.map((g) => ({ ...g, cents: Number(g.cents ?? 0) })),
    visitGroups,
    payerGroups: payerGroups.map((g) => ({ ...g, cents: Number(g.cents ?? 0) })),
    firstChargeGroups,
    journalFirstServiceDate: journalFirst._min.serviceDate ?? null,
    practiceBilledClients90: billedAll[0]?.clients ?? 0,
    altrixs: claimGroups
      ? {
          claims: summarizeAltrixsClaims(
            claimGroups.map((g) => ({ status: String(g.status), count: g._count._all, amountCents: g._sum.amountCents, paidAmount: g._sum.paidAmount === null ? null : Number(g._sum.paidAmount) }))
          ),
          payments: paymentGroups
            ? summarizeAltrixsPayments(paymentGroups.map((g) => ({ method: String(g.method), count: g._count._all, cents: g._sum.amountCents ?? 0 })))
            : null,
        }
      : null,
    appointments: appointments.map((a) => ({ clientValantFacility: a.clientValantFacility ?? null, status: a.status, startsAt: new Date(a.startsAt) })),
    programs: {
      prpEnrollments: [...prpByStatus.entries()].map(([status, count]) => ({ status, count })),
      prpAttendance90: prpAttendance90[0] ?? { encounters: 0, clients: 0 },
      primaryCareActive,
      medicalVisits90,
    },
  });
  return overview;
}
