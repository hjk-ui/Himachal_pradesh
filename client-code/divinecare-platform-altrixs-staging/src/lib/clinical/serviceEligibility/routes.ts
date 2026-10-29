/** Scanner page routes (pure). The page-access rule '/dashboard/ehr/scanner' prefix covers both. */
export const SERVICE_SCANNER_HREF = '/dashboard/ehr/scanner';
export const SUD_RADAR_HREF = '/dashboard/ehr/scanner/sud-radar';

const RADAR_PARAM = /^(sud-?radar|radar|sud)$/i;

/** Old SUD Referral Radar deep links (?tab=sud-radar / ?view=radar / ?radar=1) → the radar page. */
export function radarRedirectTarget(params: Record<string, string | string[] | undefined>): string | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tab = first(params.tab) ?? first(params.view) ?? first(params.section);
  if ((tab && RADAR_PARAM.test(tab)) || first(params.radar) === '1') return SUD_RADAR_HREF;
  return null;
}
