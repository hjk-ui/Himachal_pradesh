import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAdministerCharges } from '@/lib/patientPayments/access';
import { listPatientCharges } from '@/lib/patientPayments/server';
import { autopayGate, scopeWhere } from '../_gate';

export const runtime = 'nodejs';

/** GET ?view=attention|open|all&clientId= : automatic card charges (pending, failed, held, paid, refunded). */
export async function GET(req: Request) {
  const g = await autopayGate('read');
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  const url = new URL(req.url);
  const v = url.searchParams.get('view');
  const view = v === 'attention' || v === 'all' ? v : 'open';
  const clientId = url.searchParams.get('clientId')?.trim().slice(0, 128) || null;
  try {
    const data = await listPatientCharges(g.gate.organizationId, scopeWhere(g.gate), { view, clientId });
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'PatientCharge', patientId: clientId, metadata: { view, count: data.charges.length } });
    return NextResponse.json({ success: true, ...data, canMutate: canAdministerCharges(g.gate.role) });
  } catch (err) {
    console.error('[autopay charges GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load charges' }, { status: 500 });
  }
}
