import { NextResponse } from 'next/server';
import { applyLegacyDiagnosisEdit } from '@/lib/diagnoses/store';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { isCaseloadRole } from '@/types/roles';
import { hasCareTeamLink } from '@/lib/clients/chartAccess';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';
import { syncTeamSlotsToMembers } from '@/lib/clients/teamAccess';
import { invalidateCaseloadScopedCaches } from '@/lib/perf/cache';
import { canAccessClientRoster, canAssignPatientToClinician, canEditClinicMrn, canEditClientProfile, canEditClientDiagnoses, canEditClientRiskLevel, canSeeClientCheckIns, canSeeClientDiagnoses, canSeeClientInsurance, clientByIdWhere } from '@/lib/clients/orgScope';
import { threadAssigneeOr } from '@/lib/messages/assignee';
import { assertMrnAvailable, ensureClientMrn } from '@/lib/clients/mrn';
import { maskClientPii } from '@/lib/privacy/pii';
import {
  assertClientPhiAccess,
  SensitiveRecordAccessError,
} from '@/lib/privacy/sensitiveAccess';
import { optionalCuid } from '@/lib/validation/optionalCuid';
import { syncPatientAccountEmail } from '@/patient';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientNameFromLegal, hasLegalName, legalNameFields, normalizeMiddleInitial, preferredNameFields } from '@/lib/clients/legalName';
import {
  addressContactFields,
  DEMOGRAPHIC_FIELD_KEYS,
  demographicFields,
  demographicUpdateData,
  legacyGenderFromSex,
  normalizeStateCode,
  normalizeUsZip,
  structuredDemographicsOf,
} from '@/lib/clients/demographics';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';

