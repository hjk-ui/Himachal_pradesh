/**
 * Standing / recurring lab orders: interval arithmetic and due status. Pure (browser + tests).
 * A standing order is a reminder to place the next order on schedule; it never places one itself —
 * the prescriber places (signs) each order.
 */

export const STANDING_INTERVAL_UNITS = ['days', 'weeks', 'months'] as const;
export type StandingIntervalUnit = (typeof STANDING_INTERVAL_UNITS)[number];

/** Window before the due date in which a standing order shows as "due soon" */
export const DUE_SOON_DAYS = 14;

const DAY_MS = 86_400_000;

/** Add an interval. Months clamp to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addInterval(from: Date, unit: StandingIntervalUnit, count: number): Date {
  const n = Math.max(1, Math.floor(count));
  if (unit === 'days') return new Date(from.getTime() + n * DAY_MS);
  if (unit === 'weeks') return new Date(from.getTime() + n * 7 * DAY_MS);
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * Next due date after an order is placed: one interval from when it was placed, so a late order
 * moves the schedule rather than stacking overdue draws.
 */
export function nextDueAfterOrder(placedAt: Date, unit: StandingIntervalUnit, count: number): Date {
  return addInterval(placedAt, unit, count);
}

export type StandingDueState = 'overdue' | 'due_soon' | 'scheduled' | 'ended';

export function standingDueState(
  s: { active: boolean; nextDueAt: Date | string; endDate?: Date | string | null },
  now: Date
): StandingDueState {
  const due = new Date(s.nextDueAt);
  const end = s.endDate ? new Date(s.endDate) : null;
  if (!s.active || (end && end.getTime() < now.getTime()) || (end && due.getTime() > end.getTime())) return 'ended';
  if (due.getTime() < now.getTime()) return 'overdue';
  if (due.getTime() - now.getTime() <= DUE_SOON_DAYS * DAY_MS) return 'due_soon';
  return 'scheduled';
}

export function describeInterval(unit: StandingIntervalUnit, count: number): string {
  const n = Math.max(1, Math.floor(count));
  const word = unit === 'days' ? 'day' : unit === 'weeks' ? 'week' : 'month';
  return n === 1 ? `Every ${word}` : `Every ${n} ${word}s`;
}

export function isIntervalUnit(v: unknown): v is StandingIntervalUnit {
  return typeof v === 'string' && (STANDING_INTERVAL_UNITS as readonly string[]).includes(v);
}
