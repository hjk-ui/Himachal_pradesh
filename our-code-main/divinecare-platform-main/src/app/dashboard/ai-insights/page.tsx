'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiJson } from '@/lib/api-client';
import { useClients } from '@/features/clients/hooks/useClients';
import {
  type AiInsightsPayload,
  buildInsightsFromClients,
  isAiInsightsPayload,
} from '@/features/ehr/aiInsightsData';
import {
  Target,
  Shield,
  Brain,
  AlertCircle,
  BarChart3,
  RefreshCw,
  Download,
  TrendingDown,
  TrendingUp,
  Minus,
  Info,
  CheckCircle2,
} from 'lucide-react';

const URGENCY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: '#FEE2E2', text: '#DC2626', label: 'Critical' },
  high: { bg: '#FEF3C7', text: '#B45309', label: 'High' },
  medium: { bg: '#DBEAFE', text: '#5555B8', label: 'Medium' },
  low: { bg: '#EEF0FE', text: '#15803D', label: 'Low' },
};

const STAT_ICONS = [Target, Shield, Brain, AlertCircle];

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'worsening' || trend === 'down') return <TrendingDown size={14} className="text-red-500" />;
  if (trend === 'improving' || trend === 'up') return <TrendingUp size={14} className="text-blue-500" />;
  return <Minus size={14} className="text-slate-400" />;
}

function UrgencyIcon({ urgency }: { urgency: string }) {
  if (urgency === 'critical' || urgency === 'high') return <AlertCircle size={12} />;
  if (urgency === 'medium') return <BarChart3 size={12} />;
  return <CheckCircle2 size={12} />;
}

async function loadInsights(): Promise<AiInsightsPayload | null> {
  const res = await apiJson<{ success: true; data: unknown }>('/api/modules/ai-insights');
  return isAiInsightsPayload(res.data) ? res.data : null;
}

