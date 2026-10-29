/**
 * Patient automatic payments (card on file through Stripe). Framework- and database-free: every
 * dependency comes in through ServiceDeps (production wiring: ./server.ts).
 *
 *   startCardSetup / completeCardSetup  SetupIntent (usage off_session) confirmed by Stripe Elements in
 *                                       the portal or in the office; Altrixs stores only Stripe ids,
 *                                       brand, last 4 and expiry, then sends the Card-on-File Authorization.
 *   chargeForVisit                      after a visit is completed (copay / self-pay) or missed (fee)
 *   chargeAfterEra                      after an 835 is posted (coinsurance / deductible)
 *   handleWebhookEvent                  the ONLY place a card payment reaches the ledger
 *                                       (payment_intent.succeeded); failures, SCA, refunds
 *   retryCharge / voidCharge / refundCharge / patientConfirmation  staff and patient actions
 *
 * Every charge, refund, failure and enrollment change is audited (deps.audit).
 */
import { configProblemMessage } from './config';
import { buildCustomerParams, buildPaymentIntentParams, buildRefundParams, buildSetupIntentParams } from './params';
import {
  AUTHORIZATION_NEEDS_APPROVAL,
  CHARGE_KIND_LABEL,
  chargeMonthOf,
  classifyStripeFailure,
  countedCents,
  currentAuthorization,
  decideCharge,
  eraChargeKey,
  postEraAmountCents,
  receiptNumberFor,
  stripeAttemptKey,
  visitChargeKey,
  type ChargeKind,
  type ChargeStatus,
  type HoldReason,
  type PatientPaymentSettingsShape,
  type SkipReason,
} from './rules';
import type { Actor, CardRecord, ChargeRecord, GatewayPaymentIntent, GatewayRefund, PatientPaymentsGateway, RefundRecord, ServiceDeps } from './types';

type OkConfig = Extract<ReturnType<ServiceDeps['config']>, { ok: true }>;
export type Fail = { ok: false; status: number; error: string; code?: string };

const SYSTEM: Actor = { userId: null, role: 'system' };

async function audit(deps: ServiceDeps, action: string, c: { organizationId: string; clientId: string; id?: string | null }, actor: Actor, metadata: Record<string, unknown>, outcome: 'SUCCESS' | 'FAILURE' | 'DENIED' = 'SUCCESS') {
  await deps
    .audit({
      action,
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: c.organizationId,
      resourceType: 'PatientCharge',
      resourceId: c.id ?? null,
      patientId: c.clientId,
      outcome,
      metadata,
    })
    .catch(() => {});
}

async function readyConfig(deps: ServiceDeps, organizationId: string): Promise<{ ok: true; settings: PatientPaymentSettingsShape; config: OkConfig; gateway: PatientPaymentsGateway } | Fail> {
  const settings = await deps.store.settings(organizationId);
  if (!settings.enabled) return { ok: false, status: 409, error: 'Patient card payments are turned off for this practice (AutoPay settings).', code: 'disabled' };
  const config = deps.config(organizationId);
  if (config.ok === false) return { ok: false, status: 503, error: configProblemMessage(config.reason), code: config.reason };
  return { ok: true, settings, config, gateway: deps.gateway(config, settings) };
}

// ─── Card capture ────────────────────────────────────────────────────────────

export async function startCardSetup(
  deps: ServiceDeps,
  input: { organizationId: string; clientId: string; via: 'portal' | 'in_office'; actor: Actor }
): Promise<{ ok: true; clientSecret: string; publishableKey: string; setupIntentId: string; mode: 'test' | 'live'; stripeAccount: string | null } | Fail> {
  const ready = await readyConfig(deps, input.organizationId);
  if (ready.ok === false) return ready;
  const tmpl = await deps.store.authorizationTemplate(input.organizationId);
  if (tmpl.sendable === false) return { ok: false, status: 409, error: AUTHORIZATION_NEEDS_APPROVAL, code: 'authorization_not_approved' };
  const { config, gateway, settings } = ready;
  let customerId = await deps.store.stripeCustomer(input.organizationId, input.clientId, config.livemode);
  if (!customerId) {
    const customer = await gateway.createCustomer(buildCustomerParams(input), {
      idempotencyKey: `altrixs:${input.organizationId}:customer:${input.clientId}:${config.mode}`,
    });
    customerId = customer.id;
    await deps.store.saveStripeCustomer(input.organizationId, input.clientId, config.livemode, customerId);
  }
  const si = await gateway.createSetupIntent(buildSetupIntentParams({ ...input, customerId }));
  if (!si.client_secret) return { ok: false, status: 502, error: 'Stripe did not return a card setup session.' };
  await audit(deps, 'patient_card_setup_started', { organizationId: input.organizationId, clientId: input.clientId }, input.actor, { via: input.via, mode: config.mode, setupIntentId: si.id });
  return { ok: true, clientSecret: si.client_secret, publishableKey: config.publishableKey, setupIntentId: si.id, mode: config.mode, stripeAccount: settings.stripeAccountId };
}

function expiryLabel(month: number, year: number) {
  return `${String(month).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}`;
}

