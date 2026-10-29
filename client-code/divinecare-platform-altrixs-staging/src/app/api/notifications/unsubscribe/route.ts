import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { readUnsubscribeToken } from '@/lib/notifications/appointmentReminders';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Appointment reminder email unsubscribe.
 *   POST ?t=<token>  RFC 8058 one-click (mail clients send "List-Unsubscribe=One-Click"), or the
 *                    button on the GET page. Sets Client.emailOptOutAt.
 *   GET  ?t=<token>  confirmation page with one button. GET never unsubscribes by itself: mail
 *                    scanners prefetch links.
 * The token is an HMAC of the client id (no PHI in the URL); pages show no patient details.
 */

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#141C34;background:#fff}button{background:#5C2D91;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;cursor:pointer}</style></head>
<body><h1 style="font-size:20px">${title}</h1>${body}</body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function tokenFrom(req: Request) {
  return new URL(req.url).searchParams.get('t');
}

function clientIdFor(token: string | null): string | null {
  try {
    return readUnsubscribeToken(token);
  } catch {
    return null; // secret not configured
  }
}

export async function GET(req: Request) {
  const token = tokenFrom(req);
  if (!clientIdFor(token)) return page('Link not valid', '<p>This unsubscribe link is not valid. Contact the practice to change reminder preferences.</p>', 400);
  const action = `/api/notifications/unsubscribe?t=${encodeURIComponent(token!)}`;
  return page(
    'Stop appointment reminder emails?',
    `<p>You will no longer get appointment reminder emails. Texts and other messages from the practice are not changed.</p>
<form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>`
  );
}

export async function POST(req: Request) {
  const token = tokenFrom(req);
  const clientId = clientIdFor(token);
  if (!clientId) return page('Link not valid', '<p>This unsubscribe link is not valid.</p>', 400);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, organizationId: true, emailOptOutAt: true } });
  if (!client) return page('Link not valid', '<p>This unsubscribe link is not valid.</p>', 400);
  if (!client.emailOptOutAt) {
    await prisma.client.update({ where: { id: client.id }, data: { emailOptOutAt: new Date() } });
    await writeAuditLog({
      action: 'EMAIL_REMINDER_UNSUBSCRIBE',
      actorUserId: null,
      actorRole: 'PATIENT',
      organizationId: client.organizationId,
      resourceType: 'client',
      resourceId: client.id,
      patientId: client.id,
      ...auditRequestMeta(req),
      metadata: { via: 'email_link', fields: ['emailOptOutAt'] },
    });
  }
  return page('You are unsubscribed', '<p>You will no longer get appointment reminder emails.</p>');
}
