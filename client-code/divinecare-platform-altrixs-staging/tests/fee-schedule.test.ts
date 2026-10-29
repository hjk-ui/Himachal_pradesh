import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claimLineCpt,
  deriveFee,
  deriveVariant,
  isInsuranceBillable,
  mergeCptOptions,
  parseFeeScheduleCsv,
  pickFee,
  planFeeImport,
  priceClaimLines,
  selfPayFeeProblem,
  summarizeFees,
  visitContext,
  type ExistingFee,
  type FeeItem,
} from '../src/lib/billing/feeSchedule';
import { CPT_CODES, chargeAmountCents } from '../src/lib/constants/cpt';
import { noteCptOptions, NOTE_CPT_OPTIONS } from '../src/lib/ai/noteDraftFormats';

// Rows copied from Valant's Fees export (same header, generic column names)
const CSV = [
  'PatientName1,ServiceDate11,textBox1,textBox2',
  'Zeroed,$0.00,0000,0000',
  'Diagnostic Assessment - Therapy,$300.00,90791,90791',
  'Diagnostic Assessment Child - Therapy,$300.00,90791C,90791',
  'Diagnostic Assessment Child - Therapy,$300.00,90791CS,',
  'Diagnostic Assessment - Therapy,$300.00,90791T,90791',
  'Psychiatric Diagnostic Eval. w/ Med Svcs,$300.00,90792,90792',
  'Psychiatric Diagnostic Eval - Child,$300.01,90792C,90792',
  'Psychiatric Diagnostic Eval. w/ Med Svcs,$300.00,90792S,90792',
  'Psychotherapy (45 min),$144.14,90834,90834',
  'Psychotherapy w/ITP,$175.01,90834-ITP,90834',
  'Psychotherapy w/ITP,$175.01,90834C-ITPC,90834',
  'Psychotherapy Self Pay (45 min),$180.00,90834S,90834S',
  'Psychotherapy,$144.14,90834T,90834',
  'Psychotherapy,$259.00,90837,90837',
  'Psychotherapy,$259.00,90837C,90837C',
  'Psychotherapy,$259.00,90837ITP,90837',
  'Psychotherapy (60 min) Self,$100.00,90837S,90837S',
  'Psychotherapy,$259.00,90837T,90837',
  'Couple Therapy,$150.11,90847,90847',
  'Couple Therapy Self PAY,$100.00,90847S,90847S',
  'Couple Therapy Telehealth,$150.11,90847T,90847',
  'Echo,$259.00,93306,99306',
  'Psychological Testing_Self Pay,$50.00,96136S,',
  'New Pt Moderate Complexity,$275.00,99204,99204',
  'New Pt High Complexity (60 min),$290.00,99205,99205',
  'New Pt High Complexity (60 min),$250.00,99205-Spravato,99205',
  'Est Pt Minor Cplx (10 min),$135.00,99212,99212',
  'Self pay fro DR Followup 20-35 minutes,$200.00,99213SG,',
  '"Prolonged Service, After H(91-150)",$40.00,99354,99354',
  'Appointment Not Confirmed Or Cancelled,$0.00,Cancelled,CANCLD',
  'PRP Adults,"$1,300.00",H2018AD,H2018',
  'PRP Child,$608.34,H2018CH,H2018',
  'No show patients,$0.00,NSH - Thrpy,NSH - T',
  'PRP IRP,$0.00,PRP IRP,',
  'Screening Papanicolaou smear,$50.00,q0091,Q0091',
  'Medical Records Code,$15.00,S9981A,S9981',
].join('\r\n');

const parsed = parseFeeScheduleCsv(CSV);
const byCode = new Map(parsed.items.map((i) => [i.code, i]));
const get = (code: string) => {
  const f = byCode.get(code);
  assert.ok(f, `missing ${code}`);
  return f;
};
const items: FeeItem[] = parsed.items.map((f) => ({ ...f, active: true, source: 'valant' }));

