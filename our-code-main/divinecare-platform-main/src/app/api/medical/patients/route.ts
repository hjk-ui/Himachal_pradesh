import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { isPrimaryCareRole, staffLocationIds } from '@/lib/clients/locationScope';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    let patients = await prisma.medicalPatient.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const clientIds = patients.map((p) => p.bhClientId).filter(Boolean) as string[];
    const clientMrns = patients.map((p) => p.mrn);
    const clients = await prisma.client.findMany({
      where: {
        OR: [
          { id: { in: clientIds } },
          { mrn: { in: clientMrns } },
        ],
      },
      select: {
        id: true,
        mrn: true,
        locationId: true,
        assignedToId: true,
        primaryDiagnosis: true,
        primaryDiagnosisCode: true,
        medicalProblems: {
          select: {
            id: true,
            icd10Code: true,
            name: true,
            description: true,
            category: true,
            status: true,
            isChronic: true,
          },
        },
      },
    });

    const clientMap = new Map();
    for (const c of clients) {
      if (c.id) clientMap.set(c.id, c);
      if (c.mrn) clientMap.set(c.mrn, c);
    }

    let visiblePatients = patients;
    if (isPrimaryCareRole(gate.role)) {
      const locations = new Set(await staffLocationIds(gate.userId));
      visiblePatients = patients.filter((patient) => {
        const linked = (patient.bhClientId ? clientMap.get(patient.bhClientId) : null) || clientMap.get(patient.mrn);
        return Boolean(linked?.locationId && locations.has(linked.locationId) && linked.assignedToId === gate.userId);
      });
    }

    return NextResponse.json({
      success: true,
      patients: visiblePatients.map((p) => {
        const client = (p.bhClientId ? clientMap.get(p.bhClientId) : null) || clientMap.get(p.mrn);
        const dobStr = p.dateOfBirth ? p.dateOfBirth.toISOString().split('T')[0] : '';
        const birthYear = p.dateOfBirth ? p.dateOfBirth.getFullYear() : NaN;
        const currentYear = new Date().getFullYear();
        const age = Number.isFinite(birthYear) ? Math.max(0, currentYear - birthYear) : 0;
        const gender = (p.gender || '').toLowerCase();
        const pronouns = gender === 'female' ? 'She/Her' : gender === 'male' ? 'He/Him' : '';
        const sexAtBirth = gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : '';

        const problems = (client?.medicalProblems || []).map((mp: any) => ({
          id: mp.id,
          icd10: mp.icd10Code,
          description: mp.name || mp.description || mp.icd10Code,
          onsetDate: '',
          status: mp.isChronic ? 'Chronic' : (mp.status || 'Active'),
          severity: '',
          category: mp.category || '',
        }));

        if (problems.length === 0 && client?.primaryDiagnosisCode) {
          problems.push({
            id: `prob-${p.id}`,
            icd10: client.primaryDiagnosisCode,
            description: client.primaryDiagnosis || client.primaryDiagnosisCode,
            onsetDate: '',
            status: 'Active',
            severity: '',
            category: '',
          });
        }

        return {
          id: p.id,
          mrn: p.mrn,
          name: p.name,
          preferredName: p.firstName || p.name.split(' ')[0] || p.name,
          dob: dobStr,
          age,
          gender: p.gender || '',
          pronouns,
          pcp: p.assignedPcp && p.assignedPcp !== 'Dr. Emeka Okafor, MD' ? p.assignedPcp : '',
          phone: p.phone || '',
          email: p.email || '',
          hasCareGaps: Boolean(p.hba1cOverdue || p.egfrDeclining),
          hasAbnormalLabs: false,
          hasCriticalPanicLab: false,
          lastVisit: '',
          nextVisit: p.nextAppointmentDate ? `Scheduled for ${p.nextAppointmentDate.toISOString().split('T')[0]}` : null,
          demographics: {
            legalName: p.name,
            preferredName: p.firstName || p.name.split(' ')[0] || p.name,
            dateOfBirth: dobStr,
            sexAtBirth,
            genderIdentity: p.gender || '',
            sexualOrientation: '',
            pronouns,
            ombRace: '',
            ombEthnicity: '',
            preferredLanguage: '',
            interpreterNeeded: false,
            portalStatus: '',
            primaryInsurance: {
              payerName: p.primaryPayer || p.primaryInsurance || '',
              payerId: '',
              memberId: '',
              groupNumber: '',
              subscriberName: p.name,
              subscriberDob: dobStr,
              relationship: 'Self',
            },
            guarantor: {
              name: p.name,
              relationship: 'Self',
              phone: p.phone || '',
              address: p.address || '',
            },
            emergencyContacts: p.emergencyContact
              ? [
                  {
                    name: p.emergencyContact,
                    relationship: 'Contact',
                    phone: p.phone || '',
                    isAuthorizedProxy: false,
                  },
                ]
              : [],
            codeStatus: '',
            advanceDirectives: {
              hasLivingWill: false,
              hasPOLST: false,
            },
            chartFlags: [],
          },
          problems,
          medications: [],
          allergies: [],
          vitals: [],
          labs: [],
          preventiveCare: [],
          referrals: [],
          encounters: [],
        };
      }),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch medical patients' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();
    const name = body.name || `${body.firstName || ''} ${body.lastName || ''}`.trim();
    if (!name) {
      return NextResponse.json({ success: false, error: 'Patient name is required' }, { status: 400 });
    }
    const mrn = body.mrn || `MED-${Math.floor(10000 + Math.random() * 90000)}`;
    const dobRaw = body.dob || body.dateOfBirth;
    const dob = dobRaw ? new Date(dobRaw) : null;
    if (!dob || Number.isNaN(dob.getTime())) {
      return NextResponse.json({ success: false, error: 'Date of birth is required' }, { status: 400 });
    }

    const created = await prisma.medicalPatient.create({
      data: {
        organizationId: gate.organizationId,
        mrn,
        name,
        firstName: body.firstName || name.split(' ')[0] || null,
        lastName: body.lastName || name.split(' ').slice(1).join(' ') || null,
        dateOfBirth: dob,
        dob,
        gender: body.gender || 'Unknown',
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        emergencyContact: body.emergencyContact || null,
        primaryPayer: body.primaryInsurance || body.primaryPayer || null,
        primaryInsurance: body.primaryInsurance || body.primaryPayer || null,
        secondaryPayer: body.secondaryPayer || null,
        assignedPcp: body.assignedPcp || body.pcp || '',
        hba1cOverdue: Boolean(body.hba1cOverdue),
        egfrDeclining: Boolean(body.egfrDeclining),
        nextAppointmentDate: body.nextAppointmentDate ? new Date(body.nextAppointmentDate) : null,
        bhClientId: body.bhClientId || body.crossReferencedBhId || null,
        crossReferencedBhId: body.bhClientId || body.crossReferencedBhId || null,
        hasPart2Consent: Boolean(body.hasPart2Consent || body.consent42CfrPart2),
        consent42CfrPart2: Boolean(body.hasPart2Consent || body.consent42CfrPart2),
      },
    });

    return NextResponse.json({
      success: true,
      patient: {
        id: created.id,
        mrn: created.mrn,
        name: created.name,
        dob: created.dateOfBirth.toISOString().split('T')[0],
        gender: created.gender,
        primaryInsurance: created.primaryInsurance,
        crossReferencedBhId: created.crossReferencedBhId,
        consent42CfrPart2: created.consent42CfrPart2,
      },
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create medical patient' },
      { status: 500 }
    );
  }
}

