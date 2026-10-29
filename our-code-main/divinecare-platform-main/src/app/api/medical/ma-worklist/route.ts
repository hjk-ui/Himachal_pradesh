import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { buildMaWorklist } from '@/lib/medical/ma-worklist';

export const runtime = 'nodejs';

const MA_ROLES = new Set([
  'MEDICAL_ASSISTANT',
  'PHYSICIAN',
  'MEDICAL_NP',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !MA_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const items = await buildMaWorklist(gate.organizationId);
  return NextResponse.json({ success: true, items });
}
