import type { EvaluationTemplate, EvaluationTemplateSection } from './templates';
type EvalType =
  | 'InitialPsych' | 'InitialPsychMed' | 'PsychReEval' | 'PsychFollowUp'
  | 'Biopsychosocial' | 'SUDEval' | 'CrisisEval' | 'CollateralNote';

type EvalStatus = 'draft' | 'pending_signature' | 'finalized' | 'amended';

interface MSEState {
  appearance: string[]; behavior: string[]; eyeContact: string;
  speechRate: string; speechVolume: string; mood: string[]; moodText: string;
  affect: string[]; thoughtProcess: string[]; thoughtContent: string[];
  perceptions: string[]; perceptionDetail: string; cognition: string[];
  insight: string; judgment: string; notes: string;
}

interface RiskState {
  si: string; siDetails: string; siMeans: string[]; priorAttempts: string; nssi: string;
  hi: string; hiDetails: string; riskLevel: string; rationale: string;
  safetyActions: string[];
}

interface DiagnosisEntry { name: string; icd10: string; specifier: string; }

interface EvalForm {
  clientId: string; evalType: EvalType; sections: Record<string, string>;
  mse: MSEState; risk: RiskState; diagnoses: DiagnosisEntry[];
  cptCode: string; sessionDuration: string;
}

