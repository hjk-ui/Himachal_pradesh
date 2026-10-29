import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseAllergyDownload, parsePrescriptionEvents } from '../src/lib/services/drfirstCommands';
import {
  allergyPlan,
  diagnosisProblems,
  fingerprint,
  firstRunCursor,
  formatRcopiaCursor,
  mapDownloadedAllergy,
  normalizeIcd10,
  pendingSends,
  prescriptionEventPayload,
  readLedger,
} from '../src/lib/drfirst/chartMapping';

// Synthetic fixtures shaped after the v2.54 update_allergy / update_prescription_events responses.
const ALLERGIES = `<Response><AllergyList>
  <Allergy>
    <Deleted>n</Deleted>
    <RcopiaID>7001</RcopiaID>
    <Patient><RcopiaID>9001</RcopiaID><ExternalID>client_abc</ExternalID></Patient>
    <Allergen><Name>Penicillin</Name><Drug><NDCID>00000-0000-00</NDCID></Drug></Allergen>
    <Severity><Description>Life threatening</Description></Severity>
    <ReactionList><Reaction><Description>Hives</Description></Reaction><Reaction><Description>Anaphylaxis</Description></Reaction></ReactionList>
    <Status>Active</Status>
  </Allergy>
  <Allergy>
    <Deleted>n</Deleted>
    <RcopiaID>7002</RcopiaID>
    <ExternalID>local_allergy_1</ExternalID>
    <Patient><RcopiaID>9001</RcopiaID></Patient>
    <Allergen><Name>Peanuts</Name></Allergen>
  </Allergy>
  <Allergy>
    <Deleted>y</Deleted>
    <RcopiaID>7003</RcopiaID>
    <Patient><RcopiaID>9001</RcopiaID></Patient>
    <Allergen><Name>Latex</Name></Allergen>
  </Allergy>
  <Allergy>
    <RcopiaID>7004</RcopiaID>
    <Patient><RcopiaID>9999</RcopiaID></Patient>
    <Allergen><Name>Sulfa</Name></Allergen>
  </Allergy>
  <Allergy><RcopiaID>7005</RcopiaID><Patient><RcopiaID>9001</RcopiaID></Patient><Allergen><Name></Name></Allergen></Allergy>
</AllergyList><LastUpdateDate>10/16/2026 10:00:00</LastUpdateDate><Status>ok</Status></Response>`;

const EVENTS = `<Response><PrescriptionList>
  <Prescription>
    <RcopiaID>880001</RcopiaID>
    <Status>Error</Status>
    <Error>Pharmacy rejected transmission</Error>
    <SendMethod>electronic</SendMethod>
    <TransmissionHistory><TransmissionEvent><EventCode>Sent</EventCode><EventDate>10/15/2026 09:00:00</EventDate></TransmissionEvent></TransmissionHistory>
    <PDMPReportStatusList><PDMPReportStatus><Code>Reviewed</Code><ReportDateTime>10/15/2026 08:59:00</ReportDateTime></PDMPReportStatus></PDMPReportStatusList>
  </Prescription>
  <Prescription><RcopiaID>880999</RcopiaID><Status>Signed</Status></Prescription>
</PrescriptionList><LastUpdateDate>10/16/2026 10:00:00</LastUpdateDate><Status>ok</Status></Response>`;

test('ICD-10 filtering: codes normalized, free text and non-codes rejected, duplicates sent once', () => {
  assert.equal(normalizeIcd10('f41.1'), 'F41.1');
  assert.equal(normalizeIcd10('F4310'), 'F43.10');
  assert.equal(normalizeIcd10('F32'), 'F32');
  for (const bad of ['Depression', '296.32', 'U07.1', '', 'F4']) assert.equal(normalizeIcd10(bad), null, bad);

  const { problems, rejected } = diagnosisProblems({
    primaryDiagnosisCode: 'F33.1',
    primaryDiagnosis: 'Major depressive disorder, recurrent, moderate',
    secondaryDiagnoses: 'F41.1 - Generalized anxiety disorder; anxiety (rule out), F43.10, 296.32, f33.1',
  });
  assert.deepEqual(problems, [
    { code: 'F33.1', description: 'Major depressive disorder, recurrent, moderate' },
    { code: 'F41.1', description: 'Generalized anxiety disorder' },
    { code: 'F43.10', description: 'F43.10' },
  ]);
  assert.deepEqual(rejected, ['anxiety (rule out)', '296.32']);
  assert.deepEqual(diagnosisProblems({ primaryDiagnosisCode: 'Anxiety', secondaryDiagnoses: null }), { problems: [], rejected: ['Anxiety'] });
  assert.deepEqual(diagnosisProblems({}), { problems: [], rejected: [] });
});

