import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  getSubscriptionState,
  getSubscriptionUsage,
  saveSubscriptionState,
  SUBSCRIPTION_PLANS,
} from '@/lib/subscription/plans';
import {
  stripeCheckoutReady,
  stripeConfigured,
  stripeKeyMode,
  stripePriceIdsConfigured,
} from '@/lib/stripe/config';
import {
  cancelStripeSubscriptionAtPeriodEnd,
  createBillingPortalUrl,
  createSubscriptionCheckoutUrl,
} from '@/lib/stripe/checkout';

export const runtime = 'nodejs';

const updateSchema = z.object({
  plan: z.enum(['free', 'solo', 'professional', 'practice', 'enterprise', 'growth']),
  billingCycle: z.enum(['monthly', 'annual']),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/subscription')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const [state, usage] = await Promise.all([
    getSubscriptionState(gate.organizationId),
    getSubscriptionUsage(gate.organizationId),
  ]);

  return NextResponse.json({
    success: true,
    state,
    usage,
    plans: SUBSCRIPTION_PLANS,
    stripe: {
      portalConfigured: stripeConfigured(),
      priceIdsConfigured: stripePriceIdsConfigured(),
      checkoutReady: stripeCheckoutReady(),
      mode: stripeKeyMode(),
      hasCustomer: Boolean(state.stripeCustomerId),
    },
  });
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/subscription')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = updateSchema.parse(await req.json());
    const plan = body.plan === 'growth' ? 'professional' : body.plan;
    const payload = { plan, billingCycle: 'monthly' as const };

    if (plan === 'free') {
      const state = await cancelStripeSubscriptionAtPeriodEnd(gate.organizationId);
      return NextResponse.json({ success: true, state, portalUrl: null, checkoutUrl: null });
    }

    if (!stripeCheckoutReady()) {
      const state = await saveSubscriptionState(gate.organizationId, payload);
      return NextResponse.json({
        success: true,
        state,
        portalUrl: null,
        checkoutUrl: null,
        warning:
          'Stripe Checkout is not fully configured (secret key + price IDs). Plan was saved locally for demo review only.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: gate.userId },
      select: { email: true },
    });

    const checkout = await createSubscriptionCheckoutUrl({
      organizationId: gate.organizationId,
      plan,
      billingCycle: body.billingCycle,
      customerEmail: user?.email,
      request: req,
    });
    if ('error' in checkout) {
      return NextResponse.json({ success: false, error: checkout.error }, { status: checkout.status });
    }

    const current = await getSubscriptionState(gate.organizationId);
    return NextResponse.json({
      success: true,
      state: current,
      checkoutUrl: checkout.checkoutUrl,
      portalUrl: null,
    });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Invalid subscription selection.'
        : err instanceof Error
          ? err.message
          : 'Could not update subscription.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/subscription')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const portal = await createBillingPortalUrl({
    organizationId: gate.organizationId,
    request: req,
  });
  if ('error' in portal) {
    return NextResponse.json({ success: false, error: portal.error }, { status: portal.status });
  }
  return NextResponse.json({ success: true, portalUrl: portal.portalUrl });
}
