/**
 * Visit Guide requirements catalog: the basis behind every protocol step and due item.
 *
 * Plain-language summaries for clinicians, not legal text. `confirm: true` marks a detail the
 * owner / compliance lead must still verify against the current rule (law changes, payer policy,
 * practice choice). Citations are text only; no links are given that were not verified.
 *
 * Owner confirmation 2026-10-21: the Maryland / payer items in OWNER_CONFIRMED_IDS were confirmed by
 * the practice owner (confirmedBy / confirmedOn; the Visit Guide shows "Confirmed by practice
 * 2026-10-21"). Where each is enforced and the numeric items still open: docs/compliance-confirmations-2026-10-21.md.
 */
import type { Requirement } from './types';

export const OWNER_CONFIRMED_BY = 'Practice owner';
export const OWNER_CONFIRMED_ON = '2026-10-21';
/** Requirement ids the practice owner confirmed on 2026-10-21. */
export const OWNER_CONFIRMED_IDS: readonly string[] = [
  'md_pdmp',
  'md_epcs',
  'dea_telehealth',
  'minor_consent_md',
  'prp_comar',
  'treatment_plan_review',
  'spravato_rems',
  'telehealth_consent_location',
  'discharge_aftercare',
  'sdoh_screen',
  'tms_course',
  'md_duty_to_warn',
  'md_child_abuse_report',
  'md_vulnerable_adult_report',
];

