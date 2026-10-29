/**
 * Primary care overview (/dashboard/medical, GET /api/medical/overview). Pure: no prisma, safe
 * for the browser bundle and tests. The DB source lives in primaryCareOverviewDb.ts.
 *
 * Everything here is read from real records; nothing is sample data. Scope follows the
 * Primary care patients roster (primaryCareRoster.ts):
 * - Population: primary-care patients (primaryCarePatientWhere) ANDed with the viewer's client
 *   access (clientAccessWhere: org; medical roles: care team via medicalCareTeamClientWhere;
 *   caseload roles: own caseload).
 * - Today: appointments starting inside today's PRACTICE-clock day (practiceDay.ts).
 *   A primary-care appointment is one with a physician / medical NP as the clinician.
 *   Physicians / medical NPs see their own; everyone else sees primary-care appointments for the
 *   clients they may access (leadership: the whole org; medical assistant: care team).
 * - Work queues and panel summary are counts only. A queue the viewer's role may not open is
 *   left out (null), using the same page rules as the roster columns.
 * - Protected (Part 2 / sensitive) records the viewer may not open are listed masked in Today.
 */
import type { Prisma } from '@prisma/client';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canViewLabs } from '@/lib/labs/access';
import { canPrescribe } from '@/types/roles';
import { formatPracticeDate, formatPracticeTime } from '@/lib/time/practiceTime';
import { practiceTodayBounds } from '@/lib/dashboard/practiceDay';
import { practiceMonthStart } from '@/lib/dashboard/practiceMonth';
import { MEDICAL_LABS_PATH, MEDICAL_PROBLEM_LIST_PATH, MEDICAL_TAB_PATHS, primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import { PRIMARY_CARE_INTAKE_HREF, PRIMARY_CARE_PATIENTS_HREF, primaryCareChartHref } from '@/lib/medical/primaryCareRoster';
import { canRoomPatients, isPrimaryCareProvider as isPcProviderRole, roomingChip, type RoomingChip } from '@/lib/medical/primaryCareWorkflow';

type ClientWhere = Prisma.ClientWhereInput;
type AppointmentWhere = Prisma.AppointmentWhereInput;
type VisitWhere = Prisma.MedicalVisitWhereInput;

export const MEDICAL_OVERVIEW_PATH = '/dashboard/medical';
export const MEDICAL_OVERVIEW_API = '/api/medical/overview';
export const MEDICAL_VITALS_HREF = MEDICAL_TAB_PATHS['medical-vitals'];
export const MEDICAL_VISITS_HREF = MEDICAL_TAB_PATHS['medical-visits'];
export const INBOX_HREF = '/dashboard/inbox';
/** "Seen recently" window for the panel summary */
export const SEEN_WINDOW_DAYS = 90;
export const TODAY_LIMIT = 200;

/** Roles whose own appointments are "primary care" (the clinician on a primary-care visit) */
export const PRIMARY_CARE_PROVIDER_ROLES = ['PHYSICIAN', 'MEDICAL_NP'] as const;

export type OverviewScope = 'provider' | 'care_team' | 'caseload' | 'organization';

const up = (role: string | null | undefined) => (role ?? '').trim().toUpperCase();

export function isPrimaryCareProviderRole(role: string | null | undefined): boolean {
  return (PRIMARY_CARE_PROVIDER_ROLES as readonly string[]).includes(up(role));
}

/**
 * provider: physician / medical NP (own schedule, own unsigned visits, own Rcopia queue);
 * care_team: medical assistant; caseload: other caseload roles (own caseload);
 * organization: leadership and front-office roles (all primary care in the org).
 * The client population itself always comes from clientAccessWhere, so this only picks the
 * appointment / visit owner filter and the label.
 */
export function overviewScopeForRole(role: string | null | undefined, isCaseload: boolean): OverviewScope {
  if (isPrimaryCareProviderRole(role)) return 'provider';
  if (up(role) === 'MEDICAL_ASSISTANT') return 'care_team';
  if (isCaseload) return 'caseload';
  return 'organization';
}

/** Staff user who is a physician / medical NP (primary role or an additional role) */
export function primaryCareClinicianWhere(): Prisma.UserWhereInput {
  const roles = [...PRIMARY_CARE_PROVIDER_ROLES];
  return { OR: [{ role: { in: roles } }, { roles: { hasSome: roles } }] };
}

/** Primary-care patients the viewer may access */
export function overviewPopulationWhere(access: ClientWhere): ClientWhere {
  return { AND: [access, primaryCarePatientWhere()] };
}

/** Today's primary-care appointments (cancelled visits are not on the day's schedule) */
export function todayAppointmentsWhere(input: {
  access: ClientWhere;
  scope: OverviewScope;
  userId: string;
  start: Date;
  end: Date;
}): AppointmentWhere {
  const and: AppointmentWhere[] = [
    { client: input.access },
    { startsAt: { gte: input.start, lt: input.end } },
    { status: { not: 'CANCELLED' } },
    input.scope === 'provider' ? { clinicianId: input.userId } : { clinician: primaryCareClinicianWhere() },
  ];
  return { AND: and };
}

/** Primary-care visit notes not signed yet (provider: own notes) */
export function unsignedVisitsWhere(input: { population: ClientWhere; scope: OverviewScope; userId: string }): VisitWhere {
  const and: VisitWhere[] = [{ client: input.population }, { signedAt: null }];
  if (input.scope === 'provider') and.push({ providerId: input.userId });
  return { AND: and };
}

/** Problem statuses that are no longer active (same list as the roster's isActiveProblem) */
export const INACTIVE_PROBLEM_STATUSES = ['Resolved', 'Inactive', 'Entered in error', 'Entered-in-error', 'Refuted'];

/** Active problems with no ICD-10 code on file ("needs coding"; codes are never guessed) */
export function problemsNeedingCodingWhere(population: ClientWhere): Prisma.MedicalProblemWhereInput {
  return {
    AND: [
      { client: population },
      { OR: [{ icd10Code: null }, { icd10Code: '' }] },
      // status is required on MedicalProblem (default "Active"), so no null case
      ...INACTIVE_PROBLEM_STATUSES.map((s) => ({ NOT: { status: { equals: s, mode: 'insensitive' as const } } })),
    ],
  };
}

export type OverviewQueues = { visits: boolean; labs: boolean; problems: boolean; vitals: boolean; rx: boolean };

/** Queues follow the page rules of the matching primary care worklists (as the roster columns do) */
export function overviewQueuesForRole(role: string | null | undefined): OverviewQueues {
  return {
    visits: canAccessPath(role, MEDICAL_VISITS_HREF),
    labs: canViewLabs(role),
    problems: canAccessPath(role, MEDICAL_PROBLEM_LIST_PATH),
    vitals: canAccessPath(role, MEDICAL_VITALS_HREF),
    // Refill / RxChange requests are routed to the prescriber; only shown to primary care prescribers
    rx: isPrimaryCareProviderRole(role) && canPrescribe(role),
  };
}

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  CHECKED_IN: 'Checked in',
  IN_SESSION: 'In session',
  COMPLETED: 'Completed',
  NO_SHOW: 'No show',
  LATE_CANCEL: 'Late cancel',
  CANCELLED: 'Cancelled',
};

