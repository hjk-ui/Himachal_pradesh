/**
 * Resource library role rules (pure).
 *
 * Page / API gates (roleAccess):
 *   /dashboard/resources        patient education library: care team + office manager + primary care.
 *   /dashboard/resources/staff  staff resources (policies, forms, training): every clinic role,
 *                               each item narrowed by its visibleRoles.
 * Inside the library:
 *   - assign to a client: treating roles only (not office manager / front desk / billing / HR);
 *     the client must also be in the assigner's caseload scope (clientAccessWhere) and not a
 *     protected record they cannot open (checked in the store);
 *   - add / edit content: leadership, office manager, licensed clinicians, primary care providers;
 *   - clinical review (sets reviewer + date, required to activate an upload or article): clinical
 *     leadership and licensed / prescribing clinicians only;
 *   - staff resources: leadership, office manager and HR manage them.
 */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

const LEADERSHIP = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
const LICENSED = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'];
const SPECIALTY = ['PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'CRISIS_RESPONDER'];
const PRIMARY_CARE_PROVIDERS = ['PHYSICIAN', 'MEDICAL_NP'];

export const RESOURCE_LIBRARY_PATH = '/dashboard/resources';
export const STAFF_RESOURCES_PATH = '/dashboard/resources/staff';

/** Page roles for the patient education library (also the /api/resources gate) */
export const RESOURCE_LIBRARY_ROLES = [...LEADERSHIP, ...LICENSED, ...SPECIALTY, 'OFFICE_MANAGER', ...PRIMARY_CARE_PROVIDERS, 'MEDICAL_ASSISTANT'] as const;
export const RESOURCE_ASSIGN_ROLES = [...LEADERSHIP, ...LICENSED, ...SPECIALTY, ...PRIMARY_CARE_PROVIDERS, 'MEDICAL_ASSISTANT'] as const;
export const RESOURCE_MANAGE_ROLES = [...LEADERSHIP, 'OFFICE_MANAGER', ...LICENSED, ...PRIMARY_CARE_PROVIDERS] as const;
export const RESOURCE_REVIEW_ROLES = [...LEADERSHIP, ...LICENSED, ...PRIMARY_CARE_PROVIDERS] as const;
export const STAFF_RESOURCE_MANAGE_ROLES = [...LEADERSHIP, 'OFFICE_MANAGER', 'HR'] as const;

const norm = (role: string) => String(normalizeStaffRole(role)).toUpperCase();
const has = (list: readonly string[], role: string | null | undefined) => Boolean(role) && list.includes(norm(role as string));

export const canUseResourceLibrary = (role: string | null | undefined) => has(RESOURCE_LIBRARY_ROLES, role);
export const canAssignResources = (role: string | null | undefined) => has(RESOURCE_ASSIGN_ROLES, role);
export const canManageResources = (role: string | null | undefined) => has(RESOURCE_MANAGE_ROLES, role);
export const canReviewResources = (role: string | null | undefined) => has(RESOURCE_REVIEW_ROLES, role);
export const canManageStaffResources = (role: string | null | undefined) => has(STAFF_RESOURCE_MANAGE_ROLES, role);
export const isResourceLeadership = (role: string | null | undefined) => has(LEADERSHIP, role);

/** A staff resource is visible to everyone when visibleRoles is empty; leadership and managers always see it. */
export function canSeeStaffItem(role: string | null | undefined, visibleRoles: readonly string[]): boolean {
  if (!role) return false;
  if (canManageStaffResources(role)) return true;
  if (!visibleRoles.length) return true;
  return visibleRoles.map(norm).includes(norm(role));
}

/**
 * Patient-facing items a staff member sees in the library: active ones always; drafts and
 * retired items only for content managers (to review / restore).
 */
export function canSeePatientItem(role: string | null | undefined, status: string): boolean {
  if (!canUseResourceLibrary(role)) return false;
  return status === 'active' || canManageResources(role);
}
