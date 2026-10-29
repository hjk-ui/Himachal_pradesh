import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { consentPdf } from '@/lib/consents/library/store2';
import { chartGate, consentGate, json, pdfResponse } from '../../../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — one signed consent / authorization as a PDF (frozen text, responses, signature, revocation). Audited EXPORT. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!id || id.length > 128) return json({ success: false, error: 'Invalid consent' }, 400);
  const row = await prisma.consentForm.findFirst({ where: { id, organizationId: g.gate.organizationId }, select: { clientId: true } });
  if (!row) return json({ success: false, error: 'Not found' }, 404);
  const denied = await chartGate(g.gate, req, row.clientId, `/api/consents/library/forms/${id}/pdf`, 'consentPdf');
  if (denied) return denied;
  try {
    const pdf = await consentPdf(g.actor, id);
    if (pdf.ok === false) return json({ success: false, error: pdf.error }, pdf.status);
    await auditPhiAccess({ gate: g.gate, req, action: 'EXPORT', resourceType: 'consentPdf', resourceId: id, patientId: pdf.clientId, metadata: { format: 'pdf', textIntact: pdf.intact } });
    return pdfResponse(pdf.bytes, pdf.fileName);
  } catch (err) {
    console.error('[consents/library/forms/[id]/pdf]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not build the PDF' }, 500);
  }
}
