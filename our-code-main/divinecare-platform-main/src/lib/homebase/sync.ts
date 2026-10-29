import { prisma } from '@/lib/db/prisma';
import {
  HomebaseError,
  getHomebaseConfigFor,
  listHomebaseEmployees,
  listHomebaseLocations,
  listHomebaseTimecards,
  type HomebaseConfig,
  type HomebaseLocation,
} from './client';

/**
 * Homebase → Altrixs, one direction. Reads locations / employees / hours; the only writes are to our own
 * HomebaseSyncRun and HomebaseEmployeeLink tables. When Homebase is not connected every function returns
 * empties — nothing is ever invented.
 */

export type HomebaseStatus = {
  connected: boolean;
  readOnly: true;
  lastRun: {
    id: string;
    status: string;
    trigger: string;
    startedAt: string;
    finishedAt: string | null;
    locationCount: number;
    employeeCount: number;
    matchedCount: number;
    error: string | null;
  } | null;
};

export type SyncResult =
  | { connected: false; locations: 0; employees: 0; matched: 0 }
  | { connected: true; ok: true; runId: string; locations: number; employees: number; matched: number }
  | { connected: true; ok: false; runId: string; error: string };

const normalizeName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export async function getHomebaseStatus(organizationId: string): Promise<HomebaseStatus> {
  const connected = Boolean(getHomebaseConfigFor(organizationId));
  const run = await prisma.homebaseSyncRun.findFirst({
    where: { organizationId },
    orderBy: { startedAt: 'desc' },
  });
  return {
    connected,
    readOnly: true,
    lastRun: run
      ? {
          id: run.id,
          status: run.status,
          trigger: run.trigger,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          locationCount: run.locationCount,
          employeeCount: run.employeeCount,
          matchedCount: run.matchedCount,
          error: run.error,
        }
      : null,
  };
}

export async function syncHomebase(input: {
  organizationId: string;
  trigger: 'manual' | 'cron';
  startedById?: string | null;
}): Promise<SyncResult> {
  const config = getHomebaseConfigFor(input.organizationId);
  if (!config) return { connected: false, locations: 0, employees: 0, matched: 0 };

  const run = await prisma.homebaseSyncRun.create({
    data: { organizationId: input.organizationId, trigger: input.trigger, startedById: input.startedById ?? null },
  });
  try {
    const locations = await listHomebaseLocations(config);
    const staff = await prisma.user.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    // Auto-match only when exactly one local staff member has that full name.
    const byName = new Map<string, string[]>();
    for (const u of staff) {
      if (!u.name) continue;
      const key = normalizeName(u.name);
      byName.set(key, [...(byName.get(key) || []), u.id]);
    }

    let employees = 0;
    let matched = 0;
    for (const loc of locations) {
      for (const emp of await listHomebaseEmployees(config, loc.id)) {
        employees += 1;
        const existing = await prisma.homebaseEmployeeLink.findUnique({
          where: {
            organizationId_homebaseEmployeeId: { organizationId: input.organizationId, homebaseEmployeeId: emp.id },
          },
        });
        const candidates = byName.get(normalizeName(emp.name)) || [];
        const autoUserId = !existing?.userId && existing?.matchStatus !== 'IGNORED' && candidates.length === 1 ? candidates[0] : null;
        const link = await prisma.homebaseEmployeeLink.upsert({
          where: {
            organizationId_homebaseEmployeeId: { organizationId: input.organizationId, homebaseEmployeeId: emp.id },
          },
          create: {
            organizationId: input.organizationId,
            homebaseEmployeeId: emp.id,
            homebaseLocationId: loc.id,
            displayName: emp.name || null,
            userId: autoUserId,
            matchStatus: autoUserId ? 'MATCHED' : 'UNMATCHED',
            matchedBy: autoUserId ? 'auto-name' : null,
          },
          update: {
            homebaseLocationId: loc.id,
            displayName: emp.name || null,
            ...(autoUserId ? { userId: autoUserId, matchStatus: 'MATCHED', matchedBy: 'auto-name' } : {}),
          },
        });
        if (link.userId) matched += 1;
      }
    }

    await prisma.homebaseSyncRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        locationCount: locations.length,
        employeeCount: employees,
        matchedCount: matched,
        finishedAt: new Date(),
      },
    });
    return { connected: true, ok: true, runId: run.id, locations: locations.length, employees, matched };
  } catch (err) {
    const message = err instanceof HomebaseError ? err.message : 'Homebase sync failed';
    await prisma.homebaseSyncRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: message, finishedAt: new Date() },
    });
    return { connected: true, ok: false, runId: run.id, error: message };
  }
}

export async function listHomebaseLocationsFor(organizationId: string): Promise<HomebaseLocation[]> {
  const config = getHomebaseConfigFor(organizationId);
  return config ? listHomebaseLocations(config) : [];
}

export type RosterRow = {
  linkId: string;
  homebaseEmployeeId: string;
  homebaseLocationId: string | null;
  displayName: string | null;
  matchStatus: string;
  userId: string | null;
  userName: string | null;
};

