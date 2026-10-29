/**
 * Psychiatric medication monitoring order sets. SUGGESTIONS ONLY: the prescriber reviews, edits and
 * signs every order; nothing is placed automatically. Schedules restate the cited source (see
 * docs/labs.md for the full citations); patient factors decide the actual interval.
 */
import type { StandingIntervalUnit } from './standing';

export type OrderSetItem = {
  testKey: string;
  /** Pre-checked in the order form */
  defaultOn: boolean;
  when: 'baseline' | 'ongoing' | 'baseline_and_ongoing';
  note?: string;
};

export type OrderSetStanding = { testKeys: string[]; unit: StandingIntervalUnit; count: number; label: string };

export type LabOrderSet = {
  key: string;
  name: string;
  medication: string;
  items: OrderSetItem[];
  /** Non-lab measurements to record in Vitals (not orderable) */
  measurements?: string[];
  schedule: string;
  /** Optional standing orders the prescriber can turn on */
  standing: OrderSetStanding[];
  /** Keys into ORDER_SET_SOURCES */
  sources: string[];
};

export const ORDER_SET_SOURCES: Record<string, string> = {
  'fda-clozapine-rems-2025':
    'FDA Drug Safety Communication: FDA removes REMS program for the antipsychotic drug clozapine (effective June 13, 2025; communication Aug 27, 2025) — ANC monitoring per prescribing information is still recommended. https://www.fda.gov/drugs/drug-safety-and-availability/fda-removes-risk-evaluation-and-mitigation-strategy-rems-program-antipsychotic-drug-clozapine',
  'clozapine-pi': 'Clozapine (Clozaril) prescribing information — Severe neutropenia boxed warning and ANC monitoring schedule.',
  'apa-bipolar': 'American Psychiatric Association. Practice Guideline for the Treatment of Patients With Bipolar Disorder, 2nd ed. (2002).',
  'lithium-pi': 'Lithium carbonate prescribing information — toxicity boxed warning; serum level, renal and thyroid monitoring.',
  'valproate-pi': 'Divalproex sodium / valproic acid prescribing information — boxed warnings (hepatotoxicity, fetal risk, pancreatitis); liver tests and platelets.',
  'carbamazepine-pi': 'Carbamazepine prescribing information — boxed warnings (serious dermatologic reactions and HLA-B*1502; aplastic anemia / agranulocytosis); CBC, sodium, liver tests.',
  'ada-apa-2004':
    'American Diabetes Association, American Psychiatric Association, AACE, NAASO. Consensus development conference on antipsychotic drugs and obesity and diabetes. Diabetes Care 2004;27(2):596–601.',
  'apa-schizophrenia-2020': 'American Psychiatric Association. Practice Guideline for the Treatment of Patients With Schizophrenia, 3rd ed. (2020) — monitoring table.',
  'samhsa-tip63': 'SAMHSA. TIP 63: Medications for Opioid Use Disorder (updated 2021).',
  'asam-2020': 'ASAM National Practice Guideline for the Treatment of Opioid Use Disorder, 2020 Focused Update.',
};

