import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadCopyForwardNote } from '@/lib/ehr/copyForward';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId')?.trim();
  const noteType = url.searchParams.get('noteType')?.trim() || 'SOAP';
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'clientId required' }, { status: 400 });
  }

  const result = await loadCopyForwardNote({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    clientId,
    noteType,
  });

  return NextResponse.json({ success: true, ...result });
}
