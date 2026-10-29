import 'server-only';
/**
 * GET /api/dashboard/home loader: one aggregated read per role home, counts only (plus today's
 * schedule rows). Reuses the existing loaders so a tile matches the page it links to:
 *  - Caseload Health: buildPopulationHealth (Population Health page) over the viewer's scope
 *    (caseload roles: their assigned clients; leadership: organization or one location)
 *  - unsigned notes / refills / lab results: the inbox section loaders
 *  - standing labs: listStandingOrders (Labs page)
 * No value here is estimated or sampled; a source that cannot be read gives null (tile omitted).
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientAppointments, canAccessClientRoster, careTeamClientWhereForRole, clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { canUseSudRadar } from '@/lib/clinical/sudRadar/access';
import { isControlledSubstance } from '@/lib/ehr/psychMedMgmt';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { unsignedNoteCutoff } from '@/lib/inbox/core';
import { ESCALATION_OVERDUE_DAYS } from '@/lib/notes/standard';
import { sectionsForRole } from '@/lib/inbox/sections';
import { INBOX_DEPS, loadSection } from '@/lib/inbox/service';
import type { InboxSectionKey } from '@/lib/inbox/types';
import { canViewLabs, LABS_PATH } from '@/lib/labs/access';
import { suggestedOrderSets } from '@/lib/labs/orderSets';
import { listStandingOrders } from '@/lib/labs/standingDb';
import { standingDueState } from '@/lib/labs/standing';
import { buildAppointmentLocationResolver, effectiveLocation } from '@/lib/locations/effectiveLocation';
import { isMedicalViewerRole, MEDICAL_LABS_PATH } from '@/lib/medical/medicalProgram';
import { practiceNoteSignDeadlineHours } from '@/lib/practice/consumers';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { POPULATION_PATH, DEFAULT_PAGE_SIZE, populationClientWhere } from '@/lib/reports/populationHealth';
import { buildPopulationHealth } from '@/lib/reports/populationHealthQueries';
import { reportClientWhere, type ReportScope } from '@/lib/reports/outcomesReports';
import { resolveReportScope } from '@/lib/reports/outcomesReportsQueries';
import { withLabelFields } from '@/lib/scheduling/appointmentLabelsServer';
import type { AppointmentLabelChipData } from '@/lib/scheduling/appointmentLabels';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { canPrescribe, isCaseloadRole, isMedicalRole } from '@/types/roles';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { practiceTodayBounds } from './practiceDay';
import { practiceMonthStart } from './practiceMonth';
import {
  buildCaseloadInsights,
  buildCaseloadTiles,
  type CaseloadMetrics,
  type HomeAccess,
  type HomeInsight,
  type HomeTile,
  type PrescriberMetrics,
} from './homeTiles';
import { buildScheduleRows, scheduleCounts, type RawScheduleAppointment, type TodaySchedule } from './todaySchedule';

const DAY_MS = 86_400_000;
const LEADERSHIP = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
const BILLING_HOME = [...LEADERSHIP, 'BILLING'];
const NEW_CLIENT_HOME = [...LEADERSHIP, 'FRONT_DESK', 'OFFICE_MANAGER'];
/** Order sets whose medications need monitoring labs */
const MONITORED_SETS = ['clozapine', 'lithium', 'valproate', 'carbamazepine', 'antipsychotic-metabolic'];
const MONITORING_FLOOR_DAYS = 365;
const PDMP_WINDOW_DAYS = 90;

export type HomeViewer = { organizationId: string; userId: string; role: Role };

export type CaseloadHealth = {
  scope: 'caseload' | 'organization';
  generatedAt: string;
  activeClients: number;
  hiddenSensitiveClients: number;
  tiles: HomeTile[];
  insights: HomeInsight[];
  notes: string[];
};

export type HomeCounters = Partial<Record<
  | 'active_clients'
  | 'new_clients_7d'
  | 'active_medications'
  | 'job_requisitions'
  | 'claims_7d'
  | 'claims_denied'
  | 'paid_7d'
  | 'collections_mtd'
  | 'open_alerts'
  | 'sdoh_open'
  | 'plan_reviews_due'
  | 'prp_participants'
  | 'prp_attendance_today'
  | 'prp_no_attendance'
  | 'prp_irp_due'
  | 'prp_referrals_pending'
  | 'prp_transitioning',
  HomeTile
>>;

export type StaffUnsignedRow = {
  clinicianId: string;
  name: string;
  unsigned: number;
  /** Of those, unsigned more than 7 days past the deadline (escalated) */
  overdue7d: number;
};

/** Escalation: unsigned more than this many hours after the service note was written (deadline + 7 days) */
function escalationCutoff(now: Date, deadlineHours: number): Date {
  return unsignedNoteCutoff(now, deadlineHours + ESCALATION_OVERDUE_DAYS * 24);
}

