/**
 * Office manager operations rollup (pure; tests/front-office.test.ts). Takes huddle rows and
 * returns per-location readiness and the exceptions queue. Counts and appointment references only:
 * no clinical content, no note text.
 */
import { isOpen } from './rules';
import type { FoItemId, FoRow } from './types';

export type LocationRollup = {
  locationId: string | null;
  locationName: string;
  date: string;
  visits: number;
  ready: number;
  attention: number;
  stop: number;
  open: number;
};

export type ExceptionKey =
  | 'eligibility'
  | 'authorization'
  | 'demographics'
  | 'consents'
  | 'confirm'
  | 'carelon'
  | 'intake'
  | 'identity'
  | 'copay'
  | 'reschedule';

export const EXCEPTION_LABELS: Record<ExceptionKey, string> = {
  eligibility: 'Eligibility not verified / failed',
  authorization: 'Authorization missing or out of units',
  demographics: 'Demographics incomplete (blocks claims)',
  consents: 'Consents missing for upcoming visits',
  confirm: 'Unconfirmed appointments',
  carelon: 'Carelon attestation needed',
  intake: 'New-client intake not completed',
  identity: 'Online bookings: identity not verified',
  copay: 'Copays expected, not posted',
  reschedule: 'No-shows / late cancels not rebooked',
};

const EXCEPTION_ORDER: ExceptionKey[] = ['eligibility', 'authorization', 'demographics', 'consents', 'carelon', 'identity', 'intake', 'confirm', 'copay', 'reschedule'];

export type ExceptionRef = { appointmentId: string; clientName: string; date: string; startTime: string; locationName: string | null; reason: string };
export type ExceptionGroup = { key: ExceptionKey; label: string; count: number; items: ExceptionRef[] };

export function rollupByLocation(rows: readonly FoRow[], date: string): LocationRollup[] {
  const m = new Map<string, LocationRollup>();
  for (const r of rows) {
    if (r.date !== date || r.status === 'CANCELLED') continue;
    const key = r.locationId ?? '';
    const e = m.get(key) ?? { locationId: r.locationId, locationName: r.locationName ?? 'No location', date, visits: 0, ready: 0, attention: 0, stop: 0, open: 0 };
    e.visits += 1;
    if (r.readiness === 'ready' || r.readiness === 'closed') e.ready += 1;
    else if (r.readiness === 'stop') e.stop += 1;
    else e.attention += 1;
    e.open += r.items.filter((x) => isOpen(x) && x.level === 'required').length;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => a.locationName.localeCompare(b.locationName));
}

/**
 * Exceptions queue: open items of the given kinds, soonest visit first. Copay and reschedule only
 * count for visits on or before `today` (they are day-of work).
 */
export function exceptionQueue(rows: readonly FoRow[], today: string, perGroup = 8): ExceptionGroup[] {
  const groups = new Map<ExceptionKey, ExceptionRef[]>();
  const sorted = [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const r of sorted) {
    for (const x of r.items) {
      if (!isOpen(x)) continue;
      const key = x.id as FoItemId as ExceptionKey;
      if (!EXCEPTION_ORDER.includes(key)) continue;
      if ((key === 'copay' || key === 'reschedule') && r.date > today) continue;
      const list = groups.get(key) ?? [];
      list.push({ appointmentId: r.appointmentId, clientName: r.clientName, date: r.date, startTime: r.startTime, locationName: r.locationName, reason: x.reason });
      groups.set(key, list);
    }
  }
  return EXCEPTION_ORDER.filter((k) => groups.has(k)).map((k) => {
    const list = groups.get(k)!;
    return { key: k, label: EXCEPTION_LABELS[k], count: list.length, items: list.slice(0, perGroup) };
  });
}

/** Unsigned notes past the signing deadline, counted per clinician (no note content). */
export function unsignedByClinician(
  visits: ReadonlyArray<{ clinicianName: string | null; endsAt: Date; signed: boolean }>,
  deadlineHours: number,
  now: Date
): { clinicianName: string; count: number; oldestDays: number }[] {
  const m = new Map<string, { count: number; oldest: number }>();
  for (const v of visits) {
    if (v.signed) continue;
    const dueAt = v.endsAt.getTime() + deadlineHours * 3_600_000;
    if (dueAt > now.getTime()) continue;
    const name = v.clinicianName?.trim() || 'Unassigned';
    const e = m.get(name) ?? { count: 0, oldest: now.getTime() };
    e.count += 1;
    e.oldest = Math.min(e.oldest, v.endsAt.getTime());
    m.set(name, e);
  }
  return [...m.entries()]
    .map(([clinicianName, e]) => ({ clinicianName, count: e.count, oldestDays: Math.floor((now.getTime() - e.oldest) / 86_400_000) }))
    .sort((a, b) => b.count - a.count || a.clinicianName.localeCompare(b.clinicianName));
}
