import type { Prisma } from '@prisma/client';
import { AUDIT_OUTCOMES } from '@/lib/audit/auditLabels';

/**
 * Filters shared by the audit-log list, summary and CSV export so every view of the
 * trail selects exactly the same rows. Always org-scoped.
 */
export type AuditFilters = {
  patientId?: string;
  actorUserId?: string;
  /** One or more actions (comma separated in the query string) */
  actions?: string[];
  /** One or more of SUCCESS / FAILURE / DENIED */
  outcomes?: string[];
  resourceType?: string;
  from?: Date;
  to?: Date;
};

function param(params: URLSearchParams, key: string): string | undefined {
  const v = params.get(key)?.trim();
  return v ? v.slice(0, 191) : undefined;
}

function list(v: string | undefined, max = 20): string[] | undefined {
  if (!v) return undefined;
  const items = [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, max);
  return items.length ? items : undefined;
}

export function parseAuditDate(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  // Bare YYYY-MM-DD "to" dates are inclusive of the whole day
  const d = new Date(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const outcomes = list(param(params, 'outcome'))
    ?.map((o) => o.toUpperCase())
    .filter((o) => (AUDIT_OUTCOMES as readonly string[]).includes(o));
  return {
    patientId: param(params, 'patientId'),
    actorUserId: param(params, 'actorUserId'),
    actions: list(param(params, 'action'))?.map((a) => a.toUpperCase()),
    outcomes: outcomes?.length ? outcomes : undefined,
    resourceType: param(params, 'resourceType'),
    from: parseAuditDate(param(params, 'from')),
    to: parseAuditDate(param(params, 'to'), true),
  };
}

export function auditWhere(organizationId: string, f: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    organizationId,
    ...(f.patientId ? { patientId: f.patientId } : {}),
    ...(f.actorUserId ? { actorUserId: f.actorUserId } : {}),
    ...(f.actions?.length ? { action: f.actions.length === 1 ? f.actions[0] : { in: f.actions } } : {}),
    ...(f.outcomes?.length ? { outcome: f.outcomes.length === 1 ? f.outcomes[0] : { in: f.outcomes } } : {}),
    ...(f.resourceType ? { resourceType: f.resourceType } : {}),
    ...(f.from || f.to
      ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
  };
}

/** Filter values as they go into the audit row of the viewer (ids / enums / dates only). */
export function auditFiltersForLog(f: AuditFilters) {
  return {
    patientId: f.patientId ?? null,
    actorUserId: f.actorUserId ?? null,
    actions: f.actions ?? null,
    outcomes: f.outcomes ?? null,
    resourceType: f.resourceType ?? null,
    from: f.from?.toISOString() ?? null,
    to: f.to?.toISOString() ?? null,
  };
}
