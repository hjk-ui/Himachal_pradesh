'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import type { OutcomesReport } from '@/lib/reports/outcomesReports';
import type {
  ActionGroup,
  ListKey,
  PopulationReport,
  PopulationRow,
  RiskTier,
} from '@/lib/reports/populationHealth';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Info,
  Lock,
  TrendingDown,
  Users,
  X,
} from 'lucide-react';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';

const OUTCOME_MONTHS = 6;
const PAGE_SIZE = 25;

const TIER_META: Record<RiskTier, { label: string; tone: Tone; hint: string }> = {
  high: { label: 'High risk', tone: 'danger', hint: 'Chart risk High, an unreviewed high alert, or a safety-flagged latest C-SSRS' },
  moderate: { label: 'Moderate risk', tone: 'warning', hint: 'Chart risk Medium or an unreviewed medium alert' },
  low: { label: 'Low risk', tone: 'success', hint: 'Chart risk Low with a risk screen on file' },
  unknown: { label: 'Not screened', tone: 'neutral', hint: 'Chart risk is the default Low and no C-SSRS, risk alert, finalized evaluation or safety plan is on file' },
};
const TIERS: RiskTier[] = ['high', 'moderate', 'low', 'unknown'];

const URGENCY: Record<ActionGroup['urgency'], { tone: Tone; label: string }> = {
  critical: { tone: 'danger', label: 'Critical' },
  high: { tone: 'warning', label: 'High' },
  routine: { tone: 'info', label: 'Routine' },
};

/** Sparkline stroke/fill per series tone. */
const SPARK_TONE: Record<Tone, string> = {
  neutral: 'stroke-slate-500 fill-slate-500',
  brand: 'stroke-blue-600 fill-blue-600',
  info: 'stroke-sky-600 fill-sky-600',
  success: 'stroke-emerald-600 fill-emerald-600',
  warning: 'stroke-amber-500 fill-amber-500',
  danger: 'stroke-rose-600 fill-rose-600',
};

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const pctOf = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : '—');
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '—';

function shortMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

