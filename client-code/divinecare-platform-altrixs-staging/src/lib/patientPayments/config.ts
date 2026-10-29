/**
 * Patient payments Stripe configuration (pure: reads an env record, no network).
 *
 * ARCHITECTURE: patient card payments go to the PRACTICE's own Stripe account, never to the Stripe
 * account Altrixs uses for its own subscription billing (src/lib/stripe/*, STRIPE_SECRET_KEY). The
 * practice is the merchant of record and owns the money, the disputes and the payouts.
 *   - Now (one practice): the practice's own keys in PATIENT_PAYMENTS_STRIPE_SECRET_KEY /
 *     _PUBLISHABLE_KEY / _WEBHOOK_SECRET, bound to one organization with PATIENT_PAYMENTS_ORGANIZATION_ID.
 *   - Later (several practices): Stripe Connect. Altrixs's platform key + one connected account per
 *     practice (PatientPaymentSettings.stripeAccountId, sent as the Stripe-Account header). The gateway
 *     already takes the account id, so no charge code changes.
 *
 * SAFETY: TEST MODE ONLY until the owner approves live. A live secret key (sk_live_ / rk_live_) is
 * refused unless PATIENT_PAYMENTS_LIVE_APPROVED=true, and live mode also requires the organization
 * binding. The publishable key must be the same mode as the secret key.
 */

export type PatientPaymentsEnv = Record<string, string | undefined>;

export type PatientPaymentsConfig =
  | {
      ok: true;
      mode: 'test' | 'live';
      livemode: boolean;
      secretKey: string;
      publishableKey: string;
      webhookSecret: string | null;
      /** Organization the keys belong to (required in live mode); null = any organization (test mode) */
      organizationId: string | null;
    }
  | { ok: false; reason: PatientPaymentsConfigProblem; message: string };

export type PatientPaymentsConfigProblem =
  | 'not_configured'
  | 'publishable_key_missing'
  | 'unknown_key'
  | 'live_not_approved'
  | 'live_needs_organization'
  | 'mode_mismatch'
  | 'shared_with_subscription_billing'
  | 'wrong_organization';

const MESSAGES: Record<PatientPaymentsConfigProblem, string> = {
  not_configured: 'Patient card payments are not connected: the practice Stripe keys are not set on this server.',
  publishable_key_missing: 'Patient card payments need the practice Stripe publishable key as well as the secret key.',
  unknown_key: 'The practice Stripe secret key is not a Stripe secret or restricted key.',
  live_not_approved: 'Live Stripe keys are refused: patient payments run in TEST MODE until the owner approves live charging (PATIENT_PAYMENTS_LIVE_APPROVED).',
  live_needs_organization: 'Live Stripe keys must be bound to the practice organization (PATIENT_PAYMENTS_ORGANIZATION_ID).',
  mode_mismatch: 'The practice Stripe publishable key and secret key are from different modes (test vs live).',
  shared_with_subscription_billing: "The patient payment key is Altrixs's own subscription billing key. Patient payments must use the practice's Stripe account.",
  wrong_organization: 'The practice Stripe keys on this server belong to a different practice.',
};

export function configProblemMessage(p: PatientPaymentsConfigProblem): string {
  return MESSAGES[p];
}

function keyMode(key: string, kind: 'secret' | 'publishable'): 'test' | 'live' | null {
  const prefixes = kind === 'secret' ? ['sk_', 'rk_'] : ['pk_'];
  for (const p of prefixes) {
    if (key.startsWith(`${p}live_`)) return 'live';
    if (key.startsWith(`${p}test_`)) return 'test';
  }
  return null;
}

const fail = (reason: PatientPaymentsConfigProblem): PatientPaymentsConfig => ({ ok: false, reason, message: MESSAGES[reason] });

/**
 * Resolve the patient payments config. organizationId (optional) checks the key binding for the
 * practice asking. Never returns a live config without PATIENT_PAYMENTS_LIVE_APPROVED=true.
 */
export function patientPaymentsConfig(env: PatientPaymentsEnv = process.env, organizationId?: string | null): PatientPaymentsConfig {
  const secretKey = env.PATIENT_PAYMENTS_STRIPE_SECRET_KEY?.trim() || '';
  if (!secretKey) return fail('not_configured');
  const mode = keyMode(secretKey, 'secret');
  if (!mode) return fail('unknown_key');
  const subscriptionKey = env.STRIPE_SECRET_KEY?.trim() || env.STRIPE_SECRET?.trim() || '';
  if (subscriptionKey && subscriptionKey === secretKey) return fail('shared_with_subscription_billing');
  const boundOrg = env.PATIENT_PAYMENTS_ORGANIZATION_ID?.trim() || null;
  if (mode === 'live') {
    if (env.PATIENT_PAYMENTS_LIVE_APPROVED?.trim() !== 'true') return fail('live_not_approved');
    if (!boundOrg) return fail('live_needs_organization');
  }
  const publishableKey = env.PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY?.trim() || '';
  if (!publishableKey) return fail('publishable_key_missing');
  if (keyMode(publishableKey, 'publishable') !== mode) return fail('mode_mismatch');
  if (organizationId && boundOrg && boundOrg !== organizationId) return fail('wrong_organization');
  return {
    ok: true,
    mode,
    livemode: mode === 'live',
    secretKey,
    publishableKey,
    webhookSecret: env.PATIENT_PAYMENTS_STRIPE_WEBHOOK_SECRET?.trim() || null,
    organizationId: boundOrg,
  };
}

/** Env vars the feature reads and whether each is set (never the value), for the settings panel. */
export function patientPaymentsEnvReport(env: PatientPaymentsEnv = process.env): { name: string; set: boolean; purpose: string }[] {
  const set = (n: string) => Boolean(env[n]?.trim());
  return [
    { name: 'PATIENT_PAYMENTS_STRIPE_SECRET_KEY', set: set('PATIENT_PAYMENTS_STRIPE_SECRET_KEY'), purpose: "Practice Stripe secret key (sk_test_...; live refused until approved)" },
    { name: 'PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY', set: set('PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY'), purpose: 'Practice Stripe publishable key for Stripe Elements (pk_test_...)' },
    { name: 'PATIENT_PAYMENTS_STRIPE_WEBHOOK_SECRET', set: set('PATIENT_PAYMENTS_STRIPE_WEBHOOK_SECRET'), purpose: 'Signing secret of the patient payments webhook endpoint (whsec_...)' },
    { name: 'PATIENT_PAYMENTS_ORGANIZATION_ID', set: set('PATIENT_PAYMENTS_ORGANIZATION_ID'), purpose: 'Organization the practice keys belong to (required for live)' },
    { name: 'PATIENT_PAYMENTS_LIVE_APPROVED', set: env.PATIENT_PAYMENTS_LIVE_APPROVED?.trim() === 'true', purpose: 'Owner approval for live charging (true); test mode otherwise' },
  ];
}
