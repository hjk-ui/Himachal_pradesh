import { hash } from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError } from '@/patient/domain';
import { assertPatientPassword } from '@/patient/domain/password-policy';
import { hashInviteToken, isInviteTokenShape } from '@/patient/infrastructure/security/tokens';

export async function previewPatientInvite(rawToken: string) {
  const account = await findInvited(rawToken);
  // A guardian-only login sees its own name, never the child's (the invite carries no PHI)
  return {
    name: account.client?.name ?? account.displayName ?? '',
    email: account.email,
    expiresAt: account.inviteExpiresAt!.toISOString(),
  };
}

export async function acceptPatientInvite(rawToken: string, password: string) {
  assertPatientPassword(password);

  const account = await findInvited(rawToken);
  const passwordHash = await hash(password, 12);

  const updated = await prisma.patientAccount.update({
    where: { id: account.id },
    data: {
      passwordHash,
      status: 'ACTIVE',
      inviteTokenHash: null,
      inviteExpiresAt: null,
    },
    include: { client: { select: { id: true, name: true } } },
  });

  return {
    email: updated.email,
    name: updated.client?.name ?? updated.displayName ?? '',
  };
}

async function findInvited(rawToken: string) {
  if (!isInviteTokenShape(rawToken)) {
    throw new PatientAppError('Invalid invite link', 400, 'invalid_token');
  }

  const inviteTokenHash = hashInviteToken(rawToken);
  const account = await prisma.patientAccount.findFirst({
    where: { inviteTokenHash, status: 'INVITED' },
    include: { client: { select: { name: true } } },
  });

  if (!account) {
    throw new PatientAppError('Invite not found or already used', 400, 'invalid_token');
  }
  if (!account.inviteExpiresAt || account.inviteExpiresAt.getTime() < Date.now()) {
    throw new PatientAppError('This invite has expired. Ask the clinic to send it again.', 400, 'expired');
  }

  return account;
}