/** Structured demographic columns returned after an update */
const STRUCTURED_SELECT = Object.fromEntries(
  [...DEMOGRAPHIC_FIELD_KEYS, 'needsNameReview', 'nameReviewReason'].map((k) => [k, true])
) as Record<(typeof DEMOGRAPHIC_FIELD_KEYS)[number] | 'needsNameReview' | 'nameReviewReason', true>;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  // Structured name (DrFirst sync; treatment plan header in Valant's name format)
  ...legalNameFields,
  ...preferredNameFields,
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable(),
  dateOfBirth: z.string().trim().optional().nullable(),
  gender: z.string().trim().max(50).optional().nullable(),
  addressLine1: z.string().trim().max(250).optional().nullable(),
  addressLine2: z.string().trim().max(250).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(50).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  emergencyContactName: z.string().trim().max(200).optional().nullable(),
  emergencyContactPhone: z.string().trim().max(50).optional().nullable(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high']).optional(),
  primaryDiagnosis: z.string().trim().max(250).optional().nullable(),
  primaryDiagnosisCode: z.string().trim().max(50).optional().nullable(),
  secondaryDiagnoses: z.string().trim().max(500).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCHARGED']).optional(),
  assignedToId: optionalCuid,
  insurancePayer: z.string().trim().max(120).optional().nullable(),
  insuranceMemberId: z.string().trim().max(120).optional().nullable(),
  insuranceGroupNumber: z.string().trim().max(120).optional().nullable(),
  /** Clinic MRN — Admin / Practice Director only; must be unique in org */
  mrn: z.string().trim().min(4).max(40).optional().nullable(),
  treatmentTeam: z
    .union([
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          role: z.string(),
          initials: z.string().optional(),
          color: z.string().optional(),
          primary: z.boolean().optional(),
        })
      ),
      z.object({
        primaryTherapistId: z.string().optional(),
        primaryTherapistName: z.string().optional(),
        prescriberId: z.string().optional(),
        prescriberName: z.string().optional(),
        caseManagerId: z.string().optional(),
        caseManagerName: z.string().optional(),
        prpSpecialistId: z.string().optional(),
        prpSpecialistName: z.string().optional(),
        peerSupportId: z.string().optional(),
        peerSupportName: z.string().optional(),
        copay: z.object({ amount: z.number(), unit: z.literal('USD') }).optional(),
      }).passthrough(),
    ])
    .optional()
    .nullable(),
  hieLastQueryAt: z.string().datetime().optional().nullable(),
  // Standard demographics (code sets in src/lib/clients/demographics.ts); state / ZIP / phones validated
  ...demographicFields,
  ...addressContactFields,
});

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { id } = await ctx.params;
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(id, gate.organizationId),
    include: {
      location: { select: { id: true, name: true, organizationId: true } },
      assignedTo: { select: { id: true, name: true } },
      checkIns: {
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, mood: true, stress: true, sleep: true, note: true, createdAt: true },
      },
      patientAccount: {
        select: {
          id: true,
          email: true,
          status: true,
          updatedAt: true,
          inviteExpiresAt: true,
        },
      },
      _count: { select: { appointments: true } },
    },
  });

  if (!client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }

  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId: id,
      path: `/api/clients/${id}`,
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'patient', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'sensitive_record' } });
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }

  // Ensure legacy clients get a durable org-scoped MRN
  let mrn = client.mrn;
  if (!mrn || !client.organizationId) {
    try {
      const ensured = await ensureClientMrn(client.id);
      mrn = ensured.mrn;
    } catch (err) {
      console.error('[clients GET] MRN ensure failed', id, err);
    }
  }

  if (!canAccessClientRoster(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  // Caseload roles: primary assignee, else the care-team rule below (same as the list and chart)
  const primaryOrOrgWide =
    !isCaseloadScoped({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId }) || client.assignedToId === gate.userId;
  if (!primaryOrOrgWide) {
    // Sensitive + BTG/whitelist already cleared assertClientPhiAccess above — allow PHI reveal.
    const protectedRec = await prisma.sensitiveRecord.findFirst({
      where: { clientId: id, organizationId: gate.organizationId },
      select: { id: true },
    });
    // Every caseload role: care-team link (treatment team member, recent / upcoming appointment
    // clinician; medical also MedicalVisit; peer: treatment team), same rule as the list and chart
    const careTeam = !protectedRec
      ? await hasCareTeamLink({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, id)
      : false;
    if (!protectedRec && !careTeam) {
      const actorName = gate.session.user.name?.trim();
      const hasForwardedThread = await prisma.messageThread.findFirst({
        where: {
          clientId: id,
          organizationId: gate.organizationId,
          // Exact (case-insensitive) name / id match, never a substring
          OR: threadAssigneeOr({ userId: gate.userId, name: actorName }),
        },
      });
      if (!hasForwardedThread) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  const riskMap = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' } as const;
  const moods = client.checkIns.map((c) => c.mood);
  const stresses = client.checkIns.map((c) => c.stress);
  const sleeps = client.checkIns
    .map((c) => c.sleep)
    .filter((s): s is number => s != null);
  const avgMood = moods.length
    ? Math.round(moods.reduce((a, b) => a + b, 0) / moods.length)
    : null;
  const avgStress = stresses.length
    ? Math.round(stresses.reduce((a, b) => a + b, 0) / stresses.length)
    : null;
  const avgSleep = sleeps.length
    ? Math.round(sleeps.reduce((a, b) => a + b, 0) / sleeps.length)
    : null;

  const shared = {
    id: client.id,
    mrn: mrn ?? null,
    name: client.name,
    legalFirstName: client.legalFirstName ?? null,
    middleInitial: client.middleInitial ?? null,
    legalLastName: client.legalLastName ?? null,
    preferredName: client.preferredName ?? null,
    nameSuffix: client.nameSuffix ?? null,
    email: client.email ?? '',
    phone: client.phone ?? '',
    image: client.image,
    status: client.status,
    risk: riskMap[client.riskLevel],
    riskLevel: client.riskLevel,
    locationName: client.location?.name ?? null,
    assignedToName: client.assignedTo?.name ?? null,
    assignedToId: client.assignedToId,
    assignedSince: client.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    checkInStreak: client.checkInStreak,
    streak: client.checkInStreak,
    totalSessions: client._count.appointments,
    treatmentTeam: client.treatmentTeam ?? null,
    hieLastQueryAt: client.hieLastQueryAt?.toISOString() ?? null,
    patientAccount: client.patientAccount
      ? {
          id: client.patientAccount.id,
          email: client.patientAccount.email,
          status: client.patientAccount.status,
          isInvited: client.patientAccount.status === 'INVITED',
          isActive: client.patientAccount.status === 'ACTIVE',
          inviteExpired: client.patientAccount.inviteExpiresAt
            ? new Date(client.patientAccount.inviteExpiresAt).getTime() < Date.now()
            : false,
        }
      : null,
    appAccess: client.patientAccount?.status === 'ACTIVE'
      ? ('active' as const)
      : client.patientAccount?.status === 'INVITED'
        ? ('invite_sent' as const)
        : ('none' as const),
  };

  const isClinicalDetailView =
    gate.role === 'SUPER_ADMIN' ||
    gate.role === 'ADMIN' ||
    gate.role === 'DIRECTOR' ||
    gate.role === 'PRACTICE_DIRECTOR' ||
    gate.role === 'OFFICE_MANAGER' ||
    gate.role === 'FRONT_DESK' ||
    isCaseloadRole(gate.role);

  // Peer Support: no diagnoses or insurance / copay detail (orgScope.canSeeClientInsurance)
  const peerView = !canSeeClientInsurance(gate.role);
  // BH diagnoses: care team + leadership (Billing reads codes on claims). Not Front Desk / Office
  // Manager / primary care. Check-in scores and the patient's check-in notes: BH care team only.
  const dxHidden = !canSeeClientDiagnoses(gate.role);
  const checkInsHidden = !canSeeClientCheckIns(gate.role);
  const detail = isClinicalDetailView
    ? {
        ...shared,
        dateOfBirth: client.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        gender: client.gender,
        ...structuredDemographicsOf(client),
        // Peer Support: no sexual orientation, guarantor or Medicaid number (minimum necessary)
        ...(peerView
          ? { sexualOrientation: null, medicaidId: null, guarantorFirstName: null, guarantorLastName: null, guarantorRelationship: null, guarantorDateOfBirth: null, guarantorPhone: null, guarantorAddressLine1: null, guarantorAddressLine2: null, guarantorCity: null, guarantorState: null, guarantorPostalCode: null }
          : {}),
        addressLine1: client.addressLine1,
        addressLine2: client.addressLine2,
        city: client.city,
        state: client.state,
        postalCode: client.postalCode,
        emergencyContactName: client.emergencyContactName,
        emergencyContactPhone: client.emergencyContactPhone,
        phoneSecondary: client.phoneSecondary,
        insurancePayer: peerView ? null : client.insurancePayer,
        insuranceMemberId: peerView ? null : client.insuranceMemberId,
        insuranceGroupNumber: peerView ? null : client.insuranceGroupNumber,
        insuranceType: peerView ? null : client.insuranceType,
        insuranceCoverageType: peerView ? null : client.insuranceCoverageType,
        insurancePayerPhone: peerView ? null : client.insurancePayerPhone,
        insuranceEffectiveFrom: peerView ? null : client.insuranceEffectiveFrom?.toISOString().slice(0, 10) ?? null,
        insuranceEffectiveTo: peerView ? null : client.insuranceEffectiveTo?.toISOString().slice(0, 10) ?? null,
        copayAmount: peerView ? null : client.copayAmount != null ? Number(client.copayAmount) : null,
        primaryDiagnosis: dxHidden ? null : client.primaryDiagnosis,
        primaryDiagnosisCode: dxHidden ? null : client.primaryDiagnosisCode,
        secondaryDiagnoses: dxHidden ? null : client.secondaryDiagnoses,
        avgMood: checkInsHidden ? null : avgMood,
        avgStress: checkInsHidden ? null : avgStress,
        avgSleep: checkInsHidden ? null : avgSleep,
        checkIns: (checkInsHidden ? [] : client.checkIns)
          .slice()
          .reverse()
          .map((c) => ({
            id: c.id,
            date: c.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            dateKey: c.createdAt.toISOString().slice(0, 10),
            mood: c.mood,
            stress: c.stress,
            sleep: c.sleep ?? null,
            note: c.note,
            createdAt: c.createdAt.toISOString(),
          })),
      }
    : {
        ...shared,
        // Billing view: what claims need (legal name is in shared; sex, Medicaid number, guarantor)
        administrativeSex: client.administrativeSex,
        needsNameReview: client.needsNameReview,
        medicaidId: client.medicaidId,
        guarantorFirstName: client.guarantorFirstName,
        guarantorLastName: client.guarantorLastName,
        guarantorRelationship: client.guarantorRelationship,
        insurancePayer: client.insurancePayer,
        insuranceMemberId: client.insuranceMemberId,
        insuranceGroupNumber: client.insuranceGroupNumber,
        insuranceType: client.insuranceType,
        insuranceCoverageType: client.insuranceCoverageType,
        insurancePayerPhone: client.insurancePayerPhone,
        insuranceEffectiveFrom: client.insuranceEffectiveFrom?.toISOString().slice(0, 10) ?? null,
        insuranceEffectiveTo: client.insuranceEffectiveTo?.toISOString().slice(0, 10) ?? null,
        copayAmount: client.copayAmount != null ? Number(client.copayAmount) : null,
      };
  // Peer Support: no diagnoses either (insurance is already null above)
  if (peerView && 'primaryDiagnosis' in detail) {
    Object.assign(detail, { primaryDiagnosis: null, primaryDiagnosisCode: null, secondaryDiagnoses: null });
  }

  await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'patient', resourceId: id, patientId: id, metadata: { view: isClinicalDetailView ? 'clinical' : 'basic' } });
  return NextResponse.json({
    success: true,
    client: maskClientPii(detail, gate.role),
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const canPatchOps = canEditClientProfile(gate.role);
  const canPatchInsurance =
    canPatchOps || gate.role === 'BILLING';

  if (!canPatchInsurance) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    // Diagnoses and the clinical risk level are clinical determinations: only licensed BH clinicians
    // / leadership change diagnoses (crisis responders also the risk level). Other profile editors
    // (Front Desk, Office Manager, PRP, case managers, primary care) send the full profile form, so
    // these fields are dropped for them rather than refusing the whole demographics update.
    if (!canEditClientDiagnoses(gate.role)) {
      delete (body as Record<string, unknown>).primaryDiagnosis;
      delete (body as Record<string, unknown>).primaryDiagnosisCode;
      delete (body as Record<string, unknown>).secondaryDiagnoses;
    }
    if (!canEditClientRiskLevel(gate.role)) delete (body as Record<string, unknown>).riskLevel;

    const hasStatusOrAssignee =
      body.status !== undefined || body.assignedToId !== undefined;
    const hasInsurance =
      body.insurancePayer !== undefined ||
      body.insuranceMemberId !== undefined ||
      body.insuranceGroupNumber !== undefined;
    const hasTeam = body.treatmentTeam !== undefined;
    const hasHie = body.hieLastQueryAt !== undefined;
    const hasMrn = body.mrn !== undefined;
    const hasDemographics =
      body.name !== undefined ||
      body.legalFirstName !== undefined ||
      body.middleInitial !== undefined ||
      body.legalLastName !== undefined ||
      body.preferredName !== undefined ||
      body.nameSuffix !== undefined ||
      body.email !== undefined ||
      body.phone !== undefined ||
      body.dateOfBirth !== undefined ||
      body.gender !== undefined ||
      body.addressLine1 !== undefined ||
      body.addressLine2 !== undefined ||
      body.city !== undefined ||
      body.state !== undefined ||
      body.postalCode !== undefined ||
      body.emergencyContactName !== undefined ||
      body.emergencyContactPhone !== undefined ||
      body.phoneSecondary !== undefined ||
      DEMOGRAPHIC_FIELD_KEYS.some((k) => body[k] !== undefined) ||
      body.riskLevel !== undefined ||
      body.primaryDiagnosis !== undefined ||
      body.primaryDiagnosisCode !== undefined ||
      body.secondaryDiagnoses !== undefined;

    if ((hasStatusOrAssignee || hasTeam || hasHie || hasDemographics) && !canPatchOps) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (hasMrn && !canEditClinicMrn(gate.role)) {
      return NextResponse.json(
        { success: false, error: 'Only Clinic Admin or Practice Director can change MRN' },
        { status: 403 }
      );
    }

    if (!hasStatusOrAssignee && !hasInsurance && !hasTeam && !hasHie && !hasMrn && !hasDemographics) {
      return NextResponse.json(
        { success: false, error: 'No changes provided' },
        { status: 400 }
      );
    }

    const existing = await prisma.client.findFirst({
      where: clientByIdWhere(id, gate.organizationId),
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    // Caseload roles: on the client's care team (same rule as the list / chart). Treatment-team
    // members and visit clinicians may update the profile fields their role allows; changing the
    // client's status (discharge / reactivate) or the treatment-team structure stays with the
    // primary assigned clinician (or the roles with canAssignPatientToClinician below).
    const caseloadScoped = isCaseloadScoped({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId });
    if (caseloadScoped && !(await caseloadAllows({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, existing))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (caseloadScoped && existing.assignedToId !== gate.userId && ((body.status !== undefined && body.status !== existing.status) || hasTeam)) {
      return NextResponse.json(
        { success: false, error: "Only the client's primary clinician or clinic leadership can change status or the treatment team" },
        { status: 403 }
      );
    }

    if (
      body.assignedToId !== undefined &&
      body.assignedToId !== (existing.assignedToId ?? null) &&
      !canAssignPatientToClinician(gate.role)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Only Admin, Practice Director, Front Desk, or Office Manager can reassign a clinician',
        },
        { status: 403 }
      );
    }

    // Warm handoff / Assign Clinician also requires assign permission when changing primary
    if (
      hasTeam &&
      body.treatmentTeam &&
      !Array.isArray(body.treatmentTeam) &&
      body.treatmentTeam.primaryTherapistId &&
      body.treatmentTeam.primaryTherapistId !== (existing.assignedToId ?? null) &&
      !canAssignPatientToClinician(gate.role)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Only Admin, Practice Director, Front Desk, or Office Manager can reassign a clinician',
        },
        { status: 403 }
      );
    }

    let nextMrn: string | undefined;
    if (hasMrn) {
      if (body.mrn == null || !String(body.mrn).trim()) {
        return NextResponse.json(
          { success: false, error: 'MRN cannot be cleared once assigned' },
          { status: 400 }
        );
      }
      const check = await assertMrnAvailable(gate.organizationId, body.mrn, id);
      if ('error' in check) {
        return NextResponse.json({ success: false, error: check.error }, { status: 409 });
      }
      nextMrn = check.mrn;
    }

    // Diagnosis fields on the profile form: applied to the diagnosis list (src/lib/diagnoses) so
    // rank / status / history stay true; the client-record fields are its derived copy. Unchanged
    // values (the form resends them) are dropped.
    const norm = (v: string | null | undefined) => (v ?? '').trim() || null;
    const dxEdit: Record<string, string | null> = {};
    if (body.primaryDiagnosisCode !== undefined && norm(body.primaryDiagnosisCode) !== norm(existing.primaryDiagnosisCode)) dxEdit.primaryDiagnosisCode = norm(body.primaryDiagnosisCode);
    if (body.primaryDiagnosis !== undefined && norm(body.primaryDiagnosis) !== norm(existing.primaryDiagnosis)) dxEdit.primaryDiagnosis = norm(body.primaryDiagnosis);
    if (body.secondaryDiagnoses !== undefined && norm(body.secondaryDiagnoses) !== norm(existing.secondaryDiagnoses)) dxEdit.secondaryDiagnoses = norm(body.secondaryDiagnoses);
    delete (body as Record<string, unknown>).primaryDiagnosis;
    delete (body as Record<string, unknown>).primaryDiagnosisCode;
    delete (body as Record<string, unknown>).secondaryDiagnoses;
    if (Object.keys(dxEdit).length) {
      const actorUser = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, credentials: true } }).catch(() => null);
      const dx = await applyLegacyDiagnosisEdit(
        { organizationId: gate.organizationId, userId: gate.userId, name: [actorUser?.name, actorUser?.credentials].filter(Boolean).join(', ') || null },
        id,
        dxEdit
      );
      await auditPhiAccess({
        gate, req, action: 'UPDATE', resourceType: 'clientDiagnosis', resourceId: id, patientId: id,
        outcome: dx.ok ? 'SUCCESS' : 'FAILURE',
        metadata: { context: 'client_profile', fields: Object.keys(dxEdit), added: dx.ok ? dx.added : undefined, resolved: dx.ok ? dx.resolved : undefined },
      });
      if (dx.ok === false) return NextResponse.json({ success: false, error: dx.error }, { status: dx.status });
    }

    const primaryFromTeam =
      body.treatmentTeam && !Array.isArray(body.treatmentTeam)
        ? body.treatmentTeam.primaryTherapistId
        : undefined;
    const assignedToId =
      body.assignedToId !== undefined
        ? body.assignedToId
        : primaryFromTeam
          ? primaryFromTeam
          : undefined;

    if (assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: assignedToId,
          organizationId: gate.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!assignee) {
        return NextResponse.json(
          { success: false, error: 'Assignee not found in your organization' },
          { status: 400 }
        );
      }
    }

    // Legal name: Client.name stays the derived "First Last"; staff saving both legal parts confirms
    // a name that the import / backfill flagged for review.
    const nextFirst = body.legalFirstName !== undefined ? emptyToNull(body.legalFirstName) : existing.legalFirstName;
    const nextLast = body.legalLastName !== undefined ? emptyToNull(body.legalLastName) : existing.legalLastName;
    const legalNameTouched = body.legalFirstName !== undefined || body.legalLastName !== undefined;
    const nameSync =
      legalNameTouched && hasLegalName({ legalFirstName: nextFirst, legalLastName: nextLast })
        ? { name: clientNameFromLegal({ legalFirstName: nextFirst, legalLastName: nextLast }), needsNameReview: false, nameReviewReason: null }
        : {};
    const structured = demographicUpdateData(body);
    // Legacy Client.gender follows the structured sex (the form no longer edits it separately)
    const genderSync =
      body.administrativeSex !== undefined && body.gender === undefined ? { gender: legacyGenderFromSex(emptyToNull(body.administrativeSex)) } : {};

    const client = await prisma.client.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...nameSync,
        ...structured,
        ...genderSync,
        ...(body.phoneSecondary !== undefined ? { phoneSecondary: emptyToNull(body.phoneSecondary) } : {}),
        ...(body.legalFirstName !== undefined ? { legalFirstName: emptyToNull(body.legalFirstName) } : {}),
        ...(body.middleInitial !== undefined ? { middleInitial: normalizeMiddleInitial(body.middleInitial) } : {}),
        ...(body.legalLastName !== undefined ? { legalLastName: emptyToNull(body.legalLastName) } : {}),
        ...(body.preferredName !== undefined ? { preferredName: emptyToNull(body.preferredName) } : {}),
        ...(body.nameSuffix !== undefined ? { nameSuffix: emptyToNull(body.nameSuffix) } : {}),
        ...(body.email !== undefined ? { email: emptyToNull(body.email) } : {}),
        ...(body.phone !== undefined ? { phone: emptyToNull(body.phone) } : {}),
        ...(body.dateOfBirth !== undefined
          ? { dateOfBirth: body.dateOfBirth && body.dateOfBirth.trim() ? new Date(body.dateOfBirth.trim()) : null }
          : {}),
        ...(body.gender !== undefined ? { gender: emptyToNull(body.gender) } : {}),
        ...(body.addressLine1 !== undefined ? { addressLine1: emptyToNull(body.addressLine1) } : {}),
        ...(body.addressLine2 !== undefined ? { addressLine2: emptyToNull(body.addressLine2) } : {}),
        ...(body.city !== undefined ? { city: emptyToNull(body.city) } : {}),
        ...(body.state !== undefined ? { state: normalizeStateCode(body.state) ?? emptyToNull(body.state) } : {}),
        ...(body.postalCode !== undefined ? { postalCode: normalizeUsZip(body.postalCode) ?? emptyToNull(body.postalCode) } : {}),
        ...(body.emergencyContactName !== undefined
          ? { emergencyContactName: emptyToNull(body.emergencyContactName) }
          : {}),
        ...(body.emergencyContactPhone !== undefined
          ? { emergencyContactPhone: emptyToNull(body.emergencyContactPhone) }
          : {}),
        ...(body.riskLevel !== undefined
          ? { riskLevel: String(body.riskLevel).toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' }
          : {}),
        ...(body.primaryDiagnosis !== undefined
          ? { primaryDiagnosis: emptyToNull(body.primaryDiagnosis) }
          : {}),
        ...(body.primaryDiagnosisCode !== undefined
          ? { primaryDiagnosisCode: emptyToNull(body.primaryDiagnosisCode) }
          : {}),
        ...(body.secondaryDiagnoses !== undefined
          ? { secondaryDiagnoses: emptyToNull(body.secondaryDiagnoses) }
          : {}),
        ...(body.status
          ? { status: body.status, active: body.status === 'ACTIVE' }
          : {}),
        // assignedSince only moves when the primary clinician actually changes (the profile form resends it)
        ...(assignedToId !== undefined
          ? (assignedToId ?? null) !== (existing.assignedToId ?? null)
            ? { assignedToId, assignedSince: new Date() }
            : { assignedToId }
          : {}),
        ...(body.insurancePayer !== undefined
          ? { insurancePayer: emptyToNull(body.insurancePayer) }
          : {}),
        ...(body.insuranceMemberId !== undefined
          ? { insuranceMemberId: emptyToNull(body.insuranceMemberId) }
          : {}),
        ...(body.insuranceGroupNumber !== undefined
          ? { insuranceGroupNumber: emptyToNull(body.insuranceGroupNumber) }
          : {}),
        ...(body.treatmentTeam !== undefined
          ? { treatmentTeam: body.treatmentTeam === null ? Prisma.DbNull : (body.treatmentTeam as Prisma.InputJsonValue) }
          : {}),
        ...(body.hieLastQueryAt !== undefined
          ? {
              hieLastQueryAt: body.hieLastQueryAt
                ? new Date(body.hieLastQueryAt)
                : null,
            }
          : {}),
        ...(nextMrn
          ? {
              mrn: nextMrn,
              organizationId: existing.organizationId || gate.organizationId,
            }
          : {}),
      },
      select: {
        id: true,
        mrn: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        riskLevel: true,
        dateOfBirth: true,
        gender: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        assignedToId: true,
        insurancePayer: true,
        insuranceMemberId: true,
        insuranceGroupNumber: true,
        primaryDiagnosis: true,
        primaryDiagnosisCode: true,
        secondaryDiagnoses: true,
        treatmentTeam: true,
        hieLastQueryAt: true,
        legalFirstName: true,
        middleInitial: true,
        legalLastName: true,
        nameSuffix: true,
        preferredName: true,
        phoneSecondary: true,
        ...STRUCTURED_SELECT,
      },
    });

    // Warm handoff / Assign Clinician slots (prescriber, case manager, PRP, peer): the new holder
    // gets a treatment-team row, which is what opens the chart for them (clientAccessWhere); the
    // replaced holder's slot row goes. Primary therapist access is Client.assignedToId above.
    let teamSlots: { added: string[]; removed: string[] } | null = null;
    if (body.treatmentTeam && !Array.isArray(body.treatmentTeam)) {
      teamSlots = await syncTeamSlotsToMembers({
        organizationId: gate.organizationId,
        clientId: id,
        before: existing.treatmentTeam as Record<string, unknown> | null,
        after: body.treatmentTeam as Record<string, unknown>,
        assignedBy: gate.userId,
      });
    }
    // Caseload lists / home / inbox caches for this org drop now, so a new assignee sees the client right away
    if (assignedToId !== undefined || teamSlots) invalidateCaseloadScopedCaches(gate.organizationId);

    let portalSyncNotice: { synced: boolean; inviteSent: boolean; message?: string } | null = null;
    if (body.email !== undefined) {
      const nextEmail = emptyToNull(body.email)?.toLowerCase() ?? null;
      const prevEmail = existing.email?.toLowerCase() ?? null;
      if (nextEmail !== prevEmail) {
        try {
          const syncResult = await syncPatientAccountEmail(id, nextEmail);
          portalSyncNotice = {
            synced: syncResult.synced,
            inviteSent: syncResult.inviteSent,
            message: syncResult.inviteSent
              ? `Portal invitation sent to updated email (${nextEmail})`
              : syncResult.synced && nextEmail
                ? `Portal account login email updated to ${nextEmail}`
                : undefined,
          };
        } catch (syncErr) {
          console.error('[PATCH /api/clients/:id] Portal sync failed:', syncErr);
        }
      }
    }

    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'patient', resourceId: id, patientId: id, metadata: { fields: Object.keys(body), nameReviewCleared: 'needsNameReview' in nameSync && existing.needsNameReview, ...(teamSlots && (teamSlots.added.length || teamSlots.removed.length) ? { teamSlotsAdded: teamSlots.added, teamSlotsRemoved: teamSlots.removed } : {}) } });
    return NextResponse.json({
      success: true,
      client: { ...client, ...structuredDemographicsOf(client), dateOfBirth: client.dateOfBirth?.toISOString().slice(0, 10) ?? null },
      portalSyncNotice,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: err.issues[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : String(err.meta?.target ?? '');
      if (target.includes('email')) {
        return NextResponse.json(
          { success: false, error: 'A client with this email address already exists in the system' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, error: 'MRN or unique identifier already in use' },
        { status: 409 }
      );
    }
    console.error('[PATCH /api/clients/:id]', err);
    return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 });
  }
}
