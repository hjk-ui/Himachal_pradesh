import { randomInt } from 'crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { PRP_DX_CODES } from '@/lib/prp/dxCodes';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { promptCarelonForProgram } from '@/lib/consents/carelon/trigger';
import { requireFeatureWrite } from '@/lib/billing/entitlementsServer';

export const runtime = 'nodejs';

const ENROLL_ROLES = new Set([
  'PSYCHIATRIST',
  'NP',
  'PRACTICE_DIRECTOR',
  'ADMIN',
  'PRP_SPECIALIST',
]);

const DX_SET = new Set(PRP_DX_CODES.map((d) => d.code));

function generateDisplayId(): string {
  return `PRP-${String(randomInt(1000, 10000))}`;
}

const createSchema = z.object({
  clientId: z.string().cuid(),
  referralId: z.string().cuid().optional().nullable(),
  diagnosisCode: z.string().trim().min(2).max(20),
  diagnosisSource: z.enum(['chart', 'referral']).optional().default('chart'),
  eligibilitySnapshot: z.unknown().optional().nullable(),
  priorAuthId: z.string().trim().max(80).optional().nullable(),
  specialistId: z.string().cuid().optional().nullable(),
  startDate: z.string().trim().max(32).optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!ENROLL_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const enrollments = await prisma.prpEnrollment.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        client: { select: { id: true, name: true, mrn: true } },
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'prpEnrollment',
      metadata: {
        count: enrollments.length,
        ids: enrollments.slice(0, 50).map((e) => e.id),
        patientIds: [...new Set(enrollments.map((e) => e.clientId))].slice(0, 50),
      },
    });

    return NextResponse.json({
      success: true,
      enrollments: enrollments.map((e) => ({
        id: e.id,
        displayId: e.displayId,
        clientId: e.clientId,
        client: e.client,
        referralId: e.referralId,
        diagnosisCode: e.diagnosisCode,
        diagnosisSource: e.diagnosisSource,
        eligibilitySnapshot: e.eligibilitySnapshot,
        priorAuthId: e.priorAuthId,
        specialistId: e.specialistId,
        startDate: e.startDate?.toISOString().slice(0, 10) ?? null,
        status: e.status,
        createdById: e.createdById,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[prp/enrollments GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load PRP enrollments' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const plan = await requireFeatureWrite(gate.organizationId, 'programs');
  if (plan.ok === false) {
    return NextResponse.json({ success: false, error: plan.error, code: plan.code }, { status: plan.status });
  }
  if (!ENROLL_ROLES.has(gate.role)) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Only Psychiatrist, NP, PRP Specialist, Practice Director, or Admin can enroll in PRP',
      },
      { status: 403 }
    );
  }

  try {
    const body = createSchema.parse(await req.json());

    if (!DX_SET.has(body.diagnosisCode)) {
      return NextResponse.json(
        {
          success: false,
          error: `Diagnosis ${body.diagnosisCode} is not a COMAR-qualifying PRP code`,
        },
        { status: 400 }
      );
    }

    const client = await prisma.client.findFirst({
      where: { id: body.clientId, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json(
        { success: false, error: 'Client not found in your organization' },
        { status: 404 }
      );
    }

    const snap = body.eligibilitySnapshot as
      | { ok?: boolean; active?: boolean; prpCovered?: boolean | 'unknown' }
      | null
      | undefined;
    // Active coverage is required. A PRP benefit not listed in the 271 ('unknown') may
    // proceed; the ASO (Carelon) prior authorization confirms it before sessions start.
    const eligible =
      snap != null &&
      (snap.ok === true ||
        (snap.active === true && (snap.prpCovered === true || snap.prpCovered === 'unknown')));
    if (!eligible) {
      return NextResponse.json(
        {
          success: false,
          error: 'Enrollment blocked — client must have active coverage with PRP benefit',
        },
        { status: 400 }
      );
    }

    if (body.referralId) {
      const referral = await prisma.prpReferral.findFirst({
        where: { id: body.referralId, organizationId: gate.organizationId },
        select: { id: true },
      });
      if (!referral) {
        return NextResponse.json(
          { success: false, error: 'Referral not found' },
          { status: 404 }
        );
      }
    }

    if (body.specialistId) {
      const specialist = await prisma.user.findFirst({
        where: {
          id: body.specialistId,
          organizationId: gate.organizationId,
          status: { in: ['ACTIVE', 'INVITED'] },
        },
        select: { id: true },
      });
      if (!specialist) {
        return NextResponse.json(
          { success: false, error: 'Specialist not found in your organization' },
          { status: 400 }
        );
      }
    }

    let startDate: Date | null = null;
    if (body.startDate) {
      const d = new Date(body.startDate);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { success: false, error: 'Invalid start date' },
          { status: 400 }
        );
      }
      startDate = d;
    }

    const displayId = generateDisplayId();
    const enrollment = await prisma.prpEnrollment.create({
      data: {
        organizationId: gate.organizationId,
        clientId: client.id,
        referralId: body.referralId || null,
        diagnosisCode: body.diagnosisCode,
        diagnosisSource: body.diagnosisSource,
        eligibilitySnapshot:
          body.eligibilitySnapshot == null
            ? undefined
            : (body.eligibilitySnapshot as Prisma.InputJsonValue),
        priorAuthId: body.priorAuthId || null,
        specialistId: body.specialistId || null,
        startDate,
        displayId,
        status: 'active',
        createdById: gate.userId,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'prpEnrollment',
      resourceId: enrollment.id,
      patientId: client.id,
      metadata: {
        referralId: enrollment.referralId,
        priorAuthId: enrollment.priorAuthId,
        status: enrollment.status,
        fields: Object.keys(body),
      },
    });
    // Maryland Medicaid: a PRP enrollment prompts a new Carelon non-overlap attestation
    await promptCarelonForProgram({ gate, req, clientId: client.id, program: 'prp', trigger: 'prp_enrollment' });

    return NextResponse.json(
      {
        success: true,
        enrollment: {
          id: enrollment.id,
          displayId: enrollment.displayId,
          clientId: enrollment.clientId,
          referralId: enrollment.referralId,
          diagnosisCode: enrollment.diagnosisCode,
          status: enrollment.status,
          startDate: enrollment.startDate?.toISOString().slice(0, 10) ?? null,
          createdAt: enrollment.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid enrollment payload', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[prp/enrollments POST]', err);
    return NextResponse.json(
      { success: false, error: 'Could not create PRP enrollment' },
      { status: 500 }
    );
  }
}
