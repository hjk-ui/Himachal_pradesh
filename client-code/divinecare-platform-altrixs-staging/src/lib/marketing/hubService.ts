/**
 * Marketing hub service (Prisma): reputation, testimonials, audience contacts, campaigns, social
 * planner, partners, events, forms, templates, workflows, spend and analytics. Org-scoped.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { consentOnFile } from '@/lib/consents/onFile';
import { formKeyFor } from '@/lib/consents/library/catalog';
import {
  averageRating,
  eventRoi,
  partnerLeaderboard,
  ratingTrend,
  sourceReport,
  speedSummary,
  stageFunnel,
} from './attribution';
import { validateWorkflow, RECIPES } from './automation';
import { leadSourceLabel, OPEN_STAGES } from './constants';
import { marketingAuthorizationState } from './consent';
import { normalizeFormFields, slugify, SLUG_RE, STANDARD_FIELDS } from './forms';
import { abVariant, planAudience, validateSegment, type AudienceContact } from './segments';
import { getMarketingSettings } from './settings';
import { sendMarketingMessage } from './send';
import { fireTrigger } from './automationService';
import type { GrowthAggregates } from './aiTemplates';

type Actor = { userId: string; role: string; name?: string | null };
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const LEADERSHIP = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

// ─── Reviews ────────────────────────────────────────────────────────────────────────────

export async function listReviews(organizationId: string) {
  const rows = await prisma.marketingReview.findMany({ where: { organizationId }, orderBy: { reviewedAt: 'desc' }, take: 300 });
  return {
    reviews: rows.map((r) => ({
      id: r.id,
      source: r.source,
      locationName: r.locationName,
      rating: r.rating,
      authorName: r.authorName,
      body: r.body,
      reviewedAt: r.reviewedAt.toISOString(),
      responseDraft: r.responseDraft,
      responseStatus: r.responseStatus,
      respondedAt: iso(r.respondedAt),
    })),
    averageRating: averageRating(rows),
    trend: ratingTrend(rows, 6),
  };
}

export async function createReview(organizationId: string, input: { source: string; rating: number; authorName?: string | null; body?: string; reviewedAt?: string | null; locationName?: string | null; externalId?: string | null }, actor: Actor) {
  const r = await prisma.marketingReview.create({
    data: {
      organizationId,
      source: input.source,
      rating: Math.min(5, Math.max(1, Math.round(input.rating))),
      authorName: input.authorName?.trim() || null,
      body: input.body?.trim() ?? '',
      reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : new Date(),
      locationName: input.locationName?.trim() || null,
      externalId: input.externalId?.trim() || null,
    },
  });
  await writeAuditLog({ action: 'MARKETING_REVIEW_ADD', actorUserId: actor.userId, actorRole: actor.role, organizationId, resourceType: 'marketing_review', resourceId: r.id }).catch(() => {});
  await fireTrigger(organizationId, { type: 'review_received', reviewId: r.id, rating: r.rating }).catch(() => {});
  return r;
}

// ─── Testimonials ───────────────────────────────────────────────────────────────────────

export function testimonialUsable(t: { status: string; authorizationSignedAt: Date | null; authorizationExpiresAt: Date | null; authorizationRevokedAt: Date | null }, now = new Date()): boolean {
  return t.status === 'approved' && marketingAuthorizationState({ marketingAuthorizationAt: t.authorizationSignedAt, marketingAuthorizationExpiresAt: t.authorizationExpiresAt, marketingAuthorizationRevokedAt: t.authorizationRevokedAt }, now) === 'valid';
}

/** Signed consent-library form (by template key) for a client: the authorization of record. */
export async function signedAuthorizationFor(organizationId: string, clientId: string, templateKey: string, typeWord: 'marketing' | 'testimonial') {
  const typeRe = new RegExp(`\\b${typeWord}\\b`, 'i');
  const rows = await prisma.consentForm.findMany({
    where: { organizationId, clientId, OR: [{ formKey: formKeyFor(templateKey) }, { type: { contains: typeWord, mode: 'insensitive' } }] },
    select: { id: true, type: true, formKey: true, status: true, formStatus: true, expiresAt: true, revokedAt: true, signedAt: true, clientSignedAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const now = new Date();
  for (const r of rows) {
    if (consentOnFile([r], templateKey, typeRe, now)) return { ref: r.id, signedAt: r.clientSignedAt ?? r.signedAt ?? now, expiresAt: r.expiresAt };
  }
  return null;
}

export async function listTestimonials(organizationId: string) {
  const rows = await prisma.marketingTestimonial.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const now = new Date();
  return rows.map((t) => ({
    id: t.id,
    quote: t.quote,
    displayName: t.displayName,
    status: t.status,
    authorizationSignedAt: iso(t.authorizationSignedAt),
    authorizationExpiresAt: iso(t.authorizationExpiresAt),
    authorizationRevokedAt: iso(t.authorizationRevokedAt),
    hasClientLink: Boolean(t.clientId),
    allowedChannels: t.allowedChannels,
    usable: testimonialUsable(t, now),
  }));
}

export async function createTestimonial(
  organizationId: string,
  input: { quote: string; displayName: string; clientId?: string | null; authorizationSignedAt?: string | null; authorizationExpiresAt?: string | null; authorizationRef?: string | null; allowedChannels?: string[] },
  actor: Actor,
) {
  let signedAt = input.authorizationSignedAt ? new Date(input.authorizationSignedAt) : null;
  let expiresAt = input.authorizationExpiresAt ? new Date(input.authorizationExpiresAt) : null;
  let ref = input.authorizationRef?.trim() || null;
  if (input.clientId) {
    const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId }, select: { id: true } });
    if (!client) return { ok: false as const, status: 404, error: 'Client not found.' };
    const settings = await getMarketingSettings(organizationId);
    const auth = await signedAuthorizationFor(organizationId, input.clientId, settings.testimonialAuthTemplateKey, 'testimonial');
    if (!auth) return { ok: false as const, status: 409, error: `No signed testimonial authorization on file for this client (consent template "${settings.testimonialAuthTemplateKey}"). Send it from Consents first.` };
    signedAt = auth.signedAt;
    expiresAt = auth.expiresAt;
    ref = auth.ref;
  }
  const t = await prisma.marketingTestimonial.create({
    data: {
      organizationId,
      quote: input.quote.trim(),
      displayName: input.displayName.trim(),
      clientId: input.clientId ?? null,
      authorizationSignedAt: signedAt,
      authorizationExpiresAt: expiresAt,
      authorizationRef: ref,
      allowedChannels: input.allowedChannels ?? [],
      status: 'pending',
      createdById: actor.userId,
    },
  });
  await writeAuditLog({ action: 'MARKETING_TESTIMONIAL_ADD', actorUserId: actor.userId, actorRole: actor.role, organizationId, resourceType: 'marketing_testimonial', resourceId: t.id, patientId: input.clientId ?? null }).catch(() => {});
  return { ok: true as const, testimonial: t };
}

