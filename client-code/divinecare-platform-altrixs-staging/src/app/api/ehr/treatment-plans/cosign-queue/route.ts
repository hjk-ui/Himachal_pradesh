import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessTreatmentPlans } from '@/lib/ehr/treatmentPlans';
import { listPlansAwaitingCosign } from '@/lib/ehr/therapy/planStore';
import { lockedIdsOrNull, maskLockedRows, PROTECTED_RECORD_LABEL } from '@/lib/privacy/lockedRows';

export const runtime = 'nodejs';

/** GET: treatment plans by pre-licensed clinicians waiting for this supervisor's signature. */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const queue = await listPlansAwaitingCosign({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
    // 42 CFR Part 2 / VIP clients the reviewer may not open: keep the row (the co-sign is not lost), alias the name
    const locked = await lockedIdsOrNull(gate, queue.map((p) => p.clientId));
    const plans = maskLockedRows(queue, locked, (p) => p.clientId, (p) => ({ ...p, clientName: PROTECTED_RECORD_LABEL, title: PROTECTED_RECORD_LABEL, protected: true }));
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'treatmentPlan', metadata: { purpose: 'plan_cosign_queue', count: plans.length } });
    return NextResponse.json({ success: true, plans }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[treatment-plans cosign-queue GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load plans awaiting co-signature' }, { status: 500 });
  }
}
