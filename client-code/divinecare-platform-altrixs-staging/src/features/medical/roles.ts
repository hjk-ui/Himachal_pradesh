import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import { canWriteClientMedications } from '@/lib/clients/orgScope';

/**
 * Roles allowed to sign visits, change the problem list, or stop medications.
 * Shared by the medical API routes and the dashboard pages so the UI never
 * disables a control the server would accept (or enables one it would refuse).
 */
export const MEDICAL_PROVIDER_ROLES: ReadonlySet<string> = new Set([
  'PHYSICIAN',
  'MEDICAL_NP',
  'PSYCHIATRIST',
  'NP',
  'PRACTICE_DIRECTOR',
  'DIRECTOR',
  'ADMIN',
]);

export function isMedicalProvider(role: string | null | undefined) {
  return Boolean(role && MEDICAL_PROVIDER_ROLES.has(String(normalizeStaffRole(role)).toUpperCase()));
}

/**
 * Add an entry to the primary care medication list (POST /api/medical/patients/[id]/medications):
 * canWriteClientMedications AND a medical provider (physician / medical NP / psychiatrist / NP /
 * leadership) or the medical assistant (med reconciliation). Not Front Desk, Office Manager, Case
 * Manager, Therapist / Clinician or Billing.
 */
export function canWritePrimaryCareMedications(role: string | null | undefined) {
  if (!role) return false;
  const r = String(normalizeStaffRole(role)).toUpperCase();
  return canWriteClientMedications(r) && (isMedicalProvider(r) || r === 'MEDICAL_ASSISTANT');
}

/** Roles allowed to record a charge as Paid or Denied (money-affecting status changes). */
const CHARGE_ADJUDICATION_ROLES: ReadonlySet<string> = new Set([
  'BILLING',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

export function canAdjudicateCharges(role: string | null | undefined) {
  return Boolean(role && CHARGE_ADJUDICATION_ROLES.has(String(normalizeStaffRole(role)).toUpperCase()));
}
