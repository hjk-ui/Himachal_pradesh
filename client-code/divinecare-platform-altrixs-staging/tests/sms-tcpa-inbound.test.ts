import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { parseSmsKeyword, helpReplyText } from '../src/lib/sms/keywords';
import {
  isTrustedSigningCertUrl,
  isTrustedSubscribeUrl,
  snsStringToSign,
  verifySnsMessage,
  parseInboundSmsPayload,
  type SnsMessage,
} from '../src/lib/sms/snsVerify';
import { smsEligibility, emailReminderEligibility } from '../src/lib/sms/consent';
import { handleInboundSms } from '../src/lib/sms/inbound';

test('keywords: STOP synonyms, START, HELP, C', () => {
  for (const s of ['STOP', 'stop.', ' Stop ', 'UNSUBSCRIBE', 'cancel', 'End', 'quit', 'STOPALL', 'opt out', 'Revoke']) {
    assert.equal(parseSmsKeyword(s), 'stop', s);
  }
  assert.equal(parseSmsKeyword('START'), 'unstop');
  assert.equal(parseSmsKeyword('unstop'), 'unstop');
  assert.equal(parseSmsKeyword('HELP'), 'help');
  assert.equal(parseSmsKeyword('c'), 'confirm');
  assert.equal(parseSmsKeyword('Confirm!'), 'confirm');
  assert.equal(parseSmsKeyword('can I stop by later'), 'other');
  assert.equal(parseSmsKeyword(''), 'other');
  const help = helpReplyText({ practiceName: 'MD Behavioral Health', contactPhone: '410-555-0100' });
  assert.match(help, /Reply STOP/);
  assert.match(help, /Msg & data rates may apply/);
});

test('SNS: only sns.<region>.amazonaws.com certificate / subscribe URLs are trusted', () => {
  assert.ok(isTrustedSigningCertUrl('https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem'));
  assert.ok(!isTrustedSigningCertUrl('http://sns.us-east-1.amazonaws.com/x.pem'));
  assert.ok(!isTrustedSigningCertUrl('https://sns.us-east-1.amazonaws.com.evil.com/x.pem'));
  assert.ok(!isTrustedSigningCertUrl('https://evil.com/sns.us-east-1.amazonaws.com/x.pem'));
  assert.ok(isTrustedSubscribeUrl('https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=a&Token=b'));
  assert.ok(!isTrustedSubscribeUrl('https://example.com/?Action=ConfirmSubscription'));
});

test('SNS: signature verification (v1 SHA1 and v2 SHA256); tamper, stale and foreign cert rejected', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const base: SnsMessage = {
    Type: 'Notification',
    MessageId: 'm-1',
    TopicArn: 'arn:aws:sns:us-east-1:111:inbound-sms',
    Message: JSON.stringify({ originationNumber: '+14105550100', messageBody: 'STOP' }),
    Timestamp: '2026-10-19T12:00:00.000Z',
    SignatureVersion: '2',
    Signature: '',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-x.pem',
  };
  const sign = (m: SnsMessage, algo: string) => {
    const s = createSign(algo);
    s.update(snsStringToSign(m)!);
    return s.sign(privateKey, 'base64');
  };
  const now = new Date('2026-10-19T12:05:00Z');
  const fetchCert = async () => pem;
  const v2 = { ...base, Signature: sign(base, 'RSA-SHA256') };
  assert.deepEqual(await verifySnsMessage(v2, { fetchCert, now }), { ok: true });
  const v1base = { ...base, SignatureVersion: '1' };
  const v1 = { ...v1base, Signature: sign(v1base, 'RSA-SHA1') };
  assert.deepEqual(await verifySnsMessage(v1, { fetchCert, now }), { ok: true });
  const tampered = { ...v2, Message: JSON.stringify({ originationNumber: '+14105550199', messageBody: 'STOP' }) };
  assert.deepEqual(await verifySnsMessage(tampered, { fetchCert, now }), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(await verifySnsMessage(v2, { fetchCert, now: new Date('2026-10-20T12:00:00Z') }), { ok: false, reason: 'stale_timestamp' });
  assert.deepEqual(
    await verifySnsMessage({ ...v2, SigningCertURL: 'https://evil.com/x.pem' }, { fetchCert, now }),
    { ok: false, reason: 'untrusted_cert_url' }
  );
  assert.equal(parseInboundSmsPayload(base.Message)?.messageBody, 'STOP');
  assert.equal(parseInboundSmsPayload('not json'), null);
});

