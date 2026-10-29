import { canPrescribe } from '@/types/roles';

/** Roles allowed to land on /dashboard/ehr/prescriptions/return (THERAPIST false). */
const RETURN_PAGE_ROLES = new Set([
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'PSYCHIATRIST',
  'NP',
  'PHYSICIAN',
  'MEDICAL_NP',
]);

export function canAccessDrFirstReturn(role: string | null | undefined): boolean {
  const r = (role ?? '').toUpperCase();
  if (RETURN_PAGE_ROLES.has(r)) return true;
  return canPrescribe(r);
}

export const DRFIRST_RETURN_STATUS = 'Updating the chart from DrFirst…';

export function drfirstThrottleCopy(retryAfterSeconds: number): string {
  const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `DrFirst allows one update per patient every 5 minutes; the chart will catch up in about ${mins} min.`;
}

export function drfirstLogoutUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/dashboard/ehr/prescriptions/return`;
}
