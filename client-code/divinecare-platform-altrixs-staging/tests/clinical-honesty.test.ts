import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLaunchDob, MISSING_DOB_MESSAGE } from '../src/lib/fhir/launchDob';
import {
  buildInCallDraftBody,
  missingInCallSelections,
  previewInCallCoding,
  psychotherapyAddOnForMinutes,
  psychotherapyCptForMinutes,
} from '../src/lib/telehealth/inCallCoding';
import { asamScoresFromDims, parseAsamScores } from '../src/lib/residential/asamScores';
import { formatEpisodeNumber, nextEpisodeNumber, yearInTimeZone } from '../src/lib/crisis/episodeNumber';
import { chartDiagnoses, parseSecondaryDiagnoses, summarizeDiagnoses } from '../src/lib/clients/diagnosisOverviewCore';

// ─── HIE: CRISP launch never substitutes a date of birth ──────────────────────
test('HIE DOB guard: missing or invalid DOB blocks the launch', () => {
  assert.equal(normalizeLaunchDob(null), null);
  assert.equal(normalizeLaunchDob(undefined), null);
  assert.equal(normalizeLaunchDob(''), null);
  assert.equal(normalizeLaunchDob('—'), null);
  assert.equal(normalizeLaunchDob('1985-02-30'), null, 'not a real calendar date');
  assert.equal(normalizeLaunchDob('03/14/1985'), null, 'only ISO dates are sent to CRISP');
  assert.equal(normalizeLaunchDob('2999-01-01'), null, 'future date');
  assert.equal(normalizeLaunchDob(new Date('invalid')), null);
  assert.match(MISSING_DOB_MESSAGE, /not recorded/i);
});

test('HIE DOB guard: a real DOB passes through unchanged (never the old 1985-03-14 stand-in)', () => {
  assert.equal(normalizeLaunchDob('1990-07-04'), '1990-07-04');
  assert.equal(normalizeLaunchDob('1990-07-04T00:00:00.000Z'), '1990-07-04');
  assert.equal(normalizeLaunchDob(new Date('1972-11-30T00:00:00.000Z')), '1972-11-30');
});

// ─── Telehealth: CPT from the actual elapsed time ─────────────────────────────
test('psychotherapy CPT follows the CMS time ranges', () => {
  assert.equal(psychotherapyCptForMinutes(null), null);
  assert.equal(psychotherapyCptForMinutes(0), null);
  assert.equal(psychotherapyCptForMinutes(15), null, 'under 16 min: no psychotherapy code');
  assert.equal(psychotherapyCptForMinutes(16), '90832');
  assert.equal(psychotherapyCptForMinutes(37), '90832');
  assert.equal(psychotherapyCptForMinutes(38), '90834');
  assert.equal(psychotherapyCptForMinutes(52), '90834');
  assert.equal(psychotherapyCptForMinutes(53), '90837');
  assert.equal(psychotherapyCptForMinutes(90), '90837');
  assert.equal(psychotherapyAddOnForMinutes(20), '90833');
  assert.equal(psychotherapyAddOnForMinutes(45), '90836');
  assert.equal(psychotherapyAddOnForMinutes(60), '90838');
  assert.equal(psychotherapyAddOnForMinutes(10), null);
});

test('coding preview: POS from patient location, otherwise "confirm patient location"', () => {
  const home = previewInCallCoding({ elapsedMinutes: 45, isPrescriberVisit: false, pos: '10' });
  assert.equal(home.primaryCpt, '90834');
  assert.equal(home.pos, '10');
  assert.match(home.posNote, /POS 10/);
  const other = previewInCallCoding({ elapsedMinutes: 55, isPrescriberVisit: false, pos: '02' });
  assert.equal(other.primaryCpt, '90837');
  assert.match(other.posNote, /POS 02/);
  const unknown = previewInCallCoding({ elapsedMinutes: 20, isPrescriberVisit: false, pos: null });
  assert.equal(unknown.pos, null);
  assert.equal(unknown.posNote, 'POS: confirm patient location');
  const short = previewInCallCoding({ elapsedMinutes: 10, isPrescriberVisit: false, pos: '10' });
  assert.equal(short.primaryCpt, null);
  assert.match(short.primaryNote ?? '', /Under 16/);
});

test('coding preview: prescriber visit never guesses an E/M level; add-on only with a documented E/M', () => {
  const noEm = previewInCallCoding({ elapsedMinutes: 40, isPrescriberVisit: true, emCode: null, pos: '10' });
  assert.equal(noEm.primaryCpt, null);
  assert.equal(noEm.addOnCpt, null);
  assert.match(noEm.primaryNote ?? '', /E\/M level not documented/);
  const withEm = previewInCallCoding({ elapsedMinutes: 40, isPrescriberVisit: true, emCode: '99214', pos: '10' });
  assert.equal(withEm.primaryCpt, '99214');
  assert.equal(withEm.addOnCpt, '90836');
  const bogus = previewInCallCoding({ elapsedMinutes: 40, isPrescriberVisit: true, emCode: '99999', pos: '10' });
  assert.equal(bogus.primaryCpt, null);
});

test('in-call draft: MSE / C-SSRS need an explicit choice; blanks say "Not recorded"', () => {
  assert.deepEqual(missingInCallSelections({}), ['C-SSRS risk', 'MSE appearance', 'MSE mood / affect', 'MSE thought process']);
  assert.deepEqual(
    missingInCallSelections({ cssrsRiskScore: 'Not assessed', mseAppearance: 'Casual', mseMood: 'Not assessed', mseThought: 'Linear/Goal-directed' }),
    []
  );
  const body = buildInCallDraftBody({ subjective: 'Slept poorly', mseAppearance: 'Casual' });
  assert.match(body, /Slept poorly/);
  assert.match(body, /Objective:\nNot recorded/);
  assert.match(body, /C-SSRS screen: Not recorded/);
  assert.doesNotMatch(body, /Euthymic|Well-groomed|Low/);
});

