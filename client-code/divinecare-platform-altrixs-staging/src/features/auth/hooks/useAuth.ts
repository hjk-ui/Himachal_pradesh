'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { logout as logoutApi } from '../api/authApi';
import type { AuthUser } from '../types';
import type { StaffRole } from '@/types/roles';
import { canSwitchToRole, normalizeUserRoles } from '@/lib/auth/userRoles';
import { CLINIC_ADMIN_ROLE_VALUES } from '@/lib/platform/clinic-roles';

const ADMIN_PREVIEW_STORAGE_KEY = 'altrixs.adminPreviewSelected';

/** Client session helper. Auth is enforced by middleware + server `auth()`. */
export function useAuth() {
  const { data, status, update } = useSession();

  const user: AuthUser | null = useMemo(() => {
    if (!data?.user?.id) return null;
    const roles = normalizeUserRoles(data.user.role, data.user.roles);
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      name: data.user.name ?? null,
      image: data.user.image,
      role: data.user.role,
      baseRole: data.user.baseRole,
      rolePreview: data.user.rolePreview,
      roles,
      organizationId: data.user.organizationId ?? null,
      medicalDirector: Boolean(data.user.medicalDirector),
      medicalDirectorPreview: Boolean(data.user.medicalDirectorPreview),
      medicalDirectorScope: data.user.medicalDirectorScope ?? null,
      displayName: data.user.name ?? data.user.email ?? null,
    };
  }, [data]);

  const loading = status === 'loading';

  useEffect(() => {
    if (!user || user.baseRole !== 'ADMIN' || !user.rolePreview) return;

    try {
      if (window.sessionStorage.getItem(ADMIN_PREVIEW_STORAGE_KEY) === '1') return;
    } catch {
      return;
    }

    void update({ activeRole: 'ADMIN', roles: [...CLINIC_ADMIN_ROLE_VALUES] });
  }, [update, user]);

  const logout = async () => {
    try {
      window.sessionStorage.removeItem(ADMIN_PREVIEW_STORAGE_KEY);
      const { wipeOfflineEncryption } = await import('@/lib/offline/crypto');
      const { wipeOfflineDraftsAndQueue } = await import('@/lib/offline/db');
      wipeOfflineEncryption();
      await wipeOfflineDraftsAndQueue(true);
    } catch {
      // Ignore storage restrictions during logout.
    }
    await logoutApi();
  };

  /**
   * Switch the active role. `medicalDirectorPreview` (admins only) previews "Medical Director (<role>)":
   * the JWT callback honours it only for an ADMIN base role and the server re-checks the DB role.
   */
  const switchRole = useCallback(
    async (next: StaffRole, opts?: { medicalDirectorPreview?: boolean }) => {
      if (!user?.role) return false;
      const roles = user.roles?.length ? user.roles : normalizeUserRoles(user.role, []);
      const isAdminViewer = user.baseRole === 'ADMIN' || user.role === 'ADMIN';
      const allowed = isAdminViewer ? [...CLINIC_ADMIN_ROLE_VALUES] : roles;
      if (!canSwitchToRole(allowed, next)) return false;
      const wantPreview = Boolean(isAdminViewer && opts?.medicalDirectorPreview);
      if (next === user.role && wantPreview === Boolean(user.medicalDirectorPreview)) return true;
      if (isAdminViewer) {
        try {
          window.sessionStorage.setItem(ADMIN_PREVIEW_STORAGE_KEY, '1');
        } catch {
          // The role update still works if session storage is unavailable.
        }
      }
      await update({ activeRole: next, roles: allowed, medicalDirectorPreview: wantPreview });
      return true;
    },
    [user, update]
  );

  /** Re-read the Medical Director flag from the database into the session token. */
  const refreshCapabilities = useCallback(async () => {
    await update({ refreshCapabilities: true });
  }, [update]);

  return { user, loading, logout, switchRole, refreshCapabilities };
}
