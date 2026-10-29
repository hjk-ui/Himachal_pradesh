import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { isDueForVisit, planRuleAssignments, planVisitSend, requestStatusLabel, sendStageFor, parseRules, type AssignmentLike } from '../src/lib/measures/schedule';
import { afterFailedDob, dobMatches, hashMeasureToken, isTokenShape, linkState, newMeasureToken, normalizeDob, sessionValid, MAX_DOB_ATTEMPTS } from '../src/lib/measures/token';
import { missingItems, scoreMeasure, scoreRequest } from '../src/lib/measures/scoring';
import { appendNarrative, measureSectionFor, measuresNarrative } from '../src/lib/measures/narrative';
import { safetyAlertsFor, showCrisisPage } from '../src/lib/measures/safety';
import { measureRequestEmail, measureLinkUrl } from '../src/lib/measures/messages';
import { planDelivery, part2ConsentCoversPatient } from '../src/lib/measures/delivery';
import { isSendable, sendableCheck, isWorsening, depressionInstrumentForAge } from '../src/lib/measures/instruments';
import { planLegacyScheduleMigration } from '../src/lib/measures/legacyMigration';
import { measureInboxItems, nextDueDay } from '../src/lib/measures/staffViews';
import { lintPatientSms } from '../src/lib/sms/contentRules';
import { measureRequestSms } from '../src/lib/sms/templates';
import { NOTE_SECTIONS, type NoteType } from '../src/lib/ehr/noteTemplates';
import { cleanAnswers, publicInstruments } from '../src/lib/measures/patientLink';

