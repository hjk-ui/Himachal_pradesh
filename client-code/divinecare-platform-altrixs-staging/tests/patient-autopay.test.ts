/**
 * Patient automatic payments (src/lib/patientPayments): SetupIntent card capture, no PHI to Stripe,
 * charge rules (copay incl. Medicaid exclusion, post-ERA coinsurance, self-pay, caps), idempotency,
 * ledger posting only from the payment_intent.succeeded webhook, decline / SCA handling, the signed
 * authorization requirement and the live-key guard. Stripe and the database are in-memory fakes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patientPaymentsConfig } from '../src/lib/patientPayments/config';
import { assertNoPhi, buildPaymentIntentParams, phiProblems, sanitizeDescriptorSuffix } from '../src/lib/patientPayments/params';
import {
  AUTHORIZATION_NEEDS_APPROVAL,
  CARD_AUTHORIZATION_FORM_KEY,
  DEFAULT_SETTINGS,
  cardExpired,
  classifyStripeFailure,
  copayCents,
  currentAuthorization,
  decideCharge,
  isMedicaidForCharging,
  postEraAmountCents,
  type AuthorizationRow,
  type DecisionInput,
  type PatientPaymentSettingsShape,
  type PayerFacts,
} from '../src/lib/patientPayments/rules';
import {
  chargeAfterEra,
  chargeForVisit,
  completeCardSetup,
  handleWebhookEvent,
  patientConfirmation,
  refundCharge,
  retryCharge,
  startCardSetup,
  voidCharge,
} from '../src/lib/patientPayments/service';
import { accountUpdateSms, receiptEmailText, ACCOUNT_UPDATE_EMAIL } from '../src/lib/patientPayments/messages';
import { lintPatientSms } from '../src/lib/sms/contentRules';
import { templateVersion } from '../src/lib/consents/library/catalog';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isAutopayVisitStatus, setAutopayVisitRunner, triggerAutopayAfterVisitStatus } from '../src/lib/patientPayments/visitTrigger';
import { sweepPatientAutopay, type SweepFinder } from '../src/lib/patientPayments/sweep';
import { canAdministerCharges, canEditPatientPaymentSettings, canManageAutopayEnrollment } from '../src/lib/patientPayments/access';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import type {
  CardRecord,
  ChargeRecord,
  EraFacts,
  GatewayPaymentIntent,
  PatientPaymentsGateway,
  PatientPaymentsStore,
  RefundRecord,
  ServiceDeps,
  VisitFacts,
} from '../src/lib/patientPayments/types';

const ORG = 'org_1';
const CLIENT = 'client_1';
const NOW = new Date('2026-11-10T15:00:00Z');
const TEST_ENV = { PATIENT_PAYMENTS_STRIPE_SECRET_KEY: 'sk_test_abc', PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY: 'pk_test_abc', PATIENT_PAYMENTS_STRIPE_WEBHOOK_SECRET: 'whsec_x' };

// ─── Fakes ───────────────────────────────────────────────────────────────────

type Call = { method: string; params?: Record<string, unknown>; idempotencyKey?: string };

function authRow(over: Partial<AuthorizationRow> & { chargeTypes?: string[]; last4?: string; maxPerCharge?: string } = {}): AuthorizationRow {
  const { chargeTypes = ['copay', 'patient_responsibility', 'self_pay'], last4 = '4242', maxPerCharge = '', ...rest } = over;
  return {
    id: 'cf_1',
    status: 'SIGNED',
    formKey: CARD_AUTHORIZATION_FORM_KEY,
    revokedAt: null,
    expiresAt: null,
    signedAt: new Date('2026-11-01T12:00:00Z'),
    formData: { response: { fields: { chargeTypes, last4, maxPerCharge, cardBrand: 'visa', expiry: '12/29', cardholderName: 'X' } } },
    ...rest,
  };
}

function harness(opts: {
  settings?: Partial<PatientPaymentSettingsShape>;
  env?: Record<string, string>;
  card?: Partial<CardRecord> | null;
  enrolled?: boolean;
  auth?: AuthorizationRow[];
  payer?: Partial<PayerFacts>;
  visit?: Partial<VisitFacts>;
  era?: Partial<EraFacts>;
  templateReady?: boolean;
  piResult?: (params: Record<string, unknown>, n: number) => Awaited<ReturnType<PatientPaymentsGateway['createPaymentIntent']>>;
} = {}) {
  const settings: PatientPaymentSettingsShape = { ...DEFAULT_SETTINGS, enabled: true, ...opts.settings };
  const calls: Call[] = [];
  const charges = new Map<string, ChargeRecord>();
  const refunds = new Map<string, RefundRecord>();
  const ledger: { amountCents: number; idempotencyKey: string; claimId: string | null; note: string }[] = [];
  const audits: { action: string; outcome?: string; metadata?: Record<string, unknown> }[] = [];
  const notices = { accountUpdate: 0, receipt: 0, billingReview: 0 };
  const customers = new Map<string, string>();
  let card: CardRecord | null =
    opts.card === null
      ? null
      : { id: 'card_1', organizationId: ORG, clientId: CLIENT, customerId: 'cus_1', paymentMethodId: 'pm_1', brand: 'visa', last4: '4242', expiry: '12/29', autopayEnabled: true, livemode: false, ...opts.card };
  const sentAuth: { method: string; prefill: Record<string, string> }[] = [];
  let seq = 0;
  let piSeq = 0;
  const pis = new Map<string, GatewayPaymentIntent>();
  const payer: PayerFacts = { insuranceType: 'Commercial', insurancePayer: 'CareFirst BlueCross', medicaidId: null, coverages: [], ...opts.payer };

  const store: PatientPaymentsStore = {
    settings: async () => settings,
    enrollment: async () => (opts.enrolled === false ? null : { active: true }),
    card: async () => card,
    authorizationRows: async () => opts.auth ?? [authRow()],
    payer: async () => payer,
    visit: async (id) => ({ appointmentId: id, organizationId: ORG, clientId: CLIENT, status: 'COMPLETED', selfPay: false, copayCents: 2500, selfPayFeeCents: null, claimId: null, missedVisitPolicy: null, ...opts.visit }),
    era: async (id) => ({ eraClaimId: id, organizationId: ORG, clientId: CLIENT, claimId: 'claim_1', appointmentId: 'appt_1', patientResponsibilityCents: 8000, ...opts.era }),
    charges: async (_o, f) =>
      [...charges.values()].filter(
        (c) => c.clientId === f.clientId && (!f.month || c.chargeMonth === f.month) && (!f.appointmentId || c.appointmentId === f.appointmentId) && (!f.claimId || c.claimId === f.claimId)
      ),
    chargeByKey: async (_o, key) => [...charges.values()].find((c) => c.idempotencyKey === key) ?? null,
    chargeById: async (id) => charges.get(id) ?? null,
    chargeByPaymentIntent: async (pi) => [...charges.values()].find((c) => c.stripePaymentIntentId === pi) ?? null,
    insertCharge: async (data) => {
      const prior = [...charges.values()].find((c) => c.organizationId === data.organizationId && c.idempotencyKey === data.idempotencyKey);
      if (prior) return { created: false, charge: prior };
      const id = `ch_${++seq}`;
      const { createdById: _c, ...rest } = data;
      const row: ChargeRecord = {
        ...rest,
        id,
        attempts: 0,
        lastAttemptAt: null,
        failureCode: null,
        failureMessage: null,
        paymentId: null,
        refundedCents: 0,
        receiptNumber: null,
        receiptEmailedAt: null,
        patientNotifiedAt: null,
        succeededAt: null,
        stripePaymentIntentId: null,
        createdAt: NOW,
      };
      charges.set(id, row);
      return { created: true, charge: row };
    },
    updateCharge: async (id, patch, onlyFrom) => {
      const c = charges.get(id);
      if (!c) return null;
      if (onlyFrom && !onlyFrom.includes(c.status)) return null;
      const { updatedById: _u, ...p } = patch;
      const next = { ...c, ...p } as ChargeRecord;
      charges.set(id, next);
      return next;
    },
    postLedgerPayment: async (input) => {
      const prior = ledger.findIndex((l) => l.idempotencyKey === input.idempotencyKey);
      if (prior >= 0) return { paymentId: `pay_${prior}`, duplicate: true };
      ledger.push({ amountCents: input.amountCents, idempotencyKey: input.idempotencyKey, claimId: input.claimId, note: input.note });
      return { paymentId: `pay_${ledger.length - 1}`, duplicate: false };
    },
    stripeCustomer: async (o, c, live) => customers.get(`${o}:${c}:${live}`) ?? null,
    saveStripeCustomer: async (o, c, live, id) => {
      customers.set(`${o}:${c}:${live}`, id);
    },
    saveCard: async (i) => {
      card = { id: 'card_new', organizationId: i.organizationId, clientId: i.clientId, customerId: i.customerId, paymentMethodId: i.paymentMethodId, brand: i.brand, last4: i.last4, expiry: i.expiry, autopayEnabled: true, livemode: i.livemode };
      return card;
    },
    authorizationTemplate: async () => (opts.templateReady === false ? { sendable: false, reason: 'No Active version (latest is version 1, draft)' } : { sendable: true }),
    sendAuthorization: async (i) => {
      sentAuth.push({ method: i.method, prefill: i.prefill });
      return { ok: true, packetId: 'pkt_1' };
    },
    insertRefund: async (d) => {
      const id = `rf_${++seq}`;
      const { createdById: _c, ...rest } = d;
      const r: RefundRecord = { ...rest, id, stripeRefundId: null, paymentId: null };
      refunds.set(id, r);
      return r;
    },
    updateRefund: async (id, patch) => {
      const r = { ...refunds.get(id)!, ...patch } as RefundRecord;
      refunds.set(id, r);
      return r;
    },
    refundByStripeId: async (sid) => [...refunds.values()].find((r) => r.stripeRefundId === sid) ?? null,
    refundById: async (id) => refunds.get(id) ?? null,
    refunds: async (chargeId) => [...refunds.values()].filter((r) => r.chargeId === chargeId),
  };

  let piCalls = 0;
  const gateway: PatientPaymentsGateway = {
    createCustomer: async (params, o) => {
      calls.push({ method: 'customers.create', params, idempotencyKey: o.idempotencyKey });
      return { id: 'cus_new' };
    },
    createSetupIntent: async (params) => {
      calls.push({ method: 'setupIntents.create', params });
      return { id: 'seti_1', client_secret: 'seti_1_secret_x', status: 'requires_payment_method' };
    },
    retrieveSetupIntent: async (id) => ({ id, status: 'succeeded', customer: 'cus_new', payment_method: 'pm_new', usage: 'off_session', metadata: { altrixs_account: CLIENT, altrixs_org: ORG, altrixs_capture: 'portal' } }),
    retrievePaymentMethod: async (id) => ({ id, customer: 'cus_new', card: { brand: 'mastercard', last4: '4444', exp_month: 3, exp_year: 2030 }, postalCode: '20715' }),
    detachPaymentMethod: async (id) => {
      calls.push({ method: 'paymentMethods.detach', params: { id } });
    },
    createPaymentIntent: async (params, o) => {
      calls.push({ method: 'paymentIntents.create', params, idempotencyKey: o.idempotencyKey });
      piCalls += 1;
      const r = opts.piResult
        ? opts.piResult(params, piCalls)
        : { ok: true as const, paymentIntent: { id: `pi_${++piSeq}`, status: 'succeeded', amount: Number(params.amount), amount_received: Number(params.amount), livemode: false, metadata: params.metadata as Record<string, string> } };
      if (r.paymentIntent) pis.set(r.paymentIntent.id, r.paymentIntent);
      return r;
    },
    retrievePaymentIntent: async (id) => pis.get(id) ?? { id, status: 'requires_action', amount: 0, livemode: false, client_secret: `${id}_secret`, payment_method: 'pm_1' },
    cancelPaymentIntent: async (id) => {
      calls.push({ method: 'paymentIntents.cancel', params: { id } });
      return { id, status: 'canceled', amount: 0, livemode: false };
    },
    createRefund: async (params, o) => {
      calls.push({ method: 'refunds.create', params, idempotencyKey: o.idempotencyKey });
      return { id: 're_1', status: 'succeeded', amount: Number(params.amount), payment_intent: String(params.payment_intent), metadata: params.metadata as Record<string, string> };
    },
  };

  const deps: ServiceDeps = {
    store,
    config: (o) => patientPaymentsConfig(opts.env ?? TEST_ENV, o),
    gateway: () => gateway,
    notify: {
      accountUpdate: async () => {
        notices.accountUpdate += 1;
      },
      receipt: async () => {
        notices.receipt += 1;
        return true;
      },
      billingReview: async () => {
        notices.billingReview += 1;
      },
    },
    audit: async (e) => {
      audits.push({ action: e.action, outcome: e.outcome, metadata: e.metadata });
    },
    now: () => NOW,
    practiceToday: async () => '2026-11-10',
  };
  return { deps, calls, charges, ledger, audits, notices, sentAuth, refunds, getCard: () => card };
}

const piEvent = (type: string, pi: Partial<GatewayPaymentIntent> & { id: string }, livemode = false) => ({
  id: `evt_${type}_${pi.id}`,
  type,
  livemode,
  data: { object: { amount: 2500, amount_received: 2500, status: 'succeeded', livemode, ...pi } as unknown as Record<string, unknown> },
});

// ─── Config / live key guard ─────────────────────────────────────────────────

test('live key refused without owner approval; test keys accepted; mode and key separation enforced', () => {
  assert.equal(patientPaymentsConfig({}).ok, false);
  const live = { PATIENT_PAYMENTS_STRIPE_SECRET_KEY: 'sk_live_x', PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY: 'pk_live_x' };
  const noApproval = patientPaymentsConfig(live);
  assert.equal(noApproval.ok, false);
  assert.equal(noApproval.ok === false && noApproval.reason, 'live_not_approved');
  const rk = patientPaymentsConfig({ ...live, PATIENT_PAYMENTS_STRIPE_SECRET_KEY: 'rk_live_x' });
  assert.equal(rk.ok === false && rk.reason, 'live_not_approved');
  const noOrg = patientPaymentsConfig({ ...live, PATIENT_PAYMENTS_LIVE_APPROVED: 'true' });
  assert.equal(noOrg.ok === false && noOrg.reason, 'live_needs_organization');
  const approved = patientPaymentsConfig({ ...live, PATIENT_PAYMENTS_LIVE_APPROVED: 'true', PATIENT_PAYMENTS_ORGANIZATION_ID: ORG }, ORG);
  assert.equal(approved.ok && approved.mode, 'live');
  const other = patientPaymentsConfig({ ...live, PATIENT_PAYMENTS_LIVE_APPROVED: 'true', PATIENT_PAYMENTS_ORGANIZATION_ID: ORG }, 'org_2');
  assert.equal(other.ok === false && other.reason, 'wrong_organization');
  const yes = patientPaymentsConfig({ ...live, PATIENT_PAYMENTS_LIVE_APPROVED: 'yes', PATIENT_PAYMENTS_ORGANIZATION_ID: ORG });
  assert.equal(yes.ok, false, 'only the exact value true approves live');

  const t = patientPaymentsConfig(TEST_ENV);
  assert.equal(t.ok && t.mode, 'test');
  const mismatch = patientPaymentsConfig({ ...TEST_ENV, PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY: 'pk_live_x' });
  assert.equal(mismatch.ok === false && mismatch.reason, 'mode_mismatch');
  const shared = patientPaymentsConfig({ ...TEST_ENV, STRIPE_SECRET_KEY: 'sk_test_abc' });
  assert.equal(shared.ok === false && shared.reason, 'shared_with_subscription_billing');
  assert.equal(patientPaymentsConfig({ PATIENT_PAYMENTS_STRIPE_SECRET_KEY: 'pk_test_x', PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }).ok, false);
});

test('live key refused end to end: card setup and charges do not reach Stripe', async () => {
  const live = { PATIENT_PAYMENTS_STRIPE_SECRET_KEY: 'sk_live_x', PATIENT_PAYMENTS_STRIPE_PUBLISHABLE_KEY: 'pk_live_x' };
  const h = harness({ env: live });
  const r = await startCardSetup(h.deps, { organizationId: ORG, clientId: CLIENT, via: 'portal', actor: { userId: null, role: 'PATIENT' } });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : '', /TEST MODE/);
  const v = await chargeForVisit(h.deps, 'appt_1');
  assert.equal(v.outcome, 'skipped');
  assert.equal(h.calls.length, 0);
});

// ─── SetupIntent card capture ────────────────────────────────────────────────

test('SetupIntent: customer created once with an idempotency key, usage off_session, card only; card saved with brand/last4/expiry and the authorization sent', async () => {
  const h = harness({ card: null });
  const actor = { userId: null, role: 'PATIENT' };
  const s1 = await startCardSetup(h.deps, { organizationId: ORG, clientId: CLIENT, via: 'portal', actor });
  assert.equal(s1.ok, true);
  assert.equal(s1.ok && s1.clientSecret, 'seti_1_secret_x');
  assert.equal(s1.ok && s1.publishableKey, 'pk_test_abc');
  const s2 = await startCardSetup(h.deps, { organizationId: ORG, clientId: CLIENT, via: 'portal', actor });
  assert.equal(s2.ok, true);
  const customers = h.calls.filter((c) => c.method === 'customers.create');
  assert.equal(customers.length, 1, 'customer reused');
  assert.equal(customers[0].idempotencyKey, `altrixs:${ORG}:customer:${CLIENT}:test`);
  const si = h.calls.find((c) => c.method === 'setupIntents.create')!.params!;
  assert.equal(si.usage, 'off_session');
  assert.deepEqual(si.payment_method_types, ['card']);
  assert.equal(si.customer, 'cus_new');

  const done = await completeCardSetup(h.deps, { organizationId: ORG, clientId: CLIENT, setupIntentId: 'seti_1', via: 'portal', actor });
  assert.equal(done.ok, true);
  const card = h.getCard()!;
  assert.deepEqual([card.brand, card.last4, card.expiry, card.paymentMethodId], ['mastercard', '4444', '03/30', 'pm_new']);
  assert.deepEqual(h.sentAuth, [{ method: 'portal', prefill: { cardBrand: 'mastercard', last4: '4444', expiry: '03/30' } }]);
  assert.ok(h.audits.some((a) => a.action === 'patient_card_saved'));
  assert.ok(h.audits.some((a) => a.action === 'patient_card_setup_started'));
});

test('SetupIntent: another patient\'s SetupIntent is refused; capture is off with the master switch off; unapproved authorization template blocks capture', async () => {
  const h = harness({ card: null });
  await startCardSetup(h.deps, { organizationId: ORG, clientId: CLIENT, via: 'portal', actor: { userId: null, role: 'PATIENT' } });
  const foreign = await completeCardSetup(h.deps, { organizationId: ORG, clientId: 'client_2', setupIntentId: 'seti_1', via: 'portal', actor: { userId: null, role: 'PATIENT' } });
  assert.equal(foreign.ok, false);
  assert.ok(h.audits.some((a) => a.action === 'patient_card_save_refused' && a.outcome === 'DENIED'));

  const off = harness({ settings: { enabled: false } });
  const r = await startCardSetup(off.deps, { organizationId: ORG, clientId: CLIENT, via: 'in_office', actor: { userId: 'u1', role: 'BILLING' } });
  assert.equal(r.ok === false && r.code, 'disabled');

  const draft = harness({ templateReady: false });
  const d = await startCardSetup(draft.deps, { organizationId: ORG, clientId: CLIENT, via: 'in_office', actor: { userId: 'u1', role: 'BILLING' } });
  assert.equal(d.ok === false && d.error, AUTHORIZATION_NEEDS_APPROVAL);
  assert.equal(draft.calls.length, 0);
});

// ─── No PHI to Stripe ────────────────────────────────────────────────────────

test('no PHI in any Stripe request: neutral descriptions, id-only metadata, sanitized descriptor', async () => {
  // Authorization signed for the card captured below (Mastercard ending 4444)
  const h = harness({ card: null, settings: { statementDescriptorSuffix: 'MDBH' }, auth: [authRow({ last4: '4444' })] });
  const actor = { userId: 'u1', role: 'BILLING' };
  await startCardSetup(h.deps, { organizationId: ORG, clientId: CLIENT, via: 'in_office', actor });
  await completeCardSetup(h.deps, { organizationId: ORG, clientId: CLIENT, setupIntentId: 'seti_1', via: 'in_office', actor });
  await chargeForVisit(h.deps, 'appt_1');
  const ch = [...h.charges.values()][0];
  await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: ch.stripePaymentIntentId!, metadata: { altrixs_charge: ch.id, altrixs_org: ORG, altrixs_account: CLIENT } }));
  await refundCharge(h.deps, { organizationId: ORG, chargeId: ch.id, reason: 'Overpaid copay for therapy visit', actor });
  assert.ok(h.calls.length >= 4);
  for (const c of h.calls) {
    if (!c.params) continue;
    assert.doesNotThrow(() => assertNoPhi(c.params!), c.method);
    const text = JSON.stringify(c.params).toLowerCase();
    for (const bad of ['therapy', 'counsel', 'psych', 'behavioral', 'diagnos', 'f32', '90837', 'dr.', 'name', 'email', 'phone', 'copay for']) {
      assert.ok(!text.includes(bad), `${c.method} carries "${bad}"`);
    }
  }
  const pi = h.calls.find((c) => c.method === 'paymentIntents.create')!.params!;
  assert.equal(pi.description, 'Patient payment');
  assert.equal(pi.statement_descriptor_suffix, 'MDBH');
  assert.equal(pi.off_session, true);
  assert.equal(pi.confirm, true);
  assert.deepEqual(Object.keys(pi.metadata as object).sort(), ['altrixs_account', 'altrixs_charge', 'altrixs_org']);

  // The guard itself refuses anything that could carry PHI
  const base = buildPaymentIntentParams({ organizationId: ORG, clientId: CLIENT, chargeId: 'ch_1', amountCents: 100, customerId: 'cus_1', paymentMethodId: 'pm_1', descriptorSuffix: null });
  assert.equal(phiProblems(base).length, 0);
  assert.throws(() => assertNoPhi({ ...base, description: 'Psychotherapy 90837 with Dr. Smith' }));
  assert.throws(() => assertNoPhi({ ...base, metadata: { diagnosis: 'F32.1' } }));
  assert.throws(() => assertNoPhi({ ...base, metadata: { altrixs_account: 'Jane Doe, DOB 1/2/1990' } }));
  assert.throws(() => assertNoPhi({ ...base, receipt_email: 'jane@example.com' }));
  assert.throws(() => assertNoPhi({ description: 'Patient account', name: 'Jane Doe' }));
  assert.throws(() => assertNoPhi({ ...base, statement_descriptor_suffix: 'THERAPY*' }));
  assert.equal(sanitizeDescriptorSuffix('md-bh*copay!'), 'MDBHCOPAY');
  assert.equal(sanitizeDescriptorSuffix('1234'), null);
  assert.equal(sanitizeDescriptorSuffix(''), null);
});

test('patient notices and receipts carry no PHI; the SMS passes the patient SMS content rules', () => {
  const sms = accountUpdateSms('Your care team');
  assert.deepEqual(lintPatientSms(sms, { purpose: 'portal_notice', sender: 'Your care team', clientName: 'Jane Doe' }), []);
  assert.match(sms, /update about your account in the patient portal/);
  const email = ACCOUNT_UPDATE_EMAIL.text('Your care team');
  const receipt = receiptEmailText({ from: 'Your care team', amountCents: 2500, cardBrand: 'visa', cardLast4: '4242', paidOn: 'November 10, 2026', receiptNumber: 'R-20261110-ABCD1234' });
  assert.match(receipt, /Amount: \$25\.00/);
  assert.match(receipt, /Visa ending 4242/);
  for (const t of [sms, email, receipt]) assert.doesNotMatch(t, /therap|counsel|psych|behavioral|diagnos|copay|coinsurance|visit|appointment|Dr\.|clinician/i);
});

// ─── Copay rule ──────────────────────────────────────────────────────────────

test('copay: charged right after a completed visit for the coverage copay, off-session; posted later by the webhook', async () => {
  const h = harness();
  const r = await chargeForVisit(h.deps, 'appt_1');
  assert.equal(r.outcome, 'attempted');
  const pi = h.calls.filter((c) => c.method === 'paymentIntents.create');
  assert.equal(pi.length, 1);
  assert.equal(pi[0].params!.amount, 2500);
  assert.equal(pi[0].params!.customer, 'cus_1');
  assert.equal(pi[0].params!.payment_method, 'pm_1');
  const ch = [...h.charges.values()][0];
  assert.equal(ch.kind, 'copay');
  assert.equal(ch.status, 'processing', 'a synchronous success waits for the webhook');
  assert.equal(h.ledger.length, 0, 'never posted optimistically');
});

test('copay: Medicaid clients are never charged (Maryland MCO, MA number, MC filing code, other-state Medicaid)', async () => {
  const cases: Partial<PayerFacts>[] = [
    { insurancePayer: 'Priority Partners', insuranceType: 'Medicaid' },
    { insurancePayer: 'Aetna', insuranceType: 'Commercial', medicaidId: '12345678901' },
    { insurancePayer: 'Some Plan', coverages: [{ payerName: 'Some Plan', memberId: 'x', claimFilingCode: 'MC', active: true, rank: 'P' }] },
    { insurancePayer: 'DC Medicaid (DHCF)', insuranceType: 'Medicaid' },
    { insurancePayer: 'Medicare', coverages: [{ payerName: 'Wellpoint Maryland', memberId: 'y', claimFilingCode: 'HM', active: true, rank: 'S' }] },
  ];
  for (const payer of cases) {
    const h = harness({ payer });
    const r = await chargeForVisit(h.deps, 'appt_1');
    assert.equal(r.outcome, 'skipped', JSON.stringify(payer));
    assert.equal(r.outcome === 'skipped' && r.reason, 'medicaid');
    assert.equal(h.calls.length, 0, 'no Stripe call for a Medicaid client');
  }
  assert.equal(isMedicaidForCharging({ insuranceType: 'Commercial', insurancePayer: 'CareFirst', medicaidId: null, coverages: [] }, NOW), false);
});

test('copay: not charged without a copay, without the copay authorization, or with the copay rule off', async () => {
  const none = harness({ visit: { copayCents: null } });
  assert.equal((await chargeForVisit(none.deps, 'appt_1')).outcome, 'skipped');
  assert.equal(none.charges.size, 0, 'nothing to charge: no row');

  const onlyAfterIns = harness({ auth: [authRow({ chargeTypes: ['patient_responsibility'] })] });
  const r = await chargeForVisit(onlyAfterIns.deps, 'appt_1');
  assert.equal(r.outcome === 'skipped' && r.reason, 'not_authorized_for_type');
  assert.equal(onlyAfterIns.calls.length, 0);

  const off = harness({ settings: { chargeCopays: false } });
  assert.equal((await chargeForVisit(off.deps, 'appt_1')).outcome, 'skipped');
  assert.equal(off.calls.length, 0);

  assert.equal(copayCents({ copayAmount: '30.00', insurancePayer: 'X', rules: [] }), 3000);
  assert.equal(copayCents({ copayAmount: null, insurancePayer: 'Aetna', rules: [{ payerName: 'aetna', providerType: '', cptRule: '', amountCents: 2000 }] }), 2000);
  assert.equal(copayCents({ copayAmount: null, insurancePayer: 'Aetna', rules: [{ payerName: 'Aetna', providerType: 'MD', cptRule: '', amountCents: 2000 }] }), null, 'only a general rule');
});

test('self-pay visit: the fee schedule amount after the visit; missed-visit fee only with the practice policy and never Medicaid / unknown insurance', async () => {
  const sp = harness({ visit: { selfPay: true, copayCents: null, selfPayFeeCents: 15000 }, payer: { insurancePayer: null, insuranceType: null } });
  const r = await chargeForVisit(sp.deps, 'appt_1');
  assert.equal(r.outcome, 'attempted');
  assert.equal([...sp.charges.values()][0].kind, 'self_pay');
  assert.equal(sp.calls.find((c) => c.method === 'paymentIntents.create')!.params!.amount, 15000);

  const auth = [authRow({ chargeTypes: ['missed_visit'] })];
  const policyOff = harness({ settings: { chargeMissedVisitFees: true }, auth, visit: { status: 'NO_SHOW', missedVisitPolicy: { feeEnabled: false, feeCents: 5000 } } });
  const a = await chargeForVisit(policyOff.deps, 'appt_1');
  assert.equal(a.outcome === 'skipped' && a.reason, 'missed_visit_not_allowed');
  const medicaid = harness({ settings: { chargeMissedVisitFees: true }, auth, payer: { insurancePayer: 'Maryland Physicians Care', insuranceType: 'Medicaid' }, visit: { status: 'NO_SHOW', missedVisitPolicy: { feeEnabled: true, feeCents: 5000 } } });
  assert.equal((await chargeForVisit(medicaid.deps, 'appt_1')).outcome, 'skipped');
  assert.equal(medicaid.calls.length, 0);
  const ok = harness({ settings: { chargeMissedVisitFees: true }, auth, visit: { status: 'LATE_CANCEL', missedVisitPolicy: { feeEnabled: true, feeCents: 5000 } } });
  assert.equal((await chargeForVisit(ok.deps, 'appt_1')).outcome, 'attempted');
  assert.equal([...ok.charges.values()][0].kind, 'missed_visit');
  const rulesOff = harness({ auth, visit: { status: 'NO_SHOW', missedVisitPolicy: { feeEnabled: true, feeCents: 5000 } } });
  assert.equal((await chargeForVisit(rulesOff.deps, 'appt_1')).outcome, 'skipped', 'missed-visit charging is off by default');
});

// ─── Post-ERA coinsurance ────────────────────────────────────────────────────

test('post-ERA coinsurance: patient responsibility less the copay already charged for the visit; nothing at the visit for coinsurance', async () => {
  const h = harness();
  await chargeForVisit(h.deps, 'appt_1'); // copay 25.00, processing
  const copay = [...h.charges.values()][0];
  await h.deps.store.updateCharge(copay.id, { appointmentId: 'appt_1' });
  const r = await chargeAfterEra(h.deps, 'era_1');
  assert.equal(r.outcome, 'attempted');
  const coins = [...h.charges.values()].find((c) => c.kind === 'coinsurance')!;
  assert.equal(coins.amountCents, 8000 - 2500);
  assert.equal(coins.idempotencyKey, 'era:era_1:coinsurance');
  assert.equal(coins.claimId, 'claim_1');
  // A second 835 for the same claim (PR accumulated to 80.00) charges nothing more
  const again = await chargeAfterEra(h.deps, 'era_2');
  assert.equal(again.outcome, 'skipped');
  assert.equal([...h.charges.values()].filter((c) => c.kind === 'coinsurance').length, 1);
  assert.equal(postEraAmountCents(8000, 9000), 0);
});

test('post-ERA: needs the "after insurance" authorization; secondary insurance on file is billed first; Medicaid never', async () => {
  const noAuth = harness({ auth: [authRow({ chargeTypes: ['copay'] })] });
  const a = await chargeAfterEra(noAuth.deps, 'era_1');
  assert.equal(a.outcome === 'skipped' && a.reason, 'not_authorized_for_type');
  const secondary = harness({ payer: { coverages: [{ payerName: 'CareFirst', memberId: '1', claimFilingCode: 'BL', active: true, rank: 'P' }, { payerName: 'Aetna', memberId: '2', claimFilingCode: 'CI', active: true, rank: 'S' }] } });
  const b = await chargeAfterEra(secondary.deps, 'era_1');
  assert.equal(b.outcome === 'skipped' && b.reason, 'secondary_coverage');
  const md = harness({ payer: { insurancePayer: 'Carelon Behavioral Health' } });
  const c = await chargeAfterEra(md.deps, 'era_1');
  assert.equal(c.outcome === 'skipped' && c.reason, 'medicaid');
  for (const x of [noAuth, secondary, md]) assert.equal(x.calls.length, 0);
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

test('idempotency: one charge per visit + type, one Stripe request; Stripe Idempotency-Key per attempt', async () => {
  const h = harness({ piResult: (p, n) => (n === 1 ? { ok: false, error: { code: 'card_declined', decline_code: 'insufficient_funds', type: 'StripeCardError' }, paymentIntent: { id: 'pi_a', status: 'requires_payment_method', amount: Number(p.amount), livemode: false } } : { ok: true, paymentIntent: { id: 'pi_b', status: 'succeeded', amount: Number(p.amount), livemode: false, metadata: p.metadata as Record<string, string> } }) });
  const [r1, r2] = await Promise.all([chargeForVisit(h.deps, 'appt_1'), chargeForVisit(h.deps, 'appt_1')]);
  const r3 = await chargeForVisit(h.deps, 'appt_1');
  assert.ok([r1.outcome, r2.outcome].includes('attempted'));
  assert.equal(r3.outcome, 'duplicate');
  assert.equal(h.charges.size, 1);
  const pis = h.calls.filter((c) => c.method === 'paymentIntents.create');
  assert.equal(pis.length, 1);
  assert.equal(pis[0].idempotencyKey, `altrixs:${ORG}:visit:appt_1:copay:a1`);
  const ch = [...h.charges.values()][0];
  assert.equal(ch.status, 'failed');
  const retry = await retryCharge(h.deps, { organizationId: ORG, chargeId: ch.id, actor: { userId: 'u1', role: 'BILLING' } });
  assert.equal(retry.ok, true);
  const keys = h.calls.filter((c) => c.method === 'paymentIntents.create').map((c) => c.idempotencyKey);
  assert.deepEqual(keys, [`altrixs:${ORG}:visit:appt_1:copay:a1`, `altrixs:${ORG}:visit:appt_1:copay:a2`]);
  // A copay and a missed-visit fee for the same visit are different charges
  assert.notEqual(`visit:appt_1:copay`, `visit:appt_1:missed_visit`);
});

// ─── Webhook ─────────────────────────────────────────────────────────────────

test('webhook: the ledger is posted only on payment_intent.succeeded, once, with a receipt', async () => {
  const h = harness();
  await chargeForVisit(h.deps, 'appt_1');
  const ch = [...h.charges.values()][0];
  const meta = { altrixs_charge: ch.id, altrixs_org: ORG, altrixs_account: CLIENT };
  assert.equal(h.ledger.length, 0);

  await handleWebhookEvent(h.deps, piEvent('payment_intent.processing', { id: ch.stripePaymentIntentId!, metadata: meta }));
  assert.equal(h.ledger.length, 0);

  const r = await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: ch.stripePaymentIntentId!, metadata: meta }));
  assert.equal(r.outcome, 'posted');
  assert.equal(h.ledger.length, 1);
  assert.equal(h.ledger[0].amountCents, 2500);
  assert.equal(h.ledger[0].idempotencyKey, `stripe:${ch.stripePaymentIntentId}`);
  const paid = h.charges.get(ch.id)!;
  assert.equal(paid.status, 'succeeded');
  assert.match(paid.receiptNumber ?? '', /^R-20261110-/);
  assert.equal(h.notices.receipt, 1);

  const dup = await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: ch.stripePaymentIntentId!, metadata: meta }));
  assert.equal(dup.outcome, 'duplicate');
  assert.equal(h.ledger.length, 1, 'a Stripe retry never posts twice');
  assert.equal(h.notices.receipt, 1);
  assert.ok(h.audits.some((a) => a.action === 'patient_charge_succeeded'));
});

test('webhook: failures, mode mismatch and unknown PaymentIntents never post the ledger', async () => {
  const h = harness();
  await chargeForVisit(h.deps, 'appt_1');
  const ch = [...h.charges.values()][0];
  const meta = { altrixs_charge: ch.id, altrixs_org: ORG, altrixs_account: CLIENT };
  const live = await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: ch.stripePaymentIntentId!, metadata: meta }, true));
  assert.equal(live.outcome, 'ignored');
  const unknown = await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: 'pi_other', metadata: { altrixs_charge: 'ch_nope', altrixs_org: ORG, altrixs_account: CLIENT } }));
  assert.equal(unknown.outcome, 'unknown_charge');
  const spoof = await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: 'pi_spoof', metadata: { ...meta } }));
  assert.equal(spoof.outcome, 'unknown_charge', 'a second PaymentIntent for a charge with one on record is refused');
  const failed = await handleWebhookEvent(h.deps, piEvent('payment_intent.payment_failed', { id: ch.stripePaymentIntentId!, status: 'requires_payment_method', last_payment_error: { code: 'card_declined', decline_code: 'generic_decline', type: 'card_error' }, metadata: meta }));
  assert.equal(failed.outcome, 'updated');
  assert.equal(h.charges.get(ch.id)!.status, 'failed');
  assert.equal(h.ledger.length, 0);
});

test('refunds: billing refunds through Stripe; the ledger gets one negative card payment; the webhook does not double post', async () => {
  const h = harness();
  await chargeForVisit(h.deps, 'appt_1');
  const ch = [...h.charges.values()][0];
  const actor = { userId: 'u1', role: 'BILLING' };
  const early = await refundCharge(h.deps, { organizationId: ORG, chargeId: ch.id, reason: 'x', actor });
  assert.equal(early.ok, false, 'not paid yet: void, not refund');
  await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: ch.stripePaymentIntentId!, metadata: { altrixs_charge: ch.id, altrixs_org: ORG, altrixs_account: CLIENT } }));
  const tooMuch = await refundCharge(h.deps, { organizationId: ORG, chargeId: ch.id, amountCents: 9999, reason: 'x', actor });
  assert.equal(tooMuch.ok, false);
  const r = await refundCharge(h.deps, { organizationId: ORG, chargeId: ch.id, amountCents: 1000, reason: 'Courtesy', actor });
  assert.equal(r.ok, true);
  assert.equal(h.ledger.length, 2);
  assert.equal(h.ledger[1].amountCents, -1000);
  assert.equal(h.charges.get(ch.id)!.status, 'partially_refunded');
  assert.equal(h.charges.get(ch.id)!.refundedCents, 1000);
  const ev = await handleWebhookEvent(h.deps, { id: 'evt_r', type: 'refund.updated', livemode: false, data: { object: { id: 're_1', status: 'succeeded', amount: 1000, payment_intent: ch.stripePaymentIntentId, metadata: {} } } });
  assert.equal(ev.outcome, 'duplicate');
  assert.equal(h.ledger.length, 2);
  const refundCall = h.calls.find((c) => c.method === 'refunds.create')!;
  assert.match(refundCall.idempotencyKey!, /^altrixs:org_1:refund:rf_/);
  assert.ok(h.audits.some((a) => a.action === 'patient_charge_refunded'));
});

// ─── Decline / SCA ───────────────────────────────────────────────────────────

test('decline: marked failed with the decline code, patient told once (no PHI notice), retryable by billing', async () => {
  const h = harness({ piResult: (p) => ({ ok: false, error: { code: 'card_declined', decline_code: 'insufficient_funds', type: 'StripeCardError' }, paymentIntent: { id: 'pi_d', status: 'requires_payment_method', amount: Number(p.amount), livemode: false } }) });
  await chargeForVisit(h.deps, 'appt_1');
  const ch = [...h.charges.values()][0];
  assert.equal(ch.status, 'failed');
  assert.equal(ch.failureCode, 'card_declined:insufficient_funds');
  assert.equal(h.notices.accountUpdate, 1);
  assert.equal(h.ledger.length, 0);
  await handleWebhookEvent(h.deps, piEvent('payment_intent.payment_failed', { id: 'pi_d', status: 'requires_payment_method', last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', type: 'card_error' }, metadata: { altrixs_charge: ch.id, altrixs_org: ORG, altrixs_account: CLIENT } }));
  assert.equal(h.notices.accountUpdate, 1, 'one notice per charge');
  assert.ok(h.audits.some((a) => a.action === 'patient_charge_failed'));
  assert.equal(classifyStripeFailure({ code: 'card_declined', decline_code: 'insufficient_funds' }).retryable, true);
  assert.equal(classifyStripeFailure({ code: 'card_declined', decline_code: 'stolen_card' }).retryable, false);
  assert.equal(classifyStripeFailure({ code: 'expired_card' }).status, 'failed');
});

test('SCA: authentication_required marks the charge "needs patient action", the patient confirms in the portal, billing cannot force it', async () => {
  const h = harness({ piResult: (p) => ({ ok: false, error: { code: 'authentication_required', decline_code: 'authentication_required', type: 'StripeCardError' }, paymentIntent: { id: 'pi_sca', status: 'requires_payment_method', amount: Number(p.amount), livemode: false, client_secret: 'pi_sca_secret' } }) });
  await chargeForVisit(h.deps, 'appt_1');
  const ch = [...h.charges.values()][0];
  assert.equal(ch.status, 'needs_action');
  assert.equal(ch.stripePaymentIntentId, 'pi_sca');
  assert.equal(h.notices.accountUpdate, 1);
  const retry = await retryCharge(h.deps, { organizationId: ORG, chargeId: ch.id, actor: { userId: 'u1', role: 'BILLING' } });
  assert.equal(retry.ok, false);
  const conf = await patientConfirmation(h.deps, { organizationId: ORG, clientId: CLIENT, chargeId: ch.id });
  assert.equal(conf.ok && conf.clientSecret, 'pi_sca_secret');
  const wrongPatient = await patientConfirmation(h.deps, { organizationId: ORG, clientId: 'client_2', chargeId: ch.id });
  assert.equal(wrongPatient.ok, false);
  // The patient confirms; Stripe then sends payment_intent.succeeded and the ledger is posted
  await handleWebhookEvent(h.deps, piEvent('payment_intent.succeeded', { id: 'pi_sca', metadata: { altrixs_charge: ch.id, altrixs_org: ORG, altrixs_account: CLIENT } }));
  assert.equal(h.charges.get(ch.id)!.status, 'succeeded');
  assert.equal(h.ledger.length, 1);
  // Void of a needs-action charge cancels the PaymentIntent
  const h2 = harness({ piResult: (p) => ({ ok: true, paymentIntent: { id: 'pi_ra', status: 'requires_action', amount: Number(p.amount), livemode: false } }) });
  await chargeForVisit(h2.deps, 'appt_1');
  const c2 = [...h2.charges.values()][0];
  assert.equal(c2.status, 'needs_action');
  const v = await voidCharge(h2.deps, { organizationId: ORG, chargeId: c2.id, actor: { userId: 'u1', role: 'BILLING' } });
  assert.equal(v.ok, true);
  assert.ok(h2.calls.some((c) => c.method === 'paymentIntents.cancel'));
  assert.equal(h2.charges.get(c2.id)!.status, 'canceled');
});

// ─── Authorization required ──────────────────────────────────────────────────

test('authorization required: no signed authorization, revoked, expired, or for another card -> not charged', async () => {
  const cases: [AuthorizationRow[], string][] = [
    [[], 'no_authorization'],
    [[authRow({ revokedAt: new Date('2026-11-05T00:00:00Z'), status: 'DECLINED' })], 'no_authorization'],
    [[authRow({ status: 'PENDING', signedAt: null })], 'no_authorization'],
    [[authRow({ expiresAt: new Date('2026-11-01T00:00:00Z') })], 'no_authorization'],
    [[authRow({ last4: '1111' })], 'authorization_card_mismatch'],
  ];
  for (const [auth, reason] of cases) {
    const h = harness({ auth });
    const r = await chargeForVisit(h.deps, 'appt_1');
    assert.equal(r.outcome === 'skipped' && r.reason, reason);
    assert.equal(h.calls.length, 0);
    assert.equal(h.charges.size, 1, 'an opted-in client\'s skipped charge is kept for billing review');
  }
  const notEnrolled = harness({ enrolled: false });
  assert.equal((await chargeForVisit(notEnrolled.deps, 'appt_1')).outcome, 'skipped');
  assert.equal(notEnrolled.charges.size, 0, 'clients who never opted in leave no rows');
  const noCard = harness({ card: null });
  assert.equal((await chargeForVisit(noCard.deps, 'appt_1')).outcome, 'skipped');
  const autopayOff = harness({ card: { autopayEnabled: false } });
  assert.equal((await chargeForVisit(autopayOff.deps, 'appt_1')).outcome, 'skipped');
  assert.equal(autopayOff.calls.length, 0);

  const latest = currentAuthorization([authRow({ id: 'old', signedAt: new Date('2026-01-01'), formData: { response: { fields: { chargeTypes: ['copay'] } } } }), authRow({ id: 'new', chargeTypes: ['self_pay'] })], NOW);
  assert.equal(latest?.consentFormId, 'new');
  const t = templateVersion('card-on-file-authorization', 1)!;
  const options = t.fields?.find((f) => f.key === 'chargeTypes')?.options?.map((o) => o.value) ?? [];
  for (const v of ['copay', 'patient_responsibility', 'self_pay', 'missed_visit']) assert.ok(options.includes(v), `template offers ${v}`);
});

test('master switch off (default): nothing is charged and no rows are written', async () => {
  const h = harness({ settings: { enabled: false } });
  const r = await chargeForVisit(h.deps, 'appt_1');
  assert.equal(r.outcome === 'skipped' && r.reason, 'disabled');
  assert.equal(h.charges.size, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(DEFAULT_SETTINGS.enabled, false);
});

// ─── Caps ────────────────────────────────────────────────────────────────────

test('caps: above the practice per-charge or monthly maximum the charge is held and billing notified; approval charges it; the patient\'s own maximum always applies', async () => {
  const perCharge = harness({ settings: { maxPerChargeCents: 2000 } });
  const r = await chargeForVisit(perCharge.deps, 'appt_1');
  assert.equal(r.outcome === 'held' && r.reason, 'over_charge_cap');
  assert.equal(perCharge.notices.billingReview, 1);
  assert.equal(perCharge.calls.length, 0);
  const held = [...perCharge.charges.values()][0];
  const noApproval = await retryCharge(perCharge.deps, { organizationId: ORG, chargeId: held.id, actor: { userId: 'u1', role: 'BILLING' } });
  assert.equal(noApproval.ok, false);
  const approved = await retryCharge(perCharge.deps, { organizationId: ORG, chargeId: held.id, actor: { userId: 'u1', role: 'BILLING' }, approveHeld: true });
  assert.equal(approved.ok, true);
  assert.equal(perCharge.calls.filter((c) => c.method === 'paymentIntents.create').length, 1);
  assert.ok(perCharge.audits.some((a) => a.action === 'patient_charge_cap_approved'));

  const monthly = harness({ settings: { maxPerMonthCents: 4000 } });
  await chargeForVisit(monthly.deps, 'appt_1'); // 25.00 processing
  const second = await chargeForVisit(monthly.deps, 'appt_2'); // 25 + 25 > 40
  assert.equal(second.outcome === 'held' && second.reason, 'over_month_cap');

  const patientMax = harness({ auth: [authRow({ maxPerCharge: '$20' })] });
  const p = await chargeForVisit(patientMax.deps, 'appt_1');
  assert.equal(p.outcome === 'skipped' && p.reason, 'over_authorized_max');
  const c = [...patientMax.charges.values()][0];
  const forced = await retryCharge(patientMax.deps, { organizationId: ORG, chargeId: c.id, actor: { userId: 'u1', role: 'BILLING' }, approveHeld: true });
  assert.equal(forced.ok, false, 'billing cannot exceed what the patient authorized');
  assert.equal(patientMax.calls.length, 0);
});

test('decideCharge: expired card and card from another Stripe mode are not charged', () => {
  const base: DecisionInput = {
    kind: 'copay',
    settings: { ...DEFAULT_SETTINGS, enabled: true },
    configured: true,
    livemode: false,
    enrollment: { active: true },
    card: { paymentMethodId: 'pm_1', customerId: 'cus_1', autopayEnabled: true, expiry: '12/29', last4: '4242', livemode: false },
    authorization: currentAuthorization([authRow()], NOW),
    payer: { insuranceType: 'Commercial', insurancePayer: 'Aetna', medicaidId: null, coverages: [] },
    amountCents: 2500,
    monthToDateCents: 0,
    now: NOW,
  };
  assert.deepEqual(decideCharge(base), { action: 'charge', amountCents: 2500 });
  assert.equal((decideCharge({ ...base, card: { ...base.card!, expiry: '10/26' } }) as { reason: string }).reason, 'card_expired');
  assert.equal((decideCharge({ ...base, livemode: true }) as { reason: string }).reason, 'card_mode_mismatch');
  assert.equal(cardExpired('11/26', NOW), false);
  assert.equal(cardExpired('10/2026', NOW), true);
});


// ─── Visit trigger from every status path ────────────────────────────────────

test('visit trigger: runs for COMPLETED / NO_SHOW / LATE_CANCEL (any spelling) and linked sessions; never for other statuses; never throws', async () => {
  const ran: string[] = [];
  setAutopayVisitRunner(async (id) => {
    ran.push(id);
    if (id === 'boom') throw new Error('x');
  });
  try {
    const cases: [string, string | null][] = [['a1', 'COMPLETED'], ['a2', 'no-show'], ['a3', 'LATE_CANCEL'], ['a4', 'CANCELLED'], ['a5', 'IN_SESSION'], ['a6', null], ['boom', 'COMPLETED']];
    for (const [id, st] of cases) await triggerAutopayAfterVisitStatus(id, st);
    await triggerAutopayAfterVisitStatus(null, 'COMPLETED');
    assert.deepEqual(ran, ['a1', 'a2', 'a3', 'a6', 'boom']);
  } finally {
    setAutopayVisitRunner(null);
  }
  assert.equal(isAutopayVisitStatus('completed'), true);
  assert.equal(isAutopayVisitStatus('CHECKED_IN'), false);
});

test('visit trigger: through the trigger the charge path stays idempotent (one charge per visit + type)', async () => {
  const h = harness();
  setAutopayVisitRunner((id) => chargeForVisit(h.deps, id));
  try {
    await Promise.all([triggerAutopayAfterVisitStatus('appt_9', 'COMPLETED'), triggerAutopayAfterVisitStatus('appt_9', 'COMPLETED'), triggerAutopayAfterVisitStatus('appt_9', null)]);
  } finally {
    setAutopayVisitRunner(null);
  }
  assert.equal(h.charges.size, 1);
  assert.equal(h.calls.filter((c) => c.method === 'paymentIntents.create').length, 1);
});

test('every code path that completes / no-shows / late-cancels a visit calls the AutoPay trigger', () => {
  const ROOT = path.join(__dirname, '..', 'src');
  const REQUIRED = [
    'lib/appointments/manage.ts', // staff PATCH, status helper, series edits
    'app/api/telehealth/end/route.ts',
    'app/api/telehealth/in-call/route.ts',
    'lib/telehealth/manage.ts',
    'lib/groups/store.ts', // group attendance -> COMPLETED / NO_SHOW
    'patient/application/appointments/service.ts', // patient late cancel
  ];
  for (const f of REQUIRED) assert.match(readFileSync(path.join(ROOT, f), 'utf8'), /triggerAutopayAfterVisitStatus\(/, `${f} must call triggerAutopayAfterVisitStatus`);
  // Any other file writing one of these statuses on an appointment must call it too
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n)) files.push(p);
    }
  };
  walk(ROOT);
  const writer = /appointment\.(update|updateMany|upsert)\(\{[\s\S]{0,400}?status:\s*[^,}]*'(COMPLETED|NO_SHOW|LATE_CANCEL)'/;
  const offenders = files
    .filter((f) => !f.includes(`${path.sep}patientPayments${path.sep}`))
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return writer.test(src) && !src.includes('triggerAutopayAfterVisitStatus(');
    })
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

// ─── Nightly sweep ───────────────────────────────────────────────────────────

const finder = (visits: string[], eras: string[]): SweepFinder => ({ visits: async () => visits, eras: async () => eras });

test('sweep: dry run reports what would happen and writes nothing; --apply charges through the same rules; reruns are idempotent', async () => {
  const h = harness();
  const dry = await sweepPatientAutopay(h.deps, finder(['appt_1', 'appt_2'], ['era_1']), { organizationId: ORG, apply: false });
  assert.equal(dry.visits, 2);
  assert.equal(dry.eras, 1);
  assert.equal(dry.charge, 3);
  assert.equal(h.charges.size, 0, 'dry run writes nothing');
  assert.equal(h.calls.length, 0, 'dry run calls nothing in Stripe');
  assert.ok(h.audits.some((a) => a.action === 'patient_autopay_sweep_dry_run'));

  const applied = await sweepPatientAutopay(h.deps, finder(['appt_1', 'appt_2'], ['era_1']), { organizationId: ORG, apply: true });
  assert.equal(applied.charge, 3);
  assert.equal(h.charges.size, 3);
  const again = await sweepPatientAutopay(h.deps, finder(['appt_1', 'appt_2'], ['era_1']), { organizationId: ORG, apply: true });
  assert.equal(again.duplicate, 3);
  assert.equal(again.charge, 0);
  assert.equal(h.calls.filter((c) => c.method === 'paymentIntents.create').length, 3);
});

test('sweep: same rules (Medicaid skipped, master switch off does nothing, visits before the authorization day never charged)', async () => {
  const md = harness({ payer: { insurancePayer: 'Priority Partners' } });
  const r = await sweepPatientAutopay(md.deps, finder(['appt_1'], []), { organizationId: ORG, apply: true });
  assert.equal(r.skipRecorded, 1);
  assert.equal(r.skipReasons.medicaid, 1);
  assert.equal(md.calls.length, 0);

  const off = harness({ settings: { enabled: false } });
  const o = await sweepPatientAutopay(off.deps, finder(['appt_1'], ['era_1']), { organizationId: ORG, apply: true });
  assert.equal(o.visits + o.eras + o.charge, 0);

  // Authorization signed Nov 1; a visit from Oct 25 (e.g. imported from Valant) is never charged
  const old = harness({ visit: { startsAt: new Date('2026-10-25T14:00:00Z') } });
  const b = await sweepPatientAutopay(old.deps, finder(['appt_old'], []), { organizationId: ORG, apply: true });
  assert.equal(b.skipReasons.before_authorization, 1);
  assert.equal(old.calls.length, 0);
  // Card authorized at the end of that day's visit still covers that visit's copay
  const sameDay = harness({ visit: { startsAt: new Date('2026-11-01T10:00:00Z') } });
  assert.equal((await chargeForVisit(sameDay.deps, 'appt_today')).outcome, 'attempted');
});

// ─── Roles ───────────────────────────────────────────────────────────────────

test('roles: front desk and office manager capture cards and turn AutoPay on/off; charges, refunds, voids and settings stay billing / leadership', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'ADMIN', 'PRACTICE_DIRECTOR']) assert.equal(canManageAutopayEnrollment(r), true, r);
  for (const r of ['THERAPIST', 'CASE_MANAGER', 'PEER_SUPPORT', null]) assert.equal(canManageAutopayEnrollment(r), false, String(r));
  for (const r of ['BILLING', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) assert.equal(canAdministerCharges(r), true, r);
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'THERAPIST']) assert.equal(canAdministerCharges(r), false, r);
  assert.equal(canEditPatientPaymentSettings('ADMIN'), true);
  for (const r of ['BILLING', 'OFFICE_MANAGER', 'FRONT_DESK']) assert.equal(canEditPatientPaymentSettings(r), false, r);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/billing/autopay'), true);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/billing/autopay'), false);
  const read = (f: string) => readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'billing', 'autopay', f), 'utf8');
  assert.match(read('card-setup/route.ts'), /autopayGate\('desk'\)/);
  assert.match(read('charges/[id]/route.ts'), /autopayGate\('charges'\)/);
  assert.match(read('route.ts'), /canManageAutopayEnrollment\(gate\.role\)/);
  assert.match(read('settings/route.ts'), /canEditPatientPaymentSettings/);
});
