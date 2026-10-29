import { canAccessPath } from '@/lib/auth/roleAccess';
import type { StaffRole } from '@/types/roles';

const BILLING_FULL: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
const BILLING_LIMITED: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'FRONT_DESK', 'OFFICE_MANAGER', 'THERAPIST'];
const HR_FULL: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR', 'OFFICE_MANAGER'];
const HR_SUPERVISION: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR', 'OFFICE_MANAGER', 'THERAPIST', 'PSYCHIATRIST', 'NP'];
const COMMUNITY_ROLES: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CASE_MANAGER', 'PEER_SUPPORT'];
const REFERRAL_ROLES: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER', 'THERAPIST', 'NP', 'CASE_MANAGER'];
const MARKETING_ROLES: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER'];

/** ClinicModuleState keys that map to a dashboard path (roleAccess). */
const MODULE_DASHBOARD_PATH: Record<string, string> = {
  'assessment-due': '/dashboard/ehr/assessments',
  'hr-training-staff': '/dashboard/hr/training',
  'hr-trainings-catalog': '/dashboard/hr/training',
  'sdoh-screenings': '/dashboard/sdoh',
  'sdoh-resources': '/dashboard/sdoh',
  'scribe-accepted-suggestions': '/dashboard/scribe',
  'resource-uploads': '/dashboard/resources',
  'resource-assignments': '/dashboard/resources',
  'patient-surveys': '/dashboard/analytics/surveys',
  'doc-productivity': '/dashboard/analytics/productivity',
  'ai-insights': '/dashboard/ai-insights',
  'mbc-schedules': '/dashboard/mbc',
  'mbc-rules': '/dashboard/mbc',
  'outcome-schedules': '/dashboard/mbc/outcomes',
  'outcome-responses': '/dashboard/mbc/outcomes',
  'population-health': '/dashboard/population',
  incidents: '/dashboard/incidents',
  grievances: '/dashboard/grievances',
  'grievances-meta': '/dashboard/grievances',
  'qi-indicators': '/dashboard/qi',
  'qi-caps': '/dashboard/qi',
  'qi-meetings': '/dashboard/qi',
  'qi-meta': '/dashboard/qi',
  'compliance-calendar': '/dashboard/compliance',
  'compliance-meta': '/dashboard/compliance',
  'peer-contacts': '/dashboard/peer-support',
  'peer-goals': '/dashboard/peer-support',
  'peer-placements': '/dashboard/peer-support',
  'peer-meta': '/dashboard/peer-support',
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
  'group-sessions': '/dashboard/ehr/group-sessions',
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
/** Patient-side Office Manager keeps invoices and AutoPay, not superbills or payer panels. */
const OFFICE_MANAGER_EXCLUDED_BILLING_MODULES = new Set(['superbills', 'payer-panels']);
const HR_FULL_MODULES = new Set([
  'hr-operations',
  'credentials',
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

export function canUseClinicModule(role: StaffRole | null | undefined, module: string): boolean {
  // Integration mappings, launch sessions and audits are server-managed only.
  if (module.startsWith('drfirst')) return false;
  if (!role) return false;
  if (BILLING_FULL_MODULES.has(module)) return BILLING_FULL.includes(role);
  if (BILLING_LIMITED_MODULES.has(module)) {
    if (role === 'OFFICE_MANAGER' && OFFICE_MANAGER_EXCLUDED_BILLING_MODULES.has(module)) return false;
    return BILLING_LIMITED.includes(role);
  }
  if (HR_FULL_MODULES.has(module)) return HR_FULL.includes(role);
  if (HR_SUPERVISION_MODULES.has(module)) return HR_SUPERVISION.includes(role);
  if (COMMUNITY_MODULES.has(module)) return COMMUNITY_ROLES.includes(role);
  if (REFERRAL_MODULES.has(module)) return REFERRAL_ROLES.includes(role);
  if (MARKETING_MODULES.has(module)) return MARKETING_ROLES.includes(role);

  const path = MODULE_DASHBOARD_PATH[module];
  if (path) return canAccessPath(role, path);
  return false;
}
