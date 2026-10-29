/** Exact Oct 22 HR hub tabs — primary nav labels. */

export const HR_HUB_TABS = [
  { href: '/dashboard/hr', label: 'Dashboard', match: 'exact' as const },
  { href: '/dashboard/hr/people', label: 'People', match: 'prefix' as const },
  { href: '/dashboard/hr/credentialing', label: 'Credentialing', match: 'prefix' as const },
  { href: '/dashboard/hr/onboarding', label: 'Onboarding', match: 'prefix' as const },
  { href: '/dashboard/hr/offboarding', label: 'Offboarding', match: 'prefix' as const },
  { href: '/dashboard/hr/training', label: 'Training', match: 'prefix' as const },
  { href: '/dashboard/hr/time-off', label: 'Time off', match: 'prefix' as const },
  { href: '/dashboard/hr/performance', label: 'Performance', match: 'prefix' as const },
  { href: '/dashboard/hr/supervision', label: 'Supervision', match: 'prefix' as const },
  { href: '/dashboard/hr/org-chart', label: 'Org chart', match: 'prefix' as const },
  { href: '/dashboard/hr/homebase', label: 'Homebase', match: 'prefix' as const },
  { href: '/dashboard/hr/settings', label: 'Settings', match: 'prefix' as const },
  { href: '/dashboard/hr/me', label: 'My HR', match: 'prefix' as const },
] as const;

export const HR_DASHBOARD_TITLE = 'HR dashboard';
export const HR_DASHBOARD_EYEBROW = 'HR';
export const HR_DASHBOARD_DESCRIPTION =
  'Expirations, reminders, onboarding and approvals in one place. Reminders appear in Altrixs only; no email is sent.';

export const HR_EMPTIES = {
  nothingWaiting: 'Nothing waiting',
  allCurrent: 'All current',
  noneInProgress: 'None in progress',
  noStaffMatch: 'No staff match',
  noDocuments: 'No documents',
  noTrainings: 'No required trainings yet',
  noChecklist: 'No onboarding or offboarding checklist',
  noCorrective: 'No corrective action on file',
} as const;

export const CREDENTIALING_TABS = [
  'Expirations',
  'Exclusion checks',
  'Credential registry',
  'Payer enrollment',
] as const;

export const TIME_OFF_TABS = ['Requests', 'Calendar', 'Balances'] as const;

export const ORG_CHART_TABS = ['Directory', 'Org chart', 'Headcount & turnover'] as const;

export const PEOPLE_FILTERS = [
  'Active',
  'Onboarding',
  'On Leave',
  'Offboarding',
  'Terminated',
  'Former staff',
] as const;

export const EMPLOYEE_RECORD_TABS = [
  'Overview',
  'Compensation',
  'Credentials',
  'Documents',
  'Training',
  'Time off',
  'Performance',
  'Onboarding',
  'Corrective action',
  'Altrixs account',
] as const;
