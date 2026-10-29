/**
 * Service Eligibility Scanner rules — one evaluator per program over a client's chart facts.
 * Pure and deterministic (pass `now`). Decision support only: the output lists what the chart
 * shows against each published criterion; it is never a determination.
 *
 * Status rules (all programs):
 *  enrolled      — a current enrollment / course / residency exists, or the program's service
 *                  codes were billed recently (Valant transactions / Altrixs claims)
 *  not_indicated — a required criterion is unmet (no qualifying diagnosis, minor, contraindication)
 *  candidate     — every criterion the chart can answer is met (confirm items still apply)
 *  potential     — qualifying diagnosis present but data missing or a soft criterion unmet
 *  review        — AOT: chart context only, clinical / legal review required
 *
 * Missing data is never a silent pass or fail: each gap is listed in `missing` with its key in
 * `gaps` (e.g. no medication list on file → "Medication history not available").
 */
import {
  ADEQUATE_TRIAL_DAYS,
  BILLING_WINDOW_DAYS,
  PRP_LOCUS_MIN,
  WINDOWS,
  tmsTrialRule,
} from './criteria';
import {
  LOW_DOSE_FLOOR_MG,
  PRP_NEVER_ALONE,
  antidepressantGeneric,
  asamLevelNumber,
  doseMg,
  isAotSmi,
  isKetamineAllergy,
  isMdd,
  mddSeverity,
  prpDiagnosis,
  spravatoContraindication,
  tmsAbsolute,
  tmsRelative,
  type AsamReading,
  type BilledProgram,
} from './codes';
import { classifySudCode } from '@/lib/clinical/sudRadar/codes';
import { DEFAULT_PRACTICE_TIME_ZONE, toPracticeWallTime } from '@/lib/time/practiceTime';
import type { EligibilityStatus, Evidence, GapKey, ProgramKey, ProgramResult } from './types';

// ─── Chart facts (what the loader reads) ─────────────────────────────────────

export type ChartDx = {
  code: string;
  label: string | null;
  source: 'primary' | 'secondary' | 'problem-list';
  date: Date | null;
};

export type ChartMed = {
  name: string;
  genericName: string | null;
  brandName: string | null;
  /** Charted dose text (dose / dosage / sig) — used only for the low-dose floor (trazodone) */
  dose?: string | null;
  startDate: Date | null;
  endDate: Date | null;
  active: boolean;
  status: string | null;
  stopReason: string | null;
};

export type ChartBilling = { code: string; program: BilledProgram; date: Date | null; source: 'valant' | 'claim' };