export async function listRoster(organizationId: string): Promise<RosterRow[]> {
  if (!getHomebaseConfigFor(organizationId)) return [];
  const links = await prisma.homebaseEmployeeLink.findMany({
    where: { organizationId },
    orderBy: [{ matchStatus: 'asc' }, { displayName: 'asc' }],
  });
  const userIds = links.map((l) => l.userId).filter((v): v is string => Boolean(v));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return links.map((l) => ({
    linkId: l.id,
    homebaseEmployeeId: l.homebaseEmployeeId,
    homebaseLocationId: l.homebaseLocationId,
    displayName: l.displayName,
    matchStatus: l.matchStatus,
    userId: l.userId,
    userName: l.userId ? (names.get(l.userId) ?? null) : null,
  }));
}

/** Manual roster decision — local only. `userId: null` with `ignore` marks the employee as not staff here. */
export async function setRosterMatch(input: {
  organizationId: string;
  linkId: string;
  userId: string | null;
  ignore?: boolean;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const link = await prisma.homebaseEmployeeLink.findFirst({
    where: { id: input.linkId, organizationId: input.organizationId },
  });
  if (!link) return { ok: false, status: 404, error: 'Employee not found' };
  if (input.userId) {
    const user = await prisma.user.findFirst({
      where: { id: input.userId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!user) return { ok: false, status: 404, error: 'Staff member not found' };
  }
  await prisma.homebaseEmployeeLink.update({
    where: { id: link.id },
    data: {
      userId: input.userId,
      matchStatus: input.userId ? 'MATCHED' : input.ignore ? 'IGNORED' : 'UNMATCHED',
      matchedBy: input.actorId,
    },
  });
  return { ok: true };
}

export type HoursRow = {
  homebaseEmployeeId: string;
  displayName: string | null;
  userName: string | null;
  matchStatus: string;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
};

export type DateRange = { start: string; end: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Default window: the last 14 days. */
export function resolveRange(start?: string | null, end?: string | null, now = new Date()): DateRange | null {
  if (start && !DATE_RE.test(start)) return null;
  if (end && !DATE_RE.test(end)) return null;
  const endDate = end || now.toISOString().slice(0, 10);
  const startDate = start || new Date(now.getTime() - 13 * 86_400_000).toISOString().slice(0, 10);
  if (startDate > endDate) return null;
  if (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime() > 92 * 86_400_000) return null;
  return { start: startDate, end: endDate };
}

async function collectHours(organizationId: string, config: HomebaseConfig, range: DateRange): Promise<HoursRow[]> {
  const locations = await listHomebaseLocations(config);
  const links = await prisma.homebaseEmployeeLink.findMany({ where: { organizationId } });
  const linkByEmp = new Map(links.map((l) => [l.homebaseEmployeeId, l]));
  const userIds = links.map((l) => l.userId).filter((v): v is string => Boolean(v));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, name: true } })
    : [];
  const userNames = new Map(users.map((u) => [u.id, u.name]));

  const totals = new Map<string, HoursRow>();
  for (const loc of locations) {
    for (const t of await listHomebaseTimecards(config, loc.id, range)) {
      const link = linkByEmp.get(t.employeeId);
      const row =
        totals.get(t.employeeId) ??
        ({
          homebaseEmployeeId: t.employeeId,
          displayName: link?.displayName ?? null,
          userName: link?.userId ? (userNames.get(link.userId) ?? null) : null,
          matchStatus: link?.matchStatus ?? 'UNMATCHED',
          regularHours: 0,
          overtimeHours: 0,
          totalHours: 0,
        } satisfies HoursRow);
      row.regularHours += t.regularHours;
      row.overtimeHours += t.overtimeHours;
      row.totalHours = row.regularHours + row.overtimeHours;
      totals.set(t.employeeId, row);
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return [...totals.values()]
    .map((r) => ({ ...r, regularHours: round(r.regularHours), overtimeHours: round(r.overtimeHours), totalHours: round(r.totalHours) }))
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

export async function listHours(organizationId: string, range: DateRange): Promise<HoursRow[]> {
  const config = getHomebaseConfigFor(organizationId);
  return config ? collectHours(organizationId, config, range) : [];
}

export type PayrollReconciliation = {
  range: DateRange;
  /** Staff-matched employees: hours ready to reconcile. */
  matched: HoursRow[];
  /** Employees with hours but no staff match — must be matched before payroll. */
  unmatched: HoursRow[];
  matchedTotalHours: number;
  unmatchedTotalHours: number;
};

/** Hours only. No wages are read or returned, so this reconciles hours, not dollars. */
export async function payrollReconciliation(organizationId: string, range: DateRange): Promise<PayrollReconciliation> {
  const rows = await listHours(organizationId, range);
  const matched = rows.filter((r) => r.matchStatus === 'MATCHED');
  const unmatched = rows.filter((r) => r.matchStatus !== 'MATCHED' && r.matchStatus !== 'IGNORED');
  const sum = (xs: HoursRow[]) => Math.round(xs.reduce((n, r) => n + r.totalHours, 0) * 100) / 100;
  return { range, matched, unmatched, matchedTotalHours: sum(matched), unmatchedTotalHours: sum(unmatched) };
}
