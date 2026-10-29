'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Download, EyeOff, Plug, RefreshCw, X } from 'lucide-react';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  type Tone,
} from '@/components/ui';
import { CALL_STATUSES, INTEGRATIONS, INTEGRATION_LABELS, type IntegrationName } from '@/lib/integrations/callLog/constants';

type HealthState = 'ok' | 'degraded' | 'failing' | 'idle';

type Tile = {
  integration: IntegrationName;
  label: string;
  calls24h: number;
  errors24h: number;
  errorRate24h: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  calls1h: number;
  errors1h: number;
  health: HealthState;
};

type Row = {
  id: string;
  createdAt: string;
  startedAt: string;
  integration: IntegrationName;
  operation: string;
  direction: string;
  status: string;
  httpStatus: number | null;
  vendorStatus: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  correlationId: string | null;
  actorName: string | null;
  patientMrn: string | null;
  hasPayload: boolean;
};

type ListResponse = {
  success: boolean;
  error?: string;
  total: number;
  page: number;
  pageSize: number;
  tiles: Tile[];
  actors: Array<{ id: string; name: string }>;
  rows: Row[];
};

type Detail = Row & {
  finishedAt: string;
  organizationId: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown> | null;
  payload: { kind: string | null; text: string | null } | null;
  masked: boolean;
};

type Filters = { integration: string; operation: string; status: string; from: string; to: string; mrn: string; user: string };
const EMPTY_FILTERS: Filters = { integration: '', operation: '', status: '', from: '', to: '', mrn: '', user: '' };

const STATUS_TONE: Record<string, Tone> = { success: 'success', error: 'danger', throttled: 'warning', skipped: 'neutral' };
const HEALTH_TONE: Record<HealthState, Tone> = { ok: 'success', degraded: 'warning', failing: 'danger', idle: 'neutral' };
const HEALTH_LABEL: Record<HealthState, string> = { ok: 'OK', degraded: 'Degraded', failing: 'Failing', idle: 'No calls (1h)' };

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—';
const fmtMs = (ms: number | null) => (ms === null || ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const label = (i: string) => INTEGRATION_LABELS[i as IntegrationName] ?? i;

function toQuery(f: Filters, page: number) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v.trim()) q.set(k, v.trim());
  q.set('page', String(page));
  q.set('pageSize', '50');
  return q.toString();
}

