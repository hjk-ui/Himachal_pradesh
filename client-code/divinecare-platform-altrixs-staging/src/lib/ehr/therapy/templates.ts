/**
 * The four therapist / counselor templates the clinical director listed:
 *   1. MD Therapy Adult & Child Intake (90791)
 *   2. Substance Abuse Intake (90791)
 *   3. Therapy Progress Adult & Child (90832 / 90834 / 90837; family 90846 / 90847)
 *   4. Treatment Plan (initial and review)
 *
 * Built from the clinic's own forms (2013 Intake Note, Progress Note - Therapy, OMHC Individual
 * Treatment Plan and Treatment Plan Review) plus standard outpatient practice where the forms are
 * silent; `origin` on each field records which. Field order follows the forms where they exist.
 * Simpler than the Word forms: chips and pick-lists instead of free text where the answer is a
 * category, conditional sections (child history only under 18, telehealth fields only for
 * telehealth), and only billing / compliance items are required to sign.
 */
import { SERVICE_FREQUENCIES } from '@/lib/ehr/planLibrary';
import type { FieldDef, SectionDef } from '@/lib/ehr/therapy/engine';
import {
  SUD_INTAKE,
  THERAPY_INTAKE,
  THERAPY_PROGRESS,
  THERAPY_SECTIONS,
  TP,
  TREATMENT_PLAN_SECTIONS,
  TS,
  type TherapyNoteType,
} from '@/lib/ehr/therapy/sections';

// ─── Option lists ───────────────────────────────────────────────────────────

