/**
 * Guardian / proxy portal access — Oct 21 staging defaults.
 * <12 full; 12–17 limited; age-out at 18; Part 2 hidden from proxies.
 */

export type GuardianRelationship = 'parent' | 'legal_guardian' | 'authorized_representative';

export const GUARDIAN_RELATIONSHIPS: GuardianRelationship[] = [
  'parent',
  'legal_guardian',
  'authorized_representative',
];

export type GuardianAccessTier = 'full' | 'limited' | 'aged_out';

export function ageYearsFromDob(dateOfBirth: Date | null | undefined, now = new Date()): number | null {
  if (!dateOfBirth || !Number.isFinite(dateOfBirth.getTime())) return null;
  return (now.getTime() - dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/** Defaults by patient age when inviting a proxy. */
export function defaultGuardianAccessTier(
  dateOfBirth: Date | null | undefined,
  now = new Date()
): GuardianAccessTier {
  const age = ageYearsFromDob(dateOfBirth, now);
  if (age == null) return 'limited';
  if (age >= 18) return 'aged_out';
  if (age < 12) return 'full';
  return 'limited';
}

export function isValidGuardianRelationship(
  value: string | null | undefined
): value is GuardianRelationship {
  return GUARDIAN_RELATIONSHIPS.includes(value as GuardianRelationship);
}

/** Proxies never see Part 2 / SUD identifying content. */
export function proxyCanViewPart2(isProxy: boolean): boolean {
  return !isProxy;
}

export function proxyCanViewClinicalDetail(
  tier: GuardianAccessTier | string | null | undefined,
  isProxy: boolean
): boolean {
  if (!isProxy) return true;
  if (tier === 'aged_out') return false;
  if (tier === 'full') return true;
  return false; // limited — demographics / appointments only
}
