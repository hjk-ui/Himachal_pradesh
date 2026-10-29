/**
 * Consent library (src/lib/consents/library): template lifecycle, packet composer rules, frozen
 * text, revocation effects, 42 CFR §2.31 and HIPAA §164.508 elements, Maryland minor rules,
 * optional / masked SSN, and report counts equal lists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ALL_TEMPLATE_VERSIONS, DEFAULT_PACKET_ORDER, TEMPLATE_KEYS, renderTemplate, templateVersion, versionsOf, LEGACY_TYPE_TO_KEY } from '../src/lib/consents/library/catalog';
import { PRACTICE_PACKET_V1 } from '../src/lib/consents/library/practicePacket';
import { TYPO_FIXES, TYPO_FIX_TEMPLATES, appliedTypoFixes } from '../src/lib/consents/library/typoFixes';
import { activeVersion, canApproveTemplates, canSendTemplate, effectiveStatus, indexStates, planLifecycle, type TemplateStateRow } from '../src/lib/consents/library/lifecycle';
import { ageOn, composePacket, flagsFromInterests, minorRule, type PacketClientContext } from '../src/lib/consents/library/composer';
import { validatePacketSubmission, validateSigner, expiresAtFor, type PacketSubmission } from '../src/lib/consents/library/signing';
import { computeClientConsents, filterCompliance, summarizeCompliance, type ComplianceFilter, type ComplianceRow, type ConsentRowLite } from '../src/lib/consents/library/status';
import { disclosureConsentCheck, revocationEffects, validateRevocation, needsWrittenConfirmation, isPartialChannelRevocation } from '../src/lib/consents/library/revocation';
import { freeze, frozenIntact } from '../src/lib/consents/library/freeze';
import type { ConsentTemplateVersion, TemplateBlock } from '../src/lib/consents/library/types';
import { captureGate } from '../src/lib/scribe/consent';
import { smsEligibility, emailReminderEligibility } from '../src/lib/sms/consent';
import { canRevealSsn, maskSsn, normalizeSsn, ssnError, ssnLast4 } from '../src/lib/clients/ssn';
import { consentInboxDrafts } from '../src/lib/inbox/core';
import { sectionsForRole } from '../src/lib/inbox/sections';
import { getReport } from '../src/lib/reports/library/registry';
import { canRunReport } from '../src/lib/reports/library/access';
import { CONSENT_REPORT_ROLES } from '../src/lib/consents/library/access';

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-10-19T15:00:00Z');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SOURCE = read('docs/source-forms/mdb-intake-form-valant-2026-10-12.md');
const VARS = { practiceName: 'MD Behavioral Health LLC', practicePhone: '301-249-8100', nppUrl: 'https://example.org/npp.pdf', nppEffectiveDate: '10/01/2026' };

/** Every Draft / Approved version made Active (simulates the owner approving everything). */
function allActiveStates(): Map<string, TemplateStateRow> {
  const rows: TemplateStateRow[] = [];
  for (const key of TEMPLATE_KEYS) {
    const vs = versionsOf(key);
    const latest = vs[vs.length - 1];
    for (const v of vs) rows.push({ templateKey: key, version: v.version, status: v.version === latest.version ? 'ACTIVE' : 'RETIRED' });
  }
  return indexStates(rows);
}

function resolver(states: Map<string, TemplateStateRow>, nppReady = true) {
  return (key: string) => {
    const t = activeVersion(key, states);
    if (!t) return { reason: 'no active version' };
    const c = canSendTemplate(t, states, { nppReady });
    return c.ok === false ? { reason: c.reason } : { template: t };
  };
}

const ADULT: PacketClientContext = { ageYears: 34, services: ['omhc'], medicaid: false, emergencyContact: null };

// ─── Catalog / practice wording ──────────────────────────────────────────────

test('every practice-packet section from the source is in the library, Active by default, with the practice ack', () => {
  const required = [
    'program-orientation', 'confidentiality-part2-notice', 'release-of-information-explanation', 'duty-to-warn', 'rehabilitation-assessment-irp',
    'course-of-treatment', 'transition-discharge', 'legal-requirement-expectations', 'after-hours-emergency', 'weapons-drugs',
    'advance-directives-education', 'abuse-neglect-reporting', 'program-rules', 'reinstatement', 'facility-orientation',
    'informed-consent-treatment', 'participant-responsibilities', 'hipaa-acknowledgment', 'telehealth-consent', 'financial-responsibility',
  ];
  for (const k of required) {
    const v1 = templateVersion(k, 1);
    assert.ok(v1, k);
    assert.equal(v1!.origin, 'practice_packet', k);
    assert.equal(v1!.defaultStatus, 'ACTIVE', k);
    assert.equal(v1!.acknowledgment, 'I (Client/Parent/Guardian) hereby acknowledge that I have read and understand the above conditions.');
    assert.ok(SOURCE.includes(v1!.acknowledgment.replace(/\.$/, '')), 'practice ack comes from the source');
  }
  // keys are unique per version, and every packet key exists
  const ids = ALL_TEMPLATE_VERSIONS.map((t) => `${t.key}@${t.version}`);
  assert.equal(new Set(ids).size, ids.length);
  for (const k of DEFAULT_PACKET_ORDER) assert.ok(versionsOf(k).length, k);
});

