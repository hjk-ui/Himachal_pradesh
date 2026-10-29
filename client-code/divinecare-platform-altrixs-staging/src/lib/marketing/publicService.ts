/**
 * Public endpoints (no staff session): hosted intake form, event registration, unsubscribe.
 * Returns only what the public page needs (no staff, client or lead data). Spam: honeypot +
 * minimum fill time + rate limits (route). Bots get a normal-looking success and nothing is saved.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { CONTACT_CONSENT_TEXT, NO_PHI_FORM_NOTICE, SMS_CONSENT_TEXT } from './constants';
import { HOW_HEARD_OPTIONS, isSpam, normalizeFormFields, validateSubmission, type Submission } from './forms';
import { isValidEmail, toUsE164 } from './consent';
import { practiceInfo, getMarketingSettings } from './settings';
import { createLead } from './leadService';
import { routeWebFormToWaitlist } from '@/lib/waitlist/webForm';
import { createContact } from './hubService';
import { fireTrigger } from './automationService';
import type { UnsubKind } from './tokens';

async function orgBySlug(slug: string) {
  return prisma.organization.findFirst({ where: { slug, active: true }, select: { id: true, name: true, slug: true } });
}

export async function getPublicForm(orgSlug: string, formSlug: string) {
  const org = await orgBySlug(orgSlug);
  if (!org) return null;
  const settings = await getMarketingSettings(org.id);
  if (!settings.publicFormsEnabled) return null;
  const form = await prisma.marketingForm.findFirst({ where: { organizationId: org.id, slug: formSlug, active: true } });
  if (!form) return null;
  const practice = await practiceInfo(org.id);
  const fill = (t: string) => t.replace(/\{practice\}/g, practice.name);
  return {
    practiceName: practice.name,
    practicePhone: practice.phone,
    formName: form.name,
    fields: normalizeFormFields(form.fields),
    serviceOptions: form.serviceOptions,
    locationOptions: form.locationOptions,
    howHeardOptions: HOW_HEARD_OPTIONS.map((h) => h.label),
    contactConsentText: fill(CONTACT_CONSENT_TEXT),
    smsConsentText: fill(SMS_CONSENT_TEXT),
    notice: NO_PHI_FORM_NOTICE,
    renderedAt: Date.now(),
  };
}

export type PublicSubmitResult = { ok: true; message: string; status?: undefined; errors?: undefined; error?: undefined } | { ok: false; status: number; errors?: Record<string, string>; error?: string };

export async function submitPublicForm(orgSlug: string, formSlug: string, body: Submission, now = new Date()): Promise<PublicSubmitResult> {
  const org = await orgBySlug(orgSlug);
  if (!org) return { ok: false, status: 404, error: 'Form not found.' };
  const settings = await getMarketingSettings(org.id);
  const form = await prisma.marketingForm.findFirst({ where: { organizationId: org.id, slug: formSlug, active: true } });
  if (!form || !settings.publicFormsEnabled) return { ok: false, status: 404, error: 'Form not found.' };
  const message = form.confirmationMessage;
  if (isSpam({ honeypot: body.website as string | undefined, renderedAt: Number(body.renderedAt), now: now.getTime() })) {
    return { ok: true, message };
  }
  const v = validateSubmission(normalizeFormFields(form.fields), body, { serviceOptions: form.serviceOptions, locationOptions: form.locationOptions, now });
  if (v.ok === false) return { ok: false, status: 400, errors: v.errors };
  const s = v.value;
  const loc = s.location ? await prisma.location.findFirst({ where: { organizationId: org.id, name: s.location }, select: { id: true } }).catch(() => null) : null;
  const leadResult = await createLead(
    org.id,
    {
      firstName: s.firstName,
      lastName: s.lastName,
      phone: s.phone,
      email: s.email,
      dateOfBirth: s.dateOfBirth,
      source: s.source,
      sourceDetail: s.sourceDetail ?? form.name,
      formId: form.id,
      serviceInterest: s.serviceInterest,
      locationId: loc?.id ?? null,
      locationName: s.location,
      insurance: s.insurance,
      preferredContact: s.preferredContact,
      contactConsent: s.contactConsent,
      smsConsent: s.smsConsent,
      smsConsentSource: s.smsConsent ? `web_form:${form.slug}` : null,
      emailConsent: false,
    },
    null,
  );
  // Self-referral lands on the clinic waitlist as New (deduped; never fails the submission)
  await routeWebFormToWaitlist(org.id, {
    leadId: leadResult.ok ? leadResult.lead.id : null,
    firstName: s.firstName,
    lastName: s.lastName,
    phone: s.phone,
    email: s.email,
    dateOfBirth: s.dateOfBirth,
    serviceInterest: s.serviceInterest,
    locationId: loc?.id ?? null,
    insurance: s.insurance,
    preferredContact: s.preferredContact,
    formName: form.name,
  });
  await prisma.marketingForm.update({ where: { id: form.id }, data: { submissionCount: { increment: 1 } } });
  return { ok: true, message };
}

export async function getPublicEvent(orgSlug: string, slug: string) {
  const org = await orgBySlug(orgSlug);
  if (!org) return null;
  const e = await prisma.communityEvent.findFirst({ where: { organizationId: org.id, registrationSlug: slug, registrationOpen: true } });
  if (!e) return null;
  const practice = await practiceInfo(org.id);
  return {
    practiceName: practice.name,
    title: e.title,
    eventType: e.eventType,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    locationName: e.locationName,
    description: e.description,
    closed: e.endsAt.getTime() < Date.now(),
    smsConsentText: SMS_CONSENT_TEXT.replace(/\{practice\}/g, practice.name).replace('about my inquiry, including follow-ups and scheduling', 'about this and future community events'),
    renderedAt: Date.now(),
  };
}

export async function registerForEvent(orgSlug: string, slug: string, body: Record<string, unknown>, now = new Date()): Promise<PublicSubmitResult> {
  const org = await orgBySlug(orgSlug);
  if (!org) return { ok: false, status: 404, error: 'Event not found.' };
  const e = await prisma.communityEvent.findFirst({ where: { organizationId: org.id, registrationSlug: slug, registrationOpen: true } });
  if (!e || e.endsAt.getTime() < now.getTime()) return { ok: false, status: 404, error: 'Registration is closed.' };
  const okMsg = `You are registered for ${e.title}. See you there.`;
  if (isSpam({ honeypot: body.website as string | undefined, renderedAt: Number(body.renderedAt), now: now.getTime() })) return { ok: true, message: okMsg };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = 'Enter your name.';
  if (email && !isValidEmail(email)) errors.email = 'Enter a valid email.';
  const phone = phoneRaw ? toUsE164(phoneRaw) : null;
  if (phoneRaw && !phone) errors.phone = 'Enter a 10-digit US phone number.';
  if (!email && !phone) errors.email = errors.email ?? 'Enter an email or phone so we can send event updates.';
  const emailConsent = body.emailConsent === true;
  const smsConsent = body.smsConsent === true && Boolean(phone);
  if (Object.keys(errors).length) return { ok: false, status: 400, errors };
  const c = await createContact(org.id, { name, email: email || null, phone, kind: 'event_attendee', emailConsent, smsConsent, tags: [e.eventType], source: `event:${e.id}` }, null);
  const contactId = c.ok ? c.contact.id : null;
  await prisma.marketingEventRegistration.create({ data: { organizationId: org.id, eventId: e.id, name, email: email || null, phone, emailConsent, smsConsent, contactId } });
  await prisma.communityEvent.update({ where: { id: e.id }, data: { registeredCount: { increment: 1 } } });
  if (contactId) await fireTrigger(org.id, { type: 'event_registered', contactId, eventId: e.id }).catch(() => {});
  return { ok: true, message: okMsg };
}

/** One-click unsubscribe (email). Marks the lead or contact, and counts it on the last campaign. */
export async function applyUnsubscribe(t: { kind: UnsubKind; id: string }, now = new Date()) {
  if (t.kind === 'lead') {
    const l = await prisma.marketingLead.findUnique({ where: { id: t.id }, select: { id: true, organizationId: true, emailOptOutAt: true } });
    if (!l) return false;
    if (!l.emailOptOutAt) await prisma.marketingLead.update({ where: { id: l.id }, data: { emailOptOutAt: now, emailConsent: false } });
    await prisma.marketingLeadActivity.create({ data: { organizationId: l.organizationId, leadId: l.id, kind: 'system', summary: 'Unsubscribed from email.' } });
    await writeAuditLog({ action: 'MARKETING_UNSUBSCRIBE', actorRole: 'PUBLIC', organizationId: l.organizationId, resourceType: 'marketing_lead', resourceId: l.id }).catch(() => {});
    return true;
  }
  const c = await prisma.marketingContact.findUnique({ where: { id: t.id }, select: { id: true, organizationId: true, emailOptOutAt: true } });
  if (!c) return false;
  if (!c.emailOptOutAt) {
    await prisma.marketingContact.update({ where: { id: c.id }, data: { emailOptOutAt: now, emailConsent: false } });
    const last = await prisma.marketingMessage.findFirst({ where: { contactId: c.id, campaignId: { not: null }, channel: 'email' }, orderBy: { createdAt: 'desc' }, select: { campaignId: true } });
    if (last?.campaignId) await prisma.marketingCampaign.update({ where: { id: last.campaignId }, data: { unsubscribedCount: { increment: 1 } } }).catch(() => {});
  }
  await writeAuditLog({ action: 'MARKETING_UNSUBSCRIBE', actorRole: 'PUBLIC', organizationId: c.organizationId, resourceType: 'marketing_contact', resourceId: c.id }).catch(() => {});
  return true;
}
