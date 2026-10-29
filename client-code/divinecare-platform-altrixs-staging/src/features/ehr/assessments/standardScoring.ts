/**
 * Published scoring rules for instruments that are NOT read as one summed total against a band
 * (pure; browser-safe). Used by the catalog (calculateResult), so in-session entry, the patient
 * link, paper entry, the guide and print all score the same way.
 *
 *  - ASRS v1.1 screener, Part A (Kessler et al., 2005): positive when 4 or more of the 6 answers
 *    fall in the shaded boxes (items 1–3 at "Sometimes" or higher, items 4–6 at "Often" or higher).
 *  - DASS-21 / DASS-42 (Lovibond & Lovibond, 1995): three subscales. DASS-21 subscale = sum of its
 *    7 items x 2; DASS-42 subscale = sum of its 14 items. Same cutoffs for both.
 *  - MDQ (Hirschfeld et al., 2000): positive only with 7 or more of the 13 Part 1 items "yes",
 *    AND Part 2 (several at the same time) yes, AND Part 3 a moderate or serious problem.
 *
 * The stored total stays the raw item sum (history is comparable); the screen / subscale result is
 * in the severity and interpretation. A total-only entry (paper or in-session score only) cannot be
 * screened: it says what is needed instead.
 */

type Answers = Record<string, number>;
type Result = { totalScore: number; severity: string; interpretation: string; safetyFlagged: boolean; subscales?: Record<string, number> };

/** Instruments scored by item pattern or subscale: no total-score band exists */
export const PATTERN_SCORED: ReadonlySet<string> = new Set(['asrs', 'mdq', 'dass-21', 'dass-42']);

const isTotalOnly = (a: Answers) => Object.prototype.hasOwnProperty.call(a, '__total');
const rawSum = (a: Answers) => Object.values(a).reduce((s, v) => s + (Number(v) || 0), 0);

// ─── ASRS v1.1 Part A ─────────────────────────────────────────────────────────

/** Lowest answer in the shaded box per item (Never 0, Rarely 1, Sometimes 2, Often 3, Very Often 4) */
export const ASRS_SHADED_FROM: Readonly<Record<string, number>> = Object.freeze({ q1: 2, q2: 2, q3: 2, q4: 3, q5: 3, q6: 3 });
export const ASRS_POSITIVE_COUNT = 4;
export const ASRS_TOTAL_ONLY = 'Shaded count needed for screening';

export function asrsShadedCount(answers: Answers): number {
  return Object.entries(ASRS_SHADED_FROM).filter(([q, min]) => (answers[q] ?? -1) >= min).length;
}

export function calculateAsrsResult(answers: Answers): Result {
  if (isTotalOnly(answers)) {
    const t = Number(answers.__total) || 0;
    return {
      totalScore: t,
      severity: ASRS_TOTAL_ONLY,
      interpretation: `ASRS-v1.1 Part A total ${t}. ${ASRS_TOTAL_ONLY}: enter the six item responses (positive when ${ASRS_POSITIVE_COUNT} or more fall in the shaded boxes).`,
      safetyFlagged: false,
    };
  }
  const n = asrsShadedCount(answers);
  const positive = n >= ASRS_POSITIVE_COUNT;
  return {
    totalScore: rawSum(answers),
    severity: `${positive ? 'Screen Positive' : 'Screen Negative'} (${n} of 6 shaded)`,
    interpretation: `ASRS-v1.1 Part A: ${n} of 6 answers in the shaded boxes. ${positive ? 'Positive screen: symptoms highly consistent with adult ADHD; a full clinical assessment is needed.' : 'Negative screen.'}`,
    safetyFlagged: false,
    subscales: { shaded: n },
  };
}

// ─── DASS-21 / DASS-42 ────────────────────────────────────────────────────────

export type DassScale = 'depression' | 'anxiety' | 'stress';
export const DASS_SCALES: readonly DassScale[] = ['depression', 'anxiety', 'stress'];
export const DASS_SCALE_NAME: Readonly<Record<DassScale, string>> = Object.freeze({ depression: 'Depression', anxiety: 'Anxiety', stress: 'Stress' });

/** Severity bands per subscale (DASS-42 scale; DASS-21 sums are doubled first). Max 42 per subscale. */
export const DASS_BANDS: Readonly<Record<DassScale, readonly { min: number; max: number; label: string }[]>> = Object.freeze({
  depression: [
    { min: 0, max: 9, label: 'Normal' }, { min: 10, max: 13, label: 'Mild' }, { min: 14, max: 20, label: 'Moderate' },
    { min: 21, max: 27, label: 'Severe' }, { min: 28, max: 42, label: 'Extremely Severe' },
  ],
  anxiety: [
    { min: 0, max: 7, label: 'Normal' }, { min: 8, max: 9, label: 'Mild' }, { min: 10, max: 14, label: 'Moderate' },
    { min: 15, max: 19, label: 'Severe' }, { min: 20, max: 42, label: 'Extremely Severe' },
  ],
  stress: [
    { min: 0, max: 14, label: 'Normal' }, { min: 15, max: 18, label: 'Mild' }, { min: 19, max: 25, label: 'Moderate' },
    { min: 26, max: 33, label: 'Severe' }, { min: 34, max: 42, label: 'Extremely Severe' },
  ],
});

