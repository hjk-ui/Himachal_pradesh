/**
 * Consents brought to the industry standard: required-consent rules engine, standard status
 * (complete / missing / expiring / expired / revoked), ROI (45 CFR §164.508(c)) and Part 2
 * (42 CFR §2.31) element validation, e-signature evidence, hash stability, revocation that is
 * prospective and blocks disclosures, worklist counts = lists, bulk-send eligibility, completion
 * rate, no PHI in the "forms to sign" text, and the retired evidence-free legacy screens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { renderTemplate, templateVersion, TEMPLATE_KEYS, versionsOf } from '../src/lib/consents/library/catalog';
import { activeVersion, canSendTemplate, indexStates, type TemplateStateRow } from '../src/lib/consents/library/lifecycle';
import { composePacket, type PacketClientContext, type PacketItem } from '../src/lib/consents/library/composer';
import { mergeRequirements, requiredConsents, REQUIREMENT_RULES, STAFF_PREPARED_KEYS, EXPIRING_WITHIN_DAYS } from '../src/lib/consents/library/requirements';
import { computeClientConsents, standardStatusOf, type ComplianceRow, type ConsentRowLite } from '../src/lib/consents/library/status';
import { HIPAA_AUTHORIZATION_ELEMENTS, PART2_CONSENT_ELEMENTS, PART2_REDISCLOSURE_NOTICE, missingElements, templateElementGaps } from '../src/lib/consents/library/elements';
import { validatePacketSubmission, type PacketSubmission } from '../src/lib/consents/library/signing';
import { buildEvidence, evidenceLines, validateStaffEvidence } from '../src/lib/consents/library/evidence';
import { freeze, frozenIntact, hashRendered } from '../src/lib/consents/library/freeze';
import { disclosureConsentCheck, revocationEffects } from '../src/lib/consents/library/revocation';
import { buildWorklist, bulkItemKeys, completionBy, isBulkSendable, type WorklistFacets } from '../src/lib/consents/library/worklistCore';
import { smsEligibility } from '../src/lib/sms/consent';
import { lintPatientSms, PATIENT_SMS_PURPOSES } from '../src/lib/sms/contentRules';
import { documentsToSignSms } from '../src/lib/sms/templates';
import { documentsToSignEmail } from '../src/lib/consents/library/delivery';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = new Date('2026-10-21T15:00:00Z');
const VARS = { practiceName: 'MD Behavioral Health LLC', practicePhone: '301-249-8100', nppUrl: 'https://example.org/npp.pdf', nppEffectiveDate: '10/01/2026' };

function allActiveStates(): Map<string, TemplateStateRow> {
  const rows: TemplateStateRow[] = [];
  for (const key of TEMPLATE_KEYS) {
    const vs = versionsOf(key);
    const latest = vs[vs.length - 1];
    for (const v of vs) rows.push({ templateKey: key, version: v.version, status: v.version === latest.version ? 'ACTIVE' : 'RETIRED' });
  }
  return indexStates(rows);
}
function resolver(states: Map<string, TemplateStateRow>) {
  return (key: string) => {
    const t = activeVersion(key, states);
    if (!t) return { reason: 'no active version' };
    const c = canSendTemplate(t, states, { nppReady: true });
    return c.ok === false ? { reason: c.reason } : { template: t };
  };
}
const ctx = (over: Partial<PacketClientContext> = {}): PacketClientContext => ({ ageYears: 34, services: ['omhc'], medicaid: false, emergencyContact: null, ...over });
const keys = (c: PacketClientContext) => requiredConsents(c).map((r) => r.key).sort();
let seq = 0;
function row(p: Partial<ConsentRowLite>): ConsentRowLite {
  seq += 1;
  return { id: `r${seq}`, formKey: null, type: 'x', formVersion: '1', status: 'SIGNED', formStatus: 'SIGNED', signedAt: new Date('2026-06-01'), expiresAt: null, revokedAt: null, createdAt: new Date(2026, 0, seq), signedByName: 'Pat Client', recipientName: null, ...p };
}

// ─── Rules engine ────────────────────────────────────────────────────────────

test('rules: baseline adult in outpatient care needs consent to treatment and the NPP acknowledgment', () => {
  assert.deepEqual(keys(ctx()), ['informed-consent-treatment', 'npp-acknowledgment']);
});

test('rules: each program / service / signal adds its consent', () => {
  assert.ok(keys(ctx({ services: ['omhc', 'telehealth'] })).includes('telehealth-consent'));
  assert.ok(keys(ctx({ ageYears: 15 })).includes('minor-consent-treatment'));
  assert.ok(!keys(ctx({ ageYears: 18 })).includes('minor-consent-treatment'));
  assert.ok(keys(ctx({ services: ['prp'] })).includes('rehabilitation-assessment-irp'));
  assert.ok(keys(ctx({ services: ['primary_care'] })).includes('primary-care-consent'));
  assert.ok(keys(ctx({ services: ['omhc', 'group'] })).includes('group-therapy-confidentiality'));
  assert.ok(keys(ctx({ services: ['omhc', 'medication'] })).includes('psychiatric-medication-consent'));
  assert.ok(keys(ctx({ signals: { smsConsent: true } })).includes('communication-consent'));
  assert.ok(keys(ctx({ signals: { autopay: true } })).includes('card-on-file-authorization'));
  const ai = keys(ctx({ signals: { aiScribe: true } }));
  assert.ok(ai.includes('ai-note-drafting-consent') && ai.includes('recording-transcription-consent'));
});

test('rules: Part 2 consent and ROIs are voluntary (never required); AOT adds nothing without a practice decision', () => {
  assert.ok(!keys(ctx({ services: ['sud'] })).includes('part2-consent'));
  assert.ok(!REQUIREMENT_RULES.some((r) => r.key === 'part2-consent' || r.key === 'roi-authorization'));
  assert.deepEqual(keys(ctx({ signals: { aot: true } })), keys(ctx()));
  // telehealth only (no other service) is not "in care" by itself
  assert.deepEqual(keys(ctx({ services: ['telehealth'] })), ['telehealth-consent']);
});

test('rules: staff-prepared forms (prescriber / card details) are never bulk-sent', () => {
  assert.deepEqual([...STAFF_PREPARED_KEYS].sort(), ['card-on-file-authorization', 'psychiatric-medication-consent']);
});

test('mergeRequirements: adds required consents missing from the packet; reports templates that cannot be sent', () => {
  const states = allActiveStates();
  const c = ctx({ services: ['omhc', 'medication'], signals: { smsConsent: true } });
  const composed = composePacket({ selection: ['informed-consent-treatment'], resolve: resolver(states), ctx: c, today: '2026-10-21' });
  const merged = mergeRequirements(composed, c, resolver(states));
  const k = merged.items.map((i) => i.key);
  for (const want of ['informed-consent-treatment', 'npp-acknowledgment', 'psychiatric-medication-consent', 'communication-consent']) assert.ok(k.includes(want), want);
  const med = merged.items.find((i) => i.key === 'psychiatric-medication-consent')!;
  assert.equal(med.anyRow, true);
  assert.equal(med.optional, false);
  // with the default (Draft) states the proposed templates cannot be sent: listed, never silently dropped
  const draft = mergeRequirements(composePacket({ selection: [], resolve: resolver(indexStates([])), ctx: c, today: '2026-10-21' }), c, resolver(indexStates([])));
  assert.ok(draft.requiredUnavailable!.some((u) => u.key === 'psychiatric-medication-consent'));
  assert.ok(draft.requiredUnavailable!.some((u) => u.key === 'communication-consent'));
  assert.ok(draft.items.some((i) => i.key === 'informed-consent-treatment'), 'practice-packet consent to treatment ships Active');
});

// ─── Status: complete / missing / expiring / expired / revoked ───────────────

test('standard status mapping', () => {
  assert.deepEqual(standardStatusOf('signed', null), { standard: 'complete', detail: null });
  assert.equal(standardStatusOf('signed', 31).standard, 'complete');
  assert.equal(standardStatusOf('signed', EXPIRING_WITHIN_DAYS).standard, 'expiring');
  assert.equal(standardStatusOf('signed', 3).detail, 'Expires in 3 days');
  assert.equal(standardStatusOf('expired', -2).standard, 'expired');
  assert.equal(standardStatusOf('revoked', null).standard, 'revoked');
  assert.equal(standardStatusOf('pending', null).standard, 'missing');
  assert.equal(standardStatusOf('needs_resign', null).detail, 'New version: client must re-sign');
  assert.equal(standardStatusOf('declined', null).detail, 'Client declined');
});

test('computeClientConsents: expiring / expired / revoked / any-row requirement', () => {
  const states = allActiveStates();
  const c = ctx({ services: ['omhc', 'medication', 'telehealth'] });
  const composed = mergeRequirements(composePacket({ selection: ['informed-consent-treatment', 'telehealth-consent'], resolve: resolver(states), ctx: c, today: '2026-10-21' }), c, resolver(states));
  const tVer = String(activeVersion('telehealth-consent', states)!.version);
  const items = computeClientConsents({
    composed,
    activeOf: (k) => activeVersion(k, states),
    now: NOW,
    rows: [
      row({ formKey: 'lib:informed-consent-treatment', formVersion: String(activeVersion('informed-consent-treatment', states)!.version), expiresAt: new Date('2026-11-05T12:00:00Z') }),
      row({ formKey: 'lib:telehealth-consent', formVersion: tVer, status: 'DECLINED', formStatus: 'REVOKED', revokedAt: new Date('2026-10-01') }),
      row({ formKey: 'lib:npp-acknowledgment', formVersion: '1', expiresAt: new Date('2026-10-01') }),
      // a psychotropic consent for one medication satisfies the medication-management rule
      row({ formKey: 'lib:psychiatric-medication-consent', formVersion: '1', recipientName: null }),
    ],
  });
  const by = Object.fromEntries(items.filter((i) => i.required).map((i) => [i.templateKey, i]));
  assert.equal(by['informed-consent-treatment'].standard, 'expiring');
  assert.equal(by['informed-consent-treatment'].daysToExpiry, 14);
  assert.equal(by['telehealth-consent'].standard, 'revoked');
  assert.equal(by['npp-acknowledgment'].standard, 'expired');
  assert.equal(by['psychiatric-medication-consent'].standard, 'complete');
  assert.equal(by['psychiatric-medication-consent'].required, true);
});

// ─── ROI / Part 2 elements ───────────────────────────────────────────────────

test('ROI and Part 2 templates carry every required element (static)', () => {
  const roi = templateVersion('roi-authorization', 1)!;
  const p2 = templateVersion('part2-consent', 1)!;
  assert.deepEqual(templateElementGaps(roi), []);
  assert.deepEqual(templateElementGaps(p2), []);
  assert.equal(HIPAA_AUTHORIZATION_ELEMENTS.length, 9);
  assert.equal(PART2_CONSENT_ELEMENTS.length, 10);
  // a template with a statement missing is caught
  const broken = { ...roi, blocks: roi.blocks.filter((b) => !(b.kind === 'p' && b.element === '164.508(c)(2)(iii)')) };
  assert.ok(templateElementGaps(broken).some((g) => g.startsWith('164.508(c)(2)(iii)')));
  assert.equal(PART2_REDISCLOSURE_NOTICE, '42 CFR part 2 prohibits unauthorized use or disclosure of these records.');
});

const ROI_FIELDS_OK = { patientName: 'Pat Client', disclosingParty: 'MD Behavioral Health LLC', direction: 'release', recipientName: 'Dr. Lee', information: ['summary'], purpose: 'Coordination of care', expirationDate: '2027-10-21' };

test('ROI: signing is blocked until every element is present, in plain language', () => {
  const roi = templateVersion('roi-authorization', 1)!;
  const r = renderTemplate(roi, VARS);
  const signer = { printedName: 'Pat Client', signature: 'Pat Client', signerType: 'self' as const };
  assert.deepEqual(missingElements(roi, r, ROI_FIELDS_OK, signer), []);
  const { purpose: _p, expirationDate: _e, ...noPurpose } = ROI_FIELDS_OK;
  void _p;
  void _e;
  const miss = missingElements(roi, r, noPurpose, signer).map((m) => m.label);
  assert.ok(miss.includes('why it is being shared'));
  assert.ok(miss.includes('when this permission ends (a date or an event)'));
  // representative without authority: the signature element is incomplete
  assert.ok(missingElements(roi, r, ROI_FIELDS_OK, { ...signer, signerType: 'representative', relationship: 'Parent', authority: '' }).some((m) => m.element === '164.508(c)(1)(vi)'));
});

test('Part 2: a named recipient needs the name; TPO designation is enough on its own', () => {
  const p2 = templateVersion('part2-consent', 1)!;
  const r = renderTemplate(p2, VARS);
  const base = { patientName: 'Pat Client', disclosingParty: 'MD Behavioral Health LLC', information: ['sud_treatment'], informationDetail: 'Diagnosis and dates of service', purpose: 'Treatment', expirationEvent: 'End of my treatment' };
  const signer = { printedName: 'Pat Client', signature: 'Pat Client', signerType: 'self' as const };
  assert.deepEqual(missingElements(p2, r, { ...base, recipientType: 'tpo' }, signer), []);
  assert.ok(missingElements(p2, r, { ...base, recipientType: 'named' }, signer).some((m) => m.element === 'part2.recipients'));
});

test('validatePacketSubmission blocks a standalone ROI missing an element (server and browser run the same code)', () => {
  const roi = templateVersion('roi-authorization', 1)!;
  const r = renderTemplate(roi, VARS);
  const item: PacketItem = { key: roi.key, version: 1, title: roi.title, signing: 'standalone', optional: true, reason: 'test' };
  const sub = (fields: Record<string, string | string[]>): PacketSubmission => ({
    sections: { [roi.key]: { version: 1, acknowledged: true, fields, signature: 'Pat Client' } },
    signer: { signerType: 'self', printedName: 'Pat Client', signature: 'Pat Client', agree: true },
  });
  assert.deepEqual(validatePacketSubmission([item], new Map([[roi.key, r]]), sub(ROI_FIELDS_OK), null), []);
  const { recipientName: _r, ...noRecipient } = ROI_FIELDS_OK;
  void _r;
  const errs = validatePacketSubmission([item], new Map([[roi.key, r]]), sub(noRecipient), null);
  assert.ok(errs.length > 0);
});

// ─── E-signature evidence + hash stability ───────────────────────────────────

test('staff evidence: verbal never for an authorization; paper needs the scan reference; interpreter needs a language', () => {
  const roi = templateVersion('roi-authorization', 1)!;
  const treat = templateVersion('informed-consent-treatment', 1)!;
  assert.deepEqual(validateStaffEvidence({ signatureMethod: 'in_office_tablet' }, [treat, roi]), []);
  assert.ok(validateStaffEvidence({ signatureMethod: 'verbal_witnessed', witnessName: 'Sam Staff' }, [treat, roi]).some((e) => /in writing/.test(e)));
  assert.deepEqual(validateStaffEvidence({ signatureMethod: 'verbal_witnessed', witnessName: 'Sam Staff' }, [treat]), []);
  assert.ok(validateStaffEvidence({ signatureMethod: 'verbal_witnessed' }, [treat]).some((e) => /witness/.test(e)));
  assert.ok(validateStaffEvidence({ signatureMethod: 'paper_scanned' }, [treat]).some((e) => /scanned/.test(e)));
  assert.ok(validateStaffEvidence({ signatureMethod: 'in_office_tablet', interpreter: { used: true, language: '', name: null } }, [treat]).some((e) => /language/.test(e)));
});

test('evidence + PDF audit trail: method, device, interpreter, full SHA-256 of each signed section', () => {
  const r = renderTemplate(templateVersion('informed-consent-treatment', 1)!, VARS);
  const f = freeze(r, NOW);
  const e = buildEvidence({
    signatureMethod: 'portal_esign',
    signedAt: NOW,
    request: { ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 test' },
    portalAccountId: 'acct1',
    proxy: { relationship: 'parent', portalAccessId: 'pa1' },
    hashes: [{ key: r.key, version: r.version, sha256: f.sha256 }],
  });
  assert.equal(e.ipAddress, '203.0.113.7');
  const lines = evidenceLines(e, { sentAt: '2026-10-20T12:00:00Z', lastSentAt: '2026-10-21T12:00:00Z', sendCount: 2, channels: ['portal', 'email'], viewedAt: '2026-10-21T13:00:00Z' }, (iso) => iso);
  const text = lines.join('\n');
  assert.match(text, /Electronic signature in the patient portal/);
  assert.match(text, /IP 203\.0\.113\.7/);
  assert.match(text, /signed as parent/);
  assert.match(text, /Reminded 1 time/);
  assert.match(text, /First opened by the client/);
  assert.ok(text.includes(f.sha256), 'full hash printed');
  const staff = buildEvidence({ signatureMethod: 'in_office_tablet', signedAt: NOW, staff: { userId: 'u1', name: 'Sam Staff' }, staffInput: { signatureMethod: 'in_office_tablet', interpreter: { used: true, language: 'Spanish', name: 'ID 4411' } }, hashes: [] });
  assert.match(evidenceLines(staff, null, (x) => x).join('\n'), /Interpreter used: Spanish, ID 4411/);
});

test('hash stability: same rendered text = same SHA-256; any change = different; tampering detected', () => {
  const t = templateVersion('part2-consent', 1)!;
  assert.ok(t.variables?.includes('practiceName'));
  const a = renderTemplate(t, VARS);
  const b = renderTemplate(t, { ...VARS });
  assert.equal(hashRendered(a), hashRendered(b));
  assert.match(hashRendered(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashRendered(a), hashRendered(renderTemplate(t, { ...VARS, practiceName: 'Other Practice' })));
  const f1 = freeze(a, NOW);
  const f2 = freeze(b, new Date('2027-01-01'));
  assert.equal(f1.sha256, f2.sha256, 'the signing time is not part of the text hash');
  assert.ok(frozenIntact(f1));
  const tampered = { ...f1, blocks: f1.blocks.map((x, i) => (i === 1 && x.kind === 'p' ? { ...x, text: `${x.text} (edited)` } : x)) };
  assert.equal(frozenIntact(tampered), false);
});

// ─── Revocation: prospective, blocks disclosures, SMS gate in sync ──────────

test('revocation is prospective: disclosures before it stand, after it are blocked', () => {
  const r = { clientId: 'c1', formKey: 'lib:roi-authorization', type: 'Release of Information', status: 'DECLINED', expiresAt: null, revokedAt: new Date('2026-10-10T00:00:00Z') };
  assert.equal(disclosureConsentCheck(r, 'c1', new Date('2026-10-15')).ok, false);
  assert.equal(disclosureConsentCheck(r, 'c1', new Date('2026-10-05')).ok, true);
  assert.equal(disclosureConsentCheck({ ...r, status: 'SIGNED', revokedAt: null, expiresAt: new Date('2026-10-01') }, 'c1', new Date('2026-10-15')).ok, false);
});

test('revoking the communication consent turns texting off at the SMS gate', () => {
  const comm = templateVersion('communication-consent', 1)!;
  const kinds = revocationEffects(comm, null).map((e) => e.kind);
  assert.ok(kinds.includes('sms_opt_out'));
  assert.deepEqual(smsEligibility({ phone: '4105550100', smsConsent: false, smsOptOutAt: NOW }), { ok: false, reason: 'sms_opted_out' });
});

// ─── Worklist / reporting ────────────────────────────────────────────────────

function cr(clientId: string, templateKey: string, standard: ComplianceRow['standard'], state: ComplianceRow['state'], over: Partial<ComplianceRow> = {}): ComplianceRow {
  return {
    itemKey: templateKey, templateKey, title: templateKey, required: true, state, needsAction: state !== 'signed', signedVersion: null, legacy: false, activeVersion: 1,
    signedAt: null, signerName: null, expiresAt: null, revokedAt: null, rowId: null, recipient: null, reason: null, daysToExpiry: null, standard, detail: null,
    clientId, clientName: `Client ${clientId}`, mrn: `M${clientId}`, ...over,
  };
}
const FACETS = new Map<string, WorklistFacets>([
  ['a', { locationId: 'bowie', locationName: 'Bowie', clinicianId: 'u1', clinicianName: 'Dr. One', programs: ['omhc', 'telehealth'], nextVisit: '2026-10-21', nextVisitAt: '2026-10-21T14:00:00Z' }],
  ['b', { locationId: 'ss', locationName: 'Silver Spring', clinicianId: 'u2', clinicianName: 'Dr. Two', programs: ['primary_care'], nextVisit: '2026-10-30', nextVisitAt: '2026-10-30T14:00:00Z' }],
  ['c', { locationId: 'bowie', locationName: 'Bowie', clinicianId: 'u1', clinicianName: 'Dr. One', programs: ['sud'], nextVisit: null, nextVisitAt: null }],
]);
const ROWS = [
  cr('a', 'informed-consent-treatment', 'complete', 'signed'),
  cr('a', 'telehealth-consent', 'missing', 'missing'),
  cr('b', 'informed-consent-treatment', 'expiring', 'signed', { daysToExpiry: 10 }),
  cr('b', 'npp-acknowledgment', 'revoked', 'revoked'),
  cr('c', 'informed-consent-treatment', 'expired', 'expired'),
  cr('c', 'psychiatric-medication-consent', 'missing', 'missing'),
  cr('c', 'roi-authorization', 'missing', 'declined', { required: false }),
];

test('worklist: counts equal the lists for every status filter', () => {
  const all = buildWorklist(ROWS, FACETS, { status: 'all' });
  assert.equal(all.counts.clients, 3);
  for (const s of ['complete', 'missing', 'expiring', 'expired', 'revoked'] as const) {
    const w = buildWorklist(ROWS, FACETS, { status: s });
    const listed = w.clients.reduce((n, c) => n + c.items.length, 0);
    assert.equal(listed, all.counts[s], s);
  }
  const needs = buildWorklist(ROWS, FACETS, {});
  assert.equal(needs.clients.reduce((n, c) => n + c.items.length, 0), needs.counts.needsAttention);
  assert.equal(needs.counts.needsAttention, 5, 'non-required rows never count');
  // soonest visit first, no visit last
  assert.deepEqual(needs.clients.map((c) => c.clientId), ['a', 'b', 'c']);
});

test('worklist filters: location, program, clinician, consent type, due before visit date, search', () => {
  assert.deepEqual(buildWorklist(ROWS, FACETS, { locationId: 'bowie' }).clients.map((c) => c.clientId), ['a', 'c']);
  assert.deepEqual(buildWorklist(ROWS, FACETS, { program: 'primary_care' }).clients.map((c) => c.clientId), ['b']);
  assert.deepEqual(buildWorklist(ROWS, FACETS, { clinicianId: 'u2' }).clients.map((c) => c.clientId), ['b']);
  assert.deepEqual(buildWorklist(ROWS, FACETS, { templateKey: 'telehealth-consent' }).clients.map((c) => c.clientId), ['a']);
  assert.deepEqual(buildWorklist(ROWS, FACETS, { dueBefore: '2026-10-25' }).clients.map((c) => c.clientId), ['a']);
  assert.deepEqual(buildWorklist(ROWS, FACETS, { search: 'mb' }).clients.map((c) => c.clientId), ['b']);
});

test('bulk send: only what the client can sign now (not revoked, declined, pending or staff-prepared)', () => {
  assert.equal(isBulkSendable(cr('x', 'telehealth-consent', 'missing', 'missing')), true);
  assert.equal(isBulkSendable(cr('x', 'informed-consent-treatment', 'expiring', 'signed')), true);
  assert.equal(isBulkSendable(cr('x', 'informed-consent-treatment', 'expired', 'expired')), true);
  assert.equal(isBulkSendable(cr('x', 'informed-consent-treatment', 'missing', 'needs_resign')), true);
  assert.equal(isBulkSendable(cr('x', 'npp-acknowledgment', 'revoked', 'revoked')), false);
  assert.equal(isBulkSendable(cr('x', 'informed-consent-treatment', 'missing', 'declined')), false);
  assert.equal(isBulkSendable(cr('x', 'informed-consent-treatment', 'missing', 'pending')), false);
  assert.equal(isBulkSendable(cr('x', 'psychiatric-medication-consent', 'missing', 'missing')), false);
  assert.deepEqual([...bulkItemKeys(ROWS, 'c')], ['informed-consent-treatment']);
  const w = buildWorklist(ROWS, FACETS, {});
  assert.equal(w.clients.find((c) => c.clientId === 'b')!.bulkSendable, true);
});

test('completion rate by location counts expiring as complete (still valid)', () => {
  const g = completionBy(ROWS, FACETS, 'location');
  const bowie = g.find((x) => x.key === 'bowie')!;
  assert.equal(bowie.required, 4);
  assert.equal(bowie.complete, 1);
  assert.equal(bowie.rate, 25);
  const ss = g.find((x) => x.key === 'ss')!;
  assert.equal(ss.rate, 50);
  assert.equal(completionBy(ROWS, FACETS, 'clinician').length, 2);
});

// ─── Sending: no PHI ─────────────────────────────────────────────────────────

test('"forms to sign" text and email never name the forms and pass the patient SMS content rules', () => {
  assert.equal(PATIENT_SMS_PURPOSES.documents_to_sign.consent, 'explicit');
  const body = documentsToSignSms({ sender: 'MD Behavioral Health', portalUrl: 'https://staging.altrixs.com/patient/documents' });
  assert.deepEqual(lintPatientSms(body, { purpose: 'documents_to_sign', sender: 'MD Behavioral Health', clientName: 'Pat Client' }), []);
  const mail = documentsToSignEmail('MD Behavioral Health', 'https://staging.altrixs.com/patient/documents');
  for (const word of [/part 2/i, /substance/i, /release of information/i, /telehealth/i, /medication/i]) {
    assert.doesNotMatch(mail.text, word);
    assert.doesNotMatch(mail.subject, word);
  }
});

// ─── Retired evidence-free screens / migration ──────────────────────────────

test('no consent can be marked signed without a signature record; the hub has no fake delivery methods', () => {
  const manage = read('src/lib/consents/manage.ts');
  assert.match(manage, /LEGACY_CONSENT_RETIRED/);
  assert.doesNotMatch(manage, /status: 'SIGNED',\s*\n\s*signedAt/);
  const hub = read('src/app/dashboard/ehr/consents/page.tsx');
  assert.doesNotMatch(hub, /DocuSign|Mark Signed|mark signed/);
  assert.match(hub, /\/api\/consents\/worklist/);
  const chart = read('src/app/dashboard/clients/[id]/page.tsx');
  assert.doesNotMatch(chart, /Mark Signed/);
});

test('migration 20261021_consents_signing_evidence.sql is idempotent and adds the delivery / evidence columns', () => {
  const sql = read('prisma/migrations/20261021_consents_signing_evidence.sql');
  for (const col of ['deliveryChannels', 'lastSentAt', 'sendCount', 'viewedAt', 'evidence']) assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
  assert.doesNotMatch(sql, /DROP |DELETE |UPDATE /);
});

test('every new consent API route writes an audit entry', () => {
  for (const rel of ['src/app/api/consents/worklist/route.ts', 'src/app/api/consents/packets/route.ts', 'src/app/api/consents/due/route.ts', 'src/app/api/consents/library/packets/[id]/resend/route.ts', 'src/app/api/consents/[id]/sign/route.ts', 'src/app/api/consents/[id]/resend/route.ts']) {
    assert.match(read(rel), /auditPhiAccess|writeAuditLog/, rel);
  }
});
