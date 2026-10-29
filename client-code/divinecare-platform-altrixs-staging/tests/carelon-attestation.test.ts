/**
 * Carelon Behavioral Health - Maryland "Attestation to Discharge Conflicting/Overlapping
 * Authorization(s) Due to Non-Overlap Requirement": Medicaid detection, prefill (no invented
 * Participant ID), status flow, frozen text, authorized-representative fields, the PDF text,
 * banner / inbox visibility, program triggers ("needs new") and report counts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  CARELON_CURRENT_VERSION,
  CARELON_FORM_KEY,
  CARELON_TEMPLATES,
  allStatements,
  carelonTemplate,
  type CarelonTemplate,
} from '../src/lib/consents/carelon/template';
import { detectMarylandMedicaid, isOtherStatePayer, marylandMedicaidPayerLabel, MEDICAID_RULE_EXPLANATION, type MedicaidClientInput } from '../src/lib/consents/carelon/medicaid';
import { defaultProviderOption, formatDateOnlyMdY, formatPracticeMdY, participantPrefill, prefillBlockers, providerOptions, providerPrefill } from '../src/lib/consents/carelon/prefill';
import {
  attestationRequirement,
  canManageCarelon,
  canMarkCarelonSubmitted,
  canSignCarelonProvider,
  CARELON_REPORT_ROLES,
  consentStatusFor,
  filterStatusRows,
  fillBlanks,
  freezeDocument,
  frozenBlanks,
  programTriggersAttestation,
  requestDecision,
  summarizeStatuses,
  transition,
  validatePartA,
  validatePartB,
  type AttestationRow,
  type CarelonAction,
  type CarelonStatus,
  type ClientStatusRow,
  type RequirementState,
  type StatusFilter,
} from '../src/lib/consents/carelon/workflow';
import { buildCarelonPdf } from '../src/lib/consents/carelon/pdf';
import { loadChartBanner, type BannerClientRow, type ChartBannerSource } from '../src/lib/clients/chartBanner';
import { carelonInboxDrafts } from '../src/lib/inbox/core';
import { sectionsForRole } from '../src/lib/inbox/sections';
import { getReport } from '../src/lib/reports/library/registry';
import { canRunReport } from '../src/lib/reports/library/access';

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-10-19T15:00:00Z');
const TZ = 'America/New_York';
const T = carelonTemplate()!;

const client = (over: Partial<MedicaidClientInput> = {}): MedicaidClientInput => ({
  medicaidId: null,
  insuranceType: null,
  insurancePayer: null,
  insuranceMemberId: null,
  insuranceEffectiveTo: null,
  coverages: [],
  ...over,
});

// ─── Form text ───────────────────────────────────────────────────────────────

test('template: exact Carelon wording, versioned', () => {
  assert.equal(CARELON_FORM_KEY, 'carelon-md-nonoverlap-attestation');
  assert.equal(CARELON_CURRENT_VERSION, '2025');
  assert.ok(CARELON_TEMPLATES['2025']);
  assert.equal(T.title, 'Carelon Behavioral Health - Maryland');
  assert.equal(T.subtitle, 'Attestation to Discharge Conflicting/Overlapping Authorization(s) Due to Non-Overlap Requirement');
  assert.equal(T.footer, 'maryland.carelonbh.com');
  assert.deepEqual(T.participantInfo.fields.map((f) => f.label), ['Participant Full Name', 'Participant ID', 'Date of Birth (MM/DD/YYYY)']);
  assert.deepEqual(T.providerInfo.fields.map((f) => f.label), ['Provider Organization Name', 'Provider NPI / Provider Identifier', 'Provider TIN Number']);
  assert.equal(T.purpose.paragraphs[2], 'If the participant has any questions, they can call customer service at 1-800-888-1965 to ask for additional details.');
  assert.equal(T.partA.statements[0], '2. I am requesting to receive the indicated behavioral health service(s) with the provider identified above.');
  assert.equal(T.partA.statements[4], '6. I attest that this decision is voluntary and made without coercion.');
  assert.equal(T.partA.statement1.optionRepresentative, "The participant's Authorized Representative/legal guardian with legal authority to act on the participant's behalf.");
  assert.equal(T.partB.statements.length, 4);
  assert.deepEqual(T.partA.fields.map((f) => f.label), [
    'Printed Name (participant or Authorized Representative)',
    'If Authorized Representative, relationship to participant',
    'If Authorized Representative, brief description of authority',
    'Signature',
    'Date Signed (MM/DD/YYYY)',
  ]);
  assert.deepEqual(T.partB.fields.map((f) => f.label), ['Printed Name (Provider/Representative)', 'Title', 'Signature', 'Date Signed (MM/DD/YYYY)']);
  assert.equal(carelonTemplate('1999'), null);
});

// ─── Medicaid detection ──────────────────────────────────────────────────────

test('medicaid: MC claim filing code on an active coverage counts', () => {
  const d = detectMarylandMedicaid(client({ coverages: [{ payerName: 'Some Plan', memberId: 'M1', claimFilingCode: 'MC', active: true }] }), { now: NOW });
  assert.equal(d.medicaid, true);
  assert.deepEqual(d.sources, ['coverage']);
  assert.equal(d.coverageMemberId, 'M1');
});

test('medicaid: HealthChoice MCOs, Carelon / PBHS and Maryland Medicaid by name', () => {
  for (const name of [
    'Priority Partners',
    'Wellpoint Maryland',
    'Amerigroup',
    'CareFirst Community Health Plan Maryland',
    'Maryland Physicians Care',
    'MedStar Family Choice (MD/DC Medicaid)',
    'UnitedHealthcare Community Plan',
    'Aetna Better Health of Maryland',
    'Jai Medical Systems',
    'Kaiser Permanente HealthChoice',
    'Carelon Behavioral Health',
    'Maryland Public Behavioral Health System',
    'Optum Maryland',
    'Medicaid (Maryland)',
    'Maryland Medicaid (DHMH/MDH)',
  ]) {
    assert.ok(marylandMedicaidPayerLabel(name), name);
    assert.equal(detectMarylandMedicaid(client({ insurancePayer: name }), { now: NOW }).medicaid, true, name);
  }
});

test('medicaid: commercial and other-state Medicaid do not count', () => {
  for (const name of ['CareFirst BCBS', 'Aetna', 'Cigna', 'United Healthcare', 'Medicare', 'DC Medicaid (DHCF)', 'Virginia Medicaid (DMAS)', 'Anthem HealthKeepers Plus (VA Medicaid)', 'Trusted Health Plan (DC Medicaid)', 'Community HealthChoices (PA LTSS Medicaid)']) {
    assert.equal(detectMarylandMedicaid(client({ insurancePayer: name }), { now: NOW }).medicaid, false, name);
  }
  assert.equal(isOtherStatePayer('DC Medicaid (DHCF)'), true);
  assert.equal(isOtherStatePayer('MedStar Family Choice (MD/DC Medicaid)'), false);
  // MC filing code on a DC Medicaid coverage is not Maryland
  assert.equal(detectMarylandMedicaid(client({ coverages: [{ payerName: 'DC Medicaid (DHCF)', memberId: 'X', claimFilingCode: 'MC', active: true }] }), { now: NOW }).medicaid, false);
});

test('medicaid: inactive coverage and an ended primary payer do not count; MA number always does', () => {
  assert.equal(detectMarylandMedicaid(client({ coverages: [{ payerName: 'Priority Partners', memberId: 'X', claimFilingCode: 'MC', active: false }] }), { now: NOW }).medicaid, false);
  assert.equal(detectMarylandMedicaid(client({ insurancePayer: 'Priority Partners', insuranceEffectiveTo: new Date('2026-01-31T00:00:00Z') }), { now: NOW }).medicaid, false);
  const ma = detectMarylandMedicaid(client({ medicaidId: '12345678901' }), { now: NOW });
  assert.equal(ma.medicaid, true);
  assert.deepEqual(ma.sources, ['medicaid_id']);
});

test('medicaid: insurance type Medicaid and a payer mapped to MC count', () => {
  assert.equal(detectMarylandMedicaid(client({ insuranceType: 'Medicaid', insurancePayer: 'Acme Health' }), { now: NOW }).medicaid, true);
  const mapped = detectMarylandMedicaid(client({ insurancePayer: 'Acme Health' }), { now: NOW, filingCodeForPayer: (n) => (n === 'Acme Health' ? 'MC' : null) });
  assert.equal(mapped.medicaid, true);
  assert.deepEqual(mapped.sources, ['primary_payer']);
  assert.equal(detectMarylandMedicaid(client({ insurancePayer: 'Acme Health' }), { now: NOW, filingCodeForPayer: () => 'CI' }).medicaid, false);
  assert.ok(MEDICAID_RULE_EXPLANATION.join(' ').includes('claim filing code MC'));
});

// ─── Prefill ─────────────────────────────────────────────────────────────────

const chartClient = { name: 'Jane Q Doe', legalFirstName: 'Jane', legalLastName: 'Doe', dateOfBirth: new Date('1990-03-07T00:00:00Z'), medicaidId: null as string | null };

test('prefill: participant name, MA number, DOB in MM/DD/YYYY', () => {
  const p = participantPrefill({ ...chartClient, medicaidId: '12345678901' }, 'MCO-9');
  assert.equal(p.participantName, 'Jane Doe');
  assert.equal(p.participantId, '12345678901');
  assert.equal(p.participantIdSource, 'medicaid_id');
  assert.equal(p.dateOfBirth, '03/07/1990');
});

test('prefill: falls back to the Medicaid coverage member ID, never invents a Participant ID', () => {
  const fallback = participantPrefill(chartClient, 'MCO-9');
  assert.equal(fallback.participantId, 'MCO-9');
  assert.equal(fallback.participantIdSource, 'coverage_member_id');
  const none = participantPrefill(chartClient, null);
  assert.equal(none.participantId, null);
  assert.equal(none.participantIdSource, null);
  // A malformed MA number is not used (and is not "fixed" into something else)
  const bad = participantPrefill({ ...chartClient, medicaidId: '123' }, null);
  assert.equal(bad.participantId, null);
  assert.ok(bad.warnings.some((w) => /not 11 digits/.test(w)));
  const blockers = prefillBlockers(none, providerPrefill(null));
  assert.ok(blockers.some((b) => /Participant ID is missing/.test(b)));
  assert.ok(blockers.some((b) => /Provider NPI is missing/.test(b)));
  assert.ok(blockers.some((b) => /Provider TIN is missing/.test(b)));
});

test('prefill: provider options (billing provider for the site, default, practice settings, verified site NPI)', () => {
  const opts = providerOptions({
    billingProviders: [
      { npi: '1234567893', name: 'MD Behavioral Health LLC', label: 'Behavioral health', taxId: '521234567', isDefault: true, active: true, locationKeys: [] },
      { npi: '1245319599', name: 'MD Behavioral Health LLC', label: 'Silver Spring', taxId: '521234567', isDefault: false, active: true, locationKeys: ['Silver Spring'] },
      { npi: '0000000000', name: 'Bad', label: null, taxId: '1', isDefault: false, active: true, locationKeys: [] },
    ],
    practice: { legalName: 'MD Behavioral Health LLC', dbaName: null, organizationNpi: '1234567893', taxId: '521234567' },
    organizationName: 'MDBH',
    locations: [{ id: 'loc-b', name: 'Bowie', code: 'BOW', npi: '1003000126', npiVerified: true, active: true }, { id: 'loc-x', name: 'X', code: null, npi: '1003000134', npiVerified: false, active: true }],
  });
  assert.deepEqual(opts.map((o) => o.key), ['bp:1234567893', 'bp:1245319599', 'site:loc-b']);
  assert.equal(defaultProviderOption(opts, { id: 'loc-ss', name: 'Silver Spring', code: null })?.key, 'bp:1245319599');
  assert.equal(defaultProviderOption(opts, { id: 'loc-b', name: 'Bowie', code: 'BOW' })?.key, 'bp:1234567893');
  const site = opts.find((o) => o.key === 'site:loc-b')!;
  assert.equal(site.tin, '521234567');
  const pp = providerPrefill(defaultProviderOption(opts, null));
  assert.deepEqual(prefillBlockers(participantPrefill({ ...chartClient, medicaidId: '12345678901' }, null), pp), []);
});

test('prefill: dates are MM/DD/YYYY; signing dates on the practice clock', () => {
  assert.equal(formatDateOnlyMdY(new Date('2001-12-31T00:00:00Z')), '12/31/2001');
  // 02:30 UTC Oct 20 is still Oct 19 in Maryland
  assert.equal(formatPracticeMdY(new Date('2026-10-20T02:30:00Z'), TZ), '10/19/2026');
});

// ─── Status flow ─────────────────────────────────────────────────────────────

test('status flow: not started → sent → client signed → complete → submitted → superseded', () => {
  const step = (s: CarelonStatus, a: CarelonAction) => {
    const r = transition(s, a);
    assert.equal(r.ok, true, `${s} ${a}`);
    return (r as { next: CarelonStatus }).next;
  };
  let s: CarelonStatus = 'NOT_STARTED';
  s = step(s, 'send');
  assert.equal(s, 'SENT');
  s = step(s, 'sign_participant');
  assert.equal(s, 'CLIENT_SIGNED');
  s = step(s, 'sign_provider');
  assert.equal(s, 'COMPLETE');
  s = step(s, 'mark_submitted');
  assert.equal(s, 'SUBMITTED');
  s = step(s, 'supersede');
  assert.equal(s, 'SUPERSEDED');
  // In office: straight from not started to client signed
  assert.equal(step('NOT_STARTED', 'sign_participant'), 'CLIENT_SIGNED');
});

test('status flow: illegal steps are refused', () => {
  assert.equal(transition('NOT_STARTED', 'sign_provider').ok, false, 'provider signs after the participant');
  assert.equal(transition('SENT', 'mark_submitted').ok, false, 'submission only after completion');
  assert.equal(transition('COMPLETE', 'void').ok, false, 'a completed attestation is superseded, not cancelled');
  assert.equal(transition('CLIENT_SIGNED', 'sign_participant').ok, false);
  assert.equal(transition('SUBMITTED', 'send').ok, false);
  assert.equal(consentStatusFor('COMPLETE'), 'SIGNED');
  assert.equal(consentStatusFor('SENT'), 'PENDING');
  assert.equal(consentStatusFor('SUPERSEDED'), 'EXPIRED');
});

test('requirement: complete / not started / pending / needs new', () => {
  const row = (id: string, formStatus: CarelonStatus, day: number): AttestationRow => ({ id, formStatus, createdAt: new Date(Date.UTC(2026, 9, day)), signedAt: null, submittedAt: null, neededReason: null });
  assert.equal(attestationRequirement(true, []).state, 'not_started');
  assert.equal(attestationRequirement(true, [row('a', 'SENT', 1)]).state, 'pending_client');
  assert.equal(attestationRequirement(true, [row('a', 'CLIENT_SIGNED', 1)]).state, 'pending_provider');
  const done = attestationRequirement(true, [row('a', 'SUBMITTED', 1), row('old', 'SUPERSEDED', 1)]);
  assert.equal(done.state, 'complete');
  assert.equal(done.submitted, true);
  assert.equal(done.needsAction, false);
  assert.equal(attestationRequirement(true, [row('a', 'COMPLETE', 1), row('b', 'NOT_STARTED', 5)]).state, 'needs_new');
  assert.equal(attestationRequirement(true, [row('v', 'VOIDED', 1)]).state, 'not_started');
  assert.equal(attestationRequirement(false, [row('b', 'NOT_STARTED', 5)]).state, 'not_required');
});

// ─── Frozen text and signatures ──────────────────────────────────────────────

test('signing freezes the exact text and values; later template edits never change it', () => {
  const live: CarelonTemplate = JSON.parse(JSON.stringify(T));
  const doc = freezeDocument(live, { participantName: 'Jane Doe', participantId: '12345678901', dateOfBirth: '03/07/1990' }, { organizationName: 'MDBH', npi: '1234567893', tin: '521234567' }, NOW);
  live.partA.statements[0] = 'CHANGED';
  live.title = 'CHANGED';
  assert.equal(doc.template.partA.statements[0], T.partA.statements[0]);
  assert.equal(doc.template.title, 'Carelon Behavioral Health - Maryland');
  assert.equal(doc.template.version, '2025');
  assert.equal(doc.frozenAt, NOW.toISOString());
  // Only blanks are ever filled afterwards
  const partial = freezeDocument(T, { participantName: 'Jane Doe', participantId: null, dateOfBirth: '03/07/1990' }, { organizationName: 'MDBH', npi: null, tin: '521234567' }, NOW);
  assert.deepEqual(frozenBlanks(partial), ['Participant ID', 'Provider NPI']);
  const filled = fillBlanks(partial, { participantName: 'Someone Else', participantId: '12345678901' }, { npi: '1234567893', tin: '999999999' });
  assert.deepEqual(filled.filled.sort(), ['npi', 'participantId']);
  assert.equal(filled.doc.participant.participantName, 'Jane Doe');
  assert.equal(filled.doc.provider.tin, '521234567');
  assert.deepEqual(frozenBlanks(filled.doc), []);
});

test('Part A: an Authorized Representative needs relationship and a description of authority', () => {
  const base = { printedName: 'Mary Doe', signature: 'Mary Doe', agree: true };
  assert.deepEqual(validatePartA({ ...base, signerType: 'participant' }), []);
  const rep = validatePartA({ ...base, signerType: 'representative' });
  assert.ok(rep.some((e) => /Relationship/.test(e)));
  assert.ok(rep.some((e) => /legal authority/.test(e)));
  assert.deepEqual(validatePartA({ ...base, signerType: 'representative', relationship: 'Parent', authority: 'Parent of a minor (age 15)' }), []);
  assert.ok(validatePartA({ ...base, signerType: 'participant', agree: false }).some((e) => /agree/.test(e)));
  assert.ok(validatePartA({ ...base, signerType: 'participant', signature: 'Someone' }).some((e) => /must match/.test(e)));
  assert.deepEqual(validatePartB({ printedName: 'Dr. A', title: 'LCPC', signature: 'dr. a', agree: true }), []);
  assert.ok(validatePartB({ printedName: 'Dr. A', title: '', signature: 'Dr. A', agree: true }).some((e) => /Title/.test(e)));
});

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** Text drawn in a pdf-lib PDF: inflate each stream, decode the hex strings of Tj / TJ. */
function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const out: string[] = [];
  let i = 0;
  while ((i = buf.indexOf('stream', i)) !== -1) {
    let start = i + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf('endstream', start);
    if (end === -1) break;
    const raw = buf.subarray(start, end);
    let data: Buffer | null = null;
    try {
      data = zlib.inflateSync(raw);
    } catch {
      data = raw;
    }
    for (const m of data.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(m[1], 'hex').toString('latin1'));
    i = end + 9;
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

test('PDF: three pages with the exact statements, fields, signatures and footer', async () => {
  const bytes = await buildCarelonPdf({
    template: T,
    participant: { participantName: 'Jane Doe', participantId: '12345678901', dateOfBirth: '03/07/1990' },
    provider: { organizationName: 'MD Behavioral Health LLC', npi: '1234567893', tin: '521234567' },
    partA: { signerType: 'representative', printedName: 'Mary Doe', relationship: 'Parent', authority: 'Parent of a minor', signature: 'Mary Doe', method: 'portal', signedAt: '2026-10-19T14:00:00.000Z', dateSigned: '10/19/2026', recordedById: null, recordedByName: null },
    partB: { printedName: 'Alex Provider', title: 'LCPC', signature: 'Alex Provider', signedAt: '2026-10-19T15:00:00.000Z', dateSigned: '10/19/2026', userId: 'u1', role: 'THERAPIST' },
    submission: null,
    recordId: 'att1',
    timeZone: TZ,
    generatedAt: NOW,
  });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3);
  const text = pdfText(bytes);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const s of [T.title, T.subtitle, ...allStatements(T), ...T.participantInfo.fields.map((f) => f.label), ...T.providerInfo.fields.map((f) => f.label), ...T.partA.fields.map((f) => f.label), ...T.partB.fields.map((f) => f.label)]) {
    assert.ok(text.includes(norm(s)), `PDF is missing: ${s.slice(0, 80)}`);
  }
  for (const v of ['Jane Doe', '12345678901', '03/07/1990', 'MD Behavioral Health LLC', '1234567893', '52-1234567', 'Mary Doe', 'Parent of a minor', 'Alex Provider', 'LCPC', '10/19/2026', 'maryland.carelonbh.com', 'Page 1 of 3', 'Page 3 of 3']) {
    assert.ok(text.includes(v), `PDF is missing value: ${v}`);
  }
});

