import { prisma } from '@/lib/db/prisma';
import { writeAuditLog as persistAuditLog } from '@/lib/audit/writeAuditLog';

export type AuditAction = 'READ' | 'WRITE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'AI_ACCESS' | 'EPCS_SIGN' | 'DENIED';
export type ResourceType = 'checkIn' | 'clinicalNote' | 'prescription' | 'message' | 'patient' | 'appointment' | 'crisisEvent' | 'consent' | 'part2Consent' | 'claim' | 'auditLog' | 'user';
export type ActorRole = 'client' | 'therapist' | 'psychiatrist' | 'np' | 'prp_specialist' | 'case_manager' | 'peer_support' | 'practice_director' | 'office_manager' | 'billing_specialist' | 'hr_manager' | 'system';

export interface AuditEvent {
  actorUid: string;
  actorRole: ActorRole;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId: string;
  patientId: string;
  ipAddress: string;
  userAgent: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  details?: Record<string, unknown>;
  /** Optional — resolved from the actor's user record when omitted. */
  organizationId?: string | null;
}

/**
 * Legacy-shaped audit writer. Persists to the AuditLog table through
 * '@/lib/audit/writeAuditLog' (6-year retention, PHI-scrubbed metadata).
 * Never throws.
 */
export async function writeAuditLog(event: AuditEvent): Promise<void> {
  let organizationId = event.organizationId ?? null;
  if (!organizationId && event.actorUid) {
    try {
      const actor = await prisma.user.findUnique({
        where: { id: event.actorUid },
        select: { organizationId: true },
      });
      organizationId = actor?.organizationId ?? null;
    } catch {
      organizationId = null;
    }
  }
  await persistAuditLog({
    action: event.action,
    actorUserId: event.actorUid,
    actorRole: event.actorRole,
    organizationId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    patientId: event.patientId,
    outcome: event.outcome,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    metadata: event.details,
  });
}

export function auditMetaFromHeaders(headers: Headers): Pick<AuditEvent, 'ipAddress' | 'userAgent'> {
  return {
    ipAddress: headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'server',
    userAgent: headers.get('user-agent') || 'server',
  };
}
