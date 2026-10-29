import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { INTEGRATIONS } from '@/lib/integrations/callLog/record';
import { buildLogWhere, buildTiles, orgScope, parseLogFilters, type StatusCount } from '@/lib/integrations/callLog/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_ONLY = 'Only Admin / Practice Director can view integration logs';

/**
 * GET /api/admin/integrations/logs — Admin > Integrations > Logs (ADMIN / PRACTICE_DIRECTOR only).
 * Filters: integration, operation, status, from, to (YYYY-MM-DD), mrn, user, page, pageSize.
 * Returns the page (newest first; metadata only, no payloads), per-integration tiles (24 h) and
 * health (last 1 h). Payloads are read one row at a time through /api/admin/integrations/logs/[id]
 * (audited).
 */
export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.status === 403 ? ADMIN_ONLY : gate.error }, { status: gate.status });
  }
  const orgId = gate.organizationId;
  const f = parseLogFilters(new URL(req.url).searchParams);

  try {
    let clientIds: string[] | null = null;
    if (f.mrn) {
      const clients = await prisma.client.findMany({ where: { organizationId: orgId, mrn: f.mrn }, select: { id: true }, take: 20 });
      clientIds = clients.map((c) => c.id);
    }
    const where = buildLogWhere(f, orgId, clientIds);
    const now = Date.now();
    const since24h = new Date(now - 86_400_000);
    const since1h = new Date(now - 3_600_000);
    const scope = orgScope(orgId);

    const [total, rows, g24, g1, lastSuccess, lastErrors, actorRows] = await Promise.all([
      prisma.integrationCallLog.count({ where }),
      prisma.integrationCallLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      prisma.integrationCallLog.groupBy({ by: ['integration', 'status'], where: { AND: [scope, { createdAt: { gte: since24h } }] }, _count: { _all: true } }),
      prisma.integrationCallLog.groupBy({ by: ['integration', 'status'], where: { AND: [scope, { createdAt: { gte: since1h } }] }, _count: { _all: true } }),
      prisma.integrationCallLog.groupBy({ by: ['integration'], where: { AND: [scope, { status: 'success' }] }, _max: { createdAt: true } }),
      prisma.integrationCallLog.findMany({
        where: { AND: [scope, { status: { in: ['error', 'throttled'] } }] },
        orderBy: { createdAt: 'desc' },
        distinct: ['integration'],
        select: { integration: true, createdAt: true, errorMessage: true, errorCode: true },
      }),
      prisma.integrationCallLog.groupBy({
        by: ['actorUserId'],
        where: { AND: [scope, { actorUserId: { not: null } }, { createdAt: { gte: new Date(now - 30 * 86_400_000) } }] },
        _count: { _all: true },
      }),
    ]);

    const toCounts = (g: Array<{ integration: string; status: string; _count: { _all: number } }>): StatusCount[] =>
      g.map((r) => ({ integration: r.integration, status: r.status, count: r._count._all }));
    const tiles = buildTiles({
      counts24h: toCounts(g24),
      counts1h: toCounts(g1),
      lastSuccess: lastSuccess.map((r) => ({ integration: r.integration, at: r._max.createdAt })),
      lastError: lastErrors.map((r) => ({ integration: r.integration, at: r.createdAt, message: r.errorMessage || r.errorCode })),
    });

    // Names for actors and MRNs for patients on this page (org-scoped lookups)
    const userIds = Array.from(new Set([...rows.map((r) => r.actorUserId), ...actorRows.map((a) => a.actorUserId)].filter((v): v is string => Boolean(v))));
    const pageClientIds = Array.from(new Set(rows.map((r) => r.clientId).filter((v): v is string => Boolean(v))));
    const [users, clients] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({ where: { id: { in: userIds }, organizationId: orgId }, select: { id: true, name: true, email: true } })
        : Promise.resolve([] as Array<{ id: string; name: string | null; email: string }>),
      pageClientIds.length
        ? prisma.client.findMany({ where: { id: { in: pageClientIds }, organizationId: orgId }, select: { id: true, mrn: true } })
        : Promise.resolve([] as Array<{ id: string; mrn: string | null }>),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name || u.email]));
    const mrnOf = new Map(clients.map((c) => [c.id, c.mrn]));

    // The list shows patient MRNs: audit the read (filters as flags / ids only)
    await writeAuditLog({
      action: 'INTEGRATION_LOG_LIST',
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: orgId,
      resourceType: 'IntegrationCallLog',
      outcome: 'SUCCESS',
      ...auditRequestMeta(req),
      requestId: req.headers.get('x-request-id'),
      metadata: {
        count: rows.length,
        page: f.page,
        integration: f.integration,
        status: f.status,
        mrnFilter: Boolean(f.mrn),
        userFilter: f.userId,
        patientRows: pageClientIds.length,
      },
    });

    return NextResponse.json(
      {
        success: true,
        total,
        page: f.page,
        pageSize: f.pageSize,
        integrations: INTEGRATIONS,
        tiles,
        actors: actorRows
          .filter((a) => a.actorUserId && userName.has(a.actorUserId))
          .map((a) => ({ id: a.actorUserId as string, name: userName.get(a.actorUserId as string) as string })),
        rows: rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          startedAt: r.startedAt,
          integration: r.integration,
          operation: r.operation,
          direction: r.direction,
          status: r.status,
          httpStatus: r.httpStatus,
          vendorStatus: r.vendorStatus,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          durationMs: r.durationMs,
          correlationId: r.correlationId,
          actorName: r.actorUserId ? userName.get(r.actorUserId) ?? 'Staff user' : null,
          patientMrn: r.clientId ? mrnOf.get(r.clientId) ?? null : null,
          hasPayload: r.sourceTable === 'drfirst_api_logs',
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[integration-logs] list failed:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load integration logs' }, { status: 500 });
  }
}
