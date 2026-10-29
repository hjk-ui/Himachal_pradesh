/**
 * Clinical urgency used to sort scanner suggestions. Pure. Every point comes from a charted fact
 * and its reason names that fact and date; nothing is estimated. Revenue impact is separate
 * (revenue.ts, fee schedule) and never mixed into this score.
 */
import { WINDOWS } from './criteria';
import type { ClientChart } from './rules';
import { PROGRAMS, type ClientPriority, type ProgramKey, type ProgramResult } from './types';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const within = (d: Date | null | undefined, now: Date, days: number) =>
  Boolean(d && now.getTime() - d.getTime() <= days * DAY && d.getTime() <= now.getTime() + DAY);

export const PRIORITY_WEIGHTS = {
  crisis90: 40,
  cssrsHigh: 30,
  phqSevere: 20,
  phqModSevere: 10,
  noShows: 10,
  candidate: 5,
  potential: 2,
} as const;

export function clientPriority(chart: ClientChart, results: Record<ProgramKey, ProgramResult>, now: Date): ClientPriority {
  let score = 0;
  const reasons: string[] = [];
  const crises = chart.crisisEpisodes.filter((c) => within(c.date, now, 90));
  if (crises.length) {
    score += PRIORITY_WEIGHTS.crisis90;
    reasons.push(`${crises.length} crisis episode${crises.length === 1 ? '' : 's'} in 90 days (latest ${iso(crises[0].date)})`);
  }
  const c = chart.cssrs && within(chart.cssrs.date, now, WINDOWS.cssrs) ? chart.cssrs : null;
  if (c && (c.safetyFlagged || /moderate|high|imminent/i.test(c.severity || ''))) {
    score += PRIORITY_WEIGHTS.cssrsHigh;
    reasons.push(`C-SSRS ${c.severity ?? 'safety-flagged'} on ${iso(c.date)}`);
  }
  const phq = chart.phq9 && within(chart.phq9.date, now, WINDOWS.phq9) ? chart.phq9 : null;
  if (phq && phq.score >= 20) {
    score += PRIORITY_WEIGHTS.phqSevere;
    reasons.push(`PHQ-9 ${phq.score} on ${iso(phq.date)}`);
  } else if (phq && phq.score >= 15) {
    score += PRIORITY_WEIGHTS.phqModSevere;
    reasons.push(`PHQ-9 ${phq.score} on ${iso(phq.date)}`);
  }
  const ns = chart.utilization?.noShows90 ?? 0;
  if (ns >= 2) {
    score += PRIORITY_WEIGHTS.noShows;
    reasons.push(`${ns} missed / late-cancelled appointments in 90 days`);
  }
  for (const p of PROGRAMS) {
    if (results[p].status === 'candidate') score += PRIORITY_WEIGHTS.candidate;
    else if (results[p].status === 'potential') score += PRIORITY_WEIGHTS.potential;
  }
  const level: ClientPriority['level'] = score >= 30 ? 'high' : score >= 10 ? 'medium' : 'low';
  return { score, level, reasons };
}
