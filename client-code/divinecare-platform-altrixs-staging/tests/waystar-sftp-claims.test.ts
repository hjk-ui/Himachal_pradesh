import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_NUMBER_RE,
  claimToBatchClaim,
  eraAdjudicationFromPayments,
  findPayerMapping,
  parse277CA,
  parse999,
  resolveBillingProvider,
  x12TransactionType,
  type BillingProviderConfig,
  type ClaimForMapping,
  type CoverageRecord,
  type MapperContext,
  type PayerMappingConfig,
  type PriorAuthRecord,
} from '../src/lib/billing/waystarSftpClaims';
import { generate837P, isValidNpi } from '../src/lib/services/waystarSftpService';

// Check-digit-valid test NPIs (not real providers)
const GROUP_NPI = '1234567893';
const CLINICIAN_NPI = '1111111112';
// NUCC taxonomies used as test values: 261QM0801X mental health clinic, 101YP2500X professional counselor
const PRACTICE_TAXONOMY = '261QM0801X';
const ENV_CTX: MapperContext = { groupNpi: GROUP_NPI, billingTaxonomy: PRACTICE_TAXONOMY };

/** The signed note the claim bills: DOS, clinician, minutes come from it. */
const BASE_NOTE = {
  id: 'note-1',
  clinicianId: 'clin-1',
  // Practice date Oct 14 (stored as UTC midnight of the date the clinician entered)
  dateOfService: new Date('2026-10-14T00:00:00.000Z'),
  cptCode: '90837',
  durationMinutes: 55,
  appointmentId: 'appt-1',
  workflow: { status: 'LOCKED', cosignRequired: false, cosignedAt: null },
};
const BASE_CLINICIAN = { userId: 'clin-1', npi: CLINICIAN_NPI, legalFirstName: 'Sam', legalLastName: 'Clinician', taxonomyCode: '101YP2500X', preLicensed: false, supervisor: null };

function baseClaim(overrides: Partial<ClaimForMapping> = {}): ClaimForMapping {
  return {
    id: 'cmclaimabc123def456ghi78',
    claimControlNumber: 'AX0123456789ABCDEF',
    status: 'READY',
    cptCode: '90837',
    units: 1,
    amountCents: 18000,
    payer: 'Maryland Medicaid',
    icd10Codes: ['F33.1', 'F41.1'],
    placeOfService: '11',
    renderingNpi: null,
    billingNpi: null,
    submissionData: { payerId: 'MDMCD', claimFilingCode: 'MC', diagnosisCodes: ['F33.1'], placeOfService: '11' },
    noteStatus: 'LOCKED',
    client: {
      name: 'Jane Testpatient',
      legalFirstName: 'Jane',
      legalLastName: 'Testpatient',
      middleInitial: 'Q',
      dateOfBirth: new Date('1990-04-02T00:00:00.000Z'),
      gender: 'Female',
      addressLine1: '1 Test St',
      city: 'Bowie',
      state: 'MD',
      postalCode: '20715',
      insurancePayer: 'Maryland Medicaid',
      insuranceMemberId: 'MA123456789',
    },
    // 9pm Eastern on Oct 14 is Oct 15 in UTC; the appointment cross-check uses the practice date (Oct 14)
    appointment: { id: 'appt-1', clinicianId: 'clin-1', startsAt: new Date('2026-10-15T01:00:00.000Z'), clinician: { name: 'Dr. Sam Clinician, LCSW-C', npi: CLINICIAN_NPI } },
    note: BASE_NOTE,
    renderingClinician: BASE_CLINICIAN,
    serviceLines: [],
    ...overrides,
  };
}

test('complete READY claim maps to ClaimForBatch', () => {
  const r = claimToBatchClaim(baseClaim(), ENV_CTX);
  assert.equal(r.ok, true);
  if (!('claim' in r)) return;
  assert.equal(r.claim.claimId, 'cmclaimabc123def456ghi78');
  assert.equal(r.claim.controlNumber, 'AX0123456789ABCDEF');
  assert.equal(r.claim.payerId, 'MDMCD');
  assert.equal(r.claim.claimFilingCode, 'MC');
  assert.equal(r.claim.patientGender, 'F');
  assert.equal(r.claim.patientDob, '1990-04-02');
  assert.deepEqual(r.claim.diagnoses, ['F331', 'F411']);
  assert.equal(r.claim.renderingNpi, CLINICIAN_NPI);
  assert.equal(r.claim.renderingLastName, 'Clinician');
  assert.equal(r.claim.lines.length, 1);
  assert.equal(r.claim.lines[0].serviceDate, '2026-10-14');
  assert.equal(r.claim.lines[0].chargeAmount, 180);
});

