/**
 * "Mark inactive / discharge review" for the session-frequency "likely inactive" group.
 * Pure (no database): picks which clients get a discharge case in planning.
 */
import type { SessionFrequencyItem } from './sessionFrequency';

export const DISCHARGE_REVIEW_REASON = 'No appointment or note in 180+ days — likely inactive (discharge review)';

/** Discharge case statuses that mean a review is already open */
const OPEN_CASE = new Set(['planning', 'ready']);

export function openDischargeClientIds(existingCases: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(existingCases)) return out;
  for (const c of existingCases) {
    if (!c || typeof c !== 'object') continue;
    const row = c as { clientId?: unknown; status?: unknown };
    if (typeof row.clientId === 'string' && OPEN_CASE.has(String(row.status ?? 'planning'))) out.add(row.clientId);
  }
  return out;
}

export function planDischargeReviews(input: {
  items: SessionFrequencyItem[];
  existingCases: unknown;
  /** Only these clients (the group's rows); omitted = the whole likely-inactive group */
  requested?: string[];
}) {
  const wanted = input.requested ? new Set(input.requested) : null;
  const open = openDischargeClientIds(input.existingCases);
  const group = input.items.filter((i) => i.bucket === 'likely_inactive' && (!wanted || wanted.has(i.clientId)));
  const start: SessionFrequencyItem[] = [];
  const alreadyOpen: string[] = [];
  let skippedProtected = 0;
  for (const i of group) {
    if (i.locked) {
      skippedProtected += 1;
      continue;
    }
    if (open.has(i.clientId)) {
      alreadyOpen.push(i.clientId);
      continue;
    }
    open.add(i.clientId);
    start.push(i);
  }
  return { start, alreadyOpen, skippedProtected };
}
