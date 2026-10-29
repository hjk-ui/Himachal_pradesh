export type PrpDxCategory = 'Schizophrenia' | 'Mood' | 'Anxiety';

export type PrpDxCode = {
  code: string;
  label: string;
  category: PrpDxCategory;
  /** UI accent: purple | teal | gold */
  color: 'purple' | 'teal' | 'gold';
  useSparingly?: boolean;
  highDenialRisk?: boolean;
};

/** COMAR 10.09.80 qualifying ICD-10 for MD Medicaid PRP (16 codes) */
export const PRP_DX_CODES: PrpDxCode[] = [
  { code: 'F20.0', label: 'Paranoid schizophrenia', category: 'Schizophrenia', color: 'purple' },
  { code: 'F20.9', label: 'Schizophrenia, unspecified', category: 'Schizophrenia', color: 'purple' },
  { code: 'F22', label: 'Delusional disorder', category: 'Schizophrenia', color: 'purple' },
  {
    code: 'F25.0',
    label: 'Schizoaffective disorder, bipolar type',
    category: 'Schizophrenia',
    color: 'purple',
  },
  {
    code: 'F25.1',
    label: 'Schizoaffective disorder, depressive type',
    category: 'Schizophrenia',
    color: 'purple',
  },
  { code: 'F29', label: 'Unspecified psychosis', category: 'Schizophrenia', color: 'purple' },
  {
    code: 'F31.13',
    label: 'Bipolar manic severe, no psych features',
    category: 'Mood',
    color: 'teal',
  },
  {
    code: 'F31.4',
    label: 'Bipolar depressed severe, no psych features',
    category: 'Mood',
    color: 'teal',
  },
  { code: 'F31.81', label: 'Bipolar II disorder', category: 'Mood', color: 'teal' },
  {
    code: 'F33.2',
    label: 'MDD recurrent severe, no psych features',
    category: 'Mood',
    color: 'teal',
  },
  {
    code: 'F33.3',
    label: 'MDD recurrent severe with psych features',
    category: 'Mood',
    color: 'teal',
  },
  {
    code: 'F41.1',
    label: 'Generalized anxiety disorder',
    category: 'Anxiety',
    color: 'gold',
    useSparingly: true,
  },
  {
    code: 'F41.0',
    label: 'Panic disorder',
    category: 'Anxiety',
    color: 'gold',
    useSparingly: true,
  },
  {
    code: 'F40.10',
    label: 'Social anxiety disorder',
    category: 'Anxiety',
    color: 'gold',
    useSparingly: true,
  },
  {
    code: 'F43.22',
    label: 'Adjustment disorder with anxiety',
    category: 'Anxiety',
    color: 'gold',
    useSparingly: true,
  },
  {
    code: 'F41.9',
    label: 'Anxiety disorder, unspecified',
    category: 'Anxiety',
    color: 'gold',
    useSparingly: true,
    highDenialRisk: true,
  },
];

export const PRP_DX_CAT_COLORS: Record<PrpDxCategory, { bg: string; text: string }> = {
  Schizophrenia: { bg: '#F3E8FF', text: '#6B21A8' }, // purple
  Mood: { bg: '#CCFBF1', text: '#0F766E' }, // teal
  Anxiety: { bg: '#FEF3C7', text: '#B45309' }, // gold
};

export const PRP_DOMAINS = [
  'Daily Living',
  'Med Self-Mgmt',
  'Community Nav',
  'Social',
  'Prevocational',
  'Financial',
  'Symptom Self-Mgmt',
  'Crisis Prevention',
] as const;
