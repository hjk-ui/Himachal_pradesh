'use client';

import { useEffect, useState } from 'react';

type Row = {
  id: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  outcome: string;
  createdAt: string;
};

export default function AuditLogPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/audit')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load the audit log');
        return Array.isArray(data.rows) ? data.rows : [];
      })
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the audit log');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Refused chart access and PHI writes. Admin and practice director only.
        </p>
      </div>
      {loading ? <p className="text-sm text-slate-500">Loading audit log…</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500">
          No audit rows yet.
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-slate-500">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.actorUserId}</td>
                  <td className="px-4 py-3">{row.actorRole}</td>
                  <td className="px-4 py-3">{row.action}</td>
                  <td className="px-4 py-3">{row.resourceType}{row.resourceId ? ` · ${row.resourceId}` : ''}</td>
                  <td className="px-4 py-3">{row.patientId || '—'}</td>
                  <td className="px-4 py-3">{row.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