function blockTexts(blocks: TemplateBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === 'ul' || b.kind === 'ol' ? b.items : b.kind === 'lead' ? [b.label, b.text] : [b.text]));
}

test('practice wording is verbatim from the source except the practice name variable', () => {
  const src = SOURCE.replace(/\*\*/g, '').replace(/\*/g, '');
  for (const t of PRACTICE_PACKET_V1) {
    const texts = [...blockTexts(t.blocks), ...(t.checkboxes ?? []).map((c) => c.label)];
    for (const text of texts) {
      for (const frag of text.split('{{practiceName}}').map((f) => f.trim()).filter((f) => f.length > 3)) {
        assert.ok(src.includes(frag), `${t.key}: not verbatim: "${frag.slice(0, 90)}"`);
      }
    }
  }
  // the wrong entity names never reach a client
  for (const t of PRACTICE_PACKET_V1) {
    const all = JSON.stringify(renderTemplate(t, VARS));
    assert.ok(!/Care Connection|\bMBD\b|\bMDB\b/.test(all), t.key);
  }
  const hipaa = renderTemplate(templateVersion('hipaa-acknowledgment', 1)!, VARS);
  assert.ok(JSON.stringify(hipaa.blocks).includes('MD Behavioral Health LLC is committed to maintaining the privacy'));
  assert.ok(templateVersion('hipaa-acknowledgment', 1)!.reviewFlags.some((f) => f.note === '1' && f.severity === 'needs_decision'));
  assert.ok(templateVersion('participant-responsibilities', 1)!.reviewFlags.some((f) => f.note === '2'));
});

test('telehealth: v1 keeps "never recorded" and is flagged superseded pending approval; v2 is a Draft that reflects the AI Scribe', () => {
  const v1 = templateVersion('telehealth-consent', 1)!;
  const v2 = templateVersion('telehealth-consent', 2)!;
  assert.ok(blockTexts(v1.blocks).includes('I understand that none of the telehealth sessions will be recorded or photographed.'));
  assert.ok(v1.reviewFlags.some((f) => f.note === '3' && /SUPERSEDED PENDING OWNER APPROVAL/.test(f.text)));
  assert.equal(v2.defaultStatus, 'DRAFT');
  assert.equal(v2.origin, 'proposed');
  assert.ok(blockTexts(v2.blocks).some((t) => /AI documentation assistant/.test(t) && /all parties/.test(t)));
  assert.ok(!blockTexts(v2.blocks).some((t) => /none of the telehealth sessions will be recorded/.test(t)));
  assert.ok(v2.reviewFlags.some((f) => /Proposed — needs owner\/compliance approval/.test(f.text)));
});

