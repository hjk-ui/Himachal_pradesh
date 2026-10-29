import { resolveChartAccess } from '@/lib/clients/chartAccess';

/**
 * One-client API gate: role rule first (deny by default), then the chart rule
 * (org, roster role, 42 CFR Part 2 / sensitive record, caseload or care team).
 * Callers audit the DENIED outcome with the returned reason.
 */
export type ClientRouteGate =
  | { ok: true }
  | { ok: false; status: 403 | 404; reason: string; error: string };

export async function gateClientRoute(input: {
  organizationId: string;
  userId: string;
  role: string;
  clientId: string;
  path: string;
  roleAllowed: boolean;
}): Promise<ClientRouteGate> {
  if (!input.roleAllowed) {
    return { ok: false, status: 403, reason: 'role_not_permitted', error: 'Your role cannot view this information' };
  }
  const access = await resolveChartAccess(
    { organizationId: input.organizationId, userId: input.userId, role: input.role },
    input.clientId,
    input.path,
  );
  if (access.ok === false) {
    return {
      ok: false,
      status: access.status,
      reason: access.reason,
      error: access.status === 404 ? 'Patient not found' : 'You do not have access to this client',
    };
  }
  return { ok: true };
}
