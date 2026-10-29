import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientProfile } from '@/patient/domain';
import {
  ageInYears,
  isPortalAccessLevel,
  isPortalRelationship,
  linkState,
  type PortalActor,
  type PortalLinkState,
  type PortalRelationship,
} from '@/patient/domain/proxy-policy';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { bearerToken, matchesPatientCredential, verifyPatientSession } from '@/patient/infrastructure/security/tokens';

/**
 * Patient portal sessions (web + Flutter bearer tokens).
 *
 * The token carries the portal user (sub = PatientAccount.id) and the ACTIVE client (clientId).
 * Nothing in the token is trusted for access: every request re-checks that the portal user still has
 * an active PortalAccess link to that client (or is that client's own pre-migration login), so a
 * revocation, an expiry or the client's 18th birthday takes effect on the next request.
 * Single-client tokens issued before proxy access existed have the same shape and keep working.
 */

const unauthenticated = () => new PatientAppError('Sign in required', 401, 'unauthenticated');

export type PortalUser = {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  /** The user's own chart ('self'), null for a guardian-only login */
  clientId: string | null;
  lastActiveClientId: string | null;
};

/** Verifies the bearer token and the account only (not which client it is viewing). */
export async function requirePortalUser(req: Request): Promise<{ user: PortalUser; activeClientId: string }> {
  const token = bearerToken(req);
  if (!token) throw unauthenticated();
  let parsed: ReturnType<typeof verifyPatientSession>;
  try {
    parsed = verifyPatientSession(token);
  } catch {
    throw unauthenticated();
  }
  const account = await prisma.patientAccount.findFirst({
    where: { id: parsed.accountId, status: 'ACTIVE' },
    select: { id: true, email: true, displayName: true, passwordHash: true, clientId: true, lastActiveClientId: true },
  });
  if (!account || !account.passwordHash || !matchesPatientCredential(parsed.credential, account.passwordHash)) {
    throw unauthenticated();
  }
  return {
    user: {
      id: account.id,
      email: account.email,
      displayName: account.displayName ?? null,
      passwordHash: account.passwordHash,
      clientId: account.clientId ?? null,
      lastActiveClientId: account.lastActiveClientId ?? null,
    },
    activeClientId: parsed.clientId,
  };
}

const clientSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  active: true,
  dateOfBirth: true,
  portalMinorSelfConsentMh: true,
} as const;

type AccessClient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  active: boolean;
  dateOfBirth: Date | null;
  portalMinorSelfConsentMh: boolean | null;
};

export type ResolvedAccess =
  | { ok: true; client: AccessClient; actor: PortalActor }
  | { ok: false; reason: 'no_link' | 'client_inactive' | Exclude<PortalLinkState, 'active'>; relationship: PortalRelationship | null };

/**
 * Server-side check: may this portal user open this client's chart right now, and as whom?
 * Ends aged-out / expired links in the database (once) so the nightly job and the request path agree.
 */
export async function resolvePortalAccess(
  user: Pick<PortalUser, 'id' | 'clientId' | 'displayName'>,
  clientId: string,
  now = new Date()
): Promise<ResolvedAccess> {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 64) return { ok: false, reason: 'no_link', relationship: null };
  const [client, link] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: clientSelect }) as Promise<AccessClient | null>,
    prisma.portalAccess.findUnique({ where: { portalUserId_clientId: { portalUserId: user.id, clientId } } }),
  ]);
  if (!client) return { ok: false, reason: 'no_link', relationship: null };

  let relationship: PortalRelationship;
  let accessLevel: 'full' | 'limited' = 'full';
  let accessId: string | null = null;
  if (link) {
    relationship = isPortalRelationship(link.relationship) ? link.relationship : 'authorized_representative';
    const state = linkState(link, { dateOfBirth: client.dateOfBirth ?? null }, now);
    if (state !== 'active') {
      if ((state === 'aged_out' || state === 'expired') && !link.revokedAt) {
        await endPortalAccess(link.id, state, now, { portalUserId: user.id, clientId, relationship });
      }
      return { ok: false, reason: state, relationship };
    }
    accessLevel = isPortalAccessLevel(link.accessLevel) ? link.accessLevel : 'limited';
    accessId = link.id;
  } else if (user.clientId && user.clientId === clientId) {
    // Pre-migration account: the login's own chart is an implicit 'self' link
    relationship = 'self';
  } else {
    return { ok: false, reason: 'no_link', relationship: null };
  }

  if (!client.active || client.status === 'DISCHARGED') return { ok: false, reason: 'client_inactive', relationship };

  const isProxy = relationship !== 'self';
  return {
    ok: true,
    client,
    actor: {
      accessId,
      relationship,
      accessLevel: isProxy ? accessLevel : 'full',
      isProxy,
      actorName: isProxy ? user.displayName?.trim() || 'Guardian' : client.name,
      clientAgeYears: ageInYears(client.dateOfBirth ?? null, now),
      minorSelfConsentMh: Boolean(client.portalMinorSelfConsentMh),
    },
  };
}