export const REFERRAL_SOURCES = ['Self', 'Family / guardian', 'Primary care', 'Psychiatrist / prescriber', 'School', 'Hospital / ER discharge', 'Court / legal', 'DSS / CPS', 'Insurance / MCO', 'Other'] as const;
export const SYMPTOMS = [
  'Depressed mood',
  'Anxiety / worry',
  'Panic',
  'Sleep problems',
  'Appetite change',
  'Irritability / anger',
  'Mood swings',
  'Trauma symptoms',
  'Attention / concentration',
  'Hyperactivity / impulsivity',
  'Obsessions / compulsions',
  'Hallucinations / unusual thoughts',
  'Behavior problems',
  'Grief',
  'Relationship problems',
  'School / work problems',
] as const;
export const ONSET = ['Less than 1 month', '1–6 months', '6–12 months', 'More than 1 year', 'Since childhood'] as const;
export const SUBSTANCE_USE_STATUS = ['Never', 'Past use', 'Current use'] as const;
export const SCREEN_FOLLOW_UP = ['SUD screener completed', 'Referred for Substance Abuse Intake', 'Not indicated'] as const;
export const TRAUMA_TYPES = ['Physical abuse', 'Sexual abuse', 'Emotional abuse', 'Neglect', 'Domestic violence (witnessed)', 'Intimate partner violence', 'Community violence', 'Traumatic loss', 'Accident / injury', 'Medical trauma', 'Combat / military', 'Bullying', 'Displacement / immigration'] as const;
export const MANDATED_REPORT = ['Not indicated', 'Report made', 'Report pending — supervisor notified'] as const;
export const LIVES_WITH = ['Alone', 'Spouse / partner', 'Parent(s)', 'Children', 'Other relatives', 'Roommates / friends', 'Foster / kinship care', 'Group home / residential', 'Shelter / unhoused'] as const;
export const RELATIONSHIP_STATUS = ['Single', 'Married', 'Partnered', 'Separated', 'Divorced', 'Widowed'] as const;
export const EMPLOYMENT = ['Employed full-time', 'Employed part-time', 'Unemployed', 'Student', 'Retired', 'Disabled', 'Homemaker'] as const;
export const SUPPORTS = ['Family', 'Friends', 'Partner', 'Faith community', 'Peer support / recovery community', 'School staff', 'Other providers', 'Limited supports'] as const;
export const GUARDIANS = ['Mother', 'Father', 'Both parents', 'Grandparent(s)', 'Other relative', 'Foster parent', 'Legal guardian', 'DSS / agency'] as const;
export const CUSTODY = ['Both parents (joint)', 'Mother (sole)', 'Father (sole)', 'Shared — court order', 'Legal guardian', 'DSS custody', 'Unknown'] as const;
export const CONSENT_BY = ['Parent', 'Legal guardian', 'DSS / agency', 'Minor (16+) self-consent — Md. Health-Gen. §20-104'] as const;
export const GRADES = ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Not enrolled'] as const;
export const SCHOOL_SUPPORTS = ['None', 'IEP', '504 plan', 'Evaluation pending'] as const;
export const SCHOOL_CONCERNS = ['Grades declining', 'Attendance / truancy', 'Suspensions / expulsion', 'Behavior at school', 'Bullying', 'Peer problems', 'Learning difficulties'] as const;
export const MILESTONES = ['Met on time', 'Delayed', 'Unknown'] as const;
export const LEGAL_INVOLVEMENT = ['Probation / parole', 'Pending charges', 'Court-ordered treatment', 'Custody case', 'CPS / DSS involvement', 'Juvenile services (DJS)', 'Prior incarceration', 'Protective order'] as const;
export const STRENGTHS = ['Motivated for treatment', 'Insight', 'Family support', 'Social support', 'Employment / school engagement', 'Coping skills', 'Faith / spirituality', 'Stable housing', 'Hobbies / interests', 'Resilience', 'Prior treatment success'] as const;
export const BARRIERS = ['Transportation', 'Cost / insurance', 'Work / school schedule', 'Childcare', 'Limited supports', 'Housing instability', 'Language', 'Stigma', 'Ambivalence about treatment', 'Cognitive / learning'] as const;
export const RISK_LEVELS = ['Low', 'Moderate', 'High'] as const;
export const LEVEL_OF_CARE = ['Outpatient therapy', 'Outpatient therapy + psychiatry', 'Intensive outpatient (IOP)', 'Partial hospitalization (PHP)', 'Inpatient / crisis evaluation', 'PRP (with outpatient)'] as const;
export const SUD_LEVEL_OF_CARE = ['ASAM 0.5 Early intervention', 'ASAM 1 Outpatient', 'ASAM 2.1 Intensive outpatient', 'ASAM 2.5 Partial hospitalization', 'ASAM 3.1 Low-intensity residential', 'ASAM 3.5 High-intensity residential', 'ASAM 3.7 Medically monitored inpatient', 'ASAM 4 Medically managed inpatient', 'OTP / MOUD referral'] as const;
/** Same values as the treatment plan "Service frequency" (session-frequency engine reads these) */
export const THERAPY_FREQUENCIES = SERVICE_FREQUENCIES.filter((f) => ['Weekly', 'Bi-weekly', '2x/week', 'Monthly', 'As needed'].includes(f));
export const MODALITIES = ['CBT', 'DBT skills', 'Motivational interviewing', 'Trauma-focused CBT', 'EMDR', 'Solution-focused', 'Family therapy', 'Play therapy', 'Group therapy', 'Psychoeducation', 'Mindfulness / relaxation', 'Behavioral activation', 'Relapse prevention', 'Supportive therapy'] as const;
export const REFERRALS = ['Psychiatric evaluation / medication management', 'PRP', 'SUD services', 'Primary care', 'Case management', 'Group therapy', 'School-based services', 'Psychological testing', 'Crisis services'] as const;
export const PLAN_TIMING = ['Developed with client today', 'To be completed at next session'] as const;
export const SUBSTANCES = ['Alcohol', 'Cannabis', 'Opioids (heroin / fentanyl)', 'Prescription opioids', 'Cocaine / crack', 'Methamphetamine / stimulants', 'Benzodiazepines', 'Hallucinogens', 'Inhalants', 'Tobacco / nicotine', 'Other'] as const;
export const USE_FREQUENCY = ['Daily', 'Several times a week', 'Weekly', 'Monthly or less', 'Binge pattern', 'In remission'] as const;
export const USE_ROUTE = ['Oral', 'Smoked', 'Vaped', 'Intranasal', 'Injected (IV)', 'Other'] as const;
export const WITHDRAWAL_SYMPTOMS = ['Tremor', 'Sweating', 'Nausea / vomiting', 'Anxiety / agitation', 'Insomnia', 'Seizures', 'Hallucinations', 'DTs', 'Muscle aches', 'Cravings'] as const;
export const WITHDRAWAL_RISK = ['None', 'Low', 'Moderate', 'High — medical evaluation needed'] as const;
export const NALOXONE = ['Has naloxone', 'Provided / prescribed today', 'Education given', 'Declined', 'Not applicable'] as const;
export const SUD_TX_LEVELS = ['Detox / withdrawal management', 'Residential', 'IOP', 'Outpatient', 'MOUD / OTP', 'Self-help (AA / NA)'] as const;
export const PART2_CONSENT = ['Signed — on file', 'Signed today', 'Pending — patient to sign', 'Patient declined disclosure consent'] as const;
export const SESSION_FOCUS_STATUS = ['Improved', 'Unchanged', 'Worse', 'Mixed'] as const;
export const ENGAGEMENT = ['Engaged', 'Partially engaged', 'Guarded', 'Resistant', 'Unable to engage'] as const;
export const NEXT_SESSION = ['1 week', '2 weeks', '3 weeks', '4 weeks', 'As scheduled'] as const;
export const PSYCHOSOCIAL_PROBLEMS = [
  'Problems with primary support group',
  'Problems with natural support',
  'Problems related to the social environment',
  'Education problems',
  'Occupational problems',
  'Housing problems',
  'Economic problems',
  'Problems with access to health care services',
] as const;
export const SERVICE_SETTINGS = ['In person — on site', 'In person — off site', 'Telehealth (video & audio)'] as const;
export const SERVICES = ['Individual therapy', 'Family therapy', 'Group therapy', 'Medication management', 'PRP', 'SUD counseling', 'Case management'] as const;
export const DISCHARGE_GOALS = [
  'Improvement in symptoms',
  'Maintenance of current functioning',
  'Maintenance of current skills',
  'Improvement in functioning',
  'Improvement in skills',
  'Independent ADL / self-help',
  'Medication adherence',
  'Freedom from SI / HI',
  'Freedom from school suspensions',
] as const;
export const DISCHARGE_ACTIONS = ['Reduce OMHC visits', 'Discharge from OMHC', 'Discharge to another OMHC', 'Discharge from PRP', 'Step down to lower level of care'] as const;
export const YES_NO = ['Yes', 'No'] as const;
export const COPY_OFFERED = ['Accepted', 'Declined'] as const;
/** Valant Treatment Plan template participation checkboxes (exact wording). */
export const PLAN_PARTICIPATION = [
  'Patient participated in the development of this treatment plan',
  'Guardian(s) participated in the development of this treatment plan',
  'Guarantor participated in the development of this treatment plan',
] as const;
export const PLAN_KINDS = ['Initial', 'Review'] as const;

