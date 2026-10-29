import { registerCaseloadScopedCache, TtlCache } from '../perf/cache';
import type { InboxSectionResult } from './types';

/**
 * The inbox section cache (no other imports, so write routes can invalidate it cheaply).
 * Entries are keyed org | user | role | inbox | section (scopedKey in perf/cache).
 */
export const INBOX_CACHE_TTL_MS = 45_000;

export const inboxSectionCache = registerCaseloadScopedCache(new TtlCache<InboxSectionResult>(INBOX_CACHE_TTL_MS, 2000));

/**
 * Drop cached inbox sections for every viewer of an organization after a write that changes
 * what they see (alert reviewed, MBC acknowledged, ...).
 */
export function invalidateInboxForOrg(organizationId: string | null | undefined): void {
  if (organizationId) inboxSectionCache.deletePrefix(`${organizationId.replace(/\|/g, '%7C')}|`);
}
