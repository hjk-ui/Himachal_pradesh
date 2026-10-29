export const CLINIC_ADMIN_ROLE_VALUES = [
  'ADMIN',
  'PRACTICE_DIRECTOR',
  'OFFICE_MANAGER',
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
  // Legacy aliases
  'DIRECTOR',
  'FRONT_DESK',
  'BILLING',
  'HR',
] as const;

export type ClinicAdminRole = (typeof CLINIC_ADMIN_ROLE_VALUES)[number];

export const CLINIC_ADMIN_ROLE_OPTIONS: { value: ClinicAdminRole; label: string }[] = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'PRACTICE_DIRECTOR', label: 'Practice Director' },
  { value: 'OFFICE_MANAGER', label: 'Office Manager' },
  { value: 'PHYSICIAN', label: 'Primary Care Physician (MD/DO)' },
  { value: 'MEDICAL_NP', label: 'Medical Nurse Practitioner (FNP-C)' },
  { value: 'MEDICAL_ASSISTANT', label: 'Medical Assistant (CMA)' },
  { value: 'CRISIS_RESPONDER', label: 'Crisis Responder (Mobile Crisis)' },
  { value: 'THERAPIST', label: 'Therapist' },
  { value: 'PSYCHIATRIST', label: 'Psychiatrist' },
  { value: 'NP', label: 'NP' },
  { value: 'PRP_SPECIALIST', label: 'PRP Specialist' },
  { value: 'CASE_MANAGER', label: 'Case Manager' },
  { value: 'PEER_SUPPORT', label: 'Peer Support' },
  { value: 'FRONT_DESK', label: 'Front Desk' },
  { value: 'BILLING', label: 'Billing Specialist' },
  { value: 'HR', label: 'HR' },
] as const;
