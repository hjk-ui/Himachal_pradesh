'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import {
  FORECAST_STATUS_META,
  fmtForecastDay,
  type AuthForecast,
  type AuthForecastSummary,
} from '@/lib/ai/authForecast/labels';

type ForecastResponse = { success: true; forecasts: AuthForecast[]; summary: AuthForecastSummary };

/**
 * Loads GET /api/billing/authorizations/forecast (optionally for one client). Roles without
 * prior-auth access get a 403: the hook then returns no forecasts and no error, so surfaces just
 * fall back to what they showed before.
 */
export function useAuthForecasts(clientId?: string) {
  const [forecasts, setForecasts] = useState<AuthForecast[]>([]);
  const [summary, setSummary] = useState<AuthForecastSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
    fetch(`/api/billing/authorizations/forecast${q}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 401 || res.status === 403) {
          setForecasts([]);
          setSummary(null);
          return;
        }
        const data = (await res.json().catch(() => null)) as ForecastResponse | { error?: string } | null;
        if (!res.ok || !data || !('forecasts' in data)) {
          setError((data as { error?: string } | null)?.error || 'Could not load the authorization forecast');
          return;
        }
        setForecasts(data.forecasts);
        setSummary(data.summary);
        setError(null);
      })
      .catch(() => live && setError('Could not load the authorization forecast'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [clientId, tick]);

  const byId = useMemo(() => new Map(forecasts.map((f) => [f.priorAuthId, f])), [forecasts]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { forecasts, byId, summary, loading, error, reload };
}

const TONE: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  slate: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export function AuthForecastPill({ forecast }: { forecast: AuthForecast }) {
  const meta = FORECAST_STATUS_META[forecast.status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${TONE[meta.tone]}`} title={forecast.statusDetail}>
      {meta.label}
      {forecast.status === 'runs_out' && forecast.projectedRunOut ? ` ${fmtForecastDay(forecast.projectedRunOut)}` : ''}
    </span>
  );
}

/** Compact forecast block: pace, run-out, renew-by */
export function AuthForecastDetail({ forecast }: { forecast: AuthForecast }) {
  const f = forecast;
  return (
    <div className="space-y-0.5 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-1.5">
        <AuthForecastPill forecast={f} />
        {f.renewalDraftedAt ? <span className="text-[11px] text-slate-500">Renewal drafted {fmtForecastDay(f.renewalDraftedAt)}</span> : null}
      </div>
      <p>
        {f.pacePerWeek}/week pace · {f.scheduledInWindow} scheduled · runs out {f.projectedRunOut ? fmtForecastDay(f.projectedRunOut) : 'not projected'}
      </p>
      {f.renewBy && f.status !== 'expired' ? (
        <p className={f.renewalDue ? 'font-semibold text-rose-700' : ''}>
          Renew by {fmtForecastDay(f.renewBy)} ({f.leadTimeDays}-day lead)
        </p>
      ) : null}
      <p className="text-[11px] text-slate-500">
        Used {f.visitsUsed} of {f.unitsApproved} (recorded {f.unitsRecorded}, attended {f.visitsAttended})
      </p>
    </div>
  );
}

/** Banner add-on: " · runs out Nov 3" when the forecast projects run-out before the end date */
export function AuthForecastBannerNote({ clientId, priorAuthId }: { clientId: string; priorAuthId: string }) {
  const { byId } = useAuthForecasts(clientId);
  const f = byId.get(priorAuthId);
  if (!f || f.status !== 'runs_out' || !f.projectedRunOut) return null;
  return (
    <span className="font-semibold text-rose-700" title={f.statusDetail}>
      {' '}· runs out ~{fmtForecastDay(f.projectedRunOut)}
    </span>
  );
}

export async function postRenewal(priorAuthId: string, action: 'draft' | 'record') {
  return apiJson<{
    success: true;
    renewalDraftedAt?: string;
    draft?: {
      text: string;
      justificationSource: 'ai' | 'template';
      fallbackReason: string | null;
      consent: string;
      warning: string | null;
      canRecord: boolean;
    };
  }>(`/api/billing/authorizations/forecast/${encodeURIComponent(priorAuthId)}/renewal`, { method: 'POST', body: JSON.stringify({ action }) });
}
