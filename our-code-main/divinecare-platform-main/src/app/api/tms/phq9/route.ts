import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import {
  canReadTmsSpravato,
  canWriteTmsSpravato,
  TMS_SPRAVATO_PATH,
} from '@/lib/ehr/tmsSpravato';

export const runtime = 'nodejs';

const createSchema = z.object({
  courseId: z.string().min(1),
  milestone: z.enum(['baseline', '10', '15', '20', '25', '36', 'custom']),
  score: z.number().int().min(0).max(27),
  gad7Score: z.number().int().min(0).max(21).optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadTmsSpravato(gate.role) || !canAccessPath(gate.role, TMS_SPRAVATO_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const courseId = new URL(req.url).searchParams.get('courseId');
  if (!courseId) {
    return NextResponse.json({ success: false, error: 'courseId required' }, { status: 400 });
  }

  try {
    const course = await prisma.tmsCourse.findFirst({
      where: { id: courseId, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json({ success: false, error: 'Course not found' }, { status: 404 });
    }

    const scores = await prisma.tmsPhq9.findMany({
      where: { courseId },
      orderBy: { recordedAt: 'asc' },
    });

    return NextResponse.json({
      success: true,
      scores: scores.map((s) => ({
        id: s.id,
        courseId: s.courseId,
        milestone: s.milestone,
        score: s.score,
        gad7Score: s.gad7Score,
        recordedAt: s.recordedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[tms/phq9 GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load PHQ-9 scores' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canWriteTmsSpravato(gate.role) || !canAccessPath(gate.role, TMS_SPRAVATO_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const course = await prisma.tmsCourse.findFirst({
      where: { id: body.courseId, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json({ success: false, error: 'Course not found' }, { status: 404 });
    }

    const row = await prisma.tmsPhq9.create({
      data: {
        courseId: body.courseId,
        milestone: body.milestone,
        score: body.score,
        gad7Score: body.gad7Score ?? null,
      },
    });

    return NextResponse.json(
      {
        success: true,
        score: {
          id: row.id,
          courseId: row.courseId,
          milestone: row.milestone,
          score: row.score,
          gad7Score: row.gad7Score,
          recordedAt: row.recordedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid PHQ-9 payload' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not save PHQ-9' },
      { status: 400 }
    );
  }
}
