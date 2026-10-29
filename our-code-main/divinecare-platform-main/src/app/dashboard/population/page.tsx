'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiJson } from '@/lib/api-client';
import { useClients } from '@/features/clients';
import {
  type ActionItem,
  type PopulationClient,
  type PopulationHealthPayload,
  type RiskBucket,
  type Urgency,
  EMPTY_POPULATION_HEALTH,
  isPopulationHealthPayload,
  overlayLivePopulationCounts,
} from '@/features/analytics/populationHealthData';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Filter,
  TrendingDown,
  Users,
} from 'lucide-react';

const ACCENT = '#6868D0';

const RISK_THEME: Record<
  RiskBucket,
  { avatar: string; text: string; border: string; bg: string; soft: string }
> = {
  High: {
    avatar: '#DC2626',
    text: 'text-red-600',
    border: 'border-red-100',
    bg: 'bg-red-50',
    soft: '#FEE2E2',
  },
  Moderate: {
    avatar: '#D97706',
    text: 'text-amber-700',
    border: 'border-amber-100',
    bg: 'bg-amber-50',
    soft: '#FEF3C7',
  },
  Low: {
    avatar: '#16A34A',
    text: 'text-emerald-700',
    border: 'border-emerald-100',
    bg: 'bg-emerald-50',
    soft: '#DCFCE7',
  },
};

const URGENCY_THEME: Record<Urgency, { badge: string; avatar: string; label: string }> = {
  critical: { badge: 'bg-red-100 text-red-700', avatar: '#DC2626', label: 'Critical' },
  high: { badge: 'bg-amber-100 text-amber-800', avatar: '#D97706', label: 'High' },
  routine: { badge: 'bg-blue-100 text-blue-700', avatar: '#2563EB', label: 'Routine' },
};

function TrendSpark({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length === 0) return null;
  const w = 280;
  const h = 110;
  const pad = 16;
  const lo = Math.min(...values) - 0.5;
  const hi = Math.max(...values) + 0.5;
  const span = Math.max(hi - lo, 1);
  const denom = Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => {
    const x = pad + (i / denom) * (w - pad * 2);
    const y = h - pad - ((v - lo) / span) * (h - pad * 2);
    return { x, y, v };
  });
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="h-28 max-w-full">
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
          <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-slate-500" fontSize="9">
            {p.v}
          </text>
        </g>
      ))}
    </svg>
  );
}

async function loadPayload(): Promise<PopulationHealthPayload | null> {
  const res = await apiJson<{ success: true; data: unknown }>('/api/modules/population-health');
  return isPopulationHealthPayload(res.data) ? res.data : null;
}

