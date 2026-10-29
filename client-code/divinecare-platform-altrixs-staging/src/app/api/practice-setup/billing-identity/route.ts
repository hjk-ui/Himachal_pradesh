import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getOrgPracticeSetup } from '@/lib/solo/manage';

export const runtime = 'nodejs';

/**
 * Practice billing identity (name, address, phone, NPI) for superbills. The full practice setup
 * (/api/practice-setup: license, availability, booking, payer policy) stays leadership-only; Billing
 * and the other superbill roles only need what prints on the superbill header.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing/superbills')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const result = await getOrgPracticeSetup(gate.organizationId);
  const setup = result?.setup;
  if (!setup?.practiceName) {
    return NextResponse.json({ success: true, practice: null });
  }
  return NextResponse.json({
    success: true,
    practice: {
      practiceName: setup.practiceName,
      practiceAddress: setup.practiceAddress,
      practiceCity: setup.practiceCity,
      practiceState: setup.practiceState,
      practiceZip: setup.practiceZip,
      practicePhone: setup.practicePhone,
      npi: setup.npi,
    },
  });
}
