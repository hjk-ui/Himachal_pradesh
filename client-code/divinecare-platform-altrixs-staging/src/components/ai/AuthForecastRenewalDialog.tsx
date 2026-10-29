'use client';

import { useState } from 'react';
import { Copy, FileText, Loader2, Printer, X } from 'lucide-react';
import { postRenewal } from './AuthForecastClient';

type Draft = NonNullable<Awaited<ReturnType<typeof postRenewal>>['draft']>;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * "Draft renewal" button + dialog: editable packet text, copy / print, and (write roles) "Record
 * renewal drafted" on the authorization. Nothing is submitted to the payer.
 */
export function AuthForecastRenewalButton({ priorAuthId, onRecorded, compact }: { priorAuthId: string; onRecorded?: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const start = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await postRenewal(priorAuthId, 'draft');
      if (res.draft) {
        setDraft(res.draft);
        setText(res.draft.text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft the renewal request');
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      setStatus('Copy failed; select the text and copy it');
    }
  };

  const print = () => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return setStatus('Allow pop-ups to print');
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Authorization renewal request</title><pre style="font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const record = async () => {
    try {
      const res = await postRenewal(priorAuthId, 'record');
      setStatus(`Recorded: renewal drafted ${res.renewalDraftedAt ?? ''}`);
      onRecorded?.();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not record');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        className={`inline-flex items-center gap-1 font-semibold text-[#5C2D91] hover:underline ${compact ? 'text-[11px]' : 'text-xs'}`}
      >
        <FileText size={compact ? 11 : 12} /> Draft renewal
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Authorization renewal draft">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Renewal request draft</h2>
                <p className="text-xs text-slate-500">For staff review. Edit, then copy or print; nothing is sent to the payer.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {loading ? (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 size={14} className="animate-spin" /> Drafting…
                </p>
              ) : null}
              {error ? <p className="text-sm text-rose-700">{error}</p> : null}
              {draft ? (
                <>
                  <p className="text-xs text-slate-600">
                    Justification: {draft.justificationSource === 'ai' ? 'AI draft (Bedrock), review before use' : 'template'}
                    {draft.warning ? <span className="ml-1 font-semibold text-amber-700">{draft.warning}</span> : null}
                  </p>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    aria-label="Renewal request text"
                    className="h-[55vh] w-full rounded-xl border border-slate-200 p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/30"
                  />
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" disabled={!draft} onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                <Copy size={12} /> Copy
              </button>
              <button type="button" disabled={!draft} onClick={print} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                <Printer size={12} /> Print
              </button>
              {draft?.canRecord ? (
                <button type="button" onClick={() => void record()} className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                  Record renewal drafted
                </button>
              ) : null}
              {status ? <span className="text-xs text-slate-600">{status}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