// Synthetic ids only; no real patient data.
const read = (p: string) => readFileSync(p, 'utf8');
const a = (over: Partial<AssignmentLike> = {}): AssignmentLike => ({
  id: 'a1', clientId: 'c1', instrumentId: 'phq-9', schedule: 'interval', everyDays: 30, startDate: '2026-09-01', endDate: null, status: 'active', ...over,
});
const allAnswers = (n: number, v = 1, over: Record<string, number> = {}) => ({ ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i + 1}`, v])), ...over });

// ─── Scheduling ─────────────────────────────────────────────────────────────

test('due rules: interval with tolerance, once, before each visit, paused / not started / ended', () => {
  assert.equal(isDueForVisit(a(), '2026-10-26', null), true, 'never done');
  assert.equal(isDueForVisit(a(), '2026-10-26', '2026-10-01'), true, '25 days >= 30 - 7');
  assert.equal(isDueForVisit(a(), '2026-10-26', '2026-10-10'), false, '16 days');
  assert.equal(isDueForVisit(a({ everyDays: 7 }), '2026-10-26', '2026-10-20'), true, '6 days >= 7 - 1');
  assert.equal(isDueForVisit(a({ schedule: 'once', startDate: '2026-10-01' }), '2026-10-26', '2026-09-20'), true);
  assert.equal(isDueForVisit(a({ schedule: 'once', startDate: '2026-10-01' }), '2026-10-26', '2026-10-05'), false);
  assert.equal(isDueForVisit(a({ schedule: 'before_visit' }), '2026-10-26', '2026-10-24'), false, 'done 2 days before');
  assert.equal(isDueForVisit(a({ schedule: 'before_visit' }), '2026-10-26', '2026-10-19'), true);
  assert.equal(isDueForVisit(a({ status: 'paused' }), '2026-10-26', null), false);
  assert.equal(isDueForVisit(a({ startDate: '2026-11-01' }), '2026-10-26', null), false);
  assert.equal(isDueForVisit(a({ endDate: '2026-10-01' }), '2026-10-26', null), false);
  assert.equal(isDueForVisit(a({ instrumentId: 'bam' }), '2026-10-26', null), false, 'pending licensed copy is never sent');
});

test('send stages are 3 days and 1 day before the visit only', () => {
  assert.equal(sendStageFor('2026-10-23', '2026-10-26'), 'visit_3d');
  assert.equal(sendStageFor('2026-10-25', '2026-10-26'), 'visit_1d');
  assert.equal(sendStageFor('2026-10-24', '2026-10-26'), null);
  assert.equal(sendStageFor('2026-10-26', '2026-10-26'), null);
});

test('visit send plan: one per instrument, due only', () => {
  const plan = planVisitSend({
    assignments: [a({ id: 'x1' }), a({ id: 'x2' }), a({ id: 'x3', instrumentId: 'gad-7' }), a({ id: 'x4', instrumentId: 'pcl-5' })],
    visitDay: '2026-10-26',
    latestByInstrument: new Map([['pcl-5', '2026-10-20']]),
  });
  assert.deepEqual(plan.instrumentIds, ['phq-9', 'gad-7']);
  assert.deepEqual(plan.assignmentIds, ['x1', 'x3']);
});

test('rules: nothing unless leadership turned them on; PHQ-A under 18; programs and providers; never twice', () => {
  const visits = [
    { clientId: 'adult', clinicianId: 'u1', kind: 'therapy_individual', ageYears: 40 },
    { clientId: 'teen', clinicianId: 'u2', kind: 'med_management', ageYears: 15 },
    { clientId: 'prp', clinicianId: 'u1', kind: 'prp', ageYears: 30 },
  ];
  const off = { visitRule: false, programRule: false, providerRule: false, phq9Days: 30, gad7Days: 30, programMeasures: [], providerMeasures: [] };
  assert.deepEqual(planRuleAssignments({ settings: off, upcomingVisits: visits, enrollments: [{ clientId: 'adult', programId: 'p1' }], existingActiveKeys: new Set() }), []);
  const adds = planRuleAssignments({
    settings: {
      ...off, visitRule: true, programRule: true, providerRule: true,
      programMeasures: [{ programId: 'p1', instrumentIds: ['pcl-5', 'phq-9'], everyDays: 7 }],
      providerMeasures: [{ userId: 'u2', instrumentIds: ['audit'], everyDays: 90 }],
    },
    upcomingVisits: visits,
    enrollments: [{ clientId: 'adult', programId: 'p1' }],
    existingActiveKeys: new Set(['adult:gad-7']),
  });
  assert.deepEqual(adds.map((x) => `${x.clientId}:${x.instrumentId}:${x.source}:${x.everyDays}`), [
    'adult:phq-9:visit_rule:30', 'teen:phq-a:visit_rule:30', 'teen:gad-7:visit_rule:30', 'adult:pcl-5:program:7', 'teen:audit:provider_rule:90',
  ]);
  assert.equal(depressionInstrumentForAge(17), 'phq-a');
  assert.equal(depressionInstrumentForAge(null), 'phq-9');
  assert.deepEqual(parseRules([{ programId: 'p', instrumentIds: ['bam', 'gad-7'], everyDays: 999 }, { programId: '', instrumentIds: ['gad-7'] }], 'programId'), [{ programId: 'p', instrumentIds: ['gad-7'], everyDays: 30 }]);
});

test('status labels and next due', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const exp = new Date('2026-10-30T12:00:00Z');
  assert.equal(requestStatusLabel({ status: 'sent', expiresAt: exp }, now), 'Sent');
  assert.equal(requestStatusLabel({ status: 'opened', expiresAt: exp }, now), 'Opened');
  assert.equal(requestStatusLabel({ status: 'started', expiresAt: exp }, now), 'Started');
  assert.equal(requestStatusLabel({ status: 'started', expiresAt: new Date('2026-10-20T00:00:00Z') }, now), 'Expired');
  assert.equal(requestStatusLabel({ status: 'completed', expiresAt: exp, completedAt: now }, now), 'Completed');
  assert.equal(requestStatusLabel({ status: 'not_sent', expiresAt: exp }, now), 'Not sent');
  assert.equal(requestStatusLabel({ status: 'locked', expiresAt: exp }, now), 'Locked');
  assert.equal(nextDueDay({ schedule: 'interval', everyDays: 30, startDate: '2026-09-01', status: 'active' }, '2026-10-01', '2026-10-23'), '2026-10-24');
  assert.equal(nextDueDay({ schedule: 'once', everyDays: null, startDate: '2026-09-01', status: 'active' }, '2026-09-05', '2026-10-23'), null);
});

// ─── Token / DOB lock ───────────────────────────────────────────────────────

test('token: random, base64url, only the sha256 is stored', () => {
  const t = newMeasureToken();
  assert.ok(isTokenShape(t));
  assert.notEqual(newMeasureToken(), t);
  assert.match(hashMeasureToken(t), /^[0-9a-f]{64}$/);
  assert.ok(!isTokenShape('short'));
  assert.ok(!isTokenShape('../../etc/passwd/aaaaaaaaaaaaaaaaaa'));
});

test('DOB: formats accepted, impossible dates refused, compared with the chart', () => {
  assert.equal(normalizeDob('2001-03-04'), '2001-03-04');
  assert.equal(normalizeDob('3/4/2001'), '2001-03-04');
  assert.equal(normalizeDob('03042001'), '2001-03-04');
  assert.equal(normalizeDob('02/30/2001'), null);
  assert.equal(normalizeDob('hello'), null);
  const chart = new Date('2001-03-04T00:00:00Z');
  assert.ok(dobMatches('03/04/2001', chart));
  assert.ok(!dobMatches('03/05/2001', chart));
  assert.ok(!dobMatches('03/04/2001', null), 'no DOB on chart never matches');
});

test('DOB lock: 3 wrong tries lock the link; locked / expired / completed links never show questions', () => {
  assert.equal(MAX_DOB_ATTEMPTS, 3);
  assert.deepEqual(afterFailedDob(0), { attempts: 1, locked: false, remaining: 2 });
  assert.deepEqual(afterFailedDob(1), { attempts: 2, locked: false, remaining: 1 });
  assert.deepEqual(afterFailedDob(2), { attempts: 3, locked: true, remaining: 0 });
  const now = new Date('2026-10-23T12:00:00Z');
  const base = { status: 'sent', expiresAt: new Date('2026-10-30T00:00:00Z'), lockedAt: null, completedAt: null };
  assert.equal(linkState(base, now, false), 'verify');
  assert.equal(linkState(base, now, true), 'ready');
  assert.equal(linkState({ ...base, status: 'locked', lockedAt: now }, now, true), 'locked');
  assert.equal(linkState({ ...base, expiresAt: new Date('2026-10-22T00:00:00Z') }, now, true), 'expired');
  assert.equal(linkState({ ...base, completedAt: now }, now, true), 'completed');
  assert.equal(linkState({ ...base, status: 'not_sent' }, now, false), 'not_sent');
  const secret = 'session-secret-value-xyz';
  assert.ok(sessionValid({ sessionHash: hashMeasureToken(secret), sessionExpiresAt: new Date('2026-10-23T13:00:00Z') }, secret, now));
  assert.ok(!sessionValid({ sessionHash: hashMeasureToken(secret), sessionExpiresAt: new Date('2026-10-23T11:00:00Z') }, secret, now), 'expired session');
  assert.ok(!sessionValid({ sessionHash: hashMeasureToken(secret), sessionExpiresAt: new Date('2026-10-23T13:00:00Z') }, 'other', now));
});

test('route and page: DOB first, httpOnly session, public path, rate limit, crisis banner', () => {
  const route = read('src/app/api/measures/public/[token]/route.ts');
  assert.match(route, /httpOnly: true/);
  assert.match(route, /rateLimit\(/);
  assert.match(read('src/proxy.ts'), /pathname\.startsWith\('\/api\/measures\/public\/'\)/);
  const page = read('src/app/m/[token]/page.tsx');
  assert.match(page, /tel:988/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /action: 'save'/);
  const link = read('src/lib/measures/patientLink.ts');
  for (const a of ['MEASURE_REQUEST_OPENED', 'MEASURE_LINK_LOCKED', 'MEASURE_REQUEST_STARTED', 'MEASURE_REQUEST_COMPLETED']) assert.ok(link.includes(a), a);
  assert.match(read('src/lib/measures/send.ts'), /MEASURE_REQUEST_SENT/);
});

// ─── Scoring hookup ─────────────────────────────────────────────────────────

test('scoring uses the catalog: PHQ-9 / GAD-7 totals and bands; incomplete and unsendable refused', () => {
  const phq = scoreMeasure('phq-9', allAnswers(9, 1, { q9: 0, q1: 3, q2: 3 }));
  assert.ok(phq.ok);
  if (phq.ok) {
    assert.equal(phq.scored.totalScore, 12);
    assert.equal(phq.scored.severity, 'Moderate');
    assert.equal(phq.scored.safetyFlagged, false);
    assert.equal(phq.scored.answers.length, 9);
  }
  const gad = scoreMeasure('gad-7', allAnswers(7, 2));
  assert.ok(gad.ok && gad.scored.totalScore === 14);
  assert.deepEqual(scoreMeasure('phq-9', { q1: 1 }), { ok: false, instrumentId: 'phq-9', error: 'incomplete' });
  assert.equal(missingItems('phq-9', allAnswers(8)).join(), 'q9');
  assert.deepEqual(scoreMeasure('bam', {}), { ok: false, instrumentId: 'bam', error: 'not_sendable' });
  assert.deepEqual(scoreMeasure('phq-9', allAnswers(9, 7)), { ok: false, instrumentId: 'phq-9', error: 'incomplete' }, 'invalid option score');
  const both = scoreRequest(['phq-9', 'gad-7'], { 'phq-9': allAnswers(9, 0), 'gad-7': allAnswers(7, 1) });
  assert.ok(both.ok && both.scored.length === 2);
  assert.ok(!isSendable('nida-assist') && !isSendable('c-ssrs-brief') && isSendable('audit') && isSendable('cage-aid'));
  assert.deepEqual(sendableCheck('bam'), { ok: false, reason: 'pending_licensed_copy' });
});

test('patient payload: question wording only, answers limited to real items and options', () => {
  const [p] = publicInstruments(['phq-9']);
  assert.equal(p.questions.length, 9);
  assert.ok(!JSON.stringify(p).includes('safety protocol'), 'no clinician notes');
  assert.deepEqual(cleanAnswers(['phq-9'], { 'phq-9': { q1: 2, q2: 9, bogus: 1 }, 'gad-7': { q1: 1 } }), { 'phq-9': { q1: 2 } });
});

// ─── Safety ─────────────────────────────────────────────────────────────────

test('PHQ-9 item 9 > 0 raises a HIGH risk alert and the crisis page even with a low total', () => {
  const r = scoreMeasure('phq-9', allAnswers(9, 0, { q9: 1 }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.scored.totalScore, 1);
  assert.equal(r.scored.safetyFlagged, true);
  assert.equal(r.scored.safetyItemPositive, true);
  const alerts = safetyAlertsFor([r.scored]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'HIGH');
  assert.equal(alerts[0].type, 'suicidal_ideation');
  assert.match(alerts[0].description, /safety item endorsed \(score 1\)/);
  assert.ok(showCrisisPage([r.scored]));
  const clean = scoreMeasure('phq-9', allAnswers(9, 2, { q9: 0 }));
  assert.ok(clean.ok && safetyAlertsFor([clean.scored]).length === 0 && !showCrisisPage([clean.scored]));
  const teen = scoreMeasure('phq-a', allAnswers(9, 0, { q9: 2 }));
  assert.ok(teen.ok && teen.scored.safetyItemPositive);
  // the completion writes the RiskAlert in the same transaction as the records
  assert.match(read('src/lib/measures/patientLink.ts'), /tx\.riskAlert\.create/);
});

// ─── Narrative in the note ─────────────────────────────────────────────────

test('narrative: one line with change and item 9, into the assessment / measures section (never the top)', () => {
  const history = [
    { id: 'r1', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 19, severity: 'Mod. Severe', date: '2026-09-12T15:00:00Z', items: { q9: 0 } },
    { id: 'r2', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 14, severity: 'Moderate', date: '2026-10-21T15:00:00Z', items: { q9: 0 } },
    { id: 'r3', instrumentId: 'gad-7', instrumentName: 'GAD-7', totalScore: 9, severity: 'Mild', date: '2026-10-21T14:00:00Z' },
  ];
  const n = measuresNarrative(history, '2026-10-01');
  assert.equal(n.text, 'PHQ-9 14 (moderate), down from 19 on 9/12; item 9 = 0. GAD-7 9 (mild).');
  assert.deepEqual(n.recordIds, ['r2', 'r3']);
  assert.equal(measuresNarrative(history, '2026-10-22').text, '', 'nothing new since the last note');
  assert.equal(measureSectionFor('Therapy Progress', NOTE_SECTIONS['Therapy Progress' as NoteType]), 'Impression');
  assert.equal(measureSectionFor('Psych Med Mgmt', NOTE_SECTIONS['Psych Med Mgmt']), 'Measure Review');
  assert.equal(measureSectionFor('SOAP', NOTE_SECTIONS.SOAP), 'Assessment');
  assert.equal(measureSectionFor('Substance Abuse Intake', NOTE_SECTIONS['Substance Abuse Intake' as NoteType]), 'Screening Scores');
  assert.equal(measureSectionFor('Therapy Intake', NOTE_SECTIONS['Therapy Intake' as NoteType]), 'Diagnostic Impressions');
  assert.equal(measureSectionFor('Telephone', NOTE_SECTIONS.Telephone), null);
  for (const [type, headings] of Object.entries(NOTE_SECTIONS)) {
    const s = measureSectionFor(type, headings);
    if (!s) continue;
    assert.ok(headings.includes(s), `${type}: ${s} is a real section`);
    assert.notEqual(headings[0], s, `${type}: never the first section`);
    assert.ok(!/chief complaint|hpi|history of present/i.test(s), `${type}: never chief complaint / HPI`);
  }
  assert.equal(appendNarrative('Client engaged.', 'PHQ-9 14.'), 'Client engaged.\nPHQ-9 14.');
  assert.equal(appendNarrative('Client engaged.\nPHQ-9 14.', 'PHQ-9 14.'), 'Client engaged.\nPHQ-9 14.', 'never twice');
  assert.match(read('src/app/dashboard/ehr/notes/page.tsx'), /<MeasuresNarrativeOffer/);
});

// ─── No PHI in messages; delivery rules ────────────────────────────────────

test('email and text carry no PHI: practice name and link only', () => {
  const url = measureLinkUrl('AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'https://staging.altrixs.com');
  assert.equal(url, 'https://staging.altrixs.com/m/AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  const mail = measureRequestEmail('Divine Counseling', url);
  assert.match(mail.text, /You have a short questionnaire from Divine Counseling before your visit/);
  const all = `${mail.subject} ${mail.text} ${mail.html}`;
  for (const bad of [/PHQ/i, /GAD/i, /depress/i, /anxiety/i, /therap/i, /substance/i, /suicid/i, /psych/i, /diagnos/i, /Dr\./, /Jane/]) assert.doesNotMatch(all, bad);
  const sms = measureRequestSms({ sender: 'Your care team', url });
  assert.deepEqual(lintPatientSms(sms, { purpose: 'measure_request', sender: 'Your care team', clientName: 'Jane Testpatient' }), []);
  assert.match(sms, /Reply STOP to opt out\./);
});

test('delivery: needs a channel with consent and a DOB; Part 2 SUD measures only with a covering consent', () => {
  const client = { dateOfBirth: new Date('1990-01-01'), email: 'p@example.test', emailOptOutAt: null, phone: '4105550100', smsConsent: false, smsOptOutAt: null, status: 'ACTIVE' };
  const ok = planDelivery({ client, instrumentIds: ['phq-9', 'gad-7'], part2Client: false, part2ConsentCovers: false });
  assert.ok(ok.ok && ok.channels.join() === 'email');
  const both = planDelivery({ client: { ...client, smsConsent: true }, instrumentIds: ['phq-9'], part2Client: false, part2ConsentCovers: false });
  assert.ok(both.ok && both.channels.join() === 'email,sms');
  assert.deepEqual(planDelivery({ client: { ...client, email: null }, instrumentIds: ['phq-9'], part2Client: false, part2ConsentCovers: false }).ok, false);
  const noChannel = planDelivery({ client: { ...client, emailOptOutAt: new Date() }, instrumentIds: ['phq-9'], part2Client: false, part2ConsentCovers: false });
  assert.ok(noChannel.ok === false && noChannel.reason === 'no_channel');
  const noDob = planDelivery({ client: { ...client, dateOfBirth: null }, instrumentIds: ['phq-9'], part2Client: false, part2ConsentCovers: false });
  assert.ok(noDob.ok === false && noDob.reason === 'no_dob');
  const p2 = planDelivery({ client, instrumentIds: ['audit', 'phq-9'], part2Client: true, part2ConsentCovers: false });
  assert.ok(p2.ok && p2.instrumentIds.join() === 'phq-9' && p2.droppedPart2.join() === 'audit');
  const p2only = planDelivery({ client, instrumentIds: ['audit'], part2Client: true, part2ConsentCovers: false });
  assert.ok(p2only.ok === false && p2only.reason === 'part2_in_session_only');
  const p2ok = planDelivery({ client, instrumentIds: ['audit'], part2Client: true, part2ConsentCovers: true });
  assert.ok(p2ok.ok && p2ok.part2);
  assert.ok(part2ConsentCoversPatient([{ type: 'Part 2 consent', formKey: 'lib:part2-consent', recipientName: 'Patient portal' }]));
  assert.ok(!part2ConsentCoversPatient([{ type: 'Part 2 consent', formKey: 'lib:part2-consent', recipientName: 'County court' }]));
  assert.ok(!planDelivery({ client: { ...client, status: 'DISCHARGED' }, instrumentIds: ['phq-9'], part2Client: false, part2ConsentCovers: false }).ok);
});

// ─── Inbox, migration, settings ─────────────────────────────────────────────

test('inbox: "Measures completed" per request and "Worsening" on a clinically meaningful rise', () => {
  const recs = new Map([
    ['r1', { id: 'r1', instrumentId: 'phq-9', totalScore: 17, severity: 'Mod. Severe' }],
    ['r2', { id: 'r2', instrumentId: 'gad-7', totalScore: 8, severity: 'Mild' }],
  ]);
  const items = measureInboxItems(
    [{ id: 'q1', clientId: 'c1', clientName: 'Client One', completedAt: new Date('2026-10-22T12:00:00Z'), safetyFlagged: false, resultRecordIds: ['r1', 'r2'] }],
    recs,
    (id) => (id === 'r1' ? 11 : 7)
  );
  assert.deepEqual(items.map((i) => i.kind), ['completed', 'worsening']);
  assert.equal(items[0].title, 'Measures completed · PHQ-9 17, GAD-7 8');
  assert.equal(items[1].title, 'Worsening · PHQ-9 17 (up 6 from 11)');
  assert.ok(isWorsening('phq-9', 15, 10) && !isWorsening('phq-9', 14, 10) && isWorsening('gad-7', 12, 8) && !isWorsening('aces', 9, 0));
  const sections = read('src/lib/inbox/sections.ts');
  assert.match(sections, /key: 'measures'/);
  assert.match(read('src/lib/inbox/loaders.ts'), /measures: loadMeasures/);
});

test('legacy MBC blob -> measure_assignments: mapped, idempotent, nothing invented', () => {
  const blob = [
    { scheduleId: 's1', patientId: 'c1', measure: 'PHQ-9', frequency: 'weekly', nextSendDate: '2026-10-01', active: true },
    { scheduleId: 's2', patientId: 'c1', measure: 'PHQ-9', frequency: 'monthly', active: true },
    { scheduleId: 's3', patientId: 'c2', measure: 'Columbia', frequency: 'once', active: false },
    { scheduleId: 's4', patientId: 'c2', measure: 'BAM', frequency: 'monthly', active: true, source: 'sud-radar', instrumentId: 'bam', assignedAt: '2026-10-20T10:00:00Z' },
    { scheduleId: 's5', patientId: 'gone', measure: 'GAD-7', frequency: 'monthly', active: true },
    { scheduleId: 's6', patientId: 'c1', measure: 'Mystery', frequency: 'monthly', active: true },
    { scheduleId: 's7', patientId: 'c1', measure: 'GAD-7', frequency: 'monthly', active: true },
    'junk',
  ];
  const { plan, counts } = planLegacyScheduleMigration(blob, { clientIds: new Set(['c1', 'c2']), existingLegacyIds: new Set(['s7']), existingActiveKeys: new Set(), today: '2026-10-23' });
  assert.deepEqual(plan.map((p) => `${p.legacySourceId}:${p.instrumentId}:${p.schedule}:${p.everyDays}:${p.status}:${p.source}`), [
    's1:phq-9:interval:7:active:legacy', 's2:phq-9:interval:30:paused:legacy', 's3:c-ssrs-brief:once:null:paused:legacy', 's4:bam:interval:30:active:sud_radar',
  ]);
  assert.equal(plan[3].startDate, '2026-10-20');
  assert.deepEqual(counts, { rows: 8, planned: 4, alreadyCopied: 1, unknownMeasure: 1, unknownClient: 1, invalid: 1, pausedDuplicate: 1 });
  const script = read('scripts/migrate-outcome-schedules-blob.ts');
  assert.match(script, /const APPLY = args\.includes\('--apply'\)/);
});

test('settings default OFF; migration is idempotent; cron job holds its advisory lock', () => {
  const sql = read('prisma/migrations/20261023_measures_to_patients.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS measure_assignments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS measure_requests/);
  for (const col of ['mbcAutoSend', 'mbcVisitRule', 'mbcProgramRule', 'mbcProviderRule']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}" BOOLEAN NOT NULL DEFAULT false`));
    assert.match(read('src/lib/practice/settings.ts'), new RegExp(`${col}: z\\.boolean\\(\\)\\.default\\(false\\)`));
  }
  assert.doesNotMatch(sql, /CREATE TABLE measure|ADD COLUMN "(?!.*IF NOT EXISTS)/);
  assert.match(read('src/lib/jobs/advisoryLock.ts'), /measuresSend: 'job:measures-send'/);
  assert.match(read('scripts/measures-send.ts'), /withJobLock\(JOB_LOCK_KEYS\.measuresSend/);
  assert.match(read('src/lib/measures/job.ts'), /if \(settings\.mbcAutoSend\)/);
  assert.match(read('src/app/dashboard/practice-setup/_components/sections.tsx'), /Send measures to patients before visits/);
});
