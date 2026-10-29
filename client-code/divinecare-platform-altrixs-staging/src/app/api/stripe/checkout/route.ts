import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { createSubscriptionCheckout } from '@/lib/stripe/checkout';
import { fail, requireBillingManager } from '../_gate';

export const runtime = 'nodejs';

const schema = z.object({
  tier: z.enum(['starter', 'professional', 'clinic']),
  interval: z.enum(['month', 'year']),
  /** Clinicians licensed for AI Scribe. Prescriber seats (with e-prescribing) are counted from active staff. */
  aiScribeUsers: z.number().int().min(0).max(2000).default(0),
  includeOnboarding: z.boolean().default(false),
  includeDataMigration: z.boolean().default(false),
});

/** POST /api/stripe/checkout — start Stripe Checkout for a new subscription (quantity = seats). */
export async function POST(req: Request) {
  const auth = await requireBillingManager();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid plan selection', 400);
  try {
    const user = await prisma.user.findUnique({ where: { id: auth.gate.userId }, select: { email: true } });
    const result = await createSubscriptionCheckout({
      organizationId: auth.gate.organizationId,
      ...parsed.data,
      customerEmail: user?.email,
      request: req,
    });
    if (result.ok === false) return fail(result.error, result.status);
    return NextResponse.json({ success: true, url: result.url });
  } catch (err) {
    console.error('[stripe checkout]', err instanceof Error ? err.message : err);
    return fail('Stripe Checkout could not be started. No charge was made.', 502);
  }
}
