import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { sendEmail, verifySmtpConnection } from '@/lib/email/smtp';

const bodySchema = z.object({
  to: z.string().email(),
});

/** Admin-only: one SES test message. Sandbox requires a verified To address. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return Response.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (gate.role !== 'ADMIN' && gate.role !== 'DIRECTOR') {
    return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Valid "to" email is required' }, { status: 400 });
  }

  const verify = await verifySmtpConnection();
  if (!verify.ok) {
    return Response.json({ success: false, error: verify.error }, { status: 503 });
  }

  try {
    await sendEmail({
      to: parsed.data.to,
      subject: 'Altrixs SES SMTP test',
      text: 'This is a single test email from Altrixs via Amazon SES SMTP.',
      html: '<p>This is a single test email from Altrixs via Amazon SES SMTP.</p>',
      context: 'ses-smtp-test',
    });
    return Response.json({ success: true, message: 'Test email sent' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed';
    return Response.json({ success: false, error: message }, { status: 502 });
  }
}
