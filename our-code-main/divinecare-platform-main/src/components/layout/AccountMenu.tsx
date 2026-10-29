'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronRight, LogOut, UserRound, X } from 'lucide-react';
import { roleLabel } from '@/lib/auth/userRoles';
import {
  ACCOUNT_MENU_COPY,
  accountMenuAriaLabel,
  altrixsVersionLabel,
  PROFILE_HREF,
  previewingAs,
  roleMenuLabel,
} from '@/lib/layout/accountMenu';
import type { StaffRole } from '@/types/roles';
import { displayRole, staffInitials, staffRoles, useRoleSwitching } from './RoleSwitcher';

type Props = {
  /** Collapsed sidebar rail: avatar only. */
  collapsed?: boolean;
  /** Called after navigating (closes the mobile drawer). */
  onNavigate?: () => void;
  onSignOut: () => void | Promise<void>;
};

const MENU_ITEM =
  'flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm font-medium text-slate-200 transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:opacity-50';

/**
 * Sidebar footer Account menu: My profile · Role preview (admin) / Switch dashboard (multi-role) · Sign out.
 * Replaces the old RoleSwitcher + settings link + Sign out stack; the role logic is the same hook.
 */
export function AccountMenu({ collapsed = false, onNavigate, onSignOut }: Props) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'roles'>('main');

  const {
    user,
    active,
    assignedRoles,
    isAdminViewer,
    isPreviewing,
    canSwitch,
    staff,
    staffLoading,
    staffError,
    busy,
    pick,
  } = useRoleSwitching({ loadStaff: open && view === 'roles' });

  const close = (restoreFocus = false) => {
    setOpen(false);
    setView('main');
    if (restoreFocus) triggerRef.current?.focus();
  };

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Focus the first item whenever the menu (or its role view) opens.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open, view]);

  if (!user) return null;

  const name = user.displayName || 'Staff';
  const roleText = roleLabel(active ?? user.role);
  const initial = user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (view === 'roles') setView('main');
      else close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab') return;
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
    );
    if (nodes.length === 0) return;
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    const forward = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
    // Arrow keys and Tab both cycle inside the menu (focus trap).
    e.preventDefault();
    const next = forward ? (idx + 1) % nodes.length : (idx - 1 + nodes.length) % nodes.length;
    nodes[next].focus();
  };

  const onPick = async (next: StaffRole) => {
    if (await pick(next)) close();
  };

  const exitPreview = async () => {
    await pick('ADMIN');
  };

  const roleMenu = roleMenuLabel(isAdminViewer);

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={accountMenuAriaLabel(name, roleText)}
      onKeyDown={onMenuKeyDown}
      className={`absolute bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#1a2340] shadow-xl ${
        collapsed ? 'left-0 w-72 max-w-[calc(100vw-1rem)]' : 'left-0 right-0'
      }`}
    >
      {view === 'main' ? (
        <>
          <Link
            href={PROFILE_HREF}
            role="menuitem"
            onClick={() => {
              close();
              onNavigate?.();
            }}
            className={MENU_ITEM}
          >
            <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            {ACCOUNT_MENU_COPY.profile}
          </Link>

          {canSwitch ? (
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              onClick={() => setView('roles')}
              className={MENU_ITEM}
            >
              <span className="flex-1">{roleMenu}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void onSignOut();
            }}
            className={`${MENU_ITEM} border-t border-white/10`}
          >
            <LogOut className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            {ACCOUNT_MENU_COPY.signOut}
          </button>

          <p className="border-t border-white/10 px-3 py-2 text-[11px] text-slate-400">
            {altrixsVersionLabel(process.env.NEXT_PUBLIC_APP_VERSION)}
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => setView('main')}
            className={`${MENU_ITEM} border-b border-white/10 text-[11px] font-bold uppercase tracking-wider text-slate-400`}
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {roleMenu}
          </button>
          <div className="max-h-64 overflow-y-auto">
            {isAdminViewer ? (
              staffLoading ? (
                <p className="px-3 py-3 text-xs text-slate-400">Loading staff...</p>
              ) : staff.length > 0 ? (
                staff.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => void onPick(item.role)}
                    className={MENU_ITEM}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6868D0]/20 text-[10px] font-bold text-[#c7c9ff]">
                      {staffInitials(item)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-100">
                        {item.name || item.email}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {staffRoles(item).map(displayRole).join(' / ')}
                      </span>
                    </span>
                    {item.role === active ? <Check className="h-3.5 w-3.5 shrink-0 text-[#A3A5F0]" aria-hidden /> : null}
                  </button>
                ))
              ) : (
                <p className="px-3 py-3 text-xs text-slate-400">
                  {staffError ? 'Staff list unavailable.' : 'No staff found.'}
                </p>
              )
            ) : (
              assignedRoles.map((role) => (
                <button
                  key={role}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void onPick(role)}
                  className={`${MENU_ITEM} justify-between`}
                >
                  <span>{displayRole(role)}</span>
                  {role === active ? <Check className="h-4 w-4 text-[#A3A5F0]" aria-hidden /> : null}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );

  const previewLabel = active ? previewingAs(displayRole(active)) : '';

  return (
    <div ref={rootRef} className="relative">
      {isPreviewing && active ? (
        collapsed ? (
          <button
            type="button"
            onClick={() => void exitPreview()}
            disabled={busy}
            title={`${previewLabel} — ${ACCOUNT_MENU_COPY.exit}`}
            aria-label={`${previewLabel}. ${ACCOUNT_MENU_COPY.exit}`}
            className="mb-2 flex min-h-11 w-full items-center justify-center rounded-lg bg-amber-400/15 text-amber-200 transition hover:bg-amber-400/25 disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-400/15 px-3 py-1.5">
            <p className="min-w-0 truncate text-[12px] font-semibold text-amber-100">{previewLabel}</p>
            <button
              type="button"
              onClick={() => void exitPreview()}
              disabled={busy}
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-bold text-amber-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {ACCOUNT_MENU_COPY.exit}
            </button>
          </div>
        )
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={accountMenuAriaLabel(name, roleText)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={name}
        className={`flex w-full items-center rounded-2xl border border-white/10 bg-white/5 text-left transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
          collapsed ? 'justify-center p-2' : 'gap-3 p-2.5'
        }`}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#6868D0] text-sm font-semibold text-white">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </div>
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-white">{name}</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-200">
                {roleText}
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-300">{user.email}</p>
          </div>
        ) : null}
      </button>

      {open ? menu : null}
    </div>
  );
}
