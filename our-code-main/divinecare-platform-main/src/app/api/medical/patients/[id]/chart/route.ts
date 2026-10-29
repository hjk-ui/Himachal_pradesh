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

    // 1. Try finding patient in PostgreSQL MedicalPatient table
    let patient = await prisma.medicalPatient.findFirst({
      where: {
        OR: [{ id }, { mrn: id }],
        organizationId: gate.organizationId,
      },
    });

    // 2b. Open an existing client's chart. A medical row is created only when the client already has a real date of birth.
    let chartClient: { id: string; mrn: string | null; name: string; dateOfBirth: Date | null; gender: string | null; phone: string | null; email: string | null; addressLine1: string | null; city: string | null; state: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; insurancePayer: string | null } | null = null;
    if (!patient) {
      chartClient = await prisma.client.findFirst({
        where: {
          OR: [{ id }, { mrn: id }],
          organizationId: gate.organizationId,
        },
        select: {
          id: true,
          mrn: true,
          name: true,
          dateOfBirth: true,
          gender: true,
          phone: true,
          email: true,
          addressLine1: true,
          city: true,
          state: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
          insurancePayer: true,
        },
      });
      if (chartClient?.mrn && chartClient.dateOfBirth) {
        patient = await prisma.medicalPatient.upsert({
          where: { mrn: chartClient.mrn },
          update: {},
          create: {
            organizationId: gate.organizationId,
            mrn: chartClient.mrn,
            name: chartClient.name || 'Client',
            dateOfBirth: chartClient.dateOfBirth,
            gender: chartClient.gender || 'Unknown',
            phone: chartClient.phone,
            email: chartClient.email,
            address: [chartClient.addressLine1, chartClient.city, chartClient.state].filter(Boolean).join(', ') || null,
            emergencyContact: chartClient.emergencyContactName ? `${chartClient.emergencyContactName}${chartClient.emergencyContactPhone ? ` (${chartClient.emergencyContactPhone})` : ''}` : null,
            primaryPayer: chartClient.insurancePayer || null,
            secondaryPayer: null,
            assignedPcp: '',
            bhClientId: chartClient.id,
          },
        });
      }
    }

    if (!patient && chartClient) {
      return NextResponse.json({
        success: true,
        patient: {
          id: chartClient.id,
          mrn: chartClient.mrn,
          name: chartClient.name,
          dob: '',
          gender: chartClient.gender || '',
          phone: chartClient.phone || '',
          email: chartClient.email || '',
          address: [chartClient.addressLine1, chartClient.city, chartClient.state].filter(Boolean).join(', '),
          primaryPayer: chartClient.insurancePayer || '',
          secondaryPayer: null,
          assignedPcp: '',
          hba1cOverdue: false,
          egfrDeclining: false,
          behavioralHealthCrossReference: {
            bhClientId: chartClient.id,
            enrolled: true,
            part2ConsentOnFile: false,
            diagnoses: ['[CONFIDENTIAL — 42 CFR Part 2 Consent Required to View Psychiatric Diagnoses]'],
            therapist: '',
            psychiatrist: '',
            lastSeenDate: '',
            nextSessionDate: '',
          },
        },
        problems: [],
        vitals: [],
        visits: [],
        medications: [],
        labs: [],
      });
    }

    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    // 3. Find associated Client record
    const client = await prisma.client.findFirst({
      where: {
        OR: [{ mrn: patient.mrn }, { id: patient.bhClientId || undefined }],
      },
      include: {
        medicalProblems: true,
        medicalVitals: { orderBy: { recordedAt: 'desc' } },
        medicalVisits: { orderBy: { visitDate: 'desc' } },
        medications: { where: { active: true } },
        labOrders: { include: { results: true }, orderBy: { orderedAt: 'desc' } },
      },
    });

    // 4. Behavioral health cross-reference (HIPAA & 42 CFR Part 2 Scoped)
    let bhCrossReference = null;
    if (patient.bhClientId || client?.id) {
      const bhTargetId = patient.bhClientId || client?.id;
      const bhClient = await prisma.client.findUnique({
        where: { id: bhTargetId },
        select: { id: true, name: true, status: true, riskLevel: true },
      });

      if (bhClient) {
        bhCrossReference = {
          bhClientId: bhClient.id,
          enrolled: true,
          part2ConsentOnFile: patient.hasPart2Consent,
          diagnoses: patient.hasPart2Consent ? [] : ['[CONFIDENTIAL — 42 CFR Part 2 Consent Required to View Psychiatric Diagnoses]'],
          therapist: '',
          psychiatrist: '',
          lastSeenDate: '',
          nextSessionDate: '',
        };
      }
    }

    return NextResponse.json({
      success: true,
      patient: {
        id: patient.id,
        mrn: patient.mrn,
        name: patient.name,
        dob: patient.dateOfBirth.toISOString().split('T')[0],
        gender: patient.gender,
        phone: patient.phone,
        email: patient.email,
        address: patient.address,
        primaryPayer: patient.primaryPayer,
        secondaryPayer: patient.secondaryPayer,
        assignedPcp: patient.assignedPcp,
        hba1cOverdue: patient.hba1cOverdue,
        egfrDeclining: patient.egfrDeclining,
        behavioralHealthCrossReference: bhCrossReference,
      },
      problems: client?.medicalProblems || [],
      vitals: client?.medicalVitals || [],
      visits: client?.medicalVisits || [],
      medications: client?.medications || [],
      labs: client?.labOrders || [],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch patient chart' },
      { status: 500 }
    );
  }
}
