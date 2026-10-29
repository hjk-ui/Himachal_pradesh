/**
 * Per-user sidebar conveniences kept in localStorage: recent client charts and
 * pinned pages. Every access is wrapped in try/catch (private mode, blocked
 * storage) and the UI works without it.
 *
 * Recent clients hold ONLY {id, name, mrn} — no other PHI — and are cleared on sign-out.
 */
export type RecentClient = { id: string; name: string; mrn?: string | null };

export const RECENT_CLIENTS_MAX = 5;
export const NAV_STORAGE_EVENT = 'altrixs:nav-storage';

const recentKey = (userId: string) => `altrixs.recentClients.${userId}`;
const pinsKey = (userId: string) => `altrixs.nav.pins.${userId}`;
const COLLAPSE_KEY = 'altrixs.nav.collapsedGroups';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
  try {
    window.dispatchEvent(new CustomEvent(NAV_STORAGE_EVENT, { detail: { key } }));
  } catch {
    /* non-browser */
  }
}

/** Newest first, de-duplicated by id, capped at RECENT_CLIENTS_MAX. Pure (tested). */
export function mergeRecentClient(list: RecentClient[], entry: RecentClient): RecentClient[] {
  const clean: RecentClient = {
    id: String(entry.id),
    name: String(entry.name || '').trim().slice(0, 120),
    mrn: entry.mrn ? String(entry.mrn).trim().slice(0, 40) : null,
  };
  if (!clean.id || !clean.name) return list;
  const rest = list.filter((c) => c && c.id !== clean.id);
  return [clean, ...rest].slice(0, RECENT_CLIENTS_MAX);
}

export function getRecentClients(userId: string | null | undefined): RecentClient[] {
  if (!userId) return [];
  const list = read<RecentClient[]>(recentKey(userId), []);
  return Array.isArray(list) ? list.filter((c) => c && c.id && c.name).slice(0, RECENT_CLIENTS_MAX) : [];
}

export function rememberRecentClient(userId: string | null | undefined, entry: RecentClient) {
  if (!userId) return;
  const current = getRecentClients(userId);
  const next = mergeRecentClient(current, entry);
  const same =
    next.length === current.length &&
    next.every((c, i) => c.id === current[i]?.id && c.name === current[i]?.name && c.mrn === current[i]?.mrn);
  if (!same) write(recentKey(userId), next);
}

export function clearRecentClients(userId: string | null | undefined) {
  if (!userId) return;
  try {
    window.localStorage.removeItem(recentKey(userId));
  } catch {
    /* ignore */
  }
}

export function getPinnedHrefs(userId: string | null | undefined): string[] {
  if (!userId) return [];
  const list = read<string[]>(pinsKey(userId), []);
  return Array.isArray(list) ? list.filter((h) => typeof h === 'string') : [];
}

export function togglePinnedHref(userId: string | null | undefined, href: string): string[] {
  if (!userId) return [];
  const current = getPinnedHrefs(userId);
  const next = current.includes(href) ? current.filter((h) => h !== href) : [...current, href];
  write(pinsKey(userId), next);
  return next;
}

export function getCollapsedGroups(): Record<string, boolean> {
  const v = read<Record<string, boolean>>(COLLAPSE_KEY, {});
  return v && typeof v === 'object' ? v : {};
}

export function setCollapsedGroups(value: Record<string, boolean>) {
  write(COLLAPSE_KEY, value);
}

/**
 * Chart pages can announce the open client (name + MRN only) so the sidebar
 * and command search list it under "Recent clients" without a second fetch:
 *   announceChartClient({ id, name, mrn })
 */
export const CHART_CLIENT_EVENT = 'altrixs:chart-client';

export function announceChartClient(entry: RecentClient) {
  try {
    window.dispatchEvent(new CustomEvent<RecentClient>(CHART_CLIENT_EVENT, { detail: entry }));
  } catch {
    /* non-browser */
  }
}
