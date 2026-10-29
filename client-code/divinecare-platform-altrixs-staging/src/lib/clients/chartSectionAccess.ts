import type { Role } from '@prisma/client';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientMessages, canAccessClientRoster } from '@/lib/clients/orgScope';
import { canAccessLabs } from '@/lib/labs/manage';
import { canAccessPriorAuths } from '@/lib/ehr/priorAuths';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveAccess';
import {
  isMedicalViewerRole,
  MEDICAL_LABS_PATH,
  MEDICAL_PROBLEM_LIST_PATH,
  MEDICAL_ROLE_CHART_SECTIONS,
  MEDICAL_TAB_PATHS,
} from '@/lib/medical/medicalProgram';

/**
 * GET /api/clients/[id]/chart?section=… — which sections exist and which roles may load each.
 * Kept out of the route file so the rules are unit-tested (tests/medical-chart.test.ts).
 */
export const CHART_SECTIONS = [
  'diagnoses',
  'labs',
  'safety',
  'authorizations',
  'eligibility',
  'care-team',
  'messages',
  'programs',
  'discharge',
  'access-log',
  'medical-visits',
  'medical-vitals',
  'medical-history',
] as const;
export type ChartSectionKey = (typeof CHART_SECTIONS)[number];

/** BH diagnosis rule; roles that only pass the medical problem-list rule get problems only */
export const canSeeBhDiagnoses = (role: string) => canAccessPath(role, '/dashboard/ehr/diagnoses');

/** Program enrollments (PRP / TMS / Spravato, with diagnosis code): clinical + program + billing roles */
const PROGRAMS_SECTION_ROLES = [
  'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP',
  'PRP_SPECIALIST', 'CASE_MANAGER', 'CRISIS_RESPONDER', 'OFFICE_MANAGER', 'BILLING',
];

/**
 * Section -> role allowed? (same rule as the matching practice-wide page / API).
 * Deny by default: every section has an explicit rule; an unknown section is refused.
 * Peer Support gets no chart sections (their chart is summary, check-ins and appointments; the
 * peer workspace has its own APIs).
 */
export function sectionAllowed(section: ChartSectionKey, role: string): boolean {
  const r = role as Role;
  if (!role) return false;
  if (String(role).toUpperCase() === 'PEER_SUPPORT') return false;
  // Primary care roles: medical sections plus problems / labs / eligibility only (no BH sections)
  if (isMedicalViewerRole(role) && !MEDICAL_ROLE_CHART_SECTIONS.includes(section)) return false;
  switch (section) {
    case 'care-team':
    case 'discharge':
      // Care team names / roles and discharge status: any chart viewer (discharge cases are
      // further gated by the discharge module rule in the loader)
      return canAccessClientRoster(role);
    case 'programs':
      return PROGRAMS_SECTION_ROLES.includes(String(role).toUpperCase());
    case 'diagnoses':
      return canSeeBhDiagnoses(role) || canAccessPath(role, MEDICAL_PROBLEM_LIST_PATH);
    case 'labs':
      return canAccessLabs(r) || canAccessPath(role, MEDICAL_LABS_PATH);
    case 'medical-visits':
      return canAccessPath(role, MEDICAL_TAB_PATHS['medical-visits']);
    case 'medical-vitals':
      return canAccessPath(role, MEDICAL_TAB_PATHS['medical-vitals']);
    case 'medical-history':
      return canAccessPath(role, MEDICAL_TAB_PATHS['medical-history']);
    case 'authorizations':
      return canAccessPriorAuths(r);
    case 'eligibility':
      return canAccessPath(role, '/dashboard/ehr/eligibility');
    case 'messages':
      return canAccessClientMessages(role);
    case 'access-log':
      return isSensitivePrivilegedRole(role);
    case 'safety':
      // Risk alerts, C-SSRS scores, safety plans: Risk Alerts / Safety Plan page roles only
      // (not Front Desk, Billing, HR, Peer Support).
      return canAccessPath(role, '/dashboard/alerts') || canAccessPath(role, '/dashboard/ehr/safety-plan');
    default:
      return false;
  }
}
