/**
 * Old URLs of merged pages. Each old page.tsx is a server redirect to its
 * canonical page (so bookmarks keep working) and forwards the query string.
 */
export const AUTHORIZATIONS_PATH = '/dashboard/billing/authorizations';

export const LEGACY_ROUTE_REDIRECTS: Record<string, { to: string; params?: Record<string, string> }> = {
  // "Electronic Prior Authorization" (Carelon / Availity submissions)
  '/dashboard/billing/prior-auth': { to: AUTHORIZATIONS_PATH, params: { tab: 'electronic' } },
  '/dashboard/prior-auth': { to: AUTHORIZATIONS_PATH, params: { tab: 'electronic' } },
  // "Prior Authorizations" tracking (PA status, session counts, expiry)
  '/dashboard/ehr/prior-auths': { to: AUTHORIZATIONS_PATH, params: { tab: 'tracking' } },
  // "AI Session Notes" folded into AI Scribe ("Paste or import"); `from` shows a one-line notice there
  '/dashboard/ehr/session-ai': { to: '/dashboard/scribe', params: { mode: 'paste', from: 'session-ai' } },
};

type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams | undefined | null;

/** Canonical URL for a legacy path, keeping the caller's query params (the fixed tab wins). */
export function legacyRedirectUrl(fromPath: string, searchParams?: SearchParams): string {
  const rule = LEGACY_ROUTE_REDIRECTS[fromPath];
  if (!rule) throw new Error(`No legacy redirect for ${fromPath}`);
  const qs = new URLSearchParams();
  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((v, k) => qs.append(k, v));
  } else if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) qs.append(k, one);
    }
  }
  for (const [k, v] of Object.entries(rule.params ?? {})) qs.set(k, v);
  const query = qs.toString();
  return query ? `${rule.to}?${query}` : rule.to;
}
