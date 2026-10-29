import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { auditFiltersForLog, auditWhere, parseAuditFilters } from '@/lib/audit/auditFilters';
import { clientLabelMap, staffNameMap } from '@/lib/audit/clientLabels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 200;

/**
 * GET /api/admin/audit-log — org-scoped HIPAA audit trail, newest first.
 * Filters: patientId, actorUserId, action (comma list), outcome (comma list), resourceType,
 * from, to (ISO or YYYY-MM-DD). Paging: page (1-based), pageSize (<=200).
 * Leadership only (requireFullAdmin: ADMIN / PRACTICE_DIRECTOR).
 */
export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const url = new URL(req.url);
  const filters = parseAuditFilters(url.searchParams);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50)
  );
  const where = auditWhere(gate.organizationId, filters);

  try {
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          actorUserId: true,
          actorRole: true,
          action: true,
          resourceType: true,
          resourceId: true,
          patientId: true,
          outcome: true,
          ipAddress: true,
          metadata: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // AuditLog has no FK relations (append-only table) — resolve names separately, org-scoped
    const [nameById, patients] = await Promise.all([
      staffNameMap(gate.organizationId, rows.map((r) => r.actorUserId)),
      clientLabelMap({
        organizationId: gate.organizationId,
        userId: gate.userId,
        role: gate.role,
        clientIds: rows.map((r) => r.patientId),
      }),
    ]);

    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'auditLog',
      patientId: filters.patientId ?? null,
      metadata: { page, pageSize, returned: rows.length, filters: auditFiltersForLog(filters) },
    });

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      entries: rows.map((r) => {
        const p = r.patientId ? patients.get(r.patientId) : undefined;
        return {
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          actorUserId: r.actorUserId,
          actorName: r.actorUserId ? nameById.get(r.actorUserId) ?? null : null,
          actorRole: r.actorRole,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          patientId: r.patientId,
          patientLabel: p?.label ?? null,
          patientMrn: p?.mrn ?? null,
          patientProtected: p?.protected ?? false,
          outcome: r.outcome,
          ipAddress: r.ipAddress,
          metadata: r.metadata,
        };
      }),
    });
  } catch (err) {
    console.error('[admin audit-log GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load audit log' }, { status: 500 });
  }
}