interface EvalRecord {
  id: string; client: string; evalType: EvalType; cptCode: string;
  clinician: string; date: string; status: EvalStatus;
  supervisorRequired: boolean; durationMin: number;
  diagnoses: string[]; riskLevel?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVAL_LABELS: Record<EvalType, string> = {
  InitialPsych: 'Initial Psych Eval', InitialPsychMed: 'Initial Psych/Med Eval',
  PsychReEval: 'Psych Re-Evaluation', PsychFollowUp: 'Psych Follow-Up',
  Biopsychosocial: 'Adult Comprehensive Diagnostic Evaluation', SUDEval: 'SUD Evaluation',
  CrisisEval: 'Crisis Evaluation', CollateralNote: 'Collateral/Consultation',
};

const EVAL_CPT: Record<EvalType, string> = {
  InitialPsych: '90791', InitialPsychMed: '90792', PsychReEval: '90792',
  PsychFollowUp: '99214', Biopsychosocial: '90791', SUDEval: 'H0001',
  CrisisEval: '90839', CollateralNote: '99368',
};

const EVAL_COLORS: Record<EvalType, string> = {
  InitialPsych: '#5C2D91', InitialPsychMed: '#7B3FC4', PsychReEval: '#15803D',
  PsychFollowUp: '#00ACC1', Biopsychosocial: '#B45309', SUDEval: '#EA580C',
  CrisisEval: '#C62828', CollateralNote: '#546E7A',
};

const EVAL_TABS: Record<EvalType, string[]> = {
  InitialPsych: ['Presenting', 'History', 'Social & Cultural', 'Mental Status', 'Risk', 'Diagnosis', 'Plan'],
  InitialPsychMed: ['Presenting', 'History', 'Social & Cultural', 'Mental Status', 'Risk', 'Diagnosis', 'Prescribing', 'Plan'],
  PsychReEval: ['Interval History', 'Medications', 'Mental Status', 'Risk', 'Updated Dx', 'Prescribing', 'Plan Update'],
  PsychFollowUp: ['Interval History', 'Medications', 'Symptoms', 'Brief MSE', 'Risk Screen', 'Assessment & Plan'],
  Biopsychosocial: ['Presenting', 'Psych & Medical', 'Social & Developmental', 'Trauma & Substance', 'Cultural & Legal', 'MSE', 'Risk', 'Dx & Plan'],
  SUDEval: ['Chief Complaint', 'Substance History', 'CAGE-AID/AUDIT', 'ASAM Dimensions', 'MAT & Withdrawal', 'MSE', 'Risk', 'Dx & LOC'],
  CrisisEval: ['Presenting Crisis', 'C-SSRS/Ideation', 'HI & Perceptions', 'Brief MSE', 'Risk & Disposition', 'Intervention & Plan'],
  CollateralNote: ['Contact & ROI', 'Information Exchange', 'Clinical Relevance'],
};

type TabFieldDef = { label: string; placeholder: string; rows?: number };

const TAB_FIELDS: Record<EvalType, Record<string, TabFieldDef[]>> = {
  InitialPsych: {
    'Presenting': [
      { label: 'Chief Complaint', placeholder: "Client's stated reason for seeking evaluation…", rows: 2 },
      { label: 'History of Present Illness', placeholder: 'Onset, duration, precipitants, course of current episode…', rows: 5 },
      { label: 'Symptom Review', placeholder: 'Current psychiatric symptoms endorsed…', rows: 3 },
    ],
    'History': [
      { label: 'Psychiatric History', placeholder: 'Prior diagnoses, hospitalizations, outpatient treatment, medications tried…', rows: 4 },
      { label: 'Medical History', placeholder: 'Medical conditions, surgeries, current medications, allergies…', rows: 3 },
      { label: 'Developmental History', placeholder: 'Prenatal/perinatal, developmental milestones, childhood history…', rows: 3 },
      { label: 'Family Psychiatric History', placeholder: 'Mental health diagnoses in first-degree relatives, suicide history…', rows: 3 },
    ],
    'Social & Cultural': [
      { label: 'Social History', placeholder: 'Marital status, living situation, support system, employment…', rows: 3 },
      { label: 'Educational History', placeholder: 'Highest level, learning disabilities, academic performance…', rows: 2 },
      { label: 'Cultural Formulation', placeholder: 'Cultural identity, explanatory model, cultural stressors/supports…', rows: 3 },
      { label: 'Legal History', placeholder: 'Current or past legal involvement, probation/parole…', rows: 2 },
      { label: 'Spiritual/Religious', placeholder: 'Role in coping and identity…', rows: 2 },
    ],
    'Plan': [
      { label: 'Functional Assessment / GAF', placeholder: 'Current level of functioning, impairment in work/social/self-care…', rows: 3 },
      { label: 'Clinical Formulation', placeholder: 'Biopsychosocial formulation integrating findings…', rows: 4 },
      { label: 'Treatment Recommendations', placeholder: 'Level of care, modality, frequency, goals…', rows: 3 },
      { label: 'Safety Plan', placeholder: 'Warning signs, coping strategies, supports, crisis resources…', rows: 3 },
    ],
  },
  InitialPsychMed: {
    'Presenting': [
      { label: 'Chief Complaint', placeholder: "Client's stated reason…", rows: 2 },
      { label: 'History of Present Illness', placeholder: 'Onset, duration, precipitants…', rows: 5 },
    ],
    'History': [
      { label: 'Psychiatric History', placeholder: 'Prior diagnoses, hospitalizations, prior medications…', rows: 4 },
      { label: 'Medical History & Review of Systems', placeholder: 'Active medical conditions, ROS positives/negatives…', rows: 4 },
      { label: 'Family History', placeholder: 'Psychiatric and medical family history…', rows: 3 },
    ],
    'Social & Cultural': [
      { label: 'Social History', placeholder: 'Living situation, support, employment…', rows: 3 },
      { label: 'Cultural Formulation', placeholder: 'Cultural identity, explanatory model…', rows: 3 },
    ],
    'Prescribing': [
      { label: 'Vital Signs', placeholder: 'BP, HR, Wt, BMI (if obtained)…', rows: 2 },
      { label: 'Current Medications', placeholder: 'Name, dose, frequency, duration, response…', rows: 3 },
      { label: 'Medication Allergies & Adverse Reactions', placeholder: 'Medication, reaction type…', rows: 2 },
      { label: 'Laboratory / ECG Review', placeholder: 'Relevant labs ordered or reviewed…', rows: 2 },
      { label: 'Prescribing Plan', placeholder: 'Medication(s) initiated/changed, rationale, monitoring plan, patient education provided…', rows: 4 },
      { label: 'PDMP Review', placeholder: 'PDMP checked (Y/N), findings, controlled substances noted…', rows: 2 },
    ],
    'Plan': [
      { label: 'Clinical Formulation', placeholder: 'Biopsychosocial formulation…', rows: 4 },
      { label: 'Treatment Recommendations', placeholder: 'Level of care, therapy, medication, follow-up…', rows: 3 },
    ],
  },
  PsychReEval: {
    'Interval History': [
      { label: 'Reason for Re-Evaluation', placeholder: 'Annual re-eval, change in condition, new symptoms, transfer of care…', rows: 2 },
      { label: 'Interval History Since Last Eval', placeholder: 'Changes in symptoms, stressors, functioning since last evaluation…', rows: 4 },
      { label: 'Treatment Response', placeholder: 'Response to current treatment; adherence issues…', rows: 3 },
    ],
    'Medications': [
      { label: 'Current Medications', placeholder: 'Name, dose, frequency, response, side effects…', rows: 4 },
      { label: 'Vital Signs', placeholder: 'BP, HR, Wt, BMI…', rows: 2 },
      { label: 'Laboratory Review', placeholder: 'Labs reviewed, results, clinical significance…', rows: 3 },
    ],
    'Updated Dx': [
      { label: 'Clinical Formulation Update', placeholder: 'Updated biopsychosocial formulation…', rows: 4 },
    ],
    'Prescribing': [
      { label: 'Medication Changes', placeholder: 'Adjustments made, rationale, monitoring…', rows: 4 },
      { label: 'PDMP Review', placeholder: 'PDMP checked, findings…', rows: 2 },
    ],
    'Plan Update': [
      { label: 'Updated Treatment Plan', placeholder: 'Goals, interventions, follow-up frequency…', rows: 3 },
      { label: 'Safety Plan Review', placeholder: 'Safety plan reviewed/updated…', rows: 2 },
    ],
  },
  PsychFollowUp: {
    'Interval History': [
      { label: 'Interval History', placeholder: 'Changes since last visit, stressors, significant events…', rows: 3 },
      { label: 'Subjective Complaints', placeholder: "Client's reported symptoms and concerns today…", rows: 3 },
    ],
    'Medications': [
      { label: 'Medication Review', placeholder: 'Current medications, adherence, side effects…', rows: 3 },
      { label: 'Vital Signs', placeholder: 'BP, HR, Wt (if obtained)…', rows: 2 },
    ],
    'Symptoms': [
      { label: 'Target Symptom Review', placeholder: 'PHQ-9/GAD-7 scores if administered; specific symptom ratings…', rows: 3 },
      { label: 'Functional Status', placeholder: 'Work, relationships, sleep, activities of daily living…', rows: 2 },
    ],
    'Assessment & Plan': [
      { label: 'Assessment', placeholder: 'Clinical impression, response to treatment, diagnostic update…', rows: 3 },
      { label: 'Plan', placeholder: 'Medication changes, therapy coordination, follow-up, referrals…', rows: 4 },
      { label: 'Patient Education', placeholder: 'Topics discussed, patient questions addressed…', rows: 2 },
    ],
  },
  Biopsychosocial: {
    'Presenting': [
      { label: 'Chief Complaint', placeholder: "Client's own words…", rows: 2 },
      { label: 'History of Present Illness', placeholder: 'Comprehensive narrative of current episode…', rows: 6 },
    ],
    'Psych & Medical': [
      { label: 'Psychiatric History', placeholder: 'Full psychiatric history including all prior episodes…', rows: 4 },
      { label: 'Medical History', placeholder: 'Medical conditions, surgeries, chronic illnesses…', rows: 3 },
      { label: 'Review of Systems', placeholder: 'Pertinent positives and negatives…', rows: 3 },
      { label: 'Medications & Allergies', placeholder: 'All current medications, supplements, allergies…', rows: 3 },
    ],
    'Social & Developmental': [
      { label: 'Developmental History', placeholder: 'Prenatal/perinatal, milestones, early childhood…', rows: 3 },
      { label: 'Educational & Occupational', placeholder: 'Academic history, employment history, current status…', rows: 3 },
      { label: 'Relational & Social History', placeholder: 'Attachment patterns, peer relationships, romantic history…', rows: 3 },
      { label: 'Family of Origin', placeholder: 'Family dynamics, parenting style, significant family events…', rows: 3 },
    ],
    'Trauma & Substance': [
      { label: 'Trauma History (ACEs)', placeholder: 'Physical, sexual, emotional abuse/neglect; witness to violence; ACE score…', rows: 4 },
      { label: 'Substance Use History', placeholder: 'Substances used, age of first use, patterns, CAGE/AUDIT/DAST scores…', rows: 3 },
      { label: 'Housing & Food Security', placeholder: 'Current housing stability, food access, financial stressors…', rows: 2 },
    ],
    'Cultural & Legal': [
      { label: 'Cultural Formulation', placeholder: 'Cultural identity, explanatory model, cultural stressors/supports, help-seeking patterns…', rows: 4 },
      { label: 'Legal History', placeholder: 'Arrests, incarcerations, current legal involvement, probation…', rows: 3 },
      { label: 'Spiritual/Religious History', placeholder: 'Spiritual/religious identity and role in coping…', rows: 2 },
    ],
    'Dx & Plan': [
      { label: 'Biopsychosocial Formulation', placeholder: 'Integration of biological, psychological, and social factors…', rows: 5 },
      { label: 'Strengths & Protective Factors', placeholder: 'Internal and external strengths…', rows: 3 },
      { label: 'Treatment Recommendations', placeholder: 'Level of care, modality, frequency, goals…', rows: 3 },
      { label: 'Safety Plan', placeholder: 'Warning signs, coping, supports, crisis plan…', rows: 3 },
    ],
  },
  SUDEval: {
    'Chief Complaint': [
      { label: 'Chief Complaint', placeholder: 'Presenting reason for SUD evaluation…', rows: 2 },
      { label: 'Referral Source', placeholder: 'Self-referral, court-ordered, employer EAP, family, other provider…', rows: 2 },
      { label: 'History of Present Illness', placeholder: 'Current substance use context, consequences, motivation for treatment…', rows: 4 },
    ],
    'Substance History': [
      { label: 'Substance Use History', placeholder: 'For each substance: age first use, frequency, amount, route, last use, longest sobriety…', rows: 6 },
      { label: 'Withdrawal History', placeholder: 'Prior withdrawal symptoms, seizures, DTs, medically managed withdrawals…', rows: 3 },
      { label: 'Consequences of Use', placeholder: 'Medical, legal, occupational, relational, financial consequences…', rows: 3 },
    ],
    'CAGE-AID/AUDIT': [
      { label: 'CAGE-AID Results', placeholder: 'C: Cut down? A: Annoyed? G: Guilty? E: Eye-opener? Score (0-4)…', rows: 3 },
      { label: 'AUDIT-C / AUDIT Score', placeholder: 'Score and interpretation…', rows: 2 },
      { label: 'DAST-10 Score', placeholder: 'Score and interpretation (for drug use)…', rows: 2 },
    ],
    'ASAM Dimensions': [
      { label: 'Dim 1 — Intoxication & Withdrawal', placeholder: 'CIWA, COWS scores; current intoxication/withdrawal risk…', rows: 3 },
      { label: 'Dim 2 — Biomedical Conditions', placeholder: 'Medical conditions impacting or impacted by substance use…', rows: 3 },
      { label: 'Dim 3 — Emotional/Behavioral/Cognitive', placeholder: 'Psychiatric co-morbidity, cognitive functioning, emotional stability…', rows: 3 },
      { label: 'Dim 4 — Readiness to Change', placeholder: 'Stage of change, motivation, ambivalence, treatment goals…', rows: 3 },
      { label: 'Dim 5 — Relapse/Continued Use Potential', placeholder: 'Triggers, high-risk situations, coping skills, prior relapse patterns…', rows: 3 },
      { label: 'Dim 6 — Recovery Environment', placeholder: 'Home, social network, family support, living stability, community resources…', rows: 3 },
    ],
    'MAT & Withdrawal': [
      { label: 'MAT Candidacy', placeholder: 'Opioid use disorder: buprenorphine/naltrexone candidacy. AUD: acamprosate/naltrexone candidacy…', rows: 3 },
      { label: 'Medical Clearance for Withdrawal', placeholder: 'Medical needs for medically managed withdrawal, referral if needed…', rows: 2 },
      { label: 'Current Medications', placeholder: 'All medications including prescribed, OTC, supplements…', rows: 3 },
      { label: 'PDMP Review', placeholder: 'PDMP checked (Y/N), findings, controlled substances…', rows: 2 },
    ],
    'Dx & LOC': [
      { label: 'Clinical Formulation', placeholder: 'ASAM-informed biopsychosocial formulation…', rows: 4 },
      { label: 'Recommended Level of Care', placeholder: 'ASAM level (0.5 / 1 / 2.1 / 2.5 / 3.1 / 3.3 / 3.5 / 3.7 / 4.0) and rationale…', rows: 3 },
      { label: 'Treatment Plan', placeholder: 'Short and long-term goals, interventions, referrals…', rows: 3 },
      { label: '42 CFR Part 2 Compliance', placeholder: 'ROI obtained, limitations on disclosure explained, consent documented…', rows: 2 },
    ],
  },
  CrisisEval: {
    'Presenting Crisis': [
      { label: 'Precipitating Event', placeholder: 'What led to crisis presentation today? Context and timeline…', rows: 3 },
      { label: 'Crisis Description', placeholder: "Nature of crisis, acute stressors, client's account…", rows: 3 },
      { label: 'Collateral Information', placeholder: 'Information from family, EMS, mobile crisis, ED…', rows: 2 },
    ],
    'HI & Perceptions': [
      { label: 'Homicidal Ideation', placeholder: 'Presence, plan, target, intent, means, access…', rows: 3 },
      { label: 'Perceptual Disturbances', placeholder: 'Hallucinations (AVH, VH, tactile), command hallucinations, content…', rows: 3 },
      { label: 'Delusions / Disorganization', placeholder: 'Paranoia, thought insertion/broadcasting, disorganized thought/behavior…', rows: 3 },
    ],
    'Intervention & Plan': [
      { label: 'Interventions Provided', placeholder: 'De-escalation, safety planning, psychoeducation, crisis counseling…', rows: 3 },
      { label: 'Disposition Decision & Rationale', placeholder: 'Discharge home, PHP, IOP, voluntary inpatient, involuntary hold — rationale…', rows: 4 },
      { label: 'Safety Plan', placeholder: 'Warning signs, coping strategies, supports, crisis resources (988), means restriction…', rows: 3 },
      { label: 'Follow-Up Plan', placeholder: 'Next appointment, warm handoff, care coordination…', rows: 2 },
    ],
  },
  CollateralNote: {
    'Contact & ROI': [
      { label: 'Contact Person', placeholder: 'Name, relationship to client, contact method (phone/telehealth/in-person)…', rows: 2 },
      { label: 'Date & Duration', placeholder: 'Date, time, duration of contact…', rows: 1 },
      { label: 'ROI Verification', placeholder: 'ROI on file (Y/N), date signed, scope of disclosure authorized…', rows: 2 },
      { label: '42 CFR Part 2 Compliance', placeholder: 'If SUD client: specific 42 CFR Part 2 consent reviewed; limitations explained…', rows: 2 },
    ],
    'Information Exchange': [
      { label: 'Information Received', placeholder: 'Information shared by collateral contact: observations, concerns, history…', rows: 4 },
      { label: 'Information Disclosed', placeholder: 'Information shared with collateral (per ROI scope): general progress, appointments…', rows: 3 },
    ],
    'Clinical Relevance': [
      { label: 'Clinical Relevance to Treatment', placeholder: 'How this contact informs treatment planning and clinical understanding…', rows: 4 },
      { label: 'Client Informed', placeholder: 'Was client informed of this contact? Client response…', rows: 2 },
      { label: 'Follow-Up Actions', placeholder: 'Next steps resulting from this collateral contact…', rows: 2 },
    ],
  },
};

// ─── MSE ──────────────────────────────────────────────────────────────────────

const ids: Record<EvalType, string> = { InitialPsych: 'psychiatric_eval', InitialPsychMed: 'initial_psych_med', PsychReEval: 'psych_re_eval', PsychFollowUp: 'psych_follow_up', Biopsychosocial: 'biopsychosocial', SUDEval: 'sud_asam', CrisisEval: 'crisis_evaluation', CollateralNote: 'collateral_consultation' };
export const SOURCE_EVALUATION_TEMPLATES: EvaluationTemplate[] = (Object.keys(EVAL_LABELS) as EvalType[]).map(type => ({
 id: ids[type], name: EVAL_LABELS[type], code: EVAL_CPT[type], description: EVAL_TABS[type].join(' · '),
 sections: [
  ...Object.entries(TAB_FIELDS[type]).flatMap(([group, fields]) => fields.map((field, index): EvaluationTemplateSection => ({
    id: (group + '_' + field.label).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    title: group + ' — ' + field.label, type: field.label === 'Vital Signs' ? 'vitals' : 'textarea', placeholder: field.placeholder,
    fieldLabel: field.label, group,
    required: index === 0 && group === EVAL_TABS[type][0],
  }))),
  ...(type === 'CollateralNote' ? [] : [
    { id: 'mse', title: 'Mental Status Examination', type: 'mse' as const },
    { id: 'risk_assessment', title: 'Risk Assessment', type: 'risk' as const },
    { id: 'diagnoses', title: 'Diagnostic Impressions', type: 'diagnosis' as const },
  ]),
 ],
}));