export async function setTestimonialStatus(organizationId: string, id: string, action: 'approve' | 'retire' | 'revoke', actor: Actor) {
  const t = await prisma.marketingTestimonial.findFirst({ where: { id, organizationId } });
  if (!t) return { ok: false as const, status: 404, error: 'Testimonial not found.' };
  if (action === 'approve') {
    const state = marketingAuthorizationState({ marketingAuthorizationAt: t.authorizationSignedAt, marketingAuthorizationExpiresAt: t.authorizationExpiresAt, marketingAuthorizationRevokedAt: t.authorizationRevokedAt }, new Date());
    if (state !== 'valid') return { ok: false as const, status: 409, error: 'A testimonial can be approved only with a signed, current authorization on file.' };
    await prisma.marketingTestimonial.update({ where: { id }, data: { status: 'approved' } });
  } else if (action === 'retire') {
    await prisma.marketingTestimonial.update({ where: { id }, data: { status: 'retired' } });
  } else {
    await prisma.marketingTestimonial.update({ where: { id }, data: { status: 'retired', authorizationRevokedAt: new Date() } });
  }
  await writeAuditLog({ action: `MARKETING_TESTIMONIAL_${action.toUpperCase()}`, actorUserId: actor.userId, actorRole: actor.role, organizationId, resourceType: 'marketing_testimonial', resourceId: id }).catch(() => {});
  return { ok: true as const };
}

// ─── Contacts (audience) ────────────────────────────────────────────────────────────────

export async function listContacts(organizationId: string) {
  const rows = await prisma.marketingContact.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 2000 });
  const now = new Date();
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    kind: c.kind,
    tags: c.tags,
    partnerId: c.partnerId,
    emailConsent: c.emailConsent,
    emailOptedOut: Boolean(c.emailOptOutAt),
    smsConsent: c.smsConsent,
    smsOptedOut: Boolean(c.smsOptOutAt),
    authorization: c.kind === 'client_authorized' ? marketingAuthorizationState(c, now) : null,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function createContact(
  organizationId: string,
  input: { name: string; email?: string | null; phone?: string | null; kind: string; tags?: string[]; partnerId?: string | null; emailConsent?: boolean; smsConsent?: boolean; clientId?: string | null; source?: string | null },
  actor: Actor | null,
) {
  const now = new Date();
  const data: Prisma.MarketingContactUncheckedCreateInput = {
    organizationId,
    name: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    kind: input.kind,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20),
    partnerId: input.partnerId ?? null,
    emailConsent: Boolean(input.emailConsent),
    emailConsentAt: input.emailConsent ? now : null,
    smsConsent: Boolean(input.smsConsent),
    smsConsentAt: input.smsConsent ? now : null,
    source: input.source ?? (actor ? 'staff' : 'public'),
  };
  if (input.kind === 'client_authorized') {
    if (!input.clientId) return { ok: false as const, status: 400, error: 'Choose the client.' };
    const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId }, select: { id: true, name: true, email: true, phone: true } });
    if (!client) return { ok: false as const, status: 404, error: 'Client not found.' };
    const settings = await getMarketingSettings(organizationId);
    const auth = await signedAuthorizationFor(organizationId, client.id, settings.marketingAuthTemplateKey, 'marketing');
    if (!auth) {
      return { ok: false as const, status: 409, error: `HIPAA: this client has no signed marketing authorization (consent template "${settings.marketingAuthTemplateKey}"). Clients join marketing lists only with one on file.` };
    }
    Object.assign(data, {
      clientId: client.id,
      name: data.name || client.name,
      email: data.email ?? client.email,
      phone: data.phone ?? client.phone,
      marketingAuthorizationAt: auth.signedAt,
      marketingAuthorizationExpiresAt: auth.expiresAt,
      marketingAuthorizationRef: auth.ref,
      // Diagnosis / program / appointment data never become tags
      tags: (data.tags as string[]).filter((t) => !/diagnos|program|appoint|sud|substance/i.test(t)),
    });
  } else if (input.clientId) {
    return { ok: false as const, status: 400, error: 'Only the authorized-client type can link a client.' };
  }
  const c = await prisma.marketingContact.create({ data });
  if (actor) await writeAuditLog({ action: 'MARKETING_CONTACT_ADD', actorUserId: actor.userId, actorRole: actor.role, organizationId, resourceType: 'marketing_contact', resourceId: c.id, patientId: c.clientId }).catch(() => {});
  return { ok: true as const, contact: c };
}

