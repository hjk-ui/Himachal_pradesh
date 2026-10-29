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
import { shouldWithholdDose } from '@/features/ehr/tmsSpravatoConstants';

export const runtime = 'nodejs';

const createSchema = z.object({
  enrollmentId: z.string().min(1),
  sessionDate: z.string().min(1),
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

function serializeSession(s: {
  id: string;
  enrollmentId: string;
  sessionDate: Date;
  doseMg: number | null;
  vitalsJson: unknown;
  moaas: number | null;
  cadssItemsJson: unknown;
  cadssTotal: number | null;
  withheld: boolean;
  clinician: string | null;
  notes: string | null;
  otherSideEffects: string | null;
  phq9: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    enrollmentId: s.enrollmentId,
    sessionDate: s.sessionDate.toISOString(),
    doseMg: s.doseMg,
    vitalsJson: s.vitalsJson,
    moaas: s.moaas,
    cadssItemsJson: s.cadssItemsJson,
    cadssTotal: s.cadssTotal,
    withheld: s.withheld,
    clinician: s.clinician,
    notes: s.notes,
    otherSideEffects: s.otherSideEffects,
    phq9: s.phq9,
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

  const enrollmentId = new URL(req.url).searchParams.get('enrollmentId');
  if (!enrollmentId) {
    return NextResponse.json(
      { success: false, error: 'enrollmentId required' },
      { status: 400 }
    );
  }

  try {
    const enrollment = await prisma.spravatoEnrollment.findFirst({
      where: { id: enrollmentId, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!enrollment) {
      return NextResponse.json({ success: false, error: 'Enrollment not found' }, { status: 404 });
    }

    const sessions = await prisma.spravatoSession.findMany({
      where: { enrollmentId },
      orderBy: { sessionDate: 'desc' },
    });

    return NextResponse.json({
      success: true,
      sessions: sessions.map(serializeSession),
    });
  } catch (err) {
    console.error('[spravato/sessions GET]', err);
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
    const enrollment = await prisma.spravatoEnrollment.findFirst({
      where: { id: body.enrollmentId, organizationId: gate.organizationId },
      select: { id: true, doseCount: true },
    });
    if (!enrollment) {
      return NextResponse.json({ success: false, error: 'Enrollment not found' }, { status: 404 });
    }

    const vitals =
      (body.vitalsJson as Record<string, { sbp?: number; dbp?: number; bp?: string }>) || {};
    const autoWithhold = shouldWithholdDose(vitals);
    const withheld = body.withheld ?? autoWithhold;
    const cadssTotal =
      body.cadssTotal ??
      (body.cadssItemsJson ? body.cadssItemsJson.reduce((a, b) => a + b, 0) : null);

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.spravatoSession.create({
        data: {
          enrollmentId: body.enrollmentId,
          sessionDate: new Date(body.sessionDate),
          doseMg: body.doseMg ?? null,
          vitalsJson: (body.vitalsJson as object) ?? undefined,
          moaas: body.moaas ?? null,
          cadssItemsJson: (body.cadssItemsJson as object) ?? undefined,
          cadssTotal,
          withheld,
          clinician: body.clinician ?? null,
          notes: body.notes ?? null,
          otherSideEffects: body.otherSideEffects ?? null,
          phq9: body.phq9 ?? null,
        },
      });

      if (!withheld) {
        await tx.spravatoEnrollment.update({
          where: { id: body.enrollmentId },
          data: { doseCount: { increment: 1 } },
        });
      }

      return created;
    });

    return NextResponse.json(
      { success: true, session: serializeSession(session) },
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
