import { NextResponse } from 'next/server';
import { requireClinicalContext } from '@/lib/clinical/access';
import { canAccessClaims } from '@/lib/billing/claims';
import { clearinghouseOverview, outcomeForOrganization, runWaystarRetrieval, waystarRetrievalAvailable } from '@/lib/billing/waystarInbound';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE = '/dashboard/billing/clearinghouse';

async function gate() {
  const g = await requireClinicalContext(PAGE);
  if (!g.ok) return { error: NextResponse.json({ success: false, error: g.error }, { status: g.status }) };
  if (!canAccessClaims(g.role)) return { error: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  return { g };
}

/** Billing -> Clearinghouse: last retrieval, inbound files by type, ERA review count, remittances, 270/276 files. */
export async function GET() {
  const { g, error } = await gate();
  if (error) return error;
  try {
    const overview = await clearinghouseOverview({ organizationId: g.organizationId, actorUserId: g.userId, actorRole: g.role });
    await writeAuditLog({
      action: 'waystar_clearinghouse_viewed', actorUserId: g.userId, actorRole: g.role, organizationId: g.organizationId,
      resourceType: 'WaystarInbound', resourceId: 'overview',
      metadata: { reviewCount: overview.reviewCount, remittances: overview.remittances.length, awaiting: overview.awaitingAdjudication.length },
    });
    return NextResponse.json({ success: true, ...overview });
  } catch (err) {
    console.error('[waystar-inbound] overview failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load clearinghouse status' }, { status: 500 });
  }
}

/** Runs a retrieval now (same work as the cron job). */
export async function POST() {
  const { g, error } = await gate();
  if (error) return error;
  // Retrieval applies 999 / 277CA / 835 files to claims: billing core only
  if (!canAccessClaims(g.role)) {
    await writeAuditLog({
      action: 'waystar_retrieval_denied', actorUserId: g.userId, actorRole: g.role, organizationId: g.organizationId,
      resourceType: 'WaystarInbound', resourceId: 'retrieval', outcome: 'DENIED', metadata: { reason: 'cannot_mutate_claims' },
    });
    return NextResponse.json({ success: false, error: 'Only billing staff can run a Waystar retrieval' }, { status: 403 });
  }
  if (!waystarRetrievalAvailable()) return NextResponse.json({ success: false, error: 'Waystar SFTP is not active on this server' }, { status: 503 });
  try {
    const out = outcomeForOrganization(await runWaystarRetrieval({ trigger: 'manual', actorUserId: g.userId }), g.organizationId);
    return NextResponse.json({ success: true, ...out });
  } catch (err) {
    console.error('[waystar-inbound] retrieval failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Waystar retrieval failed' }, { status: 502 });
  }
}
