/**
 * Saved reports and scheduled delivery: pure rules (browser-safe, unit tested).
 *
 * A saved report stores the report id and its parameters only. A schedule emails the owner a
 * sign-in link to the report (no PHI in the email); the report runs, with the owner's current
 * access, when the link is opened. Relative presets (last month, YTD...) roll forward by themselves.
 */
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday, zonedWallTimeToUtc } from '@/lib/time/practiceTime';
import { addDaysYmd, resolveReportParams, type RawParams } from './params';
import type { ReportMeta } from './types';

export const SCHEDULES = [
  { value: 'none', label: 'Do not email' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly (1st of the month)' },
] as const;
export type Schedule = (typeof SCHEDULES)[number]['value'];
export const SAVED_VIEWS_PER_USER = 50;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function isSchedule(v: unknown): v is Schedule {
  return typeof v === 'string' && SCHEDULES.some((s) => s.value === v);
}

function at(ymd: string, hour: number, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return zonedWallTimeToUtc(y, m, d, hour, 0, tz);
}

function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** Next delivery strictly after `after`, at `hour` on the practice clock. null for 'none'. */
export function nextScheduledRun(
  schedule: Schedule,
  hour: number,
  weekday: number | null,
  after: Date,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): Date | null {
  if (schedule === 'none') return null;
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const today = practiceToday(timeZone, after);
  for (let i = 0; i <= 62; i++) {
    const day = addDaysYmd(today, i);
    const ok =
      schedule === 'daily' ||
      (schedule === 'weekly' && weekdayOf(day) === (weekday ?? 1)) ||
      (schedule === 'monthly' && day.endsWith('-01'));
    if (!ok) continue;
    const t = at(day, h, timeZone);
    if (t.getTime() > after.getTime()) return t;
  }
  return null;
}

export function scheduleLabel(schedule: string, hour: number, weekday: number | null): string {
  if (schedule === 'none') return 'Not emailed';
  const time = `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
  if (schedule === 'daily') return `Daily at ${time}`;
  if (schedule === 'weekly') return `${WEEKDAYS[weekday ?? 1]}s at ${time}`;
  return `1st of each month at ${time}`;
}

/**
 * The parameters to store for a saved report: only the report's own declared parameters, after the
 * same validation a run uses. from / to are kept only for a custom range.
 */
export function savedParamsFor(meta: Pick<ReportMeta, 'params'>, raw: RawParams): { ok: true; params: Record<string, string> } | { ok: false; error: string } {
  const r = resolveReportParams(meta, raw);
  if ('error' in r) return { ok: false, error: r.error };
  const out: Record<string, string> = {};
  for (const spec of meta.params) {
    if (spec.kind === 'dateRange' && r.params.range) {
      out.preset = r.params.range.preset;
      if (r.params.range.preset === 'custom') {
        out.from = r.params.range.fromDate;
        out.to = r.params.range.toDate;
      }
    } else if (spec.kind === 'site' && r.params.site) out.site = r.params.site;
    else if (spec.kind === 'provider' && r.params.provider) out.provider = r.params.provider;
    else if (spec.kind === 'payer' && r.params.payer) out.payer = r.params.payer;
    else if (spec.kind === 'select') out[spec.key] = r.params.values[spec.key];
  }
  return { ok: true, params: out };
}

/** Link to the saved report (sign-in required). Parameters are ids / dates / options, never PHI. */
export function savedReportPath(reportId: string, savedId: string, params: Record<string, string>): string {
  const sp = new URLSearchParams({ ...params, saved: savedId });
  return `/dashboard/reports/run/${encodeURIComponent(reportId)}?${sp.toString()}`;
}

/**
 * The scheduled email: the report title (from the catalog) and a link only. The saved view's own
 * name is free text a user typed, so it is never put in the email.
 */
export function scheduledEmail(input: { reportTitle: string; url: string; scheduleText: string }) {
  const subject = `Altrixs report ready: ${input.reportTitle}`;
  const text = [
    `Your scheduled ${input.reportTitle} report is ready.`,
    '',
    `Open it in Altrixs (sign-in required): ${input.url}`,
    '',
    'The report runs with your current access when you open it. This email contains no patient information.',
    `Schedule: ${input.scheduleText}. To stop these emails, remove the schedule from the saved report in the Report library.`,
  ].join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<p>Your scheduled <strong>${esc(input.reportTitle)}</strong> report is ready.</p>
<p><a href="${esc(input.url)}" style="background:#5C2D91;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Open the report in Altrixs</a></p>
<p style="color:#64748b;font-size:12px">Sign-in required. The report runs with your current access when you open it. This email contains no patient information.<br>Schedule: ${esc(input.scheduleText)}. To stop these emails, remove the schedule from the saved report in the Report library.</p>`;
  return { subject, text, html };
}