/** Patient has arrived (vitals are expected from this point on) */
export const ARRIVED_STATUSES = new Set(['CHECKED_IN', 'IN_SESSION', 'COMPLETED']);

// ─── Loader (DB access injected) ─────────────────────────────────────────────

export type TodayAppointmentRow = {
  id: string;
  clientId: string;
  clientName: string;
  startsAt: Date;
  type: string;
  status: string;
  isVirtual: boolean;
  clinicianName: string | null;
};

export type OverviewSource = {
  todayAppointments(where: AppointmentWhere, take: number): Promise<TodayAppointmentRow[]>;
  /** id -> alias for each protected record the viewer may NOT open; null = lookup failed (mask all) */
  lockedAliases(clientIds: string[]): Promise<Map<string, string | null> | null>;
  /** Clients among `clientIds` with a MedicalVital recorded in [start, end) */
  vitalsRecorded(clientIds: string[], start: Date, end: Date): Promise<Set<string>>;
  countClients(where: ClientWhere): Promise<number>;
  clientsByLocation(where: ClientWhere): Promise<{ locationId: string | null; count: number }[]>;
  locationNames(organizationId: string, ids: string[]): Promise<Map<string, string>>;
  countVisits(where: VisitWhere): Promise<number>;
  countProblems(where: Prisma.MedicalProblemWhereInput): Promise<number>;
  labsAwaitingReview(organizationId: string, population: ClientWhere): Promise<{ toReview: number; critical: number }>;
  standingOverdue(organizationId: string, population: ClientWhere, now: Date): Promise<number>;
  /** refills: null when the provider has no Rcopia username on file (requests cannot be routed) */
  rxPending(viewer: OverviewViewer, access: ClientWhere): Promise<{ refills: number | null; rxChanges: number }>;
  /** MA rooming per appointment id (optional: older sources / tests without the table) */
  roomings?(appointmentIds: string[]): Promise<Map<string, { status: string; roomedAt: Date | null; inRoomAt: Date | null }>>;
};

