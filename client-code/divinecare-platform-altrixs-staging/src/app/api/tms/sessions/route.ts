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
import { advanceOnSession, flagSessionConcerns } from '@/lib/tms/workflowDb';

export const runtime = 'nodejs';

const createSchema = z.object({
  courseId: z.string().min(1),
  sessionDate: z.string().min(1),
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

function serializeSession(s: {
  id: string;
  courseId: string;
  sessionDate: Date;
  durationMin: number | null;
  targetSite: string | null;
  frequencyHz: number | null;
  pulses: number | null;
  sideEffects: string | null;
  phq9: number | null;
  clinician: string | null;
  motorThresholdPct: number | null;
  notes: string | null;
  attendance?: string | null;
  suicidalIdeation?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    courseId: s.courseId,
    sessionDate: s.sessionDate.toISOString(),
    durationMin: s.durationMin,
    targetSite: s.targetSite,
    frequencyHz: s.frequencyHz,
    pulses: s.pulses,
    sideEffects: s.sideEffects,
    phq9: s.phq9,
    clinician: s.clinician,
    motorThresholdPct: s.motorThresholdPct,
    notes: s.notes,
    attendance: s.attendance ?? null,
    suicidalIdeation: s.suicidalIdeation ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

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

    const sessions = await prisma.tmsSession.findMany({
      where: { courseId },
      orderBy: { sessionDate: 'desc' },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'tmsSession',
      patientId: course.clientId,
      metadata: { courseId, count: sessions.length },
    });

    return NextResponse.json({
      success: true,
      sessions: sessions.map(serializeSession),
    });
  } catch (err) {
    console.error('[tms/sessions GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load sessions' },
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

    const session = await prisma.tmsSession.create({
      data: {
        courseId: body.courseId,
        sessionDate: new Date(body.sessionDate),
        durationMin: body.durationMin ?? null,
        targetSite: body.targetSite ?? null,
        frequencyHz: body.frequencyHz ?? null,
        pulses: body.pulses ?? null,
        sideEffects: body.sideEffects ?? null,
        phq9: body.phq9 ?? null,
        clinician: body.clinician ?? null,
        motorThresholdPct: body.motorThresholdPct ?? null,
        notes: body.notes ?? null,
        attendance: body.attendance ?? null,
        suicidalIdeation: body.suicidalIdeation ?? null,
      },
    });

    // Worsening PHQ-9 or new suicidal ideation: risk alert to the prescriber (never blocks the save)
    const flags = await flagSessionConcerns({
      organizationId: gate.organizationId,
      courseId: course.id,
      clientId: course.clientId,
      sessionId: session.id,
      suicidalIdeation: body.suicidalIdeation,
      phq9: body.phq9,
    }).catch(() => ({ si: false, worsening: false }));
    if (body.attendance !== 'no_show' && body.attendance !== 'cancelled') await advanceOnSession(gate.organizationId, course.id, gate.userId).catch(() => {});

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'tmsSession',
      resourceId: session.id,
      patientId: course.clientId,
      metadata: { courseId: course.id, flaggedSi: flags.si, flaggedWorsening: flags.worsening },
    });

    return NextResponse.json(
      { success: true, session: serializeSession(session), flags },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid session' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not create session' },
      { status: 400 }
    );
  }
}
