import { SOURCE_EVALUATION_TEMPLATES } from './sourceTemplates';
export interface EvaluationTemplateSection {
  id: string;
  title: string;
  type: 'text' | 'textarea' | 'select' | 'mse' | 'risk' | 'diagnosis' | 'asam';
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

export interface EvaluationTemplate {
  id: string;
  name: string;
  code?: string;
  description: string;
  targetRole?: string;
  requiresSupervisorCoSign?: boolean;
  sections: EvaluationTemplateSection[];
}

const EXISTING_TEMPLATES: EvaluationTemplate[] = [
  {
    id: 'biopsychosocial',
    name: 'Adult Comprehensive Diagnostic Evaluation',
    code: 'BPSO-01',
    description: 'Full baseline assessment covering medical, psychological, social history, MSE, risk, and preliminary diagnoses.',
    requiresSupervisorCoSign: false,
    sections: [
      { id: 'chief_complaint', title: 'Chief Complaint & Reason for Referral', type: 'textarea', placeholder: 'Client states reasons for seeking evaluation...', required: true },
      { id: 'hpi', title: 'History of Present Illness (HPI)', type: 'textarea', placeholder: 'Onset, duration, intensity, triggers, course of symptoms...', required: true },
      { id: 'psychiatric_history', title: 'Past Psychiatric History', type: 'textarea', placeholder: 'Previous diagnoses, hospitalizations, outpatient treatments, medication trials...' },
      { id: 'medical_history', title: 'Medical & Surgical History', type: 'textarea', placeholder: 'Chronic medical conditions, current non-psychiatric medications, allergies...' },
      { id: 'substance_history', title: 'Substance Use History', type: 'textarea', placeholder: 'Alcohol, nicotine, prescription drugs, illicit substances, usage patterns...' },
      { id: 'social_developmental', title: 'Social & Developmental History', type: 'textarea', placeholder: 'Family history, trauma/abuse history, education, employment, legal, living situation...' },
      { id: 'mse', title: 'Mental Status Examination (MSE)', type: 'mse' },
      { id: 'risk_assessment', title: 'Clinical Risk Assessment', type: 'risk' },
      { id: 'diagnoses', title: 'Diagnostic Impressions (ICD-10)', type: 'diagnosis' },
      { id: 'treatment_recommendations', title: 'Clinical Summary & Treatment Recommendations', type: 'textarea', placeholder: 'Summary formulation, level of care recommendation, therapeutic modalities...', required: true }
    ]
  },
  {
    id: 'psychiatric_eval',
    name: 'Psychiatric Diagnostic Evaluation (CPT 90791/90792)',
    code: 'CPT-90791',
    description: 'Diagnostic evaluation by licensed psychiatrist or psychiatric NP including medication review and medical necessity.',
    requiresSupervisorCoSign: false,
    sections: [
      { id: 'referral_reason', title: 'Reason for Psychiatric Consultation', type: 'textarea', required: true },
      { id: 'symptom_review', title: 'Current Symptoms & Target Behaviors', type: 'textarea', required: true },
      { id: 'medication_reconciliation', title: 'Current Medications & Adherence', type: 'textarea', placeholder: 'List all psychotropic and general medications, dosages, prescribing providers...' },
      { id: 'mse', title: 'Mental Status Examination', type: 'mse' },
      { id: 'risk_assessment', title: 'Suicide / Homicide / Self-Harm Risk Assessment', type: 'risk' },
      { id: 'diagnoses', title: 'ICD-10 Diagnostic Formulation', type: 'diagnosis' },
      { id: 'pharmacotherapy_plan', title: 'Pharmacotherapy & Clinical Management Plan', type: 'textarea', placeholder: 'Prescribed medications, dosage titration, labs ordered, follow-up schedule...' }
    ]
  },
  {
    id: 'mental_health_update',
    name: 'Mental Health Assessment Update',
    code: 'MHA-UPD',
    description: 'Annual or periodic update to re-evaluate treatment progress, updated diagnoses, and ongoing medical necessity.',
    sections: [
      { id: 'interval_history', title: 'Interval History & Recent Events', type: 'textarea', placeholder: 'Summary of progress since last assessment, major life changes, crises...', required: true },
      { id: 'symptom_status', title: 'Current Symptom Severity & Functional Status', type: 'textarea', required: true },
      { id: 'mse', title: 'Current Mental Status Examination', type: 'mse' },
      { id: 'risk_assessment', title: 'Re-Assessment of Risk', type: 'risk' },
      { id: 'diagnoses', title: 'Updated ICD-10 Diagnoses', type: 'diagnosis' },
      { id: 'continued_care_justification', title: 'Continued Care & Medical Necessity Justification', type: 'textarea', required: true }
    ]
  },
  {
    id: 'crisis_evaluation',
    name: 'Crisis Evaluation & Safety Protocol',
    code: 'CRISIS-01',
    description: 'Urgent evaluation triggered during acute clinical decompensation, suicidal/homicidal ideation, or emergency situations.',
    requiresSupervisorCoSign: true,
    sections: [
      { id: 'crisis_trigger', title: 'Crisis Trigger & Immediate Presentation', type: 'textarea', placeholder: 'What prompted the crisis evaluation? Who referred?', required: true },
      { id: 'risk_assessment', title: 'Comprehensive Risk & Lethality Assessment', type: 'risk' },
      { id: 'mse', title: 'Mental Status Examination (Crisis State)', type: 'mse' },
      { id: 'deescalation_interventions', title: 'De-escalation & Clinical Interventions Completed', type: 'textarea', placeholder: 'Safety planning, family notification, mobile crisis contact, grounding techniques...' },
      { id: 'disposition_plan', title: 'Crisis Disposition & Safety Plan', type: 'textarea', placeholder: 'Level of care disposition (Inpatient admission, Crisis Stabilization, Outpatient with Safety Plan)...', required: true }
    ]
  },
  {
    id: 'sud_asam',
    name: 'Substance Use Disorder Assessment & ASAM Criteria',
    code: 'SUD-ASAM',
    description: 'Specialized evaluation mapping client symptoms across 6 ASAM dimensions to determine appropriate level of care.',
    sections: [
      { id: 'substance_patterns', title: 'Substance Use Patterns & Dependence History', type: 'textarea', placeholder: 'Primary/secondary drugs of choice, frequency, route, last use date, overdose history...', required: true },
      { id: 'asam_dim1', title: 'ASAM Dimension 1: Acute Intoxication and/or Withdrawal Potential', type: 'textarea', placeholder: 'Withdrawal signs, detox history...' },
      { id: 'asam_dim2', title: 'ASAM Dimension 2: Biomedical Conditions and Complications', type: 'textarea', placeholder: 'Physical health conditions, liver/cardiac issues, chronic pain...' },
      { id: 'asam_dim3', title: 'ASAM Dimension 3: Emotional, Behavioral, or Cognitive Conditions', type: 'textarea', placeholder: 'Co-occurring psychiatric disorders, trauma, cognitive deficits...' },
      { id: 'asam_dim4', title: 'ASAM Dimension 4: Readiness to Change', type: 'textarea', placeholder: 'Stage of change (Precontemplation, Contemplation, Preparation, Action)...' },
      { id: 'asam_dim5', title: 'ASAM Dimension 5: Relapse, Continued Use, or Continued Problem Potential', type: 'textarea', placeholder: 'Triggers, craving intensity, coping mechanisms...' },
      { id: 'asam_dim6', title: 'ASAM Dimension 6: Recovery Environment', type: 'textarea', placeholder: 'Living situation, supportive relationships, environmental triggers...' },
      { id: 'risk_assessment', title: 'Risk Assessment', type: 'risk' },
      { id: 'diagnoses', title: 'ICD-10 Diagnoses (Substance Use & Mental Health)', type: 'diagnosis' },
      { id: 'asam_level_recommendation', title: 'Recommended ASAM Level of Care', type: 'select', options: ['Level 0.5: Early Intervention', 'Level 1: Outpatient Services', 'Level 2.1: Intensive Outpatient (IOP)', 'Level 2.5: Partial Hospitalization (PHP)', 'Level 3.1: Clinically Managed Low-Intensity Residential', 'Level 3.5: Clinically Managed High-Intensity Residential', 'Level 3.7: Medically Monitored Inpatient', 'Level 4: Medically Managed Intensive Inpatient'] }
    ]
  },
  {
    id: 'nursing_initial',
    name: 'Initial Nursing Assessment',
    code: 'NURS-01',
    description: 'Registered nurse evaluation of physical health status, vital signs, medication management, and medical screening.',
    sections: [
      { id: 'vitals', title: 'Vital Signs & Physical Screen', type: 'textarea', placeholder: 'BP, Pulse, Resp Rate, Temp, Height, Weight, BMI, Pain Score...' },
      { id: 'medical_allergies', title: 'Allergies & Adverse Reactions', type: 'textarea', placeholder: 'Drug allergies, food allergies, environmental allergies, reaction type...' },
      { id: 'nursing_review_systems', title: 'Nursing Review of Systems', type: 'textarea', placeholder: 'Neurological, Cardiovascular, Respiratory, Gastrointestinal, Musculoskeletal...' },
      { id: 'medication_administration', title: 'Current Medications & Self-Administration Ability', type: 'textarea' },
      { id: 'nursing_care_plan', title: 'Nursing Intervention & Health Education Plan', type: 'textarea' }
    ]
  },
  {
    id: 'discharge_eval',
    name: 'Discharge Evaluation & Continuing Care Plan',
    code: 'DISCH-01',
    description: 'End-of-treatment summary evaluating goal achievement, discharge status, continuing care recommendations, and safety plan.',
    sections: [
      { id: 'discharge_reason', title: 'Reason for Discharge', type: 'select', options: ['Treatment Completed / Goals Met', 'Transferred to Higher Level of Care', 'Client Relocated', 'Discontinued / Client Request', 'Administrative Discharge'] },
      { id: 'treatment_summary', title: 'Summary of Treatment Provided & Progress Made', type: 'textarea', required: true },
      { id: 'goal_attainment', title: 'Status of Treatment Goals at Discharge', type: 'textarea', required: true },
      { id: 'diagnoses', title: 'Discharge ICD-10 Diagnoses', type: 'diagnosis' },
      { id: 'continuing_care_plan', title: 'Continuing Care & Aftercare Recommendations', type: 'textarea', placeholder: 'Outpatient therapy providers, psychiatry referrals, peer support groups...', required: true }
    ]
  },
  {
    id: 'treatment_plan_eval',
    name: 'Individual Treatment Plan Evaluation',
    code: 'ITP-EVAL',
    description: 'Comprehensive review of problem statements, measurable goals, objectives, interventions, and frequency of care.',
    sections: [
      { id: 'presenting_problems', title: 'Presenting Clinical Problems / Needs', type: 'textarea', required: true },
      { id: 'goals_objectives', title: 'Measurable Goals & SMART Objectives', type: 'textarea', placeholder: 'Goal 1: [Target Outcome] by [Date]...', required: true },
      { id: 'therapeutic_interventions', title: 'Modality & Intervention Frequencies', type: 'textarea', placeholder: 'Individual Psychotherapy (1x/week), Medication Mgmt (1x/month)...' },
      { id: 'diagnoses', title: 'Target Diagnoses Addressed', type: 'diagnosis' }
    ]
  },
  {
    id: 'adult_psych_re_eval',
    name: 'Adult Psychiatry Re-Evaluation',
    code: 'PSYCH-RE-ADULT',
    description: 'Adult psychiatry re-evaluation saved on this client.',
    sections: [
      { id: 'interval_history', title: 'Interval history', type: 'textarea', required: true },
      { id: 'mse', title: 'Mental Status Examination', type: 'mse' },
      { id: 'diagnoses', title: 'Diagnoses', type: 'diagnosis' },
      { id: 'plan', title: 'Plan', type: 'textarea', required: true },
    ],
  },
  {
    id: 'child_psych_intake',
    name: 'Child Psychiatry Intake',
    code: 'PSYCH-INTAKE-CHILD',
    description: 'Child psychiatry intake saved on this client.',
    sections: [
      { id: 'chief_complaint', title: 'Chief complaint', type: 'textarea', required: true },
      { id: 'developmental', title: 'Developmental history', type: 'textarea' },
      { id: 'mse', title: 'Mental Status Examination', type: 'mse' },
      { id: 'diagnoses', title: 'Diagnoses', type: 'diagnosis' },
      { id: 'plan', title: 'Plan', type: 'textarea', required: true },
    ],
  }
];

export const EVALUATION_TEMPLATES: EvaluationTemplate[] = [
 ...SOURCE_EVALUATION_TEMPLATES.map(source => ({ ...source, requiresSupervisorCoSign: EXISTING_TEMPLATES.find(t => t.id === source.id)?.requiresSupervisorCoSign })),
 ...EXISTING_TEMPLATES.filter(existing => !SOURCE_EVALUATION_TEMPLATES.some(source => source.id === existing.id)),
];
