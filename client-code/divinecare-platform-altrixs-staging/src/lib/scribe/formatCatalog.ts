/**
 * AI Scribe output formats ↔ the EHR's note templates. Pure, browser-safe.
 *
 * Every scribe format except the treatment plan update writes a note of one NOTE_TYPES type, with
 * that type's own section headings (NOTE_SECTIONS), so a draft opens in Notes with each section in
 * place: the structured prescriber editor (Psych Med Mgmt, adult / child psychiatry intake and
 * re-eval) and the plain section editor both split the saved body by those headings.
 *
 * The default format follows the visit: the appointment's Visit Guide note type, else the open
 * note's type, else the clinician's own default, else the practice default when it suits the
 * clinician's role, else the role's usual template. The picker lists the role's templates first
 * and the rest under "More templates".
 */
import { normalizeNoteType, type NoteType } from '@/lib/ehr/noteTemplates';
import { SUD_INTAKE, THERAPY_INTAKE, THERAPY_PROGRESS } from '@/lib/ehr/therapy/sections';
import { SCRIBE_FORMATS, type ScribeFormat } from './settings';

/** Who usually writes the template (drives the picker order). */
export type FormatGroup = 'prescriber' | 'therapy' | 'medical' | 'program';
/** How the coding assist treats the visit (coding.ts). */
export type CodingBasis = 'psychotherapy' | 'intake' | 'em' | 'none';

/** Note type each format writes (TREATMENT_PLAN_REVIEW updates the plan, not a note). */
export const FORMAT_NOTE_TYPE: Record<Exclude<ScribeFormat, 'TREATMENT_PLAN_REVIEW'>, NoteType> = {
  THERAPY_PROGRESS: THERAPY_PROGRESS,
  THERAPY_INTAKE: THERAPY_INTAKE,
  SUD_INTAKE: SUD_INTAKE,
  SOAP: 'SOAP',
  DAP: 'DAP',
  BIRP: 'BIRP',
  GIRP: 'GIRP',
  PIRP: 'PIRP',
  PSYCH_MED_MGMT: 'Psych Med Mgmt',
  MED_MGMT: 'Med Mgmt',
  PSYCH_EVAL: 'Psych Eval',
  ADULT_PSYCH_INTAKE: 'Adult Psych Intake',
  ADULT_PSYCH_REEVAL: 'Adult Psych Re-Eval',
  CHILD_PSYCH_INTAKE: 'Child Psych Initial Intake',
  // Stored key of the child re-evaluation (Valant 46444) is 'Child Psych Intake' (noteTemplates.ts)
  CHILD_PSYCH_REEVAL: 'Child Psych Intake',
  PRIMARY_CARE_SOAP: 'SOAP',
  PIE: 'PIE',
  CBT: 'CBT',
  DBT: 'DBT',
  MFT: 'MFT',
  EMDR: 'EMDR',
  CLINICAL_INTAKE: 'Intake',
  SUD_NOTE: 'SUD',
  CRISIS: 'Crisis',
  COLLATERAL: 'Collateral',
  TELEPHONE: 'Telephone',
  DISCHARGE: 'Discharge',
  PRP: 'PRP',
  PEER_SUPPORT: 'Peer Support',
};

export const FORMAT_GROUP: Record<ScribeFormat, FormatGroup> = {
  THERAPY_PROGRESS: 'therapy',
  THERAPY_INTAKE: 'therapy',
  SUD_INTAKE: 'therapy',
  TREATMENT_PLAN_REVIEW: 'therapy',
  SOAP: 'therapy',
  DAP: 'therapy',
  BIRP: 'therapy',
  GIRP: 'therapy',
  PIRP: 'therapy',
  PSYCH_MED_MGMT: 'prescriber',
  MED_MGMT: 'prescriber',
  PSYCH_EVAL: 'prescriber',
  ADULT_PSYCH_INTAKE: 'prescriber',
  ADULT_PSYCH_REEVAL: 'prescriber',
  CHILD_PSYCH_INTAKE: 'prescriber',
  CHILD_PSYCH_REEVAL: 'prescriber',
  PRIMARY_CARE_SOAP: 'medical',
  PIE: 'therapy',
  CBT: 'therapy',
  DBT: 'therapy',
  MFT: 'therapy',
  EMDR: 'therapy',
  CLINICAL_INTAKE: 'therapy',
  SUD_NOTE: 'therapy',
  CRISIS: 'therapy',
  COLLATERAL: 'therapy',
  TELEPHONE: 'therapy',
  DISCHARGE: 'therapy',
  PRP: 'program',
  PEER_SUPPORT: 'program',
};

export const FORMAT_CODING: Record<ScribeFormat, CodingBasis> = {
  THERAPY_PROGRESS: 'psychotherapy',
  THERAPY_INTAKE: 'intake',
  SUD_INTAKE: 'intake',
  TREATMENT_PLAN_REVIEW: 'none',
  SOAP: 'psychotherapy',
  DAP: 'psychotherapy',
  BIRP: 'psychotherapy',
  GIRP: 'psychotherapy',
  PIRP: 'psychotherapy',
  PSYCH_MED_MGMT: 'em',
  MED_MGMT: 'em',
  PSYCH_EVAL: 'em',
  ADULT_PSYCH_INTAKE: 'em',
  ADULT_PSYCH_REEVAL: 'em',
  CHILD_PSYCH_INTAKE: 'em',
  CHILD_PSYCH_REEVAL: 'em',
  PRIMARY_CARE_SOAP: 'em',
  PIE: 'psychotherapy',
  CBT: 'psychotherapy',
  DBT: 'psychotherapy',
  MFT: 'psychotherapy',
  EMDR: 'psychotherapy',
  CLINICAL_INTAKE: 'intake',
  SUD_NOTE: 'none',
  CRISIS: 'none',
  COLLATERAL: 'none',
  TELEPHONE: 'none',
  DISCHARGE: 'none',
  PRP: 'none',
  PEER_SUPPORT: 'none',
};

