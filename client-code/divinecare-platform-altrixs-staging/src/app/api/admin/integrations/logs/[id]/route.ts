import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { decryptLogPayload } from '@/lib/drfirst/persistence';
import { canViewIntegrationLogs, loadIntegrationLogDetail, orgScope, type DetailDeps } from '@/lib/integrations/callLog/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/integrations/logs/[id] — one integration log row with its stored payload
 * (DrFirst only: decrypted request / response XML, credentials removed, patient identifiers
 * masked unless ?masked=0). Audited as INTEGRATION_LOG_VIEW.
 * ?download=1 — the same as a .txt file for the vendor's support team (masked by default).
 * Audited as INTEGRATION_LOG_DOWNLOAD. ADMIN / PRACTICE_DIRECTOR only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { success: false, error: gate.status === 403 ? 'Only Admin / Practice Director can view integration logs' : gate.error },
      { status: gate.status }
    );
  }
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const download = sp.get('download') === '1';
  const masked = sp.get('masked') !== '0';
  const meta = auditRequestMeta(req);

  const deps: DetailDeps = {
    findLog: (logId, organizationId) =>
      prisma.integrationCallLog.findFirst({ where: { AND: [{ id: logId }, orgScope(organizationId)] } }),
    findPayload: async (row, organizationId) => {
      if (!row.sourceId || !/^[0-9a-f-]{36}$/i.test(row.sourceId)) return null;
      const src = await prisma.drFirstApiLog.findFirst({
        where: { id: row.sourceId, OR: [{ organizationId }, { organizationId: null }] },
        select: { payloadKind: true, payloadEncrypted: true },
      });
      if (!src) return { kind: null, text: null };
      return { kind: src.payloadKind, text: decryptLogPayload(src.payloadEncrypted) };
    },
    writeAudit: (entry) => writeAuditLog({ ...entry, ...meta, requestId: req.headers.get('x-request-id') }),
  };

  try {
    // requireFullAdmin also admits a verified admin previewing another role
    const role = canViewIntegrationLogs(gate.role) ? String(gate.role) : 'ADMIN';
    const res = await loadIntegrationLogDetail(deps, { userId: gate.userId, role, organizationId: gate.organizationId }, { id, download, masked });
    if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    if (download) {
      return new NextResponse(res.text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${res.fileName}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const row = res.row;
    const [actor, client] = await Promise.all([
      row.actorUserId ? prisma.user.findFirst({ where: { id: row.actorUserId, organizationId: gate.organizationId }, select: { name: true, email: true } }) : null,
      row.clientId ? prisma.client.findFirst({ where: { id: row.clientId, organizationId: gate.organizationId }, select: { mrn: true } }) : null,
    ]);
    return NextResponse.json(
      {
        success: true,
        data: {
          ...row,
          clientId: undefined,
          actorUserId: undefined,
          actorName: actor ? actor.name || actor.email : row.actorUserId ? 'Staff user' : null,
          patientMrn: client?.mrn ?? null,
          payload: res.payload,
          masked: res.masked,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[integration-logs] detail failed:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the log entry' }, { status: 500 });
  }
}
