import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  ageInYears,
  birthdayAt,
  defaultAccessLevel,
  isPortalAccessLevel,
  isPortalRelationship,
  isProxyRelationship,
  linkState,
  PROXY_RULES,
  validateGrant,
  validateVerification,
  type PortalAccessLevel,
  type PortalLinkState,
  type PortalRelationship,
} from '@/patient/domain/proxy-policy';
import { hashInviteToken, inviteExpiry, newInviteToken } from '@/patient/infrastructure/security/tokens';
import { sendGuardianAccessAddedEmail, sendGuardianInviteEmail } from '@/patient/infrastructure/notifications/guardian-email';
import { PORTAL_ITEM_TYPES, type PortalItemType } from '@/patient/application/proxy/visibility';

/**
 * Staff side of portal proxy access (client chart → "Portal access"). Every function is scoped by
 * organization + client; routes check the staff role and write the HIPAA audit row.
 */

export class ProxyAccessError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'ProxyAccessError';
  }
}

export type VerificationInput = { method: string; legalDocumentRef?: string | null; note?: string | null };

type Actor = { organizationId: string; userId: string };

const clip = (v: string | null | undefined, n: number) => (v ?? '').trim().slice(0, n) || null;

async function loadClient(where: Prisma.ClientWhereInput) {
  const client = await prisma.client.findFirst({
    where,
    select: {
      id: true, name: true, email: true, dateOfBirth: true, active: true, status: true,
      guardianName: true, guardianRelationship: true, guardianEmail: true, guardianPhone: true, guardianAuthority: true,
      portalMinorSelfConsentMh: true, portalMinorSelfConsentSetAt: true,
      patientAccount: { select: { id: true, email: true, status: true, displayName: true } },
    },
  });
  if (!client) throw new ProxyAccessError('Client not found', 404);
  return client;
}

export type PortalAccessRow = {
  id: string;
  relationship: PortalRelationship;
  accessLevel: PortalAccessLevel;
  accessLevelReason: string | null;
  state: PortalLinkState;
  minorAtGrant: boolean;
  portalUser: { id: string; email: string; displayName: string | null; status: string };
  grantedAt: string;
  grantedById: string | null;
  verifiedAt: string | null;
  verifiedById: string | null;
  verificationMethod: string | null;
  legalDocumentRef: string | null;
  expiresAt: string | null;
  /** When a minor's proxy link ends automatically (18th birthday) */
  endsAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  endedReason: string | null;
};

