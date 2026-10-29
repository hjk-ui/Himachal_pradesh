/**
 * A completed PAPER measure entered by staff (pure). Scores with the same catalog scoring as the
 * in-session form and the patient link:
 *  - item responses -> scoreItems (scoring.ts), exactly what a patient link uses;
 *  - total only     -> scoreFromTotal (guide.ts), the same calculateResult run on the total.
 * Instruments read by item (C-SSRS, AIMS) need the items. Copyrighted forms with no items stored
 * (Y-BOCS, HAM-D, MADRS ...) take the total only. For a total-only PHQ-9 / PHQ-A / EPDS the safety
 * item (item 9 / item 10) is still required: it drives the safety alert whatever the total.
 */
import { instrumentById, SAFETY_ITEMS } from './instruments';
import { paperEntryMode, scoreFromTotal } from './guide';
import { scoreItems, type Answers, type ScoredMeasure } from './scoring';

export type PaperInput = {
  instrumentId: string;
  mode: 'items' | 'total';
  answers?: Answers | null;
  totalScore?: number | null;
  /** Total-only entry of an instrument with an item-level safety item (PHQ-9 item 9, EPDS item 10) */
  safetyItemScore?: number | null;
};

export type PaperResult = { ok: true; scored: ScoredMeasure } | { ok: false; error: string };

const MEAN_SCORED = new Set(['des-ii']);

export function scorePaperMeasure(input: PaperInput): PaperResult {
  const i = instrumentById(input.instrumentId);
  const mode = paperEntryMode(input.instrumentId);
  if (!i || mode === 'none') return { ok: false, error: 'This measure cannot be entered from paper (no scoring stored). File the scan under Documents.' };

  if (input.mode === 'items') {
    if (mode === 'total_only') return { ok: false, error: 'Only the total score can be entered for this measure.' };
    const r = scoreItems(input.instrumentId, input.answers, 'paper');
    if (r.ok === false) return { ok: false, error: r.error === 'incomplete' ? 'Answer every item from the paper form.' : 'This measure has no items stored.' };
    return { ok: true, scored: r.scored };
  }

  if (mode === 'items_only') return { ok: false, error: 'Enter the item responses for this measure (it is read by item, not by total).' };
  const total = input.totalScore;
  const max = i.maxScore ?? Infinity;
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0 || total > max) return { ok: false, error: `Enter a total between 0 and ${i.maxScore ?? 'the maximum'}.` };
  if (!MEAN_SCORED.has(i.id) && !Number.isInteger(total)) return { ok: false, error: 'Enter a whole-number total.' };

  const safetyItem = SAFETY_ITEMS[i.id];
  const question = safetyItem ? i.questions?.find((q) => q.id === safetyItem) : undefined;
  let safetyItemScore: number | null = null;
  if (safetyItem && question) {
    const v = input.safetyItemScore;
    if (typeof v !== 'number' || !question.options.some((o) => o.score === v)) {
      return { ok: false, error: `Enter the answer to item ${safetyItem.replace(/^q/, '')} (the safety item) from the form.` };
    }
    if (v > total) return { ok: false, error: 'The safety item cannot be higher than the total.' };
    safetyItemScore = v;
  }
  const r = scoreFromTotal(i.id, total);
  if (!r) return { ok: false, error: 'This measure cannot be scored from a total.' };
  const safetyItemPositive = (safetyItemScore ?? 0) > 0;
  const safetyFlagged = r.safetyFlagged || safetyItemPositive;
  const opt = question?.options.find((o) => o.score === safetyItemScore);
  return {
    ok: true,
    scored: {
      instrumentId: i.id,
      instrumentName: i.name,
      category: i.category,
      totalScore: r.totalScore,
      severity: r.severity,
      interpretation: r.interpretation + (safetyItemPositive ? ` Safety item ${safetyItem!.replace(/^q/, '')} endorsed (${safetyItemScore}).` : ''),
      safetyFlagged,
      safetyNotes: safetyFlagged ? 'Safety item endorsed on a paper form: clinician review required.' : null,
      safetyItemPositive,
      safetyItemScore,
      answers:
        question && safetyItemScore != null
          ? [{ itemId: question.id, questionText: question.text, scoreValue: safetyItemScore, selectedText: opt?.label ?? null, flagged: safetyItemPositive }]
          : [],
    },
  };
}

/** Label on the record and in the chart: "Paper — entered by <staff>" */
export function paperEnteredLabel(staffName: string | null | undefined): string {
  const name = (staffName ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  return `Paper — entered by ${name || 'staff'}`;
}

/** Record date from the date written on the form (YYYY-MM-DD): noon UTC so it never shifts a day */
export function paperAdministeredAt(day: string, now = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return null;
  if (d.getTime() > now.getTime() + 36 * 3_600_000) return null;
  return d;
}