export async function updateContact(organizationId: string, id: string, patch: { tags?: string[]; emailConsent?: boolean; smsConsent?: boolean; emailOptOut?: boolean; smsOptOut?: boolean; remove?: boolean }) {
  const c = await prisma.marketingContact.findFirst({ where: { id, organizationId } });
  if (!c) return { ok: false as const, status: 404, error: 'Contact not found.' };
  if (patch.remove) {
    await prisma.marketingContact.delete({ where: { id } });
    return { ok: true as const };
  }
  const now = new Date();
  const data: Record<string, unknown> = {};
  if (patch.tags) data.tags = patch.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20);
  if (patch.emailConsent !== undefined) {
    if (patch.emailConsent && c.emailOptOutAt) return { ok: false as const, status: 409, error: 'This address unsubscribed. Only the person can re-subscribe.' };
    Object.assign(data, { emailConsent: patch.emailConsent, emailConsentAt: patch.emailConsent ? now : null });
  }
  if (patch.smsConsent !== undefined) {
    if (patch.smsConsent && c.smsOptOutAt) return { ok: false as const, status: 409, error: 'This number replied STOP. Only the person can opt back in (reply START).' };
    Object.assign(data, { smsConsent: patch.smsConsent, smsConsentAt: patch.smsConsent ? now : null });
  }
  if (patch.emailOptOut) Object.assign(data, { emailOptOutAt: now, emailConsent: false });
  if (patch.smsOptOut) Object.assign(data, { smsOptOutAt: now, smsConsent: false });
  await prisma.marketingContact.update({ where: { id }, data });
  return { ok: true as const };
}

async function audienceContacts(organizationId: string): Promise<AudienceContact[]> {
  const [contacts, regs] = await Promise.all([
    prisma.marketingContact.findMany({ where: { organizationId }, take: 5000 }),
    prisma.marketingEventRegistration.findMany({ where: { organizationId, contactId: { not: null } }, select: { contactId: true, eventId: true, attended: true }, take: 20000 }),
  ]);
  const byContact = new Map<string, { eventId: string; attended: boolean }[]>();
  for (const r of regs) {
    const list = byContact.get(r.contactId!) ?? [];
    list.push({ eventId: r.eventId, attended: r.attended });
    byContact.set(r.contactId!, list);
  }
  return contacts.map((c) => ({ ...c, events: byContact.get(c.id) ?? [] }));
}

// ─── Campaigns ──────────────────────────────────────────────────────────────────────────

export async function listCampaigns(organizationId: string) {
  const rows = await prisma.marketingCampaign.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    audience: c.audience,
    subjectA: c.subjectA,
    subjectB: c.subjectB,
    body: c.body,
    status: c.status,
    scheduledAt: iso(c.scheduledAt),
    sentAt: iso(c.sentAt),
    metrics: {
      recipients: c.recipientCount,
      sent: c.sentCount,
      delivered: c.deliveredCount,
      opened: null as number | null,
      clicked: null as number | null,
      unsubscribed: c.unsubscribedCount,
      blocked: c.blockedCount,
      queued: c.queuedCount,
    },
    variantStats: c.variantStats,
    createdById: c.createdById,
    approvedById: c.approvedById,
  }));
}

export async function previewAudience(organizationId: string, audience: unknown, channel: 'email' | 'sms') {
  const seg = validateSegment(audience);
  if (seg.ok === false) return { ok: false as const, status: 400, error: seg.error };
  const settings = await getMarketingSettings(organizationId);
  const plan = planAudience(await audienceContacts(organizationId), seg.segment, channel, {
    now: new Date(),
    timeZone: settings.timeZone,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    physicalAddress: settings.physicalAddress,
  });
  const reasons: Record<string, number> = {};
  for (const b of plan.blocked) reasons[b.reason] = (reasons[b.reason] ?? 0) + 1;
  return { ok: true as const, matched: plan.matched, sendable: plan.sendable.length, deferred: plan.deferred.length, blocked: plan.blocked.length, blockedReasons: reasons };
}

export async function saveCampaign(
  organizationId: string,
  input: { id?: string; name: string; channel: 'email' | 'sms'; audience: unknown; subjectA?: string | null; subjectB?: string | null; body: string; scheduledAt?: string | null },
  actor: Actor,
) {
  const seg = validateSegment(input.audience);
  if (seg.ok === false) return { ok: false as const, status: 400, error: seg.error };
  if (input.channel === 'email' && !input.subjectA?.trim()) return { ok: false as const, status: 400, error: 'Add a subject line.' };
  if (input.channel === 'sms' && input.body.length > 480) return { ok: false as const, status: 400, error: 'Keep texts under 480 characters (3 segments).' };
  const data = {
    name: input.name.trim(),
    channel: input.channel,
    audience: seg.segment as unknown as Prisma.InputJsonValue,
    subjectA: input.subjectA?.trim() || null,
    subjectB: input.subjectB?.trim() || null,
    body: input.body.trim(),
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
  };
  if (input.id) {
    const c = await prisma.marketingCampaign.findFirst({ where: { id: input.id, organizationId } });
    if (!c) return { ok: false as const, status: 404, error: 'Campaign not found.' };
    if (!['draft', 'review'].includes(c.status)) return { ok: false as const, status: 409, error: 'Only draft campaigns can be edited.' };
    const row = await prisma.marketingCampaign.update({ where: { id: c.id }, data: { ...data, status: 'draft', approvedById: null } });
    return { ok: true as const, campaign: row };
  }
  const row = await prisma.marketingCampaign.create({ data: { organizationId, ...data, status: 'draft', createdById: actor.userId } });
  return { ok: true as const, campaign: row };
}

