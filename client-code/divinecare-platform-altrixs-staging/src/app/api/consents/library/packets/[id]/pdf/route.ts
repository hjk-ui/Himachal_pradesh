import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { packetPdf } from '@/lib/consents/library/store2';
import { chartGate, consentGate, json, pdfResponse } from '../../../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — signed packet PDF (stored copy when intact, else rebuilt from the frozen record). Audited EXPORT. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!id || id.length > 128) return json({ success: false, error: 'Invalid packet' }, 400);
  const row = await prisma.consentPacket.findFirst({ where: { id, organizationId: g.gate.organizationId }, select: { clientId: true } });
  if (!row) return json({ success: false, error: 'Not found' }, 404);
  const denied = await chartGate(g.gate, req, row.clientId, `/api/consents/library/packets/${id}/pdf`, 'consentPacketPdf');
  if (denied) return denied;
  try {
    const pdf = await packetPdf(g.actor, id);
    if (pdf.ok === false) return json({ success: false, error: pdf.error }, pdf.status);
    await auditPhiAccess({ gate: g.gate, req, action: 'EXPORT', resourceType: 'consentPacketPdf', resourceId: id, patientId: pdf.clientId, metadata: { format: 'pdf', source: pdf.source } });
    return pdfResponse(pdf.bytes, pdf.fileName);
  } catch (err) {
    console.error('[consents/library/packets/[id]/pdf]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not build the PDF' }, 500);
  }
}
