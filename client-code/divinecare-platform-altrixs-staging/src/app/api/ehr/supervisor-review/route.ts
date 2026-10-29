import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listCosignQueue } from '@/lib/notes/workflow-store';
import { cosignQueueScope } from '@/lib/notes/transitions';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { lockedIdsOrNull, maskLockedRows, PROTECTED_RECORD_LABEL } from '@/lib/privacy/lockedRows';

export const runtime = 'nodejs';

/** GET /api/ehr/supervisor-review — signed notes awaiting this user's co-signature (org-scoped). */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/supervisor-review', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  // Leadership / verified Medical Director: org-wide queue (co-sign of a pre-licensed author is
  // re-checked on co-sign). Psychiatrist: supervisees + own caseload. Others: supervisees only.
  const medicalDirector = verifiedMedicalDirector({ userId: gate.userId, role: gate.role, organizationId: gate.organizationId });
  const scope = cosignQueueScope(gate.role, { medicalDirector });
  const queue = await listCosignQueue({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });
  // 42 CFR Part 2 / VIP clients the reviewer may not open: keep the queue row (so the co-sign is
  // not lost) but blank the note body and alias the name; open the chart (break-glass) to review.
  const locked = await lockedIdsOrNull(gate, queue.map((n) => n.clientId));
  const notes = maskLockedRows(queue, locked, (n) => n.clientId, (n) => ({
    ...n,
    clientName: PROTECTED_RECORD_LABEL,
    body: '',
    protected: true,
  }));

  await auditPhiAccess({
    gate,
    req,
    action: 'LIST',
    resourceType: 'progressNote',
    metadata: { view: 'supervisorReview', scope, count: notes.length, masked: notes.filter((n) => (n as { protected?: boolean }).protected).length },
  });

  return NextResponse.json({
    success: true,
    notes,
    /**
     * 'all' = every pending note in the org; 'supervisees_and_caseload' = this user's supervisees and
     * clients on their caseload; 'supervisees' = only this user's licensure-track supervisees
     */
    scope: scope === 'org' ? 'all' : scope,
  });
}
