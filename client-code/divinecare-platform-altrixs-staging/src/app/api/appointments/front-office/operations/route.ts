import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canViewFrontOfficeOperations } from '@/lib/frontOffice/access';
import { loadFrontOfficeOperations } from '@/lib/frontOffice/operations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/appointments/front-office/operations?location=<Location id|all>&days=1..7
 * Office manager operations view: readiness by location, exceptions queue, waitlist fill
 * opportunities, unsigned notes past due (counts by clinician), staff invites pending, open
 * front-desk work. Counts and appointment references only. Audited LIST.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status, headers: NO_STORE });
  if (!canViewFrontOfficeOperations(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'frontOfficeOperations', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: NO_STORE });
  }
  const sp = new URL(req.url).searchParams;
  const location = sp.get('location');
  const days = Number(sp.get('days') ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 7) return NextResponse.json({ success: false, error: 'days must be 1 to 7' }, { status: 400, headers: NO_STORE });
  const locationId = location && location !== 'all' && ID.test(location) ? location : null;
  try {
    const ops = await loadFrontOfficeOperations({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, { locationId, days });
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'frontOfficeOperations',
      metadata: {
        dates: ops.dates,
        location: ops.locationId,
        exceptions: ops.exceptions.map((g) => `${g.key}:${g.count}`),
        appointmentIds: ops.exceptions.flatMap((g) => g.items.map((i) => i.appointmentId)).slice(0, 50),
      },
    });
    return NextResponse.json({ success: true, ops }, { headers: NO_STORE });
  } catch (err) {
    console.error('[front-office operations GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the operations view' }, { status: 500, headers: NO_STORE });
  }
}
