import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { canWriteTmsSpravato, TMS_SPRAVATO_PATH } from '@/lib/ehr/tmsSpravato';

export const runtime = 'nodejs';

const patchSchema = z.object({
  targetSessions: z.number().int().min(1).max(100).optional(),
  screeningJson: z.unknown().optional().nullable(),
  paChecklistJson: z.unknown().optional().nullable(),
  adtTrialsJson: z.unknown().optional().nullable(),
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

    const existing = await prisma.tmsCourse.findFirst({
      where: { id, organizationId: gate.organizationId },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Course not found' }, { status: 404 });
    }

    const course = await prisma.tmsCourse.update({
      where: { id },
      data: {
        ...(body.targetSessions !== undefined ? { targetSessions: body.targetSessions } : {}),
        ...(body.screeningJson !== undefined
          ? { screeningJson: body.screeningJson as object }
          : {}),
        ...(body.paChecklistJson !== undefined
          ? { paChecklistJson: body.paChecklistJson as object }
          : {}),
        ...(body.adtTrialsJson !== undefined
          ? { adtTrialsJson: body.adtTrialsJson as object }
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
      course: {
        id: course.id,
        clientId: course.clientId,
        clientName: course.client.name,
        targetSessions: course.targetSessions,
        screeningJson: course.screeningJson,
        paChecklistJson: course.paChecklistJson,
        adtTrialsJson: course.adtTrialsJson,
        status: course.status,
        sessionCount: course._count.sessions,
        updatedAt: course.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid course update' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not update course' },
      { status: 400 }
    );
  }
}
