/** Front-office role rules (pure). Data inside the huddle is further gated per item (eligibility, consents, ledger...). */

const FRONT_OFFICE = new Set(['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
const OPERATIONS = new Set(['OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

/** Front desk huddle + front-office checklist marks: front desk, office manager, practice leadership. */
export function canUseFrontOffice(role: string | null | undefined): boolean {
  return FRONT_OFFICE.has(String(role ?? '').toUpperCase());
}

/** Office manager operations view (cross-location rollup, exceptions, counts by clinician / staff). */
export function canViewFrontOfficeOperations(role: string | null | undefined): boolean {
  return OPERATIONS.has(String(role ?? '').toUpperCase());
}
