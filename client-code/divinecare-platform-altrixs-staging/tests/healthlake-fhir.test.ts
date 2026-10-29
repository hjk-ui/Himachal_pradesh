import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SYSTEMS,
  buildOrgResources,
  clientDiagnoses,
  fhirId,
  hashResource,
  isSudIcd10,
  isValidFhirId,
  isValidNpi,
  mapAdministrativeGender,
  mapAllergyIntolerance,
  mapAppointmentEncounter,
  mapAssessmentObservation,
  mapClientDiagnosis,
  mapMedicalProblem,
  mapMedicationStatement,
  mapPatient,
  mapPractitioner,
  mapProgressNoteDocument,
  normalizeIcd10,
  safeId,
  type BuiltResource,
  type FhirResource,
  type OrgSnapshot,
} from '../src/lib/fhir/mapping';
import {
  applyUpdates,
  backoffMs,
  outboxKey,
  planOutbox,
  processOutbox,
  selectDue,
  type OutboxRow,
} from '../src/lib/healthlake/outbox';
import { buildScopedSearch, scopeBundle } from '../src/lib/healthlake/search';
import { healthLakeConfig } from '../src/lib/healthlake/config';
import { createHealthLakeTransport } from '../src/lib/healthlake/client';
import { canonicalQueryString, canonicalUri, rfc3986 } from '../src/lib/aws/sign';
import { parseSyncSettings } from '../src/lib/healthlake/settings';

// ─── Synthetic fixtures (no real patients) ───────────────────────────────────

const ORG = 'orgalpha';
const OFF = { enabled: true, allowPart2Sync: false };
const ON = { enabled: true, allowPart2Sync: true };
const d = (s: string) => new Date(s);

