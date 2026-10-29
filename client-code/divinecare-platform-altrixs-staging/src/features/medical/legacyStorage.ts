/**
 * Older builds cached primary care patient charts, lab alerts, claims and payer rules in
 * localStorage. Purge them once per page load so PHI does not linger on shared workstations.
 */
const LEGACY_STORAGE_KEYS = [
  'altrixs.medical.patients.v1',
  'altrixs.medical.patients.v2',
  'altrixs.medical.patients.v3',
  'altrixs.medical.alerts.v1',
  'altrixs.medical.alerts.v2',
  'altrixs.medical.alerts.v3',
  'altrixs.medical.claims.v1',
  'altrixs.medical.claims.v2',
  'altrixs.medical.claims.v3',
  'altrixs.medical.payers.v1',
  'altrixs.medical.payers.v2',
];

let purged = false;

export function purgeLegacyMedicalStorage(): void {
  if (purged || typeof window === 'undefined') return;
  purged = true;
  try {
    LEGACY_STORAGE_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}
