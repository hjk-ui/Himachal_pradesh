import { after, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { apply835File } from '@/lib/billing/waystarInbound/era';

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

/**
 * The JSON webhook (processEraWebhook: set claims PAID unconditionally, matched across organizations)
 * is retired. 835s arrive by Waystar SFTP and are posted by the 835 pipeline (era.ts: CLP matching,
 * balancing, review queue). This endpoint stays closed (410) unless a Waystar webhook has been
 * verified with Waystar and switched on with ERA_WEBHOOK_ENABLED=verified; it then accepts only a
 * raw X12 835 and hands it to the same 835 pipeline.
 */
export async function POST(request: Request) {
  if (process.env.ERA_WEBHOOK_ENABLED !== 'verified') {
    return NextResponse.json(
      { error: 'Retired: 835 remittances are retrieved from Waystar SFTP and posted by the ERA pipeline.' },
      { status: 410 }
    );
  }
  const rawText = await request.text().catch(() => '');
  if (!authorizeWebhook(request, rawText)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let x12 = rawText;
  if (!/^\s*ISA/.test(rawText)) {
    try {
      const body = rawText ? (JSON.parse(rawText) as { x12?: unknown }) : null;
      x12 = typeof body?.x12 === 'string' ? body.x12 : '';
    } catch {
      x12 = '';
    }
  }
  if (!/^\s*ISA/.test(x12) || !/ST\*835\*/.test(x12)) {
    return NextResponse.json({ error: 'Send the raw X12 835 (body, or JSON { "x12": "ISA*..." })' }, { status: 400 });
  }
  const fileName = `webhook-835-${new Date().toISOString().replace(/[:.]/g, '-')}.835`;
  after(async () => {
    try {
      await apply835File({ id: null, fileName }, x12, { actorUserId: null, trigger: 'era-webhook' });
    } catch (err) {
      console.error('[era-webhook] processing failed', err instanceof Error ? err.message : 'unknown');
    }
  });
  return NextResponse.json({ received: true }, { status: 202 });
}