export const LAB_ORDER_SETS: LabOrderSet[] = [
  {
    key: 'clozapine',
    name: 'Clozapine monitoring',
    medication: 'Clozapine',
    items: [
      { testKey: 'cbc', defaultOn: true, when: 'baseline_and_ongoing', note: 'ANC from the differential' },
      { testKey: 'clozapine', defaultOn: false, when: 'ongoing', note: 'At steady state or when adherence / toxicity is in question' },
      { testKey: 'a1c', defaultOn: true, when: 'baseline_and_ongoing' },
      { testKey: 'lipid', defaultOn: true, when: 'baseline_and_ongoing' },
    ],
    measurements: ['Weight / BMI', 'Waist circumference', 'Blood pressure'],
    schedule:
      'ANC (general population, per prescribing information): baseline; weekly for the first 6 months; every 2 weeks for months 6–12; monthly after 12 months. Different thresholds apply for benign ethnic neutropenia (BEN). The REMS ended in 2025; the FDA still recommends ANC monitoring per labeling.',
    standing: [
      { testKeys: ['cbc'], unit: 'weeks', count: 1, label: 'CBC/ANC weekly (months 0–6)' },
      { testKeys: ['cbc'], unit: 'weeks', count: 2, label: 'CBC/ANC every 2 weeks (months 6–12)' },
      { testKeys: ['cbc'], unit: 'months', count: 1, label: 'CBC/ANC monthly (after 12 months)' },
    ],
    sources: ['fda-clozapine-rems-2025', 'clozapine-pi', 'ada-apa-2004'],
  },
  {
    key: 'lithium',
    name: 'Lithium monitoring',
    medication: 'Lithium',
    items: [
      { testKey: 'lithium', defaultOn: true, when: 'ongoing', note: '12-hour trough' },
      { testKey: 'bmp', defaultOn: true, when: 'baseline_and_ongoing', note: 'Creatinine / BUN (renal), electrolytes, calcium' },
      { testKey: 'tsh', defaultOn: true, when: 'baseline_and_ongoing' },
      { testKey: 'hcg-urine', defaultOn: false, when: 'baseline', note: 'If the patient can become pregnant' },
      { testKey: 'ekg', defaultOn: false, when: 'baseline', note: 'Baseline EKG for patients with cardiac risk / older adults' },
    ],
    schedule:
      'Serum level 5–7 days after start or dose change, then every 3–6 months when stable; renal function and TSH (and calcium) at baseline and every 6–12 months.',
    standing: [
      { testKeys: ['lithium'], unit: 'months', count: 3, label: 'Lithium level every 3 months' },
      { testKeys: ['bmp', 'tsh'], unit: 'months', count: 6, label: 'BMP + TSH every 6 months' },
    ],
    sources: ['apa-bipolar', 'lithium-pi'],
  },
  {
    key: 'valproate',
    name: 'Valproate (Depakote) monitoring',
    medication: 'Valproate / divalproex',
    items: [
      { testKey: 'valproic', defaultOn: true, when: 'ongoing', note: 'Trough' },
      { testKey: 'lft', defaultOn: true, when: 'baseline_and_ongoing' },
      { testKey: 'cbc', defaultOn: true, when: 'baseline_and_ongoing', note: 'Platelets' },
      { testKey: 'hcg-urine', defaultOn: false, when: 'baseline', note: 'If the patient can become pregnant (fetal risk boxed warning)' },
    ],
    schedule: 'Liver tests and CBC with platelets at baseline and periodically (closely during the first 6 months); level after dose changes and when clinically indicated.',
    standing: [{ testKeys: ['valproic', 'lft', 'cbc'], unit: 'months', count: 6, label: 'Level + LFTs + CBC every 6 months' }],
    sources: ['valproate-pi', 'apa-bipolar'],
  },
  {
    key: 'carbamazepine',
    name: 'Carbamazepine (Tegretol) monitoring',
    medication: 'Carbamazepine',
    items: [
      { testKey: 'carbamazepine', defaultOn: true, when: 'ongoing', note: 'Trough; autoinduction lowers levels over the first weeks' },
      { testKey: 'cbc', defaultOn: true, when: 'baseline_and_ongoing' },
      { testKey: 'sodium', defaultOn: true, when: 'baseline_and_ongoing', note: 'Hyponatremia' },
      { testKey: 'lft', defaultOn: true, when: 'baseline_and_ongoing' },
      { testKey: 'hlab1502', defaultOn: false, when: 'baseline', note: 'Before starting, in patients of Asian ancestry at genetic risk (boxed warning)' },
    ],
    schedule: 'CBC, sodium and liver tests at baseline and periodically; level after dose changes and when clinically indicated.',
    standing: [{ testKeys: ['carbamazepine', 'cbc', 'sodium', 'lft'], unit: 'months', count: 6, label: 'Level + CBC + sodium + LFTs every 6 months' }],
    sources: ['carbamazepine-pi', 'apa-bipolar'],
  },
  {
    key: 'antipsychotic-metabolic',
    name: 'Antipsychotic metabolic monitoring',
    medication: 'Second-generation antipsychotics',
    items: [
      { testKey: 'glucose-fasting', defaultOn: true, when: 'baseline_and_ongoing', note: 'Or Hemoglobin A1c' },
      { testKey: 'a1c', defaultOn: false, when: 'baseline_and_ongoing' },
      { testKey: 'lipid', defaultOn: true, when: 'baseline_and_ongoing', note: 'Fasting' },
      { testKey: 'prolactin', defaultOn: false, when: 'ongoing', note: 'If symptoms of hyperprolactinemia' },
    ],
    measurements: ['Weight / BMI', 'Waist circumference', 'Blood pressure'],
    schedule:
      'ADA/APA 2004: weight/BMI at baseline, 4, 8 and 12 weeks, then quarterly; waist at baseline and annually; BP and fasting glucose at baseline, 12 weeks, then annually; fasting lipids at baseline, 12 weeks, then every 5 years if normal. APA 2020 adds A1c or fasting glucose and lipids at baseline, 4 months, then annually.',
    standing: [
      { testKeys: ['glucose-fasting'], unit: 'months', count: 12, label: 'Fasting glucose yearly (after the 12-week check)' },
      { testKeys: ['lipid'], unit: 'months', count: 12, label: 'Lipid panel yearly (APA 2020)' },
    ],
    sources: ['ada-apa-2004', 'apa-schizophrenia-2020'],
  },
  {
    key: 'buprenorphine',
    name: 'Buprenorphine (MAT) monitoring',
    medication: 'Buprenorphine',
    items: [
      { testKey: 'bup-mat', defaultOn: true, when: 'baseline_and_ongoing', note: 'Includes buprenorphine / norbuprenorphine per lab panel' },
      { testKey: 'lft', defaultOn: false, when: 'baseline' },
      { testKey: 'hep-acute', defaultOn: false, when: 'baseline', note: 'Hepatitis B / C screening' },
      { testKey: 'hiv', defaultOn: false, when: 'baseline' },
      { testKey: 'hcg-urine', defaultOn: false, when: 'baseline', note: 'If the patient can become pregnant' },
    ],
    schedule: 'Urine drug testing at intake and periodically; frequency is individualized and is typically higher early in treatment. Baseline liver tests and HIV / hepatitis screening are recommended.',
    standing: [{ testKeys: ['bup-mat'], unit: 'months', count: 1, label: 'MAT urine drug test monthly' }],
    sources: ['samhsa-tip63', 'asam-2020'],
  },
];

