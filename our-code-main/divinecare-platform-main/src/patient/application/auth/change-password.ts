import { compare, hash } from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientProfile } from '@/patient/domain';
import { assertPatientPassword } from '@/patient/domain/password-policy';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { signPatientSession } from '@/patient/infrastructure/security/tokens';

export async function changePatientPassword(
  me: PatientProfile,
  currentPassword: string,
  newPassword: string
) {
  assertPatientPassword(newPassword);

  const account = await prisma.patientAccount.findFirst({
    where: { id: me.accountId, clientId: me.clientId, status: 'ACTIVE' },
    include: { client: { select: { active: true, status: true } } },
  });

  if (
    !account ||
    !account.passwordHash ||
    !account.client.active ||
    account.client.status === 'DISCHARGED'
  ) {
    throw new PatientAppError('Account not found or inactive', 404, 'not_found');
  }

  const validCurrent = await compare(currentPassword, account.passwordHash);
  if (!validCurrent) {
    throw new PatientAppError('Current password is incorrect', 400, 'invalid_current_password');
  }

  const isSame = await compare(newPassword, account.passwordHash);
  if (isSame) {
    throw new PatientAppError(
      'New password must be different from your current password',
      400,
      'same_password'
    );
  }

  const newPasswordHash = await hash(newPassword, 12);

  // Compare-and-swap ensures atomicity and concurrency safety
  const updated = await prisma.patientAccount.updateMany({
    where: {
      id: account.id,
      clientId: account.clientId,
      status: 'ACTIVE',
      passwordHash: account.passwordHash,
      client: { active: true, status: { not: 'DISCHARGED' } },
    },
    data: { passwordHash: newPasswordHash },
  });

  if (updated.count !== 1) {
    throw new PatientAppError('Could not update password. Please try again.', 409, 'conflict');
  }

  await logPatientAudit({
    clientId: account.clientId,
    accountId: account.id,
    action: 'password.changed',
    entityType: 'patient_account',
    entityId: account.id,
  });

  // Issue a new session token so that the patient's current login continues seamlessly
  const token = await signPatientSession(account.id, account.clientId, newPasswordHash);

  return {
    token,
    message: 'Your password has been updated successfully.',
  };
}
