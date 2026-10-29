/**
 * Identifying Information (Oct 25) — prefill rules.
 *
 * Precedence (first non-blank wins, never overwriting what the clinician already has):
 *   saved draft → chart → chart vitals → last signed non-Part 2 evaluation → visit (appointment)
 *   → AI Scribe suggestion (only once reviewed by the clinician, fills blanks only).
 * Blank fields stay blank — nothing is defaulted to "unknown".
 */
import { formatAge, fieldLabel, isBlank } from './fields';
import type {
  ChartDemographicsChanges,
  IdentifyingChartData,
  IdentifyingFieldKey,
  IdentifyingPriorEvaluation,
  IdentifyingSource,
  IdentifyingSources,
  IdentifyingState,
  IdentifyingValues,
  IdentifyingVisit,
  IdentifyingVitals,
  VisitModality,
} from './types';

/** Demographics that carry over from a prior evaluation (visit-specific fields never do). */
export const PRIOR_EVALUATION_FIELDS: readonly IdentifyingFieldKey[] = [
  'title',
  'sexAssignedAtBirth',
  'genderIdentity',
  'pronouns',
  'race',
  'ethnicity',
  'maritalStatus',
  'legalGuardian',
  'preferredLanguage',
  'interpreterNeeded',
];

/** Chart columns that "Update chart demographics" may write. */
export const CHART_WRITABLE_FIELDS = ['title', 'genderIdentity'] as const satisfies readonly IdentifyingFieldKey[];

type Layer = { source: IdentifyingSource; values: IdentifyingValues };

function trimmed(v: string | null | undefined): string | undefined {
  return isBlank(v) ? undefined : v!.trim();
}

