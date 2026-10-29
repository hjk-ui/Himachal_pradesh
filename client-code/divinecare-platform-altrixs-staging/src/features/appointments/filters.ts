/**
 * Scheduler filters (Valant / TherapyNotes / SimplePractice / athenaOne parity). Pure and
 * browser-safe: no React, no Prisma. The page keeps one ScheduleFilters value, mirrors it into the
 * URL (shareable, back-button safe) and per-user localStorage, and runs every view (day, week,
 * month, board, list) through applyScheduleFilters so they always agree.
 *
 * Filters only ever narrow what /api/appointments already returned: role / caseload scoping
 * stays on the server.
 */
import type { Appointment, AppointmentStatus } from './types';

/** Calendar-label filter key for appointments without a label (same value the legend uses). */
export const NO_LABEL_KEY = '__none__';
/** Provider / site filter key for appointments with no clinician / no known site. */
export const UNASSIGNED_KEY = '__none__';

/** Visit status as the front desk reads it: "confirmed" is a scheduled visit the patient confirmed. */
export type FilterStatus = AppointmentStatus | 'confirmed';
export const FILTER_STATUSES: readonly FilterStatus[] = [
  'scheduled',
  'confirmed',
  'checked-in',
  'in-session',
  'completed',
  'no-show',
  'late-cancel',
  'cancelled',
] as const;
export const FILTER_STATUS_LABEL: Record<FilterStatus, string> = {
  scheduled: 'Scheduled (unconfirmed)',
  confirmed: 'Confirmed',
  'checked-in': 'Checked in',
  'in-session': 'In session',
  completed: 'Completed',
  'no-show': 'No-show',
  'late-cancel': 'Late cancel',
  cancelled: 'Cancelled',
};
/** Hidden by the "Hide cancelled / no-shows" toggle unless picked explicitly in Status. */
export const HIDDEN_BY_DEFAULT: readonly FilterStatus[] = ['cancelled', 'late-cancel', 'no-show'];

export type VisitMode = 'in-person' | 'video' | 'audio';
export const VISIT_MODES: readonly VisitMode[] = ['in-person', 'video', 'audio'] as const;
export const VISIT_MODE_LABEL: Record<VisitMode, string> = {
  'in-person': 'In person',
  video: 'Telehealth video',
  audio: 'Audio only',
};

export type Program = 'omhc' | 'prp' | 'iop' | 'residential' | 'primary-care';
export const PROGRAMS: readonly Program[] = ['omhc', 'prp', 'iop', 'residential', 'primary-care'] as const;
export const PROGRAM_LABEL: Record<Program, string> = {
  omhc: 'Outpatient mental health (OMHC)',
  prp: 'PRP',
  iop: 'IOP',
  residential: 'Residential',
  'primary-care': 'Primary care',
};

export type QuickFilter = 'new' | 'unconfirmed' | 'needs-checkin' | 'unsigned' | 'recurring';
export const QUICK_FILTERS: readonly QuickFilter[] = ['new', 'unconfirmed', 'needs-checkin', 'unsigned', 'recurring'] as const;
export const QUICK_FILTER_LABEL: Record<QuickFilter, string> = {
  new: 'New clients',
  unconfirmed: 'Unconfirmed',
  'needs-checkin': 'Needs check-in today',
  unsigned: 'Unsigned note',
  recurring: 'Recurring series',
};

export type ScheduleFilters = {
  /** Clinician ids (UNASSIGNED_KEY = no clinician). Empty = everyone the user may see. */
  providers: string[];
  /** "My schedule": only appointments where the signed-in user is the clinician. */
  mine: boolean;
  /** Site ids (the client's home location; UNASSIGNED_KEY = no site on file). */
  locations: string[];
  /** Exact appointment type strings from the data. */
  types: string[];
  statuses: FilterStatus[];
  modes: VisitMode[];
  /** Calendar label ids (NO_LABEL_KEY = no label). */
  labels: string[];
  programs: Program[];
  /** Payer names (UNASSIGNED_KEY = no payer on file). */
  payers: string[];
  /** Client name or MRN. */
  q: string;
  /** Quick chips; all picked chips must match (AND). */
  quick: QuickFilter[];
  /** Hide cancelled, late-cancelled and no-show visits. */
  hideCancelled: boolean;
};

