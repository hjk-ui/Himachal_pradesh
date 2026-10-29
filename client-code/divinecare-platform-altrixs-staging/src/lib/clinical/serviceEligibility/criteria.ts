/**
 * Service Eligibility Scanner — published criteria, citations and clinic-configurable rules.
 * Pure module (no imports): the page shows these texts and the rules read the same values.
 *
 * Where a source sets no number (PRP has no LOCUS cut-off; payers differ on TMS medication
 * trials), the value is a clinic setting, labelled as such, and listed as an owner question.
 */
import type { ProgramKey } from './types';

export type Citation = { label: string; url?: string };

export type ProgramMeta = {
  key: ProgramKey;
  label: string;
  fullName: string;
  criteria: string[];
  citations: Citation[];
  referral: { label: string; href: (clientId: string) => string };
};

const q = (id: string) => encodeURIComponent(id);

export const PROGRAM_META: Record<ProgramKey, ProgramMeta> = {
  prp: {
    key: 'prp',
    label: 'PRP',
    fullName: 'Psychiatric Rehabilitation Program (Adult)',
    criteria: [
      'Diagnosis on the Maryland PBHS PRP priority-population list (Category A or B)',
      'Category A: SSI/SSDI for mental illness (Category C) or impaired role functioning (Category D); Category B: Category D required',
      'Functional impairment and duration documented (LOCUS used here as chart evidence — clinic threshold)',
      'Engaged with an outpatient clinician not affiliated with the PRP; referral signed by a licensed MH professional, dated within 60 days',
      'Not routinely with ACT/MTS, adult TCM, inpatient, MH residential, residential SUD 3.3+, SUD IOP/PHP or MH IOP/PHP',
      'State-funded / uninsured: also 1 of 4 (state-hospital conditional release, psychiatric discharge / jail release / RRP discharge within 6 months)',
    ],
    citations: [
      {
        label: 'Optum Maryland — Psychiatric Rehabilitation Program (Adult) medical necessity criteria, provider training guide (MDH criteria rev. July 1, 2020)',
        url: 'https://marylandbh.optum.com/content/dam/ops-maryland/documents/provider/training/BH_MD_Provider_PRPAdult_PG.pdf',
      },
      { label: 'COMAR 10.09.59 (Specialty Mental Health Services) and 10.63 (BHA community-based program licensing)' },
    ],
    referral: { label: 'Start PRP referral', href: (id) => `/dashboard/prp/referral?clientId=${q(id)}` },
  },
  spravato: {
    key: 'spravato',
    label: 'Spravato',
    fullName: 'Spravato (esketamine) nasal spray',
    criteria: [
      'Adult (18+) with major depressive disorder',
      'Treatment-resistant depression: inadequate response to ≥2 different antidepressants of adequate dose and duration in the current episode — OR — MDD with acute suicidal ideation or behavior (with an oral antidepressant)',
      'Contraindications: aneurysmal vascular disease or arteriovenous malformation, history of intracerebral hemorrhage, hypersensitivity to esketamine / ketamine',
      'SPRAVATO REMS: certified setting, patient enrolled, ≥2 h post-dose monitoring; blood pressure checked before and after each dose',
    ],
    citations: [
      { label: 'SPRAVATO (esketamine) Prescribing Information — Indications, Contraindications, Boxed Warning (Janssen)', url: 'https://www.janssenlabels.com/package-insert/product-monograph/prescribing-information/SPRAVATO-pi.pdf' },
      { label: 'SPRAVATO REMS', url: 'https://www.spravatorems.com' },
    ],
    referral: { label: 'Refer to Spravato clinic', href: (id) => `/dashboard/ehr/tms-spravato?clientId=${q(id)}&program=spravato` },
  },
  tms: {
    key: 'tms',
    label: 'TMS',
    fullName: 'Transcranial Magnetic Stimulation',
    criteria: [
      'Adult with confirmed severe major depressive disorder (single or recurrent episode)',
      'Failure of / intolerance to antidepressant trials of adequate dose and duration — number set per payer (Medicare in Maryland, Novitas L34998: one or more)',
      'Ordered by a psychiatrist who examined the patient',
      'Absolute contraindication: magnetic-sensitive implanted device or metal within 30 cm of the coil (cochlear implant, ICD, pacemaker, VNS, aneurysm clips / coils, stents)',
      'Relative: seizure history, psychotic symptoms in the current episode, neurologic conditions (epilepsy, cerebrovascular disease, dementia, raised ICP, severe head trauma, CNS tumor)',
    ],
    citations: [
      { label: 'Novitas Solutions LCD L34998 — TMS in the Treatment of Adults with MDD (JL: MD, DC, DE, NJ, PA)', url: 'https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=34998' },
      { label: 'WPS LCD L34641 — Transcranial Magnetic Stimulation (other jurisdictions; also requires a psychotherapy trial)', url: 'https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=34641' },
    ],
    referral: { label: 'Refer to TMS', href: (id) => `/dashboard/ehr/tms-spravato?clientId=${q(id)}&program=tms` },
  },
  aot: {
    key: 'aot',
    label: 'AOT',
    fullName: 'Assisted Outpatient Treatment (Maryland)',
    criteria: [
      '18+, serious and persistent mental illness',
      'History prong (3-year look-back): repeated hospitalization / detention-center mental health services, or serious violent act / credible threat',
      'Unlikely to adhere to treatment voluntarily; AOT is the least restrictive alternative for health and safety',
      'Most criteria are legal / history facts not in the chart — the scanner shows chart context only and never establishes eligibility',
    ],
    citations: [
      { label: 'Md. Code, Health–General § 10-6A-05 (Assisted Outpatient Treatment)' },
      { label: 'MDH AOT Petitioner Filing Checklist (mirrored in the AOT module)' },
    ],
    referral: { label: 'Start AOT eligibility screen', href: (id) => `/dashboard/aot?clientId=${q(id)}` },
  },
  residential: {
    key: 'residential',
    label: 'Residential',
    fullName: 'Residential SUD — ASAM 3.1 / 3.5',
    criteria: [
      'Substance use disorder diagnosis (ICD-10-CM F10–F19, excluding nicotine F17)',
      'ASAM six-dimension assessment supports a residential level (3.1 low-intensity / 3.5 high-intensity)',
      'Exclusions: high withdrawal risk (Dimension 1 → withdrawal management), acute biomedical (Dimension 2) or psychiatric instability needing a medically monitored level',
      'Payer prior authorization (Maryland Medicaid residential: H0018 / H0019 per the residential module)',
    ],
    citations: [
      { label: 'The ASAM Criteria — Levels 3.1 and 3.5 dimensional admission criteria (American Society of Addiction Medicine)' },
      { label: 'Maryland Medicaid SUD residential services (ASAM 3.1–3.7) under the HealthChoice §1115 waiver — payer PA through the ASO' },
    ],
    referral: { label: 'Start residential admission', href: (id) => `/dashboard/residential?clientId=${q(id)}` },
  },
  iop: {
    key: 'iop',
    label: 'IOP',
    fullName: 'SUD Intensive Outpatient / PHP — ASAM 2.1 / 2.5',
    criteria: [
      'Substance use disorder diagnosis (ICD-10-CM F10–F19, excluding nicotine F17)',
      'ASAM six-dimension assessment supports Level 2.1 (IOP, ≥ 9 h/week adult) or 2.5 (PHP, ≥ 20 h/week)',
      'Withdrawal (Dimension 1) and biomedical (Dimension 2) needs manageable at an outpatient level, or withdrawal management arranged',
      'Not currently in residential care (IOP is the step-down); payer authorization (Maryland Medicaid H0015 through the ASO)',
    ],
    citations: [
      { label: 'The ASAM Criteria — Levels 2.1 and 2.5 dimensional admission criteria (American Society of Addiction Medicine)' },
      { label: 'Maryland Medicaid / PBHS SUD intensive outpatient (ASAM 2.1, H0015) — Optum Maryland provider manual' },
    ],
    referral: { label: 'Open SUD assessment (ASAM)', href: (id) => `/dashboard/ehr/assessments/sud?clientId=${q(id)}` },
  },
};

