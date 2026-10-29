/**
 * AI section review in the note editor: per-section "Accept" instead of deleting each
 * "[AI DRAFT …]" marker by hand, and filling a scribe draft into the open note in place.
 * Pure, browser-safe.
 *
 * Rules (unchanged): every AI-filled section starts with AI_DRAFT_MARKER; the server refuses to sign
 * while any marker remains (workflow-store countAiDraftMarkers). "Accept" removes the marker from
 * that one section; "Accept all reviewed" removes it from every section the clinician has marked
 * reviewed (opened, read or edited). Editing a section's text below the marker also counts as review
 * and clears it. Nothing here signs: signing stays blocked until every AI section is accepted or
 * edited.
 */
import { AI_DRAFT_MARKER } from '@/lib/ai/noteDraftFormats';

/** True when the section text still carries the AI DRAFT marker. */
export function hasAiMarker(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.includes(AI_DRAFT_MARKER);
}

/** Section text without the marker (and the line break that followed it). */
export function stripAiMarker(text: string): string {
  return text
    .split(AI_DRAFT_MARKER)
    .join('')
    .replace(/^[ \t]*\r?\n/, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** Headings whose text still carries the marker, in the given order. */
export function aiSectionsPending(texts: Record<string, string>, order?: readonly string[]): string[] {
  const keys = order ? [...order, ...Object.keys(texts).filter((k) => !order.includes(k))] : Object.keys(texts);
  return keys.filter((h) => hasAiMarker(texts[h]));
}

/** "Accept": clear the marker for one section. Other sections are untouched. */
export function acceptSection(texts: Record<string, string>, heading: string): Record<string, string> {
  if (!hasAiMarker(texts[heading])) return texts;
  return { ...texts, [heading]: stripAiMarker(texts[heading]) };
}

/** "Accept all reviewed": clear the marker for each heading in `reviewed` (all pending when omitted). */
export function acceptAllSections(texts: Record<string, string>, reviewed?: Iterable<string>): Record<string, string> {
  const only = reviewed ? new Set(reviewed) : null;
  const out = { ...texts };
  for (const h of Object.keys(out)) if ((!only || only.has(h)) && hasAiMarker(out[h])) out[h] = stripAiMarker(out[h]);
  return out;
}

/**
 * Editing counts as review: when the clinician changed the words below the marker (not just
 * whitespace), the marker is cleared for that section. Returns `next` unchanged otherwise.
 */
export function clearMarkerIfEdited(prev: string, next: string): string {
  if (!hasAiMarker(prev) || !hasAiMarker(next)) return next;
  const norm = (t: string) => stripAiMarker(t).replace(/\s+/g, ' ').trim();
  return norm(prev) === norm(next) ? next : stripAiMarker(next);
}

/** Signing is allowed (as far as AI review goes) only when no section carries the marker. */
export function aiReviewComplete(texts: Record<string, string>): boolean {
  return aiSectionsPending(texts).length === 0;
}

/**
 * Fill a scribe draft into the open note in place. Only headings the note has receive text; empty
 * draft sections are skipped. A section the clinician left empty (or still at the template's default
 * text) takes the draft; a section the clinician already wrote in keeps their text and gets the
 * draft below it, so nothing typed is lost. Sections the AI never writes (risk, diagnoses …) are not
 * in the draft, so they are never touched.
 */
export function fillDraftInPlace(input: {
  current: Record<string, string>;
  drafted: Record<string, string>;
  /** Template default text per heading (sectionsToRecord of the blank template) */
  template?: Record<string, string>;
  headings: readonly string[];
}): { texts: Record<string, string>; filled: string[]; appended: string[] } {
  const out = { ...input.current };
  const filled: string[] = [];
  const appended: string[] = [];
  for (const h of input.headings) {
    const add = (input.drafted[h] || '').trim();
    if (!add) continue;
    const cur = (out[h] || '').trim();
    const tpl = (input.template?.[h] || '').trim();
    if (!cur || cur === tpl) {
      out[h] = add;
      filled.push(h);
    } else if (!cur.includes(add)) {
      out[h] = `${cur}\n\n${add}`;
      appended.push(h);
    }
  }
  return { texts: out, filled, appended };
}

export const ACCEPT_LABEL = 'Accept';
export const ACCEPT_ALL_LABEL = 'Accept all reviewed';
export const REVIEW_HELP =
  'AI-drafted sections are marked until you accept them. Read each one against the session, edit what is wrong (editing also accepts it), then Accept. Signing stays blocked until every AI section is accepted or edited.';
