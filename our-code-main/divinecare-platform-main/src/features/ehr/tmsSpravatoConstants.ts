/** Shared clinical reference data for TMS & Spravato module (Altrixs). */

export const TMS_CONTRAINDICATIONS = [
  {
    id: 'c1',
    label:
      'Metal implants in or near head/neck (cochlear implants, aneurysm clips, deep brain stimulators)',
    absolute: true,
  },
  {
    id: 'c2',
    label: 'Implanted cardiac pacemaker or defibrillator (ICD)',
    absolute: true,
  },
  {
    id: 'c3',
    label: 'Implanted medication pumps in the head or neck',
    absolute: true,
  },
  {
    id: 'c4',
    label: 'Metallic implants in or near the brain stem or spinal cord',
    absolute: true,
  },
  {
    id: 'c5',
    label: 'History of seizure disorder or epilepsy',
    absolute: true,
  },
  {
    id: 'c6',
    label: 'Prior brain surgery with residual metal in skull',
    absolute: true,
  },
  { id: 'c7', label: 'Known brain tumor or lesion', absolute: false },
  { id: 'c8', label: 'Pregnancy (discuss risk/benefit)', absolute: false },
  {
    id: 'c9',
    label: 'Current substance use disorder (active)',
    absolute: false,
  },
  { id: 'c10', label: 'Significant cardiac disease', absolute: false },
  {
    id: 'c11',
    label: 'Severe sleep deprivation (increases seizure risk)',
    absolute: false,
  },
] as const;

export const CADSS_ITEMS = [
  'Surroundings seem unreal or unfamiliar',
  'Objects change size, shape, or color',
  'Feeling detached from surroundings as if watching from outside',
  'Things seem to happen in slow motion or are unclear',
  'Feeling as if you are not really there',
] as const;

export const MOAAS_LEVELS = [
  { score: 5, label: 'Alert — responds readily to name in normal tone' },
  { score: 4, label: 'Lethargic — responds to name in normal tone' },
  { score: 3, label: 'Responds only when called loudly or repeatedly' },
  { score: 2, label: 'Responds to mild prodding or shaking' },
  { score: 1, label: 'Responds only to painful trapezius squeeze' },
  { score: 0, label: 'No response to painful stimulus' },
] as const;

export const ADT_HISTORY_FIELDS = [
  { id: 'adt1', label: 'Trial 1', required: true },
  { id: 'adt2', label: 'Trial 2', required: true },
  { id: 'adt3', label: 'Trial 3', required: false },
  { id: 'adt4', label: 'Trial 4', required: false },
] as const;

export const TMS_PA_CHECKLIST = [
  'Diagnosis of Major Depressive Disorder (ICD-10 F32.x or F33.x) — not bipolar',
  'Minimum 2 adequate antidepressant trials (4+ weeks at therapeutic dose) in current episode',
  'Some payers require 4 failed trials (check payer-specific LCD)',
  'PHQ-9 ≥ 10 (or HDRS ≥ 14) at time of submission — document in chart',
  'Documentation that patient cannot tolerate or is not candidate for ECT',
  'Letter of Medical Necessity (LMN) from referring psychiatrist or MD',
  'Complete TMS contraindications screening form signed by prescriber',
  'MRI clearance if prior brain surgery or unclear metal history',
] as const;

export const SPRAVATO_REMS_CHECKLIST = [
  'Healthcare site certified at spravatorems.com',
  'Prescribing provider registered in REMS',
  'Certified pharmacy identified (specialty Rx only)',
  'Patient enrolled and counseled on REMS requirements',
  'Patient signed REMS Patient Enrollment Form',
  'Monitoring room confirmed (BP cuff, observation space)',
  'Driver confirmation — patient must NOT drive day of dose',
] as const;

