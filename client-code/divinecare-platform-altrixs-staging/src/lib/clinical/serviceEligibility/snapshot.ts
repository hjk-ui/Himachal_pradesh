/**
 * Service Eligibility snapshot — server only (prisma).
 *
 * Write: runAndStoreScan() runs the scan (lib/clinical/serviceEligibility/load.ts) under a
 * Postgres advisory lock per organization (one scan at a time across every server and the cron),
 * upserts one slim row per evaluated client (statuses, priority, data gaps — no chart text), and
 * marks accepted suggestions "enrolled" when the client now shows as enrolled.
 *
 * Read: loadScannerRows() reads the snapshot for the viewer's scope only — org / caseload filter
 * (clientAccessWhere), active clients, and the 42 CFR Part 2 lock for the viewer (locked clients
 * are dropped and counted). Names, MRN, clinician and location come live from Client.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { runServiceEligibilityScan, type ScanResult } from './load';
import { PROGRAMS, type EligibilityStatus, type GapKey, type ProgramKey, type ScannedClient, type ClientPriority } from './types';
import type { DecisionState, ScannerRow } from './view';

export const scanLockKey = (organizationId: string) => `service-eligibility-scan:${organizationId}`;
/** Longest a scan may hold the lock (the transaction that owns it) */
const LOCK_TX_TIMEOUT_MS = 10 * 60_000;

export class ScanBusyError extends Error {
  constructor() {
    super('A service eligibility scan is already running for this organization');
    this.name = 'ScanBusyError';
  }
}

export type SnapshotSummary = {
  age: number | null;
  primaryDx: string | null;
  payer: string | null;
  priority: ClientPriority;
  gaps: Partial<Record<ProgramKey, GapKey[]>>;
};

export function snapshotParts(c: ScannedClient): { statuses: Record<ProgramKey, EligibilityStatus>; anyIndicated: boolean; summary: SnapshotSummary } {
  const statuses = {} as Record<ProgramKey, EligibilityStatus>;
  const gaps: Partial<Record<ProgramKey, GapKey[]>> = {};
  for (const p of PROGRAMS) {
    statuses[p] = c.results[p].status;
    if (c.results[p].gaps.length) gaps[p] = c.results[p].gaps;
  }
  return {
    statuses,
    anyIndicated: PROGRAMS.some((p) => statuses[p] !== 'not_indicated'),
    summary: { age: c.age, primaryDx: c.primaryDx, payer: c.payer, priority: c.priority, gaps },
  };
}

async function upsertBatch(organizationId: string, runId: string, now: Date, rows: ScannedClient[]) {
  if (!rows.length) return;
  const data = rows.map((c) => {
    const { statuses, anyIndicated, summary } = snapshotParts(c);
    return {
      organizationId, clientId: c.id, scannedAt: now, runId,
      statuses: statuses as unknown as Prisma.InputJsonValue, anyIndicated, priorityScore: c.priority.score,
      summary: summary as unknown as Prisma.InputJsonValue,
    };
  });
  // Replace this batch's rows atomically (two statements per batch of BATCH_SIZE clients)
  await prisma.$transaction([
    prisma.serviceEligibilitySnapshot.deleteMany({ where: { organizationId, clientId: { in: rows.map((r) => r.id) } } }),
    prisma.serviceEligibilitySnapshot.createMany({ data }),
  ]);
}

export type StoredScan = { runId: string; durationMs: number; scan: Omit<ScanResult, 'clients'> };

/**
 * Run the scan for `clientWhere` and store it. scope 'organization' also removes snapshot rows of
 * clients no longer in the scan (discharged / merged). Throws ScanBusyError when another scan for
 * the organization holds the lock.
 */
