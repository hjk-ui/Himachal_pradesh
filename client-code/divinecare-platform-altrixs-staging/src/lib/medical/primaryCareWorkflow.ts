/**
 * Primary care workflow rules (pure: no prisma; browser, server and tests).
 *
 * MA rooming (vitals flags, BMI, screenings due), care gaps (screening guidance), the behavioral
 * health warm-handoff threshold, E/M code suggestions and closed-loop result / order tracking.
 *
 * Owner rules applied here:
 * - Nothing is invented: every flag, due item and suggestion is computed from values passed in and
 *   carries its reason. A missing date reads "none on file", never a guess.
 * - Vital flags are flags only ("Notify provider"); no interpretation text.
 * - Care gaps are screening guidance (USPSTF / ACIP / ADA-HEDIS). A Medical Assistant can record a
 *   patient-reported "done elsewhere" but that never closes a gap; only a provider action does.
 * - E/M codes are suggestions only; the provider picks the code.
 */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import { toPracticeWallTime } from '@/lib/time/practiceTime';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

// ─── Roles ───────────────────────────────────────────────────────────────────

const up = (role: string | null | undefined) => (role ? String(normalizeStaffRole(role)).toUpperCase() : '');
const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

/** Physician / medical NP: the primary care providers (prescribe for their care team). */
export function isPrimaryCareProvider(role: string | null | undefined): boolean {
  const r = up(role);
  return r === 'PHYSICIAN' || r === 'MEDICAL_NP';
}

export function isMedicalAssistant(role: string | null | undefined): boolean {
  return up(role) === 'MEDICAL_ASSISTANT';
}

/** Room a patient (identity, vitals, reviews, screenings): MA, physician, medical NP. */
export function canRoomPatients(role: string | null | undefined): boolean {
  return isMedicalAssistant(role) || isPrimaryCareProvider(role);
}

/** Read rooming / care gaps / referral tracking: the primary care team and leadership. */
export function canViewPrimaryCareWorkflow(role: string | null | undefined): boolean {
  return canRoomPatients(role) || LEADERSHIP.has(up(role));
}

/** Practice settings for primary care (standing orders, results window, enabled care gaps). */
export function canManagePrimaryCareSettings(role: string | null | undefined): boolean {
  return LEADERSHIP.has(up(role));
}

// ─── Vitals ──────────────────────────────────────────────────────────────────

export type BpReading = { systolic: number | null; diastolic: number | null; takenAt?: string | null };

export type RoomingVitals = {
  systolic?: number | null;
  diastolic?: number | null;
  heartRate?: number | null;
  respRate?: number | null;
  temperatureF?: number | null;
  spO2?: number | null;
  heightIn?: number | null;
  weightLbs?: number | null;
  /** 0–10 patient-reported pain */
  pain?: number | null;
  /** ISO time the first set was taken */
  takenAt?: string | null;
  /** BP recheck after an elevated first reading */
  recheck?: BpReading | null;
};

/** Accepted ranges (entry validation only; not clinical limits). */
export const VITAL_RANGES = {
  systolic: [40, 300],
  diastolic: [20, 250],
  heartRate: [20, 300],
  respRate: [4, 80],
  temperatureF: [85, 112],
  spO2: [50, 100],
  heightIn: [10, 96],
  weightLbs: [1, 1500],
  pain: [0, 10],
} as const;

export type VitalKey = keyof typeof VITAL_RANGES;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Entry errors ("Systolic must be 40–300"); empty values are allowed (nothing is required here). */
export function vitalEntryErrors(v: RoomingVitals): string[] {
  const out: string[] = [];
  for (const [key, [min, max]] of Object.entries(VITAL_RANGES) as [VitalKey, readonly [number, number]][]) {
    const x = (v as Record<string, unknown>)[key];
    if (x == null) continue;
    const n = num(x);
    if (n == null || n < min || n > max) out.push(`${VITAL_LABEL[key]} must be ${min}–${max}`);
  }
  const s = num(v.systolic);
  const d = num(v.diastolic);
  if ((s == null) !== (d == null)) out.push('Enter both systolic and diastolic blood pressure');
  if (s != null && d != null && d >= s) out.push('Diastolic must be lower than systolic');
  if (v.recheck) {
    const rs = num(v.recheck.systolic);
    const rd = num(v.recheck.diastolic);
    if (rs == null || rd == null || rs < 40 || rs > 300 || rd < 20 || rd > 250 || rd >= rs) out.push('Recheck blood pressure is not valid');
  }
  return out;
}

export const VITAL_LABEL: Record<VitalKey, string> = {
  systolic: 'Systolic BP',
  diastolic: 'Diastolic BP',
  heartRate: 'Heart rate',
  respRate: 'Respiratory rate',
  temperatureF: 'Temperature',
  spO2: 'SpO2',
  heightIn: 'Height',
  weightLbs: 'Weight',
  pain: 'Pain',
};

/** BMI from pounds and inches (703 formula), one decimal; null when either is missing. */
export function bmiFromImperial(weightLbs: number | null | undefined, heightIn: number | null | undefined): number | null {
  const w = num(weightLbs);
  const h = num(heightIn);
  if (w == null || h == null || w <= 0 || h <= 0) return null;
  return Math.round(((w / (h * h)) * 703) * 10) / 10;
}

export const BP_FLAG_SYSTOLIC = 140;
export const BP_FLAG_DIASTOLIC = 90;
export const BP_RECHECK_WAIT_MINUTES = 5;
export const SPO2_FLAG_BELOW = 92;
export const TEMP_FLAG_AT_OR_ABOVE = 100.4;
export const HR_FLAG_ABOVE = 100;
export const HR_FLAG_BELOW = 50;

export type VitalFlagKey = 'bp_elevated' | 'spo2_low' | 'temp_elevated' | 'hr_high' | 'hr_low' | 'phq9_item9';

/** A flag only: the action is always "Notify provider" (no interpretation). */
export type VitalFlag = { key: VitalFlagKey; label: string; value: string; action: 'Notify provider' };

export function bpElevated(s: number | null | undefined, d: number | null | undefined): boolean {
  const ss = num(s);
  const dd = num(d);
  return (ss != null && ss >= BP_FLAG_SYSTOLIC) || (dd != null && dd >= BP_FLAG_DIASTOLIC);
}

