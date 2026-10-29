import 'server-only';

import { instrumentStripe } from '@/lib/integrations/callLog/stripeInstrument';
import Stripe from 'stripe';
import type { PatientPaymentsConfig } from './config';
import { assertNoPhi, type StripeParams } from './params';
import type { PatientPaymentSettingsShape } from './rules';
import type { GatewayError, GatewayPaymentIntent, PatientPaymentsGateway } from './types';

/**
 * Stripe adapter for patient payments: the PRACTICE's Stripe account (its own keys, or the platform key
 * with the practice's connected account as Stripe-Account). Never the Altrixs subscription account
 * (src/lib/stripe/client.ts). Every request is checked by assertNoPhi before it leaves the server.
 */

const clients = new Map<string, Stripe>();

function stripeFor(secretKey: string): Stripe {
  let c = clients.get(secretKey);
  if (!c) {
    c = instrumentStripe(new Stripe(secretKey, { maxNetworkRetries: 2, appInfo: { name: 'Altrixs patient payments' } }), 'patient_payments');
    clients.set(secretKey, c);
  }
  return c;
}

function idOf(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return typeof v === 'object' && 'id' in (v as object) ? String((v as { id: unknown }).id) : null;
}

function mapError(e: { code?: string | null; decline_code?: string | null; type?: string | null } | null | undefined): GatewayError | null {
  if (!e) return null;
  return { code: e.code ?? null, decline_code: e.decline_code ?? null, type: e.type ?? null };
}

function mapPi(pi: Stripe.PaymentIntent): GatewayPaymentIntent {
  return {
    id: pi.id,
    status: pi.status,
    amount: pi.amount,
    amount_received: pi.amount_received,
    livemode: pi.livemode,
    client_secret: pi.client_secret,
    payment_method: idOf(pi.payment_method),
    last_payment_error: mapError(pi.last_payment_error as { code?: string; decline_code?: string; type?: string } | null),
    metadata: pi.metadata ?? null,
  };
}

export function stripePatientGateway(config: Extract<PatientPaymentsConfig, { ok: true }>, settings: Pick<PatientPaymentSettingsShape, 'stripeAccountId'>): PatientPaymentsGateway {
  const stripe = stripeFor(config.secretKey);
  const account = settings.stripeAccountId?.trim() || null;
  const opts = (extra: Stripe.RequestOptions = {}): Stripe.RequestOptions => ({ ...extra, ...(account ? { stripeAccount: account } : {}) });
  const checked = <T extends StripeParams>(p: T) => {
    assertNoPhi(p);
    return p;
  };
  return {
    async createCustomer(params, o) {
      const c = await stripe.customers.create(checked(params) as unknown as Stripe.CustomerCreateParams, opts({ idempotencyKey: o.idempotencyKey }));
      return { id: c.id };
    },
    async createSetupIntent(params) {
      const si = await stripe.setupIntents.create(checked(params) as unknown as Stripe.SetupIntentCreateParams, opts());
      return { id: si.id, client_secret: si.client_secret, status: si.status };
    },
    async retrieveSetupIntent(id) {
      const si = await stripe.setupIntents.retrieve(id, {}, opts());
      return { id: si.id, status: si.status, customer: idOf(si.customer), payment_method: idOf(si.payment_method), usage: si.usage ?? null, metadata: si.metadata ?? null };
    },
    async retrievePaymentMethod(id) {
      const pm = await stripe.paymentMethods.retrieve(id, {}, opts());
      return {
        id: pm.id,
        customer: idOf(pm.customer),
        card: pm.card ? { brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year } : null,
        postalCode: pm.billing_details?.address?.postal_code ?? null,
      };
    },
    async detachPaymentMethod(id) {
      await stripe.paymentMethods.detach(id, {}, opts());
    },
    async createPaymentIntent(params, o) {
      try {
        const pi = await stripe.paymentIntents.create(checked(params) as unknown as Stripe.PaymentIntentCreateParams, opts({ idempotencyKey: o.idempotencyKey }));
        return { ok: true, paymentIntent: mapPi(pi) };
      } catch (err) {
        if (err instanceof Stripe.errors.StripeError) {
          const raw = (err as unknown as { payment_intent?: Stripe.PaymentIntent; raw?: { payment_intent?: Stripe.PaymentIntent } }).payment_intent ??
            (err as unknown as { raw?: { payment_intent?: Stripe.PaymentIntent } }).raw?.payment_intent;
          if (err.type === 'StripeCardError' || raw) {
            return { ok: false, error: { code: err.code ?? null, decline_code: (err as { decline_code?: string }).decline_code ?? null, type: err.type }, paymentIntent: raw ? mapPi(raw) : null };
          }
        }
        throw err;
      }
    },
    async retrievePaymentIntent(id) {
      return mapPi(await stripe.paymentIntents.retrieve(id, {}, opts()));
    },
    async cancelPaymentIntent(id) {
      return mapPi(await stripe.paymentIntents.cancel(id, { cancellation_reason: 'requested_by_customer' }, opts()));
    },
    async createRefund(params, o) {
      const r = await stripe.refunds.create(checked(params) as unknown as Stripe.RefundCreateParams, opts({ idempotencyKey: o.idempotencyKey }));
      return { id: r.id, status: r.status, amount: r.amount, payment_intent: idOf(r.payment_intent), metadata: r.metadata ?? null };
    },
  };
}

/** Verify a patient payments webhook with ITS OWN endpoint secret (never the subscription webhook's). */
export function constructPatientPaymentsEvent(
  rawBody: string,
  signature: string | null,
  config: PatientPaymentsConfig
): { ok: true; event: Stripe.Event } | { ok: false; status: number; error: string } {
  if (config.ok === false || !config.webhookSecret) return { ok: false, status: 503, error: 'Patient payments webhook secret is not configured' };
  if (!signature) return { ok: false, status: 400, error: 'Missing stripe-signature header' };
  try {
    return { ok: true, event: stripeFor(config.secretKey).webhooks.constructEvent(rawBody, signature, config.webhookSecret) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid Stripe signature' };
  }
}