test('missing required fields fail with one error per field, nothing guessed', () => {
  const claim = baseClaim({
    status: 'DRAFT',
    noteStatus: 'DRAFT',
    submissionData: {},
    icd10Codes: [],
    payer: null,
    appointment: null,
    note: { ...BASE_NOTE, dateOfService: null },
    renderingClinician: null,
    client: {
      ...baseClaim().client,
      name: 'Prince',
      legalFirstName: null,
      legalLastName: null,
      dateOfBirth: null,
      gender: null,
      addressLine1: null,
      city: '',
      // A state name maps deterministically ("Maryland" -> MD); a misspelling does not
      state: 'Marylnd',
      postalCode: '2071',
      insurancePayer: null,
      insuranceMemberId: null,
    },
  });
  const r = claimToBatchClaim(claim, ENV_CTX);
  assert.equal(r.ok, false);
  const errors = 'errors' in r ? r.errors.join('\n') : '';
  for (const expected of [
    'only READY claims',
    'signed progress note',
    'Waystar payer ID is missing',
    'Payer name is missing',
    'claim filing code',
    'member ID is missing',
    'legal first and last name',
    'date of birth is missing',
    'sex is missing',
    'street address',
    'city is missing',
    '2-letter code',
    'ZIP must be 5 or 9 digits',
    'No ICD-10 diagnosis',
    'Rendering provider is missing',
    'Date of service is missing on the progress note',
  ]) {
    assert.ok(errors.includes(expected), `expected error containing "${expected}"\n${errors}`);
  }
});

test('billing NPI that differs from the configured group NPI is blocked', () => {
  const r = claimToBatchClaim(baseClaim({ billingNpi: 'Other Clinic — NPI 1111111112' }), ENV_CTX);
  assert.equal(r.ok, false);
  assert.match('errors' in r ? r.errors.join(' ') : '', /one billing NPI per file/);
  assert.match('errors' in r ? r.errors.join(' ') : '', /without configured billing providers/);
});

test('invalid NPIs and unknown editor rendering provider are blocked', () => {
  const r = claimToBatchClaim(baseClaim({ renderingNpi: '1234567890' }), { groupNpi: '1457893210' });
  const errors = 'errors' in r ? r.errors.join(' ') : '';
  assert.match(errors, /PRACTICE_GROUP_NPI/);
  assert.match(errors, /Rendering NPI 1234567890 picked on the claim is not a staff member/);
  const bad = claimToBatchClaim(baseClaim({ renderingClinician: { ...BASE_CLINICIAN, npi: '1234567890' } }), ENV_CTX);
  assert.match('errors' in bad ? bad.errors.join(' ') : '', /Rendering provider NPI 1234567890 fails the NPI check digit/);
});

test('multi-line claims keep per-line modifiers and must add up', () => {
  const lines = [
    { id: 'a1', cptCode: '90837', modifier: 'HO', units: 1, totalCharge: 180 },
    { id: 'b2', cptCode: '90785', modifier: null, units: 1, totalCharge: 20 },
  ];
  const ok = claimToBatchClaim(baseClaim({ serviceLines: lines, amountCents: 20000 }), ENV_CTX);
  assert.equal(ok.ok, true);
  if ('claim' in ok) assert.deepEqual(ok.claim.lines.map((l) => [l.cpt, l.modifiers]), [['90837', ['HO']], ['90785', []]]);
  const bad = claimToBatchClaim(baseClaim({ serviceLines: lines, amountCents: 18000 }), ENV_CTX);
  assert.match('errors' in bad ? bad.errors.join(' ') : '', /do not add up/);
});

test('generated 837 carries CLM01 = claim control number, SBR09 filing code, and the GS06 the 999 echoes', () => {
  const r = claimToBatchClaim(baseClaim(), ENV_CTX);
  assert.ok('claim' in r);
  if (!('claim' in r)) return;
  const { content, controlNumber } = generate837P([r.claim], 123456789);
  assert.equal(controlNumber, '123456789');
  assert.match(content, /CLM\*AX0123456789ABCDEF\*180\.00\*\*\*11:B:1\*Y\*A\*Y\*Y~/);
  assert.match(content, /BHT\*0019\*00\*AX0123456789ABCDEF\*/);
  assert.match(content, /SBR\*P\*18\*{7}MC~/);
  assert.match(content, /HI\*ABK:F331\*ABF:F411~/);
  assert.match(content, /GS\*HC\*[^~]*\*123456789\*X\*005010X222A1~/);
  assert.match(content, /NM1\*82\*1\*CLINICIAN\*SAM\*{4}XX\*1111111112~/);
  assert.match(content, /DTP\*472\*D8\*20261014~/);
});

const ISA = 'ISA*00*          *00*          *ZZ*WAYSTAR        *ZZ*ALTRIXS01      *261016*1200*^*00501*000000001*0*T*:~';

test('999 parser reads group and per-transaction-set results', () => {
  const content = [
    ISA,
    'GS*FA*WAYSTAR*ALTRIXS01*20261016*1200*1*X*005010X231A1~',
    'ST*999*0001*005010X231A1~',
    'AK1*HC*123456789*005010X222A1~',
    'AK2*837*0001*005010X222A1~',
    'IK5*A~',
    'AK2*837*0002*005010X222A1~',
    'IK3*NM1*12**8~',
    'IK4*9**7*123~',
    'IK5*R*5~',
    'AK9*P*2*2*1~',
    'SE*10*0001~',
  ].join('\n');
  assert.equal(x12TransactionType(content), '999');
  const { groups } = parse999(content);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupControlNumber, '123456789');
  assert.equal(groups[0].code, 'P');
  assert.deepEqual(groups[0].sets.map((s) => [s.stControlNumber, s.accepted]), [['0001', true], ['0002', false]]);
  assert.match(groups[0].sets[1].errors.join(' '), /Segment NM1 at position 12/);
});

