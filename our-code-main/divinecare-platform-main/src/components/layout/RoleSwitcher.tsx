'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { listStaff, type StaffUser } from '@/features/staff';
import { roleLabel } from '@/lib/auth/userRoles';
import { homePathForRole } from '@/lib/auth/roleAccess';
import { CLINIC_ADMIN_ROLE_OPTIONS } from '@/lib/platform/clinic-roles';
import type { StaffRole } from '@/types/roles';

const LABEL_BY_ROLE = Object.fromEntries(
  CLINIC_ADMIN_ROLE_OPTIONS.map((option) => [option.value, option.label])
) as Partial<Record<StaffRole, string>>;

export function displayRole(role: StaffRole) {
  return LABEL_BY_ROLE[role] ?? roleLabel(role);
}

export function staffRoles(staff: StaffUser) {
  return Array.from(new Set([staff.role, ...(staff.roles ?? [])]));
}

export function staffInitials(item: Pick<StaffUser, 'name' | 'email'>) {
  return (item.name || item.email || '?')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Role preview (admins) and assigned-role switching (multi-role staff).
 * Shared by the sidebar Account menu and the standalone RoleSwitcher.
 */
export function useRoleSwitching(options: { loadStaff?: boolean } = {}) {
  const { loadStaff = true } = options;
  const { user, switchRole } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState(false);

  const active = user?.role;
  const assignedRoles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const isAdminViewer = user?.baseRole === 'ADMIN' || user?.role === 'ADMIN';
  /** An admin currently looking at another role's dashboard. */
  const isPreviewing = Boolean(isAdminViewer && active && active !== 'ADMIN');
  const canSwitch = isAdminViewer || assignedRoles.length > 1;

  useEffect(() => {
    if (!isAdminViewer || !loadStaff) return;
    let cancelled = false;
    setStaffLoading(true);
    setStaffError(false);
    listStaff()
      .then((users) => {
        if (!cancelled) setStaff(users.filter((item) => item.status !== 'DEACTIVATED'));
      })
      .catch(() => {
        if (!cancelled) setStaffError(true);
      })
      .finally(() => {
        if (!cancelled) setStaffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdminViewer, loadStaff]);

  /** Switch to `next` and land on that role's home. Resolves true when the switch happened. */
  const pick = async (next: StaffRole): Promise<boolean> => {
    if (!active || next === active || busy) return false;
    setBusy(true);
    try {
      const ok = await switchRole(next);
      if (ok) {
        router.replace(homePathForRole(next));
        router.refresh();
      }
      return ok;
    } finally {
      setBusy(false);
    }
  };

  return {
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
  };
}

type Props = {
  collapsed?: boolean;
};

/** Role preview for admins, and assigned-role switching for regular staff. */
export function RoleSwitcher({ collapsed = false }: Props) {
  const {
    user,
    active,
    assignedRoles,
    isAdminViewer,
    canSwitch,
    staff,
    staffLoading,
    staffError,
    busy,
    pick,
  } = useRoleSwitching();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const displayStaff = useMemo(() => staff, [staff]);

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [open]);

  if (!user || !active) return null;
  if (!canSwitch) return null;

  const onPick = async (next: StaffRole) => {
    if (await pick(next)) setOpen(false);
  };

  const menu = (
    <div
      className={`absolute bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#1a2340] shadow-xl ${
        collapsed ? 'left-0 w-72 max-w-[calc(100vw-1rem)]' : 'left-0 right-0'
      }`}
    >
      {isAdminViewer ? (
        <>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {staffLoading ? (
              <p className="px-2 py-3 text-xs text-slate-400">Loading staff...</p>
            ) : displayStaff.length > 0 ? (
              displayStaff.map((item) => {
                const itemRoles = staffRoles(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(item.role)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6868D0]/20 text-[10px] font-bold text-[#c7c9ff]">
                      {staffInitials(item)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-100">
                        {item.name || item.email}
                      </span>
                      <span className="block truncate text-[10px] text-slate-400">
                        {itemRoles.map(displayRole).join(' / ')}
                      </span>
                    </span>
                    {item.role === active ? <Check className="h-3.5 w-3.5 shrink-0 text-[#A3A5F0]" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-3 text-xs text-slate-400">
                {staffError ? 'Staff list unavailable.' : 'No staff found.'}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="border-b border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Assigned by admin
          </p>
          {assignedRoles.map((role) => (
            <button
              key={role}
              type="button"
              disabled={busy}
              onClick={() => onPick(role)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              <span className="font-medium">{displayRole(role)}</span>
              {role === active ? <Check className="h-4 w-4 text-[#A3A5F0]" /> : null}
            </button>
          ))}
        </>
      )}
    </div>
  );

  const label = isAdminViewer
    ? active === 'ADMIN'
      ? 'Switch Demo Role'
      : `Viewing as ${displayRole(active)}`
    : displayRole(active);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex w-full items-center rounded-xl border border-white/10 bg-white/5 text-left transition hover:bg-white/10 disabled:opacity-60 ${
          collapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-3 py-2'
        }`}
      >
        {collapsed ? (
          <RefreshCw className="h-4 w-4 text-slate-300" />
        ) : (
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              {isAdminViewer ? 'Role preview' : 'Your dashboards'}
            </p>
            <p className="truncate text-sm font-semibold text-white">{label}</p>
          </div>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-300 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? menu : null}
    </div>
  );
}
