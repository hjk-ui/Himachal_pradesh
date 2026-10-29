/**
 * Stripe API calls in the integration call log, through the SDK's 'response' event: method, path
 * (object ids replaced by :id), HTTP status, Stripe request id and elapsed time. The event carries
 * no request or response body, so card data can never reach the log.
 */
import type Stripe from 'stripe';
import { recordIntegrationCall } from './record';

/** "/v1/customers/cus_123/sources" -> "post_/v1/customers/:id/sources" */
export function stripeOperation(method: string, path: string): string {
  const clean = String(path || '')
    .split('?')[0]
    .split('/')
    .map((seg) => (/^[a-z]{2,8}_[A-Za-z0-9]{6,}$/.test(seg) || /\d{4,}/.test(seg) ? ':id' : seg))
    .join('/');
  return `${String(method || 'get').toLowerCase()}_${clean}`;
}

type ResponseEventLike = { method?: string; path?: string; status?: number; request_id?: string; elapsed?: number };

export function instrumentStripe<S extends Stripe>(stripe: S, label: 'platform' | 'patient_payments'): S {
  try {
    stripe.on('response', (event: ResponseEventLike) => {
      const status = Number(event.status) || 0;
      void recordIntegrationCall({
        integration: 'stripe',
        operation: stripeOperation(event.method || 'get', event.path || ''),
        direction: 'outbound',
        status: status >= 200 && status < 400 ? 'success' : status === 429 ? 'throttled' : 'error',
        httpStatus: status || null,
        durationMs: typeof event.elapsed === 'number' ? event.elapsed : null,
        correlationId: event.request_id ?? null,
        errorMessage: status >= 400 ? `HTTP ${status}` : null,
        metadata: { account: label },
      });
    });
  } catch {
    // older SDK without events: no logging
  }
  return stripe;
}