test('PDF: an unsigned prefilled copy still has every statement and blank signature lines', async () => {
  const bytes = await buildCarelonPdf({ template: T, participant: { participantName: 'Jane Doe', participantId: null, dateOfBirth: null }, provider: { organizationName: null, npi: null, tin: null }, partA: null, partB: null, recordId: null, timeZone: TZ, generatedAt: NOW });
  const text = pdfText(bytes);
  assert.ok(text.includes(T.partB.statements[3].replace(/\s+/g, ' ')));
  assert.ok(!text.includes('Electronic signature record'));
});

// ─── Banner / inbox visibility ───────────────────────────────────────────────

const bannerClient: BannerClientRow = {
  id: 'c1', name: 'Jane Doe', legalFirstName: 'Jane', middleInitial: null, legalLastName: 'Doe', mrn: 'ALT-1', dateOfBirth: new Date('1990-03-07T00:00:00Z'),
  status: 'ACTIVE', riskLevel: 'LOW', assignedToId: 'u-ther', assignedToName: 'T', locationName: 'Bowie', insurancePayer: 'Priority Partners', insuranceMemberId: '1',
  primaryDiagnosis: null, primaryDiagnosisCode: null, secondaryDiagnoses: null,
};

function bannerSource(state: RequirementState | null): ChartBannerSource {
  return {
    findClient: async (org, id) => (org === 'org-a' && id === 'c1' ? bannerClient : null),
    sensitiveState: async () => 'none',
    sensitiveAlias: async () => null,
    hasForwardedThread: async () => false,
    allergies: async () => [],
    priorAuths: async () => [],
    riskAlerts: async () => [],
    latestCssrs: async () => null,
    nextAppointment: async () => null,
    balanceCents: async () => null,
    sessionFrequency: async () => null,
    carelonAttestation: async () => state,
  };
}
const viewer = (role: string) => ({ organizationId: 'org-a', userId: 'u-ther', role, billingVisible: false });

