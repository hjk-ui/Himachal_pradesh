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

const upsertSchema = z.object({
  clientId: z.string().min(1).max(128),
  targetSessions: z.number().int().min(1).max(100).optional().default(36),
  screeningJson: z.unknown().optional().nullable(),
  paChecklistJson: z.unknown().optional().nullable(),
  adtTrialsJson: z.unknown().optional().nullable(),
  status: z.string().trim().max(40).optional(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadTmsSpravato(gate.role) || !canAccessPath(gate.role, TMS_SPRAVATO_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const courses = await prisma.tmsCourse.findMany({
      where: { organizationId: gate.organizationId },
      include: {
        client: { select: { id: true, name: true } },
        sessions: { select: { id: true }, orderBy: { sessionDate: 'asc' } },
        phq9Scores: { orderBy: { recordedAt: 'asc' } },
        _count: { select: { sessions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      courses: courses.map((c) => ({
        id: c.id,
        organizationId: c.organizationId,
        clientId: c.clientId,
        clientName: c.client.name,
        targetSessions: c.targetSessions,
        screeningJson: c.screeningJson,
        paChecklistJson: c.paChecklistJson,
        adtTrialsJson: c.adtTrialsJson,
        status: c.status,
        sessionCount: c._count.sessions,
        phq9Scores: c.phq9Scores.map((p) => ({
          id: p.id,
          milestone: p.milestone,
          score: p.score,
          gad7Score: p.gad7Score,
          recordedAt: p.recordedAt.toISOString(),
        })),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[tms/courses GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load TMS courses' },
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
    const body = upsertSchema.parse(await req.json());

    const client = await prisma.client.findFirst({
      where: { id: body.clientId, organizationId: gate.organizationId },
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const existing = await prisma.tmsCourse.findFirst({
      where: {
        organizationId: gate.organizationId,
        clientId: body.clientId,
        status: { not: 'archived' },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const data = {
      targetSessions: body.targetSessions ?? 36,
      ...(body.screeningJson !== undefined ? { screeningJson: body.screeningJson as object } : {}),
      ...(body.paChecklistJson !== undefined
        ? { paChecklistJson: body.paChecklistJson as object }
        : {}),
      ...(body.adtTrialsJson !== undefined ? { adtTrialsJson: body.adtTrialsJson as object } : {}),
      ...(body.status ? { status: body.status } : {}),
    };

    const course = existing
      ? await prisma.tmsCourse.update({
          where: { id: existing.id },
          data,
          include: { client: { select: { id: true, name: true } }, _count: { select: { sessions: true } } },
        })
      : await prisma.tmsCourse.create({
          data: {
            organizationId: gate.organizationId,
            clientId: body.clientId,
            ...data,
          },
          include: { client: { select: { id: true, name: true } }, _count: { select: { sessions: true } } },
        });

    return NextResponse.json(
      {
        success: true,
        course: {
          id: course.id,
          organizationId: course.organizationId,
          clientId: course.clientId,
          clientName: course.client.name,
          targetSessions: course.targetSessions,
          screeningJson: course.screeningJson,
          paChecklistJson: course.paChecklistJson,
          adtTrialsJson: course.adtTrialsJson,
          status: course.status,
          sessionCount: course._count.sessions,
          createdAt: course.createdAt.toISOString(),
          updatedAt: course.updatedAt.toISOString(),
        },
      },
      { status: existing ? 200 : 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid course payload' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not save TMS course' },
      { status: 400 }
    );
  }
}
