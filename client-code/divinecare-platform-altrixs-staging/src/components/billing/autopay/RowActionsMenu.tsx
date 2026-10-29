'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type RowAction = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown as the item's title when disabled (why it is unavailable) */
  hint?: string;
  danger?: boolean;
};

/** Keyboard-accessible actions menu: Enter/Space/ArrowDown opens, arrows move, Escape closes and returns focus. */
export function RowActionsMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const enabled = actions.map((a, i) => (a.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openMenu = () => {
    if (enabled.length === 0) return;
    setActive(enabled[0]);
    setOpen(true);
  };

  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const move = (dir: 1 | -1) => {
    const pos = enabled.indexOf(active);
    const next = enabled[(pos + dir + enabled.length) % enabled.length];
    setActive(next);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(enabled[0]); }
    else if (e.key === 'End') { e.preventDefault(); setActive(enabled[enabled.length - 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  return (
    <div ref={wrapRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(); }
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {actions.map((a, i) => (
            <button
              key={a.key}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              aria-disabled={a.disabled || undefined}
              title={a.disabled ? a.hint : undefined}
              onClick={() => {
                if (a.disabled) return;
                close();
                a.onSelect();
              }}
              className={`block w-full px-3 py-2 text-left focus:outline-none ${
                a.disabled
                  ? 'cursor-not-allowed text-slate-500'
                  : a.danger
                    ? 'text-rose-700 hover:bg-rose-50 focus:bg-rose-50'
                    : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-100'
              }`}
            >
              {a.label}
              {a.disabled && a.hint ? <span className="mt-0.5 block text-[11px] text-slate-500">{a.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
