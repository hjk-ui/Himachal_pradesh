'use client';

/**
 * Clinical Insights (/dashboard/ai-insights). Server-computed, rule-based priority for chart review
 * plus population patterns. Every number on this page is a count of the rows returned by
 * /api/insights/clinical, computed with the same predicate as the list it opens (tiles = lists).
 * No predictions: tiers come from the documented rules (src/lib/insights/clinical/rules.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowDown, ArrowUp, ClipboardList, Filter, Info, Loader2, RefreshCw, Search, ShieldAlert, Sparkles, Users, X,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { ConfirmDialog, FormField, PageHeader, buttonClasses } from '@/components/ui';
import {
  BREAKDOWN_DIMS, BREAKDOWN_LABEL, CARE_GAP_KEYS, CARE_GAPS, EMPTY_FILTERS, filterRows, NO_PROGRAM,
  careGapTileFilters, noFutureTileFilters, signalTileFilters, sortRows, tierTileFilters, tileCounts, zeroCoverageBanners,
  type BreakdownDim, type CareGapKey, type InsightFilters, type InsightRow, type PopulationView, type SortKey, type TileCounts,
} from '@/lib/insights/clinical/population';
import { SIGNAL_KEYS, SIGNAL_META } from '@/lib/insights/clinical/rules';
import { CATEGORY_LABEL, SIGNAL_CATEGORIES, TIER_LABEL, TIERS, type SignalCategory, type SignalKey, type Tier } from '@/lib/insights/clinical/types';
import { ClientDrawer } from './ClientDrawer';
import { SignalChip, TIER_STYLE, TierBadge, fmtDay, pctText } from './ui';

const TrendsCharts = dynamic(() => import('./TrendsCharts'), {
  ssr: false,
  loading: () => <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">Loading charts…</p>,
});

type Payload = {
  success: true;
  generatedAt: string | null;
  today: string;
  lastRun: { trigger: string; status: string; startedAt: string; durationMs: number | null } | null;
  scanBusy: boolean;
  scope: 'organization' | 'caseload';
  viewerId: string;
  clientsInScope: number;
  notScanned: number;
  sensitiveHidden: number;
  truncated: boolean;
  aiConfigured: boolean;
  rows: InsightRow[];
  tiles: TileCounts;
  view: PopulationView;
  options: { clinicians: { id: string; name: string }[]; locations: { id: string; name: string }[]; programs: string[]; payers: string[]; dxGroups: string[] };
  rules: { id: string; tier: string; text: string }[];
};

type NlResult =
  | { status: 'ok'; filters: InsightFilters; applied: string[]; ignored: string[] }
  | { status: 'unavailable' | 'rejected'; message: string; ignored?: string[] };

type NarrativeResult =
  | { status: 'ok'; sentences: { text: string; cites: string[] }[]; facts: { id: string; text: string }[]; model: string; generatedAt: string; cached: boolean }
  | { status: 'unavailable' | 'rejected'; message: string; facts: { id: string; text: string }[] };

const PAGE = 50;
const selectCls = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

function Tile({ label, value, sub, active, onClick, color }: { label: string; value: number | string; sub?: string; active?: boolean; onClick?: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border bg-white p-4 text-left shadow-xs transition hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${active ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-200'}`}
    >
      <p className={`text-2xl font-semibold tabular-nums ${color ?? 'text-slate-900'}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-700">{label}</p>
      {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
    </button>
  );
}

function sameFilters(a: InsightFilters, b: InsightFilters) {
  return JSON.stringify({ ...a, search: '' }) === JSON.stringify({ ...b, search: '' });
}

export default function ClinicalInsightsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<InsightFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'priority', dir: 'asc' });
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [dim, setDim] = useState<BreakdownDim>('location');
  const [nlQuery, setNlQuery] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nl, setNl] = useState<NlResult | null>(null);
  const [narr, setNarr] = useState<{ label: string; result: NarrativeResult } | null>(null);
  const [narrBusy, setNarrBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiJson<Payload>(`/api/insights/clinical${refresh ? '?refresh=1' : ''}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load clinical insights');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const viewerId = data?.viewerId ?? null;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const tiles = useMemo(() => tileCounts(rows, filters, viewerId), [rows, filters, viewerId]);
  const list = useMemo(() => sortRows(filterRows(rows, filters, viewerId), sort.key, sort.dir), [rows, filters, viewerId, sort]);
  const banners = useMemo(() => zeroCoverageBanners(rows), [rows]);
  const set = (patch: Partial<InsightFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const apply = (f: InsightFilters) => {
    setFilters((cur) => (sameFilters(cur, f) ? { ...EMPTY_FILTERS, search: cur.search } : f));
    setShown(PAGE);
  };
  const active = (f: InsightFilters) => sameFilters(filters, f);
  const filtered = !sameFilters(filters, EMPTY_FILTERS) || filters.search.trim().length > 0;

  async function runNl() {
    if (!nlQuery.trim()) return;
    setNlBusy(true);
    try {
      const r = await apiJson<{ success: true; result: NlResult }>('/api/insights/clinical/nl-filter', { method: 'POST', body: JSON.stringify({ query: nlQuery.trim() }) });
      setNl(r.result);
      if (r.result.status === 'ok') {
        setFilters({ ...r.result.filters, search: '' });
        setShown(PAGE);
      }
    } catch (e) {
      setNl({ status: 'rejected', message: e instanceof Error ? e.message : 'AI unavailable — use the filters below' });
    } finally {
      setNlBusy(false);
    }
  }

  async function runNarrative(refresh = false) {
    setNarrBusy(true);
    try {
      const r = await apiJson<{ success: true; label: string; result: NarrativeResult }>('/api/insights/clinical/narrative', { method: 'POST', body: JSON.stringify({ refresh }) });
      setNarr({ label: r.label, result: r.result });
    } catch (e) {
      setNarr({ label: '', result: { status: 'rejected', message: e instanceof Error ? e.message : 'AI unavailable', facts: [] } });
    } finally {
      setNarrBusy(false);
    }
  }

  const headerSort = (key: SortKey, label: string) => {
    const on = sort.key === key;
    return (
      <th scope="col" className={key === 'name' ? 'sticky left-0 z-10 bg-slate-50 px-3 py-2.5' : 'px-3 py-2.5'} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => setSort({ key, dir: on && sort.dir === 'asc' ? 'desc' : 'asc' })} className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-slate-700">
          {label} {on ? sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden /> : null}
        </button>
      </th>
    );
  };

  const v = data?.view;
  const currentWeek = v?.trends.weeks.at(-1)?.start ?? '';

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Clinical Insights"
        description={<>Who needs attention and why, from recorded scores, safety events, visits, plans, medications and social needs {data ? ` — ${data.scope === 'caseload' ? 'your caseload' : 'the organization'}` : ''}.</>}
        actions={<>
          <button
          type="button"
          onClick={() => (data?.scope === 'organization' ? setConfirmRefresh(true) : void load(true))}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden /> Refresh
        </button>
        </>}
      >
        {data ? (
            <p className="mt-1 text-xs text-slate-500">
              {data.generatedAt ? `Computed ${new Date(data.generatedAt).toLocaleString('en-US')}` : 'Not computed yet'}
              {data.notScanned ? ` · ${data.notScanned} active client(s) not in the last computation — refresh to include them` : ''}
              {data.sensitiveHidden ? ` · ${data.sensitiveHidden} protected record(s) you cannot open are not shown` : ''}
              {data.scanBusy ? ' · a computation is already running; showing the last one' : ''}
            </p>
          ) : null}
          {error ? <p role="alert" className="mt-1 text-sm text-rose-600">{error}</p> : null}
      </PageHeader>

      <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          Decision support for chart review, not a prediction model: tiers come from the written rules below (each chip shows the signal, its value and date).
          Missing data is listed, never counted as normal. Use clinical judgment and the client&apos;s safety plan; in an emergency call 988 or 911.
        </p>
      </div>

      {banners.length ? (
        <section aria-label="Data not available" className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          {banners.map((b) => (
            <p key={b.key} className="flex items-start gap-2 text-xs text-amber-900">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden /> {b.text}
            </p>
          ))}
        </section>
      ) : null}

      {loading && !data ? (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" aria-hidden /> Computing insights…</p>
      ) : null}

      {data && v ? (
        <>
          {/* Natural-language filter */}
          <form
            className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs"
            onSubmit={(e) => {
              e.preventDefault();
              void runNl();
            }}
          >
            <FormField label={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-blue-600" aria-hidden /> Ask for a list</span>} hint={data.aiConfigured ? 'e.g. "worsening clients at Bowie with no appointment". AI turns this into the filters below (never a database query). Do not type client names.' : 'AI unavailable — AWS Bedrock is not configured on this server. Use the filters below.'}>
              {(control) => (
                <div className="flex gap-2">
                  <input {...control} value={nlQuery} onChange={(e) => setNlQuery(e.target.value)} maxLength={200} disabled={!data.aiConfigured || nlBusy} placeholder="Describe the clients you want to see" className={`${selectCls} flex-1`} />
                  <button type="submit" disabled={!data.aiConfigured || nlBusy || !nlQuery.trim()} className={buttonClasses({ variant: 'primary' })}>
                    {nlBusy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Filter size={14} aria-hidden />} Apply
                  </button>
                </div>
              )}
            </FormField>
            {nl ? (
              <div className="mt-2 text-xs" aria-live="polite">
                {nl.status === 'ok' ? (
                  <p className="text-slate-700"><span className="font-semibold">Filters applied:</span> {nl.applied.join(' · ')}{nl.ignored.length ? <span className="text-slate-500"> · not understood: {nl.ignored.join(', ')}</span> : null}</p>
                ) : (
                  <p className="text-slate-600">{nl.message}{nl.ignored?.length ? ` (${nl.ignored.join(', ')})` : ''}</p>
                )}
              </div>
            ) : null}
          </form>

          {/* KPI tiles */}
          <section aria-label="Priority tiers and key signals" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TIERS.map((t) => (
                <Tile key={t} label={TIER_LABEL[t]} value={tiles.tiers[t]} sub={t === 'stable' ? 'nothing flagged in the data on file' : 'clients — click to list'} color={TIER_STYLE[t].text} active={active(tierTileFilters(filters, t))} onClick={() => apply(tierTileFilters(filters, t))} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Reliably worsening" value={tiles.signals.worsening} sub={`${pctText(v.kpis.worsening)} of ${v.kpis.worsening.den} with a current trajectory`} active={active(signalTileFilters(filters, 'worsening'))} onClick={() => apply(signalTileFilters(filters, 'worsening'))} />
              <Tile label="Reliably improving" value={tiles.signals.improving} sub={`${pctText(v.kpis.improving)} of ${v.kpis.improving.den} with a current trajectory`} active={active(signalTileFilters(filters, 'improving'))} onClick={() => apply(signalTileFilters(filters, 'improving'))} />
              <Tile label="PHQ-9 overdue" value={tiles.signals.phq9_overdue} sub={`measured: ${pctText(v.kpis.measurement)} of ${v.kpis.measurement.den} seen in 90 days`} active={active(signalTileFilters(filters, 'phq9_overdue'))} onClick={() => apply(signalTileFilters(filters, 'phq9_overdue'))} />
              <Tile label="No future appointment" value={tiles.noFutureAppt} sub="nothing scheduled" active={active(noFutureTileFilters(filters))} onClick={() => apply(noFutureTileFilters(filters))} />
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            {/* Worklist */}
            <section aria-labelledby="worklist-h" className="min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs">
              <div className="border-b border-slate-200/80 px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="worklist-h" className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ClipboardList size={15} aria-hidden /> Needs attention</h2>
                  <p className="text-xs text-slate-500" aria-live="polite">{list.length} of {rows.length} clients{filtered ? ' (filtered)' : ''}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Tier">
                  {TIERS.map((t) => {
                    const on = filters.tiers.includes(t);
                    return (
                      <button key={t} type="button" aria-pressed={on} onClick={() => set({ tiers: on ? filters.tiers.filter((x) => x !== t) : [...filters.tiers, t] })} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                        {TIER_LABEL[t]} ({tiles.tiers[t]})
                      </button>
                    );
                  })}
                  {data.scope === 'organization' ? (
                    <button type="button" aria-pressed={filters.myCaseload} onClick={() => set({ myCaseload: !filters.myCaseload })} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${filters.myCaseload ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                      <Users size={12} aria-hidden /> My caseload
                    </button>
                  ) : null}
                  {filtered ? (
                    <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setNl(null); setShown(PAGE); }} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      <X size={12} aria-hidden /> Clear filters
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <FormField label="Search" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                    <div className="relative">
                      <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-500" aria-hidden />
                      <input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Name or MRN" className={`${selectCls} pl-8`} />
                    </div>
                  </FormField>
                  {data.scope === 'organization' ? (
                    <FormField label="Clinician" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                      <select value={filters.clinicianId ?? ''} onChange={(e) => set({ clinicianId: e.target.value || null })} className={selectCls}>
                        <option value="">All clinicians</option>
                        {data.options.clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </FormField>
                  ) : null}
                  <FormField label="Location" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                    <select value={filters.locationId ?? ''} onChange={(e) => set({ locationId: e.target.value || null })} className={selectCls}>
                      <option value="">All locations</option>
                      {data.options.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Program" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                    <select value={filters.program ?? ''} onChange={(e) => set({ program: e.target.value || null })} className={selectCls}>
                      <option value="">All programs</option>
                      {data.options.programs.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Payer" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                    <select value={filters.payer ?? ''} onChange={(e) => set({ payer: e.target.value || null })} className={selectCls}>
                      <option value="">All payers</option>
                      {data.options.payers.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Diagnosis group" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                    <select value={filters.dxGroup ?? ''} onChange={(e) => set({ dxGroup: e.target.value || null })} className={selectCls}>
                      <option value="">All diagnoses</option>
                      {data.options.dxGroups.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Signal type" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                    <select value={filters.category ?? ''} onChange={(e) => set({ category: (e.target.value || null) as SignalCategory | null })} className={selectCls}>
                      <option value="">All types</option>
                      {SIGNAL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Signal" labelClassName="mb-1 block text-[11px] font-medium text-slate-500">
                    <select value={filters.signal ?? ''} onChange={(e) => set({ signal: (e.target.value || null) as SignalKey | null })} className={selectCls}>
                      <option value="">Any signal</option>
                      {SIGNAL_KEYS.map((k) => <option key={k} value={k}>{SIGNAL_META[k].title} ({v.signalCounts[k] ?? 0})</option>)}
                    </select>
                  </FormField>
                </div>
                {filters.careGap ? <p className="mt-2 text-xs text-slate-600">Care gap: <span className="font-medium">{CARE_GAPS[filters.careGap].label}</span></p> : null}
              </div>
              {list.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-500">{rows.length === 0 ? 'No active clients in your scope have been computed yet. Use Refresh.' : 'No clients match these filters.'}</p>
              ) : (
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Needs attention worklist (scrolls horizontally)">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        {headerSort('name', 'Client')}
                        {headerSort('priority', 'Tier')}
                        <th scope="col" className="px-3 py-2.5 font-semibold uppercase tracking-wide">Why</th>
                        {headerSort('lastVisit', 'Last visit')}
                        {headerSort('nextAppointment', 'Next appt')}
                        {headerSort('clinician', 'Clinician')}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {list.slice(0, shown).map((r) => {
                        const chips = r.signals.filter((s) => s.level !== 'info');
                        return (
                          <tr key={r.id} className="group align-top hover:bg-slate-50">
                            <td className="sticky left-0 z-10 max-w-[14rem] bg-white px-3 py-2.5 group-hover:bg-slate-50">
                              <button type="button" onClick={() => setOpenId(r.id)} className="text-left font-medium text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                                {r.name}
                              </button>
                              <span className="block text-[11px] text-slate-500">MRN {r.mrn ?? '—'}{r.location ? ` · ${r.location.name}` : ''}</span>
                            </td>
                            <td className="px-3 py-2.5"><TierBadge tier={r.tier} /></td>
                            <td className="px-3 py-2.5">
                              <div className="flex max-w-md flex-wrap gap-1">
                                {chips.slice(0, 4).map((s, i) => <SignalChip key={`${s.key}-${i}`} signal={s} />)}
                                {chips.length > 4 ? <span className="text-[11px] text-slate-500">+{chips.length - 4} more</span> : null}
                                {chips.length === 0 ? <span className="text-[11px] text-slate-500">{r.signals.length ? `${r.signals.length} info signal(s)` : '—'}</span> : null}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">{r.lastVisit ? fmtDay(r.lastVisit) : <span className="text-slate-500">— none on file</span>}</td>
                            <td className="px-3 py-2.5 text-slate-700">{r.nextAppointment ? fmtDay(r.nextAppointment) : <span className="text-slate-500">— none scheduled</span>}</td>
                            <td className="px-3 py-2.5 text-slate-700">{r.clinician?.name ?? <span className="text-slate-500">— unassigned</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {list.length > shown ? (
                    <div className="border-t border-slate-100 px-5 py-3 text-center">
                      <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-sm font-medium text-blue-600 hover:underline">Show {Math.min(PAGE, list.length - shown)} more</button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {/* Care gaps */}
            <aside aria-labelledby="gaps-h" className="space-y-4">
              <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
                <h2 id="gaps-h" className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ShieldAlert size={15} aria-hidden /> Care gaps</h2>
                <p className="text-[11px] text-slate-500">Each count opens the exact list.</p>
                <ul className="mt-2 divide-y divide-slate-100">
                  {CARE_GAP_KEYS.map((g: CareGapKey) => {
                    const f = careGapTileFilters(filters, g);
                    const on = active(f);
                    return (
                      <li key={g}>
                        <button type="button" aria-pressed={on} onClick={() => apply(f)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${on ? 'bg-blue-600/5 font-medium text-blue-600' : 'text-slate-700'}`}>
                          <span>{CARE_GAPS[g].label}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">{tiles.careGaps[g]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11px] text-slate-500">ED visits and hospital discharges are not tracked (no hospital feed is connected); discharge follow-up uses the practice discharge cases.</p>
              </section>

              <section aria-labelledby="narr-h" className="rounded-xl border border-blue-600/20 bg-blue-600/5 p-4">
                <h2 id="narr-h" className="flex items-center gap-1.5 text-sm font-semibold text-blue-600"><Sparkles size={15} aria-hidden /> What changed</h2>
                <p className="text-[11px] text-slate-600">AI summary from the aggregate statistics only (no client-level data; groups under 10 are left out).</p>
                <button type="button" onClick={() => void runNarrative(false)} disabled={narrBusy || !data.aiConfigured} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {narrBusy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />} Summarize
                </button>
                {!data.aiConfigured ? <p className="mt-2 text-xs text-slate-600">AI unavailable — AWS Bedrock is not configured on this server.</p> : null}
                {narr ? (
                  <div className="mt-3 space-y-2" aria-live="polite">
                    {narr.result.status === 'ok' ? (
                      <>
                        {narr.result.sentences.map((s, i) => <p key={i} className="text-sm text-slate-800">{s.text} <span className="text-[11px] text-slate-500">[{s.cites.join(', ')}]</span></p>)}
                        <p className="text-[11px] text-slate-500">{narr.label}</p>
                      </>
                    ) : (
                      <p className="text-sm text-slate-700">{narr.result.message}</p>
                    )}
                    {narr.result.facts.length ? (
                      <details className="text-xs text-slate-600">
                        <summary className="cursor-pointer select-none font-medium">Statistics sent ({narr.result.facts.length})</summary>
                        <ol className="mt-1 space-y-0.5">{narr.result.facts.map((f) => <li key={f.id}><span className="font-mono text-slate-500">{f.id}</span> {f.text}</li>)}</ol>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </aside>
          </div>

          {/* Trends */}
          <section aria-labelledby="trends-h" className="space-y-3">
            <div>
              <h2 id="trends-h" className="text-sm font-semibold text-slate-800">Trends</h2>
              <p className="text-xs text-slate-500">All clients in your scope (filters above apply to the worklist only). Points with fewer than 10 clients or visits are hidden.</p>
            </div>
            <TrendsCharts trends={v.trends} currentWeek={currentWeek} currentMonth={data.today.slice(0, 7)} />
            {v.trends.shifts.length ? (
              <ul className="grid gap-2 md:grid-cols-2">
                {v.trends.shifts.map((s) => (
                  <li key={s.key} className={`rounded-lg border px-3 py-2 text-xs ${s.shift.flagged ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}>
                    <p className="font-semibold">{s.shift.flagged ? 'Meaningful shift: ' : ''}{s.label}</p>
                    <p>
                      {s.period}: {pctText(s.shift.now)} (n={s.shift.now.den}) vs {s.previous}: {pctText(s.shift.prev)} (n={s.shift.prev.den})
                      {s.shift.diffPts != null ? ` · ${s.shift.diffPts > 0 ? '+' : ''}${s.shift.diffPts} points` : ''}
                      {' · '}
                      {s.shift.reason === 'flagged' ? `z = ${s.shift.z} (p < 0.05)` : s.shift.reason === 'suppressed_small_n' ? 'not tested (n<10)' : s.shift.reason === 'below_threshold' ? 'under 5 points' : 'not statistically meaningful'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Breakdowns */}
          <section aria-labelledby="bd-h" className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-5 py-3.5">
              <div>
                <h2 id="bd-h" className="text-sm font-semibold text-slate-800">Breakdown by {BREAKDOWN_LABEL[dim].toLowerCase()}</h2>
                <p className="text-[11px] text-slate-500">Groups under 10 clients show “n&lt;10”. No-show rate covers the last 12 weeks.</p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Break down by">
                {BREAKDOWN_DIMS.filter((d) => data.scope === 'organization' || d !== 'clinician').map((d) => (
                  <button key={d} type="button" aria-pressed={dim === d} onClick={() => setDim(d)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${dim === d ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{BREAKDOWN_LABEL[d]}</button>
                ))}
              </div>
            </div>
            {v.breakdowns[dim].length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No clients to break down.</p>
            ) : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Breakdown table (scrolls horizontally)">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr><th scope="col" className="sticky left-0 z-10 bg-slate-50 px-5 py-2.5">{BREAKDOWN_LABEL[dim]}</th><th scope="col" className="px-3 py-2.5">Clients</th><th scope="col" className="px-3 py-2.5">Urgent or High</th><th scope="col" className="px-3 py-2.5">Worsening</th><th scope="col" className="px-3 py-2.5">PHQ-9 in 90 days</th><th scope="col" className="px-3 py-2.5">No-show rate</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {v.breakdowns[dim].map((b) => (
                      <tr key={b.key}>
                        <td className="sticky left-0 z-10 bg-white px-5 py-2 font-medium text-slate-800">{b.label}{dim === 'program' && b.label === NO_PROGRAM ? <span className="block text-[11px] font-normal text-slate-500">no PRP / TMS / Spravato / AOT / residential enrollment</span> : null}</td>
                        <td className="px-3 py-2 text-slate-700">{b.clients}</td>
                        <td className="px-3 py-2 text-slate-700">{b.suppressed ? '— (n<10)' : `${b.urgentHigh.num} (${pctText(b.urgentHigh)})`}</td>
                        <td className="px-3 py-2 text-slate-700">{b.suppressed ? '— (n<10)' : pctText(b.worsening)}</td>
                        <td className="px-3 py-2 text-slate-700">{b.suppressed ? '— (n<10)' : pctText(b.measured)}</td>
                        <td className="px-3 py-2 text-slate-700">{b.suppressed ? '— (n<10)' : pctText(b.noShow)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Coverage + rules */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="cov-h" className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <h2 id="cov-h" className="text-sm font-semibold text-slate-800">Data coverage</h2>
              <p className="text-[11px] text-slate-500">Share of the {rows.length} clients with anything on file for each source. Low coverage means a signal cannot fire, not that the client is fine.</p>
              <ul className="mt-2 space-y-1.5">
                {v.coverage.map((c) => (
                  <li key={c.key} className="text-xs text-slate-700">
                    <div className="flex justify-between"><span>{c.label}</span><span className="font-medium">{rows.filter((r) => r.coverage?.[c.key]).length} · {rows.length ? `${Math.round((rows.filter((r) => r.coverage?.[c.key]).length / rows.length) * 100)}%` : '—'}</span></div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-100" aria-hidden>
                      <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${rows.length ? (rows.filter((r) => r.coverage?.[c.key]).length / rows.length) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="rules-h" className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <h2 id="rules-h" className="text-sm font-semibold text-slate-800">How tiers are assigned</h2>
              <p className="text-[11px] text-slate-500">Highest rule wins. Reliable change: PHQ-9 ≥ 5, GAD-7 ≥ 4, PCL-5 ≥ 10 points vs baseline or prior score.</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                {data.rules.map((r) => (
                  <li key={r.id} className="flex gap-2"><span className="w-7 shrink-0 font-mono text-slate-500">{r.id}</span><span><span className="font-semibold">{TIER_LABEL[r.tier as Tier]}:</span> {r.text}</span></li>
                ))}
                <li className="flex gap-2"><span className="w-7 shrink-0 font-mono text-slate-500">—</span><span><span className="font-semibold">Stable:</span> no rule fired. Data gaps are listed in each client&apos;s drawer.</span></li>
              </ul>
            </section>
          </div>
        </>
      ) : null}

      {openId ? <ClientDrawer clientId={openId} onClose={() => setOpenId(null)} /> : null}
      {confirmRefresh ? (
        <ConfirmDialog
          title="Recompute for the organization?"
          confirmLabel="Recompute now"
          onCancel={() => setConfirmRefresh(false)}
          onConfirm={() => {
            setConfirmRefresh(false);
            void load(true);
          }}
        >
          This re-evaluates every active client in the organization ({data?.clientsInScope ?? 0}) and can take a minute. The nightly job does this automatically.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

