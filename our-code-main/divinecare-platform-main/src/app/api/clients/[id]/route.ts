import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { isPrimaryCareRole, staffLocationIds } from '@/lib/clients/locationScope';
import { recordPhiAudit } from '@/lib/audit/phiAudit';
import { isCaseloadRole, isClinicalStaff } from '@/types/roles';
import { canAccessClientRoster, canAssignPatientToClinician, canEditClinicMrn, canEditClientProfile, clientByIdWhere } from '@/lib/clients/orgScope';
import { canEditDiagnosis, canEditRiskLevel } from '@/lib/clients/chartVisibility';
import { canPrescribe } from '@/types/roles';
import { assertMrnAvailable, ensureClientMrn } from '@/lib/clients/mrn';
import { maskClientPii } from '@/lib/privacy/pii';
import {
  assertClientPhiAccess,
  SensitiveRecordAccessError,
} from '@/lib/privacy/sensitiveAccess';
import { optionalCuid } from '@/lib/validation/optionalCuid';
import { syncPatientAccountEmail } from '@/patient';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
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
        copay: z.object({ amount: z.number(), unit: z.string().trim().max(8).optional() }).optional(),
      }).passthrough(),
    ])
    .optional()
    .nullable(),
  hieLastQueryAt: z.string().datetime().optional().nullable(),
});

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function GET(
  _req: Request,
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

  if (isPrimaryCareRole(gate.role)) {
    const locations = await staffLocationIds(gate.userId);
    if (!client.locationId || !locations.includes(client.locationId)) {
      await recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action: 'chart.read',
        resourceType: 'client',
        resourceId: id,
        patientId: id,
        outcome: 'DENIED',
      });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
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

  const onTreatmentTeam =
    isCaseloadRole(gate.role) && client.assignedToId !== gate.userId
      ? Boolean(
          await prisma.clientTreatmentTeamMember.findFirst({
            where: { clientId: id, providerId: gate.userId },
            select: { id: true },
          })
        )
      : false;

  if (gate.role !== 'PEER_SUPPORT' && isCaseloadRole(gate.role) && client.assignedToId !== gate.userId && !onTreatmentTeam) {
    // Sensitive + BTG/whitelist already cleared assertClientPhiAccess above — allow PHI reveal.
    const protectedRec = await prisma.sensitiveRecord.findFirst({
      where: { clientId: id, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!protectedRec) {
      const actorName = gate.session.user.name?.trim();
      const hasForwardedThread = await prisma.messageThread.findFirst({
        where: {
          clientId: id,
          organizationId: gate.organizationId,
          OR: [
            ...(actorName
              ? [{ forwardedTo: { contains: actorName, mode: 'insensitive' as const } }]
              : []),
            { forwardedTo: gate.userId },
            ...(actorName
              ? [{ assignedStaff: { contains: actorName, mode: 'insensitive' as const } }]
              : []),
          ],
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

  const detail = isClinicalDetailView
    ? {
        ...shared,
        dateOfBirth: client.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        gender: client.gender,
        addressLine1: client.addressLine1,
        addressLine2: client.addressLine2,
        city: client.city,
        state: client.state,
        postalCode: client.postalCode,
        emergencyContactName: client.emergencyContactName,
        emergencyContactPhone: client.emergencyContactPhone,
        insurancePayer: client.insurancePayer,
        insuranceMemberId: client.insuranceMemberId,
        insuranceGroupNumber: client.insuranceGroupNumber,
        primaryDiagnosis: client.primaryDiagnosis,
        primaryDiagnosisCode: client.primaryDiagnosisCode,
        secondaryDiagnoses: client.secondaryDiagnoses,
        avgMood,
        avgStress,
        avgSleep,
        checkIns: client.checkIns
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
        insurancePayer: client.insurancePayer,
        insuranceMemberId: client.insuranceMemberId,
        insuranceGroupNumber: client.insuranceGroupNumber,
      };

  const chart = { ...detail } as Record<string, unknown>;
  const roleName = String(gate.role || '').toUpperCase();
  if (roleName === 'PEER_SUPPORT') {
    return NextResponse.json({
      success: true,
      client: {
        id: client.id,
        name: client.name,
        status: client.status,
        risk: riskMap[client.riskLevel],
        riskLevel: client.riskLevel,
      },
    });
  }
  if (['FRONT_DESK', 'OFFICE_MANAGER', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'].includes(roleName)) {
    delete chart.primaryDiagnosis;
    delete chart.primaryDiagnosisCode;
    delete chart.secondaryDiagnoses;
    delete chart.checkIns;
    delete chart.avgMood;
    delete chart.avgStress;
    delete chart.avgSleep;
  }
  if (canPrescribe(gate.role)) {
    chart.prescribingRegistration = client.rcopiaPatientId ? 'registered' : 'not_registered';
  }

  return NextResponse.json({
    success: true,
    client: maskClientPii(chart as typeof detail, gate.role),
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
    const diagnosisWrite =
      body.primaryDiagnosis !== undefined ||
      body.primaryDiagnosisCode !== undefined ||
      body.secondaryDiagnoses !== undefined;
    if (diagnosisWrite && !canEditDiagnosis(gate.role)) {
      await recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action: 'diagnosis.write',
        resourceType: 'patient',
        patientId: id,
        outcome: 'DENIED',
      });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (body.riskLevel !== undefined && !canEditRiskLevel(gate.role)) {
      await recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action: 'risk.write',
        resourceType: 'patient',
        patientId: id,
        outcome: 'DENIED',
      });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

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

    if (isCaseloadRole(gate.role) && existing.assignedToId !== gate.userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (isPrimaryCareRole(gate.role)) {
      const locations = await staffLocationIds(gate.userId);
      if (!existing.locationId || !locations.includes(existing.locationId)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
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

    const client = await prisma.client.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.email !== undefined ? { email: emptyToNull(body.email) } : {}),
        ...(body.phone !== undefined ? { phone: emptyToNull(body.phone) } : {}),
        ...(body.dateOfBirth !== undefined
          ? { dateOfBirth: body.dateOfBirth && body.dateOfBirth.trim() ? new Date(body.dateOfBirth.trim()) : null }
          : {}),
        ...(body.gender !== undefined ? { gender: emptyToNull(body.gender) } : {}),
        ...(body.addressLine1 !== undefined ? { addressLine1: emptyToNull(body.addressLine1) } : {}),
        ...(body.addressLine2 !== undefined ? { addressLine2: emptyToNull(body.addressLine2) } : {}),
        ...(body.city !== undefined ? { city: emptyToNull(body.city) } : {}),
        ...(body.state !== undefined ? { state: emptyToNull(body.state) } : {}),
        ...(body.postalCode !== undefined ? { postalCode: emptyToNull(body.postalCode) } : {}),
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
        ...(assignedToId !== undefined
          ? { assignedToId, assignedSince: new Date() }
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
      },
    });

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

    return NextResponse.json({ success: true, client, portalSyncNotice });
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
