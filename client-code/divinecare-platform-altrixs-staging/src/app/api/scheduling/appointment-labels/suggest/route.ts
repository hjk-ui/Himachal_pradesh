import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canSetAppointmentLabel } from '@/lib/scheduling/appointmentLabelAccess';
import { suggestForNewAppointment } from '@/lib/scheduling/appointmentLabelsServer';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';

export const runtime = 'nodejs';

/** GET ?clientId=&isVirtual=1 — label suggestions for an appointment being booked (shown as chips, never applied). */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canSetAppointmentLabel(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const clientId = (url.searchParams.get('clientId') || '').slice(0, 128);
  const isVirtual = url.searchParams.get('isVirtual') === '1';
  if (!clientId) return NextResponse.json({ success: true, suggestions: isVirtual ? ['tele'] : [] });

  const client = await prisma.client.findFirst({
    where: clientByIdWhere(clientId, gate.organizationId),
    select: { id: true, importedAt: true, assignedToId: true },
  });
  if (!client || !(await caseloadAllows({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, client))) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }
  try {
    const suggestions = await suggestForNewAppointment(gate.organizationId, client, isVirtual);
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'appointment_label_suggestion',
      resourceId: clientId,
      patientId: clientId,
      metadata: { suggestions },
    });
    return NextResponse.json({ success: true, suggestions });
  } catch (err) {
    console.error('[appointment labels] suggest', err);
    return NextResponse.json({ success: true, suggestions: [] });
  }
}
