/**
 * Client demographics to industry standard (src/lib/clients/demographics.ts and its users):
 * validators, deterministic legal-name parsing (ambiguous names flagged, never guessed),
 * sex code mapping (never defaulted), 837P NM1 / N3 / DMG output, the DrFirst send_patient
 * builder, FHIR US Core Patient, the Valant import validator and the backfill planner.
 * Synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  administrativeSexCode,
  claimReadiness,
  demographicFields,
  demographicUpdateData,
  describeGaps,
  drfirstReadiness,
  ethnicityFromText,
  fhirReadiness,
  isValidMedicaidId,
  languageFromText,
  normalizeStateCode,
  normalizeUsPhone,
  normalizeUsZip,
  raceCodesFromText,
  relationshipFromText,
  sexCodeFromText,
  x12PatientName,
  zipDigits,
} from '../src/lib/clients/demographics';
import { parseLegalNameSource } from '../src/lib/clients/legalName';
import { planClientBackfill, type BackfillRow } from '../src/lib/clients/demographicsBackfill';
import { buildRcopiaPatient, type RcopiaPatientSource } from '../src/lib/drfirst/patientDemographics';
import { sendPatientBody } from '../src/lib/services/drfirstRcopiaService';
import { claimToBatchClaim, type ClaimForMapping, type MapperContext } from '../src/lib/billing/waystarSftpClaims';
import { generate837P } from '../src/lib/services/waystarSftpService';
import { mapPatient } from '../src/lib/fhir/mapping/patient';
import type { ClientRow } from '../src/lib/fhir/mapping/types';
import { validateClient } from '../src/lib/migration/validate';
import { resolveClientFields } from '../src/lib/migration/fieldMaps';

const NOW = new Date('2026-10-19T12:00:00Z');

// ─── Validators ──────────────────────────────────────────────────────────────

test('ZIP / ZIP+4, US phone, state code and Medicaid number validation', () => {
  assert.equal(normalizeUsZip('20715'), '20715');
  assert.equal(normalizeUsZip('207151234'), '20715-1234');
  assert.equal(normalizeUsZip(' 20715-1234 '), '20715-1234');
  for (const bad of ['2071', '207151', 'ABCDE', '20715-12', '', null]) assert.equal(normalizeUsZip(bad), null, String(bad));
  assert.equal(zipDigits('20715-1234'), '207151234');

  assert.deepEqual(normalizeUsPhone('(410) 555-0100'), { digits: '4105550100', e164: '+14105550100', display: '(410) 555-0100' });
  assert.equal(normalizeUsPhone('+1 410.555.0100')?.digits, '4105550100');
  for (const bad of ['555-0100', '(110) 555-0100', '410 155 0100', '410-555-0100 x12', '000-000-0000', '']) {
    assert.equal(normalizeUsPhone(bad), null, bad);
  }

  assert.equal(normalizeStateCode('md'), 'MD');
  assert.equal(normalizeStateCode('Maryland'), 'MD');
  assert.equal(normalizeStateCode('District of Columbia'), 'DC');
  assert.equal(normalizeStateCode('Marylnd'), null);
  assert.equal(normalizeStateCode('XX'), null);

  assert.ok(isValidMedicaidId('12345678901'));
  assert.ok(!isValidMedicaidId('1234567890'));
  assert.ok(!isValidMedicaidId('MA123456789'));
});

test('zod demographic fields accept only code-set values; declined race is exclusive', () => {
  const ok = (k: keyof typeof demographicFields, v: unknown) => demographicFields[k].safeParse(v).success;
  assert.ok(ok('administrativeSex', 'F'));
  assert.ok(ok('administrativeSex', 'U'));
  assert.ok(!ok('administrativeSex', 'Female'));
  assert.ok(ok('sexAtBirth', 'ASKU'));
  assert.ok(ok('genderIdentity', '33791000087105'));
  assert.ok(!ok('genderIdentity', 'nonbinary'));
  assert.ok(ok('pronouns', 'LA29519-8'));
  assert.ok(ok('race', ['2054-5', '2106-3']));
  assert.ok(ok('race', ['ASKU']));
  assert.ok(!ok('race', ['ASKU', '2106-3']), 'declined cannot be combined with a category');
  assert.ok(!ok('race', ['Black']));
  assert.ok(ok('ethnicity', '2135-2'));
  assert.ok(ok('preferredLanguage', 'es'));
  assert.ok(ok('preferredLanguage', 'ase'));
  assert.ok(!ok('preferredLanguage', 'Spanish'));
  assert.ok(ok('maritalStatus', 'M'));
  assert.ok(!ok('medicaidId', '123'));
  assert.ok(ok('guarantorPostalCode', '20910-1234'));
  assert.ok(!ok('guardianPhone', '555-0100'));

  const data = demographicUpdateData({ race: ['2106-3', '2106-3'], guarantorState: 'maryland', guarantorPostalCode: '209101234', ethnicity: '', medicaidId: '123 456 789 01' });
  assert.deepEqual(data.race, ['2106-3']);
  assert.equal(data.guarantorState, 'MD');
  assert.equal(data.guarantorPostalCode, '20910-1234');
  assert.equal(data.ethnicity, null);
  assert.equal(data.medicaidId, '12345678901');
  assert.equal('genderIdentity' in data, false, 'fields not sent are left unchanged');
});

const READY = {
  legalFirstName: 'Jane',
  legalLastName: 'Testpatient',
  dateOfBirth: new Date('1990-04-02T00:00:00Z'),
  administrativeSex: 'F',
  addressLine1: '1 Test St',
  city: 'Bowie',
  state: 'MD',
  postalCode: '20715',
  phone: '(410) 555-0100',
  insurancePayer: 'Maryland Medicaid',
  insuranceMemberId: '12345678901',
  mrn: 'ALT-TEST-2026-000001',
};

test('readiness: DrFirst, claims and FHIR list exactly what is missing', () => {
  assert.equal(drfirstReadiness(READY, NOW).ready, true);
  assert.equal(claimReadiness(READY, NOW).ready, true);
  assert.equal(fhirReadiness(READY).ready, true);
  // FHIR Must Support items are recommendations, not blockers
  assert.ok(fhirReadiness(READY).missing.some((g) => g.field === 'race' && g.severity === 'recommended'));

  const gaps = drfirstReadiness({ ...READY, legalFirstName: null, postalCode: '2071', state: 'Marylnd', administrativeSex: null, gender: 'Non-binary', phone: null }, NOW);
  assert.equal(gaps.ready, false);
  const required = gaps.missing.filter((g) => g.severity === 'required').map((g) => g.field);
  assert.deepEqual(required.sort(), ['administrativeSex', 'legalFirstName', 'postalCode', 'state'].sort());
  assert.ok(gaps.missing.some((g) => g.field === 'phone' && g.severity === 'recommended'));
  assert.match(describeGaps(gaps.missing), /Legal first name, .* and /);

  assert.equal(drfirstReadiness({ ...READY, needsNameReview: true }, NOW).ready, false);
  assert.equal(drfirstReadiness({ ...READY, dateOfBirth: new Date('2030-01-01') }, NOW).ready, false);
  const claims = claimReadiness({ ...READY, insuranceMemberId: '' }, NOW);
  assert.deepEqual(claims.missing.map((g) => g.field), ['insuranceMemberId']);
});

// ─── Name parsing ────────────────────────────────────────────────────────────

test('legal name: only "Last, First M" is split; ambiguous names are flagged with a reason', () => {
  assert.deepEqual(parseLegalNameSource('Testpatient, Jane'), { ok: true, firstName: 'Jane', middleInitial: null, lastName: 'Testpatient', suffix: null });
  assert.deepEqual(parseLegalNameSource('Testpatient, Jane Q.'), { ok: true, firstName: 'Jane', middleInitial: 'Q', lastName: 'Testpatient', suffix: null });
  assert.deepEqual(parseLegalNameSource('De La Cruz, Maria'), { ok: true, firstName: 'Maria', middleInitial: null, lastName: 'De La Cruz', suffix: null });
  assert.deepEqual(parseLegalNameSource("O'Neil-Smith, Ann R, Jr."), { ok: true, firstName: 'Ann', middleInitial: 'R', lastName: "O'Neil-Smith", suffix: 'Jr.' });
  assert.deepEqual(parseLegalNameSource('Testpatient, Jane, III'), { ok: true, firstName: 'Jane', middleInitial: null, lastName: 'Testpatient', suffix: 'III' });

  for (const ambiguous of [
    'Jane Testpatient', // no comma: order not certain
    'Mary Ann Testpatient',
    'Testpatient, Mary Ann', // middle name or two-part first name
    'Testpatient Jr, John', // suffix inside the last name
    'Testpatient, Jane, PhD', // not a name suffix
    'Testpatient, ',
    ', Jane',
    'Jane',
    'Patient 2',
    'A, B, C, D',
    '',
    null,
  ]) {
    const r = parseLegalNameSource(ambiguous);
    assert.equal(r.ok, false, String(ambiguous));
    if (r.ok === false) {
      assert.ok(r.reason.length > 0);
      // the reason never echoes the name itself (it is stored on the chart and printed by scripts)
      assert.ok(!/Testpatient|Jane|Mary/.test(r.reason), r.reason);
    }
  }
});

test('backfill planner: parses only deterministic names, flags the rest, maps only literal male / female', () => {
  const base: BackfillRow = {
    id: 'c1', name: 'Testpatient, Jane Q', legalFirstName: null, legalLastName: null, middleInitial: null, nameSuffix: null,
    needsNameReview: false, nameReviewReason: null, gender: 'Female', administrativeSex: null, state: 'Maryland', postalCode: '207151234',
  };
  const p = planClientBackfill(base);
  assert.equal(p.name, 'parsed');
  assert.deepEqual(p.data, {
    legalFirstName: 'Jane', legalLastName: 'Testpatient', middleInitial: 'Q', name: 'Jane Testpatient',
    administrativeSex: 'F', state: 'MD', postalCode: '20715-1234',
  });

  const flagged = planClientBackfill({ ...base, name: 'Jane Testpatient', gender: 'Unknown', state: 'MD', postalCode: '20715' });
  assert.equal(flagged.name, 'flagged');
  assert.equal(flagged.sex, 'unmapped');
  assert.equal(flagged.legacyGenderBucket, 'unknown');
  assert.deepEqual(flagged.data, { needsNameReview: true, nameReviewReason: 'No comma: first / last order is not certain' });

  const set = planClientBackfill({ ...base, legalFirstName: 'Jane', legalLastName: 'Testpatient', gender: null, state: 'MD', postalCode: '20715' });
  assert.equal(set.name, 'already_set');
  assert.equal(set.sex, 'missing');
  assert.deepEqual(set.data, {}, 'nothing invented: no sex default, no name change');

  const half = planClientBackfill({ ...base, legalFirstName: 'Jane', needsNameReview: true });
  assert.equal(half.name, 'already_flagged');
  assert.equal('needsNameReview' in half.data, false);
});

// ─── Sex code mapping ────────────────────────────────────────────────────────

test('sex codes: structured value wins; legacy maps only male / female; never defaulted', () => {
  assert.equal(administrativeSexCode({ administrativeSex: 'U', gender: 'Male' }), 'U');
  assert.equal(administrativeSexCode({ gender: 'Male' }), 'M');
  assert.equal(administrativeSexCode({ gender: 'f' }), 'F');
  for (const g of [null, '', 'Unknown', 'Non-binary', 'Transgender Female', 'Decline to specify', 'Other']) {
    assert.equal(administrativeSexCode({ gender: g }), null, String(g));
  }
  assert.deepEqual(sexCodeFromText('Female'), { code: 'F', unmapped: null });
  assert.deepEqual(sexCodeFromText('X'), { code: null, unmapped: 'X' });
  assert.deepEqual(sexCodeFromText(''), { code: null, unmapped: null });
});

test('import text -> codes: exact labels / synonyms only; the rest is reported unmapped', () => {
  assert.deepEqual(raceCodesFromText('White; Black or African American'), { codes: ['2054-5', '2106-3'], unmapped: [] });
  assert.deepEqual(raceCodesFromText('Native Hawaiian or Other Pacific Islander'), { codes: ['2076-8'], unmapped: [] });
  assert.deepEqual(raceCodesFromText('Two or more races'), { codes: [], unmapped: ['Two or more races'] });
  assert.deepEqual(raceCodesFromText('Patient declined'), { codes: ['ASKU'], unmapped: [] });
  assert.equal(ethnicityFromText('Not Hispanic or Latino').code, '2186-5');
  assert.equal(ethnicityFromText('Hispanic').code, '2135-2');
  assert.equal(languageFromText('Spanish').code, 'es');
  assert.equal(languageFromText('Klingon').code, null);
  assert.equal(relationshipFromText('Mother').code, 'MTH');
  assert.equal(relationshipFromText('Boyfriend').code, null);
});

// ─── 837P ────────────────────────────────────────────────────────────────────

const GROUP_NPI = '1234567893';
const CLINICIAN_NPI = '1111111112';
const CTX: MapperContext = { groupNpi: GROUP_NPI, billingTaxonomy: '261QM0801X' };

function claim(client: Partial<ClaimForMapping['client']> = {}): ClaimForMapping {
  return {
    id: 'cmclaimdemographics00001',
    claimControlNumber: 'DEMO0000000000000001',
    status: 'READY',
    cptCode: '90837',
    units: 1,
    amountCents: 18000,
    payer: 'Maryland Medicaid',
    icd10Codes: ['F33.1'],
    placeOfService: '11',
    renderingNpi: null,
    billingNpi: null,
    submissionData: { payerId: 'MDMCD', claimFilingCode: 'MC', placeOfService: '11' },
    noteStatus: 'LOCKED',
    client: {
      name: 'Jane Testpatient',
      legalFirstName: 'Jane',
      legalLastName: 'Testpatient',
      middleInitial: 'Q',
      nameSuffix: 'Jr.',
      dateOfBirth: new Date('1990-04-02T00:00:00.000Z'),
      administrativeSex: 'F',
      gender: null,
      addressLine1: '1 Test St',
      addressLine2: 'Apt 2',
      city: 'Bowie',
      state: 'Maryland',
      postalCode: '20715-1234',
      insurancePayer: 'Maryland Medicaid',
      insuranceMemberId: '12345678901',
      ...client,
    },
    appointment: { id: 'appt-1', clinicianId: 'clin-1', startsAt: new Date('2026-10-14T14:00:00.000Z'), clinician: { name: 'Sam Clinician', npi: CLINICIAN_NPI } },
    note: {
      id: 'note-1', clinicianId: 'clin-1', dateOfService: new Date('2026-10-14T00:00:00.000Z'), cptCode: '90837', durationMinutes: 55,
      appointmentId: 'appt-1', workflow: { status: 'LOCKED', cosignRequired: false, cosignedAt: null },
    },
    renderingClinician: { userId: 'clin-1', npi: CLINICIAN_NPI, legalFirstName: 'Sam', legalLastName: 'Clinician', taxonomyCode: '101YP2500X', preLicensed: false, supervisor: null },
    serviceLines: [],
  };
}

test('837P 2010BA: legal name + suffix in NM1, address line 2 in N3, ZIP+4 in N4, sex in DMG', () => {
  const r = claimToBatchClaim(claim(), CTX);
  assert.equal(r.ok, true, 'errors' in r ? r.errors.join('; ') : '');
  if (!('claim' in r)) return;
  const segs = generate837P([r.claim], 11).content.split('~\n').map((x) => x.replace(/~$/, ''));
  assert.ok(segs.includes('NM1*IL*1*TESTPATIENT*JANE*Q**JR*MI*12345678901'), segs.filter((s) => s.startsWith('NM1*IL')).join(' | '));
  assert.ok(segs.includes('N3*1 TEST ST*APT 2'));
  assert.ok(segs.includes('N4*BOWIE*MD*207151234'));
  assert.ok(segs.includes('DMG*D8*19900402*F'));
});

test('837P: never splits a display name, never defaults sex, blocks a name under review', () => {
  const noLegal = claimToBatchClaim(claim({ legalFirstName: null, legalLastName: null, name: 'Jane Testpatient' }), CTX);
  assert.equal(noLegal.ok, false);
  assert.ok('errors' in noLegal && noLegal.errors.some((e) => /legal first and last name/.test(e)));

  const legacyGender = claimToBatchClaim(claim({ administrativeSex: null, gender: 'Non-binary' }), CTX);
  assert.ok('errors' in legacyGender && legacyGender.errors.some((e) => /not an X12 sex code/.test(e)));

  const missingSex = claimToBatchClaim(claim({ administrativeSex: null, gender: null }), CTX);
  assert.ok('errors' in missingSex && missingSex.errors.some((e) => /sex is missing/.test(e)));

  const review = claimToBatchClaim(claim({ needsNameReview: true }), CTX);
  assert.ok('errors' in review && review.errors.some((e) => /needs staff review/.test(e)));

  const unknownSex = claimToBatchClaim(claim({ administrativeSex: 'U' }), CTX);
  assert.equal(unknownSex.ok, true, 'U is a recorded answer');

  assert.equal(x12PatientName({ legalFirstName: 'Jane', legalLastName: 'Testpatient', middleInitial: 'q.' })?.middleInitial, 'Q');
  assert.equal(x12PatientName({ legalFirstName: 'Jane', legalLastName: null }), null);
});

// ─── DrFirst ─────────────────────────────────────────────────────────────────

const RCOPIA_CLIENT: RcopiaPatientSource = {
  id: 'ckclientdemo1',
  legalFirstName: 'Jane',
  middleInitial: 'Q',
  legalMiddleName: 'Quinn',
  legalLastName: 'Testpatient',
  nameSuffix: 'Jr.',
  needsNameReview: false,
  dateOfBirth: new Date('1990-04-02T00:00:00.000Z'),
  administrativeSex: 'F',
  gender: null,
  addressLine1: '1 Test St',
  addressLine2: 'Apt 2',
  city: 'Bowie',
  state: 'md',
  postalCode: '20715',
  phone: '(410) 628-3910',
  phoneType: 'mobile',
  phoneSecondary: '301-262-4417',
  phoneSecondaryType: 'home',
};

test('DrFirst send_patient: legal name pieces, recorded sex, full address, typed phones', () => {
  const b = buildRcopiaPatient(RCOPIA_CLIENT, NOW);
  assert.equal(b.ok, true);
  if (!('patient' in b)) return;
  assert.deepEqual(b.patient, {
    externalId: 'ckclientdemo1', firstName: 'Jane', middleName: 'Quinn', lastName: 'Testpatient', suffix: 'Jr.',
    dob: '1990-04-02', gender: 'F', addressLine1: '1 Test St', addressLine2: 'Apt 2', city: 'Bowie', state: 'MD', zipCode: '20715',
    mobilePhone: '4106283910', homePhone: '3012624417',
  });
  const xml = sendPatientBody(b.patient);
  for (const el of ['<FirstName>Jane</FirstName>', '<MiddleName>Quinn</MiddleName>', '<LastName>Testpatient</LastName>', '<Suffix>Jr.</Suffix>',
    '<DOB>04/02/1990</DOB>', '<Sex>F</Sex>', '<MobilePhone>4106283910</MobilePhone>', '<HomePhone>3012624417</HomePhone>',
    '<Address1>1 Test St</Address1>', '<Address2>Apt 2</Address2>', '<City>Bowie</City>', '<State>MD</State>', '<Zip>20715</Zip>']) {
    assert.ok(xml.includes(el), el);
  }
  assert.ok(!/\n\s*\n/.test(xml), 'no blank lines from omitted elements');
});

test('DrFirst send_patient is blocked with the missing items; never a default sex or split name', () => {
  const b = buildRcopiaPatient({ ...RCOPIA_CLIENT, legalFirstName: null, administrativeSex: null, gender: 'Unknown', postalCode: '2071' }, NOW);
  assert.equal(b.ok, false);
  if (b.ok) return;
  assert.deepEqual(b.missing.map((g) => g.field).sort(), ['administrativeSex', 'legalFirstName', 'postalCode']);
  assert.match(b.reason, /Demographics incomplete for e-prescribing/);
  const noPhone = buildRcopiaPatient({ ...RCOPIA_CLIENT, phone: null, phoneSecondary: null }, NOW);
  assert.equal(noPhone.ok, true, 'phone is recommended, not required');
  if (noPhone.ok) assert.equal(noPhone.patient.homePhone, undefined);
});

// ─── FHIR US Core Patient ────────────────────────────────────────────────────

const FHIR_CLIENT: ClientRow = {
  id: 'clientdemo', organizationId: 'orgdemo', name: 'Jane Testpatient', legalFirstName: 'Jane', middleInitial: 'Q', legalLastName: 'Testpatient',
  email: null, phone: '(410) 555-0100', phoneSecondary: null, status: 'ACTIVE', mrn: 'ALT-DEMO-2026-000001', sourcePlatform: null, sourceId: null,
  dateOfBirth: new Date('1990-04-02T00:00:00Z'), gender: 'Female', addressLine1: '1 Test St', addressLine2: null, city: 'Bowie', state: 'MD',
  postalCode: '207151234', emergencyContactName: null, emergencyContactPhone: null, primaryDiagnosis: null, primaryDiagnosisCode: null,
  secondaryDiagnoses: null, assignedToId: null, sensitiveRecord: null,
  nameSuffix: 'Jr.', preferredName: 'Jay', administrativeSex: 'F', sexAtBirth: 'F', genderIdentity: '33791000087105', pronouns: 'LA29520-6',
  race: ['2054-5', '2106-3'], ethnicity: '2186-5', preferredLanguage: 'es', interpreterNeeded: true, maritalStatus: 'S', county: "Prince George's",
  phoneType: 'mobile', medicaidId: '12345678901', guardianName: 'Pat Testguardian', guardianRelationship: 'MTH', guardianPhone: '(410) 555-0101',
};

test('FHIR Patient: US Core official / usual names, race / ethnicity / birthsex / genderIdentity, language, identifiers', () => {
  const p = mapPatient(FHIR_CLIENT, { organizationId: 'orgdemo' }) as Record<string, any>;
  assert.deepEqual(p.name[0], { use: 'official', family: 'Testpatient', given: ['Jane', 'Q'], suffix: ['Jr.'], text: 'Jane Q Testpatient Jr.' });
  assert.deepEqual(p.name[1], { use: 'usual', given: ['Jay'], family: 'Testpatient', text: 'Jay Testpatient' });
  assert.equal(p.gender, 'female');
  const ext = (url: string) => (p.extension as any[]).find((e) => e.url.endsWith(url));
  const race = ext('us-core-race');
  assert.deepEqual(race.extension.filter((e: any) => e.url === 'ombCategory').map((e: any) => e.valueCoding.code), ['2054-5', '2106-3']);
  assert.equal(race.extension.find((e: any) => e.url === 'text').valueString, 'Black or African American, White');
  assert.equal(race.extension[0].valueCoding.system, 'urn:oid:2.16.840.1.113883.6.238');
  assert.equal(ext('us-core-ethnicity').extension[0].valueCoding.code, '2186-5');
  assert.equal(ext('us-core-birthsex').valueCode, 'F');
  assert.equal(ext('us-core-genderIdentity').valueCodeableConcept.coding[0].code, '33791000087105');
  assert.equal(ext('individual-pronouns').extension[0].valueCodeableConcept.coding[0].code, 'LA29520-6');
  assert.equal(ext('patient-interpreterRequired').valueBoolean, true);
  assert.deepEqual(p.communication, [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'es', display: 'Spanish' }], text: 'Spanish' }, preferred: true }]);
  assert.equal(p.maritalStatus.coding[0].code, 'S');
  assert.equal(p.address[0].postalCode, '20715-1234');
  assert.equal(p.address[0].district, "Prince George's");
  assert.equal(p.telecom[0].use, 'mobile');
  assert.ok((p.identifier as any[]).some((i) => i.type?.coding?.[0]?.code === 'MA' && i.value === '12345678901'));
  assert.ok((p.contact as any[]).some((c) => c.relationship.some((r: any) => r.coding[0].code === 'GUARD')));

  // Declined answers are sent as NullFlavor ASKU, not a category
  const declined = mapPatient({ ...FHIR_CLIENT, race: ['ASKU'], genderIdentity: 'ASKU' }, { organizationId: 'orgdemo' }) as Record<string, any>;
  const dRace = (declined.extension as any[]).find((e) => e.url.endsWith('us-core-race'));
  assert.equal(dRace.extension[0].valueCoding.system, 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor');
  assert.equal(dRace.extension[0].valueCoding.code, 'ASKU');

  // Nothing recorded -> no extensions, no invented gender, display name never split
  const bare = mapPatient({ ...FHIR_CLIENT, legalFirstName: null, middleInitial: null, legalLastName: null, nameSuffix: null, preferredName: null,
    administrativeSex: null, gender: null, sexAtBirth: null, genderIdentity: null, pronouns: null, race: [], ethnicity: null, preferredLanguage: null,
    interpreterNeeded: null, maritalStatus: null }, { organizationId: 'orgdemo' }) as Record<string, any>;
  assert.equal(bare.extension, undefined);
  assert.equal(bare.gender, undefined);
  assert.deepEqual(bare.name, [{ use: 'official', text: 'Jane Testpatient' }]);
});

// ─── Valant import ───────────────────────────────────────────────────────────

test('Valant import: first / last columns or "Last, First M" only; other names flagged; codes mapped; nothing defaulted', () => {
  const cols = resolveClientFields({
    'Pt. ID': 'V1', 'Pt. Name (First)': 'Jane', 'Pt. Name (Last)': 'Testpatient', 'Pt. Birth Date': '4/2/1990', 'Pt. Sex': 'F',
    'Pt. Race': 'White', 'Pt. Ethnicity': 'Not Hispanic or Latino', 'Pt. Language': 'Spanish', 'Pt. Marital Status': 'Single',
    'Pt. Address (State)': 'Maryland', 'Pt. Address (Zip)': '207151234', 'Pt. Phone (Cell)': '410-555-0100',
  }, 'valant');
  const v = validateClient(cols);
  assert.ok(v.ok);
  if (!('value' in v)) return;
  assert.equal(v.value.firstName, 'Jane');
  assert.equal(v.value.needsNameReview, false);
  assert.equal(v.value.administrativeSex, 'F');
  assert.equal(v.value.gender, 'Female');
  assert.deepEqual(v.value.race, ['2106-3']);
  assert.equal(v.value.ethnicity, '2186-5');
  assert.equal(v.value.preferredLanguage, 'es');
  assert.equal(v.value.maritalStatus, 'S');
  assert.equal(v.value.state, 'MD');
  assert.equal(v.value.postalCode, '20715-1234');
  assert.equal(v.value.phone, '410-555-0100');
  assert.equal(v.value.phoneType, 'mobile');

  const parsed = validateClient({ sourceId: 'V2', name: 'Testpatient, Jane Q', dateOfBirth: '1990-04-02' });
  assert.ok(parsed.ok && parsed.value.firstName === 'Jane' && parsed.value.lastName === 'Testpatient' && parsed.value.middleInitial === 'Q' && !parsed.value.needsNameReview);
  assert.ok(parsed.ok && parsed.value.name === 'Jane Testpatient');

  const ambiguous = validateClient({ sourceId: 'V3', name: 'Mary Ann Testpatient', dateOfBirth: '1990-04-02', gender: '', race: 'Two or more races' });
  assert.ok(ambiguous.ok);
  if (!('value' in ambiguous)) return;
  assert.equal(ambiguous.value.firstName, null);
  assert.equal(ambiguous.value.lastName, null);
  assert.equal(ambiguous.value.needsNameReview, true);
  assert.equal(ambiguous.value.name, 'Mary Ann Testpatient');
  assert.equal(ambiguous.value.gender, null, 'a blank sex cell is not "Unknown"');
  assert.equal(ambiguous.value.administrativeSex, null);
  assert.deepEqual(ambiguous.value.race, []);
  assert.deepEqual(ambiguous.value.unmapped, [{ field: 'race', value: 'Two or more races' }]);
});

test('send_patient always carries <MiddleName>: empty when the middle initial was removed (DrFirst certification)', async () => {
  const { sendPatientBody } = await import('../src/lib/services/drfirstRcopiaService');
  const base = { externalId: 'c1', firstName: 'Ann', lastName: 'Lee', dob: '1990-02-03', gender: 'F' } as Parameters<typeof sendPatientBody>[0];
  assert.match(sendPatientBody({ ...base, middleName: 'Q' }), /<MiddleName>Q<\/MiddleName>/);
  assert.match(sendPatientBody({ ...base, middleName: '' }), /<MiddleName><\/MiddleName>/);
});
