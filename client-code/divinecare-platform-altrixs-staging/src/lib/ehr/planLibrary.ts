export const PLAN_TYPES = [
  'Individual Therapy',
  'Psychiatric Medical',
  'Substance Use Disorder (SUD)',
  'Group Therapy',
  'Family Therapy',
  'PRP Rehabilitation',
  'Case Management Care Plan',
  'Crisis Safety Plan',
  'Transition & Discharge Plan',
] as const;
export const LEVELS_OF_CARE = [
  'Outpatient',
  'Intensive Outpatient',
  'Partial Hospitalization',
  'Residential',
  'Inpatient',
  'Community-based',
] as const;
export const ASAM_LEVELS = [
  'Not applicable',
  'Level 0.5 Early Intervention',
  'Level 1 Outpatient',
  'Level 2.1 Intensive Outpatient',
  'Level 2.5 Partial Hospitalization',
  'Level 3.1 Low-Intensity Residential',
  'Level 3.3 Population-Specific Residential',
  'Level 3.5 High-Intensity Residential',
  'Level 3.7 Medically Monitored Intensive Inpatient',
] as const;
export const SERVICE_FREQUENCIES = [
  'Weekly',
  'Bi-weekly',
  '2x/week',
  '3x/week',
  'Monthly',
  'Daily',
  'As needed',
] as const;
export const EXPECTED_DURATIONS = [
  '30 days',
  '60 days',
  '90 days',
  '180 days',
  '365 days',
] as const;
export type PlanCare = {
  planType: (typeof PLAN_TYPES)[number] | '';
  levelOfCare: (typeof LEVELS_OF_CARE)[number] | '';
  asamLevel: (typeof ASAM_LEVELS)[number] | '';
  serviceFrequency: (typeof SERVICE_FREQUENCIES)[number] | '';
  expectedDuration: (typeof EXPECTED_DURATIONS)[number] | '';
  coordinationOfCare: string;
  barriersToTreatment: string;
};
export const EMPTY_PLAN_CARE: PlanCare = {
  planType: '',
  levelOfCare: '',
  asamLevel: '',
  serviceFrequency: '',
  expectedDuration: '',
  coordinationOfCare: '',
  barriersToTreatment: '',
};
export const DIAGNOSIS_GROUPS: { label: string; diagnoses: { icd: string; dsm: string }[] }[] = [
  {
    label: 'Depression',
    diagnoses: [
      { icd: 'F32.0', dsm: 'Major Depressive Disorder, Single Episode, Mild' },
      { icd: 'F32.1', dsm: 'Major Depressive Disorder, Single Episode, Moderate' },
      { icd: 'F33.0', dsm: 'Major Depressive Disorder, Recurrent, Mild' },
      { icd: 'F33.1', dsm: 'Major Depressive Disorder, Recurrent, Moderate' },
      { icd: 'F33.2', dsm: 'Major Depressive Disorder, Recurrent, Severe' },
    ],
  },
  {
    label: 'Anxiety Disorders',
    diagnoses: [
      { icd: 'F41.1', dsm: 'Generalized Anxiety Disorder' },
      { icd: 'F41.0', dsm: 'Panic Disorder' },
      { icd: 'F40.10', dsm: 'Social Anxiety Disorder' },
      { icd: 'F40.00', dsm: 'Agoraphobia' },
      { icd: 'F41.9', dsm: 'Anxiety Disorder, Unspecified' },
    ],
  },
  {
    label: 'Trauma & Stressor-Related',
    diagnoses: [
      { icd: 'F43.10', dsm: 'PTSD, Unspecified' },
      { icd: 'F43.12', dsm: 'PTSD, Chronic' },
      { icd: 'F43.21', dsm: 'Adjustment Disorder with Depressed Mood' },
      { icd: 'F43.23', dsm: 'Adjustment Disorder with Mixed Anxiety and Depressed Mood' },
    ],
  },
  {
    label: 'Bipolar & Related',
    diagnoses: [
      { icd: 'F31.10', dsm: 'Bipolar I Disorder, Manic Episode' },
      { icd: 'F31.32', dsm: 'Bipolar I Disorder, Depressed, Moderate' },
      { icd: 'F31.81', dsm: 'Bipolar II Disorder' },
      { icd: 'F34.0', dsm: 'Cyclothymic Disorder' },
    ],
  },
  {
    label: 'Psychotic Disorders',
    diagnoses: [
      { icd: 'F20.9', dsm: 'Schizophrenia' },
      { icd: 'F25.0', dsm: 'Schizoaffective Disorder, Bipolar Type' },
      { icd: 'F25.1', dsm: 'Schizoaffective Disorder, Depressive Type' },
      { icd: 'F29', dsm: 'Unspecified Psychosis' },
    ],
  },
  {
    label: 'Substance Use Disorders',
    diagnoses: [
      { icd: 'F10.20', dsm: 'Alcohol Dependence, Uncomplicated' },
      { icd: 'F10.21', dsm: 'Alcohol Dependence, In Remission' },
      { icd: 'F11.20', dsm: 'Opioid Dependence, Uncomplicated' },
      { icd: 'F12.20', dsm: 'Cannabis Dependence, Uncomplicated' },
      { icd: 'F14.20', dsm: 'Cocaine Dependence, Uncomplicated' },
      { icd: 'F15.20', dsm: 'Other Stimulant Dependence, Uncomplicated' },
      { icd: 'F19.20', dsm: 'Other Psychoactive Substance Dependence' },
    ],
  },
  {
    label: 'ADHD & Neurodevelopmental',
    diagnoses: [
      { icd: 'F90.0', dsm: 'ADHD, Predominantly Inattentive' },
      { icd: 'F90.1', dsm: 'ADHD, Predominantly Hyperactive' },
      { icd: 'F90.2', dsm: 'ADHD, Combined Presentation' },
      { icd: 'F84.0', dsm: 'Autism Spectrum Disorder' },
    ],
  },
  {
    label: 'Eating Disorders',
    diagnoses: [
      { icd: 'F50.00', dsm: 'Anorexia Nervosa, Unspecified' },
      { icd: 'F50.20', dsm: 'Bulimia Nervosa, Unspecified' },
      { icd: 'F50.819', dsm: 'Binge Eating Disorder, Unspecified' },
    ],
  },
  {
    label: 'Personality Disorders',
    diagnoses: [
      { icd: 'F60.3', dsm: 'Borderline Personality Disorder' },
      { icd: 'F60.6', dsm: 'Avoidant Personality Disorder' },
      { icd: 'F60.0', dsm: 'Paranoid Personality Disorder' },
    ],
  },
  {
    label: 'Other',
    diagnoses: [
      { icd: 'F42.2', dsm: 'Obsessive-Compulsive Disorder, Mixed' },
      { icd: 'F51.01', dsm: 'Primary Insomnia' },
      { icd: 'F91.3', dsm: 'Oppositional Defiant Disorder' },
      { icd: 'F34.1', dsm: 'Persistent Depressive Disorder' },
    ],
  },
];
export const DIAGNOSIS_OPTIONS = DIAGNOSIS_GROUPS.flatMap((group) => group.diagnoses);
export type PracticeTemplate = {
  name: string;
  icd: string;
  planType: PlanCare['planType'];
  goals: { text: string; objectives: string[]; interventions: string[] }[];
};
export const PRACTICE_TEMPLATES: PracticeTemplate[] = [
  {
    name: 'Major Depressive Disorder',
    icd: 'F33.1',
    planType: 'Individual Therapy',
    goals: [
      {
        text: 'Improve mood and daily functioning over 90 days.',
        objectives: [
          'Track mood and activity at least 4 days per week.',
          'Complete 2 personally meaningful activities weekly.',
          'Review PHQ-9 and functional progress every 4 weeks.',
        ],
        interventions: [
          'CBT cognitive restructuring',
          'Behavioral activation',
          'Collaborative symptom monitoring',
        ],
      },
    ],
  },
  {
    name: 'Generalized Anxiety Disorder',
    icd: 'F41.1',
    planType: 'Individual Therapy',
    goals: [
      {
        text: 'Reduce interference from worry and avoidance over 90 days.',
        objectives: [
          'Practice a grounding or relaxation skill 5 days per week.',
          'Identify and challenge 2 worry patterns each week.',
          'Review GAD-7 and functioning every 4 weeks.',
        ],
        interventions: [
          'CBT for worry',
          'Graduated exposure with consent',
          'Relaxation skill rehearsal',
        ],
      },
    ],
  },
  {
    name: 'PTSD Trauma Recovery',
    icd: 'F43.12',
    planType: 'Individual Therapy',
    goals: [
      {
        text: 'Strengthen safety, coping and trauma recovery over 180 days.',
        objectives: [
          'Develop a personalized grounding and safety plan within 2 sessions.',
          'Practice 2 stabilization skills between sessions.',
          'Review readiness and trauma symptoms every 4 weeks.',
        ],
        interventions: [
          'Trauma-informed stabilization',
          'Cognitive processing therapy when appropriate',
          'Collaborative safety planning',
        ],
      },
    ],
  },
  {
    name: 'Adult ADHD Management',
    icd: 'F90.0',
    planType: 'Individual Therapy',
    goals: [
      {
        text: 'Improve organization and task completion over 90 days.',
        objectives: [
          'Use a daily planner on 5 days each week.',
          'Break 3 weekly priority tasks into manageable steps.',
          'Review task completion and barriers at each session.',
        ],
        interventions: [
          'CBT for adult ADHD',
          'Executive function skill coaching',
          'Medication care coordination when indicated',
        ],
      },
    ],
  },
  {
    name: 'Substance Use Relapse Prevention',
    icd: 'F10.20',
    planType: 'Substance Use Disorder (SUD)',
    goals: [
      {
        text: 'Build a personalized recovery and relapse prevention plan over 90 days.',
        objectives: [
          'Identify 3 triggers and corresponding coping responses within 4 sessions.',
          'Identify 2 recovery supports and a contact plan.',
          'Review cravings, safety and recovery goals each week.',
        ],
        interventions: [
          'Motivational interviewing',
          'CBT relapse prevention',
          'Harm reduction and recovery support coordination',
        ],
      },
    ],
  },
  {
    name: 'Adolescent Behavioral',
    icd: 'F91.3',
    planType: 'Family Therapy',
    goals: [
      {
        text: 'Improve emotional regulation and family communication over 90 days.',
        objectives: [
          'Practice 2 regulation skills 4 days per week.',
          'Hold one collaborative family check-in each week.',
          'Track school and home behavior goals with appropriate consent.',
        ],
        interventions: [
          'Developmentally appropriate CBT',
          'Caregiver behavior management training',
          'School and family coordination with consent',
        ],
      },
    ],
  },
];
