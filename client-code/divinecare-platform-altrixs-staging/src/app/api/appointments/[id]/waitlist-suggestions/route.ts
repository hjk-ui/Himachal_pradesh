import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { suggestWaitlistForCancelled } from '@/lib/scheduling/waitlistSuggest';

export const runtime = 'nodejs';

/**
 * GET /api/appointments/[id]/waitlist-suggestions — after a cancel / late cancel: waitlist entries
 * that could take the freed time. Suggestion only (nothing is booked or sent).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const appt = await prisma.appointment.findFirst({
    where: { id, status: { in: ['CANCELLED', 'LATE_CANCEL'] }, AND: [appointmentOrgWhere(gate.organizationId)] },
    select: { id: true },
  });
  if (!appt) return NextResponse.json({ success: true, suggestions: [] });
  const suggestions = await suggestWaitlistForCancelled(gate.organizationId, [appt.id]);
  await auditPhiAccess({
    gate,
    req,
    action: 'LIST',
    resourceType: 'waitlist_suggestion',
    resourceId: appt.id,
    metadata: { count: suggestions.length, entryIds: suggestions.map((s) => s.entryId) },
  });
  return NextResponse.json({ success: true, suggestions });
}