test('banner: "Carelon non-overlap attestation needed" only for Medicaid clients needing it', async () => {
  const flagged = await loadChartBanner(bannerSource('not_started'), viewer('FRONT_DESK'), 'c1', NOW);
  assert.ok(flagged.ok && !flagged.banner.locked);
  assert.equal((flagged as { banner: { carelonAttestation: { state: string } | null } }).banner.carelonAttestation?.state, 'not_started');
  const newNeeded = await loadChartBanner(bannerSource('needs_new'), viewer('THERAPIST'), 'c1', NOW);
  assert.equal((newNeeded as { banner: { carelonAttestation: { label: string } | null } }).banner.carelonAttestation?.label, 'New attestation needed');
  for (const s of ['complete', 'not_required', null] as const) {
    const r = await loadChartBanner(bannerSource(s), viewer('FRONT_DESK'), 'c1', NOW);
    assert.equal((r as { banner: { carelonAttestation: unknown } }).banner.carelonAttestation, null, String(s));
  }
  // Billing (no access to the form page) and peer support (minimum necessary) never see it
  const billing = await loadChartBanner(bannerSource('not_started'), viewer('BILLING'), 'c1', NOW);
  if (billing.ok && !billing.banner.locked) assert.equal((billing.banner as { carelonAttestation: unknown }).carelonAttestation, null);
  const peer = await loadChartBanner({ ...bannerSource('not_started'), hasCareTeamLink: async () => true }, viewer('PEER_SUPPORT'), 'c1', NOW);
  if (peer.ok && !peer.banner.locked) assert.equal((peer.banner as { carelonAttestation: unknown }).carelonAttestation, null);
});

