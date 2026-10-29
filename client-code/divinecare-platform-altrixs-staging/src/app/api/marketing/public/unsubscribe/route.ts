import { NextResponse } from 'next/server';
import { readMarketingUnsubscribeToken } from '@/lib/marketing/tokens';
import { applyUnsubscribe } from '@/lib/marketing/publicService';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';

function page(title: string, text: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:40px 16px"><main style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="font-size:14px;color:#334155;margin:0">${text}</p></main></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function handle(req: Request) {
  const limited = rateLimit(clientKey(req, 'mkt-unsub'), 30, 60 * 60 * 1000);
  if (!limited.ok) return page('Please try again later', 'Too many requests from this connection.', 429);
  const token = new URL(req.url).searchParams.get('t');
  let parsed: ReturnType<typeof readMarketingUnsubscribeToken> = null;
  try {
    parsed = readMarketingUnsubscribeToken(token);
  } catch {
    parsed = null;
  }
  if (!parsed) return page('Link not valid', 'This unsubscribe link is not valid. Reply to the email or call our office and we will remove you.', 400);
  await applyUnsubscribe(parsed).catch(() => false);
  return page('You are unsubscribed', 'You will not receive more marketing email from us. Appointment and care messages from your care team are not affected.');
}

/** GET: link in the email footer. POST: RFC 8058 one-click (List-Unsubscribe-Post). */
export const GET = handle;
export const POST = handle;