// ─── Shared sections ────────────────────────────────────────────────────────

const F = <T extends FieldDef>(f: T) => f;

const sessionSection = (extra: FieldDef[] = []): SectionDef => ({
  heading: TS.session,
  fields: [
    F({ id: 'session', kind: 'widget', widget: 'session', label: 'Session', origin: 'clinic-form' }),
    F({ id: 'personsPresent', kind: 'text', label: 'Persons present', placeholder: 'e.g. client; mother', origin: 'clinic-form', recommended: true }),
    ...extra,
    F({ id: 'patientLocation', kind: 'text', label: 'Patient location during telehealth', when: { telehealth: true }, required: true, placeholder: 'e.g. home in Bowie, MD', origin: 'standard', hint: 'Payers and Maryland telehealth rules require the patient’s location at the time of service.' }),
    F({ id: 'telehealthConsent', kind: 'single', label: 'Telehealth consent', options: ['Verbal consent obtained', 'Written consent on file'], when: { telehealth: true }, required: true, origin: 'clinic-form' }),
  ],
});

/** Identifying Information (shared with the psychiatry intakes; fields and text in src/lib/ehr/identifyingInfo.ts) */
const identifyingSection: SectionDef = {
  heading: TS.identifying,
  fields: [F({ id: 'identifyingInfo', kind: 'widget', widget: 'identifyingInfo', label: 'Identifying information', origin: 'clinic-form' })],
};

const referralSection: SectionDef = {
  heading: TS.referral,
  fields: [
    F({ id: 'referralSource', kind: 'single', label: 'Referral source', options: REFERRAL_SOURCES, other: true, origin: 'clinic-form', recommended: true }),
    F({ id: 'referralReason', kind: 'text', label: 'Reason for referral', origin: 'standard' }),
    F({ id: 'presentingProblem', kind: 'textarea', label: 'Presenting problem (client’s words)', rows: 3, required: true, origin: 'clinic-form', placeholder: 'Quote the client (and parent / guardian for a child)…' }),
  ],
};

const hpiSection: SectionDef = {
  heading: TS.hpi,
  fields: [
    F({ id: 'symptoms', kind: 'multi', label: 'Current symptoms', options: SYMPTOMS, other: true, origin: 'standard', recommended: true }),
    F({ id: 'onset', kind: 'single', label: 'Onset', options: ONSET, origin: 'standard' }),
    F({ id: 'hpiNarrative', kind: 'textarea', label: 'History of present illness', rows: 5, ai: true, bare: true, origin: 'clinic-form', placeholder: 'Onset, course, triggers, functioning at home / school / work, what has helped…' }),
  ],
};

const psychHxSection: SectionDef = {
  heading: TS.psychHx,
  fields: [
    F({ id: 'priorOutpatient', kind: 'tri', label: 'Prior outpatient treatment', detailsLabel: 'Provider / dates / response', origin: 'clinic-form' }),
    F({ id: 'priorInpatient', kind: 'tri', label: 'Psychiatric hospitalizations', detailsLabel: 'Facility / dates / reason', origin: 'clinic-form' }),
    F({ id: 'priorDiagnoses', kind: 'text', label: 'Previous diagnoses', origin: 'clinic-form' }),
    F({ id: 'pastPsychMeds', kind: 'text', label: 'Past psychotropic medications', origin: 'clinic-form' }),
    F({ id: 'selfHarmHx', kind: 'tri', label: 'Self-harm / suicide attempts', detailsLabel: 'When / method / medical care', origin: 'clinic-form', recommended: true }),
  ],
};

const medicalSection: SectionDef = {
  heading: TS.medical,
  fields: [
    F({ id: 'chartMeds', kind: 'widget', widget: 'chartMeds', label: 'Medications & allergies', origin: 'clinic-form' }),
    F({ id: 'medicalConditions', kind: 'text', label: 'Medical conditions', origin: 'clinic-form' }),
    F({ id: 'pcp', kind: 'text', label: 'Primary care provider', origin: 'standard' }),
  ],
};