export type ClientChart = {
  id: string;
  dateOfBirth: Date | null;
  insurancePayer: string | null;
  insuranceType: string | null;
  diagnoses: ChartDx[];
  /** Count of active problem-list rows (0 → contraindication screening not possible from chart) */
  problemCount: number;
  meds: ChartMed[];
  allergies: { allergen: string; status: string | null }[];
  phq9: { score: number; date: Date; source?: 'assessment' | 'measurement' | 'tms' } | null;
  cssrs: { severity: string | null; safetyFlagged: boolean; date: Date } | null;
  locus: { composite: number; level: string; date: Date } | null;
  sudIntake: { asam: AsamReading; date: Date; noteId: string } | null;
  sudSignals: { condition: string; routedAction: string | null; date: Date }[];
  crisisEpisodes: { date: Date }[];
  prpEnrollment: { status: string; date: Date | null } | null;
  prpReferral: { date: Date } | null;
  /** PRP workflow stage (referral | enrolled | assessed | irp) */
  prpWorkflow?: { stage: string; date: Date } | null;
  spravatoEnrollment: { status: string; date: Date | null } | null;
  tmsCourse: { status: string; date: Date } | null;
  aotParticipant: { status: string } | null;
  residentialResident: { program: string; date: Date } | null;
  /** Program service codes billed (Valant transactions, Altrixs claims), newest first */
  billing?: ChartBilling[];
  /** Latest service date on which each diagnosis code was billed (diagnosis recency evidence) */
  billedDx?: Record<string, Date>;
  /** Acute psychiatric care from billing (POS 21 / 23 / 51, hospital / ED / crisis codes) and residential admissions */
  acuteEvents?: AcuteEvent[];
  /** Visit pattern, last 90 days (no-show / late cancel vs. completed) */
  utilization?: { noShows90: number; completed90: number };
  /** Practice time zone (age is computed on the practice calendar) */
  timeZone?: string;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const chartHref = (id: string) => `/dashboard/clients/${encodeURIComponent(id)}`;

/**
 * Age in whole years on the practice calendar. DOB is a calendar date (stored at UTC midnight),
 * so its UTC parts are the birth date; "today" is the practice-local date, not the UTC date —
 * at 9 pm Eastern the UTC date is already tomorrow.
 */
export function ageAt(dob: Date | null, now: Date, timeZone: string = DEFAULT_PRACTICE_TIME_ZONE): number | null {
  if (!dob || Number.isNaN(dob.getTime())) return null;
  const [y, m, d] = toPracticeWallTime(now, timeZone).date.split('-').map(Number);
  let age = y - dob.getUTCFullYear();
  const dm = m - (dob.getUTCMonth() + 1);
  if (dm < 0 || (dm === 0 && d < dob.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function dxText(chart: ClientChart, d: ChartDx): string {
  const where = d.source === 'problem-list' ? 'problem list' : `chart dx (${d.source})`;
  const billed = chart.billedDx?.[d.code];
  const when = d.date ? '' : billed ? `; last billed ${iso(billed)}` : '; diagnosis date not recorded';
  return `${d.code}${d.label ? ` ${d.label}` : ''} — ${where}${when}`;
}

function dxEvidence(chart: ClientChart, d: ChartDx): Evidence {
  return {
    kind: d.source === 'problem-list' ? 'problem-list' : 'diagnosis',
    text: dxText(chart, d),
    date: iso(d.date ?? chart.billedDx?.[d.code] ?? null),
    href: chartHref(chart.id),
  };
}

function within(d: Date | null | undefined, now: Date, days: number) {
  return Boolean(d && now.getTime() - d.getTime() <= days * DAY && d.getTime() <= now.getTime() + DAY);
}

const ACTIVE_STATUS = /^(active|induction|maint|in[_ -]?progress|enrolled|current)/i;
const CLOSED_STATUS = /archiv|complete|discharg|closed|cancel|withdrawn|inactive|ended|stepped?[_ -]?down|terminated/i;

/** An enrollment row counts as current unless its status says it ended. */
export function isCurrent(status: string | null | undefined): boolean {
  if (!status) return true;
  if (ACTIVE_STATUS.test(status)) return true;
  return !CLOSED_STATUS.test(status);
}

function result(program: ProgramKey, status: EligibilityStatus, parts: Partial<Omit<ProgramResult, 'program' | 'status'>>): ProgramResult {
  return {
    program,
    status,
    met: parts.met ?? [],
    unmet: parts.unmet ?? [],
    missing: parts.missing ?? [],
    confirm: parts.confirm ?? [],
    flags: parts.flags ?? [],
    evidence: parts.evidence ?? [],
    summary: parts.summary ?? '',
    gaps: [...new Set(parts.gaps ?? [])],
  };
}

/** Recent billing of a program's service codes (newest first). */
export function recentBilling(chart: ClientChart, program: BilledProgram, now: Date, days: number = BILLING_WINDOW_DAYS[program]): ChartBilling[] {
  return (chart.billing ?? []).filter((b) => b.program === program && within(b.date, now, days));
}

function billingEnrolled(chart: ClientChart, program: ProgramKey, billed: BilledProgram, now: Date, label: string): ProgramResult | null {
  const rows = recentBilling(chart, billed, now);
  if (!rows.length) return null;
  const last = rows[0];
  return result(program, 'enrolled', {
    met: [`${label} billed in the last ${BILLING_WINDOW_DAYS[billed]} days (${rows.length} line${rows.length === 1 ? '' : 's'})`],
    evidence: rows.slice(0, 3).map((b) => ({
      kind: 'billing',
      text: `${b.code} billed (${b.source === 'valant' ? 'Valant transaction' : 'Altrixs claim'})`,
      date: iso(b.date),
      href: `/dashboard/clients/${encodeURIComponent(chart.id)}?tab=billing`,
    })),
    summary: `Already receiving ${label} — service codes billed on ${iso(last.date) ?? 'a recent date'}.`,
  });
}

function ageCriterion(chart: ClientChart, now: Date, met: string[], unmet: string[], missing: string[], evidence: Evidence[], gaps: GapKey[]): 'adult' | 'minor' | 'unknown' {
  const age = ageAt(chart.dateOfBirth, now, chart.timeZone);
  if (age === null) {
    missing.push('Date of birth not recorded — adult (18+) status cannot be confirmed');
    gaps.push('dob');
    return 'unknown';
  }
  evidence.push({ kind: 'demographics', text: `Age ${age}`, date: iso(chart.dateOfBirth), href: chartHref(chart.id) });
  if (age >= 18) {
    met.push(`Adult (age ${age})`);
    return 'adult';
  }
  unmet.push(`Age ${age} — under 18`);
  return 'minor';
}

const NO_MED_LIST =
  'Medication history not available — no medication list on file for this client (the Valant medication history was not imported); antidepressant trials cannot be counted from the chart';

// ─── Antidepressant trials ───────────────────────────────────────────────────

export type AntidepressantTrial = {
  generic: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  active: boolean;
  days: number | null;
  stopReason: string | null;
  adequateDuration: boolean;
  /** false when the drug has a low-dose floor (trazodone) and the charted dose is below it or not charted */
  countable: boolean;
  notCountedReason: string | null;
};

/**
 * One trial per distinct antidepressant (longest charted duration wins). Entered-in-error rows
 * skipped. Duration ends at the stop date, or today for an active medication — a future end date
 * (prescription end) never adds days that have not happened.
 */
export function antidepressantTrials(meds: ChartMed[], now: Date): AntidepressantTrial[] {
  const byGeneric = new Map<string, AntidepressantTrial>();
  for (const m of meds) {
    if (/error|deleted|void/i.test(m.status || '')) continue;
    const generic = antidepressantGeneric(m.genericName, m.name, m.brandName);
    if (!generic) continue;
    const rawEnd = m.endDate ?? (m.active ? now : null);
    const end = rawEnd && rawEnd.getTime() > now.getTime() ? now : rawEnd;
    const days = m.startDate && end ? Math.max(0, Math.round((end.getTime() - m.startDate.getTime()) / DAY)) : null;
    const floor = LOW_DOSE_FLOOR_MG[generic];
    const mg = floor ? doseMg(m.dose, m.name) : null;
    const countable = !floor || (mg !== null && mg >= floor);
    const trial: AntidepressantTrial = {
      generic,
      name: m.name,
      startDate: m.startDate,
      endDate: m.endDate,
      active: m.active,
      days,
      stopReason: m.stopReason,
      adequateDuration: days !== null && days >= ADEQUATE_TRIAL_DAYS,
      countable,
      notCountedReason: countable
        ? null
        : `${generic} ${mg === null ? 'dose not charted' : `${mg} mg`} — below the ${floor} mg antidepressant floor (often prescribed for sleep); not counted`,
    };
    const prev = byGeneric.get(generic);
    const better = !prev || Number(trial.countable) > Number(prev.countable) || (trial.countable === prev.countable && (trial.days ?? -1) > (prev.days ?? -1));
    if (better) byGeneric.set(generic, trial);
  }
  return [...byGeneric.values()];
}

function trialEvidence(clientId: string, t: AntidepressantTrial): Evidence {
  const span = `${iso(t.startDate) ?? 'start ?'} → ${t.active ? 'active' : iso(t.endDate) ?? 'stop date not recorded'}`;
  const dur = t.days === null ? 'duration not established' : `${Math.floor(t.days / 7)} wk on record`;
  return {
    kind: 'medication',
    text: `${t.name} (${t.generic}) — ${span}; ${dur}${t.stopReason ? `; stopped: ${t.stopReason}` : ''}${t.notCountedReason ? `; ${t.notCountedReason}` : ''}`,
    date: iso(t.startDate),
    href: `/dashboard/ehr/prescriptions?clientId=${encodeURIComponent(clientId)}`,
  };
}

function mddDiagnoses(chart: ClientChart) {
  return chart.diagnoses.filter((d) => isMdd(d.code) && mddSeverity(d.code) !== 'remission');
}

// ─── PRP ─────────────────────────────────────────────────────────────────────

const PRP_ENROLLED_STAGES = /^(enrolled|assessed|irp)$/i;

export function evaluatePrp(chart: ClientChart, now: Date): ProgramResult {
  const met: string[] = [], unmet: string[] = [], missing: string[] = [], confirm: string[] = [], flags: string[] = [];
  const evidence: Evidence[] = [];
  const gaps: GapKey[] = [];

  if (chart.prpEnrollment && isCurrent(chart.prpEnrollment.status)) {
    return result('prp', 'enrolled', {
      met: ['Current PRP enrollment'],
      evidence: [{ kind: 'enrollment', text: `PRP enrollment — ${chart.prpEnrollment.status}`, date: iso(chart.prpEnrollment.date), href: '/dashboard/prp' }],
      summary: 'Already enrolled in PRP.',
    });
  }
  if (chart.prpWorkflow && PRP_ENROLLED_STAGES.test(chart.prpWorkflow.stage)) {
    return result('prp', 'enrolled', {
      met: [`PRP workflow at stage "${chart.prpWorkflow.stage}"`],
      evidence: [{ kind: 'enrollment', text: `PRP workflow — ${chart.prpWorkflow.stage}`, date: iso(chart.prpWorkflow.date), href: '/dashboard/prp' }],
      summary: 'Already in PRP (workflow past referral).',
    });
  }
  const billed = billingEnrolled(chart, 'prp', 'prp', now, 'PRP services');
  if (billed) return billed;

  const matches = chart.diagnoses.map((d) => ({ d, m: prpDiagnosis(d.code) })).filter((x) => x.m);
  const catA = matches.filter((x) => x.m!.category === 'A');
  const catB = matches.filter((x) => x.m!.category === 'B' && !PRP_NEVER_ALONE.has(x.d.code));
  if (!catA.length && !catB.length) {
    const alone = matches.find((x) => PRP_NEVER_ALONE.has(x.d.code));
    return result('prp', 'not_indicated', {
      unmet: [
        alone
          ? `No diagnosis on the PRP priority-population list that qualifies — ${alone.d.code} (unspecified anxiety) does not meet PRP medical necessity on its own`
          : 'No diagnosis on the PRP priority-population list charted',
      ],
      evidence: alone ? [dxEvidence(chart, alone.d)] : [],
      summary: 'Not indicated from the chart — no qualifying PRP diagnosis.',
    });
  }
  const best = catA[0] ?? catB[0];
  for (const x of [...catA, ...catB].slice(0, 4)) evidence.push(dxEvidence(chart, x.d));

  // Functional impairment (Category D) evidence: LOCUS at the clinic threshold, or a signed PRP
  // referral (it documents impairment and the functional narrative) dated within 60 days.
  const locus = chart.locus && within(chart.locus.date, now, WINDOWS.locus) ? chart.locus : null;
  const referral = chart.prpReferral && within(chart.prpReferral.date, now, 60) ? chart.prpReferral : null;
  if (locus) {
    evidence.push({ kind: 'locus', text: `LOCUS composite ${locus.composite} — ${locus.level}`, date: iso(locus.date), href: '/dashboard/ehr/locus' });
    if (locus.composite >= PRP_LOCUS_MIN) met.push(`Functional impairment: LOCUS composite ${locus.composite} (clinic threshold ≥ ${PRP_LOCUS_MIN})`);
    else unmet.push(`LOCUS composite ${locus.composite} is below the clinic threshold ${PRP_LOCUS_MIN} — document functional impairment if present`);
  }
  if (chart.prpReferral) {
    evidence.push({ kind: 'referral', text: 'PRP referral on file', date: iso(chart.prpReferral.date), href: '/dashboard/prp' });
    if (referral) met.push('Functional impairment documented on a signed PRP referral (within 60 days)');
    else confirm.push('PRP referral on file is older than 60 days — a new signed referral is required');
  }
  const impairment = Boolean((locus && locus.composite >= PRP_LOCUS_MIN) || referral);
  const anyImpairmentEvidence = Boolean(locus || referral);
  if (!anyImpairmentEvidence) {
    missing.push('No functional impairment documented — no LOCUS in the last 12 months and no signed PRP referral within 60 days');
    gaps.push('functional_impairment', 'locus');
  }

  if (best.m!.category === 'A') {
    met.push(`Category A (SMI) diagnosis: ${best.d.code}${best.d.label ? ` ${best.d.label}` : ''}`);
    if (!best.m!.onClinicList) confirm.push(`${best.d.code} is not on the clinic's configured PRP diagnosis list — confirm it is on the PBHS Priority Population list`);
    confirm.push('Category C (SSI/SSDI for mental illness) or Category D (impaired role functioning) — confirm and document');
  } else {
    met.push(`Category B diagnosis: ${best.d.code}${best.d.label ? ` ${best.d.label}` : ''} (requires Category D impaired role functioning)`);
    if (best.m!.highDenialRisk) flags.push(`${best.d.code} carries high denial risk for PRP authorization`);
    if (!anyImpairmentEvidence) {
      unmet.push(`Category B diagnosis ${best.d.code} without documented functional impairment — does not qualify on the diagnosis alone`);
      return result('prp', 'not_indicated', { met, unmet, missing, evidence, gaps, summary: 'Not indicated — a Category B diagnosis alone does not meet PRP medical necessity.' });
    }
  }

  const age = ageAt(chart.dateOfBirth, now, chart.timeZone);
  if (age === null) {
    missing.push('Date of birth not recorded — adult vs. minor PRP criteria cannot be selected');
    gaps.push('dob');
  } else if (age < 18) confirm.push(`Age ${age} — the minor (child & adolescent) PRP criteria and diagnosis list apply, not the adult set screened here`);
  else met.push(`Adult (age ${age})`);

  const payer = `${chart.insuranceType ?? ''} ${chart.insurancePayer ?? ''}`.trim();
  if (payer) {
    evidence.push({ kind: 'insurance', text: `Payer: ${payer}`, date: null, href: chartHref(chart.id) });
    if (!isMarylandMedicaid(payer)) {
      confirm.push('Payer is not recorded as Maryland Medicaid — PRP is a PBHS service; state-funded / uninsured clients must also meet 1 of 4 eligibility criteria');
    }
  } else {
    missing.push('Insurance not recorded — PBHS (Medicaid / state-funded) coverage not confirmed');
    gaps.push('insurance');
  }

  if (chart.residentialResident && /3\.(3|5|7)/.test(chart.residentialResident.program)) {
    flags.push(`Conflicting service: active residential SUD level ${chart.residentialResident.program} (PRP not routinely provided with residential SUD 3.3+)`);
    unmet.push('Currently in residential SUD treatment 3.3 or higher');
  }
  const iop = recentBilling(chart, 'iop', now);
  if (iop.length) {
    flags.push(`Conflicting service: IOP / PHP billed ${iso(iop[0].date) ?? ''} (${iop[0].code}) — PRP is not routinely provided with IOP / PHP`.replace(' ()', ''));
    evidence.push({ kind: 'billing', text: `${iop[0].code} billed (IOP / PHP)`, date: iso(iop[0].date) });
  }
  confirm.push('Outpatient clinician and referral source must not be affiliated with or paid by the PRP');

  // SMI diagnosis with no impairment evidence at all: diagnosis only — screen (hidden by default)
  const status: EligibilityStatus = !anyImpairmentEvidence
    ? 'screen'
    : impairment && !missing.length && !unmet.length
      ? 'candidate'
      : 'potential';
  return result('prp', status, {
    met, unmet, missing, confirm, flags, evidence, gaps,
    summary: status === 'candidate'
      ? 'Qualifying diagnosis and documented functional impairment — consider a PRP referral after clinician review.'
      : status === 'screen'
        ? 'Diagnosis only — screen: an SMI diagnosis is charted but no functional impairment is documented (LOCUS or signed PRP referral).'
        : 'Qualifying diagnosis with impairment evidence — complete the missing items before a PRP referral.',
  });
}

const MD_MEDICAID = /medicaid|medical assistance|priority partners|amerigroup|wellpoint|maryland physicians care|\bjai\b|carefirst community|aetna better health|united.*community|kaiser.*medicaid|healthchoice|\bmco\b|\bpbhs\b|optum maryland/i;
export function isMarylandMedicaid(payer: string): boolean {
  return MD_MEDICAID.test(payer);
}

// ─── Spravato ────────────────────────────────────────────────────────────────

export function evaluateSpravato(chart: ClientChart, now: Date): ProgramResult {
  const met: string[] = [], unmet: string[] = [], missing: string[] = [], flags: string[] = [];
  const evidence: Evidence[] = [];
  const gaps: GapKey[] = [];
  const confirm = [
    'Adequate dose and duration of each antidepressant trial, and that trials were in the current episode',
    'SPRAVATO REMS: certified setting and patient enrollment; ≥2 h post-dose monitoring',
    'Blood pressure before dosing (label: assess BP; do not dose if elevated per label guidance)',
  ];

  if (chart.spravatoEnrollment && isCurrent(chart.spravatoEnrollment.status)) {
    return result('spravato', 'enrolled', {
      met: ['Current Spravato enrollment'],
      evidence: [{ kind: 'enrollment', text: `Spravato enrollment — ${chart.spravatoEnrollment.status}`, date: iso(chart.spravatoEnrollment.date), href: '/dashboard/ehr/tms-spravato' }],
      summary: 'Already enrolled in the Spravato program.',
    });
  }
  const billed = billingEnrolled(chart, 'spravato', 'spravato', now, 'Spravato treatment');
  if (billed) return billed;

  const mdd = mddDiagnoses(chart);
  if (!mdd.length) {
    return result('spravato', 'not_indicated', { unmet: ['No active major depressive disorder diagnosis (F32 / F33) charted'], summary: 'Not indicated from the chart — no MDD diagnosis.' });
  }
  met.push(`MDD diagnosis: ${mdd[0].code}${mdd[0].label ? ` ${mdd[0].label}` : ''}`);
  for (const d of mdd.slice(0, 2)) evidence.push(dxEvidence(chart, d));

  const age = ageCriterion(chart, now, met, unmet, missing, evidence, gaps);
  if (age === 'minor') {
    return result('spravato', 'not_indicated', { met, unmet, evidence, summary: 'Not indicated — Spravato is approved for adults only.' });
  }

  // Contraindications (problem list, allergies)
  const contra = chart.diagnoses.map((d) => ({ d, label: spravatoContraindication(d.code) })).filter((x) => x.label);
  const allergy = chart.allergies.filter((a) => !/inactive|resolved|error/i.test(a.status || '') && isKetamineAllergy(a.allergen));
  for (const c of contra) {
    flags.push(`Contraindication on chart: ${c.label} (${c.d.code})`);
    evidence.push(dxEvidence(chart, c.d));
  }
  for (const a of allergy) {
    flags.push(`Contraindication on chart: allergy — ${a.allergen}`);
    evidence.push({ kind: 'allergy', text: `Allergy: ${a.allergen}`, date: null, href: chartHref(chart.id) });
  }
  if (contra.length || allergy.length) {
    unmet.push('Labeled contraindication present on the chart');
    return result('spravato', 'not_indicated', { met, unmet, missing, confirm, flags, evidence, gaps, summary: 'Not indicated — a labeled contraindication is charted. Prescriber review required.' });
  }
  if (!chart.problemCount) {
    missing.push('No problem list on file — screen for aneurysmal vascular disease / AVM and intracerebral hemorrhage history');
    gaps.push('problem_list');
  } else {
    confirm.push('Contraindication screen: aneurysmal vascular disease, AVM, intracerebral hemorrhage (none coded on the problem list)');
  }

  // Pathway 1: TRD — ≥2 different antidepressants
  const trials = antidepressantTrials(chart.meds, now);
  for (const t of trials) evidence.push(trialEvidence(chart.id, t));
  const adequate = trials.filter((t) => t.adequateDuration && t.countable);
  const trd = adequate.length >= 2;

  // Pathway 2: MDD with acute suicidal ideation / behavior
  const c = chart.cssrs && within(chart.cssrs.date, now, WINDOWS.cssrs) ? chart.cssrs : null;
  const acuteSi = Boolean(c && (c.safetyFlagged || /moderate|high|imminent/i.test(c.severity || '')));
  if (c) evidence.push({ kind: 'assessment', text: `C-SSRS: ${c.severity ?? 'no severity recorded'}${c.safetyFlagged ? ' (safety-flagged)' : ''}`, date: iso(c.date), href: '/dashboard/ehr/assessments/cssrs' });

  if (trd) met.push(`Treatment-resistant: ${adequate.length} different antidepressants with ≥${ADEQUATE_TRIAL_DAYS / 7} weeks on the medication list (${adequate.map((t) => t.generic).join(', ')})`);
  if (acuteSi) met.push('MDD with acute suicidal ideation / behavior (C-SSRS in the last 30 days) — label indication with an oral antidepressant');
  if (!trd && !acuteSi) {
    if (!chart.meds.length) {
      missing.push(NO_MED_LIST);
      gaps.push('med_history');
    } else {
      missing.push(
        `≥2 adequate antidepressant trials not documented — ${adequate.length} with ≥${ADEQUATE_TRIAL_DAYS / 7} weeks on record${trials.length > adequate.length ? `, ${trials.length - adequate.length} short, unknown-duration or not counted` : ''}; medication history may be incomplete`
      );
      gaps.push('med_trials');
    }
  }
  if (acuteSi) flags.push('Acute suicidality — follow the crisis / safety protocol first (988); Spravato does not replace hospitalization when indicated');

  // No medication history at all (and no acute-SI pathway): diagnosis only — hidden by default
  const status: EligibilityStatus = trd || acuteSi ? (missing.length ? 'potential' : 'candidate') : !chart.meds.length ? 'screen' : 'potential';
  return result('spravato', status, {
    met, unmet, missing, confirm, flags, evidence, gaps,
    summary: status === 'candidate'
      ? 'Chart supports a Spravato evaluation — prescriber confirms TRD / SI criteria, contraindications and REMS.'
      : status === 'screen'
        ? 'Diagnosis only — needs medication history: MDD is charted but no medication list is on file, so treatment resistance cannot be checked.'
        : 'MDD charted — the chart does not yet document the Spravato criteria; review medication history.',
  });
}

// ─── TMS ─────────────────────────────────────────────────────────────────────

export function evaluateTms(chart: ClientChart, now: Date): ProgramResult {
  const met: string[] = [], unmet: string[] = [], missing: string[] = [], flags: string[] = [];
  const evidence: Evidence[] = [];
  const gaps: GapKey[] = [];
  const rule = tmsTrialRule(`${chart.insurancePayer ?? ''} ${chart.insuranceType ?? ''}`);
  const confirm = [
    'Adequate dose and duration of each trial, in the current episode (or documented intolerance)',
    'Order by a psychiatrist who examined the patient',
    `Payer rule used: ${rule.source}`,
  ];

  if (chart.tmsCourse && isCurrent(chart.tmsCourse.status)) {
    return result('tms', 'enrolled', {
      met: ['Current TMS course'],
      evidence: [{ kind: 'enrollment', text: `TMS course — ${chart.tmsCourse.status}`, date: iso(chart.tmsCourse.date), href: '/dashboard/ehr/tms-spravato' }],
      summary: 'Already in a TMS course.',
    });
  }
  const billed = billingEnrolled(chart, 'tms', 'tms', now, 'TMS');
  if (billed) return billed;

  const mdd = mddDiagnoses(chart);
  if (!mdd.length) {
    return result('tms', 'not_indicated', { unmet: ['No active major depressive disorder diagnosis (F32 / F33) charted'], summary: 'Not indicated from the chart — no MDD diagnosis.' });
  }
  for (const d of mdd.slice(0, 2)) evidence.push(dxEvidence(chart, d));
  const age = ageCriterion(chart, now, met, unmet, missing, evidence, gaps);
  if (age === 'minor') {
    return result('tms', 'not_indicated', { met, unmet, evidence, summary: 'Not indicated — LCD coverage is for adults.' });
  }

  // Severity: severe by code, or PHQ-9 ≥ 20 in the last 90 days
  const severities = mdd.map((d) => ({ d, s: mddSeverity(d.code) }));
  const severeDx = severities.find((x) => x.s === 'severe' || x.s === 'severe-psychotic');
  const phq = chart.phq9 && within(chart.phq9.date, now, WINDOWS.phq9) ? chart.phq9 : null;
  if (phq) evidence.push({ kind: 'assessment', text: `PHQ-9 ${phq.score}${phq.source === 'measurement' ? ' (imported measurement)' : phq.source === 'tms' ? ' (TMS course)' : ''}`, date: iso(phq.date), href: '/dashboard/ehr/assessments' });
  if (severeDx) met.push(`Severe MDD coded: ${severeDx.d.code}`);
  else if (phq && phq.score >= 20) met.push(`Severe depressive symptoms: PHQ-9 ${phq.score} (≥ 20) on ${iso(phq.date)}`);
  else if (severities.some((x) => x.s === 'moderate' || x.s === 'mild')) {
    unmet.push(`MDD coded as ${severities.find((x) => x.s === 'moderate' || x.s === 'mild')!.s} — the LCD requires severe MDD${phq ? ` (PHQ-9 ${phq.score})` : ''}`);
  } else {
    missing.push(`MDD severity not established — code unspecified${phq ? ` and PHQ-9 ${phq.score} < 20` : ' and no PHQ-9 in the last 90 days'}`);
    gaps.push(phq ? 'mdd_severity' : 'phq9');
  }
  if (severities.some((x) => x.s === 'severe-psychotic')) flags.push('Relative contraindication: psychotic features in the current episode (coded)');

  // Medication trials
  const trials = antidepressantTrials(chart.meds, now);
  for (const t of trials) evidence.push(trialEvidence(chart.id, t));
  const adequate = trials.filter((t) => t.adequateDuration && t.countable);
  const intolerance = trials.filter((t) => t.countable && !t.adequateDuration && /intoler|side effect|adverse|allerg/i.test(t.stopReason || ''));
  const counted = adequate.length + intolerance.length;
  if (counted >= rule.minTrials) {
    met.push(`${counted} antidepressant trial${counted === 1 ? '' : 's'} on record (rule: ≥ ${rule.minTrials})${intolerance.length ? ` incl. ${intolerance.length} stopped for intolerance` : ''}`);
  } else if (!chart.meds.length) {
    missing.push(`${NO_MED_LIST} (payer rule: ≥ ${rule.minTrials})`);
    gaps.push('med_history');
  } else {
    missing.push(`${counted} of ${rule.minTrials} required antidepressant trial${rule.minTrials === 1 ? '' : 's'} documented (≥${ADEQUATE_TRIAL_DAYS / 7} weeks or stopped for intolerance) — medication history may be incomplete`);
    gaps.push('med_trials');
  }

  // Contraindications
  const abs = chart.diagnoses.map((d) => ({ d, label: tmsAbsolute(d.code) })).filter((x) => x.label);
  const rel = chart.diagnoses.map((d) => ({ d, label: tmsRelative(d.code) })).filter((x) => x.label);
  for (const x of abs) { flags.push(`Absolute contraindication: ${x.label} (${x.d.code})`); evidence.push(dxEvidence(chart, x.d)); }
  for (const x of rel) { flags.push(`Relative contraindication: ${x.label} (${x.d.code})`); evidence.push(dxEvidence(chart, x.d)); }
  if (abs.length) {
    unmet.push('Implanted device / metal near the coil coded on the chart');
    return result('tms', 'not_indicated', { met, unmet, missing, confirm, flags, evidence, gaps, summary: 'Not indicated — absolute contraindication coded. Prescriber review required.' });
  }
  if (!chart.problemCount) {
    missing.push('No problem list on file — implant / metal and seizure-history screen required');
    gaps.push('problem_list');
  } else confirm.push('Implant / metal and seizure-history screen (none coded on the problem list)');

  const status: EligibilityStatus = !chart.meds.length
    ? 'screen'
    : missing.length || unmet.length || rel.length
      ? 'potential'
      : 'candidate';
  return result('tms', status, {
    met, unmet, missing, confirm, flags, evidence, gaps,
    summary: status === 'candidate'
      ? 'Chart supports a TMS evaluation — psychiatrist confirms severity, trials and safety screen.'
      : status === 'screen'
        ? 'Diagnosis only — needs medication history: MDD is charted but no medication list is on file, so failed trials cannot be counted.'
        : 'MDD charted — complete the missing TMS criteria or review the flagged items.',
  });
}

// ─── AOT ─────────────────────────────────────────────────────────────────────

/** Minimum distinct acute psychiatric events (36 months) for the AOT history prong */
export const AOT_MIN_EVENTS = 2;

export type AcuteEvent = { date: Date; kind: 'inpatient' | 'ed' | 'crisis' | 'crisis-episode' | 'residential'; code: string | null };

const ACUTE_LABEL: Record<AcuteEvent['kind'], string> = {
  inpatient: 'inpatient psychiatric / hospital service billed',
  ed: 'emergency department service billed',
  crisis: 'crisis service billed',
  'crisis-episode': 'mobile crisis episode',
  residential: 'residential admission',
};

/** Distinct acute events in the AOT look-back: one per calendar day (an ED visit and a crisis episode the same day count once). */
export function aotAcuteEvents(chart: ClientChart, now: Date): AcuteEvent[] {
  const all: AcuteEvent[] = [
    ...chart.crisisEpisodes.map((c) => ({ date: c.date, kind: 'crisis-episode' as const, code: null })),
    ...(chart.acuteEvents ?? []),
  ].filter((e) => within(e.date, now, WINDOWS.crisis));
  const byDay = new Map<string, AcuteEvent>();
  for (const e of all.sort((a, b) => b.date.getTime() - a.date.getTime())) {
    const day = iso(e.date)!;
    if (!byDay.has(day)) byDay.set(day, e);
  }
  return [...byDay.values()];
}

/**
 * AOT (Md. Code, Health–General § 10-6A): chart context for the statutory screen. "review" only
 * when the chart shows an adult with SMI AND the history prong — at least two acute psychiatric
 * events (hospitalization, ED, crisis) in 36 months. Non-adherence and violence / serious threats are
 * not structured in the chart: the clinician / legal screen confirms them. A diagnosis alone never
 * puts a client on the AOT list.
 */
export function evaluateAot(chart: ClientChart, now: Date): ProgramResult {
  if (chart.aotParticipant && isCurrent(chart.aotParticipant.status)) {
    return result('aot', 'enrolled', {
      met: ['In the AOT program'],
      evidence: [{ kind: 'enrollment', text: `AOT participant — ${chart.aotParticipant.status}`, date: null, href: '/dashboard/aot' }],
      summary: 'Already in the AOT program (any stage from referral to step-down).',
    });
  }
  const smi = chart.diagnoses.filter((d) => isAotSmi(d.code));
  if (!smi.length) {
    return result('aot', 'not_indicated', { unmet: ['No serious and persistent mental illness diagnosis charted (schizophrenia spectrum, bipolar, severe MDD)'], summary: 'Not indicated from the chart.' });
  }
  const met: string[] = [], unmet: string[] = [], missing: string[] = [];
  const gaps: GapKey[] = [];
  const evidence: Evidence[] = smi.slice(0, 3).map((d) => dxEvidence(chart, d));
  met.push(`Serious mental illness charted: ${smi[0].code}${smi[0].label ? ` ${smi[0].label}` : ''}`);
  const age = ageCriterion(chart, now, met, unmet, missing, evidence, gaps);
  if (age === 'minor') return result('aot', 'not_indicated', { met, unmet, evidence, summary: 'Not indicated — AOT is for adults.' });

  const events = aotAcuteEvents(chart, now);
  for (const e of events.slice(0, 5)) {
    evidence.push({ kind: e.kind === 'crisis-episode' ? 'crisis' : 'acute-care', text: `${ACUTE_LABEL[e.kind]}${e.code ? ` (${e.code})` : ''}`, date: iso(e.date), href: e.kind === 'crisis-episode' ? '/dashboard/crisis' : undefined });
  }
  const confirm = [
    'Non-adherence to treatment linked to these events, or a serious violent act / threat — clinical and legal history review',
    'Unlikely to adhere voluntarily; AOT is the least restrictive alternative for health and safety',
    'Detention-center mental health services and outside hospitalizations are not in the chart — check CRISP / records',
    'Run the statutory screen in the AOT module; never file a petition from scanner results',
  ];
  if (events.length < AOT_MIN_EVENTS) {
    unmet.push(`History prong not shown in the chart: ${events.length} of ${AOT_MIN_EVENTS} hospitalization / ED / crisis events in the last 36 months`);
    gaps.push('acute_events');
    return result('aot', 'not_indicated', {
      met, unmet, missing, confirm, evidence, gaps,
      summary: 'Not indicated from the chart — an SMI diagnosis alone does not meet the AOT history criteria.',
    });
  }
  if (age === 'unknown') {
    unmet.push('Adult status (18+) not confirmed — date of birth not recorded');
    return result('aot', 'not_indicated', { met, unmet, missing, confirm, evidence, gaps, summary: 'Not indicated until the date of birth is recorded (AOT is for adults).' });
  }
  met.push(`${events.length} acute psychiatric events (hospitalization / ED / crisis) in the last 36 months`);
  return result('aot', 'review', {
    met, unmet, missing, confirm, evidence, gaps,
    summary: `SMI with ${events.length} acute events in 36 months — clinical / legal review for AOT if non-adherence or violence is part of the pattern.`,
  });
}

// ─── SUD level of care (shared by Residential and IOP) ──────────────────────

type SudContext = {
  sud: { d: ChartDx; info: NonNullable<ReturnType<typeof classifySudCode>> }[];
  activeSud: SudContext['sud'];
  radar: ClientChart['sudSignals'];
  intake: ClientChart['sudIntake'];
};

function sudContext(chart: ClientChart, now: Date): SudContext {
  const sud = chart.diagnoses
    .map((d) => ({ d, info: classifySudCode(d.code, d.label) }))
    .filter((x): x is SudContext['sud'][number] => Boolean(x.info && x.info.substance !== 'nicotine'));
  return {
    sud,
    activeSud: sud.filter((x) => !x.info.remission),
    radar: chart.sudSignals.filter((s) => s.routedAction === 'residential-referral'),
    intake: chart.sudIntake && within(chart.sudIntake.date, now, WINDOWS.sudIntake) ? chart.sudIntake : null,
  };
}

function asamEvidence(chart: ClientChart, intake: NonNullable<ClientChart['sudIntake']>): Evidence {
  const { ratings, levelOfCare } = intake.asam;
  const ratingText = [1, 2, 3, 4, 5, 6].map((n) => `D${n} ${ratings[n] ?? '–'}`).join(' · ');
  return { kind: 'note', text: `Substance Abuse Intake — ASAM ${ratingText}${levelOfCare ? `; recommended level: ${levelOfCare}` : ''}`, date: iso(intake.date), href: `/dashboard/ehr/notes?clientId=${encodeURIComponent(chart.id)}` };
}

function asamFlags(ratings: Record<number, number>): string[] {
  const flags: string[] = [];
  if ((ratings[1] ?? 0) >= 3) flags.push('Dimension 1 ≥ 3 — assess for withdrawal management (3.7-WM) before residential 3.1 / 3.5');
  if ((ratings[2] ?? 0) >= 3) flags.push('Dimension 2 ≥ 3 — biomedical needs may require a medically monitored level');
  if ((ratings[3] ?? 0) >= 4) flags.push('Dimension 3 = 4 — psychiatric instability may require a higher level of care');
  return flags;
}

// ─── Residential SUD (ASAM 3.1 / 3.5) ───────────────────────────────────────

export function evaluateResidential(chart: ClientChart, now: Date): ProgramResult {
  if (chart.residentialResident) {
    return result('residential', 'enrolled', {
      met: [`Active residential resident (ASAM ${chart.residentialResident.program})`],
      evidence: [{ kind: 'enrollment', text: `Residential ${chart.residentialResident.program}`, date: iso(chart.residentialResident.date), href: '/dashboard/residential' }],
      summary: 'Already in residential treatment.',
    });
  }
  const billed = billingEnrolled(chart, 'residential', 'residential', now, 'residential SUD per diem');
  if (billed) return billed;
  const met: string[] = [], unmet: string[] = [], missing: string[] = [], flags: string[] = [];
  const evidence: Evidence[] = [];
  const gaps: GapKey[] = [];
  const confirm = ['Payer prior authorization (H0018 / H0019)', 'Medical clearance and toxicology per program admission policy'];

  const { sud, activeSud, radar, intake } = sudContext(chart, now);
  for (const s of radar) evidence.push({ kind: 'sud-radar', text: `SUD Referral Radar: ${s.condition} — routed residential / IOP`, date: iso(s.date), href: '/dashboard/ehr/scanner/sud-radar' });

  if (!activeSud.length) {
    if (radar.length) {
      missing.push('SUD Referral Radar routed a residential review, but no active F10–F19 diagnosis is charted');
      gaps.push('sud_dx');
      return result('residential', 'potential', { missing, confirm, evidence, gaps, summary: 'Radar signal only — assess and chart an SUD diagnosis before any level-of-care decision.' });
    }
    return result('residential', 'not_indicated', {
      unmet: [sud.length ? 'SUD diagnoses charted are in remission' : 'No substance use disorder diagnosis (F10–F19, excluding nicotine) charted'],
      evidence: sud.slice(0, 2).map((x) => dxEvidence(chart, x.d)),
      summary: 'Not indicated from the chart.',
    });
  }
  for (const x of activeSud.slice(0, 3)) evidence.push(dxEvidence(chart, x.d));
  const dependence = activeSud.find((x) => x.info.level === 'dependence');
  met.push(`Active SUD diagnosis: ${(dependence ?? activeSud[0]).d.code} (${(dependence ?? activeSud[0]).info.severityLabel})`);
  if (!dependence) confirm.push('Charted code is use / abuse level — residential care usually needs a moderate–severe use disorder');
  if (radar.length) met.push('SUD Referral Radar routed this client to a residential / IOP review');

  if (!intake) {
    missing.push('No signed Substance Abuse Intake with ASAM dimensions in the last 12 months');
    gaps.push('asam_intake');
    return result('residential', 'potential', { met, unmet, missing, confirm, flags, evidence, gaps, summary: 'SUD charted — complete the ASAM six-dimension assessment (Substance Abuse Intake) to determine level of care.' });
  }
  const { ratings, levelOfCare } = intake.asam;
  const rated = Object.keys(ratings).length;
  evidence.push(asamEvidence(chart, intake));
  flags.push(...asamFlags(ratings));

  const level = asamLevelNumber(levelOfCare);
  if (level !== null) {
    if (level === 3.1 || level === 3.5 || level === 3.3) {
      met.push(`Clinician-recommended level of care: ${levelOfCare}`);
    } else if (level < 3) {
      unmet.push(`Clinician-recommended level of care is ${levelOfCare} (below residential)`);
      return result('residential', 'not_indicated', { met, unmet, missing, confirm, flags, evidence, gaps, summary: `Not indicated — the intake recommends ${levelOfCare}${level >= 2 ? ' (see IOP)' : ''}.` });
    } else {
      unmet.push(`Clinician-recommended level of care is ${levelOfCare} (above 3.5)`);
      return result('residential', 'not_indicated', { met, unmet, missing, confirm, flags, evidence, gaps, summary: 'Not indicated for 3.1 / 3.5 — the intake recommends a higher level of care.' });
    }
  } else if (rated === 6) {
    const max = Math.max(...Object.values(ratings));
    if (max >= 3) met.push(`ASAM ratings include ${max} — consistent with considering Level 3.x (decision support)`);
    else unmet.push(`Highest ASAM rating ${max} — ratings suggest a non-residential level`);
    missing.push('Recommended level of care not recorded on the intake');
    gaps.push('asam_level');
  } else {
    missing.push(`ASAM dimensions incomplete on the intake (${rated} of 6 rated)`);
    gaps.push('asam_level');
  }

  const status: EligibilityStatus = missing.length || unmet.length || flags.length ? 'potential' : 'candidate';
  return result('residential', status, {
    met, unmet, missing, confirm, flags, evidence, gaps,
    summary: status === 'candidate'
      ? 'Intake recommends residential 3.1 / 3.5 — proceed to admission review and prior authorization.'
      : 'SUD charted — review the ASAM findings and flags before a residential referral.',
  });
}

// ─── SUD IOP / PHP (ASAM 2.1 / 2.5) ─────────────────────────────────────────

/**
 * Intensive outpatient (ASAM 2.1) / partial hospitalization (2.5). Same SUD diagnosis and ASAM
 * inputs as residential; the recommended level decides between them. Sedative / alcohol / opioid
 * withdrawal risk is flagged for a withdrawal-management assessment, never used to exclude
 * (owner decision: sedative withdrawal stays routed to residential / IOP).
 */
export function evaluateIop(chart: ClientChart, now: Date): ProgramResult {
  const billed = billingEnrolled(chart, 'iop', 'iop', now, 'IOP / PHP');
  if (billed) return billed;
  if (chart.residentialResident) {
    return result('iop', 'not_indicated', {
      unmet: [`In residential treatment (ASAM ${chart.residentialResident.program}) — IOP is a step-down after discharge`],
      summary: 'Not indicated now — in residential care; consider IOP at step-down.',
    });
  }
  const met: string[] = [], unmet: string[] = [], missing: string[] = [], flags: string[] = [];
  const evidence: Evidence[] = [];
  const gaps: GapKey[] = [];
  const confirm = [
    'Payer authorization (Maryland Medicaid SUD IOP H0015 / PHP through the ASO; commercial plans vary)',
    'Client can attend ≥ 9 h/week (adult 2.1) and has a safe living environment for an outpatient level',
  ];
  const { sud, activeSud, radar, intake } = sudContext(chart, now);
  for (const s of radar) evidence.push({ kind: 'sud-radar', text: `SUD Referral Radar: ${s.condition} — routed residential / IOP`, date: iso(s.date), href: '/dashboard/ehr/scanner/sud-radar' });

  if (!activeSud.length) {
    if (radar.length) {
      missing.push('SUD Referral Radar routed a level-of-care review, but no active F10–F19 diagnosis is charted');
      gaps.push('sud_dx');
      return result('iop', 'potential', { missing, confirm, evidence, gaps, summary: 'Radar signal only — assess and chart an SUD diagnosis before any level-of-care decision.' });
    }
    return result('iop', 'not_indicated', {
      unmet: [sud.length ? 'SUD diagnoses charted are in remission' : 'No substance use disorder diagnosis (F10–F19, excluding nicotine) charted'],
      evidence: sud.slice(0, 2).map((x) => dxEvidence(chart, x.d)),
      summary: 'Not indicated from the chart.',
    });
  }
  for (const x of activeSud.slice(0, 3)) evidence.push(dxEvidence(chart, x.d));
  const lead = activeSud.find((x) => x.info.level === 'dependence') ?? activeSud[0];
  met.push(`Active SUD diagnosis: ${lead.d.code} (${lead.info.severityLabel})`);
  if (activeSud.some((x) => x.info.withdrawal)) flags.push('Withdrawal coded — assess withdrawal management needs (sedative / alcohol withdrawal stays routed to residential / IOP review)');
  if (radar.length) met.push('SUD Referral Radar routed this client to a residential / IOP review');

  if (!intake) {
    missing.push('No signed Substance Abuse Intake with ASAM dimensions in the last 12 months');
    gaps.push('asam_intake');
    return result('iop', 'potential', { met, unmet, missing, confirm, flags, evidence, gaps, summary: 'SUD charted — complete the ASAM six-dimension assessment (Substance Abuse Intake) to determine level of care.' });
  }
  const { ratings, levelOfCare } = intake.asam;
  const rated = Object.keys(ratings).length;
  evidence.push(asamEvidence(chart, intake));
  if ((ratings[1] ?? 0) >= 3) flags.push('Dimension 1 ≥ 3 — withdrawal management before or alongside IOP');
  if ((ratings[2] ?? 0) >= 3) flags.push('Dimension 2 ≥ 3 — biomedical needs may require a medically monitored level');

  const level = asamLevelNumber(levelOfCare);
  if (level !== null) {
    if (level >= 2 && level < 3) met.push(`Clinician-recommended level of care: ${levelOfCare}`);
    else if (level < 2) {
      unmet.push(`Clinician-recommended level of care is ${levelOfCare} (outpatient)`);
      return result('iop', 'not_indicated', { met, unmet, missing, confirm, flags, evidence, gaps, summary: 'Not indicated — the intake recommends outpatient care.' });
    } else {
      unmet.push(`Clinician-recommended level of care is ${levelOfCare} (residential or higher)`);
      return result('iop', 'not_indicated', { met, unmet, missing, confirm, flags, evidence, gaps, summary: 'Not indicated now — the intake recommends a residential / higher level (see Residential).' });
    }
  } else if (rated === 6) {
    const max = Math.max(...Object.values(ratings));
    if (max === 2) met.push('Highest ASAM rating 2 — consistent with considering Level 2.x (decision support)');
    else if (max >= 3) confirm.push(`ASAM ratings include ${max} — compare residential vs. IOP`);
    else unmet.push(`Highest ASAM rating ${max} — ratings suggest outpatient care`);
    missing.push('Recommended level of care not recorded on the intake');
    gaps.push('asam_level');
  } else {
    missing.push(`ASAM dimensions incomplete on the intake (${rated} of 6 rated)`);
    gaps.push('asam_level');
  }

  const status: EligibilityStatus = missing.length || unmet.length || flags.length ? 'potential' : 'candidate';
  return result('iop', status, {
    met, unmet, missing, confirm, flags, evidence, gaps,
    summary: status === 'candidate'
      ? 'Intake recommends IOP / PHP (ASAM 2.1 / 2.5) — proceed to IOP intake and authorization.'
      : 'SUD charted — review the ASAM findings before an IOP referral.',
  });
}

export const EVALUATORS: Record<ProgramKey, (chart: ClientChart, now: Date) => ProgramResult> = {
  prp: evaluatePrp,
  spravato: evaluateSpravato,
  tms: evaluateTms,
  aot: evaluateAot,
  residential: evaluateResidential,
  iop: evaluateIop,
};

export function evaluateClient(chart: ClientChart, now: Date): Record<ProgramKey, ProgramResult> {
  return {
    prp: evaluatePrp(chart, now),
    spravato: evaluateSpravato(chart, now),
    tms: evaluateTms(chart, now),
    aot: evaluateAot(chart, now),
    residential: evaluateResidential(chart, now),
    iop: evaluateIop(chart, now),
  };
}