test('NKA rule: explicit NKA sends NKA, no allergy info sends nothing, real allergies win, DrFirst rows never echoed', () => {
  const row = (id: string, allergen: string, extra: Partial<{ status: string; source: string; severity: string; reaction: string }> = {}) =>
    ({ id, allergen, reaction: extra.reaction ?? null, severity: extra.severity ?? null, status: extra.status ?? 'Active', source: extra.source ?? null });

  assert.deepEqual(allergyPlan([]), { mode: 'none', allergies: [] });
  assert.deepEqual(allergyPlan([row('d1', 'Penicillin', { source: 'drfirst' })]), { mode: 'none', allergies: [] });
  assert.deepEqual(allergyPlan([row('i1', 'Codeine', { status: 'Inactive' })]), { mode: 'none', allergies: [] });
  for (const nka of ['NKDA', 'nka', 'No known allergies', 'No Known Drug Allergies.']) {
    assert.equal(allergyPlan([row('n', nka)]).mode, 'nka', nka);
  }
  const plan = allergyPlan([row('n', 'NKDA'), row('a1', ' Penicillin ', { severity: 'Severe/Anaphylaxis', reaction: 'Hives' }), row('a2', 'Peanuts', { severity: 'Unspecified' })]);
  assert.equal(plan.mode, 'list');
  assert.deepEqual(plan.allergies, [
    { externalId: 'a1', name: 'Penicillin', reaction: 'Hives', severity: 'Severe' },
    { externalId: 'a2', name: 'Peanuts' },
  ]);
});

test('idempotency: unchanged items are not resent; changed allergies are; NKA once and never after real allergies', () => {
  const problems = [{ code: 'F33.1', description: 'MDD' }, { code: 'F41.1', description: 'GAD' }];
  const plan = { mode: 'list' as const, allergies: [{ externalId: 'a1', name: 'Penicillin' }, { externalId: 'a2', name: 'Peanuts' }] };
  const ledger = readLedger({ problemFormat: 2, problems: { 'F33.1': '2026-10-16' }, allergies: { a1: fingerprint({ externalId: 'a1', name: 'Penicillin' }), a2: 'stale' } });
  const todo = pendingSends(ledger, problems, plan);
  assert.deepEqual(todo.problems.map(p => p.code), ['F41.1']);
  assert.deepEqual(todo.allergies.map(a => a.externalId), ['a2']);
  assert.equal(todo.nka, false);
  assert.equal(todo.unchanged, 2);

  // Problems recorded before the ProblemList fix (no problemFormat) were never stored by Rcopia: sent again
  assert.deepEqual(pendingSends(readLedger({ problems: { 'F33.1': '2026-10-15' } }), problems, plan).problems.map(p => p.code), ['F33.1', 'F41.1']);

  const nkaPlan = { mode: 'nka' as const, allergies: [] };
  assert.equal(pendingSends(readLedger(null), [], nkaPlan).nka, true);
  assert.equal(pendingSends(readLedger({ nka: '2026-10-16' }), [], nkaPlan).nka, false);
  assert.equal(pendingSends(readLedger({ allergies: { a1: 'x' } }), [], nkaPlan).nka, false);
  assert.equal(pendingSends(readLedger(null), [], { mode: 'none', allergies: [] }).nka, false);
});

test('update_allergy rows map to chart allergies (source drfirst fields, severity vocabulary, deleted -> Inactive)', () => {
  const rows = parseAllergyDownload(ALLERGIES);
  assert.equal(rows.length, 5);
  assert.deepEqual(mapDownloadedAllergy(rows[0]), {
    allergen: 'Penicillin', reaction: 'Hives, Anaphylaxis', severity: 'Severe/Anaphylaxis', status: 'Active', rcopiaAllergyId: '7001',
  });
  assert.equal(rows[1].externalId, 'local_allergy_1');
  assert.equal(mapDownloadedAllergy(rows[1])!.severity, 'Unspecified');
  assert.equal(mapDownloadedAllergy(rows[2])!.status, 'Inactive');
  assert.equal(mapDownloadedAllergy(rows[4]), null, 'no allergen name -> not stored');
});

