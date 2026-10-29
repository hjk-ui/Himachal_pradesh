import { NextResponse } from 'next/server';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';
import { constructStripeEvent, handleStripeEvent } from '@/lib/stripe/webhooks';

export const runtime = 'nodejs';

/**
 * Stripe webhook. Signature is verified against STRIPE_WEBHOOK_SECRET on the raw body;
 * processing is idempotent per event id (see src/lib/stripe/events.ts).
 * A 5xx makes Stripe retry, which is safe because duplicates are skipped.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  const parsed = constructStripeEvent(rawBody, signature);
  const startedAt = new Date();
  // Integration log: event type, id and outcome only (never the event body)
  const logEvent = (status: 'success' | 'error', extra: { operation: string; httpStatus: number; eventId?: string; outcome?: string; error?: unknown }) =>
    recordIntegrationCall({
      integration: 'stripe', operation: `webhook_${extra.operation}`, direction: 'webhook', status, startedAt,
      httpStatus: extra.httpStatus, correlationId: extra.eventId ?? null, vendorStatus: extra.outcome ?? null,
      errorMessage: extra.error ?? null, metadata: { account: 'platform' },
    });
  if (parsed.ok === false) {
    await logEvent('error', { operation: 'rejected', httpStatus: parsed.status, outcome: 'signature_or_parse_failed', error: parsed.error });
    return NextResponse.json({ success: false, error: parsed.error }, { status: parsed.status });
  }
  try {
    const result = await handleStripeEvent(parsed.event);
    if (result.outcome === 'no_org') {
      console.warn('[stripe webhook] no organization', parsed.event.id, parsed.event.type, result.reason);
    }
    await logEvent('success', { operation: parsed.event.type, httpStatus: 200, eventId: parsed.event.id, outcome: String(result.outcome) });
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (err) {
    console.error('[stripe webhook]', parsed.event.id, err instanceof Error ? err.message : err);
    await logEvent('error', { operation: parsed.event.type, httpStatus: 500, eventId: parsed.event.id, outcome: 'handler_failed', error: err });
    return NextResponse.json({ success: false, error: 'Webhook handler failed' }, { status: 500 });
  }
}
