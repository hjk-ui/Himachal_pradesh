import { randomInt } from 'crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { PRP_DX_CODES, PRP_DOMAINS } from '@/lib/prp/dxCodes';

export const runtime = 'nodejs';

const REFERRAL_ROLES = new Set([
  'PSYCHIATRIST',
  'NP',
  'PRACTICE_DIRECTOR',
  'ADMIN',
]);

const DX_SET = new Set(PRP_DX_CODES.map((d) => d.code));

function generateDisplayId(): string {
  return `PRP-${String(randomInt(1000, 10000))}`;
}

const createSchema = z.object({
  clientId: z.string().cuid().optional().nullable(),
  clientName: z.string().trim().min(2).max(160),
  dateOfBirth: z.string().trim().min(8).max(32),
  medicaidId: z.string().trim().min(1).max(80),
  diagnosisCode: z.string().trim().min(2).max(20),
  diagnosisNarrative: z.string().trim().min(2).max(2000),
  impairmentJson: z.unknown().optional().nullable(),
  recommendedDomains: z.array(z.string().trim().max(80)).min(2).max(20),
  hospitalizations: z.string().trim().max(2000).optional().nullable(),
  functionalNarrative: z.string().trim().min(10).max(5000),
  prpJustification: z.string().trim().min(10).max(5000),
  prescriberName: z.string().trim().min(2).max(160),
  prescriberNpi: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'NPI must be exactly 10 digits'),
  licenseNumber: z.string().trim().max(80).optional().nullable(),
  signature: z.string().trim().min(1).max(200),
  referralDate: z.string().datetime().optional().nullable(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!REFERRAL_ROLES.has(gate.role) && gate.role !== 'PRP_SPECIALIST') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const referrals = await prisma.prpReferral.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        client: { select: { id: true, name: true, mrn: true } },
      },
    });

    return NextResponse.json({
      success: true,
      referrals: referrals.map((r) => ({
        id: r.id,
        displayId: r.displayId,
        clientId: r.clientId,
        clientName: r.clientName,
        client: r.client,
        dateOfBirth: r.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        medicaidId: r.medicaidId,
        diagnosisCode: r.diagnosisCode,
        diagnosisNarrative: r.diagnosisNarrative,
        impairmentJson: r.impairmentJson,
        recommendedDomains: r.recommendedDomains,
        hospitalizations: r.hospitalizations,
        functionalNarrative: r.functionalNarrative,
        prpJustification: r.prpJustification,
        prescriberName: r.prescriberName,
        prescriberNpi: r.prescriberNpi,
        licenseNumber: r.licenseNumber,
        signature: r.signature,
        referralDate: r.referralDate.toISOString(),
        createdById: r.createdById,
        createdAt: r.createdAt.toISOString(),
      })),
      dxCodes: PRP_DX_CODES,
      domains: PRP_DOMAINS,
    });
  } catch (err) {
    console.error('[prp/referrals GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load PRP referrals' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!REFERRAL_ROLES.has(gate.role)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Only Psychiatrist, NP, Practice Director, or Admin can submit PRP referrals',
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

    if (body.clientId) {
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
    }

    let dateOfBirth: Date | null = null;
    const d = new Date(body.dateOfBirth);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date of birth' },
        { status: 400 }
      );
    }
    dateOfBirth = d;

    const displayId = generateDisplayId();
    const referral = await prisma.prpReferral.create({
      data: {
        organizationId: gate.organizationId,
        clientId: body.clientId || null,
        clientName: body.clientName,
        dateOfBirth,
        medicaidId: body.medicaidId || null,
        diagnosisCode: body.diagnosisCode,
        diagnosisNarrative: body.diagnosisNarrative,
        impairmentJson:
          body.impairmentJson == null
            ? undefined
            : (body.impairmentJson as Prisma.InputJsonValue),
        recommendedDomains: body.recommendedDomains ?? [],
        hospitalizations: body.hospitalizations || null,
        functionalNarrative: body.functionalNarrative,
        prpJustification: body.prpJustification,
        prescriberName: body.prescriberName,
        prescriberNpi: body.prescriberNpi,
        licenseNumber: body.licenseNumber || null,
        signature: body.signature,
        referralDate: body.referralDate ? new Date(body.referralDate) : new Date(),
        displayId,
        createdById: gate.userId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        referral: {
          id: referral.id,
          displayId: referral.displayId,
          clientId: referral.clientId,
          clientName: referral.clientName,
          diagnosisCode: referral.diagnosisCode,
          referralDate: referral.referralDate.toISOString(),
          createdAt: referral.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid referral form', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[prp/referrals POST]', err);
    return NextResponse.json(
      { success: false, error: 'Could not create PRP referral' },
      { status: 500 }
    );
  }
}
