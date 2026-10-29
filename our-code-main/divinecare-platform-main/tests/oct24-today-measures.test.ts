import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  selectPrimaryAction,
  startSessionHref,
  START_SESSION_ARIA,
  type PrimaryActionInput,
} from '../src/lib/today/actions';
import { practiceDayRange, practiceDayStart } from '../src/lib/today/day';
import { allowedActions, resolveScribeBlocked, SCRIBE_BLOCKED_REASONS } from '../src/lib/scribe-session/blocked';
import {
  createMeasureSession,
  generateMeasureToken,
  hashMeasureToken,
  isWellFormedMeasureToken,
  verifyMeasureSession,
} from '../src/lib/measures/hash';
import { measureEmailSubject, NOT_SENT_REASONS } from '../src/lib/measures/copy';
import { checkSendEligibility } from '../src/lib/measures/send';
import { getPatientInstrument, scorePatientAnswers, validateAnswers } from '../src/lib/measures/instruments';
import { MBC_OPTION_DEFAULTS, normalizeMbcOptions } from '../src/lib/measures/options';
import { dobMatches } from '../src/lib/measures/public';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const base: PrimaryActionInput = {
  appointmentId: 'appt1',
  clientId: 'client1',
  status: 'SCHEDULED',
  noteStatus: 'NOT_STARTED',
  dos: '2026-10-27',
  isVirtual: false,
  isGroup: false,
  protectedLocked: false,
  followUpBooked: false,
  awaitingCosign: false,
};

describe('today primary action', () => {
  it('protected record wins and has no href', () => {
    const a = selectPrimaryAction({ ...base, clientId: null, protectedLocked: true, noteStatus: 'SIGNED' });
    assert.equal(a.label, 'Protected record');
    assert.equal(a.href, null);
  });

  it('signed + follow-up → Done; signed without → Book follow-up', () => {
    assert.equal(selectPrimaryAction({ ...base, noteStatus: 'SIGNED', followUpBooked: true }).label, 'Done');
    assert.equal(selectPrimaryAction({ ...base, noteStatus: 'SIGNED' }).label, 'Book follow-up');
  });

  it('signed awaiting co-signature', () => {
    const a = selectPrimaryAction({ ...base, noteStatus: 'SIGNED', followUpBooked: true, awaitingCosign: true });
    assert.equal(a.label, 'Waiting for co-signature');
  });

  it('cancelled-class → No note needed', () => {
    for (const status of ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] as const) {
      assert.equal(selectPrimaryAction({ ...base, status }).label, 'No note needed');
    }
  });

  it('draft ready → Sign; draft/ended → Finish note; else Start session', () => {
    assert.equal(selectPrimaryAction({ ...base, noteStatus: 'AI_DRAFT' }).label, 'Sign');
    assert.equal(selectPrimaryAction({ ...base, noteStatus: 'IN_PROGRESS' }).label, 'Finish note');
    assert.equal(selectPrimaryAction({ ...base, status: 'COMPLETED' }).label, 'Finish note');
    assert.equal(selectPrimaryAction(base).label, 'Start session');
  });

  it('Start session href — individual', () => {
    const href = startSessionHref({ ...base, isVirtual: true })!;
    const u = new URL(href, 'http://x');
    assert.equal(u.pathname, '/dashboard/ehr/notes');
    assert.equal(u.searchParams.get('clientId'), 'client1');
    assert.equal(u.searchParams.get('appointmentId'), 'appt1');
    assert.equal(u.searchParams.get('dos'), '2026-10-27');
    assert.equal(u.searchParams.get('guide'), '1');
    assert.equal(u.searchParams.get('telehealth'), '1');
    assert.equal(u.searchParams.get('scribe'), '1');
    assert.equal(selectPrimaryAction(base).ariaLabel, START_SESSION_ARIA);
    assert.equal(START_SESSION_ARIA, 'Start session: open the note with AI Scribe ready to record');
  });

  it('Start session href — group', () => {
    assert.equal(
      startSessionHref({ ...base, isGroup: true }),
      '/dashboard/ehr/group-sessions/sessions/appt1?scribe=1'
    );
  });

  it('never builds a note href without a clientId (Part 2 locked)', () => {
    assert.equal(startSessionHref({ ...base, clientId: null }), null);
  });
});

