import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { attestationPdf } from '@/lib/consents/carelon/store';
import { CARELON_FORM_KEY } from '@/lib/consents/carelon/template';
import { canManageCarelon } from '@/lib/consents/carelon/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/consents/carelon/[id]/pdf — the attestation PDF (signed copy stored at completion, or
 * the form prefilled for a wet signature while unsigned). Every download is audited (EXPORT).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  if (!canManageCarelon(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'carelonAttestationPdf', resourceId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  if (!id || id.length > 128) return NextResponse.json({ success: false, error: 'Invalid attestation' }, { status: 400 });
  try {
    const row = await prisma.consentForm.findFirst({ where: { id, organizationId: gate.organizationId, formKey: CARELON_FORM_KEY }, select: { clientId: true } });
    if (!row) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, row.clientId, `/api/consents/carelon/${id}/pdf`);
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'carelonAttestationPdf', resourceId: id, patientId: row.clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const pdf = await attestationPdf({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, id);
    if (pdf.ok === false) return NextResponse.json({ success: false, error: pdf.error }, { status: pdf.status });
    await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'carelonAttestationPdf', resourceId: id, patientId: pdf.clientId, metadata: { format: 'pdf', source: pdf.source, status: pdf.status } });
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.bytes.byteLength),
        'Content-Disposition': `attachment; filename="${pdf.fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[consents/carelon/[id]/pdf GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not build the PDF' }, { status: 500 });
  }
}
