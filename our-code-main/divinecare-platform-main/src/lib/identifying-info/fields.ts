/**
 * Identifying Information (Oct 25) — note types, exact field labels, and the note-body section format.
 * Pure module (no Prisma / React).
 */
import { IDENTIFYING_INFORMATION_HEADING } from './copy';
import type { IdentifyingFieldKey, IdentifyingValues, VisitModality } from './types';

/**
 * Note types that carry the Identifying Information section.
 * NOT on SOAP / DAP / Med Mgmt / Crisis / Group.
 */
export const IDENTIFYING_INFO_NOTE_TYPES = [
  'Therapy Intake',
  'Substance Abuse Intake',
  'Intake',
  'Psych Eval',
  'Child Psych Initial Intake',
  'Child Psych Intake',
  'Adult Psych Intake',
  'Adult Psych Re-Eval',
] as const;

export type IdentifyingInfoNoteType = (typeof IDENTIFYING_INFO_NOTE_TYPES)[number];

const NOTE_TYPE_LOOKUP = new Map<string, IdentifyingInfoNoteType>(
  IDENTIFYING_INFO_NOTE_TYPES.map((t) => [t.toLowerCase(), t])
);

export function resolveIdentifyingNoteType(noteType: string | null | undefined): IdentifyingInfoNoteType | null {
  return NOTE_TYPE_LOOKUP.get((noteType ?? '').trim().toLowerCase()) ?? null;
}

export function hasIdentifyingInformation(noteType: string | null | undefined): boolean {
  return resolveIdentifyingNoteType(noteType) !== null;
}

/** The amber "Changed since last evaluation" lines apply to re-evaluations only. */
export function isReEvalNoteType(noteType: string | null | undefined): boolean {
  return resolveIdentifyingNoteType(noteType) === 'Adult Psych Re-Eval';
}

export const MODALITY_LABELS: Record<VisitModality, string> = {
  in_office: 'In office',
  telehealth_video: 'Telehealth video',
  telehealth_audio: 'Telehealth audio-only',
};

export function isTelehealthModality(modality: string | null | undefined): boolean {
  return modality === 'telehealth_video' || modality === 'telehealth_audio';
}

export type IdentifyingFieldDef = {
  key: IdentifyingFieldKey;
  /** Exact label. */
  label: string;
  input: 'text' | 'select' | 'readonly' | 'textarea';
  options?: readonly { value: string; label: string }[];
  /** Chart-derived and never typed by the clinician. */
  derived?: boolean;
  /** Only rendered when visit modality is telehealth. */
  telehealthOnly?: boolean;
};

export const IDENTIFYING_FIELDS: readonly IdentifyingFieldDef[] = [
  { key: 'title', label: 'Title', input: 'text' },
  {
    key: 'sexAssignedAtBirth',
    label: 'Sex assigned at birth',
    input: 'select',
    options: [
      { value: 'Female', label: 'Female' },
      { value: 'Male', label: 'Male' },
      { value: 'Intersex', label: 'Intersex' },
    ],
  },
  { key: 'genderIdentity', label: 'Gender identity', input: 'text' },
  { key: 'pronouns', label: 'Pronouns', input: 'text' },
  { key: 'age', label: 'Age (derived)', input: 'readonly', derived: true },
  { key: 'race', label: 'Race', input: 'text' },
  { key: 'ethnicity', label: 'Ethnicity', input: 'text' },
  { key: 'maritalStatus', label: 'Marital status', input: 'text' },
  { key: 'legalGuardian', label: 'Legal guardian', input: 'text' },
  { key: 'preferredLanguage', label: 'Preferred language', input: 'text' },
  {
    key: 'interpreterNeeded',
    label: 'Interpreter needed',
    input: 'select',
    options: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    key: 'visitModality',
    label: 'Visit modality',
    input: 'select',
    options: (Object.keys(MODALITY_LABELS) as VisitModality[]).map((value) => ({
      value,
      label: MODALITY_LABELS[value],
    })),
  },
  { key: 'patientLocation', label: 'Patient location (telehealth)', input: 'text', telehealthOnly: true },
  { key: 'accompaniedBy', label: 'Accompanied by', input: 'text' },
  { key: 'weight', label: 'Weight', input: 'text' },
  { key: 'height', label: 'Height', input: 'text' },
  { key: 'bmi', label: 'BMI', input: 'text' },
  { key: 'chiefComplaint', label: "Chief complaint (patient's own words)", input: 'textarea' },
] as const;