test('277CA parser matches TRN*2 (CLM01) and classifies STC categories', () => {
  const content = [
    ISA,
    'ST*277*0001*005010X214~',
    'HL*1**20*1~', 'NM1*AY*2*WAYSTAR*****46*WAYSTAR~',
    'HL*2*1*21*1~', 'NM1*41*2*ALTRIXS*****46*ALTRIXS01~',
    'HL*3*2*19*1~', 'NM1*85*2*PRACTICE*****XX*1234567893~',
    'HL*4*3*PT~', 'NM1*QC*1*TESTPATIENT*JANE~', 'TRN*2*cmclaimabc123def456ghi78~',
    'STC*A2:20:PR*20261016*WQ*180~', 'REF*1K*PAYER123~',
    'HL*5*3*PT~', 'NM1*QC*1*OTHER*PAT~', 'TRN*2*cmotherclaim000000000001~',
    'STC*A7:562:85*20261016*U*95********Billing provider NPI invalid~',
    'SVC*HC:90837*95*****1~', 'STC*A2:20*20261016~',
    'SE*18*0001~',
  ].join('~\n').replace(/~~/g, '~');
  assert.equal(x12TransactionType(content), '277CA');
  const { claims } = parse277CA(content);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].claimRef, 'cmclaimabc123def456ghi78');
  assert.equal(claims[0].accepted, true);
  assert.equal(claims[0].payerClaimNumber, 'PAYER123');
  assert.equal(claims[1].accepted, false);
  assert.equal(claims[1].category, 'A7');
  assert.match(claims[1].reason, /Rejected for invalid information; status code 562 \(entity 85\); Billing provider NPI invalid/);
});

// ─── Outbound completeness: subscriber, COB, prior auth, telehealth, 7/8, billing NPIs, CLM01 ───

// The practice's three organization NPIs (seeded by the 20261016 migration)
const PROVIDERS: BillingProviderConfig[] = [
  {
    npi: '1801621297', name: 'MD BEHAVIORAL HEALTH LLC', label: 'Adult Mental Health Clinic', taxId: '923843658',
    address1: '4000 MITCHELLVILLE RD', address2: 'STE 414', city: 'BOWIE', state: 'MD', zip: '207163104', phone: '3012498100',
    departments: ['mental_health'], clinicianRoles: [], locationKeys: [], isDefault: true, active: true, taxonomyCode: PRACTICE_TAXONOMY,
  },
  {
    npi: '1346021813', name: 'MD BEHAVIORAL HEALTH LLC', label: 'Psychiatry', taxId: '923843658',
    address1: '4000 MITCHELLVILLE RD', address2: 'STE A414', city: 'BOWIE', state: 'MD', zip: '207163142', phone: '3012498100',
    departments: ['psychiatry'], clinicianRoles: ['PSYCHIATRIST', 'NP'], locationKeys: [], isDefault: false, active: true, taxonomyCode: PRACTICE_TAXONOMY,
  },
  {
    npi: '1740059005', name: 'MD BEHAVIORAL HEALTH LLC', label: 'Internal Medicine', taxId: '923843658',
    address1: '7610 CARROLL AVE', address2: 'STE 360', city: 'TAKOMA PARK', state: 'MD', zip: '209126323', phone: '3012498100',
    departments: ['internal_medicine'], clinicianRoles: ['PHYSICIAN', 'MEDICAL_NP'], locationKeys: ['takoma-park'], isDefault: false, active: true, taxonomyCode: PRACTICE_TAXONOMY,
  },
];

// Test-only payer IDs (not real Waystar IDs) plus the seeded, unverified Maryland Medicaid row
const MAPPINGS: PayerMappingConfig[] = [
  { payerName: 'Maryland Medicaid', aliases: ['MD Medicaid'], waystarPayerId: '100198', claimFilingCode: 'MC', telehealthModifier: '95', requiresPriorAuth: false, verified: false, active: true },
  { payerName: 'Test Commercial', aliases: ['TC Health'], waystarPayerId: 'TESTCOM1', claimFilingCode: 'CI', telehealthModifier: 'GT', requiresPriorAuth: false, verified: true, active: true },
  { payerName: 'Test Auth Plan', aliases: [], waystarPayerId: 'TESTAUTH', claimFilingCode: 'CI', telehealthModifier: '95', requiresPriorAuth: true, verified: true, active: true },
];

const CTX: MapperContext = { billingProviders: PROVIDERS, payerMappings: MAPPINGS, usageIndicator: 'T' };