const statusRow = (id: string, state: ClientStatusRow['state'], over: Partial<ClientStatusRow> = {}): ClientStatusRow => ({
  clientId: id, clientName: `Client ${id}`, mrn: null, payerName: 'Priority Partners', medicaidReasons: state === 'not_required' ? [] : ['x'],
  state, openStatus: null, openId: null, currentId: null, completedAt: null, submitted: false, submittedAt: null, neededReason: null, ...over,
});

test('inbox: one item per Medicaid client needing it; none for complete / non-Medicaid clients', () => {
  const rows = [
    statusRow('a', 'not_started'),
    statusRow('b', 'complete', { currentId: 'x' }),
    statusRow('c', 'not_required'),
    statusRow('d', 'needs_new', { neededReason: 'Started PRP enrollment', currentId: 'y', openId: 'z' }),
    statusRow('e', 'pending_client'),
  ];
  const { drafts, notice } = carelonInboxDrafts(rows, new Map([['a', '2026-10-21T14:00:00.000Z']]));
  assert.deepEqual(drafts.map((d) => d.clientId).sort(), ['a', 'd', 'e']);
  assert.equal(notice, null);
  assert.equal(drafts.find((d) => d.clientId === 'a')?.priority, 'high', 'visit in the next 7 days');
  assert.equal(drafts.find((d) => d.clientId === 'd')?.priority, 'high');
  assert.equal(drafts.find((d) => d.clientId === 'e')?.priority, 'low');
  assert.match(drafts.find((d) => d.clientId === 'd')!.detail!, /PRP/);
  assert.ok(drafts.every((d) => d.href.startsWith('/dashboard/ehr/consents/carelon/')));
});