describe('practice day', () => {
  it('uses the practice time zone with DST-correct bounds', () => {
    // EDT (UTC-4) in October; EST (UTC-5) after the first Sunday of November.
    assert.equal(practiceDayStart('2026-10-27').toISOString(), '2026-10-27T04:00:00.000Z');
    assert.equal(practiceDayStart('2026-11-02').toISOString(), '2026-11-02T05:00:00.000Z');
    const r = practiceDayRange(new Date('2026-10-27T15:00:00Z'));
    assert.equal(r.day, '2026-10-27');
    assert.equal(r.end.toISOString(), '2026-10-28T04:00:00.000Z');
  });
});

describe('scribe-session blocked reasons', () => {
  it('exact copy', () => {
    assert.equal(SCRIBE_BLOCKED_REASONS.plan, 'AI Scribe is not included in this practice’s plan.');
    assert.equal(SCRIBE_BLOCKED_REASONS.practice_off, 'AI Scribe is turned off in practice settings.');
    assert.equal(
      SCRIBE_BLOCKED_REASONS.client_declined,
      'This client declined AI use. Nothing is captured; document the session yourself.'
    );
    assert.equal(
      SCRIBE_BLOCKED_REASONS.recording_revoked,
      'This client revoked consent to session recording. Nothing is captured; you can still dictate a recap.'
    );
  });

  it('precedence and allowed actions', () => {
    const ok = { planIncludesScribe: true, practiceScribeEnabled: true };
    assert.equal(resolveScribeBlocked(ok), null);
    assert.equal(resolveScribeBlocked({ ...ok, planIncludesScribe: false, clientDeclinedAi: true })?.code, 'plan');
    assert.equal(resolveScribeBlocked({ ...ok, practiceScribeEnabled: false })?.code, 'practice_off');
    assert.equal(resolveScribeBlocked({ ...ok, clientDeclinedAi: true, clientRevokedRecording: true })?.code, 'client_declined');
    const revoked = resolveScribeBlocked({ ...ok, clientRevokedRecording: true });
    assert.deepEqual(allowedActions(revoked), { record: false, upload: false, dictate: true });
    assert.deepEqual(allowedActions(resolveScribeBlocked({ ...ok, clientDeclinedAi: true })), {
      record: false,
      upload: false,
      dictate: false,
    });
  });
});

describe('measure tokens', () => {
  it('stores only a sha256 hex hash; raw token is well formed and not the hash', () => {
    const token = generateMeasureToken();
    assert.ok(isWellFormedMeasureToken(token));
    const hash = hashMeasureToken(token);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, token);
    assert.notEqual(generateMeasureToken(), token);
    assert.ok(!isWellFormedMeasureToken('short'));
  });

  it('schema keeps tokenHash unique and has no plaintext token column', () => {
    const schema = read('prisma/schema.prisma');
    const model = schema.slice(schema.indexOf('model MeasureRequest'));
    assert.match(model, /tokenHash\s+String\s+@unique/);
    assert.doesNotMatch(model.split('\n}')[0], /\n\s+token\s+String/);
  });

  it('DOB session cookie: valid, expires, and is bound to the request', () => {
    const now = Date.now();
    const cookie = createMeasureSession('req1', now);
    assert.ok(verifyMeasureSession('req1', cookie, now + 1000));
    assert.ok(!verifyMeasureSession('req2', cookie, now + 1000));
    assert.ok(!verifyMeasureSession('req1', cookie, now + 2 * 60 * 60 * 1000 + 1));
    assert.ok(!verifyMeasureSession('req1', cookie.slice(0, -2) + 'xx', now + 1000));
    assert.ok(!verifyMeasureSession('req1', null, now));
  });
});

