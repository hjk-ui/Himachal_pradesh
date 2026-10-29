/** Centralized public marketing copy — Oct 26 EHR positioning. Product wording avoids CRM except the outreach module label. */

export const DEFAULT_TITLE = 'Altrixs | Behavioral Health EHR';
export const DEFAULT_DESCRIPTION =
  'Altrixs is a behavioral health EHR with integrated primary care, billing, telehealth and practice operations.';

export const HOME_TITLE =
  'Altrixs | Behavioral Health EHR with Primary Care, Billing & Telehealth';
export const HOME_DESCRIPTION =
  'Altrixs is a behavioral health EHR for mental health and substance use clinics: AI Scribe, e-prescribing, telehealth, billing, Part 2 and primary care in one chart.';

export const HOME_KEYWORDS = [
  'behavioral health EHR',
  'mental health EHR',
  'SUD EHR',
  '42 CFR Part 2 EHR',
  'psychiatry EHR with e-prescribing',
  'AI scribe for therapists',
  'integrated BH + PC EHR',
  'PRP documentation',
  'BH billing',
  'telehealth for MH clinics',
  'measurement-based care',
  'Altrixs',
] as const;

export const HERO = {
  kicker: 'Behavioral health EHR',
  headline: 'The behavioral health EHR with primary care, billing and practice operations built in.',
  subhead:
    'One chart and one schedule for therapists, prescribers, program staff and the front desk. Write notes faster with an AI Scribe that checks its work, prescribe from the chart, and get claims paid.',
  chips: [
    'AI Scribe in English and Spanish',
    'E-prescribing with EPCS',
    'Built-in telehealth',
    'Claims, ERA and eligibility',
    '42 CFR Part 2 controls',
  ] as const,
  primaryCta: { label: 'Start free trial', href: '/get-started' },
  secondaryCta: {
    label: 'Request a demo',
    href: 'mailto:support@altrixs.com?subject=Altrixs%20demo%20request',
  },
} as const;

export const NAV = [
  { label: 'Platform', href: '#platform' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Sign in', href: '/login' },
  { label: 'Get started', href: '/get-started' },
] as const;

export const SECTION_KICKERS = {
  who: "Who it's for",
  platform: 'Platform',
  why: 'Why Altrixs',
  security: 'Security and privacy',
  faq: 'FAQ',
  contact: 'See Altrixs with your own workflows',
} as const;

/** Only this module may use the word CRM on the public site. */
export const COMMUNITY_MODULE_LABEL = 'Community and outreach CRM';

export const GO_LIVE_COPY = 'Most practices go live in 2–4 weeks';

export const MIGRATION_FROM = 'your current EHR';

export const PRICING_TITLE = 'Pricing | Altrixs Behavioral Health EHR';

export const GET_STARTED = {
  title: 'Start your free trial',
  subcopy:
    'Open your behavioral health EHR workspace — notes, schedule, telehealth and billing in one place.',
  trust:
    'Role-based access, two-factor sign-in and audit logging protect your clinic. A Business Associate Agreement is presented at registration.',
} as const;

export const PARTNERS = [
  { name: 'DrFirst', detail: 'e-prescribing & EPCS' },
  { name: 'Waystar', detail: 'claims & remittance' },
  { name: 'Amazon Web Services', detail: 'hosting & AI, under a BAA' },
] as const;

export const PARTNER_STRIP_H2 = 'Integrated with';
export const PARTNER_TRADEMARK =
  'DrFirst, Rcopia, Waystar and AWS are trademarks of their respective owners.';
