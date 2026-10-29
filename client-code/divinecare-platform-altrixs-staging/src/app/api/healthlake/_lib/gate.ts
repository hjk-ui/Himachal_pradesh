import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { healthLakeConfig, notConfiguredBody, type HealthLakeConfig } from '@/lib/healthlake/config';

export type HealthLakeGate = { organizationId: string; userId: string; role: string };

/** Staff session in a clinic + the HealthLake page roles (practice director / admin / director). */
export async function healthLakeGate(): Promise<{ ok: true; gate: HealthLakeGate } | { ok: false; response: NextResponse }> {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/healthlake')) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, gate: { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) } };
}

/** 503 HEALTHLAKE_NOT_CONFIGURED when the data store or credentials are missing; null when configured. */
export function notConfiguredResponse(cfg: HealthLakeConfig = healthLakeConfig()): NextResponse | null {
  if (cfg.configured) return null;
  return NextResponse.json(notConfiguredBody(cfg), { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
