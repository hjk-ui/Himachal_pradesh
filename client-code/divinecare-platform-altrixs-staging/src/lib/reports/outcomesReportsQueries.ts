/**
 * Server-side loader for GET /api/reports/outcomes. Runs the Prisma counts / groupBys for the
 * overview and the requested tab, then hands the rows to the pure aggregation in outcomesReports.ts.
 * Patient-level rows are loaded only where a per-client calculation needs them (assessment scores,
 * completed visits, signed notes, active medications), and only the fields that calculation uses.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import {
  GAD7,
  PHQ9,
  REPORT_TZ,
  UNAVAILABLE_HEDIS,
  addValantGroup,
  clinicianProductivity,
  computeFollowUp,
  computeInstrumentOutcomes,
  coverageRate,
  emptyValantMoney,
  firstPayer,
  foldClaimsByPayer,
  foldValantByKey,
  monthKey,
  outcomeSummary,
  NO_FACILITY,
  reportClientWhere,
  summarizeAppointmentStatuses,
  summarizeClaims,
  summarizeCssrs,
  summarizeMedications,
  utilizationByType,
  valantReportWhere,
  isCaseloadScope,
  type ClinicalSection,
  type FinancialSection,
  type IndexEvent,
  type MedicationsSection,
  type OutcomesReport,
  type OverviewSection,
  type QualitySection,
  type ReportFilters,
  type ReportScope,
  type ScorePoint,
  type UtilizationSection,
} from '@/lib/reports/outcomesReports';

const DAY_MS = 86_400_000;
const CLIENT_TABLE_LIMIT = 500;
const STAFF_ROLES: Role[] = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

type Range = { from: Date; toExclusive: Date };

export type ReportViewer = { organizationId: string; userId: string; role: string };

export class ReportFilterError extends Error {}

/** Resolve filters into a scope: validates location / clinician belong to the org, finds locked sensitive clients. */
export async function resolveReportScope(viewer: ReportViewer, filters: ReportFilters): Promise<ReportScope> {
  const [location, clinician, sensitive] = await Promise.all([
    filters.locationId
      ? prisma.location.findFirst({ where: { id: filters.locationId, organizationId: viewer.organizationId }, select: { name: true, city: true } })
      : Promise.resolve(null),
    filters.clinicianId
      ? prisma.user.findFirst({ where: { id: filters.clinicianId, organizationId: viewer.organizationId }, select: { id: true } })
      : Promise.resolve(null),
    prisma.sensitiveRecord.findMany({ where: { organizationId: viewer.organizationId }, select: { clientId: true } }),
  ]);
  if (filters.locationId && !location) throw new ReportFilterError('Unknown location');
  if (filters.clinicianId && !clinician) throw new ReportFilterError('Unknown clinician');
  const locked = sensitive.length
    ? await lockedSensitiveClientIds({ ...viewer, clientIds: sensitive.map((s) => s.clientId) })
    : new Set<string>();
  return {
    ...viewer,
    locationId: filters.locationId,
    clinicianId: filters.clinicianId,
    lockedClientIds: [...locked],
    facilityTerm: location ? (location.city?.trim() || location.name.trim()) : null,
  };
}

function noteDateIn(range: Range): Prisma.ProgressNoteWhereInput {
  return {
    OR: [
      { dateOfService: { gte: range.from, lt: range.toExclusive } },
      { dateOfService: null, createdAt: { gte: range.from, lt: range.toExclusive } },
    ],
  };
}

function noteOlderThan(cut: Date): Prisma.ProgressNoteWhereInput {
  return { OR: [{ dateOfService: { lt: cut } }, { dateOfService: null, createdAt: { lt: cut } }] };
}

const UNSIGNED: Prisma.ProgressNoteWhereInput = {
  // Dismissed drafts (src/lib/notes/dismiss.ts) are not unsigned work
  dismissedAt: null,
  OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }],
};