/** Optional server facets (GET /api/appointments?facets=1); filters degrade when absent. */
export type FilterableAppointment = Pick<
  Appointment,
  | 'id'
  | 'clientName'
  | 'clinicianId'
  | 'type'
  | 'date'
  | 'status'
  | 'noteStatus'
  | 'isVirtual'
  | 'audioOnly'
  | 'labelId'
  | 'seriesId'
  | 'confirmedAt'
> &
  Partial<Pick<Appointment, 'siteId' | 'clientMrn' | 'payer' | 'isNewClient' | 'primaryCareClient'>>;

export type FilterContext = {
  /** Signed-in user id ("My schedule"). */
  userId?: string | null;
  /** Practice "today" YYYY-MM-DD (practice time zone, never the browser's). */
  today: string;
  /** Clinician id -> role, so medical-provider visits count as primary care. */
  clinicianRoles?: Record<string, string | undefined>;
};

export function emptyFilters(): ScheduleFilters {
  return {
    providers: [],
    mine: false,
    locations: [],
    types: [],
    statuses: [],
    modes: [],
    labels: [],
    programs: [],
    payers: [],
    q: '',
    quick: [],
    hideCancelled: false,
  };
}

/** Roles whose day is their own column: they open on "My schedule". */
const OWN_SCHEDULE_ROLES = new Set([
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'CLINICIAN',
  'PHYSICIAN',
  'MEDICAL_NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'CRISIS_RESPONDER',
]);

/**
 * Defaults by role: clinical roles start on "My schedule"; front desk, office manager, billing,
 * medical assistants and leadership (including a medical director) start on all providers.
 * Cancelled / no-shows are hidden by default.
 */
