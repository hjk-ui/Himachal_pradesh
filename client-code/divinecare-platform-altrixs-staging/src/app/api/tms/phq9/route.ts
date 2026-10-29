import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import {
  canReadTmsSpravato,
  canWriteTmsSpravato,
  TMS_SPRAVATO_PATH,
} from '@/lib/ehr/tmsSpravato';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { flagSessionConcerns } from '@/lib/tms/workflowDb';
import { TMS_SCORE_INSTRUMENTS, TMS_SCORE_MILESTONES, scoreInstrument } from '@/lib/tms/workflow';

export const runtime = 'nodejs';

/**
 * Course scores (clinician-entered totals, score only): PHQ-9 (default), Y-BOCS total (OCD, weekly),
 * HAM-D / MADRS totals (baseline only). No instrument items are stored.
 */
const createSchema = z
  .object({
    courseId: z.string().min(1),
    instrument: z.enum(TMS_SCORE_INSTRUMENTS.map((i) => i.value) as [string, ...string[]]).optional().default('phq-9'),
    milestone: z.enum(TMS_SCORE_MILESTONES as unknown as [string, ...string[]]),
    score: z.number().int().min(0).max(60),
    gad7Score: z.number().int().min(0).max(21).optional().nullable(),
  })
  .superRefine((b, ctx) => {
    const inst = scoreInstrument(b.instrument)!;
    if (b.score > inst.max) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${inst.label} is 0-${inst.max}` });
    if (inst.baselineOnly && b.milestone !== 'baseline') ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${inst.label} is recorded at baseline only` });
    if (b.instrument !== 'phq-9' && b.gad7Score != null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GAD-7 is recorded with the PHQ-9 only' });
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
      where: { id: courseId, organizationId: gate.organizationId, client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) },
      select: { id: true, clientId: true },
    });
    if (!course) {
      return NextResponse.json({ success: false, error: 'Course not found' }, { status: 404 });
    }

    const scores = await prisma.tmsPhq9.findMany({
      where: { courseId },
      orderBy: { recordedAt: 'asc' },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'tmsPhq9',
      patientId: course.clientId,
      metadata: { courseId, count: scores.length },
    });

    return NextResponse.json({
      success: true,
      scores: scores.map((s) => ({
        id: s.id,
        courseId: s.courseId,
        milestone: s.milestone,
        instrument: s.instrument,
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
      where: { id: body.courseId, organizationId: gate.organizationId, client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) },
      select: { id: true, clientId: true },
    });
    if (!course) {
      return NextResponse.json({ success: false, error: 'Course not found' }, { status: 404 });
    }

    const row = await prisma.tmsPhq9.create({
      data: {
        courseId: body.courseId,
        milestone: body.milestone,
        instrument: body.instrument,
        score: body.score,
        gad7Score: body.gad7Score ?? null,
      },
    });

    // A PHQ-9 or Y-BOCS rise of 5+ points raises a risk alert to the prescriber (never blocks the save)
    const flags = await flagSessionConcerns({
      organizationId: gate.organizationId,
      courseId: course.id,
      clientId: course.clientId,
      sessionId: row.id,
      suicidalIdeation: false,
      phq9: row.instrument === 'phq-9' ? row.score : null,
      ybocs: row.instrument === 'ybocs' ? row.score : null,
    }).catch(() => ({ si: false, worsening: false }));

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'tmsPhq9',
      resourceId: row.id,
      patientId: course.clientId,
      metadata: { courseId: course.id, milestone: row.milestone, instrument: row.instrument, flaggedWorsening: flags.worsening },
    });

    return NextResponse.json(
      {
        success: true,
        score: {
          id: row.id,
          courseId: row.courseId,
          milestone: row.milestone,
          instrument: row.instrument,
          score: row.score,
          gad7Score: row.gad7Score,
          recordedAt: row.recordedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message || 'Invalid score' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not save PHQ-9' },
      { status: 400 }
    );
  }
}
