'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { AutopayRow } from './autopayLogic';

/** Pick an active client who is not enrolled yet. Enrolling turns AutoPay on; the client shows "Needs card" until a card is saved. */
export function EnrollClientDialog({
  candidates,
  busy,
  onEnroll,
  onClose,
}: {
  candidates: AutopayRow[];
  busy: boolean;
  onEnroll: (row: AutopayRow) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? candidates.filter((c) => c.clientName.toLowerCase().includes(q) || (c.mrn ?? '').toLowerCase().includes(q))
      : candidates;
    return list.slice(0, 50);
  }, [candidates, query]);

  const chosen = candidates.find((c) => c.clientId === selected) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div role="dialog" aria-modal="true" aria-labelledby="enroll-title" className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id="enroll-title" className="text-base font-semibold text-slate-900">Enroll client in AutoPay</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block text-xs font-semibold text-slate-600" htmlFor="enroll-search">
            Client
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id="enroll-search"
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or MRN"
              className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
          </div>
          <ul role="listbox" aria-label="Clients not enrolled" className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            {matches.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">
                {candidates.length === 0 ? 'Every active client is already enrolled.' : 'No clients match.'}
              </li>
            ) : (
              matches.map((c) => (
                <li key={c.clientId} role="option" aria-selected={selected === c.clientId}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.clientId)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                      selected === c.clientId ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-medium">{c.clientName}</span>
                    {c.mrn ? <span className="text-xs tabular-nums text-slate-500">{c.mrn}</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          <p className="text-xs text-slate-500">
            The client is enrolled with AutoPay on and shows as Needs card until a card is saved. Altrixs does not charge cards
            automatically yet.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={!chosen || busy}
            onClick={() => chosen && onEnroll(chosen)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
            Enroll
          </button>
        </div>
      </div>
    </div>
  );
}