export async function runAndStoreScan(opts: {
  organizationId: string;
  clientWhere: Prisma.ClientWhereInput;
  lockedIds: (clientIds: string[]) => Promise<Set<string>>;
  trigger: 'cron' | 'manual';
  scope: 'organization' | 'caseload';
  actorUserId: string | null;
  timeZone?: string;
  now?: Date;
}): Promise<StoredScan> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${scanLockKey(opts.organizationId)})) AS locked`;
      if (!locked) throw new ScanBusyError();
      const run = await prisma.serviceEligibilityScanRun.create({
        data: { organizationId: opts.organizationId, trigger: opts.trigger, scope: opts.scope, actorUserId: opts.actorUserId, startedAt: now },
        select: { id: true },
      });
      try {
        const scan = await runServiceEligibilityScan({
          db: prisma,
          organizationId: opts.organizationId,
          clientWhere: opts.clientWhere,
          lockedIds: opts.lockedIds,
          now,
          timeZone: opts.timeZone,
          onBatch: (rows) => upsertBatch(opts.organizationId, run.id, now, rows),
        });
        // Only a complete org-wide pass may prune (a viewer's pass skips the protected records they cannot open)
        if (opts.scope === 'organization' && !scan.truncated && scan.sensitiveHidden === 0) {
          await prisma.serviceEligibilitySnapshot.deleteMany({ where: { organizationId: opts.organizationId, NOT: { runId: run.id } } });
        }
        // Outcome tracking: accepted suggestions whose client now shows as enrolled
        await prisma.$executeRaw`
          UPDATE "service_eligibility_decisions" d
             SET "outcome" = 'enrolled', "outcome_at" = ${now}, "updated_at" = ${now}
            FROM "service_eligibility_snapshots" s
           WHERE d."organization_id" = ${opts.organizationId}
             AND d."action" = 'accepted'
             AND (d."outcome" IS NULL OR d."outcome" = 'referred')
             AND s."organization_id" = d."organization_id"
             AND s."client_id" = d."client_id"
             AND s."statuses" ->> d."program" = 'enrolled'`;
        const durationMs = Date.now() - started;
        const { clients: _omit, ...summary } = scan;
        void _omit;
        await prisma.serviceEligibilityScanRun.update({
          where: { id: run.id },
          data: {
            status: 'success', finishedAt: new Date(), durationMs,
            clientsScanned: scan.clientsScanned, sensitiveHidden: scan.sensitiveHidden, truncated: scan.truncated,
            counts: scan.counts as unknown as Prisma.InputJsonValue,
          },
        });
        return { runId: run.id, durationMs, scan: summary };
      } catch (err) {
        await prisma.serviceEligibilityScanRun
          .update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), durationMs: Date.now() - started } })
          .catch(() => {});
        throw err;
      }
    },
    { timeout: LOCK_TX_TIMEOUT_MS, maxWait: 10_000 }
  );
}

export type ScannerRead = {
  rows: ScannerRow[];
  clientsInScope: number;
  clientsScanned: number;
  notScanned: number;
  notIndicatedOnly: number;
  sensitiveHidden: number;
  scannedAt: string | null;
  lastRun: { id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null; durationMs: number | null } | null;
};

type SnapRow = { clientId: string; statuses: Prisma.JsonValue; anyIndicated: boolean; summary: Prisma.JsonValue; scannedAt: Date };
type DecisionRow = {
  clientId: string; program: string; action: string; reason: string | null; reasonNote: string | null;
  snoozeUntil: Date | null; outcome: string | null; decidedAt: Date; decidedById: string;
};

export function decisionState(d: DecisionRow): DecisionState {
  return {
    action: d.action as DecisionState['action'],
    reason: (d.reason as DecisionState['reason']) ?? null,
    reasonNote: d.reasonNote,
    snoozeUntil: d.snoozeUntil ? d.snoozeUntil.toISOString() : null,
    outcome: (d.outcome as DecisionState['outcome']) ?? null,
    decidedAt: d.decidedAt.toISOString(),
    decidedBy: d.decidedById,
  };
}

/** Pure join of live client headers, snapshot rows and decisions (exported for tests). */
export function buildScannerRows(
  clients: { id: string; name: string; mrn: string | null; assignedTo: { id: string; name: string | null } | null; location: { id: string; name: string } | null }[],
  snaps: SnapRow[],
  decisions: DecisionRow[]
): { rows: ScannerRow[]; scanned: number; notScanned: number; notIndicatedOnly: number; scannedAt: string | null } {
  const snapBy = new Map(snaps.map((s) => [s.clientId, s]));
  const decBy = new Map<string, Partial<Record<ProgramKey, DecisionState>>>();
  for (const d of decisions) {
    if (!(PROGRAMS as readonly string[]).includes(d.program)) continue;
    const m = decBy.get(d.clientId) ?? {};
    m[d.program as ProgramKey] = decisionState(d);
    decBy.set(d.clientId, m);
  }
  const rows: ScannerRow[] = [];
  let scanned = 0, notScanned = 0, notIndicatedOnly = 0;
  let latest: Date | null = null;
  for (const c of clients) {
    const s = snapBy.get(c.id);
    if (!s) {
      notScanned += 1;
      continue;
    }
    scanned += 1;
    if (!latest || s.scannedAt > latest) latest = s.scannedAt;
    const decisionsFor = decBy.get(c.id) ?? {};
    if (!s.anyIndicated && !Object.keys(decisionsFor).length) {
      notIndicatedOnly += 1;
      continue;
    }
    const sum = (s.summary ?? {}) as Partial<SnapshotSummary>;
    const statuses = { ...(s.statuses as Record<string, EligibilityStatus>) } as Record<ProgramKey, EligibilityStatus>;
    for (const p of PROGRAMS) if (!statuses[p]) statuses[p] = 'not_indicated';
    rows.push({
      id: c.id,
      name: c.name,
      mrn: c.mrn,
      age: sum.age ?? null,
      primaryDx: sum.primaryDx ?? null,
      clinician: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.name || 'Unnamed clinician' } : null,
      location: c.location,
      payer: sum.payer ?? null,
      priority: sum.priority ?? { score: 0, level: 'low', reasons: [] },
      statuses,
      gaps: sum.gaps ?? {},
      decisions: decisionsFor,
      scannedAt: s.scannedAt.toISOString(),
    });
  }
  return { rows, scanned, notScanned, notIndicatedOnly, scannedAt: latest ? (latest as Date).toISOString() : null };
}

export async function loadScannerRows(opts: {
  organizationId: string;
  clientWhere: Prisma.ClientWhereInput;
  lockedIds: (clientIds: string[]) => Promise<Set<string>>;
}): Promise<ScannerRead> {
  const clients = await prisma.client.findMany({
    where: { AND: [opts.clientWhere, { status: 'ACTIVE' }] },
    select: { id: true, name: true, mrn: true, assignedTo: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
  });
  const locked = clients.length ? await opts.lockedIds(clients.map((c) => c.id)) : new Set<string>();
  const open = clients.filter((c) => !locked.has(c.id));
  const openIds = new Set(open.map((c) => c.id));
  const [snaps, decisions, lastRun] = await Promise.all([
    prisma.serviceEligibilitySnapshot.findMany({
      where: { organizationId: opts.organizationId },
      select: { clientId: true, statuses: true, anyIndicated: true, summary: true, scannedAt: true },
    }),
    prisma.serviceEligibilityDecision.findMany({
      where: { organizationId: opts.organizationId },
      select: { clientId: true, program: true, action: true, reason: true, reasonNote: true, snoozeUntil: true, outcome: true, decidedAt: true, decidedById: true },
    }),
    prisma.serviceEligibilityScanRun.findFirst({
      where: { organizationId: opts.organizationId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, trigger: true, status: true, startedAt: true, finishedAt: true, durationMs: true },
    }),
  ]);
  const built = buildScannerRows(
    open,
    snaps.filter((s) => openIds.has(s.clientId)),
    decisions.filter((d) => openIds.has(d.clientId))
  );
  return {
    rows: built.rows,
    clientsInScope: open.length,
    clientsScanned: built.scanned,
    notScanned: built.notScanned,
    notIndicatedOnly: built.notIndicatedOnly,
    sensitiveHidden: clients.length - open.length,
    scannedAt: built.scannedAt,
    lastRun: lastRun
      ? { id: lastRun.id, trigger: lastRun.trigger, status: lastRun.status, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null, durationMs: lastRun.durationMs }
      : null,
  };
}
