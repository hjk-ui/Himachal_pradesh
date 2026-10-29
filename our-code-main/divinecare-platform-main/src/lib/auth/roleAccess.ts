import type { StaffRole } from '@/types/roles';
import { CLINIC_ROLES } from '@/types/roles';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { normalizeStaffRole } from './rolePersonas';

/**
 * Clinic role access — locked to product role summaries:
 * - Front Desk: intake, waitlist, book/check-in, consents/eligibility, schedule, copays
 * - Clinician (Doctor): schedule, assigned clients, EHR, telehealth, alerts, scribe
 * - Billing: claims/payments/denials, eligibility/PA, coding/reports, client roster (no notes)
 * - HR: staff invite/roles, credentialing, supervision, training, compliance (no patients/clients/EHR/messages/tasks/resources)
 * - Peer: caseload, appointments, messages, community — no EHR/billing/HR/alerts
 * - Admin / Director: clinic dashboard + all sidebar modules
 * - Super Admin: /platform orgs only
 */

const SPECIALTY: StaffRole[] = [
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'CRISIS_RESPONDER',
  'crisis_responder',
];

const LICENSED: StaffRole[] = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'];

const CARE_TEAM: StaffRole[] = [
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'CLINICIAN',
  ...SPECIALTY,
];

const CARE_OPS: StaffRole[] = [
  ...CARE_TEAM,
  'FRONT_DESK',
  'OFFICE_MANAGER',
];

const MESSAGING_ROLES: StaffRole[] = CARE_OPS;

const LEADERSHIP: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
/** Licensed + leadership + PRP. Excludes peer / case manager (no full EHR). */
const CLINICAL_CORE: StaffRole[] = [...LEADERSHIP, ...LICENSED, 'PRP_SPECIALIST'];
const PROVIDERS: StaffRole[] = [...LEADERSHIP, ...LICENSED, 'CRISIS_RESPONDER', 'crisis_responder'];
const EHR_CLINICAL: StaffRole[] = [...LEADERSHIP, ...LICENSED];
const SCHEDULE_ANALYTICS: StaffRole[] = [...LEADERSHIP, ...LICENSED, 'FRONT_DESK', 'OFFICE_MANAGER', 'PRP_SPECIALIST'];
const ALERT_ROLES: StaffRole[] = [...PROVIDERS, 'PRP_SPECIALIST', 'CASE_MANAGER', 'OFFICE_MANAGER', 'CRISIS_RESPONDER', 'crisis_responder'];
const BILLING_CORE: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
/** Employment/pay/discipline — leadership + HR (OM excluded). */
const HR_PERSONNEL: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR'];
/** Employment/credentials/training — includes OM (no pay/discipline/personal). */
const HR_CORE: StaffRole[] = [...HR_PERSONNEL, 'OFFICE_MANAGER'];
const MARKETING_ROLES: StaffRole[] = [...LEADERSHIP, 'OFFICE_MANAGER'];
const MARKETING_LEAD_ROLES: StaffRole[] = [...MARKETING_ROLES, 'FRONT_DESK'];
const COMMUNITY_ROLES: StaffRole[] = [...LEADERSHIP, 'CASE_MANAGER', 'PEER_SUPPORT'];

