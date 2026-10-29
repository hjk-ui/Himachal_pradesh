import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { countAtRiskAuthorizations } from '@/lib/ai/authForecast/data';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { isoDate } from '@/lib/migration/valantReportCommon';
import { monthKey, zonedStartOfDay } from '@/lib/reports/outcomesReports';
import { previewPrepaymentCredits } from '@/lib/billing/patientLedger';
import {
  addDaysYmd,
  choosePayerMix,
  countVisits,
  cptUsage,
  NO_ALTRIXS_CLAIMS_NOTE,
  NO_FACILITY_NOTE,
  summarizeAltrixsClaims,
  summarizeAltrixsPayments,
  trailingMonths,
  valantKpis,
  valantPayerMix,
  valantTrend,
  type AltrixsClaimSummary,
  type AltrixsPaymentSummary,
  type CptUsageRow,
  type OverviewRange,
  type PayerMix,
  type TrendPoint,
  type ValantKpis,
} from '@/lib/billing/overviewValant';

/**
 * GET /api/billing/overview data. Two sources, never summed:
 *  - valant: imported ValantTransaction rows (by date of service) + latest Valant aging / prepayments
 *  - altrixs: live Claim / Payment / PatientStatement / signed notes
 * Only aggregates leave this module (no patient-level rows).
 */

function isMissingTable(err: unknown) {
  const code = (err as { code?: string })?.code;
  return code === 'P2021' || code === 'P2022';
}

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

// ─── Valant (imported) ───────────────────────────────────────────────────────

export type FacilityFilter = { equals: string } | { contains: string } | null;

export type ValantSection = {
  /** any imported Valant transaction rows for the organization */
  hasData: boolean;
  /** rows matching the facility / access filter (all dates) */
  rowsInScope: number;
  asOf: { importedAt: string | null; earliestServiceDate: string | null; latestServiceDate: string | null };
  facility: {
    selected: string | null;
    /** facilities on imported rows (empty until the Transaction Journal is imported) */
    options: { facility: string; rows: number }[];
    rowsWithFacility: number;
    note: string | null;
  };
  kpis: ValantKpis;
  /** rows with no date of service (not in any date range) */
  undatedRows: number;
  trend: TrendPoint[];
  payerMix: PayerMix;
  cpt: CptUsageRow[];
  /** Valant rows not matched to an Altrixs client (organization-wide) */
  unmatchedRows: number;
};

type VGroup = { category: string; _count: { _all: number }; _sum: { amountCents: number | null } };
const toCat = (g: VGroup) => ({ category: g.category, cents: g._sum.amountCents ?? 0, count: g._count._all });

export function facilityWhere(f: FacilityFilter): Prisma.ValantTransactionWhereInput {
  if (!f) return {};
  if ('equals' in f) return { facility: { equals: f.equals, mode: 'insensitive' } };
  return { facility: { contains: f.contains, mode: 'insensitive' } };
}

/** First day of the month after `ymd`'s month, UTC midnight */
function nextMonthStartUtc(ymd: string): Date {
  return new Date(`${addDaysYmd(`${ymd.slice(0, 7)}-28`, 7).slice(0, 7)}-01T00:00:00.000Z`);
}

