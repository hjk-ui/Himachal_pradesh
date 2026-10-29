/**
 * Staff sidebar navigation — single source of truth for the sidebar, command
 * search, breadcrumbs and page titles. Pure data + functions (no React) so the
 * structure can be unit-tested (tests/navigation.test.ts).
 *
 * Visibility rule: a role only ever sees links that pass `canAccessPath`, the
 * same rule the dashboard layout / proxy use to gate the page itself, so no
 * sidebar link can bounce a user back to /dashboard.
 */
import { canAccessPath } from '@/lib/auth/roleAccess';
import { isMedicalDirectorPagePath, medicalDirectorActive, type AccessCapabilities } from '@/lib/auth/medicalDirector';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import { isMedicalViewerRole, MEDICAL_CLIENTS_HREF } from '@/lib/medical/medicalProgram';
import type { StaffRole } from '@/types/roles';

export type NavIconName =
  | 'home'
  | 'todo'
  | 'today'
  | 'inbox'
  | 'calendar'
  | 'clock'
  | 'users'
  | 'video'
  | 'calendarCog'
  | 'clientList'
  | 'intake'
  | 'file'
  | 'clipboard'
  | 'chart'
  | 'flask'
  | 'shieldAlert'
  | 'activity'
  | 'pill'
  | 'logout'
  | 'check'
  | 'mic'
  | 'spark'
  | 'scan'
  | 'fileCheck'
  | 'network'
  | 'bell'
  | 'chat'
  | 'phone'
  | 'grid'
  | 'siren'
  | 'bed'
  | 'scale'
  | 'zap'
  | 'globe'
  | 'handshake'
  | 'megaphone'
  | 'card'
  | 'receipt'
  | 'wallet'
  | 'trending'
  | 'alert'
  | 'mail'
  | 'repeat'
  | 'send'
  | 'shield'
  | 'tag'
  | 'archive'
  | 'building'
  | 'settings'
  | 'map'
  | 'userCog'
  | 'book'
  | 'lock'
  | 'grad'
  | 'database'
  | 'upload'
  | 'kanban'
  | 'stethoscope'
  | 'heart';

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  /** Only an exact pathname match marks this link active. */
  exact?: boolean;
  /** Collapsible sub-group heading inside the area (undefined = top of area). */
  group?: string;
  /** Extra search words, e.g. a page's old name, so renamed pages stay findable. */
  keywords?: string;
  badge?: number;
};

export type NavSection = { label: string; items: NavItem[] };

