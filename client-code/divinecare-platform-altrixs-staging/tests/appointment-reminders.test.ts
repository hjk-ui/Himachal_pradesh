import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  channelEnabled,
  readUnsubscribeToken,
  reminderDecision,
  reminderEmail,
  reminderSmsText,
  unsubscribeToken,
  windowFor,
} from '../src/lib/notifications/appointmentReminders';
import { runSmsEmailReminders } from '../src/lib/notifications/triggers/smsEmailReminders';
import { appointmentConfirmationSms } from '../src/patient/infrastructure/notifications/templates';

const TZ = 'America/New_York';
const ALL_ON = { smsReminder24h: true, smsReminder2h: true, emailReminder24h: true };
const ALL_OFF = { smsReminder24h: false, smsReminder2h: false, emailReminder24h: false };
const CONSENTED = { phone: '4105550100', smsConsent: true, smsOptOutAt: null, email: 'p@example.com', emailOptOutAt: null };

test('windows: 24h and 2h only', () => {
  const now = new Date('2026-10-18T13:00:00Z');
  assert.equal(windowFor(new Date(now.getTime() + 24 * 3600_000), now), '24h');
  assert.equal(windowFor(new Date(now.getTime() + 120 * 60_000), now), '2h');
  assert.equal(windowFor(new Date(now.getTime() + 6 * 3600_000), now), null);
  assert.equal(channelEnabled(ALL_ON, 'email', '2h'), false, 'no 2h email setting');
});

test('eligibility: settings, consent, opt-out, contact on file', () => {
  assert.deepEqual(reminderDecision(ALL_ON, 'sms', '24h', CONSENTED), { send: true });
  assert.deepEqual(reminderDecision(ALL_OFF, 'sms', '24h', CONSENTED), { send: false, reason: 'setting_off' });
  assert.deepEqual(reminderDecision(ALL_ON, 'sms', '2h', { ...CONSENTED, smsConsent: false }), { send: false, reason: 'no_sms_consent' });
  assert.deepEqual(reminderDecision(ALL_ON, 'sms', '24h', { ...CONSENTED, smsOptOutAt: new Date() }), { send: false, reason: 'sms_opted_out' });
  assert.deepEqual(reminderDecision(ALL_ON, 'email', '24h', { ...CONSENTED, emailOptOutAt: new Date() }), { send: false, reason: 'email_opted_out' });
  assert.deepEqual(reminderDecision(ALL_ON, 'email', '24h', { ...CONSENTED, email: null }), { send: false, reason: 'no_email' });
});

test('SMS reminder wording: practice, date, ET time, C to confirm, STOP to opt out', () => {
  const sms = reminderSmsText({ practiceName: 'MD Behavioral Health', startsAt: new Date('2026-10-19T13:00:00Z'), timeZone: TZ });
  assert.equal(sms, 'Reminder: you have an appointment with MD Behavioral Health on Mon Oct 19 at 9:00 AM ET. Reply C to confirm, STOP to opt out.');
  // DST: Nov 2 2026 is after fall-back, 9:00 AM EST is 14:00Z
  assert.match(reminderSmsText({ practiceName: 'X', startsAt: new Date('2026-11-02T14:00:00Z'), timeZone: TZ }), /Mon Nov 2 at 9:00 AM ET/);
});