export async function completeCardSetup(
  deps: ServiceDeps,
  input: { organizationId: string; clientId: string; setupIntentId: string; via: 'portal' | 'in_office'; actor: Actor }
): Promise<{ ok: true; card: CardRecord; packetId: string | null; authorizationError: string | null } | Fail> {
  const ready = await readyConfig(deps, input.organizationId);
  if (ready.ok === false) return ready;
  const { gateway, config } = ready;
  const deny = async (reason: string, error = 'This card setup does not belong to this patient.') => {
    await audit(deps, 'patient_card_save_refused', { organizationId: input.organizationId, clientId: input.clientId }, input.actor, { reason, setupIntentId: input.setupIntentId }, 'DENIED');
    return { ok: false as const, status: 400, error };
  };
  const si = await gateway.retrieveSetupIntent(input.setupIntentId);
  if (si.metadata?.altrixs_account !== input.clientId || si.metadata?.altrixs_org !== input.organizationId) return deny('metadata_mismatch');
  const customerId = await deps.store.stripeCustomer(input.organizationId, input.clientId, config.livemode);
  if (!customerId || si.customer !== customerId) return deny('customer_mismatch');
  if (si.status !== 'succeeded' || !si.payment_method) return deny('not_succeeded', 'The card was not confirmed. Please try again.');
  if (si.usage && si.usage !== 'off_session') return deny('usage');
  const pm = await gateway.retrievePaymentMethod(si.payment_method);
  if (!pm.card) return deny('not_a_card', 'Only cards can be saved for automatic payments.');
  const previous = await deps.store.card(input.organizationId, input.clientId);
  if (previous?.paymentMethodId && previous.paymentMethodId !== pm.id && previous.livemode === config.livemode) {
    await gateway.detachPaymentMethod(previous.paymentMethodId).catch(() => {});
  }
  const card = await deps.store.saveCard({
    organizationId: input.organizationId,
    clientId: input.clientId,
    customerId,
    paymentMethodId: pm.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    expiry: expiryLabel(pm.card.exp_month, pm.card.exp_year),
    postalCode: pm.postalCode,
    livemode: config.livemode,
    via: input.via,
    actorUserId: input.actor.userId,
    setupIntentId: si.id,
  });
  await audit(deps, 'patient_card_saved', { organizationId: input.organizationId, clientId: input.clientId, id: card.id }, input.actor, {
    via: input.via,
    mode: config.mode,
    brand: card.brand,
    last4: card.last4,
    replaced: Boolean(previous),
  });
  // The patient opts in by signing the Card-on-File Authorization for THIS card
  const sent = await deps.store.sendAuthorization({
    organizationId: input.organizationId,
    clientId: input.clientId,
    method: input.via === 'portal' ? 'portal' : 'in_office',
    prefill: { cardBrand: card.brand ?? '', last4: card.last4 ?? '', expiry: card.expiry ?? '' },
    actorUserId: input.actor.userId,
  });
  await audit(deps, 'patient_card_authorization_sent', { organizationId: input.organizationId, clientId: input.clientId }, input.actor, sent.ok === true ? { packetId: sent.packetId, method: input.via } : { error: 'not_sent' }, sent.ok ? 'SUCCESS' : 'FAILURE');
  return { ok: true, card, packetId: sent.ok === true ? sent.packetId : null, authorizationError: sent.ok === false ? sent.error : null };
}

// ─── Charging ────────────────────────────────────────────────────────────────

/** Skips for clients who never opted in (or nothing to charge): no row, nothing to review. */
const NO_ROW: ReadonlySet<SkipReason> = new Set(['disabled', 'kind_off', 'not_configured', 'not_enrolled', 'no_card', 'card_autopay_off', 'no_amount']);

export type ChargeOutcome =
  | { outcome: 'no_visit' | 'not_applicable' }
  | { outcome: 'duplicate'; charge: ChargeRecord }
  | { outcome: 'skipped'; reason: SkipReason; charge: ChargeRecord | null }
  | { outcome: 'held'; reason: HoldReason; charge: ChargeRecord }
  | { outcome: 'attempted'; charge: ChargeRecord };

type EvaluateInput = {
  organizationId: string;
  clientId: string;
  kind: ChargeKind;
  amountCents: number | null;
  key: string;
  appointmentId: string | null;
  claimId: string | null;
  eraClaimId: string | null;
  selfPay?: boolean;
  missedVisitPolicy?: { feeEnabled: boolean } | null;
  /** Visit start (visit charges): visits before the authorization day are never charged */
  serviceDate?: Date | null;
  actor: Actor;
};

async function decisionFor(deps: ServiceDeps, i: EvaluateInput & { capsApproved?: boolean; excludeChargeId?: string }) {
  const settings = await deps.store.settings(i.organizationId);
  const config = deps.config(i.organizationId);
  const now = deps.now();
  const [enrollment, card, authRows, payer, today] = await Promise.all([
    deps.store.enrollment(i.organizationId, i.clientId),
    deps.store.card(i.organizationId, i.clientId),
    deps.store.authorizationRows(i.organizationId, i.clientId),
    deps.store.payer(i.organizationId, i.clientId),
    deps.practiceToday(i.organizationId),
  ]);
  const month = chargeMonthOf(today);
  const monthRows = (await deps.store.charges(i.organizationId, { clientId: i.clientId, month })).filter((r) => r.id !== i.excludeChargeId);
  const decision = decideCharge({
    kind: i.kind,
    settings,
    configured: config.ok,
    livemode: config.ok ? config.livemode : false,
    enrollment,
    card,
    authorization: currentAuthorization(authRows, now),
    payer,
    amountCents: i.amountCents,
    missedVisitPolicy: i.missedVisitPolicy ?? null,
    selfPay: i.selfPay,
    monthToDateCents: countedCents(monthRows),
    now,
    serviceDate: i.serviceDate ?? null,
    capsApproved: i.capsApproved,
  });
  return { decision, settings, config, card, month };
}