export const SPRAVATO_PA_CHECKLIST = [
  'Diagnosis of Treatment-Resistant Depression (TRD): MDD + ≥ 2 failed antidepressants current episode',
  'OR: MDD with acute suicidal ideation/behavior (MDSI indication)',
  'Must be prescribed by or in consultation with a psychiatrist',
  'Patient must be enrolled in SPRAVATO REMS program',
  'Treatment must occur in a REMS-certified healthcare setting (cannot be dispensed for home use)',
  'Document blood pressure within acceptable range pre-treatment',
  'C-SSRS completed at each session — attach to claim',
  'Some commercial payers require TMS trial first (check payer policy)',
  'Medicaid coverage varies by state — Maryland often requires step therapy',
  'Janssen CarePath copay card can cover patient out-of-pocket (commercial insurance only)',
] as const;

export const TMS_BILLING = [
  {
    cpt: '90867',
    desc: 'TMS treatment; planning (initial setup + motor threshold)',
    unit: 'Per course',
    note: 'Usually billed once at start of treatment',
  },
  {
    cpt: '90868',
    desc: 'TMS treatment; delivery and management, per session',
    unit: 'Per session',
    note: 'Bill for each of the 36 sessions; requires progress note',
  },
  {
    cpt: '90869',
    desc: 'TMS treatment; motor threshold re-determination',
    unit: 'Per occurrence',
    note: 'Bill when motor threshold re-tested mid-course',
  },
] as const;

export const SPRAVATO_BILLING = [
  {
    cpt: 'J0718',
    desc: 'Esketamine (SPRAVATO) intranasal, 1 mg',
    unit: 'Per mg administered',
    note: 'Bill actual mg given (56 mg = 56 units; 84 mg = 84 units)',
  },
  {
    cpt: '99213-99215',
    desc: 'E&M Office Visit (level based on complexity)',
    unit: 'Per session',
    note: 'Required with each administration; document 2-hr monitoring period',
  },
  {
    cpt: '99224-99226',
    desc: 'E&M for established patient (if obs-level monitoring)',
    unit: 'Per session',
    note: 'Use for longer monitoring visits when warranted',
  },
  {
    cpt: '96127',
    desc: 'Brief emotional/behavioral assessment (PHQ-9, C-SSRS)',
    unit: 'Per assessment',
    note: 'Bill each time validated tool is scored; attach tool to chart',
  },
] as const;

export const PAYER_COVERAGE_NOTES = [
  {
    payer: 'Medicare (Traditional)',
    tms: 'Covered under LCD L34869 — 2+ failed ADT trials required',
    spravato: 'J0718 covered under Part B; requires prior auth from most MACs',
  },
  {
    payer: 'CareFirst BCBS (MD/DC/VA)',
    tms: 'Covered — 2 failed trials minimum, PHQ-9 ≥ 10 required',
    spravato: 'Covered with prior auth; may require TMS trial first',
  },
  {
    payer: 'Maryland Medicaid',
    tms: 'Not universally covered — submit PA; varies by MCO',
    spravato: 'Generally not covered; Janssen CarePath assistance available',
  },
  {
    payer: 'DC Medicaid (DHCF)',
    tms: 'Limited coverage — confirm with AmeriHealth DC or Trusted Health',
    spravato: 'Very limited — contact MCO case manager for exception process',
  },
  {
    payer: 'Aetna',
    tms: 'Covered — 2–4 failed ADT trials (policy varies)',
    spravato: 'Covered with PA; documents TRD diagnosis required',
  },
  {
    payer: 'Cigna / Evernorth',
    tms: 'Covered — submit LMN + antidepressant history',
    spravato: 'Covered with PA; Evernorth handles BH prior auth',
  },
  {
    payer: 'UnitedHealthcare / Optum',
    tms: 'Covered — UBH manages; 4 failed trials preferred',
    spravato: 'Covered with PA through Optum BH',
  },
  {
    payer: 'TRICARE',
    tms: 'Covered — contact Humana Military for PA',
    spravato: 'Limited coverage — case-by-case basis',
  },
  {
    payer: 'Humana',
    tms: 'Covered — medical necessity criteria apply',
    spravato: 'Covered with PA for TRD diagnosis',
  },
] as const;