/** Sub-groups that start collapsed (unless they contain the active page). */
export const DEFAULT_COLLAPSED_GROUPS = new Set<string>(['Clients/Clinical worklists']);

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Home',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'home', exact: true, keywords: 'home overview' },
      { href: '/dashboard/tasks', label: 'My To-Do', icon: 'todo', keywords: 'tasks todo' },
      { href: '/dashboard/hr/me', label: 'My HR', icon: 'userCog', keywords: 'my hr time off pto sick leave credentials license trainings ceu documents onboarding handbook policies' },
      // Query string keeps this distinct from Schedule › Calendar; the board opens on today's day view.
      {
        href: '/dashboard/appointments?view=today',
        label: "Today's schedule",
        icon: 'today',
        keywords: 'today appointments board check-in',
      },
      { href: '/dashboard/huddle', label: 'Huddle sheet', icon: 'clipboard', keywords: 'huddle tomorrow summary pre-visit brief flags prep' },
    ],
  },
  {
    label: 'Inbox',
    items: [
      {
        href: '/dashboard/inbox',
        label: 'Inbox',
        icon: 'inbox',
        keywords: 'messages tasks risk alerts refills documents to file co-sign',
      },
    ],
  },
  {
    label: 'Schedule',
    items: [
      { href: '/dashboard/appointments', label: 'Calendar', icon: 'calendar', keywords: 'appointments schedule book' },
      { href: '/dashboard/clients/waitlist', label: 'Waitlist', icon: 'clock' },
      {
        href: '/dashboard/ehr/group-sessions',
        label: 'Group Therapy',
        icon: 'users',
        keywords: 'groups group sessions psychotherapy 90853 attendance group notes',
      },
      {
        href: '/dashboard/ehr/sud-groups',
        label: 'SUD Group Counseling',
        icon: 'users',
        keywords: 'groups substance use sud iop counseling h0005 part 2 attendance',
      },
      { href: '/dashboard/telehealth', label: 'Telehealth', icon: 'video', keywords: 'video chime' },
      {
        href: '/dashboard/admin/scheduling-settings',
        label: 'Online booking settings',
        icon: 'calendarCog',
        keywords: 'online scheduling self-scheduling booking',
      },
    ],
  },
  {
    label: 'Clients',
    items: [
      { href: '/dashboard/clients', label: 'Client list', icon: 'clientList', keywords: 'clients patients roster chart' },
      { href: '/dashboard/clients/intake', label: 'New intake', icon: 'intake', keywords: 'digital intake packet link' },
      // Primary care (Family Practice) shares the client record; the chart has a Medical tab group
      {
        href: '/dashboard/medical/patients',
        label: 'Primary care patients',
        icon: 'stethoscope',
        keywords: 'medical patients primary care family practice roster',
      },
      {
        href: '/dashboard/medical/patients/intake',
        label: 'Primary care intake',
        icon: 'intake',
        keywords: 'medical intake wizard new patient',
      },
      ...(
        [
          { href: '/dashboard/ehr/notes', label: 'Progress Notes', icon: 'file', keywords: 'soap notes documentation' },
          { href: '/dashboard/ehr/treatment-plans', label: 'Treatment Plans', icon: 'clipboard' },
          { href: '/dashboard/ehr/assessments', label: 'Assessments', icon: 'chart', keywords: 'phq-9 gad-7' },
          { href: '/dashboard/ehr/assessments/sud', label: 'SUD Screeners', icon: 'flask', keywords: 'audit dast cage substance' },
          { href: '/dashboard/ehr/assessments/cssrs', label: 'C-SSRS (Suicide Scale)', icon: 'shieldAlert', keywords: 'columbia suicide' },
          { href: '/dashboard/ehr/locus', label: 'LOCUS / CALOCUS', icon: 'chart', keywords: 'level of care' },
          { href: '/dashboard/ehr/evaluations', label: 'Evaluations', icon: 'clipboard' },
          { href: '/dashboard/ehr/diagnoses', label: 'Diagnoses', icon: 'activity', keywords: 'icd-10 dx' },
          { href: '/dashboard/ehr/prescriptions', label: 'E-Prescribing', icon: 'pill', keywords: 'drfirst rcopia rx epcs' },
          { href: '/dashboard/ehr/labs', label: 'Labs', icon: 'flask', keywords: 'lab orders results' },
          { href: '/dashboard/ehr/safety-plan', label: 'Safety Planning', icon: 'shieldAlert' },
          { href: '/dashboard/sdoh', label: 'Social Needs (SDOH)', icon: 'handshake', keywords: 'sdoh social determinants ahc hrsn housing food transportation utilities referrals community resources' },
          { href: '/dashboard/ehr/discharge', label: 'Discharge Planning', icon: 'logout' },
          { href: '/dashboard/ehr/supervisor-review', label: 'Supervisor Review', icon: 'check', keywords: 'co-sign cosign' },
          { href: '/dashboard/scribe', label: 'AI Scribe', icon: 'mic', keywords: 'dictation transcript ai session notes paste import' },
          { href: '/dashboard/ehr/doc-intake', label: 'Smart Doc Intake', icon: 'file', keywords: 'documents upload file fax' },
          {
            href: '/dashboard/ehr/scanner',
            label: 'Service Eligibility Scanner',
            icon: 'scan',
            keywords: 'service eligibility scanner prp spravato tms aot residential asam referral candidates',
          },
          {
            href: '/dashboard/ehr/scanner/sud-radar',
            label: 'SUD Referral Radar',
            icon: 'scan',
            keywords: 'sud radar substance use f10 f19 referral signals',
          },
          { href: '/dashboard/ehr/mandatory-reporting', label: 'Mandatory Reporting', icon: 'shieldAlert' },
          { href: '/dashboard/ehr/consents', label: 'Consent Forms', icon: 'fileCheck', keywords: 'roi release' },
          { href: '/dashboard/ehr/hie', label: 'CRISP HIE', icon: 'network', keywords: 'health information exchange' },
          { href: '/dashboard/alerts', label: 'Risk Alerts', icon: 'bell', keywords: 'crisis safety flags' },
          { href: '/dashboard/messages', label: 'Messages', icon: 'chat', keywords: 'secure messaging' },
          { href: '/dashboard/communications', label: 'Communications', icon: 'phone', keywords: 'sms calls' },
        ] satisfies Omit<NavItem, 'group'>[]
      ).map((item) => ({ ...item, group: 'Clinical worklists' })),
      ...(
        [
          { href: '/dashboard/medical/visits', label: 'Visits & SOAP', icon: 'stethoscope', keywords: 'medical encounters sign visit' },
          { href: '/dashboard/medical/vitals', label: 'Vitals flowsheet', icon: 'heart', keywords: 'blood pressure bmi' },
          { href: '/dashboard/medical/problem-list', label: 'Problem list', icon: 'check', keywords: 'medical problems icd-10' },
          { href: '/dashboard/medical/preventive-care', label: 'Preventive care', icon: 'shield', keywords: 'screenings care gaps uspstf' },
          { href: '/dashboard/medical/history', label: 'Medical history', icon: 'book', keywords: 'pmh allergies med rec' },
          { href: '/dashboard/medical/referrals', label: 'Orders & referrals', icon: 'send', keywords: 'imaging specialist referral letter' },
          { href: '/dashboard/medical/labs', label: 'Primary care lab orders', icon: 'flask', keywords: 'medical labs' },
          { href: '/dashboard/medical/ai', label: 'Medical AI Suite', icon: 'spark', keywords: 'soap draft comprehend' },
        ] satisfies Omit<NavItem, 'group'>[]
      ).map((item) => ({ ...item, group: 'Primary care' })),
    ],
  },
  {
    label: 'Programs',
    items: [
      { href: '/dashboard/prp', label: 'PRP Program', icon: 'grid', group: 'PRP', exact: true },
      { href: '/dashboard/prp/assessment', label: 'PRP Assessment', icon: 'clipboard', group: 'PRP' },
      { href: '/dashboard/prp/irp', label: 'Treatment Plan (IRP)', icon: 'file', group: 'PRP' },
      { href: '/dashboard/prp/referral', label: 'PRP Referral', icon: 'users', group: 'PRP' },
      { href: '/dashboard/prp/enroll', label: 'Enroll Client', icon: 'intake', group: 'PRP' },
      { href: '/dashboard/crisis', label: 'Mobile Crisis Team', icon: 'siren', keywords: 'crisis team' },
      { href: '/dashboard/residential', label: 'Residential (ASAM 3.1/3.5)', icon: 'bed' },
      { href: '/dashboard/aot', label: 'AOT Court Program', icon: 'scale' },
      { href: '/dashboard/programs/intensive', label: 'IOP / PHP Programs', icon: 'activity', keywords: 'intensive outpatient iop php partial hospitalization asam 2.1 2.5 h0015 s9480 h0035' },
      { href: '/dashboard/ehr/tms-spravato', label: 'TMS & Spravato', icon: 'zap' },
      { href: '/dashboard/community', label: 'Events & Outreach', icon: 'globe', group: 'Community outreach', exact: true },
      {
        href: '/dashboard/community/referrals',
        label: 'Referrals',
        icon: 'users',
        group: 'Community outreach',
        keywords: 'referral tracking inbound outbound',
      },
      { href: '/dashboard/peer-support', label: 'Peer Support', icon: 'handshake', group: 'Community outreach' },
      {
        href: '/dashboard/marketing',
        label: 'Marketing hub',
        icon: 'trending',
        group: 'Growth & Marketing',
        exact: true,
        keywords: 'growth marketing leads pipeline crm campaigns email sms reviews reputation testimonials automations social planner analytics attribution partners',
      },
      {
        href: '/dashboard/marketing/leads',
        label: 'Lead inbox',
        icon: 'inbox',
        group: 'Growth & Marketing',
        keywords: 'leads prospective clients inquiries pipeline conversations speed to lead web form',
      },
      { href: '/dashboard/pr', label: 'PR & Marketing', icon: 'megaphone', group: 'Growth & Marketing', keywords: 'press releases media coverage brand assets' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { href: '/dashboard/billing/claims', label: 'Claims', icon: 'file', group: 'Claims', keywords: '837p cms-1500' },
      { href: '/dashboard/billing/claim-scrubber', label: 'Claim Scrubber', icon: 'check', group: 'Claims' },
      { href: '/dashboard/coding', label: 'AI Coding', icon: 'spark', group: 'Claims', keywords: 'cpt icd coding' },
      { href: '/dashboard/billing/superbills', label: 'Superbills', icon: 'receipt', group: 'Claims' },
      { href: '/dashboard/billing/payments', label: 'Payments & deposits', icon: 'wallet', keywords: 'payments copay deposits' },
      { href: '/dashboard/billing/ar-control', label: 'A/R Control Center', icon: 'trending', group: 'A/R & follow-up', keywords: 'aging' },
      { href: '/dashboard/billing/provider-collections', label: 'Provider Collections', icon: 'card', group: 'A/R & follow-up' },
      { href: '/dashboard/billing/denials', label: 'Denials', icon: 'alert', keywords: 'denial management appeals' },
      { href: '/dashboard/billing/statements', label: 'eStatements', icon: 'mail', group: 'Statements & autopay', keywords: 'statements' },
      { href: '/dashboard/billing/autopay', label: 'AutoPay', icon: 'repeat', group: 'Statements & autopay' },
      {
        href: '/dashboard/billing/clearinghouse',
        label: 'Clearinghouse',
        icon: 'send',
        group: 'Clearinghouse',
        keywords: 'waystar era 835 remittance',
      },
      {
        href: '/dashboard/ehr/eligibility',
        label: 'Eligibility',
        icon: 'shield',
        group: 'Clearinghouse',
        keywords: '270 271 insurance verification',
      },
      {
        href: '/dashboard/billing/authorizations',
        label: 'Authorizations',
        icon: 'fileCheck',
        group: 'Clearinghouse',
        keywords: 'prior auth pa electronic prior authorization carelon availity',
      },
      { href: '/dashboard/billing/fee-schedule', label: 'Fee schedule', icon: 'tag' },
      {
        href: '/dashboard/billing/valant-balances',
        label: 'Legacy balances (Valant)',
        icon: 'archive',
        keywords: 'valant balances run-out',
      },
      { href: '/dashboard/billing', label: 'Billing overview', icon: 'card', exact: true },
      { href: '/dashboard/billing/residential-crisis', label: 'Residential & Crisis Billing', icon: 'card' },
      { href: '/dashboard/programs/intensive/billing', label: 'IOP / PHP charge drafts', icon: 'card', keywords: 'intensive outpatient partial hospitalization per diem h0015 s9480 h0035' },
      { href: '/dashboard/medical/billing', label: 'Medical billing', icon: 'card', keywords: 'primary care charges medical rcm' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { href: '/dashboard/reports', label: 'Report library', icon: 'chart', keywords: 'outcomes & reports ar aging denials no-show census caseload treatment plans audit export' },
      { href: '/dashboard/analytics/schedule', label: 'Schedule Analytics', icon: 'chart' },
      { href: '/dashboard/analytics/productivity', label: 'Doc Productivity', icon: 'check' },
      { href: '/dashboard/analytics/surveys', label: 'Patient Satisfaction', icon: 'chat', keywords: 'surveys' },
      { href: '/dashboard/population', label: 'Population Health', icon: 'activity' },
      { href: '/dashboard/ai-insights', label: 'Clinical Insights', icon: 'spark' },
      {
        href: '/dashboard/mbc',
        label: 'Outcome measures',
        icon: 'activity',
        exact: true,
        keywords: 'mbc automation measurement-based care',
      },
      {
        href: '/dashboard/mbc/outcomes',
        label: 'Outcome schedules',
        icon: 'calendar',
        keywords: 'outcome measures scheduling phq gad',
      },
      {
        href: '/dashboard/mbc/guide',
        label: 'Measure guide',
        icon: 'book',
        keywords: 'measure interpretation scoring cutoffs severity phq-9 gad-7 print blank form',
      },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/dashboard/practice-setup', label: 'Practice settings', icon: 'settings', group: 'Practice & locations', keywords: 'practice setup npi tax id' },
      { href: '/onboarding', label: 'Setup wizard', icon: 'settings', group: 'Practice & locations', keywords: 'practice setup onboarding' },
      { href: '/dashboard/enterprise', label: 'Locations & enterprise', icon: 'building', group: 'Practice & locations' },
      { href: '/dashboard/admin/locations', label: 'Locations', icon: 'map', group: 'Practice & locations', keywords: 'locations facility mapping valant client location' },
      {
        href: '/dashboard/admin',
        label: 'Admin & Compliance',
        icon: 'userCog',
        group: 'Users & roles',
        exact: true,
        keywords: 'users roles staff invite audit log hipaa',
      },
      { href: '/dashboard/billing/payer-settings', label: 'Payers', icon: 'settings', group: 'Payers & panels', keywords: 'payer settings payer ids claims mailing address timely filing waystar era eft' },
      { href: '/dashboard/billing/panels', label: 'Insurance Panels', icon: 'users', group: 'Payers & panels' },
      { href: '/dashboard/billing/insurance-companies', label: 'Insurance companies', icon: 'building', group: 'Payers & panels', keywords: 'payers insurance companies valant edi payer id claim addresses' },
      {
        href: '/dashboard/medical/payer-settings',
        label: 'Medical payer settings',
        icon: 'settings',
        group: 'Payers & panels',
        keywords: 'primary care payer rules timely filing',
      },
      { href: '/dashboard/ehr/note-builder', label: 'Note Builder', icon: 'file', group: 'Clinical content' },
      { href: '/dashboard/ehr/smart-phrases', label: 'Smart Phrases', icon: 'book', group: 'Clinical content' },
      { href: '/dashboard/ehr/goal-bank', label: 'Goal Bank', icon: 'book', group: 'Clinical content' },
      {
        href: '/dashboard/admin/measurement-types',
        label: 'Measurement types',
        icon: 'activity',
        group: 'Clinical content',
        keywords: 'measures scores subscores vitals valant outcome',
      },
      { href: '/dashboard/resources', label: 'Resource Library', icon: 'book', group: 'Clinical content' },
      { href: '/dashboard/admin/audit-log', label: 'HIPAA audit log', icon: 'shield', group: 'Compliance', keywords: 'audit trail access log phi hipaa' },
      { href: '/dashboard/ehr/part2', label: '42 CFR Part 2', icon: 'lock', group: 'Compliance' },
      { href: '/dashboard/protected-records', label: 'Protected Records', icon: 'lock', group: 'Compliance', keywords: 'vip sensitive break glass' },
      { href: '/dashboard/incidents', label: 'Incident Reports', icon: 'alert', group: 'Compliance' },
      { href: '/dashboard/grievances', label: 'Grievances & Rights', icon: 'chat', group: 'Compliance' },
      { href: '/dashboard/qi', label: 'Quality Improvement', icon: 'trending', group: 'Compliance', keywords: 'qi' },
      { href: '/dashboard/compliance', label: 'Compliance Calendar', icon: 'calendar', group: 'Compliance' },
      { href: '/dashboard/hr', label: 'HR & Staff', icon: 'building', group: 'HR & credentialing', exact: true },
      { href: '/dashboard/hr/credentialing', label: 'Credentialing', icon: 'shield', group: 'HR & credentialing' },
      { href: '/dashboard/hr/supervision', label: 'Clinical Supervision Log', icon: 'clipboard', group: 'HR & credentialing' },
      { href: '/dashboard/hr/training', label: 'Training Hub', icon: 'grad', group: 'HR & credentialing' },
      {
        href: '/dashboard/ehr/healthlake',
        label: 'Data exchange',
        icon: 'database',
        group: 'Integrations',
        keywords: 'healthlake fhir r4 aws',
      },
      {
        href: '/dashboard/admin/migration',
        label: 'Data import',
        icon: 'upload',
        keywords: 'ehr migration import valant',
      },
      { href: '/dashboard/subscription', label: 'Plan & Subscription', icon: 'card' },
      { href: '/dashboard/projects', label: 'Projects & Kanban', icon: 'kanban' },
    ],
  },
];

/**
 * Pages that are reachable but intentionally not in the sidebar (search only).
 * `area` places them in breadcrumbs.
 */
export const SEARCH_ONLY_ITEMS: (NavItem & { area: string })[] = [
  { href: '/dashboard/settings', label: 'My profile', icon: 'settings', area: 'Account', keywords: 'profile settings password' },
  { href: '/dashboard/ehr', label: 'EHR Overview', icon: 'activity', area: 'Clients', exact: true, keywords: 'ehr' },
  // Medical roles' home (their Home › Dashboard link points here)
  {
    href: '/dashboard/medical',
    label: 'Primary care overview',
    icon: 'home',
    area: 'Home',
    exact: true,
    keywords: 'medical overview family practice',
  },
  {
    href: '/dashboard/notifications',
    label: 'Push notifications',
    icon: 'bell',
    area: 'Admin',
    keywords: 'patient app push medication reminders',
  },
];

/** Strip query/hash so a nav href can be compared with a pathname. */
export function hrefPath(href: string): string {
  return href.split(/[?#]/)[0] || '/dashboard';
}

// Role-scoped declutter lists (applied AFTER canAccessPath, so they only ever narrow).
const BILLING_ALLOWED_HREFS = new Set([
  '/dashboard/hr/me',
  '/dashboard',
  '/dashboard/inbox',
  '/dashboard/tasks',
  '/dashboard/clients',
  '/dashboard/ehr/eligibility',
  '/dashboard/billing/authorizations',
  '/dashboard/ehr/part2',
  '/dashboard/coding',
  '/dashboard/billing',
  '/dashboard/billing/claims',
  '/dashboard/billing/clearinghouse',
  '/dashboard/billing/residential-crisis',
  '/dashboard/programs/intensive/billing',
  '/dashboard/billing/payer-settings',
  '/dashboard/billing/fee-schedule',
  '/dashboard/billing/ar-control',
  '/dashboard/billing/claim-scrubber',
  '/dashboard/billing/statements',
  '/dashboard/billing/denials',
  '/dashboard/billing/autopay',
  '/dashboard/billing/valant-balances',
  '/dashboard/billing/provider-collections',
  '/dashboard/billing/superbills',
  '/dashboard/billing/payments',
  '/dashboard/billing/panels',
  '/dashboard/billing/insurance-companies',
  '/dashboard/medical/billing',
  '/dashboard/medical/payer-settings',
  // Report library: BILLING is in REPORT_LIBRARY_ROLES and has its own R_BILLING reports
  '/dashboard/reports',
]);

// Office Manager: front office + operations. No clinical boards (alerts, crisis, residential, AOT,
// PRP), CRISP HIE or the SUD scanner; canAccessPath refuses those too. Billing is patient-side only
// (2026-10-22 owner): payments, statements, AutoPay and authorizations; no A/R, claims, denials,
// payer settings, Valant balances or provider collections.
const OFFICE_MANAGER_ALLOWED_HREFS = new Set([
  '/dashboard/hr/me',
  '/dashboard',
  '/dashboard/inbox',
  '/dashboard/clients',
  '/dashboard/clients/waitlist',
  '/dashboard/clients/intake',
  '/dashboard/appointments',
  '/dashboard/messages',
  '/dashboard/communications',
  '/dashboard/ehr/consents',
  '/dashboard/ehr/eligibility',
  '/dashboard/billing/authorizations',
  '/dashboard/ehr/part2',
  '/dashboard/analytics/schedule',
  '/dashboard/analytics/productivity',
  '/dashboard/analytics/surveys',
  '/dashboard/reports',
  '/dashboard/resources',
  '/dashboard/qi',
  '/dashboard/incidents',
  '/dashboard/grievances',
  '/dashboard/compliance',
  '/dashboard/community',
  '/dashboard/community/referrals',
  '/dashboard/pr',
  '/dashboard/marketing',
  '/dashboard/marketing/leads',
  '/dashboard/billing/payments',
  '/dashboard/billing/statements',
  '/dashboard/billing/autopay',
  '/dashboard/admin/scheduling-settings',
]);

/** Primary care worklists and the Family Practice client filter */
export function isMedicalNavHref(href: string): boolean {
  return hrefPath(href).startsWith('/dashboard/medical') || href === MEDICAL_CLIENTS_HREF;
}

/**
 * Medical providers (physician / medical NP): to-do, schedule, telehealth,
 * communications, their own encounter billing, incident reports, the client list
 * (caseload-scoped; the chart shows them the medical tab set only) and every primary
 * care worklist the role can open. Behavioral-health worklists and alerts are hidden.
 */
// Primary care sidebar: their patient list is "Primary care patients" (not the behavioral health
// client directory); payments, AutoPay and superbills are front-office / billing work (they use Medical billing).
const MEDICAL_PROVIDER_ALLOWED_HREFS = new Set([
  '/dashboard/hr/me',
  '/dashboard/inbox',
  '/dashboard/tasks',
  '/dashboard/huddle',
  '/dashboard/appointments',
  '/dashboard/telehealth',
  '/dashboard/communications',
  '/dashboard/incidents',
]);

const NON_PRESCRIBING_BH = new Set(['THERAPIST', 'PEER_SUPPORT', 'CASE_MANAGER', 'FRONT_DESK']);

/** Sidebar for one role: same order as NAV_SECTIONS, only links the role can open. */
/**
 * The role's Home link in the shell (sidebar "Dashboard" item and the logo): HR's home is the HR
 * workspace; medical roles' home is the primary care overview (the same page /dashboard sends them
 * to). Everyone else: /dashboard (RoleHomeRouter).
 */
export function navHomeHrefForRole(role: StaffRole | string | null | undefined): string {
  if (!role) return '/dashboard';
  const r = normalizeStaffRole(role);
  if (r === 'HR') return '/dashboard/hr';
  if (isMedicalViewerRole(r)) return '/dashboard/medical';
  return '/dashboard';
}

/**
 * Personal settings (My profile: name, photo, password). It is account-level, not a module, so the
 * shell renders it in the sidebar footer / header avatar rather than in a nav section; this is the
 * nav-model entry point, gated by canAccessPath like every sidebar item (every clinic staff role).
 */
export const PROFILE_HREF = '/dashboard/settings';

export function profileHrefForRole(role: StaffRole | string | null | undefined): string | null {
  if (!role) return null;
  return canAccessPath(normalizeStaffRole(role), PROFILE_HREF) ? PROFILE_HREF : null;
}

/**
 * `caps` adds capability links on top of the role: a Medical Director (prescriber role + flag) also
 * gets the clinical oversight pages (MEDICAL_DIRECTOR_PAGE_PREFIXES) — the same canAccessPath rule
 * the proxy and layout apply, so a link never bounces.
 */
export function buildNavForRole(
  role: StaffRole | string | null | undefined,
  sections: NavSection[] = NAV_SECTIONS,
  caps?: AccessCapabilities | null,
): NavSection[] {
  if (!role) return [];
  const r = normalizeStaffRole(role);
  const director = medicalDirectorActive(r, caps);
  const isMedicalProvider = r === 'PHYSICIAN' || r === 'MEDICAL_NP' || r === 'MEDICAL_ASSISTANT';
  const navHome = navHomeHrefForRole(r);
  const home = navHome === '/dashboard' ? null : navHome;

  return sections
    .map((section) => {
      let items = section.items
        .map((item) => (home && item.href === '/dashboard' ? { ...item, href: home } : item))
        // Drop the duplicate HR & Staff link below.
        .filter((item) => !(r === 'HR' && section.label === 'Admin' && item.href === '/dashboard/hr'))
        // Non-prescribing behavioral-health roles never had the primary care worklists in the sidebar
        .filter((item) => !(NON_PRESCRIBING_BH.has(r) && isMedicalNavHref(item.href)))
        .filter((item) => canAccessPath(r, hrefPath(item.href), caps));

      if (isMedicalProvider) {
        items = items.filter(
          (item) =>
            MEDICAL_PROVIDER_ALLOWED_HREFS.has(hrefPath(item.href)) ||
            isMedicalNavHref(item.href) ||
            (director && isMedicalDirectorPagePath(hrefPath(item.href))),
        );
      } else if (r === 'BILLING') {
        items = items.filter((item) => BILLING_ALLOWED_HREFS.has(hrefPath(item.href)));
      } else if (r === 'OFFICE_MANAGER') {
        items = items.filter((item) => OFFICE_MANAGER_ALLOWED_HREFS.has(hrefPath(item.href)));
      }
      return { ...section, items };
    })
    .filter((section) => section.items.length > 0);
}

/** Search-only pages a role can open. */
export function searchOnlyItemsForRole(role: StaffRole | string | null | undefined, caps?: AccessCapabilities | null) {
  if (!role) return [];
  return SEARCH_ONLY_ITEMS.filter((item) => canAccessPath(role, hrefPath(item.href), caps));
}

function matches(item: { href: string; exact?: boolean }, pathname: string) {
  const path = hrefPath(item.href);
  return item.exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

/** Longest matching nav link for a pathname (ignores query-string links like Today's schedule). */
export function findActiveNavItem(
  pathname: string,
  sections: NavSection[] = NAV_SECTIONS,
): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href.includes('?')) continue;
      if (!matches(item, pathname)) continue;
      if (!best || hrefPath(item.href).length > hrefPath(best.item.href).length) best = { section, item };
    }
  }
  return best;
}

