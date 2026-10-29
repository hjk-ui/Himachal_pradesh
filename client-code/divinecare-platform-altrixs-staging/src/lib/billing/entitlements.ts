/**
 * Entitlements: what an organization may use and whether it may write.
 *
 * Pure (no Prisma / Stripe) so it can be unit-tested and used by client components.
 * Server code loads the record with getOrgAccess() in entitlementsServer.ts.
 *
 * Safety rules (owner requirement — never lock out the launch customer):
 *  - MD Behavioral Health (LAUNCH_CUSTOMER_ORG_IDS) is always comped: full access, every feature.
 *  - Orgs listed in BILLING_COMPED_ORG_IDS, or whose record says status 'comped', likewise.
 *  - Orgs with no record (or a pre-billing legacy record) are grandfathered: full access.
 *  - Only an explicit v2 record created by self-serve signup or Stripe can restrict an org.
 */
import {
  ADD_ONS,
  PAST_DUE_GRACE_DAYS,
  READ_ONLY_RETENTION_DAYS,
  TIERS,
  featureById,
  type AddOnId,
  type FeatureId,
  type TierId,
} from './plans';
import type { OrgSubscriptionRecord, SubscriptionAddOns, SubscriptionStatus } from './subscriptionRecord';

/** MD Behavioral Health — launch customer. Never billed by Altrixs software, never locked. */
export const LAUNCH_CUSTOMER_ORG_IDS: readonly string[] = ['cmva1hmq6000090ohpo38undp'];

/** Add-ons that a local (no card) trial gets so clinics can evaluate them. */
export const TRIAL_INCLUDED_ADD_ONS: AddOnId[] = ['ai_scribe'];

const DAY_MS = 24 * 60 * 60 * 1000;

export function compedOrgIds(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = (env.BILLING_COMPED_ORG_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...LAUNCH_CUSTOMER_ORG_IDS, ...extra]);
}

export type AccessMode = 'full' | 'grace' | 'read_only';

export type BillingBanner = {
  tone: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
};