test('proposed and typo-fix versions are Drafts; typo fixes change only the listed strings', () => {
  for (const t of ALL_TEMPLATE_VERSIONS) {
    if (t.origin === 'proposed' || t.origin === 'proposed_typo_fix') {
      assert.equal(t.defaultStatus, 'DRAFT', `${t.key}@${t.version}`);
      assert.ok(t.reviewFlags.some((f) => /needs owner\/compliance approval/.test(f.text)), `${t.key}@${t.version} flagged proposed`);
    }
  }
  for (const key of Object.keys(TYPO_FIXES)) assert.equal(appliedTypoFixes(key).length, TYPO_FIXES[key].length, `${key}: every listed typo occurs in v1`);
  for (const t2 of TYPO_FIX_TEMPLATES) {
    const v1 = templateVersion(t2.key, 1)!;
    let expected = JSON.stringify(v1.blocks);
    for (const [a, b] of TYPO_FIXES[t2.key]) expected = expected.split(a).join(b);
    assert.equal(JSON.stringify(t2.blocks), expected, t2.key);
  }
  assert.ok(blockTexts(templateVersion('duty-to-warn', 2)!.blocks).some((s) => s.includes('an imminent threat')));
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

test('lifecycle: only admin / practice director approve; Draft → Approved → Active; activating retires the previous Active', () => {
  const states = indexStates([]);
  assert.equal(effectiveStatus(templateVersion('telehealth-consent', 1)!, states), 'ACTIVE');
  assert.equal(effectiveStatus(templateVersion('telehealth-consent', 2)!, states), 'DRAFT');
  assert.equal(canApproveTemplates('ADMIN'), true);
  assert.equal(canApproveTemplates('PRACTICE_DIRECTOR'), true);
  for (const r of ['THERAPIST', 'FRONT_DESK', 'OFFICE_MANAGER', 'BILLING']) assert.equal(canApproveTemplates(r), false, r);
  const denied = planLifecycle('THERAPIST', 'telehealth-consent', 2, 'approve', states);
  assert.equal(denied.ok, false);
  assert.equal((denied as { status: number }).status, 403);
  // cannot activate a Draft without approval
  const early = planLifecycle('ADMIN', 'telehealth-consent', 2, 'activate', states);
  assert.equal(early.ok, false);
  assert.equal((early as { status: number }).status, 409);
  const approve = planLifecycle('ADMIN', 'telehealth-consent', 2, 'approve', states);
  assert.ok(approve.ok);
  assert.deepEqual(approve.ok && approve.writes, [{ templateKey: 'telehealth-consent', version: 2, status: 'APPROVED', stamp: 'approved' }]);
  const approved = indexStates([{ templateKey: 'telehealth-consent', version: 2, status: 'APPROVED', approvedAt: NOW, approvedById: 'u1', approvedByName: 'Owner' }]);
  const activate = planLifecycle('PRACTICE_DIRECTOR', 'telehealth-consent', 2, 'activate', approved);
  assert.ok(activate.ok);
  if (activate.ok) {
    assert.deepEqual(activate.writes.map((w) => `${w.version}:${w.status}`), ['2:ACTIVE', '1:RETIRED']);
    assert.equal(activate.retiredVersion, 1);
  }
  // approval is recorded with who / when by the store
  const store = read('src/lib/consents/library/store.ts');
  assert.match(store, /approvedAt: now, approvedById: actor\.userId, approvedByName: byName/);
});

test('only an Active version can be sent; the NPP acknowledgment needs the NPP document', () => {
  const states = indexStates([]);
  const draft = templateVersion('roi-authorization', 1)!;
  assert.equal(canSendTemplate(draft, states, { nppReady: true }).ok, false);
  const retired = indexStates([{ templateKey: 'program-orientation', version: 1, status: 'RETIRED' }]);
  assert.equal(canSendTemplate(templateVersion('program-orientation', 1)!, retired, { nppReady: true }).ok, false);
  assert.equal(canSendTemplate(templateVersion('program-orientation', 1)!, states, { nppReady: true }).ok, true);
  const npp = templateVersion('npp-acknowledgment', 1)!;
  assert.equal(npp.defaultStatus, 'ACTIVE');
  assert.equal(canSendTemplate(npp, states, { nppReady: false }).ok, false);
  assert.equal(canSendTemplate(npp, states, { nppReady: true }).ok, true);
  // composer never includes a Draft
  const day1 = composePacket({ selection: [...DEFAULT_PACKET_ORDER], resolve: resolver(states), ctx: { ...ADULT, services: ['omhc', 'telehealth', 'sud'] }, today: '2026-10-19' });
  for (const it of day1.items) assert.equal(effectiveStatus(templateVersion(it.key, it.version)!, states), 'ACTIVE', it.key);
  assert.ok(day1.items.some((i) => i.key === 'telehealth-consent' && i.version === 1));
  assert.ok(day1.skipped.some((s) => s.key === 'part2-consent'), 'Part 2 consent is a Draft on day one');
});

// ─── Composer rules ──────────────────────────────────────────────────────────

test('packet composer: telehealth, PRP, SUD / Part 2, minor, primary care, emergency ROI, Carelon', () => {
  const states = allActiveStates();
  const compose = (ctx: Partial<PacketClientContext>) => composePacket({ selection: [...DEFAULT_PACKET_ORDER], resolve: resolver(states), ctx: { ...ADULT, ...ctx }, today: '2026-10-19' });
  const keys = (ctx: Partial<PacketClientContext>) => compose(ctx).items.map((i) => i.key);

  const base = keys({});
  for (const k of ['telehealth-consent', 'rehabilitation-assessment-irp', 'part2-consent', 'minor-consent-treatment', 'primary-care-consent', 'roi-authorization']) assert.ok(!base.includes(k), `adult OMHC excludes ${k}`);
  for (const k of ['informed-consent-treatment', 'hipaa-acknowledgment', 'npp-acknowledgment', 'financial-responsibility']) assert.ok(base.includes(k), k);

  assert.ok(keys({ services: ['omhc', 'telehealth'] }).includes('telehealth-consent'));
  assert.ok(keys({ services: ['prp'] }).includes('rehabilitation-assessment-irp'));
  const sud = compose({ services: ['sud'] });
  const p2 = sud.items.find((i) => i.key === 'part2-consent')!;
  assert.ok(p2 && p2.optional && p2.signing === 'standalone' && p2.purposeTag === 'tpo' && p2.prefill?.recipientType === 'tpo');
  assert.ok(keys({ ageYears: 15 }).includes('minor-consent-treatment'));
  assert.ok(!keys({ ageYears: 18 }).includes('minor-consent-treatment'));
  assert.ok(compose({ ageYears: null }).skipped.some((s) => s.key === 'minor-consent-treatment' && /Date of birth unknown/.test(s.reason)));
  assert.ok(keys({ services: ['primary_care'] }).includes('primary-care-consent'));
  assert.equal(compose({ medicaid: true }).carelonAttestation, true);
  assert.equal(compose({}).carelonAttestation, false);
  const ec = compose({ emergencyContact: { name: 'Pat Doe', relationship: 'SPS', phone: '3015550100' } });
  const roi = ec.items.find((i) => i.key === 'roi-authorization')!;
  assert.equal(roi.purposeTag, 'emergency_contact');
  assert.equal(roi.prefill?.recipientName, 'Pat Doe');
  assert.equal(roi.prefill?.expirationDate, '2027-10-19');
  // practice deselection is respected
  assert.ok(!composePacket({ selection: ['program-orientation'], resolve: resolver(states), ctx: { ...ADULT, services: ['telehealth'] }, today: '2026-10-19' }).items.some((i) => i.key === 'telehealth-consent'));
  // services from the intake answers
  assert.deepEqual(flagsFromInterests(['prp', 'medication_management', 'primary_care']).sort(), ['medication', 'primary_care', 'prp']);
});

// ─── Minor rules ─────────────────────────────────────────────────────────────

test('Maryland minor rules: 16+ mental health alone, SUD at any age, otherwise a representative', () => {
  assert.equal(minorRule(30, ['omhc']), null);
  assert.equal(minorRule(15, ['omhc'])!.mayConsentAlone, false);
  assert.equal(minorRule(16, ['omhc', 'medication'])!.mayConsentAlone, true);
  assert.match(minorRule(16, ['omhc'])!.explanation, /20-104/);
  const sud = minorRule(14, ['sud'])!;
  assert.equal(sud.mayConsentAlone, true);
  assert.equal(sud.minorControlsPart2, true);
  assert.match(sud.explanation, /20-102/);
  assert.equal(minorRule(17, ['primary_care'])!.mayConsentAlone, false);
  assert.equal(minorRule(16, ['omhc', 'primary_care'])!.mayConsentAlone, false);
  assert.equal(ageOn('2010-10-20', NOW), 15);
  assert.equal(ageOn('2010-10-19', NOW), 16);
  const self = { signerType: 'self' as const, printedName: 'Kid Doe', signature: 'Kid Doe', agree: true };
  assert.ok(validateSigner(self, minorRule(15, ['omhc'])).some((e) => /under 18/.test(e)));
  assert.equal(validateSigner(self, minorRule(16, ['omhc'])).length, 0);
  const rep = { signerType: 'representative' as const, printedName: 'Parent Doe', signature: 'Parent Doe', agree: true, relationship: '', authority: '' };
  assert.ok(validateSigner(rep, null).some((e) => /relationship/.test(e)));
  assert.ok(validateSigner(rep, null).some((e) => /authority/.test(e)));
  assert.equal(validateSigner({ ...rep, relationship: 'Parent', authority: 'Parent with legal custody' }, null).length, 0);
  // Part 2: a minor who consents to SUD treatment alone controls disclosures (42 CFR 2.14)
  const states = allActiveStates();
  const c = composePacket({ selection: ['part2-consent'], resolve: resolver(states), ctx: { ...ADULT, ageYears: 15, services: ['sud'] }, today: '2026-10-19' });
  const t = templateVersion('part2-consent', 1)!;
  const sub: PacketSubmission = {
    signer: { signerType: 'representative', printedName: 'Parent Doe', signature: 'Parent Doe', agree: true, relationship: 'Parent', authority: 'Parent with legal custody' },
    sections: { 'part2-consent': { version: 1, acknowledged: true, signature: 'Parent Doe', fields: { patientName: 'Kid Doe', disclosingParty: 'Practice', information: ['all_sud'], informationDetail: 'All records', recipientType: 'tpo', purpose: 'TPO', expirationEvent: 'End of treatment' } } },
  };
  const errs = validatePacketSubmission(c.items, new Map([['part2-consent', renderTemplate(t, VARS)]]), sub, c.minor);
  assert.ok(errs.some((e) => /42 CFR §2.14/.test(e)));
});

// ─── Frozen text + signing ───────────────────────────────────────────────────

test('frozen text: rendered with the practice name, hashed, tamper-evident; a version change blocks signing', () => {
  const t = templateVersion('informed-consent-treatment', 1)!;
  const r = renderTemplate(t, VARS);
  assert.deepEqual(r.missingVariables, []);
  assert.ok(JSON.stringify(r).includes('rendered by MD Behavioral Health LLC, or its employees'));
  assert.deepEqual(renderTemplate(t, { practiceName: null }).missingVariables, ['practiceName']);
  const f = freeze(r, NOW);
  assert.equal(f.version, 1);
  assert.equal(f.key, 'informed-consent-treatment');
  assert.equal(frozenIntact(f), true);
  const tampered = { ...f, blocks: [...f.blocks, { kind: 'p' as const, text: 'added later' }] };
  assert.equal(frozenIntact(tampered), false);
  // the store freezes at signing and keeps version + text in formData
  const store = read('src/lib/consents/library/store.ts');
  assert.match(store, /freeze\(rendered\.get\(it\.key\)!, now\)/);
  assert.match(store, /frozen: frozenByKey\.get\(it\.key\)!/);
  assert.match(store, /formVersion: String\(it\.version\)/);
  // a response for an older version is refused
  const states = allActiveStates();
  const c = composePacket({ selection: ['informed-consent-treatment'], resolve: resolver(states), ctx: ADULT, today: '2026-10-19' });
  const sub: PacketSubmission = { signer: { signerType: 'self', printedName: 'Ann Lee', signature: 'ann lee', agree: true }, sections: { 'informed-consent-treatment': { version: 1, acknowledged: true, choices: { serviceSetting: 'both' }, checkboxes: { blendedExplained: true, orientationReviewed: true } } } };
  const active = activeVersion('informed-consent-treatment', states)!;
  const rendered = new Map([['informed-consent-treatment', renderTemplate(active, VARS)]]);
  const errs = validatePacketSubmission(c.items, rendered, sub, null);
  if (active.version !== 1) assert.ok(errs.some((e) => /changed while you were completing/.test(e)));
  const ok = validatePacketSubmission(c.items, rendered, { ...sub, sections: { 'informed-consent-treatment': { ...sub.sections['informed-consent-treatment'], version: active.version } } }, null);
  assert.deepEqual(ok, []);
  // renewal cadence: consent to treatment and financial policy yearly; ROI by its own date
  assert.equal(expiresAtFor(12, {}, NOW)!.toISOString().slice(0, 10), '2027-10-19');
  assert.equal(expiresAtFor(12, { expirationDate: '2027-03-01' }, NOW)!.toISOString().slice(0, 10), '2027-03-01');
  assert.equal(expiresAtFor(null, {}, NOW), null);
});

// ─── Regulatory elements ─────────────────────────────────────────────────────

function assertElements(t: ConsentTemplateVersion, required: string[]) {
  const els = t.regulatoryElements ?? [];
  for (const r of required) assert.ok(els.some((e) => e.element === r), `${t.key}: element ${r} listed`);
  for (const e of els) {
    if (e.satisfiedBy === 'signature') continue;
    if (e.satisfiedBy === 'block') {
      assert.ok(t.blocks.some((b) => b.kind === 'p' && b.element === e.element), `${t.key}: statement for ${e.element}`);
      continue;
    }
    const keys = e.satisfiedBy.replace('field:', '').split('|');
    const fields = keys.map((k) => t.fields?.find((f) => f.key === k));
    assert.ok(fields.every(Boolean), `${t.key}: fields for ${e.element}`);
    if (keys.length === 1) assert.ok(fields[0]!.required, `${t.key}: ${keys[0]} required`);
  }
  assert.equal(t.signing, 'standalone', 'own signature (not combined with the consent to treatment)');
  assert.equal(t.revocable, true);
}

test('42 CFR Part 2 consent carries the §2.31 (2024 rule) elements, incl. the TPO single-consent option', () => {
  const t = templateVersion('part2-consent', 1)!;
  assertElements(t, ['part2.patient_name', 'part2.authorized_discloser', 'part2.information', 'part2.recipients', 'part2.purpose', 'part2.expiration', 'part2.signature', 'part2.revocation', 'part2.conditioning', 'part2.redisclosure']);
  assert.ok(t.fields!.find((f) => f.key === 'recipientType')!.options!.some((o) => o.value === 'tpo'));
  const text = blockTexts(t.blocks).join(' ');
  assert.match(text, /revoke this consent in writing/);
  assert.match(text, /redisclosed/);
  assert.match(text, /civil, criminal, administrative or legislative proceeding/);
  assert.match(text, /SUD counseling notes/);
  assert.ok(t.effects!.includes('part2'));
  // a signed Part 2 consent with neither expiration date nor event is refused
  const errs = validatePacketSubmission(
    [{ key: 'part2-consent', version: 1, title: t.title, signing: 'standalone', optional: false, reason: '' }],
    new Map([['part2-consent', renderTemplate(t, VARS)]]),
    { signer: { signerType: 'self', printedName: 'Ann Lee', signature: 'Ann Lee', agree: true }, sections: { 'part2-consent': { version: 1, acknowledged: true, signature: 'Ann Lee', fields: { patientName: 'Ann Lee', disclosingParty: 'P', information: ['diagnosis'], informationDetail: 'x', recipientType: 'named', recipientName: 'Dr. X', purpose: 'At my request' } } } },
    null
  );
  assert.ok(errs.some((e) => /expiration date or an expiration event/.test(e)));
});

test('HIPAA ROI / authorization carries the §164.508(c) core elements and required statements', () => {
  const t = templateVersion('roi-authorization', 1)!;
  assertElements(t, ['164.508(c)(1)(i)', '164.508(c)(1)(ii)', '164.508(c)(1)(iii)', '164.508(c)(1)(iv)', '164.508(c)(1)(v)', '164.508(c)(1)(vi)', '164.508(c)(2)(i)', '164.508(c)(2)(ii)', '164.508(c)(2)(iii)']);
  assert.equal(t.consentType, 'Release of Information');
  assert.ok(t.staffGuidance!.some((g) => /Psychotherapy notes/.test(g)));
  assert.ok(t.fields!.find((f) => f.key === 'informationDetail')!.help!.includes('Psychotherapy notes'));
});

// ─── Revocation effects ──────────────────────────────────────────────────────

test('revocation: SMS stops, AI drafting and the AI Scribe are blocked, ROI disclosures are blocked', () => {
  const comm = templateVersion('communication-consent', 1)!;
  assert.deepEqual(revocationEffects(comm, null).map((e) => e.kind), ['sms_opt_out', 'email_opt_out', 'voicemail_off']);
  assert.deepEqual(revocationEffects(comm, null, ['sms']).map((e) => e.kind), ['sms_opt_out']);
  assert.equal(isPartialChannelRevocation(comm, ['sms']), true);
  // the store sets smsOptOutAt, which the one TCPA gate reads
  assert.match(read('src/lib/consents/library/store2.ts'), /smsConsent: false, smsOptOutAt: now/);
  assert.deepEqual(smsEligibility({ phone: '3015550100', smsConsent: true, smsOptOutAt: NOW }), { ok: false, reason: 'sms_opted_out' });
  assert.deepEqual(emailReminderEligibility({ email: 'a@b.co', emailOptOutAt: NOW }), { ok: false, reason: 'email_opted_out' });

  // AI drafting (library template and the scribe's point-of-care rows, type "AI Note Drafting")
  assert.deepEqual(revocationEffects(templateVersion('ai-note-drafting-consent', 1)!, null).map((e) => e.kind), ['ai_drafting_blocked']);
  assert.deepEqual(revocationEffects(null, 'AI Note Drafting').map((e) => e.kind), ['ai_drafting_blocked']);
  assert.match(read('src/lib/consents/library/store2.ts'), /status: 'DECLINED',\s+formStatus: 'REVOKED'/);
  assert.equal(LEGACY_TYPE_TO_KEY['AI Note Drafting'], 'ai-note-drafting-consent');
  const base = { mode: 'in_person' as const, scribeEnabled: true, entitled: true, practiceRequiresAiConsent: true, transcriptionConfigured: true, recordingConsent: { method: 'verbal' as const, participants: [{ role: 'CLIENT' as const, consented: true }], allPartiesConfirmed: true, scriptRead: true } };
  assert.equal(captureGate({ ...base, aiConsent: 'declined' }).ok, false);
  assert.equal(captureGate({ ...base, aiConsent: 'signed' }).ok, true);
  const rec = captureGate({ ...base, aiConsent: 'signed', recordingConsentRevoked: true });
  assert.equal(rec.ok, false);
  assert.equal((rec as { code: string }).code, 'recording_consent_revoked');
  assert.deepEqual(revocationEffects(templateVersion('recording-transcription-consent', 1)!, null).map((e) => e.kind), ['recording_blocked']);
  assert.match(read('src/app/api/scribe/captures/route.ts'), /recordingConsentRevoked: recordingRevoked/);

  // ROI / Part 2: revoked, expired or unsigned consents cannot back a disclosure
  const roi = { clientId: 'c1', formKey: 'lib:roi-authorization', type: 'Release of Information', status: 'SIGNED', expiresAt: new Date('2027-01-01'), revokedAt: null };
  assert.deepEqual(disclosureConsentCheck(roi, 'c1', NOW), { ok: true });
  assert.equal(disclosureConsentCheck({ ...roi, status: 'DECLINED', revokedAt: new Date('2026-10-01') }, 'c1', NOW).ok, false);
  assert.equal(disclosureConsentCheck({ ...roi, expiresAt: new Date('2026-01-01') }, 'c1', NOW).ok, false);
  assert.equal(disclosureConsentCheck({ ...roi, status: 'PENDING' }, 'c1', NOW).ok, false);
  assert.equal(disclosureConsentCheck(roi, 'other-client', NOW).ok, false);
  assert.equal(disclosureConsentCheck({ ...roi, formKey: 'lib:program-rules', type: 'Program Rules' }, 'c1', NOW).ok, false);
  // a disclosure made before the revocation date is still valid for the accounting
  assert.equal(disclosureConsentCheck({ ...roi, status: 'DECLINED', revokedAt: new Date('2026-11-01') }, 'c1', NOW).ok, true);
  assert.deepEqual(revocationEffects(templateVersion('roi-authorization', 1)!, null).map((e) => e.kind), ['disclosures_blocked']);
  assert.match(read('src/app/api/part2/disclosures/route.ts'), /disclosureConsentCheck\(consent, body\.clientId/);
  assert.equal(needsWrittenConfirmation(templateVersion('roi-authorization', 1)!, 'verbal'), true);
  assert.deepEqual(revocationEffects(templateVersion('card-on-file-authorization', 1)!, null).map((e) => e.kind), ['autopay_off']);

  // revocation input rules
  const signed = { status: 'SIGNED', revokedAt: null, signedAt: new Date('2026-10-01T12:00:00Z') };
  assert.deepEqual(validateRevocation(comm, signed, { receivedOn: '2026-10-19', method: 'verbal', receivedVia: 'phone' }, '2026-10-19'), []);
  assert.ok(validateRevocation(comm, signed, { receivedOn: '2026-10-20', method: 'written', receivedVia: 'mail' }, '2026-10-19').some((e) => /future/.test(e)));
  assert.ok(validateRevocation(comm, signed, { receivedOn: '2026-09-01', method: 'written', receivedVia: 'mail' }, '2026-10-19').some((e) => /before the consent was signed/.test(e)));
  assert.ok(validateRevocation(templateVersion('program-rules', 1)!, signed, { receivedOn: '2026-10-19', method: 'written', receivedVia: 'mail' }, '2026-10-19').some((e) => /cannot be revoked/.test(e)));
  assert.ok(validateRevocation(comm, { ...signed, revokedAt: NOW }, { receivedOn: '2026-10-19', method: 'written', receivedVia: 'mail' }, '2026-10-19').some((e) => /already revoked/.test(e)));
});

// ─── SSN ─────────────────────────────────────────────────────────────────────

test('SSN is optional, validated, masked, encrypted at rest and reveal is role-limited', async () => {
  assert.equal(ssnError(null), null);
  assert.equal(ssnError(''), null);
  assert.equal(ssnError('123-45-6789'), null);
  assert.ok(ssnError('123-45-678'));
  assert.ok(ssnError('000-12-3456'));
  assert.ok(ssnError('900-12-3456'));
  assert.equal(normalizeSsn('123 45 6789'), '123456789');
  assert.equal(ssnLast4('123-45-6789'), '6789');
  assert.equal(maskSsn('6789'), '***-**-6789');
  assert.equal(maskSsn(null), null);
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'BILLING']) assert.equal(canRevealSsn(r), true, r);
  for (const r of ['FRONT_DESK', 'THERAPIST', 'PEER_SUPPORT', 'HR']) assert.equal(canRevealSsn(r), false, r);
  const prev = process.env.PHI_FIELD_ENCRYPTION_KEY;
  const crypto = await import('../src/lib/security/fieldCrypto');
  delete process.env.PHI_FIELD_ENCRYPTION_KEY;
  assert.equal(crypto.encryptField('123456789'), null, 'no key: nothing stored in clear');
  process.env.PHI_FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const enc = crypto.encryptField('123456789')!;
  assert.ok(enc.startsWith('v1:') && !enc.includes('123456789'));
  assert.equal(crypto.decryptField(enc), '123456789');
  if (prev === undefined) delete process.env.PHI_FIELD_ENCRYPTION_KEY;
  else process.env.PHI_FIELD_ENCRYPTION_KEY = prev;
  // intake: SSN optional in the schema and never copied into the stored intake formData
  assert.match(read('src/app/api/intake/public/[token]/complete/route.ts'), /identity: z\.object\(\{ ssn: z\.string\(\)\.trim\(\)\.max\(20\)\.optional\(\)\.nullable\(\) \}\)\.optional\(\)/);
  const manage = read('src/lib/intake/manage.ts');
  assert.match(manage, /const \{ identity: _identity, consentPacket: _packet, \.\.\.storable \} = payload;/);
  assert.match(manage, /identity: \{ ssnProvided: Boolean/);
  assert.doesNotMatch(read('prisma/schema.prisma'), /^\s+ssn\s+String/m);
});

// ─── Status, report and inbox: counts equal lists ────────────────────────────

function row(p: Partial<ConsentRowLite> & { formKey: string | null; type?: string }): ConsentRowLite {
  return { id: Math.random().toString(36).slice(2), type: p.type ?? 'x', formVersion: '1', status: 'SIGNED', formStatus: 'SIGNED', signedAt: new Date('2026-01-10'), expiresAt: null, revokedAt: null, createdAt: new Date('2026-01-10'), signedByName: 'Ann Lee', recipientName: null, ...p } as ConsentRowLite;
}

test('client consent status: signed, missing, expired, revoked, re-sign on a new version, legacy rows count', () => {
  const states = allActiveStates();
  const composed = composePacket({ selection: ['informed-consent-treatment', 'telehealth-consent', 'financial-responsibility', 'npp-acknowledgment', 'ai-note-drafting-consent', 'program-rules'], resolve: resolver(states), ctx: { ...ADULT, services: ['omhc', 'telehealth'] }, today: '2026-10-19' });
  const items = computeClientConsents({
    composed,
    activeOf: (k) => activeVersion(k, states),
    now: NOW,
    rows: [
      row({ formKey: null, type: 'Consent to Treat', formVersion: null, expiresAt: new Date('2027-01-01') }),
      row({ formKey: 'lib:telehealth-consent', formVersion: '1' }),
      row({ formKey: 'lib:financial-responsibility', formVersion: '2', expiresAt: new Date('2026-09-01') }),
      row({ formKey: null, type: 'AI Note Drafting', formVersion: null, status: 'DECLINED', formStatus: 'REVOKED', revokedAt: new Date('2026-10-01') }),
      row({ formKey: 'lib:program-rules', formVersion: '2', status: 'PENDING', formStatus: 'SENT', signedAt: null }),
    ],
  });
  const st = Object.fromEntries(items.map((i) => [i.templateKey, i.state]));
  assert.equal(st['informed-consent-treatment'], 'signed', 'legacy "Consent to Treat" counts');
  assert.equal(st['telehealth-consent'], 'needs_resign', 'v2 active and requires re-sign');
  assert.equal(st['financial-responsibility'], 'expired');
  assert.equal(st['ai-note-drafting-consent'], 'revoked');
  assert.equal(st['npp-acknowledgment'], 'missing');
  assert.equal(st['program-rules'], 'pending');
  assert.ok(items.find((i) => i.templateKey === 'telehealth-consent')!.needsAction);
});

test('Consent compliance report: KPI counts equal the filtered lists; inbox and roles', () => {
  const mk = (clientId: string, state: ComplianceRow['state'], required = true, templateKey = 'program-rules'): ComplianceRow => ({
    itemKey: `${templateKey}:${clientId}:${state}`, templateKey, title: templateKey, required, state, needsAction: required && state !== 'signed',
    signedVersion: null, legacy: false, activeVersion: 1, signedAt: null, signerName: null, expiresAt: null, revokedAt: null, rowId: null, recipient: null, reason: null,
    daysToExpiry: null, standard: state === 'signed' ? 'complete' : state === 'expired' ? 'expired' : state === 'revoked' ? 'revoked' : 'missing', detail: null,
    clientId, clientName: `Client ${clientId}`, mrn: null,
  });
  const rows = [mk('a', 'signed'), mk('a', 'missing'), mk('b', 'expired'), mk('b', 'revoked'), mk('c', 'needs_resign'), mk('c', 'pending'), mk('d', 'declined'), mk('d', 'signed', false), mk('e', 'missing', false)];
  const s = summarizeCompliance(rows);
  const n = (f: ComplianceFilter) => filterCompliance(rows, f).length;
  assert.equal(s.required, n('all_required'));
  assert.equal(s.needsAction, n('needs_action'));
  for (const f of ['missing', 'expired', 'revoked', 'needs_resign', 'declined', 'pending', 'signed'] as const) assert.equal(s[f], n(f), f);
  assert.equal(s.signed + s.missing + s.expired + s.revoked + s.needs_resign + s.declined + s.pending, s.required);
  assert.equal(s.clientsNeedingAction, new Set(filterCompliance(rows, 'needs_action').map((r) => r.clientId)).size);

  const r = getReport('consent-compliance')!;
  assert.ok(r);
  assert.equal(r.category, 'compliance');
  assert.deepEqual([...r.access.roles].sort(), [...CONSENT_REPORT_ROLES].sort());
  for (const role of ['ADMIN', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER']) assert.equal(canRunReport(r, role), true, role);
  for (const role of ['THERAPIST', 'FRONT_DESK', 'BILLING', 'HR', 'PEER_SUPPORT']) assert.equal(canRunReport(r, role), false, role);
  // KPIs and the list come from the same scoped rows
  const runner = read('src/lib/reports/library/runners/compliance.ts');
  assert.match(runner, /const s = summarizeCompliance\(scoped\);/);
  assert.match(runner, /filterCompliance\(scoped, view as/);

  const inbox = consentInboxDrafts(rows, new Map([['b', '2026-10-21T14:00:00Z']]));
  assert.deepEqual(inbox.drafts.map((d) => d.clientId).sort(), ['a', 'b', 'c', 'd']);
  assert.equal(inbox.drafts.find((d) => d.clientId === 'b')!.priority, 'high');
  assert.equal(inbox.drafts.find((d) => d.clientId === 'a')!.href, '/dashboard/ehr/consents/client/a');
  for (const role of ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'PRACTICE_DIRECTOR']) assert.ok(sectionsForRole(role).some((x) => x.key === 'consents_needed'), role);
  for (const role of ['THERAPIST', 'BILLING', 'PEER_SUPPORT', 'HR']) assert.ok(!sectionsForRole(role).some((x) => x.key === 'consents_needed'), role);
});

test('migration is idempotent and matches the schema', () => {
  const sql = read('prisma/migrations/20261019_consent_library.sql');
  for (const line of sql.split('\n').filter((l) => /^\s*(ALTER TABLE|CREATE)/.test(l))) assert.match(line, /IF NOT EXISTS/, line);
  for (const t of ['ConsentTemplateState', 'ConsentLibrarySettings', 'ConsentPacket']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`));
    assert.match(read('prisma/schema.prisma'), new RegExp(`model ${t} \\{`));
  }
  for (const col of ['packetId', 'revokedAt', 'revocationMethod', 'revocationReceivedVia', 'recipientName']) assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
  for (const col of ['ssnEncrypted', 'ssnLast4', 'guardianEmail', 'servicesInterested']) assert.match(sql, new RegExp(`"Client" ADD COLUMN IF NOT EXISTS "${col}"`));
});