export const RESOURCES = {
  provider: [
    {
      title: 'SPRAVATO REMS Program (FDA Required)',
      url: 'https://www.spravatorems.com',
      desc: 'Certify your practice, enroll patients, and access prescribing tools',
      org: 'Janssen / FDA',
    },
    {
      title: 'Janssen Medical Information — Spravato',
      url: 'https://www.janssenpro.com',
      desc: 'Full prescribing information, dosing guide, monitoring protocols',
      org: 'Janssen',
    },
    {
      title: 'Clinical TMS Society',
      url: 'https://clinicaltmssociety.org',
      desc: 'Practice guidelines, training resources, TMS certification programs',
      org: 'Clinical TMS Society',
    },
    {
      title: 'NeuroStar TMS Therapy (FDA cleared)',
      url: 'https://neurostar.com',
      desc: 'Most widely used TMS system — training, clinical support, prior auth tools',
      org: 'Neuronetics / NeuroStar',
    },
    {
      title: 'Brainsway Deep TMS',
      url: 'https://brainsway.com',
      desc: 'H-Coil TMS system; FDA cleared for depression, OCD, smoking cessation, MDD-AD',
      org: 'Brainsway',
    },
    {
      title: 'APA Practice Guideline — MDD',
      url: 'https://www.psychiatry.org/psychiatrists/practice/clinical-practice-guidelines',
      desc: 'American Psychiatric Association guidelines covering TMS and esketamine',
      org: 'APA',
    },
    {
      title: 'SAMHSA TIP 63 — Medications for OUD (ketamine context)',
      url: 'https://store.samhsa.gov',
      desc: 'Broader SAMHSA guidance on pharmacological treatment for MDD and TRD',
      org: 'SAMHSA',
    },
  ],
  biller: [
    {
      title: 'TMS CPT Code Guidance — CMS',
      url: 'https://www.cms.gov',
      desc: 'CPT 90867–90869 documentation requirements; LCD L34869 (Novitas, CareFirst territory)',
      org: 'CMS',
    },
    {
      title: 'Spravato J-Code (J0718) Billing Guide',
      url: 'https://www.janssencarepath.com',
      desc: 'Step-by-step J-code billing, UB-04 vs CMS-1500 guidance, prior auth',
      org: 'Janssen CarePath',
    },
    {
      title: 'HCPCS J0718 — Esketamine',
      url: 'https://hcpcs.codes/codes/J0718/',
      desc: 'Official HCPCS code details, billing unit definition (per 1 mg)',
      org: 'CMS HCPCS',
    },
    {
      title: 'Novitas Solutions LCD — TMS (Maryland)',
      url: 'https://www.novitas-solutions.com',
      desc: 'Local Coverage Determination governing TMS coverage for MD/DC/VA Medicaid and Medicare',
      org: 'Novitas Solutions',
    },
    {
      title: 'Maryland Medicaid eMedicaid — TMS PA',
      url: 'https://mmcp.maryland.gov',
      desc: 'Maryland Medicaid prior authorization for TMS — form and clinical criteria',
      org: 'DHMH Maryland',
    },
    {
      title: 'CareFirst Prior Auth — Behavioral Health',
      url: 'https://provider.carefirst.com',
      desc: 'CareFirst/BCBS prior auth portal for TMS and Spravato (dominant payer in MD)',
      org: 'CareFirst',
    },
  ],
  client: [
    {
      title: 'NAMI — TMS Patient Guide',
      url: 'https://nami.org/About-Mental-Illness/Treatments/Brain-Stimulation-Therapies',
      desc: 'Plain-language overview of TMS: what to expect, how it works, side effects',
      org: 'NAMI',
    },
    {
      title: 'Brain & Behavior Research Foundation — TMS',
      url: 'https://www.bbrfoundation.org',
      desc: 'Research-backed patient education on TMS for depression',
      org: 'BBRF',
    },
    {
      title: 'SPRAVATO Patient Information Sheet (FDA)',
      url: 'https://www.spravatorems.com',
      desc: 'FDA-required patient medication guide — must be given before each dose',
      org: 'FDA / Janssen',
    },
    {
      title: 'Janssen CarePath Patient Support',
      url: 'https://www.janssencarepath.com/patient/spravato',
      desc: 'Copay assistance (up to $0 copay for eligible commercial patients), nurse support line',
      org: 'Janssen CarePath',
    },
    {
      title: 'NAMI Helpline',
      url: 'https://nami.org/help',
      desc: '1-800-950-NAMI — support for patients navigating treatment-resistant depression',
      org: 'NAMI',
    },
    {
      title: 'Depression & Bipolar Support Alliance (DBSA)',
      url: 'https://www.dbsalliance.org',
      desc: 'Peer support groups, treatment information, living with TRD resources',
      org: 'DBSA',
    },
    {
      title: '988 Suicide & Crisis Lifeline',
      url: 'https://988lifeline.org',
      desc: 'Always available — critical safety resource for patients in TRD treatment',
      org: 'SAMHSA',
    },
  ],
  clinic: [
    {
      title: 'SPRAVATO REMS Healthcare Provider Enrollment',
      url: 'https://www.spravatorems.com',
      desc: 'Certify your site to administer Spravato — required before first dose',
      org: 'Janssen / FDA',
    },
    {
      title: 'Joint Commission Ketamine Guidance (if applicable)',
      url: 'https://www.jointcommission.org',
      desc: 'Guidance for facilities administering sedating agents — monitoring room standards',
      org: 'Joint Commission',
    },
    {
      title: 'CARF Standards for Behavioral Health TRD Services',
      url: 'https://www.carf.org',
      desc: 'CARF accreditation standards applicable to TMS/Spravato programs',
      org: 'CARF International',
    },
    {
      title: 'NeuroStar Access Program — Equipment Financing',
      url: 'https://neurostar.com/for-providers',
      desc: 'Financing, training, and start-up support for adding TMS to your practice',
      org: 'Neuronetics',
    },
    {
      title: 'Spravato Support360 (Provider Support Line)',
      url: 'https://www.janssencarepath.com',
      desc: '1-844-757-2826 — Prior auth support, reimbursement navigation, REMS help for providers',
      org: 'Janssen',
    },
    {
      title: 'Maryland Board of Physicians — Scope of Practice',
      url: 'https://www.mbp.state.md.us',
      desc: 'Confirm which licensed clinicians can supervise or administer TMS/Spravato in MD',
      org: 'Maryland Board',
    },
  ],
} as const;

