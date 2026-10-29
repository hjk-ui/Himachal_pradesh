/**
 * Public homepage copy shared by the page (metadata + JSON-LD, a server component) and
 * HomePage.tsx (client). Plain data, no 'use client', so the server can read the real values.
 *
 * Category: Altrixs is a BEHAVIORAL HEALTH EHR with integrated primary care, billing / RCM and
 * practice operations. The referral and lead tools are one module, "Community and outreach CRM";
 * the product itself is never described with that word.
 * Terminology: "clients" in behavioral health contexts, "patients" in primary care contexts.
 * Every capability claimed here maps to code; tests/marketing-copy-standard.test.ts checks the
 * mapping and bans security-certification claims, absolute HIPAA claims, naming other EHR
 * vendors, and emoji. Prices are never written here: they come from src/lib/billing/plans.ts.
 */
import {
  GO_LIVE_TIMELINE,
  PRICING_FAQ,
  TIERS,
  TIER_ORDER,
  TRIAL_DAYS,
  tierPriceLabel,
} from '@/lib/billing/plans';
import { BAA_LEGAL_REVIEWED } from '@/lib/legal/baa';

export { GO_LIVE_TIMELINE };

/** Where "Request a demo" goes. One constant so it can be switched to a sales inbox later. */
export const DEMO_REQUEST_EMAIL = 'support@altrixs.com';
export const DEMO_REQUEST_HREF = `mailto:${DEMO_REQUEST_EMAIL}?subject=Altrixs%20demo%20request`;

/** Public migration promise (owner 2026-10-26): softened, with no promise that each document type is filed for you. */
export const MIGRATION_PROMISE = 'Migration from any EHR platform, with support available';

export const HOME_TITLE = 'Altrixs | Behavioral Health EHR with Primary Care, Billing & Telehealth';
export const HOME_DESCRIPTION =
  'Altrixs is a behavioral health EHR for mental health and substance use clinics: AI Scribe, e-prescribing, telehealth, billing, Part 2 and primary care in one chart.';

export const HERO = {
  kicker: 'Behavioral health EHR',
  headline: 'The behavioral health EHR with primary care, billing and practice operations built in.',
  subhead:
    'One chart and one schedule for therapists, prescribers, program staff and the front desk. Write notes faster with an AI Scribe that checks its work, prescribe from the chart, and get claims paid.',
  proof: [
    'AI Scribe in English and Spanish',
    'E-prescribing with EPCS',
    'Built-in telehealth',
    'Claims, ERA and eligibility',
    '42 CFR Part 2 controls',
  ],
};

export const AUDIENCES = [
  {
    title: 'Outpatient mental health clinics',
    body: 'Therapy, assessments, treatment plans and measures for individual, family and group care.',
  },
  {
    title: 'Psychiatry and medication management',
    body: 'Psychiatric evaluations, med management notes and e-prescribing in the same chart.',
  },
  {
    title: 'Integrated behavioral health and primary care',
    body: 'Patients have a primary care provider, medical visits, vitals and labs next to their behavioral health record.',
  },
  {
    title: 'Program providers',
    body: 'PRP built to Maryland COMAR, IOP and PHP, residential, AOT and peer support programs.',
  },
  {
    title: 'Multi-site organizations',
    body: 'Shared standards across locations, with each person seeing only the clients and data their role needs.',
  },
  {
    title: 'Solo and small practices',
    body: 'Self-guided setup, free front desk and billing users, and a plan sized for up to five providers.',
  },
];

