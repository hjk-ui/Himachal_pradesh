/**
 * THE sender for marketing and lead messages (classified exception to the patient SMS gate,
 * tests/sms-patient-gate.test.ts): recipients here are leads and opted-in marketing contacts, never
 * clients without a marketing authorization. Every send passes decideSend (consent, STOP, quiet
 * hours, CAN-SPAM address, HIPAA marketing authorization) and is recorded in marketing_messages.
 *
 * Never fakes a send: when SMS (AWS End User Messaging) or email (SES) is not configured on this
 * server the message is saved as "queued" with reason *_not_connected, and staff see "connect to send".
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { isSnsSmsConfigured, sendSms, smsWasSent } from '@/lib/sms/send';
import { isSmtpConfigured, sendEmail } from '@/lib/email/smtp';
import {
  decideSend,
  emailFooterText,
  emailHtml,
  withSmsFooter,
  type BlockReason,
  type ConsentRecipient,
  type SendChannel,
  type SendPurpose,
} from './consent';
import { getMarketingSettings, practiceInfo } from './settings';
import { unsubscribeUrl, type UnsubKind } from './tokens';

export type MarketingSendInput = {
  organizationId: string;
  channel: SendChannel;
  purpose: SendPurpose;
  recipient: ConsentRecipient;
  body: string;
  subject?: string | null;
  leadId?: string | null;
  contactId?: string | null;
  campaignId?: string | null;
  runId?: string | null;
  templateId?: string | null;
  variant?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  /** Re-send of a message queued for quiet hours: update that row instead of adding one */
  existingMessageId?: string | null;
  now?: Date;
};

export type MarketingSendResult =
  | { status: 'sent'; messageId: string }
  | { status: 'queued'; messageId: string; reason: 'sms_not_connected' | 'email_not_connected' | 'quiet_hours'; deferUntil?: Date }
  | { status: 'blocked'; messageId: string | null; reason: BlockReason }
  | { status: 'failed'; messageId: string; reason: string };

export type SendDeps = {
  db: any;
  smsConfigured: () => boolean;
  emailConfigured: () => boolean;
  sendSms: typeof sendSms;
  sendEmail: typeof sendEmail;
  audit: typeof writeAuditLog;
};

export const defaultSendDeps = (): SendDeps => ({
  db: prisma,
  smsConfigured: isSnsSmsConfigured,
  emailConfigured: isSmtpConfigured,
  sendSms,
  sendEmail,
  audit: writeAuditLog,
});