function noteWhere(scope: ReportScope, range: Range, extra: Prisma.ProgressNoteWhereInput[] = []): Prisma.ProgressNoteWhereInput {
  return {
    AND: [
      { client: reportClientWhere(scope, { byAssignee: false }) },
      noteDateIn(range),
      ...(scope.clinicianId ? [{ clinicianId: scope.clinicianId }] : []),
      ...extra,
    ],
  };
}

function appointmentWhere(scope: ReportScope, range: Range, extra: Prisma.AppointmentWhereInput = {}): Prisma.AppointmentWhereInput {
  return {
    client: reportClientWhere(scope, { byAssignee: false }),
    startsAt: { gte: range.from, lt: range.toExclusive },
    ...(scope.clinicianId ? { clinicianId: scope.clinicianId } : {}),
    ...extra,
  };
}

function claimWhere(scope: ReportScope, range: Range): Prisma.ClaimWhereInput {
  return {
    organizationId: scope.organizationId,
    client: reportClientWhere(scope, { byAssignee: false }),
    createdAt: { gte: range.from, lt: range.toExclusive },
    ...(scope.clinicianId
      ? { OR: [{ appointment: { clinicianId: scope.clinicianId } }, { progressNote: { clinicianId: scope.clinicianId } }] }
      : {}),
  };
}

async function loadOverview(scope: ReportScope, range: Range, now: Date): Promise<OverviewSection> {
  const assigned = reportClientWhere(scope, { byAssignee: true });
  const cut24 = new Date(now.getTime() - DAY_MS);
  const cut48 = new Date(now.getTime() - 2 * DAY_MS);
  const vWhere = valantReportWhere(scope, range);
  const [
    activeClients, newClients, importedClients, apptGroups, notesInPeriod, unsigned, unsigned24, unsigned48,
    claimGroups, valantGroups, undatedRows,
  ] = await Promise.all([
    prisma.client.count({ where: { AND: [assigned, { status: 'ACTIVE' }] } }),
    prisma.client.count({ where: { AND: [assigned, { importedAt: null, sourcePlatform: null, createdAt: { gte: range.from, lt: range.toExclusive } }] } }),
    prisma.client.count({ where: { AND: [assigned, { importedAt: { gte: range.from, lt: range.toExclusive } }] } }),
    prisma.appointment.groupBy({ by: ['status'], where: appointmentWhere(scope, range), _count: { _all: true } }),
    prisma.progressNote.count({ where: noteWhere(scope, range) }),
    prisma.progressNote.count({ where: noteWhere(scope, range, [UNSIGNED]) }),
    prisma.progressNote.count({ where: noteWhere(scope, range, [UNSIGNED, noteOlderThan(cut24)]) }),
    prisma.progressNote.count({ where: noteWhere(scope, range, [UNSIGNED, noteOlderThan(cut48)]) }),
    prisma.claim.groupBy({ by: ['status'], where: claimWhere(scope, range), _count: { _all: true }, _sum: { amountCents: true, paidAmount: true } }),
    prisma.valantTransaction.groupBy({ by: ['category'], where: vWhere, _count: { _all: true }, _sum: { amountCents: true } }),
    // Rows without a service date cannot be placed in any period; report how many exist.
    prisma.valantTransaction.count({
      where: {
        organizationId: scope.organizationId,
        serviceDate: null,
        ...(isCaseloadScope(scope) ? { client: reportClientWhere(scope, { byAssignee: false }) } : {}),
      },
    }),
  ]);
  const valant = emptyValantMoney();
  for (const g of valantGroups) addValantGroup(valant, { category: g.category, cents: g._sum.amountCents ?? 0, count: g._count._all });
  return {
    activeClients,
    newClients,
    importedClients,
    appointments: summarizeAppointmentStatuses(apptGroups.map((g) => ({ status: g.status, count: g._count._all }))),
    notes: { inPeriod: notesInPeriod, signed: notesInPeriod - unsigned, unsigned, unsignedOver24h: unsigned24, unsignedOver48h: unsigned48 },
    claims: summarizeClaims(claimGroups.map((g) => ({
      status: g.status, count: g._count._all, amountCents: g._sum.amountCents, paidAmount: g._sum.paidAmount,
    }))),
    valant: { ...valant, undatedRows },
  };
}

