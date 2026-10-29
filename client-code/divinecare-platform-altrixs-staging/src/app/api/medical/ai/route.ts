import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

/**
 * Legacy catch-all medical AI endpoint. It never called a model (it returned template text labeled
 * as Bedrock output), so it now answers 501. Use /api/medical/ai/bedrock-soap and
 * /api/medical/ai/comprehend, which call the real services or answer 503.
 */
export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/ai')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(
    { success: false, error: 'Not implemented — use the SOAP drafting or Comprehend tools on the Medical AI page.' },
    { status: 501 }
  );
}
