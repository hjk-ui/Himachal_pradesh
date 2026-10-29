'use client';
import { useState } from 'react';
import { Banknote, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ClinicalModal } from '@/components/clinic/ClinicalModal';
type EraStatus = 'Processed' | 'Auto-Posted' | 'Discrepancy';
type Era = {
  id: string;
  payer: string;
  eft: string;
  date: string;
  amountCents: number;
  claims: number;
  status: EraStatus;
  adjustments: { code: string; label: string; amountCents: number }[];
  resolution?: string;
};
export const ERA_DEMO: Era[] = [];
const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export function EraPayments() {
  const [rows, setRows] = useState<Era[]>(ERA_DEMO);
  const [status, setStatus] = useState<EraStatus | 'All'>('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Era | null>(null);
  const [resolution, setResolution] = useState('');
  const filtered = rows.filter(
    (row) =>
      (status === 'All' || row.status === status) &&
      `${row.payer} ${row.eft}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  function update(status: EraStatus) {
    if (!selected) return;
    const updated = { ...selected, status, resolution: resolution.trim() || selected.resolution };
    setRows((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setSelected(updated);
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>835 ERA · Demo preview</strong>
        <p className="mt-1">
          Sample remittances for payment review. Posting and reconciliation are simulated for this
          session.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: 'Sample remittance total',
            value: money(rows.reduce((sum, row) => sum + row.amountCents, 0)),
            Icon: Banknote,
          },
          {
            label: 'Auto-posted',
            value: rows.filter((row) => row.status === 'Auto-Posted').length,
            Icon: CheckCircle2,
          },
          {
            label: 'Needs review',
            value: rows.filter((row) => row.status === 'Discrepancy').length,
            Icon: AlertTriangle,
          },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-xl border border-slate-200 p-4">
            <Icon size={20} className="text-[#5C2D91]" />
            <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          aria-label="Search remittances"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search payer or Check / EFT…"
          className="w-full min-w-0 rounded-xl border border-slate-200 p-2.5 text-sm sm:min-w-[16rem] sm:flex-[1_1_20rem]"
        />
        <select
          aria-label="ERA status"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          className="w-full rounded-xl border border-slate-200 p-2.5 text-sm sm:w-auto"
        >
          {['All', 'Processed', 'Auto-Posted', 'Discrepancy'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              {['Payer', 'Check / EFT #', 'Date', 'Amount', 'Claims Count', 'Status', 'Review'].map(
                (label) => (
                  <th className="px-3 py-3" key={label}>
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-4 font-medium text-slate-900">{row.payer}</td>
                <td className="px-3 py-4 text-slate-600">{row.eft}</td>
                <td className="px-3 py-4 text-slate-600">{row.date}</td>
                <td className="px-3 py-4 font-semibold">{money(row.amountCents)}</td>
                <td className="px-3 py-4">{row.claims}</td>
                <td className="px-3 py-4">
                  <span
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${row.status === 'Discrepancy' ? 'bg-amber-50 text-amber-800' : row.status === 'Auto-Posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-[#5C2D91]'}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-4">
                  <button
                    onClick={() => {
                      setSelected(row);
                      setResolution(row.resolution || '');
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#5C2D91]"
                  >
                    View ERA
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-8 text-center text-sm text-slate-500">No matching remittances.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          ['PR-1', 'Deductible'],
          ['CO-45', 'Exceeds fee schedule'],
          ['PR-2', 'Co-insurance'],
          ['CO-97', 'Bundled'],
        ].map(([code, label]) => (
          <span
            key={code}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
          >
            {code} · {label}
          </span>
        ))}
      </div>
      {selected && (
        <ClinicalModal title={`ERA ${selected.eft}`} onClose={() => setSelected(null)}>
          <p className="text-sm text-slate-600">
            {selected.payer} · {selected.date} · {selected.claims} claims
          </p>
          <p className="text-2xl font-semibold text-[#5C2D91]">{money(selected.amountCents)}</p>
          <p className="text-sm">Status: {selected.status}</p>
          <h3 className="text-sm font-semibold">Claim adjustment reason codes (CARC)</h3>
          <ul className="space-y-2">
            {selected.adjustments.map((item) => (
              <li
                key={item.code}
                className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"
              >
                <span>
                  {item.code} · {item.label}
                </span>
                <span>{money(item.amountCents)}</span>
              </li>
            ))}
          </ul>
          {selected.status === 'Discrepancy' && (
            <>
              <label className="block text-sm font-medium">
                Reconciliation note
                <textarea
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-slate-200 p-3"
                />
              </label>
              <button
                disabled={!resolution.trim()}
                onClick={() => update('Processed')}
                className="rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Resolve discrepancy in preview
              </button>
            </>
          )}
          {selected.resolution && (
            <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
              Reconciliation: {selected.resolution}
            </p>
          )}
          {selected.status === 'Processed' && (
            <button
              onClick={() => update('Auto-Posted')}
              className="rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white"
            >
              Auto-post in preview
            </button>
          )}
          {selected.status === 'Auto-Posted' && (
            <p role="status" className="text-sm text-emerald-700">
              Posted in demo state. No live ledger entry was created.
            </p>
          )}
        </ClinicalModal>
      )}
    </div>
  );
}
