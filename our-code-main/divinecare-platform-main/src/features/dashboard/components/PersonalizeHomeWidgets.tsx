'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HeartPulse, Sparkles } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type Insight = {
  id: string;
  clientId: string;
  clientName: string;
  signal: string;
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
};

type InsightsPayload = {
  success: true;
  demoMode: boolean;
  roleKey?: string;
  insights: Insight[];
  summary: {
    atRisk: number;
    overdueNotes: number;
    improving: number;
    totalCaseload: number;
  };
};

function roleInsightCopy(roleKey?: string) {
  const key = (roleKey || '').toUpperCase();
  if (key.includes('PEER') || key.includes('CASE')) {
    return {
      healthTitle: 'Outreach Health',
      insightsTitle: 'Engagement Insights',
      empty: 'No outreach signals for this caseload yet.',
    };
  }
  if (key.includes('PSYCHIATR') || key.includes('NURSE') || key.includes('NP')) {
    return {
      healthTitle: 'Clinical Caseload Health',
      insightsTitle: 'Prescriber Care Insights',
      empty: 'No clinical insight signals for this caseload yet.',
    };
  }
  return {
    healthTitle: 'Caseload Health',
    insightsTitle: 'Personalized Care Insights',
    empty: 'No insight signals for this caseload yet.',
  };
}

const SEV: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-emerald-100 text-emerald-700',
};

export function PersonalizeHomeWidgets() {
  const [data, setData] = useState<InsightsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<InsightsPayload>('/api/personalize/caseload-insights', { method: 'POST' })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-400 shadow-sm">
          Loading caseload health…
        </div>
      </div>
    );
  }

  const copy = roleInsightCopy(data.roleKey);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <HeartPulse size={16} className="text-rose-600" />
            <h2 className="text-sm font-semibold text-slate-900">{copy.healthTitle}</h2>
          </div>
          {data.demoMode && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
              DEMO
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          {[
            { label: 'Caseload', value: data.summary.totalCaseload },
            { label: 'At risk', value: data.summary.atRisk },
            { label: 'Overdue notes', value: data.summary.overdueNotes },
            { label: 'Improving', value: data.summary.improving },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-500">{s.label}</p>
              <p className="text-xl font-bold text-slate-900">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#5C2D91]" />
            <h2 className="text-sm font-semibold text-slate-900">{copy.insightsTitle}</h2>
          </div>
          <Link href="/dashboard/clients" className="text-xs font-semibold text-[#5C2D91]">
            View caseload
          </Link>
        </div>
        <div className="divide-y divide-slate-50">
          {data.insights.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">{copy.empty}</p>
          ) : (
            data.insights.slice(0, 5).map((insight) => (
              <div key={insight.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {insight.clientName || insight.signal}
                    </p>
                    <p className="text-xs text-slate-500">{insight.signal}</p>
                    <p className="mt-1 text-xs text-slate-600">{insight.recommendation}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${SEV[insight.severity] || SEV.medium}`}
                  >
                    {insight.severity}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
