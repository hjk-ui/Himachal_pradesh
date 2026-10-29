import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { canTextFor, sendPatientSms, type PatientSmsDeps } from '../src/lib/sms/patientSms';
import { PATIENT_SMS_PURPOSES, lintPatientSms, smsSender, type PatientSmsPurpose } from '../src/lib/sms/contentRules';
import {
  portalInviteSms,
  documentsToSignSms,
  measureRequestSms,
  portalNoticeSms,
  securityCodeSms,
  telehealthReadySms,
  telehealthScheduledSms,
  withOptOutFooter,
} from '../src/lib/sms/templates';
import { STAFF_TEXT_TEMPLATES, sendStaffAlertSms, staffAlertText } from '../src/lib/sms/staff';
import { statementSmsText } from '../src/lib/billing/statementSms';
import { reminderSmsText } from '../src/lib/notifications/appointmentReminders';
import { runSmsEmailReminders } from '../src/lib/notifications/triggers/smsEmailReminders';
import { appointmentConfirmationSms } from '../src/patient/infrastructure/notifications/templates';
import { helpReplyText, stopReplyText, unstopReplyText, confirmReplyText } from '../src/lib/sms/keywords';
import { revocationEffects } from '../src/lib/consents/library/revocation';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fake deps: an in-memory client table + NotificationLog + audit, recording what was handed to AWS
// ---------------------------------------------------------------------------------------------
type FakeClient = { id: string; organizationId: string; name: string; phone: string | null; smsConsent: boolean; smsOptOutAt: Date | null };

function harness(client: Partial<FakeClient> | null, practice: Partial<{ practiceName: string | null; showPracticeName: boolean; smsConfirm: boolean }> = {}) {
  const row: FakeClient | null = client
    ? { id: 'c1', organizationId: 'o1', name: 'Jordan Rivers', phone: '410-555-0100', smsConsent: true, smsOptOutAt: null, ...client }
    : null;
  const sent: { to: string; body: string }[] = [];
  const logs: any[] = [];
  const audits: any[] = [];
  const deps: PatientSmsDeps = {
    db: {
      client: { findUnique: async (a: any) => (row && a.where.id === row.id ? row : null) },
      notificationLog: { create: async (a: any) => { logs.push(a.data); return a.data; } },
    },
    send: (async (x: any) => { sent.push({ to: x.to, body: x.body }); return { mode: 'sms', messageId: 'm1' }; }) as any,
    configured: () => true,
    audit: (async (e: any) => { audits.push(e); }) as any,
    practice: async () => ({ practiceName: 'MD Behavioral Health', showPracticeName: true, smsConfirm: true, ...practice }),
  };
  return { deps, sent, logs, audits };
}

/** One builder per former sender path (same template the production caller uses). */
const BUILDERS: Record<PatientSmsPurpose, (ctx: { sender: string }) => string> = {
  appointment_confirmation: ({ sender }) => appointmentConfirmationSms({ date: '2026-10-21', startTime: '09:00', endTime: '09:50', practiceName: sender }),
  appointment_reminder: ({ sender }) => reminderSmsText({ practiceName: sender, startsAt: new Date('2026-10-21T13:00:00Z'), timeZone: 'America/New_York' }),
  telehealth_scheduled: ({ sender }) => telehealthScheduledSms({ sender, date: 'Wed Oct 21', time: '9:00 AM ET', joinUrl: 'https://staging.altrixs.com/telehealth/join/tok' }),
  telehealth_join_link: ({ sender }) => telehealthReadySms({ sender, joinUrl: 'https://staging.altrixs.com/telehealth/join/tok' }),
  portal_notice: ({ sender }) => portalNoticeSms({ sender }),
  statement_ready: ({ sender }) => statementSmsText(sender, 'https://staging.altrixs.com/patient/home'),
  portal_invite: ({ sender }) => portalInviteSms({ sender, acceptUrl: 'https://staging.altrixs.com/patient/accept?token=abc' }),
  documents_to_sign: ({ sender }) => documentsToSignSms({ sender, portalUrl: 'https://staging.altrixs.com/patient/documents' }),
  staff_message: () => 'Please call the front desk when you can.',
  security_code: () => securityCodeSms({ code: '123456' }),
  measure_request: ({ sender }) => measureRequestSms({ sender, url: 'https://staging.altrixs.com/m/AbCdEfGhIjKlMnOpQrStUvWxYz012345' }),
};
const CONSENT_PURPOSES = (Object.keys(PATIENT_SMS_PURPOSES) as PatientSmsPurpose[]).filter((p) => PATIENT_SMS_PURPOSES[p].consent === 'explicit');

