import { writeAuditLog, type AuditLogEntry, type AuditOutcome } from '@/lib/audit/writeAuditLog';

type HeaderSource = Request | Headers | { headers: Headers } | null | undefined;

function toHeaders(src: HeaderSource): Headers | null {
  if (!src) return null;
  if (src instanceof Headers) return src;
  return src.headers ?? null;
}

/** Client IP (first x-forwarded-for hop, then x-real-ip) and user-agent for audit rows. */
export function auditRequestMeta(src: HeaderSource): { ipAddress: string | null; userAgent: string | null } {
  const h = toHeaders(src);
  if (!h) return { ipAddress: null, userAgent: null };
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip')?.trim() ||
    null;
  return { ipAddress: ip, userAgent: h.get('user-agent') || null };
}

/** Successful gate from requireOrgContext() / requireAdmin() / requireFullAdmin(). */
export type AuditGate = {
  organizationId: string;
  userId: string;
  role?: string | null;
};

/**
 * Log a PHI access (READ / WRITE / EXPORT / LIST ...) for a route that already
 * passed requireOrgContext(). Never throws. Metadata must be ids/enums/counts only.
 */
export async function auditPhiAccess(args: {
  gate: AuditGate;
  req?: HeaderSource;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  outcome?: AuditOutcome;
  metadata?: AuditLogEntry['metadata'];
}): Promise<void> {
  const { gate, req, ...rest } = args;
  await writeAuditLog({
    ...rest,
    actorUserId: gate.userId,
    actorRole: gate.role ?? null,
    organizationId: gate.organizationId,
    ...auditRequestMeta(req),
  });
}