export const REQUIREMENTS: Requirement[] = [
  // ─── Prescribing ───────────────────────────────────────────────────────────
  {
    id: 'md_pdmp',
    title: 'Maryland PDMP (CRISP) query',
    authority: 'Maryland law',
    rule:
      'Before starting a course of treatment with an opioid or a benzodiazepine, the prescriber queries the PDMP (at least the prior 4 months), then at least every 90 days while it continues. Limited exceptions apply (for example a supply of 3 days or less, cancer / hospice care).',
    citation: 'Md. Code, Health-General §21-2A-04.1',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'md_epcs',
    title: 'Electronic prescribing of controlled substances',
    authority: 'Maryland law',
    rule: 'Controlled dangerous substance prescriptions must be sent electronically (EPCS) unless a listed exception or an approved waiver applies.',
    citation: 'Md. Code, Health-General §21-220',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'dea_telehealth',
    title: 'DEA telemedicine prescribing of controlled substances',
    authority: 'DEA',
    rule:
      'Prescribing a controlled substance after a telemedicine-only relationship (no prior in-person exam) depends on the DEA telemedicine flexibilities or the final special-registration rule in force on the visit date. Verify the current status before prescribing.',
    citation: '21 U.S.C. 802(54), 829(e) (Ryan Haight Act); DEA temporary telemedicine flexibilities',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'informed_consent_psychotropic',
    title: 'Informed consent for psychotropic medication',
    authority: 'Clinical guideline',
    rule:
      'Before starting a psychotropic, discuss and document the diagnosis / target symptoms, expected benefits, risks and common side effects (including any boxed warning), alternatives including no medication, and the patient\'s (or guardian\'s) agreement.',
    confirm: false,
  },
  {
    id: 'apa_aims',
    title: 'Tardive dyskinesia screening (AIMS)',
    authority: 'Clinical guideline',
    rule:
      'Patients on an antipsychotic get a structured movement assessment (e.g. AIMS) at baseline, every 6 months when at high risk of tardive dyskinesia and every 12 months otherwise, plus whenever new abnormal movements appear. The practice uses 6 months for everyone on an antipsychotic.',
    citation: 'APA Practice Guideline for the Treatment of Patients With Schizophrenia, 3rd ed. (2020)',
    confirm: false,
  },
  {
    id: 'ada_apa_metabolic',
    title: 'Metabolic monitoring on antipsychotics',
    authority: 'Clinical guideline',
    rule:
      'Weight / BMI at baseline, 4, 8 and 12 weeks then quarterly; blood pressure and fasting glucose (or A1c) at baseline, 12 weeks, then yearly; fasting lipids at baseline, 12 weeks, then every 5 years if normal; waist at baseline and yearly.',
    citation: 'ADA / APA / AACE / NAASO consensus statement, Diabetes Care 2004;27(2):596–601',
    confirm: false,
  },

  // ─── Joint Commission ──────────────────────────────────────────────────────
  {
    id: 'tjc_suicide_screen',
    title: 'Suicide risk screening',
    authority: 'Joint Commission',
    rule:
      'Screen every patient treated for a behavioral health condition for suicide risk with a validated tool (e.g. C-SSRS). When positive, complete an evidence-based risk assessment, document it, and give a safety plan and crisis resources (988).',
    citation: 'NPSG.15.01.01',
    confirm: false,
  },
  {
    id: 'tjc_med_rec',
    title: 'Medication reconciliation',
    authority: 'Joint Commission',
    rule:
      'Maintain and communicate accurate medication information: get the current list (including OTC and supplements), compare with what is ordered, resolve differences and give the patient an updated list.',
    citation: 'NPSG.03.06.01',
    confirm: false,
  },
  {
    id: 'tjc_mbc',
    title: 'Measurement-based care',
    authority: 'Joint Commission',
    rule:
      'Use a standardized tool or instrument to monitor progress (e.g. PHQ-9, GAD-7) at intervals the practice sets, and use the results to inform treatment and goals.',
    citation: 'CTS.03.01.09 (Behavioral Health Care and Human Services)',
    confirm: false,
  },

  // ─── HEDIS ─────────────────────────────────────────────────────────────────
  {
    id: 'hedis_ssd',
    title: 'Diabetes screening on antipsychotics (SSD)',
    authority: 'HEDIS',
    rule: 'Adults 18–64 with schizophrenia / schizoaffective or bipolar disorder who are dispensed an antipsychotic get a glucose or A1c test during the year.',
    citation: 'HEDIS SSD',
    confirm: false,
  },
  {
    id: 'hedis_apm',
    title: 'Metabolic monitoring for youth on antipsychotics (APM)',
    authority: 'HEDIS',
    rule: 'Children and adolescents 1–17 on two or more antipsychotic dispensings get both a glucose / A1c test and a cholesterol / LDL-C test during the year.',
    citation: 'HEDIS APM-E',
    confirm: false,
  },
  {
    id: 'hedis_add',
    title: 'Follow-up for children newly on ADHD medication (ADD)',
    authority: 'HEDIS',
    rule:
      'Children 6–12 newly started on an ADHD medication have a follow-up visit with a prescriber within 30 days (initiation phase), and two more visits within the next 9 months if they stay on it.',
    citation: 'HEDIS ADD-E',
    confirm: false,
  },
  {
    id: 'hedis_amm',
    title: 'Antidepressant medication management (AMM)',
    authority: 'HEDIS',
    rule: 'Adults newly treated for major depression with an antidepressant stay on it at least 84 days (acute phase) and 180 days (continuation phase). Check adherence and fills.',
    citation: 'HEDIS AMM',
    confirm: false,
  },
  {
    id: 'hedis_fuh',
    title: 'Follow-up after psychiatric hospitalization (FUH)',
    authority: 'HEDIS',
    rule: 'Patients 6 and older discharged from an inpatient stay for mental illness have a follow-up visit with a mental health provider within 7 days (and no later than 30 days).',
    citation: 'HEDIS FUH',
    confirm: false,
  },

  // ─── Privacy / consent ─────────────────────────────────────────────────────
  {
    id: 'part2_consent',
    title: '42 CFR Part 2 consent',
    authority: 'Federal law',
    rule:
      'Records of a substance use disorder program are disclosed only with the patient\'s written Part 2 consent (or a listed exception). They stay segregated from general notes, and SUD counseling notes need their own consent.',
    citation: '42 CFR Part 2 (2024 final rule)',
    confirm: false,
  },
  {
    id: 'telehealth_consent_location',
    title: 'Telehealth consent and patient location',
    authority: 'CMS / Maryland Medicaid',
    rule:
      'A telehealth consent is on file, and each telehealth note records the modality (audio-video or audio-only), the patient\'s location and state (POS 10 home, POS 02 other), and the provider\'s location. Audio-only behavioral health visits need the patient\'s agreement to audio-only; the claim carries modifier 95 for audio-video and the payer\'s audio-only modifier (93 or FQ) only where that payer accepts audio-only.',
    citation: 'CMS POS 02 / 10 definitions; COMAR 10.09.49 (Maryland Medicaid telehealth)',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'minor_consent_md',
    title: 'Maryland minor consent',
    authority: 'Maryland law',
    rule:
      'A minor 16 or older may consent to outpatient mental health care; younger minors need a parent / guardian consent unless another exception applies. Minors may consent to substance use treatment. Record who consented and guardian involvement.',
    citation: 'Md. Code, Health-General §20-104 and §20-102(c)',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'md_duty_to_warn',
    title: 'Duty to warn / protect (Maryland)',
    authority: 'Maryland law',
    rule:
      'When a client communicates a threat of serious physical violence against a specified or readily identifiable victim, act on it: reasonable efforts to warn the victim and notify law enforcement (or seek hospitalization), consult the clinical director, and document what was said and what was done.',
    citation: 'Md. Code, Courts and Judicial Proceedings §5-609',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'md_child_abuse_report',
    title: 'Mandated report: suspected child abuse or neglect',
    authority: 'Maryland law',
    rule:
      'A health practitioner who has reason to believe a child has been abused or neglected reports it to the local department of social services or law enforcement: an oral report right away and a written report within 48 hours. 42 CFR Part 2 permits the initial report from SUD records.',
    citation: 'Md. Code, Family Law §5-704; 42 CFR 2.12(c)(6)',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'md_vulnerable_adult_report',
    title: 'Mandated report: suspected abuse of a vulnerable adult',
    authority: 'Maryland law',
    rule:
      'A health practitioner who has reason to believe a vulnerable adult has been abused, neglected, self-neglected or exploited reports it to the local department of social services (Adult Protective Services).',
    citation: 'Md. Code, Family Law §14-302',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },

  // ─── Documentation / plans ─────────────────────────────────────────────────
  {
    id: 'treatment_plan_review',
    title: 'Treatment plan and periodic review',
    authority: 'COMAR',
    rule:
      'Each outpatient client has a written, individualized treatment plan (goals, objectives, services, frequency) developed with the client and reviewed / updated at the practice interval (adults: Practice Settings, at most 180 days; under 18: at most 90 days) or when the clinical picture changes.',
    citation: 'COMAR 10.63.03 (outpatient mental health center program); review interval per practice settings',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'prp_comar',
    title: 'PRP service documentation and IRP review',
    authority: 'COMAR',
    rule:
      'Each PRP contact is documented (date, service type, minutes, onsite / offsite, staff, IRP goal addressed, intervention, response). The Individual Rehabilitation Plan is reviewed at the practice interval (default 6 months; Practice Settings, under 18 at most 90 days).',
    citation: 'COMAR 10.63.03 (PRP) and COMAR 10.09.59 (Medicaid specialty mental health services)',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'asam',
    title: 'ASAM level-of-care assessment',
    authority: 'Clinical guideline',
    rule: 'SUD clients get a multidimensional ASAM assessment (6 dimensions) to place them in a level of care at intake and again at each review or change in status.',
    citation: 'The ASAM Criteria, 4th ed. (2023); Maryland Medicaid SUD level-of-care requirements',
    confirm: false,
  },
  {
    id: 'discharge_aftercare',
    title: 'Discharge summary and aftercare plan',
    authority: 'Practice policy',
    rule:
      'At discharge, complete a summary (reason, services, progress, medications) and an aftercare plan with referrals and crisis resources, within the practice timeframe; send records to the next provider with consent.',
    citation: 'Practice policy; COMAR 10.63.03 record requirements',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'sdoh_screen',
    title: 'Social needs screening',
    authority: 'Practice policy',
    rule: 'Screen for social needs (food, housing, transportation, utilities, safety) at least once a year with a standardized tool (AHC-HRSN) and refer when positive.',
    citation: 'HEDIS SNS-E (Social Need Screening and Intervention); practice policy',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },

  // ─── Coding ────────────────────────────────────────────────────────────────
  {
    id: 'cms_em_2021',
    title: 'E/M level and psychotherapy add-on',
    authority: 'CMS',
    rule:
      'Office E/M (99202–99215) level is chosen by medical decision making or total time on the date of service. A psychotherapy add-on (90833 / 90836 / 90838) needs separately documented psychotherapy time (at least 16 minutes for 90833) that is not counted toward E/M time.',
    citation: 'AMA CPT 2021 E/M guidelines; CMS',
    confirm: false,
  },
  {
    id: 'cms_psychotherapy_time',
    title: 'Psychotherapy code by time',
    authority: 'CMS',
    rule: 'Psychotherapy codes follow face-to-face time: 90832 for 16–37 minutes, 90834 for 38–52, 90837 for 53 or more. Under 16 minutes is not billable as psychotherapy.',
    citation: 'AMA CPT psychotherapy time rules',
    confirm: false,
  },

  // ─── Primary care ──────────────────────────────────────────────────────────
  {
    id: 'uspstf_screening',
    title: 'Preventive screening (USPSTF / HEDIS)',
    authority: 'Clinical guideline',
    rule:
      'Screening guidance by age and sex: depression (PHQ-2 / PHQ-9), tobacco use, unhealthy alcohol use (AUDIT-C, 18+), falls (65+), colorectal cancer 45–75, breast cancer 40–74 every 2 years, cervical cancer 21–65. Shown as guidance; the provider decides and documents ordered / done elsewhere / declined / not applicable.',
    citation: 'U.S. Preventive Services Task Force recommendations; NCQA HEDIS COL, BCS, CCS',
    confirm: true,
  },
  {
    id: 'acip_immunization',
    title: 'Adult immunizations (ACIP)',
    authority: 'Clinical guideline',
    rule:
      'Influenza every season, pneumococcal vaccine for all adults 50+ (ACIP recommendation of October 2024), Td / Tdap every 10 years. Doses given elsewhere are recorded with date and source; the Maryland immunization registry (ImmuNet) is not connected yet.',
    citation: 'CDC ACIP adult immunization schedule; ACIP pneumococcal recommendation, October 2024 (adults 50+)',
    confirm: true,
  },
  {
    id: 'ada_diabetes_care',
    title: 'Diabetes care (ADA / HEDIS)',
    authority: 'Clinical guideline',
    rule: 'With diabetes on the problem list: A1c at least every 6 months, yearly retinal eye exam, yearly foot exam, yearly urine albumin-to-creatinine ratio.',
    citation: 'ADA Standards of Care in Diabetes; NCQA HEDIS GSD, EED, KED',
  },
  {
    id: 'collaborative_care',
    title: 'Behavioral health warm handoff',
    authority: 'Practice policy',
    rule:
      'A primary care PHQ-9 or GAD-7 of 10 or more prompts the provider to offer a warm handoff (internal referral) to the practice behavioral health team. Only the referral status comes back to primary care; behavioral health notes are not shared.',
    confirm: true,
  },
  // ─── Interventional ────────────────────────────────────────────────────────
  {
    id: 'spravato_rems',
    title: 'Spravato (esketamine) REMS',
    authority: 'FDA REMS',
    rule:
      'Given only in a REMS-certified setting to an enrolled patient: self-administered under direct observation, blood pressure before and after the dose, monitoring for sedation and dissociation for at least 2 hours, and no driving until the next day after restful sleep.',
    citation: 'SPRAVATO REMS',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
  {
    id: 'tms_course',
    title: 'TMS course documentation',
    authority: 'Practice policy',
    rule:
      'Each TMS session records the motor threshold (when checked), coil target, parameters (frequency, pulses), side effects, and PHQ-9 progress at the course milestones; payer prior authorization stays on file.',
    confirmedBy: OWNER_CONFIRMED_BY,
    confirmedOn: OWNER_CONFIRMED_ON,
  },
];

const BY_ID = new Map(REQUIREMENTS.map((r) => [r.id, r]));

export function requirementById(id: string): Requirement | null {
  return BY_ID.get(id) ?? null;
}

/** Requirements for a set of ids (unknown ids ignored), catalog order. */
export function requirementsFor(ids: Iterable<string>): Requirement[] {
  const want = new Set(ids);
  return REQUIREMENTS.filter((r) => want.has(r.id));
}