function mapOk(claim: ClaimForMapping, ctx: MapperContext = CTX) {
  const r = claimToBatchClaim(claim, ctx);
  if (!('claim' in r)) assert.fail(`expected the claim to map:\n${'errors' in r ? r.errors.join('\n') : ''}`);
  return r;
}

function errorsOf(claim: ClaimForMapping, ctx: MapperContext = CTX) {
  const r = claimToBatchClaim(claim, ctx);
  assert.equal(r.ok, false);
  return 'errors' in r ? r.errors.join('\n') : '';
}

/** Segments of transaction set n (1-based) of an 837. */
function stSegments(content: string, n = 1): string[] {
  const segs = content.split('~\n').map((x) => x.replace(/~$/, ''));
  const starts = segs.map((x, i) => (x.startsWith('ST*') ? i : -1)).filter((i) => i >= 0);
  const from = starts[n - 1];
  const to = segs.findIndex((x, i) => i > from && x.startsWith('SE*'));
  return segs.slice(from, to + 1);
}

test('the three seeded organization NPIs pass the NPI check digit', () => {
  for (const p of PROVIDERS) assert.ok(isValidNpi(p.npi), p.npi);
});

test('self subscriber: SBR02 = 18, patient in 2010BA with N3/N4/DMG, no 2000C', () => {
  const r = mapOk(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] } }));
  assert.equal(r.claim.subscriber, undefined);
  const st = stSegments(generate837P([r.claim], 1).content);
  assert.deepEqual(st.slice(st.indexOf('HL*2*1*22*0'), st.indexOf('HL*2*1*22*0') + 7), [
    'HL*2*1*22*0',
    'SBR*P*18*******MC',
    'NM1*IL*1*TESTPATIENT*JANE*Q***MI*MA123456789',
    'N3*1 TEST ST',
    'N4*BOWIE*MD*20715',
    'DMG*D8*19900402*F',
    'NM1*PR*2*MARYLAND MEDICAID*****PI*100198',
  ]);
  assert.ok(!st.some((x) => x.startsWith('HL*3') || x.startsWith('PAT*')));
  // SE01 counts every segment ST..SE
  assert.equal(st[st.length - 1], `SE*${st.length}*0001`);
});

test('dependent subscriber: 2000B policyholder without DMG, 2000C/2010CA patient with PAT01', () => {
  const claim = baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] }, client: { ...baseClaim().client, insuranceGroupNumber: 'GRP-77' } });
  const ctx: MapperContext = {
    ...CTX,
    coverages: [{ rank: 'P', subscriberRelationship: '19', subscriberFirstName: 'Pat', subscriberLastName: 'Parent', subscriberMiddleInitial: 'r' }],
  };
  const r = mapOk(claim, ctx);
  assert.deepEqual(r.claim.subscriber, { relationship: '19', firstName: 'Pat', lastName: 'Parent', middleInitial: 'r' });
  const st = stSegments(generate837P([r.claim], 1).content);
  const i = st.indexOf('HL*2*1*22*1');
  assert.ok(i > 0, st.join('\n'));
  assert.deepEqual(st.slice(i, i + 10), [
    'HL*2*1*22*1',
    'SBR*P**GRP-77******MC',
    'NM1*IL*1*PARENT*PAT*R***MI*MA123456789',
    'NM1*PR*2*MARYLAND MEDICAID*****PI*100198',
    'HL*3*2*23*0',
    'PAT*19',
    'NM1*QC*1*TESTPATIENT*JANE*Q',
    'N3*1 TEST ST',
    'N4*BOWIE*MD*20715',
    'DMG*D8*19900402*F',
  ]);
  assert.match(st[i + 10], /^CLM\*/);
  // A dependent without the policyholder's name is blocked
  const missing = errorsOf(claim, { ...CTX, coverages: [{ rank: 'P', subscriberRelationship: '01' }] });
  assert.match(missing, /Policyholder \(subscriber\) first and last name are missing/);
  assert.match(errorsOf(claim, { ...CTX, coverages: [{ rank: 'P', subscriberRelationship: '99', subscriberFirstName: 'A', subscriberLastName: 'B' }] }), /not an X12 relationship code/);
});

const SECONDARY_COVERAGES: CoverageRecord[] = [
  { rank: 'P', subscriberRelationship: '18' },
  { rank: 'S', payerName: 'Test Commercial', memberId: 'TC998877', groupNumber: 'G100', subscriberRelationship: '01', subscriberFirstName: 'Sam', subscriberLastName: 'Spouse' },
];

function secondaryClaim(overrides: Partial<ClaimForMapping> = {}) {
  return baseClaim({ payer: 'Test Commercial', payerResponsibility: 'S', submissionData: { diagnosisCodes: ['F33.1'] }, ...overrides });
}

