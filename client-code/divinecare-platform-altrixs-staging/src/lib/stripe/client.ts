import 'server-only';

import Stripe from 'stripe';
import { stripeSecretKey } from './config';
import { instrumentStripe } from '@/lib/integrations/callLog/stripeInstrument';

let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = stripeSecretKey();
  cached = key ? instrumentStripe(new Stripe(key), 'platform') : null;
  return cached;
}