/** Chart card data: the client's own login, every proxy link, the age rules and the overrides. */
export async function listClientPortalAccess(organizationId: string, clientWhere: Prisma.ClientWhereInput, now = new Date()) {
  const client = await loadClient(clientWhere);
  const [links, overrides] = await Promise.all([
    prisma.portalAccess.findMany({
      where: { clientId: client.id },
      include: { portalUser: { select: { id: true, email: true, displayName: true, status: true } } },
      orderBy: { grantedAt: 'asc' },
    }),
    prisma.portalItemVisibility.findMany({ where: { clientId: client.id }, orderBy: { setAt: 'desc' }, take: 200 }),
  ]);
  const age = ageInYears(client.dateOfBirth, now);
  const rows: PortalAccessRow[] = links.map((l) => ({
    id: l.id,
    relationship: isPortalRelationship(l.relationship) ? l.relationship : 'authorized_representative',
    accessLevel: isPortalAccessLevel(l.accessLevel) ? l.accessLevel : 'limited',
    accessLevelReason: l.accessLevelReason,
    state: linkState(l, { dateOfBirth: client.dateOfBirth }, now),
    minorAtGrant: l.minorAtGrant,
    portalUser: l.portalUser,
    grantedAt: l.grantedAt.toISOString(),
    grantedById: l.grantedById,
    verifiedAt: l.verifiedAt?.toISOString() ?? null,
    verifiedById: l.verifiedById,
    verificationMethod: l.verificationMethod,
    legalDocumentRef: l.legalDocumentRef,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    endsAt: (l.minorAtGrant || l.relationship === 'parent') && client.dateOfBirth ? birthdayAt(client.dateOfBirth, PROXY_RULES.proxyEndsAtAge).toISOString() : null,
    revokedAt: l.revokedAt?.toISOString() ?? null,
    revokeReason: l.revokeReason,
    endedReason: l.endedReason,
  }));
  return {
    client: {
      id: client.id,
      ageYears: age,
      hasDateOfBirth: Boolean(client.dateOfBirth),
      minor: age !== null && age < PROXY_RULES.proxyEndsAtAge,
      minorSelfConsentMh: client.portalMinorSelfConsentMh,
      minorSelfConsentSetAt: client.portalMinorSelfConsentSetAt?.toISOString() ?? null,
      guardianOnChart: client.guardianName || client.guardianEmail
        ? { name: client.guardianName, relationship: client.guardianRelationship, email: client.guardianEmail, authority: client.guardianAuthority }
        : null,
    },
    ownLogin: client.patientAccount ? { id: client.patientAccount.id, email: client.patientAccount.email, status: client.patientAccount.status } : null,
    defaults: {
      parent: defaultAccessLevel('parent', age),
      legal_guardian: defaultAccessLevel('legal_guardian', age),
      authorized_representative: defaultAccessLevel('authorized_representative', age),
    },
    rules: PROXY_RULES,
    links: rows,
    overrides: overrides.map((o) => ({ id: o.id, itemType: o.itemType, itemId: o.itemId, visibility: o.visibility, reason: o.reason, setAt: o.setAt.toISOString() })),
  };
}

function verificationData(v: VerificationInput | null | undefined, relationship: PortalRelationship, age: number | null, actor: Actor, now: Date) {
  if (!v) return {};
  const err = validateVerification({ relationship, method: v.method, legalDocumentRef: v.legalDocumentRef, ageYears: age });
  if (err) throw new ProxyAccessError(err);
  return {
    verifiedAt: now,
    verifiedById: actor.userId,
    verificationMethod: v.method,
    legalDocumentRef: clip(v.legalDocumentRef, 200),
    verificationNote: clip(v.note, 500),
  };
}

export type GrantInput = {
  email: string;
  displayName: string;
  relationship: string;
  accessLevel?: string | null;
  accessLevelReason?: string | null;
  verification?: VerificationInput | null;
  expiresAt?: string | null;
};

/**
 * Add a guardian / representative: an existing portal login (by email) or a new invited login.
 * The link is PENDING until staff record verification of authority (here or later with verify).
 * A new login gets an invitation email with no PHI; an existing active login gets an "access added" note.
 */
