import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

/**
 * Retired 2026-10-17. This endpoint took the full card number and CVV in the request body and saved a
 * made-up "tok_demo_" token, so no card was ever tokenized with a processor and raw card data reached
 * the Altrixs server (outside PCI SAQ-A). Card data must stay in Stripe: cards are to be collected with
 * Stripe Elements / a SetupIntent so Altrixs only ever sees brand, last 4 and expiry. The request body is
 * not read, so nothing sent here is parsed, logged or stored.
 */
export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  return NextResponse.json(
    {
      success: false,
      error: 'Card capture in Altrixs is turned off: cards must be saved through Stripe, which is not connected for patient cards yet.',
    },
    { status: 410 }
  );
}