/** Approval workflow: draft -> review -> approved (-> scheduled) -> sent. The author cannot approve their own campaign unless leadership. */
export async function campaignAction(organizationId: string, id: string, action: 'submit' | 'approve' | 'reject' | 'send' | 'schedule', actor: Actor) {
  const c = await prisma.marketingCampaign.findFirst({ where: { id, organizationId } });
  if (!c) return { ok: false as const, status: 404, error: 'Campaign not found.' };
  if (action === 'submit') {
    if (c.status !== 'draft') return { ok: false as const, status: 409, error: 'Only drafts can be submitted.' };
    await prisma.marketingCampaign.update({ where: { id }, data: { status: 'review' } });
    return { ok: true as const };
  }
  if (action === 'approve' || action === 'reject') {
    if (c.status !== 'review') return { ok: false as const, status: 409, error: 'Submit the campaign for review first.' };
    if (action === 'approve' && c.createdById === actor.userId && !LEADERSHIP.includes(actor.role)) return { ok: false as const, status: 403, error: 'Someone other than the author must approve this campaign.' };
    await prisma.marketingCampaign.update({ where: { id }, data: action === 'approve' ? { status: 'approved', approvedById: actor.userId } : { status: 'draft' } });
    return { ok: true as const };
  }
  if (action === 'schedule') {
    if (c.status !== 'approved') return { ok: false as const, status: 409, error: 'Only approved campaigns can be scheduled.' };
    if (!c.scheduledAt || c.scheduledAt.getTime() < Date.now()) return { ok: false as const, status: 400, error: 'Set a future send time first.' };
    await prisma.marketingCampaign.update({ where: { id }, data: { status: 'scheduled' } });
    return { ok: true as const };
  }
  // send
  if (!['approved', 'scheduled'].includes(c.status)) return { ok: false as const, status: 409, error: 'Only approved campaigns can be sent.' };
  return sendCampaignNow(organizationId, id, actor);
}

export async function sendCampaignNow(organizationId: string, id: string, actor: Actor | null) {
  const c = await prisma.marketingCampaign.findFirst({ where: { id, organizationId } });
  if (!c) return { ok: false as const, status: 404, error: 'Campaign not found.' };
  const seg = validateSegment(c.audience);
  if (seg.ok === false) return { ok: false as const, status: 400, error: seg.error };
  await prisma.marketingCampaign.update({ where: { id }, data: { status: 'sending' } });
  const contacts = await audienceContacts(organizationId);
  const byId = new Map(contacts.map((x) => [x.id, x]));
  const settings = await getMarketingSettings(organizationId);
  const plan = planAudience(contacts, seg.segment, c.channel as 'email' | 'sms', {
    now: new Date(),
    timeZone: settings.timeZone,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    physicalAddress: settings.physicalAddress,
  });
  let sent = 0;
  let queued = 0;
  let blocked = plan.blocked.length;
  const variants: Record<string, { sent: number }> = { A: { sent: 0 }, B: { sent: 0 } };
  const targets = [...plan.sendable, ...plan.deferred].slice(0, 5000);
  for (const [i, t] of targets.entries()) {
    const contact = byId.get(t.id)!;
    const v = abVariant(i, Boolean(c.subjectB));
    const r = await sendMarketingMessage({
      organizationId,
      channel: c.channel as 'email' | 'sms',
      purpose: 'marketing',
      recipient: { ...contact, isClient: contact.kind === 'client_authorized' || Boolean(contact.clientId) },
      body: c.body.replace(/\{\{\s*firstName\s*\}\}/g, contact.name.split(/\s+/)[0] ?? ''),
      subject: v === 'B' ? c.subjectB : c.subjectA,
      contactId: contact.id,
      campaignId: c.id,
      variant: c.subjectB ? v : null,
      actorId: actor?.userId ?? null,
      actorRole: actor?.role ?? null,
    });
    if (r.status === 'sent') {
      sent += 1;
      variants[v].sent += 1;
    } else if (r.status === 'queued') queued += 1;
    else blocked += 1;
  }
  const status = sent ? 'sent' : queued ? 'queued' : 'sent';
  await prisma.marketingCampaign.update({
    where: { id },
    data: {
      status,
      sentAt: new Date(),
      recipientCount: plan.matched,
      sentCount: sent,
      deliveredCount: sent,
      queuedCount: queued,
      blockedCount: blocked,
      variantStats: (c.subjectB ? variants : null) as unknown as Prisma.InputJsonValue,
    },
  });
  await writeAuditLog({ action: 'MARKETING_CAMPAIGN_SEND', actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? 'SYSTEM', organizationId, resourceType: 'marketing_campaign', resourceId: id, metadata: { matched: plan.matched, sent, queued, blocked } }).catch(() => {});
  return { ok: true as const, matched: plan.matched, sent, queued, blocked };
}

/** Cron: send scheduled campaigns that are due. */
export async function sendDueCampaigns(now = new Date()) {
  const due = await prisma.marketingCampaign.findMany({ where: { status: 'scheduled', scheduledAt: { lte: now } }, take: 20 });
  for (const c of due) await sendCampaignNow(c.organizationId, c.id, null).catch(() => {});
  return due.length;
}

/** Cron: re-send manual messages that waited for quiet hours to end. */
export async function resendQuietHoursQueue(organizationId: string | undefined, now = new Date()) {
  const rows = await prisma.marketingMessage.findMany({
    where: { ...(organizationId ? { organizationId } : {}), status: 'queued', reason: 'quiet_hours', direction: 'outbound' },
    take: 200,
  });
  let n = 0;
  for (const m of rows) {
    const recipient = m.leadId
      ? await prisma.marketingLead.findFirst({ where: { id: m.leadId, organizationId: m.organizationId } }).then((l) => (l ? { ...l, isClient: l.stage === 'converted' } : null))
      : m.contactId
        ? await prisma.marketingContact.findFirst({ where: { id: m.contactId, organizationId: m.organizationId } }).then((c) => (c ? { ...c, isClient: c.kind === 'client_authorized' || Boolean(c.clientId) } : null))
        : null;
    if (!recipient) continue;
    const r = await sendMarketingMessage({
      organizationId: m.organizationId,
      channel: m.channel as 'sms' | 'email',
      purpose: m.campaignId ? 'marketing' : 'lead_follow_up',
      recipient,
      body: m.body.replace(/\s*Reply STOP to opt out\.\s*$/i, ''),
      subject: m.subject,
      leadId: m.leadId,
      contactId: m.contactId,
      campaignId: m.campaignId,
      existingMessageId: m.id,
      now,
    });
    if (r.status !== 'queued' || r.reason !== 'quiet_hours') n += 1;
  }
  return n;
}