const traumaSection: SectionDef = {
  heading: TS.trauma,
  fields: [
    F({ id: 'traumaHx', kind: 'tri', label: 'Trauma / abuse history', detailsLabel: 'Brief description (no graphic detail needed)', origin: 'clinic-form', recommended: true }),
    F({ id: 'traumaTypes', kind: 'multi', label: 'Type', options: TRAUMA_TYPES, when: { field: 'traumaHx', is: 'Endorses' }, origin: 'standard' }),
    F({ id: 'currentAbuse', kind: 'tri', label: 'Current abuse / neglect concerns', origin: 'standard' }),
    F({ id: 'mandatedReport', kind: 'single', label: 'Mandated report', options: MANDATED_REPORT, when: { field: 'currentAbuse', is: 'Endorses' }, required: true, origin: 'standard', hint: 'Maryland requires a report to DSS / law enforcement for suspected child abuse or neglect.' }),
  ],
};

const familySocialSection: SectionDef = {
  heading: TS.familySocial,
  fields: [
    F({ id: 'familyMhHx', kind: 'text', label: 'Family mental health / substance history', origin: 'clinic-form' }),
    F({ id: 'livesWith', kind: 'multi', label: 'Lives with', options: LIVES_WITH, origin: 'clinic-form', recommended: true }),
    F({ id: 'relationship', kind: 'single', label: 'Relationship status', options: RELATIONSHIP_STATUS, when: { minor: false }, origin: 'clinic-form' }),
    F({ id: 'employment', kind: 'single', label: 'Employment', options: EMPLOYMENT, when: { minor: false }, origin: 'clinic-form' }),
    F({ id: 'supports', kind: 'multi', label: 'Supports', options: SUPPORTS, origin: 'standard' }),
    F({ id: 'culture', kind: 'text', label: 'Cultural / spiritual considerations', origin: 'standard' }),
    F({ id: 'socialNotes', kind: 'text', label: 'Social history', origin: 'clinic-form' }),
  ],
};

const childSection: SectionDef = {
  heading: TS.child,
  when: { minor: true },
  intro: 'Shown because the client is under 18.',
  fields: [
    F({ id: 'guardians', kind: 'multi', label: 'Parent(s) / guardian(s)', options: GUARDIANS, required: true, origin: 'standard' }),
    F({ id: 'custody', kind: 'single', label: 'Legal custody', options: CUSTODY, required: true, origin: 'standard' }),
    F({ id: 'consentBy', kind: 'single', label: 'Consent for treatment given by', options: CONSENT_BY, required: true, origin: 'standard' }),
    F({ id: 'school', kind: 'text', label: 'School', origin: 'clinic-form' }),
    F({ id: 'grade', kind: 'single', label: 'Grade', options: GRADES, origin: 'clinic-form' }),
    F({ id: 'schoolSupports', kind: 'single', label: 'IEP / 504', options: SCHOOL_SUPPORTS, origin: 'clinic-form' }),
    F({ id: 'schoolConcerns', kind: 'multi', label: 'School concerns', options: SCHOOL_CONCERNS, origin: 'clinic-form' }),
    F({ id: 'milestones', kind: 'single', label: 'Developmental milestones', options: MILESTONES, origin: 'clinic-form' }),
    F({ id: 'birthHx', kind: 'tri', label: 'Pregnancy / birth complications', origin: 'clinic-form' }),
    F({ id: 'devNotes', kind: 'text', label: 'Developmental / academic notes', origin: 'clinic-form' }),
  ],
};

const legalSection: SectionDef = {
  heading: TS.legal,
  fields: [
    F({ id: 'legalHx', kind: 'tri', label: 'Legal involvement', origin: 'clinic-form' }),
    F({ id: 'legalTypes', kind: 'multi', label: 'Involvement', options: LEGAL_INVOLVEMENT, when: { field: 'legalHx', is: 'Endorses' }, origin: 'standard' }),
  ],
};

const strengthsSection: SectionDef = {
  heading: TS.strengths,
  fields: [
    F({ id: 'strengths', kind: 'multi', label: 'Strengths', options: STRENGTHS, other: true, origin: 'clinic-form', recommended: true }),
    F({ id: 'barriers', kind: 'multi', label: 'Barriers to treatment', options: BARRIERS, other: true, origin: 'standard' }),
  ],
};

const mseSection = (recommended: boolean): SectionDef => ({
  heading: TS.mse,
  fields: [F({ id: 'mse', kind: 'widget', widget: 'mse', label: 'Mental status exam', origin: 'clinic-form', ...(recommended ? { recommended: true } : { required: true }) })],
});

/** Risk: SI / HI screen; any SI → C-SSRS screener; positive or High → safety plan. */
const riskFields = (): FieldDef[] => [
  F({ id: 'si', kind: 'tri', label: 'Suicidal ideation', required: true, origin: 'clinic-form' }),
  F({ id: 'hi', kind: 'tri', label: 'Homicidal ideation', required: true, origin: 'clinic-form' }),
  F({ id: 'selfHarm', kind: 'tri', label: 'Current self-harm', origin: 'standard' }),
  F({ id: 'cssrs', kind: 'widget', widget: 'cssrs', label: 'C-SSRS screener', when: { field: 'si', is: 'Endorses' }, required: true, origin: 'standard' }),
  F({ id: 'riskLevel', kind: 'single', label: 'Overall risk level', options: RISK_LEVELS, warn: ['Moderate', 'High'], required: true, origin: 'standard' }),
  F({ id: 'riskRationale', kind: 'text', label: 'Risk formulation', when: { field: 'riskLevel', is: ['Moderate', 'High'] }, recommended: true, origin: 'standard' }),
  // Required (sign rule) when the C-SSRS screen is positive or risk is High; offered for Moderate
  F({ id: 'safetyPlan', kind: 'widget', widget: 'safetyPlan', label: 'Safety plan', origin: 'standard' }),
];

