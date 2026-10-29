/**
 * Visit Guide protocols: one per VisitKind. Ordered steps across prepare / during / wrap_up.
 *
 * Steps are prompts, not findings. 'note' steps name a real section of the protocol's note type
 * (NOTE_SECTIONS, checked by tests); 'auto' steps are checked against the chart by the loader
 * (ids in AUTO_STEP_IDS); 'manual' steps are ticked by the clinician (visit_checklist_items).
 * Every `basis` id exists in REQUIREMENTS (checked by tests).
 */
import type { ProtocolStep, VisitKind, VisitProtocol } from './types';

type Phase = 'prepare' | 'during' | 'wrap_up';
type Entry = { phase: Phase; step: ProtocolStep };

/** Step ids the loader can verify from the chart. An 'auto' step must use one of these ids. */
export const AUTO_STEP_IDS = [
  'cssrs',
  'measures',
  'substance_screen',
  'aims',
  'sdoh',
  'safety_plan',
  'pdmp',
  'telehealth_consent',
  'part2_consent',
  'guardian_consent',
  'treatment_consent',
  'follow_up_booked',
  'labs_reviewed',
  'pending_renewals',
  'treatment_plan_current',
  // Primary care (src/lib/medical/primaryCareGuide.ts)
  'rooming_complete',
  'vitals',
  'pc_screenings',
  'care_gaps',
] as const;
export type AutoStepId = (typeof AUTO_STEP_IDS)[number];

const prep = (step: ProtocolStep): Entry => ({ phase: 'prepare', step });
const during = (step: ProtocolStep): Entry => ({ phase: 'during', step });
const wrap = (step: ProtocolStep): Entry => ({ phase: 'wrap_up', step });

// ─── Shared steps ────────────────────────────────────────────────────────────

const reviewBrief = (): ProtocolStep => ({
  id: 'review_brief',
  label: 'Review the briefing',
  help: 'Changes since the last visit, scores, risk, open follow-ups and care-team notes.',
  level: 'recommended',
  source: 'manual',
});

const reviewPlan = (): ProtocolStep => ({
  id: 'treatment_plan_current',
  label: 'Treatment plan current',
  help: 'An active plan on file and its review date not passed.',
  level: 'recommended',
  source: 'auto',
  action: { kind: 'treatment_plan' },
  basis: ['treatment_plan_review'],
});

const labsReviewed = (): ProtocolStep => ({
  id: 'labs_reviewed',
  label: 'Lab results reviewed',
  help: 'No resulted lab orders waiting for your review; check monitoring labs due.',
  level: 'recommended',
  source: 'auto',
  action: { kind: 'labs' },
  basis: ['ada_apa_metabolic'],
});

const pendingRenewals = (): ProtocolStep => ({
  id: 'pending_renewals',
  label: 'Refill requests handled',
  help: 'Pending pharmacy refill requests in DrFirst.',
  level: 'recommended',
  source: 'auto',
  action: { kind: 'drfirst', screen: 'message' },
});

const cssrs = (level: ProtocolStep['level'] = 'required'): ProtocolStep => ({
  id: 'cssrs',
  label: 'C-SSRS screen',
  help: 'Recorded today. If positive: risk assessment, safety plan, 988.',
  level,
  source: 'auto',
  action: { kind: 'assessment', instrument: 'C-SSRS' },
  basis: ['tjc_suicide_screen'],
});

const measures = (level: ProtocolStep['level'] = 'recommended'): ProtocolStep => ({
  id: 'measures',
  label: 'PHQ-9 / GAD-7',
  help: 'Given today or within the practice interval; use the scores in the plan.',
  level,
  source: 'auto',
  action: { kind: 'assessment', instrument: 'PHQ-9' },
  basis: ['tjc_mbc'],
});

const safetyPlan = (): ProtocolStep => ({
  id: 'safety_plan',
  label: 'Safety plan on file and reviewed',
  help: 'Moderate / high risk: review or create the Stanley-Brown plan with the client.',
  level: 'required',
  source: 'auto',
  when: 'elevated_risk',
  action: { kind: 'safety_plan' },
  basis: ['tjc_suicide_screen'],
});

const telehealthConsent = (): ProtocolStep => ({
  id: 'telehealth_consent',
  label: 'Telehealth consent on file',
  level: 'required',
  source: 'auto',
  when: 'telehealth',
  action: { kind: 'consents', template: 'telehealth-consent' },
  basis: ['telehealth_consent_location'],
});

const telehealthLocation = (): ProtocolStep => ({
  id: 'telehealth_location',
  label: 'Patient location and state',
  help: 'Where the patient is (home / other) and the state; video or audio-only.',
  level: 'required',
  source: 'manual',
  when: 'telehealth',
  basis: ['telehealth_consent_location'],
});

const guardianConsent = (): ProtocolStep => ({
  id: 'guardian_consent',
  label: 'Minor consent / guardian on file',
  help: 'Who consented (minor 16+ or parent / guardian) and guardian involvement.',
  level: 'required',
  source: 'auto',
  when: 'minor',
  action: { kind: 'consents', template: 'minor-consent-treatment' },
  basis: ['minor_consent_md'],
});

const medRec = (): ProtocolStep => ({
  id: 'med_rec',
  label: 'Medication reconciliation',
  help: 'Confirm what the patient actually takes (incl. OTC / supplements) against the list; fix differences.',
  level: 'required',
  source: 'manual',
  action: { kind: 'drfirst', screen: 'manage_medications' },
  basis: ['tjc_med_rec'],
});

const pdmp = (): ProtocolStep => ({
  id: 'pdmp',
  label: 'PDMP (CRISP) checked',
  help: 'Required before starting and every 90 days on an opioid or benzodiazepine; attest in the note.',
  level: 'required',
  source: 'auto',
  when: 'controlled_meds',
  audiences: ['prescriber', 'medical'],
  basis: ['md_pdmp'],
});

