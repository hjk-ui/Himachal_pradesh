import type { StaffRole } from '@/types/roles';
import { CLINIC_ROLES } from '@/types/roles';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { normalizeStaffRole } from './rolePersonas';
import {
  isMedicalDirectorApiPath,
  isMedicalDirectorPagePath,
  medicalDirectorActive,
  type AccessCapabilities,
} from './medicalDirector';

export type { AccessCapabilities };

/**
 * Clinic role access — locked to product role summaries:
 * - Front Desk: intake, waitlist, book/check-in, consents/eligibility, schedule, copays
 * - Clinician (Doctor): schedule, assigned clients, EHR, telehealth, alerts, scribe
 * - Billing: claims/payments/denials, eligibility/PA, coding/reports, client roster (no notes)
 * - HR: staff invite/roles, credentialing, supervision, training, compliance, staff resources (no patients/clients/EHR/messages/tasks/patient resource library)
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
/** Measures in the chart or on the MBC pages (measureGate: assessment roles, else MBC roles) */
const MEASURE_ROLES: StaffRole[] = [...new Set<StaffRole>([...CLINICAL_CORE, ...PROVIDERS])];
/** Practice analytics and reports: leadership and operations only. Providers (therapists, psychiatrists,
 * NPs, physicians, PRP / case management / peers) work from their own worklists, not practice reports;
 * a verified Medical Director gets the clinical oversight pages through MEDICAL_DIRECTOR_PAGE_PREFIXES. */
const SCHEDULE_ANALYTICS: StaffRole[] = [...LEADERSHIP, 'FRONT_DESK', 'OFFICE_MANAGER'];
/** Huddle sheet (/dashboard/huddle, /api/huddle): same roles as the pre-visit brief (src/lib/huddle/core.ts canViewHuddle) */
export const HUDDLE_ROLES: StaffRole[] = [...LEADERSHIP, ...LICENSED, 'PHYSICIAN', 'MEDICAL_NP'];
/** Risk alerts (descriptions, triggers, C-SSRS): treating roles + leadership. Not Office Manager,
 * Front Desk, Billing or HR: administrative roles keep the generic high-risk flag on the chart
 * banner and can still open a crisis episode / page (CRISIS_ESCALATION_ROLES). */
const ALERT_ROLES: StaffRole[] = [...PROVIDERS, 'PRP_SPECIALIST', 'CASE_MANAGER', 'CRISIS_RESPONDER', 'crisis_responder'];
const BILLING_CORE: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
const HR_CORE: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR', 'OFFICE_MANAGER'];
/** HR corner (personnel roster, payroll / time exports): HR + leadership, same as canAccessHrCorner. */
const HR_PERSONNEL: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR'];
const COMMUNITY_ROLES: StaffRole[] = [...LEADERSHIP, 'CASE_MANAGER', 'PEER_SUPPORT'];
/** Growth & Marketing (campaigns, reputation, automations, analytics): leadership + Office Manager. */
export const MARKETING_ROLES: StaffRole[] = [...LEADERSHIP, 'OFFICE_MANAGER'];
/** Lead pipeline / conversations inbox (prospective clients): marketing roles + Front Desk intake staff. */
export const MARKETING_LEAD_ROLES: StaffRole[] = [...MARKETING_ROLES, 'FRONT_DESK'];

/**
 * 2026-10-22 owner: Office Manager patient-side billing only. Payer A/R, claims, denials, fees,
 * payer settings, provider revenue and legacy (Valant) balances belong to Billing + leadership.
 */
const BILLING_AR_ROLES: StaffRole[] = [...BILLING_CORE];
/** Patient-side billing the Office Manager keeps (patient statements); payments / AutoPay add Front Desk. */
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
/** BH labs: prescribers order / review; licensed therapists view their own clients' results (drug
 * screens, lithium levels). Case managers, PRP and peers have no lab access (minimum necessary). */