/** Flags from the entered values. BP uses the recheck when one was recorded. */
export function vitalFlags(v: RoomingVitals): VitalFlag[] {
  const out: VitalFlag[] = [];
  const flag = (key: VitalFlagKey, label: string, value: string) => out.push({ key, label, value, action: 'Notify provider' });
  const rs = num(v.recheck?.systolic);
  const rd = num(v.recheck?.diastolic);
  const hasRecheck = rs != null && rd != null;
  const s = hasRecheck ? rs : num(v.systolic);
  const d = hasRecheck ? rd : num(v.diastolic);
  if (bpElevated(s, d)) {
    flag('bp_elevated', `BP at or above ${BP_FLAG_SYSTOLIC}/${BP_FLAG_DIASTOLIC}${hasRecheck ? ' on recheck' : ''}`, `${s ?? '?'}/${d ?? '?'} mmHg`);
  }
  const spo2 = num(v.spO2);
  if (spo2 != null && spo2 < SPO2_FLAG_BELOW) flag('spo2_low', `SpO2 below ${SPO2_FLAG_BELOW}%`, `${spo2}%`);
  const t = num(v.temperatureF);
  if (t != null && t >= TEMP_FLAG_AT_OR_ABOVE) flag('temp_elevated', `Temperature ${TEMP_FLAG_AT_OR_ABOVE} °F or higher`, `${t} °F`);
  const hr = num(v.heartRate);
  if (hr != null && hr > HR_FLAG_ABOVE) flag('hr_high', `Heart rate above ${HR_FLAG_ABOVE}`, `${hr}/min`);
  if (hr != null && hr < HR_FLAG_BELOW) flag('hr_low', `Heart rate below ${HR_FLAG_BELOW}`, `${hr}/min`);
  return out;
}

/** MA prompt on a positive rooming safety screen (fixed text: no score, no interpretation). */
export const ROOMING_SAFETY_PROMPT = 'Positive safety screen — notify the provider now; if imminent risk, follow the crisis protocol / 988';

/** PHQ-9 item 9 (thoughts of being better off dead / self-harm) above 0: notify the provider now. */
export function screeningSafetyFlags(s: { phq9?: { item9?: number | null; items?: number[] } | null } | null | undefined): VitalFlag[] {
  const item9 = num(s?.phq9?.item9 ?? s?.phq9?.items?.[8] ?? null);
  if (item9 == null || item9 <= 0) return [];
  return [{ key: 'phq9_item9', label: 'PHQ-9 item 9 (thoughts of self-harm) answered above 0', value: `${item9}`, action: 'Notify provider' }];
}

export type BpRecheckState =
  | { state: 'not_needed' }
  | { state: 'wait'; secondsLeft: number }
  | { state: 'due' }
  | { state: 'recorded'; stillElevated: boolean };

/**
 * First BP at or above 140/90: prompt a recheck after 5 minutes and record it. Without the time of
 * the first reading the recheck is shown as due (never waits on a guessed time).
 */
export function bpRecheckState(v: RoomingVitals, now: Date): BpRecheckState {
  if (!bpElevated(v.systolic, v.diastolic)) return { state: 'not_needed' };
  const rs = num(v.recheck?.systolic);
  const rd = num(v.recheck?.diastolic);
  if (rs != null && rd != null) return { state: 'recorded', stillElevated: bpElevated(rs, rd) };
  const at = v.takenAt ? new Date(v.takenAt) : null;
  if (!at || Number.isNaN(at.getTime())) return { state: 'due' };
  const left = Math.ceil((at.getTime() + BP_RECHECK_WAIT_MINUTES * MIN_MS - now.getTime()) / 1000);
  return left > 0 ? { state: 'wait', secondsLeft: left } : { state: 'due' };
}

// ─── Screenings at rooming ──────────────────────────────────────────────────

export type ScreeningKey = 'depression' | 'tobacco' | 'alcohol' | 'falls' | 'sdoh';

export type ScreeningRule = {
  key: ScreeningKey;
  label: string;
  instrument: string;
  minAge: number;
  intervalDays: number;
  basis: string;
};

export const SCREENING_RULES: ScreeningRule[] = [
  { key: 'depression', label: 'Depression screen', instrument: 'PHQ-2, then PHQ-9 if positive', minAge: 12, intervalDays: 365, basis: 'USPSTF depression screening (adults; adolescents 12–18)' },
  { key: 'tobacco', label: 'Tobacco use', instrument: 'Tobacco use status', minAge: 12, intervalDays: 365, basis: 'USPSTF tobacco use screening and counseling' },
  { key: 'alcohol', label: 'Unhealthy alcohol use', instrument: 'AUDIT-C', minAge: 18, intervalDays: 365, basis: 'USPSTF unhealthy alcohol use screening (adults 18+)' },
  { key: 'falls', label: 'Falls risk', instrument: 'STEADI three key questions', minAge: 65, intervalDays: 365, basis: 'CDC STEADI / USPSTF falls prevention (65+)' },
  { key: 'sdoh', label: 'Social needs (SDOH)', instrument: 'SDOH screen', minAge: 0, intervalDays: 365, basis: 'CMS social drivers of health screening (yearly, practice policy)' },
];

export type ScreeningDue = {
  key: ScreeningKey;
  label: string;
  instrument: string;
  basis: string;
  due: boolean;
  reason: string;
  lastDate: string | null;
};

const ymd = (d: Date, tz?: string) => (tz ? toPracticeWallTime(d, tz).date : d.toISOString().slice(0, 10));
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY_MS);

/** Screenings by age and last date (null = none on file). Unknown age: age-limited screenings are not offered. */
export function screeningsDue(input: {
  ageYears: number | null;
  last: Partial<Record<ScreeningKey, Date | null>>;
  now: Date;
  timeZone?: string;
}): ScreeningDue[] {
  const out: ScreeningDue[] = [];
  for (const r of SCREENING_RULES) {
    if (r.minAge > 0 && (input.ageYears == null || input.ageYears < r.minAge)) continue;
    const last = input.last[r.key] ?? null;
    const base = { key: r.key, label: r.label, instrument: r.instrument, basis: r.basis, lastDate: last ? ymd(last, input.timeZone) : null };
    if (!last) {
      out.push({ ...base, due: true, reason: `${r.label}: none on file (yearly)` });
      continue;
    }
    const days = daysBetween(last, input.now);
    out.push(
      days >= r.intervalDays
        ? { ...base, due: true, reason: `last ${r.label.toLowerCase()} ${days} days ago on ${base.lastDate} (yearly)` }
        : { ...base, due: false, reason: `done ${base.lastDate}` }
    );
  }
  return out;
}

