import { canAccessPath, COMMUNITY_REFERRAL_ROLES } from '@/lib/auth/roleAccess';
import type { StaffRole } from '@/types/roles';
import type { AccessCapabilities } from '@/lib/auth/medicalDirector';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';

/** Claims / denials / EOB modules: billing + leadership. Office Manager removed 2026-10-22 (owner:
 * patient-side billing only). */
const BILLING_FULL: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
/** Statements / superbills / payments modules: billing, front office and leadership (no clinicians). */
const BILLING_LIMITED: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'FRONT_DESK', 'OFFICE_MANAGER'];
const HR_FULL: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR', 'OFFICE_MANAGER'];
/** Practice administration modules (integrations, notification rules, admin audit / compliance):
 * the /dashboard/admin page roles. HR and Office Manager could read and rewrite them before. */
const PRACTICE_ADMIN: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
const HR_SUPERVISION: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR', 'OFFICE_MANAGER', 'THERAPIST', 'PSYCHIATRIST', 'NP'];
const COMMUNITY_ROLES: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CASE_MANAGER', 'PEER_SUPPORT'];
/** Same list as the /dashboard/community/referrals page (roleAccess) */
const REFERRAL_ROLES: StaffRole[] = COMMUNITY_REFERRAL_ROLES;
const MARKETING_ROLES: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER'];

/** ClinicModuleState keys that map to a dashboard path (roleAccess). */
const MODULE_DASHBOARD_PATH: Record<string, string> = {
  'assessment-due': '/dashboard/ehr/assessments',
  'hr-training-staff': '/dashboard/hr/training',
  'hr-trainings-catalog': '/dashboard/hr/training',
  'sdoh-screenings': '/dashboard/sdoh',
  'sdoh-resources': '/dashboard/sdoh',
  'scribe-accepted-suggestions': '/dashboard/scribe',
  // resource-uploads / resource-assignments: no longer client-readable or writable. The library is
  // relational (src/lib/resources, migration 20261020_resource_library.sql); the old blobs (client
  // names inside, org-wide) are read only by scripts/migrate-resource-library-blob.ts.
  'patient-surveys': '/dashboard/analytics/surveys',
  'doc-productivity': '/dashboard/analytics/productivity',
  'ai-insights': '/dashboard/ai-insights',
  'mbc-schedules': '/dashboard/mbc',
  'mbc-rules': '/dashboard/mbc',
  'outcome-schedules': '/dashboard/mbc/outcomes',
  'outcome-responses': '/dashboard/mbc/outcomes',
  'population-health': '/dashboard/population',
  // incidents: no longer client-readable or writable. Incident reports are relational
  // (src/lib/incidents, /api/incidents, migration 20261022_roles_followup_incidents.sql); the old
  // org-wide blob is read only by scripts/migrate-incidents-blob.ts.
  grievances: '/dashboard/grievances',
  'grievances-meta': '/dashboard/grievances',
  'qi-indicators': '/dashboard/qi',
  'qi-caps': '/dashboard/qi',
  'qi-meetings': '/dashboard/qi',
  'qi-meta': '/dashboard/qi',
  'compliance-calendar': '/dashboard/compliance',
  'compliance-meta': '/dashboard/compliance',
  // peer-contacts / peer-goals / peer-placements / peer-meta: no longer client-readable. They were one
  // org-wide list (not caseload scoped); the server reads them only for Import legacy entries.
  'prp-meta': '/dashboard/prp',
  'prp-groups': '/dashboard/prp',
  'prp-participants': '/dashboard/prp',
  'prp-domains': '/dashboard/prp',
  'prp-reports': '/dashboard/prp',
  'subscription-page': '/dashboard/subscription',
  diagnoses: '/dashboard/ehr/diagnoses',
  assessments: '/dashboard/ehr/assessments',
  evaluations: '/dashboard/ehr/evaluations',
  locus: '/dashboard/ehr/locus',
  prescriptions: '/dashboard/ehr/prescriptions',
  'prescription-refills': '/dashboard/ehr/prescriptions',
  'ehr-safety-plans': '/dashboard/ehr/safety-plan',
  'ehr-discharge-cases': '/dashboard/ehr/discharge',
  // group-sessions: no longer client-readable or writable. Groups are relational tables
  // (src/lib/groups, migration 20261019_group_sessions.sql); the old blob is read only by
  // scripts/migrate-group-sessions-blob.ts.
  'ai-session-history': '/dashboard/ehr/session-ai',
  'mandatory-reporting': '/dashboard/compliance/mandatory-reporting',
  'prior-auth': '/dashboard/billing/prior-auth',
  'goal-bank-templates': '/dashboard/ehr/goal-bank',
  'part2-clients': '/dashboard/ehr/part2',
  'part2-audit': '/dashboard/ehr/part2',
  'ehr-overview-revals': '/dashboard/ehr',
};

