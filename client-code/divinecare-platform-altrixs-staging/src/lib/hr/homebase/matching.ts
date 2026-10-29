/**
 * Pure matching rules (no I/O):
 *  - Homebase locations → Altrixs locations: HR maps them; we only SUGGEST by name
 *    (Bowie / Silver Spring / Baltimore, ignoring "Divine Counseling -", "clinic", punctuation).
 *  - Homebase employees → Altrixs staff users: email match (case-insensitive) links
 *    automatically; a name match is only a SUGGESTION that HR must confirm. HR-confirmed links and
 *    HR rejections are kept across syncs.
 *  - Roster review: matched / suggested / unmatched in Homebase / unmatched in Altrixs, plus
 *    mismatches useful for onboarding / offboarding.
 */

// ─── Locations ───────────────────────────────────────────────────────────────

const LOCATION_NOISE = /\b(divine|counseling|counselling|llc|inc|clinic|office|center|centre|location|site|md|maryland|the)\b/g;

export function normalizeLocationName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(LOCATION_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best Altrixs location for a Homebase location name, or null (ambiguous / no match). */
export function suggestLocation(hbName: string, altrixs: Array<{ id: string; name: string; city?: string | null }>): string | null {
  const n = normalizeLocationName(hbName);
  if (!n) return null;
  const exact = altrixs.filter((l) => normalizeLocationName(l.name) === n);
  if (exact.length === 1) return exact[0].id;
  const contains = altrixs.filter((l) => {
    const a = normalizeLocationName(l.name);
    const c = normalizeLocationName(l.city ?? '');
    return (a && (n.includes(a) || a.includes(n))) || (c && n.includes(c));
  });
  return contains.length === 1 ? contains[0].id : null;
}

// ─── Employees ───────────────────────────────────────────────────────────────

const NAME_NOISE = /\b(dr|mr|mrs|ms|mx|jr|sr|ii|iii|iv|lcsw|lcswc|lcpc|lgsw|lgpc|lmsw|lpc|lcadc|cac|ad|psyd|phd|md|do|np|crnp|pmhnp|bc|fnp|rn|lpn|ma|ms|msw|med|ncc|cprs)\b/g;

/** "Dr. Jane  O'Neil-Smith, LCSW-C" → "jane oneilsmith" (credentials and titles dropped). */
export function normalizePersonName(name: string | null | undefined): string {
  const base = String(name || '').split(',')[0];
  return base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’.-]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First + last token key ("jane marie smith" → "jane smith"). */
function nameKey(n: string): string {
  const parts = n.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export type StaffForMatch = { userId: string; name: string; email: string; accountStatus: string };
export type EmployeeForMatch = { homebaseId: string; firstName: string | null; lastName: string | null; email: string | null };

/** Existing link state on a Homebase employee (persisted). */
export type LinkState = {
  linkedUserId: string | null;
  /** email (auto) | confirmed (HR) | suggested (name, pending HR) | rejected (HR said no) | none */
  linkStatus: 'email' | 'confirmed' | 'suggested' | 'rejected' | 'none';
  suggestedUserId: string | null;
};

export type MatchDecision = LinkState & { reason: 'kept_confirmed' | 'email' | 'name_suggestion' | 'kept_rejected' | 'none' };

export function hbFullName(e: { firstName: string | null; lastName: string | null }): string {
  return [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
}

/**
 * Decide the link for each Homebase employee. A staff user is linked to at most one Homebase
 * employee: HR-confirmed links win, then email links, then name suggestions (unique names only).
 */
export function matchEmployees(
  employees: EmployeeForMatch[],
  staff: StaffForMatch[],
  existing: Map<string, LinkState> = new Map(),
): Map<string, MatchDecision> {
  const out = new Map<string, MatchDecision>();
  const taken = new Set<string>();
  const staffIds = new Set(staff.map((s) => s.userId));
  const byEmail = new Map<string, StaffForMatch>();
  for (const s of staff) if (s.email) byEmail.set(s.email.trim().toLowerCase(), s);
  const byName = new Map<string, StaffForMatch[]>();
  for (const s of staff) {
    const k = nameKey(normalizePersonName(s.name));
    if (!k || !k.includes(' ')) continue;
    byName.set(k, [...(byName.get(k) ?? []), s]);
  }

  // 1. HR-confirmed links are kept as long as the staff user still exists in this org.
  for (const e of employees) {
    const ex = existing.get(e.homebaseId);
    if (ex?.linkStatus === 'confirmed' && ex.linkedUserId && staffIds.has(ex.linkedUserId) && !taken.has(ex.linkedUserId)) {
      out.set(e.homebaseId, { linkedUserId: ex.linkedUserId, linkStatus: 'confirmed', suggestedUserId: null, reason: 'kept_confirmed' });
      taken.add(ex.linkedUserId);
    }
  }
  // 2. Email (case-insensitive), unless HR rejected that exact pairing.
  for (const e of employees) {
    if (out.has(e.homebaseId)) continue;
    const ex = existing.get(e.homebaseId);
    const s = e.email ? byEmail.get(e.email.trim().toLowerCase()) : undefined;
    if (s && !taken.has(s.userId) && !(ex?.linkStatus === 'rejected' && ex.suggestedUserId === s.userId)) {
      out.set(e.homebaseId, { linkedUserId: s.userId, linkStatus: 'email', suggestedUserId: null, reason: 'email' });
      taken.add(s.userId);
    }
  }
  // 3. Name: suggestion only (HR confirms). Skipped when HR rejected that same suggestion.
  for (const e of employees) {
    if (out.has(e.homebaseId)) continue;
    const ex = existing.get(e.homebaseId);
    const k = nameKey(normalizePersonName(hbFullName(e)));
    const candidates = k.includes(' ') ? (byName.get(k) ?? []).filter((s) => !taken.has(s.userId)) : [];
    if (candidates.length === 1) {
      const s = candidates[0];
      if (ex?.linkStatus === 'rejected' && ex.suggestedUserId === s.userId) {
        out.set(e.homebaseId, { linkedUserId: null, linkStatus: 'rejected', suggestedUserId: s.userId, reason: 'kept_rejected' });
      } else {
        out.set(e.homebaseId, { linkedUserId: null, linkStatus: 'suggested', suggestedUserId: s.userId, reason: 'name_suggestion' });
      }
      continue;
    }
    if (ex?.linkStatus === 'rejected') {
      out.set(e.homebaseId, { linkedUserId: null, linkStatus: 'rejected', suggestedUserId: ex.suggestedUserId, reason: 'kept_rejected' });
      continue;
    }
    out.set(e.homebaseId, { linkedUserId: null, linkStatus: 'none', suggestedUserId: null, reason: 'none' });
  }
  return out;
}

// ─── Roster review ───────────────────────────────────────────────────────────

export type RosterEmployee = EmployeeForMatch & LinkState & { status: 'active' | 'archived' | 'unknown'; jobTitle: string | null; locationNames: string[] };
export type RosterStaff = StaffForMatch & { role: string; workerType?: string | null };

export type RosterCategory = 'matched' | 'suggested' | 'unmatched_homebase' | 'unmatched_altrixs';
export type RosterFlag =
  | 'active_in_homebase_deactivated_in_altrixs'
  | 'archived_in_homebase_active_in_altrixs'
  | 'active_in_altrixs_missing_from_homebase'
  | 'active_in_homebase_no_altrixs_account';

export type RosterRow = {
  key: string;
  category: RosterCategory;
  homebaseId: string | null;
  homebaseName: string | null;
  homebaseEmail: string | null;
  homebaseStatus: string | null;
  homebaseJobTitle: string | null;
  homebaseLocations: string[];
  userId: string | null;
  altrixsName: string | null;
  altrixsEmail: string | null;
  altrixsStatus: string | null;
  altrixsRole: string | null;
  linkStatus: LinkState['linkStatus'];
  suggestedUserId: string | null;
  suggestedName: string | null;
  flags: RosterFlag[];
};

export function buildRosterReview(employees: RosterEmployee[], staff: RosterStaff[]): { rows: RosterRow[]; counts: Record<RosterCategory | 'flagged', number> } {
  const byId = new Map(staff.map((s) => [s.userId, s]));
  const linkedUsers = new Set<string>();
  const rows: RosterRow[] = [];
  for (const e of employees) {
    const linked = e.linkedUserId && (e.linkStatus === 'email' || e.linkStatus === 'confirmed') ? byId.get(e.linkedUserId) : undefined;
    if (linked) linkedUsers.add(linked.userId);
    const suggested = !linked && e.linkStatus === 'suggested' && e.suggestedUserId ? byId.get(e.suggestedUserId) : undefined;
    const flags: RosterFlag[] = [];
    if (linked) {
      if (e.status === 'active' && linked.accountStatus === 'DEACTIVATED') flags.push('active_in_homebase_deactivated_in_altrixs');
      if (e.status === 'archived' && linked.accountStatus === 'ACTIVE') flags.push('archived_in_homebase_active_in_altrixs');
    } else if (!suggested && e.status === 'active') {
      flags.push('active_in_homebase_no_altrixs_account');
    }
    rows.push({
      key: `hb:${e.homebaseId}`,
      category: linked ? 'matched' : suggested ? 'suggested' : 'unmatched_homebase',
      homebaseId: e.homebaseId,
      homebaseName: hbFullName(e) || null,
      homebaseEmail: e.email,
      homebaseStatus: e.status,
      homebaseJobTitle: e.jobTitle,
      homebaseLocations: e.locationNames,
      userId: linked?.userId ?? null,
      altrixsName: linked?.name ?? null,
      altrixsEmail: linked?.email ?? null,
      altrixsStatus: linked?.accountStatus ?? null,
      altrixsRole: linked?.role ?? null,
      linkStatus: linked ? e.linkStatus : suggested ? 'suggested' : e.linkStatus,
      suggestedUserId: suggested?.userId ?? null,
      suggestedName: suggested?.name ?? null,
      flags,
    });
  }
  const suggestedUsers = new Set(rows.map((r) => r.suggestedUserId).filter(Boolean) as string[]);
  for (const s of staff) {
    if (linkedUsers.has(s.userId) || suggestedUsers.has(s.userId)) continue;
    if (s.accountStatus === 'DEACTIVATED') continue;
    rows.push({
      key: `ax:${s.userId}`,
      category: 'unmatched_altrixs',
      homebaseId: null,
      homebaseName: null,
      homebaseEmail: null,
      homebaseStatus: null,
      homebaseJobTitle: null,
      homebaseLocations: [],
      userId: s.userId,
      altrixsName: s.name,
      altrixsEmail: s.email,
      altrixsStatus: s.accountStatus,
      altrixsRole: s.role,
      linkStatus: 'none',
      suggestedUserId: null,
      suggestedName: null,
      flags: s.accountStatus === 'ACTIVE' ? ['active_in_altrixs_missing_from_homebase'] : [],
    });
  }
  const counts = { matched: 0, suggested: 0, unmatched_homebase: 0, unmatched_altrixs: 0, flagged: 0 };
  for (const r of rows) {
    counts[r.category]++;
    if (r.flags.length) counts.flagged++;
  }
  return { rows, counts };
}

export const ROSTER_FLAG_TEXT: Record<RosterFlag, string> = {
  active_in_homebase_deactivated_in_altrixs: 'Active in Homebase, deactivated in Altrixs (offboard in Homebase?)',
  archived_in_homebase_active_in_altrixs: 'Archived in Homebase, Altrixs account still active (offboard in Altrixs?)',
  active_in_altrixs_missing_from_homebase: 'Active in Altrixs, not found in Homebase (add to Homebase, or contractor?)',
  active_in_homebase_no_altrixs_account: 'Active in Homebase, no Altrixs account linked',
};