function snapshot(): OrgSnapshot {
  const client = (id: string, extra: Partial<OrgSnapshot['clients'][number]> = {}): OrgSnapshot['clients'][number] => ({
    id,
    organizationId: ORG,
    name: 'Sam Q Tester',
    legalFirstName: 'Samuel',
    middleInitial: 'Q',
    legalLastName: 'Tester',
    email: 'sam@example.test',
    phone: '410-555-0100',
    phoneSecondary: null,
    status: 'ACTIVE',
    mrn: 'ALT-ALPHA-2026-000001',
    sourcePlatform: 'VALANT_EXPORT',
    sourceId: 'V-9001',
    dateOfBirth: d('1990-04-02T00:00:00Z'),
    gender: 'Female',
    addressLine1: '1 Test Way',
    addressLine2: null,
    city: 'Bowie',
    state: 'MD',
    postalCode: '20715',
    emergencyContactName: 'Pat Tester',
    emergencyContactPhone: '410-555-0101',
    primaryDiagnosis: 'Generalized anxiety disorder',
    primaryDiagnosisCode: 'F411',
    secondaryDiagnoses: 'F33.1 - Major depressive disorder, recurrent, moderate; F10.20 - Alcohol use disorder, moderate; insomnia (free text)',
    assignedToId: 'userclin',
    sensitiveRecord: null,
    ...extra,
  });
  return {
    organization: { id: ORG, name: 'Alpha Counseling', active: true },
    locations: [
      { id: 'loc1', organizationId: ORG, name: 'Bowie', code: 'BOW', addressLine1: '2 Main St', addressLine2: null, city: 'Bowie', state: 'MD', postalCode: '20715', phone: null, active: true },
    ],
    users: [
      { id: 'userclin', name: 'Dana Clinician', email: 'dana@example.test', role: 'THERAPIST', status: 'ACTIVE', npi: '1234567893', licenseNumber: 'LCPC-1' },
      { id: 'userbadnpi', name: 'Ray Prescriber', email: 'ray@example.test', role: 'NP', status: 'ACTIVE', npi: '1234567890', licenseNumber: null },
      { id: 'userbilling', name: 'Bill Ing', email: 'bill@example.test', role: 'BILLING', status: 'ACTIVE', npi: null, licenseNumber: null },
    ],
    clients: [
      client('clienta'),
      client('clientp2', { name: 'Part Two', legalFirstName: null, middleInitial: null, legalLastName: null }),
      client('clientvip', { sensitiveRecord: { noteClassification: 'Employee' }, primaryDiagnosisCode: null, primaryDiagnosis: null, secondaryDiagnoses: null }),
    ],
    problems: [
      { id: 'mp_1', clientId: 'clienta', icd10Code: 'F41.1', name: 'Generalized anxiety disorder', description: null, status: 'Active', onsetDate: d('2025-01-01T00:00:00Z'), resolvedDate: null, source: 'drfirst', rcopiaProblemId: 'R-77', createdAt: d('2026-01-01T00:00:00Z') },
      { id: 'mp_2', clientId: 'clienta', icd10Code: 'E11.9', name: 'Type 2 diabetes', description: null, status: 'Resolved', onsetDate: null, resolvedDate: d('2026-02-01T00:00:00Z'), source: null, rcopiaProblemId: null, createdAt: d('2026-01-02T00:00:00Z') },
    ],
    medications: [
      { id: 'med_1', clientId: 'clienta', medicationName: 'Sertraline', dosage: '50 mg', route: 'oral', frequency: 'daily', indication: 'GAD', startDate: d('2026-03-01T00:00:00Z'), endDate: null, stopDate: null, active: true, status: 'active', source: 'drfirst', drugName: 'Sertraline 50 mg tablet', brandName: null, genericName: 'sertraline', ndcCode: null, rxnormId: '312940', dosageText: null, asNeeded: false, prnReason: null, rcopiaMedId: 'RM-1', prescribedById: 'userbadnpi', createdAt: d('2026-03-01T00:00:00Z') },
      { id: 'med_2', clientId: 'clienta', medicationName: 'Hydroxyzine', dosage: '25 mg', route: null, frequency: null, indication: null, startDate: d('2026-03-01T00:00:00Z'), endDate: null, stopDate: d('2026-04-01T00:00:00Z'), active: false, status: 'stopped', source: 'prescribed', drugName: null, brandName: null, genericName: null, ndcCode: null, rxnormId: null, dosageText: null, asNeeded: true, prnReason: 'anxiety', rcopiaMedId: null, prescribedById: 'someone_else', createdAt: d('2026-03-01T00:00:00Z') },
      { id: 'med_bup', clientId: 'clienta', medicationName: 'Buprenorphine-naloxone', dosage: '8 mg', route: null, frequency: null, indication: null, startDate: d('2026-03-01T00:00:00Z'), endDate: null, stopDate: null, active: true, status: 'active', source: 'prescribed', drugName: null, brandName: 'Suboxone', genericName: null, ndcCode: null, rxnormId: null, dosageText: null, asNeeded: false, prnReason: null, rcopiaMedId: null, prescribedById: null, createdAt: d('2026-03-01T00:00:00Z') },
    ],
    allergies: [
      { id: 'alg_1', clientId: 'clienta', allergen: 'Penicillin', reaction: 'Hives', severity: 'Severe', status: 'Active', source: 'drfirst', rcopiaAllergyId: 'RA-1', createdAt: d('2026-01-01T00:00:00Z') },
      { id: 'alg_nka', clientId: 'clienta', allergen: 'NKDA', reaction: null, severity: 'Moderate', status: 'Active', source: null, rcopiaAllergyId: null, createdAt: d('2026-01-01T00:00:00Z') },
      { id: 'alg_orphan', clientId: null, allergen: 'Latex', reaction: null, severity: 'Mild', status: 'Active', source: null, rcopiaAllergyId: null, createdAt: d('2026-01-01T00:00:00Z') },
    ],
    appointments: [
      { id: 'appt_1', clientId: 'clienta', clinicianId: 'userclin', type: 'Individual therapy', startsAt: d('2026-10-01T14:00:00Z'), endsAt: d('2026-10-01T14:50:00Z'), status: 'COMPLETED', isVirtual: true },
      { id: 'appt_2', clientId: 'clienta', clinicianId: null, type: 'Intake', startsAt: d('2026-10-02T14:00:00Z'), endsAt: d('2026-10-02T15:00:00Z'), status: 'NO_SHOW', isVirtual: false },
      { id: 'appt_p2', clientId: 'clientp2', clinicianId: 'userclin', type: 'Group', startsAt: d('2026-10-01T14:00:00Z'), endsAt: d('2026-10-01T15:00:00Z'), status: 'COMPLETED', isVirtual: false },
    ],
    medicalVisits: [
      { id: 'mv_1', clientId: 'clienta', providerId: 'userbadnpi', visitDate: d('2026-09-01T10:00:00Z'), visitType: 'Follow-up', cptCode: '99213', icd10Codes: ['E11.9', 'F10.20'], status: 'COMPLETED', signedAt: d('2026-09-01T11:00:00Z') },
    ],
    notes: [
      { id: 'note_signed', clientId: 'clienta', clinicianId: 'userclin', body: 'draft text that changed later', noteType: 'SOAP', dateOfService: d('2026-10-01T00:00:00Z'), part2: false, createdAt: d('2026-10-01T15:00:00Z'), workflow: { status: 'LOCKED', signedAt: d('2026-10-01T16:00:00Z'), lockedAt: d('2026-10-01T16:00:00Z'), body: 'S: doing better\nP: continue CBT', signedById: 'userclin', cosignedById: null }, addenda: [{ id: 'add_1', reason: 'Late entry', text: 'Phone call follow-up.', authorName: 'Dana Clinician', createdAt: d('2026-10-02T09:00:00Z') }] },
      { id: 'note_draft', clientId: 'clienta', clinicianId: 'userclin', body: 'DRAFT ONLY', noteType: 'SOAP', dateOfService: null, part2: false, createdAt: d('2026-10-03T15:00:00Z'), workflow: { status: 'DRAFT', signedAt: null, lockedAt: null, body: 'DRAFT ONLY', signedById: null, cosignedById: null }, addenda: [] },
      { id: 'note_p2', clientId: 'clientp2', clinicianId: 'userclin', body: '<!--ehr type="SOAP" duration="50" cpt="" telehealth="false" pos="11" part2="true"-->\nSUD session', noteType: null, dateOfService: null, part2: false, createdAt: d('2026-10-01T15:00:00Z'), workflow: { status: 'SIGNED', signedAt: d('2026-10-01T16:00:00Z'), lockedAt: null, body: '<!--ehr type="SOAP" duration="50" cpt="" telehealth="false" pos="11" part2="true"-->\nSUD session', signedById: 'userclin', cosignedById: null }, addenda: [] },
    ],
    assessments: [
      { id: 'asmt_phq9', clientId: 'clienta', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 14, severity: 'Moderate', administeredById: 'userclin', createdAt: d('2026-10-01T14:10:00Z') },
      { id: 'asmt_gad7', clientId: 'clienta', instrumentId: 'gad-7', instrumentName: 'GAD-7', totalScore: 9, severity: 'Mild', administeredById: 'not-a-user', createdAt: d('2026-10-01T14:12:00Z') },
      { id: 'asmt_pcl5', clientId: 'clienta', instrumentId: 'pcl-5', instrumentName: 'PCL-5', totalScore: 40, severity: null, administeredById: null, createdAt: d('2026-10-01T14:15:00Z') },
      { id: 'asmt_bad', clientId: 'clienta', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 99, severity: null, administeredById: null, createdAt: d('2026-10-01T14:15:00Z') },
    ],
    part2NoteClientIds: [],
  };
}

