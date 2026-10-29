import { createHash, randomBytes } from 'crypto';
import type { IntakeInviteStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/clients/manage';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientOrgFilter } from '@/lib/clients/orgScope';

const INTAKE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function canAccessIntake(role: Role | undefined | null) {
  return Boolean(role && canAccessPath(role, '/dashboard/clients/intake'));
}

export type IntakeInviteListItem = {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  firstAppointment: string | null;
  status: 'pending' | 'completed' | 'expired';
  sentCount: number;
  sentAt: string;
  completedAt: string | null;
  expiresAt: string;
  token: string;
  clientId: string | null;
  waitlistEntryId: string | null;
  hasFormData: boolean;
  insurancePayer: string | null;
  assignedToId: string | null;
  appointmentType: string | null;
  homeless: boolean;
};

export type IntakeFormPayload = {
  demographics: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    pronouns?: string | null;
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    phone: string;
    email: string;
    emergencyContactName?: string | null;
    emergencyContactRelationship?: string | null;
    emergencyContactPhone?: string | null;
  };
  insurance: {
    primaryPayer: string;
    memberId?: string | null;
    groupNumber?: string | null;
    subscriberName?: string | null;
    subscriberDob?: string | null;
    subscriberRelationship?: string | null;
    secondaryPayer?: string | null;
    secondaryMemberId?: string | null;
    secondaryGroupNumber?: string | null;
  };
  medicalHistory?: Record<string, unknown>;
  consents?: Record<string, boolean>;
  signature: {
    fullName: string;
    signedAt: string;
  };
};

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function newToken() {
  return randomBytes(24).toString('hex');
}

function toUiStatus(
  status: IntakeInviteStatus,
  expiresAt: Date
): 'pending' | 'completed' | 'expired' {
  if (status === 'COMPLETED') return 'completed';
  if (status === 'EXPIRED' || expiresAt.getTime() < Date.now()) return 'expired';
  return 'pending';
}

function serializeInvite(row: {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  firstAppointment: Date | null;
  status: IntakeInviteStatus;
  sentCount: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
  token: string;
  clientId: string | null;
  waitlistEntryId: string | null;
  formData: Prisma.JsonValue | null;
  insurancePayer?: string | null;
  assignedToId?: string | null;
  appointmentType?: string | null;
  homeless?: boolean;
}): IntakeInviteListItem {
  return {
    id: row.id,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    clientPhone: row.clientPhone,
    firstAppointment: row.firstAppointment
      ? row.firstAppointment.toISOString().slice(0, 10)
      : null,
    status: toUiStatus(row.status, row.expiresAt),
    sentCount: row.sentCount,
    sentAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    token: row.token,
    clientId: row.clientId,
    waitlistEntryId: row.waitlistEntryId,
    hasFormData: row.formData != null,
    insurancePayer: row.insurancePayer ?? null,
    assignedToId: row.assignedToId ?? null,
    appointmentType: row.appointmentType ?? null,
    homeless: Boolean(row.homeless),
  };
}

/** Mark PENDING invites past expiresAt as EXPIRED (lazy). */
async function expireStaleInvites(organizationId?: string) {
  await prisma.intakeInvite.updateMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: new Date() },
      ...(organizationId ? { organizationId } : {}),
    },
    data: { status: 'EXPIRED' },
  });
}

export async function listIntakeInvites(organizationId: string) {
  await expireStaleInvites(organizationId);
  const rows = await prisma.intakeInvite.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeInvite);
}

export type CreateIntakeInput = {
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  firstAppointment?: string | null;
  assignedToId?: string | null;
  waitlistEntryId?: string | null;
  insurancePayer?: string | null;
  appointmentType?: string | null;
  homeless?: boolean;
};

