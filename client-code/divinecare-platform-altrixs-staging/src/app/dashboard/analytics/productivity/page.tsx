'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiJson } from '@/lib/api-client';
import type { ClinicianDocMetrics } from '@/lib/analytics/visitDocumentation';
import { practiceToday } from '@/lib/time/practiceTime';
import {
  type DocProductivityPayload,
  type BarTone,
  DOC_PRODUCTIVITY_SEED,
  barToneFromHours,
  isDocProductivityPayload,
} from '@/features/analytics/docProductivityData';
import {
  AlertTriangle,
  Check,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Bell,
  RefreshCw,
  CalendarCheck,
  ShieldCheck,
} from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  LoadingState,
  Page,
  PageHeader,
  Section,
  StatCard,
  StatGrid,
  StatusBadge,
  TONE_SOFT,
  Tabs,
  cx,
  type Tone,
} from '@/components/ui';

const WEEKS = ['W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'Now'];
const WINDOW_OPTIONS = [7, 14, 30] as const;

// Severity ramps (Tailwind classes): red tone -> rose, orange -> amber, mixed -> amber to emerald, green -> emerald.
const BAR_PALETTES: Record<BarTone, string[]> = {
  red: ['bg-rose-200', 'bg-rose-300', 'bg-rose-400', 'bg-rose-500', 'bg-rose-600', 'bg-rose-700'],
  orange: ['bg-amber-200', 'bg-amber-300', 'bg-amber-400', 'bg-amber-500', 'bg-amber-600', 'bg-amber-700'],
  mixed: ['bg-amber-300', 'bg-amber-400', 'bg-emerald-300', 'bg-emerald-400', 'bg-emerald-500', 'bg-emerald-600'],
  green: ['bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400', 'bg-emerald-500', 'bg-emerald-600', 'bg-emerald-700'],
};

const overdueTone = (days: number): Tone => (days >= 5 ? 'danger' : 'warning');

/** Metrics are computed on the server from completed appointments + linked note signatures. */
async function fetchDocMetrics(days: number): Promise<ClinicianDocMetrics[]> {
  const res = await apiJson<{ success: true; clinicians: ClinicianDocMetrics[] }>(
    `/api/analytics/productivity/metrics?days=${days}`
  );
  return res.clinicians;
}

function ensureTrendShape(trend: (number | null)[]): number[] {
  if (!trend.length) {
    return [0, 0, 0, 0, 0, 0];
  }
  const padded = trend.map((v) => v ?? 0);
  while (padded.length < 6) padded.unshift(0);
  return padded.slice(-6);
}

/** Screenshot-style rising mini bars with severity colors. */
function MiniTrendBar({ trend, tone }: { trend: number[]; tone: BarTone }) {
  const values = ensureTrendShape(trend);
  const max = Math.max(...values, 1);
  const palette = BAR_PALETTES[tone];

  return (
    <div className="flex h-10 w-[4.75rem] items-end gap-[3px]">
      {values.map((v, i) => {
        const pct = v > 0 ? Math.max(22, Math.round((v / max) * 100)) : 4;
        return (
          <div
            key={i}
            className={cx('w-[7px] rounded-t-[3px] transition-all', palette[i] || palette[palette.length - 1])}
            style={{ height: `${pct}%` }}
            title={`${v}%`}
          />
        );
      })}
    </div>
  );
}

function ComplianceBadge({ rate }: { rate: number | null }) {
  if (rate === null) {
    return <StatusBadge tone="neutral">No sessions in window</StatusBadge>;
  }
  const tone: Tone = rate >= 95 ? 'success' : rate >= 85 ? 'warning' : 'danger';
  const label = rate >= 95 ? 'Excellent' : rate >= 85 ? 'Good' : 'Needs Attention';
  return (
    <StatusBadge tone={tone}>
      {rate}% — {label}
    </StatusBadge>
  );
}

async function loadPayload(): Promise<{ data: DocProductivityPayload | null; version?: string }> {
  const res = await apiJson<{ success: true; data: unknown; version?: string }>('/api/modules/doc-productivity');
  return { data: isDocProductivityPayload(res.data) ? res.data : null, version: res.version };
}

/** Versioned save; throws on a failed or conflicting write (never reports success it did not get). */
async function savePayload(data: DocProductivityPayload, version: string | undefined): Promise<string | undefined> {
  const res = await fetch('/api/modules/doc-productivity', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, version }),
  });
  const body = (await res.json().catch(() => ({}))) as { version?: string; error?: string };
  if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
  return body.version;
}

