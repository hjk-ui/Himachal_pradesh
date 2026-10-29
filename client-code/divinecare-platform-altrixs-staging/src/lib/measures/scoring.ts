/**
 * Scoring a patient's answers with the existing instrument scoring (pure). Same validation as
 * POST /api/clinical/assessments for a digital administration: every item answered with one of its
 * options. The result rows are what ClinicalAssessmentRecord / AssessmentItemAnswer store.
 */
import { instrumentById, isSendable, SAFETY_ITEMS } from './instruments';

export type Answers = Record<string, number>;

export type ScoredMeasure = {
  instrumentId: string;
  instrumentName: string;
  category: string;
  totalScore: number;
  severity: string;
  interpretation: string;
  /** Catalog safety flag OR a positive item-level safety item */
  safetyFlagged: boolean;
  safetyNotes: string | null;
  /** The instrument's item-level safety item scored above 0 (e.g. PHQ-9 item 9) */
  safetyItemPositive: boolean;
  safetyItemScore: number | null;
  answers: { itemId: string; questionText: string; scoreValue: number; selectedText: string | null; flagged: boolean }[];
};

export type ScoreError = { ok: false; instrumentId: string; error: 'not_sendable' | 'incomplete' | 'no_items' };

/** Items of a sendable instrument not answered with a valid option */
export function missingItems(instrumentId: string, answers: Answers | null | undefined): string[] {
  const i = instrumentById(instrumentId);
  if (!i?.questions) return [];
  return i.questions.filter((q) => !q.options.some((o) => o.score === answers?.[q.id])).map((q) => q.id);
}

const SAFETY_NOTE: Record<'link' | 'paper', string> = {
  link: 'Safety item endorsed by the patient on a measure link: clinician review required.',
  paper: 'Safety item endorsed on a paper form: clinician review required.',
};

/**
 * Item-level scoring with the instrument's own catalog scoring (no "sendable" rule): every item
 * answered with one of its options. Used for patient links (through scoreMeasure) and for paper
 * forms entered by staff (src/lib/measures/paper.ts), so both score exactly the same way.
 */
export function scoreItems(instrumentId: string, raw: Answers | null | undefined, via: 'link' | 'paper' = 'link'): { ok: true; scored: ScoredMeasure } | ScoreError {
  const i = instrumentById(instrumentId);
  if (!i || i.itemContentPending || !i.questions?.length) return { ok: false, instrumentId, error: 'no_items' };
  if (missingItems(instrumentId, raw).length) return { ok: false, instrumentId, error: 'incomplete' };
  // Only the instrument's own items (anything else in the payload is ignored)
  const answers: Answers = Object.fromEntries(i.questions.map((q) => [q.id, raw![q.id]]));
  const r = i.calculateResult(answers);
  const safetyItem = SAFETY_ITEMS[instrumentId];
  const safetyItemScore = safetyItem ? answers[safetyItem] ?? null : null;
  const safetyItemPositive = Boolean(safetyItem && (answers[safetyItem] ?? 0) > 0);
  const safetyFlagged = Boolean(r.safetyFlagged) || safetyItemPositive;
  return {
    ok: true,
    scored: {
      instrumentId,
      instrumentName: i.name,
      category: i.category,
      totalScore: r.totalScore,
      severity: r.severity,
      interpretation: r.interpretation,
      safetyFlagged,
      safetyNotes: r.safetyNotes ?? (safetyFlagged ? SAFETY_NOTE[via] : null),
      safetyItemPositive,
      safetyItemScore,
      answers: i.questions.map((q) => {
        const opt = q.options.find((o) => o.score === answers[q.id]);
        return {
          itemId: q.id,
          questionText: q.text,
          scoreValue: answers[q.id],
          selectedText: opt?.label ?? null,
          flagged: Boolean(opt?.flagged) || (q.id === safetyItem && answers[q.id] > 0),
        };
      }),
    },
  };
}

export function scoreMeasure(instrumentId: string, raw: Answers | null | undefined): { ok: true; scored: ScoredMeasure } | ScoreError {
  if (!isSendable(instrumentId)) return { ok: false, instrumentId, error: 'not_sendable' };
  return scoreItems(instrumentId, raw, 'link');
}

/** Score every instrument of a request; the first error stops (nothing is saved half-done) */
export function scoreRequest(instrumentIds: string[], answers: Record<string, Answers | undefined>): { ok: true; scored: ScoredMeasure[] } | ScoreError {
  const out: ScoredMeasure[] = [];
  for (const id of instrumentIds) {
    const r = scoreMeasure(id, answers[id]);
    if (r.ok === false) return r;
    out.push(r.scored);
  }
  return { ok: true, scored: out };
}