export async function grantProxyAccess(actor: Actor, clientWhere: Prisma.ClientWhereInput, input: GrantInput, now = new Date()) {
  const client = await loadClient(clientWhere);
  if (!client.active || client.status === 'DISCHARGED') throw new ProxyAccessError('The client is not active.');
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ProxyAccessError('Enter a valid email address.');
  const displayName = (input.displayName ?? '').trim().slice(0, 120);
  if (displayName.length < 2) throw new ProxyAccessError('Enter the guardian’s full name.');
  if (!isProxyRelationship(input.relationship)) throw new ProxyAccessError('Choose parent, legal guardian or authorized representative.');
  const relationship = input.relationship;
  const age = ageInYears(client.dateOfBirth, now);
  const requested = input.accessLevel && isPortalAccessLevel(input.accessLevel) ? input.accessLevel : null;
  const grantErr = validateGrant({ relationship, accessLevel: requested, accessLevelReason: input.accessLevelReason, ageYears: age });
  if (grantErr) throw new ProxyAccessError(grantErr);
  const accessLevel = requested ?? defaultAccessLevel(relationship, age)!;
  const minorAtGrant = age !== null && age < PROXY_RULES.proxyEndsAtAge;
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) throw new ProxyAccessError('The end date must be in the future.');
  }
  const verified = verificationData(input.verification, relationship, age, actor, now);

  const existing = await prisma.patientAccount.findUnique({ where: { email }, select: { id: true, clientId: true, status: true, displayName: true } });
  if (existing?.clientId === client.id) {
    throw new ProxyAccessError('This email is the client’s own portal login. If the login actually belongs to the parent / guardian, use "Convert to guardian login" instead.', 409);
  }

  let rawToken: string | null = null;
  const result = await prisma.$transaction(async (tx) => {
    let portalUserId: string;
    let newLogin = false;
    if (existing) {
      if (existing.status === 'DISABLED') throw new ProxyAccessError('That portal login is disabled. Ask an administrator to re-enable it first.', 409);
      portalUserId = existing.id;
      if (!existing.displayName) await tx.patientAccount.update({ where: { id: existing.id }, data: { displayName } });
      if (existing.status === 'INVITED') {
        // Not activated yet: a fresh invitation (the old link stops working)
        rawToken = newInviteToken();
        await tx.patientAccount.update({ where: { id: existing.id }, data: { inviteTokenHash: hashInviteToken(rawToken), inviteExpiresAt: inviteExpiry() } });
      }
    } else {
      rawToken = newInviteToken();
      const created = await tx.patientAccount.create({
        data: { email, displayName, clientId: null, status: 'INVITED', inviteTokenHash: hashInviteToken(rawToken), inviteExpiresAt: inviteExpiry() },
        select: { id: true },
      });
      portalUserId = created.id;
      newLogin = true;
    }
    const data = {
      organizationId: actor.organizationId,
      relationship,
      accessLevel,
      accessLevelReason: clip(input.accessLevelReason, 500),
      minorAtGrant,
      grantedById: actor.userId,
      grantedAt: now,
      expiresAt,
      revokedAt: null,
      revokedById: null,
      revokeReason: null,
      endedReason: null,
      verifiedAt: null,
      verifiedById: null,
      verificationMethod: null,
      legalDocumentRef: null,
      verificationNote: null,
      ...verified,
    };
    const prior = await tx.portalAccess.findUnique({ where: { portalUserId_clientId: { portalUserId, clientId: client.id } }, select: { id: true, revokedAt: true, relationship: true } });
    if (prior && !prior.revokedAt) throw new ProxyAccessError('This login already has access to this client.', 409);
    if (prior?.relationship === 'self') throw new ProxyAccessError('This login is the client’s own login.', 409);
    const link = prior
      ? await tx.portalAccess.update({ where: { id: prior.id }, data })
      : await tx.portalAccess.create({ data: { ...data, portalUserId, clientId: client.id } });
    return { link, portalUserId, newLogin };
  });

  let notification: 'invite_sent' | 'access_added_sent' | 'not_sent' = 'not_sent';
  try {
    if (rawToken) {
      await sendGuardianInviteEmail({ to: email, guardianName: displayName, rawToken });
      notification = 'invite_sent';
    } else if (existing?.status === 'ACTIVE') {
      await sendGuardianAccessAddedEmail({ to: email, guardianName: existing.displayName || displayName });
      notification = 'access_added_sent';
    }
  } catch (err) {
    console.error('[portal proxy] notification failed', err instanceof Error ? err.name : 'unknown');
  }
  return {
    accessId: result.link.id,
    portalUserId: result.portalUserId,
    newLogin: result.newLogin,
    existingLoginStatus: existing?.status ?? null,
    accessLevel,
    verified: Boolean(result.link.verifiedAt),
    notification,
    // The login is also another client's OWN login (e.g. the parent's email was used as a sibling's
    // portal login): staff should convert it on that chart so it is a guardian login there too
    warning: existing?.clientId ? 'This email is also another client’s own portal login. If it belongs to the parent, open that chart and use "Convert to guardian login".' : null,
  };
}

async function loadLink(actor: Actor, clientId: string, accessId: string) {
  const link = await prisma.portalAccess.findFirst({
    where: { id: accessId, clientId },
    include: { client: { select: { id: true, dateOfBirth: true } }, portalUser: { select: { id: true, email: true, status: true, displayName: true, inviteTokenHash: true } } },
  });
  if (!link || (link.organizationId && link.organizationId !== actor.organizationId)) throw new ProxyAccessError('Access not found', 404);
  return link;
}

