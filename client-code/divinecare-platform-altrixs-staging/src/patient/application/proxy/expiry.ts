import { prisma } from '@/lib/db/prisma';
import { ageInYears, isPortalRelationship, linkState, PROXY_RULES } from '@/patient/domain/proxy-policy';
import { endPortalAccess } from '@/patient/application/auth/session';

/**
 * Nightly: end proxy links whose client turned 18 (links granted while the client was a minor, and
 * every 'parent' link) or whose expiresAt passed. The same check runs on every portal request, so
 * the job only makes the database (and the chart card) say so, and starts the client's own invite.
 *
 * At 18 the client gets their own portal invitation when they have an email on the chart that is not
 * already a portal login (often the chart email is the parent's: then staff update it; the result
 * lists those clients as needsOwnEmail).
 */
export type ProxyExpiryResult = {
  scanned: number;
  agedOut: number;
  expired: number;
  ownInvitesSent: number;
  needsOwnEmail: string[];
  inviteErrors: number;
};

export async function runProxyExpiry(
  now = new Date(),
  deps: { inviteClient?: (clientId: string) => Promise<{ invited: boolean; error?: string }> } = {}
): Promise<ProxyExpiryResult> {
  const result: ProxyExpiryResult = { scanned: 0, agedOut: 0, expired: 0, ownInvitesSent: 0, needsOwnEmail: [], inviteErrors: 0 };
  const open = await prisma.portalAccess.findMany({
    where: { revokedAt: null, relationship: { not: 'self' } },
    select: {
      id: true, portalUserId: true, clientId: true, relationship: true, accessLevel: true, minorAtGrant: true,
      verifiedAt: true, expiresAt: true, revokedAt: true, endedReason: true,
      client: { select: { id: true, dateOfBirth: true, email: true, active: true, status: true, patientAccount: { select: { id: true } } } },
    },
    take: 5000,
  });
  result.scanned = open.length;
  const turned18 = new Set<string>();
  for (const link of open) {
    const state = linkState(link, { dateOfBirth: link.client.dateOfBirth }, now);
    if (state !== 'aged_out' && state !== 'expired') continue;
    const relationship = isPortalRelationship(link.relationship) ? link.relationship : null;
    const ended = await endPortalAccess(link.id, state, now, { portalUserId: link.portalUserId, clientId: link.clientId, relationship });
    if (!ended) continue;
    if (state === 'aged_out') {
      result.agedOut++;
      turned18.add(link.clientId);
    } else {
      result.expired++;
    }
  }

  // The client's own login at 18 (once per client; skipped when they already have one)
  const invite = deps.inviteClient ?? (async (clientId: string) => (await import('@/patient/application/invite/onboard-client')).invitePatientForClient(clientId));
  for (const clientId of turned18) {
    const link = open.find((l) => l.clientId === clientId)!;
    const c = link.client;
    const age = ageInYears(c.dateOfBirth, now);
    if (c.patientAccount || !c.active || c.status === 'DISCHARGED' || age === null || age < PROXY_RULES.proxyEndsAtAge) continue;
    const email = c.email?.trim().toLowerCase();
    const emailIsALogin = email ? await prisma.patientAccount.findUnique({ where: { email }, select: { id: true } }) : null;
    if (!email || emailIsALogin) {
      result.needsOwnEmail.push(clientId);
      continue;
    }
    try {
      const r = await invite(clientId);
      if (r.invited) result.ownInvitesSent++;
      else result.inviteErrors++;
    } catch {
      result.inviteErrors++;
    }
  }
  return result;
}