async function savePayload(data: PopulationHealthPayload) {
  await fetch('/api/modules/population-health', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

function ClientChip({
  client,
  onOpen,
}: {
  client: PopulationClient;
  onOpen: () => void;
}) {
  const theme = RISK_THEME[client.risk];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-xl border ${theme.border} bg-white p-3 text-left shadow-sm transition hover:border-slate-300`}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: theme.avatar }}
        >
          {client.name.replace(/\./g, '').slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">{client.name}</span>
            <span className={`text-sm font-bold ${theme.text}`}>PHQ-9 {client.phq9}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">Last contact: {client.daysSinceContact} days ago</p>
          {client.riskNotes ? (
            <p className="mt-1 text-xs text-slate-600">{client.riskNotes}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function PopulationHealthPage() {
  const router = useRouter();
  const { clients, loading: clientsLoading } = useClients();
  const [payload, setPayload] = useState<PopulationHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [riskFilter, setRiskFilter] = useState<'all' | RiskBucket>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | Urgency>('all');
  const [expandHigh, setExpandHigh] = useState(false);
  const [expandMod, setExpandMod] = useState(false);
  const [expandLow, setExpandLow] = useState(false);
  const [expandedClinician, setExpandedClinician] = useState<string | null>(null);
  const [trendMeasure, setTrendMeasure] = useState<'PHQ-9' | 'GAD-7'>('PHQ-9');
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadPayload();
      // When stored data is missing, use clean EMPTY_POPULATION_HEALTH.
      // NEVER seed or write to the database during bootstrap / GET requests.
      setPayload(data ?? EMPTY_POPULATION_HEALTH);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load population health data');
      setPayload(EMPTY_POPULATION_HEALTH);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const data = useMemo(() => {
    return overlayLivePopulationCounts(payload ?? EMPTY_POPULATION_HEALTH, clients);
  }, [payload, clients]);

  const persist = async (next: PopulationHealthPayload) => {
    setPayload(next);
    await savePayload(next);
  };

  const highClients = useMemo(
    () => data.clients.filter((c) => c.risk === 'High'),
    [data.clients]
  );
  const modClients = useMemo(
    () => data.clients.filter((c) => c.risk === 'Moderate'),
    [data.clients]
  );
  const lowClients = useMemo(
    () => data.clients.filter((c) => c.risk === 'Low'),
    [data.clients]
  );

  const openActions = useMemo(
    () => data.actions.filter((a) => !a.done),
    [data.actions]
  );

  const filteredActions = useMemo(() => {
    return openActions.filter((a) => {
      if (urgencyFilter !== 'all' && a.urgency !== urgencyFilter) return false;
      if (riskFilter !== 'all') {
        const client = data.clients.find((c) => c.id === a.clientId);
        if (client && client.risk !== riskFilter) return false;
      }
      return true;
    });
  }, [openActions, urgencyFilter, riskFilter, data.clients]);

  const trend = trendMeasure === 'PHQ-9' ? data.phq9Trend : data.gad7Trend;
  const trendDelta =
    trend.length >= 2 && trend[0].value > 0
      ? Math.round(((trend[trend.length - 1].value - trend[0].value) / trend[0].value) * 1000) / 10
      : 0;

  const exportReport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `population-health-${data.updatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Report exported');
  };

  const markDone = async (id: string) => {
    const next = {
      ...data,
      updatedAt: new Date().toISOString(),
      actions: data.actions.map((a) => (a.id === id ? { ...a, done: true } : a)),
    };
    await persist(next);
    flash('Action completed');
  };

  const runAction = async (item: ActionItem, href: string, label: string) => {
    await markDone(item.id);
    flash(label);
    router.push(href);
  };

  if (loading || (clientsLoading && !payload)) {
    return (
      <div className="w-full space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Population Health</h1>
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-16 text-center shadow-sm">
          <Activity className="mx-auto h-8 w-8 animate-pulse text-indigo-500" />
          <p className="mt-3 text-sm font-medium text-slate-700">Loading population health data…</p>
          <p className="text-xs text-slate-400">Retrieving active caseload metrics</p>
        </div>
      </div>
    );
  }

  const preview = (list: PopulationClient[], n: number, expanded: boolean) =>
    expanded ? list : list.slice(0, n);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Population Health</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Risk stratification, engagement tracking, and outcome trends across your entire caseload.
          </p>
          {toast ? <p className="mt-1 text-sm font-medium text-emerald-600">{toast}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowFilter((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Filter size={15} /> Filter Caseload
          </button>
          <button
            type="button"
            onClick={exportReport}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{ background: ACCENT }}
          >
            <BarChart3 size={15} /> Export Report
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-semibold">Stored population health data unavailable</p>
              <p className="text-xs text-amber-700">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      ) : null}

      {showFilter ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          {(['all', 'High', 'Moderate', 'Low'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRiskFilter(r)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                riskFilter === r ? 'text-white' : 'bg-slate-100 text-slate-600'
              }`}
              style={riskFilter === r ? { background: ACCENT } : {}}
            >
              {r === 'all' ? 'All risk' : r}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: 'Active Caseload',
            value: String(data.activeCaseload),
            sub: data.activeCaseload === 1 ? '1 client enrolled' : `${data.activeCaseload} clients enrolled`,
            icon: Users,
            color: ACCENT,
            bg: '#E0E2FC',
          },
          {
            label: 'High Risk',
            value: String(data.highRiskCount),
            sub: data.highRiskCount > 0 ? 'require immediate attention' : 'no high-risk clients flagged',
            icon: AlertTriangle,
            color: '#DC2626',
            bg: '#FEE2E2',
            danger: data.highRiskCount > 0,
          },
          {
            label: 'Avg PHQ-9',
            value: data.avgPhq9 > 0 ? data.avgPhq9.toFixed(1) : '—',
            sub: data.avgPhq9 > 0 ? 'clinical average' : 'awaiting clinical assessments',
            icon: TrendingDown,
            color: '#16A34A',
            bg: '#DCFCE7',
            trend:
              data.avgPhq9 > 0 && data.priorAvgPhq9 > 0
                ? data.avgPhq9 < data.priorAvgPhq9
                  ? `↓ from ${data.priorAvgPhq9.toFixed(1)}`
                  : `↑ from ${data.priorAvgPhq9.toFixed(1)}`
                : undefined,
          },
          {
            label: 'Engagement Rate',
            value: data.engagementRate > 0 ? `${data.engagementRate}%` : '—',
            sub: data.engagementRate > 0 ? 'check-in + appt adherence' : 'awaiting activity data',
            icon: Activity,
            color: ACCENT,
            bg: '#E0E2FC',
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div
              className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: s.bg, color: s.color }}
            >
              <s.icon size={20} />
            </div>
            <p className={`text-2xl font-semibold ${s.danger ? 'text-red-600' : 'text-slate-900'}`}>
              {s.value}
            </p>
            {'trend' in s && s.trend ? (
              <p className="text-xs font-semibold text-emerald-600">{s.trend}</p>
            ) : null}
            <p className="mt-0.5 text-sm font-semibold text-slate-800">{s.label}</p>
            <p className="text-xs text-slate-500">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Risk Stratification */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Risk Stratification</h2>
          <span className="text-xs text-slate-500">{data.activeCaseload} active clients</span>
        </div>
        {data.activeCaseload === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">No Active Clients Enrolled</p>
            <p className="text-xs text-slate-500">
              When clients are added and risk levels are assigned, risk stratification will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {(
              [
                {
                  risk: 'High' as const,
                  count: data.highRiskCount,
                  list: highClients,
                  expanded: expandHigh,
                  setExpanded: setExpandHigh,
                  previewN: 4,
                },
                {
                  risk: 'Moderate' as const,
                  count: data.moderateCount,
                  list: modClients,
                  expanded: expandMod,
                  setExpanded: setExpandMod,
                  previewN: 3,
                },
                {
                  risk: 'Low' as const,
                  count: data.lowCount,
                  list: lowClients,
                  expanded: expandLow,
                  setExpanded: setExpandLow,
                  previewN: 3,
                },
              ] as const
            )
              .filter((col) => riskFilter === 'all' || riskFilter === col.risk)
              .map((col) => {
                const theme = RISK_THEME[col.risk];
                const shown = preview(col.list, col.previewN, col.expanded);
                return (
                  <div key={col.risk} className={`rounded-xl border ${theme.border} ${theme.bg} p-4`}>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className={`font-semibold ${theme.text}`}>{col.risk} Risk</h3>
                      <span className={`text-xs font-bold ${theme.text}`}>{col.count} clients</span>
                    </div>
                    {col.list.length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-400">
                        No clients in {col.risk.toLowerCase()} risk category.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {shown.map((c) => (
                          <ClientChip
                            key={c.id}
                            client={c}
                            onOpen={() => {
                              flash(`${c.name} · ${c.clinician || 'Unassigned'}`);
                              router.push('/dashboard/clients');
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {col.list.length > col.previewN ? (
                      <button
                        type="button"
                        onClick={() => col.setExpanded(!col.expanded)}
                        className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${theme.text}`}
                      >
                        {col.expanded ? 'Show less' : `View all ${col.count} ${col.risk.toLowerCase()}-risk clients`}
                        {col.expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    ) : null}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Action Required */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} style={{ color: ACCENT }} />
            <h2 className="text-lg font-semibold text-slate-900">Action Required</h2>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
              {filteredActions.length} items
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Filter by urgency</span>
            {(['all', 'critical', 'high', 'routine'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUrgencyFilter(u)}
                className={`rounded-full px-3 py-1 font-semibold capitalize ${
                  urgencyFilter === u ? 'text-white' : 'bg-slate-100 text-slate-600'
                }`}
                style={urgencyFilter === u ? { background: ACCENT } : {}}
              >
                {u === 'all' ? 'All' : u}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {filteredActions.map((item) => {
            const u = URGENCY_THEME[item.urgency];
            const critical = item.urgency === 'critical';
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: u.avatar }}
                >
                  {item.clientName.replace(/\./g, '').slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{item.clientName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${u.badge}`}>
                      {u.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">{item.title}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runAction(item, item.primaryHref, item.primaryAction)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                      critical
                        ? 'border border-red-300 text-red-700 hover:bg-red-50'
                        : 'text-white'
                    }`}
                    style={critical ? undefined : { background: ACCENT }}
                  >
                    {item.primaryAction}
                  </button>
                  {item.secondaryAction && item.secondaryHref ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(item, item.secondaryHref!, item.secondaryAction!)
                      }
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                        critical
                          ? 'border-red-300 text-red-700 hover:bg-red-50'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {item.secondaryAction}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {filteredActions.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No open actions in this filter.</p>
          ) : null}
        </div>
      </div>

      {/* Aggregate Outcome Trends */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Aggregate Outcome Trends</h2>
              {trend.length >= 2 && trendDelta < 0 ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <TrendingDown size={13} /> Improving trend ({Math.abs(trendDelta)}% reduction)
                </span>
              ) : null}
            </div>
          </div>
          {data.phq9Trend.length > 0 || data.gad7Trend.length > 0 ? (
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {(['PHQ-9', 'GAD-7'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTrendMeasure(m)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    trendMeasure === m ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {data.phq9Trend.length === 0 && data.gad7Trend.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">No Outcome Trends Recorded</p>
            <p className="text-xs text-slate-500">
              Aggregate outcome trends will populate as clinical assessments (PHQ-9 and GAD-7) are administered over time.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {[
              {
                key: 'PHQ-9',
                title: 'AVG PHQ-9 SCORE ACROSS CASELOAD',
                points: data.phq9Trend,
                threshold: 'Threshold: 10+ = moderate depression',
                color: '#6868D0',
              },
              {
                key: 'GAD-7',
                title: 'AVG GAD-7 SCORE ACROSS CASELOAD',
                points: data.gad7Trend,
                threshold: 'Threshold: 10+ = moderate anxiety',
                color: '#16A34A',
              },
            ].map((chart) => {
              const delta =
                chart.points.length >= 2 && chart.points[0].value > 0
                  ? Math.round(
                      ((chart.points[chart.points.length - 1].value - chart.points[0].value) /
                        chart.points[0].value) *
                        1000
                    ) / 10
                  : 0;
              return (
                <div key={chart.key} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {chart.title}
                  </p>
                  {chart.points.length > 0 ? (
                    <>
                      <TrendSpark values={chart.points.map((p) => p.value)} color={chart.color} />
                      <div className="mt-1 flex justify-between px-1 text-[10px] text-slate-400">
                        {chart.points.map((p) => (
                          <span key={p.month}>{p.month}</span>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-500">{chart.threshold}</span>
                        {delta !== 0 ? (
                          <span className={`font-semibold ${delta < 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {delta}% trend
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="py-8 text-center text-xs text-slate-400">
                      No assessment points recorded for {chart.key}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Clinician Caseload Balance */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users size={18} style={{ color: ACCENT }} />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Clinician Caseload Balance</h2>
              <p className="text-xs text-slate-500">{data.clinicians.length} active clinicians</p>
            </div>
          </div>
        </div>
        {data.clinicians.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">No Clinician Caseloads Assigned</p>
            <p className="text-xs text-slate-500">
              Caseload distributions will appear here as providers are assigned to active clients.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3">Clinician</th>
                  <th className="px-3 py-3">Active Clients</th>
                  <th className="px-3 py-3">High Risk</th>
                  <th className="px-3 py-3">Avg PHQ-9</th>
                  <th className="px-3 py-3">Doc Current</th>
                  <th className="px-3 py-3">Capacity</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.clinicians.map((c) => {
                  const open = expandedClinician === c.id;
                  const docColor = c.docCurrent >= 95 ? '#16A34A' : '#D97706';
                  const capColor =
                    c.capacity === 'At capacity'
                      ? 'text-amber-700'
                      : c.capacity === 'Available (new)'
                        ? 'text-sky-600'
                        : 'text-emerald-600';
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/80"
                        onClick={() => setExpandedClinician(open ? null : c.id)}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
                              style={{ background: c.color }}
                            >
                              {c.initials}
                            </div>
                            <span className="text-sm font-semibold text-slate-900">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm font-semibold text-slate-800">{c.activeClients}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700">
                            {c.highRisk}
                          </span>
                        </td>
                        <td
                          className="px-3 py-3 text-sm font-semibold"
                          style={{ color: c.avgPhq9 >= 10 ? '#DC2626' : '#D97706' }}
                        >
                          {c.avgPhq9 > 0 ? c.avgPhq9.toFixed(1) : '—'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="w-28">
                            <div className="mb-1 flex justify-between text-xs">
                              <span className="font-semibold text-slate-700">{c.docCurrent}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${c.docCurrent}%`, background: docColor }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className={`px-3 py-3 text-sm font-semibold ${capColor}`}>{c.capacity}</td>
                        <td className="px-3 py-3 text-slate-400">
                          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-slate-50 bg-slate-50/50">
                          <td colSpan={7} className="px-5 py-3 text-sm text-slate-600">
                            {c.activeClients} active · {c.highRisk} high-risk · doc currency {c.docCurrent}%
                            .{' '}
                            <button
                              type="button"
                              className="font-semibold text-indigo-600 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push('/dashboard/analytics/productivity');
                              }}
                            >
                              Open Doc Productivity
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
