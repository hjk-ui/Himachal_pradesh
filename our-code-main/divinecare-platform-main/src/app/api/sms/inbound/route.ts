import { NextResponse } from 'next/server';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/sms/phone';
import {
  applySmsOptIn,
  applySmsOptOut,
  findClientIdByPhone,
} from '@/lib/sms/patient-gate';
import { publishSnsSms } from '@/lib/sms/sns';
import { isSnsSmsConfigured } from '@/lib/sms/send';

export const runtime = 'nodejs';

/**
 * Inbound STOP / START handler for patient SMS (TCPA).
 * Body: { from, body } — no PHI in auto-replies.
 */
const schema = z.object({
  from: z.string().min(7).max(32),
  body: z.string().min(1).max(1600),
});

export async function POST(req: Request) {
  const secret = process.env.SMS_INBOUND_WEBHOOK_SECRET?.trim();
  if (secret) {
    const header = req.headers.get('x-sms-inbound-secret')?.trim();
    if (header !== secret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }

  const phone = normalizeToE164(parsed.data.from);
  if (!phone) {
    return NextResponse.json({ success: false, error: 'Invalid from number' }, { status: 400 });
  }

  const keyword = parsed.data.body.trim().toUpperCase().split(/\s+/)[0] || '';
  const clientId = await findClientIdByPhone(phone);

  let action: 'stop' | 'start' | 'ignored' = 'ignored';
  let reply: string | null = null;

  if (keyword === 'STOP' || keyword === 'STOPALL' || keyword === 'UNSUBSCRIBE' || keyword === 'CANCEL' || keyword === 'END' || keyword === 'QUIT') {
    action = 'stop';
    if (clientId) await applySmsOptOut(clientId, 'inbound_stop');
    reply = 'You are unsubscribed from patient text messages. Reply START to opt in again.';
  } else if (keyword === 'START' || keyword === 'YES' || keyword === 'UNSTOP') {
    action = 'start';
    if (clientId) await applySmsOptIn(clientId, 'inbound_start');
    reply = 'You are opted in to patient text messages from this practice. Reply STOP to opt out.';
  }

  if (reply && isSnsSmsConfigured()) {
    const region =
      process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
    try {
      await publishSnsSms({
        region,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN?.trim(),
        phoneNumber: phone,
        message: reply,
        originationNumber: process.env.SNS_SMS_ORIGINATION_NUMBER?.trim(),
      });
    } catch {
      /* best-effort confirmation */
    }
  }

  return NextResponse.json({
    success: true,
    action,
    matchedClient: Boolean(clientId),
  });
}
