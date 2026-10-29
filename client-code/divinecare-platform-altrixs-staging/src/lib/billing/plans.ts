/**
 * Altrixs plans, prices, seat types, features and add-ons — the ONE source of truth.
 *
 * The homepage pricing section, /pricing, /get-started, /dashboard/subscription, the quote
 * calculator, the Stripe catalog (src/lib/stripe/catalog.ts), Checkout, the webhook and the
 * entitlement checks all read from this file. Do not hard-code prices anywhere else.
 *
 * Client-safe: no Prisma, no server-only imports (rendered by 'use client' pages).
 *
 * PRICING STATUS: model v2 (docs/pricing-model.md, research in docs/pricing-research.md) was APPROVED
 * by the owner on 2026-10-20 (via chat); see PRICING_APPROVAL. Going live is still a deploy switch:
 * until NEXT_PUBLIC_PRICING_APPROVED=true is set, every surface keeps the "Proposed pricing" notice
 * and live-mode Stripe Checkout is refused. Set it after the Stripe catalog is synced and tested.
 *
 * Model v2 in one paragraph: priced per active clinical seat per month. Prescribers (psychiatrist,
 * NP, physician) cost more than other clinicians because e-prescribing with EPCS and PDMP is built
 * into their seat. Program staff (PRP, case management, peer support, medical assistants, crisis)
 * are lower-cost paraprofessional seats. Front desk, billing, HR, office manager, director and admin
 * accounts are free. Tiers add capability. AI Scribe is per scribe user. Claims, ERA and
 * eligibility are included up to a pooled allowance per seat, then charged per claim.
 */

export type TierId = 'starter' | 'professional' | 'clinic' | 'enterprise';
export type SelfServeTierId = Exclude<TierId, 'enterprise'>;
export type BillingInterval = 'month' | 'year';
export type AddOnId = 'ai_scribe' | 'additional_location' | 'billing_service' | 'onboarding' | 'data_migration';

/** Version of the price model. Stripe lookup keys carry it so a new model never reuses old prices. */
export const PRICING_MODEL_VERSION = 'v2';

/** Owner approval of model v2 (recorded in docs/pricing-model.md). */
export const PRICING_APPROVAL = {
  model: PRICING_MODEL_VERSION,
  approvedBy: 'owner',
  approvedOn: '2026-10-20',
  via: 'chat',
} as const;

/**
 * Whether the approved prices are live on public surfaces and for live-mode Checkout. Inlined at
 * build time. The owner approved the numbers (PRICING_APPROVAL); this switch is turned on at deploy
 * once the Stripe catalog is synced and tested.
 */
export function pricingApproved(): boolean {
  return process.env.NEXT_PUBLIC_PRICING_APPROVED === 'true';
}

export const PRICING_STATUS_LABEL = 'Proposed pricing — owner approval required';
export const PRICING_PUBLIC_NOTICE =
  'Pricing shown is proposed and may change before general availability. Contact us for a written quote.';
/** Label for any estimate computed from an organization's own seats, before pricing goes live. */
export const ESTIMATE_NOT_BILLED_LABEL = 'Proposed pricing estimate — not billed';
/** Label for the same estimate once pricing is live. */
export const ESTIMATE_LIST_PRICE_LABEL = 'Estimate at list price';

/** "Proposed, not billed" until pricing is live; then a plain list-price estimate label. */
export function estimateLabel(): string {
  return pricingApproved() ? ESTIMATE_LIST_PRICE_LABEL : ESTIMATE_NOT_BILLED_LABEL;
}

/** Where "Contact sales" goes. support@altrixs.com is the address already published on /support. */
/** Implementation timeline used everywhere the public site discusses go-live (owner 2026-10-26). */
export const GO_LIVE_TIMELINE = 'Most practices go live in 2–4 weeks';

export const SALES_CONTACT_HREF = 'mailto:support@altrixs.com?subject=Altrixs%20pricing%20and%20Enterprise%20quote';

/** Free trial length for self-serve tiers (Starter, Professional, Clinic). */
export const TRIAL_DAYS = 30;
/** AI Scribe session-audio minutes included in the free trial, per organization (owner decision 2026-10-20). */
export const TRIAL_AI_SCRIBE_MINUTES = 300;
/** After a failed renewal payment the clinic keeps full access for this many days. */
export const PAST_DUE_GRACE_DAYS = 14;
/** After cancellation / trial end, data stays available read-only (and exportable) for this long. */
export const READ_ONLY_RETENTION_DAYS = 90;
/** Annual prepay discount on every recurring price (seats and recurring add-ons). */
export const ANNUAL_DISCOUNT_PERCENT = 15;
/** Per claim above the pooled monthly allowance. Covers the claim's 837P, 277 status, ERA posting and its eligibility check. */
export const CLAIM_OVERAGE_PER_CLAIM = 0.3;
/** Above this many provider seats (prescribers + clinicians) we recommend an Enterprise agreement. */
export const ENTERPRISE_RECOMMENDED_PROVIDER_SEATS = 75;

/** Volume discount on seat charges, by provider seats (prescribers + clinicians). Highest matching row wins. */
export const VOLUME_DISCOUNTS: readonly { minProviderSeats: number; percent: number }[] = [
  { minProviderSeats: 25, percent: 5 },
  { minProviderSeats: 50, percent: 10 },
];

/** Annual price per month = monthly price less the annual discount, rounded to whole dollars. */
export function annualFromMonthly(monthly: number): number {
  return Math.round(monthly * (1 - ANNUAL_DISCOUNT_PERCENT / 100));
}

function price(monthly: number): { month: number; year: number } {
  return { month: monthly, year: annualFromMonthly(monthly) };
}

// ---------------------------------------------------------------------------
// Seat types and the role → seat mapping (counting is in seats.ts).
// ---------------------------------------------------------------------------

export type SeatType = 'prescriber' | 'clinician' | 'paraprofessional' | 'support';
export type BillableSeatType = Exclude<SeatType, 'support'>;

/** Most expensive first: a user with several roles is billed once, at the first matching type. */
export const SEAT_TYPE_ORDER: SeatType[] = ['prescriber', 'clinician', 'paraprofessional', 'support'];
export const BILLABLE_SEAT_TYPES: BillableSeatType[] = ['prescriber', 'clinician', 'paraprofessional'];
/** Seat types that count toward provider-seat limits, volume discounts and the Enterprise threshold. */
export const PROVIDER_SEAT_TYPES: BillableSeatType[] = ['prescriber', 'clinician'];

export type SeatTypeDefinition = {
  id: SeatType;
  name: string;
  plural: string;
  /** StaffRole values (prisma enum Role) that map to this seat type. */
  roles: readonly string[];
  explain: string;
};