export const PHQ2_POSITIVE_AT = 3;
export const BH_HANDOFF_THRESHOLD = 10;

const clampItem = (v: unknown) => {
  const n = num(v);
  return n == null ? null : Math.max(0, Math.min(3, Math.round(n)));
};

/** Sum of 0–3 items; null when any item is missing (a partial form is not scored). */
export function phqTotal(items: (number | null | undefined)[], expected: number): number | null {
  if (items.length !== expected) return null;
  let total = 0;
  for (const i of items) {
    const v = clampItem(i);
    if (v == null) return null;
    total += v;
  }
  return total;
}

export function phq2Positive(total: number | null | undefined): boolean {
  return num(total) != null && (total as number) >= PHQ2_POSITIVE_AT;
}

/** AUDIT-C (3 items, 0–4 each): positive at 4+ (men) / 3+ (women); sex unknown uses 3. */
export function auditCPositive(total: number | null | undefined, sex: 'F' | 'M' | null): boolean {
  const t = num(total);
  if (t == null) return false;
  return t >= (sex === 'M' ? 4 : 3);
}

/** STEADI: any "yes" to fell in the past year / feels unsteady / worries about falling. */
export function fallsScreenPositive(a: { fell?: boolean | null; unsteady?: boolean | null; worried?: boolean | null }): boolean {
  return Boolean(a.fell || a.unsteady || a.worried);
}

export type ScoreOnFile = { score: number; date: string } | null;

/**
 * Warm handoff to the practice behavioral health team: PHQ-9 >= 10 or GAD-7 >= 10 from a primary
 * care screen. A suggestion with its reason; the provider decides.
 */
export function bhHandoffSuggestion(input: { phq9: ScoreOnFile; gad7: ScoreOnFile }): { suggested: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.phq9 && input.phq9.score >= BH_HANDOFF_THRESHOLD) reasons.push(`PHQ-9 ${input.phq9.score} on ${input.phq9.date} (${BH_HANDOFF_THRESHOLD} or more)`);
  if (input.gad7 && input.gad7.score >= BH_HANDOFF_THRESHOLD) reasons.push(`GAD-7 ${input.gad7.score} on ${input.gad7.date} (${BH_HANDOFF_THRESHOLD} or more)`);
  return { suggested: reasons.length > 0, reasons };
}

// ─── Care gaps (screening guidance) ─────────────────────────────────────────

export type CareGapKey =
  | 'colorectal'
  | 'breast'
  | 'cervical'
  | 'diabetes_a1c'
  | 'diabetes_eye'
  | 'diabetes_foot'
  | 'diabetes_kidney'
  | 'influenza'
  | 'pneumococcal'
  | 'tdap';

export type CareGapGroup = 'cancer_screening' | 'diabetes' | 'immunization';

export type CareGapDef = { key: CareGapKey; label: string; group: CareGapGroup; basis: string; window: string; kinds?: { value: string; label: string }[] };

export const CARE_GAPS: CareGapDef[] = [
  {
    key: 'colorectal',
    label: 'Colorectal cancer screening',
    group: 'cancer_screening',
    basis: 'USPSTF (A/B) / HEDIS COL',
    window: 'Ages 45–75',
    kinds: [
      { value: 'colonoscopy', label: 'Colonoscopy (10 years)' },
      { value: 'fit', label: 'FIT / gFOBT (1 year)' },
      { value: 'fit_dna', label: 'Stool DNA-FIT (3 years)' },
      { value: 'ct_colonography', label: 'CT colonography (5 years)' },
      { value: 'flex_sig', label: 'Flexible sigmoidoscopy (5 years)' },
    ],
  },
  { key: 'breast', label: 'Breast cancer screening (mammogram)', group: 'cancer_screening', basis: 'USPSTF 2024 (B) / HEDIS BCS', window: 'Women 40–74, every 2 years' },
  {
    key: 'cervical',
    label: 'Cervical cancer screening',
    group: 'cancer_screening',
    basis: 'USPSTF (A) / HEDIS CCS',
    window: 'Women 21–65',
    kinds: [
      { value: 'cytology', label: 'Cytology (3 years)' },
      { value: 'hpv', label: 'Primary hrHPV, age 30+ (5 years)' },
      { value: 'cotest', label: 'Cytology + hrHPV co-test, age 30+ (5 years)' },
    ],
  },
  { key: 'diabetes_a1c', label: 'Diabetes: A1c', group: 'diabetes', basis: 'ADA Standards of Care / HEDIS GSD', window: 'Diabetes on the problem list, at least every 6 months' },
  { key: 'diabetes_eye', label: 'Diabetes: retinal eye exam', group: 'diabetes', basis: 'ADA Standards of Care / HEDIS EED', window: 'Diabetes on the problem list, yearly' },
  { key: 'diabetes_foot', label: 'Diabetes: foot exam', group: 'diabetes', basis: 'ADA Standards of Care', window: 'Diabetes on the problem list, yearly' },
  { key: 'diabetes_kidney', label: 'Diabetes: urine albumin (uACR)', group: 'diabetes', basis: 'ADA Standards of Care / HEDIS KED', window: 'Diabetes on the problem list, yearly' },
  { key: 'influenza', label: 'Influenza vaccine', group: 'immunization', basis: 'ACIP', window: 'Every season (September–March)' },
  { key: 'pneumococcal', label: 'Pneumococcal vaccine', group: 'immunization', basis: 'ACIP (October 2024)', window: 'Age 50+' },
  { key: 'tdap', label: 'Tdap / Td booster', group: 'immunization', basis: 'ACIP', window: 'Adults, every 10 years' },
];

export const CARE_GAP_KEYS = CARE_GAPS.map((g) => g.key);
const GAP_BY_KEY = new Map(CARE_GAPS.map((g) => [g.key, g]));

export function careGapDef(key: string): CareGapDef | null {
  return GAP_BY_KEY.get(key as CareGapKey) ?? null;
}

