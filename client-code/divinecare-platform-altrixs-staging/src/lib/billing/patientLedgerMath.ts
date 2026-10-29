/**
 * Patient ledger: pure balance math and Valant posting plans (no database access, unit tested).
 *
 * Patient balance = active ledger entries (Valant opening balance, Valant prepayment credit, adjustments)
 *                 + patient responsibility on Altrixs claims
 *                 - patient payments (every Payment that is not INSURANCE, with or without a claim).
 * Money is integer cents. Positive = patient owes; negative = credit on account.
 *
 * Owner decisions 2026-10-17: Valant patient opening balances and prepayment credits are posted; insurance
 * A/R is a Valant run-out and is never posted (no claims, no insurance balances). Re-posting REPLACES.
 */

import { PAYER_LIST } from '@/lib/constants/payers';

export const LEDGER_KINDS = ['opening_balance', 'prepayment_credit', 'manual_adjustment'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
/** Kinds the Valant posting tools write (manual_adjustment is reserved) */
export const VALANT_POSTED_KINDS = ['opening_balance', 'prepayment_credit'] as const satisfies readonly LedgerKind[];
export type ValantPostedKind = (typeof VALANT_POSTED_KINDS)[number];
export const VALANT_SOURCE = 'valant';

export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  opening_balance: 'Valant opening balance',
  prepayment_credit: 'Valant prepayment credit',
  manual_adjustment: 'Adjustment',
};

export const REPLACE_WARNING = 'This replaces any earlier Valant opening balances';
export const REPLACE_WARNING_PREPAYMENT = 'This replaces any earlier Valant prepayment credits';

/** Billing + leadership. Front desk / office manager can take payments but not post opening balances
 * (Office Manager removed 2026-10-22, owner: patient-side billing only). */
const VALANT_POSTING_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'] as const;

/** Who can post / unpost Valant opening balances (cutover import): billing core. Not a
 * write-off path: adjustments, payment plans and payer batches stay canMutateLedger (billing core only). */
export function canPostValantLedger(role: string | null | undefined): boolean {
  return Boolean(role && (VALANT_POSTING_ROLES as readonly string[]).includes(role));
}

// ---------------------------------------------------------------------------------------------
// Balance

export type LedgerEntryLite = {
  id: string;
  clientId: string;
  kind: string;
  source: string;
  amountCents: number;
  asOf: Date | string;
  supersededAt: Date | string | null;
};

export type ClaimLite = {
  id: string;
  status: string;
  payer: string | null;
  amountCents: number | null;
  /** ERA patient responsibility in dollars (Claim.patientResponsibility is a Float) */
  patientResponsibility: number | null;
  frequencyCode?: string | null;
};

export type PaymentLite = { amountCents: number; method: string; claimId?: string | null };

const SELF_PAY_KEYS = new Set(
  PAYER_LIST.filter((p) => p.group === 'Self-Pay').flatMap((p) => [p.id, p.label]).map((v) => v.toLowerCase())
);

/** Blank payer is self-pay (same rule as the billing overview); so are the Self-Pay payer list entries */
export function isSelfPayPayer(payer: string | null | undefined): boolean {
  const p = String(payer ?? '').trim().toLowerCase();
  if (!p) return true;
  return SELF_PAY_KEYS.has(p) || /^self[\s-]?pay\b/.test(p);
}

/**
 * Patient portion of one Altrixs claim, in cents.
 * - Draft and void (frequency 8) claims: 0.
 * - A claim that a secondary claim was billed from: 0 here (the secondary carries what the patient owes).
 * - ERA posted (patientResponsibility set): that amount.
 * - Self-pay claim with no ERA: the billed amount.
 * - Insurance claim awaiting adjudication: 0 (it is insurance A/R, not patient balance).
 */
export function claimPatientPortionCents(claim: ClaimLite, billedOnToSecondary = false): number {
  if (claim.status === 'DRAFT' || claim.frequencyCode === '8' || billedOnToSecondary) return 0;
  if (claim.patientResponsibility != null) return Math.max(0, Math.round(claim.patientResponsibility * 100));
  if (isSelfPayPayer(claim.payer)) return Math.max(0, claim.amountCents ?? 0);
  return 0;
}

