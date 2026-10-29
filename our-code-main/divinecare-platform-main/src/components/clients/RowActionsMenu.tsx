'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowRight, MoreHorizontal, Pencil, Shuffle } from 'lucide-react';
import {
  chartHref,
  rowActionAriaLabel,
  rowActionItems,
  type RowActionKey,
} from '@/lib/clients/rowActions';

const MENU_WIDTH = 224; // w-56
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
const ITEM_HEIGHT = 40;

const ICONS: Record<RowActionKey, React.ReactNode> = {
  handoff: <Shuffle size={14} aria-hidden />,
  edit: <Pencil size={14} aria-hidden />,
  view: <ArrowRight size={14} aria-hidden />,
};

const ITEM_CLASS =
  'flex min-h-10 w-full items-center gap-2 px-3 text-left text-[13px] font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none';

export type RowActionsMenuProps = {
  clientId: string;
  clientName: string;
  /** No assigned clinician / prescriber — the first item reads "Assign clinician" instead of "Transfer". */
  unassigned: boolean;
  canAssignTeam: boolean;
  canEditRow: boolean;
  onHandoff: () => void;
  onEdit: () => void;
};

/**
 * Row "⋯" menu for the clients list. The wrapper and the portaled menu both carry `data-row-actions`
 * so `isRowClickTarget` never treats a click here as a row click.
 */
export function RowActionsMenu({
  clientId,
  clientName,
  unassigned,
  canAssignTeam,
  canEditRow,
  onHandoff,
  onEdit,
}: RowActionsMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos !== null;

  const items = rowActionItems({ unassigned, canAssignTeam, canEditRow });

  const close = useCallback((restoreFocus = false) => {
    setPos(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = items.length * ITEM_HEIGHT + 8;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN)
    );
    const below = rect.bottom + MENU_GAP;
    const top =
      below + menuHeight > window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, rect.top - MENU_GAP - menuHeight)
        : below;
    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab') return;
      const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (nodes.length === 0) return;
      if (e.key === 'Tab') {
        close();
        return;
      }
      e.preventDefault();
      const idx = nodes.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % nodes.length : (idx - 1 + nodes.length) % nodes.length;
      nodes[next].focus();
    };
    const onDismiss = () => close();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  }, [open, close]);

  const run = (key: RowActionKey) => {
    close();
    if (key === 'handoff') onHandoff();
    if (key === 'edit') onEdit();
  };

  return (
    <div data-row-actions className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={rowActionAriaLabel(clientName)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:h-8 md:w-8"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={rowActionAriaLabel(clientName)}
              data-row-actions
              style={{ position: 'fixed', top: pos.top, left: pos.left }}
              className="z-[70] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
            >
              {items.map((item) =>
                item.key === 'view' ? (
                  <Link
                    key={item.key}
                    href={chartHref(clientId)}
                    role="menuitem"
                    onClick={() => close()}
                    className={ITEM_CLASS}
                  >
                    {ICONS[item.key]}
                    {item.label}
                  </Link>
                ) : (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    onClick={() => run(item.key)}
                    className={ITEM_CLASS}
                  >
                    {ICONS[item.key]}
                    {item.label}
                  </button>
                )
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