async function loadClinical(scope: ReportScope, range: Range): Promise<ClinicalSection> {
  const client = reportClientWhere(scope, { byAssignee: true });
  const [scores, cssrsRows] = await Promise.all([
    prisma.clinicalAssessmentRecord.findMany({
      where: {
        organizationId: scope.organizationId,
        client,
        instrumentId: { in: [PHQ9.id, GAD7.id] },
        totalScore: { not: null },
        createdAt: { lt: range.toExclusive },
      },
      select: { clientId: true, instrumentId: true, totalScore: true, createdAt: true },
    }),
    prisma.clinicalAssessmentRecord.findMany({
      where: {
        organizationId: scope.organizationId,
        client,
        instrumentId: { startsWith: 'c-ssrs' },
        createdAt: { gte: range.from, lt: range.toExclusive },
      },
      select: { clientId: true, totalScore: true, safetyFlagged: true },
    }),
  ]);
  const pts = (id: string): ScorePoint[] =>
    scores.filter((s) => s.instrumentId === id).map((s) => ({ clientId: s.clientId, score: s.totalScore as number, at: s.createdAt }));
  const phq = computeInstrumentOutcomes(pts(PHQ9.id), PHQ9, range);
  const gad = computeInstrumentOutcomes(pts(GAD7.id), GAD7, range);

  const ids = [...new Set([...phq.clients, ...gad.clients].map((c) => c.clientId))];
  const people = ids.length
    ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, mrn: true } })
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const phqBy = new Map(phq.clients.map((c) => [c.clientId, c]));
  const gadBy = new Map(gad.clients.map((c) => [c.clientId, c]));
  const table = ids
    .map((id) => ({
      clientId: id,
      name: byId.get(id)?.name ?? 'Unknown client',
      mrn: byId.get(id)?.mrn ?? null,
      phq9: phqBy.get(id) ?? null,
      gad7: gadBy.get(id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    phq9: outcomeSummary(phq),
    gad7: outcomeSummary(gad),
    cssrs: summarizeCssrs(cssrsRows),
    clients: table.slice(0, CLIENT_TABLE_LIMIT),
    clientsTruncated: table.length > CLIENT_TABLE_LIMIT,
  };
}

async function loadQuality(scope: ReportScope, range: Range, now: Date): Promise<QualitySection> {
  const client = reportClientWhere(scope, { byAssignee: true });
  const mbcStart = new Date(range.toExclusive.getTime() - 90 * DAY_MS);
  const screenStart = new Date(range.toExclusive.getTime() - 365 * DAY_MS);
  const completedIn = (from: Date) =>
    prisma.appointment.groupBy({
      by: ['clientId'],
      where: { client, status: 'COMPLETED', startsAt: { gte: from, lt: range.toExclusive } },
      _count: { _all: true },
    });
  const assessedIn = (from: Date, instruments: string[]) =>
    prisma.clinicalAssessmentRecord.groupBy({
      by: ['clientId'],
      where: { organizationId: scope.organizationId, client, instrumentId: { in: instruments }, createdAt: { gte: from, lt: range.toExclusive } },
      _count: { _all: true },
    });
  const [seen90, measured90, seenPeriod, screened12m, alerts, episodes] = await Promise.all([
    completedIn(mbcStart),
    assessedIn(mbcStart, [PHQ9.id, GAD7.id]),
    completedIn(range.from),
    assessedIn(screenStart, [PHQ9.id, 'phq-2']),
    prisma.riskAlert.findMany({
      where: { client, severity: 'HIGH', createdAt: { gte: range.from, lt: range.toExclusive } },
      select: { clientId: true, createdAt: true },
    }),
    prisma.crisisEpisode.findMany({
      where: { organizationId: scope.organizationId, startedAt: { gte: range.from, lt: range.toExclusive } },
      select: { clientId: true, startedAt: true },
    }),
  ]);

  // CrisisEpisode.clientId has no foreign key: keep only episodes on clients this viewer may report on.
  const episodeIds = [...new Set(episodes.map((e) => e.clientId).filter((x): x is string => Boolean(x)))];
  const allowedEpisodeClients = episodeIds.length
    ? new Set((await prisma.client.findMany({ where: { AND: [client, { id: { in: episodeIds } }] }, select: { id: true } })).map((c) => c.id))
    : new Set<string>();
  const events: IndexEvent[] = [
    ...alerts.map((a) => ({ clientId: a.clientId, at: a.createdAt, kind: 'risk_alert' as const })),
    ...episodes
      .filter((e) => e.clientId && allowedEpisodeClients.has(e.clientId))
      .map((e) => ({ clientId: e.clientId as string, at: e.startedAt, kind: 'crisis_episode' as const })),
  ];
  const eventClients = [...new Set(events.map((e) => e.clientId))];
  const visits = eventClients.length
    ? await prisma.appointment.findMany({
        where: {
          clientId: { in: eventClients },
          status: 'COMPLETED',
          startsAt: { gte: range.from, lt: new Date(range.toExclusive.getTime() + 31 * DAY_MS) },
        },
        select: { clientId: true, startsAt: true },
      })
    : [];
  return {
    measurementBasedCare: {
      ...coverageRate(seen90.map((g) => g.clientId), measured90.map((g) => g.clientId)),
      windowStart: mbcStart.toISOString(),
    },
    depressionScreening: {
      ...coverageRate(seenPeriod.map((g) => g.clientId), screened12m.map((g) => g.clientId)),
      windowStart: screenStart.toISOString(),
    },
    followUp: {
      ...computeFollowUp(events, visits.map((v) => ({ clientId: v.clientId, at: v.startsAt })), now),
      crisisEpisodesWithoutClient: episodes.filter((e) => !e.clientId).length,
    },
    unavailable: UNAVAILABLE_HEDIS,
  };
}

async function loadFinancial(scope: ReportScope, range: Range): Promise<FinancialSection> {
  const vWhere = valantReportWhere(scope, range);
  const [claimGroups, claimRows, byInsurance, byFacility, byDay] = await Promise.all([
    prisma.claim.groupBy({
      by: ['payer', 'status'], where: claimWhere(scope, range),
      _count: { _all: true }, _sum: { amountCents: true, paidAmount: true },
    }),
    prisma.claim.findMany({ where: claimWhere(scope, range), select: { createdAt: true, status: true, amountCents: true, paidAmount: true } }),
    prisma.valantTransaction.groupBy({ by: ['insurance', 'category'], where: vWhere, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.valantTransaction.groupBy({ by: ['facility', 'category'], where: vWhere, _count: { _all: true }, _sum: { amountCents: true } }),
    // Service dates are calendar days, so day × category stays small; months are folded here.
    prisma.valantTransaction.groupBy({ by: ['serviceDate', 'category'], where: vWhere, _count: { _all: true }, _sum: { amountCents: true } }),
  ]);
  const claimMonths = new Map<string, { month: string; claims: number; billedCents: number; paidCents: number }>();
  for (const c of claimRows) {
    const k = monthKey(c.createdAt);
    const row = claimMonths.get(k) ?? { month: k, claims: 0, billedCents: 0, paidCents: 0 };
    row.claims++;
    if (c.status !== 'DRAFT' && c.status !== 'READY') row.billedCents += c.amountCents ?? 0;
    if (c.status === 'PAID') row.paidCents += Math.round((c.paidAmount ?? 0) * 100);
    claimMonths.set(k, row);
  }
  type VGroup = { category: string; _count: { _all: number }; _sum: { amountCents: number | null } };
  const toGroups = <T extends VGroup>(rows: T[], key: (r: T) => string | null) =>
    rows.map((r) => ({ key: key(r), category: r.category, cents: r._sum.amountCents ?? 0, count: r._count._all }));
  const totals = emptyValantMoney();
  for (const r of byInsurance) addValantGroup(totals, { category: r.category, cents: r._sum.amountCents ?? 0, count: r._count._all });
  return {
    claimsByPayer: foldClaimsByPayer(claimGroups.map((r) => ({
      payer: r.payer, status: r.status, count: r._count._all, amountCents: r._sum.amountCents, paidAmount: r._sum.paidAmount,
    }))),
    claimsByMonth: [...claimMonths.values()].sort((a, b) => a.month.localeCompare(b.month)),
    valantByPayer: foldValantByKey(toGroups(byInsurance, (r) => r.insurance), firstPayer),
    valantByFacility: foldValantByKey(toGroups(byFacility, (r) => r.facility), (k) => k?.trim() || NO_FACILITY),
    valantByMonth: foldValantByKey(
      toGroups(byDay, (r) => (r.serviceDate ? monthKey(r.serviceDate) : null)),
      (k) => k ?? 'No service date'
    ).sort((a, b) => a.key.localeCompare(b.key)),
    valantTotals: totals,
  };
}

async function loadUtilization(scope: ReportScope, range: Range): Promise<UtilizationSection> {
  const vWhere: Prisma.ValantTransactionWhereInput = { AND: [valantReportWhere(scope, range), { category: 'charge' }] };
  const [visits, statusGroups, claimCpt, valantCpt, signed, unsignedGroups, valantProv] = await Promise.all([
    prisma.appointment.findMany({
      where: appointmentWhere(scope, range, { status: 'COMPLETED' }),
      select: { type: true, startsAt: true, endsAt: true, clinicianId: true, clientId: true },
    }),
    prisma.appointment.groupBy({ by: ['clinicianId', 'status'], where: appointmentWhere(scope, range), _count: { _all: true } }),
    prisma.claim.groupBy({ by: ['cptCode'], where: claimWhere(scope, range), _count: { _all: true }, _sum: { units: true, amountCents: true } }),
    prisma.valantTransaction.groupBy({ by: ['codeBase'], where: vWhere, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.progressNoteWorkflow.findMany({
      where: {
        status: { in: ['SIGNED', 'LOCKED'] },
        signedAt: { gte: range.from, lt: range.toExclusive },
        note: {
          client: reportClientWhere(scope, { byAssignee: false }),
          ...(scope.clinicianId ? { clinicianId: scope.clinicianId } : {}),
        },
      },
      select: { signedAt: true, note: { select: { clinicianId: true, createdAt: true } } },
    }),
    prisma.progressNote.groupBy({ by: ['clinicianId'], where: noteWhere(scope, range, [UNSIGNED]), _count: { _all: true } }),
    prisma.valantTransaction.groupBy({ by: ['providerUserId', 'providerCode'], where: vWhere, _count: { _all: true }, _sum: { amountCents: true } }),
  ]);
  const staffIds = [...new Set([
    ...statusGroups.map((g) => g.clinicianId),
    ...signed.map((s) => s.note.clinicianId),
    ...unsignedGroups.map((g) => g.clinicianId),
    ...valantProv.map((g) => g.providerUserId),
  ].filter((x): x is string => Boolean(x)))];
  const staff = staffIds.length
    ? await prisma.user.findMany({ where: { id: { in: staffIds }, organizationId: scope.organizationId }, select: { id: true, name: true } })
    : [];
  const names = new Map(staff.map((s) => [s.id, s.name]));

  const provMap = new Map<string, { provider: string; matchedStaff: boolean; charges: number; chargesCents: number }>();
  for (const p of valantProv) {
    const matched = Boolean(p.providerUserId && names.has(p.providerUserId));
    const label = matched ? names.get(p.providerUserId as string) || p.providerCode || 'Unknown staff' : p.providerCode?.trim() || 'No provider on row';
    const key = matched ? `u:${p.providerUserId}` : `c:${label}`;
    const row = provMap.get(key) ?? { provider: label, matchedStaff: matched, charges: 0, chargesCents: 0 };
    row.charges += p._count._all;
    row.chargesCents += p._sum.amountCents ?? 0;
    provMap.set(key, row);
  }

  return {
    appointmentTypes: utilizationByType(visits),
    claimCpt: claimCpt
      .map((c) => ({ cptCode: c.cptCode, claims: c._count._all, units: c._sum.units ?? 0, billedCents: c._sum.amountCents ?? 0 }))
      .sort((a, b) => b.claims - a.claims),
    valantCpt: valantCpt
      .map((c) => ({ codeBase: c.codeBase?.trim() || 'No CPT on row', charges: c._count._all, chargesCents: c._sum.amountCents ?? 0 }))
      .sort((a, b) => b.charges - a.charges),
    productivity: clinicianProductivity({
      statusGroups: statusGroups.map((g) => ({ clinicianId: g.clinicianId, status: g.status, count: g._count._all })),
      visits,
      signedNotes: signed
        .filter((s) => s.signedAt)
        .map((s) => ({ clinicianId: s.note.clinicianId, createdAt: s.note.createdAt, signedAt: s.signedAt as Date })),
      unsignedGroups: unsignedGroups.map((g) => ({ clinicianId: g.clinicianId, count: g._count._all })),
      names,
    }),
    valantByProvider: [...provMap.values()].sort((a, b) => b.charges - a.charges),
  };
}

async function loadMedications(scope: ReportScope, range: Range, now: Date): Promise<MedicationsSection> {
  const client = reportClientWhere(scope, { byAssignee: true });
  const [meds, rx] = await Promise.all([
    prisma.clientMedication.findMany({
      where: {
        client,
        active: true,
        status: { notIn: ['discontinued', 'stopped', 'deleted'] },
        OR: [{ stopDate: null }, { stopDate: { gt: now } }],
      },
      select: { clientId: true, medicationName: true, drugName: true, genericName: true, isAntipsychotic: true },
    }),
    prisma.rcopiaPrescription.count({ where: { client, signedDate: { gte: range.from, lt: range.toExclusive } } }),
  ]);
  return { ...summarizeMedications(meds), rcopiaPrescriptionsSigned: rx };
}

export async function loadOptions(organizationId: string) {
  const [locations, clinicians] = await Promise.all([
    prisma.location.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({
      where: { organizationId, status: 'ACTIVE', OR: [{ role: { in: STAFF_ROLES } }, { roles: { hasSome: STAFF_ROLES } }] },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    locations,
    clinicians: clinicians.map((c) => ({ id: c.id, name: c.name || c.email })),
  };
}

/** Sensitive clients in this viewer's scope that the report left out (count only). */
async function countHiddenSensitive(scope: ReportScope): Promise<number> {
  if (!scope.lockedClientIds.length) return 0;
  return prisma.client.count({
    where: { AND: [reportClientWhere({ ...scope, lockedClientIds: [] }, { byAssignee: true }), { id: { in: scope.lockedClientIds } }] },
  });
}

export async function buildOutcomesReport(scope: ReportScope, filters: ReportFilters, now: Date): Promise<OutcomesReport> {
  const range: Range = { from: filters.from, toExclusive: filters.toExclusive };
  const tab = filters.tab;
  const [overview, options, hidden, clinical, quality, financial, utilization, medications] = await Promise.all([
    loadOverview(scope, range, now),
    loadOptions(scope.organizationId),
    countHiddenSensitive(scope),
    tab === 'clinical' ? loadClinical(scope, range) : Promise.resolve(undefined),
    tab === 'quality' ? loadQuality(scope, range, now) : Promise.resolve(undefined),
    tab === 'financial' ? loadFinancial(scope, range) : Promise.resolve(undefined),
    tab === 'utilization' ? loadUtilization(scope, range) : Promise.resolve(undefined),
    tab === 'medications' ? loadMedications(scope, range, now) : Promise.resolve(undefined),
  ]);
  return {
    generatedAt: now.toISOString(),
    filters: { from: filters.fromDate, to: filters.toDate, locationId: filters.locationId, clinicianId: filters.clinicianId, tab, timeZone: REPORT_TZ },
    scope: isCaseloadScope(scope) ? 'caseload' : 'organization',
    hiddenSensitiveClients: hidden,
    facilityTerm: scope.facilityTerm,
    options,
    overview,
    ...(clinical ? { clinical } : {}),
    ...(quality ? { quality } : {}),
    ...(financial ? { financial } : {}),
    ...(utilization ? { utilization } : {}),
    ...(medications ? { medications } : {}),
  };
}
