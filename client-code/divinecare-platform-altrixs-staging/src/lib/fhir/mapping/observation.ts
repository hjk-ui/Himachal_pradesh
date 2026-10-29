import { SYSTEMS, fhirDateTime, fhirId, ref, type FhirResource } from './common';
import { finalize, type MapContext } from './meta';
import type { AssessmentRow } from './types';

/**
 * Instruments mapped to Observation, keyed by our catalog instrumentId. Only total-score
 * LOINC codes we are certain of; other instruments are not sent.
 *  - PHQ-9 total score 44261-6 (member of the PHQ-9 panel 44249-1)
 *  - GAD-7 total score 70274-6 (member of the GAD-7 panel 69737-5)
 *  - PHQ-2 total score 55758-7
 */
export const ASSESSMENT_LOINC: Record<string, { code: string; display: string; panel?: string; max: number }> = {
  'phq-9': { code: '44261-6', display: 'Patient Health Questionnaire 9 item (PHQ-9) total score [Reported]', panel: '44249-1', max: 27 },
  'gad-7': { code: '70274-6', display: 'Generalized anxiety disorder 7 item (GAD-7) total score [Reported.PHQ]', panel: '69737-5', max: 21 },
  'phq-2': { code: '55758-7', display: 'Patient Health Questionnaire 2 item (PHQ-2) total score [Reported]', max: 6 },
};

export function isMappedAssessment(a: Pick<AssessmentRow, 'instrumentId' | 'totalScore'>): boolean {
  const spec = ASSESSMENT_LOINC[a.instrumentId];
  return !!spec && typeof a.totalScore === 'number' && Number.isFinite(a.totalScore) && a.totalScore >= 0 && a.totalScore <= spec.max;
}

/** ClinicalAssessmentRecord -> Observation (survey); null when the instrument is not mapped. */
export function mapAssessmentObservation(a: AssessmentRow, ctx: MapContext): FhirResource | null {
  if (!isMappedAssessment(a)) return null;
  const spec = ASSESSMENT_LOINC[a.instrumentId]!;
  return finalize(
    {
      resourceType: 'Observation',
      id: fhirId('asmt', a.id),
      identifier: [{ system: 'urn:altrixs:assessment', value: a.id }],
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.observationCategory, code: 'survey', display: 'Survey' }] }],
      code: { coding: [{ system: SYSTEMS.loinc, code: spec.code, display: spec.display }], text: a.instrumentName },
      subject: ref('Patient', a.clientId),
      effectiveDateTime: fhirDateTime(a.createdAt),
      issued: fhirDateTime(a.createdAt),
      performer: a.administeredById ? [ref('Practitioner', a.administeredById)] : undefined,
      valueQuantity: { value: a.totalScore, unit: '{score}', system: SYSTEMS.ucum, code: '{score}' },
      interpretation: a.severity ? [{ text: a.severity }] : undefined,
    },
    ctx
  );
}