test('secondary claim with COB from the primary 835: 2000B SBR*S, 2320/2330A/2330B balance', () => {
  const ctx: MapperContext = {
    ...CTX,
    coverages: SECONDARY_COVERAGES,
    priorAdjudications: {
      P: { source: 'era', payerId: '100198', claimFilingCode: 'MC', paidAmount: 120, paidDate: '2026-10-20', adjustments: [{ group: 'CO', reason: '45', amount: 40 }, { group: 'PR', reason: '2', amount: 20 }] },
    },
  };
  const r = mapOk(secondaryClaim(), ctx);
  assert.equal(r.claim.payerResponsibility, 'S');
  assert.equal(r.claim.payerId, 'TESTCOM1');
  assert.equal(r.claim.claimFilingCode, 'CI');
  const st = stSegments(generate837P([r.claim], 1).content);
  // 2000B: secondary policy, spouse is the policyholder
  assert.ok(st.includes('SBR*S**G100******CI'), st.join('\n'));
  assert.ok(st.includes('NM1*IL*1*SPOUSE*SAM****MI*TC998877'));
  assert.ok(st.includes('NM1*PR*2*TEST COMMERCIAL*****PI*TESTCOM1'));
  assert.ok(st.includes('PAT*01'));
  const i = st.indexOf('SBR*P*18*******MC');
  assert.ok(i > st.findIndex((x) => x.startsWith('NM1*82*')), '2320 follows 2310B');
  assert.deepEqual(st.slice(i, i + 8), [
    'SBR*P*18*******MC',
    'CAS*CO*45*40.00',
    'CAS*PR*2*20.00',
    'AMT*D*120.00',
    'OI***Y***Y',
    'NM1*IL*1*TESTPATIENT*JANE*Q***MI*MA123456789',
    'NM1*PR*2*MARYLAND MEDICAID*****PI*100198',
    'DTP*573*D8*20261020',
  ]);
  assert.equal(st[i + 8], 'LX*1');
});

test('secondary claim with line-level COB emits 2430 SVD/CAS/DTP*573 and no 2330B date', () => {
  const ctx: MapperContext = {
    ...CTX,
    coverages: SECONDARY_COVERAGES,
    priorAdjudications: {
      P: {
        source: 'era', payerId: '100198', paidAmount: 120, paidDate: '2026-10-20', adjustments: [],
        lines: [{ lineNumber: 1, paidAmount: 120, adjustments: [{ group: 'CO', reason: '45', amount: 40 }, { group: 'PR', reason: '2', amount: 20 }] }],
      },
    },
  };
  const st = stSegments(generate837P([mapOk(secondaryClaim(), ctx).claim], 1).content);
  const lx = st.indexOf('LX*1');
  assert.deepEqual(st.slice(lx, lx + 6), [
    'LX*1',
    'SV1*HC:90837*180.00*UN*1***1',
    'DTP*472*D8*20261014',
    'SVD*100198*120.00*HC:90837**1',
    'CAS*CO*45*40.00',
    'CAS*PR*2*20.00',
  ]);
  assert.equal(st[lx + 6], 'DTP*573*D8*20261020');
  assert.ok(!st.slice(0, lx).includes('DTP*573*D8*20261020'));
});

test('secondary claim: missing or unbalanced primary adjudication is blocked; staff entry is used when no 835', () => {
  const ctx: MapperContext = { ...CTX, coverages: SECONDARY_COVERAGES };
  assert.match(errorsOf(secondaryClaim(), ctx), /Primary payer adjudication is missing: no 835 on file/);
  const unbalanced = secondaryClaim({ submissionData: { diagnosisCodes: ['F33.1'], cob: { P: { paidAmount: 100, paidDate: '2026-10-20', adjustments: [{ group: 'CO', reason: '45', amount: 40 }] } } } });
  assert.match(errorsOf(unbalanced, ctx), /claim charge \$180\.00 must equal paid \(\$100\.00\) \+ adjustments \(\$40\.00\)/);
  const staff = secondaryClaim({ submissionData: { diagnosisCodes: ['F33.1'], cob: { P: { paidAmount: 140, paidDate: '2026-10-21', adjustments: [{ group: 'CO', reason: '45', amount: 40 }] } } } });
  const r = mapOk(staff, ctx);
  assert.equal(r.claim.otherPayers?.[0].paidAmount, 140);
  assert.equal(r.claim.otherPayers?.[0].payerId, '100198');
  // No secondary coverage on file
  assert.match(errorsOf(secondaryClaim(), { ...CTX, coverages: [] }), /Secondary insurance is not on file/);
});

test('835 payments become COB: aligned SVC lines -> line level, otherwise claim level', () => {
  const pay = { paidAmount: 120, paidDate: '2026-10-20', claimAdjustments: [], serviceLines: [{ seq: 1, procedureCode: '90837', paid: 120, adjustments: [{ group: 'CO', carc: '45', amount: 60 }] }] };
  const aligned = eraAdjudicationFromPayments([pay], ['90837'], { payerId: '100198' });
  assert.equal(aligned?.lines?.length, 1);
  assert.deepEqual(aligned?.lines?.[0].adjustments, [{ group: 'CO', reason: '45', amount: 60 }]);
  const notAligned = eraAdjudicationFromPayments([pay], ['90834']);
  assert.equal(notAligned?.lines, undefined);
  assert.deepEqual(notAligned?.adjustments, [{ group: 'CO', reason: '45', amount: 60 }]);
  assert.equal(eraAdjudicationFromPayments([], ['90837']), null);
});

