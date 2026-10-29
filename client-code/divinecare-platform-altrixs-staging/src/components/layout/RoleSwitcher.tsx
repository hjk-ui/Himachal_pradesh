'use client';

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { listStaff, type StaffUser } from '@/features/staff';
import { roleLabel } from '@/lib/auth/userRoles';
import { homePathForRole } from '@/lib/auth/roleAccess';
import { CLINIC_ADMIN_ROLE_OPTIONS } from '@/lib/platform/clinic-roles';
import { MEDICAL_DIRECTOR_LABEL, isMedicalDirectorEligibleRole } from '@/lib/auth/medicalDirector';
import type { StaffRole } from '@/types/roles';

const LABEL_BY_ROLE = Object.fromEntries(
  CLINIC_ADMIN_ROLE_OPTIONS.map((option) => [option.value, option.label])
) as Partial<Record<StaffRole, string>>;

export function displayRole(role: StaffRole) {
  return LABEL_BY_ROLE[role] ?? roleLabel(role);
}

function staffRoles(staff: StaffUser) {
  return Array.from(new Set([staff.role, ...(staff.roles ?? [])]));
}

/** Role-only preview entries (no fake people) for roles not yet held by real staff. */
const ROLE_PREVIEW_ENTRIES: StaffUser[] = CLINIC_ADMIN_ROLE_OPTIONS.map((option) => ({
  id: `role-preview-${option.value.toLowerCase()}`,
  name: option.label,
  email: '',
  role: option.value,
  roles: [option.value],
  status: 'ACTIVE',
  createdAt: '',
}));

/**
 * Admin-only preview of the Medical Director capability on a Psychiatrist. The flag applies to this
 * preview session only: the JWT callback accepts it for an ADMIN base role and requireSession
 * re-checks the database role, so it is never grantable to a non-admin.
 */
const MEDICAL_DIRECTOR_PREVIEW_ENTRY: StaffUser = {
  id: 'role-preview-medical-director-psychiatrist',
  name: `${MEDICAL_DIRECTOR_LABEL} (Psychiatrist)`,
  email: '',
  role: 'PSYCHIATRIST',
  roles: ['PSYCHIATRIST'],
  status: 'ACTIVE',
  isMedicalDirector: true,
  createdAt: '',
};

/** Previewing a staff entry carries its Medical Director flag (prescriber roles only). */
function previewsMedicalDirector(item: StaffUser): boolean {
  return Boolean(item.isMedicalDirector) && isMedicalDirectorEligibleRole(item.role);
}

/**
 * Role preview for admins, and assigned-role switching for regular staff. Called once by
 * DashboardShell so the sidebar account menu and the preview banner share one state.
 */