/** Interval in days for a completed test of the given kind (colorectal / cervical modality). */
export function careGapIntervalDays(key: CareGapKey, kind: string | null | undefined, ageYears: number | null): number | null {
  switch (key) {
    case 'colorectal':
      return kind === 'colonoscopy' ? 3650 : kind === 'fit_dna' ? 1095 : kind === 'ct_colonography' || kind === 'flex_sig' ? 1825 : 365;
    case 'breast':
      return 730;
    case 'cervical':
      return (kind === 'hpv' || kind === 'cotest') && (ageYears ?? 0) >= 30 ? 1825 : 1095;
    case 'diabetes_a1c':
      return 182;
    case 'diabetes_eye':
    case 'diabetes_foot':
    case 'diabetes_kidney':
      return 365;
    case 'tdap':
      return 3650;
    default:
      return null;
  }
}

/** Influenza season on the practice calendar: September through March; doses from August 1 count. */
export function influenzaSeason(today: string): { inSeason: boolean; seasonStart: string } {
  const [y, m] = today.split('-').map(Number);
  const startYear = m >= 8 ? y : y - 1;
  return { inSeason: m >= 9 || m <= 3, seasonStart: `${startYear}-08-01` };
}

export type CareGapHistory = { date: Date; kind?: string | null; source: string };

export type CareGapStatus = 'due' | 'overdue' | 'met' | 'not_applicable';

export type CareGap = {
  key: CareGapKey;
  label: string;
  group: CareGapGroup;
  basis: string;
  window: string;
  status: CareGapStatus;
  reason: string;
  lastDate: string | null;
  nextDue: string | null;
  /** MA-recorded patient report: shown for the provider to verify; never closes the gap */
  patientReported: { date: string | null; source: string } | null;
};

export type CareGapInput = {
  ageYears: number | null;
  /** sex at birth (F / M); null = not recorded: sex-specific gaps are not evaluated */
  sex: 'F' | 'M' | null;
  /** diabetes (E10 / E11 / E13) on the active problem list */
  diabetes: boolean;
  now: Date;
  timeZone?: string;
  /** provider-verified last completion per gap (labs on file, provider "done elsewhere" / completed) */
  last: Partial<Record<CareGapKey, CareGapHistory | null>>;
  /** provider "not applicable" with reason (still in force) */
  notApplicable: Partial<Record<CareGapKey, string>>;
  patientReported?: Partial<Record<CareGapKey, { date: Date | null; source: string }>>;
  /** practice setting: gaps turned off */
  disabled?: Iterable<string>;
};

/** Eligibility by age / sex / diagnosis (no dates). */
export function careGapEligible(key: CareGapKey, input: Pick<CareGapInput, 'ageYears' | 'sex' | 'diabetes'> & { today?: string }): boolean {
  const age = input.ageYears;
  if (age == null) return false;
  switch (key) {
    case 'colorectal':
      return age >= 45 && age <= 75;
    case 'breast':
      return input.sex === 'F' && age >= 40 && age <= 74;
    case 'cervical':
      return input.sex === 'F' && age >= 21 && age <= 65;
    case 'diabetes_a1c':
    case 'diabetes_eye':
    case 'diabetes_foot':
    case 'diabetes_kidney':
      return input.diabetes && age >= 18 && age <= 75;
    case 'influenza':
      return input.today ? influenzaSeason(input.today).inSeason : true;
    case 'pneumococcal':
      // ACIP October 2024: pneumococcal conjugate vaccine for all adults 50 and older
      return age >= 50;
    case 'tdap':
      return age >= 19;
    default:
      return false;
  }
}

const addDaysYmd = (d: Date, days: number, tz?: string) => ymd(new Date(d.getTime() + days * DAY_MS), tz);

/** Care gaps for one patient: eligible gaps only, each with its status and reason. */
export function computeCareGaps(input: CareGapInput): CareGap[] {
  const tz = input.timeZone;
  const today = ymd(input.now, tz);
  const disabled = new Set(input.disabled ?? []);
  const out: CareGap[] = [];
  for (const def of CARE_GAPS) {
    if (disabled.has(def.key)) continue;
    if (!careGapEligible(def.key, { ...input, today })) continue;
    const reported = input.patientReported?.[def.key] ?? null;
    const base = {
      key: def.key,
      label: def.label,
      group: def.group,
      basis: def.basis,
      window: def.window,
      patientReported: reported ? { date: reported.date ? ymd(reported.date, tz) : null, source: reported.source } : null,
    };
    const na = input.notApplicable[def.key];
    if (na) {
      out.push({ ...base, status: 'not_applicable', reason: `not applicable: ${na}`, lastDate: null, nextDue: null });
      continue;
    }
    const last = input.last[def.key] ?? null;
    const lastDate = last ? ymd(last.date, tz) : null;

    if (def.key === 'influenza') {
      const season = influenzaSeason(today);
      if (lastDate && lastDate >= season.seasonStart) {
        out.push({ ...base, status: 'met', reason: `given ${lastDate} this season (${last!.source})`, lastDate, nextDue: null });
      } else {
        out.push({ ...base, status: 'due', reason: lastDate ? `last dose ${lastDate}; none this season (since ${season.seasonStart})` : 'no dose on file this season', lastDate, nextDue: null });
      }
      continue;
    }
    if (def.key === 'pneumococcal') {
      out.push(
        lastDate
          ? { ...base, status: 'met', reason: `dose on file ${lastDate} (${last!.source}); confirm the series is complete per ACIP`, lastDate, nextDue: null }
          : { ...base, status: 'due', reason: 'age 50+; no pneumococcal vaccine on file', lastDate: null, nextDue: null }
      );
      continue;
    }
    const interval = careGapIntervalDays(def.key, last?.kind ?? null, input.ageYears);
    if (!last || interval == null) {
      out.push({ ...base, status: 'due', reason: `${def.window.toLowerCase()}; none on file`, lastDate: null, nextDue: null });
      continue;
    }
    const nextDue = addDaysYmd(last.date, interval, tz);
    if (nextDue > today) {
      out.push({ ...base, status: 'met', reason: `done ${lastDate} (${last.source}); next due ${nextDue}`, lastDate, nextDue });
    } else {
      const late = daysBetween(new Date(`${nextDue}T12:00:00Z`), new Date(`${today}T12:00:00Z`));
      out.push({
        ...base,
        status: late > 90 ? 'overdue' : 'due',
        reason: `last ${lastDate} (${last.source}); due ${nextDue}`,
        lastDate,
        nextDue,
      });
    }
  }
  return out;
}