describe('measures send', () => {
  it('email subject is exact', () => {
    assert.equal(measureEmailSubject('MD Behavioral Health'), 'MD Behavioral Health: a short questionnaire before your visit');
  });

  const ok = {
    channel: 'email' as const,
    instrumentKnown: true,
    itemContentPending: false,
    assignmentStatus: 'active',
    hasDob: true,
    email: 'a@example.com',
    phone: '+14105550100',
    smsAllowed: { allowed: true },
  };

  it('eligible when contact + DOB are on file', () => {
    assert.equal(checkSendEligibility(ok), null);
    assert.equal(checkSendEligibility({ ...ok, channel: 'in_session', email: null, phone: null }), null);
  });

  it('returns a not-sent reason otherwise', () => {
    assert.equal(checkSendEligibility({ ...ok, email: ' ' }), 'no_email');
    assert.equal(checkSendEligibility({ ...ok, channel: 'sms', phone: null }), 'no_phone');
    assert.equal(
      checkSendEligibility({ ...ok, channel: 'sms', smsAllowed: { allowed: false, reason: 'opted_out' } }),
      'sms_opted_out'
    );
    assert.equal(
      checkSendEligibility({ ...ok, channel: 'sms', smsAllowed: { allowed: false, reason: 'no_consent' } }),
      'sms_no_consent'
    );
    assert.equal(checkSendEligibility({ ...ok, hasDob: false }), 'no_dob');
    assert.equal(checkSendEligibility({ ...ok, itemContentPending: true }), 'item_content_pending');
    assert.equal(checkSendEligibility({ ...ok, assignmentStatus: 'paused' }), 'assignment_inactive');
    assert.equal(checkSendEligibility({ ...ok, channel: 'portal' }), 'portal_unavailable');
    assert.ok(NOT_SENT_REASONS.no_email.length > 0);
  });
});

describe('measures patient flow', () => {
  it('DOB compare is exact calendar date', () => {
    const dob = new Date('1990-05-17T00:00:00.000Z');
    assert.ok(dobMatches(dob, '1990-05-17'));
    assert.ok(!dobMatches(dob, '1990-05-18'));
    assert.ok(!dobMatches(dob, 'not-a-date'));
    assert.ok(!dobMatches(null, '1990-05-17'));
  });

  it('PHQ-9 item 9 above zero is a crisis; complete requires every item', () => {
    const phq = getPatientInstrument('phq-9');
    assert.ok(phq, 'phq-9 must be in the assessment catalog');
    const all = Object.fromEntries(phq!.questions.map((q) => [q.id, 0]));
    assert.equal(scorePatientAnswers('phq-9', all)?.crisis, false);
    assert.equal(scorePatientAnswers('phq-9', { ...all, q9: 1 })?.crisis, true);
    assert.equal(validateAnswers(phq!, { q1: 0 }, { complete: true }).ok, false);
    assert.equal(validateAnswers(phq!, { q1: 0 }, { complete: false }).ok, true);
    assert.equal(validateAnswers(phq!, { q1: 99 }, { complete: false }).ok, false);
    assert.equal(validateAnswers(phq!, { zzz: 0 }, { complete: false }).ok, false);
  });

  it('MBC practice options default OFF and only literal true turns on', () => {
    assert.deepEqual(normalizeMbcOptions(undefined), MBC_OPTION_DEFAULTS);
    assert.deepEqual(Object.values(MBC_OPTION_DEFAULTS), [false, false, false, false]);
    assert.equal(normalizeMbcOptions({ mbcAutoSend: 'true', mbcVisitRule: 1 }).mbcAutoSend, false);
    assert.equal(normalizeMbcOptions({ mbcAutoSend: true }).mbcAutoSend, true);
  });
});

describe('wiring', () => {
  it('public measure API is allowed through the staff proxy', () => {
    assert.match(read('src/proxy.ts'), /\/api\/measures\/public/);
  });
  it('Today route is no-store and gated', () => {
    const route = read('src/app/api/dashboard/today/route.ts');
    assert.match(route, /Cache-Control': 'no-store'/);
    assert.match(route, /requireOrgContext/);
    assert.match(route, /Not allowed to view appointments/);
  });
  it('Today panel is mounted for therapist and prescriber homes', () => {
    assert.match(read('src/features/dashboard/components/TherapistHome.tsx'), /<TodayPanel \/>/);
    assert.match(read('src/features/dashboard/components/RoleHomes.tsx'), /<TodayPanel \/>/);
  });
});
