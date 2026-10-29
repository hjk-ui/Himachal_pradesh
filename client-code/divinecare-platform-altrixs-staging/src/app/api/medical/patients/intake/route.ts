import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { allergenTypeSchema, optionalDrugCode, rxcuiSchema } from '@/lib/drugs/resolve';
import { allergyCodeFields, medicationCodeFields } from '@/lib/drugs/types';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { primaryCareLocationWhere } from '@/lib/medical/medicalProgram';
import { addTeamMember } from '@/services/treatmentTeamService';
import { loadPcpContext, pcpChoices, setPrimaryCareProvider } from '@/lib/medical/pcpAssignmentDb';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import { clientNameFromLegal, legalNameFields, normalizeMiddleInitial, parseLegalNameSource } from '@/lib/clients/legalName';
import {
  addressContactFields,
  demographicFields,
  demographicUpdateData,
  legacyGenderFromSex,
  normalizeStateCode,
  normalizeUsZip,
} from '@/lib/clients/demographics';

const INTAKE_TEAM_ROLE: Record<string, string> = {
  PHYSICIAN: 'Primary Care Physician',
  MEDICAL_NP: 'Primary Care NP',
  MEDICAL_ASSISTANT: 'Medical Assistant',
};

export const runtime = 'nodejs';

const INTAKE_PATH = '/dashboard/medical/patients/intake';

/** Active org locations that offer primary care (Silver Spring / Bowie; medicalProgram.ts) */
function primaryCareLocations(organizationId: string) {
  return prisma.location.findMany({
    where: { AND: [{ organizationId, active: true }, primaryCareLocationWhere()] },
    select: { id: true, name: true, city: true },
    orderBy: { name: 'asc' },
  });
}

/** GET: the location and PCP choices for primary-care intake (no patient data) */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, INTAKE_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const [locations, ctx] = await Promise.all([primaryCareLocations(gate.organizationId), loadPcpContext(gate.organizationId)]);
  // PCP choices: active physicians / medical NPs (src/lib/medical/pcpAssignment.ts)
  return NextResponse.json({ success: true, locations, providers: pcpChoices(ctx) });
}

