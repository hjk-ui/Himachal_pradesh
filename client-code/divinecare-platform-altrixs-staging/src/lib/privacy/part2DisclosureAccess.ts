import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';
import { isCaseloadRole } from '@/types/roles';

/**
 * 42 CFR Part 2 disclosure log access. Pure (no database): safe in tests and the browser.
 *
 * Reading disclosure details (GET /api/part2/disclosures?clientId, the accounting of disclosures and
 * its 6-year CSV, the client's disclosure consents) is a need-to-know read under 42 CFR 2.12(c)(3):
 * - ADMIN / PRACTICE_DIRECTOR (isSensitivePrivilegedRole), or
 * - a treating clinician (caseload role) with the client on their caseload (clientAccessWhere).
 * Billing, Front Desk and Office Manager (the release-of-information desk) may only RECORD a
 * disclosure (POST), for clients they can see (clientAccessWhere: the organization for those roles);
 * they cannot read the history or export the accounting.
 * Every path also applies the Part 2 / sensitive-record lock (assertClientPhiAccess), and the Part 2
 * page rule (canUsePart2Page) stays the outer gate.
 */
export const PART2_RELEASE_DESK_ROLES = ['BILLING', 'FRONT_DESK', 'OFFICE_MANAGER'] as const;

export function isPart2ReleaseDeskRole(role: string | null | undefined): boolean {
  return (PART2_RELEASE_DESK_ROLES as readonly string[]).includes(String(role ?? '').toUpperCase());
}

export function canReadDisclosures(role: string | null | undefined, onCaseload: boolean): boolean {
  if (isSensitivePrivilegedRole(String(role ?? '').toUpperCase())) return true;
  return isCaseloadRole(role) && onCaseload;
}

/** `inScope`: the client matches clientAccessWhere for the caller (caseload for caseload roles). */
export function canRecordDisclosure(role: string | null | undefined, inScope: boolean): boolean {
  if (canReadDisclosures(role, inScope)) return true;
  return isPart2ReleaseDeskRole(role) && inScope;
}
