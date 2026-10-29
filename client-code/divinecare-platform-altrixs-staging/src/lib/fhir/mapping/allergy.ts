import { SOURCE_DRFIRST, SYSTEMS, fhirDateTime, fhirId, ref, type FhirResource } from './common';
import { finalize, type MapContext } from './meta';
import type { AllergyRow } from './types';

const NKA_RE = /^(nka|nkda|nkma|no known (drug |medication )?allerg(y|ies)( documented)?)\.?$/i;

export function isNoKnownAllergy(allergen: string): boolean {
  return NKA_RE.test(allergen.trim());
}

function allergyClinicalStatus(status: string | null | undefined): 'active' | 'inactive' | 'resolved' {
  const s = (status || '').trim().toLowerCase();
  if (s === 'resolved') return 'resolved';
  if (s === 'inactive' || s === 'deleted' || s === 'entered in error') return 'inactive';
  return 'active';
}

function reactionSeverity(sev: string | null | undefined): 'mild' | 'moderate' | 'severe' | undefined {
  const s = (sev || '').trim().toLowerCase();
  if (s.startsWith('mild')) return 'mild';
  if (s.startsWith('moderate')) return 'moderate';
  if (s.startsWith('severe') || s.includes('life')) return 'severe';
  return undefined;
}

/** MedicalAllergy -> AllergyIntolerance. Rows without a client are not mapped (returns null). */
export function mapAllergyIntolerance(a: AllergyRow, ctx: MapContext): FhirResource | null {
  if (!a.clientId) return null;
  const nka = isNoKnownAllergy(a.allergen);
  const fromDrFirst = (a.source || '').toLowerCase() === 'drfirst';
  const severity = reactionSeverity(a.severity);
  return finalize(
    {
      resourceType: 'AllergyIntolerance',
      id: fhirId('alg', a.id),
      identifier: a.rcopiaAllergyId ? [{ system: SYSTEMS.rcopiaAllergy, value: a.rcopiaAllergyId }] : undefined,
      clinicalStatus: { coding: [{ system: SYSTEMS.allergyClinical, code: allergyClinicalStatus(a.status) }] },
      verificationStatus: { coding: [{ system: SYSTEMS.allergyVerification, code: 'confirmed' }] },
      code: nka
        ? { coding: [{ system: SYSTEMS.snomed, code: '716186003', display: 'No known allergy' }], text: a.allergen.trim() }
        : { text: a.allergen.trim() },
      patient: ref('Patient', a.clientId),
      recordedDate: fhirDateTime(a.createdAt),
      criticality: severity === 'severe' ? 'high' : undefined,
      reaction:
        !nka && a.reaction?.trim()
          ? [{ manifestation: [{ text: a.reaction.trim() }], severity }]
          : undefined,
    },
    ctx,
    fromDrFirst ? SOURCE_DRFIRST : undefined
  );
}