test('CSV parsing: header, money incl. $300.01 and "$1,300.00", quoted commas, blank billed code', () => {
  assert.equal(parsed.headerOk, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.items.length, 36);
  assert.equal(get('90792C').feeCents, 30001);
  assert.equal(get('90834').feeCents, 14414);
  assert.equal(get('H2018AD').feeCents, 130000);
  assert.equal(get('99354').description, 'Prolonged Service, After H(91-150)');
  assert.equal(get('90791CS').billedCpt, null);
  assert.equal(get('q0091').baseCpt, 'Q0091');
  assert.equal(get('q0091').code, 'q0091', 'raw Valant code kept');
});

test('CSV parsing: wrong header and duplicate codes are reported', () => {
  assert.equal(parseFeeScheduleCsv('Code,Fee\n90837,$1.00').headerOk, false);
  const dup = parseFeeScheduleCsv('PatientName1,ServiceDate11,textBox1,textBox2\nA,$1.00,90837,90837\nB,$2.00,90837,90837\nC,abc,90834,90834');
  assert.equal(dup.items.length, 1);
  assert.equal(dup.errors.length, 2);
  assert.match(dup.errors[0].error, /repeats/);
  assert.match(dup.errors[1].error, /unreadable fee/);
});

test('variant derivation from the code suffix and the description', () => {
  assert.deepEqual(
    [get('90847T').telehealth, get('90847T').selfPay, get('90847T').variantLabel],
    [true, false, 'Telehealth']
  );
  assert.equal(get('90837S').selfPay, true);
  assert.equal(get('90837S').baseCpt, '90837');
  assert.equal(get('90791C').child, true);
  assert.deepEqual([get('90791CS').child, get('90791CS').selfPay], [true, true]);
  assert.deepEqual([get('90834C-ITPC').child, get('90834C-ITPC').itp, get('90834C-ITPC').baseCpt], [true, true, '90834']);
  assert.equal(get('90834-ITP').itp, true);
  assert.equal(get('90837ITP').itp, true);
  assert.equal(get('H2018CH').child, true);
  assert.equal(get('H2018AD').variantLabel, 'Adult');
  assert.deepEqual([get('99213SG').selfPay, get('99213SG').exactOnly], [true, true]);
  assert.deepEqual([get('99205-Spravato').exactOnly, get('99205-Spravato').variantLabel], [true, 'Spravato']);
  // Description-only flags
  assert.equal(deriveVariant('90834', 'Psychotherapy Self Pay (45 min)').selfPay, true);
  assert.equal(deriveVariant('H0031', 'Case Management Assessment - Telehealth').telehealth, true);
  assert.equal(deriveVariant('90846', 'Family Therapy without patient - Child').child, true);
  // Admin codes
  for (const c of ['Cancelled', 'NSH - Thrpy', 'PRP IRP', '0000']) {
    assert.equal(get(c).baseCpt, null, c);
    assert.equal(get(c).insuranceBillable, false, c);
    assert.equal(get(c).variantLabel, 'Admin (no CPT)');
  }
});

test('anomalies are flagged, never fixed: Echo 93306 bills as 99306', () => {
  const echo = get('93306');
  assert.equal(echo.billedCpt, '99306', 'kept as Valant has it');
  assert.equal(echo.needsReview, true);
  assert.match(echo.reviewNote ?? '', /^Check: .*93306.*99306/);
  assert.equal(get('90837C').needsReview, true);
  assert.equal(get('90837C').insuranceBillable, false, 'billed code with a suffix is not a CPT');
  assert.equal(get('90792S').needsReview, true, 'self-pay suffix but billed to insurance in Valant');
  assert.equal(get('S9981A').exactOnly, true);
  assert.equal(get('90837').needsReview, false);
  const s = summarizeFees(parsed.items);
  assert.deepEqual(s.needsReview.map((n) => n.code).sort(), ['90792S', '90837C', '93306', 'S9981A']);
});

