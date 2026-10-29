/**
 * Valant aging DISPLAY presenter (pure; used by the API routes, the Valant Balances page and the chart card).
 *
 * Owner decision 2026-10-17: by default every Valant aging balance is SHOWN as "Over 120" days.
 * The stored buckets are never changed; each presented row carries both:
 *   - displayBucketsCents: what the columns show ([0, 0, 0, 0, total] when the setting is on)
 *   - valantBucketsCents:  the buckets exactly as Valant reported them
 * Report reconciliation always compares the ORIGINAL buckets to the Valant report totals.
 */

export const OVER_120_INDEX = 4;
export const OVER_120_NOTE = "Shown as Over 120 (practice setting). Valant's original buckets:";

export type PresentedBuckets = {
  displayBucketsCents: number[];
  valantBucketsCents: number[];
  totalCents: number;
  /** true when displayBucketsCents differs from Valant's buckets because of the setting */
  shownAsOver120: boolean;
};

/** One row (or party line) for display. Over 120 = the row's whole total. */
export function presentAgingBuckets(valantBucketsCents: readonly number[], totalCents: number, allOver120: boolean): PresentedBuckets {
  const valant = [0, 1, 2, 3, 4].map((i) => valantBucketsCents[i] ?? 0);
  if (!allOver120) return { displayBucketsCents: [...valant], valantBucketsCents: valant, totalCents, shownAsOver120: false };
  const display = [0, 0, 0, 0, 0];
  display[OVER_120_INDEX] = totalCents;
  return { displayBucketsCents: display, valantBucketsCents: valant, totalCents, shownAsOver120: true };
}

type Presentable = { displayBucketsCents: readonly number[]; valantBucketsCents: readonly number[]; totalCents: number };

export type PresentedTotals = {
  /** column sums of what is shown */
  displayBucketsCents: number[];
  /** column sums of Valant's original buckets */
  valantBucketsCents: number[];
  totalCents: number;
  /** ORIGINAL bucket sums vs the report's bucket totals (null when the report has no figure) */
  bucketsMatchReport: (boolean | null)[];
  /** grand total vs the report total (null when the report has no total) */
  totalMatchesReport: boolean | null;
};

/** Column totals for a set of presented rows, with reconciliation against the Valant report */
export function presentAgingTotals(
  rows: readonly Presentable[],
  report?: { bucketsCents?: readonly (number | null | undefined)[]; totalCents?: number | null }
): PresentedTotals {
  const display = [0, 0, 0, 0, 0];
  const valant = [0, 0, 0, 0, 0];
  let total = 0;
  for (const r of rows) {
    for (let i = 0; i < 5; i += 1) {
      display[i] += r.displayBucketsCents[i] ?? 0;
      valant[i] += r.valantBucketsCents[i] ?? 0;
    }
    total += r.totalCents;
  }
  const rb = report?.bucketsCents ?? [];
  return {
    displayBucketsCents: display,
    valantBucketsCents: valant,
    totalCents: total,
    bucketsMatchReport: valant.map((v, i) => (typeof rb[i] === 'number' ? rb[i] === v : null)),
    totalMatchesReport: typeof report?.totalCents === 'number' ? report.totalCents === total : null,
  };
}

/** Add presented rows into one (insurance "group by payer", combined patient = sum of party lines) */
export function sumPresented(rows: readonly Presentable[], allOver120: boolean): PresentedBuckets {
  const t = presentAgingTotals(rows);
  return { displayBucketsCents: t.displayBucketsCents, valantBucketsCents: t.valantBucketsCents, totalCents: t.totalCents, shownAsOver120: allOver120 };
}
