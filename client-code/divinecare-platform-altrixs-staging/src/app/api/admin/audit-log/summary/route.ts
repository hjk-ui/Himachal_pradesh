import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { PHI_READ_ACTIONS } from '@/lib/audit/auditLabels';
import { MONITORING_TIME_ZONE, startOfLocalDayUtc } from '@/lib/audit/unusualAccessRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

/**
 * GET /api/admin/audit-log/summary — counts for the audit-log page header (no rows, no PHI).
 * ?countOnly=1 returns just the org's total event count (Admin & Compliance stat card).
 * Leadership only (requireFullAdmin).
 */
export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const org = gate.organizationId;
  const countOnly = new URL(req.url).searchParams.get('countOnly') === '1';
  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const since90d = new Date(now.getTime() - 90 * DAY_MS);
  const today = startOfLocalDayUtc(now, MONITORING_TIME_ZONE);

  try {
    if (countOnly) {
      const total = await prisma.auditLog.count({ where: { organizationId: org } });
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'auditLogSummary', metadata: { countOnly: true } });
      return NextResponse.json({ success: true, total });
    }

    const [total, last24h, failed30d, denied30d, users30d, phiReadsToday, exportsToday, actionFacets, resourceFacets] =
      await Promise.all([
        prisma.auditLog.count({ where: { organizationId: org } }),
        prisma.auditLog.count({ where: { organizationId: org, createdAt: { gte: since24h } } }),
        prisma.auditLog.count({ where: { organizationId: org, outcome: 'FAILURE', createdAt: { gte: since30d } } }),
        prisma.auditLog.count({ where: { organizationId: org, outcome: 'DENIED', createdAt: { gte: since30d } } }),
        prisma.auditLog.groupBy({
          by: ['actorUserId'],
          where: { organizationId: org, actorUserId: { not: null }, createdAt: { gte: since30d } },
        }),
        prisma.auditLog.count({
          where: {
            organizationId: org,
            patientId: { not: null },
            action: { in: [...PHI_READ_ACTIONS] },
            createdAt: { gte: today },
          },
        }),
        prisma.auditLog.count({ where: { organizationId: org, action: 'EXPORT', createdAt: { gte: today } } }),
        prisma.auditLog.groupBy({
          by: ['action'],
          where: { organizationId: org, createdAt: { gte: since90d } },
          _count: { _all: true },
        }),
        prisma.auditLog.groupBy({
          by: ['resourceType'],
          where: { organizationId: org, resourceType: { not: null }, createdAt: { gte: since90d } },
          _count: { _all: true },
        }),
      ]);

    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'auditLogSummary', metadata: { countOnly: false } });

    const facet = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, string | null>)[], key: K) =>
      rows
        .filter((r) => r[key])
        .map((r) => ({ value: r[key] as string, count: r._count._all }))
        .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      timeZone: MONITORING_TIME_ZONE,
      todayStartsAt: today.toISOString(),
      total,
      last24h,
      failed30d,
      denied30d,
      uniqueUsers30d: users30d.length,
      phiReadsToday,
      exportsToday,
      facets: {
        actions: facet(actionFacets, 'action'),
        resourceTypes: facet(resourceFacets, 'resourceType'),
      },
    });
  } catch (err) {
    console.error('[admin audit-log summary GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load audit summary' }, { status: 500 });
  }
}