/** Record verification of authority; the link becomes active. */
export async function verifyProxyAccess(actor: Actor, clientId: string, accessId: string, v: VerificationInput, now = new Date()) {
  const link = await loadLink(actor, clientId, accessId);
  if (link.revokedAt) throw new ProxyAccessError('This access has ended. Grant it again.', 409);
  const relationship = isPortalRelationship(link.relationship) ? link.relationship : 'authorized_representative';
  const data = verificationData(v, relationship, ageInYears(link.client.dateOfBirth, now), actor, now);
  await prisma.portalAccess.update({ where: { id: link.id }, data });
  return { accessId: link.id, verified: true };
}

/** Revoke now: the next request with any token for this person is refused (re-checked per request). */
export async function revokeProxyAccess(actor: Actor, clientId: string, accessId: string, reason: string, now = new Date()) {
  const why = reason.trim().slice(0, 500);
  if (why.length < 3) throw new ProxyAccessError('Record why access is revoked.');
  const link = await loadLink(actor, clientId, accessId);
  if (link.revokedAt) return { accessId: link.id, revoked: false, alreadyEnded: true };
  await prisma.portalAccess.update({ where: { id: link.id }, data: { revokedAt: now, revokedById: actor.userId, revokeReason: why, endedReason: 'revoked' } });
  return { accessId: link.id, revoked: true, alreadyEnded: false };
}

export async function setProxyAccessLevel(actor: Actor, clientId: string, accessId: string, level: string, reason: string) {
  if (!isPortalAccessLevel(level)) throw new ProxyAccessError('Choose full or limited.');
  const why = reason.trim().slice(0, 500);
  if (why.length < 5) throw new ProxyAccessError('Record why the access level changed.');
  const link = await loadLink(actor, clientId, accessId);
  if (link.relationship === 'self') throw new ProxyAccessError('The client’s own login always has full access.');
  await prisma.portalAccess.update({ where: { id: link.id }, data: { accessLevel: level, accessLevelReason: why } });
  return { accessId: link.id, accessLevel: level };
}

/** New invitation for a guardian login that has not set a password yet. */
export async function resendGuardianInvite(actor: Actor, clientId: string, accessId: string) {
  const link = await loadLink(actor, clientId, accessId);
  if (link.portalUser.status !== 'INVITED') throw new ProxyAccessError('This login is already active. The guardian can use "Forgot password".', 409);
  const rawToken = newInviteToken();
  await prisma.patientAccount.update({ where: { id: link.portalUser.id }, data: { inviteTokenHash: hashInviteToken(rawToken), inviteExpiresAt: inviteExpiry() } });
  await sendGuardianInviteEmail({ to: link.portalUser.email, guardianName: link.portalUser.displayName ?? '', rawToken });
  return { accessId: link.id, inviteSent: true };
}

/**
 * The client's own portal login actually belongs to the parent (common for young children: the
 * chart email is the parent's). Turns it into a guardian login: the login keeps its email and
 * password, loses the 'self' tie to this chart, and gets a parent / guardian link instead (with
 * the verification recorded). The same login can then be linked to siblings.
 */
