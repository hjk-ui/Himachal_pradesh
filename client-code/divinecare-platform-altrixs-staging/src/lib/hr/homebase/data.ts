/**
 * Loaders behind the HR > Homebase screens and APIs. Organization-scoped; HR / leadership only
 * (routes gate with hrGate('admin')). Payroll reconciliation reads documentation COUNTS only
 * (./aggregates.ts); no client information reaches HR.
 */
import { prisma } from '@/lib/db/prisma';
import { loadRoster } from '@/lib/hr/server';
import { addDaysYmd } from '@/lib/hr/standard';
import { DEFAULT_PRACTICE_TIME_ZONE, fromPracticeWallTime, practiceToday, resolvePracticeTimeZone, toPracticeWallTime } from '@/lib/time/practiceTime';
import { getHomebaseConfig, HOMEBASE_REASON_TEXT } from './config';
import { HomebaseNotConnectedError, homebaseClientFor } from './client';
import { buildRosterReview, hbFullName, suggestLocation, type LinkState } from './matching';
import { buildReconciliation, summarizePayPeriod, type TimecardDay } from './reconcile';
import { noteCountAggregates, visitDayAggregates } from './aggregates';
import {
  cacheCounts,
  getEmployee,
  listEmployees,
  listLocations,
  listShifts,
  listSyncRuns,
  listTimecards,
  setLocationMapping,
  sqlHomebaseStore,
  writeEmployeeLink,
  type StoredTimecard,
} from './store';
import { defaultSyncRange, runHomebaseSync, validateSyncRange, type SyncRange } from './sync';

export async function practiceTimeZoneFor(organizationId: string): Promise<string> {
  try {
    const p = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { timeZone: true } });
    return resolvePracticeTimeZone(p?.timeZone);
  } catch {
    return DEFAULT_PRACTICE_TIME_ZONE;
  }
}

/** Practice-day range [start 00:00, end+1 00:00) as UTC instants. */
export function periodBounds(start: string, end: string, timeZone: string): { from: Date; to: Date } | null {
  const from = fromPracticeWallTime(start, '00:00', timeZone);
  const to = fromPracticeWallTime(addDaysYmd(end, 1), '00:00', timeZone);
  if (!from || !to || to <= from) return null;
  return { from, to };
}

export function timecardDays(cards: StoredTimecard[], timeZone: string): Array<TimecardDay & { breakMinutes: number }> {
  return cards
    .filter((c) => c.homebaseEmployeeId && c.clockInAt && !c.deletedAt)
    .map((c) => ({
      homebaseEmployeeId: c.homebaseEmployeeId!,
      day: toPracticeWallTime(c.clockInAt!, timeZone).date,
      workedMinutes: c.workedMinutes,
      open: !c.clockOutAt,
      breakMinutes: c.breakMinutes,
    }));
}

// ─── Status ──────────────────────────────────────────────────────────────────

export async function loadHomebaseStatus(organizationId: string) {
  const cfg = getHomebaseConfig(organizationId);
  const [runs, counts, locations, altrixsLocations] = await Promise.all([
    listSyncRuns(organizationId, 5),
    cacheCounts(organizationId),
    listLocations(organizationId),
    prisma.location.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } }),
  ]);
  const lastSuccess = runs.find((r) => r.status === 'success' || r.status === 'partial') ?? null;
  return {
    connection: {
      connected: cfg.connected,
      reason: cfg.reason,
      label: HOMEBASE_REASON_TEXT[cfg.reason],
      // Host only (never the key)
      apiHost: (() => {
        try {
          return new URL(cfg.baseUrl).host + new URL(cfg.baseUrl).pathname.replace(/\/$/, '');
        } catch {
          return null;
        }
      })(),
    },
    lastSync: lastSuccess ? { at: (lastSuccess.finishedAt ?? lastSuccess.startedAt).toISOString(), status: lastSuccess.status } : null,
    runs: runs.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      rangeStart: r.rangeStart,
      rangeEnd: r.rangeEnd,
      counts: r.counts,
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    counts,
    locations: locations.map((l) => ({
      homebaseId: l.homebaseId,
      name: l.name,
      city: l.city,
      altrixsLocationId: l.altrixsLocationId,
      suggestedLocationId: l.altrixsLocationId ? null : suggestLocation(l.name, altrixsLocations),
      mappedAt: l.mappedAt?.toISOString() ?? null,
    })),
    altrixsLocations: altrixsLocations.map((l) => ({ id: l.id, name: l.name })),
  };
}

