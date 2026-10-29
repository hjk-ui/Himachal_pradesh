/**
 * Lab role rules. Pure (browser + server + tests).
 *
 * - View lab orders/results: the behavioral-health Labs page roles (/dashboard/ehr/labs) or, for
 *   primary care roles (PHYSICIAN / MEDICAL_NP / MEDICAL_ASSISTANT), the primary care Labs page
 *   (/dashboard/medical/labs). Row scope (org, caseload / care team, Part 2) is applied server-side.
 * - Order (sign) labs: prescribers only — PSYCHIATRIST, NP, PHYSICIAN, MEDICAL_NP — and the order
 *   is signed under the prescriber's own NPI (checked when the order is placed).
 * - Collect / mark sent / enter results / attach the report: prescribers, MEDICAL_ASSISTANT,
 *   CLINICIAN (licensed legacy role) and leadership (results that arrive by fax).
 * - Review & sign off results, release to the patient portal: prescribers only.
 */
import { canAccessPath } from '@/lib/auth/roleAccess';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import { isMedicalViewerRole, MEDICAL_LABS_PATH } from '@/lib/medical/medicalProgram';

export const LABS_PATH = '/dashboard/ehr/labs';

const PRESCRIBERS = ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'];
const LEADERSHIP = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

const norm = (role: string | null | undefined) => (role ? normalizeStaffRole(role) : '');

export function canViewLabs(role: string | null | undefined): boolean {
  if (!role) return false;
  if (canAccessPath(role, LABS_PATH)) return true;
  return isMedicalViewerRole(role) && canAccessPath(role, MEDICAL_LABS_PATH);
}

export function canOrderLabs(role: string | null | undefined): boolean {
  return PRESCRIBERS.includes(norm(role));
}

export function canEnterLabResults(role: string | null | undefined): boolean {
  const r = norm(role);
  return canViewLabs(role) && (PRESCRIBERS.includes(r) || r === 'MEDICAL_ASSISTANT' || r === 'CLINICIAN' || LEADERSHIP.includes(r));
}

export function canReviewLabResults(role: string | null | undefined): boolean {
  return canOrderLabs(role);
}

export function canReleaseLabResults(role: string | null | undefined): boolean {
  return canReviewLabResults(role);
}

/** Catalog import / edit: same leadership gate as the EHR migration imports */
export function canManageLabCatalog(role: string | null | undefined): boolean {
  const r = norm(role);
  return r === 'PRACTICE_DIRECTOR' || r === 'ADMIN';
}

export type LabPermissions = { view: boolean; order: boolean; enterResults: boolean; review: boolean; release: boolean };

export function labPermissions(role: string | null | undefined): LabPermissions {
  return {
    view: canViewLabs(role),
    order: canOrderLabs(role),
    enterResults: canEnterLabResults(role),
    review: canReviewLabResults(role),
    release: canReleaseLabResults(role),
  };
}
