import { NextResponse } from 'next/server';
import { expiredLicenseFlags } from '@/lib/hr/expirations';
import { hrGate, hrServerError, loadHrSettings } from '@/lib/hr/server';
import { isCredentialingRole, isHrLeadershipRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/**
 * GET /api/hr/license-alerts: clinicians with an expired license, for the warning banner on
 * scheduling / billing (HR, leadership, Office Manager, Billing see it; others get an empty list).
 * Scheduling is blocked only when the practice turned on "Block scheduling when license expired".
 */
export async function GET() {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    const canSee = isCredentialingRole(g.ctx.role) || isHrLeadershipRole(g.ctx.role) || g.ctx.role === 'BILLING';
    if (!canSee) return NextResponse.json({ success: true, flags: [], blockScheduling: false });
    const [flags, settings] = await Promise.all([expiredLicenseFlags(g.ctx.organizationId), loadHrSettings(g.ctx.organizationId)]);
    return NextResponse.json({ success: true, flags, blockScheduling: settings.blockSchedulingWhenLicenseExpired });
  } catch (err) {
    return hrServerError('license alerts', err);
  }
}
