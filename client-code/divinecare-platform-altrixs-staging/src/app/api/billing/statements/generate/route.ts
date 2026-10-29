import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

/**
 * Retired. This endpoint created an eStatement from request values with fabricated defaults
 * ($350 billed, $75 due, patient@altrixs.com) for any organization member. Statements are built
 * from the patient ledger by src/lib/billing/statements.ts (Billing > Statements).
 */
export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  return NextResponse.json(
    { success: false, error: 'Retired: generate statements from Billing > Statements (built from the patient ledger).' },
    { status: 410 }
  );
}