async function saveInsights(data: AiInsightsPayload) {
  await fetch('/api/modules/ai-insights', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

export default function AIInsightsPage() {
  const router = useRouter();
  const { clients, loading: clientsLoading } = useClients();
  const [tab, setTab] = useState<'predictions' | 'sentiment' | 'patterns' | 'report'>('predictions');
  const [payload, setPayload] = useState<AiInsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const stored = await loadInsights();
      const live = buildInsightsFromClients(
        clients.map((c) => ({
          id: c.id,
          name: c.name,
          risk: c.risk,
          mood: c.avgMood,
        }))
      );
      if (stored) {
        setPayload({
          ...stored,
          predictions: live.predictions,
          sentiment: live.sentiment,
          stats: live.stats,
          weeklyReport: {
            ...stored.weeklyReport,
            period: live.weeklyReport.period,
            summary: live.weeklyReport.summary,
            highlights: live.weeklyReport.highlights,
            recommendations: live.weeklyReport.recommendations,
          },
        });
      } else {
        // When stored data is missing, display live derived empty payload in-memory.
        // NEVER seed or write to the database during bootstrap or page loading!
        setPayload(live);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load AI insights');
      setPayload(buildInsightsFromClients([]));
    } finally {
      setLoading(false);
    }
  }, [clients]);

  useEffect(() => {
    if (clientsLoading) return;
    void bootstrap();
  }, [clientsLoading, bootstrap]);

  const rerunAnalysis = async () => {
    setRunning(true);
    try {
      const next = buildInsightsFromClients(
        clients.map((c) => ({
          id: c.id,
          name: c.name,
          risk: c.risk,
          mood: c.avgMood,
        }))
      );
      await saveInsights(next);
      setPayload(next);
      showToast('Analysis refreshed and saved');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Re-run failed');
    } finally {
      setRunning(false);
    }
  };

  const exportReport = () => {
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-insights-${payload.analyzedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report exported');
  };

  if (loading && !payload) {
    return (
      <div className="w-full space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">AI Insights</h1>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
          Loading AI insights…
        </p>
      </div>
    );
  }

  const data = payload || buildInsightsFromClients([]);
  const liveHighRisk = data.predictions.filter((p) => p.urgency === 'critical' || p.urgency === 'high').length;
  const liveImproving = data.predictions.filter((p) => p.trend === 'improving' || p.trend === 'up').length;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">AI Insights</h1>
            <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
              Powered by Amazon Bedrock
            </span>
          </div>
          <p className="text-sm text-slate-500">
            AI-driven risk predictions · Sentiment analysis · Pattern detection
          </p>
          {loadError ? <p className="mt-1 text-sm text-red-600">{loadError}</p> : null}
          {toast ? <p className="mt-1 text-sm font-medium text-emerald-600">{toast}</p> : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportReport}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <BarChart3 size={15} /> Export Report
          </button>
          <button
            type="button"
            onClick={() => void rerunAnalysis()}
            disabled={running}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
          >
            <RefreshCw size={15} className={running ? 'animate-spin' : ''} />{' '}
            {running ? 'Running…' : 'Re-run Analysis'}
          </button>
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-xl p-6 text-white"
        style={{ background: 'linear-gradient(135deg, #1A0A2E 0%, #6868D0 50%, #6868D0 100%)' }}
      >
        <div className="absolute top-0 right-0 h-64 w-64 translate-x-32 -translate-y-32 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-semibold text-blue-300">AI ANALYSIS SUMMARY</p>
            <h2 className="mb-2 text-xl font-bold">{data.weeklyReport.period}</h2>
            <p className="max-w-xl text-sm leading-relaxed text-blue-100">{data.weeklyReport.summary}</p>
          </div>
          <div className="shrink-0 text-center">
            <p className="text-5xl font-semibold">
              {data.accuracy > 0 && clients.length > 0 ? (
                <>
                  {data.accuracy}
                  <span className="text-2xl">%</span>
                </>
              ) : (
                '—'
              )}
            </p>
            <p className="mt-1 text-xs text-blue-300">Prediction Accuracy</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            `${data.predictions.length} Predictions`,
            `${liveHighRisk} Elevated Risk`,
            `${liveImproving} Improving`,
            data.accuracy > 0 && clients.length > 0 ? `${data.accuracy}% Accuracy` : 'Model Calibrating',
          ].map((tag) => (
            <span key={tag} className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-medium">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {data.stats.map((s, i) => {
          const Icon = STAT_ICONS[i] || Target;
          return (
            <div key={s.label} className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div
                className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${s.color}18`, color: s.color }}
              >
                <Icon size={22} />
              </div>
              <p className="text-3xl font-semibold" style={{ color: s.color }}>
                {s.value}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">{s.label}</p>
              <p className="text-xs text-slate-400">{s.sub}</p>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex overflow-x-auto border-b border-slate-200/80">
          {(
            [
              { key: 'predictions' as const, label: 'Risk Predictions', icon: <Target size={14} /> },
              { key: 'sentiment' as const, label: 'Sentiment Analysis', icon: <Brain size={14} /> },
              { key: 'patterns' as const, label: 'Pattern Detection', icon: <BarChart3 size={14} /> },
              { key: 'report' as const, label: 'Weekly Report', icon: <BarChart3 size={14} /> },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-5 py-3.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-blue-600 bg-blue-50/50 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'predictions' && (
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-500">
              AI-generated 72-hour risk outlook based on check-in trends, journal sentiment, sleep
              patterns, and behavioral indicators.
            </p>
            {data.predictions.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                No risk predictions flagged yet. As clients are onboarded and complete check-ins, Amazon Bedrock will identify clinical risk indicators here.
              </p>
            ) : null}
            {data.predictions.map((p) => {
              const u = URGENCY_STYLES[p.urgency] || URGENCY_STYLES.medium;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-5 transition-colors ${
                    p.urgency === 'critical'
                      ? 'border-red-200 bg-red-50/30'
                      : p.urgency === 'high'
                        ? 'border-amber-200 bg-amber-50/20'
                        : 'border-slate-200/80'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                    >
                      {p.client.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">{p.client}</p>
                        <span
                          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: u.bg, color: u.text }}
                        >
                          <UrgencyIcon urgency={p.urgency} /> {u.label}
                        </span>
                        <span
                          className={`flex items-center gap-1 text-xs font-medium ${
                            p.trend === 'worsening' || p.trend === 'down'
                              ? 'text-red-600'
                              : p.trend === 'improving' || p.trend === 'up'
                                ? 'text-blue-600'
                                : 'text-slate-500'
                          }`}
                        >
                          <TrendIcon trend={p.trend} />
                          {p.trend === 'worsening' || p.trend === 'down'
                            ? 'Worsening'
                            : p.trend === 'improving' || p.trend === 'up'
                              ? 'Improving'
                              : 'Stable'}
                        </span>
                      </div>
                      <p className="mb-2 text-sm text-slate-700">{p.prediction}</p>
                      {typeof p.risk === 'number' && p.risk > 0 ? (
                        <div className="flex items-center gap-3">
                          <div className="h-2 flex-1 rounded-full bg-slate-100">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${p.risk}%`,
                                background:
                                  p.risk >= 80
                                    ? '#DC2626'
                                    : p.risk >= 60
                                      ? '#F97316'
                                      : p.risk >= 40
                                        ? '#FBBF24'
                                        : '#6868D0',
                              }}
                            />
                          </div>
                          <span
                            className="text-sm font-bold"
                            style={{
                              color:
                                p.risk >= 80
                                  ? '#DC2626'
                                  : p.risk >= 60
                                    ? '#F97316'
                                    : p.risk >= 40
                                      ? '#FBBF24'
                                      : '#6868D0',
                            }}
                          >
                            {p.risk}% risk
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">
                          Numerical risk probability score awaiting AI model calibration.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        router.push(p.href);
                        showToast(p.action);
                      }}
                      className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium text-white"
                      style={{
                        background:
                          p.urgency === 'critical'
                            ? '#DC2626'
                            : p.urgency === 'high'
                              ? '#B45309'
                              : '#6868D0',
                      }}
                    >
                      {p.action}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'sentiment' && (
          <div className="p-6">
            <p className="mb-5 text-sm text-slate-500">
              NLP analysis of client journal entries and check-in notes. Sentiment scored 0–100 (0 =
              very negative, 100 = very positive).
            </p>
            {data.sentiment.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                No client sentiment data recorded yet. NLP sentiment analysis will automatically populate as clients log check-ins and journal entries.
              </p>
            ) : null}
            <div className="space-y-4">
              {data.sentiment.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-slate-200/80 p-4 transition-colors hover:border-slate-300"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                    >
                      {s.client[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-900">{s.client}</p>
                        <div className="flex items-center gap-2">
                          <TrendIcon trend={s.trend} />
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              s.score >= 70
                                ? 'bg-blue-50 text-blue-700'
                                : s.score >= 45
                                  ? 'bg-slate-100 text-slate-700'
                                  : s.score >= 25
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {s.today}
                          </span>
                        </div>
                      </div>
                      <div className="mb-1.5 h-2 w-full rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${s.score}%`,
                            background:
                              s.score >= 70
                                ? '#6868D0'
                                : s.score >= 45
                                  ? '#FBBF24'
                                  : s.score >= 25
                                    ? '#F97316'
                                    : '#EF4444',
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-400">Key words:</span>
                        {s.keywords.map((kw) => (
                          <span
                            key={kw}
                            className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                          >
                            {kw}
                          </span>
                        ))}
                        <span className="ml-auto text-xs font-bold text-slate-600">{s.score}/100</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-slate-200/80 bg-blue-50 p-4">
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-blue-800">
                <Info size={12} /> AI Disclaimer
              </p>
              <p className="text-xs text-blue-700">
                Sentiment analysis is an assistive tool to support clinical judgment — not a
                diagnostic instrument. Always verify AI findings with direct clinical assessment.
              </p>
            </div>
          </div>
        )}

        {tab === 'patterns' && (
          <div className="p-6">
            <p className="mb-5 text-sm text-slate-500">
              AI-identified behavioral and wellness patterns across your client population. Updated
              weekly.
            </p>
            {data.patterns.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                No behavioral patterns detected across active clients yet. Patterns will emerge as clinical documentation accumulates.
              </p>
            ) : null}
            <div className="space-y-4">
              {data.patterns.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200/80 p-5 transition-colors hover:border-slate-300"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            p.impact === 'high'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {p.impact} impact
                        </span>
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {p.category}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-slate-700">{p.insight}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(p.href)}
                      className="shrink-0 text-xs font-medium text-blue-600 hover:underline"
                    >
                      Take Action
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'report' && (
          <div className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-800">AI-Generated Weekly Report</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{data.weeklyReport.period}</span>
                <button
                  type="button"
                  onClick={exportReport}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  <Download size={12} /> Download
                </button>
              </div>
            </div>
            <div className="space-y-5">
              <div className="rounded-xl bg-slate-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">Executive Summary</h4>
                <p className="text-sm leading-relaxed text-slate-700">{data.weeklyReport.summary}</p>
              </div>
              <div>
                <h4 className="mb-3 text-sm font-semibold text-slate-700">Key Highlights</h4>
                {data.weeklyReport.highlights.length === 0 ? (
                  <p className="text-sm text-slate-500">No critical highlights for this period.</p>
                ) : (
                  <div className="space-y-2">
                    {data.weeklyReport.highlights.map((h, i) => (
                      <div key={i} className={`flex items-start gap-2 text-sm ${h.color}`}>
                        <span className="mt-0.5 font-bold">•</span>
                        <span className="text-slate-700">{h.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-3 text-sm font-semibold text-slate-700">AI Recommendations</h4>
                {data.weeklyReport.recommendations.length === 0 ? (
                  <p className="text-sm text-slate-500">No pending AI recommendations. Active client risk baseline is stable.</p>
                ) : (
                  <div className="space-y-2">
                    {data.weeklyReport.recommendations.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-blue-50/30 p-3"
                      >
                        <span className="text-sm font-bold text-blue-500">{i + 1}.</span>
                        <p className="text-sm text-slate-700">{r.text}</p>
                        <button
                          type="button"
                          onClick={() => router.push(r.href)}
                          className="ml-auto shrink-0 text-xs font-medium text-blue-600 hover:underline"
                        >
                          Act
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-slate-200/80 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-700">Previous Reports</h4>
                {data.weeklyReport.previousReports.length === 0 ? (
                  <p className="text-sm text-slate-500">No archived reports yet.</p>
                ) : (
                  <div className="space-y-2">
                    {data.weeklyReport.previousReports.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">{r.label}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setTab('report');
                            showToast(`Opened ${r.label}`);
                          }}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
