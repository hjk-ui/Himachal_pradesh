import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { accessBasisFor } from '@/lib/auth/medicalDirector';

/**
 * HIPAA audit trail (45 CFR 164.312(b)). Every entry is inserted into the
 * append-only `AuditLog` table (UPDATE/DELETE blocked by a DB trigger) and
 * mirrored as one structured console line for CloudWatch.
 *
 * Never throws into the caller. Metadata is scrubbed of obvious PHI keys and
 * long free text — pass ids and enums only.
 */
export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export type AuditLogEntry = {
  action: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  organizationId?: string | null;
  resourceType?: string;
  resourceId?: string | null;
  /** Client id when the event touches a patient record (falls back to metadata.patientId / metadata.clientId) */
  patientId?: string | null;
  outcome?: AuditOutcome;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** x-request-id from src/proxy.ts (req.headers.get('x-request-id')); stored in metadata.requestId */
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Retention: 6 years from the event (45 CFR 164.316(b)(2), 164.530(j)). */
export const AUDIT_RETENTION_YEARS = 6;

/** Exact keys (lowercased) always dropped from metadata. */
const PHI_KEYS = new Set([
  'name',
  'dob',
  'dateofbirth',
  'birthdate',
  'ssn',
  'address',
  'phone',
  'email',
  'note',
  'notes',
  'text',
  'transcript',
  'content',
  'body',
  'message',
  'password',
  'search',
  'q',
  'query',
]);
/** Key fragments (lowercased) that indicate PHI, e.g. clientName, patientEmail, addressLine1. */
const PHI_FRAGMENTS = ['name', 'email', 'phone', 'address', 'dateofbirth', 'ssn', 'transcript', 'password'];
/** Non-PHI keys that would otherwise match a fragment. */
const SAFE_KEYS = new Set(['filename', 'jobname', 'transcriptionjobname']);

function isPhiKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SAFE_KEYS.has(k)) return false;
  if (PHI_KEYS.has(k)) return true;
  return PHI_FRAGMENTS.some((f) => k.includes(f));
}

const MAX_STRING = 200;
const MAX_DEPTH = 4;

/** Recursively drop PHI keys and truncate long strings (free text is the usual PHI leak). */
export function scrubAuditMetadata(value: unknown, depth = 0): unknown {
  if (value == null) return null;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubAuditMetadata(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || isPhiKey(k)) continue;
      out[k] = scrubAuditMetadata(v, depth + 1);
    }
    return out;
  }
  return null;
}

function cleanId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t === 'none' || t === 'unknown') return null;
  return t.slice(0, 191);
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim().slice(0, max);
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const at = new Date();
    const retainUntil = new Date(at);
    retainUntil.setFullYear(retainUntil.getFullYear() + AUDIT_RETENTION_YEARS);

    const meta = entry.metadata ?? {};
    const scrubbed = scrubAuditMetadata(meta) as Record<string, unknown>;
    const requestId = cleanStr(entry.requestId, 128);
    if (requestId) scrubbed.requestId = requestId;
    // Why the actor could open the record: a verified Medical Director's org-wide scope is recorded
    // on every row they write (chart reads, lists, exports, denials), without touching call sites.
    if (entry.actorUserId && scrubbed.accessBasis === undefined) {
      const basis = accessBasisFor({ userId: entry.actorUserId, role: entry.actorRole, organizationId: entry.organizationId ?? undefined });
      if (basis) scrubbed.accessBasis = basis;
    }

    const row = {
      organizationId: cleanId(entry.organizationId),
      actorUserId: cleanId(entry.actorUserId),
      actorRole: cleanStr(entry.actorRole, 64),
      action: String(entry.action).slice(0, 128),
      resourceType: cleanStr(entry.resourceType, 128),
      resourceId: cleanId(entry.resourceId),
      patientId: cleanId(entry.patientId) ?? cleanId(meta.patientId) ?? cleanId(meta.clientId),
      outcome: entry.outcome ?? 'SUCCESS',
      ipAddress: cleanStr(entry.ipAddress, 64),
      userAgent: cleanStr(entry.userAgent, 512),
    };

    // Single structured line for CloudWatch — ids/enums only
    console.info(
      '[hipaa-audit]',
      JSON.stringify({
        at: at.toISOString(),
        action: row.action,
        outcome: row.outcome,
        org: row.organizationId,
        actor: row.actorUserId,
        role: row.actorRole,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        patientId: row.patientId,
        ip: row.ipAddress,
        ...(requestId ? { requestId } : {}),
      })
    );

    await prisma.auditLog.create({
      data: {
        ...row,
        metadata: Object.keys(scrubbed).length ? (scrubbed as Prisma.InputJsonValue) : Prisma.DbNull,
        createdAt: at,
        retainUntil,
      },
    });
  } catch (err) {
    // ids only — Prisma error messages can echo query args, so log name/code only
    const code = (err as { code?: unknown } | null)?.code;
    console.error(
      '[hipaa-audit] persist failed',
      JSON.stringify({
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        actorUserId: entry.actorUserId ?? null,
        error: err instanceof Error ? err.name : 'unknown',
        code: typeof code === 'string' ? code : null,
      })
    );
  }
}
