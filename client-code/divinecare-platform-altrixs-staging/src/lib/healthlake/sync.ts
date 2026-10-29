/**
 * HealthLake sync glue: scan (snapshot -> FHIR -> outbox plan) and work the outbox.
 * One FhirSyncRun row and one HIPAA audit row (counts only) per organization run.
 */
import type { PrismaClient } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { buildOrgResources, type BuiltResource } from '@/lib/fhir/mapping/build';
import type { HealthLakeTransport } from './client';
import {
  applyUpdates,
  outboxKey,
  planOutbox,
  processOutbox,
  selectDue,
  type OutboxRow,
  type OutboxUpdate,
} from './outbox';
import { getSyncSettings, toSyncSettings } from './settings';
import { loadOrgSnapshot } from './snapshot';

export type ScanResult = {
  resources: Map<string, BuiltResource>;
  rows: OutboxRow[];
  scanned: number;
  queued: number;
  excluded: Record<string, number>;
  conflicts: number;
};

const ROW_SELECT = {
  id: true, organizationId: true, resourceType: true, resourceId: true, sourceTable: true, sourceId: true,
  clientId: true, operation: true, status: true, hash: true, syncedHash: true, versionId: true, attempts: true,
  nextAttemptAt: true, lastError: true, lastSyncedAt: true, importJobId: true,
} as const;

export async function persistUpdates(db: PrismaClient, updates: OutboxUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200);
    await db.$transaction(batch.map((u) => db.fhirSyncState.update({ where: { id: u.id }, data: u.data })));
  }
}

/** Build this org's resources and bring its outbox rows up to date (no network). */
export async function scanOrganization(db: PrismaClient, organizationId: string): Promise<ScanResult | null> {
  const settings = await getSyncSettings(db, organizationId);
  const snap = await loadOrgSnapshot(db, organizationId);
  if (!snap) return null;
  const built = buildOrgResources(snap, toSyncSettings(settings));
  const existing = await db.fhirSyncState.findMany({ where: { organizationId }, select: ROW_SELECT });
  const plan = planOutbox(organizationId, existing, built.resources);

  if (plan.creates.length) {
    for (let i = 0; i < plan.creates.length; i += 500) {
      await db.fhirSyncState.createMany({ data: plan.creates.slice(i, i + 500), skipDuplicates: true });
    }
  }
  await persistUpdates(db, plan.updates);

  const rows = await db.fhirSyncState.findMany({ where: { organizationId }, select: ROW_SELECT });
  const ownKeys = new Set(rows.map((r) => outboxKey(r.resourceType, r.resourceId)));
  // A create skipped by the global unique key means another org already owns that resource id.
  const conflicts = plan.creates.filter((c) => !ownKeys.has(outboxKey(c.resourceType, c.resourceId))).length;
  return {
    resources: new Map(built.resources.map((r) => [outboxKey(r.resourceType, r.resourceId), r])),
    rows,
    scanned: built.resources.length,
    queued: plan.queuedUpserts + plan.queuedDeletes,
    excluded: built.excluded,
    conflicts,
  };
}

export type OrgSyncSummary = {
  organizationId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  reason?: string;
  runId?: string;
  scanned: number;
  queued: number;
  synced: number;
  deleted: number;
  failed: number;
  dead: number;
  excluded: number;
  error?: string | null;
};

