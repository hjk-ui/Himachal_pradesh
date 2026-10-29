import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    let charges = await prisma.medicalCharge.findMany({
      where: { organizationId: gate.organizationId },
      include: { client: { select: { name: true, mrn: true } } },
      orderBy: { dos: 'desc' },
    });



    return NextResponse.json({
      success: true,
      charges: charges.map((c) => ({
        id: c.id,
        patientId: c.clientId,
        patientName: c.client?.name || 'Unknown Patient',
        mrn: c.client?.mrn || 'MED-00000',
        dos: c.dos.toISOString().split('T')[0],
        dateOfService: c.dos.toISOString().split('T')[0],
        cptCode: c.cptCode,
        modifier: c.modifier || '',
        modifiers: c.modifier ? c.modifier.split(',').map((s) => s.trim()) : [],
        units: c.units,
        chargeAmount: c.amountCents / 100,
        billedAmount: c.amountCents / 100,
        allowedAmount: (c.amountCents / 100) * 0.78,
        paidAmount: c.status === 'Paid' ? (c.amountCents / 100) * 0.78 : 0,
        balance: c.status === 'Paid' ? 0 : c.amountCents / 100,
        primaryIcd10: c.primaryIcd,
        secondaryIcd10: c.secondaryIcd || '',
        icd10Pointers: [c.primaryIcd, ...(c.secondaryIcd ? c.secondaryIcd.split(',').map((s) => s.trim()) : [])],
        renderingNpi: c.providerName,
        renderingProvider: c.providerName,
        payer: c.payerName || 'Commercial Payer',
        payerName: c.payerName || 'Commercial Payer',
        payerId: '00580',
        status: c.status as 'Draft' | 'Ready' | 'Submitted' | 'Paid' | 'Denied',
        denialCode: c.denialCode || undefined,
        denialReason: c.denialReason || undefined,
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch medical charges' },
      { status: 500 }
    );
  }
}

const newChargeSchema = z.object({
  clientId: z.string().optional(),
  patientName: z.string().min(1),
  mrn: z.string().optional(),
  dateOfService: z.string(),
  cptCode: z.string().min(1),
  modifier: z.string().optional(),
  units: z.number().int().min(1).default(1),
  chargeAmount: z.number().positive(),
  primaryIcd10: z.string().min(1),
  secondaryIcd10: z.string().optional(),
  renderingProvider: z.string().min(1),
  payer: z.string().optional(),
  status: z.enum(['Draft', 'Ready', 'Submitted', 'Paid', 'Denied']).default('Ready'),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = newChargeSchema.parse(await req.json());

    // Find or create associated client record
    let client = body.clientId
      ? await prisma.client.findUnique({ where: { id: body.clientId } })
      : null;

    if (!client) {
      client = await prisma.client.findFirst({
        where: { organizationId: gate.organizationId, name: body.patientName },
      });
      if (!client) {
        client = await prisma.client.create({
          data: {
            name: body.patientName,
            mrn: body.mrn || `MED-${Math.floor(10000 + Math.random() * 90000)}`,
            organizationId: gate.organizationId,
          },
        });
      }
    }

    const created = await prisma.medicalCharge.create({
      data: {
        organizationId: gate.organizationId,
        clientId: client.id,
        dos: new Date(body.dateOfService),
        cptCode: body.cptCode,
        modifier: body.modifier || null,
        units: body.units,
        amountCents: Math.round(body.chargeAmount * 100),
        primaryIcd: body.primaryIcd10,
        secondaryIcd: body.secondaryIcd10 || null,
        providerName: body.renderingProvider,
        payerName: body.payer || 'Commercial',
        status: body.status,
      },
    });

    return NextResponse.json({
      success: true,
      chargeId: created.id,
      charge: created,
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create charge' },
      { status: 400 }
    );
  }
}

const updateChargeSchema = z.object({
  id: z.string().optional(),
  chargeId: z.string().optional(),
  status: z.enum(['Draft', 'Ready', 'Submitted', 'Paid', 'Denied']),
  denialCode: z.string().optional(),
  denialReason: z.string().optional(),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = updateChargeSchema.parse(await req.json());
    const targetId = body.id || body.chargeId;
    if (!targetId) {
      return NextResponse.json({ success: false, error: 'Charge id or chargeId is required' }, { status: 400 });
    }

    const updated = await prisma.medicalCharge.update({
      where: { id: targetId },
      data: {
        status: body.status,
        denialCode: body.denialCode || null,
        denialReason: body.denialReason || null,
        submittedAt: body.status === 'Submitted' ? new Date() : undefined,
        paidAt: body.status === 'Paid' ? new Date() : undefined,
      },
    });

    return NextResponse.json({ success: true, charge: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not update charge status' },
      { status: 400 }
    );
  }
}
