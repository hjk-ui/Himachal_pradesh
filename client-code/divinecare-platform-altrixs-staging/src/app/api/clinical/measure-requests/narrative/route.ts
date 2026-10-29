import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { measureError, measureGate } from '@/lib/measures/http';
import { noteNarrative } from '@/lib/measures/staffViews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?clientId=&noteId= : completed measures since the client's last note, as one line for the note */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId');
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const g = await measureGate(clientId);
  if (g.ok === false) return g.response;
  try {
    const n = await noteNarrative(g.scope, clientId, params.get('noteId'));
    await auditPhiAccess({ gate: g.scope, req, action: 'READ', resourceType: 'assessment', patientId: clientId, metadata: { feature: 'note-measures-narrative', records: n.recordIds.length } });
    return NextResponse.json({ success: true, ...n });
  } catch (err) {
    return measureError(err, 'Could not load measures for the note');
  }
}
