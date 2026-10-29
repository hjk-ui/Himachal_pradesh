/**
 * Growth & Marketing suite constants (pure, client-safe).
 *
 * Compliance frame (see docs in the hub Settings tab):
 * - HIPAA marketing rule (45 CFR 164.501, 164.508(a)(3)): clients get marketing only with a signed
 *   marketing authorization. Client PHI (diagnoses, appointments, programs) is never used to target.
 *   Treatment reminders are not marketing and stay in the clinical SMS system (src/lib/sms/patientSms.ts).
 * - Leads who share health information are PHI: stored only in Altrixs, never sent to third-party
 *   ad / analytics tools; no tracking pixels on public pages.
 * - TCPA: explicit SMS consent, STOP honored, quiet hours. CAN-SPAM: unsubscribe + physical address.
 * - 42 CFR Part 2: no SUD-specific targeting.
 */

export const LEAD_SOURCES = [
  { key: 'website_form', label: 'Website form' },
  { key: 'phone', label: 'Phone call' },
  { key: 'referral_partner', label: 'Referral partner' },
  { key: 'community_event', label: 'Community event' },
  { key: 'walk_in', label: 'Walk-in' },
  { key: 'insurance_directory', label: 'Insurance directory' },
  { key: 'listing', label: 'Therapist listing site' },
  { key: 'social', label: 'Social media' },
  { key: 'other', label: 'Other' },
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number]['key'];
export const LEAD_SOURCE_KEYS = LEAD_SOURCES.map((s) => s.key) as LeadSource[];
export const leadSourceLabel = (k: string | null | undefined) => LEAD_SOURCES.find((s) => s.key === k)?.label ?? 'Other';

/** Pipeline order. converted / not_a_fit / lost are closed stages. */
export const LEAD_STAGES = [
  { key: 'new', label: 'New', closed: false },
  { key: 'contacted', label: 'Contacted', closed: false },
  { key: 'screening', label: 'Screening', closed: false },
  { key: 'insurance_verified', label: 'Insurance verified', closed: false },
  { key: 'scheduled', label: 'Scheduled', closed: false },
  { key: 'converted', label: 'Converted to client', closed: true },
  { key: 'not_a_fit', label: 'Not a fit', closed: true },
  { key: 'lost', label: 'Lost', closed: true },
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number]['key'];
export const LEAD_STAGE_KEYS = LEAD_STAGES.map((s) => s.key) as LeadStage[];
export const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'screening', 'insurance_verified', 'scheduled'];
export const leadStageLabel = (k: string | null | undefined) => LEAD_STAGES.find((s) => s.key === k)?.label ?? 'New';

export const LOST_REASONS = [
  'No response',
  'Chose another provider',
  'Insurance not accepted',
  'Cost',
  'Service not offered',
  'Needs higher level of care (referred out)',
  'Location / schedule',
  'Other',
] as const;

export const SERVICE_INTERESTS = [
  'Individual therapy',
  'Couples / family therapy',
  'Child & adolescent therapy',
  'Psychiatry / medication management',
  'Psychiatric rehabilitation (PRP)',
  'Group therapy',
  'Primary care',
  'Not sure yet',
] as const;

export const PREFERRED_CONTACT = [
  { key: 'phone', label: 'Phone call' },
  { key: 'sms', label: 'Text message' },
  { key: 'email', label: 'Email' },
] as const;

export const PARTNER_TYPES = [
  { key: 'school', label: 'School' },
  { key: 'hospital', label: 'Hospital / ED' },
  { key: 'pcp', label: 'Primary care / pediatrics' },
  { key: 'court', label: 'Court / legal' },
  { key: 'church', label: 'Faith community' },
  { key: 'community_org', label: 'Community organization' },
  { key: 'government', label: 'Government agency' },
  { key: 'employer', label: 'Employer / EAP' },
  { key: 'other', label: 'Other' },
] as const;
export const partnerTypeLabel = (k: string | null | undefined) => PARTNER_TYPES.find((p) => p.key === k)?.label ?? 'Other';

