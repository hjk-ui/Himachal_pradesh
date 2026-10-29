/**
 * Mobile Crisis Triage & Decision Engine (CARF-Aligned)
 * Implements 24/7 crisis triage priority computation and disposition routing.
 */

export interface TriageInput {
  medicalEmergency: boolean;
  weaponViolence: boolean;
  attemptInProgress: boolean;
  suicidalIdeation: boolean;
  hasPlan: boolean;
  intentAndMeans: boolean;
  harmOthers: boolean;
  psychosisSigns: boolean;
  intoxicationSigns: boolean;
  supportPresent: boolean;
  willingToEngage: boolean;
}

export type CrisisPriority = 'P1_IMMINENT' | 'P2_URGENT' | 'P3_ROUTINE';
export type TriageKind =
  | 'EMS_TRANSFER'
  | 'POLICE_CIT'
  | 'DISPATCH_P1'
  | 'DISPATCH_P2'
  | 'TELEHEALTH'
  | 'REFERRAL';

export interface TriageDecision {
  priority: CrisisPriority;
  kind: TriageKind;
  label: string;
  detail: string;
}

export function evaluateCrisisTriage(input: TriageInput): TriageDecision {
  // Gate 1: 911 / EMS Immediate
  if (input.medicalEmergency) {
    return {
      priority: 'P1_IMMINENT',
      kind: 'EMS_TRANSFER',
      label: '911 / EMS Transfer',
      detail: 'Warm-transfer to 911/EMS immediately. Keep caller on line.',
    };
  }

  // Gate 2: Law Enforcement Co-Response
  if (input.weaponViolence) {
    return {
      priority: 'P1_IMMINENT',
      kind: 'POLICE_CIT',
      label: 'CIT Law Enforcement Co-Response',
      detail: 'Weapons or active violence reported. Stage mobile crisis nearby until scene secured.',
    };
  }

  // Gate 3: Imminent Risk
  if (input.attemptInProgress || input.intentAndMeans || (input.hasPlan && input.harmOthers)) {
    return {
      priority: 'P1_IMMINENT',
      kind: 'DISPATCH_P1',
      label: 'Dispatch Mobile Crisis — Priority 1',
      detail: 'Imminent danger. Target face-to-face contact within 60 minutes.',
    };
  }

  // Urgent Risk
  const isUrgent =
    input.hasPlan ||
    input.harmOthers ||
    input.psychosisSigns ||
    (input.suicidalIdeation && !input.supportPresent) ||
    (input.intoxicationSigns && input.suicidalIdeation);

  if (isUrgent) {
    return {
      priority: 'P2_URGENT',
      kind: 'DISPATCH_P2',
      label: 'Dispatch Mobile Crisis — Priority 2',
      detail: 'Urgent risk without imminent means. Target face-to-face response within 2 hours.',
    };
  }

  // Moderate
  if (input.suicidalIdeation || input.willingToEngage) {
    return {
      priority: 'P3_ROUTINE',
      kind: 'TELEHEALTH',
      label: 'Telehealth De-escalation',
      detail: 'Engage client via immediate video session.',
    };
  }

  return {
    priority: 'P3_ROUTINE',
    kind: 'REFERRAL',
    label: 'Referral & 48h Follow-up',
    detail: 'Link to warmline/988 and schedule routine outpatient visit.',
  };
}