// ─── Social planner ─────────────────────────────────────────────────────────────────────

export async function listSocial(organizationId: string) {
  const [posts, legacy] = await Promise.all([
    prisma.marketingSocialPost.findMany({ where: { organizationId }, orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }], take: 400 }),
    prisma.prSocialPost.findMany({ where: { organizationId }, orderBy: { scheduledAt: 'asc' }, take: 200 }).catch(() => []),
  ]);
  return {
    posts: posts.map((p) => ({
      id: p.id,
      channels: p.channels,
      content: p.content,
      hashtags: p.hashtags,
      imagePrompt: p.imagePrompt,
      status: p.status,
      scheduledAt: iso(p.scheduledAt),
      postedAt: iso(p.postedAt),
      approvedById: p.approvedById,
      createdById: p.createdById,
      reviewNote: p.reviewNote,
      campaignTag: p.campaignTag,
    })),
    legacy: legacy.map((p) => ({ id: p.id, channels: [p.platform], content: p.content, status: p.status, scheduledAt: iso(p.scheduledAt) })),
  };
}

const SOCIAL_NEXT: Record<string, string[]> = {
  draft: ['review'],
  review: ['approved', 'draft'],
  approved: ['scheduled', 'exported', 'posted', 'draft'],
  scheduled: ['posted', 'exported', 'approved'],
  exported: ['posted'],
  posted: [],
};

export function canMoveSocial(from: string, to: string): boolean {
  return (SOCIAL_NEXT[from] ?? []).includes(to);
}

export async function saveSocialPost(
  organizationId: string,
  input: { id?: string; channels: string[]; content: string; hashtags?: string[]; imagePrompt?: string | null; scheduledAt?: string | null; campaignTag?: string | null },
  actor: Actor,
) {
  const data = {
    channels: input.channels,
    content: input.content.trim(),
    hashtags: (input.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')).slice(0, 15),
    imagePrompt: input.imagePrompt?.trim() || null,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
    campaignTag: input.campaignTag?.trim() || null,
  };
  if (input.id) {
    const p = await prisma.marketingSocialPost.findFirst({ where: { id: input.id, organizationId } });
    if (!p) return { ok: false as const, status: 404, error: 'Post not found.' };
    if (p.status === 'posted') return { ok: false as const, status: 409, error: 'Posted items cannot be edited.' };
    // Any edit sends it back through approval
    const row = await prisma.marketingSocialPost.update({ where: { id: p.id }, data: { ...data, status: 'draft', approvedById: null, approvedAt: null } });
    return { ok: true as const, post: row };
  }
  const row = await prisma.marketingSocialPost.create({ data: { organizationId, ...data, status: 'draft', createdById: actor.userId } });
  return { ok: true as const, post: row };
}

export async function moveSocialPost(organizationId: string, id: string, to: string, actor: Actor, note?: string | null) {
  const p = await prisma.marketingSocialPost.findFirst({ where: { id, organizationId } });
  if (!p) return { ok: false as const, status: 404, error: 'Post not found.' };
  if (!canMoveSocial(p.status, to)) return { ok: false as const, status: 409, error: `Cannot move from ${p.status} to ${to}.` };
  if (to === 'approved' && p.createdById === actor.userId && !LEADERSHIP.includes(actor.role)) return { ok: false as const, status: 403, error: 'Someone other than the author must approve this post.' };
  if (to === 'scheduled' && !p.scheduledAt) return { ok: false as const, status: 400, error: 'Set a date and time first.' };
  const now = new Date();
  await prisma.marketingSocialPost.update({
    where: { id },
    data: {
      status: to,
      ...(to === 'approved' ? { approvedById: actor.userId, approvedAt: now } : {}),
      ...(to === 'posted' ? { postedAt: now } : {}),
      ...(to === 'draft' && note ? { reviewNote: note.slice(0, 500) } : {}),
    },
  });
  return { ok: true as const };
}

export function socialCsv(posts: { channels: string[]; content: string; hashtags: string[]; scheduledAt: string | null; status: string }[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ['channels,scheduled_at,status,text'];
  for (const p of posts) lines.push([esc(p.channels.join('; ')), esc(p.scheduledAt ?? ''), esc(p.status), esc(`${p.content}${p.hashtags.length ? `\n\n${p.hashtags.join(' ')}` : ''}`)].join(','));
  return lines.join('\n');
}

// ─── Partners ───────────────────────────────────────────────────────────────────────────

export async function listPartners(organizationId: string) {
  const [partners, leadCounts, touches] = await Promise.all([
    prisma.communityPartner.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
    prisma.marketingLead.groupBy({ by: ['partnerId'], where: { organizationId, partnerId: { not: null } }, _count: { _all: true } }),
    prisma.marketingPartnerTouch.findMany({ where: { organizationId }, orderBy: { touchedAt: 'desc' }, take: 300 }),
  ]);
  const counts = new Map(leadCounts.map((c) => [c.partnerId, c._count._all]));
  return partners.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    partnerType: p.partnerType,
    ownerUserId: p.ownerUserId,
    ownerName: p.ownerName,
    contactName: p.contactName,
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone,
    status: p.partnerStatus,
    lastTouchAt: iso(p.lastTouchAt),
    notes: p.partnerNotes,
    referralLeads: counts.get(p.id) ?? 0,
    touches: touches.filter((t) => t.partnerId === p.id).slice(0, 10).map((t) => ({ id: t.id, kind: t.kind, summary: t.summary, touchedAt: t.touchedAt.toISOString(), actorName: t.actorName })),
  }));
}