export type OrgAccess = {
  organizationId: string;
  status: SubscriptionStatus;
  tier: TierId | null;
  /** Comped or grandfathered: every feature, never read-only. */
  unlimited: boolean;
  mode: AccessMode;
  canWrite: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  graceEndsAt: string | null;
  readOnlySince: string | null;
  addOns: SubscriptionAddOns;
  banner: BillingBanner | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export function resolveAccess(
  organizationId: string,
  record: OrgSubscriptionRecord,
  opts: { now?: Date; comped?: Set<string> } = {}
): OrgAccess {
  const now = opts.now ?? new Date();
  const comped = opts.comped ?? compedOrgIds();
  const base: OrgAccess = {
    organizationId,
    status: record.status,
    tier: record.tier,
    unlimited: false,
    mode: 'full',
    canWrite: true,
    trialEndsAt: record.trialEndsAt,
    trialDaysLeft: null,
    graceEndsAt: null,
    readOnlySince: null,
    addOns: { ...record.addOns },
    banner: null,
  };

  if (comped.has(organizationId) || record.status === 'comped') {
    return { ...base, status: 'comped', unlimited: true };
  }
  if (record.status === 'grandfathered') {
    return { ...base, unlimited: true };
  }

  const readOnly = (since: string | null, banner: BillingBanner): OrgAccess => ({
    ...base,
    mode: 'read_only',
    canWrite: false,
    readOnlySince: since,
    banner,
  });

  switch (record.status) {
    case 'trialing': {
      const end = record.trialEndsAt ? new Date(record.trialEndsAt) : null;
      const valid = end && !Number.isNaN(end.getTime());
      const msLeft = valid ? end!.getTime() - now.getTime() : Infinity;
      const daysLeft = Number.isFinite(msLeft) ? Math.max(0, Math.ceil(msLeft / DAY_MS)) : null;
      const stripeManaged = Boolean(record.stripeSubscriptionId);
      if (msLeft > 0 || stripeManaged) {
        // Stripe-managed trials convert (or fail) on Stripe's side; we follow its webhook.
        const banner: BillingBanner | null =
          daysLeft !== null && daysLeft <= 7
            ? stripeManaged
              ? {
                  tone: 'info',
                  title: `Trial ends ${fmtDate(record.trialEndsAt)}`,
                  message: 'Your card on file will be charged when the trial ends. Manage billing any time.',
                }
              : {
                  tone: 'warning',
                  title: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial`,
                  message:
                    'Choose a plan before the trial ends to keep adding and editing records. Nothing is deleted when a trial ends.',
                }
            : null;
        return { ...base, trialDaysLeft: daysLeft, banner };
      }
      return readOnly(record.trialEndsAt, {
        tone: 'danger',
        title: 'Your free trial has ended',
        message:
          'The account is read-only: you can view and export records but not add or change them. Choose a plan to restore full access.',
      });
    }
    case 'active': {
      const banner: BillingBanner | null = record.cancelAtPeriodEnd
        ? {
            tone: 'info',
            title: `Subscription ends ${fmtDate(record.currentPeriodEnd)}`,
            message: `After that date the account becomes read-only. Records stay available to export for ${READ_ONLY_RETENTION_DAYS} days. You can resume from Plan & Subscription.`,
          }
        : null;
      return { ...base, banner };
    }
    case 'past_due': {
      const since = record.pastDueSince || record.updatedAt;
      const graceEndsAt = addDays(since, PAST_DUE_GRACE_DAYS);
      if (now.getTime() < new Date(graceEndsAt).getTime()) {
        return {
          ...base,
          mode: 'grace',
          graceEndsAt,
          banner: {
            tone: 'warning',
            title: 'Payment failed — please update your card',
            message: `Full access continues until ${fmtDate(graceEndsAt)}. After that the account becomes read-only until the balance is paid.`,
          },
        };
      }
      return {
        ...readOnly(graceEndsAt, {
          tone: 'danger',
          title: 'Account is read-only: payment overdue',
          message: 'Update the payment method in Plan & Subscription to restore full access. No records have been deleted.',
        }),
        graceEndsAt,
      };
    }
    case 'unpaid':
    case 'incomplete':
      return readOnly(record.updatedAt, {
        tone: 'danger',
        title: record.status === 'incomplete' ? 'Payment not completed' : 'Account is read-only: payment overdue',
        message: 'Complete payment in Plan & Subscription to restore full access. No records have been deleted.',
      });
    case 'canceled':
    default:
      return readOnly(record.currentPeriodEnd || record.updatedAt, {
        tone: 'danger',
        title: 'Subscription ended',
        message: `The account is read-only. Records stay available to view and export for at least ${READ_ONLY_RETENTION_DAYS} days. Choose a plan to restore full access.`,
      });
  }
}

/** Does this org have the feature (independent of read-only mode)? */
export function hasFeature(access: OrgAccess, feature: FeatureId): boolean {
  if (access.unlimited) return true;
  if (!access.tier) return false;
  const def = featureById(feature);
  const availability = def.tiers[access.tier];
  if (availability === 'included') return true;
  if (availability === 'none') return false;
  // add-on
  const addOn = def.addOn;
  if (!addOn) return false;
  if (access.status === 'trialing' && TRIAL_INCLUDED_ADD_ONS.includes(addOn)) return true;
  if (addOn === 'ai_scribe') return access.addOns.ai_scribe > 0;
  if (addOn === 'additional_location') return access.addOns.additional_location > 0;
  return false;
}

/** Human message for a denied feature, naming the cheapest way to get it. */
export function featureDeniedMessage(access: OrgAccess, feature: FeatureId): string {
  const def = featureById(feature);
  if (access.tier && def.tiers[access.tier] === 'addon' && def.addOn) {
    return `${def.name} is an add-on on the ${TIERS[access.tier].name} plan. Add ${ADD_ONS[def.addOn].name} in Plan & Subscription.`;
  }
  const firstTier = (['starter', 'professional', 'clinic', 'enterprise'] as TierId[]).find(
    (t) => def.tiers[t] === 'included'
  );
  return firstTier
    ? `${def.name} is included from the ${TIERS[firstTier].name} plan. Upgrade in Plan & Subscription.`
    : `${def.name} is not included in your plan.`;
}

export const READ_ONLY_MESSAGE =
  'This account is read-only because of its subscription status. View and export still work. Go to Plan & Subscription to restore full access.';
