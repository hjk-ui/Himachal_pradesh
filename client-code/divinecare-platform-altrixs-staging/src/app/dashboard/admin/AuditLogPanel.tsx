'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Lock, Search, X } from 'lucide-react';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardHeader,
  cx,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  LoadingState,
  StatusBadge,
  type Tone,
} from '@/components/ui';
import { actionLabel, describeResource, outcomeLabel } from '@/lib/audit/auditLabels';

export type AuditLogRow = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  patientId: string | null;
  patientLabel?: string | null;
  patientMrn?: string | null;
  patientProtected?: boolean;
  outcome: string;
  ipAddress: string | null;
};

export type AuditFacet = { value: string; count: number };

type Filters = {
  patientId: string;
  actorUserId: string;
  action: string;
  outcome: string;
  resourceType: string;
  from: string;
  to: string;
};

type PatientOption = { id: string; label: string; mrn: string | null; protected: boolean };

const EMPTY_FILTERS: Filters = { patientId: '', actorUserId: '', action: '', outcome: '', resourceType: '', from: '', to: '' };
const PAGE_SIZE = 50;
const EXPORT_MAX = 50_000;

const COMMON_ACTIONS = ['READ', 'LIST', 'WRITE', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'AI_ACCESS', 'BREAK_GLASS', 'LOGIN', 'LOGIN_FAILED'];

