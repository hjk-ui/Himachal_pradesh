/**
 * Dedupe / resolve plan for persisting scan findings. Pure module.
 *
 * - A finding matches an existing signal by (clientId, detectionSource, fingerprint).
 * - Matched signals are refreshed in place; a reviewed or dismissed signal reopens ('new')
 *   only when evidence appears that was not there before; 'referred' is kept.
 * - A resolved signal that is found again reopens.
 * - Scan-created signals (fingerprint set) for scanned clients that were not found again are
 *   marked 'resolved' — never deleted. Hand-saved legacy signals (no fingerprint) are untouched.
 */
import type { Evidence, Finding, SignalStatus } from './types';

export type ExistingSignal = {
  id: string;
  clientId: string;
  detectionSource: string;
  fingerprint: string | null;
  status: string;
  evidence: unknown;
  /** Keys of all evidence seen when last scanned (falls back to evidence[] keys) */
  evidenceKeys?: string[] | null;
};

export type SignalUpdate = {
  id: string;
  finding: Finding;
  status: SignalStatus;
  /** Why the status changed this scan, when it did */
  statusReason: string | null;
};

export type ReconcilePlan = {
  creates: Finding[];
  updates: SignalUpdate[];
  resolves: string[];
  reopened: number;
};

export function signalKey(clientId: string, detectionSource: string, fingerprint: string): string {
  return `${clientId}|${detectionSource}|${fingerprint}`;
}

export function evidenceKeys(evidence: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(evidence)) return keys;
  for (const e of evidence as Partial<Evidence>[]) {
    if (e && typeof e.key === 'string') keys.add(e.key);
  }
  return keys;
}

export function planReconcile(input: {
  existing: ExistingSignal[];
  findings: Finding[];
  /** Clients the scan covered — only their signals can be resolved */
  scannedClientIds: Iterable<string>;
}): ReconcilePlan {
  const scanned = new Set(input.scannedClientIds);
  const byKey = new Map<string, ExistingSignal>();
  for (const row of input.existing) {
    if (!row.fingerprint) continue;
    byKey.set(signalKey(row.clientId, row.detectionSource, row.fingerprint), row);
  }

  const plan: ReconcilePlan = { creates: [], updates: [], resolves: [], reopened: 0 };
  const matched = new Set<string>();
  const seenFindings = new Set<string>();

  for (const f of input.findings) {
    const key = signalKey(f.clientId, f.detectionSource, f.fingerprint);
    if (seenFindings.has(key)) continue;
    seenFindings.add(key);
    const row = byKey.get(key);
    if (!row) {
      plan.creates.push(f);
      continue;
    }
    matched.add(row.id);
    const prevStatus = row.status as SignalStatus;
    let status: SignalStatus = prevStatus;
    let statusReason: string | null = null;
    if (prevStatus === 'resolved') {
      status = 'new';
      statusReason = 'Found again by a later scan';
    } else if (prevStatus === 'reviewed' || prevStatus === 'dismissed') {
      const before = row.evidenceKeys?.length ? new Set(row.evidenceKeys) : evidenceKeys(row.evidence);
      const fresh = f.evidenceKeys.some((k) => !before.has(k));
      if (fresh) {
        status = 'new';
        statusReason = 'New evidence since the last review';
      }
    }
    if (status !== prevStatus) plan.reopened += 1;
    plan.updates.push({ id: row.id, finding: f, status, statusReason });
  }

  for (const row of input.existing) {
    if (!row.fingerprint || matched.has(row.id) || row.status === 'resolved') continue;
    if (!scanned.has(row.clientId)) continue;
    plan.resolves.push(row.id);
  }
  return plan;
}
