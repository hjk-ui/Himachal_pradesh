import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { listNoShowRisk } from '@/lib/appointments/noShowRisk';
import { parseDateOnly } from '@/lib/workflows/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/appointments/no-show-risk?date=YYYY-MM-DD&days=1..14 — rule-based attendance risk score. */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view appointments' },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const date = url.searchParams.get('date') || undefined;
  if (date) {
    try {
      parseDateOnly(date);
    } catch {
      return NextResponse.json({ success: false, error: 'Use date=YYYY-MM-DD' }, { status: 400 });
    }
  }
  const daysParam = url.searchParams.get('days');
  const days = daysParam ? Number(daysParam) : 1;
  if (!Number.isInteger(days) || days < 1 || days > 14) {
    return NextResponse.json({ success: false, error: 'days must be 1 to 14' }, { status: 400 });
  }

  try {
    const result = await listNoShowRisk(
      { id: gate.userId, role: gate.role, organizationId: gate.organizationId },
      { date, days }
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[no-show-risk GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to score appointments' },
      { status: 500 }
    );
  }
}
