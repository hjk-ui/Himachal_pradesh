'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
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
  Plus,
  Star,
  Target,
  Sparkles,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { practiceToday } from '@/lib/time/practiceTime';
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
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  cx,
  EmptyState,
  FOCUS_RING,
  FormField,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  TONE_SOFT,
  type Tone,
} from '@/components/ui';

export {
  QI_CAPS_SEED,
  QI_INDICATORS_SEED,
  QI_MEETINGS_SEED,
  QI_META_SEED,
} from '@/features/analytics/qiData';

type QiTab = 'indicators' | 'caps' | 'meetings' | 'chart-audit';

const STATUS_TONE: Record<IndicatorStatus, Tone> = {
  Meeting: 'success',
  'At Risk': 'warning',
  'Below Target': 'danger',
};

const CAP_TONE: Record<CapStatus, Tone> = {
  Open: 'neutral',
  'In Progress': 'info',
  Completed: 'success',
  Overdue: 'danger',
};

function TrendIcon({ trend }: { trend: PerformanceIndicator['trend'] }) {
  if (trend === 'up') return <ArrowUpRight size={16} className="text-emerald-600" aria-label="Trending up" />;
  if (trend === 'down') return <ArrowDownRight size={16} className="text-rose-600" aria-label="Trending down" />;
  return <Minus size={16} className="text-slate-500" aria-label="Flat" />;
}

function MiniSpark({ data, labels }: { data: number[]; labels: string[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-slate-500">No monthly data recorded yet.</p>;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(0.01, max - min);
  return (
    <div className="flex h-16 items-end gap-2">
      {data.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[11px] font-semibold text-slate-500">{v}</span>
          <div
            className="w-full max-w-[28px] rounded-t-md bg-blue-500"
            style={{
              height: `${28 + ((v - min) / range) * 36}px`,
              opacity: 0.5 + (i / Math.max(data.length - 1, 1)) * 0.5,
            }}
          />
          <span className="text-[11px] text-slate-500">{labels[i] ?? `M${i + 1}`}</span>
        </div>
      ))}
    </div>
  );
}

function normalizeIndicators(list: PerformanceIndicator[]): PerformanceIndicator[] {
  // No invented period or month labels: show what was recorded, else "—".
  return list.map((i) => ({
    ...i,
    period: i.period || '',
    monthlyData: Array.isArray(i.monthlyData) ? i.monthlyData : [],
    monthlyLabels: Array.isArray(i.monthlyLabels) ? i.monthlyLabels : [],
  }));
}

const EMPTY_CAP_FORM = { title: '', owner: '', dueDate: '', incidentId: '', source: '', rootCause: '', actionSteps: '' };
const EMPTY_MEETING_FORM = { date: '', title: '', attendees: '', agendaItems: '', decisions: '', nextSteps: '' };
const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

