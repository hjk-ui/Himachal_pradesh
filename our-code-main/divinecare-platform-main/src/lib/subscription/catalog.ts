export type SubscriptionPlanId = 'free' | 'solo' | 'professional' | 'practice' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';

export type PlanDefinition = {
  id: SubscriptionPlanId;
  name: string;
  tagline: string;
  monthly: number;
  annualMonthly: number;
  annualSavings: number;
  extraClinicianPrice: number | null;
  activeClientLimit: number;
  clinicianLimit: number;
  aiNotesLimit: number;
  invoiceLimit: number;
  insurancePanelLimit: number;
  selfScheduling: boolean;
  outcomeMeasures: boolean;
  autopay: boolean;
  prioritySupport: boolean;
  contactSales?: boolean;
  public?: boolean;
  popular?: boolean;
  accent: string;
  accentSoft: string;
  buttonClass: string;
  highlightBox: string;
  features: string[];
};

export type AddOnDefinition = {
  id: string;
  name: string;
  detail: string;
  price: string;
};

export type FeatureCompareRow = {
  group?: string;
  feature: string;
  solo: string;
  practice: string;
  enterprise: string;
};

/** Legacy `growth` maps to `professional` in normalizePlanId. Kept for existing orgs / Stripe env aliases. */
export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Internal / legacy trial — not on the public price sheet.',
    monthly: 0,
    annualMonthly: 0,
    annualSavings: 0,
    extraClinicianPrice: null,
    activeClientLimit: 5,
    clinicianLimit: 1,
    aiNotesLimit: 0,
    invoiceLimit: 5,
    insurancePanelLimit: 0,
    selfScheduling: true,
    outcomeMeasures: false,
    autopay: false,
    prioritySupport: false,
    public: false,
    accent: '#64748B',
    accentSoft: '#F1F5F9',
    buttonClass: 'bg-slate-200 text-slate-600 cursor-default',
    highlightBox: 'bg-slate-100 text-slate-700',
    features: ['5 active clients', 'Progress notes', 'HIPAA audit log'],
  },
  solo: {
    id: 'solo',
    name: 'Solo',
    tagline:
      'For independent clinicians. A complete EHR with telehealth and a native client app — everything you need to run a private practice.',
    monthly: 89,
    annualMonthly: 89,
    annualSavings: 0,
    extraClinicianPrice: null,
    activeClientLimit: Infinity,
    clinicianLimit: 1,
    aiNotesLimit: 0,
    invoiceLimit: Infinity,
    insurancePanelLimit: 0,
    selfScheduling: true,
    outcomeMeasures: true,
    autopay: true,
    prioritySupport: false,
    public: true,
    accent: '#7C3AED',
    accentSoft: '#EDE9FE',
    buttonClass: 'bg-violet-600 text-white hover:bg-violet-700',
    highlightBox: 'bg-violet-50 text-violet-800',
    features: [
      'Progress notes (SOAP / DAP / BIRP)',
      'Treatment plans + Goal Bank',
      'PHQ-9, GAD-7, AUDIT, DAST, PCL-5',
      'ICD-10 diagnoses with AI suggestions',
      'Consent forms + e-signature',
      'Crisis Safety Planning',
      'Calendar + appointment scheduling',
      'HIPAA-compliant video (Chime SDK)',
      'Secure encrypted messaging',
      'Daily mood check-ins',
      'Coping tools library',
      'Medication reminders',
      'Self-report assessments',
      'Superbill generation (self-pay / OON)',
      'Insurance eligibility checks',
    ],
  },
  /** Hidden legacy plan — Stripe STRIPE_PROFESSIONAL_* / GROWTH_* still map here. */
  professional: {
    id: 'professional',
    name: 'Professional',
    tagline: 'Legacy plan — replaced by Practice on the public price sheet.',
    monthly: 99,
    annualMonthly: 79,
    annualSavings: 240,
    extraClinicianPrice: null,
    activeClientLimit: Infinity,
    clinicianLimit: 1,
    aiNotesLimit: Infinity,
    invoiceLimit: Infinity,
    insurancePanelLimit: Infinity,
    selfScheduling: true,
    outcomeMeasures: true,
    autopay: true,
    prioritySupport: true,
    public: false,
    accent: '#0D9488',
    accentSoft: '#CCFBF1',
    buttonClass: 'bg-teal-600 text-white hover:bg-teal-700',
    highlightBox: 'bg-teal-50 text-teal-800',
    features: ['Legacy Professional — contact us to move to Practice or Enterprise'],
  },
  practice: {
    id: 'practice',
    name: 'Practice',
    tagline:
      'For group practices. Adds full insurance billing, AI Clinical Scribe, and HR tools. At 5 clinicians, costs less than hiring a billing coordinator.',
    monthly: 219,
    annualMonthly: 219,
    annualSavings: 0,
    extraClinicianPrice: 69,
    activeClientLimit: Infinity,
    clinicianLimit: 2,
    aiNotesLimit: 150,
    invoiceLimit: Infinity,
    insurancePanelLimit: Infinity,
    selfScheduling: true,
    outcomeMeasures: true,
    autopay: true,
    prioritySupport: false,
    public: true,
    popular: true,
    accent: '#0D9488',
    accentSoft: '#CCFBF1',
    buttonClass: 'bg-teal-600 text-white hover:bg-teal-700',
    highlightBox: 'bg-teal-50 text-teal-800',
    features: [
      'All Solo features included',
      'Claims submission (CMS-1500)',
      'ERA posting + payment reconciliation',
      'Denial management + appeal templates',
      'Patient statements',
      'AI Clinical Scribe (150 sessions/mo)',
      'Population Health',
      'SDOH Screening + Resource Directory',
      'Automated outcome measure scheduling',
      'Staff directory + credentialing',
      'Supervision log + hours tracking',
      'Discharge planning + follow-up tracker',
      'Prior authorization tracking',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline:
      'For CARF-accredited outpatient centers, PRP providers, and multi-program practices. Replaces $3,000+ per month in consultant and software costs.',
    monthly: 449,
    annualMonthly: 449,
    annualSavings: 0,
    extraClinicianPrice: 89,
    activeClientLimit: Infinity,
    clinicianLimit: 3,
    aiNotesLimit: Infinity,
    invoiceLimit: Infinity,
    insurancePanelLimit: Infinity,
    selfScheduling: true,
    outcomeMeasures: true,
    autopay: true,
    prioritySupport: true,
    public: true,
    contactSales: true,
    accent: '#D97706',
    accentSoft: '#FEF3C7',
    buttonClass: 'bg-amber-600 text-white hover:bg-amber-700',
    highlightBox: 'bg-amber-50 text-amber-900',
    features: [
      'All Practice features included',
      'Unlimited AI Scribe sessions',
      'QI Program — 12 indicators + CAP tracker',
      'QI Committee meeting log',
      'Incident Reporting + root cause analysis',
      'Complaint & Grievance tracking',
      'Compliance Calendar + Readiness Score',
      'Peer Support (CPRS documentation)',
      'PRP billing (H2017 / COMAR Maryland)',
      'Staff Training Hub + competency matrix',
      'Community Events & Outreach',
      'PR & Marketing module',
      'Onboarding assistance (up to 8 hrs)',
      'CARF survey prep consultation',
      'Custom BAA + service agreement',
      'Priority 4-hour support response',
    ],
  },
};

