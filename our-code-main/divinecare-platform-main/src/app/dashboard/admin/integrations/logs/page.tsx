'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { INTEGRATION_LABELS } from '@/lib/integrations/callLog';

type LogRow = {
  id: string;
  createdAt: string;
  integration: string;
  operation: string;
  status: string;
  httpStatus?: number | null;
  durationMs?: number | null;
  userId?: string | null;
  clientId?: string | null;
  mrnMasked?: string | null;
  error?: string | null;
};

export default function IntegrationLogsPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [health, setHealth] = useState('No calls (1h)');
  const [stats, setStats] = useState<{
    lastSuccess: string | null;
    errors: number;
    errorRate: number;
    lastError: { at: string; error?: string | null; integration: string } | null;
  } | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [filters, setFilters] = useState({
    integration: '',
    operation: '',
    status: '',
    from: '',
    to: '',
    mrn: '',
    userId: '',
  });

  const load = useCallback(async (next = filters) => {
    const qs = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v) qs.set(k === 'userId' ? 'userId' : k === 'mrn' ? 'mrn' : k, v);
    });
    const res = await fetch(`/api/admin/integrations/logs?${qs}`, { cache: 'no-store' });
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Failed to load');
      return;
    }
    setRows(data.rows || []);
    setHealth(data.health || 'No calls (1h)');
    setStats(data.stats24h || null);
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <div className="p-6 text-sm text-slate-600">
        Only Admin / Practice Director can view integration logs
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#141C34]">Integration logs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Org-scoped metadata for DrFirst, Waystar, Availity, AWS, Stripe, Homebase, and scheduled
          jobs. Request/response bodies appear only where needed for vendor support.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Integration health (1h)
        </p>
        <p className="mt-1 text-lg font-semibold text-[#141C34]">{health}</p>
      </div>

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            {
              label: 'Last success',
              value: stats.lastSuccess ? new Date(stats.lastSuccess).toLocaleString() : '—',
            },
            { label: 'Errors', value: String(stats.errors) },
            { label: 'Error rate', value: `${stats.errorRate}%` },
            {
              label: 'Last error',
              value: stats.lastError
                ? `${stats.lastError.integration}: ${stats.lastError.error || 'error'}`
                : '—',
              onClick: stats.lastError
                ? () => {
                    const next = { ...filters, status: 'error' };
                    setFilters(next);
                    void load(next);
                  }
                : undefined,
            },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={t.onClick}
              className="rounded-xl border border-slate-200 bg-white p-3 text-left"
            >
              <p className="text-[11px] font-semibold uppercase text-slate-500">{t.label}</p>
              <p className="mt-1 text-sm font-semibold text-[#141C34]">{t.value}</p>
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <select
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={filters.integration}
          onChange={(e) => setFilters((f) => ({ ...f, integration: e.target.value }))}
        >
          <option value="">Integration</option>
          {Object.entries(INTEGRATION_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Operation"
          value={filters.operation}
          onChange={(e) => setFilters((f) => ({ ...f, operation: e.target.value }))}
        />
        <select
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Status</option>
          {['success', 'error', 'throttled', 'skipped'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          aria-label="From"
        />
        <input
          type="datetime-local"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          aria-label="To"
        />
        <input
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Patient MRN"
          value={filters.mrn}
          onChange={(e) => setFilters((f) => ({ ...f, mrn: e.target.value }))}
        />
        <input
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="User"
          value={filters.userId}
          onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
        />
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-sm font-semibold text-white">
            Apply
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold"
            onClick={() => {
              const cleared = {
                integration: '',
                operation: '',
                status: '',
                from: '',
                to: '',
                mrn: '',
                userId: '',
              };
              setFilters(cleared);
              void load(cleared);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-slate-100 bg-slate-50 text-slate-500">
            <tr>
              {['Time', 'Integration', 'Operation', 'Status', 'HTTP/vendor', 'Duration', 'User/patient', 'Error'].map(
                (h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  No calls match these filters
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-slate-50 hover:bg-slate-50"
                  onClick={async () => {
                    const res = await fetch(`/api/admin/integrations/logs/${r.id}?masked=true`);
                    const data = await res.json();
                    if (data.success) setSelected(data.row);
                  }}
                >
                  <td className="px-3 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {INTEGRATION_LABELS[r.integration as keyof typeof INTEGRATION_LABELS] ||
                      r.integration}
                  </td>
                  <td className="px-3 py-2">{r.operation}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">{r.httpStatus ?? '—'}</td>
                  <td className="px-3 py-2">{r.durationMs != null ? `${r.durationMs}ms` : '—'}</td>
                  <td className="px-3 py-2">
                    {[r.userId, r.mrnMasked].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{r.error || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#141C34]">Call detail</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg border px-2 py-1 text-xs font-semibold"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(selected, null, 2))}
              >
                Copy
              </button>
              <a
                className="rounded-lg border px-2 py-1 text-xs font-semibold"
                href={`/api/admin/integrations/logs/${String(selected.id)}?masked=true&download=1`}
              >
                Download
              </a>
              <button
                type="button"
                className="rounded-lg border px-2 py-1 text-xs font-semibold"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Mask patient identifiers (default on)</p>
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px]">
            {JSON.stringify(selected, null, 2)}
          </pre>
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        <Link href="/dashboard/admin" className="font-semibold text-[#5C2D91] hover:underline">
          ← Admin hub
        </Link>
      </p>
    </div>
  );
}