export function isPatientPayment(p: Pick<PaymentLite, 'method'>): boolean {
  return p.method !== 'INSURANCE';
}

export function isActive(e: Pick<LedgerEntryLite, 'supersededAt'>): boolean {
  return e.supersededAt == null;
}

const iso = (d: Date | string | null | undefined) => (d == null ? null : (typeof d === 'string' ? d : d.toISOString()).slice(0, 10));

export type PatientBalanceBreakdown = {
  balanceCents: number;
  openingBalanceCents: number;
  openingBalanceAsOf: string | null;
  prepaymentCreditCents: number;
  prepaymentAsOf: string | null;
  adjustmentsCents: number;
  claimsPatientCents: number;
  claimCount: number;
  patientPaymentsCents: number;
  paymentCount: number;
};

export function computePatientBalance(input: {
  entries: readonly LedgerEntryLite[];
  claims: readonly ClaimLite[];
  payments: readonly PaymentLite[];
  /** Ids of claims a secondary claim was billed from (see claimPatientPortionCents) */
  billedOnToSecondary?: ReadonlySet<string>;
}): PatientBalanceBreakdown {
  let openingBalanceCents = 0;
  let openingBalanceAsOf: string | null = null;
  let prepaymentCreditCents = 0;
  let prepaymentAsOf: string | null = null;
  let adjustmentsCents = 0;
  for (const e of input.entries) {
    if (!isActive(e)) continue;
    if (e.kind === 'opening_balance') {
      openingBalanceCents += e.amountCents;
      openingBalanceAsOf = iso(e.asOf);
    } else if (e.kind === 'prepayment_credit') {
      prepaymentCreditCents += e.amountCents;
      prepaymentAsOf = iso(e.asOf);
    } else {
      adjustmentsCents += e.amountCents;
    }
  }
  let claimsPatientCents = 0;
  let claimCount = 0;
  for (const c of input.claims) {
    const cents = claimPatientPortionCents(c, input.billedOnToSecondary?.has(c.id) ?? false);
    if (cents) {
      claimsPatientCents += cents;
      claimCount += 1;
    }
  }
  const patient = input.payments.filter(isPatientPayment);
  const patientPaymentsCents = patient.reduce((s, p) => s + p.amountCents, 0);
  return {
    balanceCents: openingBalanceCents + prepaymentCreditCents + adjustmentsCents + claimsPatientCents - patientPaymentsCents,
    openingBalanceCents,
    openingBalanceAsOf,
    prepaymentCreditCents,
    prepaymentAsOf,
    adjustmentsCents,
    claimsPatientCents,
    claimCount,
    patientPaymentsCents,
    paymentCount: patient.length,
  };
}

/** Statement lines saved with the statement (metaJson.lines) so the amount can be explained later */
export type StatementLines = {
  openingBalanceCents: number;
  openingBalanceAsOf: string | null;
  prepaymentCreditCents: number;
  claimsPatientCents: number;
  patientPaymentsCents: number;
  adjustmentsCents: number;
};

const usd = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Human-readable statement lines (email body and the statements page) */
export function statementLineText(l: StatementLines | null): string[] {
  if (!l) return [];
  const out: string[] = [];
  if (l.openingBalanceCents) out.push(`Previous balance (Valant${l.openingBalanceAsOf ? `, as of ${l.openingBalanceAsOf}` : ''}): ${usd(l.openingBalanceCents)}`);
  if (l.prepaymentCreditCents) out.push(`Prepayment credit: ${usd(l.prepaymentCreditCents)}`);
  if (l.claimsPatientCents) out.push(`Visits (patient responsibility): ${usd(l.claimsPatientCents)}`);
  if (l.adjustmentsCents) out.push(`Adjustments: ${usd(l.adjustmentsCents)}`);
  if (l.patientPaymentsCents) out.push(`Payments received: -${usd(l.patientPaymentsCents)}`);
  return out;
}