const ctx = { organizationId: ORG };
const find = (rs: BuiltResource[], type: string, id: string) => rs.find((r) => r.resourceType === type && r.resourceId === id)?.resource;
const codings = (r: FhirResource | undefined, path: string) => JSON.stringify((r as Record<string, unknown>)?.[path] ?? null);

// ─── Helpers ─────────────────────────────────────────────────────────────────

test('helpers: ids, NPI, ICD-10, gender', () => {
  assert.equal(fhirId('dx', 'clienta', 'F41.1'), 'dx-clienta-F41.1'.replace(/_/g, '-'));
  const long = fhirId('x'.repeat(80));
  assert.ok(isValidFhirId(long) && long.length <= 64);
  assert.equal(fhirId('a b', 'c/d'), 'a-b-c-d');
  assert.equal(safeId('ckabc123'), 'ckabc123');
  const odd = safeId('legacy_id/1');
  assert.ok(isValidFhirId(odd) && odd.startsWith('legacy-id-1-') && safeId(odd) === odd);
  assert.notEqual(safeId('a_b'), safeId('a-b'));
  assert.ok(isValidNpi('1234567893'));
  assert.ok(!isValidNpi('1234567890'));
  assert.ok(!isValidNpi('12345'));
  assert.equal(normalizeIcd10('f411'), 'F41.1');
  assert.equal(normalizeIcd10('F33.1'), 'F33.1');
  assert.equal(normalizeIcd10('insomnia'), null);
  assert.ok(isSudIcd10('F10.20') && isSudIcd10('F19') && !isSudIcd10('F17.210') && !isSudIcd10('F41.1'));
  assert.equal(mapAdministrativeGender('F'), 'female');
  assert.equal(mapAdministrativeGender('Non-binary'), 'other');
  assert.equal(mapAdministrativeGender('Declined to answer'), 'unknown');
  assert.equal(mapAdministrativeGender(null), undefined);
});

test('hash ignores server-assigned meta and key order', () => {
  const a = { resourceType: 'Patient', id: 'p', active: true, meta: { tag: [{ system: 's', code: 'c' }] } } as FhirResource;
  const b = { meta: { tag: [{ code: 'c', system: 's' }], versionId: '7', lastUpdated: 'x' }, id: 'p', active: true, resourceType: 'Patient' } as unknown as FhirResource;
  assert.equal(hashResource(a), hashResource(b));
  assert.notEqual(hashResource(a), hashResource({ ...a, active: false }));
});

// ─── Each resource type ──────────────────────────────────────────────────────

test('Patient: identifiers, names, demographics, managing org, no invented values', () => {
  const snap = snapshot();
  const p = mapPatient(snap.clients[0]!, ctx) as Record<string, any>;
  assert.equal(p.resourceType, 'Patient');
  assert.equal(p.id, 'clienta');
  const ids = p.identifier as Array<{ system: string; value: string; type?: { coding?: Array<{ code: string }> } }>;
  assert.deepEqual(ids.find((i) => i.system === SYSTEMS.client)?.value, 'clienta');
  const mrn = ids.find((i) => i.type?.coding?.[0]?.code === 'MR');
  assert.equal(mrn?.value, 'ALT-ALPHA-2026-000001');
  assert.equal(mrn?.system, `urn:altrixs:organization:${ORG}:mrn`);
  assert.equal(ids.find((i) => i.system === SYSTEMS.valant)?.value, 'V-9001');
  assert.equal(p.name[0].use, 'official');
  assert.deepEqual(p.name[0].given, ['Samuel', 'Q']);
  assert.equal(p.name[0].family, 'Tester');
  assert.equal(p.name[1].use, 'usual');
  assert.equal(p.birthDate, '1990-04-02');
  assert.equal(p.gender, 'female');
  assert.equal(p.address[0].state, 'MD');
  assert.deepEqual(p.managingOrganization, { reference: `Organization/${ORG}` });
  assert.deepEqual(p.meta.tag, [{ system: SYSTEMS.organizationTag, code: ORG }]);
  assert.equal(p.meta.security, undefined);

  // No address fields -> no address; never a default state
  const bare = mapPatient({ ...snap.clients[0]!, addressLine1: null, city: null, state: null, postalCode: null, mrn: null, sourcePlatform: null }, ctx) as Record<string, any>;
  assert.equal(bare.address, undefined);
  assert.equal((bare.identifier as unknown[]).length, 1);
});

