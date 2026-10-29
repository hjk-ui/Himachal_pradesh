import { NextResponse } from 'next/server';
import { createPortalSession } from '@/lib/stripe/checkout';
import { fail, requireBillingManager } from '../_gate';

export const runtime = 'nodejs';

/** POST /api/stripe/portal — Stripe customer portal (card, invoices, cancel, plan change). */
export async function POST(req: Request) {
  const auth = await requireBillingManager();
  if (!auth.ok) return auth.response;
  try {
    const result = await createPortalSession({ organizationId: auth.gate.organizationId, request: req });
    if (result.ok === false) return fail(result.error, result.status);
    return NextResponse.json({ success: true, url: result.url });
  } catch (err) {
    console.error('[stripe portal]', err instanceof Error ? err.message : err);
    return fail('The Stripe billing portal could not be opened.', 502);
  }
}