/** Public catalog (PDF). Free + Professional stay in SUBSCRIPTION_PLANS for existing orgs. */
export const PLAN_ORDER: SubscriptionPlanId[] = ['solo', 'practice', 'enterprise'];

export const ADD_ONS: AddOnDefinition[] = [
  {
    id: 'erx',
    name: 'E-Prescribing (DrFirst Rcopia)',
    detail: 'Per prescriber. Includes PDMP check + EPCS for controlled substances.',
    price: '$35/prescriber/mo',
  },
  {
    id: 'scribe',
    name: 'Extra AI Scribe Sessions',
    detail: 'For Practice plans that exceed 150 sessions/month.',
    price: '$1.50/session',
  },
  {
    id: 'onboarding',
    name: 'Priority Onboarding & Training',
    detail: '4-hour live setup session with screen-share staff walkthrough.',
    price: '$299 one-time',
  },
  {
    id: 'carf',
    name: 'CARF Survey Prep Consultation',
    detail: '8-hour advisory engagement — evidence binder review, mock Q&A, gap plan.',
    price: '$499 one-time',
  },
];

export const FEATURE_COMPARISON: FeatureCompareRow[] = [
  { group: 'Clinical EHR', feature: 'Progress notes, treatment plans, assessments', solo: '✓', practice: '✓', enterprise: '✓' },
  { feature: 'ICD-10 diagnoses, consent forms, e-signature', solo: '✓', practice: '✓', enterprise: '✓' },
  { feature: 'Crisis Safety Planning (Stanley-Brown)', solo: '✓', practice: '✓', enterprise: '✓' },
  { feature: 'Telehealth (HIPAA-compliant video)', solo: '✓', practice: '✓', enterprise: '✓' },
  { feature: 'Secure messaging', solo: '✓', practice: '✓', enterprise: '✓' },
  { feature: 'Client iOS + Android app', solo: '✓', practice: '✓', enterprise: '✓' },
  { feature: 'Insurance eligibility verification', solo: '✓', practice: '✓', enterprise: '✓' },
  { group: 'Billing & operations', feature: 'Superbill / self-pay invoices', solo: '✓', practice: '✓', enterprise: '✓' },
  { feature: 'Insurance claims + ERA posting', solo: '—', practice: '✓', enterprise: '✓' },
  { feature: 'Denial management', solo: '—', practice: '✓', enterprise: '✓' },
  { feature: 'HR, credentialing, supervision logs', solo: '—', practice: '✓', enterprise: '✓' },
  { feature: 'E-Prescribing (DrFirst)', solo: 'Add-on', practice: 'Add-on', enterprise: 'Add-on' },
  { group: 'AI & analytics', feature: 'AI Clinical Scribe', solo: '—', practice: '150 sessions/mo', enterprise: '✓ Unlimited' },
  { feature: 'Population Health Command Center', solo: '—', practice: '✓', enterprise: '✓' },
  { feature: 'SDOH Screening + Resource Directory', solo: '—', practice: '✓', enterprise: '✓' },
  { group: 'CARF & compliance', feature: 'QI Program + CAP Tracker', solo: '—', practice: '—', enterprise: '✓' },
];