const diagnosesSection = (sud: boolean): SectionDef => ({
  heading: TS.diagnoses,
  fields: [
    F({ id: 'diagnoses', kind: 'widget', widget: 'diagnoses', label: 'Diagnoses', required: true, origin: 'clinic-form', hint: sud ? 'Substance use disorders are F10–F19.' : undefined }),
    F({ id: 'formulation', kind: 'textarea', label: 'Clinical formulation', rows: 3, origin: 'clinic-form', recommended: true }),
  ],
});

const recommendationsSection = (sud: boolean): SectionDef => ({
  heading: TS.recommendations,
  fields: [
    F({ id: 'levelOfCare', kind: 'single', label: 'Recommended level of care', options: sud ? SUD_LEVEL_OF_CARE : LEVEL_OF_CARE, required: true, origin: 'standard' }),
    F({ id: 'frequency', kind: 'single', label: 'Recommended session frequency', options: THERAPY_FREQUENCIES, required: true, origin: 'standard', hint: 'Carried into the treatment plan’s service frequency (session-frequency tracking).' }),
    F({ id: 'modalities', kind: 'multi', label: 'Planned modalities', options: MODALITIES, origin: 'standard' }),
    F({ id: 'referrals', kind: 'multi', label: 'Referrals', options: REFERRALS, other: true, origin: 'clinic-form' }),
    F({ id: 'planTiming', kind: 'single', label: 'Treatment plan', options: PLAN_TIMING, recommended: true, origin: 'standard', hint: 'A treatment plan is required before progress notes can be signed.' }),
    F({ id: 'recommendationNotes', kind: 'text', label: 'Other recommendations', origin: 'clinic-form' }),
  ],
});

const initialGoalsSection: SectionDef = {
  heading: TS.initialGoals,
  intro: 'Goals in the client’s words. They pre-fill the treatment plan.',
  fields: [
    F({
      id: 'initialGoals',
      kind: 'rows',
      label: 'Initial goals',
      columns: [
        { key: 'goal', label: 'Goal', placeholder: 'In the client’s words' },
        { key: 'target', label: 'Target', placeholder: 'e.g. 90 days' },
      ],
      addLabel: 'Add goal',
      recommended: true,
      origin: 'standard',
    }),
  ],
};

const reviewSection: SectionDef = { heading: TS.review, fields: [] };

// ─── 1. MD Therapy Adult & Child Intake ─────────────────────────────────────

const substanceScreenSection: SectionDef = {
  heading: TS.substanceScreen,
  intro: 'Brief screen. Any current use → consider an AUDIT / DAST-10 / CAGE-AID screen or the Substance Abuse Intake.',
  fields: [
    F({ id: 'alcohol', kind: 'single', label: 'Alcohol', options: SUBSTANCE_USE_STATUS, warn: ['Current use'], required: true, origin: 'clinic-form' }),
    F({ id: 'cannabis', kind: 'single', label: 'Cannabis', options: SUBSTANCE_USE_STATUS, warn: ['Current use'], required: true, origin: 'clinic-form' }),
    F({ id: 'tobacco', kind: 'single', label: 'Tobacco / nicotine', options: SUBSTANCE_USE_STATUS, warn: ['Current use'], origin: 'clinic-form' }),
    F({ id: 'otherDrugs', kind: 'single', label: 'Other drugs / misuse of prescriptions', options: SUBSTANCE_USE_STATUS, warn: ['Current use'], required: true, origin: 'clinic-form' }),
    F({ id: 'useDetails', kind: 'text', label: 'Details', origin: 'clinic-form' }),
    F({ id: 'screenFollowUp', kind: 'single', label: 'Follow-up', options: SCREEN_FOLLOW_UP, origin: 'standard' }),
  ],
};

export const SUD_SCREEN_POSITIVE_FIELDS = ['alcohol', 'cannabis', 'otherDrugs'] as const;

const therapyIntakeSections: SectionDef[] = [
  sessionSection(),
  identifyingSection,
  referralSection,
  hpiSection,
  psychHxSection,
  substanceScreenSection,
  medicalSection,
  traumaSection,
  familySocialSection,
  childSection,
  legalSection,
  strengthsSection,
  mseSection(false),
  { heading: TS.risk, fields: riskFields() },
  diagnosesSection(false),
  recommendationsSection(false),
  initialGoalsSection,
  reviewSection,
];

// ─── 2. Substance Abuse Intake ──────────────────────────────────────────────

