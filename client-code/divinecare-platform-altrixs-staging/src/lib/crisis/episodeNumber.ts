/**
 * Server-assigned crisis episode numbers: MC-<year>-<sequence>, sequence per organization and
 * year (0001, 0002, ...). The browser never picks the number.
 */
const PATTERN = /^MC-(\d{4})-(\d{4,})$/;

export function formatEpisodeNumber(year: number, seq: number): string {
  return `MC-${year}-${String(seq).padStart(4, '0')}`;
}

/** Next number for `year` given this org's existing episode numbers (any year, any format). */
export function nextEpisodeNumber(year: number, existing: Array<string | null | undefined>): string {
  let max = 0;
  for (const n of existing) {
    const m = n ? PATTERN.exec(n) : null;
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  }
  return formatEpisodeNumber(year, max + 1);
}

/** Calendar year in the practice time zone (an episode at 9 pm Dec 31 Eastern is still that year). */
export function yearInTimeZone(now: Date, timeZone: string | null | undefined): number {
  try {
    const y = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'America/New_York', year: 'numeric' }).format(now);
    const n = Number(y);
    if (Number.isFinite(n)) return n;
  } catch {
    /* invalid zone: fall through */
  }
  return now.getUTCFullYear();
}