export function defaultFilters(role?: string | null, opts?: { leadership?: boolean }): ScheduleFilters {
  const r = String(role || '').toUpperCase();
  return {
    ...emptyFilters(),
    mine: !opts?.leadership && OWN_SCHEDULE_ROLES.has(r),
    hideCancelled: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Derived appointment facts

export function effectiveStatus(a: Pick<FilterableAppointment, 'status' | 'confirmedAt'>): FilterStatus {
  return a.status === 'scheduled' && a.confirmedAt ? 'confirmed' : a.status;
}

export function visitMode(a: Pick<FilterableAppointment, 'isVirtual' | 'audioOnly'>): VisitMode {
  if (!a.isVirtual) return 'in-person';
  return a.audioOnly ? 'audio' : 'video';
}

const MEDICAL_PROVIDER_ROLES = new Set(['PHYSICIAN', 'MEDICAL_NP']);

/**
 * Program from the visit type (and, for primary care, the booked provider's role). Anything not
 * PRP / IOP / residential / primary care is outpatient mental health (OMHC).
 */
export function programOf(
  a: Pick<FilterableAppointment, 'type' | 'clinicianId'>,
  ctx?: Pick<FilterContext, 'clinicianRoles'>
): Program {
  const t = a.type || '';
  if (/\bPRP\b|psychiatric rehab/i.test(t)) return 'prp';
  if (/\bIOP\b|intensive outpatient/i.test(t)) return 'iop';
  if (/residential|\bRRP\b/i.test(t)) return 'residential';
  if (/primary care|annual (physical|wellness)|physical exam|well(ness)? visit|sick visit|\bPCP\b/i.test(t)) return 'primary-care';
  const role = a.clinicianId ? ctx?.clinicianRoles?.[a.clinicianId] : undefined;
  if (role && MEDICAL_PROVIDER_ROLES.has(role.toUpperCase())) return 'primary-care';
  return 'omhc';
}

function normalize(s: string | null | undefined) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Client name (every word, any order) or MRN (contains, ignoring punctuation). */
export function matchesClientSearch(a: Pick<FilterableAppointment, 'clientName' | 'clientMrn'>, q: string): boolean {
  const query = normalize(q);
  if (!query) return true;
  const name = normalize(a.clientName);
  if (query.split(' ').every((w) => name.includes(w))) return true;
  const mrn = normalize(a.clientMrn).replace(/ /g, '');
  const compact = query.replace(/ /g, '');
  return Boolean(mrn) && mrn.includes(compact);
}

export function matchesQuick(a: FilterableAppointment, quick: QuickFilter, ctx: FilterContext): boolean {
  switch (quick) {
    case 'new':
      return a.isNewClient === true;
    case 'unconfirmed':
      return a.status === 'scheduled' && !a.confirmedAt && a.date >= ctx.today;
    case 'needs-checkin':
      return a.status === 'scheduled' && a.date === ctx.today;
    case 'unsigned':
      return (a.status === 'completed' || a.status === 'in-session') && a.noteStatus !== 'signed';
    case 'recurring':
      return Boolean(a.seriesId);
  }
}

// ---------------------------------------------------------------------------------------------
// Matching

export type ApplyOptions = {
  /** Ignore "Hide cancelled / no-shows" (header metrics still count no-shows). */
  ignoreHide?: boolean;
};

export function matchesFilters(
  a: FilterableAppointment,
  f: ScheduleFilters,
  ctx: FilterContext,
  opts?: ApplyOptions
): boolean {
  if (f.mine && ctx.userId && a.clinicianId !== ctx.userId) return false;
  if (f.providers.length && !f.providers.includes(a.clinicianId || UNASSIGNED_KEY)) return false;
  if (f.locations.length && !f.locations.includes(a.siteId || UNASSIGNED_KEY)) return false;
  if (f.types.length && !f.types.includes(a.type)) return false;
  const status = effectiveStatus(a);
  if (f.statuses.length && !f.statuses.includes(status)) return false;
  if (
    f.hideCancelled &&
    !opts?.ignoreHide &&
    HIDDEN_BY_DEFAULT.includes(status) &&
    !f.statuses.includes(status)
  ) {
    return false;
  }
  if (f.modes.length && !f.modes.includes(visitMode(a))) return false;
  if (f.labels.length && !f.labels.includes(a.labelId || NO_LABEL_KEY)) return false;
  if (f.programs.length && !f.programs.includes(programOf(a, ctx))) return false;
  if (f.payers.length && !f.payers.includes(a.payer || UNASSIGNED_KEY)) return false;
  if (!matchesClientSearch(a, f.q)) return false;
  for (const quick of f.quick) if (!matchesQuick(a, quick, ctx)) return false;
  return true;
}

export function applyScheduleFilters<T extends FilterableAppointment>(
  list: readonly T[],
  f: ScheduleFilters,
  ctx: FilterContext,
  opts?: ApplyOptions
): T[] {
  return list.filter((a) => matchesFilters(a, f, ctx, opts));
}

/** Number of filters that differ from "show everything" (for the Filters button badge). */
export function activeFilterCount(f: ScheduleFilters): number {
  return (
    (f.mine ? 1 : 0) +
    f.providers.length +
    f.locations.length +
    f.types.length +
    f.statuses.length +
    f.modes.length +
    f.labels.length +
    f.programs.length +
    f.payers.length +
    (f.q.trim() ? 1 : 0) +
    f.quick.length +
    (f.hideCancelled ? 1 : 0)
  );
}

export function sameFilters(a: ScheduleFilters, b: ScheduleFilters): boolean {
  return filtersToQuery(a).toString() === filtersToQuery(b).toString();
}

// ---------------------------------------------------------------------------------------------
// Active chips

export type FilterChipKey = Exclude<keyof ScheduleFilters, never>;
export type FilterChip = { key: FilterChipKey; value: string; label: string };

export type ChipLookups = {
  provider?: (id: string) => string | undefined;
  location?: (id: string) => string | undefined;
  label?: (id: string) => string | undefined;
};

export function activeChips(f: ScheduleFilters, look: ChipLookups = {}): FilterChip[] {
  const none = 'None';
  const out: FilterChip[] = [];
  if (f.mine) out.push({ key: 'mine', value: '1', label: 'My schedule' });
  for (const v of f.providers) out.push({ key: 'providers', value: v, label: `Provider: ${v === UNASSIGNED_KEY ? 'Unassigned' : look.provider?.(v) ?? 'Unknown'}` });
  for (const v of f.locations) out.push({ key: 'locations', value: v, label: `Site: ${v === UNASSIGNED_KEY ? 'No site on file' : look.location?.(v) ?? 'Unknown'}` });
  for (const v of f.types) out.push({ key: 'types', value: v, label: `Type: ${v}` });
  for (const v of f.statuses) out.push({ key: 'statuses', value: v, label: `Status: ${FILTER_STATUS_LABEL[v]}` });
  for (const v of f.modes) out.push({ key: 'modes', value: v, label: VISIT_MODE_LABEL[v] });
  for (const v of f.labels) out.push({ key: 'labels', value: v, label: `Label: ${v === NO_LABEL_KEY ? 'No label' : look.label?.(v) ?? 'Unknown'}` });
  for (const v of f.programs) out.push({ key: 'programs', value: v, label: `Program: ${PROGRAM_LABEL[v]}` });
  for (const v of f.payers) out.push({ key: 'payers', value: v, label: `Payer: ${v === UNASSIGNED_KEY ? none : v}` });
  if (f.q.trim()) out.push({ key: 'q', value: f.q, label: `Client: ${f.q.trim()}` });
  for (const v of f.quick) out.push({ key: 'quick', value: v, label: QUICK_FILTER_LABEL[v] });
  if (f.hideCancelled) out.push({ key: 'hideCancelled', value: '1', label: 'Hiding cancelled / no-shows' });
  return out;
}

export function removeChip(f: ScheduleFilters, chip: Pick<FilterChip, 'key' | 'value'>): ScheduleFilters {
  const next: ScheduleFilters = { ...f };
  switch (chip.key) {
    case 'mine':
      next.mine = false;
      break;
    case 'hideCancelled':
      next.hideCancelled = false;
      break;
    case 'q':
      next.q = '';
      break;
    default: {
      const k = chip.key as 'providers' | 'locations' | 'types' | 'statuses' | 'modes' | 'labels' | 'programs' | 'payers' | 'quick';
      (next[k] as string[]) = (f[k] as string[]).filter((v) => v !== chip.value);
    }
  }
  return next;
}

export function toggleValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// ---------------------------------------------------------------------------------------------
// URL query string (shareable). `f=1` marks the URL as authoritative: a missing key means empty.

const LIST_KEYS = {
  providers: 'prov',
  locations: 'loc',
  types: 'type',
  statuses: 'status',
  modes: 'mode',
  labels: 'label',
  programs: 'prog',
  payers: 'payer',
  quick: 'quick',
} as const;

/** Every query key this module owns (so the page can keep its other params). */
export const FILTER_QUERY_KEYS: readonly string[] = ['f', 'mine', 'hide', 'q', ...Object.values(LIST_KEYS)];

export function filtersToQuery(f: ScheduleFilters, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of FILTER_QUERY_KEYS) p.delete(k);
  p.set('f', '1');
  if (f.mine) p.set('mine', '1');
  p.set('hide', f.hideCancelled ? '1' : '0');
  if (f.q.trim()) p.set('q', f.q.trim());
  for (const [field, key] of Object.entries(LIST_KEYS) as Array<[keyof typeof LIST_KEYS, string]>) {
    const values = [...new Set(f[field] as string[])].sort();
    for (const v of values) p.append(key, v);
  }
  return p;
}

function pick<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return [...new Set(values.filter((v): v is T => (allowed as readonly string[]).includes(v)))];
}

