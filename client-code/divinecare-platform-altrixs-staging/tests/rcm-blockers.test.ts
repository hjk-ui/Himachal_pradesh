/**
 * Revenue-cycle blockers (audit at a91e3c1): B1-B8, H1, H6, H7.
 * All data is synthetic; NPIs are check-digit-valid test numbers, not real providers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import {
  claimToBatchClaim,
  payerPolicyDefaults,
  type BillingProviderConfig,
  type ClaimForMapping,
  type MapperContext,
  type PayerMappingConfig,
  type StaffForClaim,
} from '../src/lib/billing/waystarSftpClaims';
import { generate837P } from '../src/lib/services/waystarSftpService';
import {
  codingEditFindings,
  cosignPending,
  crisisAddOnUnits,
  matchNoteToAppointment,
  noteClaimFindings,
  notePracticeDate,
  prpClaimBlock,
  prpIrpProblem,
  isTaxonomyCode,
} from '../src/lib/billing/claimRules';
import { extractNoteCpt } from '../src/lib/billing/noteCoding';
import { noteRequiresTreatmentPlan } from '../src/lib/ehr/therapy/rules';

const CLINICIAN_NPI = '1111111112';
const SUPERVISOR_NPI = '1234567893';
const SITE_NPI = '1801621297';
const TAX_CLINIC = '261QM0801X';
const TAX_COUNSELOR = '101YP2500X';

const PROVIDER: BillingProviderConfig = {
  npi: '1346021813', name: 'TEST BEHAVIORAL HEALTH LLC', taxId: '923843658',
  address1: '4000 TEST RD', address2: 'STE 1', city: 'BOWIE', state: 'MD', zip: '207163104', phone: '3015550100',
  departments: [], clinicianRoles: [], locationKeys: [], isDefault: true, active: true, taxonomyCode: TAX_CLINIC,
};

const MAP = (over: Partial<PayerMappingConfig>): PayerMappingConfig => ({
  payerName: 'Maryland Medicaid', aliases: [], waystarPayerId: 'TESTMCD', claimFilingCode: 'MC',
  telehealthModifier: '95', requiresPriorAuth: false, verified: true, active: true, ...over,
});
const MEDICAID = MAP({});
const MEDICARE = MAP({ payerName: 'Medicare Part B', waystarPayerId: 'TESTMCR', claimFilingCode: 'MB' });
const COMMERCIAL = MAP({ payerName: 'Test Commercial', waystarPayerId: 'TESTCOM', claimFilingCode: 'CI' });

const CTX: MapperContext = { billingProviders: [PROVIDER], payerMappings: [MEDICAID, MEDICARE, COMMERCIAL], usageIndicator: 'T', timeZone: 'America/New_York' };

const SUPERVISOR: StaffForClaim = { userId: 'sup-1', npi: SUPERVISOR_NPI, legalFirstName: 'Pat', legalLastName: 'Supervisor', taxonomyCode: TAX_COUNSELOR, preLicensed: false };
const CLINICIAN: StaffForClaim = { userId: 'clin-1', npi: CLINICIAN_NPI, legalFirstName: 'Samuel', legalLastName: 'Clinician-Jones', taxonomyCode: TAX_COUNSELOR, preLicensed: false, supervisor: null };

const NOTE = {
  id: 'note-1',
  clinicianId: 'clin-1',
  dateOfService: new Date('2026-10-14T00:00:00.000Z'),
  cptCode: '90837',
  durationMinutes: 55,
  appointmentId: 'appt-1',
  workflow: { status: 'LOCKED', cosignRequired: false, cosignedAt: null as Date | null },
};

function claim(over: Partial<ClaimForMapping> = {}): ClaimForMapping {
  return {
    id: 'claim-1',
    claimControlNumber: 'AXTEST0000000001',
    status: 'READY',
    cptCode: '90837',
    units: 1,
    amountCents: 18000,
    payer: 'Maryland Medicaid',
    icd10Codes: ['F33.1'],
    placeOfService: '11',
    renderingNpi: null,
    billingNpi: null,
    submissionData: { diagnosisCodes: ['F33.1'] },
    noteStatus: 'LOCKED',
    client: {
      name: 'Display Name Only', legalFirstName: 'Jane', legalLastName: 'Testpatient', middleInitial: null,
      dateOfBirth: new Date('1990-04-02T00:00:00.000Z'), gender: 'F', addressLine1: '1 Test St', city: 'Bowie', state: 'MD',
      postalCode: '20715', insurancePayer: 'Maryland Medicaid', insuranceMemberId: 'MA123456789',
    },
    // 9pm Eastern Oct 14 (Oct 15 UTC): same practice date as the note
    appointment: { id: 'appt-1', clinicianId: 'clin-1', startsAt: new Date('2026-10-15T01:00:00.000Z'), clinician: { name: 'Dr. Display Name, LCSW-C', npi: '1740059005' } },
    note: NOTE,
    renderingClinician: CLINICIAN,
    serviceLines: [],
    ...over,
  };
}

function mapped(c: ClaimForMapping, ctx: MapperContext = CTX) {
  const r = claimToBatchClaim(c, ctx);
  if (!('claim' in r)) assert.fail(`expected to map:\n${'errors' in r ? r.errors.join('\n') : ''}`);
  return r;
}
function errorsOf(c: ClaimForMapping, ctx: MapperContext = CTX) {
  const r = claimToBatchClaim(c, ctx);
  assert.equal(r.ok, false, 'expected errors');
  return 'errors' in r ? r.errors.join('\n') : '';
}
function segs(content: string) {
  return content.split('~\n').map((x) => x.replace(/~$/, ''));
}

// ─── B1: DOS / rendering from the note; appointment only cross-checks ───────

test('B1: DOS is the note practice date and rendering is the note clinician, not the appointment clinician', () => {
  const r = mapped(claim());
  assert.equal(r.claim.lines[0].serviceDate, '2026-10-14');
  assert.equal(r.claim.renderingNpi, CLINICIAN_NPI);
  // An appointment-less note claim still has its DOS
  assert.equal(mapped(claim({ appointment: null })).claim.lines[0].serviceDate, '2026-10-14');
  assert.equal(notePracticeDate(new Date('2026-10-14T00:00:00.000Z')), '2026-10-14');
});

test('B1: scrubber/mapper ERROR when the linked appointment has another clinician or another practice date', () => {
  const otherClin = errorsOf(claim({ appointment: { ...claim().appointment!, clinicianId: 'someone-else' } }));
  assert.match(otherClin, /different clinician than the linked appointment/);
  const otherDay = errorsOf(claim({ appointment: { ...claim().appointment!, startsAt: new Date('2026-10-16T14:00:00.000Z') } }));
  assert.match(otherDay, /\(2026-10-14\) differs from the linked appointment's practice date \(2026-10-16\)/);
  const f = noteClaimFindings(NOTE, { id: 'a', clinicianId: 'x', startsAt: new Date('2026-10-14T15:00:00Z') });
  assert.deepEqual(f.map((x) => x.code), ['APPT_CLINICIAN_MISMATCH']);
});

test('B1: backfill links a note only when exactly one same-client, same-clinician, same-practice-date appointment exists', () => {
  const base = { clientId: 'c1', clinicianId: 'clin-1', status: 'COMPLETED' };
  const one = [{ ...base, id: 'a1', startsAt: new Date('2026-10-15T01:00:00Z') }];
  assert.deepEqual(matchNoteToAppointment({ clientId: 'c1', clinicianId: 'clin-1', dateOfService: NOTE.dateOfService }, one), { appointmentId: 'a1', reason: 'matched' });
  const two = [...one, { ...base, id: 'a2', startsAt: new Date('2026-10-14T14:00:00Z') }];
  assert.equal(matchNoteToAppointment({ clientId: 'c1', clinicianId: 'clin-1', dateOfService: NOTE.dateOfService }, two).reason, 'ambiguous');
  const otherClin = [{ ...one[0], clinicianId: 'clin-2' }];
  assert.equal(matchNoteToAppointment({ clientId: 'c1', clinicianId: 'clin-1', dateOfService: NOTE.dateOfService }, otherClin).reason, 'none');
  const cancelled = [{ ...one[0], status: 'CANCELLED' }];
  assert.equal(matchNoteToAppointment({ clientId: 'c1', clinicianId: 'clin-1', dateOfService: NOTE.dateOfService }, cancelled).reason, 'none');
  assert.equal(matchNoteToAppointment({ clientId: 'c1', clinicianId: 'clin-1', dateOfService: null }, one).reason, 'no-dos');
});

// ─── B2: co-sign pending is not billable ─────────────────────────────────────

test('B2: co-sign pending blocks the 837; co-signed note is billable', () => {
  const pending = { ...NOTE, workflow: { status: 'LOCKED', cosignRequired: true, cosignedAt: null } };
  assert.equal(cosignPending(pending.workflow), true);
  assert.match(errorsOf(claim({ note: pending })), /co-signature is pending/);
  const signed = { ...NOTE, workflow: { status: 'LOCKED', cosignRequired: true, cosignedAt: new Date() } };
  assert.equal(mapped(claim({ note: signed })).ok, true);
});

// ─── B3: supervising provider ───────────────────────────────────────────────

const SUPERVISEE: StaffForClaim = { ...CLINICIAN, preLicensed: true, supervisor: SUPERVISOR };

test('B3: pre-licensed clinician -> 2310D NM1*DQ with the supervisor (default supervisee_with_2310D)', () => {
  const r = mapped(claim({ renderingClinician: SUPERVISEE }));
  assert.deepEqual(r.claim.supervisingProvider, { npi: SUPERVISOR_NPI, lastName: 'Supervisor', firstName: 'Pat' });
  const s = segs(generate837P([r.claim], 7).content);
  const nm82 = s.findIndex((x) => x.startsWith('NM1*82*'));
  const dq = s.findIndex((x) => x.startsWith('NM1*DQ*'));
  assert.equal(s[dq], `NM1*DQ*1*SUPERVISOR*PAT****XX*${SUPERVISOR_NPI}`);
  assert.ok(dq > nm82, '2310D follows 2310B');
  assert.ok(dq < s.findIndex((x) => x.startsWith('LX*')));
});

test('B3: Medicare defaults to not_allowed; render_as_supervisor bills the supervisor; missing supervisor blocks', () => {
  assert.equal(payerPolicyDefaults('MB').superviseeClaims, 'not_allowed');
  assert.equal(payerPolicyDefaults('MC').superviseeClaims, 'supervisee_with_2310D');
  assert.match(errorsOf(claim({ payer: 'Medicare Part B', renderingClinician: SUPERVISEE })), /does not accept claims rendered by a pre-licensed clinician/);
  const asSup = mapped(claim({ renderingClinician: SUPERVISEE }), { ...CTX, payerMappings: [MAP({ superviseeClaims: 'render_as_supervisor' })] });
  assert.equal(asSup.claim.renderingNpi, SUPERVISOR_NPI);
  assert.equal(asSup.claim.supervisingProvider, undefined);
  assert.match(errorsOf(claim({ renderingClinician: { ...SUPERVISEE, supervisor: null } })), /no supervisor on a supervision track/);
  assert.match(errorsOf(claim({ renderingClinician: { ...SUPERVISEE, supervisor: { ...SUPERVISOR, legalLastName: null } } })), /Supervising provider .*legal first and last name/);
});

// ─── B4: taxonomy ────────────────────────────────────────────────────────────

test('B4: PRV*BI in 2000A and PRV*PE in 2310B; missing taxonomy is an error for Medicaid, warning otherwise', () => {
  const r = mapped(claim());
  const s = segs(generate837P([r.claim], 8).content);
  assert.equal(s[s.indexOf('HL*1**20*1') + 1], `PRV*BI*PXC*${TAX_CLINIC}`);
  assert.equal(s[s.findIndex((x) => x.startsWith('NM1*82*')) + 1], `PRV*PE*PXC*${TAX_COUNSELOR}`);
  const noTax = { ...CLINICIAN, taxonomyCode: null };
  assert.match(errorsOf(claim({ renderingClinician: noTax })), /Rendering provider taxonomy \(PRV\*PE\) is missing.*required by Maryland Medicaid/);
  const com = mapped(claim({ payer: 'Test Commercial', renderingClinician: noTax }));
  assert.match(com.warnings.join(' '), /Rendering provider taxonomy \(PRV\*PE\) is missing/);
  assert.ok(!segs(generate837P([com.claim], 9).content).some((x) => x.startsWith('PRV*PE')));
  // Practice settings taxonomy is the 2000A fallback
  const fallback = mapped(claim(), { ...CTX, billingProviders: [{ ...PROVIDER, taxonomyCode: null }], billingTaxonomy: '261QM0801X' });
  assert.equal(fallback.claim.billingTaxonomy, '261QM0801X');
  assert.equal(isTaxonomyCode('101YP2500X'), true);
  assert.equal(isTaxonomyCode('LCSW'), false);
});

// ─── B5: 2310C service facility ─────────────────────────────────────────────

const SITE = { name: 'Silver Spring Office', addressLine1: '8630 Test Ave', addressLine2: 'Suite 2', city: 'Silver Spring', state: 'MD', postalCode: '209101234', npi: SITE_NPI, npiVerified: true };

test('B5: 2310C NM1*77 + N3/N4 (ZIP+4) when the site differs from 2010AA; verified site NPI only', () => {
  const r = mapped(claim(), { ...CTX, serviceLocation: SITE });
  const s = segs(generate837P([r.claim], 10).content);
  const i = s.findIndex((x) => x.startsWith('NM1*77*'));
  assert.deepEqual(s.slice(i, i + 3), [`NM1*77*2*SILVER SPRING OFFICE*****XX*${SITE_NPI}`, 'N3*8630 TEST AVE*SUITE 2', 'N4*SILVER SPRING*MD*209101234']);
  assert.ok(i > s.findIndex((x) => x.startsWith('NM1*82*')));
  // Unverified, placeholder (cleared seed) NPIs are never sent
  const unverified = mapped(claim(), { ...CTX, serviceLocation: { ...SITE, npiVerified: false } }).claim.serviceFacility;
  assert.equal(unverified?.npi, undefined);
  const placeholder = mapped(claim(), { ...CTX, serviceLocation: { ...SITE, npi: '1457893212', npiVerified: true } }).claim.serviceFacility;
  assert.equal(placeholder?.npi, undefined);
  assert.ok(segs(generate837P([mapped(claim(), { ...CTX, serviceLocation: { ...SITE, npiVerified: false } }).claim], 11).content).includes('NM1*77*2*SILVER SPRING OFFICE'));
});

test('B5: no 2310C at the billing address or for telehealth; missing / incomplete location address is an error', () => {
  const same = mapped(claim(), { ...CTX, serviceLocation: { ...SITE, addressLine1: '4000 Test Rd.', postalCode: '20716' } });
  assert.equal(same.claim.serviceFacility, undefined);
  assert.match(errorsOf(claim(), { ...CTX, serviceLocation: null }), /Service location is missing/);
  assert.match(errorsOf(claim(), { ...CTX, serviceLocation: { ...SITE, addressLine1: null } }), /address is incomplete/);
  const tele = mapped(claim({ placeOfService: '10', note: { ...NOTE, telehealth: true } }), { ...CTX, serviceLocation: null });
  assert.equal(tele.claim.serviceFacility, undefined);
});

// ─── B6: no CPT guesses; PRP blocked ─────────────────────────────────────────

test('B6: no CPT is scraped from note text or guessed from the visit type', () => {
  assert.equal(extractNoteCpt('Client seen for 90837 today'), null);
  assert.equal(extractNoteCpt('PRP group attendance'), null);
  const f = noteClaimFindings({ ...NOTE, cptCode: null }, null);
  assert.ok(f.some((x) => x.code === 'NOTE_CPT_MISSING' && /No CPT on the signed note/.test(x.message)));
});

test('B6/B8: PRP claims follow the confirmed PRP billing model (held until confirmed); IRP must be current', () => {
  // no confirmed model: held
  assert.match(prpClaimBlock(['H2017']) ?? '', /PRP billing model not confirmed/);
  assert.ok(prpClaimBlock(['H2016-U3']));
  assert.ok(prpClaimBlock(['H2017HK'], null));
  assert.equal(prpClaimBlock(['90837']), null);
  // per-encounter H2017
  assert.equal(prpClaimBlock(['H2017'], 'per_encounter_h2017'), null);
  assert.match(prpClaimBlock(['H2018', 'H2016'], 'per_encounter_h2017') ?? '', /per encounter \(H2017\)/);
  // monthly case rate
  assert.equal(prpClaimBlock(['H2018', 'H2016'], 'monthly_case_rate_h2018_h2016'), null);
  assert.match(prpClaimBlock(['H2017'], 'monthly_case_rate_h2018_h2016') ?? '', /monthly case rate/);
  assert.match(errorsOf(claim({ cptCode: 'H2017', note: { ...NOTE, cptCode: 'H2017', durationMinutes: 60 } })), /PRP billing model not confirmed/);
  assert.match(prpIrpProblem(null, '2026-10-14') ?? '', /finalized Individual Rehabilitation Plan/);
  assert.match(prpIrpProblem({ stage: 'irp', irpEffectiveDate: new Date('2026-01-01'), irpReviewDueDate: new Date('2026-07-01') }, '2026-10-14') ?? '', /review was due 2026-07-01/);
  assert.equal(prpIrpProblem({ stage: 'irp', irpEffectiveDate: new Date('2026-09-01'), irpReviewDueDate: new Date('2027-03-01') }, '2026-10-14'), null);
});

test('B8: group psychotherapy and case management need a treatment plan', () => {
  for (const code of ['90853', 'T1016', 'T1017', 'T1016-HO', '90837']) assert.equal(noteRequiresTreatmentPlan({ noteType: 'SOAP', cptCode: code }), true, code);
  for (const code of ['90791', '90839']) assert.equal(noteRequiresTreatmentPlan({ noteType: 'SOAP', cptCode: code }), false, code);
});

// ─── B7: coding edits ────────────────────────────────────────────────────────

const codes = (lines: Array<[string, number?]>, ctx: Parameters<typeof codingEditFindings>[1]) =>
  codingEditFindings(lines.map(([cpt, units]) => ({ cpt, units: units ?? 1 })), ctx);
const errs = (f: ReturnType<typeof codingEditFindings>) => f.filter((x) => x.severity === 'error').map((x) => x.message).join('\n');

test('B7: minutes vs CPT (90832 16-37, 90834 38-52, 90837 53+, family 26+, crisis 30+)', () => {
  assert.equal(errs(codes([['90832']], { minutes: 30 })), '');
  assert.match(errs(codes([['90832']], { minutes: 40 })), /90832 needs 16-37 minutes/);
  assert.equal(errs(codes([['90834']], { minutes: 45 })), '');
  assert.match(errs(codes([['90834']], { minutes: 53 })), /90834 needs 38-52 minutes/);
  assert.match(errs(codes([['90837']], { minutes: 52 })), /90837 needs 53\+ minutes/);
  assert.match(errs(codes([['90847']], { minutes: 20 })), /90847 needs 26\+ minutes/);
  assert.match(errs(codes([['90839']], { minutes: 25 })), /90839 needs 30\+ minutes/);
  assert.match(errs(codes([['90837']], { minutes: null })), /no session minutes/);
  // mapper uses the note's minutes
  assert.match(errorsOf(claim({ note: { ...NOTE, durationMinutes: 45 } })), /90837 needs 53\+ minutes/);
});

test('B7: crisis 90840 per 30 additional minutes, requires 90839; 90785 never with crisis', () => {
  assert.equal(crisisAddOnUnits(74), 0);
  assert.equal(crisisAddOnUnits(75), 1);
  assert.equal(crisisAddOnUnits(105), 2);
  assert.equal(errs(codes([['90839'], ['90840', 1]], { minutes: 80 })), '');
  assert.match(errs(codes([['90839'], ['90840', 1]], { minutes: 110 })), /support 2 unit\(s\) of 90840, not 1/);
  assert.match(errs(codes([['90840']], { minutes: 80 })), /requires 90839/);
  assert.match(errs(codes([['90839'], ['90785']], { minutes: 60 })), /90785 .*cannot be billed with crisis/);
});

test('B7: psychotherapy add-ons need an E/M primary and separately documented psychotherapy time', () => {
  assert.equal(errs(codes([['99214'], ['90833']], { minutes: 40, psychotherapyMinutes: 20 })), '');
  assert.match(errs(codes([['90833']], { minutes: 20, psychotherapyMinutes: 20 })), /requires an E\/M primary/);
  assert.match(errs(codes([['99214'], ['90836']], { minutes: 60, psychotherapyMinutes: null })), /documented separately/);
  assert.match(errs(codes([['99214'], ['90836']], { minutes: 60, psychotherapyMinutes: 30 })), /90836 needs 38-52 minutes of psychotherapy/);
  assert.match(errs(codes([['90785']], { minutes: 30 })), /requires a primary psychiatric code/);
  assert.equal(errs(codes([['90834'], ['90785']], { minutes: 45 })), '');
  // E/M + add-on note produces two lines that map cleanly
  const lines = [
    { id: 'l1', cptCode: '99214', modifier: null, units: 1, totalCharge: 150 },
    { id: 'l2', cptCode: '90833', modifier: null, units: 1, totalCharge: 80 },
  ];
  const r = mapped(claim({ cptCode: '99214', amountCents: 23000, serviceLines: lines, note: { ...NOTE, cptCode: '99214', durationMinutes: 40, psychotherapyMinutes: 20 } }));
  assert.deepEqual(r.claim.lines.map((l) => [l.cpt, l.units]), [['99214', 1], ['90833', 1]]);
});

test('B7: NCCI pairs (90791/90792 with E/M or psychotherapy, same day same provider) and per-day caps', () => {
  assert.match(errs(codes([['90791'], ['90837']], { minutes: 60 })), /90791 \/ 90792 cannot be billed with 90837/);
  assert.match(errs(codes([['90792'], ['99214']], { minutes: 60 })), /cannot be billed with 99214/);
  assert.match(errs(codes([['90791']], { minutes: 60, sameDayCodes: ['90834'] })), /same day by the same provider/);
  assert.match(errs(codes([['90837', 2]], { minutes: 120 })), /exceed the per-day cap of 1 .*verify MUE/);
  assert.match(errs(codes([['90834']], { minutes: 45, sameDayCodes: ['90834'] })), /90834: 2 units on this date/);
  // mapper reads same-day codes from the context
  assert.match(errorsOf(claim({ cptCode: '90791', note: { ...NOTE, cptCode: '90791' } }), { ...CTX, sameDayCodes: ['90837'] }), /90791 \/ 90792 cannot be billed/);
});

// ─── H1: audio-only ─────────────────────────────────────────────────────────

test('H1: audio-only uses the payer modifier (Medicare 93), FQ when configured, blocked when the payer disallows', () => {
  const audioNote = { ...NOTE, telehealth: true, audioOnly: true };
  const mcr = mapped(claim({ payer: 'Medicare Part B', placeOfService: '10', note: audioNote, submissionData: { diagnosisCodes: ['F33.1'], modifiers: ['95'] } }));
  assert.deepEqual(mcr.claim.lines[0].modifiers, ['93']);
  assert.ok(segs(generate837P([mcr.claim], 12).content).includes('SV1*HC:90837:93*180.00*UN*1***1'));
  const fq = mapped(claim({ placeOfService: '10', note: audioNote }), { ...CTX, payerMappings: [MAP({ audioOnlyModifier: 'FQ' })] });
  assert.deepEqual(fq.claim.lines[0].modifiers, ['FQ']);
  assert.match(errorsOf(claim({ placeOfService: '10', note: audioNote })), /not set up to accept audio-only telehealth/);
  assert.match(errorsOf(claim({ payer: 'Medicare Part B', placeOfService: '11', note: audioNote })), /place of service 11/);
  // Audio-only flag on the appointment counts too
  assert.match(errorsOf(claim({ placeOfService: '10', appointment: { ...claim().appointment!, audioOnly: true } })), /audio-only/);
});

// ─── H6: control numbers ─────────────────────────────────────────────────────

test('H6: ISA13 / GS06 are the sequence value, never random; invalid numbers are refused', () => {
  const c = mapped(claim()).claim;
  const a = generate837P([c], 41);
  const b = generate837P([c], 42);
  assert.match(a.content, /^ISA\*.*\*000000041\*0\*T\*:~/);
  assert.match(a.content, /GS\*HC\*[^~]*\*41\*X\*005010X222A1~/);
  assert.match(a.content, /IEA\*1\*000000041~/);
  assert.notEqual(a.batchId, b.batchId);
  assert.equal(generate837P([c], 41).controlNumber, a.controlNumber, 'deterministic for a given sequence value');
  assert.throws(() => generate837P([c], 0), /sequence value/);
  assert.throws(() => generate837P([c], 1_000_000_000), /sequence value/);
  assert.throws(() => generate837P([c], undefined as unknown as number), /sequence value/);
});

test('H6: nextInterchangeControlNumber reads nextval() and is unique + increasing; missing sequence throws', async () => {
  let n = 100;
  let missing = false;
  const db = {
    $queryRaw: async () => {
      if (missing) throw new Error('relation "waystar_interchange_control_seq" does not exist');
      n += 1;
      return [{ n: BigInt(n) }];
    },
  };
  const submit = loadWithMocks<typeof import('../src/lib/billing/waystarSftpSubmit')>('../src/lib/billing/waystarSftpSubmit', db);
  const got = [await submit.nextInterchangeControlNumber(), await submit.nextInterchangeControlNumber(), await submit.nextInterchangeControlNumber()];
  assert.deepEqual(got, [101, 102, 103]);
  assert.equal(new Set(got).size, got.length);
  missing = true;
  await assert.rejects(submit.nextInterchangeControlNumber(), /apply migration 20261019_rcm_blockers/);
});

// ─── H7: legal names ─────────────────────────────────────────────────────────

test('H7: NM1*82 uses the staff legal name, never the display name; missing legal name is an error', () => {
  const r = mapped(claim());
  assert.ok(segs(generate837P([r.claim], 13).content).includes(`NM1*82*1*CLINICIAN-JONES*SAMUEL****XX*${CLINICIAN_NPI}`));
  assert.match(errorsOf(claim({ renderingClinician: { ...CLINICIAN, legalFirstName: null } })), /legal first and last name are missing on the staff profile/);
});

// ─── Timely filing ───────────────────────────────────────────────────────────

test('timely filing: error past the payer limit, warning within 30 days', () => {
  const ctx = { ...CTX, payerMappings: [MAP({ filingLimitDays: 180 })] };
  assert.match(errorsOf(claim(), { ...ctx, today: new Date('2027-05-01T12:00:00Z') }), /past Maryland Medicaid's 180-day filing limit/);
  const near = mapped(claim(), { ...ctx, today: new Date('2027-03-25T12:00:00Z') });
  assert.match(near.warnings.join(' '), /day\(s\) left of Maryland Medicaid's 180-day filing limit/);
  assert.equal(mapped(claim(), { ...ctx, today: new Date('2026-10-20T12:00:00Z') }).warnings.some((w) => /Timely filing/.test(w)), false);
});

// ─── Server paths (mocked DB): claim creation gates + scrubber ───────────────

function loadWithMocks<T>(path: string, db: Record<string, unknown>): T {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: db };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async () => undefined };
    return originalLoad.call(this, id, ...args);
  };
  try {
    return createRequire(import.meta.url)(path) as T;
  } finally {
    loader._load = originalLoad;
  }
}

const serverDb: Record<string, Record<string, unknown>> = {
  progressNote: {},
  claim: { findUnique: async () => null },
  prpWorkflow: { findFirst: async () => null },
  appointment: {},
  waystarPayerMapping: { findMany: async () => [] },
  practiceSettings: { findUnique: async () => null },
};
const claimsMod = loadWithMocks<typeof import('../src/lib/billing/claims')>('../src/lib/billing/claims', serverDb);
const ACTOR = { organizationId: 'org-1', actorUserId: 'u-1', actorRole: 'BILLING' as const };
const dbNote = (over: Record<string, unknown> = {}) => ({
  id: 'note-1', clientId: 'c1', clinicianId: 'clin-1', body: 'Session documented (synthetic).', cptCode: '90837', addOnCptCode: null,
  dateOfService: new Date('2026-10-14T00:00:00Z'), telehealth: false, audioOnly: false, placeOfService: '11', appointmentId: null,
  workflow: { status: 'LOCKED', cosignRequired: false, cosignedAt: null },
  client: { id: 'c1', name: 'Client A', insurancePayer: 'Maryland Medicaid', dateOfBirth: null, insuranceEffectiveTo: null },
  appointment: null,
  ...over,
});

test('B2 server: claim creation is blocked while the supervisor co-signature is pending', async () => {
  serverDb.progressNote.findFirst = async () => dbNote({ workflow: { status: 'LOCKED', cosignRequired: true, cosignedAt: null } });
  const r = await claimsMod.generateClaimFromNote(ACTOR, 'note-1');
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /co-signature is pending/);
});

test('B6 server: no CPT on the note -> no claim (no 90834 default); PRP note -> held until the PRP billing model is confirmed + IRP', async () => {
  serverDb.progressNote.findFirst = async () => dbNote({ cptCode: null });
  const none = await claimsMod.generateClaimFromNote(ACTOR, 'note-1');
  assert.match(!none.ok ? none.error : '', /No CPT on the signed note/);
  serverDb.progressNote.findFirst = async () => dbNote({ cptCode: 'H2017' });
  const prp = await claimsMod.generateClaimFromNote(ACTOR, 'note-1');
  assert.match(!prp.ok ? prp.error : '', /PRP billing model not confirmed.*Individual Rehabilitation Plan/);
});

test('B1 server: a claim from an appointment needs a signed note linked to THAT appointment (no 2-day grab)', async () => {
  serverDb.appointment.findFirst = async () => ({ id: 'appt-9', status: 'COMPLETED' });
  serverDb.progressNote.findMany = async ({ where }: { where: { appointmentId: string } }) => {
    assert.equal(where.appointmentId, 'appt-9');
    return [];
  };
  const r = await claimsMod.generateClaimFromAppointment(ACTOR, 'appt-9');
  assert.match(!r.ok ? r.error : '', /No signed progress note is linked to this appointment/);
});

test('payer-denied (835) claims cannot go back to READY as an original', () => {
  assert.equal(claimsMod.payerAdjudicatedDenial({ status: 'DENIED', eraProcessedAt: new Date(), submissionData: {}, frequencyCode: '1' }), true);
  assert.equal(claimsMod.payerAdjudicatedDenial({ status: 'DENIED', eraProcessedAt: null, submissionData: {}, frequencyCode: '1' }), false);
});

test('scrubber: COSIGN_PENDING, NOTE_CPT_MISSING, APPT_MISMATCH, PRP_PENDING, CODING_EDITS, RENDERING_LEGAL_NAME are errors', () => {
  const scrubber = loadWithMocks<typeof import('../src/lib/billing/claimScrubber')>('../src/lib/billing/claimScrubber', {});
  const base = {
    id: 'cl1', cptCode: '90837', units: 1, amountCents: 18000, payer: 'Maryland Medicaid', status: 'DRAFT' as const,
    submissionData: { diagnosisCodes: ['F33.1'], payerId: 'P1' }, createdAt: new Date(), denialReason: null,
    client: { name: 'Client A', insuranceMemberId: 'M1', dateOfBirth: new Date('1990-01-01'), primaryDiagnosisCode: 'F33.1' },
    appointment: { id: 'appt-1', startsAt: new Date('2026-10-16T14:00:00Z'), clinicianId: 'clin-2', clinician: { npi: '1740059005' } },
    progressNote: {
      id: 'note-1', clinicianId: 'clin-1', dateOfService: new Date('2026-10-14T00:00:00Z'), durationMinutes: 45, cptCode: null, body: 'No metadata.',
      appointmentId: 'appt-1', clinician: { npi: CLINICIAN_NPI, legalFirstName: null, legalLastName: 'Clinician' },
      workflow: { status: 'LOCKED', cosignRequired: true, cosignedAt: null },
    },
    serviceLines: [{ cptCode: '90837', units: 1 }],
  };
  const r = scrubber.evaluateClaimScrub(base, { timeZone: 'America/New_York' });
  const errorCodes = new Set(r.findings.filter((f) => f.severity === 'error').map((f) => f.code));
  for (const code of ['COSIGN_PENDING', 'NOTE_CPT_MISSING', 'APPT_MISMATCH', 'CODING_EDITS', 'RENDERING_LEGAL_NAME']) assert.ok(errorCodes.has(code), code);
  assert.equal(r.status, 'errors');
  const prp = scrubber.evaluateClaimScrub({ ...base, cptCode: 'H2017', serviceLines: [] });
  assert.ok(prp.findings.some((f) => f.code === 'PRP_PENDING' && f.severity === 'error'));
});
