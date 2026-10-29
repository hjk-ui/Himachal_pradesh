import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { tmsError, tmsGate } from '@/lib/tms/http';
import { listBillingHandoffs } from '@/lib/tms/workflowDb';

export const runtime = 'nodejs';

/** GET — TMS cases waiting on billing verification (client, payer, days waiting; no clinical content). */
export async function GET(req: Request) {
  const g = await tmsGate('billing');
  if (g.ok === false) return g.res;
  try {
    const handoffs = await listBillingHandoffs(g.actor);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'tmsBillingHandoff',
      metadata: { count: handoffs.length, patientIds: handoffs.slice(0, 50).map((h) => h.clientId) },
    });
    return NextResponse.json({ success: true, handoffs });
  } catch (err) {
    return tmsError(err, 'Could not load TMS hand-offs');
  }
}
