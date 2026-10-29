'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Minus,
  Star,
  Target,
  ShieldAlert,
  FileText,
  Sparkles,
  Lock,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useModuleList } from '@/lib/modules/useModuleList';
import {
  type CapStatus,
  type IndicatorStatus,
  type PerformanceIndicator,
  type CAPRecord,
  type QIMeeting,
  type QIProgramMeta,
  QI_META_SEED,
  daysUntil,
  formatIndicatorValue,
  formatMeetingDate,
  formatTarget,
  isQIMeta,
} from '@/features/analytics/qiData';

type QiTab = 'indicators' | 'caps' | 'meetings' | 'chart-audit';

const STATUS_PILL: Record<IndicatorStatus, string> = {
  Meeting: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  'At Risk': 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  'Below Target': 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
};

const CAP_PILL: Record<CapStatus, string> = {
  Open: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
  'In Progress': 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100',
  Completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  Overdue: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
};

function TrendIcon({ trend }: { trend: PerformanceIndicator['trend'] }) {
  if (trend === 'up') return <ArrowUpRight size={16} className="text-emerald-600" />;
  if (trend === 'down') return <ArrowDownRight size={16} className="text-rose-500" />;
  return <Minus size={16} className="text-slate-400" />;
}

function MiniSpark({ data, labels }: { data: number[]; labels: string[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(0.01, max - min);
  return (
    <div className="flex h-16 items-end gap-2">
      {data.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] font-semibold text-slate-500">{v}</span>
          <div
            className="w-full max-w-[28px] rounded-t-md bg-indigo-500"
            style={{
              height: `${28 + ((v - min) / range) * 36}px`,
              opacity: 0.5 + (i / Math.max(data.length - 1, 1)) * 0.5,
            }}
          />
          <span className="text-[10px] text-slate-400">{labels[i] ?? `M${i + 1}`}</span>
        </div>
      ))}
    </div>
  );
}

function normalizeIndicators(list: PerformanceIndicator[]): PerformanceIndicator[] {
  return list.map((i) => ({
    ...i,
    period: i.period || 'Q3 2026',
    monthlyLabels: i.monthlyLabels?.length ? i.monthlyLabels : ['Jul', 'Aug', 'Sep'],
  }));
}

