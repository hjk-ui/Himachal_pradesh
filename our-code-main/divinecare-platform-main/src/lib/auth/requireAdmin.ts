import { requireOrgContext } from '@/lib/auth/tenant';

/** Admin, Director, or HR — staff directory / general management (clinic org only) */
export async function requireAdmin() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false as const, status: gate.status, error: gate.error };
  }
  const role = gate.role;
  const isAdminPreview =
    gate.session.user.baseRole === 'ADMIN' ||
    gate.session.user.baseRole === 'PRACTICE_DIRECTOR';
  if (
    !isAdminPreview &&
    role !== 'ADMIN' &&
    role !== 'PRACTICE_DIRECTOR' &&
    role !== 'DIRECTOR' &&
    role !== 'HR'
  ) {
    return {
      ok: false as const,
      status: 403,
      error: 'Only Admin / Director / HR can manage staff',
    };
  }
  return {
    ok: true as const,
    session: gate.session,
    userId: gate.userId,
    role: gate.role,
    organizationId: gate.organizationId,
  };
}

/** Admin only — invites, sensitive staff actions (clinic org only) */
export async function requireFullAdmin() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false as const, status: gate.status, error: gate.error };
  }
  const isAdminPreview =
    gate.session.user.baseRole === 'ADMIN' ||
    gate.session.user.baseRole === 'PRACTICE_DIRECTOR';
  if (!isAdminPreview && gate.role !== 'ADMIN' && gate.role !== 'PRACTICE_DIRECTOR') {
    return {
      ok: false as const,
      status: 403,
      error: 'Only Admin / Practice Director can invite staff',
    };
  }
  return {
    ok: true as const,
    session: gate.session,
    userId: gate.userId,
    role: gate.role,
    organizationId: gate.organizationId,
  };
}
