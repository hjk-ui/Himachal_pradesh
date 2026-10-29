'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';

export type RowMenuAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Navigate on select (router.push). */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Shown under the label when disabled (why it is unavailable). */
  hint?: string;
  /** Emphasised item (e.g. "Assign" for an unassigned client). */
  emphasis?: boolean;
  danger?: boolean;
};

const MENU_WIDTH = 224; // w-56

/**
 * Compact "more actions" button for table rows and cards (Lucide MoreHorizontal).
 * The menu is position: fixed so it is never clipped by an overflow-x-auto table wrapper,
 * flips above the button near the bottom of the viewport, and stays inside the viewport
 * horizontally on phones. Keyboard: Enter/Space/ArrowDown opens, arrows move, Escape closes.
 * Clicks inside never bubble to a clickable row.
 */
export function RowActionsMenu({ label, actions, className = '' }: { label: string; actions: RowMenuAction[]; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const enabled = actions.map((a, i) => (a.disabled ? -1 : i)).filter((i) => i >= 0);

  const place = useCallback(() => {
    const b = buttonRef.current?.getBoundingClientRect();
    if (!b) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuH = menuRef.current?.offsetHeight ?? actions.length * 40 + 8;
    const up = b.bottom + menuH + 8 > vh && b.top - menuH - 8 > 0;
    const left = Math.max(8, Math.min(b.right - MENU_WIDTH, vw - MENU_WIDTH - 8));
    setPos({ top: up ? b.top - menuH - 4 : b.bottom + 4, left, up });
  }, [actions.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Any scroll (page or table) would detach the fixed menu from its button: close it.
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
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
    const p = enabled.indexOf(active);
    setActive(enabled[(p + dir + enabled.length) % enabled.length]);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(enabled[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(enabled[enabled.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div
      className={`relative inline-block text-left ${className}`}
      data-row-actions
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            openMenu();
          }
        }}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:h-9 md:w-9"
      >
        <MoreHorizontal size={18} aria-hidden />
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH, maxWidth: 'calc(100vw - 16px)' }}
          className="z-[70] max-h-[min(20rem,calc(100dvh-1rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {actions.map((a, i) => (
            <button
              key={a.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              aria-disabled={a.disabled || undefined}
              title={a.disabled ? a.hint : undefined}
              onClick={() => {
                if (a.disabled) return;
                close(!a.href);
                if (a.href) router.push(a.href);
                else a.onSelect?.();
              }}
              className={`flex min-h-10 w-full items-start gap-2 px-3 py-2 text-left focus:outline-none ${
                a.disabled
                  ? 'cursor-not-allowed text-slate-500'
                  : a.danger
                    ? 'text-rose-700 hover:bg-rose-50 focus:bg-rose-50'
                    : a.emphasis
                      ? 'font-semibold text-blue-700 hover:bg-blue-50 focus:bg-blue-50'
                      : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-100'
              }`}
            >
              {a.icon ? <span className="mt-0.5 shrink-0 text-current opacity-80">{a.icon}</span> : null}
              <span className="min-w-0 flex-1">
                {a.label}
                {a.disabled && a.hint ? <span className="mt-0.5 block text-[11px] text-slate-500">{a.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
