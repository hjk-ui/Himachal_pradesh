import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { submitClaim } from '@/lib/billing/clearinghouseClaims';
import { submitClaimsViaWaystarSftp, waystarSftpMode } from '@/lib/billing/waystarSftpSubmit';
import { claimClearinghouseMode } from '@/lib/integrations/waystar';
import { clearinghouseMode, ClearinghouseError } from '@/lib/integrations/clearinghouse';
const batchSchema = z.object({ claimIds: z.array(z.string().min(1)).min(1).max(50), dryRun: z.boolean().optional() }).refine(body => new Set(body.claimIds).size === body.claimIds.length);
export async function GET() {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sftp = waystarSftpMode();
  if (sftp.active) {
    return NextResponse.json({
      success: true,
      mode: 'configured',
      claimCh: 'waystar_sftp',
      demoMode: false,
      submitReady: sftp.configProblems.length === 0,
      waystarSftp: { active: true, usageIndicator: sftp.usageIndicator, statusLine: sftp.statusLine, configProblems: sftp.configProblems },
    });
  }
  const mode = claimClearinghouseMode();
  // Preserve legacy `mode` values used by ClaimsClearinghousePanel
  const legacyMode = mode.demoMode ? 'demo' : mode.claimCh === 'demo' ? 'demo' : 'configured';
  // Mirrors the endpoint checks submitClaim makes, so the UI never overstates readiness
  const submitReady = mode.demoMode
    || (mode.claimCh === 'waystar' && Boolean(process.env.WAYSTAR_CLIENT_SECRET && process.env.WAYSTAR_TOKEN_URL && process.env.WAYSTAR_CLAIMS_URL))
    || (mode.claimCh === 'availity' && clearinghouseMode('Availity', 'claims') === 'configured');
  return NextResponse.json({
    success: true,
    mode: legacyMode,
    claimCh: mode.claimCh,
    demoMode: mode.demoMode,
    submitReady,
    waystarEnabled: mode.waystarEnabled,
    availityEnabled: mode.availityEnabled,
    waystarSftp: { active: false, statusLine: sftp.statusLine },
  });
}
export async function POST(request: Request) {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Select between 1 and 50 distinct claims' }, { status: 400 });
  const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  if (waystarSftpMode().active) {
    // Waystar SFTP: every claim that passes the pre-send checks goes out in ONE 837 batch
    try {
      const outcome = await submitClaimsViaWaystarSftp(actor, parsed.data.claimIds, { dryRun: parsed.data.dryRun });
      return NextResponse.json({ success: true, ...outcome });
    } catch (error) {
      return NextResponse.json({ error: error instanceof ClearinghouseError ? error.message : 'Claim batch could not be sent' }, { status: error instanceof ClearinghouseError ? error.status : 502 });
    }
  }
  if (parsed.data.dryRun) return NextResponse.json({ error: 'Pre-send checks are available for Waystar SFTP only' }, { status: 400 });
  const results = [];
  for (const id of parsed.data.claimIds) {
    try { results.push(await submitClaim(actor, id)); }
    catch (error) { results.push({ claimId: id, success: false, error: error instanceof Error ? error.message : 'Submission failed' }); }
  }
  return NextResponse.json({ success: true, results });
}
