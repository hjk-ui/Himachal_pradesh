/**
 * Waystar inbound / inquiries — synthetic X12 only (no DB, no AWS).
 * 835 X221A1 parse + posting rules, 271 X279A1, 277 X212 / 277CA X214, 270 / 276 generation snapshots.
 * Snapshots: UPDATE_SNAPSHOTS=1 npx tsx --test tests/waystar-inbound.test.ts rewrites them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse835, contractualTotal } from '../src/lib/billing/waystarInbound/parse835';
import { planEraClaimPosting, type ClaimSnapshot } from '../src/lib/billing/waystarInbound/eraPosting';
import { parse271, summarizeEligibility } from '../src/lib/billing/waystarInbound/parse271';
import { parse277, statusEffect, claimReference } from '../src/lib/billing/waystarInbound/parse277';
import { detectX12Kind, parseX12 } from '../src/lib/billing/waystarInbound/x12';
import {
  generate270,
  generate276,
  validateClaimStatusInquiry,
  validateEligibilityInquiry,
  type InquiryConfig,
} from '../src/lib/billing/waystarInbound/generate';
import * as outboundClaims from '../src/lib/billing/waystarSftpClaims';

const FIX = join(__dirname, 'fixtures', 'waystar');
const fixture = (name: string) => readFileSync(join(FIX, name), 'utf8');

function snapshot(name: string, actual: string) {
  const path = join(FIX, 'snapshots', name);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(path)) {
    writeFileSync(path, actual);
    return;
  }
  assert.equal(actual, readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), `snapshot ${name} changed (UPDATE_SNAPSHOTS=1 to accept)`);
}

function claim(overrides: Partial<ClaimSnapshot> = {}): ClaimSnapshot {
  return {
    id: 'cmclaim0000000000000000001',
    organizationId: 'org1',
    clientId: 'client1',
    status: 'ACCEPTED',
    chargeTotal: 180,
    serviceLines: [{ id: 'line1', cptCode: '90837', modifier: null, totalCharge: 180 }],
    previouslyPosted: false,
    ...overrides,
  };
}

// ─── 835 ─────────────────────────────────────────────────────────────────────

test('835: file kind, payments, claims, lines and CAS are read', () => {
  const content = fixture('835-full-partial-denied.x12');
  assert.equal(detectX12Kind(content), '835');
  const remits = parse835(content);
  assert.equal(remits.length, 3);
  const [full, partial, denied] = remits;
  assert.equal(full.traceNumber, 'EFT0001');
  assert.equal(full.payerTraceId, '1512345678');
  assert.equal(full.paymentAmount, 120);
  assert.equal(full.paymentMethod, 'ACH');
  assert.equal(full.paymentDate, '2026-10-15');
  assert.equal(full.payerName, 'MARYLAND MEDICAID');
  assert.equal(full.payerId, 'MDMCD');
  assert.equal(full.payeeNpi, '1234567893');
  assert.deepEqual(full.balanceErrors, []);
  const c = full.claims[0];
  assert.equal(c.patientControlNumber, 'AXFULL00000000001');
  assert.equal(c.statusCode, '1');
  assert.equal(c.charge, 180);
  assert.equal(c.paid, 120);
  assert.equal(c.patientResponsibility, 20);
  assert.equal(c.payerClaimControlNumber, 'ICN-FULL-1');
  assert.equal(c.memberId, 'MA123456789');
  assert.equal(c.statementFrom, '2026-10-01');
  assert.equal(c.lines.length, 1);
  assert.equal(c.lines[0].procedureCode, '90837');
  assert.equal(c.lines[0].serviceDate, '2026-10-01');
  assert.equal(c.lines[0].allowed, 140);
  assert.equal(c.lines[0].lineControlNumber, '1');
  assert.deepEqual(c.lines[0].adjustments, [
    { group: 'CO', carc: '45', amount: 40, quantity: null },
    { group: 'PR', carc: '3', amount: 20, quantity: null },
  ]);
  assert.equal(contractualTotal(c), 40);

  assert.equal(partial.paymentMethod, 'CHK');
  assert.deepEqual(partial.balanceErrors, []);
  assert.deepEqual(partial.claims[0].lines[1].remarks, ['N130']);
  assert.equal(denied.claims[0].statusCode, '4');
  assert.deepEqual(denied.claims[0].claimRemarks, ['MA130']);
  assert.deepEqual(denied.balanceErrors, []);
});

test('835: full payment with an exact match auto-posts as PAID', () => {
  const [full] = parse835(fixture('835-full-partial-denied.x12'));
  const plan = planEraClaimPosting({ era: full.claims[0], match: 'control_number', claim: claim(), remitBalanced: true, claimBalanced: true, duplicate: false });
  assert.equal(plan.decision, 'auto');
  assert.deepEqual(plan.reasons, []);
  assert.equal(plan.outcome, 'paid');
  assert.equal(plan.nextStatus, 'PAID');
  assert.equal(plan.paidCents, 12000);
  assert.equal(plan.patientResponsibility, 20);
  assert.equal(plan.adjustmentTotal, 40);
  assert.deepEqual(plan.denials, []);
  assert.deepEqual(plan.lineMatches, [{ eraLineSeq: 1, serviceLineId: 'line1' }]);
});

test('835: partial payment posts PAID with an OPEN denial for the unpaid line (CARC + RARC)', () => {
  const [, partial] = parse835(fixture('835-full-partial-denied.x12'));
  const snap = claim({
    chargeTotal: 330,
    serviceLines: [
      { id: 'line-a', cptCode: '90837', modifier: null, totalCharge: 180 },
      { id: 'line-b', cptCode: '90785', modifier: null, totalCharge: 150 },
    ],
  });
  const plan = planEraClaimPosting({ era: partial.claims[0], match: 'control_number', claim: snap, remitBalanced: true, claimBalanced: true, duplicate: false });
  assert.equal(plan.decision, 'auto');
  assert.equal(plan.outcome, 'partial');
  assert.equal(plan.nextStatus, 'PAID');
  assert.equal(plan.denials.length, 1);
  assert.equal(plan.denials[0].reasonCode, 'CO-50');
  assert.equal(plan.denials[0].carcCode, '50');
  assert.equal(plan.denials[0].lineSeq, 2);
  assert.match(plan.denials[0].reasonText, /Line 2: CO-50 Non-covered: not deemed a medical necessity \(\$150\.00\); RARC N130/);
  assert.deepEqual(plan.lineMatches, [{ eraLineSeq: 1, serviceLineId: 'line-a' }, { eraLineSeq: 2, serviceLineId: 'line-b' }]);
});

test('835: denied claim (CLP02 4) posts DENIED with CARC 197 and RARC', () => {
  const [, , denied] = parse835(fixture('835-full-partial-denied.x12'));
  const plan = planEraClaimPosting({ era: denied.claims[0], match: 'control_number', claim: claim({ status: 'SUBMITTED' }), remitBalanced: true, claimBalanced: true, duplicate: false });
  assert.equal(plan.decision, 'auto');
  assert.equal(plan.outcome, 'denied');
  assert.equal(plan.nextStatus, 'DENIED');
  assert.equal(plan.paidCents, 0);
  assert.equal(plan.denials.length, 1);
  assert.equal(plan.denials[0].reasonCode, 'CO-197');
  assert.match(plan.denials[0].reasonText, /CO-197 Precertification \/ authorization \/ notification absent/);
  assert.match(plan.denials[0].reasonText, /RARC MA130/);
  assert.match(plan.denials[0].reasonText, /RARC N54/);
});

test('835: PLB provider adjustments balance BPR (WO recovery, L6 interest)', () => {
  const [r] = parse835(fixture('835-plb.x12'));
  assert.equal(r.paymentAmount, 192.5);
  assert.equal(r.claims.length, 2);
  assert.deepEqual(r.providerAdjustments, [
    { providerId: '1234567893', fiscalPeriodDate: '2026-12-31', reasonCode: 'WO', reference: 'AXOLD0000000009', amount: 25 },
    { providerId: '1234567893', fiscalPeriodDate: '2026-12-31', reasonCode: 'L6', reference: '', amount: -2.5 },
  ]);
  assert.deepEqual(r.balanceErrors, []);
  // Claim-level CAS only (no SVC) still balances
  assert.equal(r.claims[0].claimAdjustments[0].carc, '45');
  assert.equal(r.claims[1].patientResponsibility, 30);
});

test('835: an unbalanced payment is caught and sends every claim to review', () => {
  const broken = fixture('835-plb.x12').replace('BPR*I*192.50', 'BPR*I*200.00');
  const [r] = parse835(broken);
  assert.ok(r.balanceErrors.some((e) => e.startsWith('BPR02')));
  const plan = planEraClaimPosting({ era: r.claims[0], match: 'control_number', claim: claim({ chargeTotal: 150 }), remitBalanced: false, claimBalanced: true, duplicate: false });
  assert.equal(plan.decision, 'review');
  assert.match(plan.reasons.join(' '), /does not balance/);
});

test('835: review reasons — duplicate, no match, charge mismatch, already PAID, reversal', () => {
  const [full] = parse835(fixture('835-full-partial-denied.x12'));
  const era = full.claims[0];
  const base = { era, remitBalanced: true, claimBalanced: true } as const;

  const dup = planEraClaimPosting({ ...base, match: 'control_number', claim: claim(), duplicate: true });
  assert.equal(dup.decision, 'review');
  assert.match(dup.reasons[0], /duplicate/);

  const none = planEraClaimPosting({ ...base, match: 'none', claim: null, duplicate: false });
  assert.equal(none.decision, 'review');
  assert.match(none.reasons.join(' '), /No claim matches CLP01 AXFULL00000000001/);

  const mismatch = planEraClaimPosting({ ...base, match: 'control_number', claim: claim({ chargeTotal: 200 }), duplicate: false });
  assert.equal(mismatch.decision, 'review');
  assert.match(mismatch.reasons.join(' '), /Charge mismatch/);

  const paid = planEraClaimPosting({ ...base, match: 'control_number', claim: claim({ status: 'PAID', previouslyPosted: true }), duplicate: false });
  assert.equal(paid.decision, 'review');
  assert.equal(paid.reasons.length, 2);

  const reversal = planEraClaimPosting({ ...base, era: { ...era, statusCode: '22', paid: -120 }, match: 'control_number', claim: claim(), duplicate: false });
  assert.equal(reversal.outcome, 'reversal');
  assert.equal(reversal.decision, 'review');
});

test('835: the same file parsed twice yields the same TRN02 + TRN03 key (duplicate guard)', () => {
  const a = parse835(fixture('835-full-partial-denied.x12')).map((r) => `${r.traceNumber}|${r.payerTraceId}`);
  const b = parse835(fixture('835-full-partial-denied.x12')).map((r) => `${r.traceNumber}|${r.payerTraceId}`);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
});

test('835 stored shape feeds the outbound COB reader (era_claim_payments contract)', (t) => {
  const reader = (outboundClaims as Record<string, unknown>).eraAdjudicationFromPayments as
    | ((p: Array<{ paidAmount: number; paidDate: string | null; claimAdjustments: unknown; serviceLines: unknown }>, cpts: string[]) => { paidAmount: number; adjustments: unknown[]; lines?: unknown[] } | null)
    | undefined;
  if (typeof reader !== 'function') { t.skip('eraAdjudicationFromPayments not exported yet'); return; }
  const [full] = parse835(fixture('835-full-partial-denied.x12'));
  const c = full.claims[0];
  const stored = { paidAmount: c.paid, paidDate: full.paymentDate, claimAdjustments: c.claimAdjustments, serviceLines: c.lines.map((l) => ({ seq: l.seq, procedureCode: l.procedureCode, paid: l.paid, adjustments: l.adjustments })) };
  const cob = reader([stored], ['90837']);
  assert.ok(cob);
  assert.equal(cob!.paidAmount, 120);
  assert.equal(cob!.lines?.length, 1);
});

// ─── 271 ─────────────────────────────────────────────────────────────────────

test('271: active coverage with mental-health copay / coinsurance and plan-level deductible / OOP', () => {
  const content = fixture('271-mixed.x12');
  assert.equal(detectX12Kind(content), '271');
  const all = parse271(content);
  assert.equal(all.length, 4);
  const r = all[0];
  assert.equal(r.traceNumber, 'cmcheckactive000000000001');
  assert.equal(r.payerId, 'MDMCD');
  assert.equal(r.memberId, 'MA123456789');
  assert.equal(r.groupNumber, 'GRP100');
  assert.deepEqual(r.benefits[0].serviceTypes, ['30', 'MH']);
  const s = summarizeEligibility(r);
  assert.equal(s.status, 'ELIGIBLE');
  assert.equal(s.benefits.copay, 25); // in-network MH copay, not the $40 out-of-network one
  assert.equal(s.coinsurancePercent, 0.2);
  assert.equal(s.benefits.deductible, 500);
  assert.equal(s.benefits.deductibleMet, 300);
  assert.equal(s.benefits.oopMax, 3000);
  assert.equal(s.benefits.oopMet, 500);
  assert.equal(s.benefitSource, 'mental_health');
  assert.equal(s.planBegin, '2026-01-01');
  assert.equal(s.planEnd, '2026-12-31');
  assert.equal(s.planName, 'HEALTHCHOICE PLAN');
  assert.ok(s.benefits.coveredServices.includes('Mental health'));
  assert.deepEqual(s.rejections, []);
});

test('271: inactive coverage', () => {
  const s = summarizeEligibility(parse271(fixture('271-mixed.x12'))[1]);
  assert.equal(s.status, 'INELIGIBLE');
  assert.match(s.statusText, /Inactive/);
  assert.equal(s.planEnd, '2026-06-30');
});

test('271: AAA rejection (75 subscriber not found)', () => {
  const r = parse271(fixture('271-mixed.x12'))[2];
  assert.equal(r.rejections.length, 1);
  assert.equal(r.rejections[0].reasonCode, '75');
  const s = summarizeEligibility(r);
  assert.equal(s.status, 'ERROR');
  assert.match(s.statusText, /75 Subscriber \/ insured not found — Please correct and resubmit/);
});

test('271: dependent loop carries the trace; MH active but AI inactive is still eligible for MH', () => {
  const r = parse271(fixture('271-mixed.x12'))[3];
  assert.equal(r.isDependent, true);
  assert.equal(r.traceNumber, 'cmcheckdependent000000004');
  assert.equal(r.memberId, 'SUB999');
  const s = summarizeEligibility(r);
  assert.equal(s.status, 'ELIGIBLE');
  assert.ok(s.notes.includes('Substance abuse: inactive'));
});

test('271: plan active but every mental-health type inactive is INELIGIBLE', () => {
  const r = parse271(fixture('271-mixed.x12'))[3];
  const s = summarizeEligibility({ ...r, benefits: [{ ...r.benefits[0], serviceTypes: ['88'] }, { ...r.benefits[2], serviceTypes: ['MH'] }] });
  assert.equal(s.status, 'INELIGIBLE');
  assert.match(s.statusText, /mental health benefits inactive/);
});

// ─── 277 / 277CA ─────────────────────────────────────────────────────────────

test('277 (X212): STC categories map to claim effects; REF*EJ is the claim reference', () => {
  const content = fixture('277-status.x12');
  assert.equal(detectX12Kind(content), '277');
  const entries = parse277(content);
  assert.equal(entries.length, 6);
  assert.ok(entries.every((e) => e.kind === '277'));
  assert.deepEqual(entries.map(statusEffect), ['accepted', 'denied', 'rejected', 'pending', 'not_found', 'paid']);
  assert.equal(claimReference(entries[0]), 'AX0000000000000A1');
  assert.equal(entries[0].payerClaimControlNumber, 'ICN100');
  assert.equal(entries[0].serviceDate, '2026-10-01');
  const paid = entries[5];
  assert.equal(paid.paidAmount, 120);
  assert.equal(paid.chargeAmount, 180);
  assert.equal(paid.adjudicatedDate, '2026-10-14');
  assert.equal(paid.checkNumber, 'EFT0001');
  assert.equal(paid.lineStatuses.length, 1);
  assert.equal(paid.statuses.length, 1); // the line STC does not leak into the claim statuses
  assert.match(entries[2].statuses[0].text, /A7 Acknowledgement: rejected for invalid information/);
});

test('277CA (X214): claim acknowledgment kind, TRN02 reference, payer claim number', () => {
  const content = fixture('277ca.x12');
  assert.equal(detectX12Kind(content), '277CA');
  const entries = parse277(content);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, '277CA');
  assert.equal(claimReference(entries[0]), 'AXCA000000000001');
  assert.equal(statusEffect(entries[0]), 'accepted');
  assert.equal(entries[0].payerClaimControlNumber, 'PAYERCLAIM1');
  assert.equal(statusEffect(entries[1]), 'rejected');
});

// ─── 270 / 276 generation ────────────────────────────────────────────────────

const CFG: InquiryConfig = {
  submitterId: 'ALTRIXS01',
  submitterName: 'MD BEHAVIORAL HEALTH',
  receiverId: 'WAYSTAR',
  usageIndicator: 'T',
  providerName: 'MD Behavioral Health',
  providerNpi: '1234567893',
  originatorId: '1821111111',
};
const NOW = new Date(2026, 9, 16, 9, 30);

test('270 generation snapshot: subscriber + dependent, 30 / MH service types', () => {
  const subscriberInquiry = {
    traceNumber: 'cmcheck0000000000000000001',
    payerName: 'Maryland Medicaid',
    payerId: 'mdmcd',
    subscriber: { lastName: 'Testpatient', firstName: 'Jane', middleInitial: 'Q', dateOfBirth: '1990-04-02', gender: 'Female', memberId: 'MA123456789', groupNumber: null },
    serviceDate: '2026-10-16',
  };
  const dependentInquiry = {
    traceNumber: 'cmcheck0000000000000000002',
    payerName: 'CareFirst BCBS',
    payerId: '00580',
    subscriber: { lastName: 'Parent', firstName: 'Pat', memberId: 'SUB999', groupNumber: 'GRP*7' },
    dependent: { lastName: 'Child', firstName: 'Kid', dateOfBirth: '2015-01-01', gender: 'M' },
    serviceDate: '2026-10-16',
    serviceTypes: ['MH', 'A8', 'AI'] as const,
  };
  assert.deepEqual(validateEligibilityInquiry(subscriberInquiry), []);
  assert.deepEqual(validateEligibilityInquiry({ ...dependentInquiry, serviceTypes: [...dependentInquiry.serviceTypes] }), []);
  const file = generate270([subscriberInquiry, { ...dependentInquiry, serviceTypes: [...dependentInquiry.serviceTypes] }], CFG, { now: NOW, controlNumber: 270000001 });
  assert.equal(file.controlNumber, '270000001');
  assert.equal(file.batchId, 'ALTRIXS-270-20261016-0001');
  const doc = parseX12(file.content);
  assert.equal(doc.segments[0][0], 'ISA');
  assert.equal(file.content.split('~')[0].length, 105); // fixed-width ISA (terminator is char 106)
  assert.equal(doc.segments.filter((s) => s[0] === 'ST').length, 2);
  // SE01 counts ST..SE
  for (const set of file.content.split('ST*').slice(1)) {
    const segs = ('ST*' + set).split('~').map((s) => s.trim()).filter(Boolean);
    const seIdx = segs.findIndex((s) => s.startsWith('SE*'));
    assert.equal(Number(segs[seIdx].split('*')[1]), seIdx + 1);
  }
  snapshot('270-subscriber-dependent.x12', file.content);
});

test('270 validation lists missing data instead of sending', () => {
  const errors = validateEligibilityInquiry({
    traceNumber: 'x', payerName: '', payerId: '', subscriber: { lastName: '', firstName: '', memberId: 'bad id!' }, serviceDate: '2026-13',
    serviceTypes: ['ZZ' as never],
  });
  assert.ok(errors.some((e) => /payer ID/.test(e)));
  assert.ok(errors.some((e) => /Member ID/.test(e)));
  assert.ok(errors.some((e) => /name/.test(e)));
  assert.ok(errors.some((e) => /Date of service/.test(e)));
  assert.ok(errors.some((e) => /Unsupported service type/.test(e)));
});

test('276 generation snapshot', () => {
  const inquiry = {
    traceNumber: 'AX0000000000000A1',
    claimControlNumber: 'AX0000000000000A1',
    payerClaimControlNumber: 'ICN100',
    payerName: 'Maryland Medicaid',
    payerId: 'MDMCD',
    subscriber: { lastName: 'Testpatient', firstName: 'Jane', dateOfBirth: '1990-04-02', gender: 'F', memberId: 'MA123456789' },
    chargeAmount: 180,
    serviceFrom: '2026-10-01',
  };
  assert.deepEqual(validateClaimStatusInquiry(inquiry), []);
  const file = generate276([inquiry], CFG, { now: NOW, controlNumber: 276000001 });
  assert.equal(file.batchId, 'ALTRIXS-276-20261016-0001');
  assert.match(file.content, /GS\*HR\*ALTRIXS01\*WAYSTAR\*20261016\*0930\*276000001\*X\*005010X212~/);
  snapshot('276-claim-status.x12', file.content);
  // Our own 277 reader finds the reference we sent
  assert.match(file.content, /TRN\*1\*AX0000000000000A1~/);
  assert.match(file.content, /REF\*EJ\*AX0000000000000A1~/);
});
