import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { updateAppointment } from '@/lib/appointments/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import {
  evaluateCheckinConsentSoftStop,
  isCheckInStatus,
} from '@/lib/consents/checkin-soft-stop';

export const runtime = 'nodejs';

const visitEnum = z.enum([
  'scheduled',
  'checked-in',
  'in-session',
  'completed',
  'cancelled',
  'no-show',
  'late-cancel',
  'SCHEDULED',
  'CHECKED_IN',
  'IN_SESSION',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'LATE_CANCEL',
]);

const noteEnum = z.enum([
  'not-started',
  'ai-draft',
  'in-progress',
  'signed',
  'NOT_STARTED',
  'AI_DRAFT',
  'IN_PROGRESS',
  'SIGNED',
]);

const patchSchema = z.object({
  action: z.enum(['confirm', 'decline']).optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
  status: visitEnum.optional().nullable(),
  visitStatus: visitEnum.optional().nullable(),
  noteStatus: noteEnum.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  /** ≥10 chars required to soft-override missing consents at check-in */
  consentOverrideReason: z.string().max(1000).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to update appointments' },
      { status: 403 }
    );
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());

    const nextStatus = body.status || body.visitStatus;
    if (isCheckInStatus(nextStatus)) {
      const { prisma } = await import('@/lib/db/prisma');
      const appt = await prisma.appointment.findFirst({
        where: { id, organizationId: gate.organizationId },
        select: { clientId: true, isVirtual: true },
      });
      if (appt) {
        const soft = await evaluateCheckinConsentSoftStop({
          organizationId: gate.organizationId,
          clientId: appt.clientId,
          isVirtual: appt.isVirtual,
          overrideReason: body.consentOverrideReason || body.reason,
          actorUserId: gate.userId,
        });
        if (soft.ok === false) {
          return NextResponse.json(
            {
              success: false,
              error: soft.error,
              code: soft.code,
              missing: soft.missing,
            },
            { status: 409 }
          );
        }
      }
    }

    const result = await updateAppointment(id, body, {
      id: gate.userId,
      role: gate.role,
      organizationId: gate.organizationId,
    });
    if (result.ok === false) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, appointment: result.appointment });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not update appointment';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
