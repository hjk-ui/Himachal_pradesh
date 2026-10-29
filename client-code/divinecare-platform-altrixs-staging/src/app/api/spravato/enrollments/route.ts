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

export const runtime = 'nodejs';

const upsertSchema = z.object({
  clientId: z.string().min(1).max(128),
  remsId: z.string().trim().max(120).optional().nullable(),
  enrolledAt: z.string().optional().nullable(),
  phase: z.enum(['induction', 'maint1', 'maint2']).optional().default('induction'),
  doseCount: z.number().int().min(0).max(500).optional(),
  remsChecklistJson: z.unknown().optional().nullable(),
  paChecklistJson: z.unknown().optional().nullable(),
  status: z.string().trim().max(40).optional(),
});

function serializeEnrollment(e: {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  remsId: string | null;
  enrolledAt: Date | null;
  phase: string;
  doseCount: number;
  remsChecklistJson: unknown;
  paChecklistJson: unknown;
  status: string;
  sessionCount: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    organizationId: e.organizationId,
    clientId: e.clientId,
    clientName: e.clientName,
    remsId: e.remsId,
    enrolledAt: e.enrolledAt?.toISOString() ?? null,
    phase: e.phase,
    doseCount: e.doseCount,
    remsChecklistJson: e.remsChecklistJson,
    paChecklistJson: e.paChecklistJson,
    status: e.status,
    sessionCount: e.sessionCount,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
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

  try {
    const enrollments = await prisma.spravatoEnrollment.findMany({
      where: { organizationId: gate.organizationId, client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) },
      include: {
        client: { select: { id: true, name: true } },
        sessions: {
          where: { phq9: { not: null } },
          orderBy: { sessionDate: 'desc' },
          take: 1,
          select: { phq9: true },
        },
        _count: { select: { sessions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Doses given = sessions on file that were not withheld (the stored counter is not
    // decremented when a session is deleted, so it is not used for display).
    const given = enrollments.length
      ? await prisma.spravatoSession.groupBy({
          by: ['enrollmentId'],
          where: { enrollmentId: { in: enrollments.map((e) => e.id) }, withheld: false },
          _count: { _all: true },
        })
      : [];
    const givenBy = new Map(given.map((g) => [g.enrollmentId, g._count._all]));

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'spravatoEnrollment',
      metadata: {
        count: enrollments.length,
        ids: enrollments.slice(0, 50).map((e) => e.id),
        patientIds: [...new Set(enrollments.map((e) => e.clientId))].slice(0, 50),
      },
    });

    return NextResponse.json({
      success: true,
      enrollments: enrollments.map((e) => ({
        ...serializeEnrollment({
          id: e.id,
          organizationId: e.organizationId,
          clientId: e.clientId,
          clientName: e.client.name,
          remsId: e.remsId,
          enrolledAt: e.enrolledAt,
          phase: e.phase,
          doseCount: givenBy.get(e.id) ?? 0,
          remsChecklistJson: e.remsChecklistJson,
          paChecklistJson: e.paChecklistJson,
          status: e.status,
          sessionCount: e._count.sessions,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        }),
        latestPhq9: e.sessions[0]?.phq9 ?? null,
      })),
    });
  } catch (err) {
    console.error('[spravato/enrollments GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load Spravato enrollments' },
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
      where: { id: body.clientId, organizationId: gate.organizationId, AND: [clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role })] },
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const existing = await prisma.spravatoEnrollment.findFirst({
      where: {
        organizationId: gate.organizationId,
        clientId: body.clientId,
        status: { not: 'archived' },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const data = {
      remsId: body.remsId ?? undefined,
      enrolledAt:
        body.enrolledAt === null
          ? null
          : body.enrolledAt
            ? new Date(body.enrolledAt)
            : undefined,
      phase: body.phase ?? 'induction',
      ...(body.doseCount !== undefined ? { doseCount: body.doseCount } : {}),
      ...(body.remsChecklistJson !== undefined
        ? { remsChecklistJson: body.remsChecklistJson as object }
        : {}),
      ...(body.paChecklistJson !== undefined
        ? { paChecklistJson: body.paChecklistJson as object }
        : {}),
      ...(body.status ? { status: body.status } : {}),
    };

    const enrollment = existing
      ? await prisma.spravatoEnrollment.update({
          where: { id: existing.id },
          data,
          include: {
            client: { select: { id: true, name: true } },
            _count: { select: { sessions: true } },
          },
        })
      : await prisma.spravatoEnrollment.create({
          data: {
            organizationId: gate.organizationId,
            clientId: body.clientId,
            remsId: body.remsId ?? null,
            enrolledAt: body.enrolledAt ? new Date(body.enrolledAt) : new Date(),
            phase: body.phase ?? 'induction',
            doseCount: body.doseCount ?? 0,
            remsChecklistJson: (body.remsChecklistJson as object) ?? undefined,
            paChecklistJson: (body.paChecklistJson as object) ?? undefined,
            status: body.status || 'active',
          },
          include: {
            client: { select: { id: true, name: true } },
            _count: { select: { sessions: true } },
          },
        });

    await auditPhiAccess({
      gate,
      req,
      action: existing ? 'WRITE' : 'CREATE',
      resourceType: 'spravatoEnrollment',
      resourceId: enrollment.id,
      patientId: enrollment.clientId,
      metadata: {
        phase: enrollment.phase,
        status: enrollment.status,
        fields: Object.keys(body).filter((k) => k !== 'clientId'),
      },
    });

    return NextResponse.json(
      {
        success: true,
        enrollment: serializeEnrollment({
          id: enrollment.id,
          organizationId: enrollment.organizationId,
          clientId: enrollment.clientId,
          clientName: enrollment.client.name,
          remsId: enrollment.remsId,
          enrolledAt: enrollment.enrolledAt,
          phase: enrollment.phase,
          doseCount: enrollment.doseCount,
          remsChecklistJson: enrollment.remsChecklistJson,
          paChecklistJson: enrollment.paChecklistJson,
          status: enrollment.status,
          sessionCount: enrollment._count.sessions,
          createdAt: enrollment.createdAt,
          updatedAt: enrollment.updatedAt,
        }),
      },
      { status: existing ? 200 : 201 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError ? 'Invalid enrollment payload' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not save enrollment' },
      { status: 400 }
    );
  }
}
