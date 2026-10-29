import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientProfile } from '@/patient/domain';
import { bearerToken, matchesPatientCredential, verifyPatientSession } from '@/patient/infrastructure/security/tokens';

export async function requirePatient(req: Request): Promise<PatientProfile> {
  const token = bearerToken(req);
  if (!token) {
    throw new PatientAppError('Sign in required', 401, 'unauthenticated');
  }

  let parsed: Awaited<ReturnType<typeof verifyPatientSession>>;
  try {
    parsed = await verifyPatientSession(token);
  } catch {
    throw new PatientAppError('Sign in required', 401, 'unauthenticated');
  }

  const account = await prisma.patientAccount.findFirst({
    where: { id: parsed.accountId, clientId: parsed.clientId, status: 'ACTIVE' },
    include: { client: { select: { id: true, name: true, email: true, phone: true, status: true, active: true } } },
  });

  if (!account || !account.passwordHash || !account.client.active || account.client.status === 'DISCHARGED' ||
      !matchesPatientCredential(parsed.credential, account.passwordHash)) {
    throw new PatientAppError('Sign in required', 401, 'unauthenticated');
  }

  return {
    accountId: account.id,
    clientId: account.client.id,
    name: account.client.name,
    email: account.email,
    phone: account.client.phone,
    status: account.status,
  };
}
