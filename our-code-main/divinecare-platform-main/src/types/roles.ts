/** All portal roles including platform operator. */
export type StaffRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'PRACTICE_DIRECTOR'
  | 'OFFICE_MANAGER'
  | 'THERAPIST'
  | 'PSYCHIATRIST'
  | 'NP'
  | 'PRP_SPECIALIST'
  | 'CASE_MANAGER'
  | 'PEER_SUPPORT'
  // Legacy aliases maintained for backward compatibility with older tokens/payloads
  | 'DIRECTOR'
  | 'CLINICIAN'
  | 'FRONT_DESK'
  | 'BILLING'
  | 'HR'
  // Medical Department (Primary Care)
  | 'PHYSICIAN'
  | 'MEDICAL_NP'
  | 'MEDICAL_ASSISTANT'
  | 'CRISIS_RESPONDER'
  | 'physician'
  | 'medical_np'
  | 'medical_assistant'
  | 'crisis_responder';

/** Roles that belong to a clinic organization. */
export type ClinicRole = Exclude<StaffRole, 'SUPER_ADMIN'>;

export const MEDICAL_PROVIDER_ROLES = [
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
] as const satisfies readonly ClinicRole[];

export const CLINICAL_SPECIALTY_ROLES = [
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
  'CRISIS_RESPONDER',
] as const satisfies readonly ClinicRole[];

export const CLINIC_ADMIN_ROLES = [
  'ADMIN',
  'PRACTICE_DIRECTOR',
  'OFFICE_MANAGER',
] as const satisfies readonly ClinicRole[];

export const CLINIC_ROLES = [
  ...CLINIC_ADMIN_ROLES,
  ...CLINICAL_SPECIALTY_ROLES,
  // Legacy fallbacks
  'DIRECTOR',
  'CLINICIAN',
  'FRONT_DESK',
  'BILLING',
  'HR',
  'physician',
  'medical_np',
  'medical_assistant',
  'crisis_responder',
] as const satisfies readonly ClinicRole[];

export function isMedicalRole(role: string | null | undefined): boolean {
  const r = (role ?? '').toUpperCase();
  return r === 'PHYSICIAN' || r === 'MEDICAL_NP' || r === 'MEDICAL_ASSISTANT';
}

export function isCaseloadRole(role: string | null | undefined): boolean {
  const r = (role ?? '').toUpperCase();
  return (
    r === 'CLINICIAN' ||
    (CLINICAL_SPECIALTY_ROLES as readonly string[]).includes(r)
  );
}

export function isClinicalStaff(role: string | null | undefined): boolean {
  return (
    role === 'ADMIN' ||
    role === 'PRACTICE_DIRECTOR' ||
    role === 'DIRECTOR' ||
    role === 'OFFICE_MANAGER' ||
    isCaseloadRole(role)
  );
}

/** Prescribing permission shared by UI and server integration gates. */
export function canPrescribe(role: string | null | undefined): boolean {
  const r = (role ?? '').toUpperCase();
  return r === 'PSYCHIATRIST' || r === 'NP' || r === 'PHYSICIAN' || r === 'MEDICAL_NP';
}