export async function saveLocationMappings(organizationId: string, actorId: string, mappings: Array<{ homebaseId: string; altrixsLocationId?: string | null }>) {
  const ids = [...new Set(mappings.map((m) => m.altrixsLocationId).filter(Boolean) as string[])];
  const valid = new Set(
    (await prisma.location.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } })).map((l) => l.id),
  );
  let updated = 0;
  for (const m of mappings) {
    if (m.altrixsLocationId && !valid.has(m.altrixsLocationId)) continue;
    updated += await setLocationMapping(organizationId, m.homebaseId, m.altrixsLocationId ?? null, actorId);
  }
  return updated;
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export async function syncNow(organizationId: string, actorId: string | null, trigger: 'manual' | 'cron', range?: SyncRange) {
  const tz = await practiceTimeZoneFor(organizationId);
  const r = range ?? defaultSyncRange(practiceToday(tz));
  const invalid = validateSyncRange(r);
  if (invalid) return { ok: false as const, error: invalid, status: 400 };
  let client;
  try {
    client = homebaseClientFor(organizationId);
  } catch (err) {
    if (err instanceof HomebaseNotConnectedError) return { ok: false as const, error: HOMEBASE_REASON_TEXT[err.reason], status: 409 };
    throw err;
  }
  const result = await runHomebaseSync({ organizationId, client, store: sqlHomebaseStore, range: r, trigger, triggeredById: actorId });
  return { ok: true as const, result, range: r, error: undefined, status: undefined };
}

// ─── Roster ──────────────────────────────────────────────────────────────────

export async function loadRosterMatch(organizationId: string) {
  const [employees, roster, locations] = await Promise.all([listEmployees(organizationId), loadRoster(organizationId, { includeDeactivated: true }), listLocations(organizationId)]);
  const locName = new Map(locations.map((l) => [l.homebaseId, l.name]));
  const review = buildRosterReview(
    employees.map((e) => ({
      homebaseId: e.homebaseId,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      status: e.status,
      jobTitle: e.jobTitle,
      locationNames: (e.homebaseLocationIds || []).map((id) => locName.get(id) ?? id),
      linkedUserId: e.linkedUserId,
      linkStatus: e.linkStatus,
      suggestedUserId: e.suggestedUserId,
    })),
    roster.map((p) => ({ userId: p.userId, name: p.name, email: p.email, accountStatus: p.accountStatus, role: p.role, workerType: p.workerType })),
  );
  return { ...review, staffOptions: roster.filter((p) => p.accountStatus !== 'DEACTIVATED').map((p) => ({ userId: p.userId, name: p.name, role: p.role })) };
}

export type LinkAction = 'confirm' | 'reject' | 'link' | 'unlink';

/** HR confirms a name suggestion, rejects it, links manually, or unlinks. */
export async function updateEmployeeLink(organizationId: string, actorId: string, homebaseId: string, action: LinkAction, targetUserId?: string | null) {
  const emp = await getEmployee(organizationId, homebaseId);
  if (!emp) return { ok: false as const, error: 'Homebase employee not found', status: 404 };
  let next: { linkedUserId: string | null; linkStatus: LinkState['linkStatus']; suggestedUserId: string | null };
  if (action === 'confirm') {
    if (!emp.suggestedUserId) return { ok: false as const, error: 'Nothing to confirm', status: 400 };
    next = { linkedUserId: emp.suggestedUserId, linkStatus: 'confirmed', suggestedUserId: null };
  } else if (action === 'reject') {
    const rejected = emp.suggestedUserId ?? emp.linkedUserId;
    next = { linkedUserId: null, linkStatus: 'rejected', suggestedUserId: rejected };
  } else if (action === 'unlink') {
    next = { linkedUserId: null, linkStatus: 'rejected', suggestedUserId: emp.linkedUserId };
  } else {
    if (!targetUserId) return { ok: false as const, error: 'Choose a staff member', status: 400 };
    next = { linkedUserId: targetUserId, linkStatus: 'confirmed', suggestedUserId: null };
  }
  if (next.linkedUserId) {
    const user = await prisma.user.findFirst({ where: { id: next.linkedUserId, organizationId }, select: { id: true } });
    if (!user) return { ok: false as const, error: 'Staff member not found', status: 404 };
    const others = (await listEmployees(organizationId)).filter(
      (e) => e.homebaseId !== homebaseId && e.linkedUserId === next.linkedUserId && (e.linkStatus === 'email' || e.linkStatus === 'confirmed'),
    );
    if (others.length) return { ok: false as const, error: 'That staff member is already linked to another Homebase employee. Unlink it first.', status: 409 };
  }
  await writeEmployeeLink(organizationId, homebaseId, next, actorId);
  return { ok: true as const, link: next, error: undefined, status: undefined };
}

// ─── Per-staff hours (HR profile) ────────────────────────────────────────────

