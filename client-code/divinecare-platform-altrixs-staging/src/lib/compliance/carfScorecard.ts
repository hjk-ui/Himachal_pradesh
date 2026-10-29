/* eslint-disable @typescript-eslint/no-explicit-any -- module snapshots are untyped JSON lists */

/**
 * CARF readiness scorecard for /dashboard/compliance: six weighted factors computed on the server
 * from the safety-plan, training, QI, incident, grievance and discharge module lists.
 *
 * The page used to read those six lists in the browser. HR and Office Manager open the compliance
 * page but may not read safety plans / discharge cases (client PHI), and HR not incidents /
 * grievances / QI either, so their page showed "Forbidden". Minimum necessary: every compliance
 * viewer gets the percentages only, never the records.
 */
import { computeReadiness } from '@/lib/compliance/metrics';

/** score / overall are null when there is no data for that factor (shown as "No data", never 100%). */
export type CarfFactor = { label: string; score: number | null; note: string };
export type CarfScorecard = { overall: number | null; factors: CarfFactor[]; factorsWithData: number };

export type CarfInputs = {
  safetyPlans: any[];
  trainingStaff: any[];
  qiMeetings: any[];
  incidents: any[];
  grievances: any[];
  dischargeCases: any[];
};

/** Module lists behind the scorecard. Incidents come from the IncidentReport table (not a module). */
export const CARF_SCORECARD_MODULES = {
  safetyPlans: 'ehr-safety-plans',
  trainingStaff: 'hr-training-staff',
  qiMeetings: 'qi-meetings',
  grievances: 'grievances',
  dischargeCases: 'ehr-discharge-cases',
} as const satisfies Record<Exclude<keyof CarfInputs, 'incidents'>, string>;

export function computeCarfScorecard(input: CarfInputs, nowMs = Date.now()): CarfScorecard {
  const r = computeReadiness({ ...input, now: new Date(nowMs) });
  return {
    overall: r.overall,
    factorsWithData: r.factorsWithData,
    factors: r.factors.map((f) => ({ label: `${f.label} (${f.weight}%)`, score: f.score, note: f.note })),
  };
}

export const EMPTY_CARF_SCORECARD: CarfScorecard = computeCarfScorecard({
  safetyPlans: [],
  trainingStaff: [],
  qiMeetings: [],
  incidents: [],
  grievances: [],
  dischargeCases: [],
});
