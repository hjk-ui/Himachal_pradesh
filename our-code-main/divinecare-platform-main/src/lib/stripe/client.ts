import 'server-only';

import Stripe from 'stripe';
import { stripeSecretKey } from './config';

let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = stripeSecretKey();
  cached = key ? new Stripe(key) : null;
  return cached;
}
