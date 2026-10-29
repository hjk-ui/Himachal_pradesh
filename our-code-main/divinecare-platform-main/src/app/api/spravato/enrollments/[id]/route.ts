import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { canWriteTmsSpravato, TMS_SPRAVATO_PATH } from '@/lib/ehr/tmsSpravato';

export const runtime = 'nodejs';

const patchSchema = z.object({
  remsId: z.string().trim().max(80).optional().nullable(),
  enrolledAt: z.string().optional().nullable(),
  phase: z.enum(['induction', 'maint1', 'maint2']).optional(),
  doseCount: z.number().int().min(0).max(500).optional(),
  remsChecklistJson: z.unknown().optional().nullable(),
  paChecklistJson: z.unknown().optional().nullable(),
  status: z.string().trim().max(40).optional(),
});

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

    const existing = await prisma.spravatoEnrollment.findFirst({
      where: { id, organizationId: gate.organizationId },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Enrollment not found' }, { status: 404 });
    }

    const enrollment = await prisma.spravatoEnrollment.update({
      where: { id },
      data: {
        ...(body.remsId !== undefined ? { remsId: body.remsId } : {}),
        ...(body.enrolledAt !== undefined
          ? { enrolledAt: body.enrolledAt ? new Date(body.enrolledAt) : null }
          : {}),
        ...(body.phase !== undefined ? { phase: body.phase } : {}),
        ...(body.doseCount !== undefined ? { doseCount: body.doseCount } : {}),
        ...(body.remsChecklistJson !== undefined
          ? { remsChecklistJson: body.remsChecklistJson as object }
          : {}),
        ...(body.paChecklistJson !== undefined
          ? { paChecklistJson: body.paChecklistJson as object }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { sessions: true } },
      },
    });

    return NextResponse.json({
      success: true,
      enrollment: {
        id: enrollment.id,
        clientId: enrollment.clientId,
        clientName: enrollment.client.name,
        remsId: enrollment.remsId,
        enrolledAt: enrollment.enrolledAt?.toISOString() ?? null,
        phase: enrollment.phase,
        doseCount: enrollment.doseCount,
        remsChecklistJson: enrollment.remsChecklistJson,
        paChecklistJson: enrollment.paChecklistJson,
        status: enrollment.status,
        sessionCount: enrollment._count.sessions,
        updatedAt: enrollment.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError ? 'Invalid enrollment update' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not update enrollment' },
      { status: 400 }
    );
  }
}
