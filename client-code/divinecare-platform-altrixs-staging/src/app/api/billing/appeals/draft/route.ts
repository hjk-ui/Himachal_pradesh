import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

/**
 * Retired. This route returned a canned letter labelled as a Bedrock draft, asserted clinical
 * facts it never read from the chart, and filled in a hard-coded NPI / Tax ID and invented
 * defaults (patient, payer, CPT, amount). Appeals are drafted from the denied claim on
 * Billing > Denials (POST /api/billing/denials/appeal).
 */
export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint is retired. Draft appeals from the denied claim (POST /api/billing/denials/appeal).',
      replacement: '/api/billing/denials/appeal',
    },
    { status: 410 }
  );
}
