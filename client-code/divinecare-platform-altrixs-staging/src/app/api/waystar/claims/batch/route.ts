import { NextResponse } from 'next/server';
import { requireBillingSession } from '@/lib/billing/requireBillingSession';

export const dynamic = 'force-dynamic';

/**
 * Retired. This route built an 837P from a raw claim payload in the request body, bypassing
 * every pre-send check (signed + co-signed note, DOS and rendering from the note, supervising
 * provider, taxonomy, coding edits, payer mapping, PRP block). Claims are sent from the Claims
 * page (submitClaimsViaWaystarSftp), which runs those checks on the stored claim.
 */
export async function POST() {
  const { denied } = await requireBillingSession();
  if (denied) return denied;
  return NextResponse.json(
    {
      error: 'This endpoint is retired. Send READY claims from Billing > Claims (Waystar), which runs the pre-send checks.',
    },
    { status: 410 }
  );
}
