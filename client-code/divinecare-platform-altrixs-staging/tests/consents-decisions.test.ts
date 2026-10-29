/**
 * Consent decisions (src/lib/consents/library/decisions.ts): the check-in soft stop (which consents
 * block, override reason, unapproved template never blocks, virtual vs in person) and the automatic
 * reminder schedule math and caps. Plus wiring checks on the check-in route, reminder job and cron.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  checkInAllowed,
  checkInBlockingKeys,
  decideCheckInConsents,
  MAX_REMINDERS,
  nextTracker,
  onFileStatus,
  OVERRIDE_REASON_MIN,
  packetReminderStage,
  reminderChannels,
  renewalReminderStage,
  VALIDITY_POLICY,
  type CheckInConsentFact,
} from '../src/lib/consents/library/decisions';
import { REQUIREMENT_RULES, requiredConsents } from '../src/lib/consents/library/requirements';
import type { ConsentRowLite } from '../src/lib/consents/library/status';
import type { PacketClientContext } from '../src/lib/consents/library/composer';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = new Date('2026-10-22T15:00:00Z');
const DAY = 86_400_000;
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

const TREAT = 'informed-consent-treatment';
const TELE = 'telehealth-consent';
const fact = (key: string, status: CheckInConsentFact['status'], templateAvailable = true): CheckInConsentFact => ({ key, title: key, status, templateAvailable });

// ─── Soft stop ───────────────────────────────────────────────────────────────

test('soft stop: in person blocks only on the consent to treatment; virtual adds the telehealth consent', () => {
  assert.deepEqual(checkInBlockingKeys(false), [TREAT]);
  assert.deepEqual(checkInBlockingKeys(true), [TREAT, TELE]);
  const inPerson = decideCheckInConsents({ isVirtual: false, facts: [fact(TREAT, 'valid'), fact(TELE, 'missing')] });
  assert.equal(inPerson.overrideRequired, false);
  assert.deepEqual(inPerson.blocking, []);
  assert.deepEqual(inPerson.flags.map((f) => f.key), [TELE], 'telehealth consent is a flag for an in-person visit');
  const virtual = decideCheckInConsents({ isVirtual: true, facts: [fact(TREAT, 'valid'), fact(TELE, 'missing')] });
  assert.equal(virtual.overrideRequired, true);
  assert.deepEqual(virtual.blocking.map((b) => b.key), [TELE]);
});

test('soft stop: missing / expired / revoked / declined / pending treatment consent blocks', () => {
  for (const s of ['missing', 'expired', 'revoked', 'declined', 'pending'] as const) {
    const d = decideCheckInConsents({ isVirtual: false, facts: [fact(TREAT, s)] });
    assert.equal(d.overrideRequired, true, s);
    assert.deepEqual(d.blocking.map((b) => b.key), [TREAT], s);
  }
});

test('soft stop: expiring or needs-re-sign still satisfies (flag only)', () => {
  for (const s of ['expiring', 'needs_resign'] as const) {
    const d = decideCheckInConsents({ isVirtual: true, facts: [fact(TREAT, s), fact(TELE, s)] });
    assert.equal(d.overrideRequired, false, s);
    assert.equal(d.flags.length, 2, s);
  }
});

test('soft stop: a required consent whose template is not approved never blocks', () => {
  const d = decideCheckInConsents({ isVirtual: true, facts: [fact(TREAT, 'missing', false), fact(TELE, 'missing', false)] });
  assert.equal(d.overrideRequired, false);
  assert.deepEqual(d.blocking, []);
  assert.equal(d.flags.length, 2);
  assert.ok(d.flags.every((f) => /not approved/.test(f.detail)));
  assert.deepEqual(checkInAllowed(d, null), { ok: true, override: null });
});

test('soft stop: other missing consents are flags only', () => {
  const d = decideCheckInConsents({ isVirtual: false, facts: [fact(TREAT, 'valid'), fact('npp-acknowledgment', 'missing'), fact('communication-consent', 'expired'), fact('recording-transcription-consent', 'missing', false)] });
  assert.equal(d.overrideRequired, false);
  assert.deepEqual(d.flags.map((f) => f.key), ['npp-acknowledgment', 'communication-consent', 'recording-transcription-consent']);
});

test('soft stop: override needs a reason of at least 10 characters', () => {
  const d = decideCheckInConsents({ isVirtual: false, facts: [fact(TREAT, 'missing')] });
  assert.equal(OVERRIDE_REASON_MIN, 10);
  assert.equal(checkInAllowed(d, undefined).ok, false);
  assert.equal(checkInAllowed(d, '   ').ok, false);
  assert.equal(checkInAllowed(d, 'too short').ok, false);
  assert.equal(checkInAllowed(d, '  123456789  ').ok, false, 'trimmed length counts');
  assert.deepEqual(checkInAllowed(d, '  Signed on paper  '), { ok: true, override: 'Signed on paper' });
});

const row = (p: Partial<ConsentRowLite>): ConsentRowLite => ({
  id: Math.random().toString(36).slice(2),
  formKey: `lib:${TREAT}`,
  type: 'Consent to Treat',
  formVersion: '1',
  status: 'SIGNED',
  formStatus: 'COMPLETE',
  signedAt: days(-100),
  expiresAt: days(200),
  revokedAt: null,
  createdAt: days(-100),
  signedByName: null,
  recipientName: null,
  ...p,
});

test('on file: a valid signed consent wins over a newer unsigned renewal copy', () => {
  const rows = [row({}), row({ status: 'PENDING', formStatus: 'SENT', signedAt: null, expiresAt: null, createdAt: days(-1) })];
  assert.equal(onFileStatus(rows, TREAT, null, NOW), 'valid');
  assert.equal(onFileStatus([row({ expiresAt: days(10) })], TREAT, null, NOW), 'expiring');
  assert.equal(onFileStatus([row({ expiresAt: days(-1) })], TREAT, null, NOW), 'expired');
  assert.equal(onFileStatus([row({ revokedAt: days(-2) })], TREAT, null, NOW), 'revoked');
  assert.equal(onFileStatus([row({ formStatus: 'VOIDED' })], TREAT, null, NOW), 'missing');
  assert.equal(onFileStatus([], TREAT, null, NOW), 'missing');
  assert.equal(onFileStatus([row({ formKey: null, type: 'Consent to Treat' })], TREAT, null, NOW), 'valid', 'legacy consent counts');
});

test('check-in route + updateAppointment enforce the soft stop (409 CONSENT_REQUIRED) and audit the override without the reason', () => {
  const manage = read('src/lib/appointments/manage.ts');
  assert.match(manage, /data\.status === 'CHECKED_IN' && existing\.status !== 'CHECKED_IN'/);
  assert.match(manage, /return consentRequiredFailure\(allowed\.error, decision, nextVirtual\)/);
  assert.match(read('src/lib/consents/library/decisions.ts'), /status: 409, code: CONSENT_REQUIRED_CODE/);
  assert.match(manage, /recordCheckInOverride/);
  const route = read('src/app/api/appointments/[id]/route.ts');
  assert.match(route, /consentOverrideReason/);
  assert.match(route, /CONSENT_CHECKIN_OVERRIDE_ACTION/);
  const audit = route.slice(route.indexOf('action: CONSENT_CHECKIN_OVERRIDE_ACTION'), route.indexOf('action: CONSENT_CHECKIN_OVERRIDE_ACTION') + 500);
  assert.doesNotMatch(audit, /reason/i, 'override reason never goes into audit metadata');
  const page = read('src/app/dashboard/appointments/page.tsx');
  assert.match(page, /CheckInConsentDialog/);
  const dialog = read('src/components/consents/CheckInConsentDialog.tsx');
  assert.match(dialog, /Consent needed before this visit/);
  assert.match(dialog, /Have the client sign now/);
  assert.match(dialog, /Check in anyway/);
  assert.match(dialog, /method: 'in_office', keys: prompt\.missing\.map/);
});

// ─── Rules ───────────────────────────────────────────────────────────────────

const ctx = (p: Partial<PacketClientContext> = {}): PacketClientContext => ({ ageYears: 40, services: ['omhc'], medicaid: false, emergencyContact: null, signals: { aot: false, autopay: false, smsConsent: false, aiScribe: false }, ...p });

test('rules: AI scribe audio requires the recording consent (Maryland all-party) and texts require the communication consent (TCPA); AOT adds none', () => {
  const keys = (c: PacketClientContext) => requiredConsents(c).map((r) => r.key);
  assert.ok(keys(ctx({ signals: { aiScribe: true } })).includes('recording-transcription-consent'));
  assert.ok(keys(ctx({ signals: { smsConsent: true } })).includes('communication-consent'));
  assert.ok(!keys(ctx()).includes('recording-transcription-consent'));
  assert.ok(!keys(ctx()).includes('communication-consent'));
  assert.deepEqual(keys(ctx({ signals: { aot: true } })), keys(ctx()));
  const rec = REQUIREMENT_RULES.find((r) => r.key === 'recording-transcription-consent')!;
  assert.match(rec.basis, /Maryland all-party recording consent, confirm with compliance/);
  assert.match(REQUIREMENT_RULES.find((r) => r.key === 'communication-consent')!.basis, /TCPA/);
  assert.match(read('src/lib/consents/library/requirements.ts'), /AOT: adds NO required consent/);
});

test('validity policy documents 12 months, ROI 1 year unless stated, 30-day expiring window', () => {
  const text = VALIDITY_POLICY.map((p) => `${p.label}: ${p.rule}`).join('\n');
  for (const l of ['Consent to treatment', 'Financial responsibility', 'Telehealth consent', 'Program rules', 'minor', 'Primary care']) assert.match(text, new RegExp(`${l}[^\n]*12 months`, 'i'));
  assert.match(text, /ROI\)?: 1 year from signing unless the ROI states its own expiration date or event/);
  assert.match(text, /30 days/);
});

// ─── Reminder schedule ───────────────────────────────────────────────────────

test('packet reminders: 3 and 7 days after sending, each once, never late catch-up', () => {
  const sent = days(-2);
  assert.equal(packetReminderStage(sent, NOW), null, 'day 2: nothing');
  assert.equal(packetReminderStage(days(-3), NOW), 'd3');
  assert.equal(packetReminderStage(days(-5), NOW, { count: 1, stages: ['d3'] }), null, 'd3 done');
  assert.equal(packetReminderStage(days(-7), NOW, { count: 1, stages: ['d3'] }), 'd7');
  assert.equal(packetReminderStage(days(-9), NOW, { count: 2, stages: ['d3', 'd7'] }), null, 'all stages done');
  assert.equal(packetReminderStage(days(-10), NOW, null), 'd7', 'missed d3 is skipped, d7 sent');
  assert.equal(packetReminderStage(days(-10), NOW, { count: 1, stages: ['d7'] }), null, 'never send d3 after d7');
});

test('renewal reminders: 30 and 7 days before expiry; none once expired', () => {
  assert.equal(renewalReminderStage(days(45), NOW), null);
  assert.equal(renewalReminderStage(days(30.5), NOW), 'pre30');
  assert.equal(renewalReminderStage(days(20), NOW, { count: 1, stages: ['pre30'] }), null);
  assert.equal(renewalReminderStage(days(7), NOW, { count: 1, stages: ['pre30'] }), 'pre7');
  assert.equal(renewalReminderStage(days(3), NOW, null), 'pre7', 'late start: only the nearest stage');
  assert.equal(renewalReminderStage(days(-1), NOW), null);
  assert.equal(renewalReminderStage(NOW, NOW), null);
});

test('reminder cap: at most 3 per packet / consent, staff resends count', () => {
  assert.equal(MAX_REMINDERS, 3);
  assert.equal(packetReminderStage(days(-7), NOW, { count: 3, stages: [] }), null);
  assert.equal(packetReminderStage(days(-7), NOW, null, 3), null, 'three staff resends: no automatic reminder');
  assert.equal(packetReminderStage(days(-7), NOW, null, 2), 'd7');
  assert.equal(renewalReminderStage(days(5), NOW, { count: 3, stages: [] }), null);
  let t = nextTracker(null, 'd3', true);
  assert.deepEqual(t, { count: 1, stages: ['d3'] });
  t = nextTracker(t, 'd7', false);
  assert.deepEqual(t, { count: 1, stages: ['d3', 'd7'] }, 'undelivered: stage done, not counted');
  assert.deepEqual(nextTracker(t, 'd7', true).stages, ['d3', 'd7'], 'no duplicate stages');
});

test('reminder channels: portal always, email when on file, SMS only with consent and no STOP', () => {
  assert.deepEqual(reminderChannels({}), ['portal']);
  assert.deepEqual(reminderChannels({ email: 'a@b.co' }), ['portal', 'email']);
  assert.deepEqual(reminderChannels({ email: 'a@b.co', emailOptOutAt: NOW }), ['portal']);
  assert.deepEqual(reminderChannels({ smsConsent: true }), ['portal', 'sms']);
  assert.deepEqual(reminderChannels({ smsConsent: true, smsOptOutAt: NOW }), ['portal']);
});

test('reminder job: lock, dry run default, setting, no form names, cron line', () => {
  const script = read('scripts/consent-reminders.ts');
  assert.match(script, /withJobLock\(JOB_LOCK_KEYS\.consentReminders/);
  assert.match(script, /process\.argv\.includes\('--apply'\)/);
  assert.match(read('src/lib/jobs/advisoryLock.ts'), /consentReminders: 'job:consent-reminders'/);
  const job = read('src/lib/consents/library/reminders.ts');
  assert.match(job, /autoRemindersEnabled/);
  assert.match(job, /notifyPacket/);
  assert.doesNotMatch(job, /sendSms\(/, 'texts only through the patient SMS gate');
  assert.match(job, /if \(!opts\.apply\) return counts/);
  assert.match(read('deploy/crontab.staging'), /scripts\/consent-reminders\.ts --apply/);
  const email = read('src/lib/consents/library/delivery.ts');
  assert.match(email, /You have forms to review and sign in your patient portal/);
});
