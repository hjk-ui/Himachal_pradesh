import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { buildOfficeOpsCounts } from '@/lib/office/ops-counts';

export const runtime = 'nodejs';

const OM_ROLES = new Set([
  'OFFICE_MANAGER',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'BILLING',
]);

export async function GET() {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!OM_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const cards = await buildOfficeOpsCounts(gate.organizationId);
  return NextResponse.json({ success: true, cards });
}
