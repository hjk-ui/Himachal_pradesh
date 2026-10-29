'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Alert, EmptyState, LoadingState } from '@/components/ui';
import { apiJson } from '@/lib/api-client';

type CodeRow = {
  providerCode: string;
  codeKey: string;
  rows: number;
  primaryCareCharges: number;
  lastServiceDate: string | null;
  mappedUserId: string | null;
  importMatchUserId: string | null;
};
type Staff = { id: string; name: string; role: string; status: string; medicalProvider: boolean };

/**
 * Admin → Data import → Valant provider codes. Each code from the imported Valant transactions is
 * mapped to a staff member by a person. Nothing is matched by name: the import's own match is shown
 * as a suggestion to confirm. Used by the primary care PCP check and Billing › Provider Collections.
 */
export function ValantProviderMap() {
  const [rows, setRows] = useState<CodeRow[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiJson<{ rows: CodeRow[]; staff: Staff[] }>('/api/migration/provider-map', { cache: 'no-store' });
      setRows(data.rows);
      setStaff(data.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load provider codes');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const sortedStaff = useMemo(
    () => [...staff].filter((s) => s.status !== 'DEACTIVATED').sort((a, b) => Number(b.medicalProvider) - Number(a.medicalProvider) || a.name.localeCompare(b.name)),
    [staff]
  );

  const save = async (row: CodeRow, userId: string | null) => {
    setSaving(row.codeKey);
    setError(null);
    try {
      await apiJson('/api/migration/provider-map', { method: 'PUT', body: JSON.stringify({ providerCode: row.providerCode, userId }) });
      setRows((prev) => (prev ?? []).map((r) => (r.codeKey === row.codeKey ? { ...r, mappedUserId: userId } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the mapping');
    } finally {
      setSaving(null);
    }
  };

  const visible = (rows ?? []).filter((r) => !onlyUnmapped || !r.mappedUserId);
  const unmapped = (rows ?? []).filter((r) => !r.mappedUserId);
  const unmappedPc = unmapped.filter((r) => r.primaryCareCharges > 0).length;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Valant provider codes</h2>
        <p className="mt-1 text-xs text-slate-600">
          Valant exports a provider code on each transaction (for example &quot;K.Daniel&quot; or &quot;Daniel K&quot;). Choose the staff
          member for each code. Codes are never matched by name automatically; two codes for the same person are mapped to the
          same staff member. The primary care PCP check uses only mapped codes, and Billing › Provider Collections shows a
          mapped code under its staff member.
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {rows === null ? (
        <LoadingState label="Loading provider codes…" />
      ) : rows.length === 0 ? (
        <EmptyState compact title="No Valant transactions are imported yet (Import Transactions)." description="Provider codes from imported transactions appear here so you can map each one to a staff member." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {unmapped.length ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle size={13} /> {unmapped.length} unmapped ({unmappedPc} with Family Practice charges)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 size={13} /> Every code is mapped
              </span>
            )}
            <label className="inline-flex items-center gap-1.5 text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} /> Show unmapped only
            </label>
          </div>
          <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Valant code</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Rows</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Family Practice charges</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Last service</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Staff member</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r) => {
                  const mapped = r.mappedUserId ? staffById.get(r.mappedUserId) : null;
                  const suggestion = !r.mappedUserId && r.importMatchUserId ? staffById.get(r.importMatchUserId) : null;
                  return (
                    <tr key={r.codeKey} className="align-top hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-slate-900">{r.providerCode}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.rows}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.primaryCareCharges}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">{r.lastServiceDate ?? '—'}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Staff member for ${r.providerCode}`}
                          value={r.mappedUserId ?? ''}
                          disabled={saving === r.codeKey}
                          onChange={(e) => void save(r, e.target.value || null)}
                          className="w-64 max-w-full rounded-lg border border-slate-300 bg-white p-1.5 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        >
                          <option value="">Not mapped</option>
                          {mapped && mapped.status === 'DEACTIVATED' ? <option value={mapped.id}>{mapped.name} (deactivated)</option> : null}
                          {sortedStaff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                              {s.medicalProvider ? ' (medical provider)' : ''}
                            </option>
                          ))}
                        </select>
                        {mapped && r.primaryCareCharges > 0 && !mapped.medicalProvider ? (
                          <p className="mt-1 text-amber-700">Not a physician / medical NP: these charges do not count toward a PCP.</p>
                        ) : null}
                        {suggestion ? (
                          <p className="mt-1 text-slate-500">
                            Import matched: {suggestion.name}.{' '}
                            <button type="button" className="rounded font-semibold text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => void save(r, suggestion.id)}>
                              Confirm
                            </button>
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
