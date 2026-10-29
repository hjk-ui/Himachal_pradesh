import { apiJson } from '@/lib/api-client';
import type {
  CreateStaffInput,
  InviteStaffInput,
  StaffUser,
  UpdateStaffInput,
} from '../types';

export async function listStaff() {
  const data = await apiJson<{ success: true; users: StaffUser[] }>('/api/staff');
  return data.users;
}

export async function createStaff(input: CreateStaffInput) {
  const data = await apiJson<{ success: true; user: StaffUser }>('/api/staff', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.user;
}

export async function inviteStaff(input: InviteStaffInput) {
  const data = await apiJson<{
    success: true;
    user: StaffUser;
    message?: string;
    emailMode?: string;
  }>('/api/staff/invite', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data;
}

export async function resendStaffInvite(userId: string) {
  const data = await apiJson<{
    success: true;
    user: StaffUser;
    message?: string;
  }>('/api/staff/invite/resend', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
  return data;
}

export async function fetchInvitePreview(token: string) {
  const data = await apiJson<{
    success: true;
    invite: { name: string | null; email: string; role: string; expiresAt: string };
  }>(`/api/staff/invite/accept?token=${encodeURIComponent(token)}`);
  return data.invite;
}

export async function acceptInvite(token: string, password: string) {
  const data = await apiJson<{ success: true; message?: string }>('/api/staff/invite/accept', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
  return data;
}

export async function updateStaff(userId: string, input: UpdateStaffInput) {
  const data = await apiJson<{ success: true; user: StaffUser; message?: string }>(
    `/api/staff/${userId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  );
  return data;
}

export async function changeStaffEmail(userId: string, email: string) {
  return apiJson<{ success: true; user: StaffUser; message?: string }>(`/api/staff/${userId}/email`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function deactivateStaff(userId: string) {
  return updateStaff(userId, { status: 'DEACTIVATED' });
}

export async function activateStaff(userId: string) {
  return updateStaff(userId, { status: 'ACTIVE' });
}

/** Admin: clear a staff member's two-factor sign-in; they set it up again at next sign-in (audited). */
export async function resetStaffMfa(userId: string) {
  return apiJson<{ success: true; message?: string }>(`/api/staff/${userId}/mfa-reset`, { method: 'POST' });
}
