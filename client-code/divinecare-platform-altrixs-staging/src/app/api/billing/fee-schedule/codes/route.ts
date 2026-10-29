import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { CLINIC_ROLES } from '@/types/roles';
import { feeScheduleCptCodes } from '@/lib/billing/feeScheduleDb';

export const runtime = 'nodejs';

/**
 * GET /api/billing/fee-schedule/codes — base CPT/HCPCS codes in the org fee schedule, for CPT
 * pick lists (claim form, coding, note signing). Any staff role; not PHI.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!(CLINIC_ROLES as readonly string[]).includes(String(gate.role))) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const codes = await feeScheduleCptCodes(gate.organizationId);
  return NextResponse.json({ success: true, codes });
}
