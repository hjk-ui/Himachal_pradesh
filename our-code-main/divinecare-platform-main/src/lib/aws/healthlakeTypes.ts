export const HEALTHLAKE_RESOURCE_TYPES = [
  'Patient',
  'Encounter',
  'Condition',
  'MedicationRequest',
  'Observation',
  'CarePlan',
  'DocumentReference',
  'Practitioner',
] as const;

export type HealthLakeResourceType = (typeof HEALTHLAKE_RESOURCE_TYPES)[number];

export function isValidResourceType(value: string): value is HealthLakeResourceType {
  return (HEALTHLAKE_RESOURCE_TYPES as readonly string[]).includes(value);
}
