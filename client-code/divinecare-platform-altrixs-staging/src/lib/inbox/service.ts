import 'server-only';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { loadAllSections, loadSection, type InboxActor, type InboxDeps } from './core';
import { inboxSectionCache, invalidateInboxForOrg, INBOX_CACHE_TTL_MS } from './cacheStore';
import { INBOX_LOADERS } from './loaders';

/** One slow section never holds the page longer than this (it fills the cache when it finishes) */
export const INBOX_SECTION_TIMEOUT_MS = 2_500;

/**
 * Real dependencies for the inbox: section loaders plus the 42 CFR Part 2 access lookup.
 * Section results are cached per viewer (org + user + role + section) for 45s and shared by
 * GET /api/inbox/summary, /api/inbox/items and the role home; the inbox counts poll every 60s.
 */
export const INBOX_DEPS: InboxDeps = {
  loaders: INBOX_LOADERS,
  lockedClientIds: (actor: InboxActor, clientIds: string[]) =>
    lockedSensitiveClientIds({
      organizationId: actor.organizationId,
      userId: actor.userId,
      role: actor.role,
      clientIds,
    }),
  cache: inboxSectionCache,
  timeoutMs: INBOX_SECTION_TIMEOUT_MS,
};

/** Same deps with a Server-Timing hook for one request */
export function inboxDepsWithTiming(onTiming: NonNullable<InboxDeps['onTiming']>): InboxDeps {
  return { ...INBOX_DEPS, onTiming };
}

export { loadAllSections, loadSection, invalidateInboxForOrg, INBOX_CACHE_TTL_MS };
