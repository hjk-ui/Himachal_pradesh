import { NextResponse } from 'next/server';
import { requireClinicalContext } from '@/lib/clinical/access';
import { submitClaim, findSerializedClaim } from '@/lib/billing/clearinghouseClaims';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  try {
    const { id } = await context.params;
    const result = await submitClaim(actor, id);
    return NextResponse.json({ success: true, ...result, claim: await findSerializedClaim(actor, id) });
  } catch (error) { return NextResponse.json({ error: error instanceof ClearinghouseError ? error.message : 'Claim submission could not be confirmed' }, { status: error instanceof ClearinghouseError ? error.status : 502 }); }
}