test('self-pay is never insurance-billable', () => {
  assert.equal(isInsuranceBillable({ baseCpt: '90792', billedCpt: '90792', selfPay: true }), false);
  assert.equal(get('90792S').insuranceBillable, false);
  assert.equal(get('90791CS').insuranceBillable, false);
  assert.equal(get('96136S').insuranceBillable, false);
  assert.equal(get('90837T').insuranceBillable, true);
  // Insurance visit never picks a self-pay item, even when it is the only variant
  for (const cpt of ['90837', '90834', '90847', '90791', '90792']) {
    const q = pickFee(items, { cpt, selfPay: false });
    assert.equal(q.insuranceBillable, true, cpt);
    assert.ok(!byCode.get(q.code ?? '')?.selfPay, cpt);
  }
  // Explicit self-pay code on an insurance claim is refused
  const r = priceClaimLines(items, [{ cptCode: '90837', units: 1, feeCode: '90837S' }], { telehealth: false, selfPay: false, child: false });
  assert.equal('error' in r, true);
  if ('error' in r) assert.match(r.error, /self-pay or non-billable/);
  // ... allowed on a self-pay claim; line CPT is the base, never "90837S"
  const ok = priceClaimLines(items, [{ cptCode: '90837', units: 2, feeCode: '90837S' }], { telehealth: false, selfPay: true, child: false });
  assert.equal('error' in ok, false);
  if (!('error' in ok)) {
    assert.equal(ok.lines[0].cptCode, '90837');
    assert.equal(ok.lines[0].charge, 200);
    assert.equal(ok.summary.lines[0].code, '90837S');
  }
});

test('feeFor: most specific variant wins, then base code, then constants', () => {
  const q = (ctx: Parameters<typeof pickFee>[1]) => pickFee(items, ctx);
  assert.equal(q({ cpt: '90837' }).code, '90837');
  assert.equal(q({ cpt: '90837', telehealth: true }).code, '90837T');
  assert.equal(q({ cpt: '90837', telehealth: true }).billedCpt, '90837', 'payer never gets the suffix code');
  assert.equal(q({ cpt: '90837', selfPay: true }).code, '90837S');
  assert.equal(q({ cpt: '90837', selfPay: true }).feeCents, 10000);
  assert.equal(q({ cpt: '90837', selfPay: true, telehealth: true }).code, '90837S', 'self-pay rate outranks telehealth');
  assert.equal(q({ cpt: '90837', child: true }).code, '90837', '90837C is not billable, falls back to base');
  assert.equal(q({ cpt: '90791', child: true }).code, '90791C');
  assert.equal(q({ cpt: '90791', child: true, selfPay: true }).code, '90791CS');
  assert.equal(q({ cpt: '90834', child: true, itp: true }).code, '90834C-ITPC');
  assert.equal(q({ cpt: '90834', itp: true }).code, '90834-ITP');
  assert.equal(q({ cpt: '90834', child: true }).code, '90834', 'child without ITP: C-ITPC not a candidate');
  assert.equal(q({ cpt: 'H2018' }).code, 'H2018AD');
  assert.equal(q({ cpt: 'H2018', child: true }).code, 'H2018CH');
  assert.equal(q({ cpt: '99205' }).code, '99205', 'Spravato only when picked');
  assert.equal(q({ cpt: '99205', code: '99205-Spravato' }).feeCents, 25000);
  assert.equal(q({ cpt: '99213', selfPay: true }).source, 'constants', '99213SG is exact-only');
  assert.equal(q({ cpt: '90837-GT' }).code, '90837', 'modifier segment ignored');
  assert.equal(q({ cpt: 'Q0091' }).code, 'q0091');
  // Inactive rows are skipped
  const inactive = items.map((i) => (i.code === '90837T' ? { ...i, active: false } : i));
  assert.equal(pickFee(inactive, { cpt: '90837', telehealth: true }).code, '90837');
  // Not in the fee schedule -> constants
  const c = q({ cpt: 'H0038' });
  assert.deepEqual([c.source, c.feeCents, c.code, c.billedCpt], ['constants', chargeAmountCents('H0038', 1), null, 'H0038']);
  assert.equal(pickFee([], { cpt: '90837' }).feeCents, chargeAmountCents('90837', 1));
  assert.ok(pickFee([], { cpt: 'ZZZZZ' }).warnings.length > 0);
});

