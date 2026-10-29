/**
 * Shared response for the booking panel's "Billing codes" section (quote + saved plan views).
 * Server only. Prices come from the fee schedule only; suggestions are never applied.
 */
import type { FeeItem } from '@/lib/billing/feeSchedule';
import {
  addOnSuggestions,
  billingSectionOpenByDefault,
  canEditPlannedCodes,
  canOverrideCharge,
  canSetDiscount,
  normalizeCode,
  validatePlannedLines,
} from '@/lib/appointments/plannedCodes';
import { codeOptions, priceLines, type CodeContext } from '@/lib/appointments/plannedCodesDb';

export type QuoteLineInput = { code: string; units?: number; modifiers?: string[]; isAddOn?: boolean };

export function quoteResponse(
  role: string,
  opts: { isOwnAppointment: boolean; context: CodeContext; items: FeeItem[]; lines: QuoteLineInput[]; withOptions: boolean }
) {
  const lines = opts.lines.filter((l) => normalizeCode(l.code));
  const prices = priceLines(opts.items, opts.context.visit, lines);
  const primary = lines.find((l) => !l.isAddOn)?.code ?? opts.context.defaultPrimary;
  const check = validatePlannedLines(lines.map((l) => ({ code: l.code, units: l.units ?? 1, modifiers: l.modifiers ?? [], isAddOn: Boolean(l.isAddOn) })));
  return {
    success: true as const,
    context: opts.context,
    prices: prices.map((p, i) => ({ code: normalizeCode(lines[i].code), ...p })),
    suggestions: addOnSuggestions(primary, lines.filter((l) => l.isAddOn).map((l) => l.code)),
    check,
    permissions: {
      canEdit: canEditPlannedCodes(role, { isOwnAppointment: opts.isOwnAppointment }),
      canOverrideCharge: canOverrideCharge(role),
      canSetDiscount: canSetDiscount(role),
      openByDefault: billingSectionOpenByDefault(role),
    },
    ...(opts.withOptions ? { codeOptions: codeOptions(opts.items) } : {}),
  };
}