function clean(values: string[], max = 200): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v && v.length <= max))].slice(0, 100);
}

/** null when the URL carries no filter state (fall back to remembered / role defaults). */
export function filtersFromQuery(p: URLSearchParams): ScheduleFilters | null {
  if (p.get('f') !== '1') return null;
  const all = (k: string) => p.getAll(k);
  return {
    providers: clean(all(LIST_KEYS.providers)).sort(),
    mine: p.get('mine') === '1',
    locations: clean(all(LIST_KEYS.locations)).sort(),
    types: clean(all(LIST_KEYS.types)).sort(),
    statuses: pick(all(LIST_KEYS.statuses), FILTER_STATUSES).sort(),
    modes: pick(all(LIST_KEYS.modes), VISIT_MODES).sort(),
    labels: clean(all(LIST_KEYS.labels)).sort(),
    programs: pick(all(LIST_KEYS.programs), PROGRAMS).sort(),
    payers: clean(all(LIST_KEYS.payers)).sort(),
    q: (p.get('q') || '').slice(0, 100),
    quick: pick(all(LIST_KEYS.quick), QUICK_FILTERS).sort(),
    hideCancelled: p.get('hide') !== '0',
  };
}

/** Sorted copy, so equal filters serialize identically. */
export function normalizeFilters(f: ScheduleFilters): ScheduleFilters {
  return filtersFromQuery(filtersToQuery(f)) ?? emptyFilters();
}

