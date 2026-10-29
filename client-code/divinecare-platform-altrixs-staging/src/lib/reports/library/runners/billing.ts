/**
 * Billing & RCM reports. Two money sources, never added together:
 *   - Valant: imported ValantTransaction rows (by date of service) and Valant aging snapshots;
 *   - Altrixs: Claim / Payment / ERA adjustments (live).
 * Scope: ctx.clientWhere() for Altrixs rows; ctx.valantWhere() (Outcomes rule) for Valant rows.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { addValantGroup, emptyValantMoney, firstPayer, NO_FACILITY, type ValantMoney } from '@/lib/reports/outcomesReports';
import { getAgingLabels } from '@/lib/billing/valantBalances';
import { presentAgingBuckets } from '@/lib/billing/valantAgingDisplay';
import { patientBalances } from '@/lib/billing/patientLedger';
import { loadTimelyFilingQueue } from '@/lib/billing/timelyFilingQueue';
import type { ReportContext } from '../context';
import { NOT_IMPORTED_HISTORY } from '@/lib/appointments/importedHistory';
import {
  AGING_BUCKETS,
  addAging,
  claimOutstandingCents,
  cleanClaimRate,
  daysInAr,
  denialRate,
  emptyAging,
  grossCollectionRate,
  netCollectionRate,
  pct,
} from '../formulas';
import type { ReportColumn, ReportOutput, ReportRow, ResolvedParams } from '../types';
import { NO_PROVIDER, NO_SITE, UNSPECIFIED, dateOnly, monthIn, monthLabel, monthOfDateOnly, requireRange, siteList, source, staffNames, ymdIn } from './shared';

const DAY_MS = 86_400_000;
type Range = NonNullable<ResolvedParams['range']>;
const OPEN_AR: Prisma.ClaimWhereInput['status'] = { in: ['READY', 'SUBMITTED', 'ACCEPTED', 'DENIED'] };
const NOT_PAYMENT_METHODS = ['STUB'] as const;

const money = (key: string, label: string, description?: string): ReportColumn => ({ key, label, type: 'money', ...(description ? { description } : {}) });

// ─── Valant money folding ────────────────────────────────────────────────────

type MoneyDim = 'month' | 'provider' | 'payer' | 'site';
type VRow = ValantMoney & { key: string; label: string };

function valantPayerWhere(payer: string | null): Prisma.ValantTransactionWhereInput {
  return payer ? { insurance: { contains: payer, mode: 'insensitive' } } : {};
}

async function valantMoneyBy(ctx: ReportContext, range: Range, payer: string | null, dim: MoneyDim): Promise<{ rows: VRow[]; total: ValantMoney; orgRows: number; importedAt: Date | null }> {
  const where: Prisma.ValantTransactionWhereInput = { AND: [ctx.valantWhere({ from: range.dayFrom, toExclusive: range.dayToExclusive }), valantPayerWhere(payer)] };
  const meta = prisma.valantTransaction.aggregate({ where: { organizationId: ctx.organizationId }, _count: { _all: true }, _max: { createdAt: true } });
  const map = new Map<string, VRow>();
  const total = emptyValantMoney();
  const add = (key: string, label: string, category: string, cents: number, count: number) => {
    const r = map.get(key) ?? { key, label, ...emptyValantMoney() };
    addValantGroup(r, { category, cents, count });
    addValantGroup(total, { category, cents, count });
    map.set(key, r);
  };
  if (dim === 'month') {
    const g = await prisma.valantTransaction.groupBy({ by: ['serviceDate', 'category'], where, _count: { _all: true }, _sum: { amountCents: true } });
    for (const r of g) {
      const k = r.serviceDate ? monthOfDateOnly(r.serviceDate) : 'none';
      add(k, k === 'none' ? 'No service date' : monthLabel(k), r.category, r._sum.amountCents ?? 0, r._count._all);
    }
  } else if (dim === 'payer') {
    const g = await prisma.valantTransaction.groupBy({ by: ['insurance', 'category'], where, _count: { _all: true }, _sum: { amountCents: true } });
    for (const r of g) {
      const label = firstPayer(r.insurance);
      add(label.toLowerCase(), label, r.category, r._sum.amountCents ?? 0, r._count._all);
    }
  } else if (dim === 'site') {
    const g = await prisma.valantTransaction.groupBy({ by: ['facility', 'category'], where, _count: { _all: true }, _sum: { amountCents: true } });
    for (const r of g) {
      const label = r.facility?.trim() || NO_FACILITY;
      add(label.toLowerCase(), label, r.category, r._sum.amountCents ?? 0, r._count._all);
    }
  } else {
    const g = await prisma.valantTransaction.groupBy({ by: ['providerUserId', 'providerCode', 'category'], where, _count: { _all: true }, _sum: { amountCents: true } });
    const names = await staffNames(ctx.organizationId, g.map((r) => r.providerUserId));
    for (const r of g) {
      const matched = r.providerUserId && names.has(r.providerUserId);
      const label = matched ? (names.get(r.providerUserId as string) as string) : r.providerCode?.trim() || 'No provider on row';
      add(matched ? `u:${r.providerUserId}` : `c:${label}`, label, r.category, r._sum.amountCents ?? 0, r._count._all);
    }
  }
  const m = await meta;
  const rows = [...map.values()].sort((a, b) => (dim === 'month' ? a.key.localeCompare(b.key) : b.chargesCents - a.chargesCents));
  return { rows, total, orgRows: m._count._all, importedAt: m._max.createdAt };
}

// ─── Altrixs money folding ───────────────────────────────────────────────────

type ARow = { key: string; label: string; claims: number; chargesCents: number; insurancePaymentsCents: number; patientPaymentsCents: number; adjustmentsCents: number; contractualCents: number };

function claimScope(ctx: ReportContext, payer: string | null): Prisma.ClaimWhereInput {
  return {
    organizationId: ctx.organizationId,
    client: ctx.clientWhere(),
    ...(payer ? { payer: { contains: payer, mode: 'insensitive' } } : {}),
    ...(ctx.scope.clinicianId
      ? { OR: [{ appointment: { clinicianId: ctx.scope.clinicianId } }, { progressNote: { clinicianId: ctx.scope.clinicianId } }] }
      : {}),
  };
}

async function altrixsMoneyBy(ctx: ReportContext, range: Range, payer: string | null, dim: MoneyDim): Promise<{ rows: ARow[]; total: ARow; counts: { claims: number; payments: number; adjustments: number } }> {
  const scope = claimScope(ctx, payer);
  const claimSel = { id: true, payer: true, amountCents: true, createdAt: true, client: { select: { locationId: true } }, appointment: { select: { clinicianId: true } }, progressNote: { select: { clinicianId: true } } } as const;
  const [claims, payments, adjustments] = await Promise.all([
    prisma.claim.findMany({ where: { ...scope, status: { not: 'DRAFT' }, createdAt: { gte: range.from, lt: range.toExclusive } }, select: claimSel }),
    prisma.payment.findMany({
      where: {
        organizationId: ctx.organizationId,
        client: ctx.clientWhere(),
        paidAt: { gte: range.from, lt: range.toExclusive },
        method: { notIn: [...NOT_PAYMENT_METHODS] },
        ...(payer || ctx.scope.clinicianId ? { claim: scope } : {}),
      },
      select: { amountCents: true, method: true, paidAt: true, client: { select: { locationId: true } }, claim: { select: claimSel } },
    }),
    prisma.eraAdjustment.findMany({
      where: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.toExclusive } },
      select: { claimId: true, groupCode: true, amount: true, createdAt: true },
    }),
  ]);
  // ERA adjustments carry a claim id but no relation: keep those on claims this viewer may report on.
  const adjClaimIds = [...new Set(adjustments.map((a) => a.claimId))];
  const adjClaims = adjClaimIds.length ? await prisma.claim.findMany({ where: { ...scope, id: { in: adjClaimIds } }, select: claimSel }) : [];
  const adjClaimBy = new Map(adjClaims.map((c) => [c.id, c]));
  const sites = dim === 'site' ? new Map((await siteList(ctx.organizationId)).map((s) => [s.id, s.name])) : null;
  const provIds = dim === 'provider' ? [...claims, ...adjClaims, ...payments.map((p) => p.claim).filter(Boolean)].map((c) => c!.appointment?.clinicianId ?? c!.progressNote?.clinicianId ?? null) : [];
  const names = dim === 'provider' ? await staffNames(ctx.organizationId, provIds) : new Map<string, string>();
  type C = { payer: string | null; client: { locationId: string | null }; appointment: { clinicianId: string | null } | null; progressNote: { clinicianId: string | null } | null } | null;
  const keyOf = (c: C, at: Date, locationId: string | null): [string, string] => {
    if (dim === 'month') { const k = monthIn(at, ctx.timeZone); return [k, monthLabel(k)]; }
    if (dim === 'payer') { const l = c?.payer?.trim() || (c ? UNSPECIFIED : 'No claim (patient payment)'); return [l.toLowerCase(), l]; }
    if (dim === 'site') { const id = locationId; return [id ?? '__none__', id ? sites!.get(id) ?? 'Other' : NO_SITE]; }
    const pid = c?.appointment?.clinicianId ?? c?.progressNote?.clinicianId ?? null;
    return [pid ?? '__none__', pid ? names.get(pid) ?? 'Other organization / removed user' : NO_PROVIDER];
  };
  const map = new Map<string, ARow>();
  const total: ARow = { key: 'total', label: 'Total', claims: 0, chargesCents: 0, insurancePaymentsCents: 0, patientPaymentsCents: 0, adjustmentsCents: 0, contractualCents: 0 };
  const row = (k: [string, string]) => {
    const r = map.get(k[0]) ?? { key: k[0], label: k[1], claims: 0, chargesCents: 0, insurancePaymentsCents: 0, patientPaymentsCents: 0, adjustmentsCents: 0, contractualCents: 0 };
    map.set(k[0], r);
    return r;
  };
  for (const c of claims) {
    const r = row(keyOf(c, c.createdAt, c.client.locationId));
    r.claims++; total.claims++;
    r.chargesCents += c.amountCents ?? 0; total.chargesCents += c.amountCents ?? 0;
  }
  for (const pm of payments) {
    const r = row(keyOf(pm.claim, pm.paidAt, pm.client.locationId));
    if (pm.method === 'INSURANCE') { r.insurancePaymentsCents += pm.amountCents; total.insurancePaymentsCents += pm.amountCents; }
    else { r.patientPaymentsCents += pm.amountCents; total.patientPaymentsCents += pm.amountCents; }
  }
  let adjUsed = 0;
  for (const a of adjustments) {
    const c = adjClaimBy.get(a.claimId);
    if (!c) continue;
    adjUsed++;
    const cents = Math.round(Number(a.amount) * 100);
    const r = row(keyOf(c, a.createdAt, c.client.locationId));
    r.adjustmentsCents += cents; total.adjustmentsCents += cents;
    if (a.groupCode === 'CO') { r.contractualCents += cents; total.contractualCents += cents; }
  }
  const rows = [...map.values()].sort((a, b) => (dim === 'month' ? a.key.localeCompare(b.key) : b.chargesCents - a.chargesCents));
  return { rows, total, counts: { claims: claims.length, payments: payments.length, adjustments: adjUsed } };
}

const DIM_LABEL: Record<MoneyDim, string> = { month: 'Month', provider: 'Provider', payer: 'Payer', site: 'Site / facility' };

// ─── Charges, payments, adjustments ──────────────────────────────────────────

export async function runChargesPayments(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = (p.values.groupBy ?? 'month') as MoneyDim;
  if ((p.values.source ?? 'valant') === 'valant') {
    const v = await valantMoneyBy(ctx, range, p.payer, dim);
    const rows: ReportRow[] = v.rows.map((r) => ({
      group: r.label, lines: r.rows, charges: r.chargesCents, insurancePayments: r.insurancePaymentsCents, patientPayments: r.patientPaymentsCents,
      adjustments: r.adjustmentsCents, fees: r.feesCents, other: r.otherCents,
    }));
    return {
      columns: [
        { key: 'group', label: DIM_LABEL[dim], type: 'text' },
        { key: 'lines', label: 'Transactions', type: 'number' },
        money('charges', 'Charges'), money('insurancePayments', 'Insurance payments'), money('patientPayments', 'Patient payments'),
        money('adjustments', 'Adjustments'), money('fees', 'Missed-visit fees'), money('other', 'Transfers / other'),
      ],
      rows,
      kpis: [
        { label: 'Charges', value: v.total.chargesCents, type: 'money' },
        { label: 'Payments', value: v.total.insurancePaymentsCents + v.total.patientPaymentsCents, type: 'money' },
        { label: 'Adjustments', value: v.total.adjustmentsCents, type: 'money' },
      ],
      chart: { type: dim === 'month' ? 'line' : 'bar', xKey: 'group', valueType: 'money', series: [{ key: 'charges', label: 'Charges' }, { key: 'insurancePayments', label: 'Insurance payments' }, { key: 'patientPayments', label: 'Patient payments' }] },
      sources: [source('Valant transactions (imported)', v.total.rows, v.importedAt, `${v.orgRows} rows imported for the organization`)],
      notices: [
        ...(v.orgRows === 0 ? ['No Valant transactions have been imported.'] : v.total.rows === 0 ? ['No Valant transactions with a date of service in this period.'] : []),
        'Valant figures are history imported from Valant (reference); they are not Altrixs postings.',
      ],
      asOf: v.importedAt?.toISOString() ?? null,
    };
  }
  const a = await altrixsMoneyBy(ctx, range, p.payer, dim);
  const rows: ReportRow[] = a.rows.map((r) => ({
    group: r.label, claims: r.claims, charges: r.chargesCents, insurancePayments: r.insurancePaymentsCents, patientPayments: r.patientPaymentsCents,
    adjustments: r.adjustmentsCents, contractual: r.contractualCents,
  }));
  return {
    columns: [
      { key: 'group', label: DIM_LABEL[dim], type: 'text' },
      { key: 'claims', label: 'Claims', type: 'number' },
      money('charges', 'Charges (billed)'), money('insurancePayments', 'Insurance payments'), money('patientPayments', 'Patient payments'),
      money('adjustments', 'ERA adjustments'), money('contractual', 'Contractual (CO)'),
    ],
    rows,
    kpis: [
      { label: 'Charges', value: a.total.chargesCents, type: 'money' },
      { label: 'Payments', value: a.total.insurancePaymentsCents + a.total.patientPaymentsCents, type: 'money' },
      { label: 'Adjustments', value: a.total.adjustmentsCents, type: 'money' },
    ],
    chart: { type: dim === 'month' ? 'line' : 'bar', xKey: 'group', valueType: 'money', series: [{ key: 'charges', label: 'Charges' }, { key: 'insurancePayments', label: 'Insurance payments' }, { key: 'patientPayments', label: 'Patient payments' }] },
    sources: [source('Claims (Altrixs)', a.counts.claims), source('Payments (Altrixs)', a.counts.payments), source('ERA adjustments', a.counts.adjustments)],
    notices: a.counts.claims + a.counts.payments === 0 ? ['No Altrixs claims or payments in this period (Altrixs billing starts at go-live; earlier history is in the Valant source).'] : [],
  };
}

// ─── A/R aging ───────────────────────────────────────────────────────────────

type OpenClaim = { payer: string | null; amountCents: number | null; paidAmount: number | null; patientResponsibility: number | null; createdAt: Date; submittedAt: Date | null; appointment: { startsAt: Date } | null; progressNote: { dateOfService: Date | null } | null; payments: { amountCents: number }[] };

async function openClaims(ctx: ReportContext, payer: string | null): Promise<OpenClaim[]> {
  return prisma.claim.findMany({
    where: { ...claimScope(ctx, payer), status: OPEN_AR },
    select: { payer: true, amountCents: true, paidAmount: true, patientResponsibility: true, createdAt: true, submittedAt: true, appointment: { select: { startsAt: true } }, progressNote: { select: { dateOfService: true } }, payments: { select: { amountCents: true } } },
  });
}

function claimAge(c: OpenClaim, now: Date): number {
  const anchor = c.appointment?.startsAt ?? c.progressNote?.dateOfService ?? c.submittedAt ?? c.createdAt;
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / DAY_MS));
}

async function latestValantInsuranceAging(organizationId: string) {
  const latest = await prisma.valantInsuranceAgingSnapshot.findFirst({ where: { organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } });
  if (!latest) return { asOf: null as Date | null, rows: [] as { payerName: string; b: number[]; totalCents: number }[] };
  const rows = await prisma.valantInsuranceAgingSnapshot.findMany({ where: { organizationId, asOf: latest.asOf }, select: { payerName: true, bucket1Cents: true, bucket2Cents: true, bucket3Cents: true, bucket4Cents: true, bucket5Cents: true, totalCents: true } });
  return { asOf: latest.asOf, rows: rows.map((r) => ({ payerName: r.payerName, b: [r.bucket1Cents, r.bucket2Cents, r.bucket3Cents, r.bucket4Cents, r.bucket5Cents], totalCents: r.totalCents })) };
}

export async function runArAging(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  if ((p.values.source ?? 'valant') === 'valant') {
    const [aging, labels] = await Promise.all([latestValantInsuranceAging(ctx.organizationId), getAgingLabels(ctx.organizationId)]);
    const filtered = p.payer ? aging.rows.filter((r) => r.payerName.toLowerCase().includes(p.payer!.toLowerCase())) : aging.rows;
    const byPayer = new Map<string, { group: string; b: number[]; total: number }>();
    for (const r of filtered) {
      const shown = presentAgingBuckets(r.b, r.totalCents, labels.displayAllOver120).displayBucketsCents;
      const k = r.payerName.trim().toLowerCase();
      const acc = byPayer.get(k) ?? { group: r.payerName.trim() || UNSPECIFIED, b: [0, 0, 0, 0, 0], total: 0 };
      shown.forEach((v, i) => (acc.b[i] += v));
      acc.total += r.totalCents;
      byPayer.set(k, acc);
    }
    const grand = [...byPayer.values()].reduce((s, r) => s + r.total, 0);
    const rows: ReportRow[] = [...byPayer.values()].sort((a, b) => b.total - a.total).map((r) => ({ group: r.group, b1: r.b[0], b2: r.b[1], b3: r.b[2], b4: r.b[3], b5: r.b[4], total: r.total, share: pct(r.total, grand) }));
    const totals = [0, 1, 2, 3, 4].map((i) => rows.reduce((s, r) => s + Number(r[`b${i + 1}`] ?? 0), 0));
    return {
      columns: [
        { key: 'group', label: 'Payer', type: 'text' },
        ...labels.labels.slice(0, 5).map((l, i) => money(`b${i + 1}`, l)),
        money('total', 'Total'),
        { key: 'share', label: '% of A/R', type: 'percent' },
      ],
      rows,
      kpis: [
        { label: 'Insurance A/R (Valant)', value: grand, type: 'money' },
        { label: `${labels.labels[4] ?? 'Oldest bucket'}`, value: totals[4], type: 'money' },
        { label: 'Payers', value: rows.length, type: 'number' },
      ],
      chart: { type: 'bar', xKey: 'bucket', valueType: 'money', series: [{ key: 'amount', label: 'A/R' }], data: labels.labels.slice(0, 5).map((l, i) => ({ bucket: l, amount: totals[i] })) },
      sources: [source('Valant insurance aging (latest import)', aging.rows.length, aging.asOf)],
      notices: [
        ...(aging.rows.length === 0 ? ['No Valant insurance aging report has been imported.'] : []),
        ...(labels.displayAllOver120 && aging.rows.length ? ['Practice setting: every Valant balance is shown in the oldest bucket (Over 120). Valant’s original buckets are on the Valant balances page.'] : []),
        'Valant A/R is a run-out reference; it is never posted to Altrixs.',
      ],
      asOf: aging.asOf?.toISOString() ?? null,
    };
  }
  const claims = await openClaims(ctx, p.payer);
  const byPayer = new Map<string, { group: string; t: ReturnType<typeof emptyAging>; claims: number }>();
  const total = emptyAging();
  for (const c of claims) {
    const cents = claimOutstandingCents({ amountCents: c.amountCents, paidAmount: c.paidAmount, patientResponsibility: c.patientResponsibility, paymentsCents: c.payments.reduce((s, x) => s + x.amountCents, 0) });
    if (cents <= 0) continue;
    const days = claimAge(c, ctx.now);
    const label = c.payer?.trim() || UNSPECIFIED;
    const r = byPayer.get(label.toLowerCase()) ?? { group: label, t: emptyAging(), claims: 0 };
    addAging(r.t, days, cents);
    addAging(total, days, cents);
    r.claims++;
    byPayer.set(label.toLowerCase(), r);
  }
  const rows: ReportRow[] = [...byPayer.values()].sort((a, b) => b.t.total - a.t.total).map((r) => ({ group: r.group, claims: r.claims, ...Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, r.t[b.key]])), total: r.t.total, share: pct(r.t.total, total.total) }));
  return {
    columns: [
      { key: 'group', label: 'Payer', type: 'text' },
      { key: 'claims', label: 'Open claims', type: 'number' },
      ...AGING_BUCKETS.map((b) => money(b.key, `${b.label} days`)),
      money('total', 'Total'),
      { key: 'share', label: '% of A/R', type: 'percent' },
    ],
    rows,
    kpis: [
      { label: 'Open A/R (Altrixs)', value: total.total, type: 'money' },
      { label: 'Over 90 days', value: total.b91_120 + total.b120p, type: 'money' },
      { label: 'Over 90 days %', value: pct(total.b91_120 + total.b120p, total.total), type: 'percent' },
    ],
    chart: { type: 'bar', xKey: 'bucket', valueType: 'money', series: [{ key: 'amount', label: 'A/R' }], data: AGING_BUCKETS.map((b) => ({ bucket: `${b.label} d`, amount: total[b.key] })) },
    sources: [source('Open claims (Altrixs)', claims.length, ctx.now)],
    notices: claims.length === 0 ? ['No open Altrixs claims (Altrixs billing starts at go-live; Valant run-out is the Valant source).'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Days in A/R ─────────────────────────────────────────────────────────────

export async function runDaysInAr(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const periodDays = Math.round((range.dayToExclusive.getTime() - range.dayFrom.getTime()) / DAY_MS);
  const [vCharges, insAging, patLatest, claims, aCharges] = await Promise.all([
    prisma.valantTransaction.aggregate({ where: { AND: [ctx.valantWhere({ from: range.dayFrom, toExclusive: range.dayToExclusive }), { category: 'charge' }] }, _sum: { amountCents: true }, _count: { _all: true } }),
    latestValantInsuranceAging(ctx.organizationId),
    prisma.valantAgingSnapshot.findFirst({ where: { organizationId: ctx.organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }),
    openClaims(ctx, null),
    prisma.claim.aggregate({ where: { ...claimScope(ctx, null), status: { not: 'DRAFT' }, createdAt: { gte: range.from, lt: range.toExclusive } }, _sum: { amountCents: true }, _count: { _all: true } }),
  ]);
  const patTotal = patLatest
    ? (await prisma.valantAgingSnapshot.aggregate({ where: { organizationId: ctx.organizationId, asOf: patLatest.asOf }, _sum: { totalCents: true } }))._sum.totalCents ?? 0
    : 0;
  const vEnding = insAging.rows.reduce((s, r) => s + r.totalCents, 0) + patTotal;
  const aEnding = claims.reduce((s, c) => s + claimOutstandingCents({ amountCents: c.amountCents, paidAmount: c.paidAmount, patientResponsibility: c.patientResponsibility, paymentsCents: c.payments.reduce((x, y) => x + y.amountCents, 0) }), 0);
  const vChargesCents = vCharges._sum.amountCents ?? 0;
  const aChargesCents = aCharges._sum.amountCents ?? 0;
  const hasValantAr = insAging.rows.length > 0 || Boolean(patLatest);
  const rows: ReportRow[] = [
    {
      group: 'Valant (imported)', endingAr: hasValantAr ? vEnding : null, arAsOf: [insAging.asOf, patLatest?.asOf].filter(Boolean).map((d) => (d as Date).toISOString().slice(0, 10)).sort().pop() ?? null,
      charges: vChargesCents, days: periodDays, avgDaily: periodDays ? Math.round(vChargesCents / periodDays) : null,
      daysInAr: hasValantAr ? daysInAr(vEnding, vChargesCents, periodDays) : null,
    },
    {
      group: 'Altrixs (claims)', endingAr: aEnding, arAsOf: ymdIn(ctx.now, ctx.timeZone),
      charges: aChargesCents, days: periodDays, avgDaily: periodDays ? Math.round(aChargesCents / periodDays) : null,
      daysInAr: daysInAr(aEnding, aChargesCents, periodDays),
    },
  ];
  return {
    columns: [
      { key: 'group', label: 'Source', type: 'text' },
      money('endingAr', 'Ending A/R'),
      { key: 'arAsOf', label: 'A/R as of', type: 'date' },
      money('charges', 'Charges in period'),
      { key: 'days', label: 'Days in period', type: 'number' },
      money('avgDaily', 'Avg daily charges'),
      { key: 'daysInAr', label: 'Days in A/R', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Days in A/R (Valant)', value: rows[0].daysInAr, type: 'number' },
      { label: 'Days in A/R (Altrixs)', value: rows[1].daysInAr, type: 'number' },
    ],
    sources: [
      source('Valant charges in period', vCharges._count._all),
      source('Valant aging (insurance + patient, latest import)', insAging.rows.length + (patLatest ? 1 : 0), insAging.asOf ?? patLatest?.asOf ?? null),
      source('Altrixs claims', aCharges._count._all + claims.length, ctx.now),
    ],
    notices: [
      ...(!hasValantAr ? ['No Valant aging has been imported, so Valant days in A/R cannot be calculated.'] : []),
      ...(aChargesCents === 0 ? ['No Altrixs charges in this period, so Altrixs days in A/R cannot be calculated.'] : []),
      'Valant ending A/R comes from the latest imported aging report, which may be older than the end of the period.',
    ],
  };
}

// ─── Net collection rate ─────────────────────────────────────────────────────

export async function runNetCollection(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = (p.values.groupBy ?? 'month') as MoneyDim;
  const cols: ReportColumn[] = [
    { key: 'group', label: DIM_LABEL[dim], type: 'text' },
    money('charges', 'Charges'), money('payments', 'Payments'), money('contractual', 'Contractual adjustments'),
    { key: 'ncr', label: 'Net collection rate', type: 'percent' }, { key: 'gcr', label: 'Gross collection rate', type: 'percent' },
  ];
  if ((p.values.source ?? 'valant') === 'valant') {
    const v = await valantMoneyBy(ctx, range, p.payer, dim);
    const rows: ReportRow[] = v.rows.map((r) => {
      const pay = r.insurancePaymentsCents + r.patientPaymentsCents;
      return { group: r.label, charges: r.chargesCents, payments: pay, contractual: r.adjustmentsCents, ncr: netCollectionRate(pay, r.chargesCents, r.adjustmentsCents), gcr: grossCollectionRate(pay, r.chargesCents) };
    });
    const pay = v.total.insurancePaymentsCents + v.total.patientPaymentsCents;
    return {
      columns: cols,
      rows,
      kpis: [
        { label: 'Net collection rate', value: netCollectionRate(pay, v.total.chargesCents, v.total.adjustmentsCents), type: 'percent' },
        { label: 'Gross collection rate', value: grossCollectionRate(pay, v.total.chargesCents), type: 'percent' },
        { label: 'Payments', value: pay, type: 'money' },
      ],
      chart: { type: dim === 'month' ? 'line' : 'bar', xKey: 'group', valueType: 'percent', series: [{ key: 'ncr', label: 'Net collection rate' }] },
      sources: [source('Valant transactions (imported)', v.total.rows, v.importedAt)],
      notices: [
        ...(v.orgRows === 0 ? ['No Valant transactions have been imported.'] : []),
        'Valant adjustments (insurance and patient) are treated as contractual; Valant does not separate contractual from other write-offs in the transaction journal.',
        'By date of service: recent months look low until their payments arrive.',
      ],
      asOf: v.importedAt?.toISOString() ?? null,
    };
  }
  const a = await altrixsMoneyBy(ctx, range, p.payer, dim);
  const rows: ReportRow[] = a.rows.map((r) => {
    const pay = r.insurancePaymentsCents + r.patientPaymentsCents;
    return { group: r.label, charges: r.chargesCents, payments: pay, contractual: r.contractualCents, ncr: netCollectionRate(pay, r.chargesCents, r.contractualCents), gcr: grossCollectionRate(pay, r.chargesCents) };
  });
  const pay = a.total.insurancePaymentsCents + a.total.patientPaymentsCents;
  return {
    columns: cols,
    rows,
    kpis: [
      { label: 'Net collection rate', value: netCollectionRate(pay, a.total.chargesCents, a.total.contractualCents), type: 'percent' },
      { label: 'Gross collection rate', value: grossCollectionRate(pay, a.total.chargesCents), type: 'percent' },
      { label: 'Payments', value: pay, type: 'money' },
    ],
    chart: { type: dim === 'month' ? 'line' : 'bar', xKey: 'group', valueType: 'percent', series: [{ key: 'ncr', label: 'Net collection rate' }] },
    sources: [source('Claims (Altrixs)', a.counts.claims), source('Payments (Altrixs)', a.counts.payments), source('ERA adjustments', a.counts.adjustments)],
    notices: a.counts.claims === 0 ? ['No Altrixs charges in this period, so the collection rate cannot be calculated.'] : [],
  };
}

// ─── Denials ─────────────────────────────────────────────────────────────────

export async function runDenials(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'reason';
  const scope = claimScope(ctx, p.payer);
  const [denials, decided] = await Promise.all([
    prisma.claimDenial.findMany({
      where: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.toExclusive }, claim: scope },
      select: { claimId: true, carcCode: true, reasonCode: true, reasonText: true, status: true, createdAt: true, claim: { select: { payer: true, amountCents: true } } },
    }),
    prisma.claim.groupBy({ by: ['status'], where: { ...scope, createdAt: { gte: range.from, lt: range.toExclusive }, status: { in: ['ACCEPTED', 'PAID', 'DENIED'] } }, _count: { _all: true } }),
  ]);
  const map = new Map<string, { group: string; description: string; denials: number; claims: Set<string>; billed: number; open: number; appealed: number; won: number; lost: number }>();
  for (const d of denials) {
    const code = (d.carcCode || d.reasonCode || '').trim() || UNSPECIFIED;
    const key = dim === 'reason' ? code : dim === 'payer' ? d.claim.payer?.trim() || UNSPECIFIED : monthIn(d.createdAt, ctx.timeZone);
    const r = map.get(key) ?? { group: dim === 'month' ? monthLabel(key) : key, description: dim === 'reason' ? d.reasonText : '', denials: 0, claims: new Set<string>(), billed: 0, open: 0, appealed: 0, won: 0, lost: 0 };
    r.denials++;
    if (!r.claims.has(d.claimId)) {
      r.claims.add(d.claimId);
      r.billed += d.claim.amountCents ?? 0;
    }
    if (d.status === 'OPEN') r.open++;
    else if (d.status === 'APPEALED') r.appealed++;
    else if (d.status === 'WON') r.won++;
    else r.lost++;
    map.set(key, r);
  }
  const deniedCount = decided.find((g) => g.status === 'DENIED')?._count._all ?? 0;
  const decidedCount = decided.reduce((s, g) => s + g._count._all, 0);
  const rows: ReportRow[] = [...map.entries()].sort((a, b) => (dim === 'month' ? a[0].localeCompare(b[0]) : b[1].denials - a[1].denials)).map(([, r]) => ({
    group: r.group, ...(dim === 'reason' ? { description: r.description } : {}), denials: r.denials, claims: r.claims.size, billed: r.billed,
    open: r.open, appealed: r.appealed, won: r.won, lost: r.lost, share: pct(r.denials, denials.length),
  }));
  return {
    columns: [
      { key: 'group', label: dim === 'reason' ? 'Reason (CARC)' : dim === 'payer' ? 'Payer' : 'Month', type: 'text' },
      ...(dim === 'reason' ? [{ key: 'description', label: 'Description', type: 'text' as const }] : []),
      { key: 'denials', label: 'Denials', type: 'number' },
      { key: 'claims', label: 'Claims', type: 'number' },
      money('billed', 'Billed on denied claims'),
      { key: 'open', label: 'Open', type: 'number' }, { key: 'appealed', label: 'Appealed', type: 'number' },
      { key: 'won', label: 'Won', type: 'number' }, { key: 'lost', label: 'Lost', type: 'number' },
      { key: 'share', label: '% of denials', type: 'percent' },
    ],
    rows,
    kpis: [
      { label: 'Denial rate', value: denialRate(deniedCount, decidedCount), type: 'percent', hint: `${deniedCount} of ${decidedCount} decided claims` },
      { label: 'Denials', value: denials.length, type: 'number' },
      { label: 'Still open', value: denials.filter((d) => d.status === 'OPEN').length, type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'denials', label: 'Denials' }], data: rows.slice(0, 12) },
    sources: [source('Claim denials', denials.length), source('Decided claims', decidedCount)],
    notices: [
      ...(denials.length === 0 ? ['No claim denials recorded in this period.'] : []),
      'Valant history has no denial data; this report covers Altrixs claims only.',
    ],
  };
}

// ─── Clean claim rate ────────────────────────────────────────────────────────

export async function runCleanClaimRate(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'payer';
  const claims = await prisma.claim.findMany({
    where: { ...claimScope(ctx, p.payer), createdAt: { gte: range.from, lt: range.toExclusive }, status: { in: ['ACCEPTED', 'PAID', 'DENIED'] } },
    select: { payer: true, status: true, denialReason: true, createdAt: true, _count: { select: { denials: true } } },
  });
  const map = new Map<string, { group: string; decided: number; clean: number; denied: number }>();
  let decided = 0;
  let clean = 0;
  for (const c of claims) {
    const key = dim === 'month' ? monthIn(c.createdAt, ctx.timeZone) : c.payer?.trim() || UNSPECIFIED;
    const r = map.get(key) ?? { group: dim === 'month' ? monthLabel(key) : key, decided: 0, clean: 0, denied: 0 };
    r.decided++;
    decided++;
    const isClean = (c.status === 'ACCEPTED' || c.status === 'PAID') && c._count.denials === 0 && !c.denialReason;
    if (isClean) { r.clean++; clean++; }
    if (c.status === 'DENIED' || c._count.denials > 0) r.denied++;
    map.set(key, r);
  }
  const rows: ReportRow[] = [...map.entries()].sort((a, b) => (dim === 'month' ? a[0].localeCompare(b[0]) : b[1].decided - a[1].decided)).map(([, r]) => ({ ...r, rate: cleanClaimRate(r.clean, r.decided) }));
  return {
    columns: [
      { key: 'group', label: dim === 'month' ? 'Month' : 'Payer', type: 'text' },
      { key: 'decided', label: 'Decided claims', type: 'number' },
      { key: 'clean', label: 'First-pass accepted', type: 'number' },
      { key: 'denied', label: 'Denied at least once', type: 'number' },
      { key: 'rate', label: 'Clean claim rate', type: 'percent' },
    ],
    rows,
    kpis: [{ label: 'Clean claim rate', value: cleanClaimRate(clean, decided), type: 'percent', hint: `${clean} of ${decided}` }, { label: 'Decided claims', value: decided, type: 'number' }],
    chart: { type: dim === 'month' ? 'line' : 'bar', xKey: 'group', valueType: 'percent', series: [{ key: 'rate', label: 'Clean claim rate' }] },
    sources: [source('Claims with a payer decision', decided)],
    notices: decided === 0 ? ['No Altrixs claims with a payer decision in this period.'] : [],
  };
}

// ─── Unbilled / unsigned encounters ──────────────────────────────────────────

export async function runUnbilledEncounters(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const showAll = p.values.show === 'all';
  const visits = await prisma.appointment.findMany({
    where: {
      client: ctx.clientWhere(),
      status: { in: ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'] },
      startsAt: { gte: range.from, lt: range.toExclusive },
      // Visits imported from Valant were billed in Valant
      ...NOT_IMPORTED_HISTORY,
      ...(ctx.scope.clinicianId ? { clinicianId: ctx.scope.clinicianId } : {}),
    },
    select: {
      id: true, startsAt: true, type: true, clinicianId: true, clientId: true,
      client: { select: { name: true, mrn: true } },
      claims: { select: { id: true, status: true } },
      progressNotes: { select: { workflow: { select: { status: true } }, claims: { select: { id: true } } } },
    },
    orderBy: { startsAt: 'asc' },
  });
  const clientIds = [...new Set(visits.map((v) => v.clientId))];
  const valantCharges = clientIds.length
    ? await prisma.valantTransaction.groupBy({
        by: ['clientId', 'serviceDate'],
        where: { organizationId: ctx.organizationId, clientId: { in: clientIds }, category: 'charge', serviceDate: { gte: new Date(range.dayFrom.getTime() - DAY_MS), lt: new Date(range.dayToExclusive.getTime() + DAY_MS) } },
      })
    : [];
  const valantKey = new Set(valantCharges.map((v) => `${v.clientId}|${dateOnly(v.serviceDate)}`));
  const names = await staffNames(ctx.organizationId, visits.map((v) => v.clinicianId));
  let noNote = 0;
  let unsigned = 0;
  let noClaim = 0;
  let billedValant = 0;
  const rows: ReportRow[] = [];
  for (const v of visits) {
    const notes = v.progressNotes;
    const signed = notes.some((n) => n.workflow && n.workflow.status !== 'DRAFT');
    const noteState = notes.length === 0 ? 'No note' : signed ? 'Signed' : 'Unsigned';
    const hasClaim = v.claims.length > 0 || notes.some((n) => n.claims.length > 0);
    const day = ymdIn(v.startsAt, ctx.timeZone);
    const inValant = valantKey.has(`${v.clientId}|${day}`);
    if (noteState === 'No note') noNote++;
    if (noteState === 'Unsigned') unsigned++;
    if (!hasClaim) noClaim++;
    if (!hasClaim && inValant) billedValant++;
    const gap = noteState !== 'Signed' || !hasClaim;
    if (!gap) continue;
    // Billed in Valant with a signed note: nothing left to do here (listed only with show=all)
    if (!showAll && inValant && noteState === 'Signed') continue;
    rows.push({
      clientId: v.clientId, client: v.client.name, mrn: v.client.mrn ?? null, date: day, provider: v.clinicianId ? names.get(v.clinicianId) ?? 'Other' : NO_PROVIDER,
      type: v.type, note: noteState, claim: hasClaim ? 'Yes' : 'No', billedInValant: inValant ? 'Yes' : 'No',
      daysSince: Math.floor((ctx.now.getTime() - v.startsAt.getTime()) / DAY_MS),
    });
  }
  return {
    columns: [
      { key: 'date', label: 'Date of service', type: 'date' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'provider', label: 'Provider', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'claim', label: 'Altrixs claim', type: 'text' },
      { key: 'billedInValant', label: 'Billed in Valant', type: 'text' },
      { key: 'daysSince', label: 'Days since visit', type: 'days' },
    ],
    rows,
    kpis: [
      { label: 'Completed visits', value: visits.length, type: 'number' },
      { label: 'No note', value: noNote, type: 'number' },
      { label: 'Unsigned note', value: unsigned, type: 'number' },
      { label: 'No claim (not billed in Valant)', value: noClaim - billedValant, type: 'number' },
    ],
    sources: [source('Completed appointments', visits.length), source('Valant charges (same client and date)', valantCharges.length)],
    notices: [
      ...(visits.length === 0 ? ['No completed visits in this period.'] : []),
      ...(billedValant ? [`${billedValant} visit(s) without an Altrixs claim were billed in Valant${showAll ? '' : ' and are hidden unless the note is open (choose "All with a gap" to list them)'}.`] : []),
    ],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Timely filing ───────────────────────────────────────────────────────────

export async function runTimelyFiling(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const rows0 = await loadTimelyFilingQueue({ organizationId: ctx.organizationId, actorUserId: ctx.userId, actorRole: ctx.role as Role }, ctx.now);
  const locked = new Set(ctx.scope.lockedClientIds);
  const site = ctx.scope.locationId;
  const siteIds = site ? new Set((await prisma.client.findMany({ where: { AND: [ctx.clientWhere(), { id: { in: [...new Set(rows0.map((r) => r.clientId))] } }] }, select: { id: true } })).map((c) => c.id)) : null;
  const rows: ReportRow[] = rows0
    .filter((r) => !locked.has(r.clientId) && (!siteIds || siteIds.has(r.clientId)) && (!p.payer || r.payer.toLowerCase().includes(p.payer.toLowerCase())))
    .map((r) => ({ clientId: r.clientId, client: r.clientName, payer: r.payer, serviceDate: r.serviceDate, limitDays: r.limitDays, daysLeft: r.daysLeft, state: r.daysLeft < 0 ? 'Past limit' : 'Within 30 days' }));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'payer', label: 'Payer', type: 'text' },
      { key: 'serviceDate', label: 'Date of service', type: 'date' },
      { key: 'limitDays', label: 'Filing limit (days)', type: 'number' },
      { key: 'daysLeft', label: 'Days left', type: 'days' },
      { key: 'state', label: 'State', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Past the limit', value: rows.filter((r) => Number(r.daysLeft) < 0).length, type: 'number' },
      { label: 'Within 30 days', value: rows.filter((r) => Number(r.daysLeft) >= 0).length, type: 'number' },
    ],
    sources: [source('Unaccepted claims with a payer filing limit', rows0.length, ctx.now)],
    notices: rows0.length === 0 ? ['No claims near their timely filing limit, or no payer has a filing limit configured (Waystar payer mapping).'] : [],
  };
}

// ─── ERA posting exceptions ──────────────────────────────────────────────────

export async function runEraExceptions(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const onlyOpen = (p.values.status ?? 'open') === 'open';
  const [eraRows, batchLines] = await Promise.all([
    prisma.eraClaimPayment.findMany({
      where: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.toExclusive }, ...(onlyOpen ? { postingStatus: { not: 'posted' } } : {}) },
      select: { claimId: true, patientControlNumber: true, patientLabel: true, paidAmount: true, chargeAmount: true, postingStatus: true, reviewReasons: true, outcome: true, createdAt: true, remittance: { select: { payerName: true, paymentDate: true, fileName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    }),
    prisma.paymentBatchLine.findMany({
      where: { clientId: null, batch: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.toExclusive } } },
      select: { unmatchedLabel: true, paidAmount: true, dos: true, batch: { select: { payerSource: true, paymentDate: true, batchNumber: true, createdAt: true } } },
      take: 5000,
    }),
  ]);
  const claimIds = [...new Set(eraRows.map((r) => r.claimId).filter((x): x is string => Boolean(x)))];
  const claims = claimIds.length ? await prisma.claim.findMany({ where: { id: { in: claimIds } }, select: { id: true, clientId: true } }) : [];
  const clientOf = new Map(claims.map((c) => [c.id, c.clientId]));
  const locked = new Set(ctx.scope.lockedClientIds);
  const rows: ReportRow[] = [];
  for (const r of eraRows) {
    const cid = r.claimId ? clientOf.get(r.claimId) : null;
    if (cid && locked.has(cid)) continue;
    rows.push({
      kind: 'ERA claim payment', received: r.createdAt.toISOString(), payer: r.remittance.payerName ?? null, reference: r.patientControlNumber,
      patient: r.patientLabel ?? null, matched: r.claimId ? 'Yes' : 'No', paid: Math.round(Number(r.paidAmount) * 100),
      status: r.postingStatus, reasons: r.reviewReasons.join('; ') || r.outcome, daysOpen: Math.floor((ctx.now.getTime() - r.createdAt.getTime()) / DAY_MS),
    });
  }
  for (const b of batchLines) {
    rows.push({
      kind: 'Unapplied batch line', received: b.batch.createdAt.toISOString(), payer: b.batch.payerSource, reference: b.batch.batchNumber,
      patient: b.unmatchedLabel ?? null, matched: 'No', paid: Math.round(b.paidAmount * 100), status: 'unapplied', reasons: 'Not matched to a client',
      daysOpen: Math.floor((ctx.now.getTime() - b.batch.createdAt.getTime()) / DAY_MS),
    });
  }
  rows.sort((a, b) => Number(b.daysOpen) - Number(a.daysOpen));
  const sumPaid = rows.reduce((s, r) => s + Number(r.paid ?? 0), 0);
  return {
    columns: [
      { key: 'kind', label: 'Item', type: 'text' },
      { key: 'received', label: 'Received', type: 'datetime' },
      { key: 'payer', label: 'Payer', type: 'text' },
      { key: 'reference', label: 'Claim / batch reference', type: 'text' },
      { key: 'patient', label: 'Patient (as on the ERA)', type: 'text' },
      { key: 'matched', label: 'Matched to claim', type: 'text' },
      money('paid', 'Paid'),
      { key: 'status', label: 'Posting status', type: 'text' },
      { key: 'reasons', label: 'Review reasons', type: 'text' },
      { key: 'daysOpen', label: 'Days open', type: 'days' },
    ],
    rows,
    kpis: [
      { label: 'Exceptions', value: rows.length, type: 'number' },
      { label: 'Unmatched', value: rows.filter((r) => r.matched === 'No').length, type: 'number' },
      { label: 'Amount not posted', value: sumPaid, type: 'money' },
    ],
    sources: [source('ERA claim payments (835)', eraRows.length), source('Payment batch lines (unmatched)', batchLines.length)],
    notices: eraRows.length + batchLines.length === 0 ? ['No ERA posting exceptions or unapplied payments in this period.'] : [],
  };
}

// ─── Patient balances ────────────────────────────────────────────────────────

export async function runPatientBalances(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const min = p.values.min ?? '0.01';
  const credit = min === 'credit';
  const minCents = credit ? 0 : Math.round(Number(min) * 100);
  const keep = (cents: number) => (credit ? cents < 0 : cents >= minCents);
  if ((p.values.source ?? 'valant') === 'valant') {
    const [latest, labels] = await Promise.all([
      prisma.valantAgingSnapshot.findFirst({ where: { organizationId: ctx.organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }),
      getAgingLabels(ctx.organizationId),
    ]);
    const snaps = latest
      ? await prisma.valantAgingSnapshot.findMany({
          where: {
            organizationId: ctx.organizationId, asOf: latest.asOf,
            ...(ctx.scopeKind === 'caseload' || ctx.scope.locationId ? { client: ctx.clientWhere() } : ctx.scope.lockedClientIds.length ? { OR: [{ clientId: null }, { clientId: { notIn: ctx.scope.lockedClientIds } }] } : {}),
          },
          select: { valantPatientId: true, bucket1Cents: true, bucket2Cents: true, bucket3Cents: true, bucket4Cents: true, bucket5Cents: true, totalCents: true, client: { select: { id: true, name: true, mrn: true } } },
        })
      : [];
    const rows: ReportRow[] = snaps.filter((s) => keep(s.totalCents)).map((s) => {
      const b = presentAgingBuckets([s.bucket1Cents, s.bucket2Cents, s.bucket3Cents, s.bucket4Cents, s.bucket5Cents], s.totalCents, labels.displayAllOver120).displayBucketsCents;
      return { clientId: s.client?.id ?? null, client: s.client?.name ?? 'Not matched to a chart', mrn: s.client?.mrn ?? null, valantId: s.valantPatientId, b1: b[0], b2: b[1], b3: b[2], b4: b[3], b5: b[4], total: s.totalCents };
    }).sort((a, b) => Number(b.total) - Number(a.total));
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    return {
      columns: [
        { key: 'client', label: 'Client', type: 'text' },
        { key: 'mrn', label: 'MRN', type: 'text' },
        { key: 'valantId', label: 'Valant patient id', type: 'text' },
        ...labels.labels.slice(0, 5).map((l, i) => money(`b${i + 1}`, l)),
        money('total', 'Total'),
      ],
      rows,
      kpis: [{ label: 'Patients listed', value: rows.length, type: 'number' }, { label: 'Total', value: total, type: 'money' }],
      sources: [source('Valant patient aging (latest import)', snaps.length, latest?.asOf ?? null)],
      notices: [
        ...(!latest ? ['No Valant patient aging report has been imported.'] : []),
        ...(labels.displayAllOver120 && snaps.length ? ['Practice setting: every Valant balance is shown in the oldest bucket (Over 120).'] : []),
      ],
      asOf: latest?.asOf.toISOString() ?? null,
    };
  }
  const where = { AND: [ctx.clientWhere()] };
  const [withEntries, withClaims, withPayments] = await Promise.all([
    prisma.patientLedgerEntry.groupBy({ by: ['clientId'], where: { organizationId: ctx.organizationId, supersededAt: null, client: where } }),
    prisma.claim.groupBy({ by: ['clientId'], where: { organizationId: ctx.organizationId, client: where, patientResponsibility: { gt: 0 } } }),
    prisma.payment.groupBy({ by: ['clientId'], where: { organizationId: ctx.organizationId, client: where, method: { not: 'INSURANCE' } } }),
  ]);
  const ids = [...new Set([...withEntries, ...withClaims, ...withPayments].map((g) => g.clientId))];
  const balances = await patientBalances(ctx.organizationId, ids);
  const people = ids.length ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, mrn: true } }) : [];
  const byId = new Map(people.map((x) => [x.id, x]));
  const rows: ReportRow[] = [];
  for (const id of ids) {
    const b = balances.get(id);
    if (!b || !keep(b.balanceCents)) continue;
    rows.push({
      clientId: id, client: byId.get(id)?.name ?? '—', mrn: byId.get(id)?.mrn ?? null, balance: b.balanceCents, opening: b.openingBalanceCents,
      openingAsOf: b.openingBalanceAsOf ? b.openingBalanceAsOf.slice(0, 10) : null, prepayment: b.prepaymentCreditCents, claimsPatient: b.claimsPatientCents, payments: b.patientPaymentsCents,
    });
  }
  rows.sort((a, b) => Number(b.balance) - Number(a.balance));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      money('balance', 'Balance'),
      money('opening', 'Valant opening balance'),
      { key: 'openingAsOf', label: 'Opening as of', type: 'date' },
      money('prepayment', 'Prepayment credit'),
      money('claimsPatient', 'Patient responsibility (claims)'),
      money('payments', 'Patient payments'),
    ],
    rows,
    kpis: [{ label: 'Patients listed', value: rows.length, type: 'number' }, { label: 'Total', value: rows.reduce((s, r) => s + Number(r.balance), 0), type: 'money' }],
    sources: [source('Patient ledger / claims / payments', ids.length, ctx.now)],
    notices: [
      ...(ids.length === 0 ? ['No patient balances in Altrixs yet (no ledger postings, patient responsibility or patient payments).'] : []),
      'Altrixs balances are current totals; individual charges are not aged.',
    ],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Prior authorization utilization ─────────────────────────────────────────

export async function runPriorAuth(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const show = p.values.status ?? 'attention';
  const auths = await prisma.priorAuth.findMany({
    where: {
      organizationId: ctx.organizationId,
      client: ctx.clientWhere(),
      ...(p.payer ? { payer: { contains: p.payer, mode: 'insensitive' } } : {}),
      ...(show === 'all' ? {} : { status: 'APPROVED', OR: [{ endDate: null }, { endDate: { gte: new Date(ctx.now.getTime() - DAY_MS) } }] }),
    },
    select: { payer: true, authNumber: true, status: true, startDate: true, endDate: true, unitsApproved: true, unitsUsed: true, client: { select: { id: true, name: true, mrn: true } } },
  });
  let expiring = 0;
  let nearly = 0;
  const rows: ReportRow[] = [];
  for (const a of auths) {
    const remaining = a.unitsApproved - a.unitsUsed;
    const usedPct = pct(a.unitsUsed, a.unitsApproved);
    const daysToEnd = a.endDate ? Math.floor((a.endDate.getTime() - ctx.now.getTime()) / DAY_MS) : null;
    const isExpiring = a.status === 'APPROVED' && daysToEnd != null && daysToEnd >= 0 && daysToEnd <= 30;
    const isNearly = a.status === 'APPROVED' && usedPct != null && usedPct >= 80;
    if (isExpiring) expiring++;
    if (isNearly) nearly++;
    if (show === 'attention' && !isExpiring && !isNearly) continue;
    rows.push({
      clientId: a.client.id, client: a.client.name, mrn: a.client.mrn ?? null, payer: a.payer, authNumber: a.authNumber ?? null, status: a.status,
      start: dateOnly(a.startDate), end: dateOnly(a.endDate), approved: a.unitsApproved, used: a.unitsUsed, remaining, usedPct, daysToEnd,
      flag: [isExpiring ? 'Expiring' : null, isNearly ? 'Nearly used' : null, remaining < 0 ? 'Over approved units' : null].filter(Boolean).join(', ') || null,
    });
  }
  rows.sort((a, b) => Number(a.daysToEnd ?? 1e9) - Number(b.daysToEnd ?? 1e9));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' }, { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'payer', label: 'Payer', type: 'text' }, { key: 'authNumber', label: 'Auth #', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
      { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' },
      { key: 'approved', label: 'Approved', type: 'number' }, { key: 'used', label: 'Used', type: 'number' }, { key: 'remaining', label: 'Remaining', type: 'number' },
      { key: 'usedPct', label: '% used', type: 'percent' }, { key: 'daysToEnd', label: 'Days to end', type: 'days' }, { key: 'flag', label: 'Flag', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Authorizations', value: auths.length, type: 'number' },
      { label: 'Expiring in 30 days', value: expiring, type: 'number' },
      { label: '80% or more used', value: nearly, type: 'number' },
    ],
    sources: [source('Prior authorizations', auths.length, ctx.now)],
    notices: auths.length === 0 ? ['No prior authorizations match these parameters.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Payer mix ───────────────────────────────────────────────────────────────

export async function runPayerMix(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const basis = p.values.source ?? 'clients';
  if (basis === 'clients') {
    const g = await prisma.client.groupBy({ by: ['insurancePayer'], where: { AND: [ctx.clientWhere(), { status: 'ACTIVE' }] }, _count: { _all: true } });
    const map = new Map<string, { group: string; clients: number }>();
    for (const r of g) {
      const label = r.insurancePayer?.trim() || 'No insurance on chart';
      const x = map.get(label.toLowerCase()) ?? { group: label, clients: 0 };
      x.clients += r._count._all;
      map.set(label.toLowerCase(), x);
    }
    const total = [...map.values()].reduce((s, r) => s + r.clients, 0);
    const rows: ReportRow[] = [...map.values()].sort((a, b) => b.clients - a.clients).map((r) => ({ ...r, share: pct(r.clients, total) }));
    return {
      columns: [{ key: 'group', label: 'Payer (chart primary insurance)', type: 'text' }, { key: 'clients', label: 'Active clients', type: 'number' }, { key: 'share', label: 'Share', type: 'percent' }],
      rows,
      kpis: [{ label: 'Active clients', value: total, type: 'number' }, { label: 'Payers', value: rows.length, type: 'number' }],
      chart: { type: 'bar', xKey: 'group', series: [{ key: 'clients', label: 'Clients' }], data: rows.slice(0, 12) },
      sources: [source('Client insurance (active)', total, ctx.now)],
      notices: total === 0 ? ['No active clients in scope.'] : [],
      hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
    };
  }
  const range = requireRange(p);
  if (basis === 'valant') {
    const v = await valantMoneyBy(ctx, range, null, 'payer');
    const totalCharges = v.total.chargesCents;
    const rows: ReportRow[] = v.rows.map((r) => ({ group: r.label, charges: r.chargesCents, share: pct(r.chargesCents, totalCharges), payments: r.insurancePaymentsCents + r.patientPaymentsCents }));
    return {
      columns: [{ key: 'group', label: 'Payer (first on Valant row)', type: 'text' }, money('charges', 'Charges'), { key: 'share', label: 'Share of charges', type: 'percent' }, money('payments', 'Payments')],
      rows,
      kpis: [{ label: 'Charges', value: totalCharges, type: 'money' }, { label: 'Payers', value: rows.length, type: 'number' }],
      chart: { type: 'bar', xKey: 'group', valueType: 'money', series: [{ key: 'charges', label: 'Charges' }], data: rows.slice(0, 12) },
      sources: [source('Valant transactions (imported)', v.total.rows, v.importedAt)],
      notices: v.orgRows === 0 ? ['No Valant transactions have been imported.'] : [],
      asOf: v.importedAt?.toISOString() ?? null,
    };
  }
  const g = await prisma.claim.groupBy({ by: ['payer'], where: { ...claimScope(ctx, null), status: { not: 'DRAFT' }, createdAt: { gte: range.from, lt: range.toExclusive } }, _count: { _all: true }, _sum: { amountCents: true } });
  const total = g.reduce((s, r) => s + (r._sum.amountCents ?? 0), 0);
  const rows: ReportRow[] = g.map((r) => ({ group: r.payer?.trim() || UNSPECIFIED, claims: r._count._all, charges: r._sum.amountCents ?? 0, share: pct(r._sum.amountCents ?? 0, total) })).sort((a, b) => Number(b.charges) - Number(a.charges));
  return {
    columns: [{ key: 'group', label: 'Payer', type: 'text' }, { key: 'claims', label: 'Claims', type: 'number' }, money('charges', 'Billed'), { key: 'share', label: 'Share', type: 'percent' }],
    rows,
    kpis: [{ label: 'Billed', value: total, type: 'money' }, { label: 'Claims', value: g.reduce((s, r) => s + r._count._all, 0), type: 'number' }],
    chart: { type: 'bar', xKey: 'group', valueType: 'money', series: [{ key: 'charges', label: 'Billed' }], data: rows.slice(0, 12) },
    sources: [source('Claims (Altrixs)', g.reduce((s, r) => s + r._count._all, 0))],
    notices: g.length === 0 ? ['No Altrixs claims in this period.'] : [],
  };
}


// ─── AutoPay charges ─────────────────────────────────────────────────────────

/**
 * Automatic patient card charges by month (practice time, by charge date): paid, failed / needing the
 * patient, refunded. Amounts in cents; "Collected" = paid minus refunded. PatientCharge
 * (20261021_patient_autopay); a missing table reads as no data.
 */
