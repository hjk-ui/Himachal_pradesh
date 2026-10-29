import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import {
  checkWaystarResponses,
  listRecentWaystarBatches,
  waystarSftpMode,
} from '@/lib/billing/waystarSftpSubmit';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
import { requestClaimStatus } from '@/lib/billing/waystarInbound';

export const dynamic = 'force-dynamic';

function actorFrom(gate: { organizationId: string; userId: string; role: Parameters<typeof listRecentWaystarBatches>[0]['actorRole'] }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

function errorResponse(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof ClearinghouseError ? error.message : fallback },
    { status: error instanceof ClearinghouseError ? error.status : 502 }
  );
}

/** Channel status line + this organization's recent Waystar SFTP batches. */
export async function GET() {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const mode = waystarSftpMode();
  try {
    const batches = mode.configured ? await listRecentWaystarBatches(actorFrom(gate)) : [];
    return NextResponse.json({
      success: true,
      active: mode.active,
      configured: mode.configured,
      usageIndicator: mode.usageIndicator,
      statusLine: mode.statusLine,
      configProblems: mode.configProblems,
      batches,
    });
  } catch (error) {
    return errorResponse(error, 'Could not load Waystar batches');
  }
}

const postSchema = z
  .object({ action: z.enum(['check_responses', 'request_status']).default('check_responses'), claimIds: z.array(z.string().min(1).max(128)).max(99).optional() })
  .default({ action: 'check_responses' });

/**
 * "Check Waystar responses" (default): pull new /Download files and apply 999 / 277CA / 277 /
 * 835 / 271 (same run as the cron job). action "request_status": send a 276 for the given claims.
 */
export async function POST(req: Request) {
  const gate = await requireClinicalContext('/dashboard/billing/claims');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const raw = await req.text().catch(() => '');
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(raw ? JSON.parse(raw) : undefined);
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    if (body.action === 'request_status') {
      if (!body.claimIds?.length) return NextResponse.json({ error: 'Select at least one submitted claim' }, { status: 400 });
      const outcome = await requestClaimStatus(actorFrom(gate), body.claimIds);
      return NextResponse.json({ success: true, ...outcome });
    }
    const outcome = await checkWaystarResponses(actorFrom(gate));
    return NextResponse.json({ success: true, ...outcome });
  } catch (error) {
    console.error('[waystar-responses] error:', error instanceof Error ? error.message : error);
    if (!(error instanceof ClearinghouseError) && error instanceof Error && /not active/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return errorResponse(error, body.action === 'request_status' ? 'Could not send the 276 status request' : 'Could not check Waystar responses');
  }
}
