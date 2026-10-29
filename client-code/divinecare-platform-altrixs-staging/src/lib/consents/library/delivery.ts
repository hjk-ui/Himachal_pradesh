/**
 * Telling the client that a consent packet is waiting (server). The packet itself is always signed
 * in the patient portal (login required: no signing from an unauthenticated link), in office, or in
 * the public intake. Notifications carry NO PHI: no form names, no diagnosis, no practice
 * specialty beyond the practice's configured sender; the link is the portal sign-in page.
 *
 *  - portal: the packet shows in the portal's "Documents to sign" (needs an active portal login
 *            for the client or a verified proxy; otherwise staff send a portal invite first)
 *  - sms:    through the patient SMS gate (sendPatientSms, purpose documents_to_sign): consent,
 *            STOP and charted number enforced there; logged in NotificationLog without the text
 *  - email:  to the charted email unless the client opted out of email
 * Each send updates ConsentPacket.deliveryChannels / lastSentAt / sendCount (resend tracking).
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { sendEmail } from '@/lib/email/smtp';
import { emailReminderEligibility } from '@/lib/sms/consent';
import { sendPatientSms } from '@/lib/sms/patientSms';
import { documentsToSignSms } from '@/lib/sms/templates';
import { getAppBaseUrl } from '@/lib/staff/invite';
import { loadPracticeIdentity } from '@/lib/practice/identity';

export const NOTIFY_CHANNELS = ['portal', 'email', 'sms'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export type NotifyResult = { channel: NotifyChannel; ok: boolean; message: string };

export function portalDocumentsUrl() {
  return `${getAppBaseUrl()}/patient/documents`;
}

/** Plain email (no PHI): practice name, a neutral sentence and the portal link. */
export function documentsToSignEmail(practiceName: string | null, portalUrl: string): { subject: string; text: string } {
  const from = practiceName?.trim() || 'Your care team';
  return {
    subject: `${from}: forms to review and sign`,
    text: `Hello,\n\nYou have forms to review and sign in your patient portal. Please sign in to complete them:\n${portalUrl}\n\nIf you have questions, call the office.\n\n${from}`,
  };
}

async function hasPortalLogin(organizationId: string, clientId: string): Promise<boolean> {
  const now = new Date();
  const [own, proxy] = await Promise.all([
    prisma.patientAccount.findFirst({ where: { clientId, status: 'ACTIVE', client: { organizationId } }, select: { id: true } }).catch(() => null),
    prisma.portalAccess
      .findFirst({ where: { clientId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], portalUser: { status: 'ACTIVE' } }, select: { id: true } })
      .catch(() => null),
  ]);
  return Boolean(own || proxy);
}

/**
 * Notify the client about an unsigned portal packet on the chosen channels and record the send.
 * Never reports a fake success: each channel says sent or why not.
 */
export async function notifyPacket(input: { organizationId: string; packetId: string; channels: NotifyChannel[]; actor: { userId: string | null; role: string | null } }): Promise<{ ok: true; results: NotifyResult[]; clientId: string } | { ok: false; status: number; error: string }> {
  const p = await prisma.consentPacket.findFirst({ where: { id: input.packetId, organizationId: input.organizationId }, select: { id: true, clientId: true, status: true, method: true, deliveryChannels: true } });
  if (!p) return { ok: false, status: 404, error: 'Packet not found' };
  if (p.status !== 'SENT') return { ok: false, status: 409, error: 'Only an unsigned packet can be sent again.' };
  if (p.method !== 'portal') return { ok: false, status: 409, error: 'This packet is for signing in the office; open it from the client page.' };
  const channels = [...new Set(input.channels)];
  const results: NotifyResult[] = [];
  const url = portalDocumentsUrl();
  const portal = await hasPortalLogin(input.organizationId, p.clientId);
  if (channels.includes('portal')) {
    results.push(portal ? { channel: 'portal', ok: true, message: 'Waiting in the patient portal (Documents to sign).' } : { channel: 'portal', ok: false, message: 'No active portal login for this client. Send a portal invite, or sign in the office.' });
  }
  if (channels.includes('sms')) {
    const r = await sendPatientSms({ clientId: p.clientId, organizationId: input.organizationId, purpose: 'documents_to_sign', build: ({ sender }) => documentsToSignSms({ sender, portalUrl: url }), actor: input.actor });
    results.push({ channel: 'sms', ok: r.sent, message: r.sent ? 'Text sent.' : r.message });
  }
  if (channels.includes('email')) {
    const c = await prisma.client.findFirst({ where: { id: p.clientId, organizationId: input.organizationId }, select: { email: true, emailOptOutAt: true } });
    const elig = emailReminderEligibility({ email: c?.email ?? null, emailOptOutAt: c?.emailOptOutAt ?? null });
    if (elig.ok === false) results.push({ channel: 'email', ok: false, message: elig.reason === 'no_email' ? 'No email address on file.' : 'Client opted out of email.' });
    else {
      try {
        const identity = await loadPracticeIdentity(input.organizationId);
        const mail = documentsToSignEmail(identity.name, url);
        await sendEmail({ to: c!.email!, subject: mail.subject, text: mail.text, context: 'consent-packet' });
        results.push({ channel: 'email', ok: true, message: 'Email sent.' });
      } catch {
        results.push({ channel: 'email', ok: false, message: 'Email could not be sent.' });
      }
      await writeAuditLog({
        action: 'NOTIFY',
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        organizationId: input.organizationId,
        resourceType: 'consentPacket',
        resourceId: p.id,
        patientId: p.clientId,
        outcome: results[results.length - 1].ok ? 'SUCCESS' : 'FAILURE',
        metadata: { channel: 'email' },
      }).catch(() => {});
    }
  }
  const sentOn = results.filter((r) => r.ok).map((r) => r.channel);
  if (sentOn.length) {
    await prisma.consentPacket.update({
      where: { id: p.id },
      data: { deliveryChannels: [...new Set([...p.deliveryChannels, ...sentOn])], lastSentAt: new Date(), sendCount: { increment: 1 } },
    });
  }
  return { ok: true, results, clientId: p.clientId };
}