export const TOUCH_KINDS = ['Visit', 'Call', 'Email', 'Lunch and learn', 'Event', 'Mailer', 'Other'] as const;

export const CONTACT_KINDS = [
  { key: 'newsletter', label: 'Newsletter subscriber' },
  { key: 'event_attendee', label: 'Event attendee' },
  { key: 'partner_contact', label: 'Partner contact' },
  { key: 'community', label: 'Community member' },
  { key: 'client_authorized', label: 'Client (marketing authorization on file)' },
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number]['key'];

export const SOCIAL_CHANNELS = ['Facebook', 'Instagram', 'LinkedIn', 'X', 'Google Business Profile', 'Nextdoor', 'YouTube'] as const;

/** Social post approval workflow. */
export const SOCIAL_STATUSES = ['draft', 'review', 'approved', 'scheduled', 'posted', 'exported'] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

export const CAMPAIGN_STATUSES = ['draft', 'review', 'approved', 'scheduled', 'sending', 'sent', 'queued'] as const;

export const REVIEW_SOURCES = ['Google Business Profile', 'Facebook', 'Yelp', 'Healthgrades', 'Psychology Today', 'Zocdoc', 'Other'] as const;

/** Integrations: shown as "not connected" until the owner sets them up. Never a fake connection. */
export const INTEGRATIONS = [
  {
    key: 'googleBusiness',
    label: 'Google Business Profile',
    setup:
      'Verify each location in Google Business Profile, then grant API access (Business Profile API approval from Google). Until then, enter or paste reviews here and post approved replies by hand.',
  },
  {
    key: 'meta',
    label: 'Meta (Facebook / Instagram)',
    setup:
      'Needs a Meta Business account and app review for publishing. Until then, approved posts are exported (copy / CSV) and posted by hand. Never install the Meta Pixel on intake pages.',
  },
  {
    key: 'website',
    label: 'Practice website',
    setup:
      'Embed the intake form with the iframe snippet on the Forms tab. Do not add Google Analytics, Meta Pixel or other trackers to pages that host the form.',
  },
  {
    key: 'phone',
    label: 'Phone / SMS number',
    setup:
      'Marketing texts use the practice SMS number (AWS End User Messaging) once it is registered for 10DLC marketing use. Missed-call text-back needs a call-event feed from the phone system (Amazon Connect).',
  },
  {
    key: 'email',
    label: 'Sender email (Amazon SES)',
    setup:
      'Verify the sending domain in Amazon SES (SPF, DKIM, DMARC) and add the sender identity in Settings.',
  },
] as const;
export type IntegrationKey = (typeof INTEGRATIONS)[number]['key'];

export const AI_FEATURES = [
  { key: 'reviewReply', label: 'Review reply drafts', description: 'HIPAA-safe reply drafts that never confirm someone is a patient.' },
  { key: 'suggestedReply', label: 'Lead reply suggestions', description: 'Suggested replies for the conversations inbox (message details are redacted first).' },
  { key: 'socialCaption', label: 'Social captions and hashtags', description: 'Captions, hashtags and image prompt ideas from a topic.' },
  { key: 'pressRelease', label: 'Press release drafts', description: 'Draft press releases from a few facts.' },
  { key: 'growthInsights', label: 'Weekly growth insights', description: 'Insights from aggregate counts only (sources, stalled leads, quiet partners).' },
  { key: 'contentCalendar', label: 'Content calendar suggestions', description: 'Awareness-month ideas for the social planner.' },
  { key: 'landingCopy', label: 'Landing page and ad copy', description: 'Draft copy for pages and ads, reviewed before use.' },
] as const;
export type MarketingAiFeature = (typeof AI_FEATURES)[number]['key'];

