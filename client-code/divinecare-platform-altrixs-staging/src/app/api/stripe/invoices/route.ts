import { NextResponse } from 'next/server';
import { listBilling } from '@/lib/stripe/checkout';
import { stripeConfigured } from '@/lib/stripe/config';
import { fail, requireBillingManager } from '../_gate';

export const runtime = 'nodejs';

/** GET /api/stripe/invoices — billing history and next invoice from Stripe. */
export async function GET() {
  const auth = await requireBillingManager();
  if (!auth.ok) return auth.response;
  if (!stripeConfigured()) {
    return NextResponse.json({ success: true, configured: false, invoices: [], upcoming: null });
  }
  try {
    const result = await listBilling(auth.gate.organizationId);
    if (result.ok === false) return fail(result.error, result.status);
    return NextResponse.json(
      { success: true, configured: true, invoices: result.invoices, upcoming: result.upcoming },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[stripe invoices]', err instanceof Error ? err.message : err);
    return fail('Could not load invoices from Stripe.', 502);
  }
}
