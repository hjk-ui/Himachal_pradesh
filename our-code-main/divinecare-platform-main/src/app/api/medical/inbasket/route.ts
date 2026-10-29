import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { buildProviderInBasket } from '@/lib/medical/inbasket';

export const runtime = 'nodejs';

const INBASKET_ROLES = new Set(['PHYSICIAN', 'MEDICAL_NP', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !INBASKET_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const basket = await buildProviderInBasket(gate.organizationId);
  return NextResponse.json({ success: true, ...basket });
}