export function formatLimit(limit: number) {
  return Number.isFinite(limit) ? String(limit) : 'Unlimited';
}

export function normalizePlanId(raw: string | undefined | null): SubscriptionPlanId {
  if (raw === 'growth') return 'professional';
  if (raw && raw in SUBSCRIPTION_PLANS) return raw as SubscriptionPlanId;
  return 'free';
}

export function clientsLabel(plan: PlanDefinition) {
  return plan.activeClientLimit === Infinity
    ? 'Unlimited clients'
    : `${plan.activeClientLimit} clients`;
}

export function cliniciansLabel(plan: PlanDefinition) {
  if (plan.extraClinicianPrice) {
    return `Base includes ${plan.clinicianLimit} clinicians · +$${plan.extraClinicianPrice} per additional`;
  }
  if (plan.clinicianLimit === 1) return '1 clinician · flat rate';
  return `Up to ${plan.clinicianLimit} clinicians`;
}

export type CompetitorRow = {
  platform: string;
  entry: string;
  mid: string;
  aiNotes: string;
  outcomeMeasures: string;
  telehealth: string;
  highlight?: boolean;
};

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

export type SubscriptionPageContent = {
  version: 1;
  subtitle: string;
  compareNote: string;
  competitors: CompetitorRow[];
  faqs: FaqItem[];
  enterprise: {
    title: string;
    description: string;
    ctaLabel: string;
    ctaHref: string;
  };
};

