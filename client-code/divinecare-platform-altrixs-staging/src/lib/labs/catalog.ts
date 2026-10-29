/**
 * Built-in Altrixs lab test catalog (behavioral health + primary care). Pure: no prisma, safe in
 * the browser and in tests. Each org's imported / edited tests (LabTest rows) are merged over this
 * list by `key` (see mergeCatalog). Valant lab request types map onto these keys
 * (src/lib/labs/catalogImport.ts).
 *
 * CODES — owner rule: never fabricated. A LOINC / CPT code appears here only when it was checked
 * against a published source (docs/labs.md, "Code sources"):
 *   - LOINC: Regenstrief LOINC 2.82 via the HL7 terminology server (tx.fhir.org $lookup, status
 *     ACTIVE) — loinc.org itself blocked automated lookup; re-check in a browser when convenient.
 *   - CPT/HCPCS: CMS Clinical Laboratory Fee Schedule CY2026 Q4 (26clabq4.zip); 93000 (EKG) from
 *     the CMS Physician Fee Schedule RVU file (rvu26d.zip).
 * `null` means "code needed" (e.g. drug-screen codes depend on the performing lab's method).
 *
 * Specimen / container / handling are typical requirements and must be confirmed against the
 * performing lab's directory of services; the UI says so.
 */

export type LabCategory =
  | 'drug_screen'
  | 'therapeutic_drug_monitoring'
  | 'chemistry'
  | 'hematology'
  | 'endocrine'
  | 'infectious'
  | 'cardiac'
  | 'procedure'
  | 'genetic'
  | 'other';

export const LAB_CATEGORY_LABEL: Record<LabCategory, string> = {
  drug_screen: 'Drug screen / toxicology',
  therapeutic_drug_monitoring: 'Therapeutic drug monitoring',
  chemistry: 'Chemistry',
  hematology: 'Hematology',
  endocrine: 'Endocrine',
  infectious: 'Infectious disease',
  cardiac: 'Cardiac',
  procedure: 'In-office procedure',
  genetic: 'Genetic / pharmacogenomic',
  other: 'Other',
};

export const LAB_CATEGORIES = Object.keys(LAB_CATEGORY_LABEL) as LabCategory[];

/** lab = specimen to a laboratory; in_office_procedure = done in the practice (e.g. EKG) */
export type LabOrderType = 'lab' | 'in_office_procedure';

export type LabTestDef = {
  key: string;
  name: string;
  aliases: string[];
  isPanel: boolean;
  /** Panel components — listed only where the panel's content is defined (CPT panel definition) */
  components: string[];
  loinc: string | null;
  cpt: string | null;
  /** Why a code is blank or how it is billed (shown next to "code needed") */
  codeNote?: string;
  specimenType: string | null;
  container: string | null;
  fastingRequired: boolean;
  specialHandling: string | null;
  category: LabCategory;
  orderType: LabOrderType;
  /** Therapeutic drug level — trended on the chart Labs tab */
  trended?: boolean;
  active: boolean;
  source: 'valant' | 'altrixs';
  /** Names in the source system (Valant) that map to this test */
  sourceNames?: string[];
};

type Def = Pick<LabTestDef, 'key' | 'name' | 'category'> & Partial<Omit<LabTestDef, 'key' | 'name' | 'category'>>;

const SERUM = 'Serum';
const SST = 'SST (gold / tiger top)';
const PLAIN_RED = 'Plain red top (no gel)';
const LAVENDER = 'Lavender (EDTA)';
const GRAY = 'Gray (sodium fluoride) or SST';
const URINE_CUP = 'Urine collection cup';
const TROUGH = 'Trough level: draw just before the next dose (about 12 hours after the last dose). Record the last-dose time.';

function def(d: Def): LabTestDef {
  return {
    aliases: [],
    components: [],
    isPanel: false,
    fastingRequired: false,
    orderType: 'lab',
    specimenType: null,
    container: null,
    specialHandling: null,
    loinc: null,
    cpt: null,
    active: true,
    source: 'altrixs',
    ...d,
  };
}