export async function sendMarketingMessage(input: MarketingSendInput, deps: SendDeps = defaultSendDeps()): Promise<MarketingSendResult> {
  const now = input.now ?? new Date();
  const settings = await getMarketingSettings(input.organizationId);
  const practice = await practiceInfo(input.organizationId);
  const decision = decideSend(input.recipient, input.channel, input.purpose, {
    now,
    timeZone: settings.timeZone,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    physicalAddress: settings.physicalAddress,
  });

  const record = async (status: string, reason: string | null, body: string, providerMessageId?: string | null) => {
    const row = input.existingMessageId
      ? await deps.db.marketingMessage.update({ where: { id: input.existingMessageId }, data: { status, reason, body, providerMessageId: providerMessageId ?? null } })
      : await deps.db.marketingMessage.create({
      data: {
        organizationId: input.organizationId,
        leadId: input.leadId ?? null,
        contactId: input.contactId ?? null,
        campaignId: input.campaignId ?? null,
        runId: input.runId ?? null,
        channel: input.channel,
        direction: 'outbound',
        subject: input.subject ?? null,
        body,
        status,
        reason,
        templateId: input.templateId ?? null,
        variant: input.variant ?? null,
        sentById: input.actorId ?? null,
        providerMessageId: providerMessageId ?? null,
      },
    });
    await deps
      .audit({
        action: status === 'sent' ? 'MARKETING_MESSAGE_SENT' : 'MARKETING_MESSAGE_NOT_SENT',
        actorUserId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        organizationId: input.organizationId,
        resourceType: input.leadId ? 'marketing_lead' : 'marketing_contact',
        resourceId: input.leadId ?? input.contactId ?? null,
        outcome: status === 'sent' ? 'SUCCESS' : status === 'blocked' ? 'DENIED' : 'FAILURE',
        metadata: { channel: input.channel, purpose: input.purpose, status, reason, campaignId: input.campaignId ?? null },
      })
      .catch(() => {});
    return row.id as string;
  };

  if (decision.ok === false) {
    if (decision.reason === 'quiet_hours') {
      const id = await record('queued', 'quiet_hours', input.body);
      return { status: 'queued', messageId: id, reason: 'quiet_hours', deferUntil: decision.deferUntil };
    }
    const id = await record('blocked', decision.reason, input.body);
    return { status: 'blocked', messageId: id, reason: decision.reason };
  }

  if (input.channel === 'sms') {
    const body = withSmsFooter(input.body.startsWith(practice.name) ? input.body : `${practice.name}: ${input.body}`);
    if (!deps.smsConfigured()) {
      const id = await record('queued', 'sms_not_connected', body);
      return { status: 'queued', messageId: id, reason: 'sms_not_connected' };
    }
    try {
      const r = await deps.sendSms({ to: decision.to, body, context: `marketing-${input.purpose}` });
      if (!smsWasSent(r)) {
        const id = await record('queued', 'sms_not_connected', body);
        return { status: 'queued', messageId: id, reason: 'sms_not_connected' };
      }
      const id = await record('sent', null, body, r.messageId ?? null);
      return { status: 'sent', messageId: id };
    } catch {
      const id = await record('failed', 'send_error', body);
      return { status: 'failed', messageId: id, reason: 'send_error' };
    }
  }

  // email
  const subject = (input.subject ?? '').trim() || `A message from ${practice.name}`;
  const kind: UnsubKind = input.leadId ? 'lead' : 'contact';
  const id0 = input.leadId ?? input.contactId ?? '';
  let unsub = '';
  try {
    unsub = id0 ? unsubscribeUrl(kind, id0) : '';
  } catch {
    unsub = '';
  }
  const address = settings.physicalAddress?.trim() || '';
  if (input.purpose === 'marketing' && (!unsub || !address)) {
    const id = await record('blocked', !address ? 'no_physical_address' : 'no_unsubscribe_link', input.body);
    return { status: 'blocked', messageId: id, reason: 'no_physical_address' };
  }
  const footerOpts = { practiceName: practice.name, physicalAddress: address || practice.name, unsubscribeUrl: unsub || '(reply STOP to this email)' };
  const text = `${input.body.trim()}\n${emailFooterText(footerOpts)}`;
  if (!deps.emailConfigured()) {
    const id = await record('queued', 'email_not_connected', text);
    return { status: 'queued', messageId: id, reason: 'email_not_connected' };
  }
  try {
    await deps.sendEmail({
      to: decision.to,
      subject,
      text,
      html: emailHtml(input.body, footerOpts),
      headers: unsub ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
      context: `marketing-${input.purpose}`,
    });
    const id = await record('sent', null, text);
    return { status: 'sent', messageId: id };
  } catch {
    const id = await record('failed', 'send_error', text);
    return { status: 'failed', messageId: id, reason: 'send_error' };
  }
}

export const SEND_STATUS_TEXT: Record<string, string> = {
  sent: 'Sent.',
  queued: 'Saved as queued. Connect the SMS number / sender email to send.',
  blocked: 'Not sent: consent check failed.',
  failed: 'Not sent: the delivery service returned an error.',
  sms_not_connected: 'Saved, not sent: the SMS number is not connected on this server.',
  email_not_connected: 'Saved, not sent: the sender email (SES) is not connected on this server.',
  quiet_hours: 'Queued until quiet hours end.',
};
