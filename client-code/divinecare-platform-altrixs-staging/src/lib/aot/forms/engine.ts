/**
 * MDH AOT form engine (pure, no I/O; safe in the browser).
 *
 * Each of the six Maryland Department of Health AOT forms (revised 06/25/2026) is described once as
 * sections of fields. The same description drives the Zod schema (what a draft may contain), the
 * editor, the print view and the generic part of completeness(). Form-specific rules (minimum
 * services, age 18+, attachment references ...) are CustomRules on the definition.
 */
import { z } from 'zod';

export type FormData = Record<string, unknown>;
export type Opt = { value: string; label: string };

export type ColumnType = 'text' | 'textarea' | 'date' | 'select' | 'yesno' | 'checkbox' | 'checkboxes';
export type ColumnSpec = {
  key: string;
  label: string;
  type: ColumnType;
  options?: Opt[];
  /** Filled from defaultRows and not editable (e.g. the party names in the complaint notification table) */
  readonly?: boolean;
};

export type FieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'time'
  | 'email'
  | 'tel'
  | 'amount'
  | 'yesno'
  | 'yesnounknown'
  | 'radio'
  | 'select'
  | 'checkboxes'
  | 'checkbox'
  | 'table'
  | 'static';

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  /** Item number as printed on the MDH form ("1", "1a", "14b") */
  num?: string;
  options?: Opt[];
  columns?: ColumnSpec[];
  defaultRows?: Record<string, unknown>[];
  /** Rows come only from defaultRows (no add / remove) */
  fixedRows?: boolean;
  maxRows?: number;
  /** A row counts as filled when this column has a value (required tables need one filled row) */
  rowKey?: string;
  required?: boolean | ((d: FormData) => boolean);
  showIf?: (d: FormData) => boolean;
  help?: string;
  /** Computed by the definition's derive(); shown but not editable */
  readonly?: boolean;
  /** Verbatim text for type 'static' */
  text?: string;
  max?: number;
};

export type SectionSpec = {
  id: string;
  title: string;
  /** Verbatim instruction / statutory text printed under the heading */
  intro?: string;
  fields: FieldSpec[];
  showIf?: (d: FormData) => boolean;
};

/** A form-specific requirement: returns the missing-item message, or null when satisfied. */
export type CustomRule = { id: string; check: (d: FormData) => string | null };

export type SignerSlot = {
  id: string;
  label: string;
  /** Active roles that may sign this slot */
  roles: readonly string[];
  /** A verified Medical Director (any eligible prescriber role) may also sign */
  allowMedicalDirector?: boolean;
  /** Ask the signer for a title at signing (printed with the signature) */
  askTitle?: boolean;
  roleHint: string;
};

export type FormType =
  | 'treatment_plan'
  | 'psychiatrist_affidavit'
  | 'ep_notification'
  | 'continued_treatment_plan'
  | 'nonresponsive_letter'
  | 'complaint';

export type FormDefinition = {
  type: FormType;
  title: string;
  /** MDH form number for the print footer, e.g. MDH#0001BHA (null when the form carries none) */
  mdhNumber: string | null;
  revised: string;
  purpose: string;
  /** Set when the printed fixed wording has been verified word for word against the MDH form */
  wordingVerified?: string;
  sections: SectionSpec[];
  rules: CustomRule[];
  signers: SignerSlot[];
  /** Electronic-signature attestation shown and stored with each signature */
  attestation: string;
  /** Several independent documents may exist (each EP event, each complaint); others are one document + amendments */
  multiInstance: boolean;
  /** Non-blocking warnings (e.g. practice filing-window rules) */
  warnings?: (d: FormData, now: Date) => string[];
  /** Computed fields, applied by the editor on every change and by the API before saving (e.g. 18+ from DOB) */
  derive?: (d: FormData) => FormData;
};

export const REVISED = '06/25/2026';