const sudSections: SectionDef[] = [
  sessionSection(),
  identifyingSection,
  referralSection,
  hpiSection,
  {
    heading: TS.substanceHx,
    fields: [
      F({
        id: 'substanceTable',
        kind: 'rows',
        label: 'Substances',
        columns: [
          { key: 'substance', label: 'Substance', options: SUBSTANCES },
          { key: 'ageFirst', label: 'Age of first use', kind: 'number' },
          { key: 'lastUse', label: 'Last use', placeholder: 'date or "2 days ago"' },
          { key: 'frequency', label: 'Frequency', options: USE_FREQUENCY },
          { key: 'route', label: 'Route', options: USE_ROUTE },
          { key: 'amount', label: 'Amount', placeholder: 'e.g. 6 beers / day' },
        ],
        addLabel: 'Add substance',
        noneLabel: 'No substance use reported',
        required: true,
        origin: 'standard',
      }),
      F({ id: 'primarySubstance', kind: 'text', label: 'Primary substance of concern', origin: 'standard' }),
      F({ id: 'consequences', kind: 'multi', label: 'Consequences', options: ['Work / school problems', 'Legal / DUI', 'Relationship conflict', 'Financial', 'Health problems', 'Blackouts', 'Tolerance', 'Unable to cut down', 'Risky use'], origin: 'standard' }),
    ],
  },
  {
    heading: TS.withdrawal,
    fields: [
      F({ id: 'withdrawalHx', kind: 'tri', label: 'Withdrawal history', origin: 'standard', required: true }),
      F({ id: 'withdrawalSymptoms', kind: 'multi', label: 'Withdrawal symptoms', options: WITHDRAWAL_SYMPTOMS, when: { field: 'withdrawalHx', is: 'Endorses' }, origin: 'standard' }),
      F({ id: 'withdrawalRisk', kind: 'single', label: 'Current withdrawal risk', options: WITHDRAWAL_RISK, warn: ['Moderate', 'High — medical evaluation needed'], required: true, origin: 'standard' }),
      F({ id: 'overdoseHx', kind: 'tri', label: 'Overdose history', detailsLabel: 'Number / most recent / substance', required: true, origin: 'standard' }),
      F({ id: 'naloxone', kind: 'single', label: 'Naloxone', options: NALOXONE, origin: 'standard' }),
    ],
  },
  {
    heading: TS.sudTxHx,
    fields: [
      F({
        id: 'sudTreatment',
        kind: 'rows',
        label: 'Prior SUD treatment',
        columns: [
          { key: 'level', label: 'Level', options: SUD_TX_LEVELS },
          { key: 'program', label: 'Program' },
          { key: 'dates', label: 'Dates' },
          { key: 'outcome', label: 'Outcome', options: ['Completed', 'Left early', 'Ongoing', 'Unknown'] },
        ],
        addLabel: 'Add treatment episode',
        noneLabel: 'No prior SUD treatment',
        origin: 'standard',
      }),
      F({ id: 'longestSobriety', kind: 'text', label: 'Longest period of abstinence', origin: 'standard' }),
    ],
  },
  {
    heading: TS.screening,
    intro: 'Enter scores from screens done today or recorded in the chart (Assessments › SUD screeners).',
    fields: [
      F({ id: 'auditScore', kind: 'number', label: 'AUDIT score (0–40)', origin: 'standard' }),
      F({ id: 'dastScore', kind: 'number', label: 'DAST-10 score (0–10)', origin: 'standard' }),
      F({ id: 'cageAidScore', kind: 'number', label: 'CAGE-AID score (0–4)', origin: 'standard' }),
    ],
  },
  {
    heading: TS.asam,
    intro: 'Rate each dimension 0 (no risk) to 4 (severe). The suggested level is decision support only.',
    fields: [
      F({ id: 'asam', kind: 'widget', widget: 'asam', label: 'ASAM dimensions', required: true, origin: 'standard' }),
    ],
  },
  psychHxSection,
  medicalSection,
  traumaSection,
  familySocialSection,
  childSection,
  legalSection,
  strengthsSection,
  mseSection(false),
  { heading: TS.risk, fields: riskFields() },
  diagnosesSection(true),
  {
    heading: TS.part2,
    intro: 'This note is saved as 42 CFR Part 2 protected. Disclosure outside the program needs the patient’s written consent.',
    fields: [
      F({ id: 'part2Consent', kind: 'single', label: 'Part 2 disclosure consent', options: PART2_CONSENT, required: true, origin: 'standard' }),
      F({ id: 'part2Notice', kind: 'single', label: 'Part 2 notice given to patient', options: YES_NO, required: true, origin: 'standard' }),
    ],
  },
  recommendationsSection(true),
  initialGoalsSection,
  reviewSection,
];

// ─── 3. Therapy Progress Adult & Child ──────────────────────────────────────

