/**
 * Recorded measures ("Record a measure" in the chart's Assessments & outcomes tab).
 * Values are validated by the measurement type's data type. Ranges are applied only where they are
 * physiologically known (vital signs); score types get "whole number / non-negative" checks and the
 * clinician's paper form is the source of truth. Pure: shared by the browser form and the API.
 */
import type { MeasurementDataType } from '@/lib/migration/valantMeasurementTypes';

export type MeasureTypeForValidation = {
  dataType: MeasurementDataType | string;
  vitalField?: string | null;
  documentationCode?: string | null;
};

export type MeasureValue =
  | { ok: true; valueNumeric: number | null; valueSecondary: number | null; valueText: string | null; display: string }
  | { ok: false; error: string };

/** ONC / CDC smoking status value set (SNOMED CT), the codes Valant's Smoking Status type records */
export const SMOKING_STATUS_OPTIONS = [
  { code: '449868002', label: 'Current every day smoker' },
  { code: '428041000124106', label: 'Current some day smoker' },
  { code: '8517006', label: 'Former smoker' },
  { code: '266919005', label: 'Never smoker' },
  { code: '77176002', label: 'Smoker, current status unknown' },
  { code: '266927001', label: 'Unknown if ever smoked' },
  { code: '428071000124103', label: 'Current heavy tobacco smoker' },
  { code: '428061000124105', label: 'Current light tobacco smoker' },
] as const;

/** Known plausible ranges by MedicalVital column or Valant documentation code (lower-case) */
const VITAL_RANGES: Record<string, { min: number; max: number; label: string }> = {
  bpSystolic: { min: 50, max: 300, label: 'Systolic' },
  bpDiastolic: { min: 20, max: 250, label: 'Diastolic' },
  heartRate: { min: 20, max: 300, label: 'Heart rate' },
  respiratoryRate: { min: 4, max: 100, label: 'Respiration rate' },
  heightInches: { min: 10, max: 120, label: 'Height (in)' },
  weightLbs: { min: 1, max: 1500, label: 'Weight (lb)' },
  bmi: { min: 5, max: 150, label: 'BMI' },
  waist: { min: 10, max: 120, label: 'Waist (in)' },
  fasting_glucose: { min: 10, max: 2000, label: 'Fasting glucose (mg/dL)' },
};

/** Upper bound for score types with no known range (catches typos such as an extra digit or two) */
const SCORE_MAX = 10000;

const NUM = /^-?\d+(\.\d+)?$/;
const INT = /^-?\d+$/;

function range(t: MeasureTypeForValidation) {
  return VITAL_RANGES[t.vitalField ?? ''] ?? VITAL_RANGES[(t.documentationCode ?? '').toLowerCase()];
}

function checkRange(n: number, r: { min: number; max: number; label: string } | undefined): string | null {
  if (r && (n < r.min || n > r.max)) return `${r.label} must be between ${r.min} and ${r.max}`;
  return null;
}

export function validateMeasureValue(t: MeasureTypeForValidation, raw: string): MeasureValue {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: false, error: 'Enter a value' };
  switch (t.dataType) {
    case 'blood_pressure': {
      const m = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(v);
      if (!m) return { ok: false, error: 'Enter blood pressure as systolic/diastolic, for example 120/80' };
      const sys = Number(m[1]);
      const dia = Number(m[2]);
      const err = checkRange(sys, VITAL_RANGES.bpSystolic) ?? checkRange(dia, VITAL_RANGES.bpDiastolic);
      if (err) return { ok: false, error: err };
      if (dia >= sys) return { ok: false, error: 'Diastolic must be lower than systolic' };
      return { ok: true, valueNumeric: sys, valueSecondary: dia, valueText: null, display: `${sys}/${dia}` };
    }
    case 'smoking_status': {
      const opt = SMOKING_STATUS_OPTIONS.find((o) => o.code === v || o.label.toLowerCase() === v.toLowerCase());
      if (!opt) return { ok: false, error: 'Choose a smoking status from the list' };
      return { ok: true, valueNumeric: null, valueSecondary: null, valueText: opt.code, display: opt.label };
    }
    case 'integer': {
      if (!INT.test(v)) return { ok: false, error: 'Enter a whole number' };
      const n = Number(v);
      const r = range(t);
      if (!r && (n < 0 || n > SCORE_MAX)) return { ok: false, error: `Enter a score from 0 to ${SCORE_MAX}` };
      const err = checkRange(n, r);
      return err ? { ok: false, error: err } : { ok: true, valueNumeric: n, valueSecondary: null, valueText: null, display: String(n) };
    }
    case 'real':
    case 'bmi':
    case 'length':
    case 'mass': {
      if (!NUM.test(v)) return { ok: false, error: 'Enter a number' };
      const n = Number(v);
      const r = range(t) ?? (t.dataType === 'bmi' ? VITAL_RANGES.bmi : t.dataType === 'length' ? VITAL_RANGES.heightInches : t.dataType === 'mass' ? VITAL_RANGES.weightLbs : undefined);
      if (!r && (n < 0 || n > SCORE_MAX)) return { ok: false, error: `Enter a value from 0 to ${SCORE_MAX}` };
      const err = checkRange(n, r);
      return err ? { ok: false, error: err } : { ok: true, valueNumeric: n, valueSecondary: null, valueText: null, display: String(n) };
    }
    default:
      return { ok: false, error: 'This measurement type cannot be recorded' };
  }
}

export function measureDisplay(r: { valueNumeric: number | null; valueSecondary: number | null; valueText: string | null }, dataType: string) {
  if (dataType === 'blood_pressure' && r.valueNumeric != null && r.valueSecondary != null) return `${r.valueNumeric}/${r.valueSecondary}`;
  if (dataType === 'smoking_status') return SMOKING_STATUS_OPTIONS.find((o) => o.code === r.valueText)?.label ?? r.valueText ?? '';
  return r.valueNumeric != null ? String(r.valueNumeric) : r.valueText ?? '';
}

/** A measure is recorded with "Record a measure" unless it is the total score of a built-in Altrixs instrument */
export function recordableAsMeasure(t: { instrumentKey: string | null; isSubscore: boolean; active: boolean }) {
  return t.active && !(t.instrumentKey && !t.isSubscore);
}