const CHART_PATH = /^\/dashboard\/clients\/([^/]+)(?:\/|$)/;
const NON_CHART_CLIENT_SEGMENTS = new Set(['waitlist', 'intake']);

/** Client id when the pathname is a client chart (/dashboard/clients/[id]/...). */
export function chartClientId(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const m = CHART_PATH.exec(pathname);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  return NON_CHART_CLIENT_SEGMENTS.has(id) ? null : id;
}

export type Crumb = { label: string; href?: string };

/**
 * Area › (Group) › Page, from the nav structure. Chart pages end with the
 * client's name when the caller already has it (never fetched for this).
 */
export function breadcrumbsFor(
  pathname: string,
  opts: { sections?: NavSection[]; clientName?: string | null; from?: string | null } = {},
): Crumb[] {
  const sections = opts.sections ?? NAV_SECTIONS;
  const path = hrefPath(pathname);

  // Chart opened from the Primary care patients list (?from=medical): link back to that list
  if (chartClientId(path) && opts.from === 'medical') {
    return [
      { label: 'Clients' },
      { label: 'Primary care patients', href: '/dashboard/medical/patients' },
      { label: opts.clientName?.trim() || 'Client chart' },
    ];
  }
  if (chartClientId(path)) {
    const list = findActiveNavItem('/dashboard/clients', sections) ?? findActiveNavItem('/dashboard/clients');
    const crumbs: Crumb[] = [{ label: 'Clients' }];
    if (list) crumbs.push({ label: list.item.label, href: list.item.href });
    crumbs.push({ label: opts.clientName?.trim() || 'Client chart' });
    return crumbs;
  }

  const hit = findActiveNavItem(path, sections) ?? findActiveNavItem(path);
  const extra = SEARCH_ONLY_ITEMS.filter((i) => matches(i, path)).sort(
    (a, b) => hrefPath(b.href).length - hrefPath(a.href).length,
  )[0];

  if (extra && (!hit || hrefPath(extra.href).length > hrefPath(hit.item.href).length)) {
    return [{ label: extra.area }, { label: extra.label }];
  }
  if (!hit) return [];
  const crumbs: Crumb[] = [{ label: hit.section.label }];
  if (hit.item.group) crumbs.push({ label: hit.item.group });
  // Single-link areas (Inbox) would read "Inbox › Inbox".
  if (hit.item.label !== hit.section.label) crumbs.push({ label: hit.item.label });
  return crumbs;
}

/** Short page title for the header (last breadcrumb), or 'Altrixs'. */
export function pageTitleFor(pathname: string, sections?: NavSection[]): string {
  const crumbs = breadcrumbsFor(pathname, { sections });
  return crumbs.length ? crumbs[crumbs.length - 1].label : 'Altrixs';
}

/** Flat list for the command palette: "Area › Group" as the section line. */
export function navSearchItems(sections: NavSection[]) {
  return sections.flatMap((section) =>
    section.items.map((item) => ({
      href: item.href,
      label: item.label,
      section: item.group ? `${section.label} › ${item.group}` : section.label,
      keywords: item.keywords,
    })),
  );
}

/** Every distinct nav path (used by tests and the Admin access check). */
export function allNavPaths(sections: NavSection[] = NAV_SECTIONS): string[] {
  return [...new Set(sections.flatMap((s) => s.items.map((i) => hrefPath(i.href))))];
}
