import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { recordPhiAudit } from '@/lib/audit/phiAudit';
import { resolveDrugCode } from '@/lib/prescribing/drugCodes';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { canPrescribe, isCaseloadRole, isMedicalRole } from '@/types/roles';

export const runtime = 'nodejs';

const DENIED_ROLES = new Set([
  'BILLING',
  'HR',
  'FRONT_DESK',
  'OFFICE_MANAGER',
  'PEER_SUPPORT',
  'CRISIS_RESPONDER',
  'CASE_MANAGER',
  'PRP_SPECIALIST',
]);

function canWriteAllergy(role: string) {
  const normalized = role.toUpperCase();
  if (!normalized || DENIED_ROLES.has(normalized)) return false;
  return (
    isMedicalRole(normalized) ||
    canPrescribe(normalized) ||
    normalized === 'THERAPIST' ||
    normalized === 'CLINICIAN' ||
    normalized === 'ADMIN' ||
    normalized === 'DIRECTOR' ||
    normalized === 'PRACTICE_DIRECTOR'
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { id } = await ctx.params;
  const role = String(gate.role || '');
  const deny = async () => {
    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: role,
      action: 'allergy.write',
      resourceType: 'MedicalAllergy',
      resourceId: id,
      patientId: id,
      outcome: 'DENIED',
    });
  };

  if (!canWriteAllergy(role)) {
    await deny();
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const substance = String(body.substance || body.allergen || '').trim().slice(0, 200);
  const code = resolveDrugCode(substance, body.rxnormId || body.ndcCode);
  if (!substance || !code) {
    return NextResponse.json(
      { success: false, error: 'A substance and a standard drug code are required.' },
      { status: 400 }
    );
  }

  const access = clientAccessWhere({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });
  const caseloadLimited = isCaseloadRole(role) && !isMedicalRole(role);
  const patient = await prisma.medicalPatient.findFirst({
    where: { organizationId: gate.organizationId, OR: [{ id }, { mrn: id }, { bhClientId: id }] },
    select: { id: true, bhClientId: true },
  });

  let clientId: string | null = null;
  if (patient?.bhClientId) {
    const linked = await prisma.client.findFirst({
      where: {
        id: patient.bhClientId,
        AND: [caseloadLimited ? access : clientOrgFilter(gate.organizationId)],
      },
      select: { id: true },
    });
    if (!linked) {
      await deny();
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    clientId = linked.id;
  } else if (caseloadLimited) {
    if (patient) {
      await deny();
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    const client = await prisma.client.findFirst({
      where: { id, AND: [access] },
      select: { id: true },
    });
    if (!client) {
      await deny();
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    clientId = client.id;
  } else if (!patient) {
    const client = await prisma.client.findFirst({
      where: { id, AND: [access] },
      select: { id: true },
    });
    if (!client) {
      await deny();
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    clientId = client.id;
  }

  if (caseloadLimited && !clientId) {
    await deny();
    return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
  }

  const patientId = patient?.id || clientId;
  if (!patientId) {
    await deny();
    return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
  }

  const reaction = String(body.reaction || '').trim().slice(0, 500);
  const severity = String(body.severity || 'Moderate').trim().slice(0, 40) || 'Moderate';
  const allergy = await prisma.medicalAllergy.create({
    data: {
      patientId,
      clientId,
      allergen: substance,
      reaction: reaction || null,
      severity,
      status: 'Active',
      rxnormId: code,
    },
    select: { id: true, allergen: true, rxnormId: true },
  });

  await recordPhiAudit({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: role,
    action: 'allergy.write',
    resourceType: 'MedicalAllergy',
    resourceId: allergy.id,
    patientId: clientId,
    outcome: 'SUCCESS',
  });
  return NextResponse.json({
    success: true,
    allergy: { id: allergy.id, substance: allergy.allergen, rxnormId: allergy.rxnormId },
  });
}