/**
 * Autopay amount for a plan: "Balance or $X" (upToBalance) charges the lower of the two; a fixed plan
 * charges its amount. Never charges when the patient owes nothing.
 */
export function autopayChargeCents(plan: { amountCents: number | null; upToBalance: boolean } | null, balanceCents: number, fallbackCents: number): number {
  const amount = plan?.amountCents ?? fallbackCents;
  if (plan?.upToBalance) return Math.max(0, Math.min(amount, balanceCents));
  return Math.max(0, amount);
}

// ---------------------------------------------------------------------------------------------
// Posting plans (dry run). The same plan is recomputed inside the posting transaction.

export type PlannedEntry = { clientId: string; amountCents: number; detail: string };
export type PlanDiff = { clientId: string; beforeCents: number | null; afterCents: number | null };

export type PostingPlan = {
  kind: ValantPostedKind;
  asOf: string | null;
  postings: PlannedEntry[];
  /** Active entries of this kind/source that will be superseded (all of them: posting replaces the set) */
  supersede: { id: string; clientId: string; amountCents: number }[];
  counts: { post: number; replace: number; unchanged: number; added: number; removed: number; excluded: number };
  totals: { postCents: number; previousActiveCents: number; changeCents: number };
  diffs: PlanDiff[];
};

function finishPlan(kind: ValantPostedKind, asOf: string | null, postings: PlannedEntry[], active: readonly LedgerEntryLite[], excluded: number): PostingPlan {
  const current = active.filter((e) => isActive(e) && e.kind === kind && e.source === VALANT_SOURCE);
  const before = new Map<string, number>();
  for (const e of current) before.set(e.clientId, (before.get(e.clientId) ?? 0) + e.amountCents);
  const after = new Map(postings.map((p) => [p.clientId, p.amountCents]));
  const diffs: PlanDiff[] = [];
  let replace = 0;
  let unchanged = 0;
  let added = 0;
  for (const [clientId, a] of after) {
    const b = before.get(clientId);
    if (b === undefined) {
      added += 1;
      diffs.push({ clientId, beforeCents: null, afterCents: a });
    } else {
      replace += 1;
      if (b === a) unchanged += 1;
      else diffs.push({ clientId, beforeCents: b, afterCents: a });
    }
  }
  let removed = 0;
  for (const [clientId, b] of before) {
    if (!after.has(clientId)) {
      removed += 1;
      diffs.push({ clientId, beforeCents: b, afterCents: null });
    }
  }
  const postCents = postings.reduce((s, p) => s + p.amountCents, 0);
  const previousActiveCents = current.reduce((s, e) => s + e.amountCents, 0);
  return {
    kind,
    asOf,
    postings,
    supersede: current.map((e) => ({ id: e.id, clientId: e.clientId, amountCents: e.amountCents })),
    counts: { post: postings.length, replace, unchanged, added, removed, excluded },
    totals: { postCents, previousActiveCents, changeCents: postCents - previousActiveCents },
    diffs,
  };
}

export type AgingRowLite = { clientId: string | null; valantPatientId: string; totalCents: number };

export type OpeningBalancePlan = PostingPlan & {
  reconciliation: {
    snapshotRows: number;
    snapshotTotalCents: number;
    matchedRows: number;
    matchedTotalCents: number;
    unmatchedRows: number;
    unmatchedTotalCents: number;
    /** posted total = snapshot total of matched rows */
    reconciles: boolean;
  };
  unmatched: { valantPatientId: string; totalCents: number }[];
  /** Matched patients whose Valant total is 0 (nothing posted; an earlier posting is still replaced) */
  zero: string[];
};

/**
 * One opening_balance per matched client = their Valant Patient Aging total on the current snapshot
 * (sign kept: negative = credit). Several Valant IDs matched to one client are added together.
 */