export async function loadValantSection(
  organizationId: string,
  range: OverviewRange,
  opts: {
    facility?: FacilityFilter;
    /** caseload scoping (rows of clients the viewer may open; unmatched rows excluded) */
    clientWhere?: Prisma.ClientWhereInput | null;
    /** fall back to insurance aging / chart insurance for payer mix (organization-wide views only) */
    payerFallback?: boolean;
  } = {}
): Promise<ValantSection> {
  const scope: Prisma.ValantTransactionWhereInput = {
    AND: [
      { organizationId },
      facilityWhere(opts.facility ?? null),
      ...(opts.clientWhere ? [{ client: opts.clientWhere }] : []),
    ],
  };
  const inRange: Prisma.ValantTransactionWhereInput = {
    AND: [scope, { serviceDate: { gte: range.valantFrom, lt: range.valantToExclusive } }],
  };
  const months = trailingMonths(range.toDate);
  const trendFrom = new Date(`${months[0]}-01T00:00:00.000Z`);
  const trendTo = nextMonthStartUtc(range.toDate);
  const charges: Prisma.ValantTransactionWhereInput = { AND: [inRange, { category: 'charge' }] };

  const [
    orgRows, scopeMeta, facilityGroups, categoryGroups, visitGroups, trendGroups, payerGroups,
    cptSums, cptLines, fees, undatedRows, unmatchedRows,
  ] = await Promise.all([
    prisma.valantTransaction.aggregate({ where: { organizationId }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.valantTransaction.aggregate({ where: scope, _count: { _all: true }, _min: { serviceDate: true }, _max: { serviceDate: true } }),
    prisma.valantTransaction.groupBy({ by: ['facility'], where: { organizationId, facility: { not: null } }, _count: { _all: true } }),
    prisma.valantTransaction.groupBy({ by: ['category'], where: inRange, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.valantTransaction.groupBy({ by: ['valantPatientId', 'serviceDate'], where: { AND: [charges, { amountCents: { gt: 0 } }] } }),
    prisma.valantTransaction.groupBy({
      by: ['serviceDate', 'category'],
      where: { AND: [scope, { serviceDate: { gte: trendFrom, lt: trendTo } }] },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.valantTransaction.groupBy({ by: ['insurance', 'category'], where: inRange, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.valantTransaction.groupBy({ by: ['code', 'codeBase'], where: charges, _sum: { amountCents: true } }),
    prisma.valantTransaction.groupBy({ by: ['code'], where: { AND: [charges, { amountCents: { gt: 0 } }] }, _count: { _all: true } }),
    orNull(prisma.feeScheduleItem.findMany({ where: { organizationId, active: true }, select: { code: true, feeCents: true, active: true, description: true } })),
    prisma.valantTransaction.count({ where: { AND: [scope, { serviceDate: null }] } }),
    prisma.valantTransaction.count({ where: { organizationId, clientId: null } }),
  ]);

  const linesByCode = new Map(cptLines.map((g) => [g.code, g._count._all]));
  const valantPayers = valantPayerMix(payerGroups.map((g) => ({ insurance: g.insurance, ...toCat(g) })));

  let insuranceAging: { payerName: string; totalCents: number }[] | null = null;
  let clientInsurance: { payer: string; clients: number }[] = [];
  if (opts.payerFallback && valantPayers.rowsWithInsurance === 0) {
    const latest = await prisma.valantInsuranceAgingSnapshot.findFirst({
      where: { organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true },
    });
    if (latest) {
      insuranceAging = await prisma.valantInsuranceAgingSnapshot.findMany({
        where: { organizationId, asOf: latest.asOf }, select: { payerName: true, totalCents: true },
      });
    } else {
      const groups = await prisma.client.groupBy({
        by: ['insurancePayer'],
        where: { AND: [{ status: 'ACTIVE', insurancePayer: { not: null } }, clientOrgFilter(organizationId)] },
        _count: { _all: true },
      });
      clientInsurance = groups
        .filter((g) => g.insurancePayer && g.insurancePayer.trim())
        .map((g) => ({ payer: g.insurancePayer!.trim(), clients: g._count._all }));
    }
  }

  const options = facilityGroups
    .filter((g) => g.facility && g.facility.trim())
    .map((g) => ({ facility: g.facility!.trim(), rows: g._count._all }))
    .sort((a, b) => b.rows - a.rows || a.facility.localeCompare(b.facility));
  const selected = opts.facility ? ('equals' in opts.facility ? opts.facility.equals : opts.facility.contains) : null;

  return {
    hasData: orgRows._count._all > 0,
    rowsInScope: scopeMeta._count._all,
    asOf: {
      importedAt: orgRows._max.createdAt?.toISOString() ?? null,
      earliestServiceDate: isoDate(scopeMeta._min.serviceDate),
      latestServiceDate: isoDate(scopeMeta._max.serviceDate),
    },
    facility: {
      selected,
      options,
      rowsWithFacility: options.reduce((s, o) => s + o.rows, 0),
      note: options.length ? null : NO_FACILITY_NOTE,
    },
    kpis: valantKpis(categoryGroups.map(toCat), countVisits(visitGroups)),
    undatedRows,
    trend: valantTrend(trendGroups.map((g) => ({ serviceDate: g.serviceDate, ...toCat(g) })), months),
    payerMix: choosePayerMix({ valant: valantPayers, insuranceAging, clientInsurance }),
    cpt: cptUsage(
      cptSums.map((g) => ({ code: g.code, codeBase: g.codeBase, cents: g._sum.amountCents ?? 0, lines: linesByCode.get(g.code) ?? 0 })),
      fees ?? []
    ),
    unmatchedRows,
  };
}

// ─── A/R snapshot (Valant aging, prepayments, Altrixs ledger) ────────────────

export type ArSnapshot = {
  insurance: { asOf: string | null; totalCents: number; rows: number } | null;
  patient: { asOf: string | null; totalCents: number; rows: number } | null;
  prepaymentCredits: {
    periodStart: string | null;
    periodEnd: string | null;
    /** complete, positive prepayment nets of matched clients (shown positive) */
    creditCents: number;
    clients: number;
    /** clients left out (unmatched / incomplete / zero) */
    excluded: number;
  } | null;
  ledger: {
    schemaReady: boolean;
    /** active posted entries by kind; amountCents > 0 = owed, < 0 = credit */
    kinds: { kind: string; entries: number; totalCents: number }[];
  };
};

async function loadArSnapshot(organizationId: string): Promise<ArSnapshot> {
  const [insLatest, patLatest] = await Promise.all([
    prisma.valantInsuranceAgingSnapshot.findFirst({ where: { organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }),
    prisma.valantAgingSnapshot.findFirst({ where: { organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }),
  ]);
  const [insAgg, patAgg, prepay, ledgerGroups] = await Promise.all([
    insLatest
      ? prisma.valantInsuranceAgingSnapshot.aggregate({ where: { organizationId, asOf: insLatest.asOf }, _sum: { totalCents: true }, _count: { _all: true } })
      : null,
    patLatest
      ? prisma.valantAgingSnapshot.aggregate({ where: { organizationId, asOf: patLatest.asOf }, _sum: { totalCents: true }, _count: { _all: true } })
      : null,
    orNull(previewPrepaymentCredits(organizationId)),
    orNull(
      prisma.patientLedgerEntry.groupBy({
        by: ['kind'], where: { organizationId, supersededAt: null }, _sum: { amountCents: true }, _count: { _all: true },
      })
    ),
  ]);
  return {
    insurance: insLatest && insAgg ? { asOf: isoDate(insLatest.asOf), totalCents: insAgg._sum.totalCents ?? 0, rows: insAgg._count._all } : null,
    patient: patLatest && patAgg ? { asOf: isoDate(patLatest.asOf), totalCents: patAgg._sum.totalCents ?? 0, rows: patAgg._count._all } : null,
    prepaymentCredits: prepay
      ? {
          periodStart: prepay.periodStart,
          periodEnd: prepay.periodEnd,
          creditCents: -prepay.totals.postCents,
          clients: prepay.postings.length,
          excluded: prepay.excluded.length,
        }
      : null,
    ledger: {
      schemaReady: ledgerGroups !== null,
      kinds: (ledgerGroups ?? []).map((g) => ({ kind: g.kind, entries: g._count._all, totalCents: g._sum.amountCents ?? 0 })),
    },
  };
}

// ─── Altrixs (live) ──────────────────────────────────────────────────────────

export type AltrixsSection = {
  /** any Altrixs claim exists for the organization (any date) */
  hasClaims: boolean;
  emptyNote: string | null;
  claims: AltrixsClaimSummary;
  payments: AltrixsPaymentSummary | null;
  statements: { total: number; due: number; dueCents: number } | null;
  /** empty until Altrixs has claims or payments */
  trend: { month: string; billedCents: number; paymentsCents: number }[];
};

const STATEMENT_DUE = ['outstanding', 'sent', 'viewed', 'overdue', 'plan'];

async function loadAltrixsSection(organizationId: string, range: OverviewRange): Promise<AltrixsSection> {
  const created = { gte: range.from, lt: range.toExclusive };
  const months = trailingMonths(range.toDate);
  const [claimCount, claimGroups, paymentGroups, paymentsEver, statementTotal, statementDue] = await Promise.all([
    prisma.claim.count({ where: { organizationId } }),
    prisma.claim.groupBy({
      by: ['status'], where: { organizationId, createdAt: created }, _count: { _all: true }, _sum: { amountCents: true, paidAmount: true },
    }),
    orNull(prisma.payment.groupBy({ by: ['method'], where: { organizationId, paidAt: created }, _count: { _all: true }, _sum: { amountCents: true } })),
    orNull(prisma.payment.count({ where: { organizationId, method: { not: 'STUB' } } })),
    orNull(prisma.patientStatement.count({ where: { organizationId } })),
    orNull(
      prisma.patientStatement.aggregate({
        where: { organizationId, status: { in: STATEMENT_DUE }, balanceCents: { gt: 0 } }, _count: { _all: true }, _sum: { balanceCents: true },
      })
    ),
  ]);

  // Trend only when there is something to plot (empty before go-live)
  let trend: AltrixsSection['trend'] = [];
  if (claimCount > 0 || (paymentsEver ?? 0) > 0) {
    const trendFrom = zonedStartOfDay(`${months[0]}-01`);
    const [claimRows, paymentRows] = await Promise.all([
      prisma.claim.findMany({ where: { organizationId, createdAt: { gte: trendFrom } }, select: { createdAt: true, status: true, amountCents: true } }),
      orNull(prisma.payment.findMany({ where: { organizationId, paidAt: { gte: trendFrom }, method: { not: 'STUB' } }, select: { paidAt: true, amountCents: true } })),
    ]);
    const m = new Map(months.map((k) => [k, { month: k, billedCents: 0, paymentsCents: 0 }]));
    for (const c of claimRows) {
      const row = m.get(monthKey(c.createdAt));
      if (row && !['DRAFT', 'READY'].includes(c.status)) row.billedCents += c.amountCents ?? 0;
    }
    for (const p of paymentRows ?? []) {
      const row = m.get(monthKey(p.paidAt));
      if (row) row.paymentsCents += p.amountCents;
    }
    trend = [...m.values()];
  }

  return {
    hasClaims: claimCount > 0,
    emptyNote: claimCount > 0 ? null : NO_ALTRIXS_CLAIMS_NOTE,
    claims: summarizeAltrixsClaims(
      claimGroups.map((g) => ({ status: g.status, count: g._count._all, amountCents: g._sum.amountCents, paidAmount: g._sum.paidAmount }))
    ),
    payments: paymentGroups
      ? summarizeAltrixsPayments(paymentGroups.map((g) => ({ method: g.method, count: g._count._all, cents: g._sum.amountCents ?? 0 })))
      : null,
    statements:
      statementTotal === null || statementDue === null
        ? null
        : { total: statementTotal, due: statementDue._count._all, dueCents: statementDue._sum.balanceCents ?? 0 },
    trend,
  };
}

// ─── Work queues ─────────────────────────────────────────────────────────────

export type WorkQueues = {
  /** Altrixs signed / locked progress notes with no Altrixs claim */
  notesSignedNotBilled: number | null;
  denialsOpen: number | null;
  statementsDue: number | null;
  unmatchedValantRows: number;
  /** Approved auths the forecast flags: run out before the end date, expiring within lead time, or expired */
  authorizationsAtRisk: number | null;
};

function countSignedNotBilled(organizationId: string): Promise<number> {
  return prisma.progressNoteWorkflow.count({
    where: {
      status: { in: ['SIGNED', 'LOCKED'] },
      note: { claims: { none: {} }, client: clientOrgFilter(organizationId) },
    },
  });
}

// ─── Overview ────────────────────────────────────────────────────────────────

export type BillingOverview = {
  range: { preset: OverviewRange['preset']; fromDate: string; toDate: string };
  generatedAt: string;
  valant: ValantSection;
  altrixs: AltrixsSection;
  ar: ArSnapshot;
  queues: WorkQueues;
  /** kept for the role home feed (useRoleHomeFeed reads stats.activeClients) */
  stats: { activeClients: number };
};

export async function getBillingOverview(
  organizationId: string,
  range: OverviewRange,
  opts: { facility?: string | null } = {}
): Promise<BillingOverview> {
  const facility = opts.facility ? { equals: opts.facility } : null;
  const [valant, altrixs, ar, signedNotBilled, denialsOpen, activeClients, authsAtRisk] = await Promise.all([
    loadValantSection(organizationId, range, { facility, payerFallback: !facility }),
    loadAltrixsSection(organizationId, range),
    loadArSnapshot(organizationId),
    orNull(countSignedNotBilled(organizationId)),
    orNull(prisma.claimDenial.count({ where: { organizationId, status: 'OPEN' } })),
    prisma.client.count({ where: { AND: [{ status: 'ACTIVE' }, clientOrgFilter(organizationId)] } }),
    orNull(countAtRiskAuthorizations(organizationId)),
  ]);
  return {
    range: { preset: range.preset, fromDate: range.fromDate, toDate: range.toDate },
    generatedAt: new Date().toISOString(),
    valant,
    altrixs,
    ar,
    queues: {
      notesSignedNotBilled: signedNotBilled,
      denialsOpen,
      statementsDue: altrixs.statements?.due ?? null,
      unmatchedValantRows: valant.unmatchedRows,
      authorizationsAtRisk: authsAtRisk,
    },
    stats: { activeClients },
  };
}
