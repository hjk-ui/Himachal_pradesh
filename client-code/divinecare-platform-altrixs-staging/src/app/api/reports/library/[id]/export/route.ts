import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { rawFromSearchParams } from '@/lib/reports/library/params';
import { buildCsv, exportFileName } from '@/lib/reports/library/exportFormat';
import { buildPdf, buildXlsx } from '@/lib/reports/library/exportFiles';
import { REPORT_AUDIT_RESOURCE, canOpenLibrary, getReport, runLibraryReport } from '@/lib/reports/library/server';

export const runtime = 'nodejs';

const FORMATS = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

/**
 * GET /api/reports/library/[id]/export?format=csv|xlsx|pdf&<same parameters as /run>
 * Every row (up to the row cap), with the parameter / scope / as-of header and the definitions.
 * Audit: action EXPORT with report id, parameters, format and row count (no PHI values).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await params;
  const def = getReport(id);
  if (!def) return NextResponse.json({ success: false, error: 'Unknown report' }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const format = (sp.get('format') ?? 'csv').toLowerCase();
  if (!(format in FORMATS)) return NextResponse.json({ success: false, error: 'format must be csv, xlsx or pdf' }, { status: 400 });
  if (!canOpenLibrary(gate.role, gate.capabilities)) {
    await auditPhiAccess({
      gate, req, action: 'EXPORT', resourceType: REPORT_AUDIT_RESOURCE, resourceId: def.id, outcome: 'DENIED',
      metadata: { reportId: def.id, format, reason: 'library_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const r = await runLibraryReport(gate, req, def, rawFromSearchParams(sp), { kind: 'export', format });
    if ('error' in r) return NextResponse.json({ success: false, error: r.error }, { status: r.status });
    const [org, me] = await Promise.all([
      prisma.organization.findUnique({ where: { id: gate.organizationId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, email: true } }),
    ]);
    const header = { organization: org?.name ?? null, runBy: me ? me.name || me.email : null };
    const fmt = format as keyof typeof FORMATS;
    const body: BodyInit =
      fmt === 'csv'
        ? buildCsv(r.result, header)
        : fmt === 'xlsx'
          ? new Uint8Array(await buildXlsx(r.result, header))
          : new Uint8Array(await buildPdf(r.result, header));
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': FORMATS[fmt],
        'Content-Disposition': `attachment; filename="${exportFileName(def.id, r.result, fmt)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[reports/library export]', def.id, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not export the report' }, { status: 500 });
  }
}