test('prior auth: approved auth covering payer/DOS/CPT goes in 2300 REF*G1 before HI', () => {
  const auths: PriorAuthRecord[] = [
    { authNumber: 'OLD-1', status: 'APPROVED', payer: 'MD Medicaid', cptCodes: ['90837'], startDate: new Date('2026-01-01'), endDate: new Date('2026-06-30'), unitsApproved: 10, unitsUsed: 0 },
    { authNumber: 'PA-2026-77', status: 'APPROVED', payer: 'MD Medicaid', cptCodes: ['90837'], startDate: new Date('2026-07-01'), endDate: new Date('2026-12-31'), unitsApproved: 24, unitsUsed: 3 },
    { authNumber: 'DENIED-1', status: 'DENIED', payer: 'Maryland Medicaid', cptCodes: [], startDate: null, endDate: null, unitsApproved: 0, unitsUsed: 0 },
  ];
  const r = mapOk(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] } }), { ...CTX, priorAuths: auths });
  assert.equal(r.claim.priorAuthNumber, 'PA-2026-77');
  const st = stSegments(generate837P([r.claim], 1).content);
  const clm = st.findIndex((x) => x.startsWith('CLM*'));
  assert.equal(st[clm + 1], 'REF*G1*PA-2026-77');
  assert.match(st[clm + 2], /^HI\*/);
  // Staff-entered number on the claim wins
  assert.equal(mapOk(baseClaim({ priorAuthNumber: 'MANUAL9', submissionData: { diagnosisCodes: ['F33.1'] } }), { ...CTX, priorAuths: auths }).claim.priorAuthNumber, 'MANUAL9');
  // Only an expired auth: no REF*G1, warned
  const expired = mapOk(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] } }), { ...CTX, priorAuths: [auths[0]] });
  assert.equal(expired.claim.priorAuthNumber, undefined);
  assert.match(expired.warnings.join(' '), /OLD-1 does not cover the date of service 2026-10-14/);
  // A payer that requires auth blocks the claim without one
  assert.match(errorsOf(baseClaim({ payer: 'Test Auth Plan', submissionData: { diagnosisCodes: ['F33.1'] } })), /Test Auth Plan requires prior authorization/);
});

