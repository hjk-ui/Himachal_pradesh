import {
  patientOk,
  patientOptions,
  patientRouteError,
} from '@/patient/infrastructure/http/handler';
import { listPortalPeople, requirePortalUser, resolvePortalAccess } from '@/patient/application/auth/session';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export function OPTIONS() {
  return patientOptions();
}

/**
 * GET /api/patient/session
 * Who is signed in, which person the session is viewing, and everyone this login may switch to.
 * Works even when the active person's access has ended (activeClientId is then null and the app
 * calls POST /api/patient/session/switch with one of `people`).
 */
export async function GET(req: Request) {
  try {
    const { user, activeClientId } = await requirePortalUser(req);
    const [people, resolved] = await Promise.all([listPortalPeople(user), resolvePortalAccess(user, activeClientId)]);
    await writeAuditLog({
      action: 'READ',
      actorUserId: user.id,
      actorRole: resolved.ok && resolved.actor.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
      resourceType: 'portalSession',
      resourceId: user.id,
      patientId: resolved.ok ? resolved.client.id : null,
      outcome: 'SUCCESS',
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-app', people: people.length, activeEnded: !resolved.ok },
    });
    return patientOk({
      portalUser: { id: user.id, email: user.email, displayName: user.displayName },
      activeClientId: resolved.ok ? resolved.client.id : null,
      actingAs: resolved.ok
        ? {
            clientId: resolved.client.id,
            clientName: resolved.client.name,
            relationship: resolved.actor.relationship,
            accessLevel: resolved.actor.accessLevel,
            isProxy: resolved.actor.isProxy,
            actorName: resolved.actor.actorName,
          }
        : null,
      people,
    });
  } catch (err) {
    return patientRouteError(err);
  }
}
