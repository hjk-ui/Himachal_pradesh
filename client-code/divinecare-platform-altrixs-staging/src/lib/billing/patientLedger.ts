import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isoDate } from '@/lib/migration/valantReportCommon';
import {
  LEDGER_KIND_LABEL,
  VALANT_POSTED_KINDS,
  VALANT_SOURCE,
  computePatientBalance,
  planOpeningBalances,
  planPrepaymentCredits,
  postingWrites,
  unpostWrites,
  type LedgerKind,
  type OpeningBalancePlan,
  type PatientBalanceBreakdown,
  type PostingPlan,
  type PostingWrite,
  type PrepaymentCreditPlan,
  type ValantPostedKind,
} from '@/lib/billing/patientLedgerMath';

export * from '@/lib/billing/patientLedgerMath';

/**
 * Patient ledger (database side). patientBalance() is the single source of truth for what a patient
 * owes: statements, autopay, the client chart and the payments history all read it.
 * Valant postings: see patientLedgerMath.ts for the rules and prisma/schema.prisma PatientLedgerEntry.
 */

type Db = Prisma.TransactionClient | typeof prisma;

function isMissingTable(err: unknown) {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

const entrySelect = {
  id: true, clientId: true, kind: true, source: true, amountCents: true, asOf: true, supersededAt: true,
} as const;

async function activeEntries(db: Db, organizationId: string, where: Prisma.PatientLedgerEntryWhereInput = {}) {
  try {
    return await db.patientLedgerEntry.findMany({ where: { organizationId, supersededAt: null, ...where }, select: entrySelect });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Patient balances for many clients in one pass (statements, autopay). Missing clients = 0. */
export async function patientBalances(organizationId: string, clientIds: readonly string[]): Promise<Map<string, PatientBalanceBreakdown>> {
  const ids = [...new Set(clientIds)];
  const out = new Map<string, PatientBalanceBreakdown>();
  if (!ids.length) return out;
  const [entries, claims, payments] = await Promise.all([
    activeEntries(prisma, organizationId, { clientId: { in: ids } }),
    prisma.claim.findMany({
      where: { organizationId, clientId: { in: ids } },
      select: { id: true, clientId: true, status: true, payer: true, amountCents: true, patientResponsibility: true, frequencyCode: true, primaryClaimId: true },
    }),
    prisma.payment.findMany({
      where: { organizationId, clientId: { in: ids } },
      select: { clientId: true, amountCents: true, method: true, claimId: true },
    }),
  ]);
  const billedOnToSecondary = new Set(
    claims.filter((c) => c.primaryClaimId && c.status !== 'DRAFT' && c.frequencyCode !== '8').map((c) => c.primaryClaimId as string)
  );
  const group = <T extends { clientId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
    return m;
  };
  const e = group(entries);
  const c = group(claims);
  const p = group(payments);
  for (const id of ids) {
    out.set(id, computePatientBalance({ entries: e.get(id) ?? [], claims: c.get(id) ?? [], payments: p.get(id) ?? [], billedOnToSecondary }));
  }
  return out;
}

/** What one patient owes (positive) or has on credit (negative), with the breakdown */
export async function patientBalance(organizationId: string, clientId: string): Promise<PatientBalanceBreakdown> {
  const m = await patientBalances(organizationId, [clientId]);
  return m.get(clientId) as PatientBalanceBreakdown;
}

export type LedgerEntryItem = {
  id: string;
  clientId: string;
  clientName: string;
  kind: LedgerKind;
  label: string;
  amountCents: number;
  asOf: string | null;
  source: string;
  sourceRef: string | null;
  note: string | null;
  postedAt: string;
  postedById: string | null;
  supersededAt: string | null;
  supersededById: string | null;
};

/** Ledger entries for the payments history (active only) or one client's chart (with history) */
export async function listLedgerEntries(
  organizationId: string,
  opts: { clientId?: string; clientWhere?: Prisma.ClientWhereInput; includeSuperseded?: boolean; take?: number } = {}
): Promise<{ schemaReady: boolean; entries: LedgerEntryItem[] }> {
  try {
    const rows = await prisma.patientLedgerEntry.findMany({
      where: {
        organizationId,
        ...(opts.clientId ? { clientId: opts.clientId } : {}),
        ...(opts.includeSuperseded ? {} : { supersededAt: null }),
        ...(opts.clientWhere ? { client: opts.clientWhere } : {}),
      },
      include: { client: { select: { name: true } } },
      orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
      take: opts.take ?? 500,
    });
    return {
      schemaReady: true,
      entries: rows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        clientName: r.client.name,
        kind: r.kind as LedgerKind,
        label: LEDGER_KIND_LABEL[r.kind as LedgerKind] ?? r.kind,
        amountCents: r.amountCents,
        asOf: isoDate(r.asOf),
        source: r.source,
        sourceRef: r.sourceRef,
        note: r.note,
        postedAt: r.postedAt.toISOString(),
        postedById: r.postedById,
        supersededAt: r.supersededAt?.toISOString() ?? null,
        supersededById: r.supersededById,
      })),
    };
  } catch (err) {
    if (isMissingTable(err)) return { schemaReady: false, entries: [] };
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Valant posting

/** Current (latest as-of) Patient Aging snapshot and its import */
async function currentAging(db: Db, organizationId: string) {
  const latest = await db.valantAgingSnapshot.findFirst({ where: { organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } });
  if (!latest) return null;
  const rows = await db.valantAgingSnapshot.findMany({
    where: { organizationId, asOf: latest.asOf },
    select: { clientId: true, valantPatientId: true, totalCents: true, importId: true },
  });
  const imp = await db.valantReferenceImport.findFirst({
    where: { organizationId, reportType: 'patient_aging', asOf: latest.asOf },
    orderBy: { importedAt: 'desc' },
    select: { id: true, totalsJson: true, reconciles: true },
  });
  const reportTotal = imp?.totalsJson && typeof imp.totalsJson === 'object' && !Array.isArray(imp.totalsJson)
    ? (imp.totalsJson as Record<string, unknown>).reportTotalCents
    : null;
  return {
    asOf: latest.asOf,
    rows,
    importId: imp?.id ?? rows[0]?.importId ?? null,
    reportTotalCents: typeof reportTotal === 'number' ? reportTotal : null,
    importReconciles: imp?.reconciles ?? null,
  };
}

async function currentPrepayments(db: Db, organizationId: string) {
  const imp = await db.valantReferenceImport.findFirst({
    where: { organizationId, reportType: 'prepayments' },
    orderBy: { importedAt: 'desc' },
    select: { id: true, periodStart: true, periodEnd: true },
  });
  const txns = await db.valantPrepaymentTxn.findMany({
    where: { organizationId },
    select: { clientId: true, valantName: true, date: true, amountCents: true, periodStart: true, createdAt: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  return {
    importId: imp?.id ?? null,
    periodStart: isoDate(imp?.periodStart ?? txns[0]?.periodStart ?? null),
    periodEnd: isoDate(imp?.periodEnd ?? null),
    txns,
  };
}

export type OpeningPreview = OpeningBalancePlan & { importId: string | null; reportTotalCents: number | null; importReconciles: boolean | null };
export type PrepaymentPreview = PrepaymentCreditPlan & { importId: string | null };

export async function previewOpeningBalances(organizationId: string, db: Db = prisma): Promise<OpeningPreview | null> {
  const aging = await currentAging(db, organizationId);
  if (!aging) return null;
  const active = await activeEntries(db, organizationId, { source: VALANT_SOURCE, kind: 'opening_balance' });
  return {
    ...planOpeningBalances(aging.rows, isoDate(aging.asOf), active),
    importId: aging.importId,
    reportTotalCents: aging.reportTotalCents,
    importReconciles: aging.importReconciles,
  };
}

export async function previewPrepaymentCredits(organizationId: string, db: Db = prisma): Promise<PrepaymentPreview | null> {
  const pre = await currentPrepayments(db, organizationId);
  if (!pre.txns.length) return null;
  const active = await activeEntries(db, organizationId, { source: VALANT_SOURCE, kind: 'prepayment_credit' });
  return { ...planPrepaymentCredits(pre.txns, { periodStart: pre.periodStart, periodEnd: pre.periodEnd }, active), importId: pre.importId };
}

/** What the confirm dialog showed; posting refuses when the data changed since the preview */
export type PostExpectation = { asOf: string | null; count: number; totalCents: number };

export class LedgerPostingError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function applyWrite(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorUserId: string,
  kind: ValantPostedKind | null,
  write: PostingWrite,
  insert: { asOf: Date; sourceRef: string | null; note: (clientId: string, detail: string) => string },
  now: Date,
  batchId: string
) {
  if (write.supersede.length) {
    // Unposted (no replacement) in one statement; replaced rows point at their replacement
    const removed = write.supersede.filter((s) => !s.replacedById).map((s) => s.id);
    if (removed.length) {
      const n = await tx.patientLedgerEntry.updateMany({
        where: { organizationId, id: { in: removed }, supersededAt: null },
        data: { supersededAt: now, supersededByUserId: actorUserId },
      });
      if (n.count !== removed.length) throw new LedgerPostingError('Another posting changed these entries. Preview again.', 409);
    }
    // Replaced rows must be inactive before the new rows go in (one active row per client/kind/source)
    const replaced = write.supersede.filter((s) => s.replacedById);
    if (replaced.length) {
      const n = await tx.patientLedgerEntry.updateMany({
        where: { organizationId, id: { in: replaced.map((s) => s.id) }, supersededAt: null },
        data: { supersededAt: now, supersededByUserId: actorUserId },
      });
      if (n.count !== replaced.length) throw new LedgerPostingError('Another posting changed these entries. Preview again.', 409);
    }
  }
  if (kind && write.insert.length) {
    await tx.patientLedgerEntry.createMany({
      data: write.insert.map((i) => ({
        id: i.id,
        organizationId,
        clientId: i.clientId,
        kind,
        amountCents: i.amountCents,
        asOf: insert.asOf,
        source: VALANT_SOURCE,
        sourceRef: insert.sourceRef,
        note: insert.note(i.clientId, i.detail),
        postingBatchId: batchId,
        postedById: actorUserId,
        postedAt: now,
      })),
    });
    for (const s of write.supersede) {
      if (s.replacedById) await tx.patientLedgerEntry.update({ where: { id: s.id }, data: { supersededById: s.replacedById } });
    }
  }
}

/** Serialize postings per organization (the partial unique index is the backstop) */
async function lockOrg(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient-ledger:${organizationId}`}::text))`;
}

function checkExpectation(plan: PostingPlan, expected: PostExpectation) {
  if (plan.asOf !== expected.asOf || plan.counts.post !== expected.count || plan.totals.postCents !== expected.totalCents) {
    throw new LedgerPostingError('The Valant data changed since the preview. Preview again before posting.', 409);
  }
}

export type PostResult = {
  kind: ValantPostedKind;
  batchId: string;
  asOf: string | null;
  posted: number;
  superseded: number;
  replaced: number;
  removed: number;
  totalCents: number;
  previousActiveCents: number;
};

function resultOf(plan: PostingPlan, write: PostingWrite, batchId: string): PostResult {
  return {
    kind: plan.kind,
    batchId,
    asOf: plan.asOf,
    posted: write.insert.length,
    superseded: write.supersede.length,
    replaced: write.supersede.filter((s) => s.replacedById).length,
    removed: write.supersede.filter((s) => !s.replacedById).length,
    totalCents: plan.totals.postCents,
    previousActiveCents: plan.totals.previousActiveCents,
  };
}

const TX_OPTS = { timeout: 120_000, maxWait: 10_000 } as const;
const noonUtc = (d: string) => new Date(`${d}T12:00:00.000Z`);

export async function postOpeningBalances(organizationId: string, actorUserId: string, expected: PostExpectation): Promise<PostResult> {
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const plan = await previewOpeningBalances(organizationId, tx);
    if (!plan || !plan.asOf) throw new LedgerPostingError('No Patient Aging snapshot has been imported', 400);
    checkExpectation(plan, expected);
    if (!plan.reconciliation.reconciles) throw new LedgerPostingError('Posting total does not reconcile to the snapshot; not posted', 409);
    const now = new Date();
    const batchId = randomUUID();
    const write = postingWrites(plan, () => randomUUID());
    await applyWrite(tx, organizationId, actorUserId, 'opening_balance', write, {
      asOf: noonUtc(plan.asOf),
      sourceRef: `patient_aging:${plan.importId ?? 'unknown'}:${plan.asOf}`,
      note: (_c, detail) => `Valant patient aging as of ${plan.asOf} (${detail})`.slice(0, 400),
    }, now, batchId);
    return resultOf(plan, write, batchId);
  }, TX_OPTS);
}

export async function postPrepaymentCredits(organizationId: string, actorUserId: string, expected: PostExpectation): Promise<PostResult> {
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const plan = await previewPrepaymentCredits(organizationId, tx);
    if (!plan) throw new LedgerPostingError('No Prepayments report has been imported', 400);
    checkExpectation(plan, expected);
    if (!plan.reconciliation.reconciles) throw new LedgerPostingError('Prepayment rows do not reconcile; not posted', 409);
    const now = new Date();
    const batchId = randomUUID();
    const write = postingWrites(plan, () => randomUUID());
    const asOf = plan.periodEnd ? noonUtc(plan.periodEnd) : now;
    await applyWrite(tx, organizationId, actorUserId, 'prepayment_credit', write, {
      asOf,
      sourceRef: `prepayments:${plan.importId ?? 'unknown'}:${plan.periodStart ?? '?'}..${plan.periodEnd ?? '?'}`,
      note: (_c, detail) => detail.slice(0, 400),
    }, now, batchId);
    return resultOf(plan, write, batchId);
  }, TX_OPTS);
}

/** Supersede every active Valant entry (or one kind) with no replacement. Never deletes rows. */
export async function unpostValant(organizationId: string, actorUserId: string, kind?: ValantPostedKind) {
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const active = await activeEntries(tx, organizationId, { source: VALANT_SOURCE, ...(kind ? { kind } : {}) });
    const write = unpostWrites(active, kind);
    const now = new Date();
    await applyWrite(tx, organizationId, actorUserId, null, write, { asOf: now, sourceRef: null, note: () => '' }, now, randomUUID());
    const byKind = Object.fromEntries(
      VALANT_POSTED_KINDS.map((k) => {
        const rows = active.filter((e) => e.kind === k);
        return [k, { count: rows.length, totalCents: rows.reduce((s, e) => s + e.amountCents, 0) }];
      })
    ) as Record<ValantPostedKind, { count: number; totalCents: number }>;
    return { superseded: write.supersede.length, byKind };
  }, TX_OPTS);
}

