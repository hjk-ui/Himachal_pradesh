'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FlaskConical, Loader2, Paperclip, Printer, Send, ShieldCheck, Truck } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { performingLabLabel, COLLECTION_SITES, BILL_TO_OPTIONS } from '@/lib/labs/facility';
import { FLAG_LABEL, type LabResultFlag } from '@/lib/labs/results';
import { LAB_STAGE_LABEL, labOrderStage, type LabStage } from '@/lib/labs/workflow';
import { FLAG_STYLE, fmtDay, fmtWhen, openRequisition, type LabOrderDto, type LabPermissions, type LabTestDef } from './labClient';
import { LabResultEntry } from './LabResultEntry';
import { Alert } from '@/components/ui';

export const STAGE_TONE: Record<LabStage, string> = {
  ordered: 'bg-blue-50 text-blue-600',
  collected: 'bg-sky-50 text-sky-700',
  sent: 'bg-amber-50 text-amber-800',
  resulted: 'bg-rose-50 text-rose-700',
  reviewed: 'bg-emerald-50 text-emerald-700',
  released: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

/** One lab order: tests, diagnoses, results, and the workflow actions the viewer's role allows */
export function LabOrderCard({
  order,
  permissions,
  tests,
  showClient = true,
  defaultOpen = false,
  onChange,
}: {
  order: LabOrderDto;
  permissions: LabPermissions | null;
  tests: LabTestDef[];
  showClient?: boolean;
  defaultOpen?: boolean;
  onChange: (o: LabOrderDto) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [entering, setEntering] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const stage = labOrderStage(order);
  const testNames = order.testLines.length ? order.testLines.map((l) => l.name) : [...order.panels, ...(order.otherPanel ? [order.otherPanel] : [])];
  const abnormal = order.results.filter((r) => r.flag && r.flag !== 'N').length;
  const critical = order.hasCritical;
  const can = permissions ?? { view: true, order: false, enterResults: false, review: false, release: false };

  const act = async (key: string, fn: () => Promise<LabOrderDto>, ok: string | (() => string)) => {
    setBusy(key);
    setMsg(null);
    try {
      onChange(await fn());
      setMsg({ tone: 'ok', text: typeof ok === 'function' ? ok() : ok });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Action failed' });
    } finally {
      setBusy(null);
    }
  };
  const patchStatus = (status: string, ok: string) =>
    act(status, async () => (await apiJson<{ order: LabOrderDto }>(`/api/labs/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })).order, ok);
  const review = () =>
    act('review', async () => (await apiJson<{ order: LabOrderDto }>(`/api/labs/orders/${order.id}/review`, { method: 'POST', body: JSON.stringify({ note: reviewNote || null }) })).order, 'Results signed off.');
  const release = () => {
    if (!confirm('Release these reviewed results to the patient portal? The patient is notified by email, and by text if they consented to texts, without result values.')) return;
    // The text notice is consent-gated: show its honest outcome ("Not sent: client has not consented ...")
    let smsNote = '';
    void act(
      'release',
      async () => {
        const r = await apiJson<{ order: LabOrderDto; channels?: { sms?: string; smsNote?: string } }>(`/api/labs/orders/${order.id}/send`, { method: 'POST' });
        smsNote = r.channels?.sms === 'sent' ? ' Text notice sent.' : r.channels?.smsNote ? ` Text notice: ${r.channels.smsNote}` : '';
        return r.order;
      },
      () => `Released to the patient portal.${smsNote}`
    );
  };

  const linesByName = new Map(order.testLines.map((l) => [l.name, l]));

  return (
    <div className={`rounded-xl border bg-white ${critical && !order.reviewedAt ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-200'}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-500" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-500" />}
        <FlaskConical size={16} className="mt-0.5 shrink-0 text-blue-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {showClient ? <span className="text-sm font-bold text-slate-900">{order.clientName}</span> : null}
            <span className="text-sm font-semibold text-slate-800">{testNames.slice(0, 4).join(', ') || 'Lab order'}{testNames.length > 4 ? ` +${testNames.length - 4}` : ''}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STAGE_TONE[stage]}`}>{LAB_STAGE_LABEL[stage]}</span>
            {/stat/i.test(order.priority) ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">STAT</span> : null}
            {critical ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                <AlertTriangle size={11} /> Critical
              </span>
            ) : abnormal ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">{abnormal} abnormal</span>
            ) : null}
            {order.fastingRequired ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Fasting</span> : null}
            {order.standingOrderId ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Standing</span> : null}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {performingLabLabel(order.lab, true)} · ordered {fmtDay(order.orderedAt)}
            {order.orderedByName ? ` by ${order.orderedByName}` : ''}
            {order.resultedAt ? ` · resulted ${fmtDay(order.resultedAt)}` : ''}
            {order.reviewedAt ? ` · reviewed by ${order.reviewedByName ?? 'provider'}` : ''}
          </p>
        </div>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-700">
          <div className="grid gap-2 sm:grid-cols-3">
            <p><span className="font-semibold text-slate-900">Collection:</span> {COLLECTION_SITES.find((s) => s.id === order.collectionSite)?.label ?? '—'}{order.collectedAt ? ` · ${fmtWhen(order.collectedAt)}` : ''}</p>
            <p><span className="font-semibold text-slate-900">Bill to:</span> {BILL_TO_OPTIONS.find((b) => b.id === order.billTo)?.label ?? '—'}{order.abnRequired ? ' · ABN flagged' : ''}</p>
            <p><span className="font-semibold text-slate-900">Performing lab:</span> {order.performingLabName || performingLabLabel(order.lab)}</p>
          </div>
          {order.abnRequired && order.abnNote ? <Alert tone="warning">ABN: {order.abnNote}</Alert> : null}
          {order.clinicalNotes ? <p><span className="font-semibold text-slate-900">Notes:</span> {order.clinicalNotes}</p> : null}

          <div>
            <p className="mb-1 font-semibold text-slate-900">Tests and diagnoses</p>
            <ul className="space-y-0.5">
              {testNames.map((n) => {
                const l = linesByName.get(n);
                return (
                  <li key={n}>
                    <span className="font-semibold">{n}</span>
                    {l?.cpt ? <span className="ml-1 font-mono text-slate-500">CPT {l.cpt}</span> : null}
                    <span className="ml-1 font-mono text-slate-500">
                      — {(l?.diagnoses.map((d) => d.code) ?? order.icd10Codes).join(', ') || 'no diagnosis recorded'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {order.results.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left">
                <thead className="text-[11px] uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="py-1 pr-3">Result</th>
                    <th scope="col" className="py-1 pr-3">Value</th>
                    <th scope="col" className="py-1 pr-3">Reference</th>
                    <th scope="col" className="py-1 pr-3">Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.results.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1 pr-3">
                        {r.testName}
                        {r.panelName ? <span className="ml-1 text-[11px] text-slate-500">{r.panelName}</span> : null}
                      </td>
                      <td className={`py-1 pr-3 font-mono ${FLAG_STYLE[r.flag] ?? ''}`}>
                        {r.value} {r.unit || ''}
                      </td>
                      <td className="py-1 pr-3 text-slate-500">{r.refRange || '—'}</td>
                      <td className={`py-1 pr-3 ${FLAG_STYLE[r.flag] ?? ''}`}>
                        {r.flag !== 'N' ? FLAG_LABEL[r.flag as LabResultFlag] ?? r.flag : 'Normal'}
                        {r.flagSource === 'lab' ? <span className="ml-1 text-[11px] font-normal text-slate-500">(lab)</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-500">No results entered yet.</p>
          )}
          {order.resultDocumentId ? (
            <p className="inline-flex items-center gap-1 text-slate-600">
              <Paperclip size={12} /> Scanned report attached —{' '}
              <Link href={`/dashboard/clients/${encodeURIComponent(order.clientId)}?tab=documents`} className="font-semibold text-blue-600 hover:underline">
                open chart documents
              </Link>
            </p>
          ) : null}
          {order.reviewedAt ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
              <ShieldCheck size={12} className="mr-1 inline" />
              Reviewed {fmtWhen(order.reviewedAt)} by {order.reviewedByName ?? 'provider'}
              {order.reviewNote ? ` — ${order.reviewNote}` : ''}
              {order.releasedAt ? ` · released to portal ${fmtWhen(order.releasedAt)}` : ''}
            </p>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => openRequisition(order.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50">
              <Printer size={13} /> Requisition
            </button>
            {can.enterResults && stage === 'ordered' ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void patchStatus('collected', 'Marked collected.')} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50">
                Mark collected
              </button>
            ) : null}
            {can.enterResults && (stage === 'ordered' || stage === 'collected') && order.lab !== 'IN_HOUSE' ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void patchStatus('pending', 'Marked sent to the lab.')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50">
                <Truck size={13} /> Sent to lab
              </button>
            ) : null}
            {can.enterResults && stage !== 'released' && stage !== 'cancelled' ? (
              <button type="button" onClick={() => setEntering(true)} className="rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white">
                {order.results.length ? 'Edit results' : 'Enter results'}
              </button>
            ) : null}
            {can.enterResults && (stage === 'ordered' || stage === 'collected' || stage === 'sent') ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => confirm('Cancel this lab order?') && void patchStatus('cancelled', 'Order cancelled.')}
                className="rounded-lg px-2.5 py-1.5 font-semibold text-slate-500 hover:text-rose-700"
              >
                Cancel order
              </button>
            ) : null}
            {can.release && stage === 'reviewed' ? (
              <button type="button" disabled={Boolean(busy)} onClick={release} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-800">
                <Send size={13} /> Release to portal
              </button>
            ) : null}
            {busy ? <Loader2 size={14} className="animate-spin text-slate-500" /> : null}
          </div>

          {can.review && stage === 'resulted' ? (
            <div className="rounded-lg border border-slate-200 p-2">
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={2}
                className="w-full rounded border border-slate-200 px-2 py-1"
                placeholder={critical ? 'Required for critical results: who was contacted, when, and the plan' : 'Review note (optional): interpretation / plan'}
              />
              <button
                type="button"
                disabled={Boolean(busy) || (critical && !reviewNote.trim())}
                onClick={() => void review()}
                className="mt-1 inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle2 size={13} /> Review &amp; sign off
              </button>
            </div>
          ) : null}
          {stage === 'resulted' && !can.review ? <p className="text-slate-500">Waiting for the ordering provider’s review and sign-off.</p> : null}
          {msg ? <p className={msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}>{msg.text}</p> : null}
        </div>
      ) : null}

      {entering ? (
        <LabResultEntry
          order={order}
          tests={tests}
          onClose={() => setEntering(false)}
          onSaved={(o, cleared) => {
            setEntering(false);
            onChange(o);
            setMsg({ tone: 'ok', text: cleared ? 'Results amended — sent back for provider review.' : 'Results saved — waiting for provider review.' });
          }}
        />
      ) : null}
    </div>
  );
}