export type OverviewViewer = { organizationId: string; userId: string; role: string; isCaseload: boolean };

export type OverviewTodayRow = {
  id: string;
  /** null for a protected record the viewer cannot open (no chart link) */
  clientId: string | null;
  href: string | null;
  locked: boolean;
  patient: string;
  /** "9:00 AM ET" on the practice clock */
  time: string;
  startsAt: string;
  visitType: string;
  status: string;
  statusLabel: string;
  isVirtual: boolean;
  clinician: string | null;
  /** Arrived and no vitals recorded today (null when the viewer may not see vitals) */
  vitalsMissing: boolean | null;
  /** MA rooming state: Ready / In room with time waiting (null = not roomed, or a protected record) */
  rooming: RoomingChip | null;
};

export type OverviewQueue = { key: string; label: string; count: number; href: string; detail?: string | null };

export type MedicalOverview = {
  scope: OverviewScope;
  timeZone: string;
  date: string;
  dateLabel: string;
  windowStart: string;
  windowEnd: string;
  today: { rows: OverviewTodayRow[]; total: number; truncated: boolean; counts: Record<string, number> };
  queues: OverviewQueue[];
  panel: {
    active: number;
    byLocation: { locationId: string | null; name: string; count: number }[];
    newThisMonth: number;
    seenRecently: number;
    seenWindowDays: number;
  };
  links: { intake: string; patients: string; labs: string; vitals: string };
  /** Viewer may room patients (MA, physician, medical NP) / mark the visit started (providers) */
  workflow: { canRoom: boolean; canMarkInRoom: boolean };
};

