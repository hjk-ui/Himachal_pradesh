import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import {
  hashInviteToken,
  inviteExpiry,
  newInviteToken,
} from '@/patient/infrastructure/security/tokens';
import { sendPatientInviteEmail } from '@/patient/infrastructure/notifications/email';
import {
  defaultGuardianAccessTier,
  isValidGuardianRelationship,
  type GuardianRelationship,
} from '@/lib/clients/guardianAccess';

/**
 * A guardian is a patient-portal account for exactly one client.
 * The email is unique, so the same guardian cannot be attached to a second chart,
 * and the account is not a staff user.
 */
export async function inviteGuardianForClient(input: {
  clientId: string;
  organizationId: string;
  email: string;
  name: string;
  relationship?: string | null;
}) {
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(input.clientId, input.organizationId),
    select: {
      id: true,
      name: true,
      dateOfBirth: true,
      patientAccount: { select: { id: true, email: true, status: true } },
    },
  });
  if (!client) return { ok: false as const, status: 404, error: 'Client not found' };

  const relationship: GuardianRelationship = isValidGuardianRelationship(input.relationship)
    ? input.relationship
    : 'parent';
  const accessTier = defaultGuardianAccessTier(client.dateOfBirth);
  if (accessTier === 'aged_out') {
    return {
      ok: false as const,
      status: 400,
      error: 'Patient is 18 or older — guardian proxy access ages out. Invite the patient directly.',
    };
  }

  const email = input.email.trim().toLowerCase();
  const other = await prisma.patientAccount.findFirst({
    where: { email, NOT: { clientId: client.id } },
    select: { id: true },
  });
  if (other) {
    return {
      ok: false as const,
      status: 403,
      error: 'That email already has portal access to a different client.',
    };
  }

  const rawToken = newInviteToken();
  const inviteTokenHash = hashInviteToken(rawToken);
  const inviteExpiresAt = inviteExpiry();
  try {
    const account = await prisma.patientAccount.upsert({
      where: { clientId: client.id },
      create: {
        clientId: client.id,
        email,
        status: 'INVITED',
        passwordHash: null,
        inviteTokenHash,
        inviteExpiresAt,
        relationship,
        accessTier,
        isProxy: true,
      },
      update: {
        email,
        status: 'INVITED',
        passwordHash: null,
        inviteTokenHash,
        inviteExpiresAt,
        relationship,
        accessTier,
        isProxy: true,
      },
    });
    await sendPatientInviteEmail({
      to: email,
      name: input.name,
      rawToken,
    }).catch(() => undefined);
    return {
      ok: true as const,
      accountId: account.id,
      accessTier,
      relationship,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        ok: false as const,
        status: 403,
        error: 'That email already has portal access to a different client.',
      };
    }
    throw err;
  }
}