/** Image-backed module rows on the homepage (#platform). */
export const MODULES = [
  {
    kicker: 'Clinical documentation',
    title: 'Notes, treatment plans and assessments in one chart',
    body: 'Write SOAP, DAP and BIRP progress notes, intakes, psychiatric evaluations, treatment plans, diagnoses and consents. Send PHQ-9, GAD-7 and other measures to clients by text or email, and see each new score next to the last one.',
    imageKey: 'clinical',
    alt: 'Clinician writing a progress note in the Altrixs behavioral health EHR',
  },
  {
    kicker: 'AI Scribe',
    title: 'Session notes drafted from the conversation, then checked',
    body: 'With the client’s consent recorded first, AI Scribe drafts a structured note from the session in English or Spanish. Each sentence must cite the transcript. Anything it cannot support is held back for you to review. You edit and sign.',
    imageKey: 'telehealth',
    alt: 'Clinician reviewing an AI-drafted session note before signing',
  },
  {
    kicker: 'Scheduling, telehealth and client portal',
    title: 'Fewer no-shows, fewer phone calls',
    body: 'Clients book online and get reminders by text only after they agree to receive them. Video visits start from the appointment. The client portal installs on any phone for documents, resources and payments.',
    imageKey: 'scheduling',
    alt: 'Clinic front desk scheduling appointments and telehealth visits',
  },
  {
    kicker: 'Billing and revenue cycle',
    title: 'Billing that starts at the visit',
    body: 'Check eligibility, catch errors with a claim scrubber that knows payer rules, and send claims and receive remittances (ERA) electronically. Track denials and prior authorizations, manage fee schedules, and collect client balances with autopay.',
    imageKey: 'billing',
    alt: 'Billing specialist reviewing claims and remittances',
  },
] as const;

/** Text-only module cards under the image rows. */
export const MORE_MODULES = [
  {
    title: 'E-prescribing',
    body: 'Prescribe from the chart through DrFirst Rcopia, including controlled substances (EPCS) and PDMP checks.',
  },
  {
    title: 'Primary care',
    body: 'Primary care provider assignment, medical visits, vitals, lab orders and preventive care for patients in the same record.',
  },
  {
    title: 'Programs and groups',
    body: 'PRP (Maryland COMAR), IOP and PHP, residential, AOT court forms, peer support and group therapy notes with attendance.',
  },
  {
    title: 'Measurement-based care',
    body: 'Standard measures go out by secure link. Results file to the chart with severity and change since the last score.',
  },
  {
    title: 'HR and credentialing',
    body: 'Track licenses, supervision, co-signatures and training. A read-only timekeeping connector reconciles staff hours.',
  },
  {
    title: 'Community and outreach CRM',
    body: 'A module for referral sources, outreach events and inquiries. It keeps contact and scheduling details only. Clinical details stay in the chart.',
  },
];

export const DIFFERENTIATORS = [
  {
    title: 'AI that shows its work',
    body: 'AI scribes can invent details. Altrixs checks every drafted sentence against the session transcript and holds back what the transcript does not support. Medication changes are left to the prescriber.',
  },
  {
    title: 'Risk is never skipped',
    body: 'If a session mentions suicide, self-harm or harm to others, the note cannot be signed until risk is documented, such as a C-SSRS result or safety plan, or the clinician records why no more assessment is needed.',
  },
  {
    title: 'Chart history with sources',
    body: 'Before a visit, Altrixs summarizes past notes and documents, including records brought over from your previous EHR. Every fact links to the page it came from.',
  },
  {
    title: 'One chart for therapy, psychiatry and primary care',
    body: 'No second system for medical care. Care-team access means each person sees what their role needs, and nothing more.',
  },
  {
    title: 'Part 2 in the software, not in a binder',
    body: '42 CFR Part 2 substance use records are shared only with the client’s consent, including to e-prescribing. Emergency break-the-glass access is logged.',
  },
  {
    title: 'Psychotherapy notes kept apart',
    body: 'Move sensitive details out of the progress note and into separate psychotherapy notes in one step.',
  },
  {
    title: 'Switch from any EHR',
    body: `${MIGRATION_PROMISE}. We typically bring over clients, diagnoses, appointment history and documents from your current EHR's exports, and your staff confirm matches before records are filed.`,
  },
];

/**
 * Only claimed once counsel has reviewed the click-through BAA (BAA_LEGAL_REVIEWED in
 * src/lib/legal/baa.ts). tests/marketing-copy-standard.test.ts keeps it off the site until then.
 */
export const BAA_SIGNUP_POINT = 'Business Associate Agreement (BAA) accepted online at sign-up';

export const SECURITY_POINTS = [
  'Hosted on Amazon Web Services (AWS) under a Business Associate Agreement (BAA)',
  'Role-based, minimum-necessary access for every staff role',
  'Two-factor sign-in for staff and automatic logoff after 15 idle minutes',
  'Data encrypted in transit and at rest',
  'Audit log of record access, kept for six years',
  'AI runs on Amazon Bedrock under the BAA; client data is not used to train AI models',
  ...(BAA_LEGAL_REVIEWED ? [BAA_SIGNUP_POINT] : []),
];

