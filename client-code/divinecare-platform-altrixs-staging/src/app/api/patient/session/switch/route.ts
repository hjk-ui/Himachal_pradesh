import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import {
  patientFail,
  patientOk,
  patientOptions,
  patientRateLimited,
  patientRouteError,
  readPatientJson,
} from '@/patient/infrastructure/http/handler';
import { listPortalPeople, requirePortalUser, resolvePortalAccess } from '@/patient/application/auth/session';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { signPatientSession } from '@/patient/infrastructure/security/tokens';

const schema = z.object({ clientId: z.string().trim().min(1).max(64) });

export function OPTIONS() {
  return patientOptions();
}

/**
 * POST /api/patient/session/switch  { clientId }
 * "Viewing: Child A ▾": issues a new session token for another person this login is linked to.
 * The target is re-checked server-side (active, verified, unexpired, not revoked, under 18 for a
 * minor's proxy); a client id the login is not linked to is refused (403) and audited.
 * Web and mobile use the same endpoint; the old token keeps working for its own person.
 */
export async function POST(req: Request) {
  try {
    const blocked = patientRateLimited(req, 'patient-session-switch', 60);
    if (blocked) return blocked;
    const { user, activeClientId } = await requirePortalUser(req);
    const body = schema.parse(await readPatientJson(req));
    const resolved = await resolvePortalAccess(user, body.clientId);
    if (resolved.ok === false) {
      // Never reveal whether the id exists: the same answer for unknown, unlinked and ended links
      await logPatientAudit({
        clientId: activeClientId,
        accountId: user.id,
        action: 'proxy.switch_denied',
        entityType: 'portal_access',
        entityId: resolved.reason,
        ...(resolved.relationship ? { relationship: resolved.relationship } : {}),
      });
      await writeAuditLog({
        action: 'PORTAL_SWITCH',
        actorUserId: user.id,
        actorRole: 'PATIENT_PROXY',
        resourceType: 'portalAccess',
        patientId: activeClientId,
        outcome: 'DENIED',
        ...auditRequestMeta(req),
        metadata: { portal: 'patient-app', reason: resolved.reason },
      });
      return patientFail('FORBIDDEN', 'You do not have access to that person’s account.', 403);
    }

    const token = signPatientSession(user.id, resolved.client.id, user.passwordHash);
    await prisma.patientAccount.update({ where: { id: user.id }, data: { lastActiveClientId: resolved.client.id } }).catch(() => null);
    await logPatientAudit({
      clientId: resolved.client.id,
      accountId: user.id,
      action: 'proxy.switch',
      entityType: 'portal_access',
      entityId: resolved.actor.accessId ?? 'self',
      portalAccessId: resolved.actor.accessId,
      relationship: resolved.actor.relationship,
    });
    await writeAuditLog({
      action: 'PORTAL_SWITCH',
      actorUserId: user.id,
      actorRole: resolved.actor.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
      resourceType: 'portalAccess',
      resourceId: resolved.actor.accessId,
      patientId: resolved.client.id,
      outcome: 'SUCCESS',
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-app', relationship: resolved.actor.relationship, accessLevel: resolved.actor.accessLevel, fromClientId: activeClientId },
    });

    return patientOk({
      token,
      client: { id: resolved.client.id, name: resolved.client.name, email: user.email, phone: resolved.client.phone },
      actingAs: {
        clientId: resolved.client.id,
        clientName: resolved.client.name,
        relationship: resolved.actor.relationship,
        accessLevel: resolved.actor.accessLevel,
        isProxy: resolved.actor.isProxy,
        actorName: resolved.actor.actorName,
      },
      people: await listPortalPeople(user),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return patientFail('VALIDATION_ERROR', 'Choose a person', 400);
    return patientRouteError(err);
  }
}
