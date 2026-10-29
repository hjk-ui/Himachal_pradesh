import { prisma } from '@/lib/db/prisma';
import { clientByIdWhere } from '@/lib/clients/orgScope';

/**
 * Validates that if a clientId is provided, it belongs to the authenticated organization.
 * Anonymous episodes (null / empty clientId) are permitted for field/988 intake,
 * but whenever a clientId is specified, it MUST belong to the organization.
 */
export async function validateClientBelongsToOrg(
  clientId: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (!clientId || typeof clientId !== 'string' || clientId.trim() === '') {
    return true;
  }

  const client = await prisma.client.findFirst({
    where: clientByIdWhere(clientId.trim(), organizationId),
    select: { id: true },
  });

  return Boolean(client);
}

/**
 * Backfill legacy episodes ONLY when trusted ownership evidence exists.
 * Trusted evidence: episode.clientId is non-null and corresponds to a client
 * belonging to the authenticated organization.
 * 
 * Rules:
 * - Do NOT guess or assign unlinked episodes (null clientId).
 * - Do NOT expose or reassign episodes whose clientId belongs to a different organization.
 */
export async function backfillTrustedLegacyEpisodes(organizationId: string): Promise<number> {
  if (!organizationId) return 0;

  try {
    const unassigned = await prisma.crisisEpisode.findMany({
      where: {
        organizationId: null,
        clientId: { not: null },
      },
      select: { id: true, clientId: true },
    });

    if (unassigned.length === 0) return 0;

    let backfilledCount = 0;
    for (const ep of unassigned) {
      if (!ep.clientId) continue;

      const client = await prisma.client.findFirst({
        where: clientByIdWhere(ep.clientId, organizationId),
        select: { id: true },
      });

      if (client) {
        await prisma.crisisEpisode.update({
          where: { id: ep.id },
          data: { organizationId },
        });
        backfilledCount++;
      }
    }

    return backfilledCount;
  } catch (err) {
    console.error('[crisis:tenantIsolation] backfillTrustedLegacyEpisodes error:', err);
    return 0;
  }
}

/**
 * Backfill legacy crisis team pages ONLY when trusted ownership evidence exists.
 * Trusted evidence: page links to an episode that has verified ownership in this org.
 */
export async function backfillTrustedLegacyPages(organizationId: string): Promise<number> {
  if (!organizationId) return 0;

  try {
    const unassigned = await prisma.crisisTeamPage.findMany({
      where: {
        organizationId: null,
        OR: [{ episodeId: { not: null } }, { episodeNumber: { not: null } }],
      },
      select: { id: true, episodeId: true, episodeNumber: true },
    });

    if (unassigned.length === 0) return 0;

    let backfilledCount = 0;
    for (const page of unassigned) {
      const ep = await prisma.crisisEpisode.findFirst({
        where: {
          organizationId,
          ...(page.episodeId ? { id: page.episodeId } : { episodeNumber: page.episodeNumber! }),
        },
        select: { id: true },
      });

      if (ep) {
        await prisma.crisisTeamPage.update({
          where: { id: page.id },
          data: { organizationId },
        });
        backfilledCount++;
      }
    }

    return backfilledCount;
  } catch (err) {
    console.error('[crisis:tenantIsolation] backfillTrustedLegacyPages error:', err);
    return 0;
  }
}

/**
 * Strips ownership and delivery/acknowledgement fields from request bodies to prevent
 * unauthorized override of tenant boundaries or false notification dispatch.
 */
export function sanitizeCrisisRequestBody<T extends Record<string, any>>(rawBody: T): Partial<T> {
  const sanitized = { ...rawBody };

  // Strip ownership override attempts
  delete sanitized.organizationId;
  delete sanitized.orgId;

  // Strip delivery & acknowledgement confirmation attempts
  delete sanitized.notificationsSent;
  delete sanitized.delivered;
  delete sanitized.acknowledged;
  delete sanitized.respondersAck;
  delete sanitized.respondersAcknowledged;
  delete sanitized.respondersTotal;
  delete sanitized.smsDelivered;
  delete sanitized.pushDelivered;
  delete sanitized.snsDelivered;
  delete sanitized.supervisorNotified;
  delete sanitized.deliveryStatus;

  return sanitized;
}