function nextCapNum(caps: CAPRecord[], year: number): string {
  const nums = caps
    .map((c) => c.capNum?.match(/CAP-(\d{4})-(\d+)/i))
    .filter((m): m is RegExpMatchArray => !!m && Number(m[1]) === year)
    .map((m) => Number(m[2]));
  return `CAP-${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

export default function QualityImprovementPage() {
  const [tab, setTab] = useState<QiTab>('indicators');
  const [indicatorList, , indicatorMeta] = useModuleList<PerformanceIndicator>(
    'qi-indicators',
    []
  );
  const [caps, setCaps, capsMeta] = useModuleList<CAPRecord>('qi-caps', []);
  const [meetings, setMeetings, meetingsMeta] = useModuleList<QIMeeting>('qi-meetings', []);
  const [capForm, setCapForm] = useState<typeof EMPTY_CAP_FORM | null>(null);
  const [meetingForm, setMeetingForm] = useState<typeof EMPTY_MEETING_FORM | null>(null);

  // Incidents link here with ?newCap=true&incidentId=…&source=… to start a CAP for that incident.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('newCap') !== 'true') return;
    setTab('caps');
    setCapForm({
      ...EMPTY_CAP_FORM,
      incidentId: params.get('incidentId') ?? '',
      source: params.get('source') ?? '',
    });
  }, []);

  function saveCap() {
    if (!capForm || !capForm.title.trim() || !capForm.owner.trim() || !capForm.dueDate) return;
    const year = Number(practiceToday().slice(0, 4));
    const record: CAPRecord = {
      id: crypto.randomUUID(),
      capNum: nextCapNum(caps, year),
      indicator: capForm.title.trim(),
      rootCause: capForm.rootCause.trim(),
      actionSteps: lines(capForm.actionSteps),
      responsible: capForm.owner.trim(),
      dueDate: capForm.dueDate,
      status: 'Open',
      linkedIncidentId: capForm.incidentId.trim() || undefined,
      source: capForm.source.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    setCaps((prev) => [record, ...prev]);
    setCapForm(null);
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }

  function saveMeeting() {
    if (!meetingForm || !meetingForm.date) return;
    const record: QIMeeting = {
      id: crypto.randomUUID(),
      date: meetingForm.date,
      title: meetingForm.title.trim() || undefined,
      attendees: lines(meetingForm.attendees),
      agendaItems: lines(meetingForm.agendaItems),
      decisions: lines(meetingForm.decisions),
      nextSteps: lines(meetingForm.nextSteps),
    };
    setMeetings((prev) => [record, ...prev]);
    setMeetingForm(null);
  }
  const [metaList, , metaMeta] = useModuleList<QIProgramMeta>('qi-meta', []);
  const [statusFilter, setStatusFilter] = useState<'all' | IndicatorStatus>('all');
  const [capFilter, setCapFilter] = useState<'all' | CapStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);
  const [expandedCap, setExpandedCap] = useState<string | null>(null);

  const loading = indicatorMeta.loading || capsMeta.loading || meetingsMeta.loading || metaMeta.loading;

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
    const days = meta.nextMeetingDate ? daysUntil(meta.nextMeetingDate) : null;
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
    a.download = `qi-report-${(meta.period || practiceToday()).replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const loadErrors = [indicatorMeta, capsMeta, meetingsMeta, metaMeta].filter((m) => m.error);

  if (loading && allIndicators.length === 0 && caps.length === 0 && meetings.length === 0) {
    return (
      <Page>
        <PageHeader
          title="Quality Improvement Program"
          description="CARF-required performance monitoring, corrective actions, and committee documentation"
        />
        <Card>
          <LoadingState label="Loading…" />
        </Card>
      </Page>
    );
  }

  const daysLabel =
    summary.days === null
      ? 'No meeting scheduled'
      : summary.days === 0
      ? 'Today'
      : summary.days > 0
        ? `${summary.days} day${summary.days === 1 ? '' : 's'} away`
        : `${Math.abs(summary.days)} day${Math.abs(summary.days) === 1 ? '' : 's'} ago`;

  return (
    <Page>
      <PageHeader
        title="Quality Improvement Program"
        description="CARF-required performance monitoring, corrective actions, and committee documentation"
        actions={
          <Button type="button" onClick={exportQiReport} icon={<Download />}>
            Export QI Report
          </Button>
        }
      />

      {loadErrors.length > 0 && (
        <Alert
          tone="danger"
          title="Some quality improvement records could not be loaded or saved."
          actions={
            <Button size="sm" variant="secondary" onClick={() => loadErrors.forEach((m) => m.retry())}>
              Try again
            </Button>
          }
        >
          {loadErrors.map((m) => m.error).join(' · ')}
        </Alert>
      )}

      <StatGrid columns={4}>
        <StatCard
          label="Active Indicators"
          value={summary.active}
          tone="brand"
          icon={<BarChart3 />}
          hint={
            <>
              {summary.meeting} meeting target · {summary.atRisk} at risk
              {summary.below > 0 ? ` · ${summary.below} below` : ''}
            </>
          }
        />
        <StatCard
          label="Open CAPs"
          value={summary.openCaps}
          tone="warning"
          icon={<AlertTriangle />}
          hint={
            meta.resolvedCapsYearLabel
              ? `${meta.resolvedCapsPriorYear} resolved in ${meta.resolvedCapsYearLabel}`
              : 'No resolved CAPs on record'
          }
        />
        <StatCard
          label="Next QI Meeting"
          value={meta.nextMeetingDate ? formatMeetingDate(meta.nextMeetingDate) : '—'}
          tone="info"
          icon={<CalendarDays />}
          hint={daysLabel}
        />
        <StatCard
          label="Last Survey Score"
          value={meta.lastSurveyScore > 0 ? `${meta.lastSurveyScore} / ${meta.lastSurveyMax.toFixed(1)}` : '—'}
          tone="success"
          icon={<Star />}
          hint={meta.lastSurveyLabel || 'No survey results yet'}
        />
      </StatGrid>

      <Tabs
        label="Quality improvement sections"
        value={tab}
        onChange={setTab}
        controlsPanels={false}
        items={[
          { key: 'indicators', label: 'Performance Indicators', count: summary.active },
          { key: 'caps', label: 'Corrective Action Plans', count: summary.openCaps, countTone: 'attention' },
          { key: 'meetings', label: 'Committee Meetings' },
          { key: 'chart-audit', label: 'AI Chart Audit Sampler', icon: <Sparkles /> },
        ]}
      />

      {tab === 'indicators' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter indicators by status">
              <span className="text-xs font-medium text-slate-500">Filter:</span>
              {(['all', 'Meeting', 'At Risk', 'Below Target'] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={statusFilter === s ? 'primary' : 'secondary'}
                  aria-pressed={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'all' ? 'All' : s}
                </Button>
              ))}
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Clock size={14} className="text-slate-500" aria-hidden />
              Period: {meta.period ? `${meta.period}${meta.periodRange ? ` (${meta.periodRange})` : ''}` : '—'}
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="clinic-scroll-x overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-3">Indicator</th>
                    <th scope="col" className="px-4 py-3">Target</th>
                    <th scope="col" className="px-4 py-3">Current</th>
                    <th scope="col" className="px-4 py-3">Trend</th>
                    <th scope="col" className="px-4 py-3">Period</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {indicators.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          compact
                          icon={<BarChart3 />}
                          title={
                            allIndicators.length === 0
                              ? 'Not set up yet: no performance indicators have been configured for this program.'
                              : 'No indicators match this filter.'
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {indicators.map((ind) => {
                    const open = expandedId === ind.id;
                    return (
                      <Fragment key={ind.id}>
                        <tr className="group hover:bg-slate-50">
                          <td className="sticky left-0 z-10 max-w-[16rem] bg-white px-4 py-3 font-medium text-slate-900 group-hover:bg-slate-50">{ind.name}</td>
                          <td className="px-4 py-3 text-slate-600">{formatTarget(ind)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">
                            {formatIndicatorValue(ind.current, ind.unit)}
                          </td>
                          <td className="px-4 py-3">
                            <TrendIcon trend={ind.trend} />
                          </td>
                          <td className="px-4 py-3 text-slate-500">{ind.period || '—'}</td>
                          <td className="px-4 py-3">
                            <StatusBadge tone={STATUS_TONE[ind.status]}>{ind.status}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              aria-expanded={open}
                              onClick={() => setExpandedId(open ? null : ind.id)}
                            >
                              View Data
                              {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                            </Button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                <div>
                                  <p className="text-xs font-semibold text-slate-600">
                                    Monthly trend · {ind.period || 'period not recorded'}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {ind.higherIsBetter ? 'Higher is better' : 'Lower is better'} · Target{' '}
                                    {formatTarget(ind)}
                                  </p>
                                  <div className="mt-3 max-w-xs">
                                    <MiniSpark data={ind.monthlyData} labels={ind.monthlyLabels} />
                                  </div>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                                  <p className="text-xs font-semibold text-slate-600">Gap to target</p>
                                  <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
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
          </Card>
        </div>
      )}

      {tab === 'caps' && (
        <div className="space-y-4">
          {capForm ? (
            <Card>
              <CardHeader
                title="New corrective action plan"
                titleAs="h3"
                description={capForm.source ? `Linked to: ${capForm.source}` : undefined}
              />
              <CardBody>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Title" required className="sm:col-span-2">
                    <input
                      value={capForm.title}
                      onChange={(e) => setCapForm({ ...capForm, title: e.target.value })}
                      className={inputClasses}
                    />
                  </FormField>
                  <FormField label="Owner" required>
                    <input
                      value={capForm.owner}
                      onChange={(e) => setCapForm({ ...capForm, owner: e.target.value })}
                      className={inputClasses}
                    />
                  </FormField>
                  <FormField label="Due date" required>
                    <input
                      type="date"
                      value={capForm.dueDate}
                      onChange={(e) => setCapForm({ ...capForm, dueDate: e.target.value })}
                      className={inputClasses}
                    />
                  </FormField>
                  <FormField label="Linked incident ID">
                    <input
                      value={capForm.incidentId}
                      onChange={(e) => setCapForm({ ...capForm, incidentId: e.target.value })}
                      placeholder="e.g. INC-2026-004"
                      className={inputClasses}
                    />
                  </FormField>
                  <FormField label="Root cause">
                    <input
                      value={capForm.rootCause}
                      onChange={(e) => setCapForm({ ...capForm, rootCause: e.target.value })}
                      className={inputClasses}
                    />
                  </FormField>
                  <FormField label="Action steps (one per line)" className="sm:col-span-2">
                    <textarea
                      rows={3}
                      value={capForm.actionSteps}
                      onChange={(e) => setCapForm({ ...capForm, actionSteps: e.target.value })}
                      className={inputClasses}
                    />
                  </FormField>
                </div>
              </CardBody>
              <CardFooter>
                <Button type="button" variant="secondary" onClick={() => setCapForm(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={saveCap}
                  disabled={!capForm.title.trim() || !capForm.owner.trim() || !capForm.dueDate}
                >
                  Save CAP
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Button
              type="button"
              variant="secondary"
              icon={<Plus />}
              onClick={() => setCapForm({ ...EMPTY_CAP_FORM })}
            >
              New CAP
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter corrective action plans by status">
            <span className="text-xs font-medium text-slate-500">Filter:</span>
            {(['all', 'Open', 'In Progress', 'Completed', 'Overdue'] as const).map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={capFilter === s ? 'primary' : 'secondary'}
                aria-pressed={capFilter === s}
                onClick={() => setCapFilter(s)}
              >
                {s === 'all' ? 'All' : s}
              </Button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredCaps.length === 0 && (
              <Card>
                <EmptyState compact icon={<Target />} title="No corrective action plans for this filter." />
              </Card>
            )}
            {filteredCaps.map((cap) => {
              const open = expandedCap === cap.id;
              return (
                <Card key={cap.id} className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedCap(open ? null : cap.id)}
                    aria-expanded={open}
                    className={cx('flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-slate-50', FOCUS_RING)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-blue-700">{cap.capNum}</span>
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
                          className={cx(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                            TONE_SOFT[CAP_TONE[cap.status]],
                            FOCUS_RING,
                          )}
                          title="Click to cycle status (saves to clinic)"
                        >
                          {cap.status}
                        </span>
                      </div>
                      <p className="mt-1 font-semibold text-slate-900">{cap.indicator}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Owner: {cap.responsible || 'Not assigned'} · Due{' '}
                        {cap.dueDate ? formatMeetingDate(cap.dueDate) : 'not set'}
                        {cap.linkedIncidentId ? ` · Incident ${cap.linkedIncidentId}` : ''}
                      </p>
                    </div>
                    {open ? (
                      <ChevronUp size={18} className="shrink-0 text-slate-500" aria-hidden />
                    ) : (
                      <ChevronDown size={18} className="shrink-0 text-slate-500" aria-hidden />
                    )}
                  </button>
                  {open && (
                    <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-4 pb-4 pt-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-600">Root cause</p>
                        <p className="mt-1 text-sm text-slate-700">{cap.rootCause || 'Not recorded'}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-600">Action steps</p>
                        <ul className="mt-1 space-y-1.5">
                          {cap.actionSteps.map((step) => (
                            <li key={step} className="flex gap-2 text-sm text-slate-700">
                              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-blue-600" aria-hidden />
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'meetings' && (
        <div className="space-y-3">
          {meetingForm ? (
            <Card>
              <CardHeader title="Record committee meeting" titleAs="h3" />
              <CardBody>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Date" required>
                    <input
                      type="date"
                      value={meetingForm.date}
                      onChange={(e) => setMeetingForm({ ...meetingForm, date: e.target.value })}
                      className={inputClasses}
                    />
                  </FormField>
                  <FormField label="Title">
                    <input
                      value={meetingForm.title}
                      onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })}
                      placeholder="QI Committee"
                      className={inputClasses}
                    />
                  </FormField>
                  {(
                    [
                      ['attendees', 'Attendees'],
                      ['agendaItems', 'Agenda items'],
                      ['decisions', 'Decisions'],
                      ['nextSteps', 'Next steps'],
                    ] as const
                  ).map(([key, label]) => (
                    <FormField key={key} label={`${label} (one per line)`}>
                      <textarea
                        rows={3}
                        value={meetingForm[key]}
                        onChange={(e) => setMeetingForm({ ...meetingForm, [key]: e.target.value })}
                        className={inputClasses}
                      />
                    </FormField>
                  ))}
                </div>
              </CardBody>
              <CardFooter>
                <Button type="button" variant="secondary" onClick={() => setMeetingForm(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={saveMeeting} disabled={!meetingForm.date}>
                  Save meeting
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Button
              type="button"
              variant="secondary"
              icon={<Plus />}
              onClick={() => setMeetingForm({ ...EMPTY_MEETING_FORM })}
            >
              Record meeting
            </Button>
          )}
          {sortedMeetings.length === 0 && (
            <Card>
              <EmptyState compact icon={<CalendarDays />} title="No committee meetings recorded yet." />
            </Card>
          )}
          {sortedMeetings.map((meeting) => {
            const open = expandedMeeting === meeting.id;
            const isUpcoming = meeting.date >= practiceToday();
            return (
              <Card key={meeting.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedMeeting(open ? null : meeting.id)}
                  aria-expanded={open}
                  className={cx('flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50', FOCUS_RING)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">
                        {meeting.title ?? 'QI Committee'} · {formatMeetingDate(meeting.date)}
                      </p>
                      {isUpcoming && (
                        <StatusBadge tone="info" size="sm">
                          Upcoming
                        </StatusBadge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {meeting.attendees.length} attendees · {meeting.agendaItems.length} agenda items
                      {meeting.decisions.length > 0 ? ` · ${meeting.decisions.length} decisions` : ''}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-blue-700">
                    {open ? 'Hide' : 'View minutes'}
                    {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                  </span>
                </button>
                {open && (
                  <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-4 pb-4 pt-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2">
                      <p className="text-xs font-semibold text-slate-600">Attendees</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {meeting.attendees.map((a) => (
                          <StatusBadge key={a} tone="neutral">
                            {a}
                          </StatusBadge>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-600">Agenda</p>
                      <ul className="mt-2 list-disc space-y-1.5 pl-5">
                        {meeting.agendaItems.map((item) => (
                          <li key={item} className="text-sm text-slate-700">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-600">Decisions</p>
                      {meeting.decisions.length === 0 ? (
                        <p className="mt-2 text-sm italic text-slate-500">Pending — meeting not yet held</p>
                      ) : (
                        <ul className="mt-2 list-disc space-y-1.5 pl-5">
                          {meeting.decisions.map((item) => (
                            <li key={item} className="text-sm text-slate-700">
                              {item}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2">
                      <p className="text-xs font-semibold text-slate-600">Next steps</p>
                      <ul className="mt-2 space-y-1.5">
                        {meeting.nextSteps.map((item) => (
                          <li key={item} className="flex gap-2 text-sm text-slate-800">
                            <Target size={14} className="mt-0.5 shrink-0 text-blue-600" aria-hidden />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── AI CHART AUDIT SAMPLER TAB (Commit ec2a982 / Pillar 5) ── */}
      {tab === 'chart-audit' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <Card>
            <CardHeader
              icon={<Sparkles />}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  Weekly Automated Chart Audit Sampler
                  <StatusBadge tone="neutral" size="sm">Not connected yet</StatusBadge>
                  <StatusBadge tone="neutral" size="sm">Sample Size: 0 Clinical Notes</StatusBadge>
                </span>
              }
              description={
                <>
                  5 Audit Criteria: 48h signature timeliness · Treatment plan goal linkage · Medical necessity phrasing · Telehealth verbal consent · Cloned-text similarity (&gt;80%).
                </>
              }
              actions={
                // No chart-audit sampler backend exists (/api/agents/analyze-note is fail-closed).
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled
                  title="Not connected yet: automated chart audit sampling is not running. Sample and audit charts manually for now."
                >
                  Re-Run Audit
                </Button>
              }
            />

            {/* Criteria & Findings Summary Cards */}
            <CardBody>
              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
                {[
                  '1. 48h Signature',
                  '2. Goal Linkage',
                  '3. Med Necessity',
                  '4. Telehealth Consent',
                  '5. Cloned Text (>80%)',
                ].map((criterion) => (
                  <div key={criterion} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-600">{criterion}</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">—</p>
                    <p className="mt-0.5 text-xs text-slate-500">No samples yet</p>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Table of Audited Notes */}
          <Card className="overflow-hidden">
            <CardHeader title="Sample Cohort" titleAs="h3" actions={<span className="text-xs text-slate-500">Randomized Multi-Provider Stratification</span>} />

            <div className="clinic-scroll-x overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="py-3 pl-4 pr-2">Note ID</th>
                    <th scope="col" className="px-2 py-3">Client &amp; Clinician</th>
                    <th scope="col" className="px-2 py-3">CPT / Service</th>
                    <th scope="col" className="px-2 py-3 text-center">48h Sign</th>
                    <th scope="col" className="px-2 py-3 text-center">Goal Link</th>
                    <th scope="col" className="px-2 py-3 text-center">Med Necessity</th>
                    <th scope="col" className="px-2 py-3 text-center">TH Consent</th>
                    <th scope="col" className="px-2 py-3 text-center">Similarity</th>
                    <th scope="col" className="py-3 pl-2 pr-4 text-right">Audit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        compact
                        icon={<Sparkles />}
                        title="No notes have been sampled yet. Audit results will appear once signed notes exist."
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
