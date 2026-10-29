'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { FeeItem, FeeQuote } from '@/lib/billing/feeSchedule';

export type FeeRow = FeeItem & { id: string };
export type FeeCode = { code: string; description: string; feeCents: number };
export type LineQuote = FeeQuote & { lineCpt: string };
export type QuoteContext = { telehealth: boolean; selfPay: boolean; child: boolean; itp: boolean };

export async function fetchFeeSchedule(opts: { activeOnly?: boolean } = {}) {
  const data = await apiJson<{ success: true; items: FeeRow[]; canEdit: boolean }>(
    `/api/billing/fee-schedule${opts.activeOnly ? '?active=1' : ''}`
  );
  return { items: Array.isArray(data.items) ? data.items : [], canEdit: Boolean(data.canEdit) };
}

export async function updateFeeItem(id: string, patch: Partial<Omit<FeeRow, 'id' | 'code' | 'baseCpt' | 'insuranceBillable' | 'source'>>) {
  const data = await apiJson<{ success: true; item: FeeRow }>(`/api/billing/fee-schedule/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return data.item;
}

/** Set the fee for a built-in code that has none (e.g. 99212). */
export async function createFeeForCode(code: string, feeCents: number) {
  const data = await apiJson<{ success: true; item: FeeRow }>('/api/billing/fee-schedule', {
    method: 'POST',
    body: JSON.stringify({ code, feeCents }),
  });
  return data.item;
}

export async function fetchFeeCodes() {
  const data = await apiJson<{ success: true; codes: FeeCode[] }>('/api/billing/fee-schedule/codes');
  return Array.isArray(data.codes) ? data.codes : [];
}

export async function quoteFees(input: {
  clientId?: string | null;
  serviceDate?: string | null;
  payer?: string | null;
  telehealth?: boolean;
  lines: { cpt: string; code?: string | null }[];
}) {
  return apiJson<{ success: true; context: QuoteContext; quotes: LineQuote[] }>('/api/billing/fee-schedule/quote', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Base CPTs in the org fee schedule ([] until loaded, or when the user can't read it). */
export function useFeeScheduleCodes(): FeeCode[] {
  const [codes, setCodes] = useState<FeeCode[]>([]);
  useEffect(() => {
    let alive = true;
    fetchFeeCodes()
      .then((c) => {
        if (alive) setCodes(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return codes;
}
