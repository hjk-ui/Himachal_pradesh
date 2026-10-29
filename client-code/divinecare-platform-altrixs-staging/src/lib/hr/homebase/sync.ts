/**
 * Homebase → Altrixs sync (READ-ONLY toward Homebase: GETs only, nothing is ever sent).
 *
 * One run, for a date range:
 *   1. /locations                         → HomebaseLocation (mapping to Altrixs locations is HR's)
 *   2. /locations/{uuid}/employees         → HomebaseEmployee, merged across locations, then matched
 *                                            to Altrixs staff (email = link; name = suggestion)
 *   3. /locations/{uuid}/shifts            → HomebaseShift
 *      /locations/{uuid}/timecards         → HomebaseTimecard
 *      /locations/{uuid}/shifts/deleted    → deletedAt on cached shifts
 *      /locations/{uuid}/timecards/deleted → deletedAt on cached timecards
 * A failing per-location endpoint makes the run "partial" (the rest still syncs); a failing
 * /locations makes it "failed". Run rows hold counts only.
 */
import { addDaysYmd, daysBetween } from '@/lib/hr/standard';
import { HomebaseApiError, type HomebaseClient } from './client';
import { mapDeletedIds, mapEmployee, mapLocation, mapShift, mapTimecard, type HbEmployee } from './mappers';
import { matchEmployees } from './matching';
import type { HomebaseStore } from './store';

/** Advisory lock (src/lib/jobs/advisoryLock.ts), suffixed with the organization id; shared by Sync now and the cron script */
export const HOMEBASE_SYNC_LOCK_KEY = 'job:homebase-sync';
export const MAX_SYNC_RANGE_DAYS = 93;
export const DEFAULT_LOOKBACK_DAYS = 31;
export const DEFAULT_LOOKAHEAD_DAYS = 14;

export type SyncRange = { startDate: string; endDate: string };

export function defaultSyncRange(today: string, lookbackDays = DEFAULT_LOOKBACK_DAYS): SyncRange {
  return { startDate: addDaysYmd(today, -lookbackDays), endDate: addDaysYmd(today, DEFAULT_LOOKAHEAD_DAYS) };
}

export function validateSyncRange(r: SyncRange): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(r.startDate) || !re.test(r.endDate)) return 'Dates must be YYYY-MM-DD.';
  const d = daysBetween(r.startDate, r.endDate);
  if (d < 0) return 'The start date must be on or before the end date.';
  if (d > MAX_SYNC_RANGE_DAYS) return `Sync at most ${MAX_SYNC_RANGE_DAYS} days at a time.`;
  return null;
}

export type SyncCounts = {
  locations: number;
  employees: number;
  linkedByEmail: number;
  nameSuggestions: number;
  shifts: number;
  timecards: number;
  deletedShifts: number;
  deletedTimecards: number;
  failedCalls: number;
  requests: number;
};

export type SyncResult = { runId: string; status: 'success' | 'partial' | 'failed'; counts: SyncCounts; error: string | null };

function safeMessage(err: unknown): string {
  if (err instanceof HomebaseApiError) return err.message;
  return 'Unexpected error during Homebase sync.';
}

/** Merge the same Homebase employee seen at several locations. */
export function mergeEmployees(list: HbEmployee[]): HbEmployee[] {
  const byId = new Map<string, HbEmployee>();
  for (const e of list) {
    const prev = byId.get(e.homebaseId);
    if (!prev) {
      byId.set(e.homebaseId, { ...e, locationIds: [...e.locationIds] });
      continue;
    }
    byId.set(e.homebaseId, {
      homebaseId: e.homebaseId,
      firstName: prev.firstName ?? e.firstName,
      lastName: prev.lastName ?? e.lastName,
      email: prev.email ?? e.email,
      jobTitle: prev.jobTitle ?? e.jobTitle,
      // Active at any location = active
      status: prev.status === 'active' || e.status === 'active' ? 'active' : prev.status === 'archived' || e.status === 'archived' ? 'archived' : 'unknown',
      locationIds: [...new Set([...prev.locationIds, ...e.locationIds])],
    });
  }
  return [...byId.values()];
}

