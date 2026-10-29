import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { canUseFrontOffice } from '@/lib/frontOffice/access';
import { FO_ITEM_IDS, FO_VISIT_KIND, markProblem, stepIdFor } from '@/lib/frontOffice/rules';
import type { FoItemId } from '@/lib/frontOffice/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESOURCE = 'frontOfficeChecklistItem';

const keySchema = z.object({
  appointmentId: z.string().trim().min(1).max(64),
  itemId: z.enum(FO_ITEM_IDS as [FoItemId, ...FoItemId[]]),
});
const markSchema = keySchema.extend({
  status: z.enum(['done', 'not_applicable', 'deferred']),
  reason: z.string().trim().max(500).nullish(),
});

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

async function findAppointment(req: Request, gate: Gate, appointmentId: string, action: string) {
  const appt = await prisma.appointment.findFirst({
    where: { AND: [appointmentOrgWhere(gate.organizationId), { id: appointmentId }] },
    select: { id: true, clientId: true, status: true, confirmedAt: true },
  });
  if (!appt) {
    await auditPhiAccess({ req, gate, action, resourceType: RESOURCE, resourceId: appointmentId, outcome: 'DENIED', metadata: { reason: 'appointment_not_found' } }).catch(() => {});
  }
  return appt;
}

/**
 * POST /api/appointments/front-office/checklist { appointmentId, itemId, status, reason? }
 * Front desk marks a readiness item done / not applicable / deferred (reason required except for a
 * plain "done"; some items need a note even when done). Stored in visit_checklist_items with
 * visit_kind 'front_office'. Marking "Appointment confirmed" done also records Appointment.confirmedAt
 * (staff confirmation) when the visit is still Scheduled and unconfirmed. Audited UPDATE.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canUseFrontOffice(gate.role)) return NextResponse.json({ success: false, error: 'Your role cannot update front-office checks' }, { status: 403 });
  const parsed = markSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const body = parsed.data;
  const reason = body.reason?.trim() || null;
  const problem = markProblem(body.itemId, body.status, reason);
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });
  const appt = await findAppointment(req, gate, body.appointmentId, 'UPDATE');
  if (!appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });

  const now = new Date();
  const stepId = stepIdFor(body.itemId);
  const data = {
    organizationId: gate.organizationId,
    clientId: appt.clientId,
    visitKind: FO_VISIT_KIND,
    status: body.status,
    reason,
    markedById: gate.userId,
    markedAt: now,
  };
  const row = await prisma.visitChecklistItem.upsert({
    where: { appointmentId_stepId: { appointmentId: appt.id, stepId } },
    create: { ...data, appointmentId: appt.id, stepId, noteId: null },
    update: data,
    select: { id: true },
  });
  let confirmed = false;
  if (body.itemId === 'confirm' && body.status === 'done' && appt.status === 'SCHEDULED' && !appt.confirmedAt) {
    await prisma.appointment.update({ where: { id: appt.id }, data: { confirmedAt: now } });
    confirmed = true;
  }
  await auditPhiAccess({
    req,
    gate,
    action: 'UPDATE',
    resourceType: RESOURCE,
    resourceId: row.id,
    patientId: appt.clientId,
    outcome: 'SUCCESS',
    metadata: { appointmentId: appt.id, itemId: body.itemId, status: body.status, reasonGiven: reason ? 1 : 0, confirmedAt: confirmed ? 1 : 0 },
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { id: row.id, itemId: body.itemId, status: body.status, reason, markedAt: now.toISOString(), confirmed } });
}

/** DELETE ?appointmentId=&itemId= (or JSON body) — remove a front-office mark (the computed status shows again). */
export async function DELETE(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canUseFrontOffice(gate.role)) return NextResponse.json({ success: false, error: 'Your role cannot update front-office checks' }, { status: 403 });
  const url = new URL(req.url);
  const q = { appointmentId: url.searchParams.get('appointmentId') ?? undefined, itemId: url.searchParams.get('itemId') ?? undefined };
  const parsed = keySchema.safeParse(q.appointmentId ? q : await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const key = parsed.data;
  const appt = await findAppointment(req, gate, key.appointmentId, 'DELETE');
  if (!appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
  const removed = (
    await prisma.visitChecklistItem.deleteMany({
      where: { organizationId: gate.organizationId, appointmentId: appt.id, stepId: stepIdFor(key.itemId), visitKind: FO_VISIT_KIND },
    })
  ).count;
  await auditPhiAccess({
    req,
    gate,
    action: 'DELETE',
    resourceType: RESOURCE,
    resourceId: appt.id,
    patientId: appt.clientId,
    outcome: 'SUCCESS',
    metadata: { itemId: key.itemId, removed },
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { removed } });
}