/** Behavioral health prescriber visits: the step records the CRISP query (marylandPdmpAudit) in one click */
const pdmpBh = (): ProtocolStep => ({ ...pdmp(), action: { kind: 'pdmp_attest' } });

const controlledRx = (): ProtocolStep => ({
  id: 'controlled_rx_rules',
  label: 'Controlled Rx rules',
  help: 'Sent electronically (EPCS); if this is telehealth, confirm the DEA telemedicine rule allows it.',
  level: 'required',
  source: 'manual',
  when: 'controlled_meds',
  audiences: ['prescriber', 'medical'],
  action: { kind: 'drfirst', screen: 'patient' },
  basis: ['md_epcs', 'dea_telehealth'],
});

const aims = (): ProtocolStep => ({
  id: 'aims',
  label: 'AIMS (movement exam)',
  help: 'On an antipsychotic: baseline, then every 6 months.',
  level: 'recommended',
  source: 'auto',
  when: 'antipsychotic',
  action: { kind: 'assessment', instrument: 'AIMS' },
  basis: ['apa_aims'],
});

const metabolicVitals = (): ProtocolStep => ({
  id: 'vitals_metabolic',
  label: 'Weight / BMI and blood pressure',
  help: 'On an antipsychotic: record in Vitals; order glucose / A1c and lipids when due.',
  level: 'recommended',
  source: 'manual',
  when: 'antipsychotic',
  action: { kind: 'labs' },
  basis: ['ada_apa_metabolic', 'hedis_ssd', 'hedis_apm'],
});

const newMedConsent = (): ProtocolStep => ({
  id: 'med_consent',
  label: 'Informed consent for new medication',
  help: 'Benefits, risks / side effects, boxed warning, alternatives; patient or guardian agrees.',
  level: 'required',
  source: 'manual',
  when: 'new_med',
  action: { kind: 'consents', template: 'psychiatric-medication-consent' },
  basis: ['informed_consent_psychotropic'],
});

const followUpBooked = (weeks?: number): ProtocolStep => ({
  id: 'follow_up_booked',
  label: 'Next visit booked',
  level: 'recommended',
  source: 'auto',
  action: { kind: 'book_follow_up', ...(weeks ? { weeks } : {}) },
});

const afterVisitSummary = (): ProtocolStep => ({
  id: 'after_visit_summary',
  label: 'After-visit summary given',
  help: 'Plan, medication changes and crisis line (988) in plain language.',
  level: 'recommended',
  source: 'manual',
});

const note = (id: string, label: string, noteSection: string, level: ProtocolStep['level'] = 'required', extra: Partial<ProtocolStep> = {}): ProtocolStep => ({
  id,
  label,
  level,
  source: 'note',
  noteSection,
  ...extra,
});

const manual = (id: string, label: string, level: ProtocolStep['level'], extra: Partial<ProtocolStep> = {}): ProtocolStep => ({
  id,
  label,
  level,
  source: 'manual',
  ...extra,
});

const psychotherapyCode = (): ProtocolStep =>
  manual('code_visit', 'Code by session time', 'required', {
    help: 'Face-to-face time: 90832 16–37 min, 90834 38–52, 90837 53+.',
    basis: ['cms_psychotherapy_time'],
  });

const emCode = (): ProtocolStep =>
  manual('code_visit', 'Code E/M (+ add-on only with therapy time)', 'required', {
    help: 'E/M by MDM or total time; 90833 / 90836 / 90838 only with separately documented psychotherapy minutes.',
    basis: ['cms_em_2021'],
  });

const substanceScreen = (): ProtocolStep => ({
  id: 'substance_screen',
  label: 'AUDIT-C / DAST-10',
  help: 'Alcohol and drug screen recorded today (CRAFFT for adolescents).',
  level: 'recommended',
  source: 'auto',
  action: { kind: 'assessment', instrument: 'AUDIT-C' },
});

const sdoh = (): ProtocolStep => ({
  id: 'sdoh',
  label: 'Social needs screen (yearly)',
  level: 'recommended',
  source: 'auto',
  action: { kind: 'sdoh' },
  basis: ['sdoh_screen'],
});

const treatmentConsent = (): ProtocolStep => ({
  id: 'treatment_consent',
  label: 'Consent to treatment on file',
  level: 'required',
  source: 'auto',
  action: { kind: 'consents', template: 'informed-consent-treatment' },
});

const part2Consent = (): ProtocolStep => ({
  id: 'part2_consent',
  label: '42 CFR Part 2 consent',
  help: 'Written Part 2 consent for any disclosure (incl. to the care team outside the SUD program).',
  level: 'required',
  source: 'auto',
  action: { kind: 'consents', template: 'part2-consent' },
  basis: ['part2_consent'],
});

const roi = (): ProtocolStep =>
  manual('roi', 'Releases of information', 'recommended', {
    help: 'PCP, prior providers, school or family as the client agrees.',
    action: { kind: 'consents', template: 'roi-authorization' },
  });

/** Duty to warn (threat to an identifiable person) and mandated reporting (child / vulnerable adult) */
const reportableConcerns = (level: ProtocolStep['level'] = 'recommended'): ProtocolStep =>
  manual('reportable_concerns', 'Safety of others and abuse asked about', level, {
    help: 'Threat to an identifiable person (duty to warn) or suspected child / vulnerable-adult abuse or neglect (mandated report): report, consult the clinical director and document. Tick when asked and nothing is reportable.',
    basis: ['md_duty_to_warn', 'md_child_abuse_report', 'md_vulnerable_adult_report'],
  });

// ─── Protocols ───────────────────────────────────────────────────────────────

const medManagementSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(labsReviewed()),
  prep(pendingRenewals()),
  during(note('interval_history', 'Interval history and adherence', 'History of Present Illness/Interval History')),
  during(note('side_effects', 'Side effects', 'Side Effects')),
  during(measures()),
  during(note('measure_review', 'Scores reviewed with patient', 'Measure Review', 'recommended', { basis: ['tjc_mbc'] })),
  during(cssrs()),
  during(note('suicidal_ideation', 'Suicidal ideation documented', 'Suicidal Ideation', 'required', { basis: ['tjc_suicide_screen'] })),
  during(safetyPlan()),
  during(note('mse', 'Mental status exam', 'Exam')),
  during(metabolicVitals()),
  during(aims()),
  during(medRec()),
  during(pdmpBh()),
  during(note('assessment_dx', 'Assessment and diagnoses', 'Assessment - Diagnoses')),
  during(note('prescribing', 'Prescribing decision', 'Plan - Med Changes', 'required', { action: { kind: 'drfirst', screen: 'patient' } })),
  during(controlledRx()),
  during(newMedConsent()),
  during(telehealthConsent()),
  during(telehealthLocation()),
  during(manual('coordination', 'Coordinate with therapist / PCP', 'optional')),
  wrap(note('labs_ordered', 'Labs ordered (if due)', 'Plan - Labs Ordered', 'recommended', { basis: ['ada_apa_metabolic'] })),
  wrap(note('next_appointment', 'Next appointment in plan', 'Plan - Next Appointment', 'recommended')),
  wrap(followUpBooked(4)),
  wrap(afterVisitSummary()),
  wrap(emCode()),
];

/** Adult / child psychiatric evaluation (Adult Psych Intake / Child Psych Initial Intake share these headings) */
const psychEvalSteps = (child: boolean): Entry[] => [
  prep(reviewBrief()),
  prep(treatmentConsent()),
  prep(guardianConsent()),
  prep(roi()),
  prep(labsReviewed()),
  during(note('chief_complaint', 'Chief complaint', 'Chief Complaint')),
  during(note('hpi', 'History of present illness', 'HPI')),
  during(note('psych_history', 'Inpatient / outpatient history', 'Outpatient Hx')),
  during(note('suicide_history', 'Suicide / self-harm history', 'Suicide/Self-Harm Hx', 'required', { basis: ['tjc_suicide_screen'] })),
  during(note('med_trials', 'Past medication trials', 'Psychiatric Med Hx')),
  during(note('substance_history', 'Substance use history', 'Substance Use Hx')),
  during(note('medical_history', 'Medical history and allergies', 'Past Medical Hx')),
  during(note('family_history', 'Family history', 'Family Hx')),
  during(
    note(
      'developmental',
      child ? 'Development, school and IEP / 504' : 'Developmental and education history',
      'Developmental and Educational Hx',
      child ? 'required' : 'recommended'
    )
  ),
  during(note('social', 'Social history', 'General Social Hx')),
  during(note('ros', 'Review of systems', 'Review of Systems', 'recommended')),
  during(note('mse', 'Mental status exam', 'Exam')),
  during(
    child
      ? manual('rating_scales', 'Vanderbilt / PHQ-A (parent and teacher)', 'recommended', {
          help: 'Vanderbilt for attention concerns; PHQ-A 11+ for depression; CRAFFT 12+ for substances.',
          action: { kind: 'assessment', instrument: 'Vanderbilt' },
          basis: ['tjc_mbc'],
        })
      : measures('recommended')
  ),
  during(cssrs()),
  during(note('risk_formulation', 'Risk and protective factors', 'Suicide Risk Factors', 'required', { basis: ['tjc_suicide_screen'] })),
  during(reportableConcerns()),
  during(safetyPlan()),
  during(sdoh()),
  during(medRec()),
  during(pdmpBh()),
  during(note('diagnoses', 'Diagnoses', 'Assessment - Diagnoses')),
  during(note('plan', 'Plan', 'Plan')),
  during(note('prescribing', 'Medication plan', 'Plan - Med Changes', 'required', { action: { kind: 'drfirst', screen: 'patient' } })),
  during(controlledRx()),
  during(newMedConsent()),
  during(metabolicVitals()),
  during(aims()),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(note('next_appointment', 'Next appointment in plan', 'Plan - Next Appointment', 'recommended')),
  wrap(followUpBooked(4)),
  wrap(afterVisitSummary()),
  wrap(
    manual('code_visit', 'Code the evaluation', 'required', {
      help: '90792 (medical eval) or new-patient E/M by MDM / time; not both on the same day.',
      basis: ['cms_em_2021'],
    })
  ),
];

const psychReevalSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(labsReviewed()),
  prep(pendingRenewals()),
  during(note('chief_complaint', 'Reason for re-evaluation', 'Chief Complaint')),
  during(note('interval_history', 'Interval history since last evaluation', 'History of Present Illness/Interval History')),
  during(note('med_trials', 'Medication trials and response', 'Psychiatric Med Hx')),
  during(note('substance_history', 'Substance use update', 'Substance Use Hx')),
  during(note('mse', 'Mental status exam', 'Exam')),
  during(measures()),
  during(note('measure_review', 'Score trend reviewed', 'Measure Review', 'recommended', { basis: ['tjc_mbc'] })),
  during(cssrs()),
  during(note('risk_formulation', 'Risk and protective factors', 'Suicide Risk Factors', 'required', { basis: ['tjc_suicide_screen'] })),
  during(safetyPlan()),
  during(guardianConsent()),
  during(medRec()),
  during(pdmpBh()),
  during(aims()),
  during(metabolicVitals()),
  during(note('diagnoses', 'Diagnoses reconfirmed', 'Assessment - Diagnoses')),
  during(note('prescribing', 'Medication plan', 'Plan - Med Changes', 'required', { action: { kind: 'drfirst', screen: 'patient' } })),
  during(controlledRx()),
  during(newMedConsent()),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(note('labs_ordered', 'Labs ordered (if due)', 'Plan - Labs Ordered', 'recommended', { basis: ['ada_apa_metabolic'] })),
  wrap(note('next_appointment', 'Next appointment in plan', 'Plan - Next Appointment', 'recommended')),
  wrap(followUpBooked(4)),
  wrap(afterVisitSummary()),
  wrap(emCode()),
];

const therapyIntakeSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(treatmentConsent()),
  prep(manual('demographics', 'Demographics, insurance, emergency contact', 'required')),
  prep(guardianConsent()),
  prep(roi()),
  during(note('presenting_problem', 'Presenting problem and referral', 'Referral & Presenting Problem')),
  during(note('hpi', 'History of present illness', 'History of Present Illness')),
  during(note('psych_history', 'Psychiatric history', 'Psychiatric History')),
  during(note('substance', 'Substance use screen', 'Substance Use Screen')),
  during(substanceScreen()),
  during(note('medical', 'Medical history and medications', 'Medical History & Medications')),
  during(note('trauma', 'Trauma and abuse history', 'Trauma & Abuse History')),
  during(note('family_social', 'Family and social history', 'Family & Social History')),
  during(note('child_history', 'Child / adolescent history', 'Child & Adolescent History', 'required', { when: 'minor' })),
  during(note('legal', 'Legal history', 'Legal History', 'recommended')),
  during(note('strengths', 'Strengths and barriers', 'Strengths & Barriers', 'recommended')),
  during(note('mse', 'Mental status exam', 'Mental Status Exam')),
  during(measures('required')),
  during(cssrs()),
  during(note('risk', 'Risk assessment', 'Risk Assessment', 'required', { basis: ['tjc_suicide_screen'] })),
  during(reportableConcerns()),
  during(safetyPlan()),
  during(sdoh()),
  during(note('diagnosis', 'Diagnostic impressions', 'Diagnostic Impressions')),
  during(note('level_of_care', 'Recommendations and level of care', 'Recommendations & Level of Care')),
  during(note('initial_goals', 'Initial treatment goals', 'Initial Treatment Goals', 'required', { basis: ['treatment_plan_review'] })),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(manual('treatment_plan', 'Initial treatment plan started', 'required', { help: 'Within the practice timeframe after intake.', action: { kind: 'treatment_plan' }, basis: ['treatment_plan_review'] })),
  wrap(followUpBooked(1)),
  wrap(afterVisitSummary()),
  wrap(manual('code_visit', 'Code 90791', 'required', { help: 'Psychiatric diagnostic evaluation without medical services; not time-based.' })),
];

const therapyIndividualSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(reviewPlan()),
  during(note('plan_goals', 'Plan goals addressed', 'Treatment Plan Goals', 'required', { basis: ['treatment_plan_review'] })),
  during(note('homework_review', 'Symptoms, interval history, homework review', 'Target Symptoms & Interval History')),
  during(measures()),
  during(cssrs()),
  during(note('risk_check', 'Risk check', 'Risk Check', 'required', { basis: ['tjc_suicide_screen'] })),
  during(reportableConcerns('optional')),
  during(safetyPlan()),
  during(note('mse', 'Mental status exam', 'Mental Status Exam', 'recommended')),
  during(note('interventions', 'Interventions used', 'Interventions')),
  during(note('response', 'Response to interventions', 'Response to Interventions')),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(note('homework', 'Plan and homework assigned', 'Plan & Homework')),
  wrap(followUpBooked(1)),
  wrap(psychotherapyCode()),
];

const crisisFollowupSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(manual('crisis_timing', 'Seen within 7 days of the crisis / discharge', 'required', { basis: ['hedis_fuh'] })),
  during(note('interval', 'What happened since the crisis', 'Target Symptoms & Interval History')),
  during(cssrs()),
  during(note('risk_check', 'Risk reassessment', 'Risk Check', 'required', { basis: ['tjc_suicide_screen'] })),
  during(reportableConcerns()),
  during({ ...safetyPlan(), when: undefined, help: 'Review and update the safety plan; means restriction; 988.' }),
  during(medRec()),
  during(note('interventions', 'Interventions', 'Interventions')),
  during(manual('supports', 'Supports and family contacted (with consent)', 'recommended')),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan, crisis line, next steps', 'Plan & Homework')),
  wrap(followUpBooked(1)),
  wrap(manual('prescriber_notified', 'Prescriber / PCP informed', 'recommended')),
  wrap(psychotherapyCode()),
];

const familySteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(reviewPlan()),
  during(note('participants', 'Who attended (patient present?)', 'Participants', 'required', { help: '90847 with the patient present; 90846 without.' })),
  during(note('systemic', 'Family / systemic assessment', 'Systemic Assessment')),
  during(reportableConcerns('optional')),
  during(guardianConsent()),
  during(cssrs('recommended')),
  during(note('intervention', 'Interventions', 'Intervention')),
  during(note('response', 'Response', 'Response')),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(followUpBooked(2)),
  wrap(manual('code_visit', 'Code 90847 / 90846', 'required', { help: 'At least 26 minutes; patient present decides the code.', basis: ['cms_psychotherapy_time'] })),
];

const groupSteps = (sud: boolean): Entry[] => [
  prep(reviewPlan()),
  ...(sud ? [prep(part2Consent())] : []),
  prep(manual('group_confidentiality', 'Group confidentiality reviewed', 'recommended', { action: { kind: 'consents', template: 'group-therapy-confidentiality' } })),
  during(note('topic', 'Topic / focus', 'Group Topic / Focus')),
  during(note('interventions', 'Interventions', 'Interventions')),
  during(note('participation', 'Participation and attendance minutes', 'Participation')),
  during(note('individual_response', 'This member\'s response and goal link', 'Individual Response', 'required', { basis: sud ? ['asam'] : ['treatment_plan_review'] })),
  during(cssrs('recommended')),
  during(safetyPlan()),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(followUpBooked(1)),
  wrap(manual('code_visit', sud ? 'Code H0005' : 'Code 90853', 'required', { help: 'Per attendee; within the payer group-size limit.' })),
];

const sudIndividualSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(reviewPlan()),
  prep(part2Consent()),
  during(note('use_history', 'Use since last visit', 'Current Use / Amount')),
  during(note('cravings', 'Cravings and triggers', 'Cravings & Triggers')),
  during(manual('uds', 'Urine drug screen (when ordered)', 'optional', { action: { kind: 'labs' } })),
  during(cssrs()),
  during(safetyPlan()),
  during(note('interventions', 'Interventions', 'Interventions')),
  during(note('relapse_prevention', 'Relapse prevention / overdose education', 'Relapse Prevention')),
  during(note('asam_loc', 'ASAM level of care still fits', 'ASAM Level of Care', 'recommended', { basis: ['asam'] })),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(followUpBooked(1)),
  wrap(manual('code_visit', 'Code H0004 (per 15 min)', 'required')),
];

const sudIntakeSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(treatmentConsent()),
  prep(part2Consent()),
  prep(guardianConsent()),
  prep(roi()),
  during(note('presenting_problem', 'Referral and presenting problem', 'Referral & Presenting Problem')),
  during(note('use_history', 'Substance use history', 'Substance Use History')),
  during(note('withdrawal', 'Withdrawal and overdose risk', 'Withdrawal & Overdose Risk')),
  during(note('tx_history', 'Treatment history', 'Substance Use Treatment History')),
  during(substanceScreen()),
  during(note('screening_scores', 'Screening scores', 'Screening Scores', 'recommended')),
  during(note('asam_dims', 'ASAM dimensions 1–6', 'ASAM Dimensions', 'required', { action: { kind: 'assessment', instrument: 'ASAM' }, basis: ['asam'] })),
  during(note('psych_history', 'Psychiatric history', 'Psychiatric History')),
  during(note('medical', 'Medical history and medications', 'Medical History & Medications')),
  during(note('mse', 'Mental status exam', 'Mental Status Exam')),
  during(cssrs()),
  during(note('risk', 'Risk assessment', 'Risk Assessment', 'required', { basis: ['tjc_suicide_screen'] })),
  during(reportableConcerns()),
  during(safetyPlan()),
  during(sdoh()),
  during(note('part2_section', 'Part 2 consent documented', '42 CFR Part 2 Consent', 'required', { basis: ['part2_consent'] })),
  during(note('diagnosis', 'Diagnostic impressions', 'Diagnostic Impressions')),
  during(note('level_of_care', 'Level of care recommendation', 'Recommendations & Level of Care', 'required', { basis: ['asam'] })),
  during(note('initial_goals', 'Initial treatment goals', 'Initial Treatment Goals', 'required', { basis: ['treatment_plan_review'] })),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(manual('treatment_plan', 'Initial treatment plan started', 'required', { action: { kind: 'treatment_plan' }, basis: ['treatment_plan_review'] })),
  wrap(followUpBooked(1)),
  wrap(manual('code_visit', 'Code the assessment (H0001 / 90791)', 'required')),
];

const prpSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(manual('irp_current', 'IRP current (review date not passed)', 'required', { action: { kind: 'treatment_plan' }, basis: ['prp_comar'] })),
  // PRP Progress Note sections (noteType 'PRP'): date, minutes, service type, onsite / offsite, staff, IRP goal, intervention, response
  during(note('service', 'Service type and location (onsite / offsite)', 'Service Type & Location', 'required', { basis: ['prp_comar'] })),
  during(note('irp_goal', 'IRP goal addressed', 'IRP Goal Addressed', 'required', { basis: ['prp_comar'] })),
  during(note('intervention', 'Intervention / activity', 'Intervention', 'required', { basis: ['prp_comar'] })),
  during(note('response', 'Participant response', 'Participant Response', 'required', { basis: ['prp_comar'] })),
  during(manual('mors', 'MORS rating', 'recommended', { action: { kind: 'assessment', instrument: 'MORS' }, basis: ['tjc_mbc'] })),
  during(manual('risk_observed', 'Risk concerns escalated to clinician', 'required', { help: 'Any safety concern goes to the licensed clinician the same day.', basis: ['tjc_suicide_screen'] })),
  during(manual('minutes', 'Start / end time and minutes', 'required', { basis: ['prp_comar'] })),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(note('next_contact', 'Next contact', 'Next Contact', 'recommended')),
  wrap(followUpBooked(1)),
];

/** Intensive program module (roster, weekly hours, auth, discharge): src/lib/intensive, /dashboard/programs/intensive */
const programRoster = (label: string) => ({ kind: 'link' as const, href: '/dashboard/programs/intensive', label });

const iopSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(reviewPlan()),
  prep(manual('attendance', 'Attendance and hours this week', 'required', {
    help: 'Mark today\'s sessions with minutes on the program roster; under the weekly minimum is flagged there.',
    action: programRoster('Open program roster'),
  })),
  during(note('topic', 'Topic / focus', 'Group Topic / Focus')),
  during(note('interventions', 'Interventions', 'Interventions')),
  during(note('participation', 'Participation and minutes', 'Participation')),
  during(note('individual_response', 'This client\'s response and goal link', 'Individual Response', 'required', { basis: ['treatment_plan_review'] })),
  during(cssrs()),
  during(safetyPlan()),
  during(measures()),
  during(manual('asam_review', 'Level of care still fits (ASAM / LOCUS)', 'recommended', { basis: ['asam'] })),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(manual('missed_outreach', 'Missed-day outreach logged (if the client missed a day)', 'recommended', { action: programRoster('Open outreach') })),
  wrap(followUpBooked()),
  wrap(manual('code_visit', 'Code the IOP day (S9480 / H0015)', 'required', { help: 'Charge drafts are built from attendance on the program page; billing confirms the code and unit rule.' })),
];

const phpSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(reviewPlan()),
  prep(manual('attendance', 'Attendance and hours this week (PHP minimum)', 'required', {
    help: 'Mark each session with minutes on the program roster; under the weekly minimum is flagged there.',
    action: programRoster('Open program roster'),
  })),
  prep(manual('psych_eval_on_file', 'Psychiatric evaluation on file (PHP admission)', 'required', { basis: ['asam'] })),
  during(note('topic', 'Topic / focus', 'Group Topic / Focus')),
  during(note('interventions', 'Interventions', 'Interventions')),
  during(note('participation', 'Participation and minutes', 'Participation')),
  during(note('individual_response', 'This client\'s response and goal link', 'Individual Response', 'required', { basis: ['treatment_plan_review'] })),
  during(cssrs()),
  during(safetyPlan()),
  during(measures()),
  during(manual('medication_review', 'Medication response / side effects reviewed', 'recommended', { audiences: ['prescriber'], action: { kind: 'drfirst', screen: 'patient' } })),
  during(manual('asam_review', 'Level of care still fits (PHP vs IOP / inpatient)', 'required', { basis: ['asam'] })),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(manual('weekly_review', 'Weekly team review with psychiatrist / NP done this week', 'required', { action: programRoster('Open weekly review'), basis: ['treatment_plan_review'] })),
  wrap(manual('missed_outreach', 'Missed-day outreach logged (if the client missed a day)', 'recommended', { action: programRoster('Open outreach') })),
  wrap(followUpBooked()),
  wrap(manual('code_visit', 'Code the PHP day (H0035)', 'required', { help: 'Charge drafts are built from attendance on the program page; billing confirms the code and unit rule.' })),
];

const telephoneSteps = (): Entry[] => [
  prep(reviewBrief()),
  during(note('caller', 'Caller and relationship (identity verified)', 'Caller / Relationship')),
  during(note('reason', 'Reason for call', 'Reason for Call')),
  during(note('discussion', 'Discussion', 'Discussion')),
  during(manual('risk_screen', 'Safety asked about', 'recommended', { help: 'Ask about suicidal thoughts when clinically indicated; 988.', basis: ['tjc_suicide_screen'] })),
  during(note('decision', 'Clinical decision', 'Clinical Decision')),
  during(manual('prescribing', 'Medication question handled', 'optional', { audiences: ['prescriber', 'medical'], action: { kind: 'drfirst', screen: 'patient' } })),
  wrap(note('follow_up', 'Follow-up', 'Follow-up')),
  wrap(manual('code_visit', 'Code by minutes (98966–98968) or no charge', 'optional', { help: 'Not billable if it leads to a visit within 24 hours / soonest appointment or relates to a visit in the past 7 days.' })),
];

const primaryCareSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep({
    id: 'rooming_complete',
    label: 'MA intake ready (rooming)',
    help: 'Identity checked, chief complaint, vitals with flags, allergies / meds / pharmacy reviewed, screenings.',
    level: 'recommended',
    source: 'auto',
  }),
  prep(labsReviewed()),
  prep(pendingRenewals()),
  during(note('subjective', 'HPI / reason for visit', 'Subjective')),
  during(manual('ros', 'Review of systems', 'recommended')),
  during({ id: 'vitals', label: 'Vitals recorded today', help: 'From rooming or the flowsheet; recheck an elevated blood pressure.', level: 'required', source: 'auto' }),
  during(note('exam', 'Exam', 'Objective')),
  during(medRec()),
  during(manual('allergies', 'Allergies reviewed', 'required', { action: { kind: 'drfirst', screen: 'manage_allergies' } })),
  during(pdmp()),
  during({
    id: 'pc_screenings',
    label: 'Screenings due today recorded',
    help: 'Depression (PHQ-2 / PHQ-9), tobacco, alcohol (AUDIT-C), falls 65+, SDOH yearly.',
    level: 'recommended',
    source: 'auto',
    basis: ['uspstf_screening'],
  }),
  during({
    id: 'care_gaps',
    label: 'Care gaps addressed',
    help: 'Each due gap: ordered, done elsewhere (date + source), declined, or not applicable (reason).',
    level: 'required',
    source: 'auto',
    basis: ['uspstf_screening', 'acip_immunization', 'ada_diabetes_care'],
  }),
  during(
    manual('bh_handoff', 'Offer a warm handoff to the behavioral health team', 'recommended', {
      help: 'Positive primary care PHQ-9 or GAD-7 (10 or more): internal referral to the practice BH team.',
      when: 'positive_bh_screen',
      basis: ['collaborative_care'],
    })
  ),
  during(note('assessment', 'Assessment with coded problems (ICD-10)', 'Assessment')),
  during(controlledRx()),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(manual('orders', 'Orders placed (labs, imaging, referrals, prescriptions)', 'optional')),
  wrap(note('plan', 'Plan and patient instructions', 'Plan')),
  wrap(followUpBooked()),
  wrap(afterVisitSummary()),
  wrap(manual('code_visit', 'Code E/M by MDM or time (preventive / AWV when applicable)', 'required', { basis: ['cms_em_2021'] })),
];

const tmsSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(manual('tms_pa', 'Prior authorization and session count', 'required', { basis: ['tms_course'] })),
  during(manual('tms_screen', 'Seizure risk / metal / med changes asked', 'required', { basis: ['tms_course'] })),
  during(note('subjective', 'Mood and side effects since last session', 'Subjective')),
  during(manual('motor_threshold', 'Motor threshold (when re-checked)', 'recommended', { basis: ['tms_course'] })),
  during(note('parameters', 'Target, frequency, pulses, tolerance', 'Objective', 'required', { basis: ['tms_course'] })),
  during(measures()),
  during(cssrs()),
  during(safetyPlan()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(followUpBooked()),
  wrap(manual('code_visit', 'Code 90868 (90867 mapping, 90869 re-map)', 'required', { basis: ['tms_course'] })),
];

const spravatoSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(manual('rems_enrolled', 'Patient REMS enrolled; site certified', 'required', { basis: ['spravato_rems'] })),
  prep(manual('transport', 'Ride home arranged (no driving today)', 'required', { basis: ['spravato_rems'] })),
  during(manual('vitals_0', 'BP / HR before dose', 'required', { help: 'Hold the dose if blood pressure is too high per labeling.', basis: ['spravato_rems'] })),
  during(measures()),
  during(cssrs()),
  during(manual('dose_observed', 'Dose self-administered under observation', 'required', { basis: ['spravato_rems'] })),
  during(manual('vitals_40', 'BP / HR ~40 min after dose', 'required', { basis: ['spravato_rems'] })),
  during(manual('sedation_dissociation', 'Sedation (MOAA/S) and dissociation (CADSS)', 'required', { basis: ['spravato_rems'] })),
  during(manual('monitoring_2h', 'Monitored at least 2 hours', 'required', { basis: ['spravato_rems'] })),
  during(manual('vitals_120', 'BP / HR at discharge (~120 min)', 'required', { basis: ['spravato_rems'] })),
  during(note('observations', 'Observations', 'Objective')),
  wrap(manual('rems_form', 'REMS monitoring recorded / submitted', 'required', { basis: ['spravato_rems'] })),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(followUpBooked()),
  wrap(manual('code_visit', 'Code G2082 / G2083 (by dose)', 'required')),
];

const treatmentPlanReviewSteps = (): Entry[] => [
  prep(reviewBrief()),
  prep(reviewPlan()),
  during(note('goals', 'Progress on each goal and objective', 'Treatment Plan Goals', 'required', { basis: ['treatment_plan_review'] })),
  during(measures('required')),
  during(note('interval', 'Symptoms since the last review', 'Target Symptoms & Interval History')),
  during(cssrs()),
  during(note('risk_check', 'Risk check', 'Risk Check', 'required', { basis: ['tjc_suicide_screen'] })),
  during(safetyPlan()),
  during(sdoh()),
  during(manual('client_input', 'Client agrees with the updated plan', 'required', { basis: ['treatment_plan_review'] })),
  during(telehealthLocation()),
  wrap(manual('plan_updated', 'Plan updated and signed', 'required', { action: { kind: 'treatment_plan' }, basis: ['treatment_plan_review'] })),
  wrap(note('plan', 'Plan and next review date', 'Plan & Homework')),
  wrap(followUpBooked()),
  wrap(psychotherapyCode()),
];

const dischargeSteps = (): Entry[] => [
  prep(reviewBrief()),
  during(note('reason', 'Reason for discharge', 'Reason for Discharge')),
  during(note('summary', 'Treatment summary', 'Treatment Summary', 'required', { basis: ['discharge_aftercare'] })),
  during(note('progress', 'Progress toward goals', 'Progress Toward Goals')),
  during(measures()),
  during(cssrs()),
  during(note('meds', 'Medications at discharge (list handed off)', 'Medications at Discharge', 'required', { basis: ['tjc_med_rec'] })),
  during(note('aftercare', 'Aftercare plan and referrals', 'Aftercare Plan', 'required', { basis: ['discharge_aftercare'] })),
  during(manual('crisis_resources', 'Crisis resources given (988)', 'required', { basis: ['tjc_suicide_screen'] })),
  during(roi()),
  wrap(manual('records_sent', 'Records sent to next provider (with consent)', 'recommended', { basis: ['discharge_aftercare', 'part2_consent'] })),
  wrap(manual('close_episode', 'Episode closed; future visits cancelled', 'recommended')),
];

const noShowSteps = (): Entry[] => [
  during(note('scheduled', 'Scheduled appointment', 'Scheduled Appointment')),
  during(note('outreach', 'Outreach attempts (call, text, letter)', 'Contact Attempts')),
  during(note('risk_review', 'Risk review', 'Risk Review', 'required', { help: 'High-risk client: escalate per policy (welfare check if needed).', basis: ['tjc_suicide_screen'] })),
  during(manual('escalation', 'High-risk follow-up done', 'required', { when: 'elevated_risk', basis: ['tjc_suicide_screen'] })),
  wrap(note('follow_up_plan', 'Follow-up plan', 'Follow-up Plan')),
  wrap(followUpBooked()),
];

const otherSteps = (): Entry[] => [
  prep(reviewBrief()),
  during(note('subjective', 'Reason for visit', 'Subjective')),
  during(note('assessment', 'Assessment', 'Assessment')),
  during(telehealthConsent()),
  during(telehealthLocation()),
  wrap(note('plan', 'Plan', 'Plan')),
  wrap(followUpBooked()),
];

