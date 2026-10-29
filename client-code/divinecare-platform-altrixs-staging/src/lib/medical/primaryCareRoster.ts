/**
 * "Primary care patients" roster (/dashboard/medical/patients). Pure: no prisma, safe for the
 * browser bundle and tests. The DB source lives in primaryCareRosterDb.ts.
 *
 * - Who is listed: primary-care patients per primaryCarePatientWhere() (medical records,
 *   Client.primaryCare from primary-care intake, or Valant "Family Practice" rows), ANDed with
 *   the viewer's client access (org; medical roles: care team; caseload roles: own caseload).
 * - One patient record: a row opens the client chart on its Medical tab group (?from=medical
 *   gives the chart a "Back to Primary care patients" link).
 * - Columns are shown only to roles that may open the matching primary care page; the server
 *   leaves the data out (null) for the others. Protected (Part 2 / sensitive) clients the viewer
 *   may not open are listed masked, as on the client list.
 * - Preventive care is not stored yet, so there is no preventive care column.
 */
import type { Prisma } from '@prisma/client';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canViewLabs } from '@/lib/labs/access';
import {
  isMedicalViewerRole,
  MEDICAL_PROBLEM_LIST_PATH,
  MEDICAL_TAB_PATHS,
  medicalChartHref,
  primaryCarePatientWhere,
} from '@/lib/medical/medicalProgram';
import { PCP_REVIEW_STATUSES, PCP_TEAM_ROLE, isPcpTeamRole, type PcpReviewDisplay, type PcpStatus } from '@/lib/medical/pcpAssignment';

type ClientWhere = Prisma.ClientWhereInput;

export const PRIMARY_CARE_PATIENTS_HREF = '/dashboard/medical/patients';
export const PRIMARY_CARE_INTAKE_HREF = '/dashboard/medical/patients/intake';
/** ?from= value the chart reads to link back to this roster */
export const FROM_PRIMARY_CARE = 'medical';
export const PRIMARY_CARE_PATIENTS_LABEL = 'Primary care patients';

export const ROSTER_PAGE_SIZE = 25;
export const ROSTER_MAX_PAGE_SIZE = 100;
export const ROSTER_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCHARGED', 'all'] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export const ROSTER_SORTS = ['name', 'pcp'] as const;
export type RosterSort = (typeof ROSTER_SORTS)[number];
/** Most rows the PCP sort / "PCP needs review" filter will order in memory */
export const ROSTER_MAX_SORT_ROWS = 5000;

export type RosterQuery = {
  page: number;
  pageSize: number;
  q: string;
  locationId: string | null;
  providerId: string | null;
  status: RosterStatus;
  /** PCP filter: a staff user id, or 'none' (no PCP care team member) */
  pcp: string | null;
  /** "PCP needs review": MISMATCH / MISSING / AMBIGUOUS (src/lib/medical/pcpAssignment.ts) */
  pcpReview: boolean;
  sort: RosterSort;
};

/** Chart URL for a roster row: the client chart, Medical tab group, with the back link */
export function primaryCareChartHref(clientId: string): string {
  return `${medicalChartHref(clientId)}&from=${FROM_PRIMARY_CARE}`;
}

const intParam = (v: string | null, fallback: number) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const idParam = (v: string | null) => {
  const s = (v ?? '').trim();
  return s && s !== 'all' && s.length <= 64 && /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
};

export function parseRosterQuery(sp: URLSearchParams): RosterQuery {
  const statusRaw = (sp.get('status') ?? '').trim();
  const statusUp = statusRaw.toUpperCase();
  const status: RosterStatus =
    statusRaw.toLowerCase() === 'all'
      ? 'all'
      : (ROSTER_STATUSES as readonly string[]).includes(statusUp)
        ? (statusUp as RosterStatus)
        : 'ACTIVE';
  return {
    page: intParam(sp.get('page'), 1),
    pageSize: Math.min(ROSTER_MAX_PAGE_SIZE, intParam(sp.get('pageSize'), ROSTER_PAGE_SIZE)),
    q: (sp.get('q') ?? '').trim().slice(0, 100),
    locationId: idParam(sp.get('locationId')),
    providerId: idParam(sp.get('providerId')),
    status,
    pcp: (sp.get('pcp') ?? '').trim() === 'none' ? 'none' : idParam(sp.get('pcp')),
    pcpReview: sp.get('pcpReview') === '1',
    sort: sp.get('sort') === 'pcp' ? 'pcp' : 'name',
  };
}