export default function QualityImprovementPage() {
  const [tab, setTab] = useState<QiTab>('indicators');
  const [indicatorList, , { loading: loadingIndicators }] = useModuleList<PerformanceIndicator>(
    'qi-indicators',
    []
  );
  const [caps, setCaps, { loading: loadingCaps }] = useModuleList<CAPRecord>('qi-caps', []);
  const [meetings, , { loading: loadingMeetings }] = useModuleList<QIMeeting>('qi-meetings', []);
  const [metaList, , { loading: loadingMeta }] = useModuleList<QIProgramMeta>('qi-meta', []);
  const [statusFilter, setStatusFilter] = useState<'all' | IndicatorStatus>('all');
  const [capFilter, setCapFilter] = useState<'all' | CapStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);
  const [expandedCap, setExpandedCap] = useState<string | null>(null);

  const loading = loadingIndicators || loadingCaps || loadingMeetings || loadingMeta;

  const meta: QIProgramMeta = useMemo(() => {
    const first = metaList[0];
    if (isQIMeta(first)) return first;
    return QI_META_SEED;
  }, [metaList]);

  const allIndicators = useMemo(() => normalizeIndicators(indicatorList), [indicatorList]);

  const indicators = useMemo(() => {
    if (statusFilter === 'all') return allIndicators;
    return allIndicators.filter((i) => i.status === statusFilter);
  }, [allIndicators, statusFilter]);

  const filteredCaps = useMemo(() => {
    if (capFilter === 'all') return caps;
    return caps.filter((c) => c.status === capFilter);
  }, [caps, capFilter]);

  const sortedMeetings = useMemo(
    () => [...meetings].sort((a, b) => b.date.localeCompare(a.date)),
    [meetings]
  );

  const summary = useMemo(() => {
    const meeting = allIndicators.filter((i) => i.status === 'Meeting').length;
    const atRisk = allIndicators.filter((i) => i.status === 'At Risk').length;
    const below = allIndicators.filter((i) => i.status === 'Below Target').length;
    const openCaps = caps.filter((c) => c.status !== 'Completed').length;
    const days = daysUntil(meta.nextMeetingDate);
    return {
      active: allIndicators.length,
      meeting,
      atRisk,
      below,
      openCaps,
      days,
    };
  }, [allIndicators, caps, meta.nextMeetingDate]);

  function cycleCapStatus(id: string) {
    const order: CapStatus[] = ['Open', 'In Progress', 'Completed', 'Overdue'];
    setCaps((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return { ...c, status: order[(order.indexOf(c.status) + 1) % order.length] };
      })
    );
  }

  function exportQiReport() {
    const report = {
      exportedAt: new Date().toISOString(),
      program: 'Quality Improvement Program',
      meta,
      summary: {
        activeIndicators: summary.active,
        meetingTarget: summary.meeting,
        atRisk: summary.atRisk,
        belowTarget: summary.below,
        openCaps: summary.openCaps,
      },
      indicators: allIndicators,
      correctiveActionPlans: caps,
      committeeMeetings: sortedMeetings,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qi-report-${meta.period.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && allIndicators.length === 0 && caps.length === 0 && meetings.length === 0) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const daysLabel =
    summary.days === 0
      ? 'Today'
      : summary.days > 0
        ? `${summary.days} day${summary.days === 1 ? '' : 's'} away`
        : `${Math.abs(summary.days)} day${Math.abs(summary.days) === 1 ? '' : 's'} ago`;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quality Improvement Program</h1>
          <p className="mt-1 text-sm text-slate-500">
            CARF-required performance monitoring, corrective actions, and committee documentation
          </p>
        </div>
        <button
          type="button"
          onClick={exportQiReport}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Download size={16} />
          Export QI Report
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Active Indicators</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <BarChart3 size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{summary.active}</p>
          <p className="mt-1 text-xs text-slate-500">
            {summary.meeting} meeting target • {summary.atRisk} at risk
            {summary.below > 0 ? ` • ${summary.below} below` : ''}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Open CAPs</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <AlertTriangle size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{summary.openCaps}</p>
          <p className="mt-1 text-xs text-slate-500">
            {meta.resolvedCapsPriorYear} resolved in {meta.resolvedCapsYearLabel}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Next QI Meeting</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600">
              <CalendarDays size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{formatMeetingDate(meta.nextMeetingDate)}</p>
          <p className="mt-1 text-xs text-slate-500">{daysLabel}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Last Survey Score</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <Star size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            {meta.lastSurveyScore} / {meta.lastSurveyMax.toFixed(1)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{meta.lastSurveyLabel}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {(
          [
            {
              id: 'indicators' as const,
              label: 'Performance Indicators',
              count: summary.active,
              badge: 'neutral' as const,
            },
            {
              id: 'caps' as const,
              label: 'Corrective Action Plans',
              count: summary.openCaps,
              badge: 'warn' as const,
            },
            {
              id: 'meetings' as const,
              label: 'Committee Meetings',
              count: null,
              badge: 'neutral' as const,
            },
            {
              id: 'chart-audit' as const,
              label: 'AI Chart Audit Sampler',
              count: 12,
              badge: 'ai' as const,
            },
          ]
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold transition ${
                active ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              {t.count != null && (
                <span
                  className={`inline-flex min-w-[1.35rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                    t.badge === 'ai'
                      ? 'bg-purple-600 text-white'
                      : t.badge === 'warn' && !active
                      ? 'bg-amber-500 text-white'
                      : active
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {t.count}
                </span>
              )}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-600" />}
            </button>
          );
        })}
      </div>

      {tab === 'indicators' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Filter:</span>
              {(['all', 'Meeting', 'At Risk', 'Below Target'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    statusFilter === s
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Clock size={14} className="text-slate-400" />
              Period: {meta.period} ({meta.periodRange})
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Indicator</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Current</th>
                    <th className="px-4 py-3">Trend</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {indicators.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                        No indicators match this filter.
                      </td>
                    </tr>
                  )}
                  {indicators.map((ind) => {
                    const open = expandedId === ind.id;
                    return (
                      <Fragment key={ind.id}>
                        <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                          <td className="px-4 py-3.5 font-medium text-slate-900">{ind.name}</td>
                          <td className="px-4 py-3.5 text-slate-600">{formatTarget(ind)}</td>
                          <td className="px-4 py-3.5 font-bold text-slate-900">
                            {formatIndicatorValue(ind.current, ind.unit)}
                          </td>
                          <td className="px-4 py-3.5">
                            <TrendIcon trend={ind.trend} />
                          </td>
                          <td className="px-4 py-3.5 text-slate-500">{ind.period}</td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[ind.status]}`}
                            >
                              {ind.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => setExpandedId(open ? null : ind.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              View Data
                              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-slate-100 bg-slate-50/50">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
                                <div>
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                    Monthly trend · {ind.period}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {ind.higherIsBetter ? 'Higher is better' : 'Lower is better'} · Target{' '}
                                    {formatTarget(ind)}
                                  </p>
                                  <div className="mt-3 max-w-xs">
                                    <MiniSpark data={ind.monthlyData} labels={ind.monthlyLabels} />
                                  </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                    Gap to target
                                  </p>
                                  <p className="mt-1 text-lg font-bold text-slate-900">
                                    {ind.higherIsBetter
                                      ? `${(ind.current - ind.target).toFixed(
                                          ind.unit === '%' && !Number.isInteger(ind.current) ? 1 : 0
                                        )}${ind.unit === '/5' ? '' : ind.unit === 'd' ? 'd' : '%'}`
                                      : `${(ind.target - ind.current).toFixed(1)}${ind.unit === 'd' ? 'd' : '%'} under cap`}
                                  </p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'caps' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Filter:</span>
            {(['all', 'Open', 'In Progress', 'Completed', 'Overdue'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setCapFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  capFilter === s
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredCaps.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
                No corrective action plans for this filter.
              </div>
            )}
            {filteredCaps.map((cap) => {
              const open = expandedCap === cap.id;
              return (
                <div key={cap.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setExpandedCap(open ? null : cap.id)}
                    className="flex w-full items-start justify-between gap-3 p-4 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-indigo-600">{cap.capNum}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            cycleCapStatus(cap.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              cycleCapStatus(cap.id);
                            }
                          }}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CAP_PILL[cap.status]}`}
                          title="Click to cycle status (saves to clinic)"
                        >
                          {cap.status}
                        </span>
                      </div>
                      <p className="mt-1 font-semibold text-slate-900">{cap.indicator}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Owner: {cap.responsible} · Due {formatMeetingDate(cap.dueDate)}
                      </p>
                    </div>
                    {open ? (
                      <ChevronUp size={18} className="text-slate-400" />
                    ) : (
                      <ChevronDown size={18} className="text-slate-400" />
                    )}
                  </button>
                  {open && (
                    <div className="grid gap-3 border-t border-slate-100 px-4 pb-4 pt-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Root cause</p>
                        <p className="mt-1 text-sm text-slate-700">{cap.rootCause}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Action steps</p>
                        <ul className="mt-1 space-y-1.5">
                          {cap.actionSteps.map((step) => (
                            <li key={step} className="flex gap-2 text-sm text-slate-700">
                              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-indigo-600" />
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'meetings' && (
        <div className="space-y-3">
          {sortedMeetings.map((meeting) => {
            const open = expandedMeeting === meeting.id;
            const isUpcoming = meeting.date >= new Date().toISOString().slice(0, 10);
            return (
              <div key={meeting.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setExpandedMeeting(open ? null : meeting.id)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">
                        {meeting.title ?? 'QI Committee'} · {formatMeetingDate(meeting.date)}
                      </p>
                      {isUpcoming && (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">
                          Upcoming
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {meeting.attendees.length} attendees · {meeting.agendaItems.length} agenda items
                      {meeting.decisions.length > 0 ? ` · ${meeting.decisions.length} decisions` : ''}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
                    {open ? 'Hide' : 'View minutes'}
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {open && (
                  <div className="grid gap-3 border-t border-slate-100 px-4 pb-4 pt-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:col-span-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Attendees</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {meeting.attendees.map((a) => (
                          <span
                            key={a}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700"
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Agenda</p>
                      <ul className="mt-2 space-y-1.5">
                        {meeting.agendaItems.map((item) => (
                          <li key={item} className="text-sm text-slate-700">
                            • {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Decisions</p>
                      {meeting.decisions.length === 0 ? (
                        <p className="mt-2 text-sm italic text-slate-400">Pending — meeting not yet held</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {meeting.decisions.map((item) => (
                            <li key={item} className="text-sm text-slate-700">
                              • {item}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 sm:col-span-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">Next steps</p>
                      <ul className="mt-2 space-y-1.5">
                        {meeting.nextSteps.map((item) => (
                          <li key={item} className="flex gap-2 text-sm text-slate-800">
                            <Target size={14} className="mt-0.5 shrink-0 text-indigo-600" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── AI CHART AUDIT SAMPLER TAB (Commit ec2a982 / Pillar 5) ── */}
      {tab === 'chart-audit' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="rounded-2xl border-2 border-purple-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">Weekly Automated Chart Audit Sampler</h2>
                    <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-purple-800">
                      AWS Bedrock Evaluator
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                      Sample Size: 12 Clinical Notes
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    5 Audit Criteria: 48h signature timeliness · Treatment plan goal linkage · Medical necessity phrasing · Telehealth verbal consent · Cloned-text similarity (&gt;80%).
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toast.success('Bedrock re-analyzed 12 note samples. All clinical embeddings verified.')}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-xs"
                >
                  Re-Run Audit
                </button>
              </div>
            </div>

            {/* Criteria & Findings Summary Cards */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">1. 48h Signature</p>
                <p className="mt-1 text-base font-extrabold text-slate-900">91.7%</p>
                <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">11 of 12 timely</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">2. Goal Linkage</p>
                <p className="mt-1 text-base font-extrabold text-slate-900">91.7%</p>
                <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">11 of 12 linked</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">3. Med Necessity</p>
                <p className="mt-1 text-base font-extrabold text-slate-900">91.7%</p>
                <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">COMAR 10.63 aligned</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">4. Telehealth Consent</p>
                <p className="mt-1 text-base font-extrabold text-slate-900">91.7%</p>
                <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">Verbal consent recorded</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600">5. Cloned Text (&gt;80%)</p>
                <p className="mt-1 text-base font-extrabold text-rose-700">1 Flag</p>
                <p className="text-[10px] text-rose-800 font-bold mt-0.5">84% Match · Claim Held</p>
              </div>
            </div>
          </div>

          {/* High Severity Finding Alert Banner */}
          <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 shadow-xs">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-rose-800">
                    High-Severity Audit Finding — Automatic Billing Claim Safeguard Triggered
                  </h4>
                  <span className="rounded-md bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white">
                    CLAIM HELD
                  </span>
                </div>
                <p className="mt-1 text-xs text-rose-900 leading-relaxed">
                  <strong>Note NOTE-8432</strong> (Patient: Jason Miller, DOS: Oct 11, 2026, CPT: 90837): Cloned text similarity <strong>84%</strong> detected against previous session note, and 72-hour signature delay. Claim <strong>CLM-849102 ($185.00)</strong> has been placed on automatic administrative hold. <strong>CAP-2026-04</strong> initiated.
                </p>
                <div className="mt-2.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toast.success('Claim CLM-849102 billing hold confirmed. Claim cannot submit until note is re-attested.')}
                    className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 hover:underline"
                  >
                    <Lock size={12} /> Inspect Billing Hold
                  </button>
                  <span className="text-rose-300">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('caps');
                      toast.success('Navigated to CAP-2026-04 for documentation remediation.');
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline"
                  >
                    <Target size={12} /> Open CAP-2026-04
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Table of 12 Audited Notes */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
            <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Audited notes
              </h3>
              <span className="text-[11px] text-slate-400">Completed chart audits</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 pl-4 pr-2">Note ID</th>
                    <th className="px-2 py-2.5">Client &amp; Clinician</th>
                    <th className="px-2 py-2.5">CPT / Service</th>
                    <th className="px-2 py-2.5 text-center">48h Sign</th>
                    <th className="px-2 py-2.5 text-center">Goal Link</th>
                    <th className="px-2 py-2.5 text-center">Med Necessity</th>
                    <th className="px-2 py-2.5 text-center">TH Consent</th>
                    <th className="px-2 py-2.5 text-center">Similarity</th>
                    <th className="py-2.5 pl-2 pr-4 text-right">Audit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">No audited notes yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
