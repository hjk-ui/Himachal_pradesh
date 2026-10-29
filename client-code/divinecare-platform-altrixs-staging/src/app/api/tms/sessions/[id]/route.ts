import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';
import { canWriteTmsSpravato, TMS_SPRAVATO_PATH } from '@/lib/ehr/tmsSpravato';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const patchSchema = z.object({
  sessionDate: z.string().min(1).optional(),
  durationMin: z.number().int().min(1).max(180).optional().nullable(),
  targetSite: z.string().trim().max(120).optional().nullable(),
  frequencyHz: z.number().min(0).max(100).optional().nullable(),
  pulses: z.number().int().min(0).max(20000).optional().nullable(),
  sideEffects: z.string().trim().max(2000).optional().nullable(),
  phq9: z.number().int().min(0).max(27).optional().nullable(),
  clinician: z.string().trim().max(160).optional().nullable(),
  motorThresholdPct: z.number().min(1).max(150).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  attendance: z.enum(['attended', 'no_show', 'cancelled', 'held']).optional().nullable(),
  suicidalIdeation: z.boolean().optional().nullable(),
});

async function findOwnedSession(
  id: string,
  gate: { organizationId: string; userId: string; role: Role },
) {
  return prisma.tmsSession.findFirst({
    where: { id, course: { organizationId: gate.organizationId, client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) } },
    include: { course: { select: { clientId: true } } },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canWriteTmsSpravato(gate.role) || !canAccessPath(gate.role, TMS_SPRAVATO_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const existing = await findOwnedSession(id, gate);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const session = await prisma.tmsSession.update({
      where: { id },
      data: {
        ...(body.sessionDate !== undefined ? { sessionDate: new Date(body.sessionDate) } : {}),
        ...(body.durationMin !== undefined ? { durationMin: body.durationMin } : {}),
        ...(body.targetSite !== undefined ? { targetSite: body.targetSite } : {}),
        ...(body.frequencyHz !== undefined ? { frequencyHz: body.frequencyHz } : {}),
        ...(body.pulses !== undefined ? { pulses: body.pulses } : {}),
        ...(body.sideEffects !== undefined ? { sideEffects: body.sideEffects } : {}),
        ...(body.phq9 !== undefined ? { phq9: body.phq9 } : {}),
        ...(body.clinician !== undefined ? { clinician: body.clinician } : {}),
        ...(body.motorThresholdPct !== undefined ? { motorThresholdPct: body.motorThresholdPct } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.attendance !== undefined ? { attendance: body.attendance } : {}),
        ...(body.suicidalIdeation !== undefined ? { suicidalIdeation: body.suicidalIdeation } : {}),
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'tmsSession',
      resourceId: session.id,
      patientId: existing.course.clientId,
      metadata: { fields: Object.keys(body) },
    });

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        courseId: session.courseId,
        sessionDate: session.sessionDate.toISOString(),
        durationMin: session.durationMin,
        targetSite: session.targetSite,
        frequencyHz: session.frequencyHz,
        pulses: session.pulses,
        sideEffects: session.sideEffects,
        phq9: session.phq9,
        clinician: session.clinician,
        motorThresholdPct: session.motorThresholdPct,
        notes: session.notes,
        attendance: session.attendance,
        suicidalIdeation: session.suicidalIdeation,
        updatedAt: session.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid session update' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not update session' },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canWriteTmsSpravato(gate.role) || !canAccessPath(gate.role, TMS_SPRAVATO_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const existing = await findOwnedSession(id, gate);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    await prisma.tmsSession.delete({ where: { id } });
    await auditPhiAccess({
      gate,
      req,
      action: 'DELETE',
      resourceType: 'tmsSession',
      resourceId: id,
      patientId: existing.course.clientId,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[tms/sessions DELETE]', err);
    return NextResponse.json(
      { success: false, error: 'Could not delete session' },
      { status: 500 }
    );
  }
}
