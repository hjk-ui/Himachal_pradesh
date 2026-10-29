'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, LifeBuoy, MessageSquare, Phone, X } from 'lucide-react';
import { CRISIS_LINES } from '@/lib/resources/seedCatalog';

/**
 * Crisis resources, one tap away (library header and patient portal). Verified numbers only
 * (src/lib/resources/verifiedSources.ts); 911 is the universal emergency number.
 */
export function CrisisLinesButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800 hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
      >
        <LifeBuoy size={16} aria-hidden /> Crisis resources
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Crisis resources"
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-rose-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-semibold text-slate-900">Crisis and help lines</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close crisis resources" className="inline-flex h-10 w-10 shrink-0 md:h-8 md:w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              <X size={16} aria-hidden />
            </button>
          </div>
          <CrisisLinesList />
        </div>
      )}
    </div>
  );
}

/** The list itself (also shown inline in the portal). */
export function CrisisLinesList() {
  return (
    <ul className="space-y-2">
      {CRISIS_LINES.map((l) => (
        <li key={l.key} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{l.name}</p>
              <p className="text-xs text-slate-600">{l.detail}</p>
            </div>
            {l.url && (
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 w-10 shrink-0 md:h-8 md:w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label={`${l.name} website (opens in a new tab)`}>
                <ExternalLink size={14} aria-hidden />
              </a>
            )}
          </div>
          <a
            href={l.href}
            className={`mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${l.key === '911' ? 'bg-rose-700 hover:bg-rose-800' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {l.href.startsWith('sms:') ? <MessageSquare size={14} aria-hidden /> : <Phone size={14} aria-hidden />}
            {l.action}
          </a>
        </li>
      ))}
    </ul>
  );
}
