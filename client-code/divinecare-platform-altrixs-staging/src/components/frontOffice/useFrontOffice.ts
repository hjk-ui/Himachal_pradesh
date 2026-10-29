'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { FoItemId, FoMarkStatus, FoRow, FrontOfficeDay } from '@/lib/frontOffice/types';

type State = { day: FrontOfficeDay | null; loading: boolean; error: string | null };

/** GET /api/appointments/front-office for a window (or one appointment) + mark / run-eligibility helpers. */
export function useFrontOffice(params: { date?: string | null; days?: number; location?: string | null; appointmentId?: string | null; enabled?: boolean }) {
  const { date, days = 1, location, appointmentId, enabled = true } = params;
  const [state, setState] = useState<State>({ day: null, loading: enabled, error: null });
  const [nonce, setNonce] = useState(0);
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  if (days !== 1) qs.set('days', String(days));
  if (location && location !== 'all') qs.set('location', location);
  if (appointmentId) qs.set('appointmentId', appointmentId);
  const url = `/api/appointments/front-office${qs.toString() ? `?${qs}` : ''}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    apiJson<{ day: FrontOfficeDay }>(url)
      .then((r) => {
        if (!cancelled) setState({ day: r.day, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ day: null, loading: false, error: err instanceof Error ? err.message : 'Could not load the huddle' });
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export async function markFrontOfficeItem(appointmentId: string, itemId: FoItemId, status: FoMarkStatus, reason: string | null) {
  return apiJson<{ data: { confirmed: boolean } }>('/api/appointments/front-office/checklist', {
    method: 'POST',
    body: JSON.stringify({ appointmentId, itemId, status, reason }),
  });
}

export async function unmarkFrontOfficeItem(appointmentId: string, itemId: FoItemId) {
  const qs = new URLSearchParams({ appointmentId, itemId });
  return apiJson<{ data: { removed: number } }>(`/api/appointments/front-office/checklist?${qs}`, { method: 'DELETE' });
}

/** One click "Run eligibility": the existing eligibility API for the visit's payer and date (staff-initiated only). */
export async function runEligibilityFor(row: Pick<FoRow, 'clientId' | 'payer' | 'date'>) {
  return apiJson<{ check: { status: string; payerName: string }; channel: string; mode: string }>('/api/eligibility/check', {
    method: 'POST',
    body: JSON.stringify({ clientId: row.clientId, payerName: row.payer || null, dos: row.date }),
  });
}

/** Deep link to the appointment on the schedule with its detail (and front-office panel) open. */
export function appointmentHref(row: Pick<FoRow, 'appointmentId' | 'date'>, focus?: string) {
  const qs = new URLSearchParams({ view: 'calendar', cal: 'day', d: row.date, appt: row.appointmentId });
  if (focus) qs.set('focus', focus);
  return `/dashboard/appointments?${qs}`;
}