export async function savePartner(
  organizationId: string,
  input: { id?: string; name: string; category?: string; partnerType?: string | null; ownerUserId?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; status?: string; notes?: string | null },
) {
  let ownerName: string | null | undefined;
  if (input.ownerUserId !== undefined) {
    if (input.ownerUserId) {
      const u = await prisma.user.findFirst({ where: { id: input.ownerUserId, organizationId }, select: { name: true, email: true } });
      if (!u) return { ok: false as const, status: 400, error: 'Owner not found.' };
      ownerName = u.name || u.email;
    } else ownerName = null;
  }
  const data = {
    name: input.name.trim(),
    ...(input.category !== undefined ? { category: input.category } : {}),
    partnerType: input.partnerType ?? null,
    ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId || null, ownerName } : {}),
    contactName: input.contactName?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    ...(input.status ? { partnerStatus: input.status } : {}),
    ...(input.notes !== undefined ? { partnerNotes: input.notes?.trim() ?? '' } : {}),
  };
  if (input.id) {
    const p = await prisma.communityPartner.findFirst({ where: { id: input.id, organizationId } });
    if (!p) return { ok: false as const, status: 404, error: 'Partner not found.' };
    return { ok: true as const, partner: await prisma.communityPartner.update({ where: { id: p.id }, data }) };
  }
  const dup = await prisma.communityPartner.findFirst({ where: { organizationId, name: { equals: data.name, mode: 'insensitive' } } });
  if (dup) return { ok: false as const, status: 409, error: 'That partner is already in the directory.' };
  return { ok: true as const, partner: await prisma.communityPartner.create({ data: { organizationId, category: input.category || 'Community', ...data } }) };
}

export async function logPartnerTouch(organizationId: string, partnerId: string, input: { kind: string; summary: string; touchedAt?: string | null }, actor: Actor) {
  const p = await prisma.communityPartner.findFirst({ where: { id: partnerId, organizationId } });
  if (!p) return { ok: false as const, status: 404, error: 'Partner not found.' };
  if (/\b(client|patient)\b.*\b(name|dob|diagnos)/i.test(input.summary)) return { ok: false as const, status: 400, error: 'Partner notes cannot include client information.' };
  const at = input.touchedAt ? new Date(input.touchedAt) : new Date();
  await prisma.marketingPartnerTouch.create({ data: { organizationId, partnerId, kind: input.kind, summary: input.summary.trim().slice(0, 500), touchedAt: at, actorId: actor.userId, actorName: actor.name ?? null } });
  if (!p.lastTouchAt || p.lastTouchAt < at) await prisma.communityPartner.update({ where: { id: partnerId }, data: { lastTouchAt: at } });
  return { ok: true as const };
}

// ─── Events ─────────────────────────────────────────────────────────────────────────────

export async function listEvents(organizationId: string) {
  const [events, regs, leads] = await Promise.all([
    prisma.communityEvent.findMany({ where: { organizationId }, orderBy: { startsAt: 'desc' }, take: 200 }),
    prisma.marketingEventRegistration.groupBy({ by: ['eventId', 'attended'], where: { organizationId }, _count: { _all: true } }),
    prisma.marketingLead.groupBy({ by: ['eventId'], where: { organizationId, eventId: { not: null } }, _count: { _all: true } }),
  ]);
  const leadMap = new Map(leads.map((l) => [l.eventId, l._count._all]));
  return events.map((e) => {
    const r = regs.filter((x) => x.eventId === e.id);
    const total = r.reduce((a, x) => a + x._count._all, 0);
    const attended = r.filter((x) => x.attended).reduce((a, x) => a + x._count._all, 0);
    return {
      id: e.id,
      title: e.title,
      eventType: e.eventType,
      status: e.status,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      locationName: e.locationName,
      description: e.description,
      registrationSlug: e.registrationSlug,
      registrationOpen: e.registrationOpen,
      registrations: total,
      attended: Math.max(attended, e.attendedCount),
      costCents: e.costCents,
      leads: leadMap.get(e.id) ?? 0,
    };
  });
}

export async function updateEventMarketing(organizationId: string, id: string, input: { registrationOpen?: boolean; registrationSlug?: string | null; costCents?: number; attendedCount?: number }) {
  const e = await prisma.communityEvent.findFirst({ where: { id, organizationId } });
  if (!e) return { ok: false as const, status: 404, error: 'Event not found.' };
  const data: Record<string, unknown> = {};
  if (input.registrationSlug !== undefined || (input.registrationOpen && !e.registrationSlug)) {
    const slug = slugify(input.registrationSlug || e.registrationSlug || `${e.title}-${e.startsAt.toISOString().slice(0, 10)}`);
    if (!SLUG_RE.test(slug)) return { ok: false as const, status: 400, error: 'Use lowercase letters, numbers and dashes for the page address.' };
    const clash = await prisma.communityEvent.findFirst({ where: { organizationId, registrationSlug: slug, id: { not: id } }, select: { id: true } });
    if (clash) return { ok: false as const, status: 409, error: 'Another event uses that page address.' };
    data.registrationSlug = slug;
  }
  if (input.registrationOpen !== undefined) data.registrationOpen = input.registrationOpen;
  if (input.costCents !== undefined) data.costCents = Math.max(0, Math.round(input.costCents));
  if (input.attendedCount !== undefined) data.attendedCount = Math.max(0, Math.round(input.attendedCount));
  return { ok: true as const, event: await prisma.communityEvent.update({ where: { id }, data }) };
}

export async function listRegistrations(organizationId: string, eventId: string) {
  const rows = await prisma.marketingEventRegistration.findMany({ where: { organizationId, eventId }, orderBy: { createdAt: 'asc' }, take: 2000 });
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, emailConsent: r.emailConsent, smsConsent: r.smsConsent, attended: r.attended, createdAt: r.createdAt.toISOString() }));
}

