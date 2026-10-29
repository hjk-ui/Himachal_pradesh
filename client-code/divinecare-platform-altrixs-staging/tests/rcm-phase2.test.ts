/**
 * Revenue-cycle phase 2: prior auth units, ERA (reversals, PLB, accumulation, duplicate key,
 * crossover, front-end rejections), legacy path retirement, timely filing queue, statements SMS,
 * payment idempotency, batch cents. Synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { authUnitsForLines } from '../src/lib/billing/priorAuthMath';
import { claimToBatchClaim, type ClaimForMapping, type MapperContext, type PayerMappingConfig, type PriorAuthRecord } from '../src/lib/billing/waystarSftpClaims';
import { computeAuthForecast, type ForecastAuthInput } from '../src/lib/ai/authForecast/forecast';
import { accumulatedTotals, crossoverSignal, plbBatchLines, remittanceKey } from '../src/lib/billing/waystarInbound/eraPosting';
import { batchCents, bulkBatchNumber } from '../src/lib/billing/paymentBatchMath';
import { statementSmsText } from '../src/lib/billing/statementSms';
import { timelyFiling } from '../src/lib/billing/claimRules';
import { sectionsForRole } from '../src/lib/inbox/sections';

function loadWithMocks<T>(path: string, db: Record<string, unknown>): T {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: db };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async (e: unknown) => void audits.push(e) };
    return originalLoad.call(this, id, ...args);
  };
  try {
    return createRequire(import.meta.url)(path) as T;
  } finally {
    loader._load = originalLoad;
  }
}
const audits: unknown[] = [];

// ─── Prior auth units ───────────────────────────────────────────────────────

test('prior auth: units counted are the lines the auth covers (all lines when it lists no CPT)', () => {
  const lines = [{ cpt: '90837', units: 1 }, { cpt: '90785', units: 1 }, { cpt: 'T1016', units: 4 }];
  assert.equal(authUnitsForLines(['90837'], lines), 1);
  assert.equal(authUnitsForLines(['T1016-HO'], lines), 4);
  assert.equal(authUnitsForLines([], lines), 6);
});

const MAP = (over: Partial<PayerMappingConfig> = {}): PayerMappingConfig => ({
  payerName: 'Auth Plan', aliases: [], waystarPayerId: 'TESTAUTH', claimFilingCode: 'CI', telehealthModifier: '95', requiresPriorAuth: true, verified: true, active: true, ...over,
});
const AUTH = (over: Partial<PriorAuthRecord> = {}): PriorAuthRecord => ({
  authNumber: 'PA-1', status: 'APPROVED', payer: 'Auth Plan', cptCodes: ['90837'], startDate: new Date('2026-09-01'), endDate: new Date('2026-12-31'), unitsApproved: 10, unitsUsed: 10, ...over,
});
function authClaim(over: Partial<ClaimForMapping> = {}): ClaimForMapping {
  return {
    id: 'c1', claimControlNumber: 'AXT1', status: 'READY', cptCode: '90837', units: 1, amountCents: 18000, payer: 'Auth Plan', icd10Codes: ['F33.1'],
    placeOfService: '11', renderingNpi: null, billingNpi: null, submissionData: { diagnosisCodes: ['F33.1'] }, noteStatus: 'LOCKED',
    client: { name: 'X', legalFirstName: 'Jane', legalLastName: 'Test', dateOfBirth: new Date('1990-01-01'), gender: 'F', addressLine1: '1 St', city: 'Bowie', state: 'MD', postalCode: '20715', insurancePayer: 'Auth Plan', insuranceMemberId: 'M123' },
    appointment: null,
    note: { id: 'n1', clinicianId: 'u1', dateOfService: new Date('2026-10-14T00:00:00Z'), cptCode: '90837', durationMinutes: 55, workflow: { status: 'LOCKED' } },
    renderingClinician: { npi: '1111111112', legalFirstName: 'Sam', legalLastName: 'Clin', taxonomyCode: '101YP2500X' },
    serviceLines: [],
    ...over,
  };
}
const AUTH_CTX = (auths: PriorAuthRecord[], mapping = MAP()): MapperContext => ({ groupNpi: '1234567893', billingTaxonomy: '261QM0801X', payerMappings: [mapping], priorAuths: auths });
const errs = (c: ClaimForMapping, ctx: MapperContext) => {
  const r = claimToBatchClaim(c, ctx);
  return 'errors' in r ? r.errors.join('\n') : '';
};

test('prior auth: exhausted auth blocks payers that require auth, warns otherwise; a corrected claim is not counted twice', () => {
  assert.match(errs(authClaim(), AUTH_CTX([AUTH()])), /auth exhausted/);
  const warnOnly = claimToBatchClaim(authClaim(), AUTH_CTX([AUTH()], MAP({ requiresPriorAuth: false })));
  assert.ok(warnOnly.ok);
  assert.match(warnOnly.ok ? warnOnly.warnings.join(' ') : '', /10 of 10 units already used/);
  // This claim already counted its 1 unit under PA-1 (resent as a corrected claim): 9 + 1 fits
  const counted = authClaim({ submissionData: { diagnosisCodes: ['F33.1'], priorAuthUsage: { authId: 'a', authNumber: 'PA-1', units: 1 } } });
  assert.equal(claimToBatchClaim(counted, AUTH_CTX([AUTH()])).ok, true);
  // Outside the auth dates for an auth-required payer: blocked
  assert.match(errs(authClaim(), AUTH_CTX([AUTH({ unitsUsed: 0, endDate: new Date('2026-10-01') })])), /requires prior authorization/);
});

test('prior auth: units are counted once on send and released once on denial', async () => {
  const state = { sd: {} as Record<string, unknown>, unitsUsed: 2 };
  const tx = {
    claim: {
      findFirst: async () => ({ clientId: 'cl1', submissionData: state.sd }),
      update: async ({ data }: { data: { submissionData: Record<string, unknown> } }) => { state.sd = data.submissionData; },
    },
    priorAuth: {
      findFirst: async () => ({ id: 'pa1', cptCodes: ['90837'], unitsUsed: state.unitsUsed }),
      update: async ({ data }: { data: { unitsUsed: number | { increment: number } } }) => {
        state.unitsUsed = typeof data.unitsUsed === 'number' ? data.unitsUsed : state.unitsUsed + data.unitsUsed.increment;
      },
    },
  };
  const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const usage = loadWithMocks<typeof import('../src/lib/billing/priorAuthUsage')>('../src/lib/billing/priorAuthUsage', db);
  const input = { organizationId: 'o1', claimId: 'c1', authNumber: 'PA-1', lines: [{ cpt: '90837', units: 1 }] };
  assert.equal(await usage.recordPriorAuthUsage(input), 1);
  assert.equal(state.unitsUsed, 3);
  assert.equal(await usage.recordPriorAuthUsage(input), 0, 'second send (corrected claim) is not counted again');
  assert.equal(state.unitsUsed, 3);
  assert.equal(await usage.releasePriorAuthUsage({ organizationId: 'o1', claimId: 'c1', reason: 'claim denied' }), 1);
  assert.equal(state.unitsUsed, 2);
  assert.equal(await usage.releasePriorAuthUsage({ organizationId: 'o1', claimId: 'c1', reason: 'again' }), 0, 'released once');
});

test('auth forecast counts units when billed units are given (not unique days)', () => {
  const auth: ForecastAuthInput = {
    id: 'pa', clientId: 'c', payer: 'P', authNumber: 'A', cptCodes: ['T1016'], unitsApproved: 20, unitsUsed: 0, status: 'APPROVED',
    startDate: new Date('2026-10-01T12:00:00Z'), endDate: new Date('2026-12-31T12:00:00Z'), vendor: null, notes: null,
  };
  const now = new Date('2026-10-17T16:00:00Z');
  const lead = { days: 14, source: 'test' };
  const days = computeAuthForecast({ auth, visits: { attendedDays: ['2026-10-05', '2026-10-05', '2026-10-12'], scheduledDays: [] }, plan: null, lead, now });
  assert.equal(days.visitsUsed, 2);
  const units = computeAuthForecast({
    auth, visits: { attendedDays: ['2026-10-05', '2026-10-12'], scheduledDays: [], attendedUnits: [{ day: '2026-10-05', units: 4 }, { day: '2026-10-12', units: 3 }] }, plan: null, lead, now,
  });
  assert.equal(units.visitsUsed, 7);
});

// ─── ERA ─────────────────────────────────────────────────────────────────────

const REMIT = {
  traceNumber: '', payerTraceId: '1999999999', payerId: 'P1', payerName: 'Payer One', paymentAmount: 250, paymentDate: '2026-10-20',
  claims: [{ patientControlNumber: 'AX1', statusCode: '1', paid: 150, payerClaimControlNumber: 'ICN1' }, { patientControlNumber: 'AX2', statusCode: '1', paid: 100 }],
};

test('ERA duplicate key: TRN02 when present; otherwise a content hash, independent of the file name', () => {
  assert.deepEqual(remittanceKey({ ...REMIT, traceNumber: 'EFT123' }), { traceNumber: 'EFT123', payerTraceId: '1999999999' });
  const a = remittanceKey(REMIT);
  const b = remittanceKey({ ...REMIT, claims: [...REMIT.claims].reverse() });
  assert.match(a.traceNumber, /^NOTRN-[0-9a-f]{40}$/);
  assert.equal(a.traceNumber, b.traceNumber, 'same payment re-delivered (any file name, any CLP order) = same key');
  assert.notEqual(remittanceKey({ ...REMIT, paymentAmount: 251 }).traceNumber, a.traceNumber);
  assert.ok(a.traceNumber.length <= 50);
});

test('ERA second posting accumulates paid, adjustments and patient responsibility; reversal subtracts', () => {
  const prev = { paidAmount: 120, adjustmentAmount: 40, patientResponsibility: 20 };
  assert.deepEqual(accumulatedTotals(prev, { paid: 30, adjustmentTotal: 5, patientResponsibility: 0 }, true), { paidAmount: 150, adjustmentAmount: 45, patientResponsibility: 20 });
  assert.deepEqual(accumulatedTotals(prev, { paid: -120, adjustmentTotal: -40, patientResponsibility: -20 }, true), { paidAmount: 0, adjustmentAmount: 0, patientResponsibility: 0 });
  assert.deepEqual(accumulatedTotals(prev, { paid: 30, adjustmentTotal: 5, patientResponsibility: 2 }, false), { paidAmount: 30, adjustmentAmount: 5, patientResponsibility: 2 });
});

test('ERA PLB adjustments become batch lines so the batch reconciles to BPR02', () => {
  const plb = plbBatchLines([{ reasonCode: 'WO', reference: 'OVERPMT1', amount: 50 }, { reasonCode: 'L6', amount: -2.5 }, { reasonCode: 'FB', amount: 0 }]);
  assert.deepEqual(plb.map((p) => p.paidAmount), [-50, 2.5]);
  const claimsPaid = 150 + 100;
  const bpr02 = claimsPaid - 50 + 2.5;
  assert.equal(Math.round((claimsPaid + plb.reduce((t, p) => t + p.paidAmount, 0)) * 100), Math.round(bpr02 * 100));
});

test('ERA Medicaid crossover: CLP02 19, MA18 or N522 is detected', () => {
  assert.match(crossoverSignal({ statusCode: '19', claimRemarks: [], lines: [] }) ?? '', /forwarded/);
  assert.match(crossoverSignal({ statusCode: '1', claimRemarks: ['MA18'], lines: [] }) ?? '', /MA18/);
  assert.match(crossoverSignal({ statusCode: '1', claimRemarks: [], lines: [{ remarks: ['N522'] } as never] }) ?? '', /N522/);
  assert.equal(crossoverSignal({ statusCode: '1', claimRemarks: ['N130'], lines: [] }), null);
});

// ─── Batches, statements, timely filing, inbox ───────────────────────────────

test('bulk batch: cents math (no float drift) and unique / idempotent batch numbers', () => {
  const lines = Array.from({ length: 3 }, () => ({ paid: 0.1 }));
  assert.equal(batchCents(0.3, lines).balanced, true, '0.1 + 0.1 + 0.1 == 0.3 in cents');
  assert.equal(batchCents(0.31, lines).balanced, false);
  const deps = (r: string) => ({ hash: (t: string) => Buffer.from(t).toString('hex').padEnd(32, '0'), random: () => r, now: new Date('2026-10-20T10:00:00Z') });
  assert.equal(bulkBatchNumber('o1', 'key-12345', deps('a')), bulkBatchNumber('o1', 'key-12345', deps('b')), 'same key, same batch');
  assert.notEqual(bulkBatchNumber('o1', null, deps('aaaaaaaaaa')), bulkBatchNumber('o1', null, deps('bbbbbbbbbb')));
  assert.match(bulkBatchNumber('o1', null, deps('abcdef0123')), /^BATCH-20261020-ABCDEF0123$/);
});

test('statement SMS carries no balance or detail (minimum necessary)', () => {
  const t = statementSmsText('MD Behavioral Health', 'https://example.test/patient/home');
  assert.equal(t, 'MD Behavioral Health: You have a new statement. View securely: https://example.test/patient/home Reply STOP to opt out.');
  assert.ok(!/\$|\d+\.\d{2}|balance/i.test(t));
  assert.match(statementSmsText(null, 'https://x.test'), /^Your care team: /);
});

test('timely filing: past / near (30 days) / ok; inbox queue for billing roles only', () => {
  const today = new Date('2027-03-20T12:00:00Z');
  assert.equal(timelyFiling('2026-10-14', 180, today)?.status, 'near');
  assert.equal(timelyFiling('2026-08-01', 180, today)?.status, 'past');
  assert.equal(timelyFiling('2027-03-01', 180, today)?.status, 'ok');
  assert.equal(timelyFiling('2026-10-14', null, today), null);
  assert.ok(sectionsForRole('BILLING').some((s) => s.key === 'timely_filing'));
  assert.ok(!sectionsForRole('THERAPIST').some((s) => s.key === 'timely_filing'));
});

// ─── Payments: idempotency and reversals ─────────────────────────────────────

test('createPayment: same idempotency key returns the first payment (no double post); adjustments need a reason and allow negatives', async () => {
  let created = 0;
  const prior = { id: 'p1', clientId: 'cl1', claimId: null, amountCents: 5000, method: 'CHECK', paidAt: new Date('2026-10-20'), note: null, client: { name: 'A' } };
  let hasPrior = false;
  const db = {
    payment: {
      findFirst: async () => (hasPrior ? prior : null),
      create: async ({ data }: { data: Record<string, unknown> }) => { created++; hasPrior = true; return { ...prior, ...data, id: `p${created + 1}`, client: { name: 'A' } }; },
    },
    client: { findFirst: async () => ({ id: 'cl1', name: 'A' }) },
    claim: { findFirst: async () => ({ id: 'cl-claim', clientId: 'cl1' }) },
  };
  const ledger = loadWithMocks<typeof import('../src/lib/billing/ledger')>('../src/lib/billing/ledger', db);
  const actor = { organizationId: 'o1', actorUserId: 'u1', actorRole: 'BILLING' as const };
  const first = await ledger.createPayment(actor, { clientId: 'cl1', amountCents: 5000, method: 'CHECK', idempotencyKey: 'form-abc-123' });
  const again = await ledger.createPayment(actor, { clientId: 'cl1', amountCents: 5000, method: 'CHECK', idempotencyKey: 'form-abc-123' });
  assert.ok(first.ok && again.ok);
  assert.equal(created, 1);
  assert.equal(again.ok && again.duplicate, true);
  hasPrior = false;
  const zero = await ledger.createPaymentAdjustment(actor, { clientId: 'cl1', claimId: 'cl-claim', amountCents: 0, reason: 'x', kind: 'reversal' });
  assert.equal(zero.ok, false);
  const noReason = await ledger.createPaymentAdjustment(actor, { clientId: 'cl1', claimId: 'cl-claim', amountCents: -5000, reason: ' ', kind: 'reversal' });
  assert.equal(noReason.ok, false);
  const rev = await ledger.createPaymentAdjustment(actor, { clientId: 'cl1', claimId: 'cl-claim', amountCents: -5000, reason: 'CLP02 22 take-back ICN1', kind: 'reversal' });
  assert.ok(rev.ok);
  assert.equal(rev.ok && rev.payment.amountCents, -5000);
});

test('legacy JSON ERA webhook is retired (410) unless a verified webhook is switched on', async () => {
  const route = loadWithMocks<typeof import('../src/app/api/billing/era/webhook/route')>('../src/app/api/billing/era/webhook/route', {});
  delete process.env.ERA_WEBHOOK_ENABLED;
  const res = await route.POST(new Request('http://x.test/api/billing/era/webhook', { method: 'POST', body: '{"claimId":"c1","paidAmount":1}' }));
  assert.equal(res.status, 410);
});

// ─── Eligibility 271: MCO (2120), EB04, copay unknown vs $0 ─────────────────

test('271: 2120 managed care entity and EB04 are kept; a missing copay is unknown, not $0', async () => {
  const { parse271, summarizeEligibility } = await import('../src/lib/billing/waystarInbound/parse271');
  const content = [
    'ISA*00*          *00*          *ZZ*WAYSTAR        *ZZ*ALTRIXS01      *261016*1200*^*00501*000000001*0*T*:',
    'GS*HB*WAYSTAR*ALTRIXS01*20261016*1200*1*X*005010X279A1',
    'ST*271*0001*005010X279A1',
    'BHT*0022*11*T1*20261016*1200',
    'HL*1**20*1', 'NM1*PR*2*MARYLAND MEDICAID*****PI*MDMCD',
    'HL*2*1*21*1', 'NM1*1P*2*TEST PRACTICE*****XX*1234567893',
    'HL*3*2*22*0', 'TRN*2*cmchecktest00000000001*9ALTRIXS', 'NM1*IL*1*TESTPATIENT*JANE****MI*MA123456789',
    'EB*1*IND*30*MC*HEALTHCHOICE',
    'LS*2120', 'NM1*Y2*2*TEST MCO PLAN*****PI*MCO123', 'LE*2120',
    'EB*A*IND*MH*MC**27**0.2',
    'SE*15*0001', 'GE*1*1', 'IEA*1*000000001',
  ].join('~\n') + '~';
  const [r] = parse271(content);
  assert.equal(r.benefits[0].insuranceType, 'MC');
  assert.deepEqual(r.benefits[0].relatedEntities, [{ entityCode: 'Y2', name: 'TEST MCO PLAN', idQualifier: 'PI', id: 'MCO123' }]);
  const s = summarizeEligibility(r);
  assert.equal(s.status, 'ELIGIBLE');
  assert.equal(s.copayKnown, false);
  assert.match(s.notes.join(' '), /Copay not reported by the payer: unknown \(not \$0\)/);
  assert.deepEqual(s.insuranceTypes, ['MC']);
  assert.equal(s.managedCare?.name, 'TEST MCO PLAN');
});
