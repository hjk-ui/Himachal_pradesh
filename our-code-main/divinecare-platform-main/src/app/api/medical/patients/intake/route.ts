import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

const intakeSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  legalName: z.string().optional(),
  preferredName: z.string().optional(),
  dob: z.string(),
  gender: z.string().optional(),
  sexAtBirth: z.string().optional(),
  genderIdentity: z.string().optional(),
  race: z.string().optional(),
  language: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  emergencyName: z.string().optional(),
  emergencyPhone: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  primaryInsurance: z.string().optional(),
  primaryPayer: z.string().optional(),
  primaryPolicyId: z.string().optional(),
  memberId: z.string().optional(),
  groupNumber: z.string().optional(),
  secondaryInsurance: z.string().optional(),
  secondaryPayer: z.string().optional(),
  secondaryMemberId: z.string().optional(),
  assignedPcp: z.string().optional().default(''),
  pmh: z.array(z.string()).optional(),
  checkedPmh: z.array(z.string()).optional(),
  medications: z.array(z.object({
    name: z.string(),
    dose: z.string().optional(),
    frequency: z.string().optional(),
    freq: z.string().optional(),
    indication: z.string().optional(),
  })).optional(),
  medsList: z.array(z.object({
    name: z.string(),
    dose: z.string().optional(),
    freq: z.string().optional(),
    frequency: z.string().optional(),
    indication: z.string().optional(),
  })).optional(),
  allergies: z.array(z.object({
    substance: z.string(),
    reaction: z.string().optional(),
    severity: z.string().optional(),
  })).optional(),
  allergiesList: z.array(z.object({
    substance: z.string(),
    reaction: z.string().optional(),
    severity: z.string().optional(),
  })).optional(),
  consents: z.record(z.string(), z.any()).optional(),
  hasPart2Consent: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = intakeSchema.parse(await req.json());

    // 1. Extract firstName & lastName from legalName if not provided
    let firstName = body.firstName || '';
    let lastName = body.lastName || '';
    if (!firstName && !lastName && body.legalName) {
      const parts = body.legalName.trim().split(/\s+/);
      firstName = parts[0] || 'Patient';
      lastName = parts.slice(1).join(' ') || 'Unknown';
    } else if (!firstName) {
      firstName = body.preferredName || 'Patient';
    }
    const fullName = body.legalName || `${firstName} ${lastName}`.trim();
    const dob = new Date(body.dob);
    if (!fullName || Number.isNaN(dob.getTime())) {
      return NextResponse.json({ success: false, error: 'Name and date of birth are required' }, { status: 400 });
    }

    // 2. Map sexAtBirth to gender
    const gender = body.gender || body.sexAtBirth || body.genderIdentity || 'Unknown';

    // 3. Map primaryPayer to primaryInsurance, memberId to primaryPolicyId
    const primaryPayer = body.primaryInsurance || body.primaryPayer || null;
    const primaryPolicyId = body.primaryPolicyId || body.memberId || null;
    const secondaryPayer = body.secondaryInsurance || body.secondaryPayer || null;

    // 4. Map emergency contact
    const emergencyName = body.emergencyContactName || body.emergencyName || null;
    const emergencyPhone = body.emergencyContactPhone || body.emergencyPhone || null;
    const emergencyContactFormatted = emergencyName
      ? `${emergencyName}${emergencyPhone ? ` - ${emergencyPhone}` : ''}`
      : null;

    // 5. Map medsList to medications & allergiesList to allergies & checkedPmh to pmh
    const rawMeds = body.medications || body.medsList || [];
    const rawAllergies = body.allergies || body.allergiesList || [];
    const rawPmh = body.pmh || body.checkedPmh || [];

    // Generate unique MRN e.g. MED-84912
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const mrn = `MED-${randomSuffix}`;

    const newPatient = await prisma.medicalPatient.create({
      data: {
        organizationId: gate.organizationId,
        mrn,
        name: fullName,
        dateOfBirth: dob,
        gender,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address
          ? `${body.address}${body.city ? `, ${body.city}` : ''}${body.state ? ` ${body.state}` : ''}${body.zip ? ` ${body.zip}` : ''}`.trim()
          : null,
        emergencyContact: emergencyContactFormatted,
        primaryPayer,
        secondaryPayer,
        assignedPcp: body.assignedPcp,
        hasPart2Consent: body.hasPart2Consent,
      },
    });

    // Also create or sync Client record for integrated care
    const clientRecord = await prisma.client.create({
      data: {
        name: fullName,
        mrn,
        organizationId: gate.organizationId,
        dateOfBirth: dob,
        gender,
        phone: body.phone || null,
        email: body.email || null,
        insurancePayer: primaryPayer,
        insuranceMemberId: primaryPolicyId,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
        status: 'ACTIVE',
      },
    });

    // Save initial medications in ClientMedication table
    if (rawMeds && rawMeds.length > 0) {
      for (const med of rawMeds) {
        if (!med.name || !med.name.trim()) continue;
        await prisma.clientMedication.create({
          data: {
            clientId: clientRecord.id,
            medicationName: med.name,
            dosage: med.dose || 'Standard',
            frequency: med.frequency || med.freq || 'Once daily',
            indication: med.indication || 'Intake baseline',
            active: true,
          },
        });
      }
    }

    // Save PMH as active MedicalProblems
    if (rawPmh && rawPmh.length > 0) {
      for (const condition of rawPmh) {
        if (!condition || !condition.trim()) continue;
        await prisma.medicalProblem.create({
          data: {
            clientId: clientRecord.id,
            name: condition,
            icd10Code: condition.includes('HTN') || condition.includes('Hypertension')
              ? 'I10'
              : condition.includes('Diabetes')
              ? 'E11.9'
              : 'Z87.898',
            status: 'Active',
            isChronic: true,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      patientId: newPatient.id,
      clientId: clientRecord.id,
      mrn: newPatient.mrn,
      patient: newPatient,
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not complete medical intake' },
      { status: 400 }
    );
  }
}