test('inbox: section for front desk, office manager and leadership only', () => {
  const has = (role: string) => sectionsForRole(role).some((s) => s.key === 'medicaid_attestations');
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'PRACTICE_DIRECTOR']) assert.equal(has(r), true, r);
  for (const r of ['THERAPIST', 'BILLING', 'PEER_SUPPORT', 'HR', 'PSYCHIATRIST']) assert.equal(has(r), false, r);
});

// ─── Program triggers ────────────────────────────────────────────────────────

test('a PRP enrollment triggers "needs new" for a Medicaid client with an attestation on file', () => {
  assert.equal(programTriggersAttestation('prp'), true);
  assert.equal(programTriggersAttestation('iop'), true);
  assert.equal(programTriggersAttestation('residential'), true);
  assert.equal(programTriggersAttestation('spravato'), false);
  const complete: AttestationRow = { id: 'a', formStatus: 'SUBMITTED', createdAt: new Date('2026-10-01T00:00:00Z'), signedAt: new Date('2026-10-01T00:00:00Z'), submittedAt: new Date('2026-10-02T12:00:00Z'), neededReason: null };
  assert.equal(attestationRequirement(true, [complete]).state, 'complete');
  assert.equal(requestDecision(true, [complete]), 'create');
  const requested: AttestationRow = { id: 'b', formStatus: 'NOT_STARTED', createdAt: NOW, signedAt: null, submittedAt: null, neededReason: 'Started Psychiatric Rehabilitation Program (PRP) enrollment (service with non-overlap rules)' };
  const after = attestationRequirement(true, [complete, requested]);
  assert.equal(after.state, 'needs_new');
  assert.equal(after.needsAction, true);
  // A second trigger adds its reason to the open request instead of opening another
  assert.equal(requestDecision(true, [complete, requested]), 'already_open');
  // Not Medicaid: the automatic trigger does nothing; staff may still open one by hand
  assert.equal(requestDecision(false, [complete]), 'not_medicaid');
  assert.equal(requestDecision(false, [], { manual: true }), 'create');
});

