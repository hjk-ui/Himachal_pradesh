import { NextResponse } from 'next/server';
import { constructStripeEvent, handleStripeEvent } from '@/lib/stripe/webhooks';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  const parsed = constructStripeEvent(rawBody, signature);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }
  try {
    await handleStripeEvent(parsed.event);
  } catch (err) {
    console.error('[stripe webhook]', err);
    return NextResponse.json({ success: false, error: 'Webhook handler failed' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