export function openCareGaps(gaps: CareGap[]): CareGap[] {
  return gaps.filter((g) => g.status === 'due' || g.status === 'overdue');
}

/** Provider actions that address a gap at a visit; MA actions record a report or outreach only. */
export const PROVIDER_GAP_ACTIONS = ['completed', 'ordered', 'done_elsewhere', 'refused', 'not_applicable', 'reopened'] as const;
export const MA_GAP_ACTIONS = ['reported_elsewhere', 'outreach'] as const;
export type GapAction = (typeof PROVIDER_GAP_ACTIONS)[number] | (typeof MA_GAP_ACTIONS)[number];

export const GAP_ACTION_LABEL: Record<GapAction, string> = {
  completed: 'Done at this visit',
  ordered: 'Ordered',
  done_elsewhere: 'Done elsewhere (verified)',
  refused: 'Patient declined',
  not_applicable: 'Not applicable',
  reopened: 'Reopened',
  reported_elsewhere: 'Patient reports done elsewhere',
  outreach: 'Outreach',
};

/** Which actions a role may record (MA: patient-reported and outreach only; never closes a gap). */
export function allowedGapActions(role: string | null | undefined): GapAction[] {
  if (isPrimaryCareProvider(role)) return [...PROVIDER_GAP_ACTIONS, 'outreach'];
  if (isMedicalAssistant(role)) return [...MA_GAP_ACTIONS];
  return [];
}

export type GapActionInput = {
  action: GapAction;
  performedOn?: string | null;
  source?: string | null;
  reason?: string | null;
  kind?: string | null;
  method?: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Validation for one recorded action; null = valid. */
export function gapActionError(key: CareGapKey, a: GapActionInput, today: string): string | null {
  const needsDate = a.action === 'done_elsewhere' || a.action === 'reported_elsewhere';
  if (needsDate) {
    if (!a.performedOn || !YMD.test(a.performedOn)) return 'Enter the date it was done (YYYY-MM-DD)';
    if (a.performedOn > today) return 'The date cannot be in the future';
    if (!a.source?.trim()) return 'Enter where it was done (the source)';
  }
  if (a.action === 'not_applicable' && !a.reason?.trim()) return 'Enter why it is not applicable';
  if (a.action === 'outreach' && !['phone', 'portal', 'letter'].includes(String(a.method ?? ''))) return 'Choose how the patient was contacted';
  const def = careGapDef(key);
  if (def?.kinds && (a.action === 'done_elsewhere' || a.action === 'completed') && !def.kinds.some((k) => k.value === a.kind)) {
    return `Choose the test type for ${def.label.toLowerCase()}`;
  }
  return null;
}

/** Gaps open today that have no provider action recorded for this visit. */
export function unaddressedGaps(open: CareGap[], actionsThisVisit: { gapKey: string; action: string }[]): CareGap[] {
  const addressed = new Set(
    actionsThisVisit.filter((a) => (PROVIDER_GAP_ACTIONS as readonly string[]).includes(a.action) && a.action !== 'reopened').map((a) => a.gapKey)
  );
  return open.filter((g) => !addressed.has(g.key));
}

/** Diabetes on a problem list (ICD-10 E10 / E11 / E13; HEDIS diabetes value set, outpatient codes). */
export function hasDiabetesCode(codes: (string | null | undefined)[]): boolean {
  return codes.some((c) => /^E1[013](\.|$|\d)/i.test(String(c ?? '').trim()));
}

/** Lab result text that satisfies a diabetes lab gap. */
export function labGapFor(text: string): CareGapKey | null {
  if (/\ba1c\b|hba1c|hemoglobin a1c|glycated h/i.test(text)) return 'diabetes_a1c';
  if (/albumin\s*\/?\s*creat|microalb|\buacr\b|\bacr\b/i.test(text)) return 'diabetes_kidney';
  return null;
}

/** Outreach template (portal message / phone script). Names the screening types only. */
export function outreachTemplate(input: { gaps: string[]; practiceName: string | null; practicePhone: string | null; method: 'phone' | 'portal' | 'letter' }): string {
  const who = input.practiceName || 'your primary care team';
  const list = input.gaps.join(', ');
  const call = input.practicePhone ? `call us at ${input.practicePhone}` : 'call the office';
  if (input.method === 'phone') {
    return `Hello, this is ${who} calling. Our records show you may be due for: ${list}. We would like to help you schedule it. If it was done somewhere else, please tell us the date and where so we can update your chart.`;
  }
  return `Hello from ${who}. Our records show you may be due for: ${list}. Please reply here or ${call} to schedule. If it was done somewhere else, reply with the date and where so we can update your chart.`;
}

// ─── E/M suggestions ────────────────────────────────────────────────────────

export type Mdm = 'straightforward' | 'low' | 'moderate' | 'high';
export type EmSuggestion = { code: string; label: string; reason: string };

const MDM_RANK: Record<Mdm, number> = { straightforward: 0, low: 1, moderate: 2, high: 3 };
const NEW_BY_LEVEL = ['99202', '99203', '99204', '99205'];
const EST_BY_LEVEL = ['99212', '99213', '99214', '99215'];
/** 2021+ office E/M total-time thresholds (minutes on the date of service) */
const NEW_TIME = [15, 30, 45, 60];
const EST_TIME = [10, 20, 30, 40];

/** Preventive medicine code by age band (99381–99387 new / 99391–99397 established). */
export function preventiveCode(ageYears: number, newPatient: boolean): string {
  const band = ageYears < 1 ? 1 : ageYears <= 4 ? 2 : ageYears <= 11 ? 3 : ageYears <= 17 ? 4 : ageYears <= 39 ? 5 : ageYears <= 64 ? 6 : 7;
  return `${newPatient ? '9938' : '9939'}${band}`;
}

const AGE_BAND_LABEL = (age: number) =>
  age < 1 ? 'under 1 year' : age <= 4 ? '1–4 years' : age <= 11 ? '5–11 years' : age <= 17 ? '12–17 years' : age <= 39 ? '18–39 years' : age <= 64 ? '40–64 years' : '65 years and over';

/** Problem-oriented office visit level from MDM and / or total time (whichever supports the higher level). */
export function officeEmCode(input: { newPatient: boolean; mdm?: Mdm | null; totalMinutes?: number | null }): EmSuggestion | null {
  const codes = input.newPatient ? NEW_BY_LEVEL : EST_BY_LEVEL;
  const times = input.newPatient ? NEW_TIME : EST_TIME;
  const byMdm = input.mdm ? MDM_RANK[input.mdm] : -1;
  let byTime = -1;
  const minutes = num(input.totalMinutes);
  if (minutes != null) for (let i = 0; i < times.length; i++) if (minutes >= times[i]) byTime = i;
  const level = Math.max(byMdm, byTime);
  if (level < 0) return null;
  const why = level === byTime && byTime > byMdm ? `total time ${minutes} min (${times[level]}+ min)` : `${input.mdm} medical decision making`;
  return { code: codes[level], label: `${input.newPatient ? 'New' : 'Established'} patient office visit`, reason: `2021 office E/M guidelines: ${why}` };
}

export type EmInput = {
  preventive: boolean;
  newPatient: boolean;
  ageYears: number | null;
  medicare: boolean;
  /** last AWV (G0438 / G0439) on file in Altrixs */
  lastAwv: Date | null;
  now: Date;
  mdm?: Mdm | null;
  totalMinutes?: number | null;
};

/** Suggestions only (the provider selects the code). */
export function suggestEmCodes(input: EmInput): { suggestions: EmSuggestion[]; notes: string[] } {
  const suggestions: EmSuggestion[] = [];
  const notes: string[] = [];
  if (input.preventive) {
    if (input.medicare) {
      if (!input.lastAwv) {
        suggestions.push({ code: 'G0438', label: 'Medicare Annual Wellness Visit, initial', reason: 'Medicare payer; no AWV on file in Altrixs (confirm in the Medicare eligibility response: once per lifetime)' });
      } else {
        const months = (input.now.getTime() - input.lastAwv.getTime()) / (DAY_MS * 30.44);
        if (months >= 11) {
          suggestions.push({ code: 'G0439', label: 'Medicare Annual Wellness Visit, subsequent', reason: `Medicare payer; last AWV on file ${ymd(input.lastAwv)} (at least 11 full months ago)` });
        } else {
          notes.push(`Last AWV on file ${ymd(input.lastAwv)}: fewer than 11 full months have passed, so an AWV is not payable yet.`);
        }
      }
      notes.push('Medicare does not cover routine preventive physicals (99381–99397); the AWV is the Medicare preventive visit. The Welcome to Medicare visit (G0402) applies only in the first 12 months of Part B.');
    } else if (input.ageYears != null) {
      const code = preventiveCode(input.ageYears, input.newPatient);
      suggestions.push({
        code,
        label: `Preventive medicine visit, ${input.newPatient ? 'new' : 'established'} patient`,
        reason: `preventive visit; age ${input.ageYears} (${AGE_BAND_LABEL(input.ageYears)})`,
      });
    } else {
      notes.push('Date of birth not on file: the preventive code depends on age.');
    }
    const problem = officeEmCode(input);
    if (problem) {
      notes.push(`A significant, separately documented problem-oriented service can be billed in addition with modifier 25: ${problem.code} (${problem.reason}).`);
    }
    return { suggestions, notes };
  }
  const office = officeEmCode(input);
  if (office) suggestions.push(office);
  else notes.push('Select the medical decision making level or enter total time to see a suggestion.');
  return { suggestions, notes };
}

/** Visit types the medical visit editor treats as preventive. */
export function isPreventiveVisitType(visitType: string | null | undefined): boolean {
  return /annual|physical|wellness|well-woman|well woman|preventive|awv/i.test(String(visitType ?? ''));
}

/** Medicare (traditional or Medicare Advantage) from the payer text on file. */
export function isMedicarePayer(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => /medicare/i.test(String(t ?? '')));
}

