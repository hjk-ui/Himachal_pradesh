import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canUseFrontOffice } from '@/lib/frontOffice/access';
import { loadFrontOfficeDay } from '@/lib/frontOffice/loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/appointments/front-office?date=YYYY-MM-DD&days=1..7&location=<Location id|all>[&appointmentId=]
 * Front desk huddle: per-appointment readiness checks (confirmation, eligibility, authorization,
 * demographics, consents, intake, Carelon, copay / balance, telehealth, check-in / check-out, end of
 * day) computed from existing records, plus day summaries. No clinical content. Audited LIST.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status, headers: NO_STORE });
  if (!canUseFrontOffice(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'frontOfficeHuddle', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: NO_STORE });
  }
  const sp = new URL(req.url).searchParams;
  const date = sp.get('date');
  const daysRaw = sp.get('days');
  const location = sp.get('location');
  const appointmentId = sp.get('appointmentId');
  if (date && !YMD.test(date)) return NextResponse.json({ success: false, error: 'Use date=YYYY-MM-DD' }, { status: 400, headers: NO_STORE });
  const days = daysRaw ? Number(daysRaw) : 1;
  if (!Number.isInteger(days) || days < 1 || days > 7) return NextResponse.json({ success: false, error: 'days must be 1 to 7' }, { status: 400, headers: NO_STORE });
  if (appointmentId && !ID.test(appointmentId)) return NextResponse.json({ success: false, error: 'Invalid appointment id' }, { status: 400, headers: NO_STORE });
  const locationId = location && location !== 'all' && ID.test(location) ? location : null;
  try {
    const day = await loadFrontOfficeDay(
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
      { date, days, locationId, appointmentId }
    );
    if (appointmentId && !day.rows.length) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'frontOfficeHuddle', resourceId: appointmentId, outcome: 'DENIED', metadata: { reason: 'appointment_not_found' } }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404, headers: NO_STORE });
    }
    await auditPhiAccess({
      gate,
      req,
      action: appointmentId ? 'READ' : 'LIST',
      resourceType: 'frontOfficeHuddle',
      resourceId: appointmentId ?? null,
      patientId: appointmentId ? day.rows[0]?.clientId ?? null : null,
      metadata: {
        count: day.rows.length,
        dates: day.dates,
        location: day.locationId,
        appointmentIds: day.rows.slice(0, 50).map((r) => r.appointmentId),
        hidden: day.hidden,
      },
    });
    return NextResponse.json({ success: true, day }, { headers: NO_STORE });
  } catch (err) {
    console.error('[front-office GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the front desk huddle' }, { status: 500, headers: NO_STORE });
  }
}
