/**
 * AI documentation evidence for audit. Pure, browser-safe.
 *
 *  - At signing (before any transcript purge) the note keeps ProgressNote.aiProvenance: per section,
 *    how much the clinician changed the AI draft (normalized word-level Levenshtein, 0 = signed as
 *    drafted, 1 = fully rewritten), the withheld / weak / flagged counts, model id, prompt version,
 *    capture id and how the transcript-risk gate was satisfied. Shows an auditor the clinician
 *    reviewed and edited, without keeping the transcript.
 *  - Cloned-note check: each section is compared with the same section of the client's last 3
 *    signed notes (3-word shingles, Jaccard); above 0.8 the pre-sign check warns "This section is
 *    very similar to the note on <date>".
 */
import { structuredNoteSections } from '@/lib/ehr/noteTemplates';

const AI_MARKER_RE = /\[AI DRAFT[^\]]*\]\s*/gi;

export function words(text: string): string[] {
  return text
    .replace(AI_MARKER_RE, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Word-level Levenshtein distance / the longer length (0..1). Inputs capped at 1500 words. */
export function editRatio(draft: string, signed: string): number {
  const a = words(draft).slice(0, 1500);
  const b = words(signed).slice(0, 1500);
  if (!a.length && !b.length) return 0;
  if (!a.length || !b.length) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.round((prev[b.length] / Math.max(a.length, b.length)) * 100) / 100;
}

export type SectionEdit = { heading: string; editRatio: number; draftWords: number; signedWords: number };

/** Per AI-drafted section: draft text (scribe review) vs the signed body's section. */
export function sectionEditRatios(draftTexts: Record<string, string>, signedBody: string, noteType: string): SectionEdit[] {
  const signed = structuredNoteSections(noteType, signedBody);
  const text = (h: string) =>
    signed
      .filter((s) => s.title === h)
      .map((s) => s.text)
      .join('\n');
  return Object.entries(draftTexts)
    .filter(([, t]) => (t || '').trim())
    .map(([heading, t]) => ({ heading, editRatio: editRatio(t, text(heading)), draftWords: words(t).length, signedWords: words(text(heading)).length }));
}

export type AiProvenance = {
  captureId: string;
  draftId: string | null;
  modelId: string | null;
  promptVersion: string | null;
  format: string | null;
  counts: { sentences: number; withheld: number; weak: number; flagged: number };
  sections: SectionEdit[];
  /** Mean edit ratio over the drafted sections */
  overallEditRatio: number;
  riskGate: { findings: number; satisfiedBy: string | null };
  signedAt: string;
};

export function buildAiProvenance(input: {
  captureId: string;
  draft: { id: string; modelId: string; format: string; content: unknown } | null;
  signedBody: string;
  noteType: string;
  riskGate: { findings: number; satisfiedBy: string | null };
  signedAt: Date;
}): AiProvenance {
  const content = (input.draft?.content ?? {}) as { texts?: Record<string, string>; promptVersion?: string; counts?: Partial<AiProvenance['counts']>; withheld?: unknown[]; provenance?: { status?: string; flags?: unknown[] }[] };
  const sections = content.texts ? sectionEditRatios(content.texts, input.signedBody, input.noteType) : [];
  const prov = Array.isArray(content.provenance) ? content.provenance : [];
  const counts = {
    sentences: content.counts?.sentences ?? prov.length + (Array.isArray(content.withheld) ? content.withheld.length : 0),
    withheld: content.counts?.withheld ?? (Array.isArray(content.withheld) ? content.withheld.length : 0),
    weak: content.counts?.weak ?? prov.filter((p) => p.status === 'weak').length,
    flagged: content.counts?.flagged ?? prov.filter((p) => Array.isArray(p.flags) && p.flags.length).length,
  };
  return {
    captureId: input.captureId,
    draftId: input.draft?.id ?? null,
    modelId: input.draft?.modelId ?? null,
    promptVersion: content.promptVersion ?? null,
    format: input.draft?.format ?? null,
    counts,
    sections,
    overallEditRatio: sections.length ? Math.round((sections.reduce((t, s) => t + s.editRatio, 0) / sections.length) * 100) / 100 : 0,
    riskGate: input.riskGate,
    signedAt: input.signedAt.toISOString(),
  };
}

// ─── Cloned sections ────────────────────────────────────────────────────────

function shingles(w: string[], n = 3): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function shingledJaccard(a: string, b: string): number {
  const sa = shingles(words(a));
  const sb = shingles(words(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export const CLONE_SECTION_THRESHOLD = 0.8;
/** Sections shorter than this are template-length and expected to repeat */
export const CLONE_MIN_WORDS = 15;

export type SectionCloneWarning = { heading: string; similarity: number; priorDate: string };

/** Sections of this note that are > 0.8 similar to the same section of one of the prior signed notes. */
export function sectionCloneWarnings(input: { noteType: string; body: string; prior: { date: string; noteType: string | null; body: string }[] }): SectionCloneWarning[] {
  const mine = structuredNoteSections(input.noteType, input.body);
  const out: SectionCloneWarning[] = [];
  for (const s of mine) {
    if (words(s.text).length < CLONE_MIN_WORDS) continue;
    let best: SectionCloneWarning | null = null;
    for (const p of input.prior.slice(0, 3)) {
      const theirs = structuredNoteSections(p.noteType || input.noteType, p.body)
        .filter((x) => x.title === s.title)
        .map((x) => x.text)
        .join('\n');
      if (words(theirs).length < CLONE_MIN_WORDS) continue;
      const sim = shingledJaccard(s.text, theirs);
      if (sim > CLONE_SECTION_THRESHOLD && (!best || sim > best.similarity)) best = { heading: s.title, similarity: Math.round(sim * 100) / 100, priorDate: p.date };
    }
    if (best) out.push(best);
  }
  return out;
}
