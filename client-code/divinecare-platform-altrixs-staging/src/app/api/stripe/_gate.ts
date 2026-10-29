import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

/** Billing actions: signed-in leadership of a clinic (same roles as /dashboard/subscription). */
export async function requireBillingManager() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  }
  if (!canAccessPath(gate.role, '/dashboard/subscription')) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, gate };
}

export function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}