/** Standard item assignment (1-based item numbers) */
export const DASS21_ITEMS: Readonly<Record<DassScale, readonly number[]>> = Object.freeze({
  depression: [3, 5, 10, 13, 16, 17, 21],
  anxiety: [2, 4, 7, 9, 15, 19, 20],
  stress: [1, 6, 8, 11, 12, 14, 18],
});
export const DASS42_ITEMS: Readonly<Record<DassScale, readonly number[]>> = Object.freeze({
  depression: [3, 5, 10, 13, 16, 17, 21, 24, 26, 31, 34, 37, 38, 42],
  anxiety: [2, 4, 7, 9, 15, 19, 20, 23, 25, 28, 30, 36, 40, 41],
  stress: [1, 6, 8, 11, 12, 14, 18, 22, 27, 29, 32, 33, 35, 39],
});
export const DASS_TOTAL_ONLY = 'Subscale scores needed for severity';

export function dassBand(scale: DassScale, score: number): string {
  return DASS_BANDS[scale].find((b) => score >= b.min && score <= b.max)?.label ?? DASS_BANDS[scale][DASS_BANDS[scale].length - 1].label;
}

export function dassSubscales(answers: Answers, version: 21 | 42): Record<DassScale, number> {
  const items = version === 21 ? DASS21_ITEMS : DASS42_ITEMS;
  const mult = version === 21 ? 2 : 1;
  const sum = (ns: readonly number[]) => ns.reduce((s, n) => s + (Number(answers[`q${n}`]) || 0), 0) * mult;
  return { depression: sum(items.depression), anxiety: sum(items.anxiety), stress: sum(items.stress) };
}

export function calculateDassResult(version: 21 | 42) {
  const name = `DASS-${version}`;
  return (answers: Answers): Result => {
    if (isTotalOnly(answers)) {
      const t = Number(answers.__total) || 0;
      return {
        totalScore: t,
        severity: DASS_TOTAL_ONLY,
        interpretation: `${name} total ${t}. ${DASS_TOTAL_ONLY}: severity is read per subscale (Depression, Anxiety, Stress); enter the item responses.`,
        safetyFlagged: false,
      };
    }
    const sub = dassSubscales(answers, version);
    const parts = DASS_SCALES.map((k) => `${DASS_SCALE_NAME[k]}: ${dassBand(k, sub[k])} (${sub[k]})`);
    return {
      totalScore: rawSum(answers),
      severity: parts.join(' · '),
      interpretation: `${name} subscales${version === 21 ? ' (item sums × 2)' : ''}: ${parts.join('; ')}.`,
      safetyFlagged: false,
      subscales: sub,
    };
  };
}

// ─── MDQ ──────────────────────────────────────────────────────────────────────

export const MDQ_PART1_ITEMS = 13;
export const MDQ_PART1_POSITIVE = 7;
/** Part 2: several at the same time (q14, Yes = 1). Part 3: problem (q15, moderate/serious = 1). */
export const MDQ_PART2_ITEM = 'q14';
export const MDQ_PART3_ITEM = 'q15';
export const MDQ_TOTAL_ONLY = 'Parts 2 and 3 required';

export function calculateMdqResult(answers: Answers): Result {
  if (isTotalOnly(answers)) {
    const t = Number(answers.__total) || 0;
    return {
      totalScore: t,
      severity: MDQ_TOTAL_ONLY,
      interpretation: `MDQ total ${t}. ${MDQ_TOTAL_ONLY}: a positive screen needs 7 or more Part 1 items yes, Part 2 yes and a moderate or serious problem (Part 3); enter the item responses.`,
      safetyFlagged: false,
    };
  }
  const yes = Array.from({ length: MDQ_PART1_ITEMS }, (_, i) => answers[`q${i + 1}`]).filter((v) => v === 1).length;
  const samePeriod = answers[MDQ_PART2_ITEM] === 1;
  const problem = (answers[MDQ_PART3_ITEM] ?? 0) >= 1;
  const positive = yes >= MDQ_PART1_POSITIVE && samePeriod && problem;
  return {
    totalScore: rawSum(answers),
    severity: positive ? 'Screen Positive' : 'Screen Negative',
    interpretation: `MDQ: ${yes} of 13 Part 1 items yes; several at the same time: ${samePeriod ? 'yes' : 'no'}; problem: ${problem ? 'moderate or serious' : 'none or minor'}. ${positive ? 'Positive screen for bipolar spectrum disorder: full assessment needed.' : 'Negative screen.'}`,
    safetyFlagged: false,
    subscales: { part1Yes: yes, part2: samePeriod ? 1 : 0, part3: problem ? 1 : 0 },
  };
}

// ─── WHO-5: percentage alongside the raw score ────────────────────────────────

export const WHO5_PERCENT_FACTOR = 4;

export function withWho5Percent(r: Result): Result {
  const pct = Math.round(r.totalScore * WHO5_PERCENT_FACTOR);
  return { ...r, interpretation: `WHO-5: raw ${r.totalScore}/25 (${pct}%). ${r.severity}.`, subscales: { ...(r.subscales ?? {}), percent: pct } };
}

/** Custom calculateResult per catalog id (pattern / subscale scored) */
export const STANDARD_SCORING: Readonly<Record<string, (answers: Answers) => Result>> = Object.freeze({
  asrs: calculateAsrsResult,
  mdq: calculateMdqResult,
  'dass-21': calculateDassResult(21),
  'dass-42': calculateDassResult(42),
});