export function planOpeningBalances(rows: readonly AgingRowLite[], asOf: string | null, active: readonly LedgerEntryLite[]): OpeningBalancePlan {
  const byClient = new Map<string, { cents: number; ids: string[] }>();
  const unmatched: { valantPatientId: string; totalCents: number }[] = [];
  let snapshotTotalCents = 0;
  let matchedTotalCents = 0;
  let matchedRows = 0;
  for (const r of rows) {
    snapshotTotalCents += r.totalCents;
    if (!r.clientId) {
      unmatched.push({ valantPatientId: r.valantPatientId, totalCents: r.totalCents });
      continue;
    }
    matchedRows += 1;
    matchedTotalCents += r.totalCents;
    const c = byClient.get(r.clientId) ?? { cents: 0, ids: [] };
    c.cents += r.totalCents;
    c.ids.push(r.valantPatientId);
    byClient.set(r.clientId, c);
  }
  const postings: PlannedEntry[] = [];
  const zero: string[] = [];
  for (const [clientId, c] of byClient) {
    if (c.cents === 0) zero.push(clientId);
    else postings.push({ clientId, amountCents: c.cents, detail: `Valant ID ${c.ids.join(', ')}` });
  }
  postings.sort((a, b) => a.clientId.localeCompare(b.clientId));
  const plan = finishPlan('opening_balance', asOf, postings, active, unmatched.length);
  const unmatchedTotalCents = unmatched.reduce((s, u) => s + u.totalCents, 0);
  return {
    ...plan,
    reconciliation: {
      snapshotRows: rows.length,
      snapshotTotalCents,
      matchedRows,
      matchedTotalCents,
      unmatchedRows: unmatched.length,
      unmatchedTotalCents,
      reconciles: plan.totals.postCents === matchedTotalCents && matchedTotalCents + unmatchedTotalCents === snapshotTotalCents,
    },
    unmatched,
    zero,
  };
}

export type PrepaymentTxnLite = {
  clientId: string | null;
  valantName: string;
  date: Date | string;
  amountCents: number;
  periodStart: Date | string;
};

export type PrepaymentExclusionReason = 'unmatched' | 'negative_net' | 'pre_period' | 'zero_net';

export const PREPAYMENT_EXCLUSION_LABEL: Record<PrepaymentExclusionReason, string> = {
  unmatched: 'Not matched to a patient',
  negative_net: 'Incomplete: net below zero (prepayments received before the report start are missing)',
  pre_period: 'Incomplete: applied prepayment received before the report start',
  zero_net: 'Nothing remaining (net $0.00)',
};

export type PrepaymentCreditPlan = PostingPlan & {
  periodStart: string | null;
  periodEnd: string | null;
  excluded: { clientId: string | null; valantName: string; netCents: number; reason: PrepaymentExclusionReason }[];
  reconciliation: {
    transactions: number;
    allRowsNetCents: number;
    /** -(sum of posted credits) = net of the clients posted */
    postedNetCents: number;
    excludedNetCents: number;
    reconciles: boolean;
  };
};

/**
 * One prepayment_credit per matched client whose prepayment net is POSITIVE and complete = -net.
 * Incomplete (the export is limited to a period, so earlier receipts are missing):
 *  - net below zero, or
 *  - running balance (date order) dips below zero at any point: money received before the period
 *    start was applied, so the true remaining credit is unknown, or
 *  - any transaction dated before the period start.
 * Unmatched names, incomplete and zero-net clients are listed and not posted.
 */
