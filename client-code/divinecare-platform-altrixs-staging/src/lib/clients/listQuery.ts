/**
 * Staff client list (/dashboard/clients, GET /api/clients): query-string parsing, search parsing,
 * filters as Prisma where-clauses, and the A–Z name sort. Pure (no prisma client): safe for tests
 * and client components. The scope (clientAccessWhere) is always applied by the caller first; every
 * clause here only narrows it.
 */
import type { Prisma } from '@prisma/client';
import { noClinicalPrimaryWhere } from '@/lib/clients/careTeam';
import { splitFullName } from '@/lib/clients/legalName';

export const CLIENT_SORT_KEYS = ['last', 'first', 'mrn', 'dob', 'nextAppt', 'lastSeen', 'added', 'status'] as const;
export type ClientSortKey = (typeof CLIENT_SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export const CLIENT_SORT_LABELS: Record<ClientSortKey, string> = {
  last: 'Last name',
  first: 'First name',
  mrn: 'MRN',
  dob: 'Date of birth',
  nextAppt: 'Next appointment',
  lastSeen: 'Last seen',
  added: 'Date added',
  status: 'Status',
};

/** Direction a column starts in when first clicked (dates people scan newest-first). */
export const DEFAULT_SORT_DIR: Record<ClientSortKey, SortDir> = {
  last: 'asc',
  first: 'asc',
  mrn: 'asc',
  dob: 'asc',
  nextAppt: 'asc',
  lastSeen: 'desc',
  added: 'desc',
  status: 'asc',
};

export const CLIENT_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCHARGED'] as const;
export type ClientStatusValue = (typeof CLIENT_STATUSES)[number];
export const CLIENT_RISKS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ClientRiskValue = (typeof CLIENT_RISKS)[number];
/** medical = Family Practice (src/lib/medical/medicalProgram.ts); prp = PRP enrollment; iop / php = intensive programs */
export const CLIENT_PROGRAMS = ['medical', 'prp', 'iop', 'php'] as const;
export type ClientProgramValue = (typeof CLIENT_PROGRAMS)[number];
export const CLIENT_PAGE_SIZES = [25, 50, 100] as const;
/** Letter bar: A–Z plus '#' (last name starts with anything else, or no name on file) */
export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'] as const;

/** PRP enrollment states that mean the client is in the program now */
export const PRP_ENROLLED_STATUSES = ['active', 'on_hold', 'transitioning'];
/** Appointment states that count as the client having been seen (past visit) */
export const SEEN_APPOINTMENT_STATUSES = ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'] as const;
/** Appointment states that count as upcoming (future, not cancelled / no-show) */
export const UPCOMING_APPOINTMENT_STATUSES = ['SCHEDULED', 'CHECKED_IN'] as const;

export type ClinicianRoleFilter = 'any' | 'primary' | 'team';

export type ClientListQuery = {
  search?: string;
  /** Set only when the caller asked for a sort; absent keeps the legacy most-recently-updated order */
  sort?: ClientSortKey;
  dir: SortDir;
  letter?: string;
  status?: ClientStatusValue;
  locationId?: string;
  clinicianId?: string;
  clinicianRole: ClinicianRoleFilter;
  mine: boolean;
  payer?: string;
  risk?: ClientRiskValue;
  program?: ClientProgramValue;
  noUpcoming: boolean;
  needsDemographics: boolean;
  unassigned: boolean;
  take: number;
  skip: number;
};

function oneOf<T extends string>(list: readonly T[], raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  return (list as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

const flag = (v: string | null) => v === '1' || v === 'true';
const text = (v: string | null, max = 120) => {
  const t = (v ?? '').trim().slice(0, max);
  return t || undefined;
};

/** GET /api/clients query string -> validated options (unknown values are ignored, never errors). */
export function parseClientListQuery(params: URLSearchParams): ClientListQuery {
  const sort = oneOf(CLIENT_SORT_KEYS, params.get('sort'));
  const dirRaw = params.get('dir');
  const dir: SortDir = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : sort ? DEFAULT_SORT_DIR[sort] : 'asc';
  const letterRaw = (params.get('letter') ?? '').trim().toUpperCase();
  const letter = (LETTERS as readonly string[]).includes(letterRaw) ? letterRaw : undefined;
  const limitParam = params.get('limit') || params.get('take');
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
  const take = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 250;
  const skip = Math.max(0, parseInt(params.get('skip') || '0', 10) || 0);
  const clinicianRole = oneOf(['any', 'primary', 'team'] as const, params.get('clinicianRole')) ?? 'any';
  return {
    search: text(params.get('q') || params.get('search')),
    sort,
    dir,
    letter,
    status: oneOf(CLIENT_STATUSES, params.get('status')?.toUpperCase()),
    locationId: text(params.get('locationId'), 64),
    clinicianId: text(params.get('clinicianId'), 64),
    clinicianRole,
    mine: flag(params.get('mine')),
    payer: text(params.get('payer')),
    risk: oneOf(CLIENT_RISKS, params.get('risk')?.toUpperCase()),
    program: oneOf(CLIENT_PROGRAMS, params.get('program')),
    noUpcoming: flag(params.get('noUpcoming')),
    needsDemographics: flag(params.get('needsDemographics')),
    unassigned: flag(params.get('unassigned')),
    take,
    skip,
  };
}

// ─── Search parsing ──────────────────────────────────────────────────────────

export type ParsedClientSearch = {
  raw: string;
  /** "Last, First" */
  lastFirst?: { last: string; first: string };
  /** Space-separated words: every word must match a name field (either order) */
  words: string[];
  /** Date of birth typed as MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY or YYYY-MM-DD (UTC day) */
  dob?: { start: Date; end: Date };
  /** Digits when the query looks like a phone number (4+ digits, phone punctuation only) */
  phoneDigits?: string;
};

/** MM/DD/YYYY (also M/D/YYYY, MM-DD-YYYY, YYYY-MM-DD) -> that calendar day in UTC, or null. */
export function parseDobQuery(raw: string): { start: Date; end: Date } | null {
  const t = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (match) {
    m = +match[1];
    d = +match[2];
    y = +match[3];
  } else if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const start = new Date(Date.UTC(y, m - 1, d));
  if (start.getUTCMonth() !== m - 1 || start.getUTCDate() !== d) return null; // 02/31
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function parseClientSearch(input: string): ParsedClientSearch {
  const raw = input.trim().replace(/\s+/g, ' ');
  const out: ParsedClientSearch = { raw, words: [] };
  if (!raw) return out;
  const dob = parseDobQuery(raw);
  if (dob) {
    out.dob = dob;
    return out;
  }
  if (/^[\d\s().+-]+$/.test(raw)) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) out.phoneDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    return out;
  }
  const comma = raw.indexOf(',');
  if (comma > 0) {
    const last = raw.slice(0, comma).trim();
    const first = raw.slice(comma + 1).trim();
    if (last && first) out.lastFirst = { last, first };
    else if (last) out.words = [last];
    return out;
  }
  const words = raw.split(' ').filter(Boolean);
  if (words.length > 1) out.words = words.slice(0, 4);
  return out;
}

/** Phone strings as they are stored (raw import, (301) 555-1234, 301-555-1234, 301.555.1234). */
export function phoneSearchVariants(digits: string): string[] {
  const set = new Set<string>([digits]);
  if (digits.length === 10) {
    const [a, b, c] = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
    set.add(`(${a}) ${b}-${c}`);
    set.add(`(${a})${b}-${c}`);
    set.add(`${a}-${b}-${c}`);
    set.add(`${a}.${b}.${c}`);
    set.add(`${a} ${b} ${c}`);
  } else if (digits.length === 7) {
    set.add(`${digits.slice(0, 3)}-${digits.slice(3)}`);
  }
  return [...set];
}

const ci = (contains: string) => ({ contains, mode: 'insensitive' as const });
const starts = (startsWith: string) => ({ startsWith, mode: 'insensitive' as const });

/**
 * Search where-clause. Name (legal, preferred, display; "Last, First" or either word order), MRN,
 * Valant ID, email, phone (stored in any format), DOB, and the diagnosis code only when the role
 * may see diagnoses. Medicaid / member IDs are not searched here.
 */
export function clientSearchWhere(search: string, opts: { diagnosisCode: boolean }): Prisma.ClientWhereInput | null {
  const p = parseClientSearch(search);
  if (!p.raw) return null;
  const q = p.raw;
  if (p.dob) return { dateOfBirth: { gte: p.dob.start, lt: p.dob.end } };
  const or: Prisma.ClientWhereInput[] = [
    { name: ci(q) },
    { legalLastName: ci(q) },
    { legalFirstName: ci(q) },
    { preferredName: ci(q) },
    { mrn: ci(q) },
    { email: ci(q) },
    { sourceId: { equals: q, mode: 'insensitive' } },
    { phone: ci(q) },
  ];
  if (p.phoneDigits) for (const v of phoneSearchVariants(p.phoneDigits)) if (v !== q) or.push({ phone: ci(v) });
  if (p.lastFirst) {
    const { last, first } = p.lastFirst;
    or.push({ AND: [{ legalLastName: starts(last) }, { OR: [{ legalFirstName: starts(first) }, { preferredName: starts(first) }] }] });
    or.push({ AND: [{ name: ci(first) }, { name: ci(last) }] });
  }
  if (p.words.length > 1) {
    or.push({
      AND: p.words.map((w) => ({
        OR: [{ name: ci(w) }, { legalFirstName: ci(w) }, { legalLastName: ci(w) }, { preferredName: ci(w) }],
      })),
    });
  }
  if (opts.diagnosisCode) or.push({ primaryDiagnosisCode: ci(q) });
  return { OR: or };
}

// ─── Filters ────────────────────────────────────────────────────────────────

const blank = (field: 'legalFirstName' | 'legalLastName' | 'addressLine1' | 'city' | 'state' | 'postalCode' | 'administrativeSex' | 'gender') =>
  ({ OR: [{ [field]: null }, { [field]: '' }] }) as Prisma.ClientWhereInput;

/**
 * Missing the core identity demographics every downstream system needs (DrFirst, 837P, FHIR —
 * see src/lib/clients/demographics.ts readiness checks): legal first / last name, name review,
 * DOB, sex, and a street address (unless marked homeless / unknown), city, state, ZIP.
 */
export function needsDemographicsWhere(): Prisma.ClientWhereInput {
  return {
    OR: [
      blank('legalFirstName'),
      blank('legalLastName'),
      { needsNameReview: true },
      { dateOfBirth: null },
      { AND: [blank('administrativeSex'), blank('gender')] },
      { AND: [blank('addressLine1'), { addressStatus: null }] },
      blank('city'),
      blank('state'),
      blank('postalCode'),
    ],
  };
}

/** Assigned clinician: primary (Client.assignedToId, the chart's "Assigned clinician") and / or a care-team member. */
export function clinicianWhere(userId: string, role: ClinicianRoleFilter): Prisma.ClientWhereInput {
  const primary: Prisma.ClientWhereInput = { assignedToId: userId };
  const team: Prisma.ClientWhereInput = { treatmentTeamMembers: { some: { providerId: userId } } };
  if (role === 'primary') return primary;
  if (role === 'team') return { AND: [team, { NOT: primary }] };
  return { OR: [primary, team] };
}

export function upcomingAppointmentWhere(now: Date): Prisma.AppointmentWhereInput {
  return { startsAt: { gte: now }, status: { in: [...UPCOMING_APPOINTMENT_STATUSES] } };
}

/**
 * No primary clinician and nobody on the care team (the waitlist / "needs assignment" set). A
 * non-clinical assignee (e.g. the admin an import defaulted to) counts as no primary clinician
 * (src/lib/clients/careTeam.ts noClinicalPrimaryWhere).
 */
export function unassignedWhere(): Prisma.ClientWhereInput {
  return { AND: [noClinicalPrimaryWhere(), { treatmentTeamMembers: { none: {} } }] };
}

/**
 * Plain column / relation filters. Program 'medical' and 'iop' / 'php' (no Prisma relation) and
 * "my caseload" are added by the caller because they need other modules or a lookup.
 */
export function clientFilterWheres(
  q: Pick<ClientListQuery, 'status' | 'locationId' | 'clinicianId' | 'clinicianRole' | 'payer' | 'risk' | 'program' | 'noUpcoming' | 'needsDemographics' | 'unassigned'>,
  opts: { insurance: boolean; now?: Date }
): Prisma.ClientWhereInput[] {
  const now = opts.now ?? new Date();
  const and: Prisma.ClientWhereInput[] = [];
  if (q.status) and.push({ status: q.status });
  if (q.locationId) and.push({ locationId: q.locationId });
  if (q.clinicianId) and.push(clinicianWhere(q.clinicianId, q.clinicianRole));
  if (q.payer && opts.insurance) and.push({ insurancePayer: { equals: q.payer, mode: 'insensitive' } });
  if (q.risk) and.push({ riskLevel: q.risk });
  if (q.program === 'prp') and.push({ prpEnrollments: { some: { status: { in: PRP_ENROLLED_STATUSES } } } });
  if (q.noUpcoming) and.push({ appointments: { none: upcomingAppointmentWhere(now) } });
  if (q.needsDemographics) and.push(needsDemographicsWhere());
  if (q.unassigned) and.push(unassignedWhere());
  return and;
}

/** Filters that disclose clinical / financial facts: protected (locked) records are left out when one is on. */
export function hasPhiRevealingFilter(q: Partial<Pick<ClientListQuery, 'risk' | 'payer' | 'program' | 'needsDemographics' | 'noUpcoming'>>): boolean {
  return Boolean(q.risk || q.payer || q.program || q.needsDemographics || q.noUpcoming);
}

// ─── Sorting ────────────────────────────────────────────────────────────────

export type NameSortInput = {
  name?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
};

/**
 * Sort name: legal last + first; when the legal fields are empty, split the display name
 * ("First M. Last"). Lower-cased for case-insensitive sorting.
 */
export function clientSortName(c: NameSortInput): { last: string; first: string } {
  const legalLast = (c.legalLastName ?? '').trim();
  const legalFirst = (c.legalFirstName ?? '').trim();
  if (legalLast || legalFirst) {
    const fallback = !legalLast ? splitFullName(c.name).lastName : '';
    return { last: (legalLast || fallback).toLowerCase(), first: legalFirst.toLowerCase() };
  }
  const split = splitFullName(c.name);
  return { last: split.lastName.toLowerCase(), first: split.firstName.toLowerCase() };
}

/** Letter-bar bucket for a client: first letter of the sort last name, or '#'. */
export function lastNameInitial(c: NameSortInput): string {
  const ch = clientSortName(c).last.normalize('NFD').charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

export function matchesLetter(c: NameSortInput, letter: string | undefined): boolean {
  return !letter || lastNameInitial(c) === letter;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export type SortableClient = NameSortInput & {
  id: string;
  mrn?: string | null;
  dateOfBirth?: Date | null;
  createdAt?: Date | null;
  status?: string | null;
  nextAppointmentAt?: Date | null;
  lastSeenAt?: Date | null;
};

const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, INACTIVE: 1, DISCHARGED: 2 };

function cmpText(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Last, first, then id: the stable tiebreak for every sort. */
function cmpName(a: SortableClient, b: SortableClient): number {
  const na = clientSortName(a);
  const nb = clientSortName(b);
  return cmpText(na.last, nb.last) || cmpText(na.first, nb.first) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function primaryValue(c: SortableClient, key: ClientSortKey): string | number | null {
  switch (key) {
    case 'last': {
      const n = clientSortName(c);
      return n.last || null;
    }
    case 'first': {
      const n = clientSortName(c);
      return n.first || null;
    }
    case 'mrn':
      return c.mrn?.trim() || null;
    case 'dob':
      return c.dateOfBirth ? c.dateOfBirth.getTime() : null;
    case 'nextAppt':
      return c.nextAppointmentAt ? c.nextAppointmentAt.getTime() : null;
    case 'lastSeen':
      return c.lastSeenAt ? c.lastSeenAt.getTime() : null;
    case 'added':
      return c.createdAt ? c.createdAt.getTime() : null;
    case 'status':
      return c.status ? STATUS_ORDER[c.status] ?? 9 : null;
  }
}

/** Comparator for a sort key and direction. Missing values sort last in both directions. */
export function compareClients(key: ClientSortKey, dir: SortDir): (a: SortableClient, b: SortableClient) => number {
  const sign = dir === 'desc' ? -1 : 1;
  return (a, b) => {
    const va = primaryValue(a, key);
    const vb = primaryValue(b, key);
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    if (va != null && vb != null && va !== vb) {
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : cmpText(String(va), String(vb));
      if (c !== 0) return sign * c;
    }
    // Ties (and missing values): last name, first name, id, always A–Z
    return cmpName(a, b);
  };
}

export function sortClients<T extends SortableClient>(rows: T[], key: ClientSortKey, dir: SortDir): T[] {
  return [...rows].sort(compareClients(key, dir));
}

/** Display "Last, First" (+ preferred) for list rows; falls back to the display name. */
export function listDisplayName(c: NameSortInput & { preferredName?: string | null; nameSuffix?: string | null }): {
  primary: string;
  preferred: string | null;
} {
  const last = (c.legalLastName ?? '').trim();
  const first = (c.legalFirstName ?? '').trim();
  let primary: string;
  if (last && first) primary = `${last}${c.nameSuffix?.trim() ? ` ${c.nameSuffix.trim()}` : ''}, ${first}`;
  else {
    const s = splitFullName(c.name);
    primary = s.lastName && s.firstName ? `${s.lastName}, ${s.firstName}` : (c.name ?? '').trim();
  }
  const pref = (c.preferredName ?? '').trim();
  const firstForCompare = first || splitFullName(c.name).firstName;
  return { primary, preferred: pref && pref.toLowerCase() !== firstForCompare.toLowerCase() ? pref : null };
}

/** Whole years on `now` from an ISO date (YYYY-MM-DD), or null. */
export function ageFromDob(dob: string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/** Comparator for name-only pickers (A–Z by last name, then first). */
export function compareByLastName(a: NameSortInput, b: NameSortInput): number {
  const na = clientSortName(a);
  const nb = clientSortName(b);
  return cmpText(na.last, nb.last) || cmpText(na.first, nb.first);
}

// ─── Page state <-> URL ─────────────────────────────────────────────────────

export type ClientListViewState = {
  q: string;
  sort: ClientSortKey;
  dir: SortDir;
  letter: string;
  status: ClientStatusValue | 'ALL';
  clinicianId: string;
  mine: boolean;
  payer: string;
  risk: ClientRiskValue | '';
  program: ClientProgramValue | '';
  noUpcoming: boolean;
  needsDemographics: boolean;
  unassigned: boolean;
  pageSize: number;
  page: number;
};

export const DEFAULT_VIEW_STATE: ClientListViewState = {
  q: '',
  sort: 'last',
  dir: 'asc',
  letter: '',
  status: 'ACTIVE',
  clinicianId: '',
  mine: false,
  payer: '',
  risk: '',
  program: '',
  noUpcoming: false,
  needsDemographics: false,
  unassigned: false,
  pageSize: 50,
  page: 0,
};

/** Page URL (?sort=last&dir=asc&status=ACTIVE...) -> view state; only non-default values are in the URL. */
export function viewStateFromParams(params: URLSearchParams, base: ClientListViewState = DEFAULT_VIEW_STATE): ClientListViewState {
  const s = { ...base };
  const sort = oneOf(CLIENT_SORT_KEYS, params.get('sort'));
  if (sort) {
    s.sort = sort;
    const dir = params.get('dir');
    s.dir = dir === 'asc' || dir === 'desc' ? dir : DEFAULT_SORT_DIR[sort];
  }
  if (params.has('q')) s.q = (params.get('q') ?? '').slice(0, 120);
  const letter = (params.get('letter') ?? '').toUpperCase();
  if ((LETTERS as readonly string[]).includes(letter)) s.letter = letter;
  const status = (params.get('status') ?? '').toUpperCase();
  if (status === 'ALL' || (CLIENT_STATUSES as readonly string[]).includes(status)) s.status = status as ClientListViewState['status'];
  if (params.has('clinicianId')) s.clinicianId = params.get('clinicianId') ?? '';
  if (params.has('mine')) s.mine = flag(params.get('mine'));
  if (params.has('payer')) s.payer = params.get('payer') ?? '';
  const risk = oneOf(CLIENT_RISKS, params.get('risk')?.toUpperCase());
  if (risk) s.risk = risk;
  const program = oneOf(CLIENT_PROGRAMS, params.get('program'));
  if (program) s.program = program;
  if (params.has('noUpcoming')) s.noUpcoming = flag(params.get('noUpcoming'));
  if (params.has('needsDemographics')) s.needsDemographics = flag(params.get('needsDemographics'));
  if (params.has('unassigned')) s.unassigned = flag(params.get('unassigned'));
  const size = parseInt(params.get('pageSize') ?? '', 10);
  if ((CLIENT_PAGE_SIZES as readonly number[]).includes(size)) s.pageSize = size;
  const page = parseInt(params.get('page') ?? '', 10);
  if (Number.isFinite(page) && page >= 1) s.page = page - 1;
  return s;
}

/** View state -> page URL query (non-default values only; page is 1-based in the URL). */
export function viewStateToParams(s: ClientListViewState): URLSearchParams {
  const p = new URLSearchParams();
  const d = DEFAULT_VIEW_STATE;
  if (s.q.trim()) p.set('q', s.q.trim());
  if (s.sort !== d.sort || s.dir !== d.dir) {
    p.set('sort', s.sort);
    p.set('dir', s.dir);
  }
  if (s.letter) p.set('letter', s.letter);
  if (s.status !== d.status) p.set('status', s.status);
  if (s.clinicianId) p.set('clinicianId', s.clinicianId);
  if (s.mine) p.set('mine', '1');
  if (s.payer) p.set('payer', s.payer);
  if (s.risk) p.set('risk', s.risk);
  if (s.program) p.set('program', s.program);
  if (s.noUpcoming) p.set('noUpcoming', '1');
  if (s.needsDemographics) p.set('needsDemographics', '1');
  if (s.unassigned) p.set('unassigned', '1');
  if (s.pageSize !== d.pageSize) p.set('pageSize', String(s.pageSize));
  if (s.page > 0) p.set('page', String(s.page + 1));
  return p;
}

/** View state -> GET /api/clients query (always explicit sort, status, paging, total). */
export function viewStateToApiParams(s: ClientListViewState, extra: { locationId?: string } = {}): URLSearchParams {
  const p = new URLSearchParams({
    sort: s.sort,
    dir: s.dir,
    limit: String(s.pageSize),
    skip: String(s.page * s.pageSize),
    withTotal: '1',
  });
  if (s.q.trim()) p.set('q', s.q.trim());
  if (s.letter) p.set('letter', s.letter);
  if (s.status !== 'ALL') p.set('status', s.status);
  if (extra.locationId) p.set('locationId', extra.locationId);
  if (s.clinicianId) p.set('clinicianId', s.clinicianId);
  if (s.mine) p.set('mine', '1');
  if (s.payer) p.set('payer', s.payer);
  if (s.risk) p.set('risk', s.risk);
  if (s.program) p.set('program', s.program);
  if (s.noUpcoming) p.set('noUpcoming', '1');
  if (s.needsDemographics) p.set('needsDemographics', '1');
  if (s.unassigned) p.set('unassigned', '1');
  return p;
}
