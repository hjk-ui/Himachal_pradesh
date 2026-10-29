import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canManageAppointmentLabels } from '@/lib/scheduling/appointmentLabelAccess';
import { applySuggestedLabelsToExisting, BACKFILL_DAYS_BACK, LABELS_NOT_READY } from '@/lib/scheduling/appointmentLabelsServer';

export const runtime = 'nodejs';

/**
 * POST — apply the suggested label to unlabeled appointments already on the calendar
 * (last 90 days + upcoming). Labels someone chose are never changed.
 */
export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageAppointmentLabels(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const result = await applySuggestedLabelsToExisting(gate.organizationId);
    await writeAuditLog({
      action: 'appointment_labels_applied_existing',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'AppointmentLabel',
      metadata: { ...result, daysBack: BACKFILL_DAYS_BACK },
    });
    return NextResponse.json({ success: true, ...result, daysBack: BACKFILL_DAYS_BACK });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json({ success: false, error: LABELS_NOT_READY }, { status: 503 });
    }
    console.error('[appointment labels] apply existing', err);
    return NextResponse.json({ success: false, error: 'Could not apply labels' }, { status: 500 });
  }
}
