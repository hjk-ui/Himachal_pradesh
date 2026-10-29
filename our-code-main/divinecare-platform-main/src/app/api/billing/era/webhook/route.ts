import { after, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { processEraWebhook } from '@/lib/billing/clearinghouseClaims';

/**
 * Waystar / clearinghouse 835 ERA webhook.
 * Requires ERA_WEBHOOK_SECRET (or WAYSTAR_WEBHOOK_SECRET) via:
 *   Authorization: Bearer <secret>
 *   OR X-Altrixs-Webhook-Signature: sha256=<hmac of raw body>
 */

function getWebhookSecret(): string {
  return (
    process.env.ERA_WEBHOOK_SECRET?.trim() ||
    process.env.WAYSTAR_WEBHOOK_SECRET?.trim() ||
    ''
  );
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function authorizeWebhook(req: Request, rawBody: string): boolean {
  const secret = getWebhookSecret();
  if (!secret) {
    // Fail closed — never accept unauthenticated ERA posts
    return false;
  }

  const auth = req.headers.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (bearer && safeEqual(bearer, secret)) return true;

  const sigHeader =
    req.headers.get('x-altrixs-webhook-signature') ||
    req.headers.get('x-waystar-signature') ||
    '';
  const provided = sigHeader.replace(/^sha256=/i, '').trim();
  if (provided) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (safeEqual(provided, expected)) return true;
  }

  return false;
}

export async function POST(request: Request) {
  const rawText = await request.text().catch(() => '');
  if (!authorizeWebhook(request, rawText)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown = null;
  try {
    raw = rawText ? JSON.parse(rawText) : null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  after(async () => {
    try {
      await processEraWebhook(raw);
    } catch (err) {
      console.error(
        '[era-webhook] processing failed',
        err instanceof Error ? err.message : 'unknown'
      );
    }
  });
  return NextResponse.json({ received: true }, { status: 200 });
}