/** Marks a link ended (aged out at 18 / expired). Idempotent: only an open link is changed. */
export async function endPortalAccess(
  accessId: string,
  reason: 'aged_out' | 'expired',
  now: Date,
  audit: { portalUserId: string; clientId: string; relationship: PortalRelationship | null }
) {
  const res = await prisma.portalAccess.updateMany({
    where: { id: accessId, revokedAt: null },
    data: { revokedAt: now, endedReason: reason, revokeReason: reason === 'aged_out' ? 'Client turned 18' : 'Access period ended' },
  });
  if (res.count > 0) {
    await logPatientAudit({
      clientId: audit.clientId,
      accountId: audit.portalUserId,
      action: reason === 'aged_out' ? 'proxy.aged_out' : 'proxy.expired',
      entityType: 'portal_access',
      entityId: accessId,
      portalAccessId: accessId,
      relationship: audit.relationship ?? undefined,
    });
  }
  return res.count > 0;
}

function profileFor(user: PortalUser, resolved: Extract<ResolvedAccess, { ok: true }>): PatientProfile {
  return {
    accountId: user.id,
    portalUserId: user.id,
    clientId: resolved.client.id,
    name: resolved.client.name,
    email: user.email,
    phone: resolved.client.phone,
    status: 'ACTIVE',
    access: resolved.actor,
  };
}

/**
 * Every protected patient route: the token's portal user + the active client, re-checked.
 * The client's own login keeps the old answers (401 when the chart is inactive / discharged);
 * a proxy whose link ended gets 403 access_ended so the app can switch to another person.
 */
export async function requirePatient(req: Request): Promise<PatientProfile> {
  const { user, activeClientId } = await requirePortalUser(req);
  const resolved = await resolvePortalAccess(user, activeClientId);
  if (resolved.ok === false) {
    if (resolved.relationship && resolved.relationship !== 'self' && resolved.reason !== 'client_inactive') {
      await logPatientAudit({
        clientId: activeClientId,
        accountId: user.id,
        action: 'proxy.access_denied',
        entityType: 'portal_access',
        entityId: resolved.reason,
        relationship: resolved.relationship,
      });
      throw new PatientAppError('Your access to this person’s account has ended. Choose another person or contact the clinic.', 403, 'access_ended');
    }
    throw unauthenticated();
  }
  return profileFor(user, resolved);
}

export type PortalPerson = {
  clientId: string;
  name: string;
  relationship: PortalRelationship;
  accessLevel: 'full' | 'limited';
  isProxy: boolean;
};

/** People this portal user can open now (the "Viewing: …" picker). Self first, then by name. */
export async function listPortalPeople(user: Pick<PortalUser, 'id' | 'clientId'>, now = new Date()): Promise<PortalPerson[]> {
  const links = await prisma.portalAccess.findMany({
    where: { portalUserId: user.id },
    select: { id: true, clientId: true, relationship: true, accessLevel: true, minorAtGrant: true, verifiedAt: true, expiresAt: true, revokedAt: true, endedReason: true },
    take: 50,
  });
  const ids = new Set<string>(links.map((l) => l.clientId));
  if (user.clientId) ids.add(user.clientId);
  if (ids.size === 0) return [];
  const clients = (await prisma.client.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, preferredName: true, active: true, status: true, dateOfBirth: true },
  })) as { id: string; name: string; preferredName: string | null; active: boolean; status: string; dateOfBirth: Date | null }[];
  const byId = new Map(clients.map((c) => [c.id, c]));
  const people: PortalPerson[] = [];
  for (const l of links) {
    const c = byId.get(l.clientId);
    if (!c || !c.active || c.status === 'DISCHARGED') continue;
    if (linkState(l, { dateOfBirth: c.dateOfBirth ?? null }, now) !== 'active') continue;
    const relationship = isPortalRelationship(l.relationship) ? l.relationship : 'authorized_representative';
    people.push({
      clientId: c.id,
      name: c.preferredName?.trim() || c.name,
      relationship,
      accessLevel: relationship === 'self' ? 'full' : isPortalAccessLevel(l.accessLevel) ? l.accessLevel : 'limited',
      isProxy: relationship !== 'self',
    });
  }
  // Pre-migration self login (no explicit row yet). An explicit row (even revoked) decides instead.
  if (user.clientId && !links.some((l) => l.clientId === user.clientId)) {
    const c = byId.get(user.clientId);
    if (c && c.active && c.status !== 'DISCHARGED') {
      people.push({ clientId: c.id, name: c.preferredName?.trim() || c.name, relationship: 'self', accessLevel: 'full', isProxy: false });
    }
  }
  return people.sort((a, b) => (a.isProxy === b.isProxy ? a.name.localeCompare(b.name) : a.isProxy ? 1 : -1));
}

/** Default person after sign-in: last viewed (still allowed), else self, else the first link. */
export function defaultPerson(people: PortalPerson[], lastActiveClientId: string | null): PortalPerson | null {
  return people.find((p) => p.clientId === lastActiveClientId) ?? people.find((p) => !p.isProxy) ?? people[0] ?? null;
}

/** Public shape of "who am I acting as". */
export function actingAsView(me: Pick<PatientProfile, 'clientId' | 'name' | 'access'>) {
  return {
    clientId: me.clientId,
    clientName: me.name,
    relationship: me.access.relationship,
    accessLevel: me.access.accessLevel,
    isProxy: me.access.isProxy,
    actorName: me.access.actorName,
  };
}