const intakeSchema = z.object({
  /** Structured legal name (preferred). firstName / lastName / legalName kept for older clients. */
  legalFirstName: z.string().trim().max(80).optional(),
  middleInitial: legalNameFields.middleInitial,
  legalLastName: z.string().trim().max(80).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  /** Only a deterministic "Last, First M" is split; anything else must come as separate parts */
  legalName: z.string().optional(),
  preferredName: z.string().optional(),
  dob: z.string(),
  /** Coded demographics (src/lib/clients/demographics.ts). Free-text legacy values are not accepted. */
  administrativeSex: demographicFields.administrativeSex,
  sexAtBirth: demographicFields.sexAtBirth,
  genderIdentity: demographicFields.genderIdentity,
  sexualOrientation: demographicFields.sexualOrientation,
  pronouns: demographicFields.pronouns,
  race: demographicFields.race,
  ethnicity: demographicFields.ethnicity,
  preferredLanguage: demographicFields.preferredLanguage,
  interpreterNeeded: demographicFields.interpreterNeeded,
  phone: addressContactFields.phone,
  email: z.string().optional(),
  /** Street address (line 1); `address` stays the single-line form for older clients */
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: addressContactFields.state,
  zip: addressContactFields.postalCode,
  emergencyContactRelationship: demographicFields.emergencyContactRelationship,
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
  /** legacy free text; ignored when pcpUserId is sent (the PCP is the care team member) */
  assignedPcp: z.string().optional(),
  /** Required: the primary care provider (an active physician / medical NP in this org) */
  pcpUserId: z.string().trim().max(64).optional(),
  pmh: z.array(z.string()).optional(),
  checkedPmh: z.array(z.string()).optional(),
  medications: z.array(z.object({
    name: z.string(),
    dose: z.string().optional(),
    frequency: z.string().optional(),
    freq: z.string().optional(),
    indication: z.string().optional(),
    /** RxCUI (strength + form) from the drug typeahead (MUM2-MUM4) */
    rxcui: rxcuiSchema.optional().nullable(),
  })).optional(),
  medsList: z.array(z.object({
    name: z.string(),
    dose: z.string().optional(),
    freq: z.string().optional(),
    frequency: z.string().optional(),
    indication: z.string().optional(),
    /** RxCUI (strength + form) from the drug typeahead (MUM2-MUM4) */
    rxcui: rxcuiSchema.optional().nullable(),
  })).optional(),
  allergies: z.array(z.object({
    substance: z.string(),
    reaction: z.string().optional(),
    severity: z.string().optional(),
    allergenType: allergenTypeSchema.optional().nullable(),
    /** RxCUI of the drug ingredient (AUM2) */
    rxcui: rxcuiSchema.optional().nullable(),
  })).optional(),
  allergiesList: z.array(z.object({
    substance: z.string(),
    reaction: z.string().optional(),
    severity: z.string().optional(),
    allergenType: allergenTypeSchema.optional().nullable(),
    /** RxCUI of the drug ingredient (AUM2) */
    rxcui: rxcuiSchema.optional().nullable(),
  })).optional(),
  consents: z.record(z.string(), z.any()).optional(),
  hasPart2Consent: z.boolean().optional().default(false),
  /** primary-care location (must be one of the org's Silver Spring / Bowie locations) */
  locationId: z.string().trim().min(1).optional(),
  /** set after staff confirmed a same-name / same-DOB client is a different person */
  confirmNewClient: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, INTAKE_PATH)) {
    await auditPhiAccess({ gate, req, action: 'CREATE', outcome: 'DENIED', resourceType: 'medicalIntake', resourceId: null, metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = intakeSchema.parse(await req.json());

    // Location: one of the primary-care locations only. Picked by staff when there is more than
    // one; never defaulted to a location the patient was not registered at.
    const choices = await primaryCareLocations(gate.organizationId);
    let locationId: string | null = null;
    if (body.locationId) {
      if (!choices.some((l) => l.id === body.locationId)) {
        return NextResponse.json({ success: false, error: 'Choose a primary care location (Silver Spring or Bowie).' }, { status: 400 });
      }
      locationId = body.locationId;
    } else if (choices.length === 1) {
      locationId = choices[0].id;
    } else if (choices.length > 1) {
      return NextResponse.json({ success: false, error: 'Choose the primary care location for this patient.' }, { status: 400 });
    }

    // PCP: required at primary care intake, one of the org's active physicians / medical NPs
    const pcpId = (body.pcpUserId || '').trim();
    const pcpCtx = await loadPcpContext(gate.organizationId);
    const pcpChoice = pcpChoices(pcpCtx).find((p) => p.id === pcpId);
    if (!pcpChoice) {
      return NextResponse.json({ success: false, error: 'Choose the primary care provider (PCP): an active physician or medical NP.' }, { status: 400 });
    }

    // 1. Legal name: separate parts, or a deterministic "Last, First M" only. Never invented / guessed.
    let firstName = (body.legalFirstName || body.firstName || '').trim();
    let lastName = (body.legalLastName || body.lastName || '').trim();
    let middleInitial = normalizeMiddleInitial(body.middleInitial);
    if (!firstName && !lastName && body.legalName) {
      const parsed = parseLegalNameSource(body.legalName);
      if (parsed.ok) {
        firstName = parsed.firstName;
        lastName = parsed.lastName;
        middleInitial = middleInitial || parsed.middleInitial;
      }
    }
    if (!firstName || !lastName) {
      return NextResponse.json({ success: false, error: 'Enter the legal first and last name (as on the insurance card or ID).' }, { status: 400 });
    }
    const fullName = clientNameFromLegal({ legalFirstName: firstName, legalLastName: lastName });

    // 2. Sex as on the insurance card / ID (X12 / Rcopia). Required here, never defaulted; "U" is a choice.
    const administrativeSex = body.administrativeSex || null;
    if (!administrativeSex) {
      return NextResponse.json({ success: false, error: 'Sex (as on the insurance card or ID) is required; choose "Unknown" if it is not on the card.' }, { status: 400 });
    }
    const gender = legacyGenderFromSex(administrativeSex)!;
    const structured = demographicUpdateData({
      sexAtBirth: body.sexAtBirth,
      genderIdentity: body.genderIdentity,
      sexualOrientation: body.sexualOrientation,
      pronouns: body.pronouns,
      race: body.race ?? undefined,
      ethnicity: body.ethnicity,
      preferredLanguage: body.preferredLanguage,
      interpreterNeeded: body.interpreterNeeded,
      emergencyContactRelationship: body.emergencyContactRelationship,
    });
    const addressLine1 = (body.addressLine1 || '').trim() || null;
    const addressLine2 = (body.addressLine2 || '').trim() || null;
    const city = (body.city || '').trim() || null;
    const state = normalizeStateCode(body.state) ?? null;
    const zip = normalizeUsZip(body.zip) ?? null;

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
    // Drug codes picked in the typeahead, resolved from RxNav before anything is written.
    // RxNav down -> those rows are saved as free text and coded later from the chart.
    const medCodes = await Promise.all(rawMeds.map((m) => optionalDrugCode(m.rxcui, 'medication')));
    const allergyCodes = await Promise.all(
      rawAllergies.map((a) => (a.allergenType && a.allergenType !== 'drug' ? Promise.resolve({ code: null }) : optionalDrugCode(a.rxcui, 'allergy'))),
    );
    const badCode = [...medCodes, ...allergyCodes].find((c) => 'invalid' in c && c.invalid);
    if (badCode && 'invalid' in badCode) return NextResponse.json({ success: false, error: badCode.invalid }, { status: 400 });
    const drugCodeWarning = [...medCodes, ...allergyCodes].some((c) => 'warning' in c && c.warning)
      ? 'Drug lookup unavailable — some medications or allergies were saved without a drug code; code them from the chart.'
      : undefined;
    const rawPmh = body.pmh || body.checkedPmh || [];

    // One patient record: a client with the same name and date of birth is probably this person.
    // Never merge automatically; staff open the existing chart or confirm a separate record.
    const dobDate = new Date(body.dob);
    if (!body.confirmNewClient && !Number.isNaN(dobDate.getTime())) {
      const day = body.dob.slice(0, 10);
      const sameDob = await prisma.client.findMany({
        where: {
          AND: [clientOrgFilter(gate.organizationId)],
          dateOfBirth: { gte: new Date(`${day}T00:00:00.000Z`), lte: new Date(`${day}T23:59:59.999Z`) },
        },
        select: { id: true, name: true, mrn: true, legalFirstName: true, legalLastName: true },
        take: 50,
      });
      const norm = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      const want = norm(fullName);
      const duplicates = sameDob.filter(
        (c) => norm(c.name) === want || (c.legalFirstName && c.legalLastName && norm(`${c.legalFirstName} ${c.legalLastName}`) === want)
      );
      if (duplicates.length) {
        await auditPhiAccess({
          gate,
          req,
          action: 'CREATE',
          outcome: 'DENIED',
          resourceType: 'medicalIntake',
          resourceId: null,
          patientId: duplicates[0].id,
          metadata: { reason: 'possible_duplicate_client', matches: duplicates.map((d) => d.id) },
        });
        return NextResponse.json(
          {
            success: false,
            error: 'A client with this name and date of birth already exists. Open that chart, or confirm this is a different person.',
            duplicates: duplicates.map((d) => ({ id: d.id, name: d.name, mrn: d.mrn })),
          },
          { status: 409 }
        );
      }
    }

    // Generate unique MRN e.g. MED-84912
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const mrn = `MED-${randomSuffix}`;

    const newPatient = await prisma.medicalPatient.create({
      data: {
        organizationId: gate.organizationId,
        mrn,
        name: fullName,
        dateOfBirth: new Date(body.dob),
        gender,
        phone: body.phone || null,
        email: body.email || null,
        address: addressLine1
          ? [[addressLine1, addressLine2].filter(Boolean).join(' '), city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
          : body.address
            ? `${body.address}${body.city ? `, ${body.city}` : ''}${body.state ? ` ${body.state}` : ''}${body.zip ? ` ${body.zip}` : ''}`.trim()
            : null,
        emergencyContact: emergencyContactFormatted,
        primaryPayer,
        secondaryPayer,
        // Mirror of the PCP care team member's name (set below); never free text
        assignedPcp: pcpChoice.name,
        hasPart2Consent: body.hasPart2Consent,
      },
    });

    // Also create or sync Client record for integrated care
    const clientRecord = await prisma.client.create({
      data: {
        name: fullName,
        legalFirstName: firstName,
        middleInitial,
        legalLastName: lastName,
        preferredName: (body.preferredName || '').trim() || null,
        mrn,
        organizationId: gate.organizationId,
        dateOfBirth: new Date(body.dob),
        gender,
        administrativeSex,
        ...structured,
        // Structured address on the chart (the single-line form only feeds the legacy medical record)
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode: zip,
        phone: body.phone || null,
        email: body.email || null,
        insurancePayer: primaryPayer,
        insuranceMemberId: primaryPolicyId,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
        locationId,
        // Primary-care patient marker (medicalProgram.primaryCarePatientWhere); location alone never counts
        primaryCare: true,
        status: 'ACTIVE',
      },
    });

    // Save initial medications in ClientMedication table
    if (rawMeds && rawMeds.length > 0) {
      for (const [i, med] of rawMeds.entries()) {
        if (!med.name || !med.name.trim()) continue;
        const medCode = medCodes[i]?.code;
        await prisma.clientMedication.create({
          data: {
            clientId: clientRecord.id,
            medicationName: med.name.trim(),
            // Only what the patient reported; nothing is filled in
            dosage: med.dose?.trim() || '',
            frequency: (med.frequency || med.freq)?.trim() || null,
            indication: med.indication?.trim() || null,
            active: true,
            ...(medCode ? medicationCodeFields(medCode) : {}),
          },
        });
      }
    }

    // A primary care team member who did the intake goes on the treatment team (a fact, not an
    // assignment), so the care-team access rule lets them open the chart they just created.
    const teamRole = INTAKE_TEAM_ROLE[String(normalizeStaffRole(gate.role))];
    if (teamRole) {
      const actor = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true } });
      await addTeamMember({
        clientId: clientRecord.id,
        providerId: gate.userId,
        name: actor?.name || 'Primary care staff',
        role: teamRole,
        assignedBy: 'primary-care-intake',
      }).catch((err) => console.error('[medical/intake] treatment team add failed', err instanceof Error ? err.name : 'error'));
    }

    // The PCP: "Primary Care Provider" care team member (canonical; pcpAssignment.ts), audited.
    // Behavioral health assignment (assignedToId) is not set here.
    const pcpSet = await setPrimaryCareProvider({
      organizationId: gate.organizationId,
      clientId: clientRecord.id,
      newUserId: pcpChoice.id,
      actor: { userId: gate.userId, role: gate.role, via: 'intake' },
      requestMeta: auditRequestMeta(req),
    }).catch((err) => {
      console.error('[medical/intake] PCP assignment failed', err instanceof Error ? err.name : 'error');
      return null;
    });

    // Link the medical patient to its client so chart writes resolve without an MRN lookup
    await prisma.medicalPatient.update({
      where: { id: newPatient.id },
      data: { bhClientId: clientRecord.id },
    });

    // Save intake allergies (previously collected by the wizard but dropped)
    if (Array.isArray(rawAllergies) && rawAllergies.length > 0) {
      for (const [i, allergy] of rawAllergies.entries()) {
        const allergen = String(allergy?.substance || '').trim();
        const allergyCode = allergyCodes[i]?.code;
        if (!allergen) continue;
        await prisma.medicalAllergy.create({
          data: {
            patientId: newPatient.id,
            clientId: clientRecord.id,
            allergen,
            reaction: String(allergy?.reaction || '').trim() || null,
            // Keep a recognised severity if one was sent; never default it to Moderate.
            severity: ['Severe/Anaphylaxis', 'Moderate', 'Mild'].includes(String(allergy?.severity))
              ? String(allergy?.severity)
              : 'Unspecified',
            status: 'Active',
            allergenType: allergy?.allergenType || (allergyCode ? 'drug' : null),
            ...(allergyCode ? allergyCodeFields(allergyCode) : {}),
          },
        });
      }
    }

    // Save PMH as active MedicalProblems, UNCODED: the checklist is patient-reported text, so no
    // ICD-10 code is guessed. icd10Code null = "needs coding" in the problem list until a provider
    // sets it. Chronicity is not assumed either.
    if (rawPmh && rawPmh.length > 0) {
      for (const condition of rawPmh) {
        if (!condition || !condition.trim()) continue;
        await prisma.medicalProblem.create({
          data: {
            clientId: clientRecord.id,
            patientId: newPatient.id,
            name: condition.trim(),
            icd10Code: null,
            status: 'Active',
            notes: 'Reported at primary care intake; needs coding',
          },
        });
      }
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'medicalIntake',
      resourceId: newPatient.id,
      patientId: clientRecord.id,
      metadata: {
        medicalPatientId: newPatient.id,
        fields: Object.keys(body),
        medicationsSubmitted: rawMeds.length,
        allergiesSubmitted: Array.isArray(rawAllergies) ? rawAllergies.length : 0,
        problemsSubmitted: rawPmh.length,
        problemsUncoded: rawPmh.filter((c) => c && c.trim()).length,
        medicationsCoded: medCodes.filter((c) => c.code).length,
        allergiesCoded: allergyCodes.filter((c) => c.code).length,
        locationId,
        pcpProviderId: pcpChoice.id,
        pcpSet: Boolean(pcpSet && pcpSet.ok),
      },
    });

    return NextResponse.json({
      success: true,
      patientId: newPatient.id,
      clientId: clientRecord.id,
      mrn: newPatient.mrn,
      patient: newPatient,
      ...(drugCodeWarning ? { warning: drugCodeWarning } : {}),
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof z.ZodError ? err.issues[0]?.message || 'Invalid intake form' : 'Could not complete medical intake' },
      { status: 400 }
    );
  }
}
