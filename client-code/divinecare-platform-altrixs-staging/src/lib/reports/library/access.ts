/**
 * Report library access (pure). Who may RUN a report; patient scope inside a report always comes
 * from clientAccessWhere (caseload roles see their own clients; leadership and a verified Medical
 * Director see the organization), never from these lists.
 *
 * The /dashboard/reports page and /api/reports/library are open to REPORT_LIBRARY_ROLES
 * (src/lib/auth/roleAccess.ts); each report then narrows to its own roles. A test keeps every
 * report role inside REPORT_LIBRARY_ROLES.
 */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import { medicalDirectorActive, type AccessCapabilities } from '@/lib/auth/medicalDirector';
import type { StaffRole } from '@/types/roles';
import type { ReportMeta } from './types';

export const R_LEADERSHIP: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
/** Licensed behavioral-health clinicians (caseload scope) */
export const R_LICENSED: StaffRole[] = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'];
export const R_PRIMARY_CARE: StaffRole[] = ['PHYSICIAN', 'MEDICAL_NP'];
/** Billing & RCM reports (revenue, A/R, collections, payers): same roles as AR Control / billing
 * overview. Office Manager removed 2026-10-22 (owner: patient-side billing only). */
export const R_BILLING: StaffRole[] = [...R_LEADERSHIP, 'BILLING'];
/** Authorization tracking (no dollars): billing plus the Office Manager, who keeps Authorizations. */
export const R_AUTHORIZATIONS: StaffRole[] = [...R_BILLING, 'OFFICE_MANAGER'];
/** Operations (schedule, census, waitlist): leadership + office manager */
export const R_OPS: StaffRole[] = [...R_LEADERSHIP, 'OFFICE_MANAGER'];
/** Operations + clinicians (their own schedule / caseload) */
export const R_OPS_CLINICAL: StaffRole[] = [...R_OPS, ...R_LICENSED];
/** Schedule reports: front desk manages the whole schedule (no clinical or billing content) */
export const R_SCHEDULE: StaffRole[] = [...R_OPS_CLINICAL, 'FRONT_DESK'];
/** Clinical reports: leadership org-wide, licensed clinicians their caseload */
export const R_CLINICAL: StaffRole[] = [...R_LEADERSHIP, ...R_LICENSED];
/** Aggregate clinical quality reports also open to the Office Manager (small cells suppressed) */
export const R_CLINICAL_AGG: StaffRole[] = [...R_CLINICAL, 'OFFICE_MANAGER'];
/** HIPAA audit log: same rule as /dashboard/admin/audit-log (requireFullAdmin) */
export const R_AUDIT: StaffRole[] = ['ADMIN', 'PRACTICE_DIRECTOR'];
/** Compliance / system (no PHI rows): leadership */
export const R_COMPLIANCE: StaffRole[] = [...R_LEADERSHIP];
/** Staff / HR reports: leadership + HR + office manager (HR_CORE) */
export const R_HR: StaffRole[] = [...R_LEADERSHIP, 'HR', 'OFFICE_MANAGER'];

/**
 * Viewers who see un-suppressed aggregate clinical counts: leadership, licensed BH clinicians,
 * PRP specialists, primary care providers, and a verified Medical Director.
 */
const CLINICAL_VIEWERS = new Set<string>([...R_LEADERSHIP, ...R_LICENSED, ...R_PRIMARY_CARE, 'PRP_SPECIALIST']);

export function isClinicalViewer(role: string | null | undefined, caps?: AccessCapabilities | null): boolean {
  const r = normalizeStaffRole(role);
  return CLINICAL_VIEWERS.has(r) || medicalDirectorActive(r, caps);
}

/**
 * Providers do not run practice reports (industry standard: reports are a leadership / operations
 * function; clinicians work from their own worklists). Only a verified Medical Director (whatever
 * their base provider role) runs the clinical reports.
 */
export const REPORT_EXCLUDED_PROVIDER_ROLES = new Set<string>([
  ...R_LICENSED, ...R_PRIMARY_CARE, 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'MEDICAL_ASSISTANT', 'CRISIS_RESPONDER',
]);

export function canRunReport(
  meta: Pick<ReportMeta, 'access'>,
  role: string | null | undefined,
  caps?: AccessCapabilities | null
): boolean {
  if (!role) return false;
  const r = normalizeStaffRole(role);
  if (REPORT_EXCLUDED_PROVIDER_ROLES.has(r)) {
    const clinical = Boolean(meta.access.medicalDirector) || (meta.access.roles as readonly string[]).some((x) => (R_LICENSED as readonly string[]).includes(x));
    return clinical && medicalDirectorActive(r, caps);
  }
  if ((meta.access.roles as readonly string[]).includes(r)) return true;
  return Boolean(meta.access.medicalDirector) && medicalDirectorActive(r, caps);
}

export function reportsForRole<T extends Pick<ReportMeta, 'access'>>(
  reports: readonly T[],
  role: string | null | undefined,
  caps?: AccessCapabilities | null
): T[] {
  return reports.filter((m) => canRunReport(m, role, caps));
}