test('prescription event payload: ids/codes only, stable fingerprint, changes produce a new fingerprint', () => {
  const [e1, e2] = parsePrescriptionEvents(EVENTS);
  const p1 = prescriptionEventPayload(e1);
  assert.equal(p1.prescriptionRcopiaId, '880001');
  assert.equal(p1.error, 'Pharmacy rejected transmission');
  assert.deepEqual(p1.pdmpReports, [{ code: 'Reviewed', message: undefined, reportDateTime: '10/15/2026 08:59:00', error: undefined }]);
  assert.equal(prescriptionEventPayload(e1).fingerprint, p1.fingerprint);
  assert.notEqual(prescriptionEventPayload({ ...e1, status: 'Sent' }).fingerprint, p1.fingerprint);
  assert.equal(prescriptionEventPayload(e2).status, 'Signed');
});

test('first-run cursor: now minus DRFIRST_SYNC_LOOKBACK_DAYS (default 90) in MM/DD/YYYY HH:MM:SS', () => {
  const now = new Date('2026-10-16T12:34:56Z');
  assert.equal(formatRcopiaCursor(now), '10/16/2026 12:34:56');
  assert.equal(firstRunCursor(now, undefined), '07/18/2026 12:34:56');
  assert.equal(firstRunCursor(now, '7'), '10/09/2026 12:34:56');
  for (const bad of ['', 'abc', '0', '-5']) assert.equal(firstRunCursor(now, bad), '07/18/2026 12:34:56', bad);
});

// ─── Sync sweep + patient push against an in-memory database (no network) ───

type Row = Record<string, unknown>;