export function orderSetByKey(key: string): LabOrderSet | null {
  return LAB_ORDER_SETS.find((s) => s.key === key) ?? null;
}

const MED_PATTERNS: { set: string; re: RegExp }[] = [
  { set: 'clozapine', re: /clozapine|clozaril|versacloz|fazaclo/i },
  { set: 'lithium', re: /lithium|lithobid|eskalith/i },
  { set: 'valproate', re: /valpro|depakote|divalproex|depakene/i },
  { set: 'carbamazepine', re: /carbamazepine|tegretol|equetro|epitol|carbatrol/i },
  { set: 'buprenorphine', re: /buprenorphine|suboxone|subutex|zubsolv|sublocade|brixadi/i },
  {
    set: 'antipsychotic-metabolic',
    re: /clozapine|olanzapine|zyprexa|quetiapine|seroquel|risperidone|risperdal|paliperidone|invega|aripiprazole|abilify|ziprasidone|geodon|lurasidone|latuda|asenapine|saphris|iloperidone|fanapt|cariprazine|vraylar|brexpiprazole|rexulti|lumateperone|caplyta/i,
  },
];

/**
 * Order sets that fit the client's active medications (a hint for the prescriber; nothing is
 * ordered). `isAntipsychotic` comes from ClientMedication.isAntipsychotic.
 */
export function suggestedOrderSets(meds: { name: string; isAntipsychotic?: boolean }[]): string[] {
  const out = new Set<string>();
  for (const m of meds) {
    for (const p of MED_PATTERNS) if (p.re.test(m.name)) out.add(p.set);
    if (m.isAntipsychotic) out.add('antipsychotic-metabolic');
  }
  return LAB_ORDER_SETS.map((s) => s.key).filter((k) => out.has(k));
}
