/**
 * Grounded one-section AI draft for the note editors ("Draft from dictation (AI)" in the structured
 * and therapist note editors). Pure, browser-safe; the route injects the Bedrock call.
 *
 * Same guardrail as the AI Scribe draft: the clinician's dictation / bullet points become numbered
 * lines (t1, t2 … via the paste parser, one speaker: the clinician); the model must cite a line on
 * every sentence; grounding.ts withholds any sentence with no citation, an unknown citation, or a
 * date / number / code / measure / medication its cited lines do not contain, and flags weak support.
 * Only supported and flagged sentences are inserted, under the AI DRAFT marker the clinician removes
 * after review. Withheld sentences are returned so the editor can say what was left out.
 */
import { AI_DRAFT_MARKER } from '@/lib/ai/noteDraftFormats';
import { checkDraftSentence, sourceMap, type CheckedSentence, type Source } from './grounding';
import { parsePastedText } from './paste';

export const SECTION_INPUT_MAX = 8000;

/** Dictation / bullet points → numbered source lines (bullets and sentences are separate lines). */
export function sectionSources(input: string): Source[] {
  const cleaned = input
    .slice(0, SECTION_INPUT_MAX)
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    // Each bullet is its own paragraph so a sentence cites the bullet that supports it
    .join('\n\n');
  const { segments } = parsePastedText(cleaned, { kind: 'summary', parseSpeakers: false });
  return segments.map((s, i) => ({ id: `t${i + 1}`, kind: 'transcript', text: s.text }));
}

export function buildSectionDraftSystemPrompt(input: { heading: string; noteLabel: string; scope: 'history' | 'narrative' }): string {
  const scope =
    input.scope === 'history'
      ? 'Draft the history narrative only; do not add findings, exam, assessment, risk, diagnoses or plan.'
      : 'Draft this narrative only; do not add findings, risk, diagnoses or plan.';
  return `You are a clinical documentation assistant for licensed behavioral health clinicians in Maryland (COMAR). You draft; the clinician reviews, edits and signs.
Write the "${input.heading}" section of a ${input.noteLabel} note from the clinician's numbered dictation lines. ${scope}
Rules:
- Use ONLY the numbered lines. Every sentence must cite at least one line id (t1, t2 …) that supports it. Never cite a line that does not say it.
- Never invent findings, quotes, mental status observations, risk statements, diagnoses, scores, dates, medications, doses, goals, progress or plans. Leave out anything the lines do not state (do not write "denies" or "within normal limits" unless a line says so).
- Clinical, third-person, past tense, concise.
Return one JSON object: {"sentences":[{"text":"...","cites":["t1"]}]}`;
}

export function buildSectionDraftUserPrompt(sources: Source[]): string {
  return `DICTATION LINES\n${sources.map((s) => `${s.id}: ${s.text}`).join('\n')}`;
}

export type SectionDraftResult = {
  /** Text to insert (marker + supported / flagged sentences); empty when nothing was supported */
  text: string;
  sentences: CheckedSentence[];
  withheld: CheckedSentence[];
  weak: number;
};

/** Parse the model reply and ground each sentence against only the lines it cites. Null when unreadable. */
export function groundSectionReply(reply: string, sources: Source[]): SectionDraftResult | null {
  let root: unknown;
  try {
    root = JSON.parse(reply);
  } catch {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      root = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!root || typeof root !== 'object') return null;
  const list = (root as { sentences?: unknown }).sentences;
  if (!Array.isArray(list)) return null;
  const map = sourceMap(sources);
  const checked = list
    .filter((s): s is { text?: unknown; cites?: unknown } => Boolean(s) && typeof s === 'object')
    .map((s) =>
      checkDraftSentence(
        { text: typeof s.text === 'string' ? s.text : '', cites: Array.isArray(s.cites) ? s.cites.filter((c): c is string => typeof c === 'string') : [] },
        map
      )
    );
  const usable = checked.filter((c) => c.status !== 'withheld');
  const body = usable.map((s) => s.text.trim().replace(/([^.!?])$/, '$1.')).join(' ');
  return {
    text: body ? `${AI_DRAFT_MARKER}\n${body}` : '',
    sentences: usable,
    withheld: checked.filter((c) => c.status === 'withheld'),
    weak: usable.filter((c) => c.status === 'weak').length,
  };
}
