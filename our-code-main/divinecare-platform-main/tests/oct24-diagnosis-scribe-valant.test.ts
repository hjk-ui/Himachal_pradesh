import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RISK_ATTESTATION_PREFIX,
  TRANSCRIPT_RISK_CODE,
  detectStigmaWording,
  detectTranscriptRisk,
  evaluateTranscriptRiskGate,
  isStoredAttestationValid,
  noteNeedsRiskAttestation,
  validateRiskAttestationReason,
} from '../src/lib/scribe-safety/transcriptRiskGate';
import { DIAGNOSIS_COPY } from '../src/lib/diagnoses/copy';
import { normalizeIcdCode } from '../src/lib/diagnoses/list';
import { isSudDiagnosisCode } from '../src/lib/diagnoses/sud';
import {
  PART2_WITHHOLD_NOTICE,
  partitionDiagnosesForDrFirst,
} from '../src/lib/drfirst/part2-withhold';
import {
  DEFAULT_NOTES_POLICY,
  noteSectionsEnforcement,
  normalizeNotesPolicy,
  requiredNoteSectionsNotice,
} from '../src/lib/notes/notes-policy';
import { maskChartId } from '../src/lib/valant/appointmentHistory';
import {
  buildClientMatcher,
  parseAppointmentHistoryRows,
  planHistoryImport,
} from '../src/lib/valant/appointmentHistoryImport';
import { getHomebaseConfig } from '../src/lib/homebase/client';
import { DELETE as deleteDiagnoses } from '../src/app/api/clients/[id]/diagnoses/route';
import { DELETE as deleteDiagnosis } from '../src/app/api/clients/[id]/diagnoses/[dxId]/route';

test('transcript risk: detects risk language and gates signing', () => {
  const scan = detectTranscriptRisk('Client said she wants to die and has a plan.');
  assert.equal(scan.flagged, true);
  assert.equal(scan.matches[0].category, 'suicidal_ideation');
  assert.equal(detectTranscriptRisk('Discussed sleep hygiene and work stress.').flagged, false);

  const blocked = evaluateTranscriptRiskGate({ flagged: true });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, TRANSCRIPT_RISK_CODE);
  assert.equal(evaluateTranscriptRiskGate({ flagged: false }).ok, true);
});

test('transcript risk: attestation prefix and 15–1000 character reason', () => {
  assert.equal(RISK_ATTESTATION_PREFIX, 'Risk content was reviewed; no further assessment indicated because ');
  assert.equal(validateRiskAttestationReason('too short').ok, false);
  assert.equal(validateRiskAttestationReason('x'.repeat(1001)).ok, false);
  const ok = validateRiskAttestationReason('the client denied intent or plan and safety plan was reviewed');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.ok(ok.text.startsWith(RISK_ATTESTATION_PREFIX));
    assert.equal(isStoredAttestationValid(ok.text), true);
    const gate = evaluateTranscriptRiskGate({ flagged: true, attestationReason: ok.reason });
    assert.equal(gate.ok, true);
  }
  assert.equal(isStoredAttestationValid('No further assessment needed'), false);
});

test('transcript risk: AI-drafted notes with risk text need attestation; plain notes do not', () => {
  assert.equal(noteNeedsRiskAttestation({ body: 'Client reports suicidal thoughts', aiProvenance: { model: 'x' } }), true);
  assert.equal(noteNeedsRiskAttestation({ body: 'Client reports suicidal thoughts', aiProvenance: null }), false);
  assert.equal(noteNeedsRiskAttestation({ body: 'ok', transcriptRiskFlagged: true }), true);
  assert.equal(detectStigmaWording('He is an addict and non-compliant').length, 2);
});

test('diagnosis list: exact delete copy and 405', async () => {
  assert.equal(
    DIAGNOSIS_COPY.noDelete,
    'Diagnoses are not deleted. Resolve it, rule it out, or mark it entered in error; the history is kept.'
  );
  for (const del of [deleteDiagnoses, deleteDiagnosis]) {
    const res = await del();
    assert.equal(res.status, 405);
    assert.equal((await res.json()).error, DIAGNOSIS_COPY.noDelete);
  }
  assert.equal(DIAGNOSIS_COPY.empty, 'No current diagnosis on the list.');
  assert.equal(DIAGNOSIS_COPY.searchPlaceholder, 'ICD-10-CM code or words (FY2027)');
});

test('diagnosis list: ICD-10-CM normalization', () => {
  assert.equal(normalizeIcdCode('f411'), 'F41.1');
  assert.equal(normalizeIcdCode(' F33.1 '), 'F33.1');
  assert.equal(normalizeIcdCode('F32'), 'F32');
  assert.equal(normalizeIcdCode('hello'), null);
  assert.equal(normalizeIcdCode(''), null);
});

