import { z } from 'zod';

/**
 * Structured legal name (First / M.I. / Last) — the shape DrFirst Rcopia's patient
 * demographic sync expects. Client.name stays in sync as "First Last".
 * Pure helpers: safe to import from client components.
 */
export type LegalNameParts = {
  legalFirstName?: string | null;
  middleInitial?: string | null;
  legalLastName?: string | null;
};

/** Optional legal-name fields for create/update zod schemas. */
export const legalNameFields = {
  legalFirstName: z.string().trim().max(80).optional().nullable(),
  middleInitial: z
    .string()
    .trim()
    .max(2)
    .regex(/^([A-Za-z]\.?)?$/, 'Middle initial must be a single letter')
    .optional()
    .nullable(),
  legalLastName: z.string().trim().max(80).optional().nullable(),
};

export function normalizeMiddleInitial(value?: string | null): string | null {
  const letter = (value ?? '').trim().replace(/\./g, '').charAt(0);
  return letter ? letter.toUpperCase() : null;
}

function clean(value?: string | null): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export function hasLegalName(parts: LegalNameParts): boolean {
  return Boolean(clean(parts.legalFirstName) && clean(parts.legalLastName));
}

/** Client.name — "First Last". */
export function clientNameFromLegal(parts: LegalNameParts): string {
  return [clean(parts.legalFirstName), clean(parts.legalLastName)].filter(Boolean).join(' ');
}

/** Natural display with initial — "First M. Last" (intake invites, greetings). */
export function fullNameWithInitial(parts: LegalNameParts): string {
  const mi = normalizeMiddleInitial(parts.middleInitial);
  return [clean(parts.legalFirstName), mi ? `${mi}.` : '', clean(parts.legalLastName)]
    .filter(Boolean)
    .join(' ');
}

/** Chart header format — "Last, First M." — or null when legal names are missing. */
export function chartLegalName(parts: LegalNameParts): string | null {
  if (!hasLegalName(parts)) return null;
  const mi = normalizeMiddleInitial(parts.middleInitial);
  return `${clean(parts.legalLastName)}, ${clean(parts.legalFirstName)}${mi ? ` ${mi}.` : ''}`;
}

/**
 * Best-effort split of a free-text full name ("First M. Last" / "First Last").
 * A lone single letter between first and last is treated as the middle initial.
 */
export function splitFullName(fullName?: string | null): {
  firstName: string;
  middleInitial: string;
  lastName: string;
} {
  const parts = clean(fullName).split(' ').filter(Boolean);
  if (parts.length === 0) return { firstName: '', middleInitial: '', lastName: '' };
  if (parts.length >= 3 && /^[A-Za-z]\.?$/.test(parts[1])) {
    return {
      firstName: parts[0],
      middleInitial: parts[1].charAt(0).toUpperCase(),
      lastName: parts.slice(2).join(' '),
    };
  }
  return { firstName: parts[0], middleInitial: '', lastName: parts.slice(1).join(' ') };
}

// ─── Valant name format (treatment plan document header) ───────────────────

export type DisplayNameParts = LegalNameParts & {
  preferredName?: string | null;
  nameSuffix?: string | null;
  /** Client.name, used when the legal first / last name are not on file */
  name?: string | null;
  /** Patient ID printed in parentheses (Altrixs MRN) */
  patientId?: string | null;
};

/** Optional preferred-name / suffix fields for create/update zod schemas. */
export const preferredNameFields = {
  preferredName: z.string().trim().max(80).optional().nullable(),
  nameSuffix: z.string().trim().max(20).optional().nullable(),
};

/**
 * Patient name exactly as the practice's Valant template prints it:
 *  - with a preferred name: "PreferredName [FirstName] MiddleInitial. LastName, Suffix (PatientID)"
 *  - without:               "FirstName MiddleInitial. LastName, Suffix (PatientID)"
 * Parts that are not on file are left out (no stray "." / "," / "()"). A preferred name equal to
 * the first name is not a different name, so it prints as the no-preferred form. Falls back to
 * Client.name when the legal first / last name were never entered.
 */
