/**
 * AI note drafting formats and safety markers. Client-safe (no server imports):
 * the Scribe and Session AI pages use the same section keys the API returns.
 */
import { NOTE_SECTIONS, normalizeNoteType, type NoteType } from '@/lib/ehr/noteTemplates';
import { CPT_CODES, POS_CODES } from '@/lib/constants/cpt';
import { mergeCptOptions } from '@/lib/billing/feeSchedule';

export const AI_NOTE_FORMATS = ['SOAP', 'DAP', 'BIRP', 'GIRP', 'PIE', 'SUD', 'Group', 'Intake'] as const;
export type AiNoteFormat = (typeof AI_NOTE_FORMATS)[number];

export const AI_NOTE_FORMAT_LABELS: Record<AiNoteFormat, string> = {
  SOAP: 'SOAP',
  DAP: 'DAP',
  BIRP: 'BIRP',
  GIRP: 'GIRP',
  PIE: 'PIE',
  SUD: 'SUD Progress',
  Group: 'Group',
  Intake: 'Intake',
};

/** Same marker the reference implementation (monorepo bedrockService) puts on every drafted section. */
export const AI_DRAFT_MARKER = '[AI DRAFT — Clinician review required before signing]';

/** Text the model must use for a section the input does not cover. */
export const NOT_ADDRESSED = 'Not addressed in session.';

/** Note type stored on the ProgressNote (Intake drafts are filed as a psychiatric/intake evaluation). */
export function aiFormatNoteType(format: AiNoteFormat): NoteType {
  return normalizeNoteType(format) as NoteType;
}

/** Section headings for a format; the API returns exactly these keys. */
export function aiFormatSections(format: AiNoteFormat): readonly string[] {
  return NOTE_SECTIONS[aiFormatNoteType(format)];
}

/** How many sections still carry the AI DRAFT marker (the clinician removes it after reviewing each one). */
export function countAiDraftMarkers(text: string): number {
  return text.split(AI_DRAFT_MARKER).length - 1;
}

/** Plain-text note body from the edited sections, in format order. */
export function composeSectionsBody(format: AiNoteFormat, sections: Record<string, string>): string {
  const headings = aiFormatSections(format);
  const extra = Object.keys(sections).filter((k) => !headings.includes(k));
  return [...headings, ...extra]
    .map((h) => `${h}\n${(sections[h] || '').trim()}`)
    .join('\n\n');
}

/**
 * CPT pick list: the built-in codes (src/lib/constants/cpt.ts) plus the base CPTs of the org fee
 * schedule (GET /api/billing/fee-schedule/codes), so e.g. 99212 / 99204 / 99205 are selectable.
 */
export function noteCptOptions(feeCodes: { code: string; description: string; feeCents: number }[] = []) {
  return mergeCptOptions(CPT_CODES, feeCodes).map((c) => ({ code: c.code, label: `${c.code} — ${c.desc}` }));
}

/** Built-in codes only (kept for existing imports; pickers use noteCptOptions with the fee schedule). */
export const NOTE_CPT_OPTIONS = noteCptOptions();
export const PLACE_OF_SERVICE_OPTIONS = POS_CODES.map((p) => ({ code: p.pos, label: `${p.pos} — ${p.desc}` }));