async function evaluateAndCharge(deps: ServiceDeps, i: EvaluateInput): Promise<ChargeOutcome> {
  // Master switch first: a practice with patient payments off pays for one settings read per visit / ERA
  if (!(await deps.store.settings(i.organizationId)).enabled) return { outcome: 'skipped', reason: 'disabled', charge: null };
  const existing = await deps.store.chargeByKey(i.organizationId, i.key);
  if (existing) return { outcome: 'duplicate', charge: existing };
  const { decision, settings, config, card, month } = await decisionFor(deps, i);
  if (decision.action === 'skip' && NO_ROW.has(decision.reason)) return { outcome: 'skipped', reason: decision.reason, charge: null };
  const status: ChargeStatus = decision.action === 'charge' ? 'pending' : decision.action === 'hold' ? 'held' : 'skipped';
  const inserted = await deps.store.insertCharge({
    organizationId: i.organizationId,
    clientId: i.clientId,
    kind: i.kind,
    status,
    amountCents: decision.amountCents,
    idempotencyKey: i.key,
    appointmentId: i.appointmentId,
    claimId: i.claimId,
    eraClaimId: i.eraClaimId,
    chargeMonth: month,
    reason: decision.action === 'charge' ? null : decision.reason,
    cardOnFileId: card?.id ?? null,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    livemode: config.ok ? config.livemode : false,
    createdById: i.actor.userId,
  });
  if (!inserted.created) return { outcome: 'duplicate', charge: inserted.charge };
  const charge = inserted.charge;
  await audit(deps, `patient_charge_${status === 'pending' ? 'created' : status}`, charge, i.actor, {
    kind: i.kind,
    amountCents: charge.amountCents,
    key: i.key,
    ...(charge.reason ? { reason: charge.reason } : {}),
  });
  if (decision.action === 'skip') return { outcome: 'skipped', reason: decision.reason, charge };
  if (decision.action === 'hold') {
    await deps.notify.billingReview(i.organizationId).catch(() => {});
    return { outcome: 'held', reason: decision.reason, charge };
  }
  if (!config.ok || !card) return { outcome: 'skipped', reason: 'not_configured', charge };
  const attempted = await attemptCharge(deps, charge, card, settings, config, i.actor, ['pending']);
  return { outcome: 'attempted', charge: attempted ?? charge };
}

/**
 * One off-session PaymentIntent attempt. The row is claimed first (conditional status update) so two
 * workers never charge it twice; Stripe's Idempotency-Key (charge key + attempt) covers retries of the
 * same request. A synchronous success only marks the row "processing": the ledger is posted by the
 * payment_intent.succeeded webhook.
 */
async function attemptCharge(
  deps: ServiceDeps,
  charge: ChargeRecord,
  card: CardRecord,
  settings: PatientPaymentSettingsShape,
  config: OkConfig,
  actor: Actor,
  from: readonly ChargeStatus[]
): Promise<ChargeRecord | null> {
  if (!card.paymentMethodId || !card.customerId) return null;
  const attempt = charge.attempts + 1;
  const claimed = await deps.store.updateCharge(
    charge.id,
    { status: 'processing', attempts: attempt, lastAttemptAt: deps.now(), failureCode: null, failureMessage: null, reason: null, patientNotifiedAt: null, cardOnFileId: card.id, cardBrand: card.brand, cardLast4: card.last4, updatedById: actor.userId },
    from
  );
  if (!claimed) return null;
  const gateway = deps.gateway(config, settings);
  const params = buildPaymentIntentParams({
    organizationId: charge.organizationId,
    clientId: charge.clientId,
    chargeId: charge.id,
    amountCents: charge.amountCents,
    customerId: card.customerId,
    paymentMethodId: card.paymentMethodId,
    descriptorSuffix: settings.statementDescriptorSuffix,
  });
  let result: Awaited<ReturnType<PatientPaymentsGateway['createPaymentIntent']>>;
  try {
    result = await gateway.createPaymentIntent(params, { idempotencyKey: stripeAttemptKey(charge.organizationId, charge.idempotencyKey, attempt) });
  } catch (err) {
    const cls = classifyStripeFailure({ code: 'processing_error', decline_code: null, type: err instanceof Error ? err.name : null });
    const failed = await afterAttempt(deps, charge.id, { status: 'failed', failureCode: cls.code, failureMessage: cls.message });
    await audit(deps, 'patient_charge_failed', charge, actor, { attempt, code: cls.code, amountCents: charge.amountCents });
    return failed;
  }
  if (result.ok) {
    const pi = result.paymentIntent;
    if (pi.status === 'requires_action' || pi.status === 'requires_confirmation') return markNeedsAction(deps, charge, pi.id, actor, attempt, ['processing']);
    if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
      const cls = classifyStripeFailure(pi.last_payment_error ?? null, pi.status);
      const failed = await afterAttempt(deps, charge.id, { status: cls.status, stripePaymentIntentId: pi.id, failureCode: cls.code, failureMessage: cls.message });
      await audit(deps, 'patient_charge_failed', charge, actor, { attempt, code: cls.code, paymentIntent: pi.id });
      await notifyPatientOnce(deps, failed ?? charge);
      return failed;
    }
    // succeeded / processing: wait for the webhook to post the ledger
    const updated = await afterAttempt(deps, charge.id, { status: 'processing', stripePaymentIntentId: pi.id });
    await audit(deps, 'patient_charge_submitted', charge, actor, { attempt, paymentIntent: pi.id, stripeStatus: pi.status, amountCents: charge.amountCents });
    return updated;
  }
  if (result.ok !== false) return null;
  const cls = classifyStripeFailure(result.error, result.paymentIntent?.status ?? null);
  if (cls.status === 'needs_action') return markNeedsAction(deps, charge, result.paymentIntent?.id ?? null, actor, attempt, ['processing']);
  const failed = await afterAttempt(deps, charge.id, {
    status: 'failed',
    stripePaymentIntentId: result.paymentIntent?.id ?? null,
    failureCode: cls.code,
    failureMessage: cls.message,
  });
  await audit(deps, 'patient_charge_failed', charge, actor, { attempt, code: cls.code, retryable: cls.retryable, paymentIntent: result.paymentIntent?.id ?? null });
  await notifyPatientOnce(deps, failed ?? charge);
  return failed;
}

