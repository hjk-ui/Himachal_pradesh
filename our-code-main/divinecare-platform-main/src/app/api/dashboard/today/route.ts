import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { loadToday } from '@/lib/today/loadToday';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** GET /api/dashboard/today — viewer's Today cockpit (visits, notes done, inbox). */
export async function GET() {
  const gate = await requireOrgContext();
  if (gate.ok !== true) {
    return NextResponse.json(
      { success: false, error: gate.error },
      { status: gate.status, headers: NO_STORE }
    );
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view appointments' },
      { status: 403, headers: NO_STORE }
    );
  }

  try {
    const today = await loadToday({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
    });
    return NextResponse.json(today, { headers: NO_STORE });
  } catch (err) {
    console.error('[dashboard/today GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load Today' },
      { status: 500, headers: NO_STORE }
    );
  }
}
