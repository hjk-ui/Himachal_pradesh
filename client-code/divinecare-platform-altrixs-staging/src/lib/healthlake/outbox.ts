/**
 * FHIR sync outbox (pure): plan which rows need a PUT or DELETE by comparing the current
 * mapped resources' hashes with the last-synced hashes, and process due rows through a
 * transport with retry + exponential backoff. No database or network here.
 */
import { typeRank, type BuiltResource } from '@/lib/fhir/mapping/build';
import type { HealthLakeTransport, OpResult } from './client';

export type OutboxStatus = 'PENDING' | 'IMPORTING' | 'SYNCED' | 'ERROR' | 'DEAD' | 'DELETED';
export type OutboxOperation = 'UPSERT' | 'DELETE';

export type OutboxRow = {
  id: string;
  organizationId: string;
  resourceType: string;
  resourceId: string;
  sourceTable: string;
  sourceId: string;
  clientId: string | null;
  operation: string;
  status: string;
  hash: string;
  syncedHash: string | null;
  versionId: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  lastSyncedAt: Date | null;
  importJobId: string | null;
};

export type OutboxCreate = Omit<OutboxRow, 'id'>;
export type OutboxUpdate = { id: string; data: Partial<Omit<OutboxRow, 'id'>> };

export const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

export function outboxKey(resourceType: string, resourceId: string): string {
  return `${resourceType}/${resourceId}`;
}

/** 1 min, 2 min, 4 min ... capped at 6 h */
export function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

export type OutboxPlan = {
  creates: OutboxCreate[];
  updates: OutboxUpdate[];
  unchanged: number;
  queuedUpserts: number;
  queuedDeletes: number;
};

const RESET = { attempts: 0, nextAttemptAt: null, lastError: null } as const;

/**
 * Compare existing outbox rows for one org with the resources that should exist now.
 * - new resource -> PENDING upsert
 * - hash changed (or resource came back after delete) -> PENDING upsert
 * - resource gone (row deleted, or now excluded e.g. Part 2) -> PENDING delete, or DELETED
 *   directly when it never reached HealthLake
 */
export function planOutbox(organizationId: string, existing: OutboxRow[], built: BuiltResource[]): OutboxPlan {
  const plan: OutboxPlan = { creates: [], updates: [], unchanged: 0, queuedUpserts: 0, queuedDeletes: 0 };
  const byKey = new Map(existing.filter((e) => e.organizationId === organizationId).map((e) => [outboxKey(e.resourceType, e.resourceId), e]));
  const seen = new Set<string>();

  for (const r of built) {
    const key = outboxKey(r.resourceType, r.resourceId);
    seen.add(key);
    const e = byKey.get(key);
    if (!e) {
      plan.creates.push({
        organizationId,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        sourceTable: r.sourceTable,
        sourceId: r.sourceId,
        clientId: r.clientId,
        operation: 'UPSERT',
        status: 'PENDING',
        hash: r.hash,
        syncedHash: null,
        versionId: null,
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        lastSyncedAt: null,
        importJobId: null,
      });
      plan.queuedUpserts++;
      continue;
    }
    const upsert = e.operation === 'UPSERT';
    const sameHash = e.hash === r.hash;
    if (upsert && sameHash && (e.status === 'SYNCED' ? e.syncedHash === r.hash : e.status !== 'DELETED')) {
      plan.unchanged++;
      continue;
    }
    plan.updates.push({
      id: e.id,
      data: {
        operation: 'UPSERT',
        status: 'PENDING',
        hash: r.hash,
        sourceTable: r.sourceTable,
        sourceId: r.sourceId,
        clientId: r.clientId,
        importJobId: null,
        ...RESET,
      },
    });
    plan.queuedUpserts++;
  }

  for (const [key, e] of byKey) {
    if (seen.has(key)) continue;
    if (e.status === 'DELETED') {
      plan.unchanged++;
      continue;
    }
    if (e.operation === 'DELETE') {
      plan.unchanged++;
      continue;
    }
    const neverRemote = e.syncedHash == null && e.attempts === 0 && e.status !== 'IMPORTING';
    if (neverRemote) {
      plan.updates.push({ id: e.id, data: { operation: 'DELETE', status: 'DELETED', importJobId: null, ...RESET } });
      continue;
    }
    plan.updates.push({ id: e.id, data: { operation: 'DELETE', status: 'PENDING', importJobId: null, ...RESET } });
    plan.queuedDeletes++;
  }
  return plan;
}

