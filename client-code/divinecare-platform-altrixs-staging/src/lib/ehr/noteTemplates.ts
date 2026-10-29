/**
 * Clinical note types + section field sets for Progress Notes.
 * Subtitle order is source of truth for New Note dropdown.
 */
import {
  IDENTIFYING_INFO,
  SUD_INTAKE,
  THERAPY_INTAKE,
  THERAPY_NOTE_ALIASES,
  THERAPY_NOTE_LABELS,
  THERAPY_NOTE_TYPES,
  THERAPY_PROGRESS,
  THERAPY_SECTIONS,
  TS,
} from '@/lib/ehr/therapy/sections';

export const NOTE_TYPES = [
  // Therapist / counselor templates (clinical director's list) first: most notes are therapy notes
  THERAPY_INTAKE,
  SUD_INTAKE,
  THERAPY_PROGRESS,
  'SOAP',
  'DAP',
  'BIRP',
  'GIRP',
  'PIE',
  'PIRP',
  'CBT',
  'DBT',
  'MFT',
  'EMDR',
  'Intake',
  'Psych Eval',
  'Med Mgmt',
  'Psych Med Mgmt',
  'Child Psych Initial Intake',
  'Child Psych Intake',
  'Adult Psych Intake',
  'Adult Psych Re-Eval',
  'SUD',
  // Program contacts (PRP specialist / peer support): not SUD, not 42 CFR Part 2 by type
  'PRP',
  'Peer Support',
  'Group',
  'Crisis',
  'Collateral',
  'Telephone',
  'No-Show',
  'Discharge',
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_LABELS: Record<NoteType, string> = {
  ...THERAPY_NOTE_LABELS,
  SOAP: 'SOAP Note',
  DAP: 'DAP Note',
  BIRP: 'BIRP Note',
  GIRP: 'GIRP Note',
  PIE: 'PIE Note',
  PIRP: 'PIRP Note',
  CBT: 'CBT Session Note',
  DBT: 'DBT Session Note',
  MFT: 'Marriage & Family Therapy',
  EMDR: 'EMDR Note',
  Intake: 'Clinical Intake Assessment',
  'Psych Eval': 'Psychiatric Evaluation',
  'Med Mgmt': 'Medication Management',
  'Psych Med Mgmt': 'Psychiatric Med Management',
  'Child Psych Initial Intake': 'Child Psychiatry Intake',
  /** Stored key kept from when this was the only child template (Valant 46444, re-evaluation) */
  'Child Psych Intake': 'Child Psychiatry Re-Eval',
  'Adult Psych Intake': 'Adult Psychiatry Intake',
  'Adult Psych Re-Eval': 'Adult Psychiatry Re-Eval',
  SUD: 'SUD / Substance Use Note',
  PRP: 'PRP Progress Note',
  'Peer Support': 'Peer Support Contact Note',
  Group: 'Group Therapy Note',
  Crisis: 'Crisis Intervention Note',
  Collateral: 'Collateral Contact Note',
  Telephone: 'Telephone Encounter',
  'No-Show': 'No-Show / Missed Appointment',
  Discharge: 'Discharge Summary',
};

/**
 * Short type text for note-list badges. Defaults to the stored key; the child templates
 * differ because the key 'Child Psych Intake' predates the separate initial intake (18772)
 * and stays on the re-evaluation (46444) so saved notes keep opening with it.
 */
const NOTE_BADGES: Partial<Record<NoteType, string>> = {
  'Child Psych Initial Intake': 'Child Psych Intake',
  'Child Psych Intake': 'Child Psych Re-Eval',
};
export function noteTypeBadge(type: string): string {
  return NOTE_BADGES[type as NoteType] ?? type;
}

/** EMDR protocol phases (source New Note select). */
export const EMDR_PHASES = [
  '1 — History Taking',
  '2 — Preparation',
  '3 — Assessment',
  '4 — Desensitization',
  '5 — Installation',
  '6 — Body Scan',
  '7 — Closure',
  '8 — Reevaluation',
] as const;

export function normalizeNoteType(value: string): string {
  const v = value.trim();
  for (const type of THERAPY_NOTE_TYPES) {
    if (THERAPY_NOTE_ALIASES[type].some((alias) => alias.toLowerCase() === v.toLowerCase())) return type;
  }
  if (v === 'Group' || v === 'Group Note' || v === 'Group Therapy') return 'Group';
  if (v === 'Intake Assessment' || v === 'Intake' || v === 'Clinical Intake Assessment') return 'Intake';
  if (
    v === 'NoShow' ||
    v === 'No Show' ||
    v === 'No-Show' ||
    v === 'Missed Appointment' ||
    v === 'No-Show / Missed Appointment'
  )
    return 'No-Show';
  if (v === 'Psychiatric Evaluation' || v === 'PsychEval') return 'Psych Eval';
  if (v === 'Medication Management' || v === 'MedMgmt') return 'Med Mgmt';
  if (
    v === 'Psychiatric Med Management' ||
    v === 'Psychiatric Medication Management' ||
    v === 'PsychMedMgmt'
  )
    return 'Psych Med Mgmt';
  // Valant 18772 (initial evaluation). 'Child Psychiatry Intake' meant the 46444 template
  // only as a label; stored notes use the 'Child Psych Intake' key, which still maps below.
  if (
    v === 'Child Psychiatry Intake' ||
    v === 'Child Psychiatry Intake Note' ||
    v === 'MD Health - Child Psychiatry Intake Note'
  )
    return 'Child Psych Initial Intake';
  // Valant 46444 (re-evaluation): stored key 'Child Psych Intake' + its old and new labels
  if (
    v === 'Child Psychiatry Re-Eval' ||
    v === 'Child Psych Re-Eval' ||
    v === 'Child Psychiatry Intake / Re-Eval' ||
    v === 'Child Psychiatry Intake Note for Re-Eval' ||
    v === 'MD Health - Child Psychiatry Intake Note for Re-Eval'
  )
    return 'Child Psych Intake';
  if (
    v === 'Adult Psychiatry Intake' ||
    v === 'Adult Psychiatry Intake Note' ||
    v === 'MD Health - Adult Psychiatry Intake Note'
  )
    return 'Adult Psych Intake';
  if (
    v === 'Adult Psychiatry Re-Eval' ||
    v === 'Adult Psychiatry Intake Note for Re-Eval' ||
    v === 'MD Health - Adult Psychiatry Intake Note for Re-Eval'
  )
    return 'Adult Psych Re-Eval';
  if (v === 'SubstanceAbuse' || v === 'Substance Abuse') return 'SUD';
  if (v === 'Discharge Summary') return 'Discharge';
  if (v === 'Telehealth Progress' || v === 'Telephone Encounter') return 'Telephone';
  if (v === 'Family Therapy') return 'MFT';
  if (v === 'Crisis Note' || v === 'Crisis Intervention Note' || v === 'Crisis Intervention') return 'Crisis';
  if (v === 'Collateral Contact' || v === 'Collateral Contact Note' || v === 'Collateral Note') return 'Collateral';
  // PRP and peer support contacts are program notes, not SUD notes (which would also flag Part 2)
  if (v === 'PRP Rehabilitation' || v === 'PRP Progress Note' || v === 'PRP Note' || v === 'PRP Service' || v === 'Psychiatric Rehabilitation') return 'PRP';
  if (v === 'Peer Support Contact' || v === 'Peer Support Contact Note' || v === 'Peer Support Note' || v === 'Peer Recovery Support') return 'Peer Support';
  if (v === 'Care Coordination' || v === 'Consultation Note') return 'Telephone';
  if (v === 'Supervision Note' || v === 'Administrative Note') return 'SOAP';
  return v.replace(/^(SOAP|DAP|BIRP|GIRP|PIE|PIRP|CBT|DBT|MFT|EMDR) Note$/, '$1');
}

export const NOTE_SECTIONS: Record<NoteType, readonly string[]> = {
  ...THERAPY_SECTIONS,
  SOAP: ['Subjective', 'Objective', 'Assessment', 'Plan'],
  DAP: ['Data', 'Assessment', 'Plan'],
  BIRP: ['Behavior', 'Intervention', 'Response', 'Plan'],
  GIRP: ['Goals', 'Intervention', 'Response', 'Plan'],
  PIE: ['Problem', 'Intervention', 'Evaluation'],
  PIRP: ['Problem', 'Intervention', 'Response', 'Plan'],
  CBT: [
    'Session Focus',
    'Automatic Thoughts / Cognitions',
    'Cognitive Interventions',
    'Behavioral Experiments',
    'Homework',
    'Plan',
  ],
  DBT: [
    'Target Behaviors',
    'Skills Used',
    'Diary Card Review',
    'Chain Analysis / Contingencies',
    'Plan',
  ],
  MFT: ['Participants', 'Systemic Assessment', 'Intervention', 'Response', 'Plan'],
  EMDR: [
    'Phase',
    'Target Memory / Image',
    'Negative / Positive Cognition',
    'SUDS / VoC',
    'Processing Notes',
    'Installation / Body Scan',
    'Closure',
    'Plan',
  ],
  Intake: [
    IDENTIFYING_INFO,
    'Chief Complaint / Reason for Referral',
    'History of Present Illness',
    'Psychiatric History',
    'Medical / Substance History',
    'Psychosocial History',
    'Mental Status Exam',
    'Risk Assessment',
    'Diagnostic Impression',
    'Treatment Recommendations',
  ],
  'Psych Eval': [
    IDENTIFYING_INFO,
    'Chief Complaint',
    'History of Present Illness',
    'Psychiatric History',
    'Medical / Substance History',
    'Mental Status Exam',
    'Risk Assessment',
    'Diagnosis',
    'Plan',
  ],
  'Med Mgmt': [
    'Interval History',
    'Current Medications',
    'Side Effects / Tolerability',
    'Mental Status',
    'Assessment',
    'Plan',
  ],
  /** Valant template 21774 order — do not reorder (prescribers expect this sequence). */
  'Psych Med Mgmt': [
    'Header',
    'History of Present Illness/Interval History',
    'Free Form Content',
    'Exam',
    'Measure Review',
    'Suicidal Ideation',
    'Suicide Prevention Plan',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Side Effects',
    'Lab Results',
    'Plan - Labs Ordered',
    'Plan',
    'Plan - Med Changes',
    'Plan - Next Appointment',
    'Review',
  ],
  /**
   * Valant template 18772 "MD Health - Child Psychiatry Intake Note" (initial evaluation), in
   * Valant's order from the owner's screenshots: the 46444 re-eval list without
   * 'History of Present Illness/Interval History'.
   */
  'Child Psych Initial Intake': [
    'Header',
    IDENTIFYING_INFO,
    'Chief Complaint',
    'HPI',
    'Inpatient Hx',
    'Outpatient Hx',
    'Suicide/Self-Harm Hx',
    'Psychiatric Med Hx',
    'Abuse',
    'Past Medical Hx',
    'Menstruation and Pregnancy Hx',
    'Patient Allergies',
    'Substance Use Hx',
    'Substance Use Consequences',
    'Substance Treatment Hx',
    'Family Hx',
    'Family Relationships',
    'Developmental and Educational Hx',
    'General Social Hx',
    'Legal History',
    'Violence Hx',
    'Trauma/Stressors',
    'Stressors',
    'Review of Systems',
    'Exam',
    'Assessment - Sources of Risk',
    'Suicide Risk Factors',
    'Suicide Protective Factors',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Plan',
    'Plan - Med Changes',
    'Plan - Next Appointment',
    'Review',
  ],
  /**
   * Valant template 46444 "MD Health - Child Psychiatry Intake Note for Re-Eval" (Child Psychiatry
   * Re-Eval; stored key 'Child Psych Intake'), in Valant's order
   * (confirmed against the owner's screenshots: 'Patient Allergies' is followed by 'Substance Use Hx').
   */
  'Child Psych Intake': [
    'Header',
    IDENTIFYING_INFO,
    'Chief Complaint',
    'HPI',
    'History of Present Illness/Interval History',
    'Inpatient Hx',
    'Outpatient Hx',
    'Suicide/Self-Harm Hx',
    'Psychiatric Med Hx',
    'Abuse',
    'Past Medical Hx',
    'Menstruation and Pregnancy Hx',
    'Patient Allergies',
    'Substance Use Hx',
    'Substance Use Consequences',
    'Substance Treatment Hx',
    'Family Hx',
    'Family Relationships',
    'Developmental and Educational Hx',
    'General Social Hx',
    'Legal History',
    'Violence Hx',
    'Trauma/Stressors',
    'Stressors',
    'Review of Systems',
    'Exam',
    'Assessment - Sources of Risk',
    'Suicide Risk Factors',
    'Suicide Protective Factors',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Plan',
    'Plan - Med Changes',
    'Plan - Next Appointment',
    'Review',
  ],
  /**
   * Valant template 18771 "MD Health - Adult Psychiatry Intake Note", in Valant's order.
   * Saved notes keep working if a heading is removed later: an unknown heading's text is kept.
   */
  'Adult Psych Intake': [
    'Header',
    IDENTIFYING_INFO,
    'Chief Complaint',
    'HPI',
    'Inpatient Hx',
    'Outpatient Hx',
    'Suicide/Self-Harm Hx',
    'Psychiatric Med Hx',
    'Abuse',
    'Past Medical Hx',
    'Menstruation and Pregnancy Hx',
    'Patient Allergies',
    'Substance Use Hx',
    // unconfirmed in Valant 18771 screenshot (cut off between Substance Use Hx and Substance
    // Treatment Hx); kept to match the child template. Remove this line if Valant 18771 lacks it.
    // The owner's Valant 22019 (adult re-eval) screenshot shows it after Substance Use Hx in this
    // template family, but only the owner can confirm 18771 itself.
    'Substance Use Consequences',
    'Substance Treatment Hx',
    'Family Hx',
    'Family Relationships',
    'Developmental and Educational Hx',
    'General Social Hx',
    'Legal History',
    'Violence Hx',
    'Stressors',
    'Review of Systems',
    'Exam',
    'Assessment - Sources of Risk',
    'Suicide Risk Factors',
    'Suicide Protective Factors',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Plan',
    'Plan - Med Changes',
    'Plan - Next Appointment',
    'Review',
  ],
  /**
   * Valant template 22019 "MD Health - Adult Psychiatry Intake Note for Re-Eval", in Valant's order
   * (confirmed against the owner's screenshot, incl. Substance Use Consequences after Substance Use Hx).
   */
  'Adult Psych Re-Eval': [
    'Header',
    IDENTIFYING_INFO,
    'Chief Complaint',
    'HPI',
    'History of Present Illness/Interval History',
    'Inpatient Hx',
    'Outpatient Hx',
    'Suicide/Self-Harm Hx',
    'Psychiatric Med Hx',
    'Abuse',
    'Past Medical Hx',
    'Menstruation and Pregnancy Hx',
    'Patient Allergies',
    'Substance Use Hx',
    'Substance Use Consequences',
    'Substance Treatment Hx',
    'Family Hx',
    'Family Relationships',
    'Free Form Content',
    'Developmental and Educational Hx',
    'General Social Hx',
    'Legal History',
    'Violence Hx',
    'Stressors',
    'Review of Systems',
    'Exam',
    'Assessment - Sources of Risk',
    'Suicide Risk Factors',
    'Suicide Protective Factors',
    'Measure Review',
    'Assessment - Diagnoses',
    'Meds & Allergies',
    'Plan',
    'Plan - Med Changes',
    'Plan - Labs Ordered',
    'Plan - Next Appointment',
    'Review',
  ],
  SUD: [
    'Substance Use History',
    'Current Use / Amount',
    'Cravings & Triggers',
    'Interventions',
    'Relapse Prevention',
    'ASAM Level of Care',
    'Plan',
  ],
  // PRP service contact (COMAR 10.63 PRP): service type + onsite / offsite, IRP goal, intervention, response
  PRP: ['Service Type & Location', 'IRP Goal Addressed', 'Intervention', 'Participant Response', 'Plan', 'Next Contact'],
  'Peer Support': ['Contact Type & Location', 'Recovery Goal Addressed', 'Peer Support Provided', 'Participant Response', 'Plan', 'Next Contact'],
  Group: ['Group Topic / Focus', 'Interventions', 'Participation', 'Individual Response', 'Plan'],
  Crisis: ['Presenting Crisis', 'Risk Assessment', 'Interventions', 'Disposition / Safety Plan', 'Follow-up'],
  Collateral: [
    'Collateral Contact',
    'Relationship to Client',
    'Release of Information',
    'Purpose of Contact',
    'Information Exchanged',
    'Plan',
  ],
  Telephone: ['Caller / Relationship', 'Reason for Call', 'Discussion', 'Clinical Decision', 'Follow-up'],
  'No-Show': ['Scheduled Appointment', 'Contact Attempts', 'Risk Review', 'Follow-up Plan'],
  Discharge: [
    'Reason for Discharge',
    'Treatment Summary',
    'Progress Toward Goals',
    'Medications at Discharge',
    'Aftercare Plan',
  ],
};

/** Child Psychiatry Intake (18772); the re-eval (46444) adds interval-history wording below. */
const CHILD_INTAKE_PLACEHOLDERS: Record<string, string> = {
  Header: 'Patient, informants, date of service, provider, location, visit type, time and service code…',
  'Chief Complaint': 'Reason for evaluation in the patient’s / guardian’s words…',
  HPI: 'Onset, course, symptoms, functioning at home and school, precipitants…',
  'Inpatient Hx': 'Additional inpatient history…',
  'Outpatient Hx': 'Additional outpatient history…',
  'Suicide/Self-Harm Hx': 'Additional detail…',
  'Psychiatric Med Hx': 'Additional medication-trial detail…',
  Abuse: 'Additional detail…',
  'Past Medical Hx': 'Medical conditions, surgeries, head injury, seizures, hospitalizations…',
  'Menstruation and Pregnancy Hx': 'Additional detail…',
  'Patient Allergies': 'Allergy comments…',
  'Substance Use Hx': 'Additional detail…',
  'Substance Use Consequences': 'Additional detail…',
  'Substance Treatment Hx': 'Additional detail…',
  'Family Hx': 'Additional family psychiatric / medical history…',
  'Family Relationships': 'Additional detail…',
  'Developmental and Educational Hx': 'Additional detail…',
  'General Social Hx': 'Additional detail…',
  'Legal History': 'Additional detail…',
  'Violence Hx': 'Additional detail…',
  'Trauma/Stressors': 'Additional detail…',
  Stressors: 'Current stressors…',
  'Review of Systems': 'Additional ROS detail…',
  Exam: 'Mental status exam…',
  'Assessment - Sources of Risk': 'Comment…',
  'Suicide Risk Factors': 'Comment…',
  'Suicide Protective Factors': 'Comment…',
  'Assessment - Diagnoses': 'Clinical formulation…',
  'Meds & Allergies': 'Reconciliation comments…',
  Plan: 'Overall plan: therapy, school coordination, referrals, education, crisis plan…',
  'Plan - Med Changes': 'Rationale, risks/benefits/alternatives discussed with patient and guardian, consent/assent…',
  'Plan - Next Appointment': 'Follow-up comments…',
  Review: 'Optional review comments…',
};

/** Free-text placeholders for the therapist templates (each section also has its own fields). */
const THERAPY_PLACEHOLDERS: Record<string, string> = {
  [TS.session]: 'Anything else about the session (interpreter used, collateral contact)…',
  [TS.referral]: 'Additional referral detail…',
  [TS.hpi]: 'Additional detail…',
  [TS.psychHx]: 'Additional psychiatric history…',
  [TS.substanceScreen]: 'Additional detail…',
  [TS.substanceHx]: 'Pattern of use, cravings, triggers…',
  [TS.withdrawal]: 'Additional detail…',
  [TS.sudTxHx]: 'Additional detail…',
  [TS.screening]: 'Interpretation of the screening scores…',
  [TS.asam]: 'Placement rationale…',
  [TS.medical]: 'Additional medical history…',
  [TS.trauma]: 'Additional detail…',
  [TS.familySocial]: 'Additional detail…',
  [TS.child]: 'Additional detail (school, development, custody)…',
  [TS.legal]: 'Additional detail…',
  [TS.strengths]: 'Strengths and barriers in the client’s words…',
  [TS.mse]: 'Additional observations…',
  [TS.risk]: 'Additional risk detail, protective factors…',
  [TS.riskCheck]: 'Additional risk detail…',
  [TS.diagnoses]: 'Rule-outs, differential…',
  [TS.part2]: 'Consent detail (recipients, purpose, expiration)…',
  [TS.recommendations]: 'Additional recommendations…',
  [TS.initialGoals]: 'Additional goal detail…',
  [TS.planGoals]: 'Additional comments on treatment plan progress…',
  [TS.interval]: 'Additional detail…',
  [TS.interventions]: 'Additional detail…',
  [TS.response]: 'Additional detail…',
  [TS.impression]: 'Clinical impression of today’s session…',
  [TS.planNext]: 'Coordination of care, referrals…',
  [TS.review]: 'Optional review comments…',
};

/** Per-field placeholders matching source clinical note UX. */
export const NOTE_PLACEHOLDERS: Record<NoteType, Record<string, string>> = {
  [THERAPY_INTAKE]: THERAPY_PLACEHOLDERS,
  [SUD_INTAKE]: THERAPY_PLACEHOLDERS,
  [THERAPY_PROGRESS]: THERAPY_PLACEHOLDERS,
  SOAP: {
    Subjective: 'Client reports… mood, sleep, appetite, stressors, SI/HI screen…',
    Objective: 'Appearance, MSE, affect, speech, insight/judgment…',
    Assessment: 'Clinical formulation, diagnosis justification, risk level…',
    Plan: 'Interventions this session, homework, follow-up, referrals…',
  },
  DAP: {
    Data: 'Observable data and client statements from session…',
    Assessment: 'Clinical interpretation of data and progress…',
    Plan: 'Next steps, homework, coordination…',
  },
  BIRP: {
    Behavior: 'Observed / reported behaviors relevant to treatment goals…',
    Intervention: 'Modalities and techniques used in session…',
    Response: 'Client response to interventions…',
    Plan: 'Plan for next contact and between-session work…',
  },
  GIRP: {
    Goals: 'Treatment goals addressed this encounter…',
    Intervention: 'Interventions applied toward goals…',
    Response: 'Client response and measurable progress…',
    Plan: 'Plan to advance goals next session…',
  },
  PIE: {
    Problem: 'Presenting problem / focus of care…',
    Intervention: 'Actions taken to address the problem…',
    Evaluation: 'Outcome / status after intervention…',
  },
  PIRP: {
    Problem: 'Presenting problem / focus of today’s session…',
    Intervention: 'Clinician interventions used (modality, techniques)…',
    Response: 'Client’s response to the interventions…',
    Plan: 'Homework, next session, referrals…',
  },
  CBT: {
    'Session Focus': 'Agenda and primary cognitive-behavioral targets…',
    'Automatic Thoughts / Cognitions': 'Identified automatic thoughts, core beliefs, distortions…',
    'Cognitive Interventions': 'Restructuring, thought records, evidence examination…',
    'Behavioral Experiments': 'Exposure, BA tasks, experiments planned or completed…',
    Homework: 'Assigned practice and tracking…',
    Plan: 'Focus for next CBT session…',
  },
  DBT: {
    'Target Behaviors': 'Life-threatening, therapy-interfering, quality-of-life targets…',
    'Skills Used': 'Mindfulness, distress tolerance, emotion regulation, interpersonal…',
    'Diary Card Review': 'Urges, emotions, skills practice since last session…',
    'Chain Analysis / Contingencies': 'Vulnerability factors, prompting events, links, consequences…',
    Plan: 'Skill practice commitments and next targets…',
  },
  MFT: {
    Participants: 'Who attended (client, partner, family members)…',
    'Systemic Assessment': 'Interaction patterns, alliances, systemic hypotheses…',
    Intervention: 'Relational interventions used…',
    Response: 'System / member responses…',
    Plan: 'Homework for the system and next session focus…',
  },
  EMDR: {
    Phase: 'Select EMDR phase (or describe phase work completed)…',
    'Target Memory / Image': 'Target memory, worst image, emotions, body location…',
    'Negative / Positive Cognition': 'NC / PC statements…',
    'SUDS / VoC': 'Pre/post SUDS (0–10) and VoC (1–7)…',
    'Processing Notes': 'Sets, channels, cognitive interweaves, blocked processing…',
    'Installation / Body Scan': 'Installation of PC; residual body sensation…',
    Closure: 'Stabilization, safe place, end-of-session state…',
    Plan: 'Next target / reevaluation plan…',
  },
  Intake: {
    'Chief Complaint / Reason for Referral': 'Presenting problem in the client’s own words; referral source…',
    'History of Present Illness': 'Onset, duration, symptoms, prior treatment…',
    'Psychiatric History': 'Prior diagnoses, hospitalizations, outpatient treatment, medication trials…',
    'Medical / Substance History': 'Medical conditions, current meds, allergies, substance use…',
    'Psychosocial History': 'Family, housing, employment/school, legal, supports, trauma history…',
    'Mental Status Exam': 'Appearance, mood/affect, thought process/content, cognition, insight/judgment…',
    'Risk Assessment': 'SI/HI, self-harm history, protective factors, safety plan…',
    'Diagnostic Impression': 'DSM-5 considerations, rule-outs, ICD-10 codes…',
    'Treatment Recommendations': 'Level of care, frequency, modalities, referrals…',
  },
  'Psych Eval': {
    'Chief Complaint': 'Reason for evaluation in client’s words…',
    'History of Present Illness': 'Onset, course, severity, precipitants…',
    'Psychiatric History': 'Prior diagnoses, hospitalizations, treatments…',
    'Medical / Substance History': 'Medical conditions, meds, substance use…',
    'Mental Status Exam': 'Appearance, mood/affect, thought, cognition, insight…',
    'Risk Assessment': 'SI/HI, self-harm, protective factors, disposition…',
    Diagnosis: 'DSM diagnoses / ICD-10 with clinical rationale…',
    Plan: 'Level of care, referrals, meds, follow-up…',
  },
  'Med Mgmt': {
    'Interval History': 'Interval symptoms, adherence, functional status…',
    'Current Medications': 'Name, dose, frequency, indication…',
    'Side Effects / Tolerability': 'Reported AEs, labs, vitals as indicated…',
    'Mental Status': 'Focused MSE for med visit…',
    Assessment: 'Response to treatment, diagnosis stability…',
    Plan: 'Continue / adjust / taper; labs; return interval…',
  },
  'Psych Med Mgmt': {
    Header: 'Patient, date of service, provider, location, visit type, time and E/M code…',
    'History of Present Illness/Interval History':
      'Interval symptoms since last visit, response to medications, adherence, sleep, appetite, functioning, stressors…',
    'Free Form Content': 'Any additional content for this visit…',
    Exam: 'Mental status exam…',
    'Measure Review': 'Comment on rating-scale trends…',
    'Suicidal Ideation': 'Additional risk assessment detail…',
    'Suicide Prevention Plan': 'Safety plan reviewed / updated with patient…',
    'Assessment - Diagnoses': 'Clinical formulation and response to treatment…',
    'Meds & Allergies': 'Reconciliation comments…',
    'Side Effects': 'Additional side-effect detail…',
    'Lab Results': 'Interpretation of results…',
    'Plan - Labs Ordered': 'Other labs or monitoring…',
    Plan: 'Overall plan: psychotherapy, referrals, coordination, education, crisis plan…',
    'Plan - Med Changes': 'Rationale, risks/benefits/alternatives discussed, consent…',
    'Plan - Next Appointment': 'Follow-up comments…',
    Review: 'Optional review comments (care coordination, supervision, patient questions)…',
  },
  'Child Psych Initial Intake': CHILD_INTAKE_PLACEHOLDERS,
  'Child Psych Intake': {
    ...CHILD_INTAKE_PLACEHOLDERS,
    Header: 'Patient, evaluation type, prior evaluation, informants, date of service, provider, location, visit type, time and service code…',
    'Chief Complaint': 'Reason for re-evaluation in the patient’s / guardian’s words…',
    HPI: 'Current presentation: symptoms, functioning at home and school, precipitants, current treatment…',
    'History of Present Illness/Interval History': 'What changed since the prior evaluation (school, family / home, symptoms, medications, hospitalizations / ER, substance use, safety)…',
    'Suicide/Self-Harm Hx': 'Additional detail (including any events since the prior evaluation)…',
    'Assessment - Diagnoses': 'Clinical formulation and change since the prior evaluation…',
  },
  'Adult Psych Intake': {
    Header: 'Patient, history sources, date of service, provider, location, visit type, time and service code…',
    'Chief Complaint': 'Reason for evaluation in the patient’s own words…',
    HPI: 'Onset, course, symptoms, functioning at work and home, precipitants, current treatment…',
    'Inpatient Hx': 'Additional inpatient history…',
    'Outpatient Hx': 'Additional outpatient history…',
    'Suicide/Self-Harm Hx': 'Additional detail…',
    'Psychiatric Med Hx': 'Additional medication-trial detail…',
    Abuse: 'Additional detail…',
    'Past Medical Hx': 'Medical conditions, surgeries, head injury, seizures, hospitalizations…',
    'Menstruation and Pregnancy Hx': 'Additional detail (relevant to prescribing)…',
    'Patient Allergies': 'Allergy comments…',
    'Substance Use Hx': 'Additional detail…',
    'Substance Use Consequences': 'Additional detail…',
    'Substance Treatment Hx': 'Additional detail…',
    'Family Hx': 'Additional family psychiatric / medical history…',
    'Family Relationships': 'Additional detail…',
    'Developmental and Educational Hx': 'Additional detail…',
    'General Social Hx': 'Additional detail…',
    'Legal History': 'Additional detail…',
    'Violence Hx': 'Additional detail…',
    Stressors: 'Current stressors and trauma history…',
    'Review of Systems': 'Additional ROS detail…',
    Exam: 'Mental status exam…',
    'Assessment - Sources of Risk': 'Comment…',
    'Suicide Risk Factors': 'Comment…',
    'Suicide Protective Factors': 'Comment…',
    'Assessment - Diagnoses': 'Clinical formulation…',
    'Meds & Allergies': 'Reconciliation comments…',
    Plan: 'Overall plan: therapy, referrals, coordination, education, crisis plan…',
    'Plan - Med Changes': 'Rationale, risks/benefits/alternatives discussed, consent…',
    'Plan - Next Appointment': 'Follow-up comments…',
    Review: 'Optional review comments…',
  },
  'Adult Psych Re-Eval': {
    Header: 'Patient, evaluation type, prior evaluation, history sources, date of service, provider, location, visit type, time and service code…',
    'Chief Complaint': 'Reason for re-evaluation in the patient’s own words…',
    HPI: 'Current presentation: symptoms, functioning at work and home, precipitants, current treatment…',
    'History of Present Illness/Interval History': 'What changed since the prior evaluation…',
    'Inpatient Hx': 'Additional inpatient history…',
    'Outpatient Hx': 'Additional outpatient history…',
    'Suicide/Self-Harm Hx': 'Additional detail (including any events since the prior evaluation)…',
    'Psychiatric Med Hx': 'Additional medication-trial detail…',
    Abuse: 'Additional detail…',
    'Past Medical Hx': 'Medical conditions, surgeries, head injury, seizures, hospitalizations…',
    'Menstruation and Pregnancy Hx': 'Additional detail (relevant to prescribing)…',
    'Patient Allergies': 'Allergy comments…',
    'Substance Use Hx': 'Additional detail…',
    'Substance Use Consequences': 'Additional detail…',
    'Substance Treatment Hx': 'Additional detail…',
    'Family Hx': 'Additional family psychiatric / medical history…',
    'Family Relationships': 'Additional detail…',
    'Free Form Content': 'Any additional content for this re-evaluation…',
    'Developmental and Educational Hx': 'Additional detail…',
    'General Social Hx': 'Additional detail…',
    'Legal History': 'Additional detail…',
    'Violence Hx': 'Additional detail…',
    Stressors: 'Current stressors and trauma history…',
    'Review of Systems': 'Additional ROS detail…',
    Exam: 'Mental status exam…',
    'Assessment - Sources of Risk': 'Comment…',
    'Suicide Risk Factors': 'Comment…',
    'Suicide Protective Factors': 'Comment…',
    'Measure Review': 'Comment on rating-scale change since the prior evaluation…',
    'Assessment - Diagnoses': 'Clinical formulation and change since the prior evaluation…',
    'Meds & Allergies': 'Reconciliation comments…',
    Plan: 'Overall plan: therapy, referrals, coordination, education, crisis plan…',
    'Plan - Med Changes': 'Rationale, risks/benefits/alternatives discussed, consent…',
    'Plan - Labs Ordered': 'Other labs or monitoring…',
    'Plan - Next Appointment': 'Follow-up comments…',
    Review: 'Optional review comments…',
  },
  SUD: {
    'Substance Use History': 'Primary substances, pattern, prior treatment…',
    'Current Use / Amount': 'Recent use, amount, route, last use…',
    'Cravings & Triggers': 'Craving intensity, triggers, coping used…',
    Interventions: 'MI, CBT-SUD, contingency, psychoeducation…',
    'Relapse Prevention': 'High-risk situations and plan…',
    'ASAM Level of Care': 'Select the ASAM level of care…',
    Plan: 'Next session, supports, toxicology as indicated…',
  },
  PRP: {
    'Service Type & Location': 'Optional: setting details beyond the PRP contact fields above (contact type, location and times are recorded there)…',
    'IRP Goal Addressed': 'Optional: current issues addressed, in your words (select the IRP objectives above)…',
    Intervention: 'Narrative: skill taught, practiced or coached; supports provided (pick the intervention types above)…',
    'Participant Response': 'How the participant engaged and responded; progress toward the goal…',
    Plan: 'What the participant will practice; staff follow-up; any concern escalated to the clinician…',
    'Next Contact': 'Next PRP contact (the next booked appointment and Book follow-up are above)…',
  },
  'Peer Support': {
    'Contact Type & Location': 'In person / phone / community; where; start and end time…',
    'Recovery Goal Addressed': 'Recovery or treatment plan goal the contact supported…',
    'Peer Support Provided': 'Shared experience, navigation, advocacy, linkage, skill support…',
    'Participant Response': 'How the participant engaged and responded…',
    Plan: 'Follow-up actions; any concern escalated to the clinician the same day…',
    'Next Contact': 'Date / type of the next peer contact…',
  },
  Group: {
    'Group Topic / Focus': 'Theme / curriculum for today’s group…',
    Interventions: 'Facilitation techniques and skills taught…',
    Participation: 'Level and quality of participation…',
    'Individual Response': 'Client-specific response and peer interactions…',
    Plan: 'Practice assignments and next group focus…',
  },
  Crisis: {
    'Presenting Crisis': 'What happened, who initiated contact, current situation in the client’s words…',
    'Risk Assessment': 'C-SSRS (or equivalent) findings: ideation, intent, plan, means, behavior, protective factors…',
    Interventions: 'De-escalation, safety planning, means counseling, contacts made…',
    'Disposition / Safety Plan': 'Disposition (home with safety plan, mobile crisis, ED, 988…) and the safety plan reviewed…',
    'Follow-up': 'Next contact, who was notified, supervisor consulted…',
  },
  Collateral: {
    'Collateral Contact': 'Name of the person contacted…',
    'Purpose of Contact': 'Why the contact was made…',
    'Information Exchanged': 'Minimum necessary information shared and received…',
    Plan: 'Follow-up actions…',
  },
  Telephone: {
    'Caller / Relationship': 'e.g. Client, Parent, Case Manager…',
    'Reason for Call': 'Who initiated and reason for contact…',
    Discussion: 'Clinical content reviewed (no unnecessary PHI in SMS)…',
    'Clinical Decision': 'Assessment and decisions made…',
    'Follow-up': 'Return call, appointment, crisis resources…',
  },
  'No-Show': {
    'Scheduled Appointment': 'Date/time and type of the missed appointment…',
    'Contact Attempts': 'Date/time of each call attempt, voicemails left, portal messages sent…',
    'Risk Review': 'Clinical risk reviewed given the missed visit; supervisor notified if indicated…',
    'Follow-up Plan': 'Rescheduled date, outreach plan, no-show policy steps…',
  },
  Discharge: {
    'Reason for Discharge': 'Goals met, relocation, against advice, transfer…',
    'Treatment Summary': 'Course of care and modalities used…',
    'Progress Toward Goals': 'Outcome vs. treatment plan goals…',
    'Medications at Discharge': 'Current psychotropic regimen…',
    'Aftercare Plan': 'Referrals, appointments, crisis plan, resources…',
  },
};

export function noteTemplate(type: NoteType) {
  return NOTE_SECTIONS[type].map((heading) => `${heading}\n`).join('\n');
}

export function sectionPlaceholder(type: NoteType, heading: string): string {
  return NOTE_PLACEHOLDERS[type]?.[heading] || `Document ${heading.toLowerCase()}…`;
}

export function structuredNoteSections(
  type: string,
  body: string,
): { title: string; text: string }[] {
  const normalized = normalizeNoteType(type) as NoteType;
  const headings = NOTE_SECTIONS[normalized];
  if (!headings) return [{ title: 'Clinical Documentation', text: body }];
  const sections: { title: string; text: string }[] = [];
  let current: { title: string; text: string } | undefined;
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const headingLine = line
      .trim()
      .replace(/^#{1,3}\s*/, '')
      .replace(/^[A-Z]\s*[-–:]\s*/, '')
      .replace(/:$/, '');
    const heading = headings.find((item) => item.toLowerCase() === headingLine.toLowerCase());
    if (heading) {
      current = { title: heading, text: '' };
      sections.push(current);
    } else if (current) current.text += `${line}\n`;
    else if (line.trim()) {
      current = { title: 'Clinical Documentation', text: `${line}\n` };
      sections.push(current);
    }
  }
  return sections.map((section) => ({ ...section, text: section.text.trim() }));
}

export function isSudNote(type: string, flagged = false) {
  const n = normalizeNoteType(type);
  return flagged || n === 'SUD' || n === SUD_INTAKE || /\bsud\b|substance use|substance abuse|chemical dependency/i.test(type);
}

export function hasNoteContent(type: string, body: string) {
  return structuredNoteSections(type, body).some((section) => section.text.trim().length > 0);
}

/** ASAM Criteria levels of care (SUD notes). */
export const ASAM_LEVELS = [
  '0.5 — Early Intervention',
  '1 — Outpatient Services',
  '2.1 — Intensive Outpatient',
  '2.5 — Partial Hospitalization',
  '3.1 — Clinically Managed Low-Intensity Residential',
  '3.3 — Clinically Managed Population-Specific High-Intensity Residential',
  '3.5 — Clinically Managed High-Intensity Residential',
  '3.7 — Medically Monitored Intensive Inpatient',
  '4 — Medically Managed Intensive Inpatient',
  'OTP — Opioid Treatment Program',
] as const;

/**
 * Sections rendered as a single-line input or a select instead of a textarea.
 * They are still stored as ordinary sections of the note body.
 */
/** Collateral contact note: release of information status (checked before signing). */
export const ROI_STATUS = [
  'ROI on file',
  'Client present and gave verbal consent (documented)',
  'Emergency: disclosure permitted without authorization',
  'Not on file',
] as const;

export const COLLATERAL_RELATIONSHIPS = [
  'Parent / guardian',
  'Spouse / partner',
  'Other family',
  'School staff',
  'Primary care / other provider',
  'Case manager / care coordinator',
  'Probation / court',
  'DSS / CPS',
  'Other',
] as const;

export const NOTE_FIELD_INPUTS: Record<
  string,
  { kind: 'select'; options: readonly string[] } | { kind: 'input' }
> = {
  'ASAM Level of Care': { kind: 'select', options: ASAM_LEVELS },
  'Relationship to Client': { kind: 'select', options: COLLATERAL_RELATIONSHIPS },
  'Release of Information': { kind: 'select', options: ROI_STATUS },
  'Collateral Contact': { kind: 'input' },
  'Caller / Relationship': { kind: 'input' },
  'Scheduled Appointment': { kind: 'input' },
};

/** Metadata decoded from the legacy hidden comment. */
export type NoteMetadata = {
  noteType: string | null;
  durationMinutes: number | null;
  billingCode?: string | null;
  telehealth?: boolean;
  placeOfService?: string | null;
  sudConfidential?: boolean;
};

const LEGACY_META_RE = /<!--ehr\s+([^>]*?)-->/;

/**
 * @deprecated Legacy body format. New notes store metadata in ProgressNote
 * columns and must not call this; kept so tests can build legacy fixtures.
 */
export function encodeNoteBody(body: string, meta: NoteMetadata): string {
  const safe = (value: string) => value.replace(/["<>]/g, '');
  return `<!--ehr type="${safe(meta.noteType || 'SOAP')}" duration="${meta.durationMinutes ?? 50}" cpt="${safe(meta.billingCode || '')}" telehealth="${meta.telehealth === true}" pos="${safe(meta.placeOfService || '11')}" part2="${meta.sudConfidential === true}"-->\n${body}`;
}

/**
 * Decode the hidden metadata comment that older notes carry at the top of
 * ProgressNote.body. New notes store metadata in ProgressNote columns and never
 * write this comment; this stays for reading legacy rows.
 */
export function parseNoteMeta(body: string): NoteMetadata & { displayBody: string } {
  const match = body.match(LEGACY_META_RE);
  if (!match) return { noteType: null, durationMinutes: null, displayBody: body };
  const attrs = Object.fromEntries(
    [...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  return {
    noteType: attrs.type || null,
    durationMinutes: /^\d+$/.test(attrs.duration || '') ? Number(attrs.duration) : null,
    billingCode: attrs.cpt || null,
    telehealth: attrs.telehealth === 'true',
    placeOfService: attrs.pos || null,
    sudConfidential: attrs.part2 === 'true',
    displayBody: body.replace(match[0], '').trimStart(),
  };
}

/** Body without the legacy metadata comment. */
export function stripLegacyMeta(body: string): string {
  return parseNoteMeta(body).displayBody;
}

/**
 * Older notes had addenda appended to their own body ("--- ADDENDUM (...) ---").
 * Addenda now live in ProgressNoteAddendum; strip any legacy block (and
 * everything after it) when reusing a note's text.
 */
export function stripLegacyAddenda(body: string): string {
  const idx = body.search(/\n*--- ADDENDUM \([^)]*\) ---/);
  return idx === -1 ? body : body.slice(0, idx).trimEnd();
}
