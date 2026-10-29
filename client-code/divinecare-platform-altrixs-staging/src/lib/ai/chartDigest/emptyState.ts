/**
 * Chart history empty state (no digest generated yet). Pure and browser-safe: the API, the
 * pre-visit brief facts and ChartHistoryCard all use the same words.
 *
 *  - next visit within 7 days + nightly prep job enabled → "will be prepared before the next visit";
 *  - otherwise → "Not generated yet." (allowed roles still get Generate: on-demand generation stays).
 */
export const CHART_HISTORY_PREP_TEXT = 'Chart history will be prepared before the next visit.';
export const CHART_HISTORY_NOT_GENERATED_TEXT = 'Not generated yet.';
export const UPCOMING_VISIT_DAYS = 7;

export function chartHistoryEmptyState(i: { upcomingVisitWithin7Days: boolean; nightlyPrepEnabled: boolean; canGenerate: boolean }): { text: string; showGenerate: boolean } {
  if (i.upcomingVisitWithin7Days && i.nightlyPrepEnabled) return { text: CHART_HISTORY_PREP_TEXT, showGenerate: i.canGenerate };
  return { text: CHART_HISTORY_NOT_GENERATED_TEXT, showGenerate: i.canGenerate };
}

/**
 * The nightly prep job (scripts/chart-digest-prep.ts) is installed on this server. Set
 * CHART_DIGEST_NIGHTLY_PREP=on only together with the crontab line (owner approval required).
 */
export function isNightlyPrepEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(on|1|true|yes)$/i.test(String(env.CHART_DIGEST_NIGHTLY_PREP ?? '').trim());
}
