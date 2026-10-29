/**
 * Offline fixture checks for the Rcopia download parsers (no network, no database).
 * Inline fixtures are synthetic (v2.54 layouts); tests/fixtures/rcopia holds sanitized live staging captures.
 *
 * Usage:  npx tsx scripts/check-rcopia-parsers.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseMedicationDownload, parsePrescriptionDownload, parseProblemDownload, parsePatientDownload,
  parseOfficeVisitDownload, parseSendItems,
} from '../src/lib/services/drfirstCommands';
import { parseNotificationCounts, envelopeStatus } from '../src/lib/services/drfirstRcopiaService';

const MEDS = `<Response><MedicationList>
  <Medication>
    <Deleted>n</Deleted>
    <Patient><RcopiaID>9001</RcopiaID><ExternalID>client_abc</ExternalID></Patient>
    <Provider><RcopiaID>77</RcopiaID><Username>drtest</Username><FirstName>Test</FirstName><LastName>Prescriber</LastName><NPI>1234567893</NPI></Provider>
    <RcopiaID>555001</RcopiaID>
    <ExternalID>med-ext-1</ExternalID>
    <Sig>
      <Drug><RcopiaID>333</RcopiaID><NDCID>00093-7146-56</NDCID><RxnormID>312940</RxnormID><BrandName>Zoloft</BrandName><GenericName>sertraline</GenericName><Form>tablet</Form><Strength>50 mg</Strength><Schedule>nonscheduled</Schedule></Drug>
      <Dosage><InstructionList><Instruction><Sequence>1</Sequence><Action>Take</Action><Dose>1</Dose><DoseUnit>tablet</DoseUnit><Route>by mouth</Route><DoseTiming>once a day</DoseTiming></Instruction></InstructionList></Dosage>
      <Quantity>30</Quantity><QuantityUnit>tablet</QuantityUnit><Refills>2</Refills>
    </Sig>
    <StartDate>08/01/2026</StartDate>
    <LastModifiedDate>10/14/2026 13:00:00</LastModifiedDate>
  </Medication>
  <Medication>
    <Deleted>y</Deleted>
    <Patient><RcopiaID>9002</RcopiaID></Patient>
    <RcopiaID>555002</RcopiaID>
    <HistorySource>patient</HistorySource>
    <Sig><Drug><GenericName>metformin</GenericName><Strength>500 mg</Strength></Drug><Action>Take</Action><Dose>1</Dose><DoseTiming>twice a day</DoseTiming></Sig>
    <StopDate>09/01/2026</StopDate>
  </Medication>
  <Medication><Patient><RcopiaID>9003</RcopiaID></Patient><Sig><Drug><GenericName>no id</GenericName></Drug></Sig></Medication>
</MedicationList><LastUpdateDate>10/15/2026 09:00:00</LastUpdateDate><Status>ok</Status></Response>`;

const meds = parseMedicationDownload(MEDS);
assert.equal(meds.length, 2, 'record without its own RcopiaID is skipped');
assert.equal(meds[0].rcopiaId, '555001', 'medication id, not the patient/provider/drug id');
assert.equal(meds[0].externalId, 'med-ext-1');
assert.equal(meds[0].patientRcopiaId, '9001');
assert.equal(meds[0].patientExternalId, 'client_abc');
assert.equal(meds[0].providerUsername, 'drtest');
assert.equal(meds[0].providerName, 'Test Prescriber');
assert.equal(meds[0].drugName, 'Zoloft 50 mg');
assert.equal(meds[0].ndcId, '00093-7146-56');
assert.equal(meds[0].rxnormId, '312940');
assert.equal(meds[0].dose, '1');
assert.equal(meds[0].doseUnit, 'tablet');
assert.equal(meds[0].doseTiming, 'once a day');
assert.equal(meds[0].sigText, 'Take 1 tablet by mouth once a day');
assert.equal(meds[0].quantity, '30');
assert.equal(meds[0].refills, '2');
assert.equal(meds[0].startDate, '08/01/2026');
assert.equal(meds[0].deleted, false);
assert.equal(meds[1].rcopiaId, '555002');
assert.equal(meds[1].deleted, true);
assert.equal(meds[1].historySource, 'patient');
assert.equal(meds[1].drugName, 'metformin 500 mg');
assert.equal(meds[1].doseTiming, 'twice a day');
assert.equal(meds[1].stopDate, '09/01/2026');

const RX = `<Response><PrescriptionList><Prescription>
  <Patient><RcopiaID>9001</RcopiaID><ExternalID>client_abc</ExternalID></Patient>
  <RcopiaID>777001</RcopiaID>
  <Provider><Username>drtest</Username></Provider>
  <Sig><Drug><BrandName>Zoloft</BrandName><Strength>50 mg</Strength></Drug><Quantity>30</Quantity></Sig>
  <SignedDate>10/14/2026 13:00:00</SignedDate>
</Prescription></PrescriptionList></Response>`;
const rx = parsePrescriptionDownload(RX);
assert.equal(rx.length, 1);
assert.equal(rx[0].rcopiaId, '777001', 'prescription id, not the patient id that precedes it');
assert.equal(rx[0].status, 'signed');

const COUNTS = `<Response><NotificationCountList>
  <NotificationCount><Type>refill</Type><Number>3</Number>
    <Refill><RcopiaID>r1</RcopiaID><Provider><RcopiaID>p1</RcopiaID><Username>DrTest</Username></Provider></Refill>
    <Refill><RxReferenceNumber>r2</RxReferenceNumber><Provider><Username>drother</Username></Provider></Refill>
    <Refill><RcopiaID>r3</RcopiaID><Provider><Username>drtest</Username></Provider></Refill>
  </NotificationCount>
  <NotificationCount><Type>rx_change</Type><Number>1</Number>
    <RxChange><RcopiaID>c1</RcopiaID><Provider><Username>drother</Username></Provider></RxChange>
  </NotificationCount>
</NotificationCountList><Status>ok</Status></Response>`;
const counts = parseNotificationCounts(COUNTS);
assert.deepEqual(counts.counts, { refill: 3, rx_change: 1 });
assert.deepEqual(counts.byProvider.drtest, { refill: 2 });
assert.deepEqual(counts.byProvider.drother, { refill: 1, rx_change: 1 });
assert.equal(counts.items[0].rcopiaId, 'r1', 'item id, not the provider id');
assert.equal(counts.items.length, 4);

// Live-captured (sanitized) staging shapes in tests/fixtures/rcopia
const fx = (name: string) => readFileSync(join(__dirname, '..', 'tests', 'fixtures', 'rcopia', name), 'utf8');

const problems = parseProblemDownload(fx('update_problem.xml'));
assert.equal(problems.length, 2);
assert.equal(problems[0].rcopiaId, '6132308711', 'problem id, not the patient id');
assert.equal(problems[0].status, 'deleted', '<Status><Deleted/></Status>');
assert.equal(problems[1].codeSystem, 'ICD9');
assert.equal(problems[1].code, '300.0');

const [patient] = parsePatientDownload(fx('update_patient_by_external_id.xml'));
assert.equal(patient.rcopiaId, '27162725039');
assert.equal(patient.externalId, 'maxpatient');
assert.equal(parsePatientDownload(fx('update_patient_not_found.xml'))[0].error?.code, 'bad_patient_id');

const [visit] = parseOfficeVisitDownload(fx('update_patient_office_visits.xml'));
assert.equal(visit.rcopiaId, '6191175287', 'visit id, not the patient / provider id');
assert.equal(visit.renderingProviderUsername, 'ssherman');

assert.equal(parseSendItems(fx('send_problem_created.xml'), 'Problem')[0].status, 'created');
assert.equal(envelopeStatus(fx('send_problem_created.xml')), 'ok', 'envelope status, not the item status');
assert.equal(envelopeStatus(fx('update_problem.xml')), 'ok');

console.log('rcopia parser fixtures: all checks passed');