// ---------------------------------------------------------------------------------------------
// Every sender goes through the gate
// ---------------------------------------------------------------------------------------------
test('no patient-facing file calls sendSms directly (only the gate, staff texts, keyword replies, reminder cron)', () => {
  const allowed = new Set([
    'src/lib/sms/send.ts',
    'src/lib/sms/sns.ts', // transport used by send.ts
    'src/lib/sms/patientSms.ts', // THE patient gate
    'src/lib/sms/staff.ts', // staff phones (fixed, PHI-free templates)
    'src/lib/sms/inbound.ts', // STOP / HELP / START / C keyword replies (CTIA)
    'src/lib/notifications/triggers/smsEmailReminders.ts', // reminders: gated by reminderDecision -> smsEligibility
    'src/lib/marketing/send.ts', // leads / opted-in marketing contacts only: marketing consent gate (src/lib/marketing/consent.ts)
  ]);
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (allowed.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    const importsSend = /import\s*\{[^}]*\bsendSms\b[^}]*\}\s*from\s*['"]@\/lib\/sms\/send['"]/.test(src) || /\{\s*sendSms\s*\}\s*=\s*await import\(['"]@\/lib\/sms\/send['"]\)/.test(src);
    const publishes = /publishSnsSms|SendTextMessageCommand/.test(src);
    if (importsSend || publishes) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `send texts through sendPatientSms (src/lib/sms/patientSms.ts): ${offenders.join(', ')}`);
});

test('each former sender path now uses the gate with its purpose', () => {
  const expect: [string, string][] = [
    ['src/patient/infrastructure/notifications/sms.ts', "purpose: 'appointment_confirmation'"],
    ['src/patient/infrastructure/notifications/sms.ts', "purpose: 'portal_invite'"],
    ['src/lib/telehealth/manage.ts', "purpose: 'telehealth_scheduled'"],
    ['src/app/api/telehealth/room/route.ts', "purpose: 'telehealth_join_link'"],
    ['src/app/api/telehealth/admin/actions/route.ts', "purpose: 'telehealth_join_link'"],
    ['src/lib/labs/manage.ts', "purpose: 'portal_notice'"],
    ['src/lib/billing/statements.ts', "purpose: 'statement_ready'"],
    ['src/lib/connect/service.ts', "purpose: 'staff_message'"],
  ];
  for (const [file, needle] of expect) {
    const src = read(file);
    assert.ok(src.includes('sendPatientSms('), `${file} calls sendPatientSms`);
    assert.ok(src.includes(needle), `${file} has ${needle}`);
    assert.doesNotMatch(src, /MD Behavioral Health:/, `${file}: no hard-coded specialty sender`);
  }
  // appointments: no separate consent shortcut any more; the gate decides and the result is returned
  const appt = read('src/lib/appointments/manage.ts');
  assert.doesNotMatch(appt, /canTextClient/);
  assert.match(appt, /sendAppointmentCreatedSms\(\{\s*clientId: client\.id/);
});

for (const purpose of CONSENT_PURPOSES) {
  test(`${purpose}: skipped without consent, logged with reason, nothing sent`, async () => {
    const h = harness({ smsConsent: false });
    const r = await sendPatientSms({ clientId: 'c1', organizationId: 'o1', purpose, build: BUILDERS[purpose] }, h.deps);
    assert.equal(r.sent, false);
    assert.equal(r.status, 'skipped');
    assert.equal('reason' in r && r.reason, 'no_sms_consent');
    assert.equal(r.message, 'Not sent: client has not consented to text messages.');
    assert.equal(h.sent.length, 0);
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].status, 'skipped');
    assert.equal(h.logs[0].reason, 'no_sms_consent');
    assert.equal(h.logs[0].channel, 'sms');
    assert.equal(h.logs[0].type, purpose);
    assert.equal(h.logs[0].body, '(message text not stored)');
    assert.equal(h.audits[0].action, 'PATIENT_SMS_NOT_SENT');
    assert.equal(h.audits[0].outcome, 'DENIED');
    assert.equal(h.audits[0].metadata.reason, 'no_sms_consent');
  });

  test(`${purpose}: sent with consent to the charted number; template passes the content rules`, async () => {
    const h = harness({});
    const r = await sendPatientSms({ clientId: 'c1', organizationId: 'o1', purpose, build: BUILDERS[purpose] }, h.deps);
    assert.equal(r.sent, true, JSON.stringify(r));
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].to, '+14105550100');
    assert.match(h.sent[0].body, /\bSTOP\b[^.]*opt.?out/i);
    assert.equal(h.logs[0].status, 'sent');
    assert.ok(!JSON.stringify(h.logs).includes(h.sent[0].body), 'NotificationLog never holds the text');
    assert.ok(!JSON.stringify(h.audits).includes(h.sent[0].body), 'audit never holds the text');
  });
}

