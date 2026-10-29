import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  allowedGapActions,
  auditCPositive,
  bhHandoffDerivedStatus,
  bhHandoffSuggestion,
  bmiFromImperial,
  bpRecheckState,
  canManagePrimaryCareSettings,
  canRoomPatients,
  careGapEligible,
  computeCareGaps,
  daysOverdue,
  DEFAULT_RESULTS_NOTIFY_DAYS,
  fallsScreenPositive,
  gapActionError,
  hasDiabetesCode,
  influenzaSeason,
  isMedicarePayer,
  isPreventiveVisitType,
  labGapFor,
  officeEmCode,
  openCareGaps,
  parsePocStandingOrders,
  phq2Positive,
  phqTotal,
  preventiveCode,
  referralNextStatuses,
  resultNotifyState,
  roomingChip,
  screeningSafetyFlags,
  screeningsDue,
  sortResultsForReview,
  suggestEmCodes,
  unaddressedGaps,
  vitalEntryErrors,
  vitalFlags,
} from '../src/lib/medical/primaryCareWorkflow';
import { AUTO_STEP_IDS, PROTOCOLS } from '../src/lib/visits/protocols';
import { REQUIREMENTS } from '../src/lib/visits/requirements';

const NOW = new Date('2026-10-21T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// ─── Vitals ──────────────────────────────────────────────────────────────────

test('BMI from pounds and inches (703 formula, one decimal); missing values give null', () => {
  assert.equal(bmiFromImperial(180, 70), 25.8);
  assert.equal(bmiFromImperial(120, 64), 20.6);
  assert.equal(bmiFromImperial(null, 70), null);
  assert.equal(bmiFromImperial(180, 0), null);
});

test('vital flags: BP >=140/90, SpO2 <92, temp >=100.4, HR >100 or <50; flags only ("Notify provider")', () => {
  const keys = (v: Parameters<typeof vitalFlags>[0]) => vitalFlags(v).map((f) => f.key).sort();
  assert.deepEqual(keys({ systolic: 139, diastolic: 89, spO2: 92, temperatureF: 100.3, heartRate: 100 }), []);
  assert.deepEqual(keys({ systolic: 140, diastolic: 80 }), ['bp_elevated']);
  assert.deepEqual(keys({ systolic: 120, diastolic: 90 }), ['bp_elevated']);
  assert.deepEqual(keys({ spO2: 91 }), ['spo2_low']);
  assert.deepEqual(keys({ temperatureF: 100.4 }), ['temp_elevated']);
  assert.deepEqual(keys({ heartRate: 101 }), ['hr_high']);
  assert.deepEqual(keys({ heartRate: 49 }), ['hr_low']);
  for (const f of vitalFlags({ systolic: 180, diastolic: 110, spO2: 85, heartRate: 130, temperatureF: 103 })) {
    assert.equal(f.action, 'Notify provider');
    assert.doesNotMatch(f.label, /hypertens|crisis|sepsis|infection|diagnos/i, 'no interpretation text');
  }
  // The recheck is the reading of record once taken
  assert.deepEqual(keys({ systolic: 150, diastolic: 95, recheck: { systolic: 132, diastolic: 84 } }), []);
  assert.deepEqual(keys({ systolic: 150, diastolic: 95, recheck: { systolic: 146, diastolic: 84 } }), ['bp_elevated']);
});

test('BP recheck: prompted 5 minutes after an elevated first reading, then recorded', () => {
  const takenAt = new Date(NOW.getTime() - 2 * 60_000).toISOString();
  assert.deepEqual(bpRecheckState({ systolic: 128, diastolic: 80, takenAt }, NOW), { state: 'not_needed' });
  const wait = bpRecheckState({ systolic: 150, diastolic: 92, takenAt }, NOW);
  assert.equal(wait.state, 'wait');
  assert.equal(wait.state === 'wait' && wait.secondsLeft, 180);
  assert.deepEqual(bpRecheckState({ systolic: 150, diastolic: 92, takenAt: new Date(NOW.getTime() - 6 * 60_000).toISOString() }, NOW), { state: 'due' });
  assert.deepEqual(bpRecheckState({ systolic: 150, diastolic: 92 }, NOW), { state: 'due' }, 'no time on file: due now, never a guessed wait');
  assert.deepEqual(bpRecheckState({ systolic: 150, diastolic: 92, recheck: { systolic: 138, diastolic: 86 } }, NOW), { state: 'recorded', stillElevated: false });
});

test('vital entry ranges: empty allowed, both BP values together, diastolic below systolic', () => {
  assert.deepEqual(vitalEntryErrors({}), []);
  assert.ok(vitalEntryErrors({ systolic: 120 }).some((e) => /both systolic and diastolic/.test(e)));
  assert.ok(vitalEntryErrors({ systolic: 80, diastolic: 90 }).some((e) => /lower than systolic/.test(e)));
  assert.ok(vitalEntryErrors({ pain: 11 }).some((e) => /Pain/.test(e)));
  assert.ok(vitalEntryErrors({ spO2: 101 }).length > 0);
});

// ─── Screenings ──────────────────────────────────────────────────────────────

test('screenings due by age and last date: falls 65+, alcohol 18+, depression / tobacco 12+, SDOH yearly', () => {
  const keys = (age: number | null, last = {}) => screeningsDue({ ageYears: age, last, now: NOW }).filter((s) => s.due).map((s) => s.key).sort();
  assert.deepEqual(keys(70), ['alcohol', 'depression', 'falls', 'sdoh', 'tobacco']);
  assert.deepEqual(keys(40), ['alcohol', 'depression', 'sdoh', 'tobacco']);
  assert.deepEqual(keys(15), ['depression', 'sdoh', 'tobacco']);
  assert.deepEqual(keys(8), ['sdoh']);
  assert.deepEqual(keys(null), ['sdoh'], 'unknown age: no age-limited screen is offered');
  const recent = keys(70, { depression: daysAgo(100), tobacco: daysAgo(364), alcohol: daysAgo(365), falls: null, sdoh: daysAgo(10) });
  assert.deepEqual(recent, ['alcohol', 'falls']);
  const none = screeningsDue({ ageYears: 40, last: {}, now: NOW }).find((s) => s.key === 'depression')!;
  assert.match(none.reason, /none on file/);
});

test('PHQ-2 positive at 3 leads to PHQ-9; partial forms are not scored', () => {
  assert.equal(phqTotal([1, 1], 2), 2);
  assert.equal(phqTotal([1], 2), null);
  assert.equal(phqTotal([1, Number.NaN], 2), null);
  assert.equal(phq2Positive(2), false);
  assert.equal(phq2Positive(3), true);
  assert.equal(phq2Positive(null), false);
  assert.equal(phqTotal([3, 3, 3, 3, 3, 3, 3, 3, 3], 9), 27);
});

test('AUDIT-C positive at 4 (men) / 3 (women and sex unknown); STEADI any yes; PHQ-9 item 9 notifies the provider', () => {
  assert.equal(auditCPositive(3, 'M'), false);
  assert.equal(auditCPositive(4, 'M'), true);
  assert.equal(auditCPositive(3, 'F'), true);
  assert.equal(auditCPositive(3, null), true);
  assert.equal(fallsScreenPositive({ fell: false, unsteady: false, worried: false }), false);
  assert.equal(fallsScreenPositive({ worried: true }), true);
  assert.deepEqual(screeningSafetyFlags({ phq9: { items: [1, 1, 1, 1, 1, 1, 1, 1, 0] } }), []);
  const f = screeningSafetyFlags({ phq9: { items: [1, 1, 1, 1, 1, 1, 1, 1, 2] } });
  assert.equal(f.length, 1);
  assert.equal(f[0].action, 'Notify provider');
});

test('BH warm handoff threshold: PHQ-9 >= 10 or GAD-7 >= 10, with the reason', () => {
  assert.deepEqual(bhHandoffSuggestion({ phq9: { score: 9, date: '2026-10-21' }, gad7: { score: 9, date: '2026-10-21' } }), { suggested: false, reasons: [] });
  const p = bhHandoffSuggestion({ phq9: { score: 10, date: '2026-10-21' }, gad7: null });
  assert.equal(p.suggested, true);
  assert.match(p.reasons[0], /PHQ-9 10 on 2026-10-21/);
  assert.equal(bhHandoffSuggestion({ phq9: null, gad7: { score: 15, date: '2026-10-20' } }).suggested, true);
  assert.equal(bhHandoffSuggestion({ phq9: null, gad7: null }).suggested, false);
});

test('handoff status comes from the schedule only: booked after sending = scheduled, completed = seen', () => {
  const sent = daysAgo(5);
  assert.equal(bhHandoffDerivedStatus('sent', sent, []).status, 'sent');
  assert.equal(bhHandoffDerivedStatus('sent', sent, [{ startsAt: daysAgo(30), status: 'COMPLETED', createdAt: daysAgo(40) }]).status, 'sent', 'older visits do not count');
  assert.equal(bhHandoffDerivedStatus('sent', sent, [{ startsAt: new Date(NOW.getTime() + 3 * 86_400_000), status: 'SCHEDULED', createdAt: daysAgo(1) }]).status, 'scheduled');
  assert.equal(bhHandoffDerivedStatus('sent', sent, [{ startsAt: daysAgo(1), status: 'COMPLETED', createdAt: daysAgo(3) }]).status, 'seen');
  assert.equal(bhHandoffDerivedStatus('cancelled', sent, [{ startsAt: daysAgo(1), status: 'COMPLETED' }]).status, 'cancelled');
  assert.deepEqual(referralNextStatuses('internal_bh', 'sent'), ['scheduled', 'seen', 'cancelled']);
  assert.ok(!referralNextStatuses('internal_bh', 'sent').includes('report_received'), 'no BH report comes back to primary care');
  assert.deepEqual(referralNextStatuses('specialist', 'seen'), ['report_received', 'cancelled']);
  assert.deepEqual(referralNextStatuses('imaging', 'report_received'), []);
});

// ─── Care gaps ───────────────────────────────────────────────────────────────

test('care gap eligibility windows (USPSTF / ACIP / ADA)', () => {
  const e = (key: Parameters<typeof careGapEligible>[0], age: number, sex: 'F' | 'M' | null = 'F', diabetes = false) => careGapEligible(key, { ageYears: age, sex, diabetes });
  assert.equal(e('colorectal', 44), false);
  assert.equal(e('colorectal', 45), true);
  assert.equal(e('colorectal', 75), true);
  assert.equal(e('colorectal', 76), false);
  assert.equal(e('breast', 39), false);
  assert.equal(e('breast', 40), true);
  assert.equal(e('breast', 74), true);
  assert.equal(e('breast', 75), false);
  assert.equal(e('breast', 50, 'M'), false);
  assert.equal(e('breast', 50, null), false, 'sex at birth not recorded: not evaluated');
  assert.equal(e('cervical', 20), false);
  assert.equal(e('cervical', 21), true);
  assert.equal(e('cervical', 65), true);
  assert.equal(e('cervical', 66), false);
  assert.equal(e('diabetes_a1c', 50, 'M', false), false);
  assert.equal(e('diabetes_a1c', 50, 'M', true), true);
  assert.equal(e('pneumococcal', 49), false, 'ACIP October 2024: 50+');
  assert.equal(e('pneumococcal', 50), true);
  assert.equal(e('pneumococcal', 65), true);
  assert.equal(e('tdap', 18), false);
  assert.equal(e('tdap', 19), true);
  assert.equal(careGapEligible('influenza', { ageYears: 30, sex: 'M', diabetes: false, today: '2026-10-21' }), true);
  assert.equal(careGapEligible('influenza', { ageYears: 30, sex: 'M', diabetes: false, today: '2026-06-15' }), false);
  assert.deepEqual(influenzaSeason('2027-02-10'), { inSeason: true, seasonStart: '2026-08-01' });
  assert.deepEqual(influenzaSeason('2026-08-20'), { inSeason: false, seasonStart: '2026-08-01' });
});

test('care gaps: intervals by test type, provider history closes, patient report never closes', () => {
  const base = { ageYears: 52, sex: 'F' as const, diabetes: true, now: NOW, last: {}, notApplicable: {} };
  const all = computeCareGaps(base);
  assert.deepEqual(
    all.map((g) => g.key).sort(),
    ['breast', 'cervical', 'colorectal', 'diabetes_a1c', 'diabetes_eye', 'diabetes_foot', 'diabetes_kidney', 'influenza', 'pneumococcal', 'tdap'].sort()
  );
  assert.ok(all.every((g) => g.status === 'due' && /none on file|no dose|no pneumococcal vaccine on file/.test(g.reason)), 'nothing on file: due, never assumed done');

  const gaps = computeCareGaps({
    ...base,
    last: {
      colorectal: { date: daysAgo(5 * 365), kind: 'colonoscopy', source: 'GI clinic' },
      breast: { date: daysAgo(800), source: 'Imaging center' },
      cervical: { date: daysAgo(4 * 365), kind: 'cotest', source: 'OB/GYN' },
      diabetes_a1c: { date: daysAgo(100), source: 'lab result on file' },
      influenza: { date: daysAgo(20), source: 'pharmacy' },
      tdap: { date: daysAgo(12 * 365), source: 'urgent care' },
    },
    notApplicable: { diabetes_foot: 'bilateral amputation' },
    patientReported: { diabetes_eye: { date: daysAgo(30), source: 'eye doctor' } },
  });
  const by = new Map(gaps.map((g) => [g.key, g]));
  assert.equal(by.get('colorectal')!.status, 'met', 'colonoscopy: 10 years');
  assert.equal(by.get('breast')!.status, 'due', 'mammogram every 2 years');
  assert.equal(by.get('cervical')!.status, 'met', 'co-test age 30+: 5 years');
  assert.equal(by.get('diabetes_a1c')!.status, 'met');
  assert.equal(by.get('influenza')!.status, 'met');
  assert.equal(by.get('tdap')!.status, 'overdue');
  assert.equal(by.get('diabetes_foot')!.status, 'not_applicable');
  assert.equal(by.get('diabetes_eye')!.status, 'due', 'patient-reported only: still open');
  assert.equal(by.get('diabetes_eye')!.patientReported?.source, 'eye doctor');

  const fit = computeCareGaps({ ...base, last: { colorectal: { date: daysAgo(400), kind: 'fit', source: 'mailed FIT' } } });
  assert.equal(fit.find((g) => g.key === 'colorectal')!.status, 'due', 'FIT: yearly');
  const disabled = computeCareGaps({ ...base, disabled: ['tdap', 'influenza'] });
  assert.ok(!disabled.some((g) => g.key === 'tdap' || g.key === 'influenza'), 'practice setting turns gaps off');
  assert.equal(computeCareGaps({ ...base, ageYears: 70, sex: 'M', diabetes: false }).find((g) => g.key === 'pneumococcal')!.status, 'due');
  assert.equal(computeCareGaps({ ...base, ageYears: 49, sex: 'M', diabetes: false }).find((g) => g.key === 'pneumococcal'), undefined);
  assert.match(computeCareGaps({ ...base, ageYears: 50, sex: 'M', diabetes: false }).find((g) => g.key === 'pneumococcal')!.reason, /age 50\+/);
});

test('every due gap must be addressed at the visit by a provider action', () => {
  const open = openCareGaps(computeCareGaps({ ageYears: 52, sex: 'M', diabetes: false, now: NOW, last: {}, notApplicable: {} }));
  const keys = open.map((g) => g.key);
  assert.deepEqual(unaddressedGaps(open, []).map((g) => g.key), keys);
  const left = unaddressedGaps(open, [
    { gapKey: 'colorectal', action: 'ordered' },
    { gapKey: 'tdap', action: 'reported_elsewhere' },
    { gapKey: 'influenza', action: 'refused' },
    { gapKey: 'pneumococcal', action: 'ordered' },
  ]);
  assert.deepEqual(left.map((g) => g.key), ['tdap'], 'an MA patient report does not address the gap');
});

test('gap action roles and validation: MA records reports / outreach only; date + source for done elsewhere', () => {
  assert.deepEqual(allowedGapActions('MEDICAL_ASSISTANT').sort(), ['outreach', 'reported_elsewhere']);
  assert.ok(allowedGapActions('PHYSICIAN').includes('done_elsewhere'));
  assert.ok(allowedGapActions('MEDICAL_NP').includes('not_applicable'));
  assert.ok(!allowedGapActions('MEDICAL_NP').includes('reported_elsewhere'));
  assert.deepEqual(allowedGapActions('THERAPIST'), []);
  assert.deepEqual(allowedGapActions('FRONT_DESK'), []);
  const today = '2026-10-21';
  assert.match(gapActionError('tdap', { action: 'done_elsewhere' }, today)!, /date/);
  assert.match(gapActionError('tdap', { action: 'done_elsewhere', performedOn: '2026-10-01' }, today)!, /where/);
  assert.match(gapActionError('tdap', { action: 'reported_elsewhere', performedOn: '2026-11-01', source: 'CVS' }, today)!, /future/);
  assert.equal(gapActionError('tdap', { action: 'done_elsewhere', performedOn: '2026-10-01', source: 'CVS' }, today), null);
  assert.match(gapActionError('colorectal', { action: 'done_elsewhere', performedOn: '2024-01-01', source: 'GI' }, today)!, /test type/);
  assert.match(gapActionError('breast', { action: 'not_applicable' }, today)!, /why/);
  assert.match(gapActionError('breast', { action: 'outreach' }, today)!, /contacted/);
  assert.equal(gapActionError('breast', { action: 'refused' }, today), null);
});

test('diabetes from ICD-10 E10 / E11 / E13; lab text maps to A1c / uACR gaps', () => {
  assert.equal(hasDiabetesCode(['E11.9']), true);
  assert.equal(hasDiabetesCode(['E10.65', null]), true);
  assert.equal(hasDiabetesCode(['E13']), true);
  assert.equal(hasDiabetesCode(['E78.5', 'I10', 'E66.9']), false);
  assert.equal(hasDiabetesCode(['O24.4']), false);
  assert.equal(labGapFor('Hemoglobin A1c'), 'diabetes_a1c');
  assert.equal(labGapFor('Microalbumin/Creatinine Ratio, Random Urine'), 'diabetes_kidney');
  assert.equal(labGapFor('Lipid panel'), null);
});

// ─── E/M ─────────────────────────────────────────────────────────────────────

test('preventive E/M code by age band (99381–99387 new, 99391–99397 established)', () => {
  assert.equal(preventiveCode(0, true), '99381');
  assert.equal(preventiveCode(4, true), '99382');
  assert.equal(preventiveCode(5, false), '99393');
  assert.equal(preventiveCode(17, false), '99394');
  assert.equal(preventiveCode(18, true), '99385');
  assert.equal(preventiveCode(39, false), '99395');
  assert.equal(preventiveCode(40, false), '99396');
  assert.equal(preventiveCode(64, true), '99386');
  assert.equal(preventiveCode(65, false), '99397');
  assert.equal(preventiveCode(90, true), '99387');
});

test('office E/M (2021): MDM or total time, whichever supports the higher level', () => {
  assert.equal(officeEmCode({ newPatient: false, mdm: 'moderate' })!.code, '99214');
  assert.equal(officeEmCode({ newPatient: true, mdm: 'low' })!.code, '99203');
  assert.equal(officeEmCode({ newPatient: false, mdm: 'low', totalMinutes: 41 })!.code, '99215');
  assert.equal(officeEmCode({ newPatient: false, mdm: 'high', totalMinutes: 12 })!.code, '99215');
  assert.equal(officeEmCode({ newPatient: true, totalMinutes: 45 })!.code, '99204');
  assert.equal(officeEmCode({ newPatient: false, totalMinutes: 5 }), null);
  assert.equal(officeEmCode({ newPatient: false }), null);
});

test('E/M suggestions: preventive by age; Medicare AWV G0438 / G0439; suggestions only', () => {
  const p = suggestEmCodes({ preventive: true, newPatient: false, ageYears: 52, medicare: false, lastAwv: null, now: NOW, mdm: 'low' });
  assert.deepEqual(p.suggestions.map((s) => s.code), ['99396']);
  assert.ok(p.notes.some((n) => /modifier 25/.test(n)), 'problem-oriented service noted as a separate modifier-25 option');
  assert.deepEqual(suggestEmCodes({ preventive: true, newPatient: false, ageYears: 70, medicare: true, lastAwv: null, now: NOW }).suggestions.map((s) => s.code), ['G0438']);
  assert.deepEqual(suggestEmCodes({ preventive: true, newPatient: false, ageYears: 70, medicare: true, lastAwv: daysAgo(400), now: NOW }).suggestions.map((s) => s.code), ['G0439']);
  const tooSoon = suggestEmCodes({ preventive: true, newPatient: false, ageYears: 70, medicare: true, lastAwv: daysAgo(200), now: NOW });
  assert.deepEqual(tooSoon.suggestions, []);
  assert.ok(tooSoon.notes.some((n) => /11 full months/.test(n)));
  assert.deepEqual(suggestEmCodes({ preventive: false, newPatient: false, ageYears: 70, medicare: true, lastAwv: null, now: NOW, mdm: 'moderate' }).suggestions.map((s) => s.code), ['99214']);
  assert.equal(isPreventiveVisitType('Annual Physical'), true);
  assert.equal(isPreventiveVisitType('Well-Woman'), true);
  assert.equal(isPreventiveVisitType('HTN Follow-up'), false);
  assert.equal(isMedicarePayer('Medicare Part B'), true);
  assert.equal(isMedicarePayer('Maryland Medicaid', null), false);
  assert.equal(isMedicarePayer(null, 'Aetna Medicare Advantage'), true);
});

// ─── Closed loop ─────────────────────────────────────────────────────────────

test('results notification deadline: practice policy N days (default 7); portal release counts', () => {
  assert.equal(DEFAULT_RESULTS_NOTIFY_DAYS, 7);
  const resultedAt = daysAgo(5);
  const pending = resultNotifyState({ resultedAt, notifiedAt: null, releasedAt: null, notifyDays: 7, now: NOW });
  assert.equal(pending.state, 'pending');
  assert.equal(pending.daysWaiting, 5);
  assert.equal(pending.deadline, '2026-10-23');
  assert.equal(resultNotifyState({ resultedAt: daysAgo(8), notifiedAt: null, releasedAt: null, notifyDays: 7, now: NOW }).state, 'overdue');
  assert.equal(resultNotifyState({ resultedAt: daysAgo(8), notifiedAt: null, releasedAt: null, notifyDays: 10, now: NOW }).state, 'pending');
  const viaPortal = resultNotifyState({ resultedAt: daysAgo(8), notifiedAt: null, releasedAt: daysAgo(2), notifyDays: 7, now: NOW });
  assert.deepEqual([viaPortal.state, viaPortal.via], ['notified', 'portal']);
  const phone = resultNotifyState({ resultedAt: daysAgo(8), notifiedAt: daysAgo(1), notifiedMethod: 'phone', releasedAt: null, notifyDays: 7, now: NOW });
  assert.deepEqual([phone.state, phone.via], ['notified', 'phone']);
});

test('in-basket order: critical, then abnormal, then longest waiting; overdue orders', () => {
  const rows = sortResultsForReview([
    { id: 'a', critical: false, abnormal: false, daysWaiting: 9 },
    { id: 'b', critical: false, abnormal: true, daysWaiting: 1 },
    { id: 'c', critical: true, abnormal: true, daysWaiting: 0 },
    { id: 'd', critical: false, abnormal: true, daysWaiting: 4 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['c', 'd', 'b', 'a']);
  assert.equal(daysOverdue(daysAgo(10), 14, NOW), null);
  assert.equal(daysOverdue(daysAgo(20), 14, NOW), 6);
});

test('schedule chip: Ready with minutes waiting, then with provider', () => {
  assert.equal(roomingChip(null, NOW), null);
  assert.deepEqual(roomingChip({ status: 'ready', roomedAt: new Date(NOW.getTime() - 12 * 60_000), inRoomAt: null }, NOW), {
    status: 'ready',
    label: 'Ready for provider · 12 min waiting',
    minutes: 12,
  });
  assert.equal(roomingChip({ status: 'in_room', roomedAt: daysAgo(0), inRoomAt: new Date(NOW.getTime() - 5 * 60_000) }, NOW)!.label, 'With provider · 5 min');
  assert.equal(roomingChip({ status: 'draft', roomedAt: null, inRoomAt: null }, NOW)!.label, 'Rooming in progress');
});

test('POC standing orders: stored list parses; malformed rows dropped; rows without approval are drafts', () => {
  assert.deepEqual(parsePocStandingOrders(undefined), []);
  assert.deepEqual(parsePocStandingOrders([]), []);
  assert.deepEqual(parsePocStandingOrders([{ key: 'glucose', name: 'Fingerstick glucose', criteria: 'diabetes, each visit', resultType: 'numeric', unit: 'mg/dL' }, { name: 'no key' }, 'x']), [
    { key: 'glucose', name: 'Fingerstick glucose', criteria: 'diabetes, each visit', resultType: 'numeric', unit: 'mg/dL', cpt: null, status: 'draft', approval: null, retired: null },
  ]);
  assert.match(src('prisma/migrations/20261022_primary_care_workflow.sql'), /"poc_standing_orders" JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(src('prisma/migrations/20261022_primary_care_workflow.sql'), /"results_notify_days" INTEGER NOT NULL DEFAULT 7/);
});

// ─── Roles and wiring ────────────────────────────────────────────────────────

test('roles: MA / physician / medical NP room; leadership manages settings; no BH roles', () => {
  for (const r of ['MEDICAL_ASSISTANT', 'PHYSICIAN', 'MEDICAL_NP']) assert.equal(canRoomPatients(r), true, r);
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'FRONT_DESK', 'BILLING', 'OFFICE_MANAGER', 'PRACTICE_DIRECTOR']) assert.equal(canRoomPatients(r), false, r);
  assert.equal(canManagePrimaryCareSettings('PRACTICE_DIRECTOR'), true);
  assert.equal(canManagePrimaryCareSettings('PHYSICIAN'), false);
  assert.equal(canManagePrimaryCareSettings('MEDICAL_ASSISTANT'), false);
});

test('primary care protocol: rooming / vitals / screenings / care gaps are chart checks; handoff only on a positive screen', () => {
  const steps = PROTOCOLS.primary_care.steps.map((s) => s.step);
  const by = new Map(steps.map((s) => [s.id, s]));
  for (const id of ['rooming_complete', 'vitals', 'pc_screenings', 'care_gaps']) {
    assert.equal(by.get(id)?.source, 'auto', id);
    assert.ok((AUTO_STEP_IDS as readonly string[]).includes(id), id);
  }
  assert.equal(by.get('care_gaps')!.level, 'required');
  assert.equal(by.get('bh_handoff')!.when, 'positive_bh_screen');
  const ids = new Set(REQUIREMENTS.map((r) => r.id));
  for (const s of steps) for (const b of s.basis ?? []) assert.ok(ids.has(b), `${s.id} basis ${b}`);
});

test('minimum necessary: primary care reads only primary care screenings; BH status-only handoff', () => {
  const db = src('src/lib/medical/primaryCareWorkflowDb.ts');
  assert.match(db, /category: PC_SCREENING_CATEGORY/);
  assert.doesNotMatch(db, /progressNote\.findMany|body: true/, 'no BH note bodies are read');
  const loader = src('src/lib/visits/loader.ts');
  assert.match(loader, /bhChartNotes = canAccessClientChartNotes\(role\)/);
  const patch = src('src/app/api/medical/referrals/[id]/route.ts');
  assert.match(patch, /statusNote: row\.kind === 'internal_bh' \? null/);
  const rooming = src('src/app/api/medical/rooming/[appointmentId]/route.ts');
  assert.match(rooming, /has no approved standing order/);
  assert.match(rooming, /auditPhiAccess/);
});