export const PROTOCOLS: Record<VisitKind, VisitProtocol> = {
  therapy_intake: { kind: 'therapy_intake', label: 'Therapy intake', audience: 'therapist', noteType: 'Therapy Intake', cpt: ['90791'], steps: therapyIntakeSteps(), followUpDays: 7 },
  psych_eval_adult: { kind: 'psych_eval_adult', label: 'Psychiatric evaluation (adult)', audience: 'prescriber', noteType: 'Adult Psych Intake', cpt: ['90792', '99205', '99204'], steps: psychEvalSteps(false), followUpDays: 28 },
  psych_eval_child: { kind: 'psych_eval_child', label: 'Psychiatric evaluation (child)', audience: 'prescriber', noteType: 'Child Psych Initial Intake', cpt: ['90792', '99205', '99204'], steps: psychEvalSteps(true), followUpDays: 28 },
  psych_reeval: { kind: 'psych_reeval', label: 'Psychiatric re-evaluation', audience: 'prescriber', noteType: 'Adult Psych Re-Eval', cpt: ['99214', '99215', '90792'], steps: psychReevalSteps(), followUpDays: 28 },
  med_management: { kind: 'med_management', label: 'Medication management', audience: 'prescriber', noteType: 'Psych Med Mgmt', cpt: ['99214', '99213', '99215', '99212', '90833', '90836', '90838'], steps: medManagementSteps(), followUpDays: 28 },
  therapy_individual: { kind: 'therapy_individual', label: 'Individual therapy', audience: 'therapist', noteType: 'Therapy Progress', cpt: ['90837', '90834', '90832'], steps: therapyIndividualSteps(), followUpDays: 7 },
  therapy_family: { kind: 'therapy_family', label: 'Family therapy', audience: 'therapist', noteType: 'MFT', cpt: ['90847', '90846'], steps: familySteps(), followUpDays: 14 },
  group_therapy: { kind: 'group_therapy', label: 'Group therapy', audience: 'therapist', noteType: 'Group', cpt: ['90853'], steps: groupSteps(false), followUpDays: 7 },
  sud_individual: { kind: 'sud_individual', label: 'SUD counseling', audience: 'therapist', noteType: 'SUD', cpt: ['H0004'], steps: sudIndividualSteps(), followUpDays: 7, part2: true },
  sud_group: { kind: 'sud_group', label: 'SUD group', audience: 'therapist', noteType: 'Group', cpt: ['H0005'], steps: groupSteps(true), followUpDays: 7, part2: true },
  sud_intake: { kind: 'sud_intake', label: 'SUD intake', audience: 'therapist', noteType: 'Substance Abuse Intake', cpt: ['H0001', '90791'], steps: sudIntakeSteps(), followUpDays: 7, part2: true },
  // cpt empty here: the loader fills it from the practice-confirmed PRP billing model (src/lib/prp/standard.ts prpVisitCodes)
  prp: { kind: 'prp', label: 'PRP service', audience: 'program', noteType: 'PRP', cpt: [], steps: prpSteps(), followUpDays: 7 },
  iop: { kind: 'iop', label: 'Intensive outpatient (IOP)', audience: 'therapist', noteType: 'Group', cpt: ['S9480', 'H0015'], steps: iopSteps(), followUpDays: 2 },
  php: { kind: 'php', label: 'Partial hospitalization (PHP)', audience: 'therapist', noteType: 'Group', cpt: ['H0035'], steps: phpSteps(), followUpDays: 1 },
  crisis_followup: { kind: 'crisis_followup', label: 'Crisis follow-up', audience: 'therapist', noteType: 'Therapy Progress', cpt: ['90837', '90834', '90832'], steps: crisisFollowupSteps(), followUpDays: 7 },
  telephone: { kind: 'telephone', label: 'Telephone encounter', audience: 'therapist', noteType: 'Telephone', cpt: ['98966', '98967', '98968'], steps: telephoneSteps(), followUpDays: null },
  primary_care: { kind: 'primary_care', label: 'Primary care visit', audience: 'medical', noteType: 'SOAP', cpt: ['99213', '99214', '99212', '99215'], steps: primaryCareSteps(), followUpDays: 90 },
  tms: { kind: 'tms', label: 'TMS session', audience: 'prescriber', noteType: 'SOAP', cpt: ['90868', '90867', '90869'], steps: tmsSteps(), followUpDays: 1 },
  spravato: { kind: 'spravato', label: 'Spravato session', audience: 'prescriber', noteType: 'SOAP', cpt: ['G2082', 'G2083'], steps: spravatoSteps(), followUpDays: 7 },
  treatment_plan_review: { kind: 'treatment_plan_review', label: 'Treatment plan review', audience: 'therapist', noteType: 'Therapy Progress', cpt: ['90837', '90834', '90832'], steps: treatmentPlanReviewSteps(), followUpDays: 7 },
  discharge: { kind: 'discharge', label: 'Discharge', audience: 'therapist', noteType: 'Discharge', cpt: [], steps: dischargeSteps(), followUpDays: null },
  no_show: { kind: 'no_show', label: 'No-show follow-up', audience: 'therapist', noteType: 'No-Show', cpt: [], steps: noShowSteps(), followUpDays: 7 },
  other: { kind: 'other', label: 'Visit', audience: 'therapist', noteType: 'SOAP', cpt: [], steps: otherSteps(), followUpDays: null },
};

export const VISIT_KINDS = Object.keys(PROTOCOLS) as VisitKind[];

export function isVisitKind(v: unknown): v is VisitKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROTOCOLS, v);
}

/** Behavioral-health visit kinds (C-SSRS every visit per practice policy) */
export const BH_KINDS: ReadonlySet<VisitKind> = new Set<VisitKind>([
  'therapy_intake', 'psych_eval_adult', 'psych_eval_child', 'psych_reeval', 'med_management', 'therapy_individual',
  'therapy_family', 'group_therapy', 'sud_individual', 'sud_group', 'sud_intake', 'iop', 'php', 'crisis_followup', 'tms',
  'spravato', 'treatment_plan_review', 'discharge',
]);
/** Visits led by a prescriber (medication monitoring items apply) */
export const PRESCRIBER_KINDS: ReadonlySet<VisitKind> = new Set<VisitKind>(['psych_eval_adult', 'psych_eval_child', 'psych_reeval', 'med_management', 'spravato']);
export const SUD_KINDS: ReadonlySet<VisitKind> = new Set<VisitKind>(['sud_individual', 'sud_group', 'sud_intake']);
/** Visits that work from a treatment plan */
export const PLAN_KINDS: ReadonlySet<VisitKind> = new Set<VisitKind>([
  'therapy_individual', 'therapy_family', 'group_therapy', 'sud_individual', 'sud_group', 'iop', 'php', 'crisis_followup', 'treatment_plan_review',
]);