/** Payer A/R, claims, denials, fees, and revenue. Office Manager is patient-side only. */
const BILLING_AR_ROLES: StaffRole[] = [...BILLING_CORE];
/** Patient statements. Payments and AutoPay add Front Desk on their own prefixes. */
const PATIENT_BILLING_OFFICE_ROLES: StaffRole[] = [...BILLING_CORE, 'OFFICE_MANAGER'];
const COMMS_ROLES: StaffRole[] = [
  ...LEADERSHIP,
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'OFFICE_MANAGER',
];
const LABS_ROLES: StaffRole[] = [
  ...LEADERSHIP,
  'PSYCHIATRIST',
  'NP',
  'THERAPIST',
  'CASE_MANAGER',
  'CLINICIAN',
];
const CSSRS_ROLES: StaffRole[] = [...LEADERSHIP, 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN'];
const HEALTHLAKE_ROLES: StaffRole[] = ['PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR'];
const SCHEDULING_ADMIN_ROLES: StaffRole[] = [...LEADERSHIP, 'OFFICE_MANAGER'];

export const MEDICAL_ROLES: StaffRole[] = ['PHYSICIAN', 'MEDICAL_NP', 'physician', 'medical_np'];
export const MEDICAL_ASSISTANT_ROLES: StaffRole[] = ['MEDICAL_ASSISTANT', 'medical_assistant'];
export const CRISIS_RESPONDER_ROLES: StaffRole[] = ['CRISIS_RESPONDER', 'crisis_responder'];
export const MEDICAL_FULL: StaffRole[] = [
  ...LEADERSHIP,
  'OFFICE_MANAGER',
  'CLINICIAN',
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'FRONT_DESK',
  'BILLING',
  'CASE_MANAGER',
  ...MEDICAL_ROLES,
  ...MEDICAL_ASSISTANT_ROLES,
];
export const MEDICAL_PREVENTIVE_ROLES: StaffRole[] = MEDICAL_FULL.filter(
  (r) => !MEDICAL_ASSISTANT_ROLES.includes(r as any)
);
export const PROJECTS_ROLES: StaffRole[] = [...CLINIC_ROLES];
export const PRP_FORM_ROLES: StaffRole[] = [...LEADERSHIP, 'PRP_SPECIALIST', 'CASE_MANAGER'];

/**
 * Longest-prefix match. More specific prefixes MUST appear before broader ones.
 */
const PATH_ACCESS: { prefix: string; roles: StaffRole[] }[] = [
  { prefix: '/dashboard/ehr/evaluations', roles: EHR_CLINICAL },
  { prefix: '/dashboard/ehr/locus', roles: EHR_CLINICAL },
  { prefix: '/dashboard/ehr/mandatory-reporting', roles: EHR_CLINICAL },
  { prefix: '/dashboard/compliance/mandatory-reporting', roles: EHR_CLINICAL },
  { prefix: '/dashboard/billing/prior-auth', roles: [...BILLING_CORE, ...LICENSED, 'OFFICE_MANAGER'] },
  { prefix: '/dashboard/prior-auth', roles: [...BILLING_CORE, ...LICENSED, 'OFFICE_MANAGER'] },
  { prefix: '/platform', roles: ['SUPER_ADMIN'] },
  { prefix: '/dashboard/settings', roles: [...CARE_OPS, 'BILLING', 'HR', ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES] },

  // More-specific admin routes BEFORE /dashboard/admin
  { prefix: '/dashboard/admin/census', roles: [...LEADERSHIP, 'OFFICE_MANAGER'] },
  { prefix: '/dashboard/admin/audit', roles: ['ADMIN', 'PRACTICE_DIRECTOR'] },
  { prefix: '/dashboard/admin/migration', roles: ['PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR'] },
  { prefix: '/dashboard/admin/scheduling-settings', roles: SCHEDULING_ADMIN_ROLES },
  { prefix: '/dashboard/protected-records', roles: ['PRACTICE_DIRECTOR'] },

  // Business / leadership
  { prefix: '/dashboard/admin', roles: LEADERSHIP },
  { prefix: '/dashboard/enterprise', roles: LEADERSHIP },
  { prefix: '/dashboard/subscription', roles: LEADERSHIP },
  { prefix: '/dashboard/practice-setup', roles: LEADERSHIP },
  { prefix: '/onboarding', roles: LEADERSHIP },
  { prefix: '/dashboard/pr', roles: MARKETING_ROLES },
  { prefix: '/dashboard/marketing/leads', roles: MARKETING_LEAD_ROLES },
  { prefix: '/dashboard/marketing', roles: MARKETING_ROLES },

  // HR — more specific before /dashboard/hr
  { prefix: '/dashboard/hr/me', roles: [...CLINIC_ROLES] },
  { prefix: '/dashboard/hr/org-chart', roles: [...CLINIC_ROLES] },
  { prefix: '/dashboard/hr/people', roles: HR_CORE },
  { prefix: '/dashboard/hr/settings', roles: HR_PERSONNEL },
  { prefix: '/dashboard/hr/homebase', roles: HR_PERSONNEL },
  { prefix: '/dashboard/hr/performance', roles: HR_PERSONNEL },
  {
    prefix: '/dashboard/hr/supervision',
    roles: [...HR_CORE, 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'],
  },
  { prefix: '/dashboard/hr/credentialing', roles: HR_CORE },
  { prefix: '/dashboard/hr', roles: HR_CORE },

  // Medical Department Suite
  { prefix: '/dashboard/medical/billing', roles: MEDICAL_FULL.filter((role) => role !== 'OFFICE_MANAGER') },
  { prefix: '/dashboard/medical/payer-settings', roles: MEDICAL_FULL.filter((role) => role !== 'OFFICE_MANAGER') },
  { prefix: '/dashboard/medical/problem-list', roles: MEDICAL_PREVENTIVE_ROLES },
  { prefix: '/dashboard/medical/preventive-care', roles: MEDICAL_PREVENTIVE_ROLES },
  { prefix: '/dashboard/medical', roles: MEDICAL_FULL },

  // Projects Tracker & Kanban Board
  { prefix: '/dashboard/projects', roles: PROJECTS_ROLES },

  // Specialized Programs (Mobile Crisis, Residential, AOT)
  { prefix: '/dashboard/crisis', roles: [...CARE_TEAM, ...CRISIS_RESPONDER_ROLES] },
  { prefix: '/dashboard/residential', roles: [...CARE_TEAM] },
  { prefix: '/dashboard/aot', roles: [...CARE_TEAM] },

  // Billing suite — specific before /dashboard/billing.
  // Office Manager keeps patient money only: payments, statements, AutoPay, authorizations.
  { prefix: '/dashboard/billing/authorizations', roles: [...BILLING_CORE, ...LICENSED, 'OFFICE_MANAGER'] },
  { prefix: '/dashboard/billing/residential-crisis', roles: [...BILLING_CORE, ...PROVIDERS, ...CRISIS_RESPONDER_ROLES] },
  { prefix: '/dashboard/billing/payer-settings', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/insurance-companies', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/ar-control', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/claim-scrubber', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/statements', roles: PATIENT_BILLING_OFFICE_ROLES },
  {
    prefix: '/dashboard/billing/payments',
    roles: [...BILLING_CORE, 'FRONT_DESK', 'OFFICE_MANAGER', ...MEDICAL_ROLES],
  },
  { prefix: '/dashboard/billing/fee-schedule', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/intensive-charges', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/collections', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/provider-collections', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/valant-balances', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/clearinghouse', roles: BILLING_AR_ROLES },
  {
    prefix: '/dashboard/billing/superbills',
    roles: [...BILLING_CORE, ...MEDICAL_ROLES],
  },
  {
    prefix: '/dashboard/billing/autopay',
    roles: [...BILLING_CORE, 'FRONT_DESK', 'OFFICE_MANAGER', ...MEDICAL_ROLES],
  },
  {
    prefix: '/dashboard/billing/panels',
    roles: BILLING_AR_ROLES,
  },
  {
    prefix: '/dashboard/billing/claims',
    roles: BILLING_CORE,
  },
  {
    prefix: '/dashboard/billing/denials',
    roles: BILLING_AR_ROLES,
  },
  { prefix: '/dashboard/billing', roles: BILLING_AR_ROLES },


  // Digital PRP Clinical Forms
  { prefix: '/dashboard/prp/assessment', roles: PRP_FORM_ROLES },
  { prefix: '/dashboard/prp/irp', roles: PRP_FORM_ROLES },

  // Programs / community
  { prefix: '/dashboard/programs/intensive/billing', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/programs/intensive', roles: [...LEADERSHIP, 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER'] },
  { prefix: '/dashboard/prp/referral', roles: [...LEADERSHIP, 'THERAPIST', 'PSYCHIATRIST', 'NP'] },
  { prefix: '/dashboard/prp/enroll', roles: [...LEADERSHIP, 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST'] },
  { prefix: '/dashboard/prp', roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'THERAPIST'] },
  {
    prefix: '/dashboard/community/referrals',
    roles: [...CARE_OPS, 'CASE_MANAGER', 'PEER_SUPPORT'], // FD + care team
  },
  {
    prefix: '/dashboard/community',
    roles: [...COMMUNITY_ROLES, 'OFFICE_MANAGER'],
  },

  // AI & analytics — licensed providers + leadership (not peer / case / FD)
  { prefix: '/dashboard/ai-insights', roles: PROVIDERS },
  { prefix: '/dashboard/scribe', roles: PROVIDERS },
  { prefix: '/dashboard/mbc', roles: PROVIDERS },
  {
    prefix: '/dashboard/coding',
    roles: [...BILLING_CORE, ...LICENSED],
  },
  {
    prefix: '/dashboard/analytics/productivity',
    roles: [...LEADERSHIP, 'OFFICE_MANAGER'],
  },
  {
    prefix: '/dashboard/analytics/surveys',
    roles: [...PROVIDERS, 'OFFICE_MANAGER'],
  },
  {
    prefix: '/dashboard/analytics/schedule',
    roles: SCHEDULE_ANALYTICS,
  },
  {
    prefix: '/dashboard/analytics',
    roles: SCHEDULE_ANALYTICS,
  },
  {
    prefix: '/dashboard/reports/outcomes',
    roles: LEADERSHIP,
  },
  {
    prefix: '/dashboard/reports',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK', 'BILLING', 'HR'],
  },
  {
    prefix: '/dashboard/resources',
    roles: [...CARE_TEAM, 'OFFICE_MANAGER'],
  },

  // EHR — specific before /dashboard/ehr
  { prefix: '/dashboard/ehr/assessments/cssrs', roles: CSSRS_ROLES },
  { prefix: '/dashboard/ehr/labs', roles: LABS_ROLES },
  { prefix: '/dashboard/ehr/healthlake', roles: HEALTHLAKE_ROLES },
  {
    prefix: '/dashboard/ehr/tms-spravato',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PSYCHIATRIST', 'NP', 'THERAPIST'],
  },
  { prefix: '/dashboard/ehr/scanner', roles: ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER', 'DIRECTOR', 'PRACTICE_DIRECTOR'] },
  { prefix: '/dashboard/ehr/prescriptions', roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PSYCHIATRIST', 'NP'] },
  { prefix: '/dashboard/ehr/supervisor-review', roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'PSYCHIATRIST', 'NP'] },
  {
    prefix: '/dashboard/ehr/eligibility',
    roles: [
      'ADMIN',
      'DIRECTOR',
      'PRACTICE_DIRECTOR',
      'BILLING',
      'FRONT_DESK',
      'OFFICE_MANAGER',
      'NP',
      'THERAPIST',
      'PSYCHIATRIST',
      'CLINICIAN',
    ],
  },
  {
    // PC CRISP launch: PHYSICIAN + MEDICAL_NP only (Oct 21 follow-up). Leadership not excepted.
    prefix: '/dashboard/ehr/hie',
    roles: ['PHYSICIAN', 'MEDICAL_NP'],
  },
  {
    prefix: '/dashboard/ehr/consents',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'FRONT_DESK', 'OFFICE_MANAGER'],
  },
  {
    prefix: '/dashboard/ehr/prior-auths',
    roles: [
      'ADMIN',
      'DIRECTOR',
      'PRACTICE_DIRECTOR',
      'BILLING',
      'FRONT_DESK',
      'OFFICE_MANAGER',
      'THERAPIST',
      'NP',
      'PSYCHIATRIST',
      'CLINICIAN',
    ],
  },
  {
    prefix: '/dashboard/ehr/part2',
    roles: [...CLINICAL_CORE, 'BILLING', 'OFFICE_MANAGER'],
  },
  { prefix: '/dashboard/ehr/notes', roles: [...EHR_CLINICAL, 'PRP_SPECIALIST'] },
  { prefix: '/dashboard/ehr/note-builder', roles: EHR_CLINICAL },
  { prefix: '/dashboard/ehr/treatment-plans', roles: CLINICAL_CORE },
  { prefix: '/dashboard/ehr/assessments', roles: CLINICAL_CORE },
  { prefix: '/dashboard/ehr/evaluations', roles: CLINICAL_CORE },
  { prefix: '/dashboard/ehr/locus', roles: CLINICAL_CORE },
  { prefix: '/dashboard/ehr/diagnoses', roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'] },
  {
    prefix: '/dashboard/ehr/group-sessions',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'THERAPIST', 'PRP_SPECIALIST', 'CASE_MANAGER'],
  },
  { prefix: '/dashboard/ehr/session-ai', roles: PROVIDERS },
  { prefix: '/dashboard/ehr/goal-bank', roles: PROVIDERS },
  {
    prefix: '/dashboard/ehr/safety-plan',
    roles: [
      'ADMIN',
      'DIRECTOR',
      'PRACTICE_DIRECTOR',
      'CLINICIAN',
      'THERAPIST',
      'PSYCHIATRIST',
      'NP',
      'PRP_SPECIALIST',
      'CASE_MANAGER',
    ],
  },
  {
    prefix: '/dashboard/ehr/discharge',
    roles: [
      'ADMIN',
      'DIRECTOR',
      'PRACTICE_DIRECTOR',
      'CLINICIAN',
      'THERAPIST',
      'PSYCHIATRIST',
      'NP',
      'CASE_MANAGER',
    ],
  },
  { prefix: '/dashboard/ehr', roles: EHR_CLINICAL },

  // Quality & compliance + population / SDOH
  { prefix: '/dashboard/qi', roles: [...LEADERSHIP, 'OFFICE_MANAGER'] },
  {
    prefix: '/dashboard/incidents',
    roles: [
      'ADMIN',
      'DIRECTOR',
      'PRACTICE_DIRECTOR',
      'CLINICIAN',
      'THERAPIST',
      'PSYCHIATRIST',
      'NP',
      'PRP_SPECIALIST',
      'CASE_MANAGER',
      'FRONT_DESK',
      'OFFICE_MANAGER',
      ...MEDICAL_ROLES,
    ],
  },
  { prefix: '/dashboard/grievances', roles: [...LEADERSHIP, 'OFFICE_MANAGER'] },
  { prefix: '/dashboard/compliance', roles: [...LEADERSHIP, 'HR', 'OFFICE_MANAGER'] },
  {
    prefix: '/dashboard/peer-support',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST'],
  },
  {
    prefix: '/dashboard/population',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'],
  },
  {
    prefix: '/dashboard/sdoh',
    roles: [
      'ADMIN',
      'DIRECTOR',
      'PRACTICE_DIRECTOR',
      'CLINICIAN',
      'THERAPIST',
      'PSYCHIATRIST',
      'NP',
      'PRP_SPECIALIST',
      'CASE_MANAGER',
    ],
  },
  { prefix: '/dashboard/hr/training', roles: HR_CORE },

  // Clinical ops
  { prefix: '/dashboard/communications', roles: [...COMMS_ROLES, ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES] },
  { prefix: '/dashboard/telehealth', roles: [...CARE_OPS, ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES] },
  { prefix: '/dashboard/alerts', roles: [...ALERT_ROLES, ...CRISIS_RESPONDER_ROLES] },
  {
    prefix: '/dashboard/messages',
    roles: MESSAGING_ROLES,
  },
  { prefix: '/dashboard/appointments', roles: [...CARE_OPS, ...MEDICAL_ROLES] },
  {
    prefix: '/dashboard/tasks',
    roles: [...CARE_OPS, 'BILLING', ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES],
  },
  {
    prefix: '/dashboard/inbox',
    roles: [...CARE_OPS, 'BILLING', 'HR', ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES],
  },

  // Clients — waitlist/intake before clients root (Billing: roster only)
  {
    prefix: '/dashboard/clients/waitlist',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER'],
  },
  {
    prefix: '/dashboard/clients/intake',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER'],
  },
  {
    prefix: '/dashboard/clients',
    roles: [...CARE_TEAM, 'FRONT_DESK', 'BILLING', 'OFFICE_MANAGER', ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES],
  },

  {
    prefix: '/dashboard',
    roles: [...CARE_OPS, 'BILLING', 'HR', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES],
  },
];

/** Sidebar hrefs from DashboardShell — Admin must be able to open every one. */
export const CLINIC_NAV_HREFS = [
  '/dashboard',
  '/dashboard/tasks',
  '/dashboard/inbox',
  '/dashboard/clients',
  '/dashboard/crisis',
  '/dashboard/clients/waitlist',
  '/dashboard/clients/intake',
  '/dashboard/alerts',
  '/dashboard/appointments',
  '/dashboard/messages',
  '/dashboard/communications',
  '/dashboard/telehealth',
  '/dashboard/ehr',
  '/dashboard/ehr/notes',
  '/dashboard/ehr/scanner',
  '/dashboard/ehr/tms-spravato',
  '/dashboard/ehr/labs',
  '/dashboard/ehr/healthlake',
  '/dashboard/ehr/treatment-plans',
  '/dashboard/ehr/assessments',
  '/dashboard/ehr/assessments/cssrs',
  '/dashboard/ehr/diagnoses',
  '/dashboard/ehr/prescriptions',
  '/dashboard/ehr/consents',
  '/dashboard/ehr/eligibility',
  '/dashboard/ehr/hie',
  '/dashboard/ehr/prior-auths',
  '/dashboard/ehr/safety-plan',
  '/dashboard/ehr/discharge',
  '/dashboard/ehr/group-sessions',
  '/dashboard/ehr/session-ai',
  '/dashboard/ehr/supervisor-review',
  '/dashboard/ehr/note-builder',
  '/dashboard/ehr/goal-bank',
  '/dashboard/ehr/part2',
  '/dashboard/mbc',
  '/dashboard/mbc/outcomes',
  '/dashboard/scribe',
  '/dashboard/ai-insights',
  '/dashboard/coding',
  '/dashboard/analytics/schedule',
  '/dashboard/analytics/productivity',
  '/dashboard/analytics/surveys',
  '/dashboard/reports',
  '/dashboard/population',
  '/dashboard/sdoh',
  '/dashboard/resources',
  '/dashboard/qi',
  '/dashboard/incidents',
  '/dashboard/grievances',
  '/dashboard/compliance',
  '/dashboard/peer-support',
  '/dashboard/prp',
  '/dashboard/practice-setup',
  '/onboarding',
  '/dashboard/subscription',
  '/dashboard/enterprise',
  '/dashboard/billing',
  '/dashboard/billing/claims',
  '/dashboard/billing/ar-control',
  '/dashboard/billing/claim-scrubber',
  '/dashboard/billing/statements',
  '/dashboard/billing/denials',
  '/dashboard/billing/payments',
  '/dashboard/billing/autopay',
  '/dashboard/billing/superbills',
  '/dashboard/billing/panels',
  '/dashboard/hr',
  '/dashboard/hr/credentialing',
  '/dashboard/hr/supervision',
  '/dashboard/hr/training',
  '/dashboard/hr/me',
  '/dashboard/hr/people',
  '/dashboard/admin',
  '/dashboard/admin/scheduling-settings',
  '/dashboard/admin/migration',
  '/dashboard/settings',
  '/dashboard/community',
  '/dashboard/community/referrals',
  '/dashboard/marketing',
  '/dashboard/marketing/leads',
  '/dashboard/pr',
  // Medical Department Suite
  '/dashboard/medical',
  '/dashboard/medical/patients',
  '/dashboard/medical/patients/intake',
  '/dashboard/medical/visits',
  '/dashboard/medical/vitals',
  '/dashboard/medical/problem-list',
  '/dashboard/medical/preventive-care',
  '/dashboard/medical/referrals',
  '/dashboard/medical/labs',
  '/dashboard/medical/history',
  '/dashboard/medical/billing',
  '/dashboard/medical/payer-settings',
  '/dashboard/medical/ai',
  // Projects
  '/dashboard/projects',
  // PRP Digital Forms
  '/dashboard/prp/assessment',
  '/dashboard/prp/irp',
] as const;

/** Claims, A/R, denials, fees, payer setup, and clearinghouse. Not Office Manager. */
export function canAccessPayerBilling(role: StaffRole | string | undefined | null): boolean {
  if (!role) return false;
  return BILLING_CORE.includes(normalizeStaffRole(role));
}

export function canAccessPath(role: StaffRole | string | undefined | null, pathname: string): boolean {
  if (!role) return false;
  const normalized = normalizeStaffRole(role);
  const path = pathname.split('?')[0] || '/dashboard';
  const rule = PATH_ACCESS.find(
    (r) => path === r.prefix || path.startsWith(`${r.prefix}/`)
  );
  if (!rule) return normalized === 'ADMIN';
  return rule.roles.includes(normalized);
}

/** Clinic staff on a /dashboard/* URL they are not allowed to open. */
export function shouldBlockDashboardPath(
  role: StaffRole | string | undefined | null,
  pathname: string
): boolean {
  if (!role) return false;
  const normalized = normalizeStaffRole(role);
  if (normalized === 'SUPER_ADMIN') return false;
  const path = pathname.split('?')[0] || '/dashboard';
  if (path === '/dashboard') return false;
  if (!path.startsWith('/dashboard')) return false;
  return !canAccessPath(normalized, path);
}

export function filterNavForRole<T extends { href: string }>(
  sections: { label: string; items: T[] }[],
  role: StaffRole | string | undefined | null
): { label: string; items: T[] }[] {
  const normalized = normalizeStaffRole(role);
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessPath(normalized, item.href)),
    }))
    .filter((section) => section.items.length > 0);
}

export function homePathForRole(role: StaffRole | string | undefined | null): string {
  const normalized = normalizeStaffRole(role);
  if (isPlatformAdmin(normalized)) return '/platform';
  if (normalized === 'PHYSICIAN' || normalized === 'MEDICAL_NP' || normalized === 'MEDICAL_ASSISTANT') return '/dashboard/medical';
  if (normalized === 'CRISIS_RESPONDER') return '/dashboard/crisis';
  return '/dashboard';
}

export function shouldUseRoleHome(role: StaffRole | string | undefined | null, pathname: string): boolean {
  if (!role || pathname !== '/dashboard') return false;
  return true;
}