export const BUILTIN_LAB_TESTS: LabTestDef[] = [
  // ─── Chemistry ────────────────────────────────────────────────────────────
  def({
    key: 'cmp',
    name: 'Comprehensive Metabolic Panel (CMP)',
    aliases: ['CMP', 'Comprehensive Metabolic Panel', 'Chem 14'],
    isPanel: true,
    // CPT 80053 panel definition
    components: [
      'Albumin', 'Bilirubin, total', 'Calcium, total', 'Carbon dioxide (bicarbonate)', 'Chloride', 'Creatinine', 'Glucose',
      'Alkaline phosphatase', 'Potassium', 'Protein, total', 'Sodium', 'ALT (alanine aminotransferase)',
      'AST (aspartate aminotransferase)', 'Urea nitrogen (BUN)',
    ],
    loinc: '24323-8',
    cpt: '80053',
    specimenType: SERUM,
    container: SST,
    specialHandling: 'Fasting preferred for glucose; not required unless ordered fasting.',
    category: 'chemistry',
  }),
  def({
    key: 'bmp',
    name: 'Basic Metabolic Panel (BMP)',
    aliases: ['BMP', 'Basic Metabolic Panel', 'Chemistry 7', 'Chem 7', 'Chem-7'],
    isPanel: true,
    // CPT 80048 panel definition (includes calcium; a classic "Chem 7" omits it — see docs/labs.md)
    components: ['Calcium, total', 'Carbon dioxide (bicarbonate)', 'Chloride', 'Creatinine', 'Glucose', 'Potassium', 'Sodium', 'Urea nitrogen (BUN)'],
    loinc: '24321-2',
    cpt: '80048',
    specimenType: SERUM,
    container: SST,
    category: 'chemistry',
  }),
  def({
    key: 'lft',
    name: 'Hepatic Function Panel',
    aliases: ['Liver Function Tests (LFTs)', 'LFTs', 'LFT', 'Liver panel', 'Hepatic Function Panel (LFTs)'],
    isPanel: true,
    // CPT 80076 panel definition
    components: ['Albumin', 'Bilirubin, total', 'Bilirubin, direct', 'Alkaline phosphatase', 'Protein, total', 'ALT (alanine aminotransferase)', 'AST (aspartate aminotransferase)'],
    loinc: '24325-3',
    cpt: '80076',
    specimenType: SERUM,
    container: SST,
    category: 'chemistry',
  }),
  def({
    key: 'lipid',
    name: 'Lipid Panel',
    aliases: ['Fasting Lipid Panel', 'Lipids'],
    isPanel: true,
    // CPT 80061 panel definition; most labs also report a calculated LDL
    components: ['Cholesterol, total', 'HDL cholesterol', 'Triglycerides'],
    loinc: '24331-1',
    cpt: '80061',
    specimenType: SERUM,
    container: SST,
    fastingRequired: true,
    specialHandling: 'Fasting 9–12 hours (water allowed) when ordered fasting.',
    category: 'chemistry',
  }),
  def({
    key: 'glucose-fasting',
    name: 'Glucose, Fasting',
    aliases: ['Fasting Blood Glucose', 'FBG', 'Fasting glucose', 'FPG'],
    loinc: '1558-6',
    cpt: '82947',
    specimenType: 'Serum or plasma',
    container: GRAY,
    fastingRequired: true,
    specialHandling: 'Fasting at least 8 hours.',
    category: 'chemistry',
  }),
  def({ key: 'ggt', name: 'Gamma-Glutamyl Transferase (GGT)', aliases: ['GGT', 'Gamma Glutamyl Transferase (GGT)', 'Gamma GT'], loinc: '2324-2', cpt: '82977', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'sodium', name: 'Sodium, Serum', aliases: ['Sodium', 'Na'], loinc: '2951-2', cpt: '84295', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'magnesium', name: 'Magnesium, Serum', aliases: ['Magnesium', 'Mg'], loinc: '19123-9', cpt: '83735', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'phosphate', name: 'Phosphorus (Phosphate), Serum', aliases: ['Phosphate', 'Phosphorus', 'Phos'], loinc: '2777-1', cpt: '84100', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'vit-d', name: 'Vitamin D, 25-Hydroxy', aliases: ['25-hydroxyvitamin D (25(OH)D)', '25-hydroxyvitamin D', '25(OH)D', 'Vitamin D'], loinc: '62292-8', cpt: '82306', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'b12', name: 'Vitamin B12', aliases: ['B12', 'Cobalamin'], loinc: '2132-9', cpt: '82607', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'folate', name: 'Folate, Serum', aliases: ['Folic Acid (Folate)', 'Folic acid', 'Folate'], loinc: '2284-8', cpt: '82746', specimenType: SERUM, container: SST, specialHandling: 'Protect from light.', category: 'chemistry' }),
  def({ key: 'iron', name: 'Iron, Serum', aliases: ['Iron', 'Serum iron'], loinc: '2498-4', cpt: '83540', specimenType: SERUM, container: SST, specialHandling: 'Morning draw preferred.', category: 'chemistry' }),
  def({ key: 'tibc', name: 'Total Iron Binding Capacity (TIBC)', aliases: ['Total Iron Binding Capacity', 'TIBC', 'Iron binding capacity'], loinc: '2500-7', cpt: '83550', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'ferritin', name: 'Ferritin', aliases: ['Ferritin, serum'], loinc: '2276-4', cpt: '82728', specimenType: SERUM, container: SST, category: 'chemistry' }),
  def({ key: 'ua', name: 'Urinalysis', aliases: ['UA'], specimenType: 'Urine', container: URINE_CUP, category: 'chemistry', codeNote: 'Code needed: CPT depends on method (dipstick vs microscopy, in-office vs reference lab).' }),

  // ─── Hematology ───────────────────────────────────────────────────────────
  def({
    key: 'cbc',
    name: 'CBC with Differential / Platelets',
    aliases: ['CBC', 'CBC with Differential', 'Complete blood count', 'CBC w/ diff'],
    isPanel: true,
    components: [
      'WBC', 'RBC', 'Hemoglobin', 'Hematocrit', 'MCV', 'MCH', 'MCHC', 'RDW', 'Platelets',
      'Neutrophils, absolute (ANC)', 'Lymphocytes, absolute', 'Monocytes, absolute', 'Eosinophils, absolute', 'Basophils, absolute',
    ],
    loinc: '57021-8',
    cpt: '85025',
    specimenType: 'Whole blood',
    container: LAVENDER,
    category: 'hematology',
  }),
  def({ key: 'anc', name: 'Absolute Neutrophil Count (ANC)', aliases: ['ANC', 'Absolute neutrophil count', 'ANC / Absolute Neutrophil Count', 'Neutrophils, absolute (ANC)'], loinc: '751-8', specimenType: 'Whole blood', container: LAVENDER, category: 'hematology', trended: true, codeNote: 'Billed as CBC with differential (85025) at most labs.' }),
  def({ key: 'pt-inr', name: 'PT / INR', aliases: ['Prothrombin time', 'INR'], specimenType: 'Citrated plasma', container: 'Light blue (sodium citrate) — fill to the line', category: 'hematology' }),
  def({ key: 'esr', name: 'ESR (Sed Rate)', aliases: ['ESR', 'Sed rate'], specimenType: 'Whole blood', container: LAVENDER, category: 'hematology' }),

  // ─── Endocrine ────────────────────────────────────────────────────────────
  def({ key: 'tsh', name: 'TSH (Thyroid-Stimulating Hormone)', aliases: ['Thyroid-stimulating Hormone Level', 'TSH Level', 'TSH', 'Thyrotropin'], loinc: '3016-3', cpt: '84443', specimenType: SERUM, container: SST, category: 'endocrine' }),
  def({
    key: 'tsh-reflex',
    name: 'TSH with Reflex to Free T4',
    aliases: ['TSH Reflex', 'TSH w/ reflex', 'TSH reflex to FT4'],
    cpt: '84443',
    codeNote: 'Order code is lab-specific (no single LOINC order code). Bill 84443; add 84439 only when the lab performs the reflex Free T4.',
    specimenType: SERUM,
    container: SST,
    specialHandling: 'The lab adds Free T4 only when TSH is outside its reflex limits.',
    category: 'endocrine',
  }),
  def({ key: 'free-t4', name: 'Free T4 (Free Thyroxine)', aliases: ['Free T4', 'FT4'], loinc: '3024-7', cpt: '84439', specimenType: SERUM, container: SST, category: 'endocrine' }),
  def({ key: 't4-total', name: 'T4 (Thyroxine), Total', aliases: ['T4', 'Total T4', 'Thyroxine'], loinc: '3026-2', cpt: '84436', specimenType: SERUM, container: SST, category: 'endocrine' }),
  def({ key: 'free-t3', name: 'Free T3', aliases: ['FT3'], specimenType: SERUM, container: SST, category: 'endocrine' }),
  def({ key: 'a1c', name: 'Hemoglobin A1c', aliases: ['Hemoglobin A1C', 'HbA1c', 'A1C', 'Glycated hemoglobin'], loinc: '4548-4', cpt: '83036', specimenType: 'Whole blood', container: LAVENDER, category: 'endocrine' }),
  def({ key: 'prolactin', name: 'Prolactin', aliases: ['PRL'], loinc: '2842-3', cpt: '84146', specimenType: SERUM, container: SST, specialHandling: 'Draw at least 3 hours after waking; avoid stress or breast stimulation before the draw.', category: 'endocrine' }),
  def({ key: 'testosterone', name: 'Testosterone, Total', aliases: ['Total testosterone'], loinc: '2986-8', cpt: '84403', specimenType: SERUM, container: SST, specialHandling: 'Morning draw (before 10 AM) preferred.', category: 'endocrine' }),
  def({ key: 'testosterone-free', name: 'Testosterone, Free', aliases: ['Free testosterone'], loinc: '2991-8', cpt: '84402', specimenType: SERUM, container: SST, specialHandling: 'Morning draw (before 10 AM) preferred.', category: 'endocrine' }),
  def({ key: 'cortisol-am', name: 'Cortisol, AM', aliases: ['Cortisol (AM)', 'Morning cortisol'], specimenType: SERUM, container: SST, specialHandling: 'Draw 7–9 AM.', category: 'endocrine' }),
  def({
    key: 'hcg-serum',
    name: 'hCG (Human Chorionic Gonadotropin), Serum',
    aliases: ['Human Chorionic Gonadotropin (HCG)', 'HCG', 'Serum pregnancy test', 'Beta hCG'],
    codeNote: 'Code needed: confirm quantitative (CPT 84702) or qualitative (84703) with the practice.',
    specimenType: SERUM,
    container: SST,
    category: 'endocrine',
  }),
  def({
    key: 'hcg-urine',
    name: 'Pregnancy Test, Urine (hCG)',
    aliases: ['Urine Pregnancy Test', 'UPT', 'Urine hCG'],
    loinc: '2106-3',
    cpt: '81025',
    codeNote: '81025 = in-office visual color comparison kit. A reference-lab qualitative hCG bills 84703.',
    specimenType: 'Urine',
    container: URINE_CUP,
    specialHandling: 'First-morning urine preferred.',
    category: 'endocrine',
  }),

  // ─── Therapeutic drug monitoring ──────────────────────────────────────────
  def({ key: 'lithium', name: 'Lithium Level, Serum', aliases: ['Lithium, Serum', 'Lithium', 'Lithium Level', 'Li level'], loinc: '14334-7', cpt: '80178', specimenType: SERUM, container: PLAIN_RED, specialHandling: `${TROUGH} Do not use lithium-heparin tubes.`, category: 'therapeutic_drug_monitoring', trended: true }),
  def({ key: 'valproic', name: 'Valproic Acid Level, Total', aliases: ['Valproic Acid, Serum', 'Depakote', 'Depakote level', 'Divalproex', 'Valproate', 'Valproic Acid Level', 'VPA level'], loinc: '4086-5', cpt: '80164', specimenType: SERUM, container: PLAIN_RED, specialHandling: TROUGH, category: 'therapeutic_drug_monitoring', trended: true }),
  def({ key: 'carbamazepine', name: 'Carbamazepine Level, Total', aliases: ['Carbamazepine, Serum', 'Tegretol Level', 'Tegretol', 'Carbamazepine Level', 'CBZ level'], loinc: '3432-2', cpt: '80156', specimenType: SERUM, container: PLAIN_RED, specialHandling: TROUGH, category: 'therapeutic_drug_monitoring', trended: true }),
  def({ key: 'clozapine', name: 'Clozapine Level', aliases: ['Clozapine', 'Clozaril level'], loinc: '6896-5', cpt: '80159', specimenType: SERUM, container: PLAIN_RED, specialHandling: `${TROUGH} Many labs also report norclozapine.`, category: 'therapeutic_drug_monitoring', trended: true }),
  def({ key: 'nortriptyline', name: 'Nortriptyline Level, Serum', aliases: ['Nortriptyline, Serum', 'Nortriptyline', 'Pamelor level'], loinc: '3872-9', codeNote: 'CPT 80335 (tricyclics) is not on the Medicare CLFS; Medicare definitive drug testing bills G0480–G0483. Confirm with the lab.', specimenType: SERUM, container: PLAIN_RED, specialHandling: TROUGH, category: 'therapeutic_drug_monitoring', trended: true }),
  def({ key: 'risperidone', name: 'Risperidone + 9-Hydroxyrisperidone Level', aliases: ['Risperidone', 'Risperdal level'], loinc: '9394-8', codeNote: 'CPT 80342 is not on the Medicare CLFS; Medicare definitive drug testing bills G0480–G0483. Confirm with the lab.', specimenType: SERUM, container: PLAIN_RED, specialHandling: TROUGH, category: 'therapeutic_drug_monitoring', trended: true }),
  def({ key: 'lamotrigine', name: 'Lamotrigine Level', aliases: ['Lamictal level'], specimenType: SERUM, container: PLAIN_RED, specialHandling: TROUGH, category: 'therapeutic_drug_monitoring', trended: true }),

  // ─── Drug screen / toxicology ─────────────────────────────────────────────
  def({
    key: 'uds',
    name: 'Urine Drug Abuse Profile, without confirmation',
    aliases: ['Routine Urine Drug Abuse Profile, without confirmation', 'Urine Drug Screen (10-panel)', 'UDS', 'Urine drug screen'],
    codeNote: 'Code needed: presumptive screening bills 80305 / 80306 / 80307 by method — confirm with the lab.',
    specimenType: 'Urine',
    container: URINE_CUP,
    specialHandling: 'Temperature-checked collection; observed collection per program policy.',
    category: 'drug_screen',
  }),
  def({
    key: 'uds-confirm',
    name: 'Urine Drug Abuse Profile, with confirmation',
    aliases: ['Routine Urine Drug Abuse Profile, with confirmation', 'Urine Drug Screen with Confirmation', 'UDS with confirmation'],
    codeNote: 'Code needed: presumptive (80305–80307) plus definitive (Medicare G0480–G0483) by the lab’s method.',
    specimenType: 'Urine',
    container: URINE_CUP,
    specialHandling: 'Temperature-checked collection; observed collection per program policy. Positives confirmed by mass spectrometry.',
    category: 'drug_screen',
  }),
  def({
    key: 'uds-10-etg',
    name: '10-Panel Urine Drug Test + EtG',
    aliases: ['10 panel UDS with EtG'],
    codeNote: 'Code needed: the drug classes in the 10 panel and the EtG method are lab-specific.',
    specimenType: 'Urine',
    container: URINE_CUP,
    specialHandling: 'Temperature-checked collection; observed collection per program policy.',
    category: 'drug_screen',
  }),
  def({
    key: 'bup-mat',
    name: 'Buprenorphine MAT Monitoring (urine)',
    aliases: ['Buprenorphine MAT', 'Buprenorphine', 'Suboxone monitoring', 'MAT UDS'],
    codeNote: 'Code needed: panel contents (buprenorphine / norbuprenorphine, other classes) and method are lab-specific.',
    specimenType: 'Urine',
    container: URINE_CUP,
    specialHandling: 'Temperature-checked collection; observed collection per program policy.',
    category: 'drug_screen',
  }),
  def({ key: 'etg', name: 'EtG / EtS (alcohol metabolites), urine', aliases: ['EtG', 'Ethyl glucuronide', 'EtG / EtS (alcohol metabolites)'], specimenType: 'Urine', container: URINE_CUP, category: 'drug_screen' }),
  def({ key: 'etoh', name: 'Ethanol, Blood', aliases: ['Blood Alcohol / Ethanol', 'Blood alcohol'], specimenType: 'Whole blood or serum', container: GRAY, specialHandling: 'Do not clean the site with alcohol.', category: 'drug_screen' }),
  def({ key: 'cotinine', name: 'Cotinine (nicotine)', aliases: ['Cotinine'], specimenType: 'Urine or serum', category: 'drug_screen' }),

  // ─── Infectious disease ───────────────────────────────────────────────────
  def({
    key: 'hep-acute',
    name: 'Acute Hepatitis Panel',
    aliases: ['Hepatitis panel, acute'],
    isPanel: true,
    // CPT 80074 panel definition
    components: ['Hepatitis A antibody, IgM', 'Hepatitis B core antibody, IgM', 'Hepatitis B surface antigen', 'Hepatitis C antibody'],
    loinc: '24363-4',
    cpt: '80074',
    specimenType: SERUM,
    container: SST,
    category: 'infectious',
  }),
  def({ key: 'hiv', name: 'HIV-1/2 Antigen/Antibody (4th generation)', aliases: ['HIV Ag/Ab Combo', 'HIV screen 4th gen'], loinc: '56888-1', cpt: '87389', specimenType: SERUM, container: SST, specialHandling: 'Consent per Maryland law and practice policy.', category: 'infectious' }),
  def({
    key: 'hiv-ab-confirm',
    name: 'HIV Antibodies, preliminary with confirmation',
    aliases: ['HIV antibody with confirmation'],
    codeNote: 'Code needed: confirm with the lab whether this is antibody-only with confirmation or the 4th-generation Ag/Ab algorithm (87389).',
    specimenType: SERUM,
    container: SST,
    specialHandling: 'Consent per Maryland law and practice policy.',
    category: 'infectious',
  }),
  def({ key: 'hep-c', name: 'Hepatitis C Antibody', aliases: ['HCV antibody'], specimenType: SERUM, container: SST, category: 'infectious' }),
  def({ key: 'hep-b', name: 'Hepatitis B Surface Antigen', aliases: ['HBsAg'], specimenType: SERUM, container: SST, category: 'infectious' }),
  def({ key: 'rpr', name: 'RPR (Syphilis)', aliases: ['RPR', 'Syphilis screen'], specimenType: SERUM, container: SST, category: 'infectious' }),
  def({ key: 'quantiferon', name: 'QuantiFERON-TB Gold', aliases: ['TB blood test', 'IGRA'], specimenType: 'Whole blood', container: 'Lab-supplied QuantiFERON tubes', category: 'infectious' }),

  // ─── Inflammatory / other ─────────────────────────────────────────────────
  def({ key: 'ana', name: 'ANA Screen', aliases: ['ANA'], specimenType: SERUM, container: SST, category: 'other' }),
  def({ key: 'crp', name: 'C-Reactive Protein', aliases: ['CRP'], specimenType: SERUM, container: SST, category: 'other' }),
  def({ key: 'rf', name: 'Rheumatoid Factor', aliases: ['RF'], specimenType: SERUM, container: SST, category: 'other' }),

  // ─── Genetic / pharmacogenomic ────────────────────────────────────────────
  def({ key: 'cyp450', name: 'CYP450 Pharmacogenetic Panel', aliases: ['Pharmacogenomics', 'PGx'], isPanel: true, specimenType: 'Buccal swab or whole blood', category: 'genetic' }),
  def({ key: 'hlab1502', name: 'HLA-B*15:02 (carbamazepine risk)', aliases: ['HLA-B*1502', 'HLA-B*1502 (carbamazepine risk)'], specimenType: 'Whole blood', container: LAVENDER, category: 'genetic' }),

  // ─── In-office procedures (not a lab) ─────────────────────────────────────
  def({
    key: 'ekg',
    name: 'EKG, 12-lead',
    aliases: ['EKG', 'ECG', 'Electrocardiogram', '12-lead EKG'],
    loinc: '11524-6',
    cpt: '93000',
    codeNote: '93000 = complete (tracing with interpretation and report); Physician Fee Schedule, not the lab fee schedule.',
    category: 'procedure',
    orderType: 'in_office_procedure',
    specialHandling: 'Done in the office. Enter QTc (ms) and interpretation as the result; attach the tracing.',
  }),
];

