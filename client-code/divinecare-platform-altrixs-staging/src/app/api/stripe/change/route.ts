import { NextResponse } from 'next/server';
import { z } from 'zod';
import { changeSubscription } from '@/lib/stripe/checkout';
import { fail, requireBillingManager } from '../_gate';

export const runtime = 'nodejs';

const schema = z.object({
  tier: z.enum(['starter', 'professional', 'clinic']),
  interval: z.enum(['month', 'year']),
  /** Clinicians licensed for AI Scribe. Prescriber seats (with e-prescribing) are counted from active staff. */
  aiScribeUsers: z.number().int().min(0).max(2000).default(0),
});

/** POST /api/stripe/change — upgrade / downgrade / switch interval / add-ons, prorated by Stripe. */
export async function POST(req: Request) {
  const auth = await requireBillingManager();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid plan selection', 400);
  try {
    const result = await changeSubscription({ organizationId: auth.gate.organizationId, ...parsed.data });
    if (result.ok === false) return fail(result.error, result.status);
    return NextResponse.json({
      success: true,
      message: 'Change sent to Stripe. This page updates when Stripe confirms it (usually within a minute).',
    });
  } catch (err) {
    console.error('[stripe change]', err instanceof Error ? err.message : err);
    return fail('Stripe rejected the change. Nothing was changed.', 502);
  }
}