const progressSections: SectionDef[] = [
  sessionSection([
    F({ id: 'overrideReason', kind: 'text', label: 'Code override reason', origin: 'standard', hint: 'Required when the service code differs from the time rule.' }),
  ]),
  {
    heading: TS.planGoals,
    intro: 'Goals from the client’s active treatment plan. Mark progress on each goal worked on today.',
    fields: [F({ id: 'planGoals', kind: 'widget', widget: 'planGoals', label: 'Goal progress', required: true, origin: 'clinic-form' })],
  },
  {
    heading: TS.interval,
    fields: [
      F({ id: 'symptomStatus', kind: 'single', label: 'Target symptoms since last session', options: SESSION_FOCUS_STATUS, warn: ['Worse'], origin: 'clinic-form', recommended: true }),
      F({ id: 'interval', kind: 'textarea', label: 'Interval history', rows: 4, ai: true, bare: true, required: true, origin: 'clinic-form', placeholder: 'What the client reported this session, events since last visit, homework follow-up…' }),
    ],
  },
  {
    heading: TS.interventions,
    fields: [
      F({ id: 'modalitiesUsed', kind: 'multi', label: 'Interventions used', options: MODALITIES, other: true, required: true, origin: 'clinic-form' }),
      F({ id: 'interventionDetail', kind: 'textarea', label: 'Intervention detail', rows: 3, origin: 'clinic-form', recommended: true }),
    ],
  },
  mseSection(true),
  { heading: TS.riskCheck, fields: riskFields() },
  {
    heading: TS.response,
    fields: [
      F({ id: 'engagement', kind: 'single', label: 'Engagement', options: ENGAGEMENT, origin: 'standard', recommended: true }),
      F({ id: 'responseText', kind: 'textarea', label: 'Response to interventions', rows: 3, required: true, origin: 'clinic-form' }),
    ],
  },
  {
    heading: TS.impression,
    fields: [F({ id: 'impression', kind: 'textarea', label: 'Impression', rows: 2, bare: true, origin: 'clinic-form' })],
  },
  {
    heading: TS.planNext,
    fields: [
      F({ id: 'nextSession', kind: 'single', label: 'Next session', options: NEXT_SESSION, required: true, origin: 'clinic-form' }),
      F({ id: 'homework', kind: 'text', label: 'Homework', origin: 'standard' }),
      F({ id: 'planText', kind: 'textarea', label: 'Plan', rows: 2, origin: 'clinic-form' }),
    ],
  },
  reviewSection,
];

// ─── 4. Treatment Plan ──────────────────────────────────────────────────────

export const TREATMENT_PLAN_TEMPLATE: SectionDef[] = [
  {
    heading: TP.details,
    fields: [
      F({ id: 'planKind', kind: 'single', label: 'Plan type', options: PLAN_KINDS, required: true, origin: 'clinic-form' }),
      F({ id: 'serviceSetting', kind: 'single', label: 'Service setting', options: SERVICE_SETTINGS, required: true, origin: 'clinic-form' }),
      F({ id: 'tpTelehealthConsent', kind: 'single', label: 'Verbal consent obtained for telehealth', options: YES_NO, when: { field: 'serviceSetting', is: 'Telehealth (video & audio)' }, required: true, origin: 'clinic-form' }),
      // Valant Treatment Plan template: Start Date (required) and Effective Until
      F({ id: 'startDate', kind: 'date', label: 'Start Date', required: true, origin: 'clinic-form' }),
      F({ id: 'effectiveUntil', kind: 'date', label: 'Effective Until', origin: 'clinic-form' }),
    ],
  },
  {
    heading: TP.problems,
    fields: [
      F({ id: 'diagnoses', kind: 'widget', widget: 'diagnoses', label: 'Diagnoses', required: true, origin: 'clinic-form' }),
      F({ id: 'dxChanged', kind: 'single', label: 'Changes in diagnoses at this time', options: YES_NO, when: { field: 'planKind', is: 'Review' }, origin: 'clinic-form' }),
      F({ id: 'psychosocial', kind: 'multi', label: 'Psychosocial problems', options: PSYCHOSOCIAL_PROBLEMS, origin: 'clinic-form' }),
      F({ id: 'presentingNeeds', kind: 'textarea', label: 'Presenting needs / problems', rows: 3, required: true, origin: 'clinic-form' }),
    ],
  },
  {
    heading: TP.strengths,
    fields: [
      F({ id: 'tpStrengths', kind: 'textarea', label: 'Strengths (as stated by client)', rows: 2, required: true, origin: 'clinic-form' }),
      F({ id: 'tpAbilities', kind: 'text', label: 'Abilities (as stated by client)', origin: 'clinic-form' }),
      F({ id: 'tpWeaknesses', kind: 'text', label: 'Weaknesses / barriers (as stated by client)', origin: 'clinic-form' }),
      F({ id: 'tpPreferences', kind: 'text', label: 'Client’s expectations / preferences for treatment', origin: 'clinic-form' }),
      F({ id: 'tpResponsibilities', kind: 'text', label: 'Client’s responsibilities in recovery', origin: 'clinic-form' }),
      F({ id: 'tpProgress', kind: 'textarea', label: 'Progress since the last plan', rows: 2, when: { field: 'planKind', is: 'Review' }, required: true, origin: 'clinic-form' }),
    ],
  },
  {
    heading: TP.goals,
    intro: 'Problem → Goal → Objective → Intervention (Valant template). Goals in the client’s words; objectives measurable with a target date; interventions under the objective they serve.',
    fields: [F({ id: 'tpGoals', kind: 'widget', widget: 'tpGoals', label: 'Goals', required: true, origin: 'clinic-form' })],
  },
  {
    heading: TP.services,
    fields: [
      F({ id: 'tpFrequency', kind: 'single', label: 'Individual therapy frequency', options: THERAPY_FREQUENCIES, required: true, origin: 'clinic-form', hint: 'Drives session-frequency tracking.' }),
      F({
        id: 'tpServices',
        kind: 'rows',
        label: 'Services this authorization period',
        columns: [
          { key: 'service', label: 'Service', options: SERVICES },
          { key: 'perMonth', label: 'Sessions / month', kind: 'number' },
          { key: 'provider', label: 'Provider' },
        ],
        addLabel: 'Add service',
        origin: 'clinic-form',
      }),
      F({ id: 'tpLevelOfCare', kind: 'single', label: 'Level of care', options: ['Outpatient', 'Intensive Outpatient', 'Partial Hospitalization', 'Community-based'], origin: 'standard' }),
    ],
  },
  {
    heading: TP.discharge,
    fields: [
      F({ id: 'dischargeGoals', kind: 'multi', label: 'Discharge / recovery goals', options: DISCHARGE_GOALS, other: true, required: true, origin: 'clinic-form' }),
      F({ id: 'dischargeAction', kind: 'single', label: 'Planned transition', options: DISCHARGE_ACTIONS, origin: 'clinic-form' }),
      F({ id: 'dischargeDate', kind: 'date', label: 'Anticipated transition date', when: { field: 'dischargeAction', notEmpty: true }, origin: 'clinic-form' }),
      F({ id: 'tpReferrals', kind: 'text', label: 'Referrals / recommendations to other programs', origin: 'clinic-form' }),
    ],
  },
  {
    heading: TP.instructions,
    fields: [
      F({ id: 'patientInstructions', kind: 'textarea', label: 'Patient Instructions', rows: 3, origin: 'clinic-form' }),
      F({ id: 'globalComments', kind: 'textarea', label: 'Global Comments', rows: 3, origin: 'clinic-form' }),
    ],
  },
  {
    heading: TP.reviewDate,
    fields: [F({ id: 'reviewDate', kind: 'date', label: 'Next plan review date', required: true, origin: 'clinic-form', hint: 'Clinic form: 3 months for a child, 6 months for an adult.' })],
  },
  {
    heading: TP.participation,
    fields: [
      F({ id: 'clientParticipated', kind: 'single', label: 'Client actively participated in planning', options: YES_NO, required: true, origin: 'clinic-form' }),
      F({ id: 'caregiverParticipated', kind: 'single', label: 'Caregiver participated in planning', options: YES_NO, when: { minor: true }, required: true, origin: 'clinic-form' }),
      F({ id: 'clientAgreed', kind: 'single', label: 'Client verbalized agreement with the plan', options: YES_NO, origin: 'clinic-form' }),
      F({ id: 'copyOffered', kind: 'single', label: 'Copy of plan explained and offered', options: COPY_OFFERED, origin: 'clinic-form' }),
      // Valant Treatment Plan template checkboxes (printed on the plan)
      F({ id: 'tpParticipation', kind: 'multi', label: 'Participation', options: PLAN_PARTICIPATION, origin: 'clinic-form' }),
    ],
  },
];

