/**
 * Maryland Health-General § 10-6A-05 Statutory Screen
 * Assisted Outpatient Treatment eligibility determination engine.
 */

export interface AotCriteria {
  isAdult: boolean;
  meetsInpatient: boolean;
  willVoluntarilyEngage: boolean;
  hasSmi: boolean;
  needsSafetySupervision: boolean;
  historyHospitalizations: boolean; // >=2 stays >=48h in 3 years
  historyViolence: boolean; // >=1 violent act / credible threat in 3 years
  unlikelyAdhereVoluntary: boolean;
  leastRestrictiveAlt: boolean;
}

export type AotAction =
  | 'REFER_CHILD_SERVICES'
  | 'INPATIENT_EMERGENCY_EVAL'
  | 'VOLUNTARY_ENROLLMENT'
  | 'BUILD_PETITION_PACKET'
  | 'OUTPATIENT_ASSERTIVE_ENGAGEMENT';

export interface AotDetermination {
  eligible: boolean;
  action: AotAction;
  statutoryCode?: string;
}

export function evaluateAotEligibility(criteria: AotCriteria): AotDetermination {
  if (!criteria.isAdult) {
    return { eligible: false, action: 'REFER_CHILD_SERVICES' };
  }
  if (criteria.meetsInpatient) {
    return { eligible: false, action: 'INPATIENT_EMERGENCY_EVAL' };
  }
  if (criteria.willVoluntarilyEngage) {
    return { eligible: false, action: 'VOLUNTARY_ENROLLMENT' };
  }

  const threeYearProngMet = criteria.historyHospitalizations || criteria.historyViolence;
  const coreMet =
    criteria.hasSmi &&
    criteria.needsSafetySupervision &&
    criteria.unlikelyAdhereVoluntary &&
    criteria.leastRestrictiveAlt;

  if (coreMet && threeYearProngMet) {
    return {
      eligible: true,
      action: 'BUILD_PETITION_PACKET',
      statutoryCode: 'MD_HG_10_6A_05',
    };
  }

  return { eligible: false, action: 'OUTPATIENT_ASSERTIVE_ENGAGEMENT' };
}
