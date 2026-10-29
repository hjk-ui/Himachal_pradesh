/**
 * ASAM 3.1 & 3.5 Six-Dimension Qualification Engine
 * Low-intensity (3.1) vs High-intensity (3.5) clinical admission criteria.
 */

export interface AsamInput {
  gates: {
    withdrawalRisk: boolean;
    medicalInstability: boolean;
    acutePsych: boolean;
  };
  dims: [number, number, number, number, number, number]; // D1 to D6 (0-4)
}

export type AsamLevel =
  | 'REFER_UP_MEDICAL'
  | 'REFER_UP_3_7'
  | 'ASAM_3_5'
  | 'ASAM_3_1'
  | 'OUTPATIENT_IOP';

export interface AsamEvaluation {
  level: AsamLevel;
  label: string;
  allowed: boolean;
}

export function evaluateAsamLevel(input: AsamInput): AsamEvaluation {
  const { gates, dims } = input;

  // Exclusionary screening
  if (gates.withdrawalRisk || gates.medicalInstability || gates.acutePsych) {
    return {
      level: 'REFER_UP_MEDICAL',
      label: 'Refer — Medical Inpatient / 3.7-WM Detox',
      allowed: false,
    };
  }

  // Dimensions 1, 2 >= 3 or Dim 3 == 4 requires medically monitored care
  if (dims[0] >= 3 || dims[1] >= 3 || dims[2] >= 4) {
    return {
      level: 'REFER_UP_3_7',
      label: 'Refer — Medically Monitored Intensive (ASAM 3.7)',
      allowed: false,
    };
  }

  // 3.5: High Relapse Potential (Dim 5 >= 3) + Co-occurring / Low readiness
  if (dims[4] >= 3 && (dims[2] >= 2 || dims[3] >= 3)) {
    return {
      level: 'ASAM_3_5',
      label: 'Qualifies — ASAM 3.5 High-Intensity Residential',
      allowed: true,
    };
  }

  // 3.1: Relapse risk >= 2 or living environment >= 2
  if (dims[5] >= 2 || dims[4] >= 2) {
    return {
      level: 'ASAM_3_1',
      label: 'Qualifies — ASAM 3.1 Low-Intensity Residential',
      allowed: true,
    };
  }

  return {
    level: 'OUTPATIENT_IOP',
    label: 'Refer — Outpatient / Intensive Outpatient (ASAM 1.0/2.1)',
    allowed: false,
  };
}
