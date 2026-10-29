'use client';

/**
 * Tabs for the note editor's side panel (Visit guide / Chart history). WAI-ARIA tabs: arrow keys,
 * Home / End move between tabs; only the active tab's content is mounted, so a tab's data (the chart
 * history digest) is fetched only when that tab is opened.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

export type SessionSideTab = { id: string; label: string; icon?: ReactNode; render: () => ReactNode };

export function SessionSideTabs({
  tabs,
  active,
  onChange,
  onClose,
  className = '',
}: {
  tabs: SessionSideTab[];
  active: string;
  onChange: (id: string) => void;
  /** Shown as an "x" when the panel can be closed (chart history without a visit guide) */
  onClose?: () => void;
  className?: string;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!current) return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === current.id);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-2 flex items-center gap-1 border-b border-slate-200">
        <div role="tablist" aria-label="Session side panel" className="flex min-w-0 flex-1 gap-1" onKeyDown={onKey}>
          {tabs.map((t) => {
            const selected = t.id === current.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`${base}-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(t.id)}
                className={`-mb-px inline-flex min-w-0 items-center gap-1 border-b-2 px-2 py-1.5 text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 ${
                  selected ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.icon}
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close side panel" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      <div role="tabpanel" id={`${base}-panel-${current.id}`} aria-labelledby={`${base}-tab-${current.id}`} tabIndex={0} className="min-w-0 focus:outline-none">
        {current.render()}
      </div>
    </div>
  );
}
