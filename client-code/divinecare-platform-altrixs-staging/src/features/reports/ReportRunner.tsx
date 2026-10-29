'use client';

/**
 * Report runner: parameter form -> POST /api/reports/library/[id]/run -> KPI tiles, chart, sortable
 * paginated table (server-side sort / paging), notices, data sources with "as of", definitions and
 * exports (CSV / Excel / PDF via /export, print view via the browser). Every run is audit-logged
 * on the server.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Lock,
  Play,
  Printer,
  ShieldCheck,
  Star,
  Users,
  Bookmark,
  CheckCircle2,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { displayCell } from '@/lib/reports/library/exportFormat';
import type { ReportMeta, ReportOptions, ReportRunResult } from '@/lib/reports/library/types';
import { readFavorites, recordRecent, toggleFavorite, type LibraryResponse } from './libraryClient';
import { SCHEDULES, WEEKDAYS } from '@/lib/reports/library/schedule';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FOCUS_RING,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  buttonClasses,
  cardClasses,
  cx,
  inputClasses,
} from '@/components/ui';

const ReportChart = dynamic(() => import('./ReportChart'), {
  ssr: false,
  loading: () => <LoadingState label="Loading chart" className="h-72" />,
});

type Values = Record<string, string>;

function defaultsFor(meta: ReportMeta): Values {
  const v: Values = {};
  for (const p of meta.params) {
    if (p.kind === 'dateRange') v.preset = p.defaultPreset;
    else if (p.kind === 'select') v[p.key] = p.default;
    else v[p.key] = '';
  }
  return v;
}

function fromQuery(meta: ReportMeta, search: string): Values {
  const sp = new URLSearchParams(search);
  const v = defaultsFor(meta);
  for (const k of ['preset', 'from', 'to', 'site', 'provider', 'payer', ...meta.params.filter((p) => p.kind === 'select').map((p) => p.key)]) {
    const x = sp.get(k);
    if (x) v[k] = x;
  }
  return v;
}

const inputCls = inputClasses;

function ParamForm({ meta, options, presets, values, onChange }: { meta: ReportMeta; options: ReportOptions; presets: LibraryResponse['presets']; values: Values; onChange: (k: string, v: string) => void }) {
  if (!meta.params.length) return <p className="text-sm text-slate-500">This report has no parameters; it always shows current data.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {meta.params.map((p) => {
        if (p.kind === 'dateRange') {
          return (
            <div key="range" className={values.preset === 'custom' ? 'sm:col-span-2' : ''}>
              <label htmlFor="rp-preset" className="mb-1 block text-xs font-semibold text-slate-600">{p.label}</label>
              <div className="flex flex-wrap gap-2">
                <select id="rp-preset" className={`${inputCls} sm:w-auto`} value={values.preset ?? p.defaultPreset} onChange={(e) => onChange('preset', e.target.value)}>
                  {presets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                {values.preset === 'custom' ? (
                  <>
                    <input aria-label="From date" type="date" className={`${inputCls} sm:w-40`} value={values.from ?? ''} onChange={(e) => onChange('from', e.target.value)} />
                    <input aria-label="To date" type="date" className={`${inputCls} sm:w-40`} value={values.to ?? ''} onChange={(e) => onChange('to', e.target.value)} />
                  </>
                ) : null}
              </div>
            </div>
          );
        }
        const id = `rp-${p.key}`;
        let control: React.ReactNode;
        if (p.kind === 'site') {
          control = (
            <select id={id} className={inputCls} value={values.site ?? ''} onChange={(e) => onChange('site', e.target.value)}>
              <option value="">All sites</option>
              {options.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          );
        } else if (p.kind === 'provider') {
          control = (
            <select id={id} className={inputCls} value={values.provider ?? ''} onChange={(e) => onChange('provider', e.target.value)}>
              <option value="">All providers</option>
              {options.providers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          );
        } else if (p.kind === 'payer') {
          control = (
            <>
              <input id={id} list="rp-payers" className={inputCls} placeholder="All payers" value={values.payer ?? ''} onChange={(e) => onChange('payer', e.target.value)} />
              <datalist id="rp-payers">{options.payers.map((x) => <option key={x} value={x} />)}</datalist>
            </>
          );
        } else {
          control = (
            <select id={id} className={inputCls} value={values[p.key] ?? p.default} onChange={(e) => onChange(p.key, e.target.value)}>
              {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        }
        return (
          <div key={p.key}>
            <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-600" title={p.help}>{p.label}</label>
            {control}
            {p.help ? <p className="mt-0.5 text-xs text-slate-500">{p.help}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function Kpis({ r }: { r: ReportRunResult }) {
  if (!r.kpis.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
      {r.kpis.map((k) => (
        <div key={k.label} className={cx(cardClasses, 'p-4')}>
          <p className="mb-1 text-[13px] font-medium text-slate-600">{k.label}</p>
          <p className={cx('stat-number text-2xl font-semibold tracking-tight', k.value === null ? 'text-slate-500' : 'text-slate-900')}>
            {k.value === null ? 'No data' : displayCell(k.value, k.type, r.timeZone)}
          </p>
          {k.hint ? <p className="mt-1 text-xs text-slate-500">{k.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ResultTable({ r, sort, dir, onSort }: { r: ReportRunResult; sort: string; dir: 'asc' | 'desc'; onSort: (key: string) => void }) {
  return (
    <div className={cx(cardClasses, 'max-h-[65vh] overflow-auto print:max-h-none print:overflow-visible')}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]">
          <tr>
            {r.columns.map((c) => {
              const active = sort === c.key;
              const numeric = c.type !== 'text' && c.type !== 'date' && c.type !== 'datetime';
              return (
                <th key={c.key} scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600 ${numeric ? 'text-right' : 'text-left'}`} title={c.description}>
                  <button type="button" onClick={() => onSort(c.key)} className={cx('inline-flex items-center gap-1 rounded hover:text-slate-900', FOCUS_RING)}>
                    {c.label}
                    {active ? dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden /> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {r.rows.length === 0 ? (
            <tr><td colSpan={r.columns.length}><EmptyState compact title="No rows for these parameters." /></td></tr>
          ) : (
            r.rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                {r.columns.map((c) => {
                  const numeric = c.type !== 'text' && c.type !== 'date' && c.type !== 'datetime';
                  const text = displayCell(row[c.key] ?? null, c.type, r.timeZone);
                  const clientId = typeof row.clientId === 'string' ? row.clientId : null;
                  return (
                    <td key={c.key} className={`whitespace-nowrap px-4 py-2 text-slate-700 ${numeric ? 'text-right tabular-nums' : ''}`}>
                      {c.key === 'client' && clientId ? (
                        <Link href={`/dashboard/clients/${clientId}`} className="font-semibold text-blue-700 hover:underline">{text}</Link>
                      ) : text}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SavePanel({ reportId, defaultName, params, onClose }: { reportId: string; defaultName: string; params: Record<string, string | number>; onClose: () => void }) {
  const [name, setName] = useState(defaultName);
  const [schedule, setSchedule] = useState('none');
  const [hour, setHour] = useState(7);
  const [weekday, setWeekday] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) if (!['page', 'pageSize', 'sort', 'dir'].includes(k)) clean[k] = String(v);
      const r = await apiJson<{ success: boolean; view: { scheduleText: string } }>('/api/reports/library/saved', {
        method: 'POST',
        body: JSON.stringify({ reportId, name, params: clean, schedule, scheduleHour: hour, scheduleWeekday: weekday }),
      });
      setMsg({ ok: true, text: `Saved. ${r.view.scheduleText}. Find it under Saved in the report library.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx(cardClasses, 'space-y-3 p-4 print:hidden')} data-print-hide>
      <h2 className="text-sm font-semibold text-slate-900">Save these parameters</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label htmlFor="sv-name" className="mb-1 block text-xs font-semibold text-slate-600">Name (do not include patient names)</label>
          <input id="sv-name" maxLength={120} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="sv-schedule" className="mb-1 block text-xs font-semibold text-slate-600">Email me a link</label>
          <select id="sv-schedule" className={inputCls} value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            {SCHEDULES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </div>
        {schedule !== 'none' ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {schedule === 'weekly' ? (
              <div className="flex-1">
                <label htmlFor="sv-weekday" className="mb-1 block text-xs font-semibold text-slate-600">Day</label>
                <select id="sv-weekday" className={inputCls} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            ) : null}
            <div className="flex-1">
              <label htmlFor="sv-hour" className="mb-1 block text-xs font-semibold text-slate-600">Time (practice clock)</label>
              <select id="sv-hour" className={inputCls} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`}</option>)}
              </select>
            </div>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">Only the parameters are saved, never the results. A scheduled email holds the report name and a sign-in link only; the report runs with your access when you open it.</p>
      {msg ? (
        <Alert tone={msg.ok ? 'success' : 'danger'} icon={msg.ok ? <CheckCircle2 /> : <AlertTriangle />}>{msg.text}</Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!name.trim()} loading={busy} icon={<Bookmark />} onClick={save}>
          Save
        </Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export function ReportRunner({ id, library }: { id: string; library: LibraryResponse }) {
  const meta = library.reports.find((r) => r.id === id) ?? null;
  const [values, setValues] = useState<Values>({});
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState('');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [fav, setFav] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    if (!meta) return;
    setValues(fromQuery(meta, window.location.search));
    setFav(readFavorites().includes(meta.id));
    setReady(true);
  }, [meta]);

  const body = useCallback(
    (extra: Record<string, string | number> = {}) => {
      const out: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(values)) if (v !== '' && v != null) out[k] = v;
      if (out.preset !== 'custom') {
        delete out.from;
        delete out.to;
      }
      return { ...out, ...extra };
    },
    [values]
  );

  const run = useCallback(
    async (opts: { page?: number; pageSize?: number; sort?: string; dir?: 'asc' | 'desc' } = {}) => {
      if (!meta) return;
      const pg = opts.page ?? 1;
      const ps = opts.pageSize ?? pageSize;
      const s = opts.sort ?? sort;
      const d = opts.dir ?? dir;
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<{ success: boolean; result: ReportRunResult }>(`/api/reports/library/${encodeURIComponent(meta.id)}/run`, {
          method: 'POST',
          body: JSON.stringify(body({ page: pg, pageSize: ps, ...(s ? { sort: s, dir: d } : {}) })),
        });
        setResult(res.result);
        recordRecent(meta.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not run the report');
      } finally {
        setLoading(false);
      }
    },
    [meta, body, pageSize, sort, dir]
  );

  // First run with the default (or linked) parameters
  useEffect(() => {
    if (ready) void run({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const exportHref = useCallback(
    (format: string) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(body(sort ? { sort, dir } : {}))) sp.set(k, String(v));
      sp.set('format', format);
      return `/api/reports/library/${encodeURIComponent(id)}/export?${sp.toString()}`;
    },
    [body, id, sort, dir]
  );

  const pages = useMemo(() => (result ? Math.max(1, Math.ceil(result.totalRows / result.pageSize)) : 1), [result]);

  if (!meta) {
    return (
      <Page width="narrow">
        <Card>
          <EmptyState
            icon={<Lock />}
            title="This report is not available for your role."
            action={
              <Link href="/dashboard/reports" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                <ArrowLeft size={14} aria-hidden /> Back to the report library
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const catLabel = library.categories.find((c) => c.id === meta.category)?.label ?? meta.category;
  const onSort = (key: string) => {
    const nextDir = sort === key && dir === 'asc' ? 'desc' : 'asc';
    setSort(key);
    setDir(nextDir);
    void run({ page: 1, sort: key, dir: nextDir });
  };

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="flex flex-col gap-1 normal-case tracking-normal">
            <Link href="/dashboard/reports" className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline print:hidden">
              <ArrowLeft size={12} aria-hidden /> Report library
            </Link>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{catLabel}</span>
          </span>
        }
        title={
          <span className="flex items-center gap-2">
            {meta.title}
            <button
              type="button"
              onClick={() => setFav(toggleFavorite(meta.id).includes(meta.id))}
              aria-pressed={fav}
              aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
              className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-amber-500 md:h-8 md:w-8 print:hidden', FOCUS_RING)}
            >
              <Star size={18} aria-hidden className={fav ? 'fill-amber-500 text-amber-500' : 'fill-none'} />
            </button>
          </span>
        }
        description={meta.description}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden" data-print-hide>
            <a href={exportHref('csv')} className={buttonClasses({ variant: 'secondary', size: 'sm' })}><Download size={16} aria-hidden /> CSV</a>
            <a href={exportHref('xlsx')} className={buttonClasses({ variant: 'secondary', size: 'sm' })}><FileSpreadsheet size={16} aria-hidden /> Excel</a>
            <a href={exportHref('pdf')} className={buttonClasses({ variant: 'secondary', size: 'sm' })}><FileText size={16} aria-hidden /> PDF</a>
            <Button variant="secondary" size="sm" icon={<Printer />} onClick={() => window.print()}>Print</Button>
            <Button variant="secondary" size="sm" icon={<Bookmark />} onClick={() => setSaveOpen((v) => !v)} aria-expanded={saveOpen}>Save / schedule</Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {meta.output === 'patient' ? (
            <StatusBadge size="sm" tone="warning" icon={<Lock />}>Patient-level (PHI)</StatusBadge>
          ) : (
            <StatusBadge size="sm" tone="neutral">Aggregate</StatusBadge>
          )}
          {result ? (
            <StatusBadge size="sm" tone="brand" icon={<Users />}>
              {result.scope === 'caseload' ? 'My caseload' : 'Organization-wide'}
            </StatusBadge>
          ) : null}
          {result?.suppressed ? <StatusBadge size="sm" tone="neutral" icon={<ShieldCheck />}>Small counts suppressed</StatusBadge> : null}
          {meta.link ? (
            <Link href={meta.link.href} className="inline-flex items-center gap-0.5 text-xs font-semibold text-blue-700 hover:underline print:hidden">
              {meta.link.label} <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : null}
        </div>
      </PageHeader>

      <form
        className={cx(cardClasses, 'space-y-3 p-4 print:hidden')}
        data-print-hide
        onSubmit={(e) => {
          e.preventDefault();
          void run({ page: 1 });
        }}
      >
        <ParamForm meta={meta} options={library.options} presets={library.presets} values={values} onChange={(k, v) => setValues((cur) => ({ ...cur, [k]: v }))} />
        <div className="flex items-center gap-3">
          <Button type="submit" loading={loading} icon={<Play />}>
            Run report
          </Button>
          {result ? <span className="text-xs text-slate-500">Ran in {(result.durationMs / 1000).toFixed(1)} s</span> : null}
        </div>
      </form>

      {saveOpen ? <SavePanel reportId={meta.id} defaultName={meta.title} params={body()} onClose={() => setSaveOpen(false)} /> : null}

      {result ? <p className="hidden text-sm text-slate-600 print:block">{result.paramLabel}</p> : null}

      {error ? (
        <Alert tone="danger" icon={<AlertTriangle />}>{error}</Alert>
      ) : null}

      {!result && loading ? (
        <LoadingState label="Running report" />
      ) : null}

      {result ? (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          {result.notices.length || result.hiddenSensitiveClients ? (
            <Alert tone="warning" icon={false}>
              <div className="space-y-1">
                {result.notices.map((n) => (
                  <p key={n} className="flex items-start gap-2"><Info size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-700" /> {n}</p>
                ))}
                {result.hiddenSensitiveClients ? (
                  <p className="flex items-start gap-2"><Lock size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-700" /> {result.hiddenSensitiveClients} protected (42 CFR Part 2 / restricted) client record(s) you cannot open are left out of this report.</p>
                ) : null}
              </div>
            </Alert>
          ) : null}

          <Kpis r={result} />

          {result.chart ? (
            <div className={cx(cardClasses, 'p-4')}>
              <ReportChart spec={result.chart} rows={result.rows} timeZone={result.timeZone} />
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 print:hidden" data-print-hide>
              <span>
                {result.totalRows.toLocaleString('en-US')} row{result.totalRows === 1 ? '' : 's'}
                {result.totalRows > result.pageSize ? ` · page ${result.page} of ${pages}` : ''}
              </span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  Rows per page
                  <select className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')} value={pageSize} onChange={(e) => { const n = Number(e.target.value); setPageSize(n); void run({ page: 1, pageSize: n }); }}>
                    {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <IconButton label="Previous page" icon={<ChevronLeft size={16} />} disabled={result.page <= 1 || loading} onClick={() => run({ page: result.page - 1 })} className="h-10 w-10 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 md:h-8 md:w-8" />
                <IconButton label="Next page" icon={<ChevronRight size={16} />} disabled={result.page >= pages || loading} onClick={() => run({ page: result.page + 1 })} className="h-10 w-10 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 md:h-8 md:w-8" />
              </div>
            </div>
            <ResultTable r={result} sort={sort} dir={dir} onSort={onSort} />
            {result.totalRows > result.rows.length ? <p className="hidden text-xs text-slate-500 print:block">Printed rows: this page only. Use the PDF export for every row.</p> : null}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              <p className="mb-2 flex items-center gap-1.5 font-semibold text-slate-800"><Database size={14} aria-hidden /> Data sources</p>
              <ul className="space-y-1.5">
                {result.sources.map((s) => (
                  <li key={s.name}>
                    <span className="font-semibold text-slate-700">{s.name}</span>
                    {s.empty ? <StatusBadge size="sm" tone="warning" className="ml-1.5">No data</StatusBadge> : null}
                    {s.rows != null ? <span className="text-slate-500"> · {s.rows.toLocaleString('en-US')} rows</span> : null}
                    {s.asOf ? <span className="text-slate-500"> · as of {displayCell(s.asOf, 'datetime', result.timeZone)}</span> : null}
                    {s.note ? <span className="block text-slate-500">{s.note}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-slate-500">
                Data as of {displayCell(result.asOf, 'datetime', result.timeZone)} ({result.timeZone}). Generated {displayCell(result.generatedAt, 'datetime', result.timeZone)}. {result.paramLabel}
              </p>
            </div>
            <details open className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-slate-800"><BookOpen size={14} aria-hidden /> Definitions</summary>
              <dl className="mt-2 space-y-1.5">
                {result.definitions.map(([k, v]) => (
                  <div key={k}><dt className="inline font-semibold text-slate-700">{k}: </dt><dd className="inline">{v}</dd></div>
                ))}
              </dl>
            </details>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