const BILLING_FULL_MODULES = new Set(['billing-claims', 'denials', 'billing-eobs']);
const BILLING_LIMITED_MODULES = new Set([
  'invoices',
  'superbills',
  'autopay-clients',
  'autopay-charges',
  'payer-panels',
  'billing-notifications',
  'billing-audit',
]);
/** Payer-side modules inside BILLING_LIMITED (superbills, insurance panels): not Office Manager
 * (2026-10-22 owner: patient-side billing only). Same as the /dashboard/billing/superbills and
 * /dashboard/billing/panels page rules. */
const OFFICE_MANAGER_EXCLUDED_BILLING_MODULES = new Set(['superbills', 'payer-panels']);
const HR_FULL_MODULES = new Set(['hr-operations', 'credentials']);
const PRACTICE_ADMIN_MODULES = new Set([
  'admin-audit-log',
  'admin-integrations',
  'admin-notification-rules',
  'admin-compliance',
]);
const HR_SUPERVISION_MODULES = new Set(['supervisees', 'supervision-logs']);
const COMMUNITY_MODULES = new Set([
  'community-events',
  'community-partners',
  'community-volunteers',
  'community-event-contacts',
  'community-event-attendance',
  'community-audit',
]);
const REFERRAL_MODULES = new Set(['referrals', 'referral-audit']);
const MARKETING_MODULES = new Set([
  'pr-press-releases',
  'pr-media-coverage',
  'pr-social-posts',
  'pr-campaigns',
  'pr-media-contacts',
  'pr-review-links',
  'marketing-audit',
]);

export function canUseClinicModule(
  role: StaffRole | null | undefined,
  module: string,
  caps?: AccessCapabilities | null
): boolean {
  // Integration mappings, launch sessions and audits are server-managed only.
  if (module.startsWith('drfirst')) return false;
  // Legacy Part 2 audit notes (pre-Oct 2026, hand-typed): read-only, privileged roles only (canReadClinicModule)
  if (module === 'part2-audit') return false;
  // Admin audit log module: same people as the HIPAA audit log (ADMIN / PRACTICE_DIRECTOR)
  if (module === 'admin-audit-log') return isSensitivePrivilegedRole(role);
  if (!role) return false;
  if (BILLING_FULL_MODULES.has(module)) return BILLING_FULL.includes(role);
  if (BILLING_LIMITED_MODULES.has(module)) {
    if (role === 'OFFICE_MANAGER' && OFFICE_MANAGER_EXCLUDED_BILLING_MODULES.has(module)) return false;
    return BILLING_LIMITED.includes(role);
  }
  if (PRACTICE_ADMIN_MODULES.has(module)) return PRACTICE_ADMIN.includes(role);
  if (HR_FULL_MODULES.has(module)) return HR_FULL.includes(role);
  if (HR_SUPERVISION_MODULES.has(module)) return HR_SUPERVISION.includes(role);
  if (COMMUNITY_MODULES.has(module)) return COMMUNITY_ROLES.includes(role);
  if (REFERRAL_MODULES.has(module)) return REFERRAL_ROLES.includes(role);
  if (MARKETING_MODULES.has(module)) return MARKETING_ROLES.includes(role);

  const path = MODULE_DASHBOARD_PATH[module];
  if (path) return canAccessPath(role, path, caps);
  return false;
}

/**
 * Extra READ-only paths per module: a page that only consumes a module another page owns.
 * Goal bank templates (reusable goal / objective wording, no client data) are edited on the Goal Bank
 * page (providers + leadership) but read by the treatment plan editor, which PRP specialists open.
 */
const MODULE_READ_ALSO_PATHS: Record<string, string[]> = {
  'goal-bank-templates': ['/dashboard/ehr/treatment-plans'],
};

/** GET /api/modules/[module]: write roles plus the module's read-only consumers. */
export function canReadClinicModule(
  role: StaffRole | null | undefined,
  module: string,
  caps?: AccessCapabilities | null
): boolean {
  if (module === 'part2-audit') return isSensitivePrivilegedRole(role);
  if (canUseClinicModule(role, module, caps)) return true;
  if (!role) return false;
  return (MODULE_READ_ALSO_PATHS[module] ?? []).some((path) => canAccessPath(role, path, caps));
}
