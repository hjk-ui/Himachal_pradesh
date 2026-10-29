export interface LocusDimensionOption {
  score: number;
  label: string;
  description: string;
}

export interface LocusDimension {
  id: string;
  name: string;
  code: string;
  description: string;
  options: LocusDimensionOption[];
}

export const LOCUS_DIMENSIONS: LocusDimension[] = [
  {
    id: 'dim1_harm',
    name: 'Dimension 1: Risk of Harm',
    code: 'DIM-1',
    description: 'Measures risk of suicide, self-harm, aggression, or inability to care for basic survival needs.',
    options: [
      { score: 1, label: '1 - Low Risk', description: 'No ideation, plan, or intent. Minimal self-neglect.' },
      { score: 2, label: '2 - Low-Moderate Risk', description: 'Transient suicidal/homicidal ideation without plan or intent.' },
      { score: 3, label: '3 - Moderate Risk', description: 'Active ideation with vague plan; moderate self-neglect or impulsivity.' },
      { score: 4, label: '4 - Serious Risk', description: 'Active ideation with specific plan or recent self-harm/violence.' },
      { score: 5, label: '5 - Extreme Risk', description: 'Immediate lethality, acute violence, or grave disability.' }
    ]
  },
  {
    id: 'dim2_function',
    name: 'Dimension 2: Functional Status',
    code: 'DIM-2',
    description: 'Evaluates social, occupational, interpersonal, and daily living activity functioning.',
    options: [
      { score: 1, label: '1 - Minimal Impairment', description: 'Functioning appropriately across all major life domains.' },
      { score: 2, label: '2 - Mild Impairment', description: 'Minor disruption in social or work performance; copes with support.' },
      { score: 3, label: '3 - Moderate Impairment', description: 'Significant difficulty in job/school or persistent conflict.' },
      { score: 4, label: '4 - Serious Impairment', description: 'Inability to maintain employment/school; severe social withdrawal.' },
      { score: 5, label: '5 - Severe Disability', description: 'Inability to perform basic ADLs or maintain personal hygiene.' }
    ]
  },
  {
    id: 'dim3_comorbidity',
    name: 'Dimension 3: Medical, Addictive & Psychiatric Co-Morbidity',
    code: 'DIM-3',
    description: 'Assesses interaction between psychiatric, substance use, and general medical conditions.',
    options: [
      { score: 1, label: '1 - No Co-Morbidity', description: 'No co-occurring medical or addiction issues.' },
      { score: 2, label: '2 - Mild Co-Morbidity', description: 'Stable medical condition or mild substance use not interfering with treatment.' },
      { score: 3, label: '3 - Moderate Co-Morbidity', description: 'Active medical or substance disorder complicating psychiatric care.' },
      { score: 4, label: '4 - Severe Co-Morbidity', description: 'Severe medical instability or active severe addiction requiring monitoring.' },
      { score: 5, label: '5 - Extreme Co-Morbidity', description: 'Life-threatening medical or detox crisis requiring intensive hospital care.' }
    ]
  },
  {
    id: 'dim4a_stress',
    name: 'Dimension 4a: Recovery Environment - Level of Stress',
    code: 'DIM-4A',
    description: 'Evaluates environmental stressors (poverty, abuse, housing instability, family conflict).',
    options: [
      { score: 1, label: '1 - Low Stress', description: 'Stable environment with minimal stressors.' },
      { score: 2, label: '2 - Mild Stress', description: 'Occasional financial or interpersonal stress.' },
      { score: 3, label: '3 - Moderate Stress', description: 'Significant housing, economic, or family conflict.' },
      { score: 4, label: '4 - High Stress', description: 'Severe environmental threats, homelessness, domestic conflict.' },
      { score: 5, label: '5 - Extreme Stress', description: 'Imminent danger, victimization, or total lack of shelter.' }
    ]
  },
  {
    id: 'dim4b_support',
    name: 'Dimension 4b: Recovery Environment - Level of Support',
    code: 'DIM-4B',
    description: 'Assesses available social, familial, and community support networks.',
    options: [
      { score: 1, label: '1 - Highly Supportive', description: 'Strong, engaged family and peer support.' },
      { score: 2, label: '2 - Moderate Support', description: 'Adequate support system available.' },
      { score: 3, label: '3 - Limited Support', description: 'Inconsistent support network.' },
      { score: 4, label: '4 - Minimal Support', description: 'Isolated with negligible support.' },
      { score: 5, label: '5 - Total Lack of Support', description: 'Completely unsupportive or hostile environment.' }
    ]
  },
  {
    id: 'dim5_history',
    name: 'Dimension 5: Treatment & Recovery History',
    code: 'DIM-5',
    description: 'Evaluates historical response to past psychiatric/substance treatments and relapse pattern.',
    options: [
      { score: 1, label: '1 - Fully Responsive', description: 'Past treatments highly effective with good sustained recovery.' },
      { score: 2, label: '2 - Moderate Response', description: 'Good response to past care with minor relapses.' },
      { score: 3, label: '3 - Variable Response', description: 'Frequent relapses despite past outpatient interventions.' },
      { score: 4, label: '4 - Poor Response', description: 'Multiple past hospitalizations or treatment failures.' },
      { score: 5, label: '5 - Minimal Response', description: 'Chronic severe impairment with continuous crisis readmissions.' }
    ]
  },
  {
    id: 'dim6_engagement',
    name: 'Dimension 6: Engagement & Treatment Acceptance',
    code: 'DIM-6',
    description: 'Assesses client insight, motivation, and active participation in care.',
    options: [
      { score: 1, label: '1 - Fully Engaged', description: 'High insight, active collaboration in treatment planning.' },
      { score: 2, label: '2 - Moderate Engagement', description: 'Accepts treatment recommendation with minor hesitation.' },
      { score: 3, label: '3 - Ambivalent', description: 'Inconsistent attendance, partial insight.' },
      { score: 4, label: '4 - Reluctant / Resistant', description: 'Denies illness, refuses major treatment components.' },
      { score: 5, label: '5 - Unengaged / Hostile', description: 'Total refusal of care or active opposition.' }
    ]
  }
];

export function calculateLocusLevelOfCare(totalCompositeScore: number): { level: string; name: string } {
  if (totalCompositeScore <= 13) {
    return { level: 'Level 1', name: 'Low Intensity Outpatient Services' };
  } else if (totalCompositeScore <= 16) {
    return { level: 'Level 2', name: 'Low Intensity Community-Based Services' };
  } else if (totalCompositeScore <= 19) {
    return { level: 'Level 3', name: 'High Intensity Community-Based Services / IOP' };
  } else if (totalCompositeScore <= 22) {
    return { level: 'Level 4', name: 'Medically Monitored Non-Residential (PHP)' };
  } else if (totalCompositeScore <= 27) {
    return { level: 'Level 5', name: 'Medically Monitored Residential Services' };
  } else {
    return { level: 'Level 6', name: 'Medically Managed Intensive Inpatient Services' };
  }
}
