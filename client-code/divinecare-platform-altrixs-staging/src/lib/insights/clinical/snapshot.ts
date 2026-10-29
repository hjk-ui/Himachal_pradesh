/**
 * Clinical Insights snapshot — server only (prisma).
 *
 * Write: runAndStoreInsights() evaluates the scope (load.ts) while holding the Postgres advisory
 * lock `job:clinical-insights-scan:<org>` (src/lib/jobs/advisoryLock.ts), so the nightly script,
 * a viewer's Refresh and a second server never overlap. One slim row per evaluated client
 * (tier, rule ids, signals with values + dates, trend history — no names, no free text).
 *
 * Read: loadInsightRows() reads the snapshot for the viewer's scope only — org / caseload filter
 * (clientAccessWhere), active clients (plus recent discharge cases), and the viewer's 42 CFR
 * Part 2 lock (locked clients are dropped and counted). Names, MRN, clinician and location come
 * live from Client.
 */
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { insightClientWhere, runInsightsScan, scanContext, toInsightRow, type EvaluatedClient } from './load';
import { joinInsightRows, type InsightRow, type RowHistory, type StoredRow } from './population';
import { TIERS, type Tier } from './types';

export const insightsLockKey = (organizationId: string) => `${JOB_LOCK_KEYS.clinicalInsightsScan}:${organizationId}`;

export class InsightsBusyError extends Error {
  constructor() {
    super('A clinical insights scan is already running for this organization');
    this.name = 'InsightsBusyError';
  }
}


function storedRow(r: InsightRow): StoredRow {
  const { name: _n, mrn: _m, clinician: _c, location: _l, id: _i, scannedAt: _s, ...rest } = r;
  void _n; void _m; void _c; void _l; void _i; void _s;
  return rest;
}

async function upsertBatch(organizationId: string, runId: string, now: Date, rows: EvaluatedClient[]) {
  if (!rows.length) return;
  const iso = now.toISOString();
  const data = rows.map((e) => {
    const r = toInsightRow(e, iso);
    return {
      organizationId, clientId: e.client.id, runId, scannedAt: now, tier: r.tier, rank: r.rank,
      row: storedRow(r) as unknown as Prisma.InputJsonValue,
      history: e.history as unknown as Prisma.InputJsonValue,
    };
  });
  await prisma.$transaction([
    prisma.clinicalInsightSnapshot.deleteMany({ where: { organizationId, clientId: { in: data.map((d) => d.clientId) } } }),
    prisma.clinicalInsightSnapshot.createMany({ data }),
  ]);
}

export type StoredInsights = {
  runId: string;
  durationMs: number;
  clientsScanned: number;
  sensitiveHidden: number;
  truncated: boolean;
  counts: Record<Tier, number>;
};

/**
 * Evaluate `clientWhere` and store it. scope 'organization' also removes rows of clients no longer
 * in scope (only after a complete pass with nothing hidden). Throws InsightsBusyError when another
 * scan for the organization holds the lock.
 */
export async function runAndStoreInsights(opts: {
  organizationId: string;
  clientWhere: Prisma.ClientWhereInput;
  lockedIds: (clientIds: string[]) => Promise<Set<string>>;
  trigger: 'cron' | 'manual' | 'first-visit';
  scope: 'organization' | 'caseload';
  actor: { userId: string | null; role: Role | string };
  timeZone: string;
  now?: Date;
}): Promise<StoredInsights> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const run = await withJobLock(insightsLockKey(opts.organizationId), async () => {
    const runRow = await prisma.clinicalInsightScanRun.create({
      data: { organizationId: opts.organizationId, trigger: opts.trigger, scope: opts.scope, actorUserId: opts.actor.userId, startedAt: now },
      select: { id: true },
    });
    try {
      const ctx = await scanContext({
        organizationId: opts.organizationId,
        actor: { userId: opts.actor.userId ?? 'system', role: opts.actor.role },
        clientWhere: opts.clientWhere,
        timeZone: opts.timeZone,
        now,
      });
      const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
      const scan = await runInsightsScan({
        ctx,
        where: insightClientWhere(opts.clientWhere, ctx),
        lockedIds: opts.lockedIds,
        onBatch: async (rows) => {
          for (const r of rows) counts[r.evaluation.tier] += 1;
          await upsertBatch(opts.organizationId, runRow.id, now, rows);
        },
      });
      if (opts.scope === 'organization' && !scan.truncated && scan.sensitiveHidden === 0) {
        await prisma.clinicalInsightSnapshot.deleteMany({ where: { organizationId: opts.organizationId, NOT: { runId: runRow.id } } });
      }
      const durationMs = Date.now() - started;
      await prisma.clinicalInsightScanRun.update({
        where: { id: runRow.id },
        data: {
          status: 'success', finishedAt: new Date(), durationMs, clientsScanned: scan.clientsScanned,
          sensitiveHidden: scan.sensitiveHidden, truncated: scan.truncated, counts: counts as unknown as Prisma.InputJsonValue,
        },
      });
      return { runId: runRow.id, durationMs, clientsScanned: scan.clientsScanned, sensitiveHidden: scan.sensitiveHidden, truncated: scan.truncated, counts };
    } catch (err) {
      await prisma.clinicalInsightScanRun
        .update({ where: { id: runRow.id }, data: { status: 'failed', finishedAt: new Date(), durationMs: Date.now() - started } })
        .catch(() => {});
      throw err;
    }
  });
  if (!run.acquired) throw new InsightsBusyError();
  return run.result;
}

export type InsightsRead = {
  rows: InsightRow[];
  histories: Map<string, RowHistory>;
  clientsInScope: number;
  notScanned: number;
  sensitiveHidden: number;
  scannedAt: string | null;
  lastRun: { id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null; durationMs: number | null } | null;
};

export async function loadInsightRows(opts: {
  organizationId: string;
  clientWhere: Prisma.ClientWhereInput;
  lockedIds: (clientIds: string[]) => Promise<Set<string>>;
}): Promise<InsightsRead> {
  const snapIds = await prisma.clinicalInsightSnapshot.findMany({
    where: { organizationId: opts.organizationId },
    select: { clientId: true },
  });
  const clients = await prisma.client.findMany({
    where: { AND: [opts.clientWhere, { OR: [{ status: 'ACTIVE' }, { id: { in: snapIds.map((s) => s.clientId) } }] }] },
    select: { id: true, name: true, mrn: true, status: true, assignedTo: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
  });
  const locked = clients.length ? await opts.lockedIds(clients.map((c) => c.id)) : new Set<string>();
  const open = clients.filter((c) => !locked.has(c.id));
  const [snaps, lastRun] = await Promise.all([
    open.length
      ? prisma.clinicalInsightSnapshot.findMany({
          where: { organizationId: opts.organizationId, clientId: { in: open.map((c) => c.id) } },
          select: { clientId: true, row: true, history: true, scannedAt: true },
        })
      : Promise.resolve([]),
    prisma.clinicalInsightScanRun.findFirst({
      where: { organizationId: opts.organizationId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, trigger: true, status: true, startedAt: true, finishedAt: true, durationMs: true },
    }),
  ]);
  const joined = joinInsightRows(open, snaps);
  return {
    rows: joined.rows,
    histories: joined.histories,
    clientsInScope: open.filter((c) => c.status === 'ACTIVE').length,
    notScanned: joined.notScanned,
    sensitiveHidden: clients.length - open.length,
    scannedAt: joined.scannedAt,
    lastRun: lastRun
      ? { id: lastRun.id, trigger: lastRun.trigger, status: lastRun.status, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null, durationMs: lastRun.durationMs }
      : null,
  };
}