test('Practitioner: NPI only when valid', () => {
  const snap = snapshot();
  const good = mapPractitioner(snap.users[0]!, ctx) as Record<string, any>;
  assert.ok((good.identifier as Array<{ system: string; value: string }>).some((i) => i.system === SYSTEMS.npi && i.value === '1234567893'));
  const bad = mapPractitioner(snap.users[1]!, ctx) as Record<string, any>;
  assert.ok(!(bad.identifier as Array<{ system: string }>).some((i) => i.system === SYSTEMS.npi));
  assert.equal(good.name[0].family, 'Clinician');
});

test('Condition: ICD-10-CM coding, clinicalStatus, DrFirst source, client-level list parsing', () => {
  const snap = snapshot();
  const mp = mapMedicalProblem(snap.problems[0]!, ctx) as Record<string, any>;
  assert.equal(mp.code.coding[0].system, 'http://hl7.org/fhir/sid/icd-10-cm');
  assert.equal(mp.code.coding[0].code, 'F41.1');
  assert.equal(mp.clinicalStatus.coding[0].code, 'active');
  assert.equal(mp.meta.source, 'urn:altrixs:source:drfirst');
  assert.equal(mp.identifier[0].value, 'R-77');
  const resolved = mapMedicalProblem(snap.problems[1]!, ctx) as Record<string, any>;
  assert.equal(resolved.clinicalStatus.coding[0].code, 'resolved');
  assert.equal(resolved.abatementDateTime, '2026-02-01');

  const dx = clientDiagnoses(snap.clients[0]!);
  assert.deepEqual(dx.map((x) => x.code), ['F41.1', 'F33.1', 'F10.20', null]);
  const free = mapClientDiagnosis(snap.clients[0]!, dx[3]!, ctx) as Record<string, any>;
  assert.equal(free.code.coding, undefined);
  assert.equal(free.code.text, 'insomnia (free text)');
});

test('MedicationStatement: RxNorm when present, else text; status; PRN', () => {
  const snap = snapshot();
  const m1 = mapMedicationStatement(snap.medications[0]!, ctx) as Record<string, any>;
  assert.equal(m1.status, 'active');
  assert.deepEqual(m1.medicationCodeableConcept.coding[0], { system: SYSTEMS.rxnorm, code: '312940', display: 'Sertraline 50 mg tablet' });
  assert.equal(m1.meta.source, 'urn:altrixs:source:drfirst');
  const m2 = mapMedicationStatement(snap.medications[1]!, ctx) as Record<string, any>;
  assert.equal(m2.status, 'stopped');
  assert.equal(m2.medicationCodeableConcept.coding, undefined);
  assert.equal(m2.medicationCodeableConcept.text, 'Hydroxyzine');
  assert.equal(m2.dosage[0].asNeededCodeableConcept.text, 'anxiety');
});

test('AllergyIntolerance: reaction + severity, NKA as SNOMED 716186003, no client -> not mapped', () => {
  const snap = snapshot();
  const a = mapAllergyIntolerance(snap.allergies[0]!, ctx) as Record<string, any>;
  assert.equal(a.patient.reference, 'Patient/clienta');
  assert.equal(a.reaction[0].manifestation[0].text, 'Hives');
  assert.equal(a.reaction[0].severity, 'severe');
  assert.equal(a.criticality, 'high');
  const nka = mapAllergyIntolerance(snap.allergies[1]!, ctx) as Record<string, any>;
  assert.equal(nka.code.coding[0].code, '716186003');
  assert.equal(mapAllergyIntolerance(snap.allergies[2]!, ctx), null);
});

test('Encounter: appointment status/class mapping', () => {
  const snap = snapshot();
  const e1 = mapAppointmentEncounter(snap.appointments[0]!, ctx) as Record<string, any>;
  assert.equal(e1.id, 'appt-appt_1'.replace('_', '-'));
  assert.equal(e1.status, 'finished');
  assert.equal(e1.class.code, 'VR');
  assert.equal(e1.participant[0].individual.reference, 'Practitioner/userclin');
  const e2 = mapAppointmentEncounter(snap.appointments[1]!, ctx) as Record<string, any>;
  assert.equal(e2.status, 'cancelled');
  assert.equal(e2.class.code, 'AMB');
});

test('DocumentReference: signed text + addenda as base64, LOINC 11506-3, drafts never', () => {
  const snap = snapshot();
  const doc = mapProgressNoteDocument(snap.notes[0]!, ctx) as Record<string, any>;
  assert.equal(doc.type.coding[0].system, 'http://loinc.org');
  assert.equal(doc.type.coding[0].code, '11506-3');
  assert.equal(doc.docStatus, 'amended');
  const text = Buffer.from(doc.content[0].attachment.data, 'base64').toString('utf8');
  assert.ok(text.startsWith('S: doing better'), 'uses the signed snapshot, not the mutable body');
  assert.ok(text.includes('Phone call follow-up.'));
  assert.equal(mapProgressNoteDocument(snap.notes[1]!, ctx), null);
});