const cancelAnswer = PRICING_FAQ.find((f) => f.id === 'cancel')?.answer ?? '';

export const HOME_FAQS: { q: string; a: string }[] = [
  {
    q: 'What is Altrixs?',
    a: 'Altrixs is a behavioral health EHR (electronic health record). It brings together clinical notes, e-prescribing, scheduling, telehealth, a client portal, billing and practice operations. Clinics that also offer primary care chart medical visits in the same record.',
  },
  {
    q: 'Is Altrixs an EHR or a CRM?',
    a: 'Altrixs is an EHR. It also includes a Community and outreach CRM module for referral sources, events and inquiries. That module keeps contact details only. Clinical information stays in the chart.',
  },
  {
    q: 'Who is Altrixs for?',
    a: 'Outpatient mental health and substance use clinics, psychiatry practices, group and solo practices, program providers (PRP, IOP, PHP, residential, AOT, peer support) and organizations that offer behavioral health and primary care together.',
  },
  {
    q: 'Is Altrixs HIPAA compliant?',
    a: 'Altrixs is designed to support HIPAA compliance. It runs on AWS under a BAA, encrypts data in transit and at rest, uses two-factor sign-in for staff, logs staff out after 15 idle minutes and keeps an audit log for six years. Your own policies, training and use of the software also matter for compliance.',
  },
  {
    q: 'How does Altrixs handle 42 CFR Part 2?',
    a: 'Substance use disorder records are marked and protected in the chart. They are shared only with the client’s written consent, including diagnoses sent to e-prescribing. Emergency break-the-glass access is allowed and logged.',
  },
  {
    q: 'How does AI Scribe work, and is our data used to train AI?',
    a: 'AI Scribe records only after the client’s consent is noted. It drafts a note in the format you choose, and every sentence must cite the transcript. Unsupported sentences are held back for review, risk content must be addressed before signing, and medication changes are left to the prescriber. AI runs on Amazon Bedrock under our AWS BAA, and client data is not used to train AI models.',
  },
  {
    q: 'Can prescribers e-prescribe in Altrixs?',
    a: 'Yes. Every prescriber seat includes e-prescribing through DrFirst Rcopia, with controlled-substance prescribing (EPCS), PDMP checks and medication history, opened from the client’s chart.',
  },
  {
    q: 'Is telehealth included?',
    a: 'Yes. Video visits are part of every plan and start from the appointment, so there is no separate telehealth subscription. Clients join from a secure link.',
  },
  {
    q: 'Can you move our data from our current EHR?',
    a: 'Yes. We help you migrate from any EHR platform — typically clients, diagnoses, appointment history and documents — and our team supports you through the move. Your staff confirm matches before records are filed. Starter also includes self-serve import of clients and appointments from CSV. See pricing for the one-time migration fee.',
  },
  {
    q: 'How long does setup take, and is training included?',
    a: `${GO_LIVE_TIMELINE}, depending on your size, number of sites and data. Starter: ${TIERS.starter.onboardingIncludes} Professional: ${TIERS.professional.onboardingIncludes} Clinic: ${TIERS.clinic.onboardingIncludes}`,
  },
  {
    q: 'What does Altrixs connect to?',
    a: 'Claims, remittances and eligibility run through the Waystar clearinghouse. E-prescribing runs through DrFirst Rcopia. A FHIR API shares patient and practitioner data. Enterprise plans can add custom integrations.',
  },
  {
    q: 'How much does Altrixs cost?',
    a: `Plans: ${TIER_ORDER.map((id) => `${TIERS[id].name} (${tierPriceLabel(id, 'month')})`).join(', ')}. You pay per provider by role: prescriber, clinician or program staff. Prescriber seats include e-prescribing. Front desk, billing, HR and admin users are free. Every self-serve plan starts with a ${TRIAL_DAYS}-day free trial.`,
  },
  {
    q: 'Is there a long-term contract?',
    a: `${cancelAnswer} Enterprise plans use an annual contract. Talk to us about terms.`.trim(),
  },
  {
    q: 'What support do you offer?',
    a: `${TIERS.starter.name}: ${TIERS.starter.supportLevel}. ${TIERS.professional.name}: ${TIERS.professional.supportLevel}. ${TIERS.clinic.name}: ${TIERS.clinic.supportLevel}. ${TIERS.enterprise.name}: ${TIERS.enterprise.supportLevel}.`,
  },
];