function loadWithStubs(extra: { patients?: Row[]; problems?: Row[]; visits?: Row[]; prescriptions?: Row[]; medications?: Row[] } = {}) {
  const real = createRequire(import.meta.url)('../src/lib/services/drfirstCommands');
  const calls: { command: string; opts: Row }[] = [];
  const sent: { command: string; args: unknown[] }[] = [];
  const audits: Row[] = [];
  const events: Row[] = [];
  const cursors = new Map<string, string>();
  // drfirst_poll_state (GM8 throttle): key -> last call
  const polls = new Map<string, Date>();
  const allergies: Row[] = [
    { id: 'local_allergy_1', clientId: 'client_abc', allergen: 'Peanuts', reaction: 'Swelling', severity: 'Moderate', status: 'Active', source: null, rcopiaAllergyId: null },
  ];
  let failCommand = '';
  const download = (command: string, rows: Row) => async (opts: Row) => {
    calls.push({ command, opts });
    if (command === failCommand) return { ok: false, demo: false, status: 'error', error: { code: 'bad_parameter', text: 'x' }, raw: '', ...rows };
    return { ok: true, demo: false, status: 'ok', raw: '', nextCursor: '10/16/2026 10:00:00', ...rows };
  };
  const ok = (command: string) => async (...args: unknown[]) => { sent.push({ command, args }); return { ok: true, demo: false, status: 'ok', raw: '' }; };
  const commands = {
    ...real,
    updateMedications: download('update_medication', { medications: extra.medications || [] }),
    updatePrescriptions: download('update_prescription', { prescriptions: extra.prescriptions || [] }),
    updatePrescriptionEvents: download('update_prescription_events', { events: real.parsePrescriptionEvents(EVENTS) }),
    updateAllergies: download('update_allergy', { allergies: real.parseAllergyDownload(ALLERGIES) }),
    updateRxFills: download('update_rxfill', { fills: [] }),
    updateRxChanges: download('update_rxchange', { rxChanges: [] }),
    updateNotifications: download('update_notification', { notifications: [] }),
    updatePatients: download('update_patient', { patients: extra.patients || [] }),
    updateProblems: download('update_problem', { problems: extra.problems || [] }),
    updateOfficeVisits: download('update_patient_office_visits', { visits: extra.visits || [] }),
    sendProblem: ok('send_problem'),
    sendAllergy: ok('send_allergy'),
    sendNoKnownAllergies: ok('send_nka'),
  };
  const ledgers = new Map<string, unknown>();
  const problems: Row[] = [
    { id: 'local_problem', clientId: 'client_abc', icd10Code: 'F33.1', name: 'MDD', status: 'Active', source: null, rcopiaProblemId: '6132299999' },
  ];
  const clients: Row[] = [{
    id: 'client_abc', rcopiaPatientId: '9001', legalFirstName: 'Test', legalLastName: 'Patient',
    dateOfBirth: new Date('1980-01-02T00:00:00Z'), gender: 'Male', postalCode: '00000',
  }];
  const clientUpdates: Row[] = [];
  const rxRows: Row[] = [];
  const db = {
    drFirstSyncCursor: {
      findUnique: async ({ where }: { where: { commandName: string } }) =>
        cursors.has(where.commandName) ? { lastUpdateDate: cursors.get(where.commandName) } : null,
      upsert: async ({ where, create }: { where: { commandName: string }; create: { lastUpdateDate: string } }) => { cursors.set(where.commandName, create.lastUpdateDate); },
    },
    clientMedication: { findFirst: async () => null, findMany: async () => [] },
    drFirstPollState: {
      findUnique: async ({ where }: { where: { key: string } }) => (polls.has(where.key) ? { key: where.key, lastCalledAt: polls.get(where.key), payload: null } : null),
      create: async ({ data }: { data: { key: string; lastCalledAt: Date } }) => { polls.set(data.key, data.lastCalledAt); },
      updateMany: async ({ where, data }: { where: { key: string; lastCalledAt: Date }; data: { lastCalledAt: Date } }) => {
        if (polls.get(where.key)?.getTime() !== where.lastCalledAt.getTime()) return { count: 0 };
        polls.set(where.key, data.lastCalledAt);
        return { count: 1 };
      },
      update: async () => ({}),
    },
    client: {
      findMany: async () => clients,
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { clientUpdates.push({ id: where.id, ...data }); Object.assign(clients.find(c => c.id === where.id)!, data); },
    },
    medicalProblem: {
      findFirst: async ({ where }: { where: Row }) => problems.find(p => Object.entries(where).every(([k, v]) => p[k] === v)) || null,
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(problems.find(p => p.id === where.id)!, data),
      create: async ({ data }: { data: Row }) => { problems.push({ id: `new_problem_${problems.length}`, ...data }); },
      // chartPush: unresolved problems with no ICD-10 code ("needs coding")
      count: async ({ where }: { where: { clientId: string } }) =>
        problems.filter(p => p.clientId === where.clientId && !String(p.icd10Code ?? '').trim() && p.status !== 'Resolved').length,
    },
    user: { findMany: async () => [] },
    medicalPatient: { findMany: async () => [] },
    rcopiaPrescription: {
      findMany: async () => [{ rcopiaId: '880001', clientId: 'client_abc' }],
      findUnique: async ({ where }: { where: { rcopiaId: string } }) => rxRows.find(r => r.rcopiaId === where.rcopiaId) || null,
      update: async ({ where, data }: { where: { rcopiaId: string }; data: Row }) => Object.assign(rxRows.find(r => r.rcopiaId === where.rcopiaId)!, data),
      create: async ({ data }: { data: Row }) => { rxRows.push({ ...data }); },
    },
    clinicalEvent: {
      findFirst: async ({ where }: { where: { eventType: string; payloadJson: { equals: string } } }) =>
        events.find(e => e.eventType === where.eventType && (e.payload as Row).fingerprint === where.payloadJson.equals) || null,
    },
    medicalAllergy: {
      findFirst: async ({ where }: { where: Row }) =>
        allergies.find(a => Object.entries(where).every(([k, v]) => a[k] === v)) || null,
      findMany: async ({ where }: { where: { clientId: string } }) => allergies.filter(a => a.clientId === where.clientId),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(allergies.find(a => a.id === where.id)!, data),
      create: async ({ data }: { data: Row }) => { allergies.push({ id: `new_${allergies.length}`, ...data }); },
    },
    clinicModuleState: {
      findUnique: async ({ where }: { where: { organizationId_module: { module: string } } }) =>
        ledgers.has(where.organizationId_module.module) ? { data: ledgers.get(where.organizationId_module.module) } : null,
      upsert: async ({ where, create }: { where: { organizationId_module: { module: string } }; create: { data: unknown } }) => {
        ledgers.set(where.organizationId_module.module, JSON.parse(JSON.stringify(create.data)));
      },
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/services/drfirstCommands') return commands;
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async (e: Row) => { audits.push(e); } };
    if (id === '@/lib/clinical/events') return { recordClinicalEvent: async (e: Row) => { events.push(e); } };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  // Fresh copies bound to this harness's stubs
  for (const k of Object.keys(require.cache)) if (/drfirst[\\/](_lib[\\/]|persistence)/.test(k)) delete require.cache[k];
  try {
    const sync = require('../src/app/api/drfirst/_lib/sync');
    const push = require('../src/app/api/drfirst/_lib/chartPush');
    return { sync, push, calls, sent, audits, events, cursors, polls, rxRows, allergies, problems, clients, clientUpdates, setFail: (c: string) => { failCommand = c; } };
  } finally {
    loader._load = originalLoad;
  }
}

test('org sweep: first run sends a LastUpdateDate everywhere; allergies upserted, events filed, cursor saved only on success', async () => {
  const h = loadWithStubs();
  const startedAt = Date.now();
  h.setFail('update_notification');
  const steps = await h.sync.syncOrganization('org1');

  const commands = h.calls.map(c => c.command);
  for (const c of ['update_medication', 'update_prescription', 'update_prescription_events', 'update_allergy', 'update_rxfill', 'update_rxchange', 'update_notification']) {
    assert.ok(commands.includes(c), c);
  }
  const ninetyDays = 90 * 24 * 3600 * 1000;
  for (const c of h.calls) {
    const sentCursor = String(c.opts.lastUpdateDate || '');
    assert.match(sentCursor, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/, `${c.command} carries a LastUpdateDate`);
    const at = Date.parse(sentCursor.replace(' ', 'T').replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2') + 'Z');
    assert.ok(Math.abs(at - (startedAt - ninetyDays)) < 60_000, `${c.command} starts 90 days back`);
  }
  assert.equal(h.cursors.get('update_allergy:org1'), '10/16/2026 10:00:00');
  assert.equal(h.cursors.has('update_notification:org1'), false, 'failed download does not save a cursor');

  // Allergies: one new DrFirst row; the echoed local row only gains its Rcopia id; deleted/unmatched/nameless skipped
  assert.equal(steps.allergies.created, 1);
  assert.equal(steps.allergies.updated, 1);
  assert.equal(steps.allergies.skippedNoClient, 1);
  assert.equal(steps.allergies.skippedMissingData, 1);
  const local = h.allergies.find(a => a.id === 'local_allergy_1')!;
  assert.equal(local.rcopiaAllergyId, '7002');
  assert.equal(local.allergen, 'Peanuts');
  assert.equal(local.source, null);
  const created = h.allergies.find(a => a.rcopiaAllergyId === '7001')!;
  assert.equal(created.source, 'drfirst');
  assert.equal(created.clientId, 'client_abc');
  assert.equal(created.patientId, null);
  assert.equal(h.allergies.some(a => a.rcopiaAllergyId === '7003'), false, 'deleted in Rcopia is never created');

  // Prescription events: filed to the script's chart; unknown script skipped
  assert.equal(steps.prescriptionEvents.created, 1);
  assert.equal(steps.prescriptionEvents.skippedNoClient, 1);
  assert.equal(h.events[0].clientId, 'client_abc');

  const actions = h.audits.map(a => a.action);
  assert.ok(actions.includes('DRFIRST_ALLERGY_DOWNLOAD'));
  assert.ok(actions.includes('DRFIRST_PRESCRIPTION_EVENTS_DOWNLOAD'));

  // Second run: stored cursor used; nothing duplicated; deleted-in-Rcopia DrFirst row goes Inactive (never deleted)
  h.calls.length = 0;
  h.polls.clear(); // a later sweep, past the 5-minute poll window
  h.allergies.push({ id: 'dr_latex', clientId: 'client_abc', allergen: 'Latex', reaction: null, severity: 'Unspecified', status: 'Active', source: 'drfirst', rcopiaAllergyId: '7003' });
  const again = await h.sync.syncOrganization('org1');
  assert.equal(h.calls.find(c => c.command === 'update_allergy')!.opts.lastUpdateDate, '10/16/2026 10:00:00');
  assert.equal(again.prescriptionEvents.created, 0);
  assert.equal(again.allergies.created, 0, 'no duplicate DrFirst rows');
  assert.equal(h.allergies.find(a => a.id === 'dr_latex')!.status, 'Inactive');
  assert.equal(h.allergies.filter(a => a.clientId === 'client_abc').length, 3);
});

test('patient push: ICD-10 problems + allergies sent once, non-ICD-10 entries reported, no NKA by default', async () => {
  const h = loadWithStubs();
  const caller = { userId: 'u1', role: 'NP', organizationId: 'org1', rcopiaUsername: 'np1', ipAddress: null, userAgent: null };
  const client = { id: 'client_abc', primaryDiagnosisCode: 'F33.1', primaryDiagnosis: 'MDD', secondaryDiagnoses: 'F41.1, anxiety' };
  // Intake history stored uncoded: reported as needing a code, never sent, never a failure
  h.problems.push({ id: 'intake_htn', clientId: 'client_abc', icd10Code: null, name: 'Hypertension', status: 'Active', source: null });
  const first = await h.push.pushChartToRcopia(caller, client, { rcopiaId: '9001' });
  assert.equal(first.problemsNeedingCode, 1);
  assert.equal(first.failed, 0);
  assert.equal(first.problemsSent, 2);
  assert.equal(first.allergiesSent, 1);
  assert.equal(first.nkaSent, false);
  assert.deepEqual(first.skippedNonIcd10, ['anxiety']);
  assert.deepEqual(h.sent.map(s => s.command), ['send_problem', 'send_problem', 'send_allergy']);
  assert.deepEqual((h.sent[2].args[1] as Row), { externalId: 'local_allergy_1', name: 'Peanuts', reaction: 'Swelling', severity: 'Moderate' });
  const problemAudit = h.audits.find(a => a.action === 'DRFIRST_SEND_PROBLEM')!;
  assert.equal(JSON.stringify(problemAudit).includes('F33.1'), false, 'no diagnosis codes in the audit row');
  assert.ok(h.audits.some(a => a.action === 'DRFIRST_SEND_ALLERGY'));

  h.sent.length = 0;
  const second = await h.push.pushChartToRcopia(caller, client, { rcopiaId: '9001' });
  assert.equal(h.sent.length, 0, 'unchanged items are not resent');
  assert.equal(second.unchanged, 3);

  // No allergy info at all -> nothing sent (never NKA by default)
  h.allergies.length = 0;
  h.sent.length = 0;
  await h.push.pushChartToRcopia(caller, { ...client, id: 'client_new', primaryDiagnosisCode: null, secondaryDiagnoses: null }, { externalId: 'client_new' });
  assert.equal(h.sent.length, 0);
});

test('patient push: send_problem carries a stable per-chart ExternalID', async () => {
  const h = loadWithStubs();
  const caller = { userId: 'u1', role: 'NP', organizationId: 'org1', rcopiaUsername: 'np1', ipAddress: null, userAgent: null };
  await h.push.pushChartToRcopia(caller, { id: 'client_abc', primaryDiagnosisCode: 'F41.1', primaryDiagnosis: 'GAD', secondaryDiagnoses: null }, { rcopiaId: '9001' });
  const problemSend = h.sent.find(s => s.command === 'send_problem')!;
  assert.deepEqual(problemSend.args[4], { externalId: 'altrixs-dx-client_abc-F41.1' });
});

test('org sweep: update_patient / update_problem / office visits — link confirmed, chart never overwritten, idempotent', async () => {
  const real = createRequire(import.meta.url)('../src/lib/services/drfirstCommands');
  const fx = (name: string) => readFileSync(new URL(`./fixtures/rcopia/${name}`, import.meta.url), 'utf8');
  // Live-captured shapes (maxpatient), re-pointed at the in-memory chart: our client id as the external id
  const patients = real.parsePatientDownload(fx('update_patient_by_external_id.xml').replace(/<RcopiaID>27162725039<\/RcopiaID>\s*<ExternalID>maxpatient<\/ExternalID>/, '<RcopiaID>27162725039</RcopiaID><ExternalID>client_abc</ExternalID>'))
    .map((p: Row) => ({ ...p, lastName: 'Patient-Smith' }));
  const problems = real.parseProblemDownload(fx('update_problem.xml').replace(/<ExternalID>maxpatient<\/ExternalID>/g, '<ExternalID>client_abc</ExternalID>'));
  problems.push({ ...problems[1], rcopiaId: '6132299999', code: 'F33.1', codeSystem: 'ICD10', description: 'DrFirst text' }); // same Rcopia id as a local row
  problems.push({ ...problems[1], rcopiaId: '6132300000', externalId: 'altrixs-dx-client_abc-F41.1', codeSystem: 'ICD10', code: 'F41.1' }); // our own echo
  const visits = real.parseOfficeVisitDownload(fx('update_patient_office_visits.xml').replace(/<ExternalID>maxpatient<\/ExternalID>/g, '<ExternalID>client_abc</ExternalID>'));
  const h = loadWithStubs({ patients, problems, visits });
  h.clients[0].rcopiaPatientId = 'client_abc'; // send_patient placeholder (no Rcopia id returned yet)

  const steps = await h.sync.syncOrganization('org1');
  for (const c of ['update_patient', 'update_problem', 'update_patient_office_visits']) {
    assert.ok(h.calls.some(x => x.command === c && /^\d{2}\/\d{2}\/\d{4} /.test(String(x.opts.lastUpdateDate))), `${c} swept with a cursor`);
    assert.equal(h.cursors.get(`${c}:org1`), '10/16/2026 10:00:00', `${c} has its own per-org cursor`);
  }
  assert.equal(h.calls[0].command, 'update_patient', 'patients first, so new links resolve in later steps');

  // update_patient: Rcopia id confirmed; demographics untouched; the difference is a review item
  assert.deepEqual(h.clientUpdates, [{ id: 'client_abc', rcopiaPatientId: '27162725039' }]);
  assert.equal(h.clients[0].legalLastName, 'Patient');
  const review = h.events.find(e => e.eventType === 'drfirst-patient-review')!;
  assert.deepEqual((review.payload as Row).differences, [{ field: 'lastName', drfirst: 'Patient-Smith' }]);
  assert.equal(steps.patients.created, 1);

  // update_problem: deleted-in-Rcopia not created; ICD-9 row stored without inventing an ICD-10 code;
  // local row with the same Rcopia id untouched; our own echo skipped
  const dr = h.problems.filter(p => p.source === 'drfirst');
  assert.equal(dr.length, 1);
  assert.equal(dr[0].rcopiaProblemId, '6132212511');
  assert.equal(dr[0].icd10Code, '');
  assert.match(String(dr[0].notes), /ICD-9-CM 300\.0/);
  assert.equal(dr[0].patientId, null);
  assert.equal(h.problems.find(p => p.id === 'local_problem')!.name, 'MDD');
  assert.equal(steps.problems.created, 1);

  // office visit stored as a ClinicalEvent
  const visit = h.events.find(e => e.eventType === 'drfirst-office-visit')!;
  assert.equal((visit.payload as Row).visitRcopiaId, '6191175287');
  assert.equal((visit.payload as Row).deleted, true);

  const actions = h.audits.map(a => a.action);
  for (const a of ['DRFIRST_PATIENT_DOWNLOAD', 'DRFIRST_PROBLEM_DOWNLOAD', 'DRFIRST_OFFICE_VISIT_DOWNLOAD']) assert.ok(actions.includes(a), a);
  assert.equal(JSON.stringify(h.audits).includes('Patient-Smith'), false, 'no demographics in audit rows');

  // Re-run: nothing duplicated, link not rewritten
  const eventsBefore = h.events.length;
  h.polls.clear();
  const again = await h.sync.syncOrganization('org1');
  assert.equal(h.events.length, eventsBefore);
  assert.equal(h.clientUpdates.length, 1);
  assert.equal(again.problems.created, 0);
  assert.equal(h.problems.filter(p => p.source === 'drfirst').length, 1);
});

test('prescriptions: Status all, own practice cursor; a pending script is refreshed when it is completed (PDM1 / PDR1)', async () => {
  const real = createRequire(import.meta.url)('../src/lib/services/drfirstCommands');
  const fx = (name: string) => readFileSync(new URL(`./fixtures/rcopia/${name}`, import.meta.url), 'utf8');
  const live = real.parsePrescriptionDownload(fx('update_prescription_all.xml').replace(/<ExternalID>maxpatient<\/ExternalID>/g, '<ExternalID>client_abc</ExternalID>'));
  const h = loadWithStubs({ prescriptions: live });
  const steps = await h.sync.syncOrganization('org1');
  const rxCall = h.calls.find(c => c.command === 'update_prescription')!;
  assert.equal(rxCall.opts.status, 'all', 'without Status Rcopia returns completed scripts only');
  assert.equal(h.cursors.get('update_prescription_all:org1'), '10/16/2026 10:00:00', 'its own cursor: one backfill of the lookback window');
  assert.equal(steps.prescriptions.created, 2);
  assert.deepEqual(h.rxRows.map(r => [r.rcopiaId, r.lifecycleStatus]), [['SB-61360164576', 'pending'], ['SB-61358989377', 'completed']]);
  assert.ok(h.audits.some(a => a.action === 'DRFIRST_PRESCRIPTION_DOWNLOAD'));
  assert.ok(h.audits.some(a => a.action === 'DRFIRST_MEDICATION_DOWNLOAD'));

  // Within 5 minutes: throttled, Rcopia not called (GM8 / DR2)
  h.calls.length = 0;
  const throttled = await h.sync.syncOrganization('org1');
  assert.equal(h.calls.length, 0);
  assert.equal(throttled.prescriptions.throttled, true);

  // Later: the pending script was signed in Rcopia -> the same row is updated, never duplicated
  h.polls.clear();
  live[0].status = 'completed';
  live[0].signedDate = '10/20/2026 12:00:00 EDT';
  live[0].pharmacyName = 'Test Pharmacy';
  const again = await h.sync.syncOrganization('org1');
  assert.equal(h.calls.find(c => c.command === 'update_prescription')!.opts.lastUpdateDate, '10/16/2026 10:00:00', 'the stored cursor is sent back');
  assert.equal(again.prescriptions.updated, 2);
  assert.equal(h.rxRows.length, 2);
  assert.equal(h.rxRows[0].lifecycleStatus, 'completed');
  assert.equal(h.rxRows[0].pharmacyName, 'Test Pharmacy');
});

test('patient-level sync: per-patient LastUpdateDate round-trip, throttled per patient, org cursors untouched (DDM3 / ADM3 / MDM3)', async () => {
  const h = loadWithStubs();
  const client = { id: 'client_abc', rcopiaPatientId: '9001' };
  await h.sync.syncPatient('org1', client, 'np1');
  const first = Object.fromEntries(h.calls.map(c => [c.command, c.opts]));
  assert.equal(first.update_medication.lastUpdateDate, '01/01/2000 00:00:00', 'first call: full history');
  assert.deepEqual(first.update_medication.patient, { rcopiaId: '9001' });
  assert.equal(first.update_prescription.status, 'all');
  for (const c of ['update_medication', 'update_prescription', 'update_allergy', 'update_problem']) {
    assert.equal(h.cursors.get(`${c}:patient:client_abc`), '10/16/2026 10:00:00', c);
    assert.equal(h.cursors.has(`${c}:org1`), false, 'org cursor untouched');
  }
  h.calls.length = 0;
  const throttled = await h.sync.syncPatient('org1', client, 'np1');
  assert.equal(h.calls.length, 0, 'same patient within 5 minutes: no call');
  assert.equal(throttled.medications.throttled, true);
  h.polls.clear();
  await h.sync.syncPatient('org1', client, 'np1');
  for (const c of h.calls) assert.equal(c.opts.lastUpdateDate, '10/16/2026 10:00:00', `${c.command} resumes from its stored cursor`);
});

test('update_medication: our own medication echoed back (altrixs-med- ExternalID) is never copied into the chart', async () => {
  const real = createRequire(import.meta.url)('../src/lib/services/drfirstCommands');
  const fx = (name: string) => readFileSync(new URL(`./fixtures/rcopia/${name}`, import.meta.url), 'utf8');
  const echoed = real.parseMedicationDownload(fx('update_medication_echo_deleted.xml').replace(/<ExternalID>maxpatient<\/ExternalID>/g, '<ExternalID>client_abc</ExternalID>').replace('altrixs-cert-med-1', 'altrixs-med-local1'));
  assert.equal(echoed[0].externalId, 'altrixs-med-local1');
  const h = loadWithStubs({ medications: echoed });
  const steps = await h.sync.syncPatient('org1', { id: 'client_abc', rcopiaPatientId: '9001' }, 'np1');
  assert.equal(steps.medications.downloaded, 1);
  assert.equal(steps.medications.created, 0);
  assert.equal(steps.medications.updated, 0);
  assert.equal(steps.medications.failed, 0, 'no write was attempted');
});
