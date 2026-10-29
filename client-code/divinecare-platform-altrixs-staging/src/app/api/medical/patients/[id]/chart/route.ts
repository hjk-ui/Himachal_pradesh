import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { UNKNOWN_DOB, documentedDob, realValue } from '../../../_lib/demographics';
import { MEDICAL_RULE, requireMedicalPatient } from '../../../_lib/patientContext';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  // MedicalPatient id / MRN or a Client id; no shadow row is created for a client any more.
  // Visits rule (the payload carries SOAP) + full chart access check (caseload / care team / Part 2).
  const scope = await requireMedicalPatient(decodeURIComponent(id), { req, action: 'READ', resourceType: 'medicalChart', rule: MEDICAL_RULE.visits });
  if (!scope.ok) return scope.response;
  const { gate } = scope;

  try {
    const link = { medicalPatient: scope.patient, clientId: scope.clientId };

    const client = link.clientId
      ? await prisma.client.findFirst({
          where: { id: link.clientId, organizationId: gate.organizationId },
          include: {
            medicalProblems: true,
            medicalVitals: {
              orderBy: { recordedAt: 'desc' },
              include: { recordedBy: { select: { name: true } } },
            },
            medicalVisits: { orderBy: { visitDate: 'desc' } },
            medications: { where: { active: true } },
            labOrders: { include: { results: true }, orderBy: { orderedAt: 'desc' } },
          },
        })
      : null;
    // Demographics: the MedicalPatient row when one exists, else the client itself
    const patient = link.medicalPatient ?? {
      id: client!.id,
      mrn: client!.mrn ?? '',
      name: client!.name,
      firstName: client!.legalFirstName,
      lastName: client!.legalLastName,
      dateOfBirth: client!.dateOfBirth ?? UNKNOWN_DOB,
      dob: client!.dateOfBirth,
      gender: client!.gender || 'Unknown',
      phone: client!.phone,
      email: client!.email,
      address: [client!.addressLine1, client!.city, client!.state].filter(Boolean).join(', ') || null,
      primaryPayer: client!.insurancePayer,
      primaryInsurance: null,
      secondaryPayer: null,
      assignedPcp: '',
      hba1cOverdue: false,
      egfrDeclining: false,
      bhClientId: client!.id,
      hasPart2Consent: false,
    };

    // Allergies key on the medical patient (client link optional)
    const allergies = await prisma.medicalAllergy.findMany({
      where: {
        OR: client ? [{ patientId: patient.id }, { clientId: client.id }] : [{ patientId: patient.id }],
        status: { not: 'Inactive' },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 4. Behavioral health cross-reference (HIPAA & 42 CFR Part 2 Scoped)
    let bhCrossReference = null;
    if (patient.bhClientId || client?.id) {
      const bhTargetId = patient.bhClientId || client?.id;
      const bhClient = await prisma.client.findFirst({
        where: { id: bhTargetId, organizationId: gate.organizationId },
        select: { id: true, name: true, status: true, riskLevel: true },
      });

      if (bhClient) {
        bhCrossReference = {
          bhClientId: bhClient.id,
          enrolled: true,
          part2ConsentOnFile: patient.hasPart2Consent,
          // Only show diagnoses if 42 CFR Part 2 consent is on file
          diagnoses: patient.hasPart2Consent
            ? []
            : ['[CONFIDENTIAL — 42 CFR Part 2 Consent Required to View Psychiatric Diagnoses]'],
          therapist: null,
          psychiatrist: null,
          lastSeenDate: null,
          nextSessionDate: null,
        };
      }
    }

    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'medicalChart', resourceId: patient.id, patientId: client?.id ?? patient.bhClientId ?? null });
    return NextResponse.json({
      success: true,
      patient: {
        id: patient.id,
        mrn: patient.mrn,
        name: patient.name,
        // DrFirst-ready legal name: the linked client's structured name, else the medical record's.
        legalFirstName: client?.legalFirstName || patient.firstName || null,
        middleInitial: client?.legalFirstName ? client.middleInitial ?? null : null,
        legalLastName: client?.legalFirstName ? client.legalLastName ?? null : patient.lastName || null,
        dob: documentedDob(patient),
        gender: patient.gender,
        phone: patient.phone,
        email: patient.email,
        address: realValue(patient.address),
        primaryPayer: realValue(patient.primaryPayer || patient.primaryInsurance),
        secondaryPayer: patient.secondaryPayer,
        assignedPcp: patient.assignedPcp,
        hba1cOverdue: patient.hba1cOverdue,
        egfrDeclining: patient.egfrDeclining,
        behavioralHealthCrossReference: bhCrossReference,
      },
      clientId: client?.id || null,
      problems: client?.medicalProblems || [],
      vitals: client?.medicalVitals || [],
      visits: client?.medicalVisits || [],
      medications: client?.medications || [],
      allergies,
      labs: client?.labOrders || [],
    });
  } catch (err: unknown) {
    console.error('[medical/patients/chart] GET failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: 'Could not fetch patient chart' },
      { status: 500 }
    );
  }
}