export type ValantPostingStatus = {
  schemaReady: boolean;
  kinds: Record<
    ValantPostedKind,
    {
      active: number;
      totalCents: number;
      asOf: string | null;
      sourceRef: string | null;
      lastPostedAt: string | null;
      lastPostedBy: string | null;
      /** Active amount per client, for "Posted to ledger" badges */
      byClient: Record<string, number>;
    }
  >;
  lastUnpostedAt: string | null;
};

export async function valantPostingStatus(organizationId: string): Promise<ValantPostingStatus> {
  const empty = () => ({ active: 0, totalCents: 0, asOf: null, sourceRef: null, lastPostedAt: null, lastPostedBy: null, byClient: {} as Record<string, number> });
  const status: ValantPostingStatus = { schemaReady: true, kinds: { opening_balance: empty(), prepayment_credit: empty() }, lastUnpostedAt: null };
  try {
    const active = await prisma.patientLedgerEntry.findMany({
      where: { organizationId, source: VALANT_SOURCE, supersededAt: null },
      select: { clientId: true, kind: true, amountCents: true, asOf: true, sourceRef: true, postedAt: true, postedById: true },
    });
    for (const k of VALANT_POSTED_KINDS) {
      const rows = active.filter((r) => r.kind === k);
      const s = status.kinds[k];
      s.active = rows.length;
      s.totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
      for (const r of rows) s.byClient[r.clientId] = (s.byClient[r.clientId] ?? 0) + r.amountCents;
      const last = await prisma.patientLedgerEntry.findFirst({
        where: { organizationId, source: VALANT_SOURCE, kind: k },
        orderBy: { postedAt: 'desc' },
        select: { postedAt: true, postedById: true, asOf: true, sourceRef: true, supersededAt: true },
      });
      if (last) {
        s.lastPostedAt = last.postedAt.toISOString();
        s.asOf = rows.length ? isoDate(rows[0].asOf) : null;
        s.sourceRef = rows[0]?.sourceRef ?? null;
        if (last.postedById) {
          const u = await prisma.user.findUnique({ where: { id: last.postedById }, select: { name: true, email: true } });
          s.lastPostedBy = u?.name || u?.email || null;
        }
      }
    }
    const unposted = await prisma.patientLedgerEntry.findFirst({
      where: { organizationId, source: VALANT_SOURCE, supersededAt: { not: null }, supersededById: null },
      orderBy: { supersededAt: 'desc' },
      select: { supersededAt: true },
    });
    status.lastUnpostedAt = unposted?.supersededAt?.toISOString() ?? null;
    return status;
  } catch (err) {
    if (isMissingTable(err)) return { ...status, schemaReady: false };
    throw err;
  }
}
