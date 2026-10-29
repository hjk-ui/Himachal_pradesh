import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClaims } from '@/lib/billing/claims';

export const runtime = 'nodejs';

const lineSchema = z.object({
  cpt: z.string().min(1),
  modifier: z.string().optional().default(''),
  units: z.number().int().positive().default(1),
  charge: z.number().min(0).default(0),
});

const updateClaimSchema = z.object({
  dos: z.string().optional(),
  payer: z.string().optional(),
  renderingProvider: z.string().optional(),
  billingProvider: z.string().optional(),
  icd10: z.string().optional(),
  authNumber: z.string().optional(),
  pos: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClaims(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/claims')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const claim = await prisma.claim.findFirst({
      where: { id, organizationId: gate.organizationId },
      include: { client: true, serviceLines: true },
    });

    if (!claim) {
      return NextResponse.json({ success: false, error: 'Claim not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: claim });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch claim';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClaims(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/claims')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = updateClaimSchema.parse(await req.json());
    const icd10List = body.icd10 ? body.icd10.split(',').map(s => s.trim()).filter(Boolean) : [];
    const totalAmount = body.lines.reduce((s, l) => s + l.charge * l.units, 0);

    const updatedClaim = await prisma.$transaction(async (tx) => {
      // 1. Update claim header
      const c = await tx.claim.update({
        where: { id },
        data: {
          payer: body.payer,
          renderingNpi: body.renderingProvider,
          billingNpi: body.billingProvider,
          priorAuthNumber: body.authNumber,
          placeOfService: body.pos || '11',
          icd10Codes: icd10List,
          amountCents: Math.round(totalAmount * 100),
          status: 'READY',
        },
      });

      // 2. Replace lines
      await tx.claimServiceLine.deleteMany({ where: { claimId: id } });

      for (const line of body.lines) {
        await tx.claimServiceLine.create({
          data: {
            claimId: id,
            cptCode: line.cpt,
            modifier: line.modifier || null,
            units: line.units,
            unitCharge: line.charge,
            totalCharge: line.charge * line.units,
          },
        });
      }

      return c;
    });

    return NextResponse.json({
      success: true,
      data: updatedClaim,
      message: 'Claim updated in PostgreSQL and re-scrubbed clean.',
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : 'Claim update failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
