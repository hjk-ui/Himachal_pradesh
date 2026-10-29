import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const patient = await prisma.medicalPatient.findFirst({
      where: {
        OR: [{ id }, { mrn: id }],
        organizationId: gate.organizationId,
      },
    });

    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    const [problems, allergies, vitals, charges] = await Promise.all([
      prisma.medicalProblem.findMany({
        where: { OR: [{ patientId: patient.id }, { clientId: patient.id }] },
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),
      prisma.medicalAllergy.findMany({
        where: { OR: [{ patientId: patient.id }, { clientId: patient.id }] },
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),
      prisma.medicalVital.findMany({
        where: { OR: [{ patientId: patient.id }, { clientId: patient.id }] },
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),
      prisma.medicalCharge.findMany({
        where: { OR: [{ patientId: patient.id }, { clientId: patient.id }] },
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),
    ]);

    return NextResponse.json({
      success: true,
      patient: {
        ...patient,
        problems,
        allergies,
        vitals,
        charges,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch patient' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const existing = await prisma.medicalPatient.findFirst({
      where: {
        OR: [{ id }, { mrn: id }],
        organizationId: gate.organizationId,
      },
    });

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    const updated = await prisma.medicalPatient.update({
      where: { id: existing.id },
      data: {
        name: body.name ?? undefined,
        phone: body.phone ?? undefined,
        email: body.email ?? undefined,
        address: body.address ?? undefined,
        emergencyContact: body.emergencyContact ?? undefined,
        primaryPayer: body.primaryInsurance || body.primaryPayer || undefined,
        primaryInsurance: body.primaryInsurance || body.primaryPayer || undefined,
        secondaryPayer: body.secondaryPayer ?? undefined,
        assignedPcp: body.assignedPcp || body.pcp || undefined,
        hba1cOverdue: body.hba1cOverdue !== undefined ? Boolean(body.hba1cOverdue) : undefined,
        egfrDeclining: body.egfrDeclining !== undefined ? Boolean(body.egfrDeclining) : undefined,
        bhClientId: body.bhClientId || body.crossReferencedBhId || undefined,
        crossReferencedBhId: body.bhClientId || body.crossReferencedBhId || undefined,
        hasPart2Consent: body.hasPart2Consent !== undefined ? Boolean(body.hasPart2Consent) : (body.consent42CfrPart2 !== undefined ? Boolean(body.consent42CfrPart2) : undefined),
        consent42CfrPart2: body.consent42CfrPart2 !== undefined ? Boolean(body.consent42CfrPart2) : (body.hasPart2Consent !== undefined ? Boolean(body.hasPart2Consent) : undefined),
      },
    });

    return NextResponse.json({ success: true, patient: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not update patient' },
      { status: 500 }
    );
  }
}
