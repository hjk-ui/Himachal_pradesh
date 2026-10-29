/**
 * DrFirst certification (docs/drfirst-certification/README.md): request building (GM9 escaping, MUM5
 * sig text, PDUM1/2 address, PDUR2 phones, GM4 version), response parsing of every download against
 * sanitized live STAGING 201 captures (tests/fixtures/rcopia, Oct 20 2026), notification badge counts
 * (NCDM2), the call log (GM6 / GM12) and "Rcopia not reachable" handling. No network: fetch is stubbed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  parseAllergyDownload,
  parseMedicationDownload,
  parsePrescriptionDownload,
  parsePrescriptionEvents,
} from '../src/lib/services/drfirstCommands';
import {
  badgeCountsFor,
  parseNotificationCounts,
  parseSendPatientItem,
  sendPatientBody,
  xmlEscape,
} from '../src/lib/services/drfirstRcopiaService';
import { expandLatinSig, hasLatinAbbreviation } from '../src/lib/drfirst/sigText';
import { buildRcopiaPatient, type RcopiaPatientSource } from '../src/lib/drfirst/patientDemographics';
import { drfirstReadiness, isPlaceholderPhone } from '../src/lib/clients/demographics';
import {
  chartMedicationToRcopia,
  doseFormOf,
  fingerprint,
  pendingMedicationSends,
  pendingSends,
  readLedger,
  strengthOf,
  type ChartMedication,
} from '../src/lib/drfirst/chartMapping';
import { scrubPayload } from '../src/lib/drfirst/persistence';

const fx = (name: string) => readFileSync(new URL(`./fixtures/rcopia/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-20T15:00:00Z');

// ─── GM9: escaping ───────────────────────────────────────────────────────────

test('GM9: & < > " \' are escaped, non-ASCII kept, XML-invalid characters dropped', () => {
  assert.equal(xmlEscape(`O'Brien & <Sons> "Jr"`), 'O&apos;Brien &amp; &lt;Sons&gt; &quot;Jr&quot;');
  assert.equal(xmlEscape('José Müller 李 😀'), 'José Müller 李 😀', 'UTF-8 text is sent as is');
  assert.equal(xmlEscape('a\u0000b\u0007c\u001Fd\tE\nF'), 'abcd\tE\nF', 'control characters other than tab / LF / CR are dropped');
  assert.equal(xmlEscape('x\uD800y'), 'xy', 'lone surrogate dropped');
  assert.equal(xmlEscape(null as unknown as string), '');
  const xml = sendPatientBody({
    externalId: 'c&1', firstName: `Zoë`, lastName: `O'Neil <test>`, dob: '1990-01-02', gender: 'F', zipCode: '20715',
    addressLine1: '1 "A" St & Co', city: 'Bowie', state: 'MD',
  });
  assert.match(xml, /<ExternalID>c&amp;1<\/ExternalID>/);
  assert.match(xml, /<FirstName>Zoë<\/FirstName>/);
  assert.match(xml, /<LastName>O&apos;Neil &lt;test&gt;<\/LastName>/);
  assert.match(xml, /<Address1>1 &quot;A&quot; St &amp; Co<\/Address1>/);
});

// ─── MUM5: sig text ──────────────────────────────────────────────────────────

test('MUM5: Latin abbreviations are expanded to plain English', () => {
  const cases: [string, string][] = [
    ['1 tab PO BID', '1 tab by mouth twice a day'],
    ['take t.i.d. p.r.n. anxiety', 'take three times a day as needed anxiety'],
    ['QHS', 'at bedtime'],
    ['q.i.d.', 'four times a day'],
    ['QD', 'once a day'],
    ['q6h prn pain', 'every 6 hours as needed pain'],
    ['q 8 hrs', 'every 8 hours'],
    ['1 SL stat', '1 under the tongue immediately'],
    ['inject IM qod', 'inject into the muscle every other day'],
    ['2 gtts AC', '2 drops before meals'],
    ['take with food in the morning', 'take with food in the morning'],
    ['status check (not an abbreviation)', 'status check (not an abbreviation)'],
  ];
  for (const [input, expected] of cases) assert.equal(expandLatinSig(input), expected, input);
  assert.equal(hasLatinAbbreviation('twice a day by mouth'), false);
  assert.equal(hasLatinAbbreviation('bid'), true);
});

// ─── PDUM1 / PDUM2 / PDUR2: demographics ─────────────────────────────────────

const CLIENT: RcopiaPatientSource = {
  id: 'c1', legalFirstName: 'Jane', middleInitial: null, legalLastName: 'Testpatient', dateOfBirth: new Date('1990-04-02T00:00:00Z'),
  administrativeSex: 'F', gender: null, addressLine1: '1 Test St', city: 'Bowie', state: 'MD', postalCode: '20715-1234',
  phone: '(410) 628-3910', phoneType: 'mobile', phoneSecondary: null, phoneSecondaryType: null,
};

test('PDUR2: placeholder phones are never sent', () => {
  for (const p of ['5555550100', '4105550123', '2222222222', '3010000000', '4101111111', '9115551234', '4109114567', '1234567890'])
    assert.equal(isPlaceholderPhone(p), true, p);
  for (const p of ['4106283910', '3012624417', '2405551234']) assert.equal(isPlaceholderPhone(p), false, p);
  const b = buildRcopiaPatient({ ...CLIENT, phone: '(410) 555-0100', phoneSecondary: '301-262-4417', phoneSecondaryType: 'home' }, NOW);
  assert.ok(b.ok);
  if (b.ok) {
    assert.equal(b.patient.mobilePhone, undefined, '555-01xx dropped');
    assert.equal(b.patient.homePhone, '3012624417');
    assert.equal(b.patient.zipCode, '207151234', 'ZIP+4 sent as 9 digits');
  }
});

test('PDUM1 / PDUM2: no upload without name / sex / DOB / ZIP; homeless / unknown use the clinic city, state, ZIP', () => {
  const missing = buildRcopiaPatient({ ...CLIENT, legalLastName: null, dateOfBirth: null, administrativeSex: null, postalCode: null }, NOW);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(missing.missing.map(g => g.field).sort(), ['administrativeSex', 'dateOfBirth', 'legalLastName', 'postalCode']);

  const noAddress = { ...CLIENT, addressLine1: null, city: null, state: null, postalCode: null };
  assert.equal(drfirstReadiness(noAddress, NOW).ready, false, 'a blank address is not ready');
  assert.equal(drfirstReadiness({ ...noAddress, addressStatus: 'homeless' }, NOW).ready, true, 'homeless is ready');

  const clinic = { city: 'Silver Spring', state: 'md', postalCode: '20910' };
  const homeless = buildRcopiaPatient({ ...noAddress, addressStatus: 'homeless', location: clinic }, NOW);
  assert.ok(homeless.ok);
  if (homeless.ok) {
    assert.equal(homeless.patient.addressLine1, 'HOMELESS');
    assert.equal(homeless.patient.addressLine2, undefined);
    assert.deepEqual([homeless.patient.city, homeless.patient.state, homeless.patient.zipCode], ['Silver Spring', 'MD', '20910']);
  }
  const unknown = buildRcopiaPatient({ ...noAddress, addressStatus: 'unknown', location: null }, NOW, { city: 'Bowie', state: 'MD', postalCode: '20715' });
  assert.ok(unknown.ok);
  if (unknown.ok) assert.equal(unknown.patient.addressLine1, 'UNKNOWN', 'practice location when the client has no clinic');
  const noSite = buildRcopiaPatient({ ...noAddress, addressStatus: 'unknown', location: null }, NOW, null);
  assert.equal(noSite.ok, false, 'never sent without a city / state / ZIP');

  // GM1: a chart linked to a pre-existing Rcopia patient is updated by RcopiaID
  const linked = buildRcopiaPatient({ ...CLIENT, rcopiaPatientId: '27162725039' }, NOW);
  assert.ok(linked.ok);
  if (linked.ok) {
    const xml = sendPatientBody(linked.patient);
    assert.match(xml, /<RcopiaID>27162725039<\/RcopiaID>/);
    assert.doesNotMatch(xml, /<ExternalID>/);
  }
  const own = buildRcopiaPatient({ ...CLIENT, rcopiaPatientId: 'c1' }, NOW);
  if (own.ok) assert.match(sendPatientBody(own.patient), /<ExternalID>c1<\/ExternalID>/);
});

// ─── Live response shapes (staging 201, Oct 20 2026) ─────────────────────────

test('send_patient (live): the patient item confirms updated + the Rcopia id', () => {
  assert.deepEqual(parseSendPatientItem(fx('send_patient_updated.xml')), { rcopiaId: '27162725039', externalId: 'maxpatient', status: 'updated' });
  assert.equal(parseSendPatientItem('<Response><Status>ok</Status></Response>'), null);
});

test('get_notification_count (live): count types, listed items owned per provider, badge keys (NCDM2)', () => {
  const parsed = parseNotificationCounts(fx('get_notification_count_ids.xml'));
  assert.deepEqual(parsed.counts, { refill: 0, rxchange: 0, therapy_request: 0, rx_pending: 1, rx_need_signing: 0, rx_orders_pending: 0 });
  assert.equal(parsed.items.length, 1);
  assert.deepEqual([parsed.items[0].rcopiaId, parsed.items[0].providerUsername, parsed.items[0].type], ['SB-61360164576', 'ssherman', 'rx_pending']);
  const mine = badgeCountsFor(parsed, new Set(['SSherman']));
  assert.equal(mine.pending_prescription, 1);
  assert.equal(mine.refill, 0);
  assert.equal(mine.rx_change, 0);
  assert.equal(mine.need_signing, 0);
  assert.equal(badgeCountsFor(parsed, new Set(['otherdoc'])).pending_prescription, 0, 'someone else\'s pending script is not on my badge');
  // A type Rcopia counted without listing items keeps its own number
  const unlisted = badgeCountsFor({ counts: { refill: 3 }, items: [] }, new Set(['x']));
  assert.equal(unlisted.refill, 3);
});

test('update_prescription (live): no Status = completed only; Status all adds the pending script; statuses and fields', () => {
  const def = parsePrescriptionDownload(fx('update_prescription_default.xml'));
  assert.deepEqual(def.map(r => r.rcopiaId), ['SB-61358989377']);
  const all = parsePrescriptionDownload(fx('update_prescription_all.xml'));
  assert.deepEqual(all.map(r => [r.rcopiaId, r.status]), [['SB-61360164576', 'pending'], ['SB-61358989377', 'completed']]);
  const done = all[1];
  assert.equal(done.patientRcopiaId, '27162725039');
  assert.equal(done.patientExternalId, 'maxpatient');
  assert.equal(done.drugName, 'Ativan 0.5 mg');
  assert.equal(done.schedule, '4');
  assert.equal(done.sig, 'Take 1 tablet by mouth twice a day for anxiety');
  assert.equal(done.quantity, '60');
  assert.equal(done.refills, '0');
  assert.equal(done.completionAction, 'printed,signed');
  assert.equal(done.externalId, undefined, 'own ExternalID (empty), not the provider\'s or preparer\'s');
  assert.equal(parsePrescriptionDownload(fx('update_prescription_empty_cursor.xml')).length, 0);
  // Other statuses, from the same live record with the flag set
  const flip = (xml: string, from: RegExp, to: string) => parsePrescriptionDownload(xml.replace(from, to))[0].status;
  const pending = fx('update_prescription_all.xml');
  assert.equal(flip(pending, /<Denied>n<\/Denied>/, '<Denied>y</Denied>'), 'denied');
  assert.equal(flip(pending, /<Voided>n<\/Voided>/, '<Voided>y</Voided>'), 'voided');
  assert.equal(flip(pending, /<Deleted>n<\/Deleted>/, '<Deleted>y</Deleted>'), 'deleted');
  assert.equal(flip(pending, /<NeedsReview>n<\/NeedsReview>/, '<NeedsReview>y</NeedsReview>'), 'needs_review');
});

test('update_prescription_events (live): pending vs completed per script', () => {
  const ev = parsePrescriptionEvents(fx('update_prescription_events.xml'));
  assert.deepEqual(ev.map(e => [e.rcopiaId, e.status]), [['SB-61360164576', 'pending'], ['SB-61358989377', 'completed']]);
});

test('update_medication (live): medication id (not the nested prescription id), sig, dates, active vs stopped', () => {
  const [m] = parseMedicationDownload(fx('update_medication.xml'));
  assert.equal(m.rcopiaId, '27399834964');
  assert.equal(m.prescriptionRcopiaId, 'SB-61358989377');
  assert.equal(m.externalId, undefined);
  assert.equal(m.providerUsername, 'ssherman');
  assert.equal(m.drugName, 'Ativan 0.5 mg');
  assert.equal(m.sigText, 'Take 1 tablet by mouth twice a day for anxiety');
  assert.equal(m.doseTiming, 'twice a day');
  assert.equal(m.route, 'by mouth');
  assert.equal(m.startDate, '10/14/2026');
  assert.equal(m.stopDate, '10/30/2026');
  assert.equal(m.deleted, false);
  // The same record moved before the prescription block must still read its own id
  const reordered = fx('update_medication.xml').replace(/<RcopiaID>27399834964<\/RcopiaID>\n<ExternalID><\/ExternalID>\n(<Prescription>[\s\S]*?<\/Prescription>)/, '$1\n<RcopiaID>27399834964</RcopiaID>');
  assert.equal(parseMedicationDownload(reordered)[0].rcopiaId, '27399834964');
});

test('update_allergy (live): <Status><Inactive/></Status> is read; deleted rows marked', () => {
  const rows = parseAllergyDownload(fx('update_allergy.xml'));
  assert.deepEqual(rows.map(r => [r.rcopiaId, r.status, r.deleted]), [
    ['6184031110', 'inactive', true], ['6184030110', 'inactive', true], ['6183932510', 'active', false],
  ]);
  assert.deepEqual(rows[2].reactions, ['unspecified']);
  // Inactivated (not deleted) in Rcopia is still read as inactive
  const inactive = parseAllergyDownload(fx('update_allergy.xml').replace('<Deleted>n</Deleted>\n<Status><Active/></Status>', '<Deleted>n</Deleted>\n<Status><Inactive/></Status>'));
  assert.equal(inactive[2].status, 'inactive');
});

// ─── UM1 / MUM: medication upload ────────────────────────────────────────────

const MED: ChartMedication = {
  id: 'm1', medicationName: 'Sertraline 50 mg tablet', dosage: '50 mg', route: 'PO', frequency: 'QD', instructions: null,
  startDate: new Date('2026-09-01T00:00:00Z'), endDate: null, stopDate: null, stopReason: null, active: true, status: 'active',
  source: 'prescribed', rcopiaMedId: null, drugName: null, brandName: null, genericName: 'sertraline', ndcCode: null, rxnormId: '312940',
  action: 'Take', dose: '1', doseUnit: 'tablet', quantity: '30', refills: '1', asNeeded: false, prnReason: null, schedule: 'nonscheduled',
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

test('MUM2 / MUM4: coded only with name + form + strength; otherwise free-text with the mandatory flags', () => {
  assert.equal(doseFormOf('Sertraline 50 mg tablet'), 'tablet');
  assert.equal(doseFormOf('lithium carbonate ER 300 mg extended-release tablets'), 'extended-release tablet');
  assert.equal(strengthOf('Ativan 0.5 mg'), '0.5 mg');
  const coded = chartMedicationToRcopia(MED, NOW);
  assert.equal(coded.rxnormId, '312940');
  assert.equal(coded.form, 'tablet');
  assert.equal(coded.strength, '50 mg');
  assert.equal(coded.genericName, 'sertraline');
  assert.equal(coded.externalId, 'altrixs-med-m1');
  assert.equal(coded.schedule, undefined, 'no free-text flags on a coded drug');
  const noForm = chartMedicationToRcopia({ ...MED, medicationName: 'Sertraline', dosage: '50 mg' }, NOW);
  assert.equal(noForm.rxnormId, undefined, 'a code without its form is not sent as coded');
  assert.equal(noForm.schedule, 'nonscheduled');
  const stopped = chartMedicationToRcopia({ ...MED, active: false, status: 'discontinued', stopReason: 'side effects' }, NOW);
  assert.equal(stopped.stopDate, '2026-10-01', 'inactive meds carry a past StopDate (when it was stopped)');
  assert.equal(stopped.stopReason, 'side effects');
});

test('UM1 / MUM7 / DURM3 / AUM4: only new or changed records; removed ones are deleted', () => {
  const med = chartMedicationToRcopia(MED, NOW);
  const ledger = readLedger({ problemFormat: 2, problems: { 'F41.1': 'x', 'F32.9': 'x' }, problemFingerprints: { 'F41.1': fingerprint({ code: 'F41.1', description: 'GAD' }) }, allergies: { a1: 'fp', gone: 'fp' }, medications: { m1: fingerprint(med), m_old: 'fp' } });
  const plan = { mode: 'list' as const, allergies: [{ externalId: 'a1', name: 'Peanut' }] };
  const todo = pendingSends(ledger, [{ code: 'F41.1', description: 'Generalized anxiety disorder' }], plan);
  assert.deepEqual(todo.problems.map(p => p.code), ['F41.1'], 'changed description is resent');
  assert.deepEqual(todo.removedProblems, ['F32.9']);
  assert.deepEqual(todo.removedAllergies, ['gone']);
  const meds = pendingMedicationSends(ledger, [{ id: 'm1', med }, { id: 'm2', med: { ...med, externalId: 'altrixs-med-m2' } }]);
  assert.deepEqual(meds.send.map(m => m.id), ['m2'], 'unchanged m1 is not resent');
  assert.deepEqual(meds.removed, ['m_old']);
  assert.equal(meds.unchanged, 1);
});

// ─── Through the real service (fetch stubbed) ────────────────────────────────

function loadLive(t: { after: (fn: () => void) => void }, reply: (body: string) => Promise<Response>) {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.DRFIRST_VENDOR_USERNAME = 'vendor_test';
  process.env.DRFIRST_VENDOR_PASSWORD = 'secret-test-marker';
  process.env.DRFIRST_PRACTICE_USERNAME = 'practice_test';
  process.env.DRFIRST_ENGINE_URL = 'https://engine.test/servlet';
  process.env.DRFIRST_UPDATE_URL = 'https://update.test/servlet';
  delete process.env.DATABASE_URL;
  const sent: { url: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    sent.push({ url, body: init.body });
    return reply(init.body);
  }) as typeof fetch;
  t.after(() => { process.env = env; globalThis.fetch = realFetch; });
  const require = createRequire(import.meta.url);
  for (const k of Object.keys(require.cache)) if (/drfirst(RcopiaService|Commands)/.test(k)) delete require.cache[k];
  const svc = require('../src/lib/services/drfirstRcopiaService');
  const logs: Record<string, unknown>[] = [];
  svc.setRcopiaHooks({ apiVersion: async () => '2.55', logCall: async (e: Record<string, unknown>) => { logs.push(e); } });
  return { svc, cmds: require('../src/lib/services/drfirstCommands'), sent, logs };
}
const echo = (body: string, response: string) => new Response(`<RCExtResponse><Request>${body.replace(/<\?xml[^>]*>/, '')}</Request>${response}</RCExtResponse>`, { status: 200 });

test('GM4 / GM6 / GM12: version from the database hook; every call logged with its payload; send_patient item checked', async t => {
  const h = loadLive(t, async body => echo(body, fx('send_patient_updated.xml')));
  const res = await h.svc.sendPatient({ externalId: 'maxpatient', firstName: 'Test', lastName: 'Patient', dob: '1980-01-02', gender: 'M', zipCode: '00000' }, 'ssherman');
  assert.equal(res.ok, true);
  assert.equal(res.patientRcopiaId, '27162725039');
  assert.equal(res.itemStatus, 'updated');
  assert.match(h.sent[0].body, /<RCExtRequest version="2\.55">/);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].command, 'send_patient');
  assert.equal(h.logs[0].ok, true);
  assert.equal(h.logs[0].payloadKind, 'response');
  // What is stored never carries the vendor password or an SSO MAC
  const stored = scrubPayload(`${h.sent[0].body} https://x/sso?a=1&MAC=ABCDEF0123&b=2`, ['secret-test-marker']);
  assert.equal(stored.includes('secret-test-marker'), false);
  assert.match(stored, /MAC=\[removed\]&b=2/);
});

test('Rcopia not reachable: timeout / refused / HTTP 503 page fail cleanly with a code; the request is logged', async t => {
  let mode: 'timeout' | 'refused' | '503' | 'bare' = 'timeout';
  const h = loadLive(t, async () => {
    if (mode === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (mode === 'refused') throw new TypeError('fetch failed');
    if (mode === '503') return new Response('<html>Service Unavailable</html>', { status: 503 });
    return new Response('<html>ok?</html>', { status: 200 });
  });
  const timeout = await h.cmds.updateMedications({ lastUpdateDate: '10/20/2026 11:00:00' }, 'ssherman');
  assert.equal(timeout.ok, false);
  assert.equal(timeout.error.code, 'network_error');
  assert.match(timeout.error.text, /30 seconds/);
  assert.equal(timeout.nextCursor, undefined, 'no cursor from a failed call');
  assert.equal(h.logs[0].payloadKind, 'request', 'connection failure: the request is kept for DrFirst support');
  mode = 'refused';
  const refused = await h.svc.getNotificationCounts('ssherman');
  assert.equal(refused.error, 'fetch failed', 'the badge route then falls back to the synced tables');
  mode = '503';
  const down = await h.cmds.updateProblems({ lastUpdateDate: '10/20/2026 11:00:00' }, 'ssherman');
  assert.deepEqual([down.ok, down.error.code], [false, 'http_503']);
  mode = 'bare';
  const bare = await h.cmds.updatePatients({ lastUpdateDate: '10/20/2026 11:00:00' }, 'ssherman');
  assert.deepEqual([bare.ok, bare.error.code], [false, 'bad_response']);
  assert.equal(h.logs.every(l => l.ok === false && l.errorCode), true, 'every error is logged with its code (GM6)');
});

test('GM7 / PDM2: update_prescription sends Status all + the cursor, and reads the next cursor from the response', async t => {
  const h = loadLive(t, async body => echo(body, fx('update_prescription_all.xml')));
  const r = await h.cmds.updatePrescriptions({ lastUpdateDate: '01/01/2026 00:00:00', status: 'all' }, 'ssherman');
  assert.match(h.sent[0].body, /<LastUpdateDate>01\/01\/2026 00:00:00<\/LastUpdateDate>\s*<Status>all<\/Status>/);
  assert.equal(r.nextCursor, '10/20/2026 11:10:09', 'the server\'s LastUpdateDate, not our echoed one');
  assert.equal(r.prescriptions.length, 2);
});

test('MUM5 through send_medication: the sig Rcopia receives has no Latin abbreviations; a bare "ok" is a failure', async t => {
  const h = loadLive(t, async body => echo(body, '<Response><Status>ok</Status></Response>'));
  const res = await h.cmds.sendMedication({ rcopiaId: '27162725039' }, { genericName: 'sertraline', route: 'PO', doseTiming: 'BID', asNeeded: true, doseOther: 'prn anxiety', patientNotes: '1 tab po qhs' }, 'ssherman');
  const body = h.sent[0].body;
  assert.match(body, /<Route>by mouth<\/Route>/);
  assert.match(body, /<DoseTiming>twice a day<\/DoseTiming>/);
  assert.match(body, /<DoseOther>as needed anxiety<\/DoseOther>/);
  assert.match(body, /<PatientNotes>1 tab by mouth at bedtime<\/PatientNotes>/);
  assert.equal(res.ok, false, 'Rcopia did not confirm the medication item');
  assert.equal(res.error.code, 'no_item_status');
});

test('NCDM3 / GM11: message and report screens can launch in Limited Multi Patient Mode; no allow_popup_screen for a browser tab', t => {
  const h = loadLive(t, async () => new Response(''));
  const msg = new URL(h.svc.buildRcopiaSsoUrl({ rcopiaUsername: 'ssherman', startupScreen: 'message', limpMode: true }));
  assert.equal(msg.searchParams.get('startup_screen'), 'message');
  assert.equal(msg.searchParams.get('limp_mode'), 'y');
  assert.equal(msg.searchParams.get('allow_popup_screen'), null);
  assert.match(msg.searchParams.get('MAC') || '', /^[0-9A-F]{32}$/);
  const embedded = new URL(h.svc.buildRcopiaSsoUrl({ rcopiaUsername: 'ssherman', startupScreen: 'report', limpMode: true, allowPopupScreen: 'n' }));
  assert.equal(embedded.searchParams.get('allow_popup_screen'), 'n');
});

test('send_* write-back (live, Oct 20 2026): created / deleted items, allergy Warning is not an error, RcopiaID-only patient update', async t => {
  const replies = [
    fx('send_allergy_created_warning.xml'), fx('send_medication_created.xml'), fx('send_medication_deleted.xml'),
    fx('send_problem_deleted.xml'), fx('send_patient_by_rcopia_id.xml'),
  ];
  const h = loadLive(t, async body => echo(body, replies.shift() || ''));
  const patient = { rcopiaId: '27162725039' };
  const alg = await h.cmds.sendAllergy(patient, { externalId: 'altrixs-cert-alg-1', name: 'Peanuts', reaction: 'Hives' }, 'ssherman');
  assert.deepEqual([alg.ok, alg.item.status, alg.item.rcopiaId], [true, 'created', '6184120311'], 'a <Warning> does not fail the item');
  const med = await h.cmds.sendMedication(patient, { externalId: 'altrixs-cert-med-1', genericName: 'TEST certification multivitamin', historySource: 'patient' }, 'ssherman');
  assert.deepEqual([med.ok, med.item.status], [true, 'created']);
  const medDel = await h.cmds.sendMedication(patient, { externalId: 'altrixs-cert-med-1', genericName: 'TEST certification multivitamin', deleted: true }, 'ssherman');
  assert.deepEqual([medDel.ok, medDel.item.status], [true, 'deleted']);
  assert.match(h.sent[2].body, /<Medication>\s*<Deleted>y<\/Deleted>\s*<ExternalID>altrixs-cert-med-1<\/ExternalID>/);
  const dxDel = await h.cmds.sendProblem(patient, 'F41.1', 'Generalized anxiety disorder', 'ssherman', { externalId: 'altrixs-cert-dx-1', deleted: true });
  assert.deepEqual([dxDel.ok, dxDel.item.status], [true, 'deleted']);
  const pt = await h.svc.sendPatient({ externalId: '', rcopiaId: '27162725039', firstName: 'Test', lastName: 'Patient', dob: '1980-01-02', gender: 'M', zipCode: '00000' }, 'ssherman');
  assert.deepEqual([pt.ok, pt.itemStatus, pt.patientRcopiaId], [true, 'updated', '27162725039']);
  assert.doesNotMatch(h.sent[4].body, /<ExternalID>/);
});

test('update_medication (live): our own deleted medication comes back with its ExternalID and Deleted=y', () => {
  const [m] = parseMedicationDownload(fx('update_medication_echo_deleted.xml'));
  assert.equal(m.rcopiaId, '61400519440');
  assert.equal(m.externalId, 'altrixs-cert-med-1');
  assert.equal(m.deleted, true);
  assert.equal(m.historySource, 'patient');
  assert.equal(m.providerUsername, undefined, 'empty provider block');
});
