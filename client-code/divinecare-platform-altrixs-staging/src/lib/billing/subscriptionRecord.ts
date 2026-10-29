/**
 * The organization's subscription record (stored in ClinicModuleState module 'subscription-state').
 *
 * Pure: no Prisma, no Stripe. Reading normalizes older shapes so nothing an older code path wrote
 * can lock a clinic out:
 *  - no record at all          -> grandfathered (full access)
 *  - legacy record (no schema) -> grandfathered, unless it carries a Stripe subscription id
 */
import { TRIAL_DAYS, isTierId, tierFromLegacyPlan, type BillingInterval, type SeatQuantities, type TierId } from './plans';

export const SUBSCRIPTION_MODULE = 'subscription-state';

export type SubscriptionStatus =
  /** Free trial, local (no Stripe yet) or Stripe-managed. */
  | 'trialing'
  | 'active'
  /** Renewal payment failed; inside or past the grace period. */
  | 'past_due'
  /** Stripe gave up retrying. */
  | 'unpaid'
  /** First payment never completed. */
  | 'incomplete'
  | 'canceled'
  /** Internal / launch customer: never billed, never locked. Set by admin script or env. */
  | 'comped'
  /** Existing org from before billing existed: full access until a subscription replaces it. */
  | 'grandfathered';

export type OrgSubscriptionRecord = {
  schema: 2;
  tier: TierId | null;
  status: SubscriptionStatus;
  interval: BillingInterval;
  /** Paid seats on the Stripe subscription (sum of the seat lines). */
  seatsPaid: number | null;
  /** Paid seats by type (pricing model v2). null until Stripe reports seat lines. */
  seatsByType: SeatQuantities | null;
  /**
   * Add-on quantities on the Stripe subscription. `eprescribing` is a legacy (model v1) per-prescriber
   * add-on; in v2 e-prescribing is part of the prescriber seat, so it is only read, never sold.
   */
  addOns: SubscriptionAddOns;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** First time the subscription was seen past_due (start of the grace period). */
  pastDueSince: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Stripe `event.created` of the newest subscription event applied (out-of-order guard). */
  lastStripeEventAt: number | null;
  /** Recently processed Stripe event ids (idempotency; newest last, capped). */
  processedEventIds: string[];
  compedReason: string | null;
  updatedAt: string;
};

export type SubscriptionAddOns = { eprescribing: number; ai_scribe: number; additional_location: number };

export function emptyAddOns(): SubscriptionAddOns {
  return { eprescribing: 0, ai_scribe: 0, additional_location: 0 };
}

export const MAX_PROCESSED_EVENT_IDS = 100;

export function emptyRecord(now: Date = new Date()): OrgSubscriptionRecord {
  return {
    schema: 2,
    tier: null,
    status: 'grandfathered',
    interval: 'month',
    seatsPaid: null,
    seatsByType: null,
    addOns: emptyAddOns(),
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    lastStripeEventAt: null,
    processedEventIds: [],
    compedReason: null,
    updatedAt: now.toISOString(),
  };
}

/** Record for a brand-new self-serve org: local trial on the chosen tier. */
export function newTrialRecord(tier: TierId, now: Date = new Date()): OrgSubscriptionRecord {
  const ends = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return {
    ...emptyRecord(now),
    tier: tier === 'enterprise' ? 'clinic' : tier,
    status: 'trialing',
    trialEndsAt: ends.toISOString(),
  };
}

const STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'incomplete',
  'canceled',
  'comped',
  'grandfathered',
];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map a Stripe subscription status onto ours. */
export function statusFromStripe(status: string | null | undefined): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'incomplete':
      return 'incomplete';
    case 'paused':
      return 'unpaid';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

/**
 * Normalize whatever is stored (or nothing) into a v2 record.
 * Never throws; unknown shapes become grandfathered rather than locked.
 */
export function normalizeRecord(raw: unknown, now: Date = new Date()): OrgSubscriptionRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyRecord(now);
  const r = raw as Record<string, unknown>;

  if (r.schema !== 2) {
    // Legacy shape written before plans.ts existed: { plan, billingCycle, stripe* }
    const base = emptyRecord(now);
    const subId = str(r.stripeSubscriptionId);
    const legacyStatus = str(r.stripeStatus);
    if (subId && legacyStatus && legacyStatus !== 'canceled') {
      return {
        ...base,
        tier: tierFromLegacyPlan(str(r.plan)),
        status: statusFromStripe(legacyStatus === 'cancel_at_period_end' ? 'active' : legacyStatus),
        cancelAtPeriodEnd: legacyStatus === 'cancel_at_period_end',
        interval: r.billingCycle === 'annual' ? 'year' : 'month',
        stripeCustomerId: str(r.stripeCustomerId),
        stripeSubscriptionId: subId,
        updatedAt: str(r.updatedAt) || base.updatedAt,
      };
    }
    return {
      ...base,
      stripeCustomerId: str(r.stripeCustomerId),
      updatedAt: str(r.updatedAt) || base.updatedAt,
    };
  }

  const status = STATUSES.includes(r.status as SubscriptionStatus)
    ? (r.status as SubscriptionStatus)
    : 'grandfathered';
  const addOns = (r.addOns && typeof r.addOns === 'object' ? r.addOns : {}) as Record<string, unknown>;
  const sbt = (r.seatsByType && typeof r.seatsByType === 'object' ? r.seatsByType : null) as Record<string, unknown> | null;
  const ids = Array.isArray(r.processedEventIds)
    ? r.processedEventIds.filter((x): x is string => typeof x === 'string').slice(-MAX_PROCESSED_EVENT_IDS)
    : [];
  return {
    schema: 2,
    tier: isTierId(r.tier) ? r.tier : null,
    status,
    interval: r.interval === 'year' ? 'year' : 'month',
    seatsPaid: num(r.seatsPaid),
    seatsByType: sbt
      ? {
          prescriber: Math.max(0, num(sbt.prescriber) || 0),
          clinician: Math.max(0, num(sbt.clinician) || 0),
          paraprofessional: Math.max(0, num(sbt.paraprofessional) || 0),
        }
      : null,
    addOns: {
      eprescribing: Math.max(0, num(addOns.eprescribing) || 0),
      ai_scribe: Math.max(0, num(addOns.ai_scribe) || 0),
      additional_location: Math.max(0, num(addOns.additional_location) || 0),
    },
    trialEndsAt: str(r.trialEndsAt),
    currentPeriodEnd: str(r.currentPeriodEnd),
    cancelAtPeriodEnd: r.cancelAtPeriodEnd === true,
    pastDueSince: str(r.pastDueSince),
    stripeCustomerId: str(r.stripeCustomerId),
    stripeSubscriptionId: str(r.stripeSubscriptionId),
    lastStripeEventAt: num(r.lastStripeEventAt),
    processedEventIds: ids,
    compedReason: str(r.compedReason),
    updatedAt: str(r.updatedAt) || now.toISOString(),
  };
}