export const QUICK_PHONES = [
  {
    org: 'Janssen Support360 (Spravato)',
    number: '1-844-757-2826',
    desc: 'Prior auth help, REMS support, reimbursement navigation',
  },
  {
    org: 'CRISP Helpdesk',
    number: '1-877-952-7477',
    desc: 'HIE participant support — CRISP MD/DC/VA',
  },
  {
    org: 'NeuroStar Clinical Support',
    number: '1-877-600-7555',
    desc: 'TMS device support, clinical training, PA assistance',
  },
  {
    org: '988 Suicide & Crisis Lifeline',
    number: '988',
    desc: 'Always available — post to client discharge instructions',
  },
  {
    org: 'NAMI Helpline',
    number: '1-800-950-6264',
    desc: 'Patient and family support for TRD treatment navigation',
  },
  {
    org: 'CareFirst Prior Auth (MD/DC/VA)',
    number: '1-800-842-5975',
    desc: 'TMS and Spravato prior authorization — behavioral health',
  },
  {
    org: 'Novitas Solutions (Medicare PA)',
    number: '1-855-252-8782',
    desc: 'Medicare TMS prior auth — Maryland jurisdiction MAC',
  },
  {
    org: 'Janssen CarePath Patient Line',
    number: '1-833-SPRAVATO',
    desc: 'Patient copay card, insurance questions, pharmacy connection',
  },
] as const;