export type DashboardHome = {
  generatedAt: string;
  role: string;
  timeZone: string;
  today: string;
  scope: 'caseload' | 'organization';
  location: { requested: string | null; applied: string | null };
  caseloadHealth: CaseloadHealth | null;
  schedule: TodaySchedule | null;
  counters: HomeCounters;
  /** Leadership: notes unsigned past the deadline per author (for Staff Productivity) */
  staffUnsigned: StaffUnsignedRow[] | null;
};

export const isLeadershipRole = (role: string) => LEADERSHIP.includes(String(role).toUpperCase());

export function canSeeCaseloadHealth(role: string): boolean {
  return isCaseloadRole(role) || isLeadershipRole(role);
}

async function settle<T>(p: Promise<T>, label: string): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error(`[dashboard/home] ${label} unavailable`, err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

function labsPathFor(role: string): string | null {
  if (!canViewLabs(role)) return null;
  if (canAccessPath(role, LABS_PATH)) return LABS_PATH;
  return isMedicalViewerRole(role) && canAccessPath(role, MEDICAL_LABS_PATH) ? MEDICAL_LABS_PATH : null;
}

export function homeAccess(role: string): HomeAccess {
  return {
    population: canAccessPath(role, POPULATION_PATH),
    alerts: canAccessPath(role, '/dashboard/alerts'),
    inbox: canAccessPath(role, '/dashboard/inbox'),
    labsPath: labsPathFor(role),
    sudRadar: canUseSudRadar(role) && canAccessPath(role, '/dashboard/ehr/scanner'),
    clinical: canAccessPath(role, '/dashboard/alerts') || canAccessPath(role, '/dashboard/ehr'),
  };
}

/** Item count of one inbox section for this viewer; null when not visible to the role or the source failed */
async function inboxCount(v: HomeViewer, key: InboxSectionKey, now: Date): Promise<{ count: number; urgent: number; notice: string | null } | null> {
  if (!sectionsForRole(v.role).some((s) => s.key === key)) return null;
  const r = await loadSection({ organizationId: v.organizationId, userId: v.userId, role: String(v.role) }, key, INBOX_DEPS, now);
  if (r.error) return null;
  return { count: r.items.length, urgent: r.items.filter((i) => i.priority === 'urgent').length, notice: r.notice };
}

// ─── Location ────────────────────────────────────────────────────────────────

/** Leadership and front office may narrow to one Location of the org; caseload roles never do */
async function resolveLocation(v: HomeViewer, requested: string | null): Promise<string | null> {
  if (!requested || requested === 'all' || isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId })) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(requested)) return null;
  const loc = await prisma.location.findFirst({ where: { id: requested, organizationId: v.organizationId }, select: { id: true } });
  return loc?.id ?? null;
}

// ─── Caseload Health ────────────────────────────────────────────────────────

// Dismissed drafts (src/lib/notes/dismiss.ts) are not unsigned work
const UNSIGNED: Prisma.ProgressNoteWhereInput = { dismissedAt: null, OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }] };

async function monitoringAndPdmp(scope: ReportScope, now: Date): Promise<Pick<PrescriberMetrics, 'monitoringOverdue' | 'monitoredClients' | 'pdmpDue' | 'controlledClients'>> {
  const org = scope.organizationId;
  const meds = await prisma.clientMedication.findMany({
    where: { active: true, client: populationClientWhere(scope) },
    select: { clientId: true, medicationName: true, drugName: true, genericName: true, brandName: true, isAntipsychotic: true, schedule: true },
  });
  const monitored = new Map<string, string[]>();
  const controlled = new Set<string>();
  for (const m of meds) {
    const names = [m.medicationName, m.drugName, m.genericName, m.brandName].filter((x): x is string => Boolean(x && x.trim()));
    const sets = suggestedOrderSets(names.map((name) => ({ name, isAntipsychotic: m.isAntipsychotic }))).filter((s) => MONITORED_SETS.includes(s));
    if (sets.length) monitored.set(m.clientId, [...new Set([...(monitored.get(m.clientId) ?? []), ...sets])]);
    if (names.some((n) => isControlledSubstance(n, m.schedule))) controlled.add(m.clientId);
  }

  let monitoringOverdue: number | null = null;
  const monitoredIds = [...monitored.keys()];
  if (monitoredIds.length === 0) {
    monitoringOverdue = 0;
  } else {
    const [standing, recent] = await Promise.all([
      settle(
        prisma.labStandingOrder.findMany({
          where: { organizationId: org, clientId: { in: monitoredIds }, active: true },
          select: { clientId: true, nextDueAt: true, endDate: true, active: true },
        }),
        'standing orders'
      ),
      prisma.labOrder.groupBy({
        by: ['clientId'],
        where: { organizationId: org, clientId: { in: monitoredIds }, status: { not: 'cancelled' }, orderedAt: { gte: new Date(now.getTime() - MONITORING_FLOOR_DAYS * DAY_MS) } },
        _count: { _all: true },
      }),
    ]);
    const recentSet = new Set(recent.map((r) => r.clientId));
    const live = new Map<string, boolean>();
    for (const s of standing ?? []) {
      const state = standingDueState(s, now);
      if (state === 'ended') continue;
      live.set(s.clientId, (live.get(s.clientId) ?? false) || state === 'overdue');
    }
    monitoringOverdue = monitoredIds.filter((id) => (live.has(id) ? live.get(id) : !recentSet.has(id))).length;
  }

  // PDMP: only when this practice has PDMP queries logged at all (otherwise the feed is not live
  // and every controlled-substance client would read as "due")
  let pdmpDue: number | null = null;
  const anyPdmp = await prisma.marylandPdmpAudit.findFirst({ where: { client: clientOrgFilter(org) }, select: { id: true } });
  if (anyPdmp) {
    const ids = [...controlled];
    const checked = ids.length
      ? await prisma.marylandPdmpAudit.groupBy({
          by: ['clientId'],
          where: { clientId: { in: ids }, consultationTimestamp: { gte: new Date(now.getTime() - PDMP_WINDOW_DAYS * DAY_MS) } },
          _count: { _all: true },
        })
      : [];
    const done = new Set(checked.map((c) => c.clientId));
    pdmpDue = ids.filter((id) => !done.has(id)).length;
  }
  return { monitoringOverdue, monitoredClients: monitoredIds.length, pdmpDue, controlledClients: controlled.size };
}