export const SEAT_TYPES: Record<SeatType, SeatTypeDefinition> = {
  prescriber: {
    id: 'prescriber',
    name: 'Prescriber',
    plural: 'Prescribers',
    roles: ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'],
    explain:
      'Psychiatrists, nurse practitioners and physicians. Includes e-prescribing with EPCS (DrFirst Rcopia), PDMP checks and medication history.',
  },
  clinician: {
    id: 'clinician',
    name: 'Clinician',
    plural: 'Clinicians',
    roles: ['THERAPIST', 'CLINICIAN'],
    explain: 'Therapists, counselors, social workers and psychologists who see clients but do not prescribe.',
  },
  paraprofessional: {
    id: 'paraprofessional',
    name: 'Program staff',
    plural: 'Program staff',
    roles: ['PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'MEDICAL_ASSISTANT', 'CRISIS_RESPONDER'],
    explain:
      'PRP specialists, case managers, peer support, medical assistants and crisis staff. Lower-cost seat with documentation, scheduling and program tools.',
  },
  support: {
    id: 'support',
    name: 'Support staff',
    plural: 'Support staff',
    roles: ['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK', 'BILLING', 'HR'],
    explain: 'Front desk, billing, HR, office managers, directors and admins. Always free, unlimited.',
  },
};

/** Platform accounts that are never counted at all (Altrixs staff). */
export const NON_COUNTED_ROLES: readonly string[] = ['SUPER_ADMIN'];

/** Map one StaffRole to its seat type. Unknown roles are treated as free support accounts. */
export function seatTypeForRole(role: string | null | undefined): SeatType {
  const r = (role || '').toUpperCase();
  for (const type of SEAT_TYPE_ORDER) {
    if (SEAT_TYPES[type].roles.includes(r)) return type;
  }
  return 'support';
}

export type SeatQuantities = Record<BillableSeatType, number>;

export function emptySeats(): SeatQuantities {
  return { prescriber: 0, clinician: 0, paraprofessional: 0 };
}

export function providerSeatsOf(seats: Partial<SeatQuantities>): number {
  return PROVIDER_SEAT_TYPES.reduce((n, t) => n + Math.max(0, Math.floor(seats[t] || 0)), 0);
}

export function billableSeatsOf(seats: Partial<SeatQuantities>): number {
  return BILLABLE_SEAT_TYPES.reduce((n, t) => n + Math.max(0, Math.floor(seats[t] || 0)), 0);
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export type TierDefinition = {
  id: TierId;
  name: string;
  /** Who it is for, in one plain sentence. */
  audience: string;
  /** Short plain-language summary shown on cards. */
  summary: string;
  /** Price per seat per month by seat type (USD whole dollars). `year` = per month when paid annually. null = quote. */
  seatPrices: Record<BillableSeatType, { month: number; year: number }> | null;
  /** Floor on the recurring monthly charge (USD). null = quoted. */
  minimumMonthly: number | null;
  /** Maximum provider seats (prescribers + clinicians). null = no cap. */
  maxProviderSeats: number | null;
  /** Locations included. null = unlimited. */
  includedLocations: number | null;
  /** Can more locations be bought as an add-on on this tier? */
  extraLocationsAvailable: boolean;
  /** Claims included per paid seat per month, pooled across the organization. null = contract. */
  claimsPerSeat: number | null;
  /** One-time onboarding (USD). null = quoted. */
  onboardingFee: number | null;
  /** One-time onboarding per location beyond the first (USD). */
  onboardingPerExtraLocation: number;
  /** One-time data migration from one prior system (USD). null = quoted. */
  dataMigrationFee: number | null;
  onboardingIncludes: string;
  dataMigrationIncludes: string;
  supportLevel: string;
  sla: string | null;
  selfServe: boolean;
  popular?: boolean;
  /** 3–6 headline bullets for cards; the matrix carries the full detail. */
  highlights: string[];
};

export const TIERS: Record<TierId, TierDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    audience: 'Solo and small practices, up to 5 providers at one location.',
    summary:
      'Everything a small practice needs to see clients, document, prescribe, get paid by insurance and run telehealth.',
    seatPrices: {
      prescriber: price(249),
      clinician: price(99),
      paraprofessional: price(39),
    },
    minimumMonthly: 99,
    maxProviderSeats: 5,
    includedLocations: 1,
    extraLocationsAvailable: false,
    claimsPerSeat: 50,
    onboardingFee: 0,
    onboardingPerExtraLocation: 0,
    dataMigrationFee: 0,
    onboardingIncludes: 'Self-guided setup wizard, help center and a live group onboarding webinar.',
    dataMigrationIncludes: 'Self-serve client and appointment import from CSV. Assisted migration available at the Professional rate.',
    supportLevel: 'Email and in-app support, next business day',
    sla: null,
    selfServe: true,
    highlights: [
      'Up to 5 providers, 1 location',
      'Prescriber seats include e-prescribing with EPCS',
      'Scheduling, client portal and telehealth',
      'Claims, ERA and eligibility through Waystar (50 claims per seat per month included)',
      'Front desk and billing staff free',
    ],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    audience: 'Group practices with a front desk, several clinicians and up to two sites.',
    summary:
      'Adds team scheduling, supervision, claim scrubbing, denials and prior authorizations, practice reports, HR and AI clinical insights.',
    seatPrices: {
      prescriber: price(299),
      clinician: price(139),
      paraprofessional: price(49),
    },
    minimumMonthly: 499,
    maxProviderSeats: null,
    includedLocations: 2,
    extraLocationsAvailable: true,
    claimsPerSeat: 150,
    onboardingFee: 1500,
    onboardingPerExtraLocation: 500,
    dataMigrationFee: 1500,
    onboardingIncludes:
      'Guided implementation: fee schedule and payer setup, Waystar enrollment support, role setup and two live training sessions.',
    dataMigrationIncludes:
      'Client demographics, insurance, open balances and future appointments from one prior system.',
    supportLevel: 'Email, chat and phone support, business hours',
    sla: null,
    selfServe: true,
    popular: true,
    highlights: [
      'Everything in Starter, unlimited providers',
      '2 locations included',
      'Claim scrubber, denials and prior-auth tracking',
      'Supervision, co-signature and practice reports',
      'AI clinical insights and service eligibility scanner',
    ],
  },
  clinic: {
    id: 'clinic',
    name: 'Clinic',
    audience: 'Multi-site behavioral health and primary care clinics, and program providers (PRP, IOP, residential, AOT).',
    summary:
      'Adds unlimited locations, program tools, primary care charting, 42 CFR Part 2, QI and compliance, priority support and an uptime target.',
    seatPrices: {
      prescriber: price(349),
      clinician: price(179),
      paraprofessional: price(59),
    },
    minimumMonthly: 1500,
    maxProviderSeats: null,
    includedLocations: null,
    extraLocationsAvailable: false,
    claimsPerSeat: 200,
    onboardingFee: 4000,
    onboardingPerExtraLocation: 750,
    dataMigrationFee: 3500,
    onboardingIncludes:
      'Implementation project with a named specialist, workflow design per site, role-based training, go-live support on site or remote.',
    dataMigrationIncludes:
      'Assisted migration from your current EHR (one source system), typically demographics, insurance, balances, appointments, treatment plans, authorizations and documents, with our team supporting you through the move.',
    supportLevel: 'Priority phone and chat support with a named onboarding specialist',
    sla: '99.5% monthly uptime target; 4 business-hour response on urgent tickets',
    selfServe: true,
    highlights: [
      'Everything in Professional',
      'Unlimited locations',
      'PRP, IOP, residential and AOT program tools',
      'Primary care chart, labs and medical billing',
      'Part 2 consent and segmentation, QI, incidents, grievances',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    audience: `CCBHCs, health systems and organizations with ${ENTERPRISE_RECOMMENDED_PROVIDER_SEATS}+ providers.`,
    summary:
      'Everything in Clinic plus volume pricing, custom contract terms, integrations, a dedicated success manager and a written SLA. Quoted per organization.',
    seatPrices: null,
    minimumMonthly: null,
    maxProviderSeats: null,
    includedLocations: null,
    extraLocationsAvailable: false,
    claimsPerSeat: null,
    onboardingFee: null,
    onboardingPerExtraLocation: 0,
    dataMigrationFee: null,
    onboardingIncludes: 'Scoped implementation, multi-system data migration and custom integrations (quoted).',
    dataMigrationIncludes: 'Scoped per source system.',
    supportLevel: 'Dedicated customer success manager, 24/7 urgent line',
    sla: 'Contractual uptime SLA with service credits (negotiated)',
    selfServe: false,
    highlights: [
      'Everything in Clinic',
      'Volume seat pricing and annual contract',
      'Custom integrations, HIE and data exports',
      'Dedicated success manager and contractual SLA',
      'Custom BAA and security review',
    ],
  },
};

export const TIER_ORDER: TierId[] = ['starter', 'professional', 'clinic', 'enterprise'];
export const SELF_SERVE_TIERS = TIER_ORDER.filter((id) => TIERS[id].selfServe) as SelfServeTierId[];

export function isTierId(value: unknown): value is TierId {
  return typeof value === 'string' && (TIER_ORDER as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------

export type AddOnDefinition = {
  id: AddOnId;
  name: string;
  description: string;
  kind: 'recurring' | 'one_time' | 'service';
  /** Recurring USD per unit per month (monthly billing). null = not recurring or quoted. */
  monthlyPerUnit: number | null;
  /** Recurring USD per unit per month when billed annually. */
  annualPerUnitPerMonth: number | null;
  /** Plain-language unit. */
  unit: string;
  /** Which tiers can buy it (tiers where it is included are not listed here). */
  availableOn: TierId[];
  includedOn: TierId[];
  note?: string;
};

/** AI Scribe ambient-audio allowance per scribe user per month, pooled across the organization. */
export const AI_SCRIBE_INCLUDED_MINUTES = 2500;
/** Per ambient minute above the pooled allowance. */
export const AI_SCRIBE_OVERAGE_PER_MINUTE = 0.08;
/** Full billing service (RCM): percent of net collections, and its monthly minimum. */
export const BILLING_SERVICE_PERCENT = 5;
export const BILLING_SERVICE_MINIMUM_MONTHLY = 750;

/**
 * The full billing service is kept in code but NOT offered publicly (owner decision 2026-10-20:
 * Altrixs has no billing staff yet). While off it is hidden from the pricing page add-ons and the
 * quote math, and the FAQ says "available on request". Turn on with NEXT_PUBLIC_BILLING_SERVICE_OFFERED=true.
 */
export function billingServiceOffered(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_SERVICE_OFFERED === 'true';
}

export const ADD_ONS: Record<AddOnId, AddOnDefinition> = {
  ai_scribe: {
    id: 'ai_scribe',
    name: 'AI Scribe',
    description:
      'Ambient documentation: drafts the progress note from the in-person or telehealth session (or from dictation) for the clinician to review and sign. Client consent is captured first.',
    kind: 'recurring',
    monthlyPerUnit: 149,
    annualPerUnitPerMonth: annualFromMonthly(149),
    unit: 'per scribe user per month',
    availableOn: ['starter', 'professional', 'clinic', 'enterprise'],
    includedOn: [],
    note: `Buy it only for the clinicians who use it. Includes ${AI_SCRIBE_INCLUDED_MINUTES.toLocaleString('en-US')} minutes of session audio per scribe user per month, pooled across your organization; dictation and pasted text do not use minutes.`,
  },
  additional_location: {
    id: 'additional_location',
    name: 'Additional location',
    description: 'Another site with its own schedule, staff, service-facility NPI and reporting.',
    kind: 'recurring',
    monthlyPerUnit: 99,
    annualPerUnitPerMonth: annualFromMonthly(99),
    unit: 'per location per month',
    availableOn: ['professional'],
    includedOn: ['clinic', 'enterprise'],
    note: 'Professional includes 2 locations. Clinic and Enterprise include unlimited locations.',
  },
  billing_service: {
    id: 'billing_service',
    name: 'Full billing service (RCM)',
    description:
      'Our billing team works your claims end to end: charge review, submission, denials and appeals, payment posting and patient statements.',
    kind: 'service',
    monthlyPerUnit: null,
    annualPerUnitPerMonth: null,
    unit: `${BILLING_SERVICE_PERCENT}% of net collections, $${BILLING_SERVICE_MINIMUM_MONTHLY} monthly minimum`,
    availableOn: ['professional', 'clinic', 'enterprise'],
    includedOn: [],
    note: 'Quoted after a review of your payer mix. Software seats are billed separately.',
  },
  onboarding: {
    id: 'onboarding',
    name: 'Onboarding and training',
    description: 'One-time implementation fee by tier, plus a per-site fee for each location after the first.',
    kind: 'one_time',
    monthlyPerUnit: null,
    annualPerUnitPerMonth: null,
    unit: 'one-time',
    availableOn: ['starter', 'professional', 'clinic'],
    includedOn: [],
  },
  data_migration: {
    id: 'data_migration',
    name: 'Data migration',
    description:
      'One-time assisted migration from any EHR platform (one source system), with support available. Additional systems are quoted.',
    kind: 'one_time',
    monthlyPerUnit: null,
    annualPerUnitPerMonth: null,
    unit: 'one-time',
    availableOn: ['starter', 'professional', 'clinic'],
    includedOn: [],
  },
};

export const ADD_ON_ORDER: AddOnId[] = ['ai_scribe', 'additional_location', 'billing_service', 'onboarding', 'data_migration'];

/** Add-ons shown on pricing surfaces (the billing service only when offered). */
export function publicAddOnOrder(): AddOnId[] {
  return ADD_ON_ORDER.filter((id) => id !== 'billing_service' || billingServiceOffered());
}

// ---------------------------------------------------------------------------
// Features — each maps to real Altrixs screens / APIs (see `where`).
// ---------------------------------------------------------------------------

export type FeatureId =
  | 'scheduling'
  | 'client_portal'
  | 'telehealth'
  | 'reminders'
  | 'notes_templates'
  | 'treatment_plans'
  | 'assessments_mbc'
  | 'group_sessions'
  | 'secure_messaging'
  | 'eligibility'
  | 'claims_era'
  | 'patient_payments'
  | 'superbills_statements'
  | 'team_scheduling'
  | 'supervision'
  | 'denials_prior_auth'
  | 'reports_practice'
  | 'hr_credentialing'
  | 'ai_insights'
  | 'ai_scribe'
  | 'eprescribing'
  | 'multi_location'
  | 'programs'
  | 'primary_care'
  | 'part2_tools'
  | 'qi_compliance'
  | 'population_health'
  | 'audit_rbac'
  | 'custom_integrations';

export type Availability = 'included' | 'addon' | 'none';

export type FeatureDefinition = {
  id: FeatureId;
  group: 'Clinical care' | 'Client experience' | 'Billing and revenue' | 'Practice operations' | 'AI and prescribing' | 'Programs and compliance' | 'Security and support';
  name: string;
  /** Plain-language explanation for the comparison matrix. */
  explain: string;
  /** Where it lives in Altrixs (for staff and for audits of this catalog). */
  where: string;
  tiers: Record<TierId, Availability>;
  /** When availability is 'addon', the add-on that unlocks it. */
  addOn?: AddOnId;
  /** Optional per-tier qualifier shown under the check mark. */
  notes?: Partial<Record<TierId, string>>;
};

const ALL: Record<TierId, Availability> = {
  starter: 'included',
  professional: 'included',
  clinic: 'included',
  enterprise: 'included',
};
const FROM_PROFESSIONAL: Record<TierId, Availability> = {
  starter: 'none',
  professional: 'included',
  clinic: 'included',
  enterprise: 'included',
};
const FROM_CLINIC: Record<TierId, Availability> = {
  starter: 'none',
  professional: 'none',
  clinic: 'included',
  enterprise: 'included',
};

function claimsNote(tier: TierId): string {
  const n = TIERS[tier].claimsPerSeat;
  return n === null ? 'By contract' : `${n} claims / seat / mo`;
}

export const FEATURES: FeatureDefinition[] = [
  // Clinical care
  {
    id: 'notes_templates',
    group: 'Clinical care',
    name: 'Progress notes and templates',
    explain: 'SOAP, DAP, BIRP and custom note templates, smart phrases, co-signature and locking.',
    where: '/dashboard/ehr/notes, /dashboard/ehr/note-builder, /dashboard/ehr/smart-phrases',
    tiers: ALL,
  },
  {
    id: 'treatment_plans',
    group: 'Clinical care',
    name: 'Treatment plans, diagnoses and safety plans',
    explain: 'ICD-10 diagnoses, goal bank, treatment plan reviews and Stanley-Brown safety plans.',
    where: '/dashboard/ehr/treatment-plans, /dashboard/ehr/diagnoses, /dashboard/ehr/safety-plan',
    tiers: ALL,
  },
  {
    id: 'assessments_mbc',
    group: 'Clinical care',
    name: 'Assessments and measurement-based care',
    explain: 'PHQ-9, GAD-7, C-SSRS, PCL-5 and more, scored automatically and graphed over time.',
    where: '/dashboard/ehr/assessments, /dashboard/mbc',
    tiers: ALL,
  },
  {
    id: 'telehealth',
    group: 'Clinical care',
    name: 'Telehealth video',
    explain: 'HIPAA-covered in-app video sessions launched from the appointment; no separate subscription.',
    where: '/dashboard/telehealth',
    tiers: ALL,
  },
  {
    id: 'group_sessions',
    group: 'Clinical care',
    name: 'Group sessions',
    explain: 'Group rosters, attendance, one group note with per-member entries, and per-member claims.',
    where: '/dashboard/groups',
    tiers: FROM_PROFESSIONAL,
  },
  // Client experience
  {
    id: 'scheduling',
    group: 'Client experience',
    name: 'Scheduling and online booking',
    explain: 'Calendar, recurring appointments, waitlist and a public booking page.',
    where: '/dashboard/appointments, /book/[slug]',
    tiers: ALL,
  },
  {
    id: 'client_portal',
    group: 'Client experience',
    name: 'Client portal and mobile app',
    explain: 'Clients complete intake and consents, message the care team and join sessions.',
    where: '/patient, /intake',
    tiers: ALL,
  },
  {
    id: 'reminders',
    group: 'Client experience',
    name: 'Appointment reminders (email and text)',
    explain: 'Automatic reminders with no per-message charge under normal use.',
    where: '/dashboard/communications',
    tiers: ALL,
    notes: { starter: 'Fair use', professional: 'Fair use', clinic: 'Fair use' },
  },
  {
    id: 'secure_messaging',
    group: 'Client experience',
    name: 'Secure messaging',
    explain: 'Encrypted staff and client messaging with a unified staff inbox.',
    where: '/dashboard/messages, /dashboard/inbox',
    tiers: ALL,
  },
  // Billing and revenue
  {
    id: 'eligibility',
    group: 'Billing and revenue',
    name: 'Insurance eligibility checks',
    explain: '270/271 benefit checks before the visit, included with each claim.',
    where: '/dashboard/ehr/eligibility',
    tiers: ALL,
  },
  {
    id: 'claims_era',
    group: 'Billing and revenue',
    name: 'Electronic claims, claim status and ERA posting',
    explain: `837P claims through Waystar, 276/277 claim status and automatic 835 remittance posting. A pooled allowance per paid seat is included; above it each claim is $${CLAIM_OVERAGE_PER_CLAIM.toFixed(2)}.`,
    where: '/dashboard/billing/claims, /dashboard/billing/clearinghouse, /dashboard/billing/payments',
    tiers: ALL,
    notes: { starter: claimsNote('starter'), professional: claimsNote('professional'), clinic: claimsNote('clinic'), enterprise: claimsNote('enterprise') },
  },
  {
    id: 'patient_payments',
    group: 'Billing and revenue',
    name: 'Client payments and autopay',
    explain: 'Card on file, autopay and payment plans. Card processing fees are charged at cost by the processor.',
    where: '/dashboard/billing/autopay, /dashboard/billing/payments',
    tiers: ALL,
  },
  {
    id: 'superbills_statements',
    group: 'Billing and revenue',
    name: 'Superbills and client statements',
    explain: 'Out-of-network superbills and itemized client statements.',
    where: '/dashboard/billing/superbills, /dashboard/billing/statements',
    tiers: ALL,
  },
  {
    id: 'denials_prior_auth',
    group: 'Billing and revenue',
    name: 'Claim scrubber, denials and prior authorizations',
    explain: 'Catch claim errors before submission, work denials, and track authorizations and remaining units.',
    where: '/dashboard/billing/claim-scrubber, /dashboard/billing/denials, /dashboard/billing/authorizations',
    tiers: FROM_PROFESSIONAL,
  },
  // Practice operations
  {
    id: 'team_scheduling',
    group: 'Practice operations',
    name: 'Front desk and multi-clinician calendar',
    explain: 'Front-desk view across clinicians, caseload assignment and role-based dashboards.',
    where: '/dashboard/appointments, /dashboard/clients',
    tiers: FROM_PROFESSIONAL,
    notes: { starter: 'Basic' },
  },
  {
    id: 'supervision',
    group: 'Practice operations',
    name: 'Supervision and co-signature workflows',
    explain: 'Supervisor review queues, supervision logs and hours tracking for associates.',
    where: '/dashboard/ehr/supervisor-review, /dashboard/hr/supervision',
    tiers: FROM_PROFESSIONAL,
  },
  {
    id: 'reports_practice',
    group: 'Practice operations',
    name: 'Practice reports and report library',
    explain: 'Productivity, collections by provider, A/R aging, outcomes and the report library.',
    where: '/dashboard/reports, /dashboard/billing/provider-collections, /dashboard/billing/ar-control',
    tiers: FROM_PROFESSIONAL,
    notes: { starter: 'Basic reports only' },
  },
  {
    id: 'hr_credentialing',
    group: 'Practice operations',
    name: 'Staff credentialing and HR',
    explain: 'License and credential expirations, training records and staff directory.',
    where: '/dashboard/hr, /dashboard/hr/credentialing',
    tiers: FROM_PROFESSIONAL,
  },
  {
    id: 'multi_location',
    group: 'Practice operations',
    name: 'Multiple locations',
    explain: 'Run several sites under one organization with location-level schedules, staff and reporting.',
    where: '/dashboard/enterprise, /dashboard/admin (locations)',
    tiers: FROM_PROFESSIONAL,
    notes: { professional: '2 included, more as add-on', clinic: 'Unlimited', enterprise: 'Unlimited' },
  },
  // AI and prescribing
  {
    id: 'ai_insights',
    group: 'AI and prescribing',
    name: 'AI clinical insights',
    explain: 'Clinical Insights, the Service Eligibility Scanner, note-quality checks, risk watch and pre-visit briefs. Suggestions only; clinicians decide.',
    where: '/dashboard/clinical-insights, /dashboard/service-eligibility, /api/ai/*',
    tiers: FROM_PROFESSIONAL,
  },
  {
    id: 'ai_scribe',
    group: 'AI and prescribing',
    name: 'AI Scribe',
    explain: 'Drafts the progress note from the session for the clinician to review and sign.',
    where: '/dashboard/scribe (live, dictation, paste or import), POST /api/scribe/captures/[id]/draft, POST /api/scribe/section-draft',
    tiers: { starter: 'addon', professional: 'addon', clinic: 'addon', enterprise: 'addon' },
    addOn: 'ai_scribe',
    notes: { enterprise: 'Volume pricing' },
  },
  {
    id: 'eprescribing',
    group: 'AI and prescribing',
    name: 'E-prescribing with EPCS and PDMP',
    explain: 'DrFirst Rcopia inside the chart, including controlled substances and PDMP checks. Included in every prescriber seat.',
    where: '/dashboard/ehr/prescriptions, /api/drfirst/*, /api/prescribing/*',
    tiers: ALL,
    notes: { starter: 'Prescriber seats', professional: 'Prescriber seats', clinic: 'Prescriber seats', enterprise: 'Prescriber seats' },
  },
  // Programs and compliance
  {
    id: 'programs',
    group: 'Programs and compliance',
    name: 'Program tools: PRP, IOP, residential, AOT',
    explain: 'Psychiatric rehabilitation (PRP) enrollment and authorizations, IOP tracks, residential bed board and shift notes, AOT caseboard and court reports.',
    where: '/dashboard/prp, /dashboard/residential, /dashboard/aot',
    tiers: FROM_CLINIC,
  },
  {
    id: 'primary_care',
    group: 'Programs and compliance',
    name: 'Primary care chart, labs and medical billing',
    explain: 'Medical chart, problem list, vitals, lab orders and results, and E/M coding alongside behavioral health.',
    where: '/dashboard/medical, /dashboard/labs',
    tiers: FROM_CLINIC,
  },
  {
    id: 'part2_tools',
    group: 'Programs and compliance',
    name: '42 CFR Part 2 tools',
    explain: 'Part 2 consents, redisclosure notices and segmented protected records for substance use treatment.',
    where: '/dashboard/ehr/part2, /dashboard/protected-records',
    tiers: FROM_CLINIC,
  },
  {
    id: 'qi_compliance',
    group: 'Programs and compliance',
    name: 'Quality, incidents and grievances',
    explain: 'QI indicators, incident reports, grievances and the compliance calendar for accreditation.',
    where: '/dashboard/qi, /dashboard/incidents, /dashboard/grievances, /dashboard/compliance',
    tiers: FROM_CLINIC,
  },
  {
    id: 'population_health',
    group: 'Programs and compliance',
    name: 'Population health and SDOH',
    explain: 'Risk stratification across the caseload, SDOH screening and resource directory.',
    where: '/dashboard/population, /dashboard/sdoh',
    tiers: FROM_CLINIC,
  },
  // Security and support
  {
    id: 'audit_rbac',
    group: 'Security and support',
    name: 'HIPAA audit log, roles and BAA',
    explain: 'Every chart access logged, role-based permissions and a signed Business Associate Agreement.',
    where: '/dashboard/compliance, staff roles',
    tiers: ALL,
  },
  {
    id: 'custom_integrations',
    group: 'Security and support',
    name: 'Custom integrations and data exports',
    explain: 'HIE connections, FHIR access, scheduled data exports and custom interfaces.',
    where: '/dashboard/ehr/hie, /dashboard/ehr/healthlake',
    tiers: { starter: 'none', professional: 'none', clinic: 'none', enterprise: 'included' },
  },
];

export const FEATURE_IDS: FeatureId[] = FEATURES.map((f) => f.id);

export function featureById(id: FeatureId): FeatureDefinition {
  const found = FEATURES.find((f) => f.id === id);
  if (!found) throw new Error(`Unknown feature ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// Plain-language rules (rendered verbatim in the product).
// ---------------------------------------------------------------------------

export const SEAT_RULE =
  'You pay for each active staff account by what they do. Prescriber seats are for psychiatrists, nurse practitioners and physicians, and include e-prescribing with EPCS. Clinician seats are for therapists and counselors. Program staff seats are for PRP specialists, case managers, peer support, medical assistants and crisis staff. Front desk, billing, HR, office manager, director and admin accounts are always free. Someone with several roles is counted once, at their highest seat. Invited and deactivated accounts do not count.';

export const OVERAGE_RULE =
  'When you activate a new staff member, their seat is added to your subscription and prorated for the rest of the billing period (when automatic seat sync is on), or trued up at the next renewal. Deactivating someone lowers the count at the next renewal. If your total is below your plan minimum, you pay the minimum.';

export const CLAIMS_RULE = `Each paid seat includes a monthly allowance of electronic claims, pooled across the organization. Every claim includes its eligibility check, claim-status checks and remittance (ERA) posting. Claims above the allowance are $${CLAIM_OVERAGE_PER_CLAIM.toFixed(2)} each, billed the following month.`;

export const TRIAL_RULE = `Starter, Professional and Clinic start with a ${TRIAL_DAYS}-day free trial with the features of the tier you choose. AI Scribe is included during the trial with ${TRIAL_AI_SCRIBE_MINUTES} minutes of session audio for the organization (pasted text does not use minutes). No card is needed to start. When the trial ends without a subscription the account becomes read-only: you can view and export everything, but cannot add or change records, until you subscribe.`;

export const DUNNING_RULE = `If a renewal payment fails, Stripe retries the card automatically and we show a banner. Access stays fully on for ${PAST_DUE_GRACE_DAYS} days. If payment is still not received, the account becomes read-only until the balance is paid. Data is kept for at least ${READ_ONLY_RETENTION_DAYS} days after cancellation and can be exported at any time.`;

export type PricingFaq = { id: string; question: string; answer: string };

function billingServiceFaqAnswer(): string {
  return billingServiceOffered()
    ? `Yes. Our full billing service is ${BILLING_SERVICE_PERCENT}% of net collections with a $${BILLING_SERVICE_MINIMUM_MONTHLY} monthly minimum, quoted after we review your payer mix. Software seats are billed separately.`
    : 'A full billing service (we work your claims, denials and payment posting for you) is available on request. Contact us to discuss it. Every plan includes the billing tools for your own team.';
}

export const PRICING_FAQ: PricingFaq[] = [
  { id: 'seats', question: 'Who counts as a seat, and what does each seat cost?', answer: SEAT_RULE },
  {
    id: 'program_staff',
    question: 'Why are program staff priced lower?',
    answer:
      'PRP specialists, case managers, peer support workers and medical assistants document and schedule in Altrixs but bill fewer, lower-rate services than licensed clinicians, so their seat costs less. They get the same security, documentation and program tools.',
  },
  {
    id: 'erx',
    question: 'Is e-prescribing included?',
    answer:
      'Yes, for prescribers. Every prescriber seat includes DrFirst Rcopia e-prescribing, controlled-substance prescribing (EPCS), PDMP checks and medication history. Each prescriber completes EPCS identity proofing once during onboarding.',
  },
  {
    id: 'scribe',
    question: 'How is AI Scribe priced?',
    answer: `AI Scribe is bought per scribe user, so you pay only for clinicians who use it. Each scribe user includes ${AI_SCRIBE_INCLUDED_MINUTES.toLocaleString('en-US')} minutes of session audio per month, pooled across your organization; above that it is $${AI_SCRIBE_OVERAGE_PER_MINUTE.toFixed(2)} per minute. Every AI draft is reviewed and signed by the clinician, and client consent is recorded first.`,
  },
  { id: 'claims', question: 'Are there per-claim fees?', answer: CLAIMS_RULE },
  {
    id: 'locations',
    question: 'Do you charge per location?',
    answer: 'Starter covers one location. Professional includes two, and each additional location is an add-on. Clinic and Enterprise include unlimited locations.',
  },
  {
    id: 'annual',
    question: 'Is there a discount for paying annually?',
    answer: `Yes. Paying for a year up front saves ${ANNUAL_DISCOUNT_PERCENT}% on seats and recurring add-ons. Seats added mid-year are prorated.`,
  },
  {
    id: 'volume',
    question: 'Are there volume discounts?',
    answer: `Seat charges are discounted ${VOLUME_DISCOUNTS.map((v) => `${v.percent}% from ${v.minProviderSeats} providers`).join(' and ')} (prescribers plus clinicians). Organizations with ${ENTERPRISE_RECOMMENDED_PROVIDER_SEATS} or more providers get an Enterprise quote.`,
  },
  {
    id: 'minimum',
    question: 'Is there a minimum?',
    answer: `Each plan has a monthly minimum: ${SELF_SERVE_TIERS.map((t) => `${TIERS[t].name} $${TIERS[t].minimumMonthly}`).join(', ')}. If your seats and add-ons come to less, you pay the minimum.`,
  },
  { id: 'trial', question: 'How does the free trial work, and what happens when it ends?', answer: TRIAL_RULE },
  { id: 'overage', question: 'What if we hire or lose staff mid-month?', answer: OVERAGE_RULE },
  {
    id: 'onboarding',
    question: 'What do onboarding and data migration cost?',
    answer:
      `${GO_LIVE_TIMELINE}. Starter is self-guided, with self-serve CSV import, at no charge. Professional and Clinic have one-time onboarding and data-migration fees, plus a per-site onboarding fee for each location after the first. Enterprise implementation is scoped and quoted.`,
  },
  {
    id: 'billing_service',
    question: 'Can you do our billing for us?',
    answer: billingServiceFaqAnswer(),
  },
  { id: 'past_due', question: 'What happens if a payment fails?', answer: DUNNING_RULE },
  {
    id: 'cancel',
    question: 'Can we cancel?',
    answer: `Yes. Monthly plans can be cancelled any time from Plan & Subscription and stay active until the end of the paid period. Your records stay available read-only for at least ${READ_ONLY_RETENTION_DAYS} days so you can export them.`,
  },
];

// ---------------------------------------------------------------------------
// Pricing math — shared by UI, quote calculator and Checkout so totals match Stripe.
// ---------------------------------------------------------------------------

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

function wholeCount(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(0, v);
}

export function seatUnitPrice(tier: TierId, seat: BillableSeatType, interval: BillingInterval): number | null {
  const p = TIERS[tier].seatPrices;
  return p ? p[seat][interval] : null;
}

/** The headline "from" price: a clinician seat. */
export function tierUnitPrice(tier: TierId, interval: BillingInterval): number | null {
  return seatUnitPrice(tier, 'clinician', interval);
}

export function addOnUnitPrice(addOn: AddOnId, interval: BillingInterval): number | null {
  const a = ADD_ONS[addOn];
  return interval === 'year' ? a.annualPerUnitPerMonth : a.monthlyPerUnit;
}

export function volumeDiscountPercent(providerSeats: number): number {
  let pct = 0;
  for (const row of VOLUME_DISCOUNTS) if (providerSeats >= row.minProviderSeats) pct = row.percent;
  return pct;
}

/** Locations billed as add-ons on a tier, given the organization's active locations. */
export function extraLocationsFor(tier: TierId, locations: number): number {
  const t = TIERS[tier];
  if (t.includedLocations === null || !t.extraLocationsAvailable) return 0;
  return Math.max(0, wholeCount(locations) - t.includedLocations);
}

export type QuoteInput = {
  tier: TierId;
  interval: BillingInterval;
  seats: Partial<SeatQuantities>;
  /** Active locations (default 1). */
  locations?: number;
  /** Clinicians licensed for AI Scribe (capped at billable seats). */
  aiScribeUsers?: number;
  /** Expected claims per month, for the overage estimate. */
  expectedClaimsPerMonth?: number;
  /** Expected ambient AI Scribe minutes per month, for the overage estimate. */
  expectedScribeMinutesPerMonth?: number;
  includeOnboarding?: boolean;
  includeDataMigration?: boolean;
  /** Monthly net collections, to price the optional full billing service (only while billingServiceOffered()). */
  billingServiceCollections?: number;
};

export type QuoteLineKind = 'seat' | 'discount' | 'addon' | 'minimum' | 'usage' | 'service' | 'one_time';

export type QuoteLine = {
  id: string;
  kind: QuoteLineKind;
  label: string;
  quantity: number;
  /** USD per unit per month (one-time lines: per unit, once). */
  unitPrice: number;
  /** USD per month (one-time lines: total once). Negative for discounts. */
  amount: number;
};

export type PriceQuote = {
  tier: TierId;
  interval: BillingInterval;
  seats: SeatQuantities;
  providerSeats: number;
  billableSeats: number;
  locations: number;
  extraLocations: number;
  aiScribeUsers: number;
  /** Recurring subscription lines (seats, volume discount, add-ons, minimum top-up). */
  lines: QuoteLine[];
  seatSubtotal: number;
  volumeDiscountPercent: number;
  volumeDiscount: number;
  addOnSubtotal: number;
  minimumAdjustment: number;
  /** Recurring subscription per month (annual plans: monthly equivalent). */
  subscriptionPerMonth: number;
  /** Amount per subscription invoice (monthly = per month, annual = 12×). */
  subscriptionPerInvoice: number;
  claimsAllowance: number | null;
  claimsOverage: number;
  scribeMinutesAllowance: number;
  scribeOverage: number;
  /** Usage-based estimate per month (claims + scribe overage). */
  usagePerMonth: number;
  /** Optional billing service per month (percent of collections, minimum applied). */
  servicePerMonth: number;
  /** Everything recurring per month: subscription + usage + service. */
  estimatedMonthlyTotal: number;
  /** 12 × estimatedMonthlyTotal. */
  estimatedAnnualTotal: number;
  oneTimeLines: QuoteLine[];
  oneTime: number;
  enterpriseRecommended: boolean;
  warnings: string[];
};

/** Price a selection. Returns null for tiers without list prices (Enterprise). */
export function quote(input: QuoteInput): PriceQuote | null {
  const t = TIERS[input.tier];
  if (!t.seatPrices) return null;
  const interval = input.interval;
  const seats: SeatQuantities = {
    prescriber: wholeCount(input.seats.prescriber),
    clinician: wholeCount(input.seats.clinician),
    paraprofessional: wholeCount(input.seats.paraprofessional),
  };
  const providerSeats = providerSeatsOf(seats);
  const billableSeats = billableSeatsOf(seats);
  const locations = Math.max(1, wholeCount(input.locations ?? 1));
  const warnings: string[] = [];

  const lines: QuoteLine[] = [];
  let seatSubtotal = 0;
  for (const type of BILLABLE_SEAT_TYPES) {
    const qty = seats[type];
    if (qty <= 0) continue;
    const unit = t.seatPrices[type][interval];
    const amount = cents(unit * qty);
    seatSubtotal += amount;
    lines.push({
      id: `seat_${type}`,
      kind: 'seat',
      label: `${SEAT_TYPES[type].name} seat${qty === 1 ? '' : 's'} × ${qty}`,
      quantity: qty,
      unitPrice: unit,
      amount,
    });
  }
  seatSubtotal = cents(seatSubtotal);

  const pct = volumeDiscountPercent(providerSeats);
  const volumeDiscount = cents((seatSubtotal * pct) / 100);
  if (volumeDiscount > 0) {
    lines.push({
      id: 'volume_discount',
      kind: 'discount',
      label: `Volume discount ${pct}% (${providerSeats} providers)`,
      quantity: 1,
      unitPrice: -volumeDiscount,
      amount: -volumeDiscount,
    });
  }

  let addOnSubtotal = 0;
  const aiScribeUsers = Math.min(wholeCount(input.aiScribeUsers), billableSeats);
  if (wholeCount(input.aiScribeUsers) > billableSeats) {
    warnings.push('AI Scribe users were capped at the number of paid seats.');
  }
  if (aiScribeUsers > 0 && ADD_ONS.ai_scribe.availableOn.includes(input.tier)) {
    const unit = addOnUnitPrice('ai_scribe', interval)!;
    const amount = cents(unit * aiScribeUsers);
    addOnSubtotal += amount;
    lines.push({ id: 'addon_ai_scribe', kind: 'addon', label: `AI Scribe × ${aiScribeUsers}`, quantity: aiScribeUsers, unitPrice: unit, amount });
  }
  const extraLocations = extraLocationsFor(input.tier, locations);
  if (extraLocations > 0) {
    const unit = addOnUnitPrice('additional_location', interval)!;
    const amount = cents(unit * extraLocations);
    addOnSubtotal += amount;
    lines.push({
      id: 'addon_additional_location',
      kind: 'addon',
      label: `Additional location${extraLocations === 1 ? '' : 's'} × ${extraLocations}`,
      quantity: extraLocations,
      unitPrice: unit,
      amount,
    });
  }
  if (t.includedLocations !== null && !t.extraLocationsAvailable && locations > t.includedLocations) {
    warnings.push(`${t.name} covers ${t.includedLocations} location${t.includedLocations === 1 ? '' : 's'}; ${locations} entered. Choose Professional or Clinic.`);
  }
  addOnSubtotal = cents(addOnSubtotal);

  const beforeMinimum = cents(seatSubtotal - volumeDiscount + addOnSubtotal);
  const minimumAdjustment = t.minimumMonthly !== null ? cents(Math.max(0, t.minimumMonthly - beforeMinimum)) : 0;
  if (minimumAdjustment > 0) {
    lines.push({
      id: 'minimum',
      kind: 'minimum',
      label: `Plan minimum (${formatUsd(t.minimumMonthly!)} / month)`,
      quantity: 1,
      unitPrice: minimumAdjustment,
      amount: minimumAdjustment,
    });
  }
  const subscriptionPerMonth = cents(beforeMinimum + minimumAdjustment);

  if (t.maxProviderSeats !== null && providerSeats > t.maxProviderSeats) {
    warnings.push(`${t.name} is for up to ${t.maxProviderSeats} providers; ${providerSeats} entered. Choose Professional or Clinic.`);
  }
  const enterpriseRecommended = providerSeats >= ENTERPRISE_RECOMMENDED_PROVIDER_SEATS;
  if (enterpriseRecommended) warnings.push(`${providerSeats} providers: ask us for an Enterprise quote with volume pricing.`);

  // Usage
  const claimsAllowance = t.claimsPerSeat === null ? null : t.claimsPerSeat * billableSeats;
  const claims = wholeCount(input.expectedClaimsPerMonth);
  const claimsOverage = claimsAllowance === null ? 0 : cents(Math.max(0, claims - claimsAllowance) * CLAIM_OVERAGE_PER_CLAIM);
  const scribeMinutesAllowance = aiScribeUsers * AI_SCRIBE_INCLUDED_MINUTES;
  const minutes = aiScribeUsers > 0 ? wholeCount(input.expectedScribeMinutesPerMonth) : 0;
  const scribeOverage = cents(Math.max(0, minutes - scribeMinutesAllowance) * AI_SCRIBE_OVERAGE_PER_MINUTE);
  const usagePerMonth = cents(claimsOverage + scribeOverage);

  // Service
  const collections = Math.max(0, Number(input.billingServiceCollections) || 0);
  const servicePerMonth =
    collections > 0 && billingServiceOffered() && ADD_ONS.billing_service.availableOn.includes(input.tier)
      ? cents(Math.max(BILLING_SERVICE_MINIMUM_MONTHLY, (collections * BILLING_SERVICE_PERCENT) / 100))
      : 0;

  // One-time
  const oneTimeLines: QuoteLine[] = [];
  if (input.includeOnboarding && (t.onboardingFee ?? 0) > 0) {
    oneTimeLines.push({ id: 'onboarding', kind: 'one_time', label: `${t.name} onboarding`, quantity: 1, unitPrice: t.onboardingFee!, amount: t.onboardingFee! });
    const extraSites = locations - 1;
    if (extraSites > 0 && t.onboardingPerExtraLocation > 0) {
      oneTimeLines.push({
        id: 'onboarding_location',
        kind: 'one_time',
        label: `Onboarding, additional site${extraSites === 1 ? '' : 's'} × ${extraSites}`,
        quantity: extraSites,
        unitPrice: t.onboardingPerExtraLocation,
        amount: t.onboardingPerExtraLocation * extraSites,
      });
    }
  }
  if (input.includeDataMigration && (t.dataMigrationFee ?? 0) > 0) {
    oneTimeLines.push({ id: 'data_migration', kind: 'one_time', label: 'Data migration (one prior system)', quantity: 1, unitPrice: t.dataMigrationFee!, amount: t.dataMigrationFee! });
  }
  const oneTime = oneTimeLines.reduce((s, l) => s + l.amount, 0);

  const estimatedMonthlyTotal = cents(subscriptionPerMonth + usagePerMonth + servicePerMonth);
  return {
    tier: input.tier,
    interval,
    seats,
    providerSeats,
    billableSeats,
    locations,
    extraLocations,
    aiScribeUsers,
    lines,
    seatSubtotal,
    volumeDiscountPercent: pct,
    volumeDiscount,
    addOnSubtotal,
    minimumAdjustment,
    subscriptionPerMonth,
    subscriptionPerInvoice: interval === 'year' ? cents(subscriptionPerMonth * 12) : subscriptionPerMonth,
    claimsAllowance,
    claimsOverage,
    scribeMinutesAllowance,
    scribeOverage,
    usagePerMonth,
    servicePerMonth,
    estimatedMonthlyTotal,
    estimatedAnnualTotal: cents(estimatedMonthlyTotal * 12),
    oneTimeLines,
    oneTime,
    enterpriseRecommended,
    warnings,
  };
}

/** Cheapest self-serve tier whose limits fit the selection (provider cap and locations). */
export function smallestFittingTier(seats: Partial<SeatQuantities>, locations = 1): SelfServeTierId {
  const providers = providerSeatsOf(seats);
  for (const id of SELF_SERVE_TIERS) {
    const t = TIERS[id];
    if (t.maxProviderSeats !== null && providers > t.maxProviderSeats) continue;
    if (t.includedLocations !== null && !t.extraLocationsAvailable && locations > t.includedLocations) continue;
    return id;
  }
  return 'clinic';
}

export function formatUsd(amount: number): string {
  const whole = Number.isInteger(amount);
  return `${amount < 0 ? '-' : ''}$${Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "From $89 per clinician / month" or "Custom quote". */
export function tierPriceLabel(tier: TierId, interval: BillingInterval): string {
  const unit = tierUnitPrice(tier, interval);
  if (unit === null) return 'Custom quote';
  return `From ${formatUsd(unit)} per clinician / month`;
}

/** Legacy plan ids stored by older code paths (Free / Solo / Practice / Professional / Enterprise). */
export function tierFromLegacyPlan(plan: string | null | undefined): TierId | null {
  switch (plan) {
    case 'starter':
    case 'solo':
      return 'starter';
    case 'professional':
    case 'growth':
    case 'practice':
      return 'professional';
    case 'clinic':
      return 'clinic';
    case 'enterprise':
      return 'enterprise';
    default:
      return null;
  }
}