// ─── Closed-loop tracking (results, orders, referrals) ─────────────────────

export const DEFAULT_RESULTS_NOTIFY_DAYS = 7;
/** Practice policy defaults (owner to confirm): a lab with no result after this many days is flagged */
export const LAB_RESULT_EXPECTED_DAYS = 14;
/** A referral with no consult report after this many days is flagged */
export const REFERRAL_REPORT_EXPECTED_DAYS = 30;

export type ResultNotifyState = { state: 'notified' | 'pending' | 'overdue'; deadline: string; daysWaiting: number; via: string | null };

/** Patient notification of a result within N days of the result (practice policy). Portal release counts. */
export function resultNotifyState(input: {
  resultedAt: Date;
  notifiedAt: Date | null;
  notifiedMethod?: string | null;
  releasedAt: Date | null;
  notifyDays: number;
  now: Date;
  timeZone?: string;
}): ResultNotifyState {
  const deadline = new Date(input.resultedAt.getTime() + input.notifyDays * DAY_MS);
  const daysWaiting = Math.max(0, daysBetween(input.resultedAt, input.now));
  const when = input.notifiedAt ?? input.releasedAt;
  if (when) return { state: 'notified', deadline: ymd(deadline, input.timeZone), daysWaiting, via: input.notifiedAt ? input.notifiedMethod ?? 'recorded' : 'portal' };
  return { state: input.now.getTime() > deadline.getTime() ? 'overdue' : 'pending', deadline: ymd(deadline, input.timeZone), daysWaiting, via: null };
}

export function isAbnormalFlag(flag: string | null | undefined): boolean {
  const f = String(flag ?? '').trim().toUpperCase();
  return Boolean(f) && f !== 'N';
}

/** Results to review: critical first, then abnormal, then longest waiting. */
export function sortResultsForReview<T extends { critical: boolean; abnormal: boolean; daysWaiting: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.critical) - Number(a.critical) || Number(b.abnormal) - Number(a.abnormal) || b.daysWaiting - a.daysWaiting);
}

/** Days past the expected time (null = not overdue yet). */
export function daysOverdue(start: Date, expectedDays: number, now: Date): number | null {
  const late = daysBetween(new Date(start.getTime() + expectedDays * DAY_MS), now);
  return late > 0 ? late : null;
}

export const REFERRAL_STATUSES = ['sent', 'scheduled', 'seen', 'report_received', 'cancelled'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  sent: 'Sent',
  scheduled: 'Scheduled',
  seen: 'Seen',
  report_received: 'Report received',
  cancelled: 'Cancelled',
};
/** Internal BH warm handoff: no consult report comes back to primary care (no BH content shared). */
export const BH_HANDOFF_STATUSES = ['sent', 'scheduled', 'seen', 'cancelled'] as const;