export async function runOrgSync(input: {
  db: PrismaClient;
  organizationId: string;
  transport: Pick<HealthLakeTransport, 'put' | 'delete'>;
  trigger: 'cron' | 'manual';
  actorUserId?: string | null;
  actorRole?: string | null;
  now?: () => Date;
  limit?: number;
}): Promise<OrgSyncSummary> {
  const { db, organizationId } = input;
  const now = input.now ?? (() => new Date());
  const empty = { scanned: 0, queued: 0, synced: 0, deleted: 0, failed: 0, dead: 0, excluded: 0 };

  const settings = await getSyncSettings(db, organizationId);
  if (!settings.enabled) {
    return { organizationId, status: 'SKIPPED', reason: 'HealthLake sync is turned off for this organization', ...empty };
  }

  const run = await db.fhirSyncRun.create({ data: { organizationId, trigger: input.trigger, status: 'RUNNING' } });
  let summary: OrgSyncSummary;
  try {
    const scan = await scanOrganization(db, organizationId);
    if (!scan) throw new Error('organization not found');
    const due = selectDue(scan.rows, now(), input.limit ?? 1000);
    const result = await processOutbox({ rows: due, resources: scan.resources, transport: input.transport, now: now() });
    await persistUpdates(db, result.updates);
    const excludedTotal = Object.values(scan.excluded).reduce((a, b) => a + b, 0);
    const status: OrgSyncSummary['status'] = result.aborted ? 'FAILED' : result.failed ? 'PARTIAL' : 'SUCCESS';
    const patientsWritten = new Set(
      applyUpdates(due, result.updates)
        .filter((r) => r.clientId && (r.status === 'SYNCED' || r.status === 'DELETED'))
        .map((r) => r.clientId)
    ).size;
    summary = {
      organizationId,
      status,
      runId: run.id,
      scanned: scan.scanned,
      queued: scan.queued,
      synced: result.synced,
      deleted: result.deleted,
      failed: result.failed,
      dead: result.dead,
      excluded: excludedTotal,
      error: result.aborted,
    };
    await db.fhirSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: now(),
        scanned: scan.scanned,
        queued: scan.queued,
        synced: result.synced,
        deleted: result.deleted,
        failed: result.failed,
        excluded: excludedTotal,
        error: result.aborted,
        detailJson: { excluded: scan.excluded, dead: result.dead, conflicts: scan.conflicts, patientsWritten },
      },
    });
    await writeAuditLog({
      action: 'HEALTHLAKE_SYNC_ORG',
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? 'system',
      organizationId,
      resourceType: 'FhirSyncRun',
      resourceId: run.id,
      outcome: status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
      userAgent: input.trigger === 'cron' ? 'cron' : null,
      metadata: {
        trigger: input.trigger,
        scanned: scan.scanned,
        queued: scan.queued,
        synced: result.synced,
        deleted: result.deleted,
        failed: result.failed,
        excluded: excludedTotal,
        patientsWritten,
      },
    });
  } catch (err) {
    const message = (err instanceof Error ? err.message : 'sync failed').slice(0, 300);
    await db.fhirSyncRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: now(), error: message } });
    await writeAuditLog({
      action: 'HEALTHLAKE_SYNC_ORG',
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? 'system',
      organizationId,
      resourceType: 'FhirSyncRun',
      resourceId: run.id,
      outcome: 'FAILURE',
      metadata: { trigger: input.trigger, error: 'sync_failed' },
    });
    summary = { organizationId, status: 'FAILED', runId: run.id, ...empty, error: message };
  }
  return summary;
}

/** Outbox + last run summary for the status page (counts and ids only). */
export async function outboxOverview(db: PrismaClient, organizationId: string) {
  const [byStatus, byType, recentErrors, lastRun] = await Promise.all([
    db.fhirSyncState.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    db.fhirSyncState.groupBy({ by: ['resourceType', 'status'], where: { organizationId }, _count: { _all: true } }),
    db.fhirSyncState.findMany({
      where: { organizationId, status: { in: ['ERROR', 'DEAD'] } },
      orderBy: { updatedAt: 'desc' },
      take: 15,
      select: { resourceType: true, resourceId: true, operation: true, status: true, attempts: true, lastError: true, nextAttemptAt: true, updatedAt: true },
    }),
    db.fhirSyncRun.findFirst({ where: { organizationId }, orderBy: { startedAt: 'desc' } }),
  ]);
  const types: Record<string, Record<string, number>> = {};
  for (const r of byType) {
    types[r.resourceType] ??= {};
    types[r.resourceType]![r.status] = r._count._all;
  }
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    byType: types,
    recentErrors: recentErrors.map((e) => ({
      ...e,
      nextAttemptAt: e.nextAttemptAt?.toISOString() ?? null,
      updatedAt: e.updatedAt.toISOString(),
    })),
    lastRun: lastRun
      ? {
          id: lastRun.id,
          trigger: lastRun.trigger,
          status: lastRun.status,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          scanned: lastRun.scanned,
          queued: lastRun.queued,
          synced: lastRun.synced,
          deleted: lastRun.deleted,
          failed: lastRun.failed,
          excluded: lastRun.excluded,
          error: lastRun.error,
          detail: lastRun.detailJson,
        }
      : null,
  };
}