export async function runAutopayCharges(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const f = await ctx.clientIdFilter();
  const clientCond: Prisma.PatientChargeWhereInput = !f ? {} : 'in' in f ? { clientId: { in: f.in } } : { clientId: { notIn: f.notIn } };
  const rows = await prisma.patientCharge
    .findMany({
      where: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.toExclusive }, ...clientCond },
      select: { status: true, amountCents: true, refundedCents: true, createdAt: true, livemode: true },
      take: 20000,
    })
    .catch(() => [] as { status: string; amountCents: number; refundedCents: number; createdAt: Date; livemode: boolean }[]);
  type M = { month: string; label: string; succeeded: number; succeededCents: number; failed: number; failedCents: number; needsAction: number; held: number; refunded: number; refundedCents: number; collectedCents: number };
  const byMonth = new Map<string, M>();
  for (const r of rows) {
    const key = monthIn(r.createdAt, ctx.timeZone);
    const m = byMonth.get(key) ?? { month: key, label: monthLabel(key), succeeded: 0, succeededCents: 0, failed: 0, failedCents: 0, needsAction: 0, held: 0, refunded: 0, refundedCents: 0, collectedCents: 0 };
    if (r.status === 'succeeded' || r.status === 'refunded' || r.status === 'partially_refunded') {
      m.succeeded += 1;
      m.succeededCents += r.amountCents;
      m.collectedCents += r.amountCents - r.refundedCents;
    }
    if (r.refundedCents > 0) {
      m.refunded += 1;
      m.refundedCents += r.refundedCents;
    }
    if (r.status === 'failed') {
      m.failed += 1;
      m.failedCents += r.amountCents;
    }
    if (r.status === 'needs_action') m.needsAction += 1;
    if (r.status === 'held') m.held += 1;
    byMonth.set(key, m);
  }
  const out = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const sum = (k: keyof M) => out.reduce((s, r) => s + Number(r[k]), 0);
  const test = rows.filter((r) => !r.livemode).length;
  return {
    columns: [
      { key: 'label', label: 'Month', type: 'text' },
      { key: 'succeeded', label: 'Paid', type: 'number' },
      money('succeededCents', 'Paid amount'),
      { key: 'failed', label: 'Failed', type: 'number' },
      money('failedCents', 'Failed amount'),
      { key: 'needsAction', label: 'Needs patient action', type: 'number' },
      { key: 'held', label: 'Held for review', type: 'number' },
      { key: 'refunded', label: 'Refunded', type: 'number' },
      money('refundedCents', 'Refunded amount'),
      money('collectedCents', 'Collected', 'Paid amount minus refunds'),
    ],
    rows: out.map(({ month: _m, ...r }) => r),
    kpis: [
      { label: 'Collected', value: sum('collectedCents'), type: 'money' },
      { label: 'Paid charges', value: sum('succeeded'), type: 'number' },
      { label: 'Failed', value: sum('failed'), type: 'number' },
      { label: 'Refunded', value: sum('refundedCents'), type: 'money' },
    ],
    chart: { type: 'stackedBar', xKey: 'label', series: [{ key: 'succeeded', label: 'Paid' }, { key: 'failed', label: 'Failed' }, { key: 'refunded', label: 'Refunded' }], valueType: 'number' },
    sources: [source('AutoPay charges (PatientCharge)', rows.length)],
    notices: [
      ...(rows.length === 0 ? ['No automatic card charges in this period.'] : []),
      ...(test > 0 ? [`${test} of these charges ran in Stripe TEST mode (no real money).`] : []),
    ],
  };
}