test('STOP blocks every purpose, including a requested security code', async () => {
  for (const purpose of Object.keys(PATIENT_SMS_PURPOSES) as PatientSmsPurpose[]) {
    const h = harness({ smsConsent: true, smsOptOutAt: new Date('2026-10-19T12:00:00Z') });
    const r = await sendPatientSms({ clientId: 'c1', purpose, build: BUILDERS[purpose], phoneVerified: true }, h.deps);
    assert.equal(r.sent, false, purpose);
    assert.equal('reason' in r && r.reason, 'sms_opted_out', purpose);
    assert.match(r.message, /opted out/);
    assert.equal(h.sent.length, 0);
  }
});

test('revoked text-message consent blocks (revocation effect = smsConsent false + smsOptOutAt)', async () => {
  const effects = revocationEffects({ effects: ['sms', 'email'] } as any, null);
  assert.ok(effects.some((e) => e.kind === 'sms_opt_out'));
  // what store2.ts writes for sms_opt_out
  const h = harness({ smsConsent: false, smsOptOutAt: new Date('2026-10-20T10:00:00Z') });
  const r = await sendPatientSms({ clientId: 'c1', purpose: 'telehealth_join_link', build: BUILDERS.telehealth_join_link }, h.deps);
  assert.equal(r.sent, false);
  assert.equal('reason' in r && r.reason, 'sms_opted_out');
  assert.equal(h.sent.length, 0);
  assert.equal(h.logs[0].reason, 'sms_opted_out');
});

test('OTP: a patient-requested security code is allowed without smsConsent when the number is verified', async () => {
  const h = harness({ smsConsent: false });
  const r = await sendPatientSms({ clientId: 'c1', purpose: 'security_code', phoneVerified: true, build: BUILDERS.security_code }, h.deps);
  assert.equal(r.sent, true);
  assert.equal(h.sent[0].body, 'Your verification code is 123456. It expires in 2 minutes. Do not share it.');
  const unverified = harness({ smsConsent: false });
  const r2 = await sendPatientSms({ clientId: 'c1', purpose: 'security_code', build: BUILDERS.security_code }, unverified.deps);
  assert.equal('reason' in r2 && r2.reason, 'number_not_verified');
  assert.equal(unverified.sent.length, 0);
});

test('only the charted number: a typed-in other number is refused; missing / invalid numbers are typed', () => {
  const c = { id: 'c1', phone: '(410) 555-0100', smsConsent: true, smsOptOutAt: null };
  assert.deepEqual(canTextFor(c, 'telehealth_join_link', { to: '+14105550100' }), { ok: true, to: '+14105550100' });
  assert.deepEqual(canTextFor(c, 'telehealth_join_link', { to: '+14105559999' }), { ok: false, reason: 'number_not_on_file' });
  assert.deepEqual(canTextFor({ ...c, phone: null }, 'portal_notice'), { ok: false, reason: 'no_phone' });
  assert.deepEqual(canTextFor({ ...c, phone: '555' }, 'portal_notice'), { ok: false, reason: 'invalid_phone' });
  assert.deepEqual(canTextFor(null, 'portal_notice'), { ok: false, reason: 'client_not_found' });
});

test('another organization\'s client is never texted', async () => {
  const h = harness({ organizationId: 'o2' });
  const r = await sendPatientSms({ clientId: 'c1', organizationId: 'o1', purpose: 'portal_notice', build: BUILDERS.portal_notice }, h.deps);
  assert.equal('reason' in r && r.reason, 'client_not_found');
  assert.equal(h.sent.length, 0);
  assert.equal(h.logs.length, 0, 'no log row on the other org client');
});

