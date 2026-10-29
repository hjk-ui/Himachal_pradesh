import type { Prisma, Role } from '@prisma/client';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';

export type PeerActor = { organizationId: string; actorUserId: string; actorRole: Role };

/**
 * Clients whose peer-support records this actor may read or write.
 *
 * PEER_SUPPORT: the clinic's clients they are assigned to (Client.assignedToId) or that list
 * them on the treatment team (ClientTreatmentTeamMember.providerId; rows are deleted when a
 * member is removed, so a row means active). Peer specialists are normally added to a care
 * team rather than made the primary assignee, so team membership is how they get a caseload.
 *
 * Everyone else keeps the app-wide rule (clientAccessWhere): leadership sees the org,
 * case managers / PRP specialists see their assigned clients.
 */
export function peerClientWhere(actor: PeerActor): Prisma.ClientWhereInput {
  if (actor.actorRole === 'PEER_SUPPORT') {
    return {
      AND: [
        clientOrgFilter(actor.organizationId),
        {
          OR: [
            { assignedToId: actor.actorUserId },
            { treatmentTeamMembers: { some: { providerId: actor.actorUserId } } },
          ],
        },
      ],
    };
  }
  return clientAccessWhere(actor);
}

/**
 * Client fields the peer APIs may select. Name and status only: no diagnoses, notes,
 * medications, insurance or billing (minimum necessary).
 */
export const PEER_CLIENT_SELECT = { id: true, name: true, status: true, assignedToId: true } as const;
