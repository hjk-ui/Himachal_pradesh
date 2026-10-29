import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { saveClaimSubmissionDetails, findSerializedClaim } from '@/lib/billing/clearinghouseClaims';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  try {
    const { id } = await context.params;
    await saveClaimSubmissionDetails(actor, id, await request.json());
    return NextResponse.json({ success: true, claim: await findSerializedClaim(actor, id) });
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? 'Valid payer ID and diagnosis codes are required' : error instanceof ClearinghouseError ? error.message : 'Could not save submission details' }, { status: error instanceof ClearinghouseError ? error.status : 400 }); }
}
