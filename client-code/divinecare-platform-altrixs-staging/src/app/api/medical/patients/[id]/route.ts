import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { MEDICAL_RULE, requireMedicalPatient } from '../../_lib/patientContext';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  // Org + vitals rule (payload carries vitals / problems / allergies) + full chart access check
  const scope = await requireMedicalPatient(id, { req, action: 'READ', resourceType: 'medicalPatient', rule: MEDICAL_RULE.vitals });
  if (!scope.ok) return scope.response;
  const { gate } = scope;

  try {
    const patient = scope.patient;

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

    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'medicalPatient',
      resourceId: patient.id,
      patientId: patient.bhClientId ?? null,
      metadata: {
        problemCount: problems.length,
        allergyCount: allergies.length,
        vitalsCount: vitals.length,
        chargeCount: charges.length,
      },
    });

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
    console.error('[medical/patients/:id] GET failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: 'Could not fetch patient' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'WRITE', resourceType: 'medicalPatient' });
  if (!scope.ok) return scope.response;
  const { gate } = scope;

  try {
    const body = await req.json();
    const existing = scope.patient;

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    const data = {
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
    };
    const updated = await prisma.medicalPatient.update({
      where: { id: existing.id },
      data,
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'medicalPatient',
      resourceId: updated.id,
      patientId: updated.bhClientId ?? existing.bhClientId ?? null,
      metadata: { fields: Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined) },
    });

    return NextResponse.json({ success: true, patient: updated });
  } catch (err: unknown) {
    console.error('[medical/patients/:id] PATCH failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: 'Could not update patient' },
      { status: 500 }
    );
  }
}
