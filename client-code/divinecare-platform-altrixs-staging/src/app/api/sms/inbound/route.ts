import { NextResponse } from 'next/server';
import {
  isSnsMessageShape,
  isTrustedSubscribeUrl,
  parseInboundSmsPayload,
  verifySnsMessage,
} from '@/lib/sms/snsVerify';
import { handleInboundSms } from '@/lib/sms/inbound';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/sms/inbound — AWS End User Messaging two-way SMS, delivered by an SNS HTTPS
 * subscription. Public path (no staff session); trust comes from:
 *   1. SMS_INBOUND_TOPIC_ARN set and equal to the message TopicArn (fail closed when unset)
 *   2. a valid SNS signature from an sns.<region>.amazonaws.com certificate
 * SubscriptionConfirmation is confirmed by GETting its SubscribeURL (SNS host only).
 * Message text is never logged or stored; only the keyword.
 */
export async function POST(req: Request) {
  const topicArn = process.env.SMS_INBOUND_TOPIC_ARN?.trim();
  if (!topicArn) {
    return NextResponse.json({ success: false, error: 'Inbound SMS is not configured' }, { status: 503 });
  }

  let msg: unknown;
  try {
    msg = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
  }
  if (!isSnsMessageShape(msg)) {
    return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
  }
  if (msg.TopicArn !== topicArn) {
    return NextResponse.json({ success: false, error: 'Unknown topic' }, { status: 403 });
  }
  const verified = await verifySnsMessage(msg);
  if (verified.ok === false) {
    await writeAuditLog({
      action: 'SMS_INBOUND_REJECTED',
      actorRole: 'SYSTEM',
      resourceType: 'sms_inbound',
      outcome: 'DENIED',
      metadata: { reason: verified.reason, type: msg.Type },
    });
    return NextResponse.json({ success: false, error: 'Signature check failed' }, { status: 403 });
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!isTrustedSubscribeUrl(msg.SubscribeURL)) {
      return NextResponse.json({ success: false, error: 'Untrusted SubscribeURL' }, { status: 403 });
    }
    const res = await fetch(msg.SubscribeURL!, { redirect: 'error' }).catch(() => null);
    await writeAuditLog({
      action: 'SMS_INBOUND_SUBSCRIPTION_CONFIRMED',
      actorRole: 'SYSTEM',
      resourceType: 'sms_inbound',
      outcome: res?.ok ? 'SUCCESS' : 'FAILURE',
      metadata: { status: res?.status ?? null },
    });
    return NextResponse.json({ success: Boolean(res?.ok) }, { status: res?.ok ? 200 : 502 });
  }
  if (msg.Type !== 'Notification') {
    return NextResponse.json({ success: true, ignored: msg.Type });
  }

  const payload = parseInboundSmsPayload(msg.Message);
  if (!payload) {
    return NextResponse.json({ success: true, ignored: 'not_two_way_sms' });
  }
  try {
    const result = await handleInboundSms({
      snsMessageId: msg.MessageId,
      fromNumber: payload.originationNumber,
      body: payload.messageBody,
    });
    return NextResponse.json({ success: true, keyword: result.keyword, duplicate: result.duplicate });
  } catch (err) {
    console.error('[sms:inbound] handler failed', err instanceof Error ? err.name : 'error');
    // 500 lets SNS retry (the SnsMessageId dedupe makes retries safe).
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