test('the enrollment / referral / admission routes call the trigger', () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  assert.match(read('src/app/api/prp/enrollments/route.ts'), /promptCarelonForProgram\(\{[^}]*program: 'prp', trigger: 'prp_enrollment'/);
  assert.match(read('src/app/api/prp/referrals/route.ts'), /program: 'prp', trigger: 'prp_referral'/);
  assert.match(read('src/app/api/residential/residents/route.ts'), /program: 'residential', trigger: 'residential_admission'/);
  assert.match(read('src/app/api/ehr/scanner/service-eligibility/decision/route.ts'), /program: b\.program, trigger: 'service_eligibility_referral'/);
});

// ─── Report ──────────────────────────────────────────────────────────────────

test('report: KPI counts equal the rows of each filtered list', () => {
  const rows = [
    statusRow('a', 'not_started'),
    statusRow('b', 'complete', { currentId: 'x1', submitted: true, submittedAt: '2026-10-02T12:00:00.000Z' }),
    statusRow('c', 'complete', { currentId: 'x2' }),
    statusRow('d', 'needs_new', { currentId: 'x3', submitted: true, openId: 'o1', openStatus: 'NOT_STARTED' }),
    statusRow('e', 'pending_client', { openId: 'o2', openStatus: 'SENT' }),
    statusRow('f', 'pending_provider', { openId: 'o3', openStatus: 'CLIENT_SIGNED' }),
    statusRow('g', 'not_required'),
  ];
  const s = summarizeStatuses(rows);
  const n = (f: StatusFilter) => filterStatusRows(rows, f).length;
  assert.equal(s.total, n('all'));
  assert.equal(s.total, 6);
  assert.equal(s.complete, n('complete'));
  assert.equal(s.pendingSignature, n('pending_signature'));
  assert.equal(s.notStarted, n('not_started'));
  assert.equal(s.needsNew, n('needs_new'));
  assert.equal(s.submitted, n('submitted'));
  assert.equal(s.completeNotSubmitted, n('not_submitted'));
  assert.equal(n('needs_action'), s.total - s.complete);
  assert.equal(s.complete + s.pendingSignature + s.notStarted + s.needsNew, s.total);
});