test('claim line CPT: billed code, except a flagged code that bills a different CPT', () => {
  const echo = pickFee(items, { cpt: '93306' });
  assert.equal(echo.code, '93306');
  assert.ok(echo.warnings.some((w) => /99306/.test(w)));
  const lc = claimLineCpt(echo, { selfPay: false });
  assert.equal(lc.cpt, '93306');
  assert.match(lc.warning ?? '', /reviewed/);
  // Once staff clear the review flag the billed code is used as configured
  const cleared = items.map((i) => (i.code === '93306' ? { ...i, needsReview: false, reviewNote: null } : i));
  assert.equal(claimLineCpt(pickFee(cleared, { cpt: '93306' }), { selfPay: false }).cpt, '99306');
  assert.equal(claimLineCpt(pickFee(items, { cpt: '90847', telehealth: true }), { selfPay: false }).cpt, '90847');
  // Modifiers on the line CPT survive pricing
  const r = priceClaimLines(items, [{ cptCode: '90837-GT', units: 1 }], { telehealth: true, selfPay: false, child: false });
  if ('error' in r) assert.fail(r.error);
  assert.equal(r.lines[0].cptCode, '90837-GT');
  assert.equal(r.lines[0].charge, 259);
  assert.equal(r.summary.lines[0].code, '90837T');
  assert.equal(r.isKnownCode('99212'), true);
  // A charge typed by staff is kept
  const typed = priceClaimLines(items, [{ cptCode: '90837', units: 1, charge: 12.5 }], { telehealth: false, selfPay: false, child: false });
  if ('error' in typed) assert.fail(typed.error);
  assert.equal(typed.lines[0].charge, 12.5);
  assert.equal(typed.summary.lines[0].chargeFromFeeSchedule, false);
});

test('visit context: child under 18 on DOS, self-pay without an active payer', () => {
  const kid = { dateOfBirth: new Date('2010-06-15T12:00:00Z'), insurancePayer: 'CareFirst', insuranceEffectiveTo: null };
  assert.equal(visitContext(kid, { serviceDate: '2028-06-14' }).child, true);
  assert.equal(visitContext(kid, { serviceDate: '2028-06-15' }).child, false);
  assert.equal(visitContext(kid, { serviceDate: '2026-10-17' }).selfPay, false);
  assert.equal(visitContext({ ...kid, insurancePayer: null }, { serviceDate: '2026-10-17' }).selfPay, true);
  assert.equal(visitContext({ ...kid, insurancePayer: 'Self Pay' }, {}).selfPay, true);
  assert.equal(
    visitContext({ ...kid, insuranceEffectiveTo: new Date('2026-01-01T00:00:00Z') }, { serviceDate: '2026-10-17' }).selfPay,
    true,
    'coverage ended before DOS'
  );
  assert.equal(visitContext({ ...kid, insurancePayer: null }, { payer: 'Aetna' }).selfPay, false, 'form payer wins');
  assert.equal(visitContext(kid, { telehealth: true }).telehealth, true);
});