// ---------------------------------------------------------------------------------------------
// Per-user memory and saved views (browser localStorage; every access is try/catch)

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SavedView = { name: string; query: string };

export const filtersStorageKey = (userId: string) => `altrixs.schedule.filters.${userId}`;
export const savedViewsStorageKey = (userId: string) => `altrixs.schedule.views.${userId}`;

export function loadRememberedFilters(storage: StorageLike | null | undefined, userId: string): ScheduleFilters | null {
  try {
    const raw = storage?.getItem(filtersStorageKey(userId));
    return raw ? filtersFromQuery(new URLSearchParams(raw)) : null;
  } catch {
    return null;
  }
}

export function rememberFilters(storage: StorageLike | null | undefined, userId: string, f: ScheduleFilters | null) {
  try {
    if (!storage) return;
    if (!f) storage.removeItem(filtersStorageKey(userId));
    else storage.setItem(filtersStorageKey(userId), filtersToQuery(f).toString());
  } catch {
    /* private mode / quota: filters still work for this page view */
  }
}

export function loadSavedViews(storage: StorageLike | null | undefined, userId: string): SavedView[] {
  try {
    const raw = storage?.getItem(savedViewsStorageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is SavedView => Boolean(v) && typeof v.name === 'string' && typeof v.query === 'string')
      .map((v) => ({ name: v.name.slice(0, 60), query: v.query }))
      .slice(0, 30);
  } catch {
    return [];
  }
}

/** Adds or replaces (same name, case-insensitive) a saved view; returns the new list. */
export function upsertSavedView(views: SavedView[], name: string, f: ScheduleFilters): SavedView[] {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return views;
  const rest = views.filter((v) => v.name.toLowerCase() !== trimmed.toLowerCase());
  return [...rest, { name: trimmed, query: filtersToQuery(f).toString() }].sort((a, b) => a.name.localeCompare(b.name));
}

export function storeSavedViews(storage: StorageLike | null | undefined, userId: string, views: SavedView[]) {
  try {
    storage?.setItem(savedViewsStorageKey(userId), JSON.stringify(views));
  } catch {
    /* ignore */
  }
}

export function savedViewFilters(view: SavedView): ScheduleFilters | null {
  return filtersFromQuery(new URLSearchParams(view.query));
}

// ---------------------------------------------------------------------------------------------
// Options built from the data on screen (types / payers with counts)

export function distinctOptions<T>(list: readonly T[], value: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of list) {
    const v = value(item) || UNASSIGNED_KEY;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([v, count]) => ({ value: v, count }))
    .sort((a, b) => (a.value === UNASSIGNED_KEY ? 1 : b.value === UNASSIGNED_KEY ? -1 : a.value.localeCompare(b.value)));
}