/**
 * Result of an attempt, written only while the row is still "processing": the webhook may already have
 * marked it paid (Stripe can deliver payment_intent.succeeded before the API call returns here).
 */
async function afterAttempt(deps: ServiceDeps, id: string, patch: Parameters<ServiceDeps['store']['updateCharge']>[1]) {
  return (await deps.store.updateCharge(id, patch, ['processing'])) ?? (await deps.store.chargeById(id));
}

async function markNeedsAction(deps: ServiceDeps, charge: ChargeRecord, paymentIntentId: string | null, actor: Actor, attempt: number | null, onlyFrom?: readonly ChargeStatus[]) {
  const patch = {
    status: 'needs_action' as const,
    stripePaymentIntentId: paymentIntentId ?? charge.stripePaymentIntentId,
    failureCode: 'authentication_required',
    failureMessage: 'The card issuer needs the patient to confirm this payment.',
  };
  const updated = onlyFrom ? await deps.store.updateCharge(charge.id, patch, onlyFrom) : await deps.store.updateCharge(charge.id, patch);
  if (!updated) return deps.store.chargeById(charge.id);
  await audit(deps, 'patient_charge_needs_action', charge, actor, { attempt, paymentIntent: paymentIntentId });
  await notifyPatientOnce(deps, updated ?? charge);
  return updated;
}

/** One "account update" notice per charge problem (no PHI: the portal shows the detail). */
async function notifyPatientOnce(deps: ServiceDeps, charge: ChargeRecord) {
  if (charge.patientNotifiedAt || (charge.status !== 'failed' && charge.status !== 'needs_action')) return;
  await deps.notify.accountUpdate(charge.organizationId, charge.clientId).catch(() => {});
  await deps.store.updateCharge(charge.id, { patientNotifiedAt: deps.now() });
}

async function visitInput(deps: ServiceDeps, appointmentId: string, actor: Actor): Promise<EvaluateInput | 'no_visit' | 'not_applicable'> {
  const v = await deps.store.visit(appointmentId);
  if (!v) return 'no_visit';
  let kind: ChargeKind;
  let amountCents: number | null;
  if (v.status === 'COMPLETED') {
    kind = v.selfPay ? 'self_pay' : 'copay';
    amountCents = v.selfPay ? v.selfPayFeeCents : v.copayCents;
  } else if (v.status === 'NO_SHOW' || v.status === 'LATE_CANCEL') {
    kind = 'missed_visit';
    amountCents = v.missedVisitPolicy?.feeCents ?? null;
  } else {
    return 'not_applicable';
  }
  return {
    organizationId: v.organizationId,
    clientId: v.clientId,
    kind,
    amountCents,
    key: visitChargeKey(v.appointmentId, kind),
    appointmentId: v.appointmentId,
    claimId: v.claimId,
    eraClaimId: null,
    selfPay: v.selfPay,
    missedVisitPolicy: v.missedVisitPolicy,
    serviceDate: v.startsAt ?? null,
    actor,
  };
}

async function eraInput(deps: ServiceDeps, eraClaimId: string, actor: Actor): Promise<EvaluateInput | null> {
  const e = await deps.store.era(eraClaimId);
  if (!e) return null;
  const key = eraChargeKey(eraClaimId);
  const prior = [
    ...(await deps.store.charges(e.organizationId, { clientId: e.clientId, claimId: e.claimId })),
    ...(e.appointmentId ? await deps.store.charges(e.organizationId, { clientId: e.clientId, appointmentId: e.appointmentId }) : []),
  ];
  const unique = [...new Map(prior.filter((r) => r.idempotencyKey !== key && r.kind !== 'missed_visit').map((r) => [r.id, r])).values()];
  return {
    organizationId: e.organizationId,
    clientId: e.clientId,
    kind: 'coinsurance',
    amountCents: postEraAmountCents(e.patientResponsibilityCents, countedCents(unique)),
    key,
    appointmentId: e.appointmentId,
    claimId: e.claimId,
    eraClaimId: e.eraClaimId,
    actor,
  };
}