const LABS_ROLES: StaffRole[] = [
  ...LEADERSHIP,
  'PSYCHIATRIST',
  'NP',
  'THERAPIST',
  'CLINICIAN',
];
const CSSRS_ROLES: StaffRole[] = [...LEADERSHIP, 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN'];
const HEALTHLAKE_ROLES: StaffRole[] = ['PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR'];
const SCHEDULING_ADMIN_ROLES: StaffRole[] = [...LEADERSHIP, 'OFFICE_MANAGER'];
/** Prior-auth tracking roles; the merged Authorizations page opens for all of them. */
const PRIOR_AUTH_ROLES: StaffRole[] = [
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
];

export const MEDICAL_ROLES: StaffRole[] = ['PHYSICIAN', 'MEDICAL_NP', 'physician', 'medical_np'];
export const MEDICAL_ASSISTANT_ROLES: StaffRole[] = ['MEDICAL_ASSISTANT', 'medical_assistant'];
export const CRISIS_RESPONDER_ROLES: StaffRole[] = ['CRISIS_RESPONDER', 'crisis_responder'];
/** Primary care area (overview, roster, intake, orders, labs). Billing has the billing pages only. */
export const MEDICAL_FULL: StaffRole[] = [
  ...LEADERSHIP,
  'OFFICE_MANAGER',
  'CLINICIAN',
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'FRONT_DESK',
  'CASE_MANAGER',
  ...MEDICAL_ROLES,
  ...MEDICAL_ASSISTANT_ROLES,
];
/**
 * Primary care charges: Billing + leadership (full), physicians / medical NPs (their own encounters;
 * the charge API checks the encounter). Behavioral-health clinicians, case managers, Front Desk,
 * Medical Assistants and Office Manager (patient-side billing only, 2026-10-22 owner) do not work
 * primary care charges.
 */
export const MEDICAL_BILLING_ROLES: StaffRole[] = [
  ...LEADERSHIP,
  'BILLING',
  ...MEDICAL_ROLES,
];
/** Primary care payer table / billing rules: same readers as the behavioral-health payer settings
 * (Billing + leadership; Office Manager removed 2026-10-22, patient-side billing only). */
export const MEDICAL_PAYER_SETTINGS_ROLES: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
/**
 * Primary care clinical content: visits & SOAP, vitals, medical history, AI SOAP drafting.
 * Minimum necessary: licensed prescribers (psychiatrist, NP, CLINICIAN as the licensed legacy
 * alias), the primary care team (physician, medical NP, medical assistant for vitals / visit intake
 * support) and leadership. Therapists, case managers, peer support, PRP, front desk, office manager
 * and billing do not get primary care SOAP / vitals / history.
 */
export const MEDICAL_CLINICAL_CONTENT_ROLES: StaffRole[] = [
  ...LEADERSHIP,
  'CLINICIAN',
  'PSYCHIATRIST',
  'NP',
  ...MEDICAL_ROLES,
  ...MEDICAL_ASSISTANT_ROLES,
];
/** Problem list / preventive care: provider-level charting (shared with psychiatry); no Medical Assistants. */
export const MEDICAL_PREVENTIVE_ROLES: StaffRole[] = MEDICAL_CLINICAL_CONTENT_ROLES.filter(
  (r) => !MEDICAL_ASSISTANT_ROLES.includes(r),
);
/** Every clinic staff role that can sign in to /dashboard. */
const ALL_CLINIC_STAFF: StaffRole[] = [
  ...CARE_OPS,
  'BILLING',
  'HR',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  ...MEDICAL_ROLES,
  ...MEDICAL_ASSISTANT_ROLES,
  ...CRISIS_RESPONDER_ROLES,
];
export const PROJECTS_ROLES: StaffRole[] = [...CLINIC_ROLES];
export const PRP_FORM_ROLES: StaffRole[] = [...LEADERSHIP, 'PRP_SPECIALIST', 'CASE_MANAGER'];

/*
 * Area role lists shared by the page rules below and the API rules (API_PATH_ACCESS), so a page
 * and the API behind it cannot drift apart.
 */
/** /dashboard/notifications and /api/admin/notifications (canTestNotifications there) */
const NOTIFICATIONS_ADMIN_ROLES: StaffRole[] = [...LEADERSHIP, 'OFFICE_MANAGER'];
/**
 * Community referrals page, /api/referrals (canAccessReferrals) and the 'referrals' /
 * 'referral-audit' module data: Front Desk, Office Manager + the care team. Before, the module
 * used a narrower list (no peers, psychiatrists, PRP, crisis) than the page and the API.
 */
export const COMMUNITY_REFERRAL_ROLES: StaffRole[] = [...CARE_OPS, 'CASE_MANAGER', 'PEER_SUPPORT'];
/*
 * Program boards (crisis episodes, ASAM residential census with ASAM scores and shift notes, AOT
 * court-ordered participants, PRP workflow): the treating care team and leadership. Office Manager
 * was on all four; the boards are clinical (residential SUD is 42 CFR Part 2), so it is not.
 * Opening a crisis episode / paging stays open to Office Manager (CRISIS_ESCALATION_ROLES).
 */
const CRISIS_ROLES: StaffRole[] = [...CARE_TEAM, ...CRISIS_RESPONDER_ROLES];
const RESIDENTIAL_ROLES: StaffRole[] = [...CARE_TEAM];
const AOT_ROLES: StaffRole[] = [...CARE_TEAM];
/**
 * Intensive programs (IOP / PHP, /dashboard/programs/intensive): leadership (program director view)
 * plus the treating team that runs the program: licensed clinicians, psychiatrists / NPs and case
 * managers. Not PRP / peer support (SUD IOP is 42 CFR Part 2), Front Desk, Office Manager, Billing
 * or HR. Inside, rows are team / caseload scoped (src/lib/intensive/access.ts).
 */
const INTENSIVE_ROLES: StaffRole[] = [...LEADERSHIP, 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER'];
/** Intensive program charge drafts: billing + leadership (Office Manager removed 2026-10-22). */
const INTENSIVE_BILLING_ROLES: StaffRole[] = [...BILLING_CORE];
const PRP_PAGE_ROLES: StaffRole[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'THERAPIST'];
const TELEHEALTH_ROLES: StaffRole[] = [...CARE_OPS, ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES];
const COMMUNICATIONS_ROLES: StaffRole[] = [...COMMS_ROLES, ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES];
const ALERTS_PAGE_ROLES: StaffRole[] = [...ALERT_ROLES, ...CRISIS_RESPONDER_ROLES];
/** Denials / appeals: billing + leadership (Office Manager removed 2026-10-22). */
const BILLING_DENIALS_ROLES: StaffRole[] = [...BILLING_CORE];
/**
 * Opening a crisis episode / paging from telehealth or communications is a safety action:
 * every clinic role except HR and Billing (neither has any patient-facing workflow).
 */
const CRISIS_ESCALATION_ROLES: StaffRole[] = ALL_CLINIC_STAFF.filter((r) => r !== 'HR' && r !== 'BILLING');
/**
 * Report library (/dashboard/reports, /api/reports/library): every role that can run at least one
 * library report. Each report has its own role list inside this set (tests/report-library.test.ts);
 * patient scope inside a report is still the caseload / care-team rule (clientAccessWhere).
 */
export const REPORT_LIBRARY_ROLES: StaffRole[] = [
  ...LEADERSHIP,
  'OFFICE_MANAGER',
  'BILLING',
  'HR',
  'FRONT_DESK',
];

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
  // Merged Authorizations page (tracking + electronic tabs); each tab still gates on its old path.
  { prefix: '/dashboard/billing/authorizations', roles: PRIOR_AUTH_ROLES },
  // Unified staff inbox — every clinic staff role (items inside are filtered per role).
  { prefix: '/dashboard/inbox', roles: ALL_CLINIC_STAFF },
  { prefix: '/platform', roles: ['SUPER_ADMIN'] },
  // My profile (name, photo, password): every staff role, incl. primary care roles (were missing)
  { prefix: '/dashboard/settings', roles: ALL_CLINIC_STAFF },
  // Patient-app push console + medication reminder schedules: same roles as /api/admin/notifications
  // (was open to every staff role, incl. HR / Billing, through the /dashboard fallback).
  { prefix: '/dashboard/notifications', roles: NOTIFICATIONS_ADMIN_ROLES },

  // More-specific admin routes BEFORE /dashboard/admin
  { prefix: '/dashboard/admin/migration', roles: ['PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR'] },
  // Measurement type catalog: leadership + licensed clinicians read; leadership edits (API checks)
  { prefix: '/dashboard/admin/measurement-types', roles: EHR_CLINICAL },
  // Same rule as the audit-log API (requireFullAdmin): ADMIN / PRACTICE_DIRECTOR only
  { prefix: '/dashboard/admin/audit-log', roles: ['ADMIN', 'PRACTICE_DIRECTOR'] },
  // BAA record + acceptance: same rule as /api/admin/baa (requireFullAdmin)
  { prefix: '/dashboard/admin/baa', roles: ['ADMIN', 'PRACTICE_DIRECTOR'] },
  // Integration call logs + health: same rule as /api/admin/integrations/logs (requireFullAdmin).
  // Never HR / billing / front desk (no billing rule grants clearinghouse logs).
  { prefix: '/dashboard/admin/integrations', roles: ['ADMIN', 'PRACTICE_DIRECTOR'] },
  { prefix: '/dashboard/admin/scheduling-settings', roles: SCHEDULING_ADMIN_ROLES },
  { prefix: '/dashboard/protected-records', roles: ['PRACTICE_DIRECTOR'] },

  // Business / leadership
  { prefix: '/dashboard/admin', roles: LEADERSHIP },
  // Practice overview & census: read-only for Office Manager (daily operations); mapping / Locations admin stay leadership
  { prefix: '/dashboard/enterprise', roles: [...LEADERSHIP, 'OFFICE_MANAGER'] },
  { prefix: '/dashboard/subscription', roles: LEADERSHIP },
  { prefix: '/dashboard/practice-setup', roles: LEADERSHIP },
  { prefix: '/onboarding', roles: LEADERSHIP },
  { prefix: '/dashboard/pr', roles: [...LEADERSHIP, 'OFFICE_MANAGER'] },
  // Growth & Marketing hub: leadership + Office Manager. The lead inbox (prospective clients) also
  // opens for Front Desk (intake staff). Clinicians keep only the referral info they already have.
  { prefix: '/dashboard/marketing/leads', roles: MARKETING_LEAD_ROLES },
  { prefix: '/dashboard/marketing', roles: MARKETING_ROLES },

  // HR
  {
    prefix: '/dashboard/hr/supervision',
    roles: [...HR_CORE, 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'], // own supervision logs
  },
  { prefix: '/dashboard/hr/credentialing', roles: HR_CORE },
  { prefix: '/dashboard/hr/training', roles: HR_CORE },
  // HR standard hub (src/lib/hr/standard.ts): My HR self-service and the directory for every
  // staff role; the roster (credential status only for OM) for HR_CORE; workflows HR + leadership.
  { prefix: '/dashboard/hr/me', roles: ALL_CLINIC_STAFF },
  { prefix: '/dashboard/hr/org-chart', roles: ALL_CLINIC_STAFF },
  { prefix: '/dashboard/hr/people', roles: HR_CORE },
  { prefix: '/dashboard/hr/onboarding', roles: HR_PERSONNEL },
  { prefix: '/dashboard/hr/offboarding', roles: HR_PERSONNEL },
  { prefix: '/dashboard/hr/time-off', roles: HR_PERSONNEL },
  { prefix: '/dashboard/hr/performance', roles: HR_PERSONNEL },
  { prefix: '/dashboard/hr/settings', roles: HR_PERSONNEL },
  // HR corner (personnel roster, payroll / time exports): its API (canAccessHrCorner) refuses OM
  { prefix: '/dashboard/hr', roles: HR_PERSONNEL },

  // Medical Department Suite
  { prefix: '/dashboard/medical/problem-list', roles: MEDICAL_PREVENTIVE_ROLES },
  { prefix: '/dashboard/medical/preventive-care', roles: MEDICAL_PREVENTIVE_ROLES },
  { prefix: '/dashboard/medical/visits', roles: MEDICAL_CLINICAL_CONTENT_ROLES },
  { prefix: '/dashboard/medical/vitals', roles: MEDICAL_CLINICAL_CONTENT_ROLES },
  { prefix: '/dashboard/medical/history', roles: MEDICAL_CLINICAL_CONTENT_ROLES },
  { prefix: '/dashboard/medical/ai', roles: MEDICAL_CLINICAL_CONTENT_ROLES },
  // Same readers as the lab API (lib/labs/access canViewLabs): BH Labs page roles + primary care
  // roles. Front Desk / Office Manager opened the page but every lab API call was refused.
  { prefix: '/dashboard/medical/labs', roles: [...LABS_ROLES, ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES] },
  { prefix: '/dashboard/medical/billing', roles: MEDICAL_BILLING_ROLES },
  { prefix: '/dashboard/medical/payer-settings', roles: MEDICAL_PAYER_SETTINGS_ROLES },
  { prefix: '/dashboard/medical', roles: MEDICAL_FULL },

  // Projects Tracker & Kanban Board
  { prefix: '/dashboard/projects', roles: PROJECTS_ROLES },

  // Specialized Programs (Mobile Crisis, Residential, AOT)
  { prefix: '/dashboard/crisis', roles: CRISIS_ROLES },
  { prefix: '/dashboard/residential', roles: RESIDENTIAL_ROLES },
  { prefix: '/dashboard/aot', roles: AOT_ROLES },
  // Intensive programs (IOP / PHP): charge drafts page before the program hub
  { prefix: '/dashboard/programs/intensive/billing', roles: INTENSIVE_BILLING_ROLES },
  { prefix: '/dashboard/programs/intensive', roles: INTENSIVE_ROLES },

  // Billing suite — specific before /dashboard/billing
  // 2026-10-22 owner: Office Manager patient-side billing only (payments, statements, AutoPay,
  // authorizations). Every payer / claims / revenue page below is billing + leadership.
  // Residential / crisis billing queue (payers, charges, auth units, org-wide): billing + leadership.
  // Providers and crisis responders document the services, they do not work the queue.
  { prefix: '/dashboard/billing/residential-crisis', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/payer-settings', roles: BILLING_AR_ROLES },
  // Valant insurance companies (reference + links, Valant A/R usage); same readers as payer settings,
  // edits gated in the API. Front-office intake does not use it (payer is typed on the insurance card).
  { prefix: '/dashboard/billing/insurance-companies', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/fee-schedule', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/ar-control', roles: BILLING_AR_ROLES },
  { prefix: '/dashboard/billing/claim-scrubber', roles: BILLING_AR_ROLES },
  // Patient statements (eStatements): patient-side, Office Manager keeps them
  { prefix: '/dashboard/billing/statements', roles: PATIENT_BILLING_OFFICE_ROLES },
  // Valant reference-only balances (aging, insurance A/R, prepayments); never posted to the ledger
  { prefix: '/dashboard/billing/valant-balances', roles: BILLING_AR_ROLES },
  // Valant "Payments, Refunds and Adjustments" by provider, from imported Valant transactions
  { prefix: '/dashboard/billing/provider-collections', roles: BILLING_AR_ROLES },
  {
    prefix: '/dashboard/billing/payments',
    roles: [...BILLING_CORE, 'FRONT_DESK', 'OFFICE_MANAGER'],
  },
  {
    prefix: '/dashboard/billing/superbills',
    // Billing work; primary care providers use Medical billing
    roles: BILLING_AR_ROLES,
  },
  {
    prefix: '/dashboard/billing/autopay',
    // Front desk: in-office card capture and AutoPay on/off (src/lib/patientPayments/access.ts)
    roles: [...BILLING_CORE, 'OFFICE_MANAGER', 'FRONT_DESK'],
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
    roles: BILLING_DENIALS_ROLES,
  },
  // Billing overview (practice revenue / claims totals) and anything not listed above (clearinghouse)
  { prefix: '/dashboard/billing', roles: BILLING_AR_ROLES },


  // Digital PRP Clinical Forms
  { prefix: '/dashboard/prp/assessment', roles: PRP_FORM_ROLES },
  { prefix: '/dashboard/prp/irp', roles: PRP_FORM_ROLES },

  // Programs / community
  { prefix: '/dashboard/prp/referral', roles: [...LEADERSHIP, 'PSYCHIATRIST', 'NP', 'THERAPIST', 'CLINICIAN'] },
  { prefix: '/dashboard/prp/enroll', roles: [...LEADERSHIP, 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST'] },
  { prefix: '/dashboard/prp', roles: PRP_PAGE_ROLES },
  // Same roles as the referrals module data (modules/access.ts uses COMMUNITY_REFERRAL_ROLES)
  { prefix: '/dashboard/community/referrals', roles: COMMUNITY_REFERRAL_ROLES },
  {
    prefix: '/dashboard/community',
    roles: [...COMMUNITY_ROLES, 'OFFICE_MANAGER'],
  },

  // AI & analytics — licensed providers + leadership (not peer / case / FD)
  { prefix: '/dashboard/ai-insights', roles: PROVIDERS },
  { prefix: '/dashboard/scribe', roles: PROVIDERS },
  // Measure guide (reference, no PHI) and measure printing: everyone who works with measures in the
  // chart (assessment roles incl. PRP) or on the MBC pages (providers incl. crisis responders),
  // matching measureGate (src/lib/measures/http.ts). The APIs re-check the client scope.
  { prefix: '/dashboard/mbc/guide', roles: MEASURE_ROLES },
  { prefix: '/dashboard/mbc/print', roles: MEASURE_ROLES },
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
    roles: [...LEADERSHIP, 'OFFICE_MANAGER'],
  },
  {
    prefix: '/dashboard/analytics/schedule',
    roles: SCHEDULE_ANALYTICS,
  },
  {
    prefix: '/dashboard/analytics',
    roles: SCHEDULE_ANALYTICS,
  },
  // Outcomes & Reports (under the library): leadership; Medical Director via caps. Office Manager
  // removed 2026-10-22 (owner: patient-side billing only): every tab carries practice revenue KPIs
  // (billed / paid, Valant charges and payments) and the Financial tab is revenue by payer.
  {
    prefix: '/dashboard/reports/outcomes',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'],
  },
  // Report library: each report narrows further (src/lib/reports/library/access.ts)
  { prefix: '/dashboard/reports', roles: REPORT_LIBRARY_ROLES },
  // Staff resources (policies, forms, training links; no PHI): every clinic role, each item
  // narrowed by its own visibleRoles (src/lib/resources/access.ts). Before /dashboard/resources.
  { prefix: '/dashboard/resources/staff', roles: ALL_CLINIC_STAFF },
  // Patient education library: care team, office manager and primary care (patient education
  // for diabetes / hypertension). Sending to a client is narrowed further in the store.
  {
    prefix: '/dashboard/resources',
    roles: [...CARE_TEAM, 'OFFICE_MANAGER', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'],
  },

  // EHR — specific before /dashboard/ehr
  { prefix: '/dashboard/ehr/assessments/cssrs', roles: CSSRS_ROLES },
  { prefix: '/dashboard/ehr/labs', roles: LABS_ROLES },
  { prefix: '/dashboard/ehr/healthlake', roles: HEALTHLAKE_ROLES },
  {
    prefix: '/dashboard/ehr/tms-spravato',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PSYCHIATRIST', 'NP', 'THERAPIST'],
  },
  // Service Eligibility Scanner + SUD Referral Radar (scan diagnoses and signed-note language):
  // clinical decision support for the care team and clinical leadership. Office Manager removed (it
  // got an org-wide SUD screen of note text). ADMIN stays out by the existing scanner rule.
  { prefix: '/dashboard/ehr/scanner', roles: ['DIRECTOR', 'PRACTICE_DIRECTOR', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER'] },
  // Rcopia logout_url landing (on-demand DrFirst update): every role that can prescribe in Rcopia
  { prefix: '/dashboard/ehr/prescriptions/return', roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'] },
  { prefix: '/dashboard/ehr/prescriptions', roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PSYCHIATRIST', 'NP'] },
  // THERAPIST: licensed supervisors (e.g. LCPC-S) co-sign their licensure-track supervisees' notes.
  { prefix: '/dashboard/ehr/supervisor-review', roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'THERAPIST'] },
  { prefix: '/dashboard/ehr/smart-phrases', roles: [...EHR_CLINICAL, 'PRP_SPECIALIST'] },
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
  // CRISP HIE (outside encounters, meds, labs): treating clinicians, care coordinators and the
  // primary care providers (physician, medical NP). Not Office Manager, Peer Support or Medical
  // Assistants (same list as LAUNCH_ROLES in src/lib/fhir/config.ts). Launch is caseload / care-team scoped.
  {
    prefix: '/dashboard/ehr/hie',
    roles: [
      'ADMIN',
      'DIRECTOR',
      'PRACTICE_DIRECTOR',
      'CLINICIAN',
      'THERAPIST',
      'PSYCHIATRIST',
      'NP',
      'CASE_MANAGER',
      'PRP_SPECIALIST',
      'PHYSICIAN',
      'MEDICAL_NP',
    ],
  },
  {
    prefix: '/dashboard/ehr/consents',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'FRONT_DESK', 'OFFICE_MANAGER'],
  },
  { prefix: '/dashboard/ehr/prior-auths', roles: PRIOR_AUTH_ROLES },
  // Part 2 roster, consents and disclosures: Part 2 program staff, Billing (payment disclosures under
  // a 42 CFR 2.31 consent) and Office Manager (release-of-information custodian). Front Desk removed:
  // the roster itself identifies SUD patients; consent packets stay on /dashboard/ehr/consents.
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
  // Group Therapy (psychotherapy, incl. PRP groups) and SUD Group Counseling are separate areas.
  // SUD groups are 42 CFR Part 2: no PRP specialists (not part of the SUD program).
  {
    prefix: '/dashboard/ehr/group-sessions',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'PRP_SPECIALIST', 'CASE_MANAGER'],
  },
  {
    prefix: '/dashboard/ehr/sud-groups',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'CASE_MANAGER'],
  },
  { prefix: '/dashboard/ehr/session-ai', roles: PROVIDERS },
  // Treatment-plan wording: plan authors only (crisis responders do not write treatment plans)
  { prefix: '/dashboard/ehr/goal-bank', roles: EHR_CLINICAL },
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
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'],
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

  // Clinical ops
  { prefix: '/dashboard/communications', roles: COMMUNICATIONS_ROLES },
  { prefix: '/dashboard/telehealth', roles: TELEHEALTH_ROLES },
  { prefix: '/dashboard/alerts', roles: ALERTS_PAGE_ROLES },
  {
    prefix: '/dashboard/messages',
    roles: MESSAGING_ROLES,
  },
  { prefix: '/dashboard/appointments', roles: [...CARE_OPS, ...MEDICAL_ROLES] },
  { prefix: '/dashboard/huddle', roles: HUDDLE_ROLES },
  {
    prefix: '/dashboard/tasks',
    roles: [...CARE_OPS, 'BILLING', ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES, ...CRISIS_RESPONDER_ROLES],
  },

  // Clients — waitlist/intake before clients root (Billing: roster only)
  // Waitlist: desk / office manager / leadership manage it; licensed clinicians read it and add
  // their own referrals (src/lib/waitlist/standard.ts). HR / billing never.
  {
    prefix: '/dashboard/clients/waitlist',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER', 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'],
  },
  {
    prefix: '/dashboard/clients/intake',
    roles: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER'],
  },
  // Medical roles: one client record; caseload scoping + the chart's medical-role tab set apply
  {
    prefix: '/dashboard/clients',
    roles: [...CARE_TEAM, 'FRONT_DESK', 'BILLING', 'OFFICE_MANAGER', ...MEDICAL_ROLES, ...MEDICAL_ASSISTANT_ROLES],
  },

  { prefix: '/dashboard', roles: ALL_CLINIC_STAFF },
];

/**
 * Every sidebar path in src/components/layout/navConfig.ts (plus search-only pages).
 * tests/navigation.test.ts keeps this list in sync with the nav config.
 */
export const CLINIC_NAV_HREFS = [
  '/dashboard',
  '/dashboard/tasks',
  '/dashboard/huddle',
  '/dashboard/appointments',
  '/dashboard/inbox',
  '/dashboard/clients/waitlist',
  '/dashboard/ehr/group-sessions',
  '/dashboard/ehr/sud-groups',
  '/dashboard/telehealth',
  '/dashboard/admin/scheduling-settings',
  '/dashboard/clients',
  '/dashboard/clients/intake',
  '/dashboard/ehr/notes',
  '/dashboard/ehr/treatment-plans',
  '/dashboard/ehr/assessments',
  '/dashboard/ehr/assessments/sud',
  '/dashboard/ehr/assessments/cssrs',
  '/dashboard/ehr/locus',
  '/dashboard/ehr/evaluations',
  '/dashboard/ehr/diagnoses',
  '/dashboard/ehr/prescriptions',
  '/dashboard/ehr/labs',
  '/dashboard/ehr/safety-plan',
  '/dashboard/ehr/discharge',
  '/dashboard/ehr/supervisor-review',
  '/dashboard/scribe',
  '/dashboard/ehr/doc-intake',
  '/dashboard/ehr/scanner',
  '/dashboard/ehr/scanner/sud-radar',
  '/dashboard/ehr/mandatory-reporting',
  '/dashboard/ehr/consents',
  '/dashboard/ehr/hie',
  '/dashboard/alerts',
  '/dashboard/messages',
  '/dashboard/communications',
  '/dashboard/prp',
  '/dashboard/prp/assessment',
  '/dashboard/prp/irp',
  '/dashboard/prp/referral',
  '/dashboard/prp/enroll',
  '/dashboard/crisis',
  '/dashboard/residential',
  '/dashboard/aot',
  '/dashboard/programs/intensive',
  '/dashboard/programs/intensive/billing',
  '/dashboard/ehr/tms-spravato',
  '/dashboard/community',
  '/dashboard/community/referrals',
  '/dashboard/peer-support',
  '/dashboard/pr',
  '/dashboard/marketing',
  '/dashboard/marketing/leads',
  '/dashboard/billing/claims',
  '/dashboard/billing/claim-scrubber',
  '/dashboard/coding',
  '/dashboard/billing/superbills',
  '/dashboard/billing/payments',
  '/dashboard/billing/ar-control',
  '/dashboard/billing/provider-collections',
  '/dashboard/billing/denials',
  '/dashboard/billing/statements',
  '/dashboard/billing/autopay',
  '/dashboard/billing/clearinghouse',
  '/dashboard/ehr/eligibility',
  '/dashboard/billing/authorizations',
  '/dashboard/billing/fee-schedule',
  '/dashboard/billing/valant-balances',
  '/dashboard/billing',
  '/dashboard/billing/residential-crisis',
  '/dashboard/reports',
  '/dashboard/analytics/schedule',
  '/dashboard/analytics/productivity',
  '/dashboard/analytics/surveys',
  '/dashboard/population',
  '/dashboard/ai-insights',
  '/dashboard/mbc',
  '/dashboard/mbc/outcomes',
  '/dashboard/mbc/guide',
  '/dashboard/sdoh',
  '/dashboard/practice-setup',
  '/onboarding',
  '/dashboard/enterprise',
  '/dashboard/admin/locations',
  '/dashboard/admin',
  '/dashboard/billing/payer-settings',
  '/dashboard/billing/panels',
  '/dashboard/billing/insurance-companies',
  '/dashboard/ehr/note-builder',
  '/dashboard/ehr/smart-phrases',
  '/dashboard/ehr/goal-bank',
  '/dashboard/admin/measurement-types',
  '/dashboard/resources',
  '/dashboard/admin/audit-log',
  '/dashboard/ehr/part2',
  '/dashboard/protected-records',
  '/dashboard/incidents',
  '/dashboard/grievances',
  '/dashboard/qi',
  '/dashboard/compliance',
  '/dashboard/hr',
  '/dashboard/hr/credentialing',
  '/dashboard/hr/supervision',
  '/dashboard/hr/training',
  '/dashboard/hr/me',
  '/dashboard/ehr/healthlake',
  '/dashboard/admin/migration',
  '/dashboard/subscription',
  '/dashboard/projects',
  // Search-only pages
  '/dashboard/ehr',
  '/dashboard/settings',
  '/dashboard/notifications',
  // Primary care worklists (folded into Clients / Billing / Admin; overview is search-only)
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
] as const;

/**
 * Page rule for a role. `caps` (optional) adds capability grants on top of the role: a Medical
 * Director (prescriber role + verified flag) also opens the clinical oversight pages
 * (MEDICAL_DIRECTOR_PAGE_PREFIXES). Without caps the result is the plain role rule.
 */
export function canAccessPath(
  role: StaffRole | string | undefined | null,
  pathname: string,
  caps?: AccessCapabilities | null
): boolean {
  if (!role) return false;
  const normalized = normalizeStaffRole(role);
  const path = pathname.split('?')[0] || '/dashboard';
  if (medicalDirectorActive(normalized, caps) && isMedicalDirectorPagePath(path)) return true;
  const rule = PATH_ACCESS.find(
    (r) => path === r.prefix || path.startsWith(`${r.prefix}/`)
  );
  if (!rule) return normalized === 'ADMIN';
  return rule.roles.includes(normalized);
}

/** Clinic staff on a /dashboard/* URL they are not allowed to open. */
export function shouldBlockDashboardPath(
  role: StaffRole | string | undefined | null,
  pathname: string,
  caps?: AccessCapabilities | null
): boolean {
  if (!role) return false;
  const normalized = normalizeStaffRole(role);
  if (normalized === 'SUPER_ADMIN') return false;
  const path = pathname.split('?')[0] || '/dashboard';
  if (path === '/dashboard') return false;
  if (!path.startsWith('/dashboard')) return false;
  return !canAccessPath(normalized, path, caps);
}

export function filterNavForRole<T extends { href: string }>(
  sections: { label: string; items: T[] }[],
  role: StaffRole | string | undefined | null,
  caps?: AccessCapabilities | null
): { label: string; items: T[] }[] {
  const normalized = normalizeStaffRole(role);
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessPath(normalized, item.href, caps)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Landing page per role, used on every sign-in, on /dashboard (proxy + page redirect), on role
 * switch and whenever a page is blocked. Primary care roles land on the primary care overview,
 * crisis responders on Mobile Crisis; everyone else (incl. the psychiatric NP) on /dashboard,
 * where RoleHomeRouter renders their role home. Always a page canAccessPath allows for the role.
 */
export function homePathForRole(role: StaffRole | string | undefined | null): string {
  const normalized = normalizeStaffRole(role);
  if (isPlatformAdmin(normalized)) return '/platform';
  if (normalized === 'PHYSICIAN' || normalized === 'MEDICAL_NP' || normalized === 'MEDICAL_ASSISTANT') return '/dashboard/medical';
  if (normalized === 'CRISIS_RESPONDER') return '/dashboard/crisis';
  return '/dashboard';
}

/**
 * Where to send a user right after sign-in. A callbackUrl is honoured only when it is a same-site
 * staff page (/dashboard/* or /platform/*, no protocol-relative or encoded tricks) that the role
 * may open; "/dashboard" itself resolves to the role home. Anything else -> homePathForRole.
 */
export function postLoginPath(
  role: StaffRole | string | undefined | null,
  callbackUrl?: string | null,
  caps?: AccessCapabilities | null,
): string {
  const home = homePathForRole(role);
  if (!role || !callbackUrl) return home;
  let target = callbackUrl.trim();
  // Absolute URL on any origin is never followed; same-origin callers pass a path.
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return home;
  if (/%2f|%5c/i.test(target) || /[\u0000-\u001f]/.test(target)) return home;
  const path = target.split(/[?#]/)[0] || '/';
  const normalized = normalizeStaffRole(role);
  if (isPlatformAdmin(normalized)) {
    return path === '/platform' || path.startsWith('/platform/') ? target : home;
  }
  if (path === '/dashboard') return home;
  if (!path.startsWith('/dashboard/')) return home;
  if (!canAccessPath(normalized, path, caps)) return home;
  target = target.replace(/#.*$/, '');
  return target;
}

/**
 * Part 2 / sensitive-record break-the-glass (24 h emergency grant): leadership and licensed
 * treating clinicians / prescribers only (42 CFR 2.51 medical emergency: bona fide treating
 * providers). Not Peer Support, Case Manager, PRP, Crisis Responder, Medical Assistant, Front
 * Desk, Office Manager, Billing or HR. Non-leadership roles may only break the glass for a
 * client already on their caseload / care team (enforced in the break-glass route).
 */
export function canBreakGlass(role: StaffRole | string | undefined | null): boolean {
  if (!role) return false;
  const r = normalizeStaffRole(role);
  return [...LEADERSHIP, ...LICENSED, 'PHYSICIAN', 'MEDICAL_NP'].includes(r);
}

/** Leadership roles (org-wide client scope; break-glass without a caseload link). */
export function isLeadershipRole(role: StaffRole | string | undefined | null): boolean {
  return Boolean(role) && LEADERSHIP.includes(normalizeStaffRole(role));
}

/**
 * API gates enforced in src/proxy.ts for every signed-in /api request (public APIs excluded there).
 * Same role lists as the page each API serves, so an API never returns data the page would hide.
 * First match wins (put specific prefixes / method rules first). An API with no rule here relies on
 * the role checks in its own route (canAccessClientRoster, canPrescribe, requireFullAdmin, ...).
 */
type ApiRule = { prefix: string; roles: StaffRole[]; methods?: string[] };

/** Every clinic role except HR: HR never gets client PHI (no clients / EHR / messages / billing). */
const NON_HR_STAFF: StaffRole[] = ALL_CLINIC_STAFF.filter((r) => r !== 'HR');

/** Client-PHI APIs: HR is refused outright (route-level role checks still apply to everyone else). */
const CLIENT_PHI_API_PREFIXES = [
  '/api/clients',
  '/api/clinical',
  '/api/ehr',
  '/api/notes',
  '/api/assessments',
  '/api/appointments',
  '/api/messages',
  '/api/telehealth',
  '/api/medical',
  '/api/labs',
  '/api/prescriptions',
  '/api/prescribing',
  '/api/drfirst',
  '/api/integrations/drfirst',
  '/api/eligibility',
  '/api/consents',
  '/api/sdoh',
  '/api/tms',
  '/api/spravato',
  '/api/sensitive-records',
  '/api/part2',
  '/api/waitlist',
  '/api/intake',
  '/api/referrals',
  '/api/comprehend',
  '/api/textract',
  '/api/healthlake',
  '/api/agents',
  '/api/billing',
  '/api/waystar',
  // Resource library assignments (client names + what was sent); item lists carry no PHI
  '/api/resources/assignments',
  // Visit Guide (protocol steps, due items, briefing) and its checklist marks
  '/api/visits',
  // Huddle sheet (client names, MRNs, digest summaries, flags)
  '/api/huddle',
] as const;

const API_PATH_ACCESS: ApiRule[] = [
  // Org-wide alerts / appointments / client names; no page uses it (role homes load per-role feeds)
  { prefix: '/api/dashboard/overview', roles: LEADERSHIP },
  { prefix: '/api/huddle', roles: HUDDLE_ROLES },
  // Crisis escalation from telehealth (InCallEhrDrawer) / communications must never be blocked for clinical staff
  { prefix: '/api/crisis/paging', roles: CRISIS_ESCALATION_ROLES, methods: ['POST'] },
  { prefix: '/api/crisis/episodes', roles: CRISIS_ESCALATION_ROLES, methods: ['POST'] },
  { prefix: '/api/crisis', roles: CRISIS_ROLES },
  { prefix: '/api/residential', roles: RESIDENTIAL_ROLES },
  { prefix: '/api/aot', roles: AOT_ROLES },
  // Charge drafts: billing roles (generate / read rules in the route); the rest of the module: program roles
  { prefix: '/api/intensive/charges', roles: [...INTENSIVE_BILLING_ROLES] },
  { prefix: '/api/intensive', roles: INTENSIVE_ROLES },
  { prefix: '/api/prp', roles: [...PRP_PAGE_ROLES, ...PRP_FORM_ROLES] },
  { prefix: '/api/alerts', roles: ALERTS_PAGE_ROLES },
  { prefix: '/api/risk-alerts', roles: ALERTS_PAGE_ROLES },
  { prefix: '/api/communications', roles: COMMUNICATIONS_ROLES },
  { prefix: '/api/connect', roles: [...COMMUNICATIONS_ROLES, ...TELEHEALTH_ROLES] },
  { prefix: '/api/hr/credentialing', roles: HR_CORE },
  // HR standard APIs: HR-admin areas are gated here too; self-service APIs (/api/hr/me, tasks,
  // time-off, performance, policies, documents, org-chart) are scoped to the viewer in the route.
  { prefix: '/api/hr/dashboard', roles: HR_PERSONNEL },
  { prefix: '/api/hr/checklists', roles: HR_PERSONNEL },
  { prefix: '/api/hr/templates', roles: HR_PERSONNEL },
  { prefix: '/api/hr/discipline', roles: HR_PERSONNEL, methods: ['GET', 'POST'] },
  { prefix: '/api/hr/people', roles: HR_CORE, methods: ['POST', 'PATCH'] },
  { prefix: '/api/hr/exclusions', roles: HR_CORE },
  { prefix: '/api/hr/expirations', roles: HR_CORE },
  { prefix: '/api/hr/compliance', roles: HR_CORE },
  // 2026-10-22 owner: payer / revenue billing APIs are billing + leadership at the proxy too (each
  // route also checks its page rule). Office Manager keeps the patient-side APIs (payments,
  // statements, AutoPay, prior auth, patient balance / copays), which have no rule here.
  { prefix: '/api/billing/overview', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/ar', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/claim-scrub', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/provider-collections', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/valant-archive', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/residential-crisis', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/specialized', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/insurance-companies', roles: BILLING_AR_ROLES },
  // Payer master + insurance panels (Billing › Payers / Insurance Panels)
  { prefix: '/api/billing/payers', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/panels', roles: BILLING_AR_ROLES },
  { prefix: '/api/billing/statements', roles: PATIENT_BILLING_OFFICE_ROLES },
  { prefix: '/api/billing/denials', roles: BILLING_DENIALS_ROLES },
  { prefix: '/api/billing/appeals', roles: BILLING_DENIALS_ROLES },
  { prefix: '/api/medical/billing', roles: MEDICAL_BILLING_ROLES },
  { prefix: '/api/medical/payer-settings', roles: MEDICAL_PAYER_SETTINGS_ROLES },
  { prefix: '/api/reports/library', roles: REPORT_LIBRARY_ROLES },
  // Growth & Marketing: public form / registration / unsubscribe / cron endpoints are outside the
  // proxy gate (isPublicApi); lead endpoints add Front Desk; everything else is marketing roles.
  { prefix: '/api/marketing/leads', roles: MARKETING_LEAD_ROLES },
  { prefix: '/api/marketing', roles: MARKETING_ROLES },
  ...CLIENT_PHI_API_PREFIXES.map((prefix) => ({ prefix, roles: NON_HR_STAFF })),
];

/**
 * Signed-in clinic request to an /api path: false -> the proxy answers 403. A Medical Director
 * (caps) also passes the APIs behind the oversight pages (MEDICAL_DIRECTOR_API_PREFIXES); the
 * route's own checks then re-verify the flag from the database.
 */
export function canAccessApiPath(
  role: StaffRole | string | undefined | null,
  pathname: string,
  method = 'GET',
  caps?: AccessCapabilities | null,
): boolean {
  if (!role) return false;
  const normalized = normalizeStaffRole(role);
  // Platform admins are refused by requireOrgContext on clinic APIs; /api/platform has its own gate.
  if (isPlatformAdmin(normalized)) return true;
  const path = pathname.split('?')[0];
  if (medicalDirectorActive(normalized, caps) && isMedicalDirectorApiPath(path)) return true;
  const m = method.toUpperCase();
  const rule = API_PATH_ACCESS.find(
    (r) => (path === r.prefix || path.startsWith(`${r.prefix}/`)) && (!r.methods || r.methods.includes(m)),
  );
  if (!rule) return true;
  return rule.roles.includes(normalized);
}

export function shouldUseRoleHome(role: StaffRole | string | undefined | null, pathname: string): boolean {
  if (!role || pathname !== '/dashboard') return false;
  return true;
}

