import { createHash, randomBytes } from 'crypto';
import type { IntakeInviteStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createClient, type CreateClientInput } from '@/lib/clients/manage';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { normalizeMiddleInitial } from '@/lib/clients/legalName';
import { normalizeSsn, ssnError, ssnLast4 } from '@/lib/clients/ssn';
import { encryptField } from '@/lib/security/fieldCrypto';
import type { PacketSubmission } from '@/lib/consents/library/signing';
import {
  PRONOUNS,
  RELATIONSHIPS,
  demographicUpdateData,
  legacyGenderFromSex,
  normalizeStateCode,
  normalizeUsZip,
} from '@/lib/clients/demographics';

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
    middleInitial?: string | null;
    lastName: string;
    dateOfBirth: string;
    /** Coded answers (src/lib/clients/demographics.ts) */
    pronouns?: string | null;
    administrativeSex?: string | null;
    genderIdentity?: string | null;
    race?: string[] | null;
    ethnicity?: string | null;
    preferredLanguage?: string | null;
    interpreterNeeded?: boolean | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
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
  /** Social Security Number: OPTIONAL (review note 4); stored encrypted, never kept in formData */
  identity?: { ssn?: string | null };
  /** "Does the Client have a Guardian?" (source packet page 6-7) */
  guardian?: { hasGuardian: boolean; name?: string | null; relationship?: string | null; phone?: string | null; email?: string | null };
  /** "What service are you interested in?" (SERVICES_INTERESTED values) */
  servicesInterested?: string[];
  /** Would like telehealth (video) visits */
  wantsTelehealth?: boolean | null;
  /** Consent packet (consent library): recorded as ConsentForm rows by the route, not kept in formData */
  consentPacket?: PacketSubmission;
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
  /** Existing chart (waitlist conversion): completing the form updates it instead of creating one */
  clientId?: string | null;
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

  let linkedClientId: string | null = null;
  const requestedClientId = emptyToNull(input.clientId);
  if (requestedClientId) {
    const linked = await prisma.client.findFirst({
      where: { id: requestedClientId, organizationId },
      select: { id: true },
    });
    if (!linked) {
      return { ok: false as const, error: 'Client not found', status: 404 };
    }
    linkedClientId = linked.id;
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
      clientId: linkedClientId,
    },
  });

  if (waitlistEntryId) {
    // Waitlist pipeline (src/lib/waitlist/standard.ts): intake sent, still waiting to be scheduled
    await prisma.waitlistEntry.updateMany({
      where: {
        id: waitlistEntryId,
        organizationId,
        status: { in: ['WAITING', 'MATCHED'] },
        OR: [{ stage: null }, { stage: { in: ['NEW', 'CONTACTED'] } }],
      },
      data: { stage: 'INTAKE_SENT' },
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
  const middleInitial = normalizeMiddleInitial(demo.middleInitial);
  // Client.name stays "First Last"; the structured legal name feeds DrFirst demographics.
  const fullName = `${firstName} ${lastName}`.trim() || invite.clientName;
  const legalName = firstName && lastName
    ? { legalFirstName: firstName, middleInitial, legalLastName: lastName }
    : {};
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
  const ssnProblem = ssnError(payload.identity?.ssn);
  if (ssnProblem) {
    return { ok: false as const, error: ssnProblem, status: 400 };
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

  // Coded demographics the patient answered (an unanswered question stays null, never defaulted).
  // A pronoun is never written to Client.gender; a pre-coding free-text pronoun is ignored.
  const coded = demographicUpdateData({
    administrativeSex: demo.administrativeSex ?? undefined,
    genderIdentity: demo.genderIdentity ?? undefined,
    pronouns: demo.pronouns && PRONOUNS.some((o) => o.code === demo.pronouns) ? demo.pronouns : undefined,
    race: demo.race?.length ? demo.race : undefined,
    ethnicity: demo.ethnicity ?? undefined,
    preferredLanguage: demo.preferredLanguage ?? undefined,
    interpreterNeeded: demo.interpreterNeeded ?? undefined,
    emergencyContactRelationship:
      demo.emergencyContactRelationship && RELATIONSHIPS.some((o) => o.code === demo.emergencyContactRelationship)
        ? demo.emergencyContactRelationship
        : undefined,
  });
  const sexDisplay = legacyGenderFromSex(emptyToNull(demo.administrativeSex));

  const demographicsUpdate = {
    name: fullName,
    ...legalName,
    email,
    phone,
    dateOfBirth,
    ...coded,
    ...(sexDisplay ? { gender: sexDisplay } : {}),
    addressLine1: emptyToNull(demo.addressLine1),
    ...(demo.addressLine2 !== undefined ? { addressLine2: emptyToNull(demo.addressLine2) } : {}),
    city: emptyToNull(demo.city),
    state: normalizeStateCode(demo.state) ?? emptyToNull(demo.state),
    postalCode: normalizeUsZip(demo.postalCode) ?? emptyToNull(demo.postalCode),
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

  // Public intake with no linked chart: NEVER overwrite an existing chart because the typed
  // email matches it (a reused, shared or mistyped email would file this person's demographics,
  // insurance and history on someone else's record). Create a NEW chart, and when the email is
  // already taken flag it for staff identity review (same mechanism as online booking:
  // identityVerifyRequired + unverifiedEmail, since Client.email is unique DB-wide).
  let duplicateReview: { reason: 'possible_duplicate_email'; sameOrgClientId: string | null } | null = null;
  if (!clientId) {
    const emailOwner = email
      ? await prisma.client.findUnique({ where: { email }, select: { id: true, organizationId: true } })
      : null;
    const newClientInput = {
      name: fullName,
      ...legalName,
      email: emailOwner ? null : email,
      phone,
      dateOfBirth: dob,
      ...(coded as Partial<CreateClientInput>),
      ...(sexDisplay ? { gender: sexDisplay } : {}),
      addressLine1: emptyToNull(demo.addressLine1),
      addressLine2: emptyToNull(demo.addressLine2),
      city: emptyToNull(demo.city),
      state: emptyToNull(demo.state),
      postalCode: emptyToNull(demo.postalCode),
      emergencyContactName: emptyToNull(demo.emergencyContactName),
      emergencyContactPhone: emptyToNull(demo.emergencyContactPhone),
      insurancePayer: resolvedPayer,
      insuranceMemberId: emptyToNull(payload.insurance.memberId),
      insuranceGroupNumber: emptyToNull(payload.insurance.groupNumber),
      assignedToId: invite.assignedToId || actorUserId,
      status: 'ACTIVE' as const,
      secondaryDiagnoses: demographicsUpdate.secondaryDiagnoses,
    };
    let created = await createClient(newClientInput, actorUserId, invite.organizationId);
    let emailTaken = Boolean(emailOwner);
    if (!created.ok && created.status === 409 && email && !emailTaken) {
      // Lost a race for the email: same rule, new flagged chart without it.
      emailTaken = true;
      created = await createClient({ ...newClientInput, email: null }, actorUserId, invite.organizationId);
    }
    if (!created.ok) {
      return { ok: false as const, error: created.error, status: created.status };
    }
    clientId = created.client.id;

    if (emailTaken && email) {
      const owner =
        emailOwner ??
        (await prisma.client.findUnique({ where: { email }, select: { id: true, organizationId: true } }));
      const sameOrgClientId =
        owner && owner.organizationId === invite.organizationId ? owner.id : null;
      await prisma.client.update({
        where: { id: clientId },
        data: {
          unverifiedEmail: email,
          identityVerifyRequired: true,
          identityVerifyReason: 'possible_duplicate_email',
        },
      });
      duplicateReview = { reason: 'possible_duplicate_email', sameOrgClientId };
    }
  }

  if (duplicateReview && clientId) {
    // Staff review trail: ids only. Another org's chart id is never recorded here.
    await writeAuditLog({
      action: 'INTAKE_POSSIBLE_DUPLICATE',
      actorUserId: null,
      actorRole: 'PATIENT',
      organizationId: invite.organizationId,
      resourceType: 'patient',
      resourceId: clientId,
      patientId: clientId,
      metadata: {
        via: 'public-intake',
        intakeInviteId: invite.id,
        reason: duplicateReview.reason,
        possibleDuplicateOfClientId: duplicateReview.sameOrgClientId,
        matchInOtherOrganization: duplicateReview.sameOrgClientId === null,
        merged: false,
      },
    });
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

  // Consent-library intake fields: SSN (optional, encrypted; last four in clear), guardian,
  // services interested. Written to the chart, never copied into formData in clear.
  if (clientId) {
    const ssnDigits = normalizeSsn(payload.identity?.ssn);
    const g = payload.guardian;
    await prisma.client.update({
      where: { id: clientId },
      data: {
        ...(ssnDigits ? { ssnLast4: ssnLast4(ssnDigits), ssnEncrypted: encryptField(ssnDigits) } : {}),
        ...(g
          ? {
              hasGuardian: g.hasGuardian,
              ...(g.hasGuardian
                ? { guardianName: emptyToNull(g.name), guardianRelationship: emptyToNull(g.relationship), guardianPhone: emptyToNull(g.phone), guardianEmail: emptyToNull(g.email)?.toLowerCase() ?? null }
                : {}),
            }
          : {}),
        ...(payload.servicesInterested ? { servicesInterested: [...new Set(payload.servicesInterested)].slice(0, 10) } : {}),
      },
    });
  }
  const { identity: _identity, consentPacket: _packet, ...storable } = payload;
  void _identity;
  void _packet;

  const formData = JSON.parse(
    JSON.stringify({
      ...storable,
      identity: { ssnProvided: Boolean(normalizeSsn(payload.identity?.ssn)) },
      consentPacket: payload.consentPacket ? { submitted: true } : undefined,
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
        stage: 'CONVERTED',
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

/** Organization + appointment type of an open intake link (public consent-packet preview / validation). */
export async function intakeInviteContext(token: string): Promise<{ id: string; organizationId: string; appointmentType: string | null } | null> {
  const invite = await prisma.intakeInvite.findUnique({ where: { token }, select: { id: true, organizationId: true, appointmentType: true, status: true, expiresAt: true } });
  if (!invite || toUiStatus(invite.status, invite.expiresAt) !== 'pending') return null;
  return { id: invite.id, organizationId: invite.organizationId, appointmentType: invite.appointmentType };
}
