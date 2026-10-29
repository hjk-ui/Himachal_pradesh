/**
 * Thin HIPAA-oriented audit helper. No AuditLog Prisma model exists yet —
 * structured console logging keeps a durable trail in CloudWatch / host logs.
 */
export type AuditLogEntry = {
  action: string;
  actorUserId?: string | null;
  organizationId?: string | null;
  resourceType?: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  console.info('[hipaa-audit]', {
    ...entry,
    at: new Date().toISOString(),
  });
}
