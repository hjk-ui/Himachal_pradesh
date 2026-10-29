import { NextRequest, NextResponse } from 'next/server';
import { BADGE_KEY_BY_TYPE, badgeCountsFor, DEMO_MODE, getNotificationCounts, type NotificationCounts } from '@/lib/services/drfirstRcopiaService';
import { claimPoll, NOTIFICATION_COUNT_MIN_MS, savePollPayload } from '@/lib/drfirst/persistence';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { scopedKey, serverTiming, TtlCache, withTimeout } from '@/lib/perf/cache';
import { requireDrFirstCaller, type DrFirstCaller } from '../_lib/access';
import { syncedBadgeCounts } from '../_lib/badgeCounts';
import { loadOrgPrescribers } from '../_lib/sync';

export const dynamic = 'force-dynamic';

type BadgeData = {
  counts: Record<string, number>;
  byProvider?: Record<string, { userId: string; counts: Record<string, number> }>;
  demo: boolean;
  /** 'live' = Rcopia get_notification_count; 'synced' = Rcopia* tables written by the 15-min cron sync */
  source: 'live' | 'synced';
  asOf: string;
};

/**
 * Live badge counts per viewer: fresh for 15 minutes, served stale (refreshed in the background) for 30.
 * NCDM1: get_notification_count is also throttled server-wide (drfirst_poll_state) to one call per
 * 15 minutes per Rcopia user; inside the window every viewer gets the stored answer of the last call.
 */
const FRESH_MS = NOTIFICATION_COUNT_MIN_MS;
const STALE_MS = 30 * 60_000;
/** Never hold the page on DrFirst longer than this; fall back to the synced tables */
const LIVE_TIMEOUT_MS = 1_500;
const badgeCache = new TtlCache<BadgeData>(STALE_MS, 1000);

/** One audit row per live get_notification_count call (counts only; never patient data). */
async function auditLiveCount(c: DrFirstCaller, ok: boolean) {
  try {
    await writeAuditLog({
      action: 'DRFIRST_NOTIFICATION_COUNT',
      actorUserId: c.userId,
      actorRole: c.role,
      organizationId: c.organizationId,
      resourceType: 'prescription',
      resourceId: 'drfirst-notification-count',
      outcome: ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      metadata: { scope: c.isPrescriber ? 'self' : 'organization' },
    });
  } catch (err) {
    console.error('[drfirst-notifications] audit write failed:', err instanceof Error ? err.name : 'unknown');
  }
}

type StoredCounts = Pick<NotificationCounts, 'counts' | 'byProvider' | 'items'> & { asOf: string };

/** Rcopia get_notification_count at most once per 15 minutes per Rcopia user (NCDM1); otherwise the stored answer. */
async function throttledCounts(c: DrFirstCaller): Promise<(NotificationCounts & { asOf: string }) | null> {
  if (DEMO_MODE) return { counts: {}, byProvider: {}, items: [], demo: true, asOf: new Date().toISOString() };
  const key = `get_notification_count:${(c.rcopiaUsername || 'practice').toLowerCase()}`;
  const claim = await claimPoll(key, NOTIFICATION_COUNT_MIN_MS);
  if (!claim.claimed) {
    const stored = claim.payload as StoredCounts | null;
    return stored?.counts ? { ...stored, demo: false } : null;
  }
  const res = await getNotificationCounts(c.rcopiaUsername || undefined, { returnIds: true });
  if (!res.demo) await auditLiveCount(c, !res.error);
  if (res.error) throw new Error(`rcopia: ${res.error}`);
  const asOf = new Date().toISOString();
  await savePollPayload(key, { counts: res.counts, byProvider: res.byProvider, items: res.items, asOf } satisfies StoredCounts);
  return { ...res, asOf };
}

