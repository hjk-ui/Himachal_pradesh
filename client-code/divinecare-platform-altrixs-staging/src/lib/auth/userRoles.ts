import type { Role } from '@prisma/client';
import type { StaffRole } from '@/types/roles';

/** Unique roles for a user — always includes primary `role`. */
export function normalizeUserRoles(
  primary: Role | StaffRole | null | undefined,
  extra: readonly (Role | StaffRole)[] | null | undefined
): StaffRole[] {
  const out = new Set<StaffRole>();
  if (primary) out.add(primary as StaffRole);
  for (const r of extra ?? []) {
    if (r) out.add(r as StaffRole);
  }
  return Array.from(out);
}

const ROLE_DISPLAY: Partial<Record<string, string>> = {
  FRONT_DESK: 'Front Desk',
  ADMIN: 'Admin',
  PRACTICE_DIRECTOR: 'Practice Director',
  DIRECTOR: 'Practice Director',
  OFFICE_MANAGER: 'Office Manager',
  CLINICIAN: 'Clinician',
  THERAPIST: 'Therapist',
  PSYCHIATRIST: 'Psychiatrist',
  NP: 'NP',
  PRP_SPECIALIST: 'PRP Specialist',
  CASE_MANAGER: 'Case Manager',
  PEER_SUPPORT: 'Peer Support',
  BILLING: 'Billing Specialist',
  billing_specialist: 'Billing Specialist',
  office_manager: 'Office Manager',
  HR: 'HR Manager',
  SUPER_ADMIN: 'Super Admin',
  PHYSICIAN: 'Primary Care Physician (MD/DO)',
  physician: 'Primary Care Physician (MD/DO)',
  MEDICAL_NP: 'Family Nurse Practitioner (FNP/AGNP)',
  medical_np: 'Family Nurse Practitioner (FNP/AGNP)',
  MEDICAL_ASSISTANT: 'Medical Assistant',
  medical_assistant: 'Medical Assistant',
  CRISIS_RESPONDER: 'Crisis Responder',
  crisis_responder: 'Crisis Responder',
};

export function roleLabel(role: StaffRole | string | null | undefined): string {
  if (!role) return 'Clinic user';
  const key = String(role);
  return ROLE_DISPLAY[key] ?? key.replaceAll('_', ' ');
}

/** Prefer a stable primary when saving multi-role assignments. */
export function pickPrimaryRole(roles: StaffRole[], preferred?: StaffRole | null): StaffRole {
  const unique = normalizeUserRoles(preferred ?? roles[0], roles);
  if (preferred && unique.includes(preferred)) return preferred;
  const priority: StaffRole[] = [
    'ADMIN',
    'PRACTICE_DIRECTOR',
    'DIRECTOR',
    'OFFICE_MANAGER',
    'PHYSICIAN',
    'MEDICAL_NP',
    'PSYCHIATRIST',
    'NP',
    'THERAPIST',
    'CLINICIAN',
    'CRISIS_RESPONDER',
    'PRP_SPECIALIST',
    'CASE_MANAGER',
    'PEER_SUPPORT',
    'MEDICAL_ASSISTANT',
    'FRONT_DESK',
    'BILLING',
    'HR',
  ];
  for (const p of priority) {
    if (unique.includes(p)) return p;
  }
  return unique[0] ?? 'THERAPIST';
}

export function canSwitchToRole(
  roles: readonly StaffRole[] | null | undefined,
  next: StaffRole
): boolean {
  return (roles ?? []).includes(next);
}
