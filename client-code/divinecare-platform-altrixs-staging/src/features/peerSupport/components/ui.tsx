'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { peerApi } from '../api';

export function Pill({ tone = 'slate', children }: { tone?: 'slate' | 'rose' | 'amber' | 'emerald' | 'brand' | 'sky'; children: ReactNode }) {
  const cls = {
    slate: 'bg-slate-100 text-slate-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-800',
    emerald: 'bg-emerald-50 text-emerald-700',
    brand: 'bg-[#5C2D91]/10 text-[#5C2D91]',
    sky: 'bg-sky-50 text-sky-700',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function LegacyBadge() {
  return (
    <span title="Filed from the old hand-entered peer list" className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      Legacy
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[90dvh] w-full overflow-y-auto overscroll-contain ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="-mr-2 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#5C2D91] focus:outline-none focus:ring-1 focus:ring-[#5C2D91]';
export const labelCls = 'mb-1 block text-xs font-semibold text-slate-600';
/** Sticky first / last columns for the peer-support tables (client and actions stay visible when the table scrolls sideways). */
export const stickyFirstTh = 'sticky left-0 z-10 bg-slate-50';
export const stickyFirstTd = 'sticky left-0 z-10 bg-white';
export const stickyLastTh = 'sticky right-0 z-10 bg-slate-50';
export const stickyLastTd = 'sticky right-0 z-10 bg-white';
export const primaryBtn = 'inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#4a2475] disabled:opacity-50';
export const secondaryBtn = 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "3 days ago" style, for last contact. */
export function relativeDays(iso: string | null | undefined, now = new Date()) {
  if (!iso) return 'No contact yet';
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** Local datetime-local value for now. */
export function nowLocalInput() {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export type PickedClient = { id: string; name: string };

/**
 * Pick a client from the caseload, or search the actor's scope. The user always chooses:
 * nothing is matched by name automatically.
 */
export function ClientPicker({
  caseload,
  value,
  onChange,
  hint,
}: {
  caseload: PickedClient[];
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  hint?: string;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PickedClient[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      peerApi
        .searchClients(t)
        .then((r) => live && setResults(r.clients))
        .catch(() => live && setResults([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#5C2D91]/30 bg-[#5C2D91]/5 px-3 py-2 text-sm">
        <span className="min-w-0 truncate font-semibold text-slate-900">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="min-h-10 shrink-0 text-xs font-semibold text-[#5C2D91] hover:underline sm:min-h-0">
          Change
        </button>
      </div>
    );
  }

  const list = term.trim().length >= 2 ? results : caseload;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={caseload.length ? 'Search or pick from your caseload' : 'Search clients by name'}
          className={`${inputCls} pl-8`}
        />
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-100">
        {searching && <p className="px-3 py-2 text-xs text-slate-500">Searching…</p>}
        {!searching && list.length === 0 && (
          <p className="px-3 py-2 text-xs text-slate-500">{term.trim().length >= 2 ? 'No clients in your caseload match.' : 'Type at least 2 letters to search.'}</p>
        )}
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onChange({ id: c.id, name: c.name })} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TopicPicker({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: readonly string[] }) {
  const [custom, setCustom] = useState('');
  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase());
  const toggle = (t: string) => onChange(has(t) ? value.filter((v) => v.toLowerCase() !== t.toLowerCase()) : [...value, t]);
  const extra = value.filter((v) => !suggestions.some((s) => s.toLowerCase() === v.toLowerCase()));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {[...suggestions, ...extra].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${has(t) ? 'border-[#5C2D91] bg-[#5C2D91] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              e.preventDefault();
              if (!has(custom.trim())) onChange([...value, custom.trim()]);
              setCustom('');
            }
          }}
          placeholder="Other topic, press Enter"
          className={inputCls}
          maxLength={40}
        />
      </div>
    </div>
  );
}
