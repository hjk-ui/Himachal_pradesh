import { NextResponse } from 'next/server';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';
import { patientPaymentsConfig } from '@/lib/patientPayments/config';
import { constructPatientPaymentsEvent } from '@/lib/patientPayments/stripeGateway';
import { handleWebhookEvent, type WebhookEventLike } from '@/lib/patientPayments/service';
import { patientPaymentsDeps } from '@/lib/patientPayments/server';

export const runtime = 'nodejs';

/**
 * Stripe webhook for PATIENT payments (the practice's Stripe account). Separate endpoint and signing
 * secret (PATIENT_PAYMENTS_STRIPE_WEBHOOK_SECRET) from the Altrixs subscription webhook
 * (/api/webhooks/stripe). Card payments reach the patient ledger only here, on
 * payment_intent.succeeded; posting is idempotent per PaymentIntent / refund, so Stripe retries are safe.
 * Events: payment_intent.succeeded | payment_failed | requires_action | canceled, refund.created | refund.updated.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const config = patientPaymentsConfig(process.env);
  const parsed = constructPatientPaymentsEvent(rawBody, req.headers.get('stripe-signature'), config);
  const startedAt = new Date();
  // Integration log: event type, id and outcome only (never the event body)
  const logEvent = (status: 'success' | 'error', extra: { operation: string; httpStatus: number; eventId?: string; outcome?: string; error?: unknown }) =>
    recordIntegrationCall({
      integration: 'stripe', operation: `webhook_${extra.operation}`, direction: 'webhook', status, startedAt,
      httpStatus: extra.httpStatus, correlationId: extra.eventId ?? null, vendorStatus: extra.outcome ?? null,
      errorMessage: extra.error ?? null, metadata: { account: 'patient_payments' },
    });
  if (parsed.ok === false) {
    await logEvent('error', { operation: 'rejected', httpStatus: parsed.status, outcome: 'signature_or_parse_failed', error: parsed.error });
    return NextResponse.json({ success: false, error: parsed.error }, { status: parsed.status });
  }
  try {
    const result = await handleWebhookEvent(patientPaymentsDeps(), parsed.event as unknown as WebhookEventLike);
    if (result.outcome === 'unknown_charge') console.warn('[patient payments webhook] no charge', parsed.event.id, parsed.event.type);
    await logEvent('success', { operation: parsed.event.type, httpStatus: 200, eventId: parsed.event.id, outcome: String(result.outcome) });
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (err) {
    console.error('[patient payments webhook]', parsed.event.id, err instanceof Error ? err.message : err);
    await logEvent('error', { operation: parsed.event.type, httpStatus: 500, eventId: parsed.event.id, outcome: 'handler_failed', error: err });
    return NextResponse.json({ success: false, error: 'Webhook handler failed' }, { status: 500 });
  }
}
