import { compare } from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError } from '@/patient/domain';
import { signPatientSession } from '@/patient/infrastructure/security/tokens';
import { defaultPerson, listPortalPeople, resolvePortalAccess } from '@/patient/application/auth/session';

const DUMMY_PASSWORD_HASH =
  '$2b$12$LH3C5unQdTjVgR.zuxsKeOBq.CqLTbHnOI1V8qWfm4yO5bdvmC1Wq';

/**
 * One email = one portal user. After the password check the session opens the default person
 * (last viewed, else the user's own chart, else the first linked child / represented adult); the
 * response lists everyone this login may switch to (POST /api/patient/session/switch).
 */
export async function loginPatient(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const account = await prisma.patientAccount.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, displayName: true, passwordHash: true, status: true, clientId: true, lastActiveClientId: true },
  });

  const hash = account?.passwordHash || DUMMY_PASSWORD_HASH;
  const ok = await compare(password, hash);

  if (!account || !account.passwordHash || !ok) {
    throw new PatientAppError('Invalid email or password', 401, 'invalid_credentials');
  }

  if (account.status !== 'ACTIVE') {
    throw new PatientAppError('This account is no longer active', 403, 'disabled');
  }

  const user = { id: account.id, clientId: account.clientId ?? null, displayName: account.displayName ?? null };
  const people = await listPortalPeople(user);
  const person = defaultPerson(people, account.lastActiveClientId ?? null);
  if (!person) {
    // A guardian login whose access the clinic has not verified yet (never says whose chart)
    const pending = await prisma.portalAccess.findMany({ where: { portalUserId: account.id, revokedAt: null, verifiedAt: null }, select: { id: true }, take: 1 });
    if (pending.length > 0) {
      throw new PatientAppError('Your access is waiting for the clinic to verify it. Please contact the clinic.', 403, 'pending_verification');
    }
    throw new PatientAppError('This account is no longer active', 403, 'disabled');
  }
  // Same server-side check every request makes (never trust the picker alone)
  const resolved = await resolvePortalAccess(user, person.clientId);
  if (resolved.ok === false) {
    throw new PatientAppError('This account is no longer active', 403, 'disabled');
  }

  const token = signPatientSession(account.id, resolved.client.id, account.passwordHash);
  return {
    token,
    accountId: account.id,
    client: {
      id: resolved.client.id,
      name: resolved.client.name,
      email: account.email,
      phone: resolved.client.phone,
    },
    actingAs: {
      clientId: resolved.client.id,
      clientName: resolved.client.name,
      relationship: resolved.actor.relationship,
      accessLevel: resolved.actor.accessLevel,
      isProxy: resolved.actor.isProxy,
      actorName: resolved.actor.actorName,
    },
    accessId: resolved.actor.accessId,
    people,
  };
}
