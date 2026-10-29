import { fromPracticeWallTime, toPracticeWallTime } from '@/lib/time/practiceTime';

/**
 * Online-booking slot generation on the PRACTICE clock. Business hours ("09:00"-"17:00") are
 * practice wall time. Before, they were applied with Date#setHours on a UTC server, so a
 * 9-5 ET practice offered 5 AM-1 PM ET slots.
 */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** Weekday of a YYYY-MM-DD calendar date (zone-independent). */
export function weekdayKey(ymd: string): DayKey {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days, 12));
  return t.toISOString().slice(0, 10);
}

/** [start, end) UTC instants of one practice calendar day. */
export function practiceDayBounds(ymd: string, timeZone: string): { start: Date; end: Date } | null {
  const start = fromPracticeWallTime(ymd, '00:00', timeZone);
  const end = fromPracticeWallTime(addDaysYmd(ymd, 1), '00:00', timeZone);
  return start && end ? { start, end } : null;
}

export type SlotHours = Partial<Record<string, { enabled: boolean; start: string; end: string } | undefined>>;

export function generateBookingSlots(opts: {
  from: Date;
  to: Date;
  now: Date;
  timeZone: string;
  hours: SlotHours;
  durationMin: number;
  bufferMinutes: number;
  minNoticeDays: number;
  bookAheadDays: number;
  booked: { startsAt: Date; endsAt: Date; clinicianId: string | null }[];
  providerId?: string | null;
}): { startsAt: string; endsAt: string }[] {
  const { timeZone, durationMin } = opts;
  const minStart = new Date(opts.now.getTime() + opts.minNoticeDays * 24 * 60 * 60 * 1000);
  const maxEnd = new Date(opts.now.getTime() + opts.bookAheadDays * 24 * 60 * 60 * 1000);
  const lastDay = toPracticeWallTime(opts.to < maxEnd ? opts.to : maxEnd, timeZone).date;
  const step = (durationMin + Math.max(0, opts.bufferMinutes)) * 60_000;
  if (durationMin <= 0) return [];

  const slots: { startsAt: string; endsAt: string }[] = [];
  for (let day = toPracticeWallTime(opts.from, timeZone).date; day <= lastDay; day = addDaysYmd(day, 1)) {
    const hours = opts.hours[weekdayKey(day)];
    if (!hours?.enabled) continue;
    const dayStart = fromPracticeWallTime(day, hours.start, timeZone);
    const dayEnd = fromPracticeWallTime(day, hours.end, timeZone);
    if (!dayStart || !dayEnd) continue;
    for (let t = dayStart.getTime(); t + durationMin * 60_000 <= dayEnd.getTime(); t += step) {
      const slotStart = new Date(t);
      const slotEnd = new Date(t + durationMin * 60_000);
      if (slotStart < opts.from || slotStart > opts.to || slotStart > maxEnd) continue;
      if (slotStart < minStart || slotStart <= opts.now) continue;
      const overlap = opts.booked.some((b) => {
        if (opts.providerId && b.clinicianId && b.clinicianId !== opts.providerId) return false;
        return b.startsAt < slotEnd && b.endsAt > slotStart;
      });
      if (!overlap) slots.push({ startsAt: slotStart.toISOString(), endsAt: slotEnd.toISOString() });
    }
  }
  return slots;
}
