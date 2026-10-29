import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { gateDiagnosisRoute } from '@/lib/diagnoses/routeGate';
import { loadDiagnosisHistory } from '@/lib/diagnoses/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/clients/[id]/diagnoses/history — every add / change / rank / review, newest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateDiagnosisRoute(req, id, { write: false, resourceType: 'clientDiagnosisHistory' });
  if (g.ok === false) return g.response;
  const { gate, clientId } = g.ctx;
  try {
    const events = await loadDiagnosisHistory(gate.organizationId, clientId);
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clientDiagnosisHistory', resourceId: clientId, patientId: clientId, metadata: { events: events.length } });
    return NextResponse.json({ success: true, events }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[clients/[id]/diagnoses/history GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load the diagnosis history' }, { status: 500 });
  }
}
