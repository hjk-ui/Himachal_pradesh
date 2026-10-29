import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canManageAppointmentLabels } from '@/lib/scheduling/appointmentLabelAccess';
import { LABELS_NOT_READY, listOrgLabels, loadValantLabels } from '@/lib/scheduling/appointmentLabelsServer';

export const runtime = 'nodejs';

/** POST — create the Valant labels the org does not have yet (idempotent; existing labels are left alone). */
export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageAppointmentLabels(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const result = await loadValantLabels(gate.organizationId, gate.userId);
    await writeAuditLog({
      action: 'appointment_labels_loaded_valant',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'AppointmentLabel',
      metadata: { created: result.created, skipped: result.skipped },
    });
    const { labels } = await listOrgLabels(gate.organizationId, { includeInactive: true });
    return NextResponse.json({ success: true, ...result, labels });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json({ success: false, error: LABELS_NOT_READY }, { status: 503 });
    }
    console.error('[appointment labels] load valant', err);
    return NextResponse.json({ success: false, error: 'Could not load Valant labels' }, { status: 500 });
  }
}