/**
 * Look-back for "service codes billed → already receiving the program" (days). PRP / TMS /
 * Spravato / IOP bill weekly or more often, so 60–90 days without a line means the episode ended.
 */
export const BILLING_WINDOW_DAYS: Record<'prp' | 'tms' | 'spravato' | 'residential' | 'iop', number> = {
  prp: 90,
  tms: 60,
  spravato: 90,
  residential: 30,
  iop: 60,
};

// ─── Clinic-configurable thresholds ──────────────────────────────────────────

/**
 * Minimum failed antidepressant trials for TMS, by payer. Default is the Novitas L34998 rule
 * (Medicare, Maryland). Payer overrides come from this app's TMS & Spravato payer reference
 * notes (features/ehr/tmsSpravatoConstants PAYER_COVERAGE_NOTES) and are unverified against
 * current payer policy — owner to confirm.
 */
export const TMS_TRIAL_RULES: { match: RegExp; minTrials: number; source: string }[] = [
  { match: /carefirst|blue\s*cross|bcbs/i, minTrials: 2, source: 'CareFirst BCBS (app payer note: 2 failed trials, PHQ-9 ≥ 10)' },
  { match: /united|uhc|optum/i, minTrials: 4, source: 'UnitedHealthcare / Optum (app payer note: 4 failed trials preferred)' },
  { match: /aetna/i, minTrials: 2, source: 'Aetna (app payer note: 2–4 failed trials, policy varies)' },
  { match: /medicare/i, minTrials: 1, source: 'Medicare — Novitas LCD L34998 (one or more)' },
];
/**
 * Payers with no configured rule (Maryland Medicaid MCOs, other commercial plans, unknown payer):
 * two failed trials — the common commercial standard and the stricter reading, so an unknown payer
 * never turns a one-trial chart into a "candidate". Medicare (Novitas L34998, verified 2026-10-18:
 * "failure of one or more trials") keeps one. Owner to confirm per payer.
 */