test('SMS consent gate: consent required, opt-out wins; email opt-out honored', () => {
  assert.deepEqual(smsEligibility({ phone: '4105550100', smsConsent: true }), { ok: true });
  assert.deepEqual(smsEligibility({ phone: '4105550100', smsConsent: false }), { ok: false, reason: 'no_sms_consent' });
  assert.deepEqual(smsEligibility({ phone: '4105550100', smsConsent: true, smsOptOutAt: new Date() }), { ok: false, reason: 'sms_opted_out' });
  assert.deepEqual(smsEligibility({ phone: '', smsConsent: true }), { ok: false, reason: 'no_phone' });
  assert.deepEqual(emailReminderEligibility({ email: 'a@b.co', emailOptOutAt: new Date() }), { ok: false, reason: 'email_opted_out' });
  assert.deepEqual(emailReminderEligibility({ email: 'a@b.co' }), { ok: true });
});

type Call = { op: string; args: any };

function inboundFakeDb(opts: { clients: any[]; logs?: any[]; appts?: any[] }) {
  const events = new Map<string, any>();
  const calls: Call[] = [];
  return {
    calls,
    db: {
      client: {
        findMany: async (a: any) => opts.clients.filter((c) => (c.phone ?? '').includes(a.where.phone.contains)),
        updateMany: async (a: any) => {
          calls.push({ op: 'client.updateMany', args: a });
          return { count: a.where.id.in.length };
        },
      },
      smsInboundEvent: {
        create: async (a: any) => {
          if (events.has(a.data.snsMessageId)) throw Object.assign(new Error('dup'), { code: 'P2002' });
          events.set(a.data.snsMessageId, a.data);
          return a.data;
        },
        update: async (a: any) => {
          Object.assign(events.get(a.where.snsMessageId), a.data);
          return {};
        },
      },
      notificationLog: { findMany: async () => opts.logs ?? [] },
      appointment: {
        findFirst: async (a: any) =>
          (opts.appts ?? []).find((x) => a.where.id.in.includes(x.id) && x.status === 'SCHEDULED') ?? null,
        updateMany: async (a: any) => {
          calls.push({ op: 'appointment.updateMany', args: a });
          return { count: 1 };
        },
      },
      schedulingSettings: { findUnique: async () => ({ practiceName: 'MD Behavioral Health', contactPhone: null }) },
      organization: { findUnique: async () => ({ name: 'Org' }) },
    },
  };
}

const noopAudit = (async () => {}) as any;
function sender(sent: any[]) {
  return (async (x: any) => {
    sent.push(x);
    return { mode: 'sms' };
  }) as any;
}