export const SPRAVATO_PHASES = [
  {
    id: 'induction',
    label: 'Induction',
    weeks: 'Weeks 1–4',
    freq: 'Twice weekly (Mon + Thu or Tue + Fri)',
    dose: '56 mg or 84 mg per dose',
  },
  {
    id: 'maint1',
    label: 'Maintenance 1',
    weeks: 'Weeks 5–8',
    freq: 'Once weekly',
    dose: '56 mg or 84 mg per dose',
  },
  {
    id: 'maint2',
    label: 'Maintenance 2',
    weeks: 'Week 9+',
    freq: 'Once every 1–2 weeks',
    dose: '56 mg or 84 mg per dose',
  },
] as const;

export const VITAL_TIMEPOINTS = [
  { key: '0', label: 'Pre-dose (0 min)' },
  { key: '14', label: '14 min post-dose' },
  { key: '40', label: '40 min post-dose' },
  { key: '60', label: '60 min post-dose' },
  { key: '90', label: '90 min post-dose' },
  { key: '120', label: '120 min post-dose (discharge check)' },
] as const;

export const PHQ9_MILESTONES = [
  'baseline',
  '10',
  '15',
  '20',
  '25',
  '36',
  'custom',
] as const;

export const CTA_GRADIENT = 'linear-gradient(135deg, #5C2D91, #7C3AED)';

export type AdtTrial = {
  medication: string;
  dose: string;
  duration: string;
  reasonStopped: string;
};

export function emptyAdtTrials(): AdtTrial[] {
  return ADT_HISTORY_FIELDS.map(() => ({
    medication: '',
    dose: '',
    duration: '',
    reasonStopped: '',
  }));
}

export function emptyPaChecklist(length: number): boolean[] {
  return Array.from({ length }, () => false);
}

export function parseBp(raw: string): { sbp: number; dbp: number } | null {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!m) return null;
  return { sbp: Number(m[1]), dbp: Number(m[2]) };
}

/** Withhold Spravato if SBP > 180 or DBP > 110 at any recorded timepoint. */
export function shouldWithholdDose(
  vitals: Record<string, { sbp?: number; dbp?: number; bp?: string } | null | undefined>
): boolean {
  for (const v of Object.values(vitals)) {
    if (!v) continue;
    const sbp = v.sbp ?? (v.bp ? parseBp(v.bp)?.sbp : undefined);
    const dbp = v.dbp ?? (v.bp ? parseBp(v.bp)?.dbp : undefined);
    if ((sbp != null && sbp > 180) || (dbp != null && dbp > 110)) return true;
  }
  return false;
}

/** SpO₂ alert threshold for Spravato monitoring (percent). */
export const SPO2_ALERT_THRESHOLD = 92;

export function hasLowSpo2(
  vitals: Record<string, { spo2?: number | null } | null | undefined>
): boolean {
  for (const v of Object.values(vitals)) {
    if (v?.spo2 != null && v.spo2 < SPO2_ALERT_THRESHOLD) return true;
  }
  return false;
}

/** GAD-7 severity bands (0–21). Clinical cutoff ≥10 suggests further evaluation. */
export function gad7Severity(score: number): {
  label: string;
  cutoffNote: string;
} {
  if (score <= 4) return { label: 'Minimal', cutoffNote: 'Below clinical concern threshold.' };
  if (score <= 9)
    return {
      label: 'Mild',
      cutoffNote: 'Monitor; clinical cutoff for further evaluation is ≥10.',
    };
  if (score <= 14)
    return {
      label: 'Moderate',
      cutoffNote: 'Score ≥10 — complete full GAD-7 in Assessments and consider clinical follow-up.',
    };
  return {
    label: 'Severe',
    cutoffNote: 'Score ≥15 — complete full GAD-7 in Assessments; expedite clinical evaluation.',
  };
}
