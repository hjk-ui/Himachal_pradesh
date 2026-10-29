import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError } from '@/patient/domain';
import {
  sendPatientInviteEmail,
  sendPatientEmailChangedNotification,
} from '@/patient/infrastructure/notifications/email';
import { sendPatientInviteSms } from '@/patient/infrastructure/notifications/sms';
import {
  hashInviteToken,
  inviteExpiry,
  newInviteToken,
} from '@/patient/infrastructure/security/tokens';

export type AppInviteResult = {
  invited: boolean;
  emailMode?: 'smtp' | 'ses' | 'console';
  error?: string;
  /** Invitation text outcome (consent-gated): honest sent / not-sent sentence for staff */
  sms?: { sent: boolean; reason?: string; message: string };
};

export async function invitePatientForClient(
  clientId: string,
  options?: { force?: boolean }
): Promise<AppInviteResult> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      patientAccount: { select: { id: true, status: true, passwordHash: true, email: true } },
    },
  });

  if (!client) {
    throw new PatientAppError('Client not found', 404, 'not_found');
  }

  const email = client.email?.trim().toLowerCase() || null;
  if (!email) {
    return { invited: false, error: 'Client has no email address on file' };
  }

  // If already active with a password and not forcing a re-invite
  if (
    client.patientAccount?.status === 'ACTIVE' &&
    client.patientAccount.passwordHash &&
    !options?.force &&
    client.patientAccount.email.toLowerCase() === email
  ) {
    return { invited: false, error: 'already_active' };
  }

  const rawToken = newInviteToken();
  const inviteTokenHash = hashInviteToken(rawToken);
  const inviteExpiresAt = inviteExpiry();

  try {
    await prisma.patientAccount.upsert({
      where: { clientId: client.id },
      create: {
        clientId: client.id,
        email,
        status: 'INVITED',
        passwordHash: null,
        inviteTokenHash,
        inviteExpiresAt,
      },
      update: {
        email,
        status: 'INVITED',
        passwordHash: null,
        inviteTokenHash,
        inviteExpiresAt,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { invited: false, error: 'This email is already associated with another portal account' };
    }
    throw err;
  }

  try {
    const mail = await sendPatientInviteEmail({
      to: email,
      name: client.name,
      rawToken,
    });
    // Consent-gated (never throws): skipped without text-message consent, STOP or a valid number
    const text = client.phone?.trim() ? await sendPatientInviteSms({ clientId: client.id, rawToken }) : null;
    const sms = text ? { sent: text.sent, ...('reason' in text ? { reason: text.reason } : {}), message: text.message } : undefined;
    return { invited: true, emailMode: mail.mode, ...(sms ? { sms } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email failed';
    console.error('[patient invite mail]', message);
    return { invited: true, error: message };
  }
}

/**
 * Synchronizes PatientAccount.email whenever Client.email is created or changed.
 * - If client had no account, onboards them fresh (sending invitation).
 * - If account was INVITED (pending activation), re-issues fresh token and sends invitation to new email.
 * - If account was ACTIVE (password already set), updates email and notifies new email so patient can sign in or reset password.
 */
export async function syncPatientAccountEmail(
  clientId: string,
  rawNewEmail: string | null
): Promise<{ synced: boolean; inviteSent: boolean; error?: string }> {
  const newEmail = rawNewEmail?.trim().toLowerCase() || null;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { patientAccount: true },
  });

  if (!client) {
    return { synced: false, inviteSent: false, error: 'Client not found' };
  }

  // If email was removed, disable the portal account
  if (!newEmail) {
    if (client.patientAccount) {
      await prisma.patientAccount.update({
        where: { id: client.patientAccount.id },
        data: { status: 'DISABLED' },
      });
    }
    return { synced: true, inviteSent: false };
  }

  // Verify email is not owned by a different client's patient account
  // Includes guardian-only logins (clientId null): one email = one portal login
  const conflict = await prisma.patientAccount.findFirst({
    where: {
      email: newEmail,
      OR: [{ clientId: null }, { clientId: { not: clientId } }],
    },
  });
  if (conflict) {
    return { synced: false, inviteSent: false, error: 'This email is already used by another patient portal account' };
  }

  // If no patientAccount exists yet, onboard client fresh
  if (!client.patientAccount) {
    const res = await invitePatientForClient(clientId, { force: true });
    return { synced: true, inviteSent: res.invited, error: res.error };
  }

  const account = client.patientAccount;
  const currentAccountEmail = account.email.trim().toLowerCase();

  // If already in sync, nothing to do
  if (currentAccountEmail === newEmail && account.status !== 'DISABLED') {
    return { synced: true, inviteSent: false };
  }

  // If account is in INVITED state or has no password set yet:
  // Re-issue a fresh invite token and send the portal invitation to the updated email!
  if (account.status === 'INVITED' || !account.passwordHash) {
    const rawToken = newInviteToken();
    const inviteTokenHash = hashInviteToken(rawToken);
    const inviteExpiresAt = inviteExpiry();

    await prisma.patientAccount.update({
      where: { id: account.id },
      data: {
        email: newEmail,
        status: 'INVITED',
        passwordHash: null,
        inviteTokenHash,
        inviteExpiresAt,
      },
    });

    try {
      await sendPatientInviteEmail({
        to: newEmail,
        name: client.name,
        rawToken,
      });
      return { synced: true, inviteSent: true };
    } catch (err) {
      console.error('[syncPatientAccountEmail invite failed]', err);
      return { synced: true, inviteSent: false, error: 'Failed to send invite email' };
    }
  }

  // If account is ACTIVE (password is set):
  // Update PatientAccount.email to match the client's updated email!
  await prisma.patientAccount.update({
    where: { id: account.id },
    data: {
      email: newEmail,
      status: 'ACTIVE',
    },
  });

  // Notify the patient at their new email address
  try {
    await sendPatientEmailChangedNotification({
      to: newEmail,
      name: client.name,
    });
  } catch (err) {
    console.error('[syncPatientAccountEmail notification failed]', err);
  }

  return { synced: true, inviteSent: false };
}