export const SUBSCRIPTION_PAGE_SEED: SubscriptionPageContent = {
  version: 1,
  subtitle:
    'Simple, transparent pricing for every practice size. Everything you need to run a modern behavioral health practice — EHR, telehealth, AI scribe, billing, and CARF compliance — in one platform. No hidden fees.',
  compareNote:
    'Public prices are monthly. Extra clinicians: Practice +$69, Enterprise +$89. Displayed amounts follow the Altrixs pricing sheet; Stripe Price IDs are configured separately.',
  competitors: [
    {
      platform: 'SimplePractice',
      entry: '$29–$69',
      mid: '$99+',
      aiNotes: '—',
      outcomeMeasures: '+$10/mo',
      telehealth: 'Included',
    },
    {
      platform: 'TherapyNotes',
      entry: '$49–$69',
      mid: '$99',
      aiNotes: '—',
      outcomeMeasures: '—',
      telehealth: 'Included',
    },
    {
      platform: 'TheraNest',
      entry: '$39–$59',
      mid: '$89',
      aiNotes: '—',
      outcomeMeasures: '+add-on',
      telehealth: 'Included',
    },
    {
      platform: 'Jane App',
      entry: '$54–$89',
      mid: '$109',
      aiNotes: '—',
      outcomeMeasures: '—',
      telehealth: 'Included',
    },
    {
      platform: 'Eleos Health',
      entry: 'Custom',
      mid: 'Custom',
      aiNotes: '~$300+/mo',
      outcomeMeasures: 'Add-on',
      telehealth: 'Partner',
    },
    {
      platform: 'Altrixs',
      entry: '$89 Solo',
      mid: '$219+ Practice',
      aiNotes: '150/mo on Practice · Unlimited on Enterprise',
      outcomeMeasures: 'Included',
      telehealth: 'Included',
      highlight: true,
    },
  ],
  faqs: [
    {
      id: 'faq-hipaa',
      question: 'Is my data HIPAA-compliant?',
      answer:
        'Yes. Altrixs runs on AWS infrastructure covered by a Business Associate Agreement (BAA). All PHI is encrypted in transit (TLS) and at rest (AES-256). Audit logs are retained for 6 years per HIPAA requirements.',
    },
    {
      id: 'faq-ai',
      question: 'How does the AI Clinical Scribe work?',
      answer:
        'AI Clinical Scribe is included on Practice (150 sessions/month) and unlimited on Enterprise. Extra Practice sessions are $1.50 each. Solo does not include AI Scribe.',
    },
    {
      id: 'faq-claims',
      question: 'Does Solo include insurance claims?',
      answer:
        'No. Solo includes superbills (self-pay / out-of-network) and insurance eligibility checks. CMS-1500 claims, ERA posting, denials, and patient statements start on Practice.',
    },
    {
      id: 'faq-clinicians',
      question: 'How do extra clinicians work?',
      answer:
        'Solo is 1 clinician at a flat $89/month. Practice is $219/month for 2 clinicians, then +$69 per additional clinician. Enterprise is $449/month for 3 clinicians, then +$89 per additional clinician.',
    },
    {
      id: 'faq-addons',
      question: 'What add-ons are available?',
      answer:
        'E-Prescribing (DrFirst Rcopia) is $35/prescriber/month on any plan. Extra AI Scribe sessions are $1.50 each after Practice’s 150. Priority onboarding & training is $299 one-time. CARF survey prep consultation is $499 one-time.',
    },
    {
      id: 'faq-cancel',
      question: 'Can I cancel anytime?',
      answer:
        'Yes. Cancellations take effect at the end of your current billing cycle. Your data is retained in read-only mode for 90 days after cancellation.',
    },
  ],
  enterprise: {
    title: 'Enterprise',
    description: 'Base includes 3 clinicians · +$89 per additional · CARF / PRP / dedicated support',
    ctaLabel: 'Contact us',
    ctaHref: 'mailto:sales@altrixs.io?subject=Enterprise%20pricing',
  },
};
