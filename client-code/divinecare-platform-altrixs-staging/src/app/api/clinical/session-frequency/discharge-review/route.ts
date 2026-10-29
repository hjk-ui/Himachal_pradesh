import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';
import { getModuleSnapshot, ModuleConflictError, saveModuleSnapshot } from '@/lib/modules/manage';
import { canUseClinicModule } from '@/lib/modules/access';
import { createBlankDischarge } from '@/features/ehr/dischargeData';
import { DISCHARGE_REVIEW_REASON, planDischargeReviews } from '@/lib/clinical/dischargeReview';

export const runtime = 'nodejs';

const MODULE = 'ehr-discharge-cases';
const bodySchema = z.object({ clientIds: z.array(z.string().min(1).max(64)).max(500).optional() });

/**
 * POST /api/clinical/session-frequency/discharge-review — "Mark inactive / discharge review" for
 * the "Overdue more than 180 days — likely inactive" group. Opens a discharge case in planning
 * (the existing Discharge & Transition Planning flow) for each likely-inactive client in the
 * caller's scope that has no open case. Nothing is discharged: the clinician completes or closes
 * the review on /dashboard/ehr/discharge. Protected records the caller cannot open are skipped.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseClinicModule(gate.role, MODULE, gate.capabilities)) {
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'dischargeReview', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Your role cannot start discharge reviews' }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  try {
    const { items } = await loadSessionFrequency(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role },
      {},
      new Date()
    );
    const snapshot = await getModuleSnapshot(gate.organizationId, MODULE);
    const plan = planDischargeReviews({ items, existingCases: snapshot.data, requested: parsed.data.clientIds });
    if (!plan.start.length) {
      return NextResponse.json({ success: true, started: 0, alreadyOpen: plan.alreadyOpen.length, skippedProtected: plan.skippedProtected });
    }
    const stamp = Date.now().toString(36);
    const created = plan.start.map((i, n) =>
      createBlankDischarge({
        id: `ehr-dc-${stamp}-${n}`,
        clientId: i.clientId,
        clientName: i.clientName,
        clinician: i.assignedToName ?? '',
        reason: DISCHARGE_REVIEW_REASON,
      })
    );
    const existing = Array.isArray(snapshot.data) ? snapshot.data : [];
    await saveModuleSnapshot(gate.organizationId, MODULE, [...created, ...existing], snapshot.version);
    for (const i of plan.start) {
      await writeAuditLog({
        action: 'DISCHARGE_REVIEW_STARTED',
        actorUserId: gate.userId,
        actorRole: String(gate.role),
        organizationId: gate.organizationId,
        resourceType: 'ClinicModuleState',
        resourceId: MODULE,
        patientId: i.clientId,
        metadata: { source: 'session-frequency', reason: 'likely_inactive_180d', lastContact: i.lastContact ?? null },
      });
    }
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'dischargeReview',
      metadata: { started: plan.start.length, alreadyOpen: plan.alreadyOpen.length, skippedProtected: plan.skippedProtected },
    });
    return NextResponse.json({ success: true, started: plan.start.length, alreadyOpen: plan.alreadyOpen.length, skippedProtected: plan.skippedProtected });
  } catch (err) {
    if (err instanceof ModuleConflictError) {
      return NextResponse.json({ success: false, error: 'Discharge cases were just changed by someone else. Try again.' }, { status: 409 });
    }
    console.error('[session-frequency discharge-review POST]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not start the discharge reviews' }, { status: 500 });
  }
}