export async function setAttendance(organizationId: string, registrationId: string, attended: boolean) {
  const r = await prisma.marketingEventRegistration.findFirst({ where: { id: registrationId, organizationId } });
  if (!r) return { ok: false as const, status: 404, error: 'Registration not found.' };
  await prisma.marketingEventRegistration.update({ where: { id: r.id }, data: { attended } });
  if (attended && !r.attended && r.contactId) await fireTrigger(organizationId, { type: 'event_attended', contactId: r.contactId, eventId: r.eventId }).catch(() => {});
  return { ok: true as const };
}

// ─── Forms ──────────────────────────────────────────────────────────────────────────────

export async function listForms(organizationId: string) {
  const [forms, org] = await Promise.all([
    prisma.marketingForm.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } }),
  ]);
  return { orgSlug: org?.slug ?? '', standardFields: STANDARD_FIELDS, forms: forms.map((f) => ({ id: f.id, name: f.name, slug: f.slug, active: f.active, fields: f.fields, serviceOptions: f.serviceOptions, locationOptions: f.locationOptions, confirmationMessage: f.confirmationMessage, submissionCount: f.submissionCount })) };
}

export async function saveForm(
  organizationId: string,
  input: { id?: string; name: string; slug?: string; active?: boolean; fields: unknown; serviceOptions?: string[]; locationOptions?: string[]; confirmationMessage?: string },
  actor: Actor,
) {
  const slug = slugify(input.slug || input.name);
  if (!SLUG_RE.test(slug)) return { ok: false as const, status: 400, error: 'Use lowercase letters, numbers and dashes for the form address.' };
  const clash = await prisma.marketingForm.findFirst({ where: { organizationId, slug, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } });
  if (clash) return { ok: false as const, status: 409, error: 'Another form uses that address.' };
  const data = {
    name: input.name.trim(),
    slug,
    active: input.active ?? true,
    fields: normalizeFormFields(input.fields) as unknown as Prisma.InputJsonValue,
    serviceOptions: (input.serviceOptions ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 20),
    locationOptions: (input.locationOptions ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 20),
    confirmationMessage: input.confirmationMessage?.trim() || 'Thank you. Our intake team will contact you within one business day. If you are in crisis, call or text 988.',
  };
  if (input.id) {
    const f = await prisma.marketingForm.findFirst({ where: { id: input.id, organizationId } });
    if (!f) return { ok: false as const, status: 404, error: 'Form not found.' };
    return { ok: true as const, form: await prisma.marketingForm.update({ where: { id: f.id }, data }) };
  }
  return { ok: true as const, form: await prisma.marketingForm.create({ data: { organizationId, ...data, createdById: actor.userId } }) };
}

// ─── Templates ──────────────────────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATES = [
  { name: 'First reply (text)', channel: 'sms', subject: null, body: 'Hi {{firstName}}, thanks for contacting {{practiceName}}. When is a good time for a quick call with our intake team?' },
  { name: 'Insurance check (text)', channel: 'sms', subject: null, body: 'Hi {{firstName}}, we are checking your insurance now and will call you with next steps. Questions? Call {{practicePhone}}.' },
  { name: 'Follow-up (email)', channel: 'email', subject: 'Following up on your request', body: 'Hi {{firstName}},\n\nThank you for reaching out to {{practiceName}}. We would be glad to help you get started. Reply to this email or call {{practicePhone}}.\n\n{{practiceName}}' },
] as const;

export async function listTemplates(organizationId: string) {
  const rows = await prisma.marketingTemplate.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  const custom = rows.map((t) => ({ id: t.id, name: t.name, channel: t.channel, subject: t.subject, body: t.body, category: t.category, builtIn: false }));
  return [...custom, ...DEFAULT_TEMPLATES.map((t, i) => ({ id: `builtin-${i}`, ...t, category: 'follow_up', builtIn: true }))];
}

export async function saveTemplate(organizationId: string, input: { id?: string; name: string; channel: 'sms' | 'email'; subject?: string | null; body: string; remove?: boolean }) {
  if (input.id) {
    const t = await prisma.marketingTemplate.findFirst({ where: { id: input.id, organizationId } });
    if (!t) return { ok: false as const, status: 404, error: 'Template not found.' };
    if (input.remove) {
      await prisma.marketingTemplate.delete({ where: { id: t.id } });
      return { ok: true as const };
    }
    return { ok: true as const, template: await prisma.marketingTemplate.update({ where: { id: t.id }, data: { name: input.name.trim(), channel: input.channel, subject: input.subject ?? null, body: input.body.trim() } }) };
  }
  return { ok: true as const, template: await prisma.marketingTemplate.create({ data: { organizationId, name: input.name.trim(), channel: input.channel, subject: input.subject ?? null, body: input.body.trim() } }) };
}

// ─── Workflows ──────────────────────────────────────────────────────────────────────────

export async function listWorkflows(organizationId: string) {
  const [rows, runs] = await Promise.all([
    prisma.marketingWorkflow.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    prisma.marketingWorkflowRun.groupBy({ by: ['workflowId', 'status'], where: { organizationId }, _count: { _all: true } }),
  ]);
  return {
    workflows: rows.map((w) => ({
      id: w.id,
      name: w.name,
      recipeKey: w.recipeKey,
      trigger: w.trigger,
      steps: w.steps,
      active: w.active,
      runs: Object.fromEntries(runs.filter((r) => r.workflowId === w.id).map((r) => [r.status, r._count._all])),
    })),
    recipes: RECIPES.map((r) => ({ key: r.key, name: r.name, description: r.description, installed: rows.some((w) => w.recipeKey === r.key) })),
  };
}

