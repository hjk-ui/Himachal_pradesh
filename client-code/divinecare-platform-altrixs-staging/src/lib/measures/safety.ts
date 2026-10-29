/**
 * Safety on a patient-completed measure (pure). PHQ-9 / PHQ-A item 9 > 0, EPDS item 10 > 0, or any
 * instrument whose scoring flags safety (SBQ-R >= 7, ...) immediately raises the existing risk
 * alert path for the treating clinician: a HIGH RiskAlert (Alerts page + Inbox "Risk & MBC
 * alerts"), and the safety-flagged ClinicalAssessmentRecord itself is an MBC escalation
 * (listMbcAlerts). The patient sees the crisis resources page right away.
 */
import type { ScoredMeasure } from './scoring';

export type SafetyAlertPlan = {
  instrumentId: string;
  type: 'suicidal_ideation' | 'safety_screen';
  severity: 'HIGH';
  description: string;
};

/** Where the measure was completed: patient link (default), paper form, or in session (EHR > Assessments) */
export type SafetyAlertVia = 'link' | 'paper' | 'session';

export function safetyAlertsFor(scored: ScoredMeasure[], via: SafetyAlertVia = 'link'): SafetyAlertPlan[] {
  return scored
    .filter((s) => s.safetyFlagged)
    .map((s) => ({
      instrumentId: s.instrumentId,
      type: s.safetyItemPositive ? 'suicidal_ideation' : 'safety_screen',
      severity: 'HIGH',
      description: via === 'session'
        ? s.safetyItemPositive
          ? `${s.instrumentName} safety item endorsed (score ${s.safetyItemScore}) on a measure entered in session. Clinical review is required regardless of total score.`
          : `${s.instrumentName} safety screening threshold reached (total ${s.totalScore}) on a measure entered in session. Clinical review is required.`
        : s.safetyItemPositive
        ? `${s.instrumentName} safety item endorsed (score ${s.safetyItemScore}) on a questionnaire the patient completed before the visit. Clinical review is required regardless of total score. The patient was shown 988 / 911 crisis resources.`
        : `${s.instrumentName} safety screening threshold reached (total ${s.totalScore}) on a questionnaire the patient completed before the visit. Clinical review is required. The patient was shown 988 / 911 crisis resources.`,
    }));
}

/** Patient-facing: whether to switch to the crisis resources page after submitting */
export function showCrisisPage(scored: ScoredMeasure[]): boolean {
  return scored.some((s) => s.safetyFlagged);
}