/** A DOB typed in the search box (YYYY-MM-DD, MM/DD/YYYY or M/D/YYYY) as a one-day UTC range */
export function parseDobQuery(q: string): { gte: Date; lt: Date } | null {
  const s = q.trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) {
    [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else {
    hit = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
    if (!hit) return null;
    [m, d, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  }
  const gte = new Date(Date.UTC(y, m - 1, d));
  if (gte.getUTCFullYear() !== y || gte.getUTCMonth() !== m - 1 || gte.getUTCDate() !== d) return null;
  return { gte, lt: new Date(gte.getTime() + 86_400_000) };
}

/** Search box: name or MRN (contains), or an exact date of birth */
export function rosterSearchWhere(q: string): ClientWhere | null {
  const s = q.trim();
  if (!s) return null;
  const dob = parseDobQuery(s);
  if (dob) return { dateOfBirth: dob };
  return {
    OR: [
      { name: { contains: s, mode: 'insensitive' } },
      { legalLastName: { contains: s, mode: 'insensitive' } },
      { mrn: { contains: s, mode: 'insensitive' } },
    ],
  };
}

/** Patients a provider is on: care team member or primary care visit provider */
export function rosterProviderWhere(providerId: string): ClientWhere {
  return {
    OR: [
      { treatmentTeamMembers: { some: { providerId } } },
      { medicalVisits: { some: { providerId } } },
    ],
  };
}

/** PCP filter: the "Primary Care Provider" care team member (canonical PCP; pcpAssignment.ts) */
export function rosterPcpWhere(pcp: string): ClientWhere {
  const role = { equals: PCP_TEAM_ROLE, mode: 'insensitive' as const };
  if (pcp === 'none') return { NOT: { treatmentTeamMembers: { some: { role, providerId: { not: null } } } } };
  return { treatmentTeamMembers: { some: { role, providerId: pcp } } };
}

/**
 * Full where-clause for the roster. `access` is clientAccessWhere for the viewer (org + care
 * team / caseload). `locationId` must already be checked against the org's primary-care locations.
 */
export function primaryCareRosterWhere(input: { access: ClientWhere; query: RosterQuery }): ClientWhere {
  const { access, query } = input;
  const and: ClientWhere[] = [access, primaryCarePatientWhere()];
  if (query.status !== 'all') and.push({ status: query.status });
  if (query.locationId) and.push({ locationId: query.locationId });
  if (query.providerId) and.push(rosterProviderWhere(query.providerId));
  if (query.pcp) and.push(rosterPcpWhere(query.pcp));
  const search = rosterSearchWhere(query.q);
  if (search) and.push(search);
  return { AND: and };
}

export type RosterColumns = {
  /** Active problems + needs-coding count */
  problems: boolean;
  /** Last primary-care visit */
  visits: boolean;
  /** Last vitals date */
  vitals: boolean;
  /** Labs awaiting review / standing orders due */
  labs: boolean;
};

/** Column visibility follows the page rules of the matching primary care worklists */
export function rosterColumnsForRole(role: string | null | undefined): RosterColumns {
  return {
    problems: isMedicalViewerRole(role) || canAccessPath(role, MEDICAL_PROBLEM_LIST_PATH),
    visits: canAccessPath(role, MEDICAL_TAB_PATHS['medical-visits']),
    vitals: canAccessPath(role, MEDICAL_TAB_PATHS['medical-vitals']),
    labs: canViewLabs(role),
  };
}

export type CareTeamEntry = {
  providerId: string | null;
  name: string;
  credentials: string | null;
  isPrimary: boolean;
  /** care team role ("Primary Care Provider" = the PCP) */
  role?: string | null;
};

export type PrimaryCareProvider = { id: string | null; name: string; source: 'care_team' | 'assigned_pcp_text' };

/**
 * The recorded PCP (pcpAssignment.ts): the "Primary Care Provider" care team member, else the
 * MedicalPatient.assignedPcp text (shown, not a staff link). Never inferred from visits; the
 * "PCP needs review" filter compares it with the visits.
 */
export function pickPrimaryCareProvider(team: CareTeamEntry[], assignedPcpText: string | null): PrimaryCareProvider | null {
  const member = team.find((m) => isPcpTeamRole(m.role) && m.providerId && m.name.trim());
  if (member) {
    const name = member.credentials ? `${member.name.trim()}, ${member.credentials.trim()}` : member.name.trim();
    return { id: member.providerId, name, source: 'care_team' };
  }
  const text = (assignedPcpText ?? '').trim();
  return text ? { id: null, name: text, source: 'assigned_pcp_text' } : null;
}

/** PCP sort key: recorded PCP name (no PCP sorts last), then patient name, then id */
export function comparePcpSort(
  a: { id: string; name: string; pcpName: string | null },
  b: { id: string; name: string; pcpName: string | null }
): number {
  const pa = (a.pcpName ?? '').trim().toLowerCase();
  const pb = (b.pcpName ?? '').trim().toLowerCase();
  if (pa !== pb) return !pa ? 1 : !pb ? -1 : pa.localeCompare(pb);
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

const INACTIVE_PROBLEM = new Set(['resolved', 'inactive', 'entered in error', 'entered-in-error', 'refuted']);

export function isActiveProblem(status: string | null | undefined): boolean {
  return !INACTIVE_PROBLEM.has((status ?? 'Active').trim().toLowerCase());
}

export function problemCounts(problems: { icd10Code: string | null; status: string | null }[]): { active: number; needsCoding: number } {
  const active = problems.filter((p) => isActiveProblem(p.status));
  return { active: active.length, needsCoding: active.filter((p) => !(p.icd10Code ?? '').trim()).length };
}

/** "F" / "M" / gender as recorded; null when not documented */
export function sexLabel(gender: string | null | undefined): string | null {
  const g = (gender ?? '').trim();
  if (!g || /^unknown$/i.test(g)) return null;
  if (/^f(emale)?$/i.test(g)) return 'F';
  if (/^m(ale)?$/i.test(g)) return 'M';
  return g;
}

/** Whole years on `now`; null when the DOB is missing */
export function ageOn(dob: Date | null | undefined, now: Date): number | null {
  if (!dob || Number.isNaN(dob.getTime())) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// ─── Loader (DB access injected) ─────────────────────────────────────────────

export type RosterClientRow = {
  id: string;
  name: string;
  mrn: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  status: string;
  locationName: string | null;
  team: CareTeamEntry[];
  /** MedicalPatient.assignedPcp (legacy text; mirrors the PCP member's name) */
  assignedPcpText?: string | null;
  lastVisit: { visitDate: Date; visitType: string; providerId: string | null; providerName: string | null; providerUserName: string | null } | null;
  lastVitalsAt: Date | null;
  problems: { icd10Code: string | null; status: string | null }[];
  nextAppointment: { startsAt: Date; type: string; clinicianName: string | null } | null;
};

export type LabSignal = { unreviewed: number; critical: number; standingDue: number; standingOverdue: number };

export type RosterSource = {
  primaryCareLocations(organizationId: string): Promise<{ id: string; name: string }[]>;
  /** Physicians / medical NPs in the org (filter choices; staff names only) */
  providers(organizationId: string): Promise<{ id: string; name: string }[]>;
  count(where: ClientWhere): Promise<number>;
  page(where: ClientWhere, skip: number, take: number, now: Date): Promise<RosterClientRow[]>;
  /** Staff user id -> role, for care team members (the PCP column no longer depends on it) */
  userRoles?(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
  /** PCP status per client (pcpAssignment.ts). Optional: without it there is no review flag / filter. */
  pcpStatuses?(organizationId: string, clientIds: string[], now: Date): Promise<Map<string, PcpStatus>>;
  /** Review display (to confirm + contenders / not assigned) for AMBIGUOUS / NO_EVIDENCE rows; reuses pcpStatuses' decisions */
  pcpReviews?(organizationId: string, clientIds: string[], now: Date): Promise<Map<string, PcpReviewDisplay>>;
  /** Every matching client (id, name, recorded PCP name) for the PCP sort / review filter; capped */
  sortRows?(where: ClientWhere, max: number): Promise<{ id: string; name: string; pcpName: string | null }[]>;
  /**
   * Protected records among `clientIds`: id -> alias for each one the viewer may NOT open.
   * null = lookup failed (every row is then masked: fail closed).
   */
  lockedAliases(clientIds: string[]): Promise<Map<string, string | null> | null>;
  labSignals(organizationId: string, clientIds: string[], now: Date): Promise<Map<string, LabSignal>>;
};

export type RosterViewer = { organizationId: string; userId: string; role: string };

export type RosterRow = {
  clientId: string;
  href: string;
  locked: boolean;
  name: string;
  mrn: string | null;
  dob: string | null;
  age: number | null;
  sex: string | null;
  status: string | null;
  location: string | null;
  pcp: PrimaryCareProvider | null;
  /** PCP check (MATCH / MISMATCH / ...); null when not computed or the row is masked */
  pcpStatus: PcpStatus | null;
  /** No staff PCP: "PCP: to confirm" with every contender, or "PCP: not assigned"; null otherwise / masked */
  pcpReview: PcpReviewDisplay | null;
  lastVisit: { date: string; type: string } | null;
  nextAppointment: { startsAt: string; type: string; clinician: string | null } | null;
  problems: { active: number; needsCoding: number } | null;
  lastVitalsAt: string | null;
  labs: LabSignal | null;
};

export type RosterResult = {
  rows: RosterRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  columns: RosterColumns;
  filters: { locations: { id: string; name: string }[]; providers: { id: string; name: string }[] };
  /** the PCP sort / review filter hit ROSTER_MAX_SORT_ROWS (narrow the filters) */
  truncated: boolean;
  /** Filters actually applied (an unknown location id is dropped) */
  query: RosterQuery;
  maskedCount: number;
};

export async function loadPrimaryCareRoster(
  source: RosterSource,
  viewer: RosterViewer,
  access: ClientWhere,
  requested: RosterQuery,
  now = new Date()
): Promise<RosterResult> {
  const columns = rosterColumnsForRole(viewer.role);
  const [locations, providers] = await Promise.all([
    source.primaryCareLocations(viewer.organizationId),
    source.providers(viewer.organizationId),
  ]);
  // Location filter only for this org's primary-care locations (no cross-org ids)
  const query: RosterQuery = {
    ...requested,
    locationId: requested.locationId && locations.some((l) => l.id === requested.locationId) ? requested.locationId : null,
  };
  const where = primaryCareRosterWhere({ access, query });
  let total: number;
  let pageCount: number;
  let page: number;
  let raw: RosterClientRow[];
  let truncated = false;
  const statuses = new Map<string, PcpStatus>();
  const canReview = Boolean(source.pcpStatuses && source.sortRows);
  if ((query.pcpReview || query.sort === 'pcp') && canReview) {
    // In-memory order / filter over the matching ids, then one page query by id
    let list = await source.sortRows!(where, ROSTER_MAX_SORT_ROWS + 1);
    truncated = list.length > ROSTER_MAX_SORT_ROWS;
    list = list.slice(0, ROSTER_MAX_SORT_ROWS);
    if (query.pcpReview) {
      const all = await source.pcpStatuses!(viewer.organizationId, list.map((x) => x.id), now);
      for (const [id, st] of all) statuses.set(id, st);
      list = list.filter((x) => {
        const st = statuses.get(x.id);
        return Boolean(st && PCP_REVIEW_STATUSES.includes(st));
      });
    }
    if (query.sort === 'pcp') list.sort(comparePcpSort);
    total = list.length;
    pageCount = Math.max(1, Math.ceil(total / query.pageSize));
    page = Math.min(query.page, pageCount);
    const pageIds = list.slice((page - 1) * query.pageSize, page * query.pageSize).map((x) => x.id);
    // ids came from `where`; AND it again so the page query keeps the viewer scope on its own
    const fetched = pageIds.length ? await source.page({ AND: [where, { id: { in: pageIds } }] }, 0, pageIds.length, now) : [];
    const order = new Map(pageIds.map((id, i) => [id, i]));
    raw = fetched.filter((r) => order.has(r.id)).sort((x, y) => order.get(x.id)! - order.get(y.id)!);
  } else {
    total = await source.count(where);
    pageCount = Math.max(1, Math.ceil(total / query.pageSize));
    page = Math.min(query.page, pageCount);
    raw = total ? await source.page(where, (page - 1) * query.pageSize, query.pageSize, now) : [];
  }

  const ids = raw.map((r) => r.id);
  const missingStatus = ids.filter((id) => !statuses.has(id));
  const [locked, labs, pageStatuses] = await Promise.all([
    source.lockedAliases(ids),
    columns.labs && ids.length ? source.labSignals(viewer.organizationId, ids, now) : Promise.resolve(new Map<string, LabSignal>()),
    source.pcpStatuses && missingStatus.length ? source.pcpStatuses(viewer.organizationId, missingStatus, now) : Promise.resolve(new Map<string, PcpStatus>()),
  ]);
  for (const [id, st] of pageStatuses) statuses.set(id, st);
  // "PCP: to confirm" (with every contender) / "PCP: not assigned"; unlocked rows only
  const reviewIds = locked === null ? [] : ids.filter((id) => !locked.has(id) && (statuses.get(id) === 'AMBIGUOUS' || statuses.get(id) === 'NO_EVIDENCE'));
  const reviews =
    source.pcpReviews && reviewIds.length
      ? await source.pcpReviews(viewer.organizationId, reviewIds, now).catch(() => new Map<string, PcpReviewDisplay>())
      : new Map<string, PcpReviewDisplay>();

  let maskedCount = 0;
  const rows: RosterRow[] = raw.map((c) => {
    const isLocked = locked === null || locked.has(c.id);
    if (isLocked) {
      maskedCount += 1;
      return {
        clientId: c.id,
        href: primaryCareChartHref(c.id),
        locked: true,
        name: (locked?.get(c.id) || '').trim() || 'Protected Client',
        mrn: null, dob: null, age: null, sex: null, status: null, location: null, pcp: null, pcpStatus: null, pcpReview: null,
        lastVisit: null, nextAppointment: null, problems: null, lastVitalsAt: null, labs: null,
      };
    }
    return {
      clientId: c.id,
      href: primaryCareChartHref(c.id),
      locked: false,
      name: c.name,
      mrn: c.mrn,
      dob: c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : null,
      age: ageOn(c.dateOfBirth, now),
      sex: sexLabel(c.gender),
      status: c.status,
      location: c.locationName,
      pcp: pickPrimaryCareProvider(c.team, c.assignedPcpText ?? null),
      pcpStatus: statuses.get(c.id) ?? null,
      pcpReview: reviews.get(c.id) ?? null,
      lastVisit: columns.visits && c.lastVisit ? { date: c.lastVisit.visitDate.toISOString(), type: c.lastVisit.visitType } : null,
      nextAppointment: c.nextAppointment
        ? { startsAt: c.nextAppointment.startsAt.toISOString(), type: c.nextAppointment.type, clinician: c.nextAppointment.clinicianName }
        : null,
      problems: columns.problems ? problemCounts(c.problems) : null,
      lastVitalsAt: columns.vitals && c.lastVitalsAt ? c.lastVitalsAt.toISOString() : null,
      labs: columns.labs ? labs.get(c.id) ?? { unreviewed: 0, critical: 0, standingDue: 0, standingOverdue: 0 } : null,
    };
  });

  return {
    rows,
    total,
    page,
    pageSize: query.pageSize,
    pageCount,
    columns,
    filters: { locations, providers },
    truncated,
    query: { ...query, page, pcpReview: query.pcpReview && canReview, sort: canReview ? query.sort : 'name' },
    maskedCount,
  };
}