export function planPrepaymentCredits(
  txns: readonly PrepaymentTxnLite[],
  period: { periodStart: string | null; periodEnd: string | null },
  active: readonly LedgerEntryLite[]
): PrepaymentCreditPlan {
  const time = (d: Date | string) => (typeof d === 'string' ? Date.parse(d) : d.getTime());
  const sorted = [...txns].sort((a, b) => time(a.date) - time(b.date) || b.amountCents - a.amountCents);
  type Acc = { name: string; net: number; min: number; prePeriod: boolean };
  const clients = new Map<string, Acc>();
  const unmatched = new Map<string, { name: string; net: number }>();
  let allRowsNetCents = 0;
  for (const t of sorted) {
    allRowsNetCents += t.amountCents;
    if (!t.clientId) {
      const key = t.valantName.trim().toLowerCase();
      const u = unmatched.get(key) ?? { name: t.valantName, net: 0 };
      u.net += t.amountCents;
      unmatched.set(key, u);
      continue;
    }
    const a = clients.get(t.clientId) ?? { name: t.valantName, net: 0, min: 0, prePeriod: false };
    a.net += t.amountCents;
    a.min = Math.min(a.min, a.net);
    if (time(t.date) < time(t.periodStart)) a.prePeriod = true;
    clients.set(t.clientId, a);
  }
  const postings: PlannedEntry[] = [];
  const excluded: PrepaymentCreditPlan['excluded'] = [];
  for (const [clientId, a] of clients) {
    let reason: PrepaymentExclusionReason | null = null;
    if (a.net < 0) reason = 'negative_net';
    else if (a.min < 0 || a.prePeriod) reason = 'pre_period';
    else if (a.net === 0) reason = 'zero_net';
    if (reason) excluded.push({ clientId, valantName: a.name, netCents: a.net, reason });
    else postings.push({ clientId, amountCents: -a.net, detail: `Valant prepayments ${period.periodStart ?? '?'} to ${period.periodEnd ?? '?'}` });
  }
  for (const u of unmatched.values()) excluded.push({ clientId: null, valantName: u.name, netCents: u.net, reason: 'unmatched' });
  postings.sort((a, b) => a.clientId.localeCompare(b.clientId));
  excluded.sort((a, b) => a.reason.localeCompare(b.reason) || a.valantName.localeCompare(b.valantName));
  const plan = finishPlan('prepayment_credit', period.periodEnd, postings, active, excluded.length);
  const postedNetCents = -plan.totals.postCents;
  const excludedNetCents = excluded.reduce((s, e) => s + e.netCents, 0);
  return {
    ...plan,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    excluded,
    reconciliation: {
      transactions: txns.length,
      allRowsNetCents,
      postedNetCents,
      excludedNetCents,
      reconciles: postedNetCents + excludedNetCents === allRowsNetCents,
    },
  };
}

/** What a posting writes: every active entry of the kind is superseded; each planned entry is inserted. */
export type PostingWrite = {
  supersede: { id: string; replacedById: string | null }[];
  insert: (PlannedEntry & { id: string })[];
};

export function postingWrites(plan: Pick<PostingPlan, 'postings' | 'supersede'>, newId: () => string): PostingWrite {
  const insert = plan.postings.map((p) => ({ ...p, id: newId() }));
  const byClient = new Map(insert.map((i) => [i.clientId, i.id]));
  return {
    insert,
    supersede: plan.supersede.map((s) => ({ id: s.id, replacedById: byClient.get(s.clientId) ?? null })),
  };
}

/** Apply a PostingWrite to an in-memory list (used by tests and as the reference for the SQL path) */
export function applyPostingWrites<T extends LedgerEntryLite & { supersededById?: string | null }>(
  entries: readonly T[],
  write: PostingWrite,
  kind: ValantPostedKind,
  asOf: string,
  now: Date,
  make: (row: LedgerEntryLite & { supersededById: string | null }) => T
): T[] {
  const sup = new Map(write.supersede.map((s) => [s.id, s.replacedById]));
  const next = entries.map((e) => (sup.has(e.id) && isActive(e) ? { ...e, supersededAt: now, supersededById: sup.get(e.id) ?? null } : e));
  for (const i of write.insert) {
    next.push(make({ id: i.id, clientId: i.clientId, kind, source: VALANT_SOURCE, amountCents: i.amountCents, asOf, supersededAt: null, supersededById: null }));
  }
  return next;
}

/** Unpost: supersede every active Valant entry (optionally one kind), no replacement */
export function unpostWrites(active: readonly LedgerEntryLite[], kind?: ValantPostedKind): PostingWrite {
  return {
    insert: [],
    supersede: active
      .filter((e) => isActive(e) && e.source === VALANT_SOURCE && (!kind || e.kind === kind))
      .map((e) => ({ id: e.id, replacedById: null })),
  };
}