test('telehealth: POS 02/10 required, modifier per payer mapping (95 default, GT when configured)', () => {
  const virtualAppt = { ...baseClaim().appointment!, isVirtual: true };
  assert.match(errorsOf(baseClaim({ appointment: virtualAppt, submissionData: { diagnosisCodes: ['F33.1'] } })), /Telehealth visit billed with place of service 11/);
  // Medicaid mapping: 95; stored GT + 95 (REST-path style) collapse to 95
  const med = mapOk(baseClaim({ appointment: virtualAppt, placeOfService: '10', submissionData: { diagnosisCodes: ['F33.1'], modifiers: ['GT', '95'] } }));
  assert.deepEqual(med.claim.lines[0].modifiers, ['95']);
  const st = stSegments(generate837P([med.claim], 1).content);
  assert.ok(st.some((x) => /^CLM\*[^*]+\*180\.00\*\*\*10:B:1\*/.test(x)));
  assert.ok(st.includes('SV1*HC:90837:95*180.00*UN*1***1'));
  // Commercial mapping configured for GT; POS 02 alone marks the claim telehealth
  const com = mapOk(baseClaim({ payer: 'TC Health', placeOfService: '02', submissionData: { diagnosisCodes: ['F33.1'], modifiers: ['HO'] } }));
  assert.equal(com.claim.payerId, 'TESTCOM1');
  assert.deepEqual(com.claim.lines[0].modifiers, ['HO', 'GT']);
  // Note marked telehealth with in-office POS is blocked
  assert.match(errorsOf(baseClaim({ noteTelehealth: true, submissionData: { diagnosisCodes: ['F33.1'] } })), /Telehealth visit/);
  // In-office claims are untouched
  assert.deepEqual(mapOk(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'], modifiers: ['HO'] } })).claim.lines[0].modifiers, ['HO']);
});

test('corrected (7) and void (8) claims: CLM05-3 and REF*F8 payer claim control number', () => {
  const corrected = mapOk(baseClaim({ frequencyCode: '7', payerClaimControlNumber: 'ICN2026001', submissionData: { diagnosisCodes: ['F33.1'] } }));
  const st = stSegments(generate837P([corrected.claim], 1).content);
  const clm = st.findIndex((x) => x.startsWith('CLM*'));
  assert.match(st[clm], /\*\*\*11:B:7\*Y\*A\*Y\*Y$/);
  assert.equal(st[clm + 1], 'REF*F8*ICN2026001');
  const voided = mapOk(baseClaim({ frequencyCode: '8', payerClaimControlNumber: 'ICN2026001', priorAuthNumber: 'PA1', submissionData: { diagnosisCodes: ['F33.1'] } }));
  const vs = stSegments(generate837P([voided.claim], 1).content);
  const vclm = vs.findIndex((x) => x.startsWith('CLM*'));
  assert.match(vs[vclm], /11:B:8/);
  assert.deepEqual(vs.slice(vclm + 1, vclm + 3), ['REF*G1*PA1', 'REF*F8*ICN2026001']);
  assert.match(errorsOf(baseClaim({ frequencyCode: '7', submissionData: { diagnosisCodes: ['F33.1'] } })), /Corrected claim needs the payer claim control number/);
  assert.match(errorsOf(baseClaim({ frequencyCode: '5', submissionData: { diagnosisCodes: ['F33.1'] } })), /frequency code "5"/);
  // Original claims carry no REF*F8 even when a payer number is stored
  const orig = stSegments(generate837P([mapOk(baseClaim({ payerClaimControlNumber: 'ICN1', submissionData: { diagnosisCodes: ['F33.1'] } })).claim], 1).content);
  assert.ok(!orig.some((x) => x.startsWith('REF*F8')));
});

test('two billing NPIs in one file: separate 2000A per claim, grouped by NPI, one ISA/GS', () => {
  const psych = mapOk(baseClaim({ id: 'cmclaimpsych0000000000001', claimControlNumber: 'AXPSYCH0000000001', cptCode: '99214', submissionData: { diagnosisCodes: ['F33.1'] } }), { ...CTX, clinicianRole: 'PSYCHIATRIST' });
  const therapy = mapOk(baseClaim({ id: 'cmclaimther00000000000002', claimControlNumber: 'AXTHER00000000002', submissionData: { diagnosisCodes: ['F33.1'] } }), { ...CTX, clinicianRole: 'THERAPIST' });
  assert.equal(psych.claim.billingProvider?.npi, '1346021813');
  assert.equal(therapy.claim.billingProvider?.npi, '1801621297');
  // Sent in reverse NPI order; the file groups them by NPI
  const { content, transactionSets } = generate837P([therapy.claim, psych.claim, therapy.claim], 42);
  assert.equal((content.match(/^ISA\*/gm) || []).length, 1);
  assert.equal((content.match(/^GS\*/gm) || []).length, 1);
  assert.match(content, /GE\*3\*42~/);
  assert.deepEqual(transactionSets.map((t) => [t.controlNumber, t.claimControlNumber]), [
    ['0001', 'AXPSYCH0000000001'],
    ['0002', 'AXTHER00000000002'],
    ['0003', 'AXTHER00000000002'],
  ]);
  const st1 = stSegments(content, 1);
  const st2 = stSegments(content, 2);
  assert.deepEqual(st1.slice(st1.indexOf('HL*1**20*1'), st1.indexOf('HL*1**20*1') + 6), [
    'HL*1**20*1',
    'PRV*BI*PXC*261QM0801X',
    'NM1*85*2*MD BEHAVIORAL HEALTH LLC*****XX*1346021813',
    'N3*4000 MITCHELLVILLE RD*STE A414',
    'N4*BOWIE*MD*207163142',
    'REF*EI*923843658',
  ]);
  assert.ok(st2.includes('NM1*85*2*MD BEHAVIORAL HEALTH LLC*****XX*1801621297'));
  assert.ok(st2.includes('N3*4000 MITCHELLVILLE RD*STE 414'));
  // 1000A PER falls back to the billing provider phone when WAYSTAR_SUBMITTER_PHONE is unset
  if (!process.env.WAYSTAR_SUBMITTER_PHONE && !process.env.PRACTICE_BILLING_PHONE) assert.ok(st2.includes('PER*IC*BILLING*TE*3012498100'));
});

test('billing provider selection: explicit NPI, department, location, default, ambiguity', () => {
  assert.equal(resolveBillingProvider(PROVIDERS, { explicit: 'Internal Medicine — NPI 1740059005' }).ok, true);
  const unknown = resolveBillingProvider(PROVIDERS, { explicit: '1234567893' });
  assert.match('error' in unknown ? unknown.error : '', /not a configured billing provider/);
  const dept = resolveBillingProvider(PROVIDERS, { department: 'internal_medicine', clinicianRole: 'PSYCHIATRIST' });
  assert.equal('provider' in dept ? dept.provider.npi : '', '1740059005');
  const loc = resolveBillingProvider(PROVIDERS, { locationKeys: ['Takoma-Park'] });
  assert.equal('provider' in loc ? loc.provider.npi : '', '1740059005');
  const def = resolveBillingProvider(PROVIDERS, {});
  assert.equal('provider' in def ? def.provider.npi : '', '1801621297');
  const noDefault = resolveBillingProvider(PROVIDERS.map((p) => ({ ...p, isDefault: false })), {});
  assert.match('error' in noDefault ? noDefault.error : '', /ambiguous/);
  // submissionData.department routes the claim
  const r = mapOk(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'], department: 'psychiatry' } }));
  assert.equal(r.claim.billingProvider?.npi, '1346021813');
  // An invalid configured provider blocks the claim
  const bad = [{ ...PROVIDERS[0], zip: '20716' }];
  assert.match(errorsOf(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] } }), { ...CTX, billingProviders: bad }), /ZIP must be ZIP\+4/);
});