export const TMS_DEFAULT_MIN_TRIALS = 2;
export const TMS_DEFAULT_SOURCE = 'Default for payers without a configured rule: 2 failed trials (common commercial standard; Medicare / Novitas L34998 requires one or more) — confirm with the payer';

export function tmsTrialRule(payer: string | null | undefined): { minTrials: number; source: string } {
  const p = payer || '';
  const hit = TMS_TRIAL_RULES.find((r) => r.match.test(p));
  return hit ? { minTrials: hit.minTrials, source: hit.source } : { minTrials: TMS_DEFAULT_MIN_TRIALS, source: TMS_DEFAULT_SOURCE };
}

/**
 * LOCUS composite at or above which the chart is treated as documenting functional impairment
 * for PRP. The PRP criteria set no LOCUS score; 17 (LOCUS Level 3, high-intensity
 * community-based services) is a clinic setting — owner to confirm.
 */
export const PRP_LOCUS_MIN = 17;

/** Adequate-duration floor for an antidepressant trial (weeks on the medication list). */
export const ADEQUATE_TRIAL_DAYS = 42;

/** Look-back windows (days) */
export const WINDOWS = {
  phq9: 90,
  cssrs: 30,
  locus: 365,
  sudIntake: 365,
  crisis: 365 * 3,
} as const;

/** RiskAlert.type for an accepted scanner suggestion (referral to the program lead; shown as a To-Do) */
export const SERVICE_REFERRAL_ALERT = 'SERVICE_REFERRAL';

export const DISCLAIMER =
  'Decision support only — not a clinical determination. Results reflect what is charted; a licensed clinician must assess the client, confirm every criterion and the payer rules before any referral.';
