/**
 * ASAM six-dimension scores for a residential admission. Either all six dimensions were rated
 * (0-4 each) or the scores are null. A missing dimension is never filled with a default.
 */
export type AsamScores = { dim1: number; dim2: number; dim3: number; dim4: number; dim5: number; dim6: number };

export const ASAM_DIM_KEYS = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const;

function rating(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : null;
}

/** From the page's dimension array: all six rated -> scores, otherwise null. */
export function asamScoresFromDims(dims: ReadonlyArray<number | null | undefined>): AsamScores | null {
  if (dims.length !== 6) return null;
  const r = dims.map(rating);
  if (r.some((x) => x === null)) return null;
  const [dim1, dim2, dim3, dim4, dim5, dim6] = r as number[];
  return { dim1, dim2, dim3, dim4, dim5, dim6 };
}

/**
 * From a request body value. `absent` = not sent (null/undefined); `invalid` = sent but not all six
 * dimensions rated 0-4 (the route answers 400 rather than storing partial or defaulted scores).
 */
export function parseAsamScores(
  raw: unknown
): { kind: 'absent' } | { kind: 'invalid'; missing: string[] } | { kind: 'ok'; scores: AsamScores } {
  if (raw === null || raw === undefined) return { kind: 'absent' };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid', missing: [...ASAM_DIM_KEYS] };
  const obj = raw as Record<string, unknown>;
  const missing = ASAM_DIM_KEYS.filter((k) => rating(obj[k]) === null);
  if (missing.length) return { kind: 'invalid', missing };
  return { kind: 'ok', scores: asamScoresFromDims(ASAM_DIM_KEYS.map((k) => obj[k] as number))! };
}