export async function loadPrimaryCareOverview(
  source: OverviewSource,
  viewer: OverviewViewer,
  access: ClientWhere,
  opts: { timeZone: string; now?: Date }
): Promise<MedicalOverview> {
  const now = opts.now ?? new Date();
  const { timeZone } = opts;
  const scope = overviewScopeForRole(viewer.role, viewer.isCaseload);
  const queuesAllowed = overviewQueuesForRole(viewer.role);
  const population = overviewPopulationWhere(access);
  const { ymd, start, end } = practiceTodayBounds(timeZone, now);
  const monthStart = practiceMonthStart(timeZone, now);
  const seenSince = new Date(now.getTime() - SEEN_WINDOW_DAYS * 86_400_000);
  const activePopulation: ClientWhere = { AND: [population, { status: 'ACTIVE' }] };

  const appts = await source.todayAppointments(
    todayAppointmentsWhere({ access, scope, userId: viewer.userId, start, end }),
    TODAY_LIMIT + 1
  );
  const truncated = appts.length > TODAY_LIMIT;
  const shown = appts.slice(0, TODAY_LIMIT);
  const clientIds = [...new Set(shown.map((a) => a.clientId))];
  const arrivedIds = [...new Set(shown.filter((a) => ARRIVED_STATUSES.has(a.status)).map((a) => a.clientId))];

  const [locked, vitalsSet, active, byLocationRaw, newThisMonth, seenRecently, unsigned, needsCoding, labs, standing, rx] =
    await Promise.all([
      clientIds.length ? source.lockedAliases(clientIds) : Promise.resolve(new Map<string, string | null>()),
      queuesAllowed.vitals && arrivedIds.length ? source.vitalsRecorded(arrivedIds, start, end) : Promise.resolve(new Set<string>()),
      source.countClients(activePopulation),
      source.clientsByLocation(activePopulation),
      source.countClients({ AND: [population, { primaryCare: true }, { createdAt: { gte: monthStart } }] }),
      source.countClients({ AND: [population, { medicalVisits: { some: { visitDate: { gte: seenSince, lte: now } } } }] }),
      queuesAllowed.visits ? source.countVisits(unsignedVisitsWhere({ population, scope, userId: viewer.userId })) : Promise.resolve(null),
      queuesAllowed.problems ? source.countProblems(problemsNeedingCodingWhere(population)) : Promise.resolve(null),
      queuesAllowed.labs ? source.labsAwaitingReview(viewer.organizationId, population) : Promise.resolve(null),
      queuesAllowed.labs ? source.standingOverdue(viewer.organizationId, population, now) : Promise.resolve(null),
      queuesAllowed.rx ? source.rxPending(viewer, access) : Promise.resolve(null),
    ]);
  const roomingByAppt =
    source.roomings && shown.length
      ? await source.roomings(shown.map((a) => a.id)).catch(() => new Map<string, { status: string; roomedAt: Date | null; inRoomAt: Date | null }>())
      : new Map<string, { status: string; roomedAt: Date | null; inRoomAt: Date | null }>();

  const rows: OverviewTodayRow[] = shown.map((a) => {
    const isLocked = locked === null || locked.has(a.clientId);
    const base = {
      id: a.id,
      time: formatPracticeTime(a.startsAt, timeZone, { withZone: true }),
      startsAt: a.startsAt.toISOString(),
      status: a.status,
      statusLabel: APPOINTMENT_STATUS_LABEL[a.status] ?? a.status,
      isVirtual: a.isVirtual,
      clinician: a.clinicianName,
    };
    if (isLocked) {
      return {
        ...base,
        clientId: null,
        href: null,
        locked: true,
        patient: (locked?.get(a.clientId) || '').trim() || 'Protected Client',
        visitType: 'Protected appointment',
        vitalsMissing: null,
        rooming: null,
      };
    }
    return {
      ...base,
      clientId: a.clientId,
      href: primaryCareChartHref(a.clientId),
      locked: false,
      patient: a.clientName,
      visitType: a.type,
      vitalsMissing: queuesAllowed.vitals ? ARRIVED_STATUSES.has(a.status) && !vitalsSet.has(a.clientId) : null,
      rooming: roomingChip(roomingByAppt.get(a.id) ?? null, now),
    };
  });

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const vitalsMissing = rows.filter((r) => r.vitalsMissing === true).length;
  const queues: OverviewQueue[] = [];
  if (unsigned !== null)
    queues.push({ key: 'unsigned_visits', label: scope === 'provider' ? 'My unsigned visit notes' : 'Unsigned visit notes', count: unsigned, href: MEDICAL_VISITS_HREF });
  if (labs) {
    queues.push({ key: 'labs_to_review', label: 'Lab results to review', count: labs.toReview, href: MEDICAL_LABS_PATH });
    queues.push({ key: 'labs_critical', label: 'Critical lab results', count: labs.critical, href: MEDICAL_LABS_PATH });
  }
  if (standing !== null) queues.push({ key: 'standing_overdue', label: 'Standing labs overdue', count: standing, href: MEDICAL_LABS_PATH });
  if (needsCoding !== null) queues.push({ key: 'problems_needs_coding', label: 'Problems needing coding', count: needsCoding, href: MEDICAL_PROBLEM_LIST_PATH });
  if (queuesAllowed.vitals)
    queues.push({ key: 'vitals_missing', label: "Vitals missing at today's visits", count: vitalsMissing, href: MEDICAL_VITALS_HREF, detail: 'Checked in or seen today, no vitals recorded today' });
  if (rx) {
    queues.push({
      key: 'rx_requests',
      label: 'Refill / RxChange requests',
      count: (rx.refills ?? 0) + rx.rxChanges,
      href: INBOX_HREF,
      detail: rx.refills === null ? 'No DrFirst username on your profile: refill requests cannot be routed to you' : null,
    });
  }

  const locIds = byLocationRaw.map((l) => l.locationId).filter((v): v is string => Boolean(v));
  const names = locIds.length ? await source.locationNames(viewer.organizationId, locIds) : new Map<string, string>();
  const byLocation = byLocationRaw
    .map((l) => ({
      locationId: l.locationId,
      name: l.locationId ? names.get(l.locationId) ?? 'Other location' : 'No location on file',
      count: l.count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    scope,
    timeZone,
    date: ymd,
    dateLabel: formatPracticeDate(start, timeZone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    today: { rows, total: rows.length, truncated, counts },
    queues,
    panel: { active, byLocation, newThisMonth, seenRecently, seenWindowDays: SEEN_WINDOW_DAYS },
    links: { intake: PRIMARY_CARE_INTAKE_HREF, patients: PRIMARY_CARE_PATIENTS_HREF, labs: MEDICAL_LABS_PATH, vitals: MEDICAL_VITALS_HREF },
    workflow: { canRoom: canRoomPatients(viewer.role), canMarkInRoom: isPcProviderRole(viewer.role) },
  };
}
