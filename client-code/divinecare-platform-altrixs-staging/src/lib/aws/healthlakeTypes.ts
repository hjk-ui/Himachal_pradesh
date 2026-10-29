/** FHIR R4 resource types Altrixs writes to HealthLake (and the search route allows). Client-safe. */
export const HEALTHLAKE_RESOURCE_TYPES = [
  'Organization',
  'Location',
  'Practitioner',
  'Patient',
  'Condition',
  'MedicationStatement',
  'AllergyIntolerance',
  'Encounter',
  'DocumentReference',
  'Observation',
] as const;

export type HealthLakeResourceType = (typeof HEALTHLAKE_RESOURCE_TYPES)[number];

export function isValidResourceType(value: string): value is HealthLakeResourceType {
  return (HEALTHLAKE_RESOURCE_TYPES as readonly string[]).includes(value);
}