export async function createIntakeInvite(
  organizationId: string,
  actorUserId: string,
  input: CreateIntakeInput
) {
  const clientName = input.clientName.trim();
  const clientEmail = input.clientEmail.trim().toLowerCase();
  if (clientName.length < 2) {
    return { ok: false as const, error: 'Client name is required', status: 400 };
  }
  if (!clientEmail.includes('@')) {
    return { ok: false as const, error: 'Valid email is required', status: 400 };
  }

  let firstAppointment: Date | null = null;
  if (emptyToNull(input.firstAppointment)) {
    const parsed = new Date(input.firstAppointment!);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false as const, error: 'Invalid first appointment date', status: 400 };
    }
    firstAppointment = parsed;
  }

  let assignedToId = emptyToNull(input.assignedToId);
  if (assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assignedToId, organizationId, status: { in: ['ACTIVE', 'INVITED'] } },
    });
    if (!assignee) {
      return { ok: false as const, error: 'Assignee not found', status: 400 };
    }
  }

  const waitlistEntryId = emptyToNull(input.waitlistEntryId);
  if (waitlistEntryId) {
    const entry = await prisma.waitlistEntry.findFirst({
      where: { id: waitlistEntryId, organizationId },
    });
    if (!entry) {
      return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
    }
    if (!assignedToId && entry.clinicianId) {
      assignedToId = entry.clinicianId;
    }
  }

  const rawApptType = emptyToNull(input.appointmentType);
  const appointmentType =
    rawApptType === 'Telehealth' || rawApptType === 'In Office' ? rawApptType : null;

  const invite = await prisma.intakeInvite.create({
    data: {
      organizationId,
      token: newToken(),
      clientName,
      clientEmail,
      clientPhone: emptyToNull(input.clientPhone),
      firstAppointment,
      insurancePayer: emptyToNull(input.insurancePayer),
      appointmentType,
      homeless: Boolean(input.homeless),
      status: 'PENDING',
      sentCount: 1,
      expiresAt: new Date(Date.now() + INTAKE_TTL_MS),
      assignedToId,
      createdById: actorUserId,
      waitlistEntryId,
    },
  });

  if (waitlistEntryId) {
    await prisma.waitlistEntry.updateMany({
      where: {
        id: waitlistEntryId,
        organizationId,
        status: { in: ['WAITING', 'MATCHED'] },
      },
      data: { status: 'SCHEDULED' },
    });
  }

  return { ok: true as const, invite: serializeInvite(invite) };
}

export async function resendIntakeInvite(organizationId: string, id: string) {
  await expireStaleInvites(organizationId);
  const existing = await prisma.intakeInvite.findFirst({
    where: { id, organizationId },
  });
  if (!existing) {
    return { ok: false as const, error: 'Intake invite not found', status: 404 };
  }
  if (existing.status === 'COMPLETED') {
    return { ok: false as const, error: 'Completed intakes cannot be resent', status: 400 };
  }

  const updated = await prisma.intakeInvite.update({
    where: { id },
    data: {
      token: newToken(),
      status: 'PENDING',
      sentCount: { increment: 1 },
      expiresAt: new Date(Date.now() + INTAKE_TTL_MS),
      completedAt: null,
    },
  });

  return { ok: true as const, invite: serializeInvite(updated) };
}

export async function getIntakeInviteForStaff(organizationId: string, id: string) {
  await expireStaleInvites(organizationId);
  const row = await prisma.intakeInvite.findFirst({
    where: { id, organizationId },
  });
  if (!row) return null;
  return {
    ...serializeInvite(row),
    formData: row.formData,
  };
}

export async function getPublicIntakeInvite(token: string) {
  await expireStaleInvites();
  const row = await prisma.intakeInvite.findUnique({ where: { token } });
  if (!row) {
    return { ok: false as const, error: 'Intake link not found', status: 404 };
  }

  const uiStatus = toUiStatus(row.status, row.expiresAt);
  if (uiStatus === 'expired') {
    if (row.status === 'PENDING') {
      await prisma.intakeInvite.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      });
    }
    return { ok: false as const, error: 'This intake link has expired', status: 410 };
  }
  if (uiStatus === 'completed') {
    return {
      ok: true as const,
      alreadyCompleted: true as const,
      invite: {
        clientName: row.clientName,
        clientEmail: row.clientEmail,
        clientPhone: row.clientPhone,
        firstAppointment: row.firstAppointment
          ? row.firstAppointment.toISOString().slice(0, 10)
          : null,
        status: 'completed' as const,
        appointmentType: row.appointmentType ?? null,
        homeless: Boolean(row.homeless),
      },
    };
  }

  return {
    ok: true as const,
    alreadyCompleted: false as const,
    invite: {
      clientName: row.clientName,
      clientEmail: row.clientEmail,
      clientPhone: row.clientPhone,
      firstAppointment: row.firstAppointment
        ? row.firstAppointment.toISOString().slice(0, 10)
        : null,
      status: 'pending' as const,
      appointmentType: row.appointmentType ?? null,
      homeless: Boolean(row.homeless),
    },
  };
}

