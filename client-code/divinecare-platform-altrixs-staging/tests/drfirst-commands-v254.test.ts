/**
 * Rcopia v2.54 commands added Oct 16 2026: update_problem, update_patient (+ lookup),
 * office visits, search_problem, search_drug_detail, send_prescription, and the
 * corrected send_problem layout. Fixtures in tests/fixtures/rcopia are sanitized
 * <Response> sections captured live from DrFirst STAGING 201 with DrFirst's own
 * test patient (maxpatient) and test provider; names / DOB / phone / address are
 * placeholders. No network: fetch is stubbed and replays a fixture.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  parseOfficeVisitDownload,
  parsePatientDownload,
  parseProblemDownload,
  parseProblemSearch,
  parseSendItems,
} from '../src/lib/services/drfirstCommands';
import {
  appointmentOfficeVisit,
  clinicVisitDate,
  mapDownloadedProblem,
  matchesNameAndDob,
  officeVisitPayload,
  patientReview,
  patientReviewPayload,
  problemExternalId,
  rcopiaDate,
} from '../src/lib/drfirst/chartMapping';
import { envelopeStatus } from '../src/lib/services/drfirstRcopiaService';

const fx = (name: string) => readFileSync(new URL(`./fixtures/rcopia/${name}`, import.meta.url), 'utf8');

test('update_problem (live shape): Status child element, ICD10 vs ICD9, deleted, own vs patient ids', () => {
  const rows = parseProblemDownload(fx('update_problem.xml'));
  assert.equal(rows.length, 2);
  const [deleted, icd9] = rows;
  assert.equal(deleted.rcopiaId, '6132308711', 'problem id, not the patient RcopiaID');
  assert.equal(deleted.externalId, 'altrixs-probe-prob-1');
  assert.equal(deleted.patientRcopiaId, '27162725039');
  assert.equal(deleted.patientExternalId, 'maxpatient');
  assert.equal(deleted.codeSystem, 'ICD10');
  assert.equal(deleted.code, 'F41.1');
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.deleted, true);
  assert.equal(icd9.codeSystem, 'ICD9');
  assert.equal(icd9.code, '300.0');
  assert.equal(icd9.description, 'Anxiety States');
  assert.equal(icd9.status, 'active');
  assert.equal(icd9.onsetDate, '10/15/2026');
  assert.equal(icd9.lastModifiedBy, 'ssherman');
  assert.equal(icd9.externalId, undefined);
});

test('update_problem rows -> MedicalProblem fields: never invent an ICD-10 code; deleted -> Inactive', () => {
  const [deleted, icd9] = parseProblemDownload(fx('update_problem.xml'));
  const m9 = mapDownloadedProblem(icd9)!;
  assert.equal(m9.icd10Code, '', 'ICD-9 is not converted');
  assert.equal(m9.name, 'Anxiety States');
  assert.equal(m9.status, 'Active');
  assert.equal(m9.notes, 'ICD-9-CM 300.0 (recorded in DrFirst)');
  assert.equal(m9.onsetDate?.toISOString(), '2026-10-15T00:00:00.000Z');
  const m10 = mapDownloadedProblem(deleted)!;
  assert.equal(m10.icd10Code, 'F41.1');
  assert.equal(m10.status, 'Inactive');
  assert.equal(mapDownloadedProblem({ ...icd9, status: 'resolved' })!.status, 'Resolved');
  assert.equal(mapDownloadedProblem({ ...icd9, code: '', description: '' }), null);
  assert.equal(mapDownloadedProblem({ ...icd9, codeSystem: 'ICD10', code: 'NOTACODE' })!.icd10Code, '');
  assert.equal(problemExternalId('c1', 'F41.1'), 'altrixs-dx-c1-F41.1');
});

test('update_patient (live shapes): found by external id; unknown id is a per-patient bad_patient_id', () => {
  const [p] = parsePatientDownload(fx('update_patient_by_external_id.xml'));
  assert.equal(p.rcopiaId, '27162725039');
  assert.equal(p.externalId, 'maxpatient');
  assert.equal(p.lastName, 'Patient');
  assert.equal(p.dob, '01/02/1980');
  assert.equal(p.sex, 'm');
  assert.equal(p.deleted, false);
  assert.equal(p.error, undefined);
  const [missing] = parsePatientDownload(fx('update_patient_not_found.xml'));
  assert.equal(missing.rcopiaId, undefined);
  assert.equal(missing.externalId, 'no-such-ext-id-xyz');
  assert.equal(missing.error?.code, 'bad_patient_id');
});

test('patient review: link confirmed only via our external id; differences recorded, never applied', () => {
  const [p] = parsePatientDownload(fx('update_patient_by_external_id.xml'));
  const chart = {
    id: 'maxpatient', rcopiaPatientId: null, legalFirstName: 'test', legalLastName: 'PATIENT',
    dateOfBirth: new Date('1980-01-02T00:00:00Z'), gender: 'Male', postalCode: '00000-1234',
  };
  assert.deepEqual(patientReview(chart, p), { linkRcopiaId: '27162725039', differences: [] });
  assert.equal(patientReviewPayload('27162725039', patientReview(chart, p)), null, 'nothing to review');

  const linkedElsewhere = patientReview({ ...chart, rcopiaPatientId: '111' }, p);
  assert.deepEqual(linkedElsewhere.linkConflict, { chartRcopiaId: '111', drfirstRcopiaId: '27162725039' });
  assert.equal(linkedElsewhere.linkRcopiaId, undefined);

  const differs = patientReview({ ...chart, id: 'other', legalLastName: 'Jones', dateOfBirth: new Date('1981-01-02T00:00:00Z'), gender: 'F' }, p);
  assert.equal(differs.linkRcopiaId, undefined, 'matched by Rcopia id only: no link change');
  assert.deepEqual(differs.differences, [
    { field: 'lastName', drfirst: 'Patient' },
    { field: 'dateOfBirth', drfirst: '1980-01-02' },
    { field: 'sex', drfirst: 'M' },
  ]);
  const payload = patientReviewPayload('27162725039', differs)!;
  assert.equal(payload.fingerprint, patientReviewPayload('27162725039', differs)!.fingerprint, 'stable fingerprint');
  assert.equal(patientReview({ ...chart, legalFirstName: null }, p).differences.length, 0, 'blank chart field is not a difference');
  assert.equal(patientReview(chart, { ...p, deleted: true }).deletedInDrFirst, true);

  assert.equal(matchesNameAndDob(chart, p), true);
  assert.equal(matchesNameAndDob({ ...chart, dateOfBirth: null }, p), false);
  assert.equal(matchesNameAndDob({ ...chart, legalLastName: 'Patients' }, p), false);
  assert.equal(rcopiaDate('02/30/2026'), null);
  assert.equal(rcopiaDate(''), null);
});

test('office visits (live shape) and the visit sent for a completed appointment', () => {
  const [v] = parseOfficeVisitDownload(fx('update_patient_office_visits.xml'));
  assert.equal(v.rcopiaId, '6191175287', 'visit id, not patient / provider id');
  assert.equal(v.externalId, 'altrixs-probe-visit-1');
  assert.equal(v.patientRcopiaId, '27162725039');
  assert.equal(v.visitDate, '10/16/2026');
  assert.equal(v.renderingProviderUsername, 'ssherman');
  assert.equal(v.deleted, true);
  const payload = officeVisitPayload({ ...v, externalId: 'altrixs-appt-appt_1' });
  assert.equal(payload.origin, 'altrixs');
  assert.equal(payload.appointmentId, 'appt_1');
  assert.equal(JSON.stringify(payload).includes('Test'), false, 'no names in the payload');

  // 02:00 UTC on Oct 17 is still Oct 16 in Maryland
  assert.equal(clinicVisitDate(new Date('2026-10-17T02:00:00Z')), '2026-10-16');
  assert.deepEqual(appointmentOfficeVisit({ appointmentId: 'a1', startsAt: new Date('2026-10-16T14:00:00Z'), clinicianRcopiaUsername: ' np1 ' }), {
    externalId: 'altrixs-appt-a1', visitDate: '2026-10-16', renderingProviderUsername: 'np1',
  });
  assert.deepEqual(appointmentOfficeVisit({ appointmentId: 'a1', startsAt: new Date('2026-10-16T14:00:00Z'), clinicianRcopiaUsername: null }), {
    externalId: 'altrixs-appt-a1', visitDate: '2026-10-16',
  });
  assert.equal(appointmentOfficeVisit({ appointmentId: 'a1', startsAt: null, clinicianRcopiaUsername: null }), null);
});

test('send_* item status (live shapes) and search_problem parsing keeps only ICD-10-CM codes DrFirst returned', () => {
  assert.deepEqual(parseSendItems(fx('send_problem_created.xml'), 'Problem'), [
    { rcopiaId: '6132308711', externalId: 'altrixs-probe-prob-1', status: 'created', errorCode: undefined, errorText: undefined },
  ]);
  assert.equal(parseSendItems(fx('send_patient_office_visits_created.xml'), 'OfficeVisit')[0].status, 'created');
  // search_problem is not_permitted on staging: its success layout is unverified; only coded ICD-10 pairs are read
  const synthetic = '<Response><ProblemList><Problem><ICD10><Code>f41.1</Code><Description>Generalized anxiety disorder</Description></ICD10></Problem>'
    + '<Problem><ICD10><Code>F41.1</Code><Description>dup</Description></ICD10></Problem>'
    + '<Problem><ICD10><Code>300.0</Code><Description>not icd10</Description></ICD10></Problem>'
    + '<Problem><ICD10><Code>F32.9</Code><Description></Description></ICD10></Problem></ProblemList><Status>ok</Status></Response>';
  assert.deepEqual(parseProblemSearch(synthetic), [{ code: 'F41.1', description: 'Generalized anxiety disorder' }]);
  assert.deepEqual(parseProblemSearch(fx('search_problem_not_permitted.xml')), []);
});

test('envelope status: send_* (ok first, item status after) and update_* (status last) both read the Response status', () => {
  assert.equal(envelopeStatus(fx('send_problem_created.xml')), 'ok', 'not the item "created"');
  assert.equal(envelopeStatus(fx('update_problem.xml')), 'ok');
  assert.equal(envelopeStatus(fx('update_patient_by_external_id.xml')), 'ok');
  assert.equal(envelopeStatus(fx('search_problem_not_permitted.xml')), 'error');
  assert.equal(envelopeStatus(fx('patient_search_get_data_unrecognized.xml')), 'error');
  assert.equal(envelopeStatus('<Response></Response>'), '');
});

// ─── Through the real envelope + servlet response handling (fetch stubbed) ───

function loadLive(t: { after: (fn: () => void) => void }, replies: string[]) {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.DRFIRST_VENDOR_USERNAME = 'vendor_test';
  process.env.DRFIRST_VENDOR_PASSWORD = 'secret-test-marker';
  process.env.DRFIRST_PRACTICE_USERNAME = 'practice_test';
  process.env.DRFIRST_ENGINE_URL = 'https://engine.test/servlet';
  process.env.DRFIRST_UPDATE_URL = 'https://update.test/servlet';
  const sent: { url: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    sent.push({ url, body: init.body });
    // Rcopia echoes the request before the response; the service must parse only <Response>
    const reply = replies.shift() ?? '<Response><Status>ok</Status></Response>';
    return new Response(`<RCExtResponse version="2.54"><Request>${init.body.replace(/<\?xml[^>]*>/, '')}</Request>${reply}</RCExtResponse>`, { status: 200 });
  }) as typeof fetch;
  t.after(() => { process.env = env; globalThis.fetch = realFetch; });
  const require = createRequire(import.meta.url);
  for (const k of Object.keys(require.cache)) if (/drfirst(RcopiaService|Commands)/.test(k)) delete require.cache[k];
  return { cmds: require('../src/lib/services/drfirstCommands'), sent };
}

test('send_problem: ProblemList layout with ExternalID; a bare "ok" without an item is a failure', async t => {
  const h = loadLive(t, [fx('send_problem_created.xml'), '<Response><Status>ok</Status></Response>']);
  const ok = await h.cmds.sendProblem({ rcopiaId: '27162725039' }, 'F41.1', 'Generalized anxiety disorder', 'ssherman', { externalId: 'altrixs-probe-prob-1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.item.rcopiaId, '6132308711');
  const body = h.sent[0].body;
  assert.equal(h.sent[0].url, 'https://engine.test/servlet');
  assert.match(body, /<ProblemList>\s*<Problem>\s*<ExternalID>altrixs-probe-prob-1<\/ExternalID>\s*<Patient>\s*<RcopiaID>27162725039<\/RcopiaID>\s*<\/Patient>\s*<ICD10>\s*<Code>F41\.1<\/Code>/);
  const silent = await h.cmds.sendProblem({ rcopiaId: '27162725039' }, 'F41.1', 'GAD', 'ssherman');
  assert.equal(silent.ok, false);
  assert.equal(silent.error.code, 'no_item_status');
  const bad = await h.cmds.sendProblem({ rcopiaId: '1' }, 'Anxiety', 'x', 'ssherman');
  assert.equal(bad.error.code, 'invalid_icd10');
  assert.equal(h.sent.length, 2, 'invalid code never sent');
});

test('update_patient lookup: per-patient bad_patient_id is "not found", not a failed call; PatientList filter sent', async t => {
  const h = loadLive(t, [fx('update_patient_not_found.xml'), fx('update_patient_by_external_id.xml')]);
  const miss = await h.cmds.updatePatients({ patients: [{ externalId: 'no-such-ext-id-xyz' }] }, 'ssherman');
  assert.equal(miss.ok, true);
  assert.equal(miss.patients[0].error.code, 'bad_patient_id');
  assert.match(h.sent[0].body, /<PatientList>\s*<Patient>\s*<ExternalID>no-such-ext-id-xyz<\/ExternalID>/);
  assert.equal(h.sent[0].url, 'https://update.test/servlet');
  const hit = await h.cmds.updatePatients({ patients: [{ externalId: 'maxpatient' }] }, 'ssherman');
  assert.equal(hit.patients[0].rcopiaId, '27162725039');
});

test('update_problem / office visits: cursor sent, next cursor read from the response (not our echoed request)', async t => {
  const h = loadLive(t, [fx('update_problem.xml'), fx('update_patient_office_visits.xml')]);
  const probs = await h.cmds.updateProblems({ lastUpdateDate: '01/01/2020 00:00:00' }, 'ssherman');
  assert.equal(probs.ok, true);
  assert.equal(probs.nextCursor, '10/16/2026 22:28:24');
  assert.equal(probs.problems.length, 2);
  const visits = await h.cmds.updateOfficeVisits({ lastUpdateDate: '01/01/2026 00:00:00', patients: [{ rcopiaId: '27162725039' }] }, 'ssherman');
  assert.equal(visits.nextCursor, '10/16/2026 22:28:28');
  assert.equal(visits.visits.length, 1);
  assert.match(h.sent[1].body, /<PatientList>\s*<Patient>\s*<RcopiaID>27162725039/);
});

test('not_permitted commands (live): search_problem, search_drug_detail, delete pending; send_prescription off by default', async t => {
  const h = loadLive(t, [fx('search_problem_not_permitted.xml'), fx('search_drug_detail_not_permitted.xml'), fx('send_prescription_not_permitted.xml')]);
  const sp = await h.cmds.searchProblems('anxiety', 'ssherman');
  assert.equal(sp.ok, false);
  assert.equal(sp.error.code, 'not_permitted');
  assert.deepEqual(sp.results, []);
  const sd = await h.cmds.searchDrugDetail('sertraline', 'ssherman');
  assert.equal(sd.error.code, 'not_permitted');
  const del = await h.cmds.deletePendingPrescription({ rcopiaId: '27162725039' }, '1', 'ssherman');
  assert.equal(del.error.code, 'not_permitted');
  assert.match(h.sent[2].body, /<Deleted>y<\/Deleted>\s*<RcopiaID>1<\/RcopiaID>\s*<IsDischargePrescription>y/);

  delete process.env.DRFIRST_ENABLE_SEND_PRESCRIPTION;
  const off = await h.cmds.sendPrescription({ rcopiaId: '1' }, { genericName: 'sertraline' }, 'ssherman');
  assert.equal(off.error.code, 'disabled');
  assert.equal(h.sent.length, 3, 'disabled send_prescription makes no call');
  process.env.DRFIRST_ENABLE_SEND_PRESCRIPTION = 'true';
  await h.cmds.sendPrescription({ rcopiaId: '1' }, { genericName: 'sertraline', strength: '50 mg', quantity: '30' }, 'ssherman');
  assert.match(h.sent[3].body, /<Command>send_prescription<\/Command>[\s\S]*<IsDischargePrescription>y<\/IsDischargePrescription>[\s\S]*<GenericName>sertraline<\/GenericName>[\s\S]*<Quantity>30<\/Quantity>/);
  assert.equal(h.sent.some(s => s.body.includes('secret-test-marker') && !s.body.includes('<VendorPassword>secret-test-marker</VendorPassword>')), false);
});

test('feature cache: not_permitted disables until the recheck window passes; success enables', () => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) { return id === 'server-only' ? {} : original.call(this, id, ...args); };
  try {
    const f = createRequire(import.meta.url)('../src/app/api/drfirst/_lib/features');
    f.resetFeatureCache();
    assert.equal(f.knownEnabled('search_problem', 0), undefined);
    f.recordOutcome('search_problem', { ok: false, error: { code: 'not_permitted' } }, 0);
    assert.equal(f.knownEnabled('search_problem', 1000), false);
    assert.equal(f.knownEnabled('search_problem', 7 * 3600 * 1000), undefined, 'rechecked after 6 hours');
    f.recordOutcome('search_problem', { ok: false, error: { code: 'network_error' } }, 0);
    assert.equal(f.knownEnabled('search_problem', 1), undefined, 'transient errors are not cached');
    f.recordOutcome('search_problem', { ok: true }, 0);
    assert.equal(f.knownEnabled('search_problem', 1), true);
    f.recordOutcome('search_drug_detail', { ok: true, demo: true }, 0);
    assert.equal(f.knownEnabled('search_drug_detail', 1), undefined, 'demo mode proves nothing');
  } finally {
    loader._load = original;
  }
});
