import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import {
  INTEGRATION_LABELS,
  INTEGRATION_LOGS_FORBIDDEN,
  integrationHealthFromCounts,
} from '@/lib/integrations/callLog';

export const runtime = 'nodejs';

function canView(role: string) {
  return role === 'ADMIN' || role === 'PRACTICE_DIRECTOR';
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canView(gate.role)) {
    return NextResponse.json({ success: false, error: INTEGRATION_LOGS_FORBIDDEN }, { status: 403 });
  }

  const url = new URL(req.url);
  const integration = url.searchParams.get('integration') || undefined;
  const operation = url.searchParams.get('operation') || undefined;
  const status = url.searchParams.get('status') || undefined;
  const mrn = url.searchParams.get('mrn') || undefined;
  const userId = url.searchParams.get('userId') || undefined;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: Record<string, unknown> = { organizationId: gate.organizationId };
  if (integration) where.integration = integration;
  if (operation) where.operation = { contains: operation, mode: 'insensitive' };
  if (status) where.status = status;
  if (userId) where.userId = userId;
  if (mrn) where.mrnMasked = { contains: mrn.slice(-4) };
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const since1h = new Date(Date.now() - 60 * 60_000);
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);

  const [rows, hourRows, dayRows] = await Promise.all([
    prisma.integrationCallLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.integrationCallLog.findMany({
      where: { organizationId: gate.organizationId, createdAt: { gte: since1h } },
      select: { status: true },
    }),
    prisma.integrationCallLog.findMany({
      where: { organizationId: gate.organizationId, createdAt: { gte: since24h } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
  ]);

  const hourOk = hourRows.filter((r) => r.status === 'success').length;
  const hourErr = hourRows.filter((r) => r.status === 'error').length;
  const dayErr = dayRows.filter((r) => r.status === 'error');
  const dayOk = dayRows.filter((r) => r.status === 'success');

  return NextResponse.json({
    success: true,
    labels: INTEGRATION_LABELS,
    health: integrationHealthFromCounts(hourOk, hourErr, hourRows.length),
    stats24h: {
      lastSuccess: dayOk[0]?.createdAt || null,
      errors: dayErr.length,
      errorRate: dayRows.length ? Math.round((dayErr.length / dayRows.length) * 100) : 0,
      lastError: dayErr[0]
        ? { at: dayErr[0].createdAt, error: dayErr[0].error, integration: dayErr[0].integration }
        : null,
    },
    rows,
  });
}