export async function loadCaseloadHealth(v: HomeViewer, locationId: string | null, now: Date): Promise<CaseloadHealth> {
  const caseload = isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId });
  const scope = await resolveReportScope(
    { organizationId: v.organizationId, userId: v.userId, role: v.role },
    { locationId: caseload ? null : locationId, clinicianId: null } as Parameters<typeof resolveReportScope>[1]
  );
  const prescriber = canPrescribe(v.role);
  const deadlineHours = await practiceNoteSignDeadlineHours(v.organizationId);

  const [report, unsignedMine, unsignedOrg, overdue7dOrg, sud, rx, labs, standing, monitoring] = await Promise.all([
    buildPopulationHealth(scope, { locationId: scope.locationId, clinicianId: null, list: null, page: 0, pageSize: DEFAULT_PAGE_SIZE }, now),
    caseload ? settle(inboxCount(v, 'unsigned_notes', now), 'unsigned notes') : Promise.resolve(null),
    caseload
      ? Promise.resolve(null)
      : settle(
          prisma.progressNote.count({
            where: { AND: [{ client: reportClientWhere(scope, { byAssignee: false }) }, { createdAt: { lt: unsignedNoteCutoff(now, deadlineHours) } }, UNSIGNED] },
          }),
          'unsigned notes (org)'
        ),
    // Leadership: unsigned more than 7 days past the deadline (escalated to supervisors / directors)
    caseload
      ? Promise.resolve(null)
      : settle(
          prisma.progressNote.count({
            where: { AND: [{ client: reportClientWhere(scope, { byAssignee: false }) }, { createdAt: { lt: escalationCutoff(now, deadlineHours) } }, UNSIGNED] },
          }),
          'unsigned notes > 7 days overdue (org)'
        ),
    canUseSudRadar(v.role)
      ? settle(prisma.sudRadarSignal.count({ where: { organizationId: v.organizationId, status: 'new', client: reportClientWhere(scope, { byAssignee: true }) } }), 'sud radar')
      : Promise.resolve(null),
    prescriber ? settle(inboxCount(v, 'rx_requests', now), 'rx requests') : Promise.resolve(null),
    prescriber ? settle(inboxCount(v, 'lab_results', now), 'lab results') : Promise.resolve(null),
    prescriber
      ? settle(listStandingOrders({ organizationId: v.organizationId, actorUserId: v.userId, actorRole: v.role }), 'standing labs')
      : Promise.resolve(null),
    prescriber ? settle(monitoringAndPdmp(scope, now), 'medication monitoring') : Promise.resolve(null),
  ]);

  const action = (k: string) => report.actions.find((a) => a.kind === k)?.count ?? 0;
  const active = report.activeCaseload;
  const unsigned = caseload ? (unsignedMine ? unsignedMine.count : null) : unsignedOrg;
  const metrics: CaseloadMetrics = {
    scope: report.scope,
    activeClients: active,
    hiddenSensitiveClients: report.hiddenSensitiveClients,
    risk: { high: report.risk.high, moderate: report.risk.moderate, low: report.risk.low, unknown: report.risk.unknown },
    therapyOverdue: report.overdue.available ? report.overdue.therapy : null,
    medOverdue: report.overdue.available ? report.overdue.medManagement : null,
    noVisit30: active - report.engagement.seen30,
    noVisit60: action('no_visit_60'),
    measurementDue: action('not_measured_90'),
    highNoSafetyPlan: action('high_no_safety_plan'),
    phq9SevereUnacked: action('phq9_severe_unacked'),
    unsignedNotes: unsigned,
    unsignedDeadlineHours: deadlineHours,
    unsignedOverdue7d: caseload ? null : overdue7dOrg,
    sudSignals: sud,
    prescriber: prescriber
      ? {
          rxRequests: rx ? rx.count : null,
          rxNotice: rx?.notice ?? null,
          labResultsToReview: labs ? labs.count : null,
          labResultsCritical: labs ? labs.urgent : null,
          standingOverdue: standing ? standing.filter((s) => s.dueState === 'overdue').length : null,
          standingDueSoon: standing ? standing.filter((s) => s.dueState === 'due_soon').length : null,
          monitoringOverdue: monitoring?.monitoringOverdue ?? null,
          monitoredClients: monitoring?.monitoredClients ?? null,
          pdmpDue: monitoring?.pdmpDue ?? null,
          controlledClients: monitoring?.controlledClients ?? null,
        }
      : null,
  };
  const access = homeAccess(v.role);
  const notes = [...report.notes];
  if (prescriber && monitoring && monitoring.pdmpDue == null) {
    notes.push('No PDMP queries are logged for this practice yet, so a PDMP-due count is not shown.');
  }
  if (!caseload && locationId == null) notes.push('Organization-wide: every location and clinician.');
  return {
    scope: report.scope,
    generatedAt: now.toISOString(),
    activeClients: active,
    hiddenSensitiveClients: report.hiddenSensitiveClients,
    tiles: buildCaseloadTiles(metrics, access, scope.locationId),
    insights: buildCaseloadInsights(metrics, access, scope.locationId),
    notes,
  };
}