test('inbound STOP opts out every client on that number and dedupes SNS retries', async () => {
  const f = inboundFakeDb({
    clients: [
      { id: 'c1', organizationId: 'o1', phone: '(410) 555-0100', smsConsent: true, smsOptOutAt: null },
      { id: 'c2', organizationId: 'o1', phone: '410.555.0100', smsConsent: true, smsOptOutAt: null },
      { id: 'c3', organizationId: 'o1', phone: '(301) 555-0100', smsConsent: true, smsOptOutAt: null },
    ],
  });
  const sent: any[] = [];
  const deps = { db: f.db, send: sender(sent), audit: noopAudit };
  delete process.env.SMS_SELF_MANAGED_KEYWORDS;
  const r = await handleInboundSms({ snsMessageId: 's1', fromNumber: '+14105550100', body: 'Stop' }, deps);
  assert.equal(r.keyword, 'stop');
  assert.equal(r.clientCount, 2);
  const upd = f.calls.find((c) => c.op === 'client.updateMany')!;
  assert.deepEqual([...upd.args.where.id.in].sort(), ['c1', 'c2']);
  assert.ok(upd.args.data.smsOptOutAt instanceof Date);
  assert.equal(sent.length, 0, 'AWS keyword responses reply unless self-managed');
  const again = await handleInboundSms({ snsMessageId: 's1', fromNumber: '+14105550100', body: 'Stop' }, deps);
  assert.equal(again.duplicate, true);
  assert.equal(f.calls.filter((c) => c.op === 'client.updateMany').length, 1);
});

test('inbound STOP / HELP reply when keywords are self-managed', async () => {
  process.env.SMS_SELF_MANAGED_KEYWORDS = 'true';
  try {
    const f = inboundFakeDb({ clients: [{ id: 'c1', organizationId: 'o1', phone: '4105550100', smsConsent: true, smsOptOutAt: null }] });
    const sent: any[] = [];
    await handleInboundSms({ snsMessageId: 'h1', fromNumber: '+14105550100', body: 'HELP' }, { db: f.db, send: sender(sent), audit: noopAudit });
    await handleInboundSms({ snsMessageId: 'h2', fromNumber: '+14105550100', body: 'STOP' }, { db: f.db, send: sender(sent), audit: noopAudit });
    assert.equal(sent.length, 2);
    assert.match(sent[0].body, /Reply STOP to opt out/);
    assert.match(sent[1].body, /unsubscribed/);
  } finally {
    delete process.env.SMS_SELF_MANAGED_KEYWORDS;
  }
});

test('inbound START clears opt-out and records consent source', async () => {
  const f = inboundFakeDb({ clients: [{ id: 'c1', organizationId: 'o1', phone: '4105550100', smsConsent: false, smsOptOutAt: new Date() }] });
  await handleInboundSms({ snsMessageId: 's2', fromNumber: '+14105550100', body: 'START' }, { db: f.db, send: sender([]), audit: noopAudit });
  const upd = f.calls.find((c) => c.op === 'client.updateMany')!;
  assert.equal(upd.args.data.smsOptOutAt, null);
  assert.equal(upd.args.data.smsConsentSource, 'sms_unstop');
});

test('inbound C confirms only an upcoming appointment we texted a reminder for', async () => {
  const f = inboundFakeDb({
    clients: [{ id: 'c1', organizationId: 'o1', phone: '4105550100', smsConsent: true, smsOptOutAt: null }],
    logs: [{ appointmentId: 'a1' }],
    appts: [{ id: 'a1', status: 'SCHEDULED' }],
  });
  const sent: any[] = [];
  const r = await handleInboundSms({ snsMessageId: 's3', fromNumber: '+14105550100', body: 'C' }, { db: f.db, send: sender(sent), audit: noopAudit });
  assert.equal(r.appointmentId, 'a1');
  const upd = f.calls.find((c) => c.op === 'appointment.updateMany')!;
  assert.equal(upd.args.where.id, 'a1');
  assert.ok(upd.args.data.confirmedAt instanceof Date);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].body, /Dr\.|therapy|psychiatr/i);

  const none = inboundFakeDb({ clients: [{ id: 'c1', organizationId: 'o1', phone: '4105550100', smsConsent: true, smsOptOutAt: null }] });
  const r2 = await handleInboundSms({ snsMessageId: 's4', fromNumber: '+14105550100', body: 'c' }, { db: none.db, send: sender([]), audit: noopAudit });
  assert.equal(r2.appointmentId, null);
  assert.equal(none.calls.length, 0);
});