export async function runHomebaseSync(opts: {
  organizationId: string;
  client: HomebaseClient;
  store: HomebaseStore;
  range: SyncRange;
  trigger: 'manual' | 'cron';
  triggeredById: string | null;
}): Promise<SyncResult> {
  const { organizationId, client, store, range } = opts;
  const counts: SyncCounts = { locations: 0, employees: 0, linkedByEmail: 0, nameSuggestions: 0, shifts: 0, timecards: 0, deletedShifts: 0, deletedTimecards: 0, failedCalls: 0, requests: 0 };
  const runId = await store.startRun(organizationId, { trigger: opts.trigger, triggeredById: opts.triggeredById, rangeStart: range.startDate, rangeEnd: range.endDate });
  let firstError: string | null = null;
  const fail = (err: unknown) => {
    counts.failedCalls++;
    firstError ??= safeMessage(err);
  };

  try {
    const locPage = await client.locations();
    const locations = locPage.items.map(mapLocation).filter((l): l is NonNullable<typeof l> => !!l);
    await store.upsertLocations(organizationId, locations);
    counts.locations = locations.length;

    const employees: HbEmployee[] = [];
    for (const loc of locations) {
      try {
        const page = await client.employees(loc.homebaseId);
        for (const raw of page.items) {
          const e = mapEmployee(raw, loc.homebaseId);
          if (e) employees.push(e);
        }
      } catch (err) {
        fail(err);
      }
    }
    const merged = mergeEmployees(employees);
    const staff = await store.loadStaffForMatch(organizationId);
    const existing = await store.loadEmployeeLinks(organizationId);
    const decisions = matchEmployees(merged, staff, existing);
    const rows = merged.map((e) => ({ ...e, ...decisions.get(e.homebaseId)! }));
    await store.upsertEmployees(organizationId, rows);
    counts.employees = rows.length;
    counts.linkedByEmail = rows.filter((r) => r.linkStatus === 'email').length;
    counts.nameSuggestions = rows.filter((r) => r.linkStatus === 'suggested').length;

    for (const loc of locations) {
      const r = { startDate: range.startDate, endDate: range.endDate };
      try {
        const shifts = (await client.shifts(loc.homebaseId, r)).items.map((s) => mapShift(s, loc.homebaseId)).filter((s): s is NonNullable<typeof s> => !!s);
        await store.upsertShifts(organizationId, shifts);
        counts.shifts += shifts.length;
      } catch (err) {
        fail(err);
      }
      try {
        const cards = (await client.timecards(loc.homebaseId, r)).items.map((t) => mapTimecard(t, loc.homebaseId)).filter((t): t is NonNullable<typeof t> => !!t);
        await store.upsertTimecards(organizationId, cards);
        counts.timecards += cards.length;
      } catch (err) {
        fail(err);
      }
      try {
        counts.deletedShifts += await store.markShiftsDeleted(organizationId, mapDeletedIds((await client.deletedShifts(loc.homebaseId, r)).items));
      } catch (err) {
        fail(err);
      }
      try {
        counts.deletedTimecards += await store.markTimecardsDeleted(organizationId, mapDeletedIds((await client.deletedTimecards(loc.homebaseId, r)).items));
      } catch (err) {
        fail(err);
      }
    }
  } catch (err) {
    counts.requests = client.requestCount;
    const error = safeMessage(err);
    await store.finishRun(runId, 'failed', counts, error);
    return { runId, status: 'failed', counts, error };
  }
  counts.requests = client.requestCount;
  const status = counts.failedCalls ? 'partial' : 'success';
  await store.finishRun(runId, status, counts, firstError);
  return { runId, status, counts, error: firstError };
}
