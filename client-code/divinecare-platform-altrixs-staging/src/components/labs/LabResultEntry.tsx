'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Paperclip, Plus, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { findTestByKey, findTestByName } from '@/lib/labs/catalog';
import { performingLabLabel } from '@/lib/labs/facility';
import { FLAG_LABEL, LAB_RESULT_FLAGS, computeAbnormalFlag, type LabResultFlag } from '@/lib/labs/results';
import { FLAG_STYLE, fetchOrderContext, type LabOrderDto, type LabTestDef, type OrderContext } from './labClient';

type Row = {
  testName: string;
  panelName: string;
  testKey: string;
  loinc: string;
  value: string;
  unit: string;
  refRange: string;
  criticalRange: string;
  /** '' = compute from the range */
  labFlag: '' | LabResultFlag;
};

/** ISO → value for <input type="datetime-local"> in the viewer's time zone */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const blank = (over: Partial<Row>): Row => ({ testName: '', panelName: '', testKey: '', loinc: '', value: '', unit: '', refRange: '', criticalRange: '', labFlag: '', ...over });

/** Rows for an order: existing results, else one row per test (panel → one per component) */
function initialRows(order: LabOrderDto, tests: LabTestDef[]): Row[] {
  if (order.results.length) {
    return order.results.map((r) =>
      blank({
        testName: r.testName,
        panelName: r.panelName ?? '',
        testKey: r.testKey ?? '',
        loinc: r.loinc ?? '',
        value: r.value,
        unit: r.unit ?? '',
        refRange: r.refRange ?? '',
        criticalRange: r.criticalRange ?? '',
        labFlag: r.flagSource === 'lab' ? (r.flag as LabResultFlag) : '',
      })
    );
  }
  const names = order.testLines.length ? order.testLines.map((l) => ({ key: l.key, name: l.name, loinc: l.loinc })) : order.panels.map((p) => ({ key: null, name: p, loinc: null }));
  return names.flatMap((t) => {
    const def = (t.key ? findTestByKey(t.key, tests) : null) || findTestByName(t.name, tests);
    if (def?.isPanel && def.components.length) {
      return def.components.map((c) => blank({ testName: c, panelName: def.name, testKey: def.key }));
    }
    return [blank({ testName: def?.name ?? t.name, testKey: def?.key ?? '', loinc: t.loinc ?? def?.loinc ?? '' })];
  });
}

/**
 * Manual result entry (prescribers, medical assistants, leadership). Values, units, reference range
 * and the lab's critical limits as printed; H / L / critical flags are computed from the entered
 * ranges (or the lab's printed flag is chosen). Attach the scanned report filed via Smart Document
 * Intake. Saving puts the order in "Resulted — needs review" for the ordering provider.
 */