// ─── Today's schedule ─────────────────────────────────────────────────────────

async function appointmentLocationColumn(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'Appointment' AND column_name = 'location_id'`;
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function loadTodaySchedule(v: HomeViewer, locationId: string | null, now: Date, timeZone: string): Promise<TodaySchedule> {
  const { ymd, start, end } = practiceTodayBounds(timeZone, now);
  const caseload = isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId });
  const and: Prisma.AppointmentWhereInput[] = [
    appointmentOrgWhere(v.organizationId),
    { startsAt: { gte: start, lt: end } },
    { status: { not: 'CANCELLED' } },
  ];
  // Same rule as GET /api/appointments (listAppointments): caseload roles see their own visits plus
  // visits of clients on their care team (primary care: the clients assigned to them)
  if (caseload) {
    and.push({
      OR: [
        { clinicianId: v.userId },
        { client: isMedicalRole(v.role) ? { assignedToId: v.userId } : careTeamClientWhereForRole(v.userId, v.role, now) },
      ],
    });
  }
  const appts = await prisma.appointment.findMany({
    where: { AND: and },
    orderBy: { startsAt: 'asc' },
    take: 2000,
    select: {
      id: true,
      clientId: true,
      clientName: true,
      clinicianId: true,
      clinicianName: true,
      type: true,
      startsAt: true,
      endsAt: true,
      status: true,
      isVirtual: true,
      notes: true,
      rescheduleRequestedAt: true,
      clinician: { select: { name: true } },
      client: { select: { name: true, locationId: true, sensitiveRecord: { select: { alias: true } } } },
    },
  });
  const ids = appts.map((a) => a.id);
  const [locations, hasCol] = await Promise.all([
    prisma.location.findMany({ where: { organizationId: v.organizationId }, select: { id: true, name: true } }),
    ids.length ? appointmentLocationColumn() : Promise.resolve(false),
  ]);
  const own = new Map<string, string | null>();
  if (hasCol && ids.length) {
    const rows = await settle(
      prisma.$queryRaw<{ id: string; loc: string | null }[]>`SELECT "id", "location_id"::text AS "loc" FROM "Appointment" WHERE "id" = ANY(${ids}::text[])`,
      'appointment locations'
    );
    for (const r of rows ?? []) own.set(r.id, r.loc);
  }
  const resolve = buildAppointmentLocationResolver(locations);
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  const sensitiveIds = [...new Set(appts.filter((a) => a.client.sensitiveRecord).map((a) => a.clientId))];
  let locked: Set<string>;
  try {
    locked = sensitiveIds.length
      ? await lockedSensitiveClientIds({ organizationId: v.organizationId, userId: v.userId, role: v.role, clientIds: sensitiveIds })
      : new Set();
  } catch {
    locked = new Set(sensitiveIds); // fail closed
  }

  const labeled = await withLabelFields(
    v.organizationId,
    appts.map((a) => ({ id: a.id, clientId: a.clientId, startsAt: a.startsAt, status: a.status, isVirtual: a.isVirtual, notes: a.notes, rescheduleRequestedAt: a.rescheduleRequestedAt })),
    appts.map((a) => ({ id: a.id }))
  );
  const labelBy = new Map<string, AppointmentLabelChipData | null>(labeled.map((l) => [l.id, l.label]));

  const raw: RawScheduleAppointment[] = [];
  for (const a of appts) {
    const loc = effectiveLocation({ appointmentLocation: own.get(a.id) ?? null, clientLocationId: a.client.locationId }, resolve);
    if (locationId && loc.locationId !== locationId) continue;
    raw.push({
      id: a.id,
      clientId: a.clientId,
      clientName: a.clientName?.trim() || a.client.name,
      sensitiveAlias: a.client.sensitiveRecord?.alias ?? null,
      isSensitive: Boolean(a.client.sensitiveRecord),
      locked: locked.has(a.clientId),
      clinicianId: a.clinicianId,
      clinicianName: a.clinicianName?.trim() || a.clinician?.name || null,
      type: a.type,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      status: a.status,
      isVirtual: a.isVirtual,
      locationId: loc.locationId,
      locationName: loc.locationId ? locName.get(loc.locationId) ?? null : null,
      locationInferred: loc.inferred,
      label: labelBy.get(a.id) ?? null,
    });
  }
  const rows = buildScheduleRows(raw, timeZone);
  return {
    date: ymd,
    timeZone,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    scope: caseload ? 'caseload' : 'organization',
    locationId,
    locationApplied: true,
    rows,
    counts: scheduleCounts(rows),
  };
}

// ─── Role counters ──────────────────────────────────────────────────────────

function clientsIn(v: HomeViewer, locationId: string | null): Prisma.ClientWhereInput {
  const base = clientAccessWhere({ organizationId: v.organizationId, actorUserId: v.userId, actorRole: v.role });
  return locationId ? { AND: [base, { locationId }] } : base;
}

/**
 * Case manager / PRP specialist counters, scoped to the viewer's own clients (assigned to them;
 * PRP also enrollments where they are the specialist). Each source is optional: a table that is
 * not migrated yet leaves its tile out instead of showing 0.
 */
async function loadProgramCounters(v: HomeViewer, now: Date, timeZone: string, out: HomeCounters): Promise<void> {
  const role = String(v.role).toUpperCase();
  const org = v.organizationId;
  const mine = clientAccessWhere({ organizationId: org, actorUserId: v.userId, actorRole: v.role });
  const in30 = new Date(now.getTime() + 30 * DAY_MS);
  const jobs: Promise<unknown>[] = [];

  if (role === 'CASE_MANAGER' || role === 'PRP_SPECIALIST') {
    // SDOH referrals: open or connected (not closed) that the viewer owns or that are on their clients
    if (canAccessPath(v.role, '/dashboard/sdoh')) {
      jobs.push(
        settle(
          (async () => {
            const ids = (await prisma.client.findMany({ where: mine, select: { id: true }, take: 5000 })).map((c) => c.id);
            const where: Prisma.SdohReferralWhereInput = {
              organizationId: org,
              status: { in: ['open', 'connected'] },
              OR: [{ ownerId: v.userId }, { clientId: { in: ids } }],
            };
            const [open, aging] = await Promise.all([
              prisma.sdohReferral.count({ where }),
              prisma.sdohReferral.count({ where: { AND: [where, { status: 'open' }, { createdAt: { lt: new Date(now.getTime() - 14 * DAY_MS) } }] } }),
            ]);
            out.sdoh_open = {
              key: 'sdoh_open', label: 'Open SDOH referrals', value: open, sub: `${aging.toLocaleString('en-US')} open > 14 days`,
              href: '/dashboard/sdoh', source: 'SDOH referrals in Open or Connected status that you own or that are for your assigned clients.', tone: 'amber',
            };
          })(),
          'sdoh referrals'
        )
      );
    }
    // Treatment plan / IRP reviews due in 30 days (or past due) for the viewer's clients
    jobs.push(
      settle(
        prisma.treatmentPlan
          .count({ where: { organizationId: org, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] }, reviewDueAt: { lte: in30 }, client: { AND: [mine, { status: 'ACTIVE' }] } } })
          .then((n) => {
            const key = role === 'PRP_SPECIALIST' ? 'prp_irp_due' : 'plan_reviews_due';
            out[key] = {
              key,
              label: role === 'PRP_SPECIALIST' ? 'IRP reviews due' : 'Plan reviews due',
              value: n,
              sub: 'Due within 30 days or past due',
              href: canAccessPath(v.role, '/dashboard/ehr/treatment-plans') ? '/dashboard/ehr/treatment-plans' : '/dashboard/tasks',
              source: 'Active treatment plans (IRPs) on your assigned active clients whose review date is within 30 days or has passed.',
              tone: 'amber',
            };
          }),
        'plan reviews'
      )
    );
  }

  if (role === 'PRP_SPECIALIST') {
    jobs.push(
      settle(
        (async () => {
          const enrollments = await prisma.prpEnrollment.findMany({
            where: {
              organizationId: org,
              status: { not: 'discharged' },
              OR: [{ specialistId: v.userId }, { client: { assignedToId: v.userId } }],
            },
            select: { id: true, status: true },
          });
          const ids = enrollments.map((e) => e.id);
          const activeIds = enrollments.filter((e) => e.status === 'active').map((e) => e.id);
          const transitioning = enrollments.filter((e) => e.status === 'transitioning').length;
          out.prp_participants = {
            key: 'prp_participants', label: 'PRP participants', value: enrollments.length,
            sub: `${activeIds.length.toLocaleString('en-US')} active · ${(enrollments.length - activeIds.length).toLocaleString('en-US')} on hold / transitioning`,
            href: '/dashboard/prp', source: 'PRP enrollments not discharged where you are the PRP specialist or the client is assigned to you.', tone: 'teal',
          };
          out.prp_transitioning = {
            key: 'prp_transitioning', label: 'Transitioning out', value: transitioning, sub: 'Discharge planning',
            href: '/dashboard/prp', source: 'Your PRP enrollments with status Transitioning (discharge planning).', tone: 'slate',
          };
          const { ymd } = practiceTodayBounds(timeZone, now);
          // PrpAttendance.serviceDate is the calendar date at 00:00 UTC
          const todayDate = new Date(`${ymd}T00:00:00Z`);
          let today = 0;
          let seen14 = new Set<string>();
          let seen30 = new Set<string>();
          if (ids.length) {
            const [t, r14, r30] = await Promise.all([
              prisma.prpAttendance.count({ where: { organizationId: org, enrollmentId: { in: ids }, serviceDate: todayDate } }),
              prisma.prpAttendance.groupBy({ by: ['enrollmentId'], where: { organizationId: org, enrollmentId: { in: ids }, serviceDate: { gte: new Date(todayDate.getTime() - 14 * DAY_MS) } }, _count: { _all: true } }),
              prisma.prpAttendance.groupBy({ by: ['enrollmentId'], where: { organizationId: org, enrollmentId: { in: ids }, serviceDate: { gte: new Date(todayDate.getTime() - 30 * DAY_MS) } }, _count: { _all: true } }),
            ]);
            today = t;
            seen14 = new Set(r14.map((r) => r.enrollmentId));
            seen30 = new Set(r30.map((r) => r.enrollmentId));
          }
          const not14 = activeIds.filter((id) => !seen14.has(id)).length;
          out.prp_attendance_today = {
            key: 'prp_attendance_today', label: 'Attendance recorded today', value: today,
            sub: `for ${activeIds.length.toLocaleString('en-US')} active participants`,
            href: '/dashboard/prp', source: `PRP encounters recorded for your participants with today's service date (${ymd}, practice time).`, tone: 'purple',
          };
          out.prp_no_attendance = {
            key: 'prp_no_attendance', label: 'No attendance in 30 days', value: activeIds.filter((id) => !seen30.has(id)).length,
            sub: `${not14.toLocaleString('en-US')} with none in 14 days`,
            href: '/dashboard/prp', source: 'Your active PRP enrollments with no recorded PRP encounter in the last 30 (and 14) days.', tone: 'red',
          };
        })(),
        'prp enrollments / attendance'
      )
    );
    jobs.push(
      settle(
        (async () => {
          const [referrals, enrolled] = await Promise.all([
            prisma.prpReferral.findMany({ where: { organizationId: org }, select: { id: true } }),
            prisma.prpEnrollment.findMany({ where: { organizationId: org, referralId: { not: null } }, select: { referralId: true } }),
          ]);
          const used = new Set(enrolled.map((e) => e.referralId));
          out.prp_referrals_pending = {
            key: 'prp_referrals_pending', label: 'Referrals not yet enrolled', value: referrals.filter((r) => !used.has(r.id)).length,
            sub: `${referrals.length.toLocaleString('en-US')} PRP referrals on file`,
            href: '/dashboard/prp', source: 'PRP referrals (practice-wide intake pipeline) with no enrollment created from them.', tone: 'blue',
          };
        })(),
        'prp referrals'
      )
    );
  }
  await Promise.all(jobs);
}

