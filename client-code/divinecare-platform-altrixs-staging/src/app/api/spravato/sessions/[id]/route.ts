import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';
import { canWriteTmsSpravato, TMS_SPRAVATO_PATH } from '@/lib/ehr/tmsSpravato';
import { shouldWithholdDose } from '@/features/ehr/tmsSpravatoConstants';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const patchSchema = z.object({
  sessionDate: z.string().min(1).optional(),
  doseMg: z.number().min(0).max(200).optional().nullable(),
  vitalsJson: z.unknown().optional().nullable(),
  moaas: z.number().int().min(0).max(5).optional().nullable(),
  cadssItemsJson: z.array(z.number().int().min(0).max(4)).max(5).optional().nullable(),
  cadssTotal: z.number().int().min(0).max(20).optional().nullable(),
  withheld: z.boolean().optional(),
  clinician: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  otherSideEffects: z.string().trim().max(4000).optional().nullable(),
  phq9: z.number().int().min(0).max(27).optional().nullable(),
});

async function findOwnedSession(
  id: string,
  gate: { organizationId: string; userId: string; role: Role },
) {
  return prisma.spravatoSession.findFirst({
    where: { id, enrollment: { organizationId: gate.organizationId, client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) } },
    include: { enrollment: { select: { clientId: true } } },
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

    let withheld = body.withheld;
    if (body.vitalsJson && withheld === undefined) {
      withheld = shouldWithholdDose(
        body.vitalsJson as Record<string, { sbp?: number; dbp?: number; bp?: string }>
      );
    }
    const cadssTotal =
      body.cadssTotal ??
      (body.cadssItemsJson ? body.cadssItemsJson.reduce((a, b) => a + b, 0) : undefined);

    const session = await prisma.spravatoSession.update({
      where: { id },
      data: {
        ...(body.sessionDate !== undefined ? { sessionDate: new Date(body.sessionDate) } : {}),
        ...(body.doseMg !== undefined ? { doseMg: body.doseMg } : {}),
        ...(body.vitalsJson !== undefined ? { vitalsJson: body.vitalsJson as object } : {}),
        ...(body.moaas !== undefined ? { moaas: body.moaas } : {}),
        ...(body.cadssItemsJson !== undefined
          ? { cadssItemsJson: body.cadssItemsJson as object }
          : {}),
        ...(cadssTotal !== undefined ? { cadssTotal } : {}),
        ...(withheld !== undefined ? { withheld } : {}),
        ...(body.clinician !== undefined ? { clinician: body.clinician } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.otherSideEffects !== undefined
          ? { otherSideEffects: body.otherSideEffects }
          : {}),
        ...(body.phq9 !== undefined ? { phq9: body.phq9 } : {}),
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'spravatoSession',
      resourceId: session.id,
      patientId: existing.enrollment.clientId,
      metadata: { fields: Object.keys(body) },
    });

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        enrollmentId: session.enrollmentId,
        sessionDate: session.sessionDate.toISOString(),
        doseMg: session.doseMg,
        vitalsJson: session.vitalsJson,
        moaas: session.moaas,
        cadssItemsJson: session.cadssItemsJson,
        cadssTotal: session.cadssTotal,
        withheld: session.withheld,
        clinician: session.clinician,
        notes: session.notes,
        otherSideEffects: session.otherSideEffects,
        phq9: session.phq9,
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
