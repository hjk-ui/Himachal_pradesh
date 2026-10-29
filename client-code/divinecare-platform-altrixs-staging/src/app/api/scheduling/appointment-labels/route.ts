import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canManageAppointmentLabels, canReadAppointmentLabels } from '@/lib/scheduling/appointmentLabelAccess';
import { labelCollectionPutSchema, labelCreateSchema } from '@/lib/scheduling/appointmentLabels';
import {
  createLabel,
  getLabelSettings,
  hasAppointmentLabelColumn,
  LABELS_NOT_READY,
  listOrgLabels,
  reorderLabels,
  setAutoApplySuggested,
  applySuggestedLabelsToExisting,
} from '@/lib/scheduling/appointmentLabelsServer';

export const runtime = 'nodejs';

/** GET ?all=1 (label admins) includes turned-off labels. */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canReadAppointmentLabels(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const canManage = canManageAppointmentLabels(gate.role);
  const all = new URL(req.url).searchParams.get('all') === '1' && canManage;
  const [{ ready, labels }, settings, column] = await Promise.all([
    listOrgLabels(gate.organizationId, { includeInactive: all }),
    getLabelSettings(gate.organizationId),
    hasAppointmentLabelColumn(),
  ]);
  return NextResponse.json({
    success: true,
    ready: ready && column,
    labels,
    autoApplySuggested: settings.autoApplySuggested,
    canManage,
  });
}

/** POST — add a practice-defined label. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageAppointmentLabels(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = labelCreateSchema.parse(await req.json());
    const result = await createLabel(gate.organizationId, gate.userId, { ...body, color: String(body.color) });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await writeAuditLog({
      action: 'appointment_label_created',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'AppointmentLabel',
      resourceId: result.label.id,
      metadata: { name: result.label.name, color: result.label.color, availability: result.label.availability },
    });
    return NextResponse.json({ success: true, label: result.label }, { status: 201 });
  } catch (err) {
    return labelError(err, 'Could not add label');
  }
}

/** PUT { order?: id[], autoApplySuggested?: boolean } */
export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageAppointmentLabels(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = labelCollectionPutSchema.parse(await req.json());
    let reordered: number | null = null;
    if (body.order) reordered = await reorderLabels(gate.organizationId, body.order, gate.userId);
    let applied: Awaited<ReturnType<typeof applySuggestedLabelsToExisting>> | null = null;
    if (body.autoApplySuggested !== undefined) {
      await setAutoApplySuggested(gate.organizationId, body.autoApplySuggested, gate.userId);
      // Turning auto-apply on also labels the calendar already on screen (blanks only)
      if (body.autoApplySuggested) applied = await applySuggestedLabelsToExisting(gate.organizationId);
    }
    await writeAuditLog({
      action: 'appointment_labels_updated',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'AppointmentLabel',
      metadata: { reordered, autoApplySuggested: body.autoApplySuggested ?? null, applied },
    });
    const [{ labels }, settings] = await Promise.all([
      listOrgLabels(gate.organizationId, { includeInactive: true }),
      getLabelSettings(gate.organizationId),
    ]);
    return NextResponse.json({ success: true, labels, autoApplySuggested: settings.autoApplySuggested, applied });
  } catch (err) {
    return labelError(err, 'Could not save labels');
  }
}

function labelError(err: unknown, fallback: string) {
  const code = (err as { code?: string })?.code;
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ success: false, error: LABELS_NOT_READY }, { status: 503 });
  }
  const message =
    err instanceof z.ZodError
      ? err.issues[0]?.message || 'Please check the label'
      : err instanceof Error
        ? err.message
        : fallback;
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}
