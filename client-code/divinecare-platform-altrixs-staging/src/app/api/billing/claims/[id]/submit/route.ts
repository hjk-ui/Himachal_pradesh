import { NextResponse } from 'next/server';
import { requireClinicalContext } from '@/lib/clinical/access';
import { submitClaim, findSerializedClaim } from '@/lib/billing/clearinghouseClaims';
import { submitClaimsViaWaystarSftp, waystarSftpMode } from '@/lib/billing/waystarSftpSubmit';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  try {
    const { id } = await context.params;
    if (waystarSftpMode().active) {
      // Waystar SFTP: a single claim goes out as a one-claim 837 batch
      const outcome = await submitClaimsViaWaystarSftp(actor, [id]);
      const result = outcome.results[0];
      const claim = await findSerializedClaim(actor, id);
      if (!result?.success) {
        return NextResponse.json({ success: false, error: result?.error || 'Claim was not sent', errors: result?.errors ?? [], claim }, { status: 400 });
      }
      return NextResponse.json({ success: true, demoMode: false, channel: outcome.channel, usageIndicator: outcome.usageIndicator, batch: outcome.batch, claim });
    }
    const result = await submitClaim(actor, id);
    return NextResponse.json({ success: true, ...result, claim: await findSerializedClaim(actor, id) });
  } catch (error) { return NextResponse.json({ error: error instanceof ClearinghouseError ? error.message : 'Claim submission could not be confirmed' }, { status: error instanceof ClearinghouseError ? error.status : 502 }); }
}