export async function loadCounters(v: HomeViewer, locationId: string | null, now: Date, timeZone: string, monthStart: Date): Promise<HomeCounters> {
  const role = String(v.role).toUpperCase();
  const out: HomeCounters = {};
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const where = clientsIn(v, locationId);
  const tasks: Promise<void>[] = [];
  const where7 = locationId ? ' at this location' : '';

  if (canAccessClientRoster(v.role)) {
    tasks.push(
      prisma.client.count({ where: { AND: [where, { status: 'ACTIVE' }] } }).then((n) => {
        out.active_clients = {
          key: 'active_clients',
          label: isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId }) ? 'Your caseload' : 'Active clients',
          value: n,
          sub: isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId }) ? 'Active, on your care team' : locationId ? 'This location' : 'Client roster',
          href: '/dashboard/clients',
          source: isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId })
            ? 'Server count of Active clients on your care team: assigned to you, on their treatment team, or seen by you recently / scheduled with you (same rule as the client list).'
            : `Server count of clients with status Active${where7} (not the length of a loaded page).`,
          tone: 'slate',
        };
      })
    );
  }
  if (canAccessPath(v.role, '/dashboard/alerts')) {
    tasks.push(
      prisma.riskAlert
        .groupBy({ by: ['severity'], where: { reviewed: false, client: where }, _count: { _all: true } })
        .then((groups) => {
          const total = groups.reduce((s, g) => s + g._count._all, 0);
          const high = groups.find((g) => g.severity === 'HIGH')?._count._all ?? 0;
          out.open_alerts = {
            key: 'open_alerts',
            label: 'Open risk alerts',
            value: total,
            sub: `${high.toLocaleString('en-US')} high severity`,
            href: '/dashboard/alerts',
            source: `Server count of unreviewed risk alerts for clients ${isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId }) ? 'on your care team' : `in this view${where7}`} (not the length of the loaded alert list).`,
            tone: 'red',
          };
        })
    );
  }
  if (NEW_CLIENT_HOME.includes(role)) {
    tasks.push(
      Promise.all([
        prisma.client.count({ where: { AND: [where, { createdAt: { gte: since7 } }, { importedAt: null }] } }),
        prisma.client.count({ where: { AND: [where, { importedAt: { gte: since7 } }] } }),
      ]).then(([created, imported]) => {
        out.new_clients_7d = {
          key: 'new_clients_7d',
          label: 'New clients (7 days)',
          value: created,
          sub: imported ? `${imported.toLocaleString('en-US')} imported separately` : 'Created in Altrixs',
          href: '/dashboard/clients',
          source: `Client records created in Altrixs in the last 7 days${where7}. Records imported from Valant are counted separately (importedAt), not as new clients.`,
          tone: 'blue',
        };
      })
    );
  }
  if (canPrescribe(v.role)) {
    tasks.push(
      prisma.clientMedication
        .groupBy({ by: ['clientId'], where: { active: true, client: { AND: [where, { status: 'ACTIVE' }] } }, _count: { _all: true } })
        .then((groups) => {
          const meds = groups.reduce((s, g) => s + g._count._all, 0);
          out.active_medications = {
            key: 'active_medications',
            label: 'Active medications',
            value: meds,
            sub: `${groups.length.toLocaleString('en-US')} clients`,
            href: '/dashboard/ehr/prescriptions',
            source: 'Active medication list entries (DrFirst sync and charted medications) for your active caseload.',
            tone: 'blue',
          };
        })
    );
  }
  if (canAccessPath(v.role, '/dashboard/hr') && (role === 'HR' || LEADERSHIP.includes(role) || role === 'OFFICE_MANAGER')) {
    tasks.push(
      prisma.hrJobRequisition.count({ where: { organizationId: v.organizationId } }).then((n) => {
        out.job_requisitions = {
          key: 'job_requisitions',
          label: 'Job requisitions',
          value: n,
          sub: n ? 'Recorded in HR' : 'No open positions recorded',
          href: '/dashboard/hr',
          source: 'Job requisitions recorded for this organization in HR (requisitions have no open / closed status, so every recorded one is counted).',
          tone: 'purple',
        };
      })
    );
  }
  if (BILLING_HOME.includes(role) && canAccessPath(v.role, '/dashboard/billing')) {
    const org = v.organizationId;
    tasks.push(
      Promise.all([
        prisma.claim.count({ where: { organizationId: org, createdAt: { gte: since7 } } }),
        prisma.claim.count({ where: { organizationId: org, status: { in: ['DRAFT', 'READY', 'SUBMITTED'] } } }),
        prisma.claim.count({ where: { organizationId: org, status: 'DENIED' } }),
        prisma.claim.aggregate({ where: { organizationId: org, status: 'PAID', paidAt: { gte: since7 } }, _sum: { amountCents: true }, _count: { _all: true } }),
        prisma.payment.aggregate({ where: { organizationId: org, paidAt: { gte: monthStart, lte: now } }, _sum: { amountCents: true }, _count: { _all: true } }),
      ]).then(([c7, pending, denied, paid, pay]) => {
        out.claims_7d = {
          key: 'claims_7d', label: 'Claims (7 days)', value: c7, sub: `${pending.toLocaleString('en-US')} draft / ready / submitted`,
          href: '/dashboard/billing/claims', source: 'Altrixs claims created in the last 7 days; pending = all claims in Draft, Ready or Submitted.', tone: 'amber',
        };
        out.claims_denied = {
          key: 'claims_denied', label: 'Denied claims', value: denied, sub: 'Status Denied',
          href: '/dashboard/billing/denials', source: 'Altrixs claims with status Denied.', tone: 'red',
        };
        out.paid_7d = {
          key: 'paid_7d', label: 'Paid (7 days)', value: paid._sum.amountCents ?? 0, sub: `${paid._count._all.toLocaleString('en-US')} paid claims`,
          href: '/dashboard/billing/claims', source: 'Billed amount of Altrixs claims marked Paid in the last 7 days (cents).', tone: 'green',
        };
        out.collections_mtd = {
          key: 'collections_mtd', label: 'Collections MTD', value: pay._sum.amountCents ?? 0, sub: `${pay._count._all.toLocaleString('en-US')} payments since the 1st`,
          href: '/dashboard/billing/payments', source: `Payments recorded in Altrixs since the 1st of this month (practice time, ${timeZone}); Valant-imported money is on the Billing overview.`, tone: 'blue',
        };
      })
    );
  }
  if (role === 'CASE_MANAGER' || role === 'PRP_SPECIALIST' || role === 'PEER_SUPPORT') {
    tasks.push(loadProgramCounters(v, now, timeZone, out));
  }
  await Promise.all(tasks.map((t) => t.catch((err) => console.error('[dashboard/home] counter failed', err instanceof Error ? err.name : 'unknown'))));
  return out;
}