/** After a visit's status changes: COMPLETED -> copay or self-pay fee; NO_SHOW / LATE_CANCEL -> missed-visit fee. */
export async function chargeForVisit(deps: ServiceDeps, appointmentId: string, actor: Actor = SYSTEM): Promise<ChargeOutcome> {
  const i = await visitInput(deps, appointmentId, actor);
  if (i === 'no_visit' || i === 'not_applicable') return { outcome: i };
  return evaluateAndCharge(deps, i);
}

/** After an 835 claim payment is posted: patient responsibility left after what autopay already took. */
export async function chargeAfterEra(deps: ServiceDeps, eraClaimId: string, actor: Actor = SYSTEM): Promise<ChargeOutcome> {
  const i = await eraInput(deps, eraClaimId, actor);
  if (!i) return { outcome: 'no_visit' };
  return evaluateAndCharge(deps, i);
}

export type ChargePreview =
  | { outcome: 'no_visit' | 'not_applicable' | 'duplicate' }
  | { outcome: 'charge' | 'hold' | 'skip'; reason: string | null; amountCents: number; recorded: boolean };

/** Dry run (nightly sweep without --apply): the decision the charge path would make, nothing written or sent. */
export async function previewCharge(deps: ServiceDeps, target: { appointmentId: string } | { eraClaimId: string }): Promise<ChargePreview> {
  const i = 'appointmentId' in target ? await visitInput(deps, target.appointmentId, SYSTEM) : (await eraInput(deps, target.eraClaimId, SYSTEM)) ?? 'no_visit';
  if (i === 'no_visit' || i === 'not_applicable') return { outcome: i };
  if (await deps.store.chargeByKey(i.organizationId, i.key)) return { outcome: 'duplicate' };
  const { decision } = await decisionFor(deps, i);
  if (decision.action === 'charge') return { outcome: 'charge', reason: null, amountCents: decision.amountCents, recorded: true };
  if (decision.action === 'hold') return { outcome: 'hold', reason: decision.reason, amountCents: decision.amountCents, recorded: true };
  return { outcome: 'skip', reason: decision.reason, amountCents: decision.amountCents, recorded: !NO_ROW.has(decision.reason) };
}

// ─── Staff actions ───────────────────────────────────────────────────────────

async function scopedCharge(deps: ServiceDeps, organizationId: string, chargeId: string): Promise<ChargeRecord | null> {
  const c = await deps.store.chargeById(chargeId);
  return c && c.organizationId === organizationId ? c : null;
}

/**
 * Billing retries a failed charge, re-checks a skipped one, or approves a charge held over a practice
 * cap (approveHeld). Every rule is evaluated again with today's data; the patient's own maximum and
 * the authorization always apply.
 */
export async function retryCharge(deps: ServiceDeps, input: { organizationId: string; chargeId: string; actor: Actor; approveHeld?: boolean }): Promise<{ ok: true; charge: ChargeRecord; message: string } | Fail> {
  const charge = await scopedCharge(deps, input.organizationId, input.chargeId);
  if (!charge) return { ok: false, status: 404, error: 'Charge not found' };
  if (charge.status === 'needs_action') return { ok: false, status: 409, error: 'The card issuer needs the patient to confirm this payment in the portal. Void it to stop it.' };
  if (!['failed', 'held', 'skipped'].includes(charge.status)) return { ok: false, status: 409, error: `A ${charge.status} charge cannot be retried.` };
  if (charge.status === 'held' && !input.approveHeld) return { ok: false, status: 409, error: 'This charge is held over a practice cap. Approve it to charge it.' };
  const visit = charge.appointmentId ? await deps.store.visit(charge.appointmentId) : null;
  const { decision, settings, config, card } = await decisionFor(deps, {
    organizationId: charge.organizationId,
    clientId: charge.clientId,
    kind: charge.kind,
    amountCents: charge.amountCents,
    key: charge.idempotencyKey,
    appointmentId: charge.appointmentId,
    claimId: charge.claimId,
    eraClaimId: charge.eraClaimId,
    actor: input.actor,
    capsApproved: Boolean(input.approveHeld && charge.status === 'held'),
    excludeChargeId: charge.id,
    selfPay: visit?.selfPay,
    missedVisitPolicy: visit?.missedVisitPolicy ?? null,
    serviceDate: visit?.startsAt ?? null,
  });
  if (decision.action !== 'charge' || !config.ok || !card) {
    const reason = decision.action === 'charge' ? 'not_configured' : decision.reason;
    const status: ChargeStatus = decision.action === 'hold' ? 'held' : charge.status === 'failed' ? 'failed' : 'skipped';
    await deps.store.updateCharge(charge.id, { status, reason, updatedById: input.actor.userId });
    await audit(deps, 'patient_charge_retry_blocked', charge, input.actor, { reason });
    return { ok: false, status: 409, error: `Not charged: ${reason.replace(/_/g, ' ')}.`, code: reason };
  }
  if (input.approveHeld) await audit(deps, 'patient_charge_cap_approved', charge, input.actor, { amountCents: charge.amountCents, reason: charge.reason });
  await audit(deps, 'patient_charge_retry', charge, input.actor, { previousStatus: charge.status, attempt: charge.attempts + 1 });
  const attempted = await attemptCharge(deps, charge, card, settings, config, input.actor, [charge.status]);
  if (!attempted) return { ok: false, status: 409, error: 'The charge changed while retrying. Refresh and try again.' };
  return { ok: true, charge: attempted, message: attempted.status === 'processing' ? 'Charge submitted. It posts to the ledger when Stripe confirms it.' : `Charge ${attempted.status.replace('_', ' ')}.` };
}