export const YES_NO: Opt[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
export const YES_NO_UNKNOWN: Opt[] = [...YES_NO, { value: 'unknown', label: 'Unknown' }];

export const opts = (pairs: [string, string][]): Opt[] => pairs.map(([value, label]) => ({ value, label }));

// ─── Values ────────────────────────────────────────────────────────────────

export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export const str = (d: FormData, k: string): string => (typeof d?.[k] === 'string' ? (d[k] as string) : '');
export const arr = (d: FormData, k: string): string[] => (Array.isArray(d?.[k]) ? (d[k] as unknown[]).map(String) : []);
export const rows = (d: FormData, k: string): Record<string, unknown>[] =>
  Array.isArray(d?.[k]) ? (d[k] as unknown[]).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
export const is = (d: FormData, k: string, v: string) => str(d, k) === v;
export const has = (d: FormData, k: string, v: string) => arr(d, k).includes(v);

export function rowFilled(row: Record<string, unknown>, cols: ColumnSpec[], rowKey?: string): boolean {
  if (rowKey) return !isEmptyValue(row[rowKey]);
  return cols.some((c) => !c.readonly && !isEmptyValue(row[c.key]));
}

export function sectionVisible(s: SectionSpec, d: FormData) {
  return !s.showIf || s.showIf(d);
}
export function fieldVisible(f: FieldSpec, d: FormData) {
  return !f.showIf || f.showIf(d);
}
export function fieldRequired(f: FieldSpec, d: FormData) {
  return typeof f.required === 'function' ? f.required(d) : !!f.required;
}

/** The value the editor starts from for a field (tables seed their default rows). */
export function initialValue(f: FieldSpec): unknown {
  if (f.type === 'table') return (f.defaultRows ?? []).map((r) => ({ ...r }));
  if (f.type === 'checkboxes') return [];
  if (f.type === 'checkbox') return false;
  return '';
}

export function emptyData(def: FormDefinition): FormData {
  const out: FormData = {};
  for (const s of def.sections) for (const f of s.fields) if (f.type !== 'static') out[f.key] = initialValue(f);
  return out;
}

// ─── Schema ────────────────────────────────────────────────────────────────

const DATE = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use YYYY-MM-DD');
const TIME = z.string().regex(/^(\d{2}:\d{2})?$/, 'Use HH:MM');

function enumOf(options: Opt[] | undefined, extra: string[] = []) {
  const values = [...new Set([...(options ?? []).map((o) => o.value), ...extra])];
  return z.enum(values as [string, ...string[]]);
}

function columnSchema(c: ColumnSpec) {
  switch (c.type) {
    case 'date':
      return DATE.optional();
    case 'select':
    case 'yesno':
      return enumOf(c.type === 'yesno' ? YES_NO : c.options, ['']).optional();
    case 'checkbox':
      return z.boolean().optional();
    case 'checkboxes':
      return z.array(enumOf(c.options)).max(20).optional();
    default:
      return z.string().max(c.type === 'textarea' ? 4000 : 500).optional();
  }
}

function fieldSchema(f: FieldSpec) {
  switch (f.type) {
    case 'date':
      return DATE.optional();
    case 'time':
      return TIME.optional();
    case 'email':
    case 'tel':
    case 'text':
      return z.string().max(f.max ?? 500).optional();
    case 'amount':
      return z.string().max(40).optional();
    case 'textarea':
      return z.string().max(f.max ?? 8000).optional();
    case 'yesno':
      return enumOf(YES_NO, ['']).optional();
    case 'yesnounknown':
      return enumOf(YES_NO_UNKNOWN, ['']).optional();
    case 'radio':
    case 'select':
      return enumOf(f.options, ['']).optional();
    case 'checkboxes':
      return z.array(enumOf(f.options)).max((f.options ?? []).length).optional();
    case 'checkbox':
      return z.boolean().optional();
    case 'table': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const c of f.columns ?? []) shape[c.key] = columnSchema(c);
      return z.array(z.object(shape)).max(f.maxRows ?? 60).optional();
    }
    default:
      return null;
  }
}

/** Zod schema for a form's data. Unknown keys are stripped (server-managed _meta is merged back by the API). */
export function buildSchema(sections: SectionSpec[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const s of sections)
    for (const f of s.fields) {
      const fs = fieldSchema(f);
      if (fs) shape[f.key] = fs;
    }
  return z.object(shape);
}

// ─── Completeness ──────────────────────────────────────────────────────────

function requiredItems(def: FormDefinition, d: FormData): { label: string; ok: boolean }[] {
  const out: { label: string; ok: boolean }[] = [];
  for (const s of def.sections) {
    if (!sectionVisible(s, d)) continue;
    for (const f of s.fields) {
      if (f.type === 'static' || !fieldVisible(f, d) || !fieldRequired(f, d)) continue;
      const label = `${s.title}: ${f.num ? `${f.num}. ` : ''}${f.label}`;
      const ok =
        f.type === 'table'
          ? rows(d, f.key).some((r) => rowFilled(r, f.columns ?? [], f.rowKey))
          : !isEmptyValue(d?.[f.key]);
      out.push({ label, ok });
    }
  }
  return out;
}

/** Missing required items, in form order (generic required fields first, then the form's rules). */
export function missingItems(def: FormDefinition, data: FormData): string[] {
  const d = data ?? {};
  const generic = requiredItems(def, d).filter((x) => !x.ok).map((x) => x.label);
  const custom = def.rules.map((r) => r.check(d)).filter((m): m is string => !!m);
  return [...generic, ...custom];
}

export function progress(def: FormDefinition, data: FormData): { total: number; missing: number; pct: number } {
  const d = data ?? {};
  const items = requiredItems(def, d);
  const failing = def.rules.filter((r) => !!r.check(d)).length;
  const total = items.length + def.rules.length;
  const missing = items.filter((x) => !x.ok).length + failing;
  return { total, missing, pct: total ? Math.round(((total - missing) / total) * 100) : 100 };
}

/** Whole years between a YYYY-MM-DD birth date and a reference date (null when unparseable). */
export function ageOn(dob: string, on: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  let age = on.getUTCFullYear() - y;
  const md = (on.getUTCMonth() + 1) * 100 + on.getUTCDate();
  if (md < mo * 100 + day) age -= 1;
  return age;
}

export function optionLabel(options: Opt[] | undefined, value: unknown): string {
  return options?.find((o) => o.value === value)?.label ?? String(value ?? '');
}
