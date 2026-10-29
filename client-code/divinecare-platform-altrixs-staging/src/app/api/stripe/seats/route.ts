import { NextResponse } from 'next/server';
import { syncSeats } from '@/lib/stripe/checkout';
import { seatSyncEnabled } from '@/lib/stripe/config';
import { fail, requireBillingManager } from '../_gate';

export const runtime = 'nodejs';

/** POST /api/stripe/seats — set the Stripe seat quantity to the current clinician count (prorated). */
export async function POST() {
  const auth = await requireBillingManager();
  if (!auth.ok) return auth.response;
  if (!seatSyncEnabled()) {
    return fail('Automatic seat sync is off on this server (BILLING_SEAT_SYNC is not true).', 409);
  }
  try {
    const result = await syncSeats(auth.gate.organizationId);
    if (result.ok === false) return fail(result.error, result.status);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[stripe seats]', err instanceof Error ? err.message : err);
    return fail('Stripe rejected the seat update. Nothing was changed.', 502);
  }
}