export async function convertSelfLoginToGuardian(
  actor: Actor,
  clientWhere: Prisma.ClientWhereInput,
  input: { displayName: string; relationship: string; accessLevel?: string | null; accessLevelReason?: string | null; verification: VerificationInput },
  now = new Date()
) {
  const client = await loadClient(clientWhere);
  const own = client.patientAccount;
  if (!own) throw new ProxyAccessError('This client has no portal login of their own.', 404);
  if (!isProxyRelationship(input.relationship)) throw new ProxyAccessError('Choose parent, legal guardian or authorized representative.');
  const displayName = (input.displayName ?? '').trim().slice(0, 120);
  if (displayName.length < 2) throw new ProxyAccessError('Enter the guardian’s full name.');
  const age = ageInYears(client.dateOfBirth, now);
  const requested = input.accessLevel && isPortalAccessLevel(input.accessLevel) ? input.accessLevel : null;
  const grantErr = validateGrant({ relationship: input.relationship, accessLevel: requested, accessLevelReason: input.accessLevelReason, ageYears: age });
  if (grantErr) throw new ProxyAccessError(grantErr);
  if (!input.verification) throw new ProxyAccessError('Record how the guardian’s authority was verified.');
  const verified = verificationData(input.verification, input.relationship, age, actor, now);
  const accessLevel = requested ?? defaultAccessLevel(input.relationship, age)!;
  await prisma.$transaction(async (tx) => {
    await tx.patientAccount.update({ where: { id: own.id }, data: { clientId: null, displayName } });
    await tx.portalAccess.upsert({
      where: { portalUserId_clientId: { portalUserId: own.id, clientId: client.id } },
      create: {
        portalUserId: own.id, clientId: client.id, organizationId: actor.organizationId, relationship: input.relationship,
        accessLevel, accessLevelReason: clip(input.accessLevelReason, 500), minorAtGrant: age !== null && age < PROXY_RULES.proxyEndsAtAge,
        grantedById: actor.userId, grantedAt: now, ...verified,
      },
      update: {
        relationship: input.relationship, accessLevel, accessLevelReason: clip(input.accessLevelReason, 500),
        minorAtGrant: age !== null && age < PROXY_RULES.proxyEndsAtAge, grantedById: actor.userId, grantedAt: now,
        revokedAt: null, revokedById: null, revokeReason: null, endedReason: null, ...verified,
      },
    });
  });
  return { portalUserId: own.id, email: own.email, relationship: input.relationship, accessLevel };
}

/** Md. Health-General §20-104: the minor consented to their own mental health treatment. */
export async function setMinorSelfConsent(actor: Actor, clientWhere: Prisma.ClientWhereInput, value: boolean, now = new Date()) {
  const client = await loadClient(clientWhere);
  await prisma.client.update({
    where: { id: client.id },
    data: { portalMinorSelfConsentMh: value, portalMinorSelfConsentSetAt: now, portalMinorSelfConsentSetById: actor.userId },
  });
  return { clientId: client.id, minorSelfConsentMh: value };
}

/** Confirms the item belongs to this client (and org) before an override is stored. */
async function itemBelongsToClient(organizationId: string, clientId: string, itemType: PortalItemType, itemId: string) {
  const w = { id: itemId, clientId };
  switch (itemType) {
    case 'treatment_plan':
      return Boolean(await prisma.treatmentPlan.findFirst({ where: { ...w, organizationId }, select: { id: true } }));
    case 'consent_packet':
      return Boolean(await prisma.consentPacket.findFirst({ where: { ...w, organizationId }, select: { id: true } }));
    case 'carelon_attestation':
    case 'consent_form':
      return Boolean(await prisma.consentForm.findFirst({ where: { ...w, organizationId }, select: { id: true } }));
    case 'resource':
      return Boolean(await prisma.resourceAssignment.findFirst({ where: { ...w, organizationId }, select: { id: true } }));
    case 'appointment':
      return Boolean(await prisma.appointment.findFirst({ where: w, select: { id: true } }));
    case 'message_thread':
      return Boolean(await prisma.messageThread.findFirst({ where: { ...w, organizationId }, select: { id: true } }));
    default:
      return false;
  }
}

/**
 * Clinician marks one portal item confidential (hidden from every proxy) or shared with the guardian
 * (shown even when the category default hides it; for 42 CFR Part 2 content only with the minor's
 * written consent, which the reason must cite). visibility null removes the decision.
 */