export function useRoleSwitcher() {
  const { user, switchRole } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState(false);
  const staffRequested = useRef(false);

  const active = user?.role ?? null;
  const assignedRoles: StaffRole[] = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const isAdminViewer = user?.baseRole === 'ADMIN' || user?.role === 'ADMIN';
  const activeDirectorPreview = Boolean(user?.medicalDirectorPreview);
  const canSwitch = Boolean(user && active) && (isAdminViewer || assignedRoles.length > 1);
  /** An admin looking at another role's dashboard (or the Medical Director preview). */
  const isPreviewing = Boolean(isAdminViewer && active && (active !== 'ADMIN' || activeDirectorPreview));
  const previewLabel = active
    ? activeDirectorPreview
      ? `${MEDICAL_DIRECTOR_LABEL} (${displayRole(active)})`
      : displayRole(active)
    : '';

  const displayStaff = useMemo(() => {
    const existingRoles = new Set(staff.map((s) => s.role));
    const additions = ROLE_PREVIEW_ENTRIES.filter((d) => !existingRoles.has(d.role));
    return [...staff, ...additions, MEDICAL_DIRECTOR_PREVIEW_ENTRY];
  }, [staff]);

  /** Admin staff list loads the first time the menu opens (idempotent). */
  const loadStaff = useCallback(() => {
    if (!isAdminViewer || staffRequested.current) return;
    staffRequested.current = true;
    setStaffLoading(true);
    listStaff()
      .then((users) => setStaff(users.filter((item) => item.status !== 'DEACTIVATED')))
      .catch(() => setStaffError(true))
      .finally(() => setStaffLoading(false));
  }, [isAdminViewer]);

  /** Resolves true when the role actually changed. */
  const pick = async (next: StaffRole, medicalDirectorPreview = false): Promise<boolean> => {
    const preview = isAdminViewer && medicalDirectorPreview;
    if ((next === active && preview === activeDirectorPreview) || busy) return false;
    setBusy(true);
    try {
      const ok = await switchRole(next, { medicalDirectorPreview: preview });
      if (ok) {
        router.replace(homePathForRole(next));
        router.refresh();
      }
      return Boolean(ok);
    } finally {
      setBusy(false);
    }
  };

  /** Leave an admin preview and return to the Admin dashboard. */
  const exitPreview = () => pick('ADMIN', false);

  return {
    active,
    assignedRoles,
    isAdminViewer,
    activeDirectorPreview,
    canSwitch,
    isPreviewing,
    previewLabel,
    displayStaff,
    staffLoading,
    staffError,
    busy,
    loadStaff,
    pick,
    exitPreview,
  };
}

export type RoleSwitcherState = ReturnType<typeof useRoleSwitcher>;

const ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-slate-200 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 lg:min-h-10';

/** Role list rendered inside the sidebar account menu (menuitemradio entries). */
export function RoleSwitcherMenuSection({
  rs,
  onPicked,
}: {
  rs: RoleSwitcherState;
  onPicked: () => void;
}) {
  const labelId = useId();
  if (!rs.canSwitch || !rs.active) return null;
  const choose = async (role: StaffRole, medicalDirectorPreview = false) => {
    if (await rs.pick(role, medicalDirectorPreview)) onPicked();
  };

  return (
    <div role="group" aria-labelledby={labelId} className="border-t border-white/10 p-1.5">
      <p
        id={labelId}
        className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300"
      >
        {rs.isAdminViewer ? 'Role preview' : 'Switch dashboard'}
      </p>
      {rs.isAdminViewer ? (
        <div className="max-h-64 overflow-y-auto overscroll-contain">
          {rs.staffLoading ? (
            <p className="px-3 py-2 text-xs text-slate-300">Loading staff…</p>
          ) : rs.displayStaff.length > 0 ? (
            rs.displayStaff.map((item) => {
              const md = previewsMedicalDirector(item);
              const checked = item.role === rs.active && md === rs.activeDirectorPreview;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  tabIndex={-1}
                  disabled={rs.busy}
                  onClick={() => void choose(item.role, md)}
                  className={ITEM_CLASS}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-100">{item.name || item.email}</span>
                    <span className="block truncate text-[11px] text-slate-300">
                      {staffRoles(item).map(displayRole).join(' / ')}
                      {md ? ` · ${MEDICAL_DIRECTOR_LABEL}` : ''}
                    </span>
                  </span>
                  {checked ? <Check className="h-4 w-4 shrink-0 text-white" aria-hidden /> : null}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-2 text-xs text-slate-300">
              {rs.staffError ? 'Staff list unavailable.' : 'No staff found.'}
            </p>
          )}
        </div>
      ) : (
        rs.assignedRoles.map((role) => (
          <button
            key={role}
            type="button"
            role="menuitemradio"
            aria-checked={role === rs.active}
            tabIndex={-1}
            disabled={rs.busy}
            onClick={() => void choose(role)}
            className={ITEM_CLASS}
          >
            <span className="min-w-0 flex-1 truncate">{displayRole(role)}</span>
            {role === rs.active ? <Check className="h-4 w-4 shrink-0 text-white" aria-hidden /> : null}
          </button>
        ))
      )}
    </div>
  );
}