/**
 * Warm handoff status from the schedule (no BH content): a behavioral health appointment booked
 * after the handoff was sent makes it "scheduled"; a completed one makes it "seen".
 */
export function bhHandoffDerivedStatus(
  stored: string,
  sentAt: Date,
  bhAppointments: { startsAt: Date; status: string; createdAt?: Date | null }[]
): { status: string; date: Date | null } {
  if (stored === 'cancelled') return { status: 'cancelled', date: null };
  const after = bhAppointments.filter((a) => (a.createdAt ?? a.startsAt).getTime() >= sentAt.getTime() || a.startsAt.getTime() >= sentAt.getTime());
  const seen = after.filter((a) => a.status === 'COMPLETED').sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (seen) return { status: 'seen', date: seen.startsAt };
  const booked = after
    .filter((a) => ['SCHEDULED', 'CHECKED_IN', 'IN_SESSION'].includes(a.status))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (booked) return { status: 'scheduled', date: booked.startsAt };
  return { status: stored === 'scheduled' || stored === 'seen' ? stored : 'sent', date: null };
}

export function referralNextStatuses(kind: string, status: string): string[] {
  const order = kind === 'internal_bh' ? BH_HANDOFF_STATUSES : REFERRAL_STATUSES;
  const i = (order as readonly string[]).indexOf(status);
  if (i < 0 || status === 'cancelled' || status === 'report_received') return [];
  const forward = (order as readonly string[]).slice(i + 1).filter((s) => s !== 'cancelled');
  return [...forward, 'cancelled'];
}

// ─── Schedule chips ─────────────────────────────────────────────────────────

export type RoomingChip = { status: 'draft' | 'ready' | 'in_room'; label: string; minutes: number | null };

/** "Ready · 12 min waiting" / "In room · 5 min" for the provider schedule. */
export function roomingChip(r: { status: string; roomedAt: Date | string | null; inRoomAt: Date | string | null } | null, now: Date): RoomingChip | null {
  if (!r) return null;
  const mins = (t: Date | string | null) => (t ? Math.max(0, Math.floor((now.getTime() - new Date(t).getTime()) / MIN_MS)) : null);
  if (r.status === 'in_room') {
    const m = mins(r.inRoomAt);
    return { status: 'in_room', label: m != null ? `With provider · ${m} min` : 'With provider', minutes: m };
  }
  if (r.status === 'ready') {
    const m = mins(r.roomedAt);
    return { status: 'ready', label: m != null ? `Ready for provider · ${m} min waiting` : 'Ready for provider', minutes: m };
  }
  return { status: 'draft', label: 'Rooming in progress', minutes: null };
}

// ─── POC standing orders (practice setting; MA use only after Medical Director approval) ─────

/**
 * Owner decision 2026-10-21: a DRAFT list of six point-of-care tests is offered for approval. A test
 * is usable by medical assistants only after a verified Medical Director approves it in the primary
 * care settings card (approver id / name, date and STANDING_ORDER_ATTESTATION are recorded). Any
 * change to an approved order's content sends it back to draft. Retired orders stay on the list
 * (history) and are never usable. The server accepts POC results only for approved orders.
 */
export type StandingOrderStatus = 'draft' | 'approved' | 'retired';

export type StandingOrderApproval = { approverId: string; approverName: string; approvedAt: string; attestation: string };
export type StandingOrderRetirement = { byId: string; byName: string; at: string };

export type PocStandingOrder = {
  key: string;
  name: string;
  /** who / when, as written in the signed standing order (e.g. "patients with diabetes at each visit") */
  criteria: string;
  resultType: 'numeric' | 'pos_neg' | 'text';
  unit?: string | null;
  cpt?: string | null;
  /** missing on rows saved before 2026-10-21: read as draft (not usable until approved) */
  status?: StandingOrderStatus;
  approval?: StandingOrderApproval | null;
  retired?: StandingOrderRetirement | null;
};

export const STANDING_ORDER_ATTESTATION = 'I authorize medical assistants to perform this test under this standing order';

/** The draft list (CPT codes and descriptions match src/lib/constants/cpt.ts, category Lab). Criteria are written by the approver. */
export const DRAFT_POC_STANDING_ORDERS: readonly PocStandingOrder[] = [
  { key: 'glucose-fingerstick', name: 'Fingerstick blood glucose', criteria: '', resultType: 'numeric', unit: 'mg/dL', cpt: '82962', status: 'draft', approval: null, retired: null },
  { key: 'urine-dipstick', name: 'Urine dipstick (non-automated, without microscopy)', criteria: '', resultType: 'text', unit: null, cpt: '81002', status: 'draft', approval: null, retired: null },
  { key: 'rapid-strep', name: 'Rapid strep (group A)', criteria: '', resultType: 'pos_neg', unit: null, cpt: '87880', status: 'draft', approval: null, retired: null },
  { key: 'urine-pregnancy', name: 'Urine pregnancy test', criteria: '', resultType: 'pos_neg', unit: null, cpt: '81025', status: 'draft', approval: null, retired: null },
  { key: 'covid-antigen', name: 'Rapid COVID-19 antigen', criteria: '', resultType: 'pos_neg', unit: null, cpt: '87811', status: 'draft', approval: null, retired: null },
  { key: 'influenza-rapid', name: 'Rapid influenza', criteria: '', resultType: 'pos_neg', unit: null, cpt: '87804', status: 'draft', approval: null, retired: null },
];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function parseApproval(v: unknown): StandingOrderApproval | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const a = { approverId: str(o.approverId), approverName: str(o.approverName), approvedAt: str(o.approvedAt), attestation: str(o.attestation) };
  return a.approverId && a.approvedAt && a.attestation === STANDING_ORDER_ATTESTATION ? a : null;
}

function parseRetired(v: unknown): StandingOrderRetirement | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const r = { byId: str(o.byId), byName: str(o.byName), at: str(o.at) };
  return r.byId && r.at ? r : null;
}

