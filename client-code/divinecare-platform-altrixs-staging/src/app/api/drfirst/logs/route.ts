import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { decryptLogPayload } from '@/lib/drfirst/persistence';
import { requireDrFirstCaller } from '../_lib/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drfirst/logs — the DrFirst call / SSO log (GM6 / GM12 / GM13) for production support.
 * ADMIN only. Without `id`: the latest rows (metadata only: command, outcome, error, timing).
 * With `id`: that row's stored payload, decrypted (it can contain PHI; every read is audited).
 * Rows are the practice's (one vendor account per practice: GM5) and are purged after 90 days.
 */
export async function GET(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true });
  if (g.response) return g.response;
  const c = g.caller;
  if (!c.isAdmin) return NextResponse.json({ error: 'Only administrators can read the DrFirst log.' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const scope = { OR: [{ organizationId: c.organizationId }, { organizationId: null }] };
  const id = sp.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const row = await prisma.drFirstApiLog.findFirst({ where: { id, ...scope } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const payload = decryptLogPayload(row.payloadEncrypted);
    await writeAuditLog({
      action: 'DRFIRST_LOG_PAYLOAD_READ',
      actorUserId: c.userId,
      actorRole: c.role,
      organizationId: c.organizationId,
      resourceType: 'prescription',
      resourceId: row.id,
      outcome: 'SUCCESS',
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      metadata: { kind: row.kind, command: row.command, payloadKind: row.payloadKind, decrypted: payload !== null },
    });
    const meta: Record<string, unknown> = { ...row };
    delete meta.payloadEncrypted;
    return NextResponse.json({ success: true, data: { ...meta, payload } }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const take = Math.min(Math.max(Number.parseInt(sp.get('limit') || '100', 10) || 100, 1), 500);
  const kind = sp.get('kind');
  const rows = await prisma.drFirstApiLog.findMany({
    where: { ...scope, ...(kind === 'api' || kind === 'sso' ? { kind } : {}), ...(sp.get('errors') === '1' ? { ok: false } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, createdAt: true, kind: true, command: true, servlet: true, rcopiaUsername: true, ok: true,
      httpStatus: true, status: true, errorCode: true, errorText: true, durationMs: true, payloadKind: true,
    },
  });
  return NextResponse.json({ success: true, data: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