test('appointment confirmation honors the practice "SMS confirmation" setting', async () => {
  const h = harness({}, { smsConfirm: false });
  const r = await sendPatientSms({ clientId: 'c1', purpose: 'appointment_confirmation', build: BUILDERS.appointment_confirmation }, h.deps);
  assert.equal('reason' in r && r.reason, 'setting_off');
  assert.equal(h.sent.length, 0);
});

test('practice name only when the practice allows it; otherwise "Your care team"', async () => {
  const off = harness({}, { showPracticeName: false });
  await sendPatientSms({ clientId: 'c1', purpose: 'portal_notice', build: BUILDERS.portal_notice }, off.deps);
  assert.match(off.sent[0].body, /^Your care team: /);
  assert.doesNotMatch(off.sent[0].body, /Behavioral/);
  const on = harness({});
  await sendPatientSms({ clientId: 'c1', purpose: 'portal_notice', build: BUILDERS.portal_notice }, on.deps);
  assert.match(on.sent[0].body, /^MD Behavioral Health: /);
  assert.equal(smsSender('  ', true), 'Your care team');
});

test('content guard: staff free text with clinical or billing detail is blocked; opt-out appended', async () => {
  const blocked = harness({});
  const r = await sendPatientSms({ clientId: 'c1', purpose: 'staff_message', build: () => 'Your therapy copay balance is $40' }, blocked.deps);
  assert.equal('reason' in r && r.reason, 'content_blocked');
  assert.ok('issues' in r && r.issues?.includes('phi_term') && r.issues.includes('money'));
  assert.equal(blocked.sent.length, 0);
  const ok = harness({});
  await sendPatientSms({ clientId: 'c1', purpose: 'staff_message', build: BUILDERS.staff_message }, ok.deps);
  assert.equal(ok.sent[0].body, 'Please call the front desk when you can. Reply STOP to opt out.');
  assert.equal(withOptOutFooter('Hi. Reply STOP to opt out.'), 'Hi. Reply STOP to opt out.');
});

test('a send failure is reported, never a fake success; dev console output is not "sent"', async () => {
  const h = harness({});
  h.deps.send = (async () => { throw new Error('throttled'); }) as any;
  const r = await sendPatientSms({ clientId: 'c1', purpose: 'portal_notice', build: BUILDERS.portal_notice }, h.deps);
  assert.equal(r.sent, false);
  assert.equal(r.status, 'failed');
  assert.equal('reason' in r && r.reason, 'send_error');
  assert.equal(h.logs[0].status, 'failed');
  const dev = harness({});
  dev.deps.send = (async () => ({ mode: 'console' })) as any;
  const r2 = await sendPatientSms({ clientId: 'c1', purpose: 'portal_notice', build: BUILDERS.portal_notice }, dev.deps);
  assert.equal(r2.sent, false);
  assert.equal('reason' in r2 && r2.reason, 'sms_not_configured');
});

// ---------------------------------------------------------------------------------------------
// Template PHI scan (lint): every patient template, with a neutral sender and with a practice name
// ---------------------------------------------------------------------------------------------
test('template scan: no PHI, balances, names or unexpected links; opt-out wording on non-transactional texts', () => {
  for (const purpose of Object.keys(BUILDERS) as PatientSmsPurpose[]) {
    for (const sender of ['Your care team', 'MD Behavioral Health', 'Divine Counseling']) {
      const built = BUILDERS[purpose]({ sender });
      const body = PATIENT_SMS_PURPOSES[purpose].freeText ? withOptOutFooter(built) : built; // as the gate does
      assert.deepEqual(lintPatientSms(body, { purpose, sender, clientName: 'Jordan Rivers' }), [], `${purpose} / ${sender}: ${body}`);
    }
  }
  // Keyword replies (not consent-gated) still carry no PHI
  for (const body of [helpReplyText({ practiceName: 'Your care team', contactPhone: '410-555-0000' }), stopReplyText('Your care team'), unstopReplyText('Your care team'), confirmReplyText('Your care team')]) {
    assert.deepEqual(lintPatientSms(body, { purpose: 'security_code', sender: 'Your care team' }), [], body);
  }
});