async function liveCounts(c: DrFirstCaller): Promise<BadgeData> {
  const res = await throttledCounts(c);
  // Throttled with nothing stored yet (e.g. right after a restart): the synced tables answer
  if (!res) throw new Error('rcopia: notification count throttled');
  const asOf = res.asOf;

  // Badge keys (pending_prescription, need_signing, refill, rx_change, ...) from Rcopia's count types
  if (c.isPrescriber && c.rcopiaUsername) {
    return { counts: badgeCountsFor(res, new Set([c.rcopiaUsername])), demo: res.demo, source: 'live', asOf };
  }

  // ADMIN: organization totals plus per-provider counts, limited to this organization's prescribers
  const staff = await loadOrgPrescribers(c.organizationId);
  const byProvider: Record<string, { userId: string; counts: Record<string, number> }> = {};
  for (const item of res.items) {
    const username = (item.providerUsername || '').toLowerCase();
    const user = staff.get(username);
    if (!user) continue;
    const key = BADGE_KEY_BY_TYPE[item.type] || item.type;
    byProvider[username] = byProvider[username] || { userId: user.id, counts: {} };
    byProvider[username].counts[key] = (byProvider[username].counts[key] || 0) + 1;
  }
  return { counts: badgeCountsFor(res, new Set(staff.keys())), byProvider, demo: res.demo, source: 'live', asOf };
}

/** Badge from the cron-synced tables (pending refills by owning provider, pending prescriptions by NPI) */
async function syncedCounts(c: DrFirstCaller): Promise<BadgeData> {
  return { counts: await syncedBadgeCounts(c), demo: false, source: 'synced', asOf: new Date().toISOString() };
}

function refreshInBackground(key: string, c: DrFirstCaller) {
  void badgeCache.getOrCompute(key, () => liveCounts(c), { fresh: true }).catch((err) => {
    console.error('[drfirst-notifications] background refresh failed:', err instanceof Error ? err.name : 'unknown');
  });
}

/**
 * GET /api/drfirst/notifications — the caller's own Rcopia badge counts.
 *
 * Prescriber: get_notification_count signed as their own User.rcopiaUsername
 * with item ids, so `counts` holds only the items Rcopia attributes to them
 * (renewals, changes, scripts awaiting their signature). Any ?user= is ignored.
 * ADMIN: practice totals plus per-provider counts for this org's prescribers.
 *
 * Never blocks on DrFirst: the live count is cached per viewer (org + user + role) for 5 min
 * and served stale while it refreshes; with nothing cached, DrFirst gets 1.5s and the badge
 * otherwise comes from the synced Rcopia* tables (cron sync every 15 min).
 */
export async function GET(req: NextRequest) {
  const timing = serverTiming();
  const g = await timing.time('auth', () => requireDrFirstCaller(req, { allowAdmin: true, requireRcopiaUser: true, adminPracticeLevel: true }));
  if (g.response) return g.response;
  const c = g.caller;
  const key = scopedKey({ organizationId: c.organizationId, userId: c.userId, role: c.role }, 'drfirst-badge');

  try {
    const cached = badgeCache.peek(key);
    let data: BadgeData;
    if (cached && cached.ageMs < FRESH_MS) {
      timing.mark('cache', 'hit');
      data = cached.value;
    } else if (cached) {
      timing.mark('cache', 'stale');
      refreshInBackground(key, c);
      data = cached.value;
    } else {
      const live = badgeCache.getOrCompute(key, () => liveCounts(c));
      live.catch(() => {}); // a late failure after the timeout must not be unhandled
      // Synced counts start now, alongside the live call, so a cold cache costs max(live timeout,
      // synced query) instead of timeout + query (~2.3s on staging).
      const synced = timing.time('synced', () => syncedCounts(c));
      synced.catch(() => {});
      try {
        data = await timing.time('rcopia', () => withTimeout(live, LIVE_TIMEOUT_MS, 'rcopia get_notification_count'));
      } catch (err) {
        console.error('[drfirst-notifications] live count unavailable, using synced data:', err instanceof Error ? err.name : 'unknown');
        data = await synced;
      }
    }
    return NextResponse.json({ success: true, data }, { headers: { 'Server-Timing': timing.header(), 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    console.error('[drfirst-notifications] error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Failed to fetch notification counts' }, { status: 500 });
  }
}