/** Awareness observances for the content calendar (month is 1-12). */
export const AWARENESS_MONTHS: { month: number; title: string; note: string }[] = [
  { month: 1, title: 'Mental Wellness Month', note: 'New-year wellbeing, routines and self-care.' },
  { month: 2, title: "Children's Mental Health / Eating Disorders Awareness Week", note: 'Youth wellbeing; late Feb NEDA week.' },
  { month: 3, title: 'Self-Harm Awareness Month / Brain Injury Awareness Month', note: 'Help-seeking and resources; use safe messaging.' },
  { month: 4, title: 'Stress Awareness Month / Counseling Awareness Month', note: 'Coping skills and what counseling is like.' },
  { month: 5, title: 'Mental Health Awareness Month', note: 'Stigma reduction, how to get started with care. Also Maternal Mental Health Week.' },
  { month: 6, title: "PTSD Awareness Month / Men's Health Month", note: 'Trauma-informed care and men’s help-seeking.' },
  { month: 7, title: 'BIPOC Mental Health Month', note: 'Culturally responsive care and community voices.' },
  { month: 8, title: 'Back to school / Wellness Month', note: 'Student and family transitions; school partners.' },
  { month: 9, title: 'Suicide Prevention Month', note: 'Safe messaging guidelines: always include 988, no method detail, focus on hope and help.' },
  { month: 10, title: 'Depression and Mental Health Screening Month / ADHD Awareness Month', note: 'World Mental Health Day (Oct 10). Screening events.' },
  { month: 11, title: 'National Family Caregivers Month', note: 'Caregiver stress and support; holiday season planning.' },
  { month: 12, title: 'Holiday stress and seasonal wellbeing', note: 'Grief during holidays, seasonal mood, community resources.' },
];

/** Terms that indicate substance-use-disorder targeting (42 CFR Part 2): never allowed in segments. */
export const SUD_TERMS = [
  'sud',
  'substance',
  'opioid',
  'opiate',
  'alcohol',
  'addiction',
  'addict',
  'detox',
  'suboxone',
  'buprenorphine',
  'methadone',
  'naltrexone',
  'vivitrol',
  'mat',
  'moud',
  'overdose',
  'drug use',
  'aud',
  'oud',
] as const;

/** Segment fields that are clinical / PHI and can never target an audience. */
export const FORBIDDEN_SEGMENT_FIELDS = [
  'diagnosis',
  'diagnoses',
  'icd',
  'condition',
  'medication',
  'prescription',
  'appointment',
  'appointments',
  'program',
  'treatment',
  'assessment',
  'insurance',
  'payer',
  'clinician',
  'provider',
  'risk',
  'part2',
] as const;

/** Small-cell suppression default (CMS cell size suppression policy: suppress 1-10). */
export const DEFAULT_SMALL_CELL_THRESHOLD = 11;

export const DEFAULT_QUIET_HOURS = { start: '20:00', end: '09:00' } as const;

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Day = (typeof DAYS)[number];
export type BusinessHours = Partial<Record<Day, { open: string; close: string } | null>>;
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { open: '09:00', close: '17:00' },
  tue: { open: '09:00', close: '17:00' },
  wed: { open: '09:00', close: '17:00' },
  thu: { open: '09:00', close: '17:00' },
  fri: { open: '09:00', close: '17:00' },
  sat: null,
  sun: null,
};

/** Text appended to every marketing SMS (CTIA). */
export const SMS_OPT_OUT_FOOTER = 'Reply STOP to opt out.';

export const SMS_CONSENT_TEXT =
  'I agree to receive text messages from {practice} about my inquiry, including follow-ups and scheduling. Consent is not a condition of receiving services. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.';

export const CONTACT_CONSENT_TEXT = 'I agree that {practice} may contact me by phone or email about this inquiry.';

export const NO_PHI_FORM_NOTICE =
  'Please do not include details about your health or symptoms in this form. Our intake team will talk with you privately. If you are in crisis, call or text 988 or call 911.';