/** Rows to work now: PENDING / ERROR whose backoff has elapsed. Upserts by type rank, then deletes in reverse. */
export function selectDue(rows: OutboxRow[], now: Date, limit = 1000): OutboxRow[] {
  const due = rows.filter(
    (r) => (r.status === 'PENDING' || r.status === 'ERROR') && (!r.nextAttemptAt || r.nextAttemptAt.getTime() <= now.getTime())
  );
  const ups = due.filter((r) => r.operation !== 'DELETE').sort((a, b) => typeRank(a.resourceType) - typeRank(b.resourceType));
  const dels = due.filter((r) => r.operation === 'DELETE').sort((a, b) => typeRank(b.resourceType) - typeRank(a.resourceType));
  return [...ups, ...dels].slice(0, limit);
}

export type ProcessResult = {
  updates: OutboxUpdate[];
  synced: number;
  deleted: number;
  failed: number;
  dead: number;
  /** Set when HealthLake refused our credentials (401/403): the run stops, attempts are not burned */
  aborted: string | null;
};

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function processOutbox(input: {
  rows: OutboxRow[];
  resources: Map<string, BuiltResource>;
  transport: Pick<HealthLakeTransport, 'put' | 'delete'>;
  now: Date;
  maxAttempts?: number;
  /** Inline retries for 429 / 5xx before recording a failed attempt */
  inlineRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ProcessResult> {
  const max = input.maxAttempts ?? MAX_ATTEMPTS;
  const inline = input.inlineRetries ?? 2;
  const sleep = input.sleep ?? sleepDefault;
  const out: ProcessResult = { updates: [], synced: 0, deleted: 0, failed: 0, dead: 0, aborted: null };

  for (const row of input.rows) {
    const key = outboxKey(row.resourceType, row.resourceId);
    const isDelete = row.operation === 'DELETE';
    const built = isDelete ? undefined : input.resources.get(key);
    if (!isDelete && !built) continue; // planner re-queues it as a delete next run

    let res: OpResult = { ok: false, status: 0, error: 'not attempted', retryable: true };
    for (let i = 0; i <= inline; i++) {
      res = isDelete
        ? await input.transport.delete(row.resourceType, row.resourceId)
        : await input.transport.put(built!.resource);
      if (res.ok === true || res.retryable === false || i === inline) break;
      await sleep(250 * 2 ** i);
    }

    if (res.ok === true) {
      if (isDelete) {
        out.deleted++;
        out.updates.push({
          id: row.id,
          data: { status: 'DELETED', syncedHash: null, versionId: null, lastSyncedAt: input.now, ...RESET },
        });
      } else {
        out.synced++;
        out.updates.push({
          id: row.id,
          data: {
            status: 'SYNCED',
            hash: built!.hash,
            syncedHash: built!.hash,
            versionId: res.versionId ?? null,
            lastSyncedAt: input.now,
            ...RESET,
          },
        });
      }
      continue;
    }
    const fail = res as Extract<OpResult, { ok: false }>;

    if (fail.status === 401 || fail.status === 403) {
      out.aborted = fail.error;
      out.updates.push({ id: row.id, data: { status: 'ERROR', lastError: fail.error } });
      out.failed++;
      break;
    }

    const attempts = row.attempts + 1;
    out.failed++;
    if (attempts >= max) {
      out.dead++;
      out.updates.push({ id: row.id, data: { status: 'DEAD', attempts, lastError: fail.error, nextAttemptAt: null } });
    } else {
      out.updates.push({
        id: row.id,
        data: {
          status: 'ERROR',
          attempts,
          lastError: fail.error,
          nextAttemptAt: new Date(input.now.getTime() + backoffMs(attempts)),
        },
      });
    }
  }
  return out;
}

/** Apply updates to in-memory rows (used by the sync glue and tests). */
export function applyUpdates(rows: OutboxRow[], updates: OutboxUpdate[]): OutboxRow[] {
  const map = new Map(updates.map((u) => [u.id, u.data]));
  return rows.map((r) => (map.has(r.id) ? { ...r, ...map.get(r.id)! } : r));
}
