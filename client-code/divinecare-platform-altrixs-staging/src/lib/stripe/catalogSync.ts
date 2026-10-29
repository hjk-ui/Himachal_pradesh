/**
 * Pure helpers for scripts/stripe-sync-catalog.ts (kept here so they are unit-tested).
 *
 * Safety rules:
 *  - Without --apply nothing is sent to Stripe (dry run prints the plan).
 *  - --apply needs STRIPE_SECRET_KEY.
 *  - A live key (sk_live_ / rk_live_) is refused unless --live is also passed. Creating live
 *    products and prices requires the owner's explicit approval of the pricing first.
 */
import type { CatalogPrice } from './catalog';

export type SyncGuard =
  | { ok: true; mode: 'dry_run' | 'test' | 'live' }
  | { ok: false; error: string };

export function syncGuard(input: { apply: boolean; live: boolean; key: string | null | undefined }): SyncGuard {
  if (!input.apply) return { ok: true, mode: 'dry_run' };
  const key = (input.key || '').trim();
  if (!key) return { ok: false, error: 'STRIPE_SECRET_KEY is not set; --apply needs it.' };
  const isLive = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  const isTest = key.startsWith('sk_test_') || key.startsWith('rk_test_');
  if (!isLive && !isTest) return { ok: false, error: 'STRIPE_SECRET_KEY is not a recognizable test or live key.' };
  if (isLive && !input.live) {
    return {
      ok: false,
      error:
        'Refusing to write to a LIVE Stripe account. Live products and prices need the owner\'s written approval of pricing; re-run with --live only after that approval.',
    };
  }
  return { ok: true, mode: isLive ? 'live' : 'test' };
}

/** The fields of an existing Stripe price that must match the catalog for it to be reused. */
export type ExistingPrice = {
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string; usage_type: string } | null;
};

export function priceMatches(want: CatalogPrice, have: ExistingPrice): boolean {
  if (have.unit_amount !== want.unitAmount || have.currency !== want.currency) return false;
  if (!want.recurring) return have.recurring === null;
  return (
    have.recurring !== null &&
    have.recurring.interval === want.recurring.interval &&
    have.recurring.usage_type === want.recurring.usageType
  );
}