/** Leadership: notes unsigned past the deadline grouped by author (no client data) */
async function loadStaffUnsigned(v: HomeViewer, now: Date): Promise<StaffUnsignedRow[]> {
  const hours = await practiceNoteSignDeadlineHours(v.organizationId);
  const unsignedBefore = (cutoff: Date) =>
    prisma.progressNote.groupBy({
      by: ['clinicianId'],
      where: {
        AND: [
          { client: clientAccessWhere({ organizationId: v.organizationId, actorUserId: v.userId, actorRole: v.role }) },
          { createdAt: { lt: cutoff } },
          UNSIGNED,
        ],
      },
      _count: { _all: true },
    });
  const [groups, escalated] = await Promise.all([unsignedBefore(unsignedNoteCutoff(now, hours)), unsignedBefore(escalationCutoff(now, hours))]);
  const overdue7d = new Map(escalated.map((g) => [g.clinicianId, g._count._all]));
  const ids = groups.map((g) => g.clinicianId).filter((x): x is string => Boolean(x));
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids }, organizationId: v.organizationId }, select: { id: true, name: true, email: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  return groups
    .filter((g) => g.clinicianId && name.has(g.clinicianId))
    .map((g) => ({
      clinicianId: g.clinicianId as string,
      name: name.get(g.clinicianId as string) as string,
      unsigned: g._count._all,
      overdue7d: overdue7d.get(g.clinicianId) ?? 0,
    }));
}

