import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { canAccessClaims, canMutateClaims } from '@/lib/billing/claims';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { EraPostingError, dismissEraClaimPayment, listEraReview, postEraClaimPayment } from '@/lib/billing/waystarInbound';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE = '/dashboard/billing/clearinghouse';

/** ERA review queue: 835 claim payments that could not be auto-posted (and, with ?all=1, resolved ones). */
export async function GET(req: Request) {
  const gate = await requireClinicalContext(PAGE);
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessClaims(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const all = new URL(req.url).searchParams.get('all') === '1';
    const items = await listEraReview(gate.organizationId, { includeResolved: all });
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'eraReview',
      metadata: { count: items.length, includeResolved: all, eraClaimIds: items.map((i) => i.id).slice(0, 50) },
    });
    return NextResponse.json({ success: true, items });
  } catch (err) {
    console.error('[era-review] list failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load the ERA review queue' }, { status: 500 });
  }
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('post'), id: z.string().uuid(), claimId: z.string().min(1).max(128).optional(), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('dismiss'), id: z.string().uuid(), note: z.string().trim().min(3).max(500) }),
]);

/** Staff post a review line to a claim (optionally choosing the claim) or dismiss it with a note. */
export async function POST(req: Request) {
  const gate = await requireClinicalContext(PAGE);
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canMutateClaims(gate.role)) return NextResponse.json({ success: false, error: 'Only billing staff can post remittances' }, { status: 403 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  try {
    if (body.action === 'dismiss') {
      await dismissEraClaimPayment(body.id, { actorUserId: gate.userId, organizationId: gate.organizationId, note: body.note });
      return NextResponse.json({ success: true, dismissed: body.id });
    }
    const posted = await postEraClaimPayment(body.id, {
      actorUserId: gate.userId, organizationId: gate.organizationId, manual: true, claimId: body.claimId, note: body.note, trigger: 'era-review',
    });
    return NextResponse.json({ success: true, posted });
  } catch (err) {
    if (err instanceof EraPostingError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[era-review] action failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not update the remittance line' }, { status: 500 });
  }
}