test('CLM01 is the <= 20-char control number; longer or missing numbers are blocked', () => {
  const r = mapOk(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] } }));
  const clm = stSegments(generate837P([r.claim], 1).content).find((x) => x.startsWith('CLM*'))!;
  const clm01 = clm.split('*')[1];
  assert.equal(clm01, 'AX0123456789ABCDEF');
  assert.ok(clm01.length <= 20);
  assert.ok(CONTROL_NUMBER_RE.test(clm01));
  assert.match(errorsOf(baseClaim({ claimControlNumber: 'cmclaimabc123def456ghi78' })), /must be 1-20 letters\/digits/);
  assert.match(errorsOf(baseClaim({ claimControlNumber: null })), /Claim control number \(CLM01\) is not assigned/);
});

test('payer ID auto-fills from the Waystar mapping; unverified IDs are test-only; unmapped payers fail clearly', () => {
  const r = mapOk(baseClaim({ payer: 'MD Medicaid', submissionData: { diagnosisCodes: ['F33.1'], claimFilingCode: 'CI' } }));
  assert.equal(r.claim.payerId, '100198');
  assert.equal(r.claim.claimFilingCode, 'MC');
  assert.match(r.warnings.join(' '), /100198 for Maryland Medicaid is unverified/);
  assert.match(errorsOf(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] } }), { ...CTX, usageIndicator: 'P' }), /100198 for Maryland Medicaid is not verified/);
  assert.match(errorsOf(baseClaim({ payer: 'Unknown Health Plan', submissionData: { diagnosisCodes: ['F33.1'] } })), /no payer mapping for "Unknown Health Plan"/);
  assert.equal(findPayerMapping(MAPPINGS, 'maryland  medicaid')?.waystarPayerId, '100198');
  assert.equal(findPayerMapping(MAPPINGS, 'Maryland Medicaid ASO'), null);
  // A staff-entered payer ID still wins (and is flagged when it differs)
  const typed = mapOk(baseClaim({ submissionData: { payerId: 'OTHER1', claimFilingCode: 'MC', diagnosisCodes: ['F33.1'] } }));
  assert.equal(typed.claim.payerId, 'OTHER1');
  assert.match(typed.warnings.join(' '), /differs from the mapping/);
});

test('X12 delimiters in free text cannot break a segment', () => {
  const r = mapOk(baseClaim({ client: { ...baseClaim().client, addressLine1: '1 Test St*Apt~2:B' }, submissionData: { diagnosisCodes: ['F33.1'] } }));
  const st = stSegments(generate837P([r.claim], 1).content);
  assert.ok(st.includes('N3*1 TEST ST APT 2 B'));
});

// ─── Claim diagnoses from the signed note (pointer order) ────────────────────

test('note diagnoses: clinician order kept (primary first), deduped, max 12, up to 4 line pointers', async () => {
  const { claimDiagnosesFromNote } = await import('../src/lib/billing/noteDiagnoses');
  assert.equal(claimDiagnosesFromNote([]), null);
  assert.equal(claimDiagnosesFromNote(null), null);
  assert.equal(claimDiagnosesFromNote(['bad', '']), null);
  assert.deepEqual(claimDiagnosesFromNote(['f41.1', 'F33.1', 'F41.1', 'junk']), { codes: ['F41.1', 'F33.1'], linePointers: [1, 2] });
  const many = Array.from({ length: 14 }, (_, i) => `F4${i % 10}.${Math.floor(i / 10)}`);
  const r = claimDiagnosesFromNote(many);
  assert.equal(r?.codes.length, 12);
  assert.equal(r?.codes[0], 'F40.0');
  assert.deepEqual(r?.linePointers, [1, 2, 3, 4]);
});

test('837P keeps the note diagnosis order and the claim-level pointers on a single-line claim', () => {
  const r = mapOk(baseClaim({ icd10Codes: ['F41.1', 'F33.1', 'Z63.0'], submissionData: { diagnosisCodes: ['F41.1', 'F33.1', 'Z63.0'], diagnosisPointers: [1, 2, 3] } }));
  assert.deepEqual(r.claim.diagnoses, ['F411', 'F331', 'Z630']);
  assert.deepEqual(r.claim.lines[0].diagnosisPointers, [1, 2, 3]);
  // No claim-level pointers (chart-based / billing-entered claims): primary only, as before
  assert.deepEqual(mapOk(baseClaim({ submissionData: { diagnosisCodes: ['F33.1'] } })).claim.lines[0].diagnosisPointers, [1]);
});

test('claim-level pointers are bounded by the claim diagnoses', async () => {
  const { claimLevelPointers } = await import('../src/lib/billing/waystarSftpClaims');
  assert.deepEqual(claimLevelPointers([1, 2, 3, 4, 5], 6), [1, 2, 3, 4]);
  assert.deepEqual(claimLevelPointers([3, 1], 2), [1]);
  assert.deepEqual(claimLevelPointers('x', 3), [1]);
  assert.deepEqual(claimLevelPointers([2, 2, 1], 3), [2, 1]);
});