export function valantPatientName(parts: DisplayNameParts): string {
  const hasLegal = Boolean(clean(parts.legalFirstName) || clean(parts.legalLastName));
  const split = hasLegal ? null : splitFullName(parts.name);
  const first = split ? split.firstName : clean(parts.legalFirstName);
  const last = split ? split.lastName : clean(parts.legalLastName);
  const mi = normalizeMiddleInitial(split ? split.middleInitial || parts.middleInitial : parts.middleInitial);
  const preferred = clean(parts.preferredName);
  const suffix = clean(parts.nameSuffix);
  const id = clean(parts.patientId);
  const usePreferred = Boolean(preferred) && preferred.toLowerCase() !== first.toLowerCase();
  const firstPart = usePreferred ? [preferred, first ? `[${first}]` : ''].filter(Boolean).join(' ') : first;
  let core = [firstPart, mi ? `${mi}.` : '', last].filter(Boolean).join(' ');
  if (suffix) core = core ? `${core}, ${suffix}` : suffix;
  return id ? `${core} (${id})` : core;
}

// ─── Deterministic legal-name parsing (import / backfill) ──────────────────

/** Generational / professional name suffixes accepted after a trailing comma ("Last, First M, Jr.") */
export const NAME_SUFFIXES = ['Jr', 'Sr', 'II', 'III', 'IV', 'V', 'VI'] as const;

function suffixToken(raw: string): string | null {
  const t = raw.trim().replace(/\.$/, '');
  const hit = NAME_SUFFIXES.find((s) => s.toLowerCase() === t.toLowerCase());
  return hit ? (hit === 'Jr' || hit === 'Sr' ? `${hit}.` : hit) : null;
}

export type ParsedLegalName =
  | { ok: true; firstName: string; middleInitial: string | null; lastName: string; suffix: string | null }
  | { ok: false; reason: string };

/**
 * Parses ONLY the unambiguous "Last, First" / "Last, First M" / "Last, First M., Suffix" form
 * (the comma fixes which part is the family name). Everything else returns ok:false with the
 * reason, so the chart is flagged for staff review: "First Last" without a comma (order not
 * certain: "Mary Ann Smith", "Garcia Lopez Juan"), two-word given names ("Last, Mary Ann": middle
 * name or two-part first name?), extra commas, digits or a single word. Never guesses.
 */
export function parseLegalNameSource(raw?: string | null): ParsedLegalName {
  const s = clean(raw);
  if (!s) return { ok: false, reason: 'No name on file' };
  if (/\d/.test(s)) return { ok: false, reason: 'Name contains digits' };
  if (/[()[\]{}"/\;@]/.test(s)) return { ok: false, reason: 'Name contains characters that are not part of a legal name' };
  const segments = s.split(',').map((p) => p.trim());
  if (segments.length < 2) return { ok: false, reason: 'No comma: first / last order is not certain' };
  let suffix: string | null = null;
  if (segments.length === 3) {
    suffix = suffixToken(segments[2]);
    if (!suffix) return { ok: false, reason: 'Text after the second comma is not a name suffix' };
  } else if (segments.length > 3) {
    return { ok: false, reason: 'More than two commas' };
  }
  const last = segments[0];
  const given = segments[1].split(' ').filter(Boolean);
  if (!last) return { ok: false, reason: 'Last name before the comma is blank' };
  if (!given.length) return { ok: false, reason: 'First name after the comma is blank' };
  // A suffix inside the family-name part ("Smith Jr, John") is the format's suffix, not a surname word
  const lastWords = last.split(' ');
  if (lastWords.length > 1 && suffixToken(lastWords[lastWords.length - 1])) {
    return { ok: false, reason: 'Suffix written inside the last name; confirm the legal last name' };
  }
  if (given.length === 1) return { ok: true, firstName: given[0], middleInitial: null, lastName: last, suffix };
  if (given.length === 2 && /^[A-Za-z]\.?$/.test(given[1]) && given[0].length > 1) {
    return { ok: true, firstName: given[0], middleInitial: given[1].charAt(0).toUpperCase(), lastName: last, suffix };
  }
  return { ok: false, reason: 'More than one given-name word: middle name or two-part first name is not certain' };
}