test('Observation: PHQ-9 / GAD-7 total-score LOINC; unmapped or out-of-range not sent', () => {
  const snap = snapshot();
  const phq = mapAssessmentObservation(snap.assessments[0]!, ctx) as Record<string, any>;
  assert.equal(phq.code.coding[0].code, '44261-6');
  assert.equal(phq.valueQuantity.value, 14);
  assert.equal(phq.category[0].coding[0].code, 'survey');
  const gad = mapAssessmentObservation(snap.assessments[1]!, ctx) as Record<string, any>;
  assert.equal(gad.code.coding[0].code, '70274-6');
  assert.equal(mapAssessmentObservation(snap.assessments[2]!, ctx), null);
  assert.equal(mapAssessmentObservation(snap.assessments[3]!, ctx), null);
});

// ─── Whole-org build + Part 2 ────────────────────────────────────────────────

test('build: stable ids and hashes across runs; references only to known staff', () => {
  const a = buildOrgResources(snapshot(), OFF);
  const b = buildOrgResources(snapshot(), OFF);
  assert.deepEqual(a.resources.map((r) => `${r.resourceType}/${r.resourceId}:${r.hash}`), b.resources.map((r) => `${r.resourceType}/${r.resourceId}:${r.hash}`));
  const keys = a.resources.map((r) => outboxKey(r.resourceType, r.resourceId));
  assert.equal(new Set(keys).size, keys.length, 'no duplicate resource keys');
  for (const r of a.resources) assert.ok(isValidFhirId(r.resourceId), r.resourceId);
  // order: Organization first, references before dependents
  assert.equal(a.resources[0]!.resourceType, 'Organization');
  // med_2 prescriber is not a staff user -> no dangling Practitioner reference
  const m2 = find(a.resources, 'MedicationStatement', 'med-med_2'.replace('_', '-')) as Record<string, any>;
  assert.equal(m2.informationSource, undefined);
  const gad = find(a.resources, 'Observation', fhirId('asmt', 'asmt_gad7')) as Record<string, any>;
  assert.equal(gad.performer, undefined);
  // Practitioners: clinicians + referenced; billing user not referenced -> not sent
  const practitioners = a.resources.filter((r) => r.resourceType === 'Practitioner').map((r) => r.resourceId).sort();
  assert.deepEqual(practitioners, ['userbadnpi', 'userclin']);
  // GAD-7 duplicate code from client list is not duplicated (on problem list as F41.1)
  const conditions = a.resources.filter((r) => r.resourceType === 'Condition' && r.clientId === 'clienta').map((r) => r.resourceId);
  assert.ok(!conditions.includes(fhirId('dx', 'clienta', 'F41.1')));
  assert.ok(conditions.includes(fhirId('dx', 'clienta', 'F33.1')));
  assert.ok(conditions.includes(fhirId('mp', 'mp_1')));
  // drafts never
  assert.equal(find(a.resources, 'DocumentReference', fhirId('note', 'note_draft')), undefined);
  assert.ok(find(a.resources, 'DocumentReference', fhirId('note', 'note_signed')));
});

test('Part 2 default OFF: Part 2 client fully excluded, SUD content held back, SUD visit codes dropped', () => {
  const { resources, excluded } = buildOrgResources(snapshot(), OFF);
  assert.equal(resources.filter((r) => r.clientId === 'clientp2').length, 0, 'nothing about the Part 2 client');
  assert.equal(find(resources, 'Patient', 'clientp2'), undefined);
  assert.equal(find(resources, 'Condition', fhirId('dx', 'clienta', 'F10.20')), undefined, 'SUD diagnosis held back');
  assert.equal(find(resources, 'MedicationStatement', fhirId('med', 'med_bup')), undefined, 'SUD medication held back');
  const mv = find(resources, 'Encounter', fhirId('mv', 'mv_1')) as Record<string, any>;
  assert.deepEqual(mv.reasonCode.map((c: any) => c.coding[0].code), ['E11.9']);
  assert.equal(mv.meta.security, undefined);
  assert.ok(excluded.part2_client >= 1 && excluded.part2_content >= 2 && excluded.part2_reason_codes_dropped === 1);
  // legacy part2="true" comment on a signed note is what made clientp2 a Part 2 client
  assert.ok(codings(find(resources, 'Patient', 'clienta'), 'meta').includes(ORG));
});