export async function setPortalItemVisibility(
  actor: Actor,
  clientId: string,
  input: { itemType: string; itemId: string; visibility: 'confidential' | 'shared_with_guardian' | null; reason?: string | null }
) {
  if (!(PORTAL_ITEM_TYPES as readonly string[]).includes(input.itemType)) throw new ProxyAccessError('Unknown item type.');
  const itemType = input.itemType as PortalItemType;
  const itemId = input.itemId.trim().slice(0, 64);
  if (!itemId) throw new ProxyAccessError('Choose an item.');
  if (!(await itemBelongsToClient(actor.organizationId, clientId, itemType, itemId))) throw new ProxyAccessError('Item not found for this client', 404);
  if (input.visibility === null) {
    await prisma.portalItemVisibility.deleteMany({ where: { itemType, itemId, clientId } });
    return { itemType, itemId, visibility: null };
  }
  const reason = (input.reason ?? '').trim().slice(0, 500);
  if (input.visibility === 'shared_with_guardian' && reason.length < 5) {
    throw new ProxyAccessError('Record why this is shared with the guardian (for substance use records: the client’s written consent).');
  }
  await prisma.portalItemVisibility.upsert({
    where: { itemType_itemId: { itemType, itemId } },
    create: { organizationId: actor.organizationId, clientId, itemType, itemId, visibility: input.visibility, reason: reason || null, setById: actor.userId },
    update: { visibility: input.visibility, reason: reason || null, setById: actor.userId, setAt: new Date() },
  });
  return { itemType, itemId, visibility: input.visibility };
}

export type PortalItemSummary = { itemType: PortalItemType; itemId: string; label: string; date: string | null; part2: boolean };

/** Recent items a portal login can see, for the clinician's confidential / shared-with-guardian choice. */
export async function listPortalItems(organizationId: string, clientId: string): Promise<PortalItemSummary[]> {
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
  // Message threads are not listed: a guardian only ever sees the threads they opened themselves
  const [plans, packets, forms, resources, appts] = await Promise.all([
    prisma.treatmentPlan.findMany({ where: { organizationId, clientId, patientSentAt: { not: null } }, select: { id: true, title: true, patientSentAt: true }, orderBy: { patientSentAt: 'desc' }, take: 20 }),
    prisma.consentPacket.findMany({ where: { organizationId, clientId, method: 'portal' }, select: { id: true, sentAt: true, items: true }, orderBy: { sentAt: 'desc' }, take: 20 }),
    prisma.consentForm.findMany({ where: { organizationId, clientId }, select: { id: true, type: true, formKey: true, sentAt: true }, orderBy: { sentAt: 'desc' }, take: 30 }),
    prisma.resourceAssignment.findMany({ where: { organizationId, clientId, status: { not: 'withdrawn' } }, select: { id: true, part2: true, createdAt: true, item: { select: { title: true, sudRelated: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.appointment.findMany({ where: { clientId, startsAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { id: true, type: true, startsAt: true }, orderBy: { startsAt: 'asc' }, take: 20 }),
  ]);
  return [
    ...plans.map((p) => ({ itemType: 'treatment_plan' as const, itemId: p.id, label: `Treatment plan: ${p.title}`, date: iso(p.patientSentAt), part2: false })),
    ...packets.map((p) => ({ itemType: 'consent_packet' as const, itemId: p.id, label: 'Consent packet', date: iso(p.sentAt), part2: /"part2-consent"/.test(JSON.stringify(p.items ?? null)) })),
    ...forms.map((f) => ({ itemType: 'consent_form' as const, itemId: f.id, label: `Form: ${f.type}`, date: iso(f.sentAt), part2: /part[\s-]?2/i.test(`${f.formKey ?? ''} ${f.type}`) && !/notice/i.test(`${f.formKey ?? ''} ${f.type}`) })),
    ...resources.map((r) => ({ itemType: 'resource' as const, itemId: r.id, label: `Resource: ${r.item?.title ?? ''}`, date: iso(r.createdAt), part2: r.part2 || Boolean(r.item?.sudRelated) })),
    ...appts.map((a) => ({ itemType: 'appointment' as const, itemId: a.id, label: `Appointment: ${a.type ?? ''}`, date: iso(a.startsAt), part2: false })),
  ];
}
