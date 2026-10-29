import { requireSession } from '@/lib/auth/requireSession';
import { isPlatformAdmin } from '@/lib/auth/roles';

/**
 * Clinic tenant context — rejects SUPER_ADMIN and users without an org.
 * Use on all clinic dashboard APIs.
 */
export async function requireOrgContext() {
  const gate = await requireSession();
  if (!gate.ok) {
    return { ok: false as const, status: gate.status, error: gate.error };
  }

  if (isPlatformAdmin(gate.role)) {
    return {
      ok: false as const,
      status: 403,
      error: 'Use the platform console for multi-org administration',
    };
  }

  if (!gate.organizationId) {
    return {
      ok: false as const,
      status: 403,
      error: 'No organization assigned to this account',
    };
  }

  return {
    ok: true as const,
    session: gate.session,
    userId: gate.session.user.id,
    role: gate.role,
    organizationId: gate.organizationId,
    capabilities: gate.capabilities,
  };
}

/** Altrixs platform operator — all orgs. */
export async function requirePlatformAdmin() {
  const gate = await requireSession();
  if (!gate.ok) {
    return { ok: false as const, status: gate.status, error: gate.error };
  }

  if (!isPlatformAdmin(gate.role)) {
    return {
      ok: false as const,
      status: 403,
      error: 'Platform admin only',
    };
  }

  return {
    ok: true as const,
    session: gate.session,
    userId: gate.session.user.id,
    role: gate.role,
  };
}

export function assertSameOrg(
  resourceOrgId: string | null | undefined,
  actorOrgId: string
): { ok: true } | { ok: false; status: 403; error: string } {
  if (!resourceOrgId || resourceOrgId !== actorOrgId) {
    return { ok: false as const, status: 403 as const, error: 'Resource belongs to another organization' };
  }
  return { ok: true as const };
}