test('Part 2 explicitly ON: content sent with 42CFRPart2 + NORDSCLCD + R', () => {
  const { resources } = buildOrgResources(snapshot(), ON);
  const p2 = find(resources, 'Patient', 'clientp2') as Record<string, any>;
  const codes = (r: Record<string, any>) => (r.meta.security ?? []).map((s: any) => s.code).sort();
  assert.deepEqual(codes(p2), ['42CFRPart2', 'NORDSCLCD', 'R']);
  const note = find(resources, 'DocumentReference', fhirId('note', 'note_p2')) as Record<string, any>;
  assert.deepEqual(codes(note), ['42CFRPart2', 'NORDSCLCD', 'R']);
  const sud = find(resources, 'Condition', fhirId('dx', 'clienta', 'F10.20')) as Record<string, any>;
  assert.deepEqual(codes(sud), ['42CFRPart2', 'NORDSCLCD', 'R']);
  const gad = find(resources, 'Condition', fhirId('dx', 'clienta', 'F33.1')) as Record<string, any>;
  assert.equal(gad.meta.security, undefined, 'non-SUD content of a non-Part 2 client is unlabeled');
  const mv = find(resources, 'Encounter', fhirId('mv', 'mv_1')) as Record<string, any>;
  assert.equal(mv.reasonCode.length, 2);
  assert.deepEqual(codes(mv), ['42CFRPart2', 'NORDSCLCD', 'R']);
});

test('SensitiveRecord client: synced, every resource labeled restricted', () => {
  const { resources } = buildOrgResources(snapshot(), OFF);
  const vip = find(resources, 'Patient', 'clientvip') as Record<string, any>;
  assert.deepEqual(vip.meta.security.map((s: any) => `${s.system}#${s.code}`), ['http://terminology.hl7.org/CodeSystem/v3-Confidentiality#R']);
  // classification naming Part 2 makes the client a Part 2 client
  const snap = snapshot();
  snap.clients[2]!.sensitiveRecord = { noteClassification: '42 CFR Part 2' };
  assert.equal(find(buildOrgResources(snap, OFF).resources, 'Patient', 'clientvip'), undefined);
});

test('NDJSON export groups one resource per line', async () => {
  const { toNdjsonByType } = await import('../src/lib/fhir/mapping/build');
  const { resources } = buildOrgResources(snapshot(), OFF);
  const files = toNdjsonByType(resources);
  const patients = files.get('Patient')!.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(patients.map((p) => p.id).sort(), ['clienta', 'clientvip']);
});

// ─── Outbox ──────────────────────────────────────────────────────────────────

function rowsFromPlan(plan: ReturnType<typeof planOutbox>, existing: OutboxRow[] = []): OutboxRow[] {
  let n = existing.length;
  return [...applyUpdates(existing, plan.updates), ...plan.creates.map((c) => ({ ...c, id: `row_${++n}` }))];
}

test('outbox: new -> PENDING, unchanged after sync, hash change re-queues, removal -> DELETE', async () => {
  const built = buildOrgResources(snapshot(), OFF).resources;
  const p1 = planOutbox(ORG, [], built);
  assert.equal(p1.creates.length, built.length);
  assert.equal(p1.queuedUpserts, built.length);
  let rows = rowsFromPlan(p1);
  assert.ok(rows.every((r) => r.status === 'PENDING' && r.operation === 'UPSERT'));

  // all synced
  rows = rows.map((r) => ({ ...r, status: 'SYNCED', syncedHash: r.hash }));
  const p2 = planOutbox(ORG, rows, built);
  assert.equal(p2.creates.length + p2.updates.length, 0);
  assert.equal(p2.unchanged, built.length);

  // change one client's phone -> only that Patient re-queued
  const snap = snapshot();
  snap.clients[0]!.phone = '410-555-0199';
  const p3 = planOutbox(ORG, rows, buildOrgResources(snap, OFF).resources);
  assert.equal(p3.updates.length, 1);
  assert.equal(rows.find((r) => r.id === p3.updates[0]!.id)!.resourceId, 'clienta');
  assert.equal(p3.updates[0]!.data.status, 'PENDING');

  // turning Part 2 OFF after it was ON deletes the now-excluded resources
  const onBuilt = buildOrgResources(snapshot(), ON).resources;
  const onRows = rowsFromPlan(planOutbox(ORG, [], onBuilt)).map((r) => ({ ...r, status: 'SYNCED', syncedHash: r.hash }));
  const p4 = planOutbox(ORG, onRows, built);
  const deleted = p4.updates.filter((u) => u.data.operation === 'DELETE').map((u) => onRows.find((r) => r.id === u.id)!);
  assert.ok(deleted.some((r) => r.resourceType === 'Patient' && r.resourceId === 'clientp2'));
  assert.ok(deleted.some((r) => r.resourceId === fhirId('dx', 'clienta', 'F10.20')));
  assert.ok(p4.updates.filter((u) => u.data.operation === 'DELETE').every((u) => u.data.status === 'PENDING'));

  // never-synced rows that disappear are closed without a remote call
  const pending = rowsFromPlan(planOutbox(ORG, [], onBuilt));
  const p5 = planOutbox(ORG, pending, built);
  assert.ok(p5.updates.filter((u) => u.data.operation === 'DELETE').every((u) => u.data.status === 'DELETED'));
  assert.equal(p5.queuedDeletes, 0);

  // rows of another org are never touched
  const foreign = { ...rows[0]!, id: 'foreign', organizationId: 'orgbeta' };
  const p6 = planOutbox(ORG, [...rows, foreign], built);
  assert.ok(!p6.updates.some((u) => u.id === 'foreign'));
});

