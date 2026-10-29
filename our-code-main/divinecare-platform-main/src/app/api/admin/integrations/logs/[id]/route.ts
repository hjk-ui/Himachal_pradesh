import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { INTEGRATION_LOGS_FORBIDDEN, redactMetadata } from '@/lib/integrations/callLog';

export const runtime = 'nodejs';

function canView(role: string) {
  return role === 'ADMIN' || role === 'PRACTICE_DIRECTOR';
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canView(gate.role)) {
    return NextResponse.json({ success: false, error: INTEGRATION_LOGS_FORBIDDEN }, { status: 403 });
  }

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const masked = url.searchParams.get('masked') !== 'false';
  const download = url.searchParams.get('download') === '1';

  const row = await prisma.integrationCallLog.findFirst({
    where: { id, organizationId: gate.organizationId },
  });
  if (!row) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const meta = (row.metadata || {}) as Record<string, unknown>;
  const auditAction = download ? 'DOWNLOAD' : 'VIEW';
  // Append-only audit for vendor-support detail access — never throws into the response.
  try {
    await prisma.clinicModuleState.create({
      data: {
        organizationId: gate.organizationId,
        module: `integration-log-audit:${id}:${Date.now()}`,
        data: {
          action: auditAction,
          logId: id,
          userId: gate.userId,
          masked,
          at: new Date().toISOString(),
        },
      },
    });
  } catch {
    /* soft no-op */
  }

  const payload = {
    ...row,
    metadata: masked ? redactMetadata(row.integration, meta) : meta,
    clientId: masked && row.clientId ? '[masked]' : row.clientId,
    audit: auditAction,
  };

  if (download) {
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="integration-log-${id}.json"`,
      },
    });
  }

  return NextResponse.json({ success: true, row: payload });
}
