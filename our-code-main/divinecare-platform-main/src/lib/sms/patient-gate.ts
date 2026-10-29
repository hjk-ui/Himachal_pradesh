import { prisma } from '@/lib/db/prisma';

/**
 * Patient-facing SMS consent gate (Oct 21 staging).
 * Staff destinations omit clientId or set bypassPatientGate.
 */

export async function patientSmsAllowed(clientId: string): Promise<{
  allowed: boolean;
  reason?: 'no_consent' | 'opted_out' | 'not_found';
}> {
  const client = await prisma.client.findFirst({
    where: { id: clientId },
    select: {
      id: true,
      smsConsent: true,
      smsOptOutAt: true,
    },
  });
  if (!client) return { allowed: false, reason: 'not_found' };
  if (client.smsOptOutAt) return { allowed: false, reason: 'opted_out' };
  if (client.smsConsent) return { allowed: true };

  // Legacy fallback: signed SMS ConsentForm still counts until Client fields are backfilled
  const latestSms = await prisma.consentForm.findFirst({
    where: {
      clientId,
      type: { contains: 'sms', mode: 'insensitive' },
    },
    orderBy: { updatedAt: 'desc' },
    select: { status: true, expiresAt: true, signedAt: true },
  });
  const smsOn =
    latestSms?.status === 'SIGNED' &&
    (!latestSms.expiresAt || latestSms.expiresAt > new Date());
  if (smsOn) {
    await prisma.client
      .update({
        where: { id: clientId },
        data: {
          smsConsent: true,
          smsConsentAt: latestSms.signedAt || new Date(),
          smsConsentSource: 'consent_form',
          smsOptOutAt: null,
        },
      })
      .catch(() => undefined);
    return { allowed: true };
  }
  return { allowed: false, reason: 'no_consent' };
}

export async function applySmsOptOut(clientId: string, source = 'inbound_stop') {
  await prisma.client.update({
    where: { id: clientId },
    data: {
      smsConsent: false,
      smsOptOutAt: new Date(),
      smsConsentSource: source,
    },
  });
}

export async function applySmsOptIn(clientId: string, source = 'inbound_start') {
  await prisma.client.update({
    where: { id: clientId },
    data: {
      smsConsent: true,
      smsConsentAt: new Date(),
      smsConsentSource: source,
      smsOptOutAt: null,
    },
  });
}

export async function findClientIdByPhone(phoneE164: string): Promise<string | null> {
  const digits = phoneE164.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length < 10) return null;
  const clients = await prisma.client.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
    take: 5000,
  });
  for (const c of clients) {
    const p = (c.phone || '').replace(/\D/g, '');
    if (p.slice(-10) === last10) return c.id;
  }
  return null;
}
