import { v4 as uuidv4 } from 'uuid';

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
}

// Retention: 6 years from event per 45 CFR § 164.530
const RETENTION_YEARS = 6;

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  try {
    const retentionDate = new Date();
    retentionDate.setFullYear(retentionDate.getFullYear() + RETENTION_YEARS);
    const now = new Date().toISOString();

    const record = {
      ...event,
      eventId: uuidv4(),
      timestamp: now,
      createdAt: now,
      retentionDate: retentionDate.toISOString(),
    };

    // Log structured audit record per HIPAA standard
    if (process.env.NODE_ENV !== 'production' || process.env.AUDIT_LOG_STDOUT === 'true') {
      console.log(`[HIPAA-AUDIT] ${record.timestamp} ${record.action} on ${record.resourceType}:${record.resourceId} by ${record.actorRole}:${record.actorUid} -> ${record.outcome}`);
    }
  } catch (err) {
    console.error('[AUDIT-FAIL] Failed to write audit log entry:', err, JSON.stringify(event));
  }
}

export function auditMetaFromHeaders(headers: Headers): Pick<AuditEvent, 'ipAddress' | 'userAgent'> {
  return {
    ipAddress: headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'server',
    userAgent: headers.get('user-agent') || 'server',
  };
}
