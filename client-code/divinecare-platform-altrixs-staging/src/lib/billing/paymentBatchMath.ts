/** Payment batch math (pure): integer cents and unique / idempotent batch numbers. */

/** Batch total vs line totals in integer cents (no float drift). */
export function batchCents(totalAmount: number, lines: Array<{ paid: number }>) {
  const totalCents = Math.round(totalAmount * 100);
  const lineCents = lines.map((l) => Math.round(l.paid * 100));
  const appliedCents = lineCents.reduce((t, c) => t + c, 0);
  return { totalCents, appliedCents, lineCents, balanced: totalCents === appliedCents };
}

/**
 * Batch number: derived from the idempotency key when one is sent (a retry finds the same batch),
 * else date + 10 random hex characters (never the last digits of a timestamp, which collide).
 */
export function bulkBatchNumber(
  organizationId: string,
  idempotencyKey: string | null,
  deps: { hash: (text: string) => string; random: () => string; now: Date }
): string {
  if (idempotencyKey) return `BATCH-${deps.hash(`${organizationId}:${idempotencyKey}`).slice(0, 16).toUpperCase()}`;
  return `BATCH-${deps.now.toISOString().slice(0, 10).replace(/-/g, '')}-${deps.random().toUpperCase()}`;
}
