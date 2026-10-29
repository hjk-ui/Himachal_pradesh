'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  activateStaff,
  changeStaffEmail,
  createStaff,
  deactivateStaff,
  inviteStaff,
  listStaff,
  resendStaffInvite,
  resetStaffMfa,
  updateStaff,
} from '../api/staffApi';
import type {
  CreateStaffInput,
  InviteStaffInput,
  StaffUser,
  UpdateStaffInput,
} from '../types';

export function useStaff() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listStaff());
    } catch (err: any) {
      setError(err.message || 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const upsertLocal = (user: StaffUser) => {
    setUsers((prev) => {
      const rest = prev.filter((u) => u.id !== user.id);
      return [user, ...rest].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  };

  const addStaff = async (input: CreateStaffInput) => {
    const user = await createStaff(input);
    upsertLocal(user);
    return user;
  };

  const sendInvite = async (input: InviteStaffInput) => {
    const result = await inviteStaff(input);
    upsertLocal(result.user);
    return result;
  };

  const resendInvite = async (userId: string) => {
    const result = await resendStaffInvite(userId);
    upsertLocal(result.user);
    return result;
  };

  const manageStaff = async (userId: string, input: UpdateStaffInput) => {
    const result = await updateStaff(userId, input);
    upsertLocal(result.user);
    return result;
  };

  const changeEmail = async (userId: string, email: string) => {
    const result = await changeStaffEmail(userId, email);
    upsertLocal(result.user);
    return result;
  };

  const setInactive = async (userId: string) => {
    const result = await deactivateStaff(userId);
    upsertLocal(result.user);
    return result;
  };

  const resetMfa = async (userId: string) => {
    const result = await resetStaffMfa(userId);
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, mfaEnabled: false } : u)));
    return result;
  };

  const setActive = async (userId: string) => {
    const result = await activateStaff(userId);
    upsertLocal(result.user);
    return result;
  };

  return {
    users,
    loading,
    error,
    reload,
    addStaff,
    sendInvite,
    resendInvite,
    manageStaff,
    changeEmail,
    setInactive,
    setActive,
    resetMfa,
  };
}