test('Part 2: SUD diagnoses are withheld from DrFirst without consent', () => {
  assert.equal(isSudDiagnosisCode('F10.20'), true);
  assert.equal(isSudDiagnosisCode('F17.210'), false);
  assert.equal(isSudDiagnosisCode('F41.1'), false);
  const dx = [{ code: 'F10.20' }, { code: 'F41.1' }];
  const without = partitionDiagnosesForDrFirst(dx, false);
  assert.deepEqual(without.send, [{ code: 'F41.1' }]);
  assert.equal(without.notice, 'SUD diagnoses not sent to DrFirst: no Part 2 consent on file');
  assert.equal(without.notice, PART2_WITHHOLD_NOTICE);
  const withConsent = partitionDiagnosesForDrFirst(dx, true);
  assert.equal(withConsent.send.length, 2);
  assert.equal(withConsent.notice, null);
});

test('notes policy: defaults, clamping, section enforcement notice', () => {
  assert.deepEqual(DEFAULT_NOTES_POLICY, { requireDiagnosisToSign: true, diagnosisReviewDays: 90 });
  assert.equal(normalizeNotesPolicy({ diagnosisReviewDays: 5 }).diagnosisReviewDays, 30);
  assert.equal(normalizeNotesPolicy({ diagnosisReviewDays: 9999 }).diagnosisReviewDays, 365);
  assert.equal(normalizeNotesPolicy({ requireDiagnosisToSign: false }).requireDiagnosisToSign, false);
  assert.equal(requiredNoteSectionsNotice(), 'Required note sections: warn until 2026-11-16, then block');
  assert.equal(noteSectionsEnforcement('2026-11-15'), 'warn');
  assert.equal(noteSectionsEnforcement('2026-11-16'), 'block');
});

test('Homebase: not connected without both env vars (no sample data)', () => {
  assert.equal(getHomebaseConfig({} as NodeJS.ProcessEnv), null);
  assert.equal(getHomebaseConfig({ HOMEBASE_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv), null);
  const cfg = getHomebaseConfig({ HOMEBASE_API_KEY: 'k', HOMEBASE_ORGANIZATION_ID: 'org1' } as unknown as NodeJS.ProcessEnv);
  assert.equal(cfg?.organizationId, 'org1');
  assert.equal(cfg?.timeoutMs, 15000);
});

function apptRow(date: string, time: string, patient: string, cpt = '', provider = 'Dr A'): string[] {
  const r = Array.from({ length: 24 }, () => '');
  r[5] = date;
  r[6] = time;
  r[7] = patient;
  r[9] = cpt;
  r[15] = provider;
  return r;
}

test('Valant history: parse, plan, dedupe, mask', () => {
  assert.equal(maskChartId('AB123456'), 'AB****56');
  const header = Array.from({ length: 24 }, (_, i) => `c${i}`);
  const parsed = parseAppointmentHistoryRows([
    header,
    apptRow('1/6/2025', '9:00-10:00 AM', 'Pat Example (CH100)', '90837'),
    apptRow('1/7/2025', '9:00-10:00 AM', 'Pat Example (CH100)', ''),
    apptRow('1/8/2025', '9:00-10:00 AM', 'NON-PATIENT', ''),
    apptRow('1/9/2025', '9:00-10:00 AM', 'Pat Example (CH100)', '90837'),
    apptRow('1/9/2025', '9:00-10:00 AM', 'Pat Example (CH100)', '90837'),
  ]);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.skipped.non_patient, 1);
  assert.equal(parsed.rows.length, 4);

  const clients = [{ id: 'c1', name: 'Pat Example', mrn: 'CH100', sourceId: null }];
  const match = buildClientMatcher(clients, { nameMatch: true });
  const base = { rows: parsed.rows, window: {}, match, existing: [] as never[] };

  const strict = planHistoryImport({ ...base, options: { treatUncodedAsAttended: false } });
  assert.equal(strict.counts.uncodedSkipped, 1);
  assert.equal(strict.counts.duplicateInFile, 1);
  assert.equal(strict.create.length, 2);

  const loose = planHistoryImport({ ...base, options: { treatUncodedAsAttended: true } });
  assert.equal(loose.create.length, 3);

  const rerun = planHistoryImport({
    ...base,
    options: { treatUncodedAsAttended: true },
    existing: loose.create.map((c, i) => ({
      id: `a${i}`,
      clientId: c.clientId,
      startsAt: new Date('1999-01-01'),
      status: 'COMPLETED',
      source: 'valant_history',
      externalKey: c.externalKey,
      createdVia: 'import',
    })),
  });
  assert.equal(rerun.create.length, 0);
  assert.equal(rerun.counts.alreadyImported, 4); // 3 distinct visits + the in-file duplicate

  const bad = parseAppointmentHistoryRows([header, ['too', 'short']]);
  assert.ok(bad.error);

  const noName = buildClientMatcher(clients, { nameMatch: false });
  assert.equal(noName({ chartId: null, nameFromExport: 'Pat Example' }).kind, 'none');
});
