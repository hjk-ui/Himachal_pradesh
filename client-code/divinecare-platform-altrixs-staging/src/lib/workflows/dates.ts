/** Date-only workflow deadlines. UTC arithmetic avoids DST/server-timezone drift. */
export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a valid YYYY-MM-DD date');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Use a valid calendar date');
  }
  return date;
}

export function clinicDate(now = new Date(), timeZone = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Receipt day is day zero. Holidays can be supplied by the clinic policy. */
export function addBusinessDays(value: string, days: number, holidays: readonly string[] = []): string {
  if (!Number.isInteger(days) || days < 0) throw new Error('Business days must be a non-negative integer');
  const date = parseDateOnly(value);
  const excluded = new Set(holidays);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6 && !excluded.has(date.toISOString().slice(0, 10))) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

export function businessDaysBetween(from: string, to: string, holidays: readonly string[] = []): number {
  const current = parseDateOnly(from);
  const end = parseDateOnly(to);
  const excluded = new Set(holidays);
  let days = 0;
  while (current < end) {
    current.setUTCDate(current.getUTCDate() + 1);
    if (![0, 6].includes(current.getUTCDay()) && !excluded.has(current.toISOString().slice(0, 10))) days++;
  }
  return days;
}

/**
 * Review date between today and `maxDays` from today. maxDays comes from the treatment plan review
 * rule (src/lib/ehr/therapy/rules.ts maxReviewDays: adults <= 180 from Practice Settings, under 18
 * <= 90); the default is the child limit, the strictest.
 */
export function validatePlanReviewDate(value: string | Date | null | undefined, now = new Date(), maxDays = 90) {
  if (!value) return { ok: false as const, error: 'A treatment plan review date is required' };
  let date: Date;
  try {
    date = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : new Date(value);
  } catch {
    return { ok: false as const, error: 'Invalid review date' };
  }
  if (!Number.isFinite(date.getTime())) return { ok: false as const, error: 'Invalid review date' };
  const day = date.toISOString().slice(0, 10);
  const today = clinicDate(now);
  if (day < today || day > addCalendarDays(today, maxDays)) {
    return { ok: false as const, error: `Set the review date between today and ${maxDays} days from today` };
  }
  return { ok: true as const, date };
}