test('template scan catches the old texts (specialty sender, clinician, lab, balance, client name)', () => {
  const lint = (body: string, purpose: PatientSmsPurpose = 'telehealth_scheduled') => lintPatientSms(body, { purpose, sender: null, clientName: 'Jordan Rivers' });
  assert.ok(lint('MD Behavioral Health: Your virtual visit with Dr. Smith is scheduled. Access link: https://x').includes('phi_term'));
  assert.ok(lint('Your lab results: A1C 7.2 mg/dL', 'portal_notice').includes('phi_term'));
  assert.ok(lint('Your balance is $120.00. Reply STOP to opt out.', 'statement_ready').includes('money'));
  assert.ok(lint('Hi Jordan, your visit is ready. Reply STOP to opt out.').includes('client_name'));
  assert.ok(lint('Altrixs: set your password: https://x', 'portal_invite').includes('missing_opt_out'));
  assert.ok(lint('See https://x. Reply STOP to opt out.', 'portal_notice').includes('link_not_allowed'));
  assert.ok(lint('Diagnosis F32.1 on file. Reply STOP to opt out.', 'portal_notice').includes('phi_term'));
});

// ---------------------------------------------------------------------------------------------
// Reminder cron: practice-name toggle; NotificationLog keeps no message text
// ---------------------------------------------------------------------------------------------
test('reminder cron: honors "show practice name", logs without the message text, dev console is not "sent"', async () => {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret';
  const now = new Date('2026-10-18T13:00:00Z');
  const logs = new Map<string, any>();
  const db = {
    appointment: {
      findMany: async () => [
        { id: 'a1', organizationId: 'o1', clientId: 'c1', startsAt: new Date(now.getTime() + 24 * 3600_000), isVirtual: false, client: { id: 'c1', phone: '4105550100', smsConsent: true, smsOptOutAt: null, email: null, emailOptOutAt: null } },
      ],
    },
    notificationLog: {
      create: async (a: any) => { logs.set(a.data.dedupeKey, { ...a.data }); return a.data; },
      update: async (a: any) => Object.assign(logs.get(a.where.dedupeKey), a.data),
    },
  };
  const texts: string[] = [];
  const r = await runSmsEmailReminders(now, {
    db,
    sendSms: (async (x: any) => { texts.push(x.body); return { mode: 'console' }; }) as any,
    sendEmail: (async () => ({ mode: 'ses' })) as any,
    timeZone: async () => 'America/New_York',
    orgSettings: async () => ({ reminders: { smsReminder24h: true, smsReminder2h: true, emailReminder24h: false, smsShowPracticeName: false }, practiceName: 'Divine Counseling', contactPhone: null }),
    baseUrl: () => 'https://x',
  });
  assert.equal(texts.length, 1);
  assert.match(texts[0], /appointment with your care team/);
  assert.doesNotMatch(texts[0], /Counseling/);
  const log = logs.get('appt-reminder:a1:sms:24h');
  assert.equal(log.body, '(message text not stored)');
  assert.equal(log.status, 'failed');
  assert.equal(log.reason, 'sms_not_configured');
  assert.equal(r.sms.sent, 0);
});

// ---------------------------------------------------------------------------------------------
// Staff texts: not a patient consent path, fixed PHI-free templates
// ---------------------------------------------------------------------------------------------
test('staff texts are unaffected by patient consent and carry no patient information', async () => {
  const calls: any[] = [];
  const r = await sendStaffAlertSms({ to: '+14105550199', kind: 'high_severity_alert' }, (async (x: any) => { calls.push(x); return { mode: 'sms' }; }) as any);
  assert.equal(r.mode, 'sms');
  assert.equal(calls[0].body, 'Altrixs: New high-severity alert. Open Altrixs to review.');
  assert.equal(calls[0].context, 'staff-high_severity_alert');
  assert.equal(staffAlertText('crisis_page'), 'Altrixs: Urgent page. Open Altrixs now.');
  for (const t of STAFF_TEXT_TEMPLATES) {
    assert.deepEqual(lintPatientSms(t, { purpose: 'security_code', sender: 'Altrixs' }), [], t);
    assert.doesNotMatch(t, /\$\{|client|patient|MRN|risk/i);
  }
  const staffSrc = read('src/lib/sms/staff.ts');
  assert.doesNotMatch(staffSrc, /from '@\/lib\/sms\/(patientSms|consent)'/);
  assert.match(staffSrc, /STAFF texts/);
});
