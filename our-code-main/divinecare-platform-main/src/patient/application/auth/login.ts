import { compare } from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError } from '@/patient/domain';
import { signPatientSession } from '@/patient/infrastructure/security/tokens';

const DUMMY_PASSWORD_HASH =
  '$2b$12$LH3C5unQdTjVgR.zuxsKeOBq.CqLTbHnOI1V8qWfm4yO5bdvmC1Wq';

export async function loginPatient(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const account = await prisma.patientAccount.findUnique({
    where: { email: normalized },
    include: { client: { select: { id: true, name: true, email: true, phone: true, status: true, active: true } } },
  });

  const hash = account?.passwordHash || DUMMY_PASSWORD_HASH;
  const ok = await compare(password, hash);

  if (!account || !account.passwordHash || !ok) {
    throw new PatientAppError('Email or password is incorrect.', 401, 'invalid_credentials');
  }

  if (account.status !== 'ACTIVE' || !account.client.active || account.client.status === 'DISCHARGED') {
    throw new PatientAppError('This account is no longer active', 403, 'disabled');
  }

  const token = await signPatientSession(account.id, account.clientId, account.passwordHash);
  return {
    token,
    client: {
      id: account.client.id,
      name: account.client.name,
      email: account.email,
      phone: account.client.phone,
    },
  };
}
