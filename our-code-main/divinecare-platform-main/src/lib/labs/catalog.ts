export type Icd10Category =
  | 'Mood'
  | 'Psychotic'
  | 'Anxiety'
  | 'Personality'
  | 'ADHD'
  | 'Substance'
  | 'Medical';

export type Icd10Code = {
  code: string;
  description: string;
  category: Icd10Category;
};

/** Exact source category labels for Lab Orders modal. */
export type TestPanelCategory =
  | 'Metabolic & Safety Monitoring'
  | 'Endocrine & Hormonal'
  | 'Nutritional Deficiencies'
  | 'Psychiatric Medication Monitoring'
  | 'Substance Use / Toxicology'
  | 'Infectious Disease'
  | 'Autoimmune & Inflammatory'
  | 'Genetic & Specialty'
  | 'Routine';

export type TestPanel = {
  id: string;
  name: string;
  category: TestPanelCategory;
  /** Optional short hint shown in the order form */
  hint?: string;
};

export const SPECIMEN_OPTIONS = [
  'Venous Blood',
  'Urine',
  'Saliva',
  'Cheek Swab',
  'Finger-Stick Blood',
] as const;

/** Behavioral health–focused ICD-10 catalog for lab medical necessity. */
export const ICD10_CODES: Icd10Code[] = [
  { code: 'F31.30', description: 'Bipolar disorder, current episode depressed, mild', category: 'Mood' },
  { code: 'F31.31', description: 'Bipolar disorder, current episode depressed, moderate', category: 'Mood' },
  { code: 'F31.4', description: 'Bipolar disorder, current episode depressed, severe', category: 'Mood' },
  { code: 'F31.81', description: 'Bipolar II disorder', category: 'Mood' },
  { code: 'F32.1', description: 'Major depressive disorder, single episode, moderate', category: 'Mood' },
  { code: 'F32.2', description: 'Major depressive disorder, single episode, severe', category: 'Mood' },
  { code: 'F33.1', description: 'Major depressive disorder, recurrent, moderate', category: 'Mood' },
  { code: 'F33.2', description: 'Major depressive disorder, recurrent, severe', category: 'Mood' },
  { code: 'F34.1', description: 'Dysthymic disorder', category: 'Mood' },
  { code: 'F20.0', description: 'Paranoid schizophrenia', category: 'Psychotic' },
  { code: 'F20.9', description: 'Schizophrenia, unspecified', category: 'Psychotic' },
  { code: 'F22', description: 'Delusional disorder', category: 'Psychotic' },
  { code: 'F25.0', description: 'Schizoaffective disorder, bipolar type', category: 'Psychotic' },
  { code: 'F25.1', description: 'Schizoaffective disorder, depressive type', category: 'Psychotic' },
  { code: 'F29', description: 'Unspecified psychosis not due to a substance or known physiological condition', category: 'Psychotic' },
  { code: 'F41.0', description: 'Panic disorder', category: 'Anxiety' },
  { code: 'F41.1', description: 'Generalized anxiety disorder', category: 'Anxiety' },
  { code: 'F40.10', description: 'Social anxiety disorder', category: 'Anxiety' },
  { code: 'F43.10', description: 'Post-traumatic stress disorder, unspecified', category: 'Anxiety' },
  { code: 'F43.12', description: 'Post-traumatic stress disorder, chronic', category: 'Anxiety' },
  { code: 'F42.2', description: 'Obsessive-compulsive disorder', category: 'Anxiety' },
  { code: 'F60.3', description: 'Borderline personality disorder', category: 'Personality' },
  { code: 'F60.2', description: 'Antisocial personality disorder', category: 'Personality' },
  { code: 'F60.6', description: 'Avoidant personality disorder', category: 'Personality' },
  { code: 'F60.9', description: 'Personality disorder, unspecified', category: 'Personality' },
  { code: 'F90.0', description: 'ADHD, predominantly inattentive type', category: 'ADHD' },
  { code: 'F90.1', description: 'ADHD, predominantly hyperactive type', category: 'ADHD' },
  { code: 'F90.2', description: 'ADHD, combined type', category: 'ADHD' },
  { code: 'F90.9', description: 'ADHD, unspecified type', category: 'ADHD' },
  { code: 'F10.20', description: 'Alcohol dependence, uncomplicated', category: 'Substance' },
  { code: 'F11.20', description: 'Opioid dependence, uncomplicated', category: 'Substance' },
  { code: 'F12.20', description: 'Cannabis dependence, uncomplicated', category: 'Substance' },
  { code: 'F14.20', description: 'Cocaine dependence, uncomplicated', category: 'Substance' },
  { code: 'F15.20', description: 'Other stimulant dependence, uncomplicated', category: 'Substance' },
  { code: 'F19.20', description: 'Other psychoactive substance dependence, uncomplicated', category: 'Substance' },
  { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', category: 'Medical' },
  { code: 'E03.9', description: 'Hypothyroidism, unspecified', category: 'Medical' },
  { code: 'E55.9', description: 'Vitamin D deficiency, unspecified', category: 'Medical' },
  { code: 'E78.5', description: 'Hyperlipidemia, unspecified', category: 'Medical' },
  { code: 'N18.9', description: 'Chronic kidney disease, unspecified', category: 'Medical' },
  { code: 'Z79.899', description: 'Other long term (current) drug therapy', category: 'Medical' },
  { code: 'Z51.81', description: 'Encounter for therapeutic drug level monitoring', category: 'Medical' },
];

export const ICD10_CATEGORIES: Icd10Category[] = [
  'Mood',
  'Psychotic',
  'Anxiety',
  'Personality',
  'ADHD',
  'Substance',
  'Medical',
];

export const TEST_PANELS: TestPanel[] = [
  { id: 'cmp', name: 'Comprehensive Metabolic Panel (CMP)', category: 'Metabolic & Safety Monitoring' },
  { id: 'bmp', name: 'Basic Metabolic Panel (BMP)', category: 'Metabolic & Safety Monitoring' },
  { id: 'cbc', name: 'CBC with Differential', category: 'Metabolic & Safety Monitoring' },
  { id: 'lipid', name: 'Lipid Panel', category: 'Metabolic & Safety Monitoring' },
  { id: 'lft', name: 'Hepatic Function Panel (LFTs)', category: 'Metabolic & Safety Monitoring' },
  { id: 'rfp', name: 'Renal Function Panel', category: 'Metabolic & Safety Monitoring' },
  { id: 'a1c', name: 'Hemoglobin A1c', category: 'Metabolic & Safety Monitoring' },

  { id: 'tsh', name: 'TSH', category: 'Endocrine & Hormonal' },
  { id: 'free-t4', name: 'Free T4', category: 'Endocrine & Hormonal' },
  { id: 'free-t3', name: 'Free T3', category: 'Endocrine & Hormonal' },
  { id: 'cortisol-am', name: 'Cortisol (AM)', category: 'Endocrine & Hormonal' },
  { id: 'prolactin', name: 'Prolactin', category: 'Endocrine & Hormonal' },
  { id: 'testosterone', name: 'Testosterone, Total', category: 'Endocrine & Hormonal' },

  { id: 'vit-d', name: 'Vitamin D, 25-Hydroxy', category: 'Nutritional Deficiencies' },
  { id: 'b12', name: 'Vitamin B12', category: 'Nutritional Deficiencies' },
  { id: 'folate', name: 'Folate, Serum', category: 'Nutritional Deficiencies' },
  { id: 'iron-panel', name: 'Iron Panel / Ferritin', category: 'Nutritional Deficiencies' },
  { id: 'magnesium', name: 'Magnesium', category: 'Nutritional Deficiencies' },
  { id: 'zinc', name: 'Zinc', category: 'Nutritional Deficiencies' },

  {
    id: 'lithium',
    name: 'Lithium Level',
    category: 'Psychiatric Medication Monitoring',
    hint: 'Trough; draw 12h after last dose',
  },
  {
    id: 'valproic',
    name: 'Valproic Acid Level',
    category: 'Psychiatric Medication Monitoring',
    hint: 'Trough preferred',
  },
  { id: 'carbamazepine', name: 'Carbamazepine Level', category: 'Psychiatric Medication Monitoring' },
  { id: 'lamotrigine', name: 'Lamotrigine Level', category: 'Psychiatric Medication Monitoring' },
  { id: 'clozapine', name: 'Clozapine Level', category: 'Psychiatric Medication Monitoring' },
  { id: 'anc', name: 'ANC / Absolute Neutrophil Count', category: 'Psychiatric Medication Monitoring' },
  {
    id: 'metabolic-syndrome',
    name: 'Atypical Antipsychotic Metabolic Monitoring',
    category: 'Psychiatric Medication Monitoring',
    hint: 'Glucose, lipids, weight trend labs',
  },

  { id: 'uds', name: 'Urine Drug Screen (10-panel)', category: 'Substance Use / Toxicology' },
  { id: 'uds-confirm', name: 'Urine Drug Screen with Confirmation', category: 'Substance Use / Toxicology' },
  { id: 'etoh', name: 'Blood Alcohol / Ethanol', category: 'Substance Use / Toxicology' },
  { id: 'etg', name: 'EtG / EtS (alcohol metabolites)', category: 'Substance Use / Toxicology' },
  { id: 'cotinine', name: 'Cotinine (nicotine)', category: 'Substance Use / Toxicology' },

  { id: 'hiv', name: 'HIV Ag/Ab Combo', category: 'Infectious Disease' },
  { id: 'hep-c', name: 'Hepatitis C Antibody', category: 'Infectious Disease' },
  { id: 'hep-b', name: 'Hepatitis B Surface Antigen', category: 'Infectious Disease' },
  { id: 'rpr', name: 'RPR (Syphilis)', category: 'Infectious Disease' },
  { id: 'quantiferon', name: 'QuantiFERON-TB Gold', category: 'Infectious Disease' },

  { id: 'ana', name: 'ANA Screen', category: 'Autoimmune & Inflammatory' },
  { id: 'crp', name: 'C-Reactive Protein', category: 'Autoimmune & Inflammatory' },
  { id: 'esr', name: 'ESR (Sed Rate)', category: 'Autoimmune & Inflammatory' },
  { id: 'rf', name: 'Rheumatoid Factor', category: 'Autoimmune & Inflammatory' },

  { id: 'cyp450', name: 'CYP450 Pharmacogenetic Panel', category: 'Genetic & Specialty' },
  { id: 'hlab1502', name: 'HLA-B*1502 (carbamazepine risk)', category: 'Genetic & Specialty' },
  { id: 'hlab5801', name: 'HLA-B*5801 (allopurinol risk)', category: 'Genetic & Specialty' },

  { id: 'ua', name: 'Urinalysis', category: 'Routine' },
  { id: 'pregnancy', name: 'hCG, Qualitative (Serum/Urine)', category: 'Routine' },
  { id: 'pt-inr', name: 'PT / INR', category: 'Routine' },
];

export const TEST_PANEL_CATEGORIES: TestPanelCategory[] = [
  'Metabolic & Safety Monitoring',
  'Endocrine & Hormonal',
  'Nutritional Deficiencies',
  'Psychiatric Medication Monitoring',
  'Substance Use / Toxicology',
  'Infectious Disease',
  'Autoimmune & Inflammatory',
  'Genetic & Specialty',
  'Routine',
];

export function panelsByCategory(): Record<TestPanelCategory, TestPanel[]> {
  const map = Object.fromEntries(TEST_PANEL_CATEGORIES.map((c) => [c, [] as TestPanel[]])) as Record<
    TestPanelCategory,
    TestPanel[]
  >;
  for (const panel of TEST_PANELS) {
    map[panel.category].push(panel);
  }
  return map;
}

export function icd10ByCategory(): Record<Icd10Category, Icd10Code[]> {
  const map = Object.fromEntries(ICD10_CATEGORIES.map((c) => [c, [] as Icd10Code[]])) as Record<
    Icd10Category,
    Icd10Code[]
  >;
  for (const code of ICD10_CODES) {
    map[code.category].push(code);
  }
  return map;
}
