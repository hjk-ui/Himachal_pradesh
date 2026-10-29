import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { auditFiltersForLog, auditWhere, parseAuditFilters } from '@/lib/audit/auditFilters';
import { AUDIT_EXPORT_MAX_ROWS, streamAuditCsv } from '@/lib/audit/auditExport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit-log/export — CSV of the full filtered audit trail (same filters as
 * /api/admin/audit-log), streamed in pages, newest first, capped at AUDIT_EXPORT_MAX_ROWS.
 * The export itself is audited (EXPORT / auditLogExport) before the first byte is sent.
 * Leadership only (requireFullAdmin).
 */
export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const filters = parseAuditFilters(new URL(req.url).searchParams);
  const where = auditWhere(gate.organizationId, filters);

  let matched: number;
  try {
    matched = await prisma.auditLog.count({ where });
  } catch (err) {
    console.error('[admin audit-log export]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not export audit log' }, { status: 500 });
  }
  const rows = Math.min(matched, AUDIT_EXPORT_MAX_ROWS);
  const truncated = matched > AUDIT_EXPORT_MAX_ROWS;

  await auditPhiAccess({
    gate,
    req,
    action: 'EXPORT',
    resourceType: 'auditLogExport',
    patientId: filters.patientId ?? null,
    metadata: {
      format: 'csv',
      matched,
      rows,
      truncated,
      limit: AUDIT_EXPORT_MAX_ROWS,
      filters: auditFiltersForLog(filters),
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(streamAuditCsv({ organizationId: gate.organizationId, where, limit: AUDIT_EXPORT_MAX_ROWS }), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hipaa-audit-log-${stamp}.csv"`,
      'Cache-Control': 'no-store',
      'X-Audit-Matched': String(matched),
      'X-Audit-Rows': String(rows),
      'X-Audit-Truncated': truncated ? '1' : '0',
    },
  });
}