export async function loadStaffHours(organizationId: string, userId: string, start: string, end: string) {
  const tz = await practiceTimeZoneFor(organizationId);
  const b = periodBounds(start, end, tz);
  if (!b) return null;
  const linked = (await listEmployees(organizationId)).filter((e) => e.linkedUserId === userId && (e.linkStatus === 'email' || e.linkStatus === 'confirmed'));
  const ids = linked.map((e) => e.homebaseId);
  const [shifts, cards, locations] = await Promise.all([listShifts(organizationId, b.from, b.to, ids), listTimecards(organizationId, b.from, b.to, ids), listLocations(organizationId)]);
  const locName = new Map(locations.map((l) => [l.homebaseId, l.name]));
  const fmt = (d: Date | null) => (d ? toPracticeWallTime(d, tz) : null);
  const days = timecardDays(cards, tz);
  return {
    connected: getHomebaseConfig(organizationId).connected,
    linked: linked.map((e) => ({ homebaseId: e.homebaseId, name: hbFullName(e), jobTitle: e.jobTitle, status: e.status, linkStatus: e.linkStatus })),
    start,
    end,
    timeZone: tz,
    shifts: shifts.map((s) => ({
      id: s.homebaseId,
      location: s.homebaseLocationId ? locName.get(s.homebaseLocationId) ?? null : null,
      start: fmt(s.startAt),
      end: fmt(s.endAt),
      role: s.roleLabel,
      deleted: !!s.deletedAt,
    })),
    timecards: cards.map((c) => ({
      id: c.homebaseId,
      location: c.homebaseLocationId ? locName.get(c.homebaseLocationId) ?? null : null,
      clockIn: fmt(c.clockInAt),
      clockOut: fmt(c.clockOutAt),
      breakMinutes: c.breakMinutes,
      workedMinutes: c.workedMinutes,
      approved: c.approved,
      deleted: !!c.deletedAt,
    })),
    totalWorkedMinutes: days.reduce((s, d) => s + (d.workedMinutes ?? 0), 0),
  };
}

// ─── Pay period summary ──────────────────────────────────────────────────────

export async function loadPayPeriodSummary(organizationId: string, start: string, end: string) {
  const tz = await practiceTimeZoneFor(organizationId);
  const b = periodBounds(start, end, tz);
  if (!b) return null;
  const [employees, cards, roster] = await Promise.all([listEmployees(organizationId), listTimecards(organizationId, b.from, b.to), loadRoster(organizationId, { includeDeactivated: true })]);
  const nameOf = new Map(roster.map((p) => [p.userId, p.name]));
  const summary = summarizePayPeriod(
    employees.map((e) => {
      const linked = e.linkStatus === 'email' || e.linkStatus === 'confirmed' ? e.linkedUserId : null;
      return { homebaseId: e.homebaseId, name: hbFullName(e) || `Employee ${e.homebaseId}`, userId: linked, altrixsName: linked ? nameOf.get(linked) ?? null : null };
    }),
    timecardDays(cards, tz),
  );
  return { start, end, timeZone: tz, ...summary };
}

// ─── Payroll reconciliation (counts only) ────────────────────────────────────

export async function loadReconciliation(organizationId: string, start: string, end: string) {
  const tz = await practiceTimeZoneFor(organizationId);
  const b = periodBounds(start, end, tz);
  if (!b) return null;
  const settings = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { noteSignDeadlineHours: true } }).catch(() => null);
  const deadlineHours = settings?.noteSignDeadlineHours ?? 72;
  const [roster, employees, cards, visits, notes] = await Promise.all([
    loadRoster(organizationId, { includeDeactivated: true }),
    listEmployees(organizationId),
    listTimecards(organizationId, b.from, b.to),
    visitDayAggregates(organizationId, b.from, b.to, tz),
    noteCountAggregates(organizationId, b.from, b.to, deadlineHours),
  ]);
  const links = new Map<string, string[]>();
  for (const e of employees) {
    if (!e.linkedUserId || !(e.linkStatus === 'email' || e.linkStatus === 'confirmed')) continue;
    links.set(e.linkedUserId, [...(links.get(e.linkedUserId) ?? []), e.homebaseId]);
  }
  const active = new Set([...visits.map((v) => v.userId), ...notes.map((x) => x.userId), ...links.keys()]);
  const staff = roster
    .filter((p) => p.accountStatus !== 'DEACTIVATED' || active.has(p.userId))
    .map((p) => ({ userId: p.userId, name: p.name, role: p.role }));
  const recon = buildReconciliation({ staff, links, timecards: timecardDays(cards, tz), visits, notes });
  return { start, end, timeZone: tz, deadlineHours, ...recon };
}

// ─── Query period ────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_REPORT_DAYS = 62;

/** ?start=&end= (YYYY-MM-DD, practice days); default the last 14 days ending today. */
export async function resolvePeriod(organizationId: string, url: URL): Promise<{ start: string; end: string } | { error: string }> {
  const tz = await practiceTimeZoneFor(organizationId);
  const today = practiceToday(tz);
  const end = url.searchParams.get('end') || today;
  const start = url.searchParams.get('start') || addDaysYmd(end, -13);
  if (!YMD.test(start) || !YMD.test(end)) return { error: 'Dates must be YYYY-MM-DD.' };
  if (start > end) return { error: 'The start date must be on or before the end date.' };
  if (addDaysYmd(start, MAX_REPORT_DAYS) < end) return { error: `Choose at most ${MAX_REPORT_DAYS} days.` };
  return { start, end };
}