test('outbox worker: PUT success, retry + backoff, DEAD after max, 401 aborts, DELETE 404 ok', async () => {
  const built = buildOrgResources(snapshot(), OFF).resources.slice(0, 4);
  const resources = new Map(built.map((r) => [outboxKey(r.resourceType, r.resourceId), r]));
  const now = new Date('2026-10-17T00:00:00Z');
  let rows = rowsFromPlan(planOutbox(ORG, [], built));
  rows.push({ ...rows[0]!, id: 'del_1', resourceType: 'Condition', resourceId: 'gone', operation: 'DELETE', status: 'PENDING', syncedHash: 'h' });

  const calls: string[] = [];
  let failFirst = 2;
  const transport = {
    put: async (r: { resourceType: string; id: string }) => {
      calls.push(`PUT ${r.resourceType}/${r.id}`);
      if (r.resourceType === 'Location' && failFirst-- > 0) return { ok: false as const, status: 503, error: 'HTTP 503', retryable: true };
      if (r.resourceType === 'Practitioner') return { ok: false as const, status: 400, error: 'HTTP 400 invalid', retryable: false };
      return { ok: true as const, status: 200, versionId: '1' };
    },
    delete: async (t: string, id: string) => {
      calls.push(`DELETE ${t}/${id}`);
      return { ok: true as const, status: 404 };
    },
  };
  const due = selectDue(rows, now);
  assert.equal(due.at(-1)!.operation, 'DELETE', 'deletes run after upserts');
  const res = await processOutbox({ rows: due, resources, transport, now, sleep: async () => {} });
  assert.equal(res.deleted, 1);
  assert.ok(res.synced >= 2);
  assert.ok(calls.filter((c) => c.startsWith('PUT Location')).length === 3, 'inline retries for 503');
  rows = applyUpdates(rows, res.updates);
  const prac = rows.find((r) => r.resourceType === 'Practitioner')!;
  assert.equal(prac.status, 'ERROR');
  assert.equal(prac.attempts, 1);
  assert.equal(prac.nextAttemptAt!.getTime(), now.getTime() + backoffMs(1));
  const synced = rows.find((r) => r.resourceType === 'Organization')!;
  assert.equal(synced.status, 'SYNCED');
  assert.equal(synced.syncedHash, synced.hash);
  assert.equal(rows.find((r) => r.id === 'del_1')!.status, 'DELETED');

  // not due yet -> skipped
  assert.ok(!selectDue(rows, now).some((r) => r.id === prac.id));
  // dead after max attempts
  const nearDead = [{ ...prac, attempts: 7, nextAttemptAt: null }];
  const dead = await processOutbox({ rows: nearDead, resources, transport, now, sleep: async () => {} });
  assert.equal(dead.dead, 1);
  assert.equal(dead.updates[0]!.data.status, 'DEAD');

  // 401: run aborts, attempts not burned
  const denied = { put: async () => ({ ok: false as const, status: 403, error: 'HTTP 403 AccessDenied', retryable: false }), delete: transport.delete };
  const pend = rowsFromPlan(planOutbox(ORG, [], built));
  const ab = await processOutbox({ rows: selectDue(pend, now), resources, transport: denied, now, sleep: async () => {} });
  assert.ok(ab.aborted);
  assert.equal(ab.updates.length, 1);
  assert.equal(ab.updates[0]!.data.attempts, undefined);
  assert.equal(backoffMs(20), 6 * 60 * 60 * 1000);
});

// ─── Search scoping ──────────────────────────────────────────────────────────

test('search: org tag forced, caller _tag rejected, foreign entries dropped, links rewritten', () => {
  const q = buildScopedSearch(ORG, new URLSearchParams('patient=clienta&_count=500'));
  assert.ok(q.ok);
  if (q.ok) {
    assert.equal(q.params.get('_tag'), `urn:altrixs:organization|${ORG}`);
    assert.equal(q.params.get('_count'), '100');
  }
  assert.equal(buildScopedSearch(ORG, new URLSearchParams('_tag=urn:altrixs:organization|orgbeta')).ok, false);
  assert.equal(buildScopedSearch(ORG, new URLSearchParams('_has:Observation:patient:code=x')).ok, false);

  const tag = (org: string) => ({ meta: { tag: [{ system: 'urn:altrixs:organization', code: org }] } });
  const { bundle, dropped } = scopeBundle(
    {
      resourceType: 'Bundle',
      total: 2,
      link: [{ relation: 'next', url: `https://healthlake.us-east-1.amazonaws.com/datastore/abc/r4/Patient?_count=20&page=tok&_tag=urn:altrixs:organization|${ORG}` }],
      entry: [
        { fullUrl: 'https://healthlake/x/Patient/a', resource: { resourceType: 'Patient', id: 'a', ...tag(ORG) } },
        { resource: { resourceType: 'Patient', id: 'b', ...tag('orgbeta') } },
        { resource: { resourceType: 'Patient', id: 'c' } },
      ],
    },
    ORG,
    '/api/healthlake/fhir/Patient'
  );
  assert.equal(dropped, 2);
  assert.deepEqual(bundle.entry!.map((e) => e.resource!.id), ['a']);
  assert.equal(bundle.entry![0]!.fullUrl, 'Patient/a');
  assert.equal(bundle.total, undefined, 'total withheld when entries were dropped');
  assert.equal(bundle.link![0]!.url, '/api/healthlake/fhir/Patient?_count=20&page=tok');
});

