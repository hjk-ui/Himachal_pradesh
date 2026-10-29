'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronsUpDown, Eye, LogOut, UserRound } from 'lucide-react';
import { RoleSwitcherMenuSection, displayRole, type RoleSwitcherState } from '@/components/layout/RoleSwitcher';
import { MEDICAL_DIRECTOR_LABEL } from '@/lib/auth/medicalDirector';
import { currentVersion, formatVersionLabel } from '@/lib/version';
import type { StaffRole } from '@/types/roles';

type AccountUser = {
  displayName?: string | null;
  email?: string | null;
  image?: string | null;
  role?: StaffRole;
  medicalDirectorScope?: string | null;
};

type Props = {
  user: AccountUser;
  /** Sidebar collapsed to icons (desktop only): avatar-only trigger, menu opens to the right. */
  collapsed: boolean;
  profileHref: string | null;
  pathname: string;
  showMedicalDirector: boolean;
  rs: RoleSwitcherState;
  onNavigate: () => void;
  onSignOut: () => void | Promise<void>;
};

/** Same focus ring and radius as the SidebarNav items. */
const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141C34]';
const MENU_ITEM =
  'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-slate-200 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 lg:min-h-10';
const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])';

function initialsFor(user: AccountUser) {
  const source = (user.displayName || user.email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : source.slice(0, 1);
  return letters.toUpperCase() || '?';
}

/**
 * Sidebar footer: one account button (avatar, name, active role) that opens an account menu with
 * My profile, the role switcher / admin role preview, Sign out and the build version. While an
 * admin previews another role an amber "Previewing as" bar with Exit sits above the button.
 */
export function SidebarAccountMenu({
  user,
  collapsed,
  profileHref,
  pathname,
  showMedicalDirector,
  rs,
  onNavigate,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const [fixedPos, setFixedPos] = useState<{ left: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const { loadStaff } = rs;

  const name = user.displayName || 'Staff';
  const roleText = user.role ? displayRole(user.role) : 'Staff';
  const secondary = showMedicalDirector ? `${roleText} · ${MEDICAL_DIRECTOR_LABEL}` : roleText;
  const version = currentVersion();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
  const focusItem = (index: number) => {
    const list = items();
    if (list.length === 0) return;
    list[(index + list.length) % list.length].focus();
  };

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = (focus: 'first' | 'last' = 'first') => {
    focusOnOpen.current = focus;
    loadStaff();
    setOpen(true);
  };

  // Collapsed rail is too narrow for the menu: anchor it to the right of the avatar instead.
  useLayoutEffect(() => {
    if (!open || !collapsed) {
      setFixedPos(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setFixedPos({ left: rect.right + 8, bottom: Math.max(8, window.innerHeight - rect.bottom) });
  }, [open, collapsed]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      const list = items();
      list[focusOnOpen.current === 'last' ? list.length - 1 : 0]?.focus();
    });
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer, { passive: true });
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open, close]);

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(index < 0 ? -1 : index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(-1);
        break;
      case 'Tab':
        // Focus trap-lite: Tab / Shift+Tab cycle through the menu items.
        event.preventDefault();
        focusItem(event.shiftKey ? (index < 0 ? -1 : index - 1) : index + 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      default:
    }
  };

  const avatar = (
    <span
      className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#5C2D91] text-[13px] font-semibold text-white"
      aria-hidden
    >
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsFor(user)
      )}
    </span>
  );

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label="Account"
      onKeyDown={onMenuKeyDown}
      style={fixedPos ? { left: fixedPos.left, bottom: fixedPos.bottom } : undefined}
      className={`z-[60] flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-blue-900 shadow-xl ring-1 ring-black/20 ${
        fixedPos ? 'fixed w-72 max-w-[calc(100vw-1rem)]' : 'absolute inset-x-0 bottom-full mb-2'
      }`}
    >
      <div role="none" className="px-4 pb-2.5 pt-3">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        {user.email ? <p className="truncate text-xs text-slate-300">{user.email}</p> : null}
        {showMedicalDirector && user.medicalDirectorScope ? (
          <p className="mt-0.5 truncate text-[11px] text-slate-300">
            {MEDICAL_DIRECTOR_LABEL}: {user.medicalDirectorScope}
          </p>
        ) : null}
      </div>

      {profileHref ? (
        <div role="none" className="border-t border-white/10 p-1.5">
          <Link
            href={profileHref}
            role="menuitem"
            tabIndex={-1}
            aria-current={pathname.startsWith(profileHref) ? 'page' : undefined}
            onClick={() => {
              close(false);
              onNavigate();
            }}
            className={MENU_ITEM}
          >
            <UserRound size={16} className="shrink-0" aria-hidden />
            <span>My profile</span>
          </Link>
        </div>
      ) : null}

      <RoleSwitcherMenuSection rs={rs} onPicked={() => { close(false); onNavigate(); }} />

      <div role="none" className="border-t border-white/10 p-1.5">
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close(false);
            void onSignOut();
          }}
          className={MENU_ITEM}
        >
          <LogOut size={16} className="shrink-0" aria-hidden />
          <span>Sign out</span>
        </button>
      </div>

      <p role="none" className="border-t border-white/10 px-4 py-2 text-[11px] text-slate-300" title={`Built ${version.builtAt}`}>
        Altrixs {formatVersionLabel(version)}
      </p>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative space-y-2">
      {rs.isPreviewing ? (
        collapsed ? (
          <button
            type="button"
            onClick={() => void rs.exitPreview()}
            disabled={rs.busy}
            title={`Previewing as ${rs.previewLabel}. Exit preview`}
            aria-label={`Exit preview (previewing as ${rs.previewLabel})`}
            className={`flex min-h-10 w-full items-center justify-center rounded-lg border border-amber-300/40 bg-amber-400/15 text-amber-200 transition hover:bg-amber-400/25 disabled:opacity-60 ${FOCUS_RING}`}
          >
            <Eye size={16} aria-hidden />
          </button>
        ) : (
          <div
            role="status"
            className="flex min-h-10 items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-400/15 py-1 pl-3 pr-1 text-[13px] text-amber-100"
          >
            <Eye size={14} className="shrink-0 text-amber-200" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              Previewing as <span className="font-semibold text-white">{rs.previewLabel}</span>
            </span>
            <button
              type="button"
              onClick={() => void rs.exitPreview()}
              disabled={rs.busy}
              className={`min-h-9 shrink-0 rounded-md px-2.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/25 hover:text-white disabled:opacity-60 ${FOCUS_RING}`}
            >
              Exit
            </button>
          </div>
        )
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu: ${name}, ${secondary}`}
        title={collapsed ? `${name} · ${secondary}` : undefined}
        className={`flex w-full items-center rounded-lg text-left transition hover:bg-white/5 ${
          open ? 'bg-white/10' : ''
        } ${collapsed ? 'min-h-[52px] justify-center px-2 py-2' : 'min-h-[52px] gap-2.5 px-2.5 py-2'} ${FOCUS_RING}`}
      >
        {avatar}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-white">{name}</span>
              <span className="block truncate text-xs text-slate-300">{secondary}</span>
            </span>
            <ChevronsUpDown size={16} className="shrink-0 text-slate-300" aria-hidden />
          </>
        )}
      </button>

      {menu}
    </div>
  );
}