const OUTCOME_OPTIONS = [
  { value: '', label: 'Any outcome' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILURE', label: 'Failed' },
  { value: 'DENIED', label: 'Denied' },
  { value: 'FAILURE,DENIED', label: 'Failed or denied' },
];

const OUTCOME_TONE: Record<string, Tone> = {
  SUCCESS: 'success',
  FAILURE: 'warning',
  DENIED: 'danger',
};

function queryString(filters: Filters, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams(extra);
  (Object.keys(filters) as (keyof Filters)[]).forEach((k) => {
    if (filters[k].trim()) qs.set(k, filters[k].trim());
  });
  return qs.toString();
}

/** Patient filter: type a name or MRN, pick a match (sets patientId). */
function PatientPicker({
  value,
  label,
  onChange,
  inputCls,
}: {
  value: string;
  label: string | null;
  onChange: (p: PatientOption | null) => void;
  inputCls: string;
}) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<PatientOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/audit-log/patients?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as { success?: boolean; patients?: PatientOption[] } | null;
      if (!cancelled) setOptions(data?.success ? data.patients ?? [] : []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  if (value) {
    return (
      <span className={`${inputCls} inline-flex items-center gap-2`}>
        <span className="max-w-[200px] truncate font-medium">{label || value}</span>
        <button
          type="button"
          aria-label="Clear patient filter"
          onClick={() => onChange(null)}
          className={cx('rounded text-slate-500 hover:text-slate-700', FOCUS_RING)}
        >
          <X size={14} aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
        <Search size={14} aria-hidden />
      </span>
      <input
        className={`${inputCls} pl-8`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (e.target.value.trim().length < 2) setOptions([]);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Name or MRN"
      />
      {open && options.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-60 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p);
                  setQ('');
                  setOptions([]);
                  setOpen(false);
                }}
              >
                <span className="flex items-center gap-1 font-medium text-slate-800">
                  {p.protected ? <Lock size={12} className="text-rose-600" aria-label="Protected record" /> : null}
                  {p.label}
                </span>
                <span className="font-mono text-xs text-slate-500">{p.mrn || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AuditLogPanel({
  staff,
  facets,
  initialPatientId = '',
  initialActorUserId = '',
  onTotal,
}: {
  staff: { id: string; name: string | null; email?: string | null }[];
  facets?: { actions: AuditFacet[]; resourceTypes: AuditFacet[] };
  initialPatientId?: string;
  initialActorUserId?: string;
  onTotal?: (total: number) => void;
}) {
  const initial = useMemo(
    () => ({ ...EMPTY_FILTERS, patientId: initialPatientId, actorUserId: initialActorUserId }),
    [initialPatientId, initialActorUserId]
  );
  const [draft, setDraft] = useState<Filters>(initial);
  const [filters, setFilters] = useState<Filters>(initial);
  const [patientLabel, setPatientLabel] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Label a patient filter that arrived by id (link from a client chart)
  useEffect(() => {
    if (!initialPatientId) return;
    let cancelled = false;
    fetch(`/api/admin/audit-log/patients?id=${encodeURIComponent(initialPatientId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { success?: boolean; patients?: PatientOption[] }) => {
        const p = d?.success ? d.patients?.[0] : undefined;
        if (!cancelled && p) setPatientLabel(p.mrn ? `${p.label} (${p.mrn})` : p.label);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialPatientId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit-log?${queryString(filters, { page: String(page), pageSize: String(PAGE_SIZE) })}`, {
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => null)) as
        | { success: boolean; error?: string; total?: number; entries?: AuditLogRow[] }
        | null;
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load audit log');
      }
      setRows(data.entries ?? []);
      setTotal(data.total ?? 0);
      onTotal?.(data.total ?? 0);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Could not load audit log');
    } finally {
      setLoading(false);
    }
  }, [filters, page, onTotal]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportHref = `/api/admin/audit-log/export?${queryString(filters)}`;

  const actionOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...(facets?.actions.map((a) => a.value) ?? []), ...COMMON_ACTIONS].filter((a) => (seen.has(a) ? false : (seen.add(a), true)));
  }, [facets]);

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilters(draft);
  };

  const filterByPatient = (r: AuditLogRow) => {
    if (!r.patientId) return;
    const next = { ...EMPTY_FILTERS, patientId: r.patientId };
    setPatientLabel(r.patientLabel ? (r.patientMrn ? `${r.patientLabel} (${r.patientMrn})` : r.patientLabel) : null);
    setDraft(next);
    setFilters(next);
    setPage(1);
  };

  const inputCls =
    'h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 shadow-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 sm:w-auto';
  const labelCls = 'flex w-full flex-col gap-1 text-xs font-medium text-slate-600 sm:w-auto';

  return (
    <Card>
      <CardHeader
        title="Access & activity log"
        description="PHI access, exports, note signing, break-glass and sign-ins. Retained for 6 years; append-only."
        actions={
          <a
            href={total > 0 ? exportHref : undefined}
            aria-disabled={total === 0}
            className={buttonClasses({ variant: 'secondary', size: 'sm', className: total === 0 ? 'pointer-events-none opacity-50' : '' })}
            title={`Downloads every matching event (up to ${EXPORT_MAX.toLocaleString()}). The export is recorded in this log.`}
          >
            <Download size={16} aria-hidden />
            Export all matching (CSV)
          </a>
        }
      />

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
        <label className={labelCls}>
          From
          <input type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className={labelCls}>
          To
          <input type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <label className={labelCls}>
          User
          <select className={inputCls} value={draft.actorUserId} onChange={(e) => setDraft({ ...draft, actorUserId: e.target.value })}>
            <option value="">All users</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.email || s.id}
              </option>
            ))}
          </select>
        </label>
        <div className={labelCls}>
          Patient
          <PatientPicker
            value={draft.patientId}
            label={patientLabel}
            inputCls={inputCls}
            onChange={(p) => {
              setDraft({ ...draft, patientId: p?.id ?? '' });
              setPatientLabel(p ? (p.mrn ? `${p.label} (${p.mrn})` : p.label) : null);
            }}
          />
        </div>
        <label className={labelCls}>
          Action
          <select className={inputCls} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            <option value="">Any action</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)} ({a})
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Outcome
          <select className={inputCls} value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}>
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Record type
          <select className={inputCls} value={draft.resourceType} onChange={(e) => setDraft({ ...draft, resourceType: e.target.value })}>
            <option value="">Any record type</option>
            {(facets?.resourceTypes ?? []).map((r) => (
              <option key={r.value} value={r.value}>
                {describeResource(r.value)}
              </option>
            ))}
            {draft.resourceType && !facets?.resourceTypes.some((r) => r.value === draft.resourceType) ? (
              <option value={draft.resourceType}>{describeResource(draft.resourceType)}</option>
            ) : null}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft(EMPTY_FILTERS);
            setFilters(EMPTY_FILTERS);
            setPatientLabel(null);
            setPage(1);
          }}
        >
          Clear
        </Button>
      </form>

      <div className="clinic-scroll-x overflow-x-auto">
        {error ? (
          <ErrorState title="Could not load audit log" description={error} onRetry={() => void load()} />
        ) : loading && rows.length === 0 ? (
          <LoadingState label="Loading audit log…" rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No audit log entries match"
            description="Access, export and sign-in events that match your filters appear here. Widen the date range or clear the filters."
          />
        ) : (
          <table className="w-full min-w-[960px] text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Time', 'User', 'Action', 'Record', 'Patient', 'Outcome', 'IP address'].map((h, i) => (
                  <th key={h} scope="col" className={cx('whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-600', i === 0 && 'sticky left-0 z-10 bg-slate-50')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`group hover:bg-slate-50 ${r.outcome === 'DENIED' ? 'bg-rose-50/40' : ''}`}
                >
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-3 font-mono text-xs text-slate-500 group-hover:bg-slate-50">
                    {new Date(r.createdAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {r.actorName || (r.actorUserId ? <span className="font-mono text-xs">{r.actorUserId}</span> : 'System')}
                    {r.actorRole ? <span className="block text-xs font-normal text-slate-500">{r.actorRole}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-700">
                    {actionLabel(r.action)}
                    <span className="block font-mono text-[11px] font-normal text-slate-500">{r.action}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {describeResource(r.resourceType)}
                    {r.resourceId ? <span className="block max-w-[14rem] break-all font-mono text-[11px] text-slate-500">{r.resourceId}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {r.patientId ? (
                      <button
                        type="button"
                        className={cx('rounded text-left hover:text-blue-700 hover:underline', FOCUS_RING)}
                        title="Show only this patient's events"
                        onClick={() => filterByPatient(r)}
                      >
                        <span className="flex items-center gap-1 font-medium">
                          {r.patientProtected ? <Lock size={12} className="text-rose-600" aria-label="Protected record" /> : null}
                          {r.patientLabel || 'Unknown / other org'}
                        </span>
                        <span className="block font-mono text-[11px] text-slate-500">{r.patientMrn || r.patientId}</span>
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={OUTCOME_TONE[r.outcome] || 'neutral'}>{outcomeLabel(r.outcome)}</StatusBadge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.ipAddress || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {total.toLocaleString()} event{total === 1 ? '' : 's'} · page {page} of {pageCount}
          {total > EXPORT_MAX ? ` · CSV export is limited to the newest ${EXPORT_MAX.toLocaleString()}` : ''}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Newer
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      </div>

      <div className="border-t border-slate-200 p-4">
        <Alert tone="brand" title="HIPAA compliance note">
          Audit controls per 45 CFR §164.312(b). Entries are written to an append-only table (updates and deletes are
          blocked in the database), retained for 6 years, and carry record ids only, never clinical content. Viewing or
          exporting this log is itself logged.
        </Alert>
      </div>
    </Card>
  );
}