const FIELD_BY_KEY = new Map(IDENTIFYING_FIELDS.map((f) => [f.key, f]));
const KEY_BY_LABEL = new Map(IDENTIFYING_FIELDS.map((f) => [f.label.toLowerCase(), f.key]));

export function fieldLabel(key: IdentifyingFieldKey): string {
  return FIELD_BY_KEY.get(key)?.label ?? key;
}

export function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

/** Display text for a stored value (modality keys → labels). */
export function displayValue(key: IdentifyingFieldKey, value: string): string {
  if (key === 'visitModality') return MODALITY_LABELS[value as VisitModality] ?? value;
  return value;
}

function storedValue(key: IdentifyingFieldKey, text: string): string {
  if (key !== 'visitModality') return text;
  const hit = (Object.keys(MODALITY_LABELS) as VisitModality[]).find(
    (m) => MODALITY_LABELS[m].toLowerCase() === text.toLowerCase()
  );
  return hit ?? text;
}

/** Drop blank values; trims. Unknown never invented. */
export function compactValues(values: IdentifyingValues): IdentifyingValues {
  const out: IdentifyingValues = {};
  for (const field of IDENTIFYING_FIELDS) {
    const v = values[field.key];
    if (!isBlank(v)) out[field.key] = v!.trim();
  }
  return out;
}

/**
 * Render the note-body section. Blank fields are omitted; returns '' when nothing is filled in.
 * Patient location only prints for telehealth visits.
 */
export function formatIdentifyingSection(values: IdentifyingValues): string {
  const lines: string[] = [];
  const telehealth = isTelehealthModality(values.visitModality);
  for (const field of IDENTIFYING_FIELDS) {
    if (field.telehealthOnly && !telehealth) continue;
    const v = values[field.key];
    if (isBlank(v)) continue;
    const text = displayValue(field.key, v!.trim()).replace(/\s*\r?\n\s*/g, ' ');
    lines.push(`${field.label}: ${text}`);
  }
  if (lines.length === 0) return '';
  return `${IDENTIFYING_INFORMATION_HEADING}\n${lines.join('\n')}\n`;
}

/** Read an Identifying Information section back out of a note body (for prior-evaluation prefill). */
export function parseIdentifyingSection(body: string | null | undefined): IdentifyingValues {
  const out: IdentifyingValues = {};
  if (!body) return out;
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const headingIdx = lines.findIndex(
    (line) =>
      line
        .trim()
        .replace(/^#{1,3}\s*/, '')
        .replace(/:$/, '')
        .toLowerCase() === IDENTIFYING_INFORMATION_HEADING.toLowerCase()
  );
  if (headingIdx === -1) return out;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (Object.keys(out).length === 0) continue;
      break;
    }
    const colon = line.indexOf(':');
    if (colon === -1) break;
    const key = KEY_BY_LABEL.get(line.slice(0, colon).trim().toLowerCase());
    if (!key) break;
    const text = line.slice(colon + 1).trim();
    if (text) out[key] = storedValue(key, text);
  }
  return out;
}

// ─── Age (derived from chart date of birth) ─────────────────────────────────

/** Whole years on `today` (YYYY-MM-DD). null when the DOB is missing or unparseable. */
export function ageInYears(dateOfBirth: string | null | undefined, today: string): number | null {
  const dob = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '');
  const now = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!dob || !now) return null;
  let years = Number(now[1]) - Number(dob[1]);
  const monthDiff = Number(now[2]) - Number(dob[2]);
  if (monthDiff < 0 || (monthDiff === 0 && Number(now[3]) < Number(dob[3]))) years -= 1;
  return years < 0 ? null : years;
}

/** "34 years" / "1 year" / "9 months" (under 2 years, in whole months). */
export function formatAge(dateOfBirth: string | null | undefined, today: string): string | null {
  const years = ageInYears(dateOfBirth, today);
  if (years === null) return null;
  if (years >= 2) return `${years} years`;
  const dob = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth!)!;
  const now = /^(\d{4})-(\d{2})-(\d{2})/.exec(today)!;
  let months = (Number(now[1]) - Number(dob[1])) * 12 + (Number(now[2]) - Number(dob[2]));
  if (Number(now[3]) < Number(dob[3])) months -= 1;
  if (months >= 12) return '1 year';
  return `${Math.max(0, months)} ${months === 1 ? 'month' : 'months'}`;
}