/** Psychotherapy add-on / service codes shown with the format (suggestions only). */
export const FORMAT_CODES: Partial<Record<ScribeFormat, readonly string[]>> = {
  PSYCH_MED_MGMT: ['99212', '99213', '99214', '99215', '90833', '90836', '90838'],
  MED_MGMT: ['99212', '99213', '99214', '99215'],
  PSYCH_EVAL: ['90792'],
  ADULT_PSYCH_INTAKE: ['90792', '99204', '99205'],
  ADULT_PSYCH_REEVAL: ['99214', '99215', '90792'],
  CHILD_PSYCH_INTAKE: ['90792', '99204', '99205'],
  CHILD_PSYCH_REEVAL: ['99214', '99215', '90792'],
  PRIMARY_CARE_SOAP: ['99212', '99213', '99214', '99215'],
  CLINICAL_INTAKE: ['90791'],
  SUD_NOTE: ['H0004'],
  CRISIS: ['90839', '90840'],
  TELEPHONE: ['98966', '98967', '98968'],
};

/** 42 CFR Part 2 by format (the SUD note, like the SUD intake). */
export const PART2_FORMATS: ReadonlySet<ScribeFormat> = new Set<ScribeFormat>(['SUD_INTAKE', 'SUD_NOTE']);

const UPPER = (role: string | null | undefined) => String(role ?? '').toUpperCase();

/** Template group a role writes most. */
export function roleFormatGroup(role: string | null | undefined): FormatGroup {
  const r = UPPER(role);
  if (r === 'PSYCHIATRIST' || r === 'NP') return 'prescriber';
  if (r === 'PHYSICIAN' || r === 'MEDICAL_NP' || r === 'MEDICAL_ASSISTANT') return 'medical';
  if (r === 'PRP_SPECIALIST' || r === 'PEER_SUPPORT' || r === 'CASE_MANAGER') return 'program';
  return 'therapy';
}

/** The role's usual template when nothing else decides. */
export const ROLE_DEFAULT_FORMAT: Record<FormatGroup, ScribeFormat> = {
  prescriber: 'PSYCH_MED_MGMT',
  medical: 'PRIMARY_CARE_SOAP',
  program: 'PRP',
  therapy: 'THERAPY_PROGRESS',
};

/** Picker: the role's templates first (in catalog order), everything else under "More templates". */
export function formatsForRole(role: string | null | undefined): { primary: ScribeFormat[]; more: ScribeFormat[] } {
  const group = roleFormatGroup(role);
  const primary = SCRIBE_FORMATS.filter((f) => FORMAT_GROUP[f] === group);
  const more = SCRIBE_FORMATS.filter((f) => FORMAT_GROUP[f] !== group);
  return { primary, more };
}

/**
 * Scribe format for a note type (Visit Guide noteType or an open note's type). SOAP is the primary
 * care SOAP for a medical visit / medical role, otherwise the behavioral health SOAP. Note types
 * the scribe does not draft (Group, No-Show) → null.
 */
export function formatForNoteType(noteType: string | null | undefined, opts: { medical?: boolean } = {}): ScribeFormat | null {
  if (!noteType) return null;
  const nt = normalizeNoteType(noteType);
  if (nt === 'SOAP') return opts.medical ? 'PRIMARY_CARE_SOAP' : 'SOAP';
  const hit = (Object.entries(FORMAT_NOTE_TYPE) as [ScribeFormat, string][]).find(([f, t]) => t === nt && f !== 'PRIMARY_CARE_SOAP');
  return hit ? hit[0] : null;
}

export function isScribeFormat(v: unknown): v is ScribeFormat {
  return typeof v === 'string' && (SCRIBE_FORMATS as readonly string[]).includes(v);
}

/**
 * Default format for a new capture.
 *  1. the appointment's Visit Guide note type (audience 'medical' → primary care SOAP)
 *  2. the open note's type (?noteType=)
 *  3. the clinician's own default (Scribe preferences)
 *  4. the practice default, when it is one of the role's templates
 *  5. the role's usual template
 */
export function defaultScribeFormat(input: {
  role: string | null | undefined;
  visit?: { noteType: string | null; audience?: string | null } | null;
  noteType?: string | null;
  preferred?: ScribeFormat | null;
  practiceDefault?: ScribeFormat | null;
}): { format: ScribeFormat; source: 'visit' | 'note' | 'preference' | 'practice' | 'role' } {
  const group = roleFormatGroup(input.role);
  const medical = group === 'medical';
  const fromVisit = input.visit ? formatForNoteType(input.visit.noteType, { medical: input.visit.audience === 'medical' || (medical && !input.visit.audience) }) : null;
  if (fromVisit) return { format: fromVisit, source: 'visit' };
  const fromNote = formatForNoteType(input.noteType, { medical });
  if (fromNote) return { format: fromNote, source: 'note' };
  if (input.preferred && isScribeFormat(input.preferred)) return { format: input.preferred, source: 'preference' };
  if (input.practiceDefault && isScribeFormat(input.practiceDefault) && FORMAT_GROUP[input.practiceDefault] === group) {
    return { format: input.practiceDefault, source: 'practice' };
  }
  return { format: ROLE_DEFAULT_FORMAT[group], source: 'role' };
}
