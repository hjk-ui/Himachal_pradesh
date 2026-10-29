/**
 * Change the type of an unsigned note (pure, browser-safe). Prescriber feedback: an intake started
 * for a visit that turns out to be a follow-up (or the reverse) is switched during the visit
 * instead of being rewritten.
 *
 * Everything already typed is kept: a section moves to the new template's section with the same
 * heading (exact, else the same words ignoring case / punctuation); text in sections the new
 * template does not have goes into one "Carried over from <old type>" section, under its old
 * heading, so nothing is lost. The server re-runs every sign check against the new type.
 */
import { NOTE_LABELS, NOTE_TYPES, normalizeNoteType, type NoteType } from '@/lib/ehr/noteTemplates';
import { asStructuredNoteType } from '@/lib/ehr/structuredNotes';
import { SUD_INTAKE, THERAPY_INTAKE } from '@/lib/ehr/therapy/sections';

export const CARRIED_OVER_PREFIX = 'Carried over from ';

/** Intake / evaluation note types (evaluation codes 90791 / 90792 belong to these only). */
export const INTAKE_NOTE_TYPES: readonly string[] = [
  THERAPY_INTAKE,
  SUD_INTAKE,
  'Intake',
  'Psych Eval',
  'Child Psych Initial Intake',
  'Child Psych Intake',
  'Adult Psych Intake',
  'Adult Psych Re-Eval',
];
const EVALUATION_CODES = ['90791', '90792'];

export function isKnownNoteTypeValue(type: string | null | undefined): type is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(String(type ?? ''));
}

/** Display name of a note type ("Adult Psychiatry Intake"); the stored key when unknown. */
export function noteTypeLabel(type: string | null | undefined): string {
  const t = normalizeNoteType(String(type ?? ''));
  return isKnownNoteTypeValue(t) ? NOTE_LABELS[t] : t || 'Note';
}

export function carriedOverHeading(fromType: string): string {
  return `${CARRIED_OVER_PREFIX}${noteTypeLabel(fromType)}`;
}

/** Only "Carried over from <a known note type>" (a sentence that starts with the words is not a heading). */
export function isCarriedOverHeading(heading: string): boolean {
  const h = heading.trim();
  if (!h.startsWith(CARRIED_OVER_PREFIX)) return false;
  const rest = h.slice(CARRIED_OVER_PREFIX.length);
  return NOTE_TYPES.some((t) => t === rest || NOTE_LABELS[t] === rest);
}

/** "Change Intake to Progress note? …" (the confirmation the editor shows before switching). */
export function typeChangeConfirmText(fromType: string, toType: string): string {
  return `Change ${noteTypeLabel(fromType)} to ${noteTypeLabel(toType)}? Text in sections the new template doesn't have is kept under 'Carried over'.`;
}

/** Same type after normalizing aliases ("Psychiatric Med Management" = "Psych Med Mgmt"). */
export function isNoteTypeChange(current: string | null | undefined, next: string | null | undefined): boolean {
  if (next == null || next === '') return false;
  return normalizeNoteType(String(current ?? '')) !== normalizeNoteType(next);
}

const headingKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type TypeChangeResult = {
  /** Editor texts for the new type: every new heading, plus the carried-over section when needed */
  texts: Record<string, string>;
  /** Heading of the carried-over section (null when everything mapped) */
  carriedHeading: string | null;
  /** Old headings whose text moved into a new section */
  kept: string[];
  /** Old headings whose text went to the carried-over section */
  carried: string[];
};

/**
 * Map the open note's sections (keyed by the old template's headings) onto the new template.
 * Empty sections are dropped; an earlier carried-over section is carried again (its own label kept).
 */
export function remapSectionsForTypeChange(input: {
  fromType: string;
  toHeadings: readonly string[];
  texts: Record<string, string>;
}): TypeChangeResult {
  const out: Record<string, string> = {};
  for (const h of input.toHeadings) out[h] = '';
  const byKey = new Map(input.toHeadings.map((h) => [headingKey(h), h]));
  const kept: string[] = [];
  const carried: string[] = [];
  const carriedBlocks: string[] = [];
  for (const [heading, raw] of Object.entries(input.texts)) {
    const text = (raw || '').trim();
    if (!text) continue;
    const target = isCarriedOverHeading(heading)
      ? null
      : input.toHeadings.includes(heading)
        ? heading
        : byKey.get(headingKey(heading)) ?? null;
    if (target) {
      out[target] = out[target] ? `${out[target]}\n\n${text}` : text;
      kept.push(heading);
    } else {
      carriedBlocks.push(`${heading}\n${text}`);
      carried.push(heading);
    }
  }
  const carriedHeading = carriedBlocks.length ? carriedOverHeading(input.fromType) : null;
  if (carriedHeading) out[carriedHeading] = carriedBlocks.join('\n\n');
  return { texts: out, carriedHeading, kept, carried };
}

/**
 * A saved body: the template part and the carried-over sections after it (always composed last).
 * A carried-over section runs to the next carried-over heading or the end of the note.
 */
export function splitCarriedOver(body: string): { main: string; carried: { heading: string; text: string }[] } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => isCarriedOverHeading(l));
  if (start < 0) return { main: body, carried: [] };
  const carried: { heading: string; text: string }[] = [];
  let current: { heading: string; text: string[] } | null = null;
  for (const line of lines.slice(start)) {
    if (isCarriedOverHeading(line)) {
      if (current) carried.push({ heading: current.heading, text: current.text.join('\n').trim() });
      current = { heading: line.trim(), text: [] };
    } else current?.text.push(line);
  }
  if (current) carried.push({ heading: current.heading, text: current.text.join('\n').trim() });
  return { main: lines.slice(0, start).join('\n').trimEnd(), carried };
}

/**
 * Service code after a type change: structured templates start without one (the prescriber picks
 * it); a code the new type does not offer is cleared; an evaluation code (90791 / 90792) does not
 * stay on a non-intake note. Otherwise the code is kept.
 */
export function cptAfterTypeChange(currentCpt: string, toType: string, allowedCodes: readonly string[]): string {
  const code = (currentCpt || '').trim().toUpperCase();
  if (!code || asStructuredNoteType(toType)) return '';
  if (!allowedCodes.includes(code)) return '';
  if (EVALUATION_CODES.includes(code) && !INTAKE_NOTE_TYPES.includes(normalizeNoteType(toType))) return '';
  return code;
}

/**
 * Server rule for a type change (PATCH /api/notes/[id]): the new type must be a known template and
 * the note must still be unsigned (signed / locked / pending co-sign notes are corrected by addendum)
 * and not dismissed. Null = allowed.
 */
export function noteTypeChangeError(input: { toType: string; status: string; dismissed: boolean }): string | null {
  if (!isKnownNoteTypeValue(normalizeNoteType(input.toType))) return 'Unknown note type.';
  if (input.dismissed) return 'This note was dismissed. Undo the dismissal before changing it.';
  if (String(input.status).toLowerCase() !== 'draft') return 'Only an unsigned note can change type. Signed notes are corrected with an addendum.';
  return null;
}