/** Void a charge that has not been paid (cancels its PaymentIntent). A paid charge is refunded instead. */
export async function voidCharge(deps: ServiceDeps, input: { organizationId: string; chargeId: string; actor: Actor; reason?: string | null }): Promise<{ ok: true; charge: ChargeRecord } | Fail> {
  const charge = await scopedCharge(deps, input.organizationId, input.chargeId);
  if (!charge) return { ok: false, status: 404, error: 'Charge not found' };
  const voidable: ChargeStatus[] = ['pending', 'processing', 'failed', 'needs_action', 'held', 'skipped'];
  if (!voidable.includes(charge.status)) return { ok: false, status: 409, error: charge.status === 'succeeded' ? 'This charge was paid: refund it instead.' : `A ${charge.status} charge cannot be voided.` };
  if (charge.stripePaymentIntentId && ['processing', 'needs_action', 'failed', 'pending'].includes(charge.status)) {
    const ready = await readyConfig(deps, input.organizationId);
    if (ready.ok === false) return ready;
    try {
      const pi = await ready.gateway.retrievePaymentIntent(charge.stripePaymentIntentId);
      if (pi.status === 'succeeded') return { ok: false, status: 409, error: 'Stripe already collected this payment: refund it instead.' };
      if (pi.status !== 'canceled') await ready.gateway.cancelPaymentIntent(pi.id);
    } catch {
      return { ok: false, status: 502, error: 'Stripe could not void this payment. Try again or refund it once it posts.' };
    }
  }
  const updated = await deps.store.updateCharge(charge.id, { status: 'canceled', reason: 'voided', updatedById: input.actor.userId }, voidable);
  if (!updated) return { ok: false, status: 409, error: 'The charge changed. Refresh and try again.' };
  await audit(deps, 'patient_charge_voided', charge, input.actor, { previousStatus: charge.status, paymentIntent: charge.stripePaymentIntentId });
  return { ok: true, charge: updated };
}

/** Billing refunds a paid charge (all or part) through Stripe; the ledger gets a negative card payment. */
export async function refundCharge(deps: ServiceDeps, input: { organizationId: string; chargeId: string; amountCents?: number | null; reason: string; actor: Actor }): Promise<{ ok: true; charge: ChargeRecord; refund: RefundRecord } | Fail> {
  const charge = await scopedCharge(deps, input.organizationId, input.chargeId);
  if (!charge) return { ok: false, status: 404, error: 'Charge not found' };
  if (!['succeeded', 'partially_refunded'].includes(charge.status) || !charge.stripePaymentIntentId) return { ok: false, status: 409, error: 'Only a paid charge can be refunded.' };
  const remaining = charge.amountCents - charge.refundedCents;
  const amount = Math.trunc(input.amountCents ?? remaining);
  if (!(amount > 0) || amount > remaining) return { ok: false, status: 400, error: `Refund between $0.01 and $${(remaining / 100).toFixed(2)}.` };
  const reason = input.reason.trim().slice(0, 200);
  if (!reason) return { ok: false, status: 400, error: 'A reason is required for a refund.' };
  const ready = await readyConfig(deps, input.organizationId);
  if (ready.ok === false) return ready;
  const row = await deps.store.insertRefund({ organizationId: charge.organizationId, chargeId: charge.id, amountCents: amount, kind: 'refund', status: 'pending', reason, createdById: input.actor.userId });
  let refund: GatewayRefund;
  try {
    refund = await ready.gateway.createRefund(buildRefundParams({ paymentIntentId: charge.stripePaymentIntentId, amountCents: amount, chargeId: charge.id, refundId: row.id }), {
      idempotencyKey: `altrixs:${charge.organizationId}:refund:${row.id}`,
    });
  } catch {
    await deps.store.updateRefund(row.id, { status: 'failed' });
    await audit(deps, 'patient_charge_refund_failed', charge, input.actor, { amountCents: amount });
    return { ok: false, status: 502, error: 'Stripe could not process the refund.' };
  }
  const saved = await deps.store.updateRefund(row.id, { stripeRefundId: refund.id, status: refundStatus(refund.status) });
  await audit(deps, 'patient_charge_refund_requested', charge, input.actor, { amountCents: amount, refundId: refund.id, stripeStatus: refund.status });
  const applied = refund.status === 'succeeded' ? await applyRefundSucceeded(deps, charge, saved, refund, input.actor) : null;
  return { ok: true, charge: applied ?? (await deps.store.chargeById(charge.id)) ?? charge, refund: (await deps.store.refundById(row.id)) ?? saved };
}

function refundStatus(s: string | null): RefundRecord['status'] {
  return s === 'succeeded' ? 'succeeded' : s === 'failed' ? 'failed' : s === 'canceled' ? 'canceled' : 'pending';
}