function clientOrgWhere(organizationId: string): Prisma.ClientWhereInput {
  return clientOrgFilter(organizationId);
}

export async function completeIntakeInvite(token: string, payload: IntakeFormPayload) {
  await expireStaleInvites();
  const invite = await prisma.intakeInvite.findUnique({ where: { token } });
  if (!invite) {
    return { ok: false as const, error: 'Intake link not found', status: 404 };
  }

  const uiStatus = toUiStatus(invite.status, invite.expiresAt);
  if (uiStatus === 'expired') {
    return { ok: false as const, error: 'This intake link has expired', status: 410 };
  }
  if (uiStatus === 'completed') {
    return { ok: false as const, error: 'Intake already completed', status: 409 };
  }

  const demo = payload.demographics;
  const firstName = demo.firstName?.trim() ?? '';
  const lastName = demo.lastName?.trim() ?? '';
  const fullName = `${firstName} ${lastName}`.trim() || invite.clientName;
  const email = (demo.email || invite.clientEmail).trim().toLowerCase();
  const phone = emptyToNull(demo.phone) || invite.clientPhone;
  const dob = emptyToNull(demo.dateOfBirth);
  const signatureName = payload.signature?.fullName?.trim();
  if (!signatureName) {
    return { ok: false as const, error: 'Signature is required', status: 400 };
  }
  if (!payload.insurance?.primaryPayer?.trim()) {
    return { ok: false as const, error: 'Primary insurance is required', status: 400 };
  }

  let dateOfBirth: Date | null = null;
  if (dob) {
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false as const, error: 'Invalid date of birth', status: 400 };
    }
    dateOfBirth = parsed;
  }

  const actorUserId = invite.createdById || invite.assignedToId;
  if (!actorUserId) {
    return {
      ok: false as const,
      error: 'Intake invite is missing a staff owner',
      status: 500,
    };
  }

  const resolvedPayer =
    emptyToNull(payload.insurance.primaryPayer) || emptyToNull(invite.insurancePayer);

  const demographicsUpdate = {
    name: fullName,
    email,
    phone,
    dateOfBirth,
    gender: emptyToNull(demo.pronouns),
    addressLine1: emptyToNull(demo.addressLine1),
    city: emptyToNull(demo.city),
    state: emptyToNull(demo.state),
    postalCode: emptyToNull(demo.postalCode),
    emergencyContactName: emptyToNull(demo.emergencyContactName),
    emergencyContactPhone: emptyToNull(demo.emergencyContactPhone),
    insurancePayer: resolvedPayer,
    insuranceMemberId: emptyToNull(payload.insurance.memberId),
    insuranceGroupNumber: emptyToNull(payload.insurance.groupNumber),
    secondaryDiagnoses: payload.medicalHistory
      ? `Intake reason: ${String(payload.medicalHistory.reasonForSeeking || '').slice(0, 500)}`
      : undefined,
  };

  let clientId = invite.clientId;

  if (clientId) {
    const existing = await prisma.client.findFirst({
      where: { id: clientId, ...clientOrgWhere(invite.organizationId) },
    });
    if (existing) {
      await prisma.client.update({
        where: { id: existing.id },
        data: demographicsUpdate,
      });
    } else {
      clientId = null;
    }
  }

  if (!clientId && email) {
    const byEmail = await prisma.client.findFirst({
      where: { email, ...clientOrgWhere(invite.organizationId) },
    });
    if (byEmail) {
      await prisma.client.update({
        where: { id: byEmail.id },
        data: demographicsUpdate,
      });
      clientId = byEmail.id;
    }
  }

  if (!clientId) {
    const created = await createClient(
      {
        name: fullName,
        email,
        phone,
        dateOfBirth: dob,
        gender: emptyToNull(demo.pronouns),
        addressLine1: emptyToNull(demo.addressLine1),
        city: emptyToNull(demo.city),
        state: emptyToNull(demo.state),
        postalCode: emptyToNull(demo.postalCode),
        emergencyContactName: emptyToNull(demo.emergencyContactName),
        emergencyContactPhone: emptyToNull(demo.emergencyContactPhone),
        insurancePayer: resolvedPayer,
        insuranceMemberId: emptyToNull(payload.insurance.memberId),
        insuranceGroupNumber: emptyToNull(payload.insurance.groupNumber),
        assignedToId: invite.assignedToId || actorUserId,
        status: 'ACTIVE',
        secondaryDiagnoses: demographicsUpdate.secondaryDiagnoses,
      },
      actorUserId,
      invite.organizationId
    );
    if (!created.ok) {
      // Email conflict: only update if client already belongs to THIS org (never steal another clinic)
      if (created.status === 409 && email) {
        const conflict = await prisma.client.findFirst({
          where: { email, ...clientOrgWhere(invite.organizationId) },
        });
        if (conflict) {
          await prisma.client.update({
            where: { id: conflict.id },
            data: demographicsUpdate,
          });
          clientId = conflict.id;
        } else {
          return {
            ok: false as const,
            error:
              'A client with this email already exists outside your organization. Contact support — do not overwrite another clinic’s patient.',
            status: 409,
          };
        }
      } else {
        return {
          ok: false as const,
          error: created.error,
          status: created.status,
        };
      }
    } else {
      clientId = created.client.id;
    }
  }

  // Persist assigned clinician onto treatmentTeam so refresh shows badges
  if (clientId && invite.assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: invite.assignedToId,
        organizationId: invite.organizationId,
      },
      select: { id: true, name: true },
    });
    if (assignee) {
      await prisma.client.update({
        where: { id: clientId },
        data: {
          assignedToId: assignee.id,
          assignedSince: new Date(),
          treatmentTeam: {
            primaryTherapistId: assignee.id,
            primaryTherapistName: assignee.name,
          },
          ...(resolvedPayer ? { insurancePayer: resolvedPayer } : {}),
        },
      });
    }
  }

  const formData = JSON.parse(
    JSON.stringify({
      ...payload,
      meta: {
        completedViaTokenHash: createHash('sha256').update(token).digest('hex').slice(0, 16),
        completedAt: new Date().toISOString(),
      },
    })
  ) as Prisma.InputJsonValue;

  const updated = await prisma.intakeInvite.update({
    where: { id: invite.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      formData,
      clientId,
      clientName: fullName,
      clientEmail: email,
      clientPhone: phone,
    },
  });

  if (invite.waitlistEntryId) {
    await prisma.waitlistEntry.updateMany({
      where: {
        id: invite.waitlistEntryId,
        organizationId: invite.organizationId,
        convertedClientId: null,
      },
      data: {
        status: 'SCHEDULED',
        convertedClientId: clientId,
        convertedAt: new Date(),
      },
    });
  }

  return {
    ok: true as const,
    invite: serializeInvite(updated),
    clientId,
  };
}

/** Waitlist → create pending intake invite (does not create client yet). */
export async function convertWaitlistToIntake(
  organizationId: string,
  waitlistId: string,
  actorUserId: string
) {
  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: waitlistId, organizationId },
  });
  if (!entry) {
    return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  }
  if (entry.status === 'CLOSED') {
    return { ok: false as const, error: 'Entry is closed', status: 400 };
  }
  if (!entry.email?.trim()) {
    return {
      ok: false as const,
      error: 'Add an email on the waitlist entry before sending intake',
      status: 400,
    };
  }

  const pending = await prisma.intakeInvite.findFirst({
    where: {
      organizationId,
      waitlistEntryId: entry.id,
      status: { in: ['PENDING', 'EXPIRED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (pending && toUiStatus(pending.status, pending.expiresAt) === 'pending') {
    return {
      ok: true as const,
      invite: serializeInvite(pending),
      reused: true as const,
    };
  }

  return createIntakeInvite(organizationId, actorUserId, {
    clientName: entry.name,
    clientEmail: entry.email,
    clientPhone: entry.phone,
    assignedToId: entry.clinicianId,
    waitlistEntryId: entry.id,
  });
}
