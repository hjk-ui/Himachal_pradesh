import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { submitClaim } from '@/lib/billing/clearinghouseClaims';
import { claimClearinghouseMode } from '@/lib/integrations/waystar';
const batchSchema = z.object({ claimIds: z.array(z.string().min(1)).min(1).max(50) }).refine(body => new Set(body.claimIds).size === body.claimIds.length);
export async function GET() {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const mode = claimClearinghouseMode();
  // Preserve legacy `mode` values used by ClaimsClearinghousePanel
  const legacyMode = mode.demoMode ? 'demo' : mode.claimCh === 'demo' ? 'demo' : 'configured';
  return NextResponse.json({
    success: true,
    mode: legacyMode,
    claimCh: mode.claimCh,
    demoMode: mode.demoMode,
    waystarEnabled: mode.waystarEnabled,
    availityEnabled: mode.availityEnabled,
  });
}
export async function POST(request: Request) {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Select between 1 and 50 distinct claims' }, { status: 400 });
  const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  const results = [];
  for (const id of parsed.data.claimIds) {
    try { results.push(await submitClaim(actor, id)); }
    catch (error) { results.push({ claimId: id, success: false, error: error instanceof Error ? error.message : 'Submission failed' }); }
  }
  return NextResponse.json({ success: true, results });
}