test('content: no clinician name, visit type or client name on SMS / email / confirmation', () => {
  const sms = reminderSmsText({ practiceName: 'MD Behavioral Health', startsAt: new Date('2026-10-19T13:00:00Z'), timeZone: TZ });
  const email = reminderEmail({
    practiceName: 'MD Behavioral Health',
    startsAt: new Date('2026-10-19T13:00:00Z'),
    timeZone: TZ,
    isVirtual: true,
    portalUrl: 'https://staging.altrixs.com/patient',
    unsubscribeUrl: 'https://staging.altrixs.com/api/notifications/unsubscribe?t=abc',
  });
  const confirm = appointmentConfirmationSms({
    date: '2026-10-19', startTime: '09:00', endTime: '09:50', clinicianName: 'Dr. Smith', timeZone: TZ,
    ...({ type: 'Psychiatric Evaluation' } as object),
  } as any);
  for (const text of [sms, email.text, email.html, email.subject, confirm]) {
    assert.doesNotMatch(text, /Dr\.? Smith|Psychiatric|Therapy|Evaluation|Medication/i);
  }
  assert.match(confirm, /Reply STOP to opt out/);
  assert.equal(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(email.text, /unsubscribe\?t=abc/);
});

test('unsubscribe token round-trips and rejects tampering', () => {
  const t = unsubscribeToken('client_123', 'secret');
  assert.equal(readUnsubscribeToken(t, 'secret'), 'client_123');
  assert.equal(readUnsubscribeToken(t, 'other-secret'), null);
  assert.equal(readUnsubscribeToken(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 'secret'), null);
  assert.equal(readUnsubscribeToken(`${Buffer.from('client_999').toString('base64url')}.${t.split('.')[1]}`, 'secret'), null);
  assert.equal(readUnsubscribeToken('', 'secret'), null);
});

function fakeDb(appts: any[]) {
  const logs = new Map<string, any>();
  return {
    logs,
    db: {
      appointment: { findMany: async () => appts },
      notificationLog: {
        create: async (a: any) => {
          if (logs.has(a.data.dedupeKey)) throw Object.assign(new Error('dup'), { code: 'P2002' });
          logs.set(a.data.dedupeKey, { ...a.data });
          return a.data;
        },
        update: async (a: any) => Object.assign(logs.get(a.where.dedupeKey), a.data),
      },
    },
  };
}

test('runner: sends per settings + consent, logs skipped with reason, dedupes across runs', async () => {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret';
  const now = new Date('2026-10-18T13:00:00Z');
  const starts = new Date(now.getTime() + 24 * 3600_000);
  const f = fakeDb([
    { id: 'a1', organizationId: 'o1', clientId: 'c1', startsAt: starts, isVirtual: false, client: { id: 'c1', ...CONSENTED } },
    { id: 'a2', organizationId: 'o1', clientId: 'c2', startsAt: starts, isVirtual: true, client: { id: 'c2', ...CONSENTED, smsConsent: false } },
  ]);
  const smsSent: any[] = [];
  const emailSent: any[] = [];
  const deps = {
    db: f.db,
    sendSms: (async (x: any) => { smsSent.push(x); return { mode: 'sms' }; }) as any,
    sendEmail: (async (x: any) => { emailSent.push(x); return { mode: 'ses' }; }) as any,
    timeZone: async () => TZ,
    orgSettings: async () => ({ reminders: ALL_ON, practiceName: 'MD Behavioral Health', contactPhone: null }),
    baseUrl: () => 'https://staging.altrixs.com',
  };
  const r1 = await runSmsEmailReminders(now, deps);
  assert.equal(r1.sms.sent, 1);
  assert.equal(r1.sms.skipped, 1);
  assert.equal(r1.email.sent, 2);
  assert.equal(f.logs.get('appt-reminder:a2:sms:24h').reason, 'no_sms_consent');
  assert.equal(f.logs.get('appt-reminder:a1:sms:24h').status, 'sent');
  assert.equal(f.logs.get('appt-reminder:a1:sms:24h').appointmentId, 'a1');
  assert.ok(emailSent[0].headers['List-Unsubscribe']);

  const r2 = await runSmsEmailReminders(now, deps);
  assert.equal(r2.sms.sent + r2.email.sent + r2.sms.skipped, 0, 'second run sends nothing');
  assert.equal(smsSent.length, 1);

  const off = fakeDb([{ id: 'a3', organizationId: 'o1', clientId: 'c1', startsAt: starts, isVirtual: false, client: { id: 'c1', ...CONSENTED } }]);
  const r3 = await runSmsEmailReminders(now, { ...deps, db: off.db, orgSettings: async () => ({ reminders: ALL_OFF, practiceName: 'X', contactPhone: null }) });
  assert.equal(r3.sms.sent + r3.email.sent, 0);
  assert.equal(off.logs.size, 0);
});

test('runner: a send failure is logged failed, not retried', async () => {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret';
  const now = new Date('2026-10-18T13:00:00Z');
  const f = fakeDb([{ id: 'a1', organizationId: 'o1', clientId: 'c1', startsAt: new Date(now.getTime() + 120 * 60_000), isVirtual: false, client: { id: 'c1', ...CONSENTED } }]);
  let calls = 0;
  const deps = {
    db: f.db,
    sendSms: (async () => { calls++; throw new Error('throttled'); }) as any,
    sendEmail: (async () => ({ mode: 'ses' })) as any,
    timeZone: async () => TZ,
    orgSettings: async () => ({ reminders: ALL_ON, practiceName: 'X', contactPhone: null }),
    baseUrl: () => 'https://x',
  };
  const r = await runSmsEmailReminders(now, deps);
  assert.equal(r.sms.failed, 1);
  assert.equal(f.logs.get('appt-reminder:a1:sms:2h').status, 'failed');
  await runSmsEmailReminders(now, deps);
  assert.equal(calls, 1);
});
