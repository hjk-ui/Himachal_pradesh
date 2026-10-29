/**
 * Marketing side of inbound SMS (called from src/lib/sms/inbound.ts). Opt-out is per NUMBER:
 *   STOP  -> smsOptOutAt on every lead and marketing contact with that number
 *   START -> clears the opt-out (consent recorded, source sms_unstop)
 *   other -> stored on the matching open lead's conversation (the lead texted us; this is their
 *            own inquiry, kept in Altrixs only) + optional business-hours auto-reply
 * Never throws into the caller; tolerant of test doubles without marketing tables.
 */
import { phoneKey } from './leads';
import { withinBusinessHours } from './consent';
import { OPEN_STAGES } from './constants';

type Db = any;

export async function applyMarketingInbound(
  db: Db,
  input: { from: string; keyword: 'stop' | 'unstop' | 'help' | 'confirm' | 'other'; body: string; now: Date },
): Promise<{ leads: number; contacts: number; recorded: boolean; autoReplyLeadId: string | null }> {
  const out = { leads: 0, contacts: 0, recorded: false, autoReplyLeadId: null as string | null };
  if (!db?.marketingLead || !db?.marketingContact) return out;
  const key = phoneKey(input.from);
  if (!key) return out;
  try {
    const leads: { id: string; organizationId: string; phone: string | null; stage: string; lastInboundAt: Date | null }[] = await db.marketingLead.findMany({
      where: { phone: { contains: key.slice(-4) } },
      select: { id: true, organizationId: true, phone: true, stage: true, lastInboundAt: true },
      take: 200,
    });
    const leadHits = leads.filter((l) => phoneKey(l.phone) === key);
    const contacts: { id: string; phone: string | null }[] = await db.marketingContact.findMany({ where: { phone: { contains: key.slice(-4) } }, select: { id: true, phone: true }, take: 200 });
    const contactHits = contacts.filter((c) => phoneKey(c.phone) === key);
    out.leads = leadHits.length;
    out.contacts = contactHits.length;
    if (input.keyword === 'stop') {
      if (leadHits.length) await db.marketingLead.updateMany({ where: { id: { in: leadHits.map((l) => l.id) }, smsOptOutAt: null }, data: { smsOptOutAt: input.now, smsConsent: false } });
      if (contactHits.length) await db.marketingContact.updateMany({ where: { id: { in: contactHits.map((c) => c.id) }, smsOptOutAt: null }, data: { smsOptOutAt: input.now, smsConsent: false } });
      for (const l of leadHits) await db.marketingLeadActivity.create({ data: { organizationId: l.organizationId, leadId: l.id, kind: 'system', summary: 'Replied STOP: texts stopped.' } }).catch(() => {});
    } else if (input.keyword === 'unstop') {
      if (leadHits.length) await db.marketingLead.updateMany({ where: { id: { in: leadHits.map((l) => l.id) } }, data: { smsOptOutAt: null, smsConsent: true, smsConsentAt: input.now, smsConsentSource: 'sms_unstop' } });
      if (contactHits.length) await db.marketingContact.updateMany({ where: { id: { in: contactHits.map((c) => c.id) } }, data: { smsOptOutAt: null, smsConsent: true, smsConsentAt: input.now } });
    } else if (input.keyword === 'other') {
      const open = leadHits.filter((l) => (OPEN_STAGES as string[]).includes(l.stage)).sort((a, b) => (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0))[0];
      if (open) {
        await db.marketingMessage.create({ data: { organizationId: open.organizationId, leadId: open.id, channel: 'sms', direction: 'inbound', body: input.body.slice(0, 1600), status: 'received' } });
        await db.marketingLead.update({ where: { id: open.id }, data: { lastInboundAt: input.now } });
        out.recorded = true;
        const settings = db.marketingSettings ? await db.marketingSettings.findUnique({ where: { organizationId: open.organizationId } }).catch(() => null) : null;
        if (settings?.autoReplyEnabled && settings.autoReplyText && !withinBusinessHours(settings.businessHours ?? {}, settings.timeZone ?? 'America/New_York', input.now)) {
          out.autoReplyLeadId = open.id;
        }
      }
    }
  } catch (err) {
    console.error('[sms:inbound] marketing hook', err instanceof Error ? err.name : 'error');
  }
  return out;
}

/** Business-hours auto-reply (inquiry_reply: answers the text the lead just sent; STOP still honored). */
export async function sendAutoReply(leadId: string) {
  const { prisma } = await import('@/lib/db/prisma');
  const lead = await prisma.marketingLead.findUnique({ where: { id: leadId }, select: { organizationId: true } });
  if (!lead) return;
  const s = await prisma.marketingSettings.findUnique({ where: { organizationId: lead.organizationId } });
  if (!s?.autoReplyText) return;
  const { sendLeadMessage } = await import('./leadService');
  await sendLeadMessage(lead.organizationId, leadId, { channel: 'sms', body: s.autoReplyText }, null, { purpose: 'inquiry_reply' });
}

/** Missed-call text-back: only for a known lead number; unknown callers get a call-back task, never a cold text. */
export async function handleMissedCall(organizationId: string, fromNumber: string) {
  const { prisma } = await import('@/lib/db/prisma');
  const key = phoneKey(fromNumber);
  if (!key) return { texted: false, taskCreated: false };
  const s = await prisma.marketingSettings.findUnique({ where: { organizationId } });
  const leads = await prisma.marketingLead.findMany({ where: { organizationId, phone: { contains: key.slice(-4) }, stage: { in: OPEN_STAGES } }, take: 20 });
  const lead = leads.find((l) => phoneKey(l.phone) === key);
  const { addLeadTask, sendLeadMessage } = await import('./leadService');
  if (lead) {
    await prisma.marketingLead.update({ where: { id: lead.id }, data: { lastInboundAt: new Date() } });
    let texted = false;
    if (s?.missedCallTextBack && s.missedCallText) {
      const r = await sendLeadMessage(organizationId, lead.id, { channel: 'sms', body: s.missedCallText }, null, { purpose: 'inquiry_reply' });
      texted = r.ok && r.result.status === 'sent';
    }
    await addLeadTask(organizationId, lead.id, { title: 'Return missed call', dueAt: new Date(Date.now() + 30 * 60000), assignedToId: lead.assignedToId, source: 'automation' }, null);
    return { texted, taskCreated: true };
  }
  await addLeadTask(organizationId, null, { title: `Return missed call from number ending ${key.slice(-4)}`, dueAt: new Date(Date.now() + 30 * 60000), source: 'automation' }, null);
  return { texted: false, taskCreated: true };
}