export default function ProductivityPage() {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Module state now only keeps "marked reminded" dates; metrics are never stored or seeded.
  const [payload, setPayload] = useState<DocProductivityPayload | null>(null);
  const [payloadVersion, setPayloadVersion] = useState<string | undefined>(undefined);
  const [metrics, setMetrics] = useState<ClinicianDocMetrics[]>([]);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_OPTIONS)[number]>(7);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    let cancelled = false;
    loadPayload()
      .then(({ data, version }) => {
        if (cancelled) return;
        setPayload(data ?? structuredClone(DOC_PRODUCTIVITY_SEED));
        setPayloadVersion(version);
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMetrics = useCallback(async (days: number) => {
    setMetricsError(null);
    try {
      setMetrics(await fetchDocMetrics(days));
    } catch (err) {
      setMetrics([]);
      setMetricsError(err instanceof Error ? err.message : 'Could not load documentation metrics');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadMetrics(windowDays).finally(() => setLoading(false));
  }, [loadMetrics, windowDays]);

  const clinicians = useMemo(
    () =>
      metrics
        .map((c) => ({
          clinicianId: c.clinicianId,
          clinicianName: c.clinicianName,
          role: c.role,
          sessionsThisWeek: c.sessions,
          notesSignedSameDay: c.signedSameDay,
          notesSigned24h: c.signedWithin24h,
          notesSigned72h: c.signedWithin72h,
          notesOverdue: c.overdue,
          avgHoursToSign: c.avgHoursToSign,
          complianceRate: c.complianceRate,
          weeklyTrend: c.weeklyTrend,
          lateNotes: c.lateNotes,
        }))
        .sort((a, b) => (b.avgHoursToSign ?? -1) - (a.avgHoursToSign ?? -1)),
    [metrics]
  );

  const remindedAt = useMemo(() => payload?.remindedAt ?? {}, [payload]);

  const totalSessions = clinicians.reduce((s, c) => s + c.sessionsThisWeek, 0);
  const totalOverdue = clinicians.reduce((s, c) => s + c.notesOverdue, 0);
  const totalOnTime = clinicians.reduce((s, c) => s + c.notesSigned72h, 0);
  // Practice compliance = all window visits signed within 72h / all window visits (not an average of averages).
  const avgCompliance = totalSessions > 0 ? Math.round((totalOnTime / totalSessions) * 100) : null;
  const allLate = clinicians
    .flatMap((c) => c.lateNotes.map((n) => ({ ...n, clinicianName: c.clinicianName })))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  /** Records that a reminder was given (outside Altrixs); no message is sent from this page. */
  const markReminded = async (clinicianId: string) => {
    if (!payload) {
      showToast('Reminder log has not loaded; reload the page');
      return;
    }
    const today = practiceToday();
    const next: DocProductivityPayload = {
      ...payload,
      updatedAt: new Date().toISOString(),
      remindersSent: Array.from(new Set([...(payload.remindersSent || []), clinicianId])),
      remindedAt: { ...(payload.remindedAt ?? {}), [clinicianId]: today },
    };
    try {
      const version = await savePayload(next, payloadVersion);
      setPayload(next);
      setPayloadVersion(version);
      showToast(`Marked reminded on ${today}`);
    } catch (err) {
      showToast(err instanceof Error ? `Not saved: ${err.message}` : 'Not saved');
    }
  };

  const refreshFromLive = async () => {
    setRefreshing(true);
    await loadMetrics(windowDays);
    setRefreshing(false);
  };

  const header = (
    <PageHeader
      title="Documentation Productivity"
      description="Completed visits and how soon their progress notes were signed (24h / 72h after the visit) — computed live"
      actions={
        <Button
          icon={<RefreshCw className={refreshing ? 'animate-spin' : ''} />}
          onClick={() => void refreshFromLive()}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    />
  );

  if (loading && metrics.length === 0 && !metricsError) {
    return (
      <Page>
        {header}
        <Card>
          <LoadingState label="Loading productivity metrics…" />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      {header}
      {metricsError ? <Alert tone="danger">{metricsError}</Alert> : null}
      {toast ? <Alert tone="success">{toast}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600">Window:</span>
        <Tabs
          variant="pill"
          label="Window"
          controlsPanels={false}
          value={String(windowDays)}
          onChange={(k) => setWindowDays(Number(k) as (typeof WINDOW_OPTIONS)[number])}
          items={WINDOW_OPTIONS.map((d) => ({ key: String(d), label: `Last ${d} days` }))}
        />
      </div>

      <StatGrid columns={4}>
        <StatCard label={`Completed Visits (last ${windowDays} days)`} value={totalSessions} icon={<CalendarCheck />} tone="brand" />
        <StatCard
          label="Practice Compliance"
          value={avgCompliance !== null ? `${avgCompliance}%` : '—'}
          icon={<ShieldCheck />}
          tone={avgCompliance === null ? 'neutral' : avgCompliance >= 95 ? 'success' : avgCompliance >= 85 ? 'warning' : 'danger'}
        />
        <StatCard label="Overdue Notes" value={totalOverdue} icon={<AlertTriangle />} tone={totalOverdue > 0 ? 'danger' : 'neutral'} />
        <StatCard
          label="Perfect Compliance"
          value={`${clinicians.filter((c) => c.complianceRate === 100).length} / ${clinicians.length}`}
          icon={<Check />}
          tone="success"
        />
      </StatGrid>

      {totalOverdue > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            icon={<AlertTriangle className="text-rose-700" />}
            title={`${totalOverdue} Overdue Notes Require Immediate Attention`}
          />
          <ul className="divide-y divide-slate-100">
            {allLate.map((n) => (
              <li key={n.noteId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-900">{n.patientName}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {n.sessionType} · {n.sessionDate}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge tone={overdueTone(n.daysOverdue)}>{n.daysOverdue}d overdue</StatusBadge>
                  <span className="text-xs text-slate-500">{n.clinicianName}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Section title="Clinician Breakdown">
        {clinicians.length === 0 && (
          <Card>
            <EmptyState title="No documentation activity yet. Metrics appear once clinicians sign progress notes." />
          </Card>
        )}
        {clinicians.map((c) => {
          const isExpanded = expanded === c.clinicianId;
          const trend = ensureTrendShape(c.weeklyTrend);
          const trendDelta = trend[trend.length - 1] - trend[trend.length - 2];
          const tone = barToneFromHours(c.avgHoursToSign ?? 0);
          const initials = c.clinicianName
            .split(' ')
            .filter((w) => /^[A-Za-z]/.test(w))
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          return (
            <Card key={c.clinicianId}>
              <button
                type="button"
                aria-expanded={isExpanded}
                className={cx('flex w-full items-center gap-4 rounded-xl px-5 py-4 text-left hover:bg-slate-50', FOCUS_RING)}
                onClick={() => setExpanded(isExpanded ? null : c.clinicianId)}
              >
                <div aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{c.clinicianName}</span>
                    <span className="text-xs text-slate-500">{c.role}</span>
                    {c.notesOverdue > 0 && (
                      <StatusBadge tone="danger" size="sm">
                        {c.notesOverdue} overdue
                      </StatusBadge>
                    )}
                  </div>
                  <div className="mt-1">
                    <ComplianceBadge rate={c.complianceRate} />
                  </div>
                </div>

                <div className="hidden shrink-0 items-center gap-6 text-center text-xs sm:flex">
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-slate-900">{c.sessionsThisWeek}</p>
                    <p className="text-slate-500">Sessions</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-slate-900">{c.avgHoursToSign === null ? '—' : `${c.avgHoursToSign}h`}</p>
                    <p className="text-slate-500">Avg to Sign</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <MiniTrendBar trend={trend} tone={tone} />
                    <div className="mt-1 flex items-center justify-center gap-0.5">
                      {trendDelta >= 0 ? (
                        <TrendingUp size={12} aria-hidden className="text-emerald-700" />
                      ) : (
                        <TrendingDown size={12} aria-hidden className="text-rose-700" />
                      )}
                      <span className={`text-[11px] font-semibold ${trendDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {trendDelta >= 0 ? '+' : ''}
                        {trendDelta}%
                      </span>
                    </div>
                  </div>
                </div>

                {isExpanded ? (
                  <ChevronUp size={16} aria-hidden className="shrink-0 text-slate-500" />
                ) : (
                  <ChevronDown size={16} aria-hidden className="shrink-0 text-slate-500" />
                )}
              </button>

              {isExpanded && (
                <div className="space-y-4 border-t border-slate-200 px-5 py-4">
                  <div className="flex items-end gap-6 sm:hidden">
                    <div>
                      <p className="text-lg font-semibold tabular-nums text-slate-900">{c.sessionsThisWeek}</p>
                      <p className="text-xs text-slate-500">Sessions</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums text-slate-900">{c.avgHoursToSign === null ? '—' : `${c.avgHoursToSign}h`}</p>
                      <p className="text-xs text-slate-500">Avg to Sign</p>
                    </div>
                    <MiniTrendBar trend={trend} tone={tone} />
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold text-slate-600">
                      Note Completion Breakdown — Last {windowDays} days ({c.sessionsThisWeek} visits)
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {(
                        [
                          { label: 'Same Day', value: c.notesSignedSameDay, tone: 'success' },
                          { label: 'Within 24h', value: c.notesSigned24h, tone: 'brand' },
                          { label: 'Within 72h', value: c.notesSigned72h, tone: 'warning' },
                          { label: 'Overdue', value: c.notesOverdue, tone: 'danger' },
                        ] as const
                      ).map((stat) => (
                        <div key={stat.label} className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset', TONE_SOFT[stat.tone])}>
                          <span className="text-base font-semibold tabular-nums">{stat.value}</span>
                          <span>{stat.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold text-slate-600">6-Week Compliance Trend</p>
                    <div className="flex h-16 items-end gap-2">
                      {trend.map((v, i) => (
                        <div key={i} className="flex flex-1 flex-col items-center gap-1">
                          <span className="text-[11px] text-slate-500">{v}%</span>
                          <div
                            className={cx('w-full rounded-t-lg', BAR_PALETTES[tone][i], i === 5 ? '' : 'opacity-90')}
                            style={{ height: `${Math.max(8, (v / 100) * 48)}px` }}
                          />
                          <span className="text-[11px] text-slate-500">{WEEKS[i]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {c.lateNotes.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-slate-600">Overdue Notes</p>
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                        {c.lateNotes.map((n) => (
                          <li key={n.noteId} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-900">{n.patientName}</p>
                              <p className="text-xs text-slate-500">
                                {n.sessionType} · {n.sessionDate}
                              </p>
                            </div>
                            <StatusBadge size="sm" tone={n.daysOverdue >= 5 ? 'danger' : 'warning'}>
                              {n.daysOverdue}d overdue
                            </StatusBadge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {c.notesOverdue > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Bell />}
                        onClick={() => void markReminded(c.clinicianId)}
                        title="Records that you reminded this clinician (no message is sent from Altrixs)"
                      >
                        Mark reminded
                      </Button>
                    )}
                    {remindedAt[c.clinicianId] && (
                      <StatusBadge tone="brand" icon={<Check />}>
                        Reminded {remindedAt[c.clinicianId]}
                      </StatusBadge>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/ehr/notes')}>
                      View All Notes
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </Section>
    </Page>
  );
}
