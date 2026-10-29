import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { telehealthStats } from '@/lib/telehealth/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const stats = await telehealthStats({
      organizationId: gate.organizationId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, ...stats, stats });
  } catch (err) {
    console.error('[telehealth/stats]', err);
    return NextResponse.json({ success: false, error: 'Failed to load stats' }, { status: 500 });
  }
}
