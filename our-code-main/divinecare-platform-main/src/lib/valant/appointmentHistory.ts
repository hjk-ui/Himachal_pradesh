import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';

/**
 * Valant appointment HISTORY: past visits imported for the record only.
 * They are not schedule slots and not work to chase, so tasks / missing-note / worklists exclude them.
 */
export const VALANT_HISTORY_SOURCE = 'valant_history';

export const VALANT_HISTORY_NOTE = 'Imported from Valant appointment history';

/**
 * Prisma filter that excludes imported history. Use as `AND: [NOT_IMPORTED_HISTORY]`.
 * (`source: { not: 'valant_history' }` alone would also drop rows where source is NULL.)
 */
export const NOT_IMPORTED_HISTORY: Prisma.AppointmentWhereInput = {
  OR: [{ source: null }, { source: { not: VALANT_HISTORY_SOURCE } }],
};

export function isImportedHistory(appointment: { source?: string | null }): boolean {
  return appointment.source === VALANT_HISTORY_SOURCE;
}

/** Deterministic key, unique per organization: re-running an import cannot create the same visit twice. */
export function buildHistoryExternalKey(input: { chartId: string; startsAtIso: string; provider: string }): string {
  const digest = createHash('sha256')
    .update(`${input.chartId.trim().toUpperCase()}|${input.startsAtIso}|${input.provider.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
  return `valant_history:${digest}`;
}

/** "AB123456" → "AB****56" so console output never carries a full chart id. */
export function maskChartId(chartId: string | null | undefined): string {
  const id = (chartId || '').trim();
  if (!id) return '(none)';
  if (id.length <= 4) return '*'.repeat(id.length);
  return `${id.slice(0, 2)}${'*'.repeat(Math.min(6, id.length - 4))}${id.slice(-2)}`;
}
