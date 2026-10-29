import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { CLINICAL_EVENT_TYPES, isEventBridgeConfigured } from '@/lib/clinical/events';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (
    !canAccessPath(gate.role, '/dashboard/ehr/assessments') &&
    !canAccessPath(gate.role, '/dashboard/alerts')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    types: CLINICAL_EVENT_TYPES,
    demoMode: !isEventBridgeConfigured(),
  });
}