/** Post a succeeded refund to the ledger once (idempotent on the Stripe refund id). */
async function applyRefundSucceeded(deps: ServiceDeps, charge: ChargeRecord, row: RefundRecord, refund: GatewayRefund, actor: Actor): Promise<ChargeRecord | null> {
  const posted = await deps.store.postLedgerPayment({
    organizationId: charge.organizationId,
    clientId: charge.clientId,
    claimId: charge.claimId,
    amountCents: -Math.abs(refund.amount),
    paidAt: deps.now(),
    note: `Card refund (AutoPay ${CHARGE_KIND_LABEL[charge.kind].toLowerCase()})${charge.cardLast4 ? ` · ${charge.cardBrand ?? 'card'} ending ${charge.cardLast4}` : ''}`,
    idempotencyKey: `stripe:${refund.id}`,
  });
  await deps.store.updateRefund(row.id, { status: 'succeeded', paymentId: posted.paymentId, stripeRefundId: refund.id });
  if (posted.duplicate) return deps.store.chargeById(charge.id);
  const refunded = (await deps.store.refunds(charge.id)).filter((r) => r.status === 'succeeded').reduce((s, r) => s + r.amountCents, 0);
  const updated = await deps.store.updateCharge(charge.id, {
    refundedCents: Math.min(refunded, charge.amountCents),
    status: refunded >= charge.amountCents ? 'refunded' : 'partially_refunded',
  });
  await audit(deps, 'patient_charge_refunded', charge, actor, { amountCents: refund.amount, refundId: refund.id, paymentId: posted.paymentId });
  return updated;
}

// ─── Patient action (SCA) ────────────────────────────────────────────────────