function TrendSpark({ values, tone }: { values: number[]; tone: Tone }) {
  const w = 280;
  const h = 110;
  const pad = 16;
  if (values.length < 2) {
    return <div className="flex h-28 items-center justify-center text-xs text-slate-500">Not enough assessment data yet</div>;
  }
  const lo = Math.min(...values) - 0.5;
  const hi = Math.max(...values) + 0.5;
  const span = Math.max(hi - lo, 1);
  const pts = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (w - pad * 2),
    y: h - pad - ((v - lo) / span) * (h - pad * 2),
    v,
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className={cx('h-28 max-w-full', SPARK_TONE[tone])} aria-hidden>
      <path d={d} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} className="stroke-white" strokeWidth={1.5} />
          <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-slate-500 stroke-none" fontSize="11">
            {p.v}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ClientRow({ row, compact }: { row: PopulationRow; compact?: boolean }) {
  return (
    <Link
      href={row.href}
      className={cx(
        'block rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-xs transition hover:border-slate-300 hover:shadow-sm',
        FOCUS_RING,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900">
          {row.isProtected ? <Lock className="h-3 w-3 shrink-0 text-slate-500" aria-label="Protected record" /> : null}
          <span className="truncate">{row.name}</span>
        </span>
        {row.mrn ? <span className="shrink-0 text-[11px] text-slate-500">{row.mrn}</span> : null}
      </div>
      {row.isProtected ? (
        <p className="mt-0.5 text-xs text-slate-500">Protected record — details hidden here; open the chart.</p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-slate-500">
            {row.clinicianName ?? 'Unassigned'}
            {row.locationName ? ` · ${row.locationName}` : ''}
          </p>
          <p className="text-xs text-slate-500">
            Last visit {day(row.lastVisit)} · Next {day(row.nextAppointment)}
          </p>
          {row.detail && !compact ? <p className="mt-0.5 text-xs text-slate-700">{row.detail}</p> : null}
        </>
      )}
    </Link>
  );
}

type SavedAction = { id?: string; clientName?: string; title?: string; urgency?: string; due?: string; done?: boolean };

/** Hand-entered action items from the old module blob, if any (read only; nothing is seeded or saved). */
async function loadSavedNotes(): Promise<SavedAction[]> {
  try {
    const res = await apiJson<{ success: true; data: unknown }>('/api/modules/population-health');
    const data = res.data as { actions?: unknown } | null;
    const list = Array.isArray(data?.actions) ? (data.actions as SavedAction[]) : [];
    return list.filter((a) => a && typeof a === 'object' && (a.title || a.clientName));
  } catch {
    return [];
  }
}

function monthsAgoYmd(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export default function PopulationHealthPage() {
  const [locationId, setLocationId] = useState('');
  const [clinicianId, setClinicianId] = useState('');
  const [report, setReport] = useState<PopulationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcomes, setOutcomes] = useState<OutcomesReport | null>(null);
  const [trendMeasure, setTrendMeasure] = useState<'PHQ-9' | 'GAD-7'>('PHQ-9');
  const [saved, setSaved] = useState<SavedAction[]>([]);
  const [listKey, setListKey] = useState<ListKey | null>(null);
  const [listPage, setListPage] = useState(0);
  const [listData, setListData] = useState<PopulationReport['list']>(null);
  const [listLoading, setListLoading] = useState(false);

  const filterQs = useMemo(() => {
    const qs = new URLSearchParams();
    if (locationId) qs.set('location', locationId);
    if (clinicianId) qs.set('clinician', clinicianId);
    return qs;
  }, [locationId, clinicianId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Filters changed: an open list no longer matches
    setListKey(null);
    setListData(null);
    apiJson<{ success: true; report: PopulationReport }>(`/api/reports/population?${filterQs.toString()}`)
      .then((r) => {
        if (!cancelled) setReport(r.report);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not load population health');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const oq = new URLSearchParams(filterQs);
    oq.set('tab', 'clinical');
    oq.set('from', monthsAgoYmd(OUTCOME_MONTHS));
    apiJson<{ success: true; report: OutcomesReport }>(`/api/reports/outcomes?${oq.toString()}`)
      .then((r) => {
        if (!cancelled) setOutcomes(r.report);
      })
      .catch(() => {
        if (!cancelled) setOutcomes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filterQs]);

  useEffect(() => {
    void loadSavedNotes().then(setSaved);
  }, []);

  const openList = useCallback(
    async (key: ListKey, page: number) => {
      setListKey(key);
      setListPage(page);
      setListLoading(true);
      try {
        const qs = new URLSearchParams(filterQs);
        qs.set('list', key);
        qs.set('page', String(page));
        qs.set('pageSize', String(PAGE_SIZE));
        const r = await apiJson<{ success: true; report: PopulationReport }>(`/api/reports/population?${qs.toString()}`);
        setListData(r.report.list);
        setListPage(r.report.list?.page ?? page);
      } catch {
        setListData(null);
      } finally {
        setListLoading(false);
      }
    },
    [filterQs]
  );

  // Deep link from the role home tiles: /dashboard/population?list=tier:high[&location=<id>]
  const [linkedList, setLinkedList] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const loc = sp.get('location');
    if (loc && /^[A-Za-z0-9_-]{1,64}$/.test(loc)) setLocationId(loc);
    const list = sp.get('list');
    if (list && /^(tier|action):[a-z0-9_]+$/.test(list)) setLinkedList(list);
  }, []);
  useEffect(() => {
    if (!linkedList || !report || loading) return;
    const [kind, value] = linkedList.split(':');
    const known = kind === 'tier' ? value in report.tiers : report.actions.some((a) => a.kind === value);
    setLinkedList(null);
    if (known) void openList(linkedList as ListKey, 0);
  }, [linkedList, report, loading, openList]);

  const phq = outcomes?.clinical?.phq9.monthlyTrend ?? [];
  const gad = outcomes?.clinical?.gad7.monthlyTrend ?? [];
  const charts = [
    { key: 'PHQ-9' as const, title: 'AVG PHQ-9 SCORE — MONTHLY', points: phq, threshold: 'Threshold: 10+ = moderate depression', tone: 'brand' as Tone },
    { key: 'GAD-7' as const, title: 'AVG GAD-7 SCORE — MONTHLY', points: gad, threshold: 'Threshold: 10+ = moderate anxiety', tone: 'success' as Tone },
  ];
  const orderedCharts = [...charts.filter((c) => c.key === trendMeasure), ...charts.filter((c) => c.key !== trendMeasure)];

  const r = report;
  const n = r?.activeCaseload ?? 0;
  const listTitle = (key: ListKey) => {
    const [kind, value] = key.split(':');
    if (kind === 'tier') return TIER_META[value as RiskTier].label;
    return r?.actions.find((a) => a.kind === value)?.label ?? 'Clients';
  };

  return (
    <Page width="full">
      <PageHeader
        title="Population Health"
        description={
          <>
            <p>
              {r?.scope === 'caseload'
                ? 'Your assigned active clients: risk, engagement, measurement and outcome trends.'
                : 'Every active client in the organization: risk, engagement, measurement and outcome trends.'}
            </p>
            {r ? (
              <p className="mt-1 text-xs text-slate-500">
                As of {new Date(r.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET · counted on the server
                from all {fmt(n)} active client records in scope
              </p>
            ) : null}
          </>
        }
        actions={
          <>
            <select
              aria-label="Location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={cx(inputClasses, 'w-auto max-w-full text-slate-700')}
            >
              <option value="">All locations</option>
              {r?.options.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {r?.scope !== 'caseload' ? (
              <select
                aria-label="Clinician"
                value={clinicianId}
                onChange={(e) => setClinicianId(e.target.value)}
                className={cx(inputClasses, 'w-auto max-w-full text-slate-700')}
              >
                <option value="">All clinicians</option>
                {r?.options.clinicians.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading && !r ? (
        <Card>
          <LoadingState label="Loading population health…" />
        </Card>
      ) : null}

      {r ? (
        <>
          {r.hiddenSensitiveClients > 0 || r.notes.length ? (
            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {r.hiddenSensitiveClients > 0 ? (
                <p className="flex items-center gap-1.5">
                  <Lock className="h-3 w-3 shrink-0 text-slate-500" aria-hidden /> {fmt(r.hiddenSensitiveClients)} protected (42 CFR Part 2) active client
                  {r.hiddenSensitiveClients === 1 ? ' is' : 's are'} not included because you do not have access to{' '}
                  {r.hiddenSensitiveClients === 1 ? 'that record' : 'those records'}.
                </p>
              ) : null}
              {r.notes.map((note) => (
                <p key={note} className="flex items-center gap-1.5">
                  <Info className="h-3 w-3 shrink-0 text-slate-500" aria-hidden /> {note}
                </p>
              ))}
            </div>
          ) : null}

          <div className={loading ? 'opacity-60' : ''}>
            <StatGrid columns={5}>
              <StatCard
                label={r.scope === 'caseload' ? 'My active caseload' : 'Active caseload'}
                value={fmt(n)}
                hint={`${fmt(r.newIntakes.d30)} new intakes in 30 days · ${fmt(r.newIntakes.d90)} in 90`}
                icon={<Users />}
                tone="brand"
              />
              <StatCard
                label="High risk"
                value={fmt(r.risk.high)}
                hint={`of ${fmt(n)} active (${pctOf(r.risk.high, n)})`}
                icon={<AlertTriangle />}
                tone="danger"
              />
              <StatCard
                label="Seen in 30 days"
                value={fmt(r.engagement.seen30)}
                hint={`of ${fmt(n)} active (${pctOf(r.engagement.seen30, n)})`}
                icon={<CalendarClock />}
                tone="info"
              />
              <StatCard
                label="Overdue sessions"
                value={r.overdue.available ? fmt(r.overdue.either) : '—'}
                hint={
                  r.overdue.available
                    ? `of ${fmt(n)} · therapy ${fmt(r.overdue.therapy)}, med mgmt ${fmt(r.overdue.medManagement)}`
                    : 'cadence unavailable'
                }
                icon={<Activity />}
                tone="warning"
              />
              <StatCard
                label="MBC coverage"
                value={r.mbc.activeMeasured.pct == null ? '—' : `${r.mbc.activeMeasured.pct}%`}
                hint={`${fmt(r.mbc.activeMeasured.numerator)} of ${fmt(n)} with PHQ-9/GAD-7 in ${r.mbc.windowDays} days`}
                icon={<ClipboardCheck />}
                tone="success"
              />
            </StatGrid>
          </div>

          {/* Risk stratification */}
          <Card>
            <CardHeader
              title="Risk stratification"
              description={
                <>
                  Same rule as the chart banner: the highest of chart risk level, unreviewed risk alerts and a safety-flagged latest C-SSRS.
                  {r.risk.escalatedByAlert + r.risk.escalatedByCssrs > 0
                    ? ` ${fmt(r.risk.escalatedByAlert)} high-risk client(s) are raised by an unreviewed alert and ${fmt(r.risk.escalatedByCssrs)} by C-SSRS.`
                    : ''}
                </>
              }
              actions={<span className="text-xs text-slate-500">{fmt(n)} active clients</span>}
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TIERS.map((t) => {
                const meta = TIER_META[t];
                const tier = r.tiers[t];
                return (
                  <div key={t} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        <StatusBadge tone={meta.tone} dot>
                          {meta.label}
                        </StatusBadge>
                      </h3>
                      <span className="text-xs font-semibold tabular-nums text-slate-700">
                        {fmt(tier.count)} of {fmt(n)}
                      </span>
                    </div>
                    <p className="mb-3 text-xs text-slate-500">{meta.hint}</p>
                    <div className="space-y-2">
                      {tier.preview.length === 0 ? <p className="py-3 text-center text-xs text-slate-500">No clients in this tier.</p> : null}
                      {tier.preview.map((row) => (
                        <ClientRow key={row.clientId} row={row} compact />
                      ))}
                    </div>
                    {tier.count > tier.preview.length ? (
                      <button
                        type="button"
                        onClick={() => void openList(`tier:${t}`, 0)}
                        className={cx('mt-3 rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                      >
                        View all {fmt(tier.count)}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </CardBody>
          </Card>

          {listKey ? (
            <Card>
              <CardHeader
                title={
                  <>
                    {listTitle(listKey)}
                    {listData ? <span className="ml-2 text-sm font-normal text-slate-500">{fmt(listData.total)} clients</span> : null}
                  </>
                }
                actions={
                  <>
                    {listData ? (
                      <>
                        <IconButton
                          label="Previous page"
                          icon={<ChevronLeft className="h-4 w-4" />}
                          disabled={listLoading || listData.page === 0}
                          onClick={() => void openList(listKey, listPage - 1)}
                          className="h-10 w-10 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 md:h-8 md:w-8"
                        />
                        <span className="text-xs tabular-nums text-slate-600">
                          {fmt(listData.total === 0 ? 0 : listData.page * listData.pageSize + 1)}–
                          {fmt(Math.min(listData.total, (listData.page + 1) * listData.pageSize))} of {fmt(listData.total)}
                        </span>
                        <IconButton
                          label="Next page"
                          icon={<ChevronRight className="h-4 w-4" />}
                          disabled={listLoading || (listData.page + 1) * listData.pageSize >= listData.total}
                          onClick={() => void openList(listKey, listPage + 1)}
                          className="h-10 w-10 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 md:h-8 md:w-8"
                        />
                      </>
                    ) : null}
                    <IconButton
                      label="Close list"
                      icon={<X className="h-4 w-4" />}
                      onClick={() => {
                        setListKey(null);
                        setListData(null);
                      }}
                      className="h-10 w-10 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 md:h-8 md:w-8"
                    />
                  </>
                }
              />
              <CardBody>
                {listLoading && !listData ? <LoadingState label="Loading…" /> : null}
                {!listLoading && !listData ? (
                  <EmptyState compact title="Could not load this list" description="Close the list and try again." />
                ) : null}
                {listData ? (
                  listData.rows.length === 0 ? (
                    <EmptyState compact title="No clients in this list." />
                  ) : (
                    <div className={cx('grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3', listLoading ? 'opacity-60' : '')}>
                      {listData.rows.map((row) => (
                        <ClientRow key={row.clientId} row={row} />
                      ))}
                    </div>
                  )
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {/* Engagement */}
          <Card>
            <CardHeader
              title="Engagement"
              description="Last attended visit: a completed or checked-in appointment, a signed note, or a billed Valant charge (any service type)."
            />
            <CardBody>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  { label: 'Seen in 30 days', v: r.engagement.seen30 },
                  { label: 'Seen in 60 days', v: r.engagement.seen60 },
                  { label: 'Seen in 90 days', v: r.engagement.seen90 },
                  { label: 'No visit in 90 days', v: r.engagement.notSeen90 },
                  { label: 'No visit on record', v: r.engagement.neverSeen },
                ].map((e) => (
                  <div key={e.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="stat-number text-xl font-semibold text-slate-900">{fmt(e.v)}</p>
                    <p className="text-xs font-semibold text-slate-700">{e.label}</p>
                    <p className="text-xs text-slate-500">
                      of {fmt(n)} ({pctOf(e.v, n)})
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                      <div className="h-full rounded-full bg-blue-600" style={{ width: n ? `${(e.v / n) * 100}%` : 0 }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Measurement-based care among clients seen in 90 days: {fmt(r.mbc.seenMeasured.numerator)} of {fmt(r.mbc.seenMeasured.denominator)}
                {r.mbc.seenMeasured.pct == null ? '' : ` (${r.mbc.seenMeasured.pct}%)`} had a PHQ-9 or GAD-7.
                {r.overdue.available
                  ? ' Overdue sessions use the Session Frequency rules (treatment plan or authorization frequency; weekly therapy when none is set).'
                  : ''}
              </p>
            </CardBody>
          </Card>

          {/* Action items */}
          <Card>
            <CardHeader
              icon={<ClipboardList className="text-blue-600" />}
              title="Action items"
              description="Derived from recorded data only. An item clears when the underlying record changes."
            />
            <CardBody className="space-y-4">
              {r.actions.length === 0 ? <EmptyState compact title="No action items." /> : null}
              {r.actions.map((a) => (
                <div key={a.kind} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{a.label}</h3>
                    <StatusBadge size="sm" tone={URGENCY[a.urgency].tone}>
                      {URGENCY[a.urgency].label}
                    </StatusBadge>
                    <span className="text-xs font-semibold tabular-nums text-slate-600">
                      {fmt(a.count)} of {fmt(n)}
                    </span>
                  </div>
                  <p className="mb-3 text-xs text-slate-500">{a.source}</p>
                  {a.preview.length ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {a.preview.map((row) => (
                        <ClientRow key={row.clientId} row={row} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">None.</p>
                  )}
                  {a.count > a.preview.length ? (
                    <button
                      type="button"
                      onClick={() => void openList(`action:${a.kind}`, 0)}
                      className={cx('mt-3 rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                    >
                      View all {fmt(a.count)}
                    </button>
                  ) : null}
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Outcome trends */}
          <Card>
            <CardHeader
              title="Aggregate outcome trends"
              description={
                <>
                  Monthly average of recorded scores over the last {OUTCOME_MONTHS} months (Outcomes &amp; Reports, same filters). Not adjusted
                  for who was measured.
                </>
              }
              actions={
                <Tabs
                  variant="pill"
                  label="Outcome measure"
                  controlsPanels={false}
                  value={trendMeasure}
                  onChange={setTrendMeasure}
                  items={[
                    { key: 'PHQ-9', label: 'PHQ-9' },
                    { key: 'GAD-7', label: 'GAD-7' },
                  ]}
                />
              }
            />
            <CardBody>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {orderedCharts.map((chart) => (
                  <div key={chart.key} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{chart.title}</p>
                    <TrendSpark values={chart.points.map((p) => p.avg)} tone={chart.tone} />
                    <div className="mt-1 flex justify-between px-1 text-[11px] text-slate-500">
                      {chart.points.map((p) => (
                        <span key={p.month}>{shortMonth(p.month)}</span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500">{chart.threshold}</span>
                      {chart.points.length >= 2 ? (
                        <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-slate-700">
                          <TrendingDown className="h-3 w-3" aria-hidden /> {chart.points[0].avg} to {chart.points[chart.points.length - 1].avg}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                <Link href="/dashboard/reports/outcomes" className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
                  Outcomes &amp; Reports
                </Link>{' '}
                has per-client change, response and remission.
              </p>
            </CardBody>
          </Card>

          {/* Clinician caseload balance */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Clinician caseload balance"
              description={
                <>
                  Active clients by assigned clinician ({fmt(r.clinicians.filter((c) => c.clinicianId).length)} clinicians
                  {r.clinicians.some((c) => !c.clinicianId) ? ' + unassigned' : ''}). Rows add up to {fmt(n)}.
                </>
              }
            />
            <div className="clinic-scroll-x">
              <table className="w-full min-w-full border-collapse text-sm">
                <caption className="sr-only">Active clients by assigned clinician</caption>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left">
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600">Clinician</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Active clients</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600">High risk</th>
                    <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600 md:table-cell">Overdue sessions</th>
                    <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600 md:table-cell">Seen in 30 days</th>
                    <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600 md:table-cell">PHQ-9/GAD-7 in 90 days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.clinicians.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState compact title="No active clients in this filter." />
                      </td>
                    </tr>
                  ) : null}
                  {r.clinicians.map((c) => (
                    <tr key={c.clinicianId ?? 'unassigned'} className="transition-colors hover:bg-slate-50">
                      <td className={cx('px-4 py-3 font-semibold', c.clinicianId ? 'text-slate-900' : 'text-amber-700')}>{c.name}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{fmt(c.activeClients)}</td>
                      <td className="px-4 py-3 text-right">
                        <StatusBadge tone="danger" className="tabular-nums">
                          {fmt(c.highRisk)}
                        </StatusBadge>
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-slate-700 md:table-cell">{fmt(c.overdue)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-slate-700 md:table-cell">
                        {fmt(c.seen30)} <span className="text-xs text-slate-500">({pctOf(c.seen30, c.activeClients)})</span>
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-slate-700 md:table-cell">
                        {fmt(c.measured90)} <span className="text-xs text-slate-500">({pctOf(c.measured90, c.activeClients)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {saved.length ? (
            <Card>
              <CardHeader
                title="Saved notes (manual)"
                description="Hand-entered items from the previous version of this page. Read only, and not counted in any number above."
              />
              <CardBody>
                <ul className="space-y-2 text-sm">
                  {saved.map((a, i) => (
                    <li key={a.id ?? i} className="rounded-lg border border-slate-200 px-3 py-2">
                      <span className="font-semibold text-slate-800">{a.clientName || 'No client'}</span>
                      {a.title ? <span className="text-slate-600"> — {a.title}</span> : null}
                      <span className="ml-2 text-xs text-slate-500">{[a.urgency, a.due, a.done ? 'done' : null].filter(Boolean).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