// ─── Config / transport / signing ────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const out = fn();
  if (out instanceof Promise) return out.finally(restore);
  restore();
  return out;
}

const NO_AWS = {
  AWS_HEALTHLAKE_DATASTORE_ID: undefined,
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  AWS_LIVE: undefined,
  AWS_HEALTHLAKE_DATA_ACCESS_ROLE_ARN: undefined,
  AWS_HEALTHLAKE_ROLE_ARN: undefined,
  AWS_HEALTHLAKE_KMS_KEY_ARN: undefined,
  AWS_HEALTHLAKE_IMPORT_S3_URI: undefined,
  AWS_HEALTHLAKE_EXPORT_S3_URI: undefined,
};
const DS = '0123456789abcdef0123456789abcdef';

test('config: not configured without data store; instance role counts as credentials', () => {
  withEnv(NO_AWS, () => {
    const cfg = healthLakeConfig();
    assert.equal(cfg.configured, false);
    assert.ok(cfg.missing.includes('AWS_HEALTHLAKE_DATASTORE_ID'));
    assert.equal(createHealthLakeTransport(cfg), null);
  });
  withEnv({ ...NO_AWS, AWS_HEALTHLAKE_DATASTORE_ID: DS }, () => {
    const cfg = healthLakeConfig();
    assert.equal(cfg.configured, false, 'data store id without credentials is not enough');
    assert.equal(cfg.credentialMode, 'none');
  });
  withEnv({ ...NO_AWS, AWS_HEALTHLAKE_DATASTORE_ID: DS, AWS_LIVE: 'true' }, () => {
    const cfg = healthLakeConfig();
    assert.equal(cfg.configured, true);
    assert.equal(cfg.credentialMode, 'instance-role');
    assert.equal(cfg.import.ready, false);
  });
  withEnv({ ...NO_AWS, AWS_HEALTHLAKE_DATASTORE_ID: 'not-an-id', AWS_LIVE: 'true' }, () => {
    assert.equal(healthLakeConfig().configured, false);
  });
});

test('transport (fake fetch, fake credentials): signed PUT / DELETE / search URLs', async () => {
  await withEnv({ ...NO_AWS, AWS_HEALTHLAKE_DATASTORE_ID: DS, AWS_LIVE: 'true', AWS_HEALTHLAKE_REGION: 'us-east-1' }, async () => {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as string | undefined });
      if (init.method === 'DELETE') return new Response('', { status: 404 });
      if (init.method === 'GET') return new Response(JSON.stringify({ resourceType: 'Bundle', entry: [] }), { status: 200 });
      return new Response(JSON.stringify({ resourceType: 'Patient', id: 'clienta', meta: { versionId: '3' } }), { status: 201 });
    }) as unknown as typeof fetch;
    const t = createHealthLakeTransport(healthLakeConfig(), {
      fetchImpl,
      credentials: async () => ({ region: 'us-east-1', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'tok' }),
    })!;
    const put = await t.put({ resourceType: 'Patient', id: 'clienta' });
    assert.deepEqual(put, { ok: true, status: 201, versionId: '3' });
    assert.equal(seen[0]!.url, `https://healthlake.us-east-1.amazonaws.com/datastore/${DS}/r4/Patient/clienta`);
    assert.equal(seen[0]!.method, 'PUT');
    assert.match(seen[0]!.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/healthlake\/aws4_request/);
    assert.equal(seen[0]!.headers['x-amz-security-token'], 'tok');
    assert.equal(seen[0]!.headers['content-type'], 'application/fhir+json');
    assert.deepEqual(await t.delete('Condition', 'gone'), { ok: true, status: 404 });
    const s = await t.search('Patient', new URLSearchParams({ _tag: 'urn:altrixs:organization|orgalpha', _count: '5' }));
    assert.ok(s.ok);
    assert.equal(seen[2]!.url, `https://healthlake.us-east-1.amazonaws.com/datastore/${DS}/r4/Patient?_count=5&_tag=urn%3Aaltrixs%3Aorganization%7Corgalpha`);
  });
});

test('SigV4 canonical encoding is strict RFC 3986', () => {
  assert.equal(rfc3986("a!b'c(d)e*f g"), 'a%21b%27c%28d%29e%2Af%20g');
  assert.equal(canonicalQueryString(new URLSearchParams('b=2&a=1&a=0')), 'a=0&a=1&b=2');
  assert.equal(canonicalUri('/datastore/x/r4/Patient/a-b.c'), '/datastore/x/r4/Patient/a-b.c');
  assert.equal(canonicalUri('/r4/%24export'), '/r4/%2524export');
});

test('settings: only literal true turns sync or Part 2 on', () => {
  assert.deepEqual(
    { ...parseSyncSettings({ enabled: 'true', allowPart2Sync: 1 }) },
    { enabled: false, allowPart2Sync: false, updatedAt: null, updatedById: null, part2EnabledAt: null, part2EnabledById: null }
  );
  assert.equal(parseSyncSettings(null).allowPart2Sync, false);
  assert.equal(parseSyncSettings({ enabled: true, allowPart2Sync: true }).allowPart2Sync, true);
});