test('re-import is idempotent and keeps Altrixs edits unless overwriteEdits', () => {
  const first = planFeeImport([], parsed.items);
  assert.equal(first.create.length, parsed.items.length);
  const stored: ExistingFee[] = first.create.map((f, i) => ({ ...f, id: `id${i}`, source: 'valant', active: true }));

  const again = planFeeImport(stored, parsed.items);
  assert.deepEqual([again.create.length, again.update.length, again.keptEdits.length], [0, 0, 0]);
  assert.equal(again.unchanged.length, parsed.items.length);

  // Valant changed a fee -> valant row updated
  const newer = parsed.items.map((f) => (f.code === '90837' ? { ...f, feeCents: 26500 } : f));
  const upd = planFeeImport(stored, newer);
  assert.deepEqual(upd.update.map((u) => [u.code, u.changed]), [['90837', ['feeCents']]]);

  // Staff edited 90834 (source altrixs): kept, reported
  const edited = stored.map((e) => (e.code === '90834' ? { ...e, feeCents: 15000, source: 'altrixs' as const } : e));
  const kept = planFeeImport(edited, parsed.items);
  assert.equal(kept.update.length, 0);
  assert.deepEqual(kept.keptEdits, [{ code: '90834', changed: ['feeCents'] }]);
  const over = planFeeImport(edited, parsed.items, { overwriteEdits: true });
  assert.equal(over.update.length, 1);
  assert.equal(over.update[0].overwritesEdit, true);
  assert.equal(over.update[0].data.feeCents, 14414);

  // Codes match case-insensitively; rows missing from the file are left alone
  const extra: ExistingFee = { ...stored[0], id: 'x', code: 'ZZ999' };
  assert.deepEqual(planFeeImport([...stored, extra], parsed.items).notInFile, ['ZZ999']);
});

test('deriveFee with staff flags recomputes billability (self-pay never billable)', () => {
  const f = deriveFee({ code: '90837', description: 'Psychotherapy', feeCents: 25900, billedCpt: '90837', flags: { selfPay: true } });
  assert.equal(f.insuranceBillable, false);
  assert.equal(f.variantLabel, 'Self-pay');
});

test('CPT pickers include fee schedule base CPTs (99212 / 99204 / 99205) without dropping any code', () => {
  const codes = [
    { code: '99212', description: 'Est Pt Minor Cplx (10 min)', feeCents: 13500 },
    { code: '99204', description: 'New Pt Moderate Complexity', feeCents: 27500 },
    { code: '99205', description: 'New Pt High Complexity (60 min)', feeCents: 29000 },
    { code: '90837', description: 'Psychotherapy', feeCents: 25900 },
  ];
  const merged = mergeCptOptions(CPT_CODES, codes);
  for (const c of CPT_CODES) assert.ok(merged.some((m) => m.code === c.code), c.code);
  for (const c of ['99212', '99204', '99205']) assert.ok(merged.some((m) => m.code === c), c);
  assert.equal(merged.find((m) => m.code === '90837')?.rate, 259, 'fee schedule rate wins');
  const notes = noteCptOptions(codes);
  assert.ok(notes.some((o) => o.code === '99212'));
  assert.equal(NOTE_CPT_OPTIONS.length, CPT_CODES.length, 'built-in list unchanged');
});

test('scrubber rule: a claim with a payer priced with a self-pay fee is blocked', () => {
  const sd = (lines: { code: string; insuranceBillable: boolean }[], selfPay = false) => ({ payerId: 'X', feeSchedule: { context: { selfPay }, lines } });
  assert.match(selfPayFeeProblem(sd([{ code: '90837S', insuranceBillable: false }]), 'CareFirst') ?? '', /90837S/);
  assert.match(selfPayFeeProblem(sd([{ code: '90837', insuranceBillable: true }], true), 'CareFirst') ?? '', /self-pay fee schedule rates/);
  assert.equal(selfPayFeeProblem(sd([{ code: '90837T', insuranceBillable: true }]), 'CareFirst'), null);
  assert.equal(selfPayFeeProblem(sd([{ code: '90837S', insuranceBillable: false }]), null), null, 'self-pay claim with no payer is fine');
  assert.equal(selfPayFeeProblem({ payerId: 'X' }, 'CareFirst'), null, 'claims priced before the fee schedule');
});