export default function IntegrationLogsPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/integrations/logs?${toQuery(filters, page)}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as ListResponse | null;
        if (!r.ok || !d?.success) throw new Error(d?.error || 'Could not load integration logs');
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load integration logs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  useEffect(() => load(), [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const activeTiles = useMemo(() => (data?.tiles ?? []).filter((t) => t.calls24h > 0 || t.lastSuccessAt || t.lastErrorAt), [data]);

  return (
    <Page>
      <PageHeader
        title="Integration logs"
        description="Every call Altrixs makes to DrFirst, Waystar, Availity, AWS, Stripe, Homebase and the scheduled jobs: outcome, timing and errors. Request / response bodies are kept only where a vendor needs them (DrFirst, encrypted, 90 days)."
        actions={
          <>
            <Button variant="secondary" onClick={() => load()} aria-label="Refresh">
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden /> Refresh
            </Button>
            <Link href="/dashboard/admin" className={buttonClasses({ variant: 'secondary' })}>
              Admin & Compliance
            </Link>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader title="Integration health" description="Last hour: OK = no errors, degraded = some errors, failing = half or more of calls failed." icon={<Activity />} />
        <CardBody>
          {!data && loading ? (
            <LoadingState label="Checking integrations…" />
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Integration health">
              {(data?.tiles ?? []).map((t) => (
                <li key={t.integration} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="truncate text-sm font-medium text-slate-800">{t.label}</span>
                  <StatusBadge tone={HEALTH_TONE[t.health]} dot size="sm">
                    {HEALTH_LABEL[t.health]}
                    {t.calls1h ? ` · ${t.errors1h}/${t.calls1h}` : ''}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {activeTiles.length ? (
        <section aria-label="Integration summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {activeTiles.map((t) => (
            <button
              type="button"
              key={t.integration}
              onClick={() => {
                const next = { ...EMPTY_FILTERS, integration: t.integration };
                setDraft(next);
                setFilters(next);
                setPage(1);
              }}
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 truncate font-semibold text-slate-900">
                  <Plug className="h-4 w-4 shrink-0 text-slate-500" aria-hidden /> {t.label}
                </span>
                <StatusBadge tone={HEALTH_TONE[t.health]} size="sm">{HEALTH_LABEL[t.health]}</StatusBadge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                <dt>Last success</dt>
                <dd className="text-right text-slate-800">{fmtTime(t.lastSuccessAt)}</dd>
                <dt>Errors (24h)</dt>
                <dd className={`text-right ${t.errors24h ? 'font-semibold text-red-700' : 'text-slate-800'}`}>
                  {t.errors24h} of {t.calls24h}
                </dd>
                <dt>Error rate (24h)</dt>
                <dd className="text-right text-slate-800">{t.errorRate24h === null ? '—' : `${t.errorRate24h}%`}</dd>
                <dt>Last error</dt>
                <dd className="text-right text-slate-800">{fmtTime(t.lastErrorAt)}</dd>
              </dl>
              {t.lastError ? <p className="mt-2 line-clamp-2 break-words text-xs text-red-700">{t.lastError}</p> : null}
            </button>
          ))}
        </section>
      ) : null}

      <Card>
        <CardHeader title="Calls" description="Newest first. Select a row for details." />
        <CardBody>
          <form
            aria-label="Filter integration logs"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters(draft);
              setPage(1);
            }}
          >
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-slate-700">Integration</span>
              <select className={inputClasses} value={draft.integration} onChange={(e) => setDraft({ ...draft, integration: e.target.value })}>
                <option value="">All</option>
                {INTEGRATIONS.map((i) => (
                  <option key={i} value={i}>{INTEGRATION_LABELS[i]}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-slate-700">Operation</span>
              <input className={inputClasses} value={draft.operation} placeholder="e.g. send_patient" onChange={(e) => setDraft({ ...draft, operation: e.target.value })} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-slate-700">Status</span>
              <select className={inputClasses} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option value="">All</option>
                {CALL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-slate-700">From</span>
              <input type="date" className={inputClasses} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-slate-700">To</span>
              <input type="date" className={inputClasses} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-slate-700">Patient MRN</span>
              <input className={inputClasses} value={draft.mrn} onChange={(e) => setDraft({ ...draft, mrn: e.target.value })} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-slate-700">User</span>
              <select className={inputClasses} value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })}>
                <option value="">Anyone</option>
                {(data?.actors ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <Button type="submit">Apply</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft(EMPTY_FILTERS);
                  setFilters(EMPTY_FILTERS);
                  setPage(1);
                }}
              >
                Clear
              </Button>
            </div>
          </form>

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200" data-testid="integration-log-table-scroll">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2">Time</th>
                  <th scope="col" className="px-3 py-2">Integration</th>
                  <th scope="col" className="px-3 py-2">Operation</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">HTTP / vendor</th>
                  <th scope="col" className="px-3 py-2 text-right">Duration</th>
                  <th scope="col" className="px-3 py-2">User / patient</th>
                  <th scope="col" className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows ?? []).map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-slate-50 focus-within:bg-slate-50"
                    onClick={() => setOpenId(r.id)}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      <button type="button" className="rounded text-left font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>
                        {fmtTime(r.createdAt)}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{label(r.integration)}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs" title={r.operation}>{r.operation}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={STATUS_TONE[r.status] ?? 'neutral'} size="sm" dot>{r.status}</StatusBadge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {r.httpStatus ?? '—'}
                      {r.vendorStatus ? <span className="ml-1 text-xs text-slate-500">{r.vendorStatus}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtMs(r.durationMs)}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-slate-700">
                      {r.actorName ?? 'System'}
                      {r.patientMrn ? <span className="block text-xs text-slate-500">MRN {r.patientMrn}</span> : null}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-xs text-red-700" title={r.errorMessage ?? ''}>{r.errorMessage ?? r.errorCode ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && data && data.rows.length === 0 ? (
              <EmptyState title="No calls match these filters" description="Calls appear here as integrations run. DrFirst calls and Waystar retrievals before this release were imported." />
            ) : null}
            {loading && data ? <p className="px-3 py-2 text-xs text-slate-500">Loading…</p> : null}
          </div>

          <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <span>
              {data ? `${data.total.toLocaleString()} calls · page ${page} of ${pages}` : ''}
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Newer
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
                Older <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
            </span>
          </nav>
        </CardBody>
      </Card>

      {openId ? <LogDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
    </Page>
  );
}

function LogDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [masked, setMasked] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/admin/integrations/logs/${encodeURIComponent(id)}?masked=${masked ? '1' : '0'}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as { success?: boolean; error?: string; data?: Detail } | null;
        if (!r.ok || !d?.success || !d.data) throw new Error(d?.error || 'Could not load the log entry');
        if (!cancelled) setDetail(d.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the log entry');
      });
    return () => {
      cancelled = true;
    };
  }, [id, masked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const downloadHref = `/api/admin/integrations/logs/${encodeURIComponent(id)}?download=1&masked=${masked ? '1' : '0'}`;
  const facts: Array<[string, string]> = detail
    ? [
        ['Integration', label(detail.integration)],
        ['Operation', detail.operation],
        ['Direction', detail.direction],
        ['Status', `${detail.status}${detail.httpStatus ? ` (HTTP ${detail.httpStatus})` : ''}`],
        ['Vendor status', detail.vendorStatus ?? '—'],
        ['Started', fmtTime(detail.startedAt)],
        ['Finished', fmtTime(detail.finishedAt)],
        ['Duration', fmtMs(detail.durationMs)],
        ['Correlation id', detail.correlationId ?? '—'],
        ['User', detail.actorName ?? 'System'],
        ['Patient MRN', detail.patientMrn ?? '—'],
        ['Log id', detail.id],
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="integration-log-drawer-title">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="integration-log-drawer-title" className="truncate text-base font-semibold text-slate-900">
              {detail ? `${label(detail.integration)} · ${detail.operation}` : 'Call details'}
            </h2>
            {detail ? (
              <StatusBadge tone={STATUS_TONE[detail.status] ?? 'neutral'} size="sm" dot className="mt-1">{detail.status}</StatusBadge>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {!detail && !error ? <LoadingState label="Loading…" /> : null}
          {detail ? (
            <>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                {facts.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-medium text-slate-600">{k}</dt>
                    <dd className="min-w-0 break-words text-slate-900">{v}</dd>
                  </div>
                ))}
              </dl>

              {detail.errorMessage || detail.errorCode ? (
                <Alert tone="danger">
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      {detail.errorCode ? <strong className="mr-1">{detail.errorCode}</strong> : null}
                      {detail.errorMessage}
                    </span>
                  </span>
                </Alert>
              ) : null}

              {detail.metadata && Object.keys(detail.metadata).length ? (
                <section aria-label="Metadata">
                  <h3 className="mb-1 text-sm font-semibold text-slate-800">Metadata</h3>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-800">
                    {JSON.stringify(detail.metadata, null, 2)}
                  </pre>
                </section>
              ) : null}

              <section aria-label="Request and response">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {detail.payload?.text ? `Stored ${detail.payload.kind ?? 'payload'} (secrets removed)` : 'Payload'}
                  </h3>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} />
                    <EyeOff className="h-3.5 w-3.5" aria-hidden /> Mask patient identifiers
                  </label>
                </div>
                {detail.payload?.text ? (
                  <pre className="max-h-[50vh] overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100" data-testid="integration-log-payload">
                    {detail.payload.text}
                  </pre>
                ) : (
                  <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    {detail.sourceTable === 'drfirst_api_logs'
                      ? 'No body stored for this call (DrFirst bodies are kept 90 days).'
                      : 'Bodies are not stored for this integration (metadata only).'}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.payload?.text ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(detail.payload?.text ?? '').then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                      }}
                    >
                      {copied ? <Check className="mr-1 h-4 w-4" aria-hidden /> : <Copy className="mr-1 h-4 w-4" aria-hidden />} {copied ? 'Copied' : 'Copy'}
                    </Button>
                  ) : null}
                  <a href={downloadHref} className={buttonClasses({ variant: 'secondary', size: 'sm' })} download>
                    <Download className="mr-1 h-4 w-4" aria-hidden /> Download for vendor support
                  </a>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {masked
                    ? 'Patient names, dates of birth, addresses, phones and emails are masked. Passwords, keys and tokens are always removed.'
                    : 'Patient identifiers are shown. Send unmasked files only over a channel covered by the vendor BAA.'}{' '}
                  Viewing and downloading are recorded in the HIPAA audit log.
                </p>
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