export async function saveWorkflow(organizationId: string, input: { id?: string; name: string; trigger: unknown; steps: unknown; active?: boolean }, actor: Actor) {
  const v = validateWorkflow(input.trigger, input.steps);
  if (v.ok === false) return { ok: false as const, status: 400, error: v.error };
  const data = { name: input.name.trim(), trigger: v.trigger as unknown as Prisma.InputJsonValue, steps: v.steps as unknown as Prisma.InputJsonValue, ...(input.active !== undefined ? { active: input.active } : {}) };
  if (input.id) {
    const w = await prisma.marketingWorkflow.findFirst({ where: { id: input.id, organizationId } });
    if (!w) return { ok: false as const, status: 404, error: 'Workflow not found.' };
    return { ok: true as const, workflow: await prisma.marketingWorkflow.update({ where: { id: w.id }, data }) };
  }
  return { ok: true as const, workflow: await prisma.marketingWorkflow.create({ data: { organizationId, ...data, active: input.active ?? false, createdById: actor.userId } }) };
}

export async function setWorkflowActive(organizationId: string, id: string, active: boolean | null) {
  const w = await prisma.marketingWorkflow.findFirst({ where: { id, organizationId } });
  if (!w) return { ok: false as const, status: 404, error: 'Workflow not found.' };
  if (active === null) {
    await prisma.marketingWorkflowRun.updateMany({ where: { workflowId: id, status: { in: ['active', 'waiting'] } }, data: { status: 'stopped', finishedAt: new Date(), waitUntil: null } });
    await prisma.marketingWorkflow.delete({ where: { id } });
    return { ok: true as const };
  }
  await prisma.marketingWorkflow.update({ where: { id }, data: { active } });
  if (!active) await prisma.marketingWorkflowRun.updateMany({ where: { workflowId: id, status: { in: ['active', 'waiting'] } }, data: { status: 'stopped', finishedAt: new Date(), waitUntil: null } });
  return { ok: true as const };
}

// ─── Spend ──────────────────────────────────────────────────────────────────────────────

export async function listSpend(organizationId: string) {
  const rows = await prisma.marketingSpend.findMany({ where: { organizationId }, orderBy: [{ month: 'desc' }, { createdAt: 'desc' }], take: 500 });
  return rows.map((r) => ({ id: r.id, channel: r.channel, month: r.month, amountCents: r.amountCents, note: r.note }));
}

export async function addSpend(organizationId: string, input: { channel: string; month: string; amountCents: number; note?: string | null }, actor: Actor) {
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { ok: false as const, status: 400, error: 'Month must be YYYY-MM.' };
  return { ok: true as const, spend: await prisma.marketingSpend.create({ data: { organizationId, channel: input.channel.trim(), month: input.month, amountCents: Math.round(input.amountCents), note: input.note?.trim() || null, createdById: actor.userId } }) };
}

export async function deleteSpend(organizationId: string, id: string) {
  await prisma.marketingSpend.deleteMany({ where: { id, organizationId } });
  return { ok: true as const };
}

// ─── Analytics ──────────────────────────────────────────────────────────────────────────

export async function analytics(organizationId: string, days = 90, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 3600000);
  const settings = await getMarketingSettings(organizationId);
  const threshold = settings.smallCellThreshold;
  const [leads, spend, partners, events, reviews] = await Promise.all([
    prisma.marketingLead.findMany({
      where: { organizationId, createdAt: { gte: since } },
      select: { source: true, stage: true, furthestStage: true, partnerId: true, eventId: true, createdAt: true, firstResponseAt: true, convertedAt: true, intakeAppointmentId: true, stageChangedAt: true },
      take: 20000,
    }),
    prisma.marketingSpend.findMany({ where: { organizationId, month: { gte: since.toISOString().slice(0, 7) } } }),
    prisma.communityPartner.findMany({ where: { organizationId }, select: { id: true, name: true, lastTouchAt: true } }),
    listEvents(organizationId),
    prisma.marketingReview.findMany({ where: { organizationId }, select: { rating: true, reviewedAt: true, responseStatus: true }, take: 2000 }),
  ]);
  // First appointment = an intake appointment exists for the converted lead (count only, no appointment data)
  const att = leads.map((l) => ({ ...l, firstAppointmentAt: l.intakeAppointmentId ? l.convertedAt : null }));
  const sources = sourceReport(att, spend, threshold);
  const speed = speedSummary(att, settings.speedToLeadMinutes);
  const leaderboard = partnerLeaderboard(att, partners, threshold, now);
  const roi = eventRoi(events.filter((e) => new Date(e.startsAt) >= since).map((e) => ({ id: e.id, title: e.title, costCents: e.costCents, registrations: e.registrations, attended: e.attended })), att, threshold);
  const stalled = leads.filter((l) => (OPEN_STAGES as string[]).includes(l.stage) && now.getTime() - l.stageChangedAt.getTime() > 7 * 24 * 3600000).length;
  const totals = {
    leads: leads.length,
    converted: leads.filter((l) => l.stage === 'converted').length,
    open: leads.filter((l) => (OPEN_STAGES as string[]).includes(l.stage)).length,
    spendCents: spend.reduce((a, s) => a + s.amountCents, 0),
  };
  const aggregates: GrowthAggregates = {
    periodDays: days,
    leadsBySource: sources.map((s) => ({ source: leadSourceLabel(s.source), leads: s.leads, converted: s.converted.suppressed ? 0 : s.converted.value })),
    stalledLeads: stalled,
    waitingFirstResponse: speed.waiting,
    medianSpeedMinutes: speed.medianMinutes,
    speedTargetMinutes: settings.speedToLeadMinutes,
    quietPartners: leaderboard.filter((p) => p.quiet).map((p) => p.name),
    averageRating: averageRating(reviews),
    newReviews: reviews.filter((r) => r.responseStatus === 'none').length,
    upcomingEvents: events.filter((e) => new Date(e.startsAt) > now).length,
  };
  return {
    periodDays: days,
    threshold,
    totals,
    funnel: stageFunnel(att),
    sources,
    speed,
    partners: leaderboard,
    events: roi,
    reviews: { average: averageRating(reviews), trend: ratingTrend(reviews, 6, now), total: reviews.length, awaitingReply: aggregates.newReviews },
    aggregates,
  };
}
