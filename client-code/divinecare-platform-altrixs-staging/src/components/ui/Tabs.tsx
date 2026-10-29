'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './tokens';

export type TabItem<K extends string = string> = {
  key: K;
  label: ReactNode;
  /** Optional count shown as a small pill after the label. */
  count?: number;
  /** 'attention' highlights the count (e.g. items returned to you) when the tab is not selected. */
  countTone?: 'neutral' | 'attention';
  /** Native tooltip explaining the tab. */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

/**
 * Controlled tab list (WAI-ARIA tabs pattern: arrow keys move focus + selection, Home/End jump).
 * Underline style for page-level tabs; `variant="pill"` for compact view switchers
 * (e.g. Calendar / Board / List). Render the active panel yourself with <TabPanel>.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  variant = 'underline',
  label,
  idBase,
  controlsPanels = true,
  className,
}: {
  items: TabItem<NoInfer<K>>[];
  value: K;
  onChange: (key: NoInfer<K>) => void;
  variant?: 'underline' | 'pill';
  /** Accessible name for the tab list. */
  label: string;
  /** Pass the same id to TabPanel so tabs and panels are linked. */
  idBase?: string;
  /** false for view switchers that re-render the page instead of showing a TabPanel. */
  controlsPanels?: boolean;
  className?: string;
}) {
  const autoId = useId();
  const base = idBase ?? autoId;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.filter((t) => !t.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const idx = enabled.findIndex((t) => t.key === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const key = enabled[next].key;
    onChange(key);
    refs.current[items.findIndex((t) => t.key === key)]?.focus();
  };

  const underline = variant === 'underline';
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(
        underline
          ? 'flex min-w-0 gap-1 overflow-x-auto border-b border-slate-200'
          : 'inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1',
        className,
      )}
    >
      {items.map((tab, i) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={controlsPanels ? `${base}-panel-${tab.key}` : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            title={tab.hint}
            onClick={() => onChange(tab.key)}
            onKeyDown={onKeyDown}
            className={cx(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50',
              underline
                ? cx(
                    '-mb-px border-b-2 px-3 py-2.5',
                    selected
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )
                : cx(
                    'min-h-9 rounded-md px-3 py-1.5 text-[13px]',
                    selected ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900',
                  ),
            )}
          >
            {tab.icon ? (
              <span aria-hidden className="inline-flex [&>svg]:h-4 [&>svg]:w-4">
                {tab.icon}
              </span>
            ) : null}
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span
                className={cx(
                  'rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums',
                  selected
                    ? 'bg-blue-50 text-blue-700'
                    : tab.countTone === 'attention'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-600',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Panel for the active tab; pass the same idBase given to Tabs. */
export function TabPanel({
  idBase,
  tabKey,
  children,
  className,
}: {
  idBase: string;
  tabKey: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tabKey}`}
      aria-labelledby={`${idBase}-tab-${tabKey}`}
      tabIndex={0}
      className={cx('focus:outline-none', className)}
    >
      {children}
    </div>
  );
}
