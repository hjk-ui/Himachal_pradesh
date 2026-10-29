import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getConnectStatus } from '@/lib/connect/service';

export const runtime = 'nodejs';

/** GET /api/connect/status — live vs demoMode + source DID last4 (no full number). */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/communications') &&
    !canAccessPath(gate.role, '/dashboard/telehealth')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ success: true, ...getConnectStatus() });
}