// ─── Residential: ASAM scores are never defaulted ─────────────────────────────
test('residential ASAM: all six dimensions or null', () => {
  assert.equal(asamScoresFromDims([null, null, null, null, null, null]), null);
  assert.equal(asamScoresFromDims([2, 1, 2, 2, 2, null]), null, 'one unrated dimension -> null, not a default 2');
  assert.equal(asamScoresFromDims([2, 1, 2]), null);
  assert.equal(asamScoresFromDims([5, 1, 2, 2, 2, 2]), null, 'out of range');
  assert.deepEqual(asamScoresFromDims([0, 1, 2, 3, 4, 0]), { dim1: 0, dim2: 1, dim3: 2, dim4: 3, dim5: 4, dim6: 0 });
});

test('residential ASAM: the API rejects partial scores instead of filling 0', () => {
  assert.deepEqual(parseAsamScores(null), { kind: 'absent' });
  assert.deepEqual(parseAsamScores(undefined), { kind: 'absent' });
  const partial = parseAsamScores({ dim1: 2, dim2: 1 });
  assert.equal(partial.kind, 'invalid');
  assert.deepEqual(partial.kind === 'invalid' ? partial.missing : [], ['dim3', 'dim4', 'dim5', 'dim6']);
  const ok = parseAsamScores({ dim1: 0, dim2: '1', dim3: 2, dim4: 3, dim5: 4, dim6: 0 });
  assert.equal(ok.kind, 'ok');
});

// ─── Textract: not configured = 503, never fixtures, never a TextractJob row ──
test('textract not configured returns 503 and saves nothing', async () => {
  const saved = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_LIVE: process.env.AWS_LIVE,
  };
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_LIVE;
  try {
    const mod = await import('../src/lib/aws/textract');
    assert.equal(mod.isTextractConfigured(), false);
    const card = await mod.analyzeDocument({
      organizationId: 'org-test',
      actorUserId: 'user-test',
      documentType: 'insurance_card',
      bytesBase64: 'aGVsbG8gd29ybGQ=',
    });
    assert.deepEqual(card, { ok: false, status: 503, error: 'Card scanning not configured' });
    const form = await mod.analyzeMedicalForm({ organizationId: 'org-test', actorUserId: 'user-test', bytesBase64: 'aGVsbG8gd29ybGQ=' });
    assert.equal(form.ok, false);
    assert.equal(form.ok === false ? form.status : 0, 503);
    // AWS_LIVE=true (instance role) counts as configured, so staging calls Textract for real
    process.env.AWS_LIVE = 'true';
    assert.equal(mod.isTextractConfigured(), true);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ─── Crisis: server-assigned episode numbers ──────────────────────────────────
test('crisis episode numbers: current year, sequence per org', () => {
  assert.equal(formatEpisodeNumber(2026, 1), 'MC-2026-0001');
  assert.equal(nextEpisodeNumber(2026, []), 'MC-2026-0001');
  assert.equal(nextEpisodeNumber(2026, ['MC-2026-0001', 'MC-2026-0007', 'MC-2026-0003']), 'MC-2026-0008');
  assert.equal(nextEpisodeNumber(2027, ['MC-2026-0099']), 'MC-2027-0001', 'sequence restarts each year');
  assert.equal(nextEpisodeNumber(2026, ['garbage', null, 'MC-2026-12345']), 'MC-2026-12346');
  // 11 pm Dec 31 Eastern is already Jan 1 in UTC: the episode belongs to the practice's year
  assert.equal(yearInTimeZone(new Date('2027-01-01T04:00:00.000Z'), 'America/New_York'), 2026);
  assert.equal(yearInTimeZone(new Date('2027-01-01T06:00:00.000Z'), 'America/New_York'), 2027);
  assert.equal(yearInTimeZone(new Date('2026-06-01T12:00:00.000Z'), 'Not/AZone'), 2026);
});

// ─── Diagnoses: from the client record, Multi-Dx = 2+ diagnoses ───────────────
test('chart diagnoses: parsed from the client record, multi-Dx counted on 2+ diagnoses', () => {
  assert.deepEqual(parseSecondaryDiagnoses(' F41.1, F43.10 ;F41.1,, '), ['F41.1', 'F43.10']);
  const rows = [
    { id: 'a', primaryDiagnosisCode: 'F33.1', primaryDiagnosis: 'MDD, recurrent, moderate', secondaryDiagnoses: 'F41.1' },
    { id: 'b', primaryDiagnosisCode: 'F33.1', primaryDiagnosis: 'MDD', secondaryDiagnoses: null },
    { id: 'c', primaryDiagnosisCode: null, primaryDiagnosis: null, secondaryDiagnoses: null },
    { id: 'd', primaryDiagnosisCode: 'F41.1', primaryDiagnosis: null, secondaryDiagnoses: 'F41.1' },
  ];
  assert.equal(chartDiagnoses(rows[2]).length, 0);
  assert.equal(chartDiagnoses(rows[3]).length, 1, 'secondary repeating the primary is not a second diagnosis');
  const s = summarizeDiagnoses(rows);
  assert.equal(s.clientsWithDiagnosis, 3);
  assert.equal(s.multiDxClients, 1);
  assert.equal(s.uniqueCodes, 2);
  assert.deepEqual(s.prevalence[0], { key: 'F33.1', count: 2 });
});