function formatNumber(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

export function formatWeightLbs(weightLbs: number | null | undefined): string | undefined {
  if (weightLbs == null || !Number.isFinite(weightLbs) || weightLbs <= 0) return undefined;
  return `${formatNumber(weightLbs, 1)} lb`;
}

export function formatHeightInches(heightInches: number | null | undefined): string | undefined {
  if (heightInches == null || !Number.isFinite(heightInches) || heightInches <= 0) return undefined;
  const total = Math.round(heightInches * 2) / 2;
  const feet = Math.floor(total / 12);
  const inches = total - feet * 12;
  return `${feet} ft ${formatNumber(inches, 1)} in`;
}

export function formatBmi(bmi: number | null | undefined): string | undefined {
  if (bmi == null || !Number.isFinite(bmi) || bmi <= 0) return undefined;
  return bmi.toFixed(1);
}

export function chartLayer(chart: IdentifyingChartData | null | undefined, today: string): Layer {
  const values: IdentifyingValues = {};
  if (chart) {
    const title = trimmed(chart.namePrefix);
    if (title) values.title = title;
    const gender = trimmed(chart.gender);
    if (gender) values.genderIdentity = gender;
    const age = formatAge(chart.dateOfBirth, today);
    if (age) values.age = age;
  }
  return { source: 'chart', values };
}

export function vitalsLayer(vitals: IdentifyingVitals | null | undefined): Layer {
  const values: IdentifyingValues = {};
  if (vitals) {
    const weight = formatWeightLbs(vitals.weightLbs);
    const height = formatHeightInches(vitals.heightInches);
    const bmi = formatBmi(vitals.bmi);
    if (weight) values.weight = weight;
    if (height) values.height = height;
    if (bmi) values.bmi = bmi;
  }
  return { source: 'vitals', values };
}

export function priorEvaluationLayer(prior: IdentifyingPriorEvaluation | null | undefined): Layer {
  const values: IdentifyingValues = {};
  if (prior) {
    for (const key of PRIOR_EVALUATION_FIELDS) {
      const v = trimmed(prior.values[key]);
      if (v) values[key] = v;
    }
  }
  return { source: 'lastEvaluation', values };
}

/**
 * Modality the appointment was booked with. Only what the booking says: a virtual visit with no
 * known platform is left blank rather than guessed (video vs audio-only).
 */
export function modalityFromAppointment(appt: {
  isVirtual: boolean;
  telehealthPlatform: string | null;
}): VisitModality | null {
  if (!appt.isVirtual) return 'in_office';
  const platform = (appt.telehealthPlatform ?? '').trim().toLowerCase();
  if (platform === 'phone') return 'telehealth_audio';
  if (platform === 'zoom' || platform === 'meet' || platform === 'doxy') return 'telehealth_video';
  return null;
}

export function visitLayer(visit: IdentifyingVisit | null | undefined): Layer {
  const values: IdentifyingValues = {};
  if (visit?.modality) values.visitModality = visit.modality;
  return { source: 'appointment', values };
}

export type ResolvePrefillInput = {
  chart?: IdentifyingChartData | null;
  vitals?: IdentifyingVitals | null;
  prior?: IdentifyingPriorEvaluation | null;
  visit?: IdentifyingVisit | null;
  /** Values the clinician already saved on this note. Always wins. */
  draft?: IdentifyingValues | null;
  /** AI Scribe suggestions the clinician has reviewed and accepted. Fills blanks only. */
  scribe?: IdentifyingValues | null;
  /** Clinic date, YYYY-MM-DD. */
  today: string;
};

export function resolvePrefill(input: ResolvePrefillInput): IdentifyingState {
  const values: IdentifyingValues = {};
  const sources: IdentifyingSources = {};

  const apply = (layer: Layer, only?: (key: IdentifyingFieldKey) => boolean) => {
    for (const [rawKey, raw] of Object.entries(layer.values) as [IdentifyingFieldKey, string][]) {
      if (only && !only(rawKey)) continue;
      const v = trimmed(raw);
      if (!v || !isBlank(values[rawKey])) continue;
      values[rawKey] = v;
      sources[rawKey] = layer.source;
    }
  };

  // Age is derived from the chart date of birth, never saved or suggested.
  const notAge = (key: IdentifyingFieldKey) => key !== 'age';
  apply({ source: 'draft', values: input.draft ?? {} }, notAge);
  apply(chartLayer(input.chart, input.today));
  apply(vitalsLayer(input.vitals));
  apply(priorEvaluationLayer(input.prior));
  apply(visitLayer(input.visit));
  apply({ source: 'scribe', values: input.scribe ?? {} }, notAge);

  return { values, sources };
}

export type ChangedSinceLastEvaluation = {
  key: IdentifyingFieldKey;
  label: string;
  was: string;
  /** ISO timestamp of the prior evaluation. */
  date: string;
};

/** Fields whose current value differs from the last evaluation (both sides filled in). */
export function diffSinceLastEvaluation(
  values: IdentifyingValues,
  prior: IdentifyingPriorEvaluation | null | undefined
): ChangedSinceLastEvaluation[] {
  if (!prior) return [];
  const out: ChangedSinceLastEvaluation[] = [];
  for (const key of PRIOR_EVALUATION_FIELDS) {
    const now = trimmed(values[key]);
    const was = trimmed(prior.values[key]);
    if (!now || !was) continue;
    if (now.toLowerCase() === was.toLowerCase()) continue;
    out.push({ key, label: fieldLabel(key), was, date: prior.date });
  }
  return out;
}

/**
 * Edits that differ from the chart and may be written back to it.
 * Blanks never clear the chart; AI Scribe suggestions are skipped.
 */
export function chartUpdateCandidates(
  state: IdentifyingState,
  chart: IdentifyingChartData | null | undefined
): ChartDemographicsChanges {
  const out: ChartDemographicsChanges = {};
  const chartValues = chartLayer(chart, '0000-01-01').values;
  for (const key of CHART_WRITABLE_FIELDS) {
    const v = trimmed(state.values[key]);
    if (!v) continue;
    if (state.sources[key] === 'scribe') continue;
    if ((chartValues[key] ?? '').toLowerCase() === v.toLowerCase()) continue;
    out[key] = v;
  }
  return out;
}