export function parsePocStandingOrders(raw: unknown): PocStandingOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: PocStandingOrder[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!key || !name) continue;
    const rt = o.resultType === 'numeric' || o.resultType === 'pos_neg' || o.resultType === 'text' ? o.resultType : 'text';
    const approval = parseApproval(o.approval);
    const retired = parseRetired(o.retired);
    // Approved only with a valid approval record; anything else (incl. rows saved before approvals existed) is a draft
    const status: StandingOrderStatus = o.status === 'retired' && retired ? 'retired' : o.status === 'approved' && approval ? 'approved' : 'draft';
    out.push({
      key,
      name,
      criteria: typeof o.criteria === 'string' ? o.criteria.trim() : '',
      resultType: rt,
      unit: typeof o.unit === 'string' && o.unit.trim() ? o.unit.trim() : null,
      cpt: typeof o.cpt === 'string' && o.cpt.trim() ? o.cpt.trim() : null,
      status,
      approval: status === 'draft' ? null : approval,
      retired: status === 'retired' ? retired : null,
    });
  }
  return out;
}

/** Saved list plus any draft-list test not on it yet (a retired test stays retired; nothing is removed). */
export function withDraftStandingOrders(saved: readonly PocStandingOrder[]): PocStandingOrder[] {
  const have = new Set(saved.map((o) => o.key));
  return [...saved, ...DRAFT_POC_STANDING_ORDERS.filter((d) => !have.has(d.key)).map((d) => ({ ...d }))];
}

/** Only approved orders are selectable by MAs and accepted by the rooming API. */
export function usableStandingOrders(list: readonly PocStandingOrder[]): PocStandingOrder[] {
  return list.filter((o) => o.status === 'approved' && Boolean(o.approval));
}

const sameContent = (a: PocStandingOrder, b: PocStandingOrder) =>
  a.name === b.name && a.criteria === b.criteria && a.resultType === b.resultType && (a.unit ?? null) === (b.unit ?? null) && (a.cpt ?? null) === (b.cpt ?? null);

/**
 * Leadership save (PUT): content edits only. Status / approval / retirement never come from the
 * request: they are kept from the stored row, except that an approved order whose content changed
 * goes back to draft (re-approval needed). Approved and retired orders cannot be deleted here
 * (retire them instead); drafts can.
 */
export function mergeStandingOrderEdits(
  stored: readonly PocStandingOrder[],
  incoming: readonly PocStandingOrder[]
): { list: PocStandingOrder[]; reverted: string[] } {
  const prev = new Map(stored.map((o) => [o.key, o]));
  const reverted: string[] = [];
  const list: PocStandingOrder[] = incoming.map((o) => {
    const old = prev.get(o.key);
    const content: PocStandingOrder = { key: o.key, name: o.name, criteria: o.criteria ?? '', resultType: o.resultType, unit: o.unit || null, cpt: o.cpt || null };
    if (!old || !old.status || old.status === 'draft') return { ...content, status: 'draft', approval: null, retired: null };
    if (old.status === 'retired') return { ...old };
    if (sameContent(old, content)) return { ...old };
    reverted.push(o.key);
    return { ...content, status: 'draft', approval: null, retired: null };
  });
  const kept = new Set(list.map((o) => o.key));
  for (const old of stored) if (!kept.has(old.key) && (old.status === 'approved' || old.status === 'retired')) list.push({ ...old });
  return { list, reverted };
}

export type StandingOrderActor = { role: string | null | undefined; isMedicalDirector: boolean; roleEligible: boolean };

/**
 * Who may approve a standing order: a Medical Director (User.isMedicalDirector, read from the
 * database) whose role may hold the designation (src/lib/auth/medicalDirector.ts). Leadership
 * without the flag cannot; a medical assistant never can.
 */
export function canApproveStandingOrders(input: StandingOrderActor): boolean {
  return Boolean(input.isMedicalDirector && input.roleEligible);
}

/** Retire: a Medical Director or practice leadership (retiring only removes MA authority). */
export function canRetireStandingOrders(input: StandingOrderActor): boolean {
  return canApproveStandingOrders(input) || canManagePrimaryCareSettings(input.role);
}

export type StandingOrderActionResult = { ok: true; list: PocStandingOrder[]; order: PocStandingOrder } | { ok: false; error: string };

/** Approve one draft. The approver must attest with the exact text; criteria (who / when) are required. */
export function approveStandingOrder(
  list: readonly PocStandingOrder[],
  input: { key: string; approverId: string; approverName: string; attestation: string; criteria?: string | null; now: Date }
): StandingOrderActionResult {
  const i = list.findIndex((o) => o.key === input.key);
  if (i < 0) return { ok: false, error: 'That test is not on the standing-order list' };
  const cur = list[i];
  if (cur.status === 'approved') return { ok: false, error: 'This standing order is already approved' };
  if (cur.status === 'retired') return { ok: false, error: 'This standing order was retired; add it again as a new draft' };
  if (String(input.attestation ?? '').trim() !== STANDING_ORDER_ATTESTATION) return { ok: false, error: `Confirm: "${STANDING_ORDER_ATTESTATION}"` };
  const criteria = String(input.criteria ?? cur.criteria ?? '').trim();
  if (criteria.length < 3) return { ok: false, error: 'Write who / when the standing order covers before approving' };
  if (!input.approverId || !String(input.approverName ?? '').trim()) return { ok: false, error: 'Approver not identified' };
  const order: PocStandingOrder = {
    ...cur,
    criteria,
    status: 'approved',
    approval: { approverId: input.approverId, approverName: input.approverName.trim(), approvedAt: input.now.toISOString(), attestation: STANDING_ORDER_ATTESTATION },
    retired: null,
  };
  return { ok: true, list: list.map((o, j) => (j === i ? order : o)), order };
}

/** Retire one order (draft or approved): it stays on the list as history and is never usable. */
export function retireStandingOrder(
  list: readonly PocStandingOrder[],
  input: { key: string; byId: string; byName: string; now: Date }
): StandingOrderActionResult {
  const i = list.findIndex((o) => o.key === input.key);
  if (i < 0) return { ok: false, error: 'That test is not on the standing-order list' };
  if (list[i].status === 'retired') return { ok: false, error: 'This standing order is already retired' };
  const order: PocStandingOrder = {
    ...list[i],
    status: 'retired',
    retired: { byId: input.byId, byName: String(input.byName ?? '').trim() || 'Staff', at: input.now.toISOString() },
  };
  return { ok: true, list: list.map((o, j) => (j === i ? order : o)), order };
}