export async function loadDashboardHome(
  v: HomeViewer,
  opts: { location: string | null; now?: Date; onTiming?: (part: string, ms: number) => void }
): Promise<DashboardHome> {
  const now = opts.now ?? new Date();
  // Server-Timing: duration of each part (all parts run in parallel)
  const timed = <T>(part: string, p: Promise<T>): Promise<T> => {
    if (!opts.onTiming) return p;
    const t0 = Date.now();
    return p.finally(() => opts.onTiming?.(part, Date.now() - t0));
  };
  const [timeZone, locationId] = await Promise.all([getPracticeTimeZone(v.organizationId), resolveLocation(v, opts.location)]);
  const { ymd } = practiceTodayBounds(timeZone, now);
  const monthStart = practiceMonthStart(timeZone, now);
  const [caseloadHealth, schedule, counters, staffUnsigned] = await Promise.all([
    canSeeCaseloadHealth(v.role) ? timed('caseload', settle(loadCaseloadHealth(v, locationId, now), 'caseload health')) : Promise.resolve(null),
    canAccessClientAppointments(v.role) ? timed('schedule', settle(loadTodaySchedule(v, locationId, now, timeZone), 'today schedule')) : Promise.resolve(null),
    timed('counters', loadCounters(v, locationId, now, timeZone, monthStart)),
    isLeadershipRole(v.role) ? timed('staffUnsigned', settle(loadStaffUnsigned(v, now), 'staff unsigned')) : Promise.resolve(null),
  ]);
  if (schedule && opts.location && opts.location !== 'all' && !locationId && !isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId })) {
    schedule.locationApplied = false;
  }
  return {
    generatedAt: now.toISOString(),
    role: String(v.role),
    timeZone,
    today: ymd,
    scope: isCaseloadScoped({ role: v.role, userId: v.userId, organizationId: v.organizationId }) ? 'caseload' : 'organization',
    location: { requested: opts.location, applied: locationId },
    caseloadHealth,
    schedule,
    counters,
    staffUnsigned,
  };
}