// ─── Lookup / merge / search ─────────────────────────────────────────────────

/** Case, punctuation and spacing insensitive name key */
export function normalizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugTestKey(name: string): string {
  return normalizeTestName(name).replace(/\s+/g, '-').slice(0, 60) || 'test';
}

/** Row shape of a per-org LabTest (what catalog merge needs) */
export type OrgLabTestRow = {
  key: string;
  name: string;
  aliases: string[];
  isPanel: boolean;
  components: string[];
  loinc: string | null;
  cpt: string | null;
  specimenType: string | null;
  container: string | null;
  fastingRequired: boolean;
  specialHandling: string | null;
  category: string;
  orderType: string;
  active: boolean;
  source: string;
  sourceNames: string[];
};

const asCategory = (c: string): LabCategory => ((LAB_CATEGORIES as string[]).includes(c) ? (c as LabCategory) : 'other');

/**
 * Effective catalog: built-in tests, overlaid by the org's rows (same key) and extended by org-only
 * rows. Org values win when set; built-in codes / notes fill gaps so a verified code is never lost.
 * Inactive org rows are kept (active=false); callers filter `.active` for ordering.
 */
export function mergeCatalog(builtin: LabTestDef[], orgRows: OrgLabTestRow[]): LabTestDef[] {
  const byKey = new Map(builtin.map((t) => [t.key, { ...t }]));
  for (const row of orgRows) {
    const base = byKey.get(row.key);
    const name = row.name || base?.name || row.key;
    const aliases = [...new Set([...(base?.aliases ?? []), ...row.aliases])].filter((a) => normalizeTestName(a) !== normalizeTestName(name));
    byKey.set(row.key, {
      key: row.key,
      name,
      aliases,
      isPanel: row.isPanel || Boolean(base?.isPanel),
      components: row.components.length ? row.components : base?.components ?? [],
      loinc: row.loinc || base?.loinc || null,
      cpt: row.cpt || base?.cpt || null,
      codeNote: base?.codeNote,
      specimenType: row.specimenType || base?.specimenType || null,
      container: row.container || base?.container || null,
      fastingRequired: row.fastingRequired || Boolean(base?.fastingRequired),
      specialHandling: row.specialHandling || base?.specialHandling || null,
      category: base?.category ?? asCategory(row.category),
      orderType: row.orderType === 'in_office_procedure' ? 'in_office_procedure' : base?.orderType ?? 'lab',
      trended: base?.trended ?? false,
      active: row.active,
      source: row.source === 'valant' ? 'valant' : 'altrixs',
      sourceNames: row.sourceNames,
    });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Exact match on name, alias or source name (normalized) */
export function findTestByName(name: string, catalog: LabTestDef[]): LabTestDef | null {
  const n = normalizeTestName(name);
  if (!n) return null;
  return (
    catalog.find((t) => normalizeTestName(t.name) === n) ||
    catalog.find((t) => t.aliases.some((a) => normalizeTestName(a) === n)) ||
    catalog.find((t) => (t.sourceNames ?? []).some((a) => normalizeTestName(a) === n)) ||
    null
  );
}

export function findTestByKey(key: string, catalog: LabTestDef[]): LabTestDef | null {
  return catalog.find((t) => t.key === key) ?? null;
}

/** Search name, aliases, source names and codes. Active tests only; name-prefix matches first. */
export function searchCatalog(q: string, catalog: LabTestDef[], limit = 30): LabTestDef[] {
  const active = catalog.filter((t) => t.active);
  const n = normalizeTestName(q);
  if (!n) return active.slice(0, limit);
  const raw = q.trim();
  const scored: { t: LabTestDef; s: number }[] = [];
  for (const t of active) {
    const name = normalizeTestName(t.name);
    const hay = [name, ...t.aliases.map(normalizeTestName), ...(t.sourceNames ?? []).map(normalizeTestName)];
    let s = -1;
    if (name.startsWith(n)) s = 0;
    else if (hay.some((h) => h.startsWith(n))) s = 1;
    else if (hay.some((h) => h.includes(n))) s = 2;
    else if ((t.loinc && t.loinc.startsWith(raw)) || (t.cpt && t.cpt.startsWith(raw))) s = 3;
    if (s >= 0) scored.push({ t, s });
  }
  return scored
    .sort((a, b) => a.s - b.s || a.t.name.localeCompare(b.t.name))
    .slice(0, limit)
    .map((x) => x.t);
}

export function testsByCategory(catalog: LabTestDef[]): { category: LabCategory; label: string; tests: LabTestDef[] }[] {
  return LAB_CATEGORIES.map((c) => ({ category: c, label: LAB_CATEGORY_LABEL[c], tests: catalog.filter((t) => t.active && t.category === c) })).filter(
    (g) => g.tests.length
  );
}

/** Keys of tests whose values are trended on the chart Labs tab (drug levels, ANC) */
export const TRENDED_TEST_KEYS: readonly string[] = BUILTIN_LAB_TESTS.filter((t) => t.trended).map((t) => t.key);
