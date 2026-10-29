import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listLockedProgressNoteSnapshots } from '@/lib/notes/workflow-store';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing/claims')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const notes = await listLockedProgressNoteSnapshots({
    organizationId: gate.organizationId,
  });

  return NextResponse.json({ success: true, notes });
}
