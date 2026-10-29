import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { countOrgLocations, countOrgSeats, getOrgAccess, loadSubscriptionRecord } from '@/lib/billing/entitlementsServer';
import { pricingApproved, SELF_SERVE_TIERS, type BillingInterval } from '@/lib/billing/plans';
import { getSubscriptionUsage } from '@/lib/subscription/plans';
import {
  checkoutReadyFor,
  seatSyncEnabled,
  stripeConfigured,
  stripeEnvReport,
  stripeKeyMode,
  stripeWebhookSecret,
} from '@/lib/stripe/config';

export const runtime = 'nodejs';

/**
 * GET /api/subscription — current plan, access mode / banner, seats used vs paid, Stripe readiness.
 * Every signed-in staff member may read the banner fields (so the dashboard can show dunning
 * notices); seat detail, Stripe config and usage are for leadership only.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const access = await getOrgAccess(gate.organizationId);
  const canManage = canAccessPath(gate.role, '/dashboard/subscription');
  if (!canManage) {
    return NextResponse.json({
      success: true,
      canManage: false,
      access: { status: access.status, mode: access.mode, canWrite: access.canWrite, banner: access.banner },
    });
  }

  const [{ record }, usage] = await Promise.all([
    loadSubscriptionRecord(gate.organizationId),
    getSubscriptionUsage(gate.organizationId),
  ]);
  const [seats, locations] = await Promise.all([
    countOrgSeats(gate.organizationId),
    countOrgLocations(gate.organizationId),
  ]);
  const ready: Record<string, Record<BillingInterval, boolean>> = {};
  for (const tier of SELF_SERVE_TIERS) {
    ready[tier] = { month: checkoutReadyFor(tier, 'month'), year: checkoutReadyFor(tier, 'year') };
  }

  return NextResponse.json(
    {
      success: true,
      canManage: true,
      access,
      subscription: {
        tier: record.tier,
        status: access.status,
        interval: record.interval,
        seatsPaid: record.seatsPaid,
        seatsByType: record.seatsByType,
        addOns: record.addOns,
        trialEndsAt: record.trialEndsAt,
        currentPeriodEnd: record.currentPeriodEnd,
        cancelAtPeriodEnd: record.cancelAtPeriodEnd,
        hasStripeCustomer: Boolean(record.stripeCustomerId),
        hasStripeSubscription: Boolean(record.stripeSubscriptionId),
        compedReason: record.compedReason,
      },
      seats: { ...seats, billable: seats.seats },
      locations,
      usage,
      pricingApproved: pricingApproved(),
      stripe: {
        configured: stripeConfigured(),
        mode: stripeKeyMode(),
        webhookConfigured: Boolean(stripeWebhookSecret()),
        seatSync: seatSyncEnabled(),
        checkoutReady: ready,
        env: stripeEnvReport(),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