test('report: registered for front office, billing and leadership; not clinicians or HR', () => {
  const r = getReport('carelon-attestation-status')!;
  assert.ok(r);
  assert.equal(r.output, 'patient');
  for (const role of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'ADMIN', 'PRACTICE_DIRECTOR']) assert.equal(canRunReport(r, role), true, role);
  for (const role of ['THERAPIST', 'HR', 'PEER_SUPPORT']) assert.equal(canRunReport(r, role), false, role);
  assert.deepEqual([...r.access.roles].sort(), [...CARELON_REPORT_ROLES].sort());
});

// ─── Permissions ─────────────────────────────────────────────────────────────

test('permissions: front desk / office manager manage the form; billing and HR cannot', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'THERAPIST', 'PRACTICE_DIRECTOR', 'ADMIN']) {
    assert.equal(canManageCarelon(r), true, r);
    assert.equal(canSignCarelonProvider(r), true, r);
  }
  for (const r of ['BILLING', 'HR', 'PEER_SUPPORT', 'MEDICAL_ASSISTANT']) assert.equal(canManageCarelon(r), false, r);
  assert.equal(canMarkCarelonSubmitted('FRONT_DESK'), true);
  assert.equal(canMarkCarelonSubmitted('OFFICE_MANAGER'), true);
  assert.equal(canMarkCarelonSubmitted('THERAPIST'), false);
});

test('generic consent screens never sign or list the structured form', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/consents/manage.ts'), 'utf8');
  assert.match(src, /formKey: null/);
  assert.match(src, /if \(existing\.formKey\)/);
  const migration = fs.readFileSync(path.join(ROOT, 'prisma/migrations/20261019_carelon_attestation.sql'), 'utf8');
  for (const col of ['formKey', 'formVersion', 'formStatus', 'formData', 'submittedAt', 'pdfSha256']) assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
});
