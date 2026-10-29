import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  isSmtpConfigured,
  sendEmail,
  verifySmtpConnection,
} from '@/lib/email/smtp';
import { rateLimit } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';

const emptyBodySchema = z.object({}).strict();
const emailSchema = z.string().trim().email();

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
async function requireEmailAdmin() {
  const gate = await requireOrgContext();
  if (!gate.ok) return { response: json({ success: false, error: gate.error }, gate.status) };
  if (gate.role !== 'ADMIN' && gate.role !== 'DIRECTOR') {
    return { response: json({ success: false, error: 'Forbidden' }, 403) };
  }
  return { gate };
}

/**
 * Admin-only SMTP readiness check. It verifies transport authentication but
 * never sends a message and never returns hostnames, usernames, or provider errors.
 */
export async function GET() {
  const access = await requireEmailAdmin();
  if ('response' in access) return access.response;

  if (!isSmtpConfigured()) {
    return json({
      success: false,
      code: 'SMTP_NOT_CONFIGURED',
      error: 'Email delivery is not configured',
      data: { configured: false, reachable: false },
    }, 503);
  }

  const result = await verifySmtpConnection();
  if (!result.ok) {
    return json({
      success: false,
      code: 'SMTP_UNAVAILABLE',
      error: 'Email delivery service is unavailable',
      data: { configured: true, reachable: false },
    }, 503);
  }

  return json({
    success: true,
    data: { configured: true, reachable: true },
  });
}

/**
 * Admin-only single-message delivery test. The recipient is server-controlled
 * through SMTP_TEST_TO so an authenticated user cannot turn this into an open
 * email relay.
 */
export async function POST(req: Request) {
  const access = await requireEmailAdmin();
  if ('response' in access) return access.response;
  const { gate } = access;

  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return json({ success: false, error: 'Invalid request origin' }, 403);
  }
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ success: false, error: 'Content-Type must be application/json' }, 415);
  }

  const parsedBody = emptyBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return json({ success: false, error: 'Request body must be an empty JSON object' }, 400);
  }

  if (!rateLimit(`smtp-test:${gate.organizationId}:${gate.userId}`, 1, 10 * 60_000).ok) {
    return json({ success: false, error: 'Please wait before sending another test email' }, 429);
  }

  const recipient = emailSchema.safeParse(process.env.SMTP_TEST_TO);
  if (!recipient.success) {
    return json({
      success: false,
      code: 'SMTP_TEST_RECIPIENT_NOT_CONFIGURED',
      error: 'A server-controlled test recipient is not configured',
    }, 503);
  }

  if (!isSmtpConfigured() || !(await verifySmtpConnection()).ok) {
    return json({
      success: false,
      code: 'SMTP_UNAVAILABLE',
      error: 'Email delivery service is unavailable',
    }, 503);
  }

  try {
    await sendEmail({
      to: recipient.data,
      subject: 'Altrixs email delivery test',
      text: 'This is a single administrative email delivery test from Altrixs.',
      html: '<p>This is a single administrative email delivery test from Altrixs.</p>',
      context: 'smtp-delivery-test',
    });
    return json({ success: true, message: 'Test email accepted by the delivery service' });
  } catch {
    return json({
      success: false,
      code: 'SMTP_SEND_FAILED',
      error: 'The test email could not be sent',
    }, 502);
  }
}
