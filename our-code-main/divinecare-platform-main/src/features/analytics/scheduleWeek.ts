/** Mon–Fri week window for Schedule Analytics (local calendar dates). */

export const WEEKDAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export type WeekDayKey = (typeof WEEKDAY_KEYS)[number];

export type WeekDay = {
  key: WeekDayKey;
  date: string;
  isToday: boolean;
  isPast: boolean;
  iso: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function shortDate(d: Date) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Monday of the week containing `now`, shifted by `weekOffset` weeks (negative = past). */
export function mondayOfWeek(now: Date, weekOffset = 0): Date {
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset + weekOffset * 7);
}

export function weekDaysForOffset(weekOffset = 0, now = new Date()): WeekDay[] {
  const monday = mondayOfWeek(now, weekOffset);
  const today = startOfLocalDay(now);
  return WEEKDAY_KEYS.map((key, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const cmp = startOfLocalDay(d);
    return {
      key,
      date: shortDate(d),
      isToday: cmp.getTime() === today.getTime(),
      isPast: cmp.getTime() < today.getTime(),
      iso: isoDate(d),
    };
  });
}

export function formatWeekRange(days: Pick<WeekDay, 'date'>[]): string {
  if (days.length === 0) return '';
  return `${days[0].date} – ${days[days.length - 1].date}`;
}

export function appointmentsInWeek<T extends { date: string }>(
  appts: T[],
  weekDays: Pick<WeekDay, 'iso'>[]
): T[] {
  const isoSet = new Set(weekDays.map((d) => d.iso));
  return appts.filter((row) => isoSet.has(row.date));
}
