import type { Role } from '@prisma/client';

/** Read: psychiatrists, NPs, leadership, therapists (read-only). */
export const TMS_SPRAVATO_READ_ROLES: Role[] = [
  'PSYCHIATRIST',
  'NP',
  'PRACTICE_DIRECTOR',
  'ADMIN',
  'DIRECTOR',
  'THERAPIST',
];

/** Write: psychiatrists, NPs, practice directors, admins (not therapists). */
export const TMS_SPRAVATO_WRITE_ROLES: Role[] = [
  'PSYCHIATRIST',
  'NP',
  'PRACTICE_DIRECTOR',
  'ADMIN',
  'DIRECTOR',
];

export function canReadTmsSpravato(role: Role): boolean {
  return TMS_SPRAVATO_READ_ROLES.includes(role);
}

export function canWriteTmsSpravato(role: Role): boolean {
  return TMS_SPRAVATO_WRITE_ROLES.includes(role);
}

export const TMS_SPRAVATO_PATH = '/dashboard/ehr/tms-spravato';
