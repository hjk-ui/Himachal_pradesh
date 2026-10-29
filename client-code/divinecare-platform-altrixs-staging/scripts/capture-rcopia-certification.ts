/**
 * Standalone DrFirst Rcopia certification capture (STAGING only; refuses other endpoints). No app
 * imports, no database. Writes redacted request/response pairs (credentials, demographics, NPI / DEA
 * masked) to OUT_DIR (default /tmp/drfirst-cert): the evidence in docs/drfirst-certification/evidence.
 * Uses ONLY DrFirst's staging test patient (maxpatient) and test prescriber; every record the
 * "final" mode creates is deleted again in the same run. Never sends a prescription.
 *
 * Usage (on the server): OUT_DIR=/tmp/drfirst-cert npx tsx --env-file=.env scripts/capture-rcopia-certification.ts <mode>
 *   modes: all (send_patient no-op + every download with its LastUpdateDate round-trip), final (write-back
 *   create + delete, RcopiaID-only send_patient, Status=all), probe (read-only), unreachable
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const VENDOR_USER = process.env.DRFIRST_VENDOR_USERNAME || '';
const VENDOR_PASS = process.env.DRFIRST_VENDOR_PASSWORD || '';
const PRACTICE = process.env.DRFIRST_PRACTICE_USERNAME || '';
const SYSTEM = process.env.DRFIRST_PORTAL_SYSTEM_NAME || VENDOR_USER;
const ENGINE = process.env.DRFIRST_ENGINE_URL || '';
const UPDATE = process.env.DRFIRST_UPDATE_URL || '';
const OUT = process.env.OUT_DIR || '/tmp/drfirst-cert';
const PROVIDER = 'ssherman';
const MAX = { rcopiaId: '27162725039', externalId: 'maxpatient' };
const MODE = process.argv[2] || 'all';

if (!ENGINE.includes('staging') || !UPDATE.includes('staging')) {
  console.error('refusing: not a DrFirst staging endpoint');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function envelope(inner: string, user?: string) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<RCExtRequest version="2.54">',
    '  <Caller>',
    `    <VendorName>${esc(VENDOR_USER)}</VendorName>`,
    `    <VendorPassword>${esc(VENDOR_PASS)}</VendorPassword>`,
    '  </Caller>',
    user ? `  <RcopiaUserName>${esc(user)}</RcopiaUserName>` : '',
    `  <SystemName>${esc(SYSTEM)}</SystemName>`,
    `  <RcopiaPracticeUsername>${esc(PRACTICE)}</RcopiaPracticeUsername>`,
    '  <Request>',
    inner,
    '  </Request>',
    '</RCExtRequest>',
  ].filter(Boolean).join('\n');
}

// Credentials and demographics are masked; ids, codes, drug names, statuses and dates of records stay.
const PHI_TAGS = ['FirstName', 'MiddleName', 'LastName', 'Suffix', 'Prefix', 'DOB', 'SSN', 'EmailAddress', 'HomePhone', 'MobilePhone',
  'WorkPhone', 'OtherPhone', 'Address1', 'Address2', 'City', 'Zip', 'PharmacyCardNumber', 'Weight', 'Height', 'BSA', 'ObservationDate', 'NPI', 'DEA'];
function redact(s: string): string {
  let out = s;
  if (VENDOR_PASS) out = out.split(VENDOR_PASS).join('[redacted]');
  out = out.replace(/<VendorName>[^<]*<\/VendorName>/g, '<VendorName>[redacted]</VendorName>');
  if (VENDOR_USER) out = out.split(VENDOR_USER).join('[vendor-username]');
  for (const t of PHI_TAGS) {
    out = out.replace(new RegExp(`<${t}>([^<]+)</${t}>`, 'g'), (_m, v: string) => `<${t}>[masked ${v.replace(/\D/g, '').length ? v.replace(/\d/g, '9').replace(/[A-Za-z]/g, 'x') : 'text'}]</${t}>`);
  }
  return out;
}

const tag = (s: string, t: string) => (s.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];

async function call(name: string, servlet: 'engine' | 'update', inner: string, user: string | undefined = PROVIDER) {
  const body = envelope(inner, user);
  const url = servlet === 'engine' ? ENGINE : UPDATE;
  const t0 = Date.now();
  let status = 0;
  let raw = '';
  let err = '';
  try {
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body });
    status = res.status;
    raw = await res.text();
  } catch (e) {
    err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const ms = Date.now() - t0;
  const resp = raw.slice(Math.max(0, raw.lastIndexOf('<Response>')));
  const top = resp.replace(/<(\w+List)>[\s\S]*<\/\1>/g, '');
  const statuses = [...top.matchAll(/<Status>([^<]+)<\/Status>/g)].map(m => m[1]);
  const summary = {
    name, servlet, httpStatus: status, ms, error: err || undefined,
    envelopeStatus: statuses[statuses.length - 1],
    errorCode: tag(resp, 'Code'), errorText: tag(resp, 'Text') || tag(resp, 'Description'),
    lastUpdateDate: tag(resp, 'LastUpdateDate'),
    requestLastUpdateDate: tag(body, 'LastUpdateDate'),
  };
  const file = join(OUT, `${name}.txt`);
  writeFileSync(file, [
    `# ${name}  (${servlet} servlet, DrFirst staging 201)`,
    `# captured ${new Date().toISOString()}  HTTP ${status}  ${ms} ms`,
    '',
    '=== REQUEST ===',
    `POST ${url}`,
    'Content-Type: text/xml; charset=UTF-8',
    '',
    redact(body),
    '',
    '=== RESPONSE ===',
    err ? `(transport error) ${err}` : redact(raw),
    '',
  ].join('\n'));
  console.log(JSON.stringify(summary));
  return { raw: resp, summary };
}

const pat = (p: { rcopiaId?: string; externalId?: string }, ind = '      ') =>
  p.rcopiaId ? `${ind}<RcopiaID>${p.rcopiaId}</RcopiaID>` : `${ind}<ExternalID>${p.externalId}</ExternalID>`;

async function roundTrip(prefix: string, command: string, extra: string, since: string) {
  const a = await call(`${prefix}_1`, 'update', [`    <Command>${command}</Command>`, `    <LastUpdateDate>${since}</LastUpdateDate>`, extra].filter(Boolean).join('\n'));
  const next = a.summary.lastUpdateDate;
  if (!next) return;
  await call(`${prefix}_2_cursor`, 'update', [`    <Command>${command}</Command>`, `    <LastUpdateDate>${next}</LastUpdateDate>`, extra].filter(Boolean).join('\n'));
}

async function main() {
  const since = '01/01/2026 00:00:00';
  if (MODE === 'all' || MODE === 'patient') {
    // DrFirst's own test patient (maxpatient), re-sent with exactly the synthetic demographics Rcopia already
    // holds for it (captured Oct 16 in tests/fixtures/rcopia/update_patient_by_external_id.xml): a no-op update.
    const sendPatient = () => [
      '    <Command>send_patient</Command>',
      '    <PatientList>',
      '      <Patient>',
      `        <ExternalID>${MAX.externalId}</ExternalID>`,
      '        <FirstName>Test</FirstName>',
      '        <MiddleName>Q</MiddleName>',
      '        <LastName>Patient</LastName>',
      '        <DOB>01/02/1980</DOB>',
      '        <Sex>M</Sex>',
      '        <HomePhone>5555550100</HomePhone>',
      '        <MobilePhone>5555550100</MobilePhone>',
      '        <Address1>1 Test St</Address1>',
      '        <Address2>Apt 1</Address2>',
      '        <City>Testville</City>',
      '        <State>CA</State>',
      '        <Zip>00000</Zip>',
      '      </Patient>',
      '    </PatientList>',
    ].join('\n');
    await call('send_patient', 'engine', sendPatient());
    await call('update_patient_lookup', 'update', ['    <Command>update_patient</Command>', '    <PatientList>', '      <Patient>', pat({ externalId: MAX.externalId }, '        '), '      </Patient>', '    </PatientList>'].join('\n'));
    await roundTrip('update_patient', 'update_patient', '', '10/01/2026 00:00:00');
  }
  if (MODE === 'all' || MODE === 'counts') {
    await call('get_notification_count', 'update', ['    <Command>get_notification_count</Command>',
      '    <ReturnPrescriptionIDs>y</ReturnPrescriptionIDs>', '    <ReturnRefillIDs>y</ReturnRefillIDs>',
      '    <ReturnRxChangeIDs>y</ReturnRxChangeIDs>', '    <ReturnTherapyRequestIDs>y</ReturnTherapyRequestIDs>'].join('\n'));
    await call('get_notification_count_practice', 'update', '    <Command>get_notification_count</Command>', '');
  }
  if (MODE === 'all' || MODE === 'downloads') {
    const maxPatient = ['    <Patient>', pat(MAX), '    </Patient>'].join('\n');
    await roundTrip('update_prescription', 'update_prescription', maxPatient, since);
    await roundTrip('update_medication', 'update_medication', maxPatient, since);
    await roundTrip('update_allergy', 'update_allergy', maxPatient, since);
    await roundTrip('update_problem', 'update_problem', maxPatient, since);
    await roundTrip('update_prescription_practice', 'update_prescription', '', since);
    await roundTrip('update_medication_practice', 'update_medication', '', since);
  }
  if (MODE === 'probe') {
    // Read-only: where does the pending prescription (rx_pending count) come back?
    const since = '01/01/2026 00:00:00';
    for (const st of ['pending', 'all', 'completed']) {
      await call(`probe_update_prescription_status_${st}`, 'update', ['    <Command>update_prescription</Command>', `    <LastUpdateDate>${since}</LastUpdateDate>`, `    <Status>${st}</Status>`].join('\n'));
    }
    await call('probe_update_prescription_by_id', 'update', ['    <Command>update_prescription</Command>', `    <LastUpdateDate>${since}</LastUpdateDate>`,
      '    <PrescriptionList>', '      <Prescription>', '        <RcopiaID>SB-61360164576</RcopiaID>', '      </Prescription>', '    </PrescriptionList>'].join('\n'));
    await call('probe_update_prescription_events', 'update', ['    <Command>update_prescription_events</Command>', `    <LastUpdateDate>${since}</LastUpdateDate>`].join('\n'));
    await call('get_notification_count_practice', 'update', '    <Command>get_notification_count</Command>', '');
  }
  if (MODE === 'final') {
    const since = '01/01/2026 00:00:00';
    const P = (ind = '          ') => pat(MAX, ind);
    // send_patient for a chart LINKED to a pre-existing Rcopia patient: RcopiaID only, same demographics (no-op)
    await call('send_patient_by_rcopia_id', 'engine', ['    <Command>send_patient</Command>', '    <PatientList>', '      <Patient>',
      '        <RcopiaID>27162725039</RcopiaID>', '        <FirstName>Test</FirstName>', '        <MiddleName>Q</MiddleName>', '        <LastName>Patient</LastName>',
      '        <DOB>01/02/1980</DOB>', '        <Sex>M</Sex>', '        <HomePhone>5555550100</HomePhone>', '        <MobilePhone>5555550100</MobilePhone>',
      '        <Address1>1 Test St</Address1>', '        <Address2>Apt 1</Address2>', '        <City>Testville</City>', '        <State>CA</State>', '        <Zip>00000</Zip>',
      '      </Patient>', '    </PatientList>'].join('\n'));
    await call('get_notification_count_practice', 'update', '    <Command>get_notification_count</Command>', '');
    const maxPatient = ['    <Patient>', pat(MAX), '    </Patient>'].join('\n');
    await roundTrip('update_prescription_status_all', 'update_prescription', `    <Status>all</Status>\n${maxPatient}`, since);
    // Diagnoses both ways on the DrFirst test patient: send, read back, delete (DURM3), read back
    const problem = (deleted: boolean) => ['    <Command>send_problem</Command>', '    <ProblemList>', '      <Problem>',
      deleted ? '        <Deleted>y</Deleted>' : '', '        <ExternalID>altrixs-cert-dx-1</ExternalID>', '        <Patient>', P(), '        </Patient>',
      '        <ICD10>', '          <Code>F41.1</Code>', '          <Description>Generalized anxiety disorder</Description>', '        </ICD10>',
      '      </Problem>', '    </ProblemList>'].filter(Boolean).join('\n');
    const a = await call('send_problem', 'engine', problem(false));
    const cursorBefore = '10/20/2026 00:00:00';
    await call('update_problem_after_send', 'update', ['    <Command>update_problem</Command>', `    <LastUpdateDate>${cursorBefore}</LastUpdateDate>`, maxPatient].join('\n'));
    if (a.summary.envelopeStatus === 'ok') await call('send_problem_delete', 'engine', problem(true));
    // Allergy (non-drug, free text) send + delete
    const allergy = (deleted: boolean) => ['    <Command>send_allergy</Command>', '    <AllergyList>', '      <Allergy>',
      deleted ? '        <Deleted>y</Deleted>' : '', '        <ExternalID>altrixs-cert-alg-1</ExternalID>', '        <Patient>', P(), '        </Patient>',
      '        <Allergen>', '          <Name>Peanuts</Name>', '        </Allergen>',
      '        <ReactionList>', '          <Reaction>', '            <Description>Hives</Description>', '          </Reaction>', '        </ReactionList>',
      '      </Allergy>', '    </AllergyList>'].filter(Boolean).join('\n');
    const b = await call('send_allergy', 'engine', allergy(false));
    if (b.summary.envelopeStatus === 'ok') await call('send_allergy_delete', 'engine', allergy(true));
    // Medication (uncoded, reported) send + delete: verifies the per-item answer shape of send_medication
    const med = (deleted: boolean) => ['    <Command>send_medication</Command>', '    <MedicationList>', '      <Medication>',
      deleted ? '        <Deleted>y</Deleted>' : '', '        <ExternalID>altrixs-cert-med-1</ExternalID>', '        <Patient>', P(), '        </Patient>',
      '        <HasScheduledDrug>n</HasScheduledDrug>', '        <HistorySource>patient</HistorySource>',
      '        <Sig>', '          <Drug>', '            <GenericName>TEST certification multivitamin</GenericName>', '            <Schedule>nonscheduled</Schedule>',
      '            <Supply>n</Supply>', '            <Compound>n</Compound>', '          </Drug>',
      '          <Dosage>', '            <InstructionList>', '              <Instruction>', '                <Sequence>1</Sequence>',
      '                <Action>Take</Action>', '                <Dose>1</Dose>', '                <DoseUnit>tablet</DoseUnit>', '                <Route>by mouth</Route>',
      '                <DoseTiming>once a day</DoseTiming>', '              </Instruction>', '            </InstructionList>', '          </Dosage>',
      '        </Sig>', '        <StartDate>10/01/2026</StartDate>', '      </Medication>', '    </MedicationList>'].filter(Boolean).join('\n');
    const m = await call('send_medication', 'engine', med(false));
    if (m.summary.envelopeStatus === 'ok') await call('send_medication_delete', 'engine', med(true));
    await call('update_medication_after_send', 'update', ['    <Command>update_medication</Command>', `    <LastUpdateDate>${cursorBefore}</LastUpdateDate>`, maxPatient].join('\n'));
    await call('update_allergy_after_send', 'update', ['    <Command>update_allergy</Command>', `    <LastUpdateDate>${cursorBefore}</LastUpdateDate>`, maxPatient].join('\n'));
  }
  if (MODE === 'unreachable') {
    // Rcopia not reachable: a blackholed address with a 3 s budget (the app uses 30 s)
    const t0 = Date.now();
    try {
      await fetch('https://10.255.255.1/servlet/rcopia.servlet.EngineServlet', { method: 'POST', signal: AbortSignal.timeout(3000), body: '<x/>' });
    } catch (e) {
      console.log(JSON.stringify({ name: 'unreachable', ms: Date.now() - t0, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }));
    }
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