// ─── Registry ───────────────────────────────────────────────────────────────

export type TherapyTemplate = {
  type: TherapyNoteType;
  sections: readonly SectionDef[];
  /** Service codes offered (only these, from the CPT catalog) */
  codes: readonly string[];
  /** Psychotherapy time rule applies (code picked from start / end time) */
  timeBased: boolean;
  /** Sections offered for "Bring forward" from the most recent note of the same type */
  carryForward: readonly string[];
  /** Sections where AI can draft from dictation */
  aiSections: readonly string[];
  /** Part 2 protected note */
  part2: boolean;
};

const HISTORY_CARRY = [TS.psychHx, TS.medical, TS.trauma, TS.familySocial, TS.child, TS.legal];

export const THERAPY_TEMPLATES: Record<TherapyNoteType, TherapyTemplate> = {
  [THERAPY_INTAKE]: {
    type: THERAPY_INTAKE,
    sections: therapyIntakeSections,
    codes: ['90791'],
    timeBased: false,
    carryForward: HISTORY_CARRY,
    aiSections: [TS.hpi],
    part2: false,
  },
  [SUD_INTAKE]: {
    type: SUD_INTAKE,
    sections: sudSections,
    codes: ['90791'],
    timeBased: false,
    carryForward: [TS.substanceHx, TS.sudTxHx, ...HISTORY_CARRY],
    aiSections: [TS.hpi],
    part2: true,
  },
  [THERAPY_PROGRESS]: {
    type: THERAPY_PROGRESS,
    sections: progressSections,
    codes: ['90832', '90834', '90837', '90846', '90847'],
    timeBased: true,
    carryForward: [TS.planNext],
    aiSections: [TS.interval],
    part2: false,
  },
};

/** Headings in the template definitions match sections.ts (checked by tests). */
export function templateHeadings(type: TherapyNoteType): string[] {
  return THERAPY_TEMPLATES[type].sections.map((s) => s.heading);
}

export { THERAPY_SECTIONS, TREATMENT_PLAN_SECTIONS };