export function LabResultEntry({
  order,
  tests,
  onClose,
  onSaved,
}: {
  order: LabOrderDto;
  tests: LabTestDef[];
  onClose: () => void;
  onSaved: (o: LabOrderDto, reviewCleared: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(order, tests));
  const [collectedAt, setCollectedAt] = useState(() => toLocalInput(order.collectedAt));
  const [performingLab, setPerformingLab] = useState(order.performingLabName ?? performingLabLabel(order.lab));
  const [docId, setDocId] = useState(order.resultDocumentId ?? '');
  const [ctx, setCtx] = useState<OrderContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchOrderContext(order.clientId).then(setCtx).catch(() => setCtx(null));
  }, [order.clientId]);

  const flags = useMemo(() => rows.map((r) => (r.labFlag ? r.labFlag : computeAbnormalFlag(r.value, r.refRange, r.criticalRange))), [rows]);
  const set = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.testName.trim() && r.value.trim());

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const collected = collectedAt ? new Date(collectedAt).toISOString() : null;
      const d = await apiJson<{ order: LabOrderDto; reviewCleared: boolean }>(`/api/labs/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          results: filled.map((r) => ({
            testName: r.testName,
            value: r.value,
            unit: r.unit || null,
            refRange: r.refRange || null,
            criticalRange: r.criticalRange || null,
            flag: r.labFlag || null,
            testKey: r.testKey || null,
            panelName: r.panelName || null,
            loinc: r.loinc || null,
            collectedAt: collected,
          })),
          collectedAt: collected,
          performingLabName: performingLab || null,
          resultDocumentId: docId || null,
        }),
      });
      onSaved(d.order, d.reviewCleared);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save results');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Enter lab results">
      <div className="my-6 w-full min-w-0 max-w-5xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Enter results — {order.clientName}</h2>
            <p className="text-xs text-slate-500">Flags compute from the reference range you enter. Critical limits only as printed by the lab.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          {order.reviewedAt ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">These results were already signed off. Saving changes marks them as amended and sends them back for provider review.</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-slate-700">
              Collection date / time
              <input type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="text-xs font-bold text-slate-700">
              Performing lab
              <input value={performingLab} onChange={(e) => setPerformingLab(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="text-xs font-bold text-slate-700">
              <Paperclip size={12} className="mr-1 inline" />
              Scanned result report
              <select value={docId} onChange={(e) => setDocId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
                <option value="">None attached</option>
                {(ctx?.documents ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.type}
                    {d.filedAt ? `, filed ${new Date(d.filedAt).toLocaleDateString()}` : ''})
                  </option>
                ))}
              </select>
              <span className="mt-1 block font-normal text-slate-500">
                Not listed? File the PDF to this chart in{' '}
                <Link href="/dashboard/ehr/doc-intake" className="font-semibold text-[#5C2D91] hover:underline">
                  Smart Document Intake
                </Link>
                .
              </span>
            </label>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Test / component</th>
                  <th className="px-2 py-2">Value</th>
                  <th className="px-2 py-2">Units</th>
                  <th className="px-2 py-2">Reference range</th>
                  <th className="px-2 py-2">Critical limits</th>
                  <th className="px-2 py-2">Flag</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => {
                  const f = flags[i];
                  return (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <input value={r.testName} onChange={(e) => set(i, { testName: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1" aria-label="Test name" />
                        {r.panelName ? <span className="text-[10px] text-slate-500">{r.panelName}</span> : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.value} onChange={(e) => set(i, { value: e.target.value })} className="w-24 rounded border border-slate-200 px-2 py-1 font-mono" aria-label={`${r.testName} value`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className="w-20 rounded border border-slate-200 px-2 py-1" aria-label="Units" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.refRange} onChange={(e) => set(i, { refRange: e.target.value })} placeholder="e.g. 0.6-1.2, <200, Negative" className="w-36 rounded border border-slate-200 px-2 py-1" aria-label="Reference range" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.criticalRange} onChange={(e) => set(i, { criticalRange: e.target.value })} placeholder="as printed, e.g. 2.5-6.5" className="w-32 rounded border border-slate-200 px-2 py-1" aria-label="Critical limits" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <select value={r.labFlag} onChange={(e) => set(i, { labFlag: e.target.value as Row['labFlag'] })} className="rounded border border-slate-200 px-1 py-1" aria-label="Flag source">
                            <option value="">Auto</option>
                            {LAB_RESULT_FLAGS.map((fl) => (
                              <option key={fl} value={fl}>
                                Lab: {fl}
                              </option>
                            ))}
                          </select>
                          <span className={FLAG_STYLE[f ?? 'N']}>{r.value ? (f ? FLAG_LABEL[f] : 'Not computed') : ''}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button type="button" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:text-rose-600" aria-label="Remove row">
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => setRows((prev) => [...prev, blank({})])} className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91]">
            <Plus size={13} /> Add a row
          </button>
          {flags.some((f) => f === 'HH' || f === 'LL') ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
              Critical value entered. Notify the ordering provider now per the critical-results policy; the result is flagged urgent in their Inbox.
            </p>
          ) : null}
          {err ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p> : null}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" disabled={busy || filled.length === 0} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              Save results ({filled.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
