/**
 * Unusual-access review rules for the HIPAA audit log page. Pure, explainable thresholds —
 * no scoring model. Inputs are aggregates computed from AuditLog / SensitiveAccessLog /
 * BreakTheGlassGrant by src/lib/audit/monitoring.ts.
 */

export const MONITORING_TIME_ZONE = 'America/New_York';

export const RULES = {
  /** PHI reads today must be at least this many … */
  highVolumeMinToday: 50,
  /** … and at least this multiple of the user's average on the days they worked (prior 30 days) */
  highVolumeMultiplier: 3,
  /** With no prior 30-day history, flag at this many PHI reads today */
  highVolumeNoHistoryMin: 100,
  /** After hours = before 6:00 or from 20:00 (clinic time), or Saturday / Sunday */
  afterHoursStartHour: 20,
  afterHoursEndHour: 6,
  /** Minimum after-hours PHI events in the last 7 days to list a user */
  afterHoursMinEvents: 3,
  windowDays: 7,
  breakGlassWindowDays: 30,
} as const;

export const RULE_TEXT = {
  highVolume: `PHI reads today of at least ${RULES.highVolumeMinToday} and at least ${RULES.highVolumeMultiplier}x the user's average on the days they worked in the prior 30 days (or ${RULES.highVolumeNoHistoryMin}+ with no prior history).`,
  afterHours: `${RULES.afterHoursMinEvents}+ patient-record events in the last ${RULES.windowDays} days before ${RULES.afterHoursEndHour}:00, from ${RULES.afterHoursStartHour}:00, or on a weekend (Eastern time).`,
  protectedAccess: `Every opening of a protected or 42 CFR Part 2 record in the last ${RULES.windowDays} days (from the protected-record access log).`,
  breakGlass: `Every break-the-glass grant in the last ${RULES.breakGlassWindowDays} days, with the reason given.`,
  denied: `Every denied request in the last ${RULES.windowDays} days (audit log outcome DENIED and denied protected-record opens).`,
} as const;

export type DailyCount = { userId: string; day: string; count: number };

export type HighVolumeFlag = {
  userId: string;
  today: number;
  averagePerActiveDay: number | null;
  activeDays: number;
  ratio: number | null;
  reason: string;
};

/**
 * `daily` = PHI-read counts per user per clinic-local day (YYYY-MM-DD) covering today and the
 * prior 30 days. `today` = the clinic-local date string of today.
 */
export function highVolumeFlags(daily: DailyCount[], today: string): HighVolumeFlag[] {
  const byUser = new Map<string, { today: number; prior: number[] }>();
  for (const d of daily) {
    if (!d.userId) continue;
    const u = byUser.get(d.userId) ?? { today: 0, prior: [] };
    if (d.day === today) u.today += d.count;
    else if (d.day < today) u.prior.push(d.count);
    byUser.set(d.userId, u);
  }
  const flags: HighVolumeFlag[] = [];
  for (const [userId, u] of byUser) {
    const activeDays = u.prior.length;
    if (!activeDays) {
      if (u.today >= RULES.highVolumeNoHistoryMin) {
        flags.push({
          userId,
          today: u.today,
          averagePerActiveDay: null,
          activeDays: 0,
          ratio: null,
          reason: `${u.today} PHI reads today with no activity in the prior 30 days`,
        });
      }
      continue;
    }
    const avg = u.prior.reduce((a, b) => a + b, 0) / activeDays;
    const ratio = avg > 0 ? u.today / avg : null;
    if (u.today >= RULES.highVolumeMinToday && ratio != null && ratio >= RULES.highVolumeMultiplier) {
      flags.push({
        userId,
        today: u.today,
        averagePerActiveDay: Math.round(avg * 10) / 10,
        activeDays,
        ratio: Math.round(ratio * 10) / 10,
        reason: `${u.today} PHI reads today vs an average of ${Math.round(avg)} on ${activeDays} working day${activeDays === 1 ? '' : 's'} (${(Math.round(ratio * 10) / 10).toFixed(1)}x)`,
      });
    }
  }
  return flags.sort((a, b) => b.today - a.today);
}

/** Clinic-local hour (0-23) and weekday (0 = Sunday) for a UTC instant. */
export function localHourAndDay(at: Date, timeZone: string = MONITORING_TIME_ZONE): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { hour, weekday: weekday < 0 ? 1 : weekday };
}

export function isAfterHours(at: Date, timeZone: string = MONITORING_TIME_ZONE): boolean {
  const { hour, weekday } = localHourAndDay(at, timeZone);
  return weekday === 0 || weekday === 6 || hour < RULES.afterHoursEndHour || hour >= RULES.afterHoursStartHour;
}

/** Clinic-local date (YYYY-MM-DD) for a UTC instant. */
export function localDay(at: Date, timeZone: string = MONITORING_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** UTC instant of the most recent clinic-local midnight. */
export function startOfLocalDayUtc(now: Date, timeZone: string = MONITORING_TIME_ZONE): Date {
  const guess = new Date(`${localDay(now, timeZone)}T00:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(guess)
      .map((p) => [p.type, p.value])
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

export type AfterHoursCount ={ userId: string; count: number; lastAt: Date | string };

export function afterHoursFlags(rows: AfterHoursCount[]): AfterHoursCount[] {
  return rows
    .filter((r) => r.userId && r.count >= RULES.afterHoursMinEvents)
    .sort((a, b) => b.count - a.count);
}