/** The patient confirms a payment their card issuer flagged (portal, on-session). */
export async function patientConfirmation(deps: ServiceDeps, input: { organizationId: string; clientId: string; chargeId: string }): Promise<{ ok: true; clientSecret: string; paymentMethodId: string | null; publishableKey: string; stripeAccount: string | null } | Fail> {
  const charge = await scopedCharge(deps, input.organizationId, input.chargeId);
  if (!charge || charge.clientId !== input.clientId) return { ok: false, status: 404, error: 'Payment not found' };
  if (charge.status !== 'needs_action' || !charge.stripePaymentIntentId) return { ok: false, status: 409, error: 'This payment does not need your action.' };
  const ready = await readyConfig(deps, input.organizationId);
  if (ready.ok === false) return ready;
  const pi = await ready.gateway.retrievePaymentIntent(charge.stripePaymentIntentId);
  if (!pi.client_secret || !['requires_action', 'requires_payment_method', 'requires_confirmation'].includes(pi.status)) return { ok: false, status: 409, error: 'This payment can no longer be confirmed. Contact the billing office.' };
  const card = await deps.store.card(input.organizationId, input.clientId);
  await audit(deps, 'patient_charge_confirmation_started', charge, { userId: null, role: 'PATIENT' }, { paymentIntent: pi.id });
  return { ok: true, clientSecret: pi.client_secret, paymentMethodId: pi.payment_method ?? card?.paymentMethodId ?? null, publishableKey: ready.config.publishableKey, stripeAccount: ready.settings.stripeAccountId };
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

export type WebhookEventLike = { id: string; type: string; livemode: boolean; account?: string | null; data: { object: Record<string, unknown> } };
export type WebhookResult = { outcome: 'ignored' | 'duplicate' | 'posted' | 'updated' | 'refund_posted' | 'unknown_charge'; reason?: string; chargeId?: string };

async function chargeForPaymentIntent(deps: ServiceDeps, pi: GatewayPaymentIntent): Promise<ChargeRecord | null> {
  const byPi = await deps.store.chargeByPaymentIntent(pi.id);
  if (byPi) return byPi;
  const id = pi.metadata?.altrixs_charge;
  if (!id) return null;
  const c = await deps.store.chargeById(id);
  if (!c || pi.metadata?.altrixs_org !== c.organizationId || pi.metadata?.altrixs_account !== c.clientId) return null;
  // A different PaymentIntent was already recorded for this charge: never post a second one
  if (c.stripePaymentIntentId && c.stripePaymentIntentId !== pi.id) return null;
  return c;
}

/**
 * Patient payments webhook (signature verified by the route with its own endpoint secret). Posts a
 * card payment to the ledger ONLY on payment_intent.succeeded, once per PaymentIntent.
 */
export async function handleWebhookEvent(deps: ServiceDeps, event: WebhookEventLike): Promise<WebhookResult> {
  const obj = event.data.object;
  if (event.type.startsWith('payment_intent.')) {
    const pi = obj as unknown as GatewayPaymentIntent;
    const charge = await chargeForPaymentIntent(deps, pi);
    if (!charge) return { outcome: 'unknown_charge', reason: 'no Altrixs charge for this PaymentIntent' };
    if (charge.livemode !== event.livemode) return { outcome: 'ignored', reason: 'mode mismatch', chargeId: charge.id };
    switch (event.type) {
      case 'payment_intent.succeeded':
        return postSucceeded(deps, charge, pi);
      case 'payment_intent.payment_failed': {
        if (['succeeded', 'refunded', 'partially_refunded', 'canceled'].includes(charge.status)) return { outcome: 'ignored', reason: `charge ${charge.status}`, chargeId: charge.id };
        const cls = classifyStripeFailure(pi.last_payment_error ?? null, pi.status);
        if (cls.status === 'needs_action') {
          await markNeedsAction(deps, charge, pi.id, SYSTEM, null);
        } else {
          const updated = await deps.store.updateCharge(charge.id, { status: 'failed', stripePaymentIntentId: pi.id, failureCode: cls.code, failureMessage: cls.message });
          await audit(deps, 'patient_charge_failed', charge, SYSTEM, { code: cls.code, paymentIntent: pi.id, via: 'webhook' });
          await notifyPatientOnce(deps, updated ?? charge);
        }
        return { outcome: 'updated', chargeId: charge.id };
      }
      case 'payment_intent.requires_action':
        if (['succeeded', 'refunded', 'partially_refunded', 'canceled'].includes(charge.status)) return { outcome: 'ignored', chargeId: charge.id };
        await markNeedsAction(deps, charge, pi.id, SYSTEM, null);
        return { outcome: 'updated', chargeId: charge.id };
      case 'payment_intent.canceled':
        if (['succeeded', 'refunded', 'partially_refunded'].includes(charge.status)) return { outcome: 'ignored', chargeId: charge.id };
        await deps.store.updateCharge(charge.id, { status: 'canceled', stripePaymentIntentId: pi.id });
        await audit(deps, 'patient_charge_canceled', charge, SYSTEM, { paymentIntent: pi.id, via: 'webhook' });
        return { outcome: 'updated', chargeId: charge.id };
      default:
        return { outcome: 'ignored', reason: `unhandled ${event.type}`, chargeId: charge.id };
    }
  }
  if (event.type === 'refund.created' || event.type === 'refund.updated' || event.type === 'charge.refund.updated') {
    const refund = obj as unknown as GatewayRefund;
    if (!refund.payment_intent) return { outcome: 'ignored', reason: 'refund without PaymentIntent' };
    const charge = await deps.store.chargeByPaymentIntent(refund.payment_intent);
    if (!charge) return { outcome: 'unknown_charge' };
    if (charge.livemode !== event.livemode) return { outcome: 'ignored', reason: 'mode mismatch', chargeId: charge.id };
    let row = (await deps.store.refundByStripeId(refund.id)) ?? (refund.metadata?.altrixs_refund ? await deps.store.refundById(refund.metadata.altrixs_refund) : null);
    if (row && row.chargeId !== charge.id) return { outcome: 'ignored', reason: 'refund belongs to another charge' };
    if (!row) {
      // Refunded in the Stripe Dashboard: recorded so the ledger matches Stripe
      row = await deps.store.insertRefund({ organizationId: charge.organizationId, chargeId: charge.id, amountCents: refund.amount, kind: 'refund', status: refundStatus(refund.status), reason: 'Refunded in Stripe', createdById: null });
      row = await deps.store.updateRefund(row.id, { stripeRefundId: refund.id });
    }
    if (refund.status !== 'succeeded') {
      await deps.store.updateRefund(row.id, { status: refundStatus(refund.status) });
      return { outcome: 'updated', chargeId: charge.id };
    }
    if (row.paymentId) return { outcome: 'duplicate', chargeId: charge.id };
    await applyRefundSucceeded(deps, charge, row, refund, SYSTEM);
    return { outcome: 'refund_posted', chargeId: charge.id };
  }
  return { outcome: 'ignored', reason: `unhandled ${event.type}` };
}

async function postSucceeded(deps: ServiceDeps, charge: ChargeRecord, pi: GatewayPaymentIntent): Promise<WebhookResult> {
  if (charge.paymentId) return { outcome: 'duplicate', chargeId: charge.id };
  const amount = Math.trunc(pi.amount_received || pi.amount);
  const now = deps.now();
  const posted = await deps.store.postLedgerPayment({
    organizationId: charge.organizationId,
    clientId: charge.clientId,
    claimId: charge.claimId,
    amountCents: amount,
    paidAt: now,
    note: `Card payment (AutoPay ${CHARGE_KIND_LABEL[charge.kind].toLowerCase()})${charge.cardLast4 ? ` · ${charge.cardBrand ?? 'card'} ending ${charge.cardLast4}` : ''}`,
    idempotencyKey: `stripe:${pi.id}`,
  });
  const updated = await deps.store.updateCharge(charge.id, {
    status: charge.status === 'refunded' || charge.status === 'partially_refunded' ? charge.status : 'succeeded',
    stripePaymentIntentId: pi.id,
    paymentId: posted.paymentId,
    succeededAt: now,
    receiptNumber: charge.receiptNumber ?? receiptNumberFor(charge.id, now),
    failureCode: null,
    failureMessage: null,
    reason: null,
  });
  await audit(deps, 'patient_charge_succeeded', charge, SYSTEM, { paymentIntent: pi.id, amountCents: amount, paymentId: posted.paymentId, duplicateLedger: posted.duplicate });
  if (updated && !updated.receiptEmailedAt) {
    const settings = await deps.store.settings(charge.organizationId);
    const sent = await deps.notify.receipt(updated, settings).catch(() => false);
    if (sent) await deps.store.updateCharge(charge.id, { receiptEmailedAt: deps.now() });
    await audit(deps, sent ? 'patient_receipt_emailed' : 'patient_receipt_not_emailed', charge, SYSTEM, { receiptNumber: updated.receiptNumber });
  }
  return { outcome: 'posted', chargeId: charge.id };
}
