/**
 * Patient autopay charge rules (pure; tests/patient-autopay.test.ts). Industry card-on-file practice
 * (SimplePractice / athenaOne / Phreesia): a stored card is charged only for the kinds of amounts the
 * patient authorized in a signed, unrevoked Card-on-File Authorization, after they are the patient's
 * responsibility:
 *   copay        right after the visit is completed, the copay on the client's coverage;
 *   coinsurance  coinsurance / deductible after insurance processed the claim (835 ERA posted);
 *   self_pay     a self-pay visit's fee schedule amount after the visit;
 *   missed_visit no-show / late-cancel fee, only when the practice policy enables it and the
 *                missed-visit guard allows (never Medicaid / unknown insurance).
 * Never charged: Medicaid clients (Medicaid payment is payment in full, 42 CFR 447.15), amounts <= 0,
 * anything above the patient's own "maximum per charge"; above the practice caps the charge is HELD
 * for billing review instead.
 */
import { missedVisitFeeDecision, isMedicaidCoverage } from '@/lib/scheduling/missedVisitFees';
import { detectMarylandMedicaid, type MedicaidClientInput } from '@/lib/consents/carelon/medicaid';

export const CHARGE_KINDS = ['copay', 'coinsurance', 'self_pay', 'missed_visit'] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export const CHARGE_KIND_LABEL: Record<ChargeKind, string> = {
  copay: 'Copay',
  coinsurance: 'Coinsurance / deductible',
  self_pay: 'Self-pay visit',
  missed_visit: 'Missed-visit fee',
};

export const CHARGE_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'needs_action',
  'held',
  'skipped',
  'canceled',
  'refunded',
  'partially_refunded',
] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  succeeded: 'Paid',
  failed: 'Failed',
  needs_action: 'Needs patient action',
  held: 'Held for review',
  skipped: 'Not charged',
  canceled: 'Voided',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
};

/** Card-on-File Authorization chargeTypes value each kind needs (src/lib/consents/library/proposed.ts). */
export const AUTHORIZATION_VALUE: Record<ChargeKind, string> = {
  copay: 'copay',
  coinsurance: 'patient_responsibility',
  self_pay: 'self_pay',
  missed_visit: 'missed_visit',
};

export const CARD_AUTHORIZATION_KEY = 'card-on-file-authorization';
export const CARD_AUTHORIZATION_FORM_KEY = `lib:${CARD_AUTHORIZATION_KEY}`;
export const AUTHORIZATION_NEEDS_APPROVAL = 'Card authorization form needs approval in Consents';

export type PatientPaymentSettingsShape = {
  enabled: boolean;
  chargeCopays: boolean;
  chargeAfterEra: boolean;
  chargeSelfPay: boolean;
  chargeMissedVisitFees: boolean;
  maxPerChargeCents: number | null;
  maxPerMonthCents: number | null;
  statementDescriptorSuffix: string | null;
  receiptSenderName: string | null;
  stripeAccountId: string | null;
};

export const DEFAULT_SETTINGS: PatientPaymentSettingsShape = {
  enabled: false,
  chargeCopays: true,
  chargeAfterEra: true,
  chargeSelfPay: true,
  chargeMissedVisitFees: false,
  maxPerChargeCents: null,
  maxPerMonthCents: null,
  statementDescriptorSuffix: null,
  receiptSenderName: null,
  stripeAccountId: null,
};

// ─── Authorization ───────────────────────────────────────────────────────────

export type CardAuthorization = {
  consentFormId: string;
  chargeTypes: string[];
  /** Patient's own "maximum per charge" (null = none) */
  maxPerChargeCents: number | null;
  last4: string | null;
  signedAt: Date | null;
};

export type AuthorizationRow = {
  id: string;
  status: string;
  formKey: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  signedAt: Date | null;
  formData: unknown;
};

/** "$75", "75.00", "75" -> 7500; blank or unreadable -> null */
export function parseDollarsToCents(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/[$,\s]/g, '');
  if (!s || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

/**
 * The client's current authorization: newest SIGNED, unrevoked, unexpired Card-on-File
 * Authorization row. Field values come from the signed response (formData.response.fields).
 */
export function currentAuthorization(rows: AuthorizationRow[], now: Date): CardAuthorization | null {
  const valid = rows
    .filter((r) => r.formKey === CARD_AUTHORIZATION_FORM_KEY && r.status === 'SIGNED' && !r.revokedAt && (!r.expiresAt || r.expiresAt.getTime() > now.getTime()))
    .sort((a, b) => (b.signedAt?.getTime() ?? 0) - (a.signedAt?.getTime() ?? 0));
  const row = valid[0];
  if (!row) return null;
  const fd = (row.formData ?? {}) as { response?: { fields?: Record<string, unknown> } | null };
  const fields = fd.response?.fields ?? {};
  const types = fields.chargeTypes;
  const chargeTypes = Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string') : typeof types === 'string' && types ? [types] : [];
  const last4 = typeof fields.last4 === 'string' ? fields.last4.replace(/\D/g, '').slice(-4) || null : null;
  return { consentFormId: row.id, chargeTypes, maxPerChargeCents: parseDollarsToCents(fields.maxPerCharge), last4, signedAt: row.signedAt };
}

export function authorizationCovers(auth: CardAuthorization | null, kind: ChargeKind): boolean {
  return Boolean(auth && auth.chargeTypes.includes(AUTHORIZATION_VALUE[kind]));
}

// ─── Payer ───────────────────────────────────────────────────────────────────

export type PayerFacts = {
  insuranceType: string | null;
  insurancePayer: string | null;
  medicaidId: string | null;
  insuranceMemberId?: string | null;
  insuranceEffectiveTo?: Date | null;
  coverages: { payerName: string | null; memberId: string | null; claimFilingCode: string | null; active: boolean; rank?: string | null }[];
};

/**
 * Medicaid for charging purposes: Maryland Medicaid by the Carelon rule, OR any state's Medicaid /
 * MCO by the missed-visit fee patterns, OR any active coverage filed as MC. Stricter than the
 * Carelon rule on purpose: another state's Medicaid is payment in full too.
 */
export function isMedicaidForCharging(p: PayerFacts, now: Date): boolean {
  const md = detectMarylandMedicaid(p as MedicaidClientInput, { now });
  if (md.medicaid) return true;
  if (isMedicaidCoverage({ insuranceType: p.insuranceType, insurancePayer: p.insurancePayer })) return true;
  return p.coverages.some(
    (c) => c.active && ((c.claimFilingCode ?? '').trim().toUpperCase() === 'MC' || isMedicaidCoverage({ insurancePayer: c.payerName }))
  );
}

export function hasActiveSecondary(p: PayerFacts): boolean {
  return p.coverages.some((c) => c.active && (c.rank ?? '').toUpperCase() !== 'P' && Boolean(c.payerName?.trim()));
}

// ─── Decision ────────────────────────────────────────────────────────────────

export type SkipReason =
  | 'disabled'
  | 'kind_off'
  | 'not_configured'
  | 'not_enrolled'
  | 'no_card'
  | 'card_autopay_off'
  | 'card_mode_mismatch'
  | 'card_expired'
  | 'no_authorization'
  | 'not_authorized_for_type'
  | 'authorization_card_mismatch'
  | 'medicaid'
  | 'secondary_coverage'
  | 'missed_visit_not_allowed'
  | 'no_amount'
  | 'over_authorized_max'
  | 'before_authorization'
  | 'already_charged';

export type HoldReason = 'over_charge_cap' | 'over_month_cap';

export const REASON_TEXT: Record<SkipReason | HoldReason, string> = {
  disabled: 'Patient payments are turned off for the practice',
  kind_off: 'This charge type is turned off in AutoPay settings',
  not_configured: 'Stripe is not connected for patient payments',
  not_enrolled: 'AutoPay is off for this client',
  no_card: 'No card on file',
  card_autopay_off: 'AutoPay is off on the card',
  card_mode_mismatch: 'The card was saved in a different Stripe mode (test vs live)',
  card_expired: 'The card on file has expired',
  no_authorization: 'No signed Card-on-File Authorization',
  not_authorized_for_type: 'The signed authorization does not cover this kind of charge',
  authorization_card_mismatch: 'The signed authorization is for a different card',
  medicaid: 'Medicaid client: never charged for covered services',
  secondary_coverage: 'Secondary insurance on file: bill the secondary payer first',
  missed_visit_not_allowed: 'Missed-visit fee not allowed (practice policy, Medicaid or unknown insurance)',
  no_amount: 'Nothing to charge',
  over_authorized_max: "Above the patient's authorized maximum per charge",
  before_authorization: 'The visit was before the day the Card-on-File Authorization was signed',
  already_charged: 'Already charged for this visit',
  over_charge_cap: 'Above the practice maximum per charge: billing review',
  over_month_cap: 'Above the practice monthly maximum: billing review',
};

export type ChargeDecision =
  | { action: 'charge'; amountCents: number }
  | { action: 'hold'; reason: HoldReason; amountCents: number }
  | { action: 'skip'; reason: SkipReason; amountCents: number };

export type DecisionInput = {
  kind: ChargeKind;
  settings: PatientPaymentSettingsShape;
  configured: boolean;
  livemode: boolean;
  enrollment: { active: boolean } | null;
  card: { paymentMethodId: string | null; customerId: string | null; autopayEnabled: boolean; expiry: string | null; last4: string | null; livemode: boolean } | null;
  authorization: CardAuthorization | null;
  payer: PayerFacts;
  /** Amount for this kind (copay on the coverage, ERA patient responsibility left, fee) */
  amountCents: number | null;
  /** Practice no-show / late-cancel policy, missed_visit only */
  missedVisitPolicy?: { feeEnabled: boolean } | null;
  selfPay?: boolean;
  /** Already charged / in flight for the client this practice month (monthly cap) */
  monthToDateCents: number;
  now: Date;
  /** Visit start for visit charges (copay, self-pay, missed visit) */
  serviceDate?: Date | null;
  /** Staff approved a held charge: practice caps no longer apply (the patient's own maximum still does) */
  capsApproved?: boolean;
};

/** MM/YY or MM/YYYY, valid through the last day of that month. Unknown -> not expired. */
export function cardExpired(expiry: string | null | undefined, now: Date): boolean {
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec((expiry ?? '').trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) return false;
  const firstOfNext = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
  return now.getTime() >= firstOfNext;
}

const kindEnabled = (s: PatientPaymentSettingsShape, kind: ChargeKind) =>
  kind === 'copay' ? s.chargeCopays : kind === 'coinsurance' ? s.chargeAfterEra : kind === 'self_pay' ? s.chargeSelfPay : s.chargeMissedVisitFees;

/** The one charge decision. Order matters: cheapest / most fundamental checks first. */
export function decideCharge(i: DecisionInput): ChargeDecision {
  const amount = Math.max(0, Math.trunc(i.amountCents ?? 0));
  const skip = (reason: SkipReason): ChargeDecision => ({ action: 'skip', reason, amountCents: amount });
  if (!i.settings.enabled) return skip('disabled');
  if (!kindEnabled(i.settings, i.kind)) return skip('kind_off');
  if (!i.configured) return skip('not_configured');
  if (!i.enrollment?.active) return skip('not_enrolled');
  if (!i.card || !i.card.paymentMethodId || !i.card.customerId) return skip('no_card');
  if (!i.card.autopayEnabled) return skip('card_autopay_off');
  if (i.card.livemode !== i.livemode) return skip('card_mode_mismatch');
  if (cardExpired(i.card.expiry, i.now)) return skip('card_expired');
  if (!i.authorization) return skip('no_authorization');
  if (!authorizationCovers(i.authorization, i.kind)) return skip('not_authorized_for_type');
  if (i.authorization.last4 && i.card.last4 && i.authorization.last4 !== i.card.last4) return skip('authorization_card_mismatch');
  // A visit is charged only when it happened on or after the day the authorization was signed (18 h
  // grace so a card authorized at the end of today's visit still covers it). Old / imported visits never.
  if (i.kind !== 'coinsurance' && i.serviceDate && i.authorization.signedAt && i.serviceDate.getTime() < i.authorization.signedAt.getTime() - 18 * 3_600_000) {
    return skip('before_authorization');
  }
  if (isMedicaidForCharging(i.payer, i.now)) return skip('medicaid');
  if (i.kind === 'coinsurance' && hasActiveSecondary(i.payer)) return skip('secondary_coverage');
  if (i.kind === 'missed_visit') {
    const d = missedVisitFeeDecision(
      { insuranceType: i.payer.insuranceType, insurancePayer: i.payer.insurancePayer, selfPay: i.selfPay ?? null },
      { feeEnabled: Boolean(i.missedVisitPolicy?.feeEnabled) }
    );
    if (!d.allowed) return skip('missed_visit_not_allowed');
  }
  if (amount <= 0) return skip('no_amount');
  if (i.authorization.maxPerChargeCents != null && amount > i.authorization.maxPerChargeCents) return skip('over_authorized_max');
  if (!i.capsApproved) {
    if (i.settings.maxPerChargeCents != null && amount > i.settings.maxPerChargeCents) return { action: 'hold', reason: 'over_charge_cap', amountCents: amount };
    if (i.settings.maxPerMonthCents != null && i.monthToDateCents + amount > i.settings.maxPerMonthCents) return { action: 'hold', reason: 'over_month_cap', amountCents: amount };
  }
  return { action: 'charge', amountCents: amount };
}

// ─── Amounts ─────────────────────────────────────────────────────────────────

/** Copay from the client's coverage: Client.copayAmount, else one general copay rule for the primary payer. */
export function copayCents(input: {
  copayAmount: number | string | { toString(): string } | null | undefined;
  insurancePayer: string | null;
  rules: { payerName: string; providerType: string; cptRule: string; amountCents: number }[];
}): number | null {
  if (input.copayAmount != null) {
    const n = Number(String(input.copayAmount));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  const payer = (input.insurancePayer ?? '').trim().toLowerCase();
  if (!payer) return null;
  const general = input.rules.filter((r) => r.payerName.trim().toLowerCase() === payer && !r.providerType && !r.cptRule && r.amountCents > 0);
  return general.length === 1 ? general[0].amountCents : null;
}

/**
 * Post-ERA amount: patient responsibility on the claim (all posted remittances) minus what autopay
 * already charged (or has in flight) for the same visit / claim: a copay charged at the visit is part
 * of the ERA patient responsibility and is never charged twice.
 */
export function postEraAmountCents(patientResponsibilityCents: number, alreadyChargedCents: number): number {
  return Math.max(0, Math.round(patientResponsibilityCents) - Math.max(0, Math.round(alreadyChargedCents)));
}

/** Charge statuses that count as money taken or in flight (caps, ERA netting, duplicates). */
export const COUNTED_STATUSES: readonly ChargeStatus[] = ['pending', 'processing', 'succeeded', 'needs_action', 'partially_refunded'];

export function countedCents(rows: { status: string; amountCents: number; refundedCents?: number }[]): number {
  return rows.filter((r) => (COUNTED_STATUSES as readonly string[]).includes(r.status)).reduce((s, r) => s + r.amountCents - (r.refundedCents ?? 0), 0);
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

export function visitChargeKey(appointmentId: string, kind: ChargeKind): string {
  return `visit:${appointmentId}:${kind}`;
}

export function eraChargeKey(eraClaimId: string): string {
  return `era:${eraClaimId}:coinsurance`;
}

/** Stripe Idempotency-Key per attempt: a retry is a new attempt, a repeat of the same attempt is not. */
export function stripeAttemptKey(organizationId: string, chargeKey: string, attempt: number): string {
  return `altrixs:${organizationId}:${chargeKey}:a${attempt}`.slice(0, 255);
}

// ─── Failures ────────────────────────────────────────────────────────────────

export type FailureClass = { status: 'failed' | 'needs_action'; code: string; retryable: boolean; message: string };

const GENERIC_DECLINE = 'The card was declined.';

/**
 * Stripe error / last_payment_error -> charge status. authentication_required (SCA) and a PaymentIntent
 * in requires_action need the patient (portal); declines and expired cards need a new card or a retry.
 * Messages are generic: no Stripe free text is shown to patients.
 */
export function classifyStripeFailure(err: { code?: string | null; decline_code?: string | null; type?: string | null } | null | undefined, piStatus?: string | null): FailureClass {
  const code = (err?.code || '').trim();
  const decline = (err?.decline_code || '').trim();
  if (code === 'authentication_required' || decline === 'authentication_required' || piStatus === 'requires_action') {
    return { status: 'needs_action', code: 'authentication_required', retryable: false, message: 'The card issuer needs the patient to confirm this payment.' };
  }
  if (code === 'expired_card') return { status: 'failed', code, retryable: false, message: 'The card has expired.' };
  if (code === 'card_declined') {
    const soft = ['insufficient_funds', 'try_again_later', 'processing_error', 'issuer_not_available', 'reenter_transaction'].includes(decline);
    return { status: 'failed', code: decline ? `card_declined:${decline}` : 'card_declined', retryable: soft, message: GENERIC_DECLINE };
  }
  if (code === 'incorrect_cvc' || code === 'incorrect_number' || code === 'invalid_expiry_month' || code === 'invalid_expiry_year') {
    return { status: 'failed', code, retryable: false, message: GENERIC_DECLINE };
  }
  if (code === 'processing_error' || err?.type === 'StripeConnectionError' || err?.type === 'StripeAPIError' || err?.type === 'StripeRateLimitError') {
    return { status: 'failed', code: code || 'processing_error', retryable: true, message: 'The payment processor could not complete the charge. It can be retried.' };
  }
  return { status: 'failed', code: code || 'charge_failed', retryable: true, message: 'The charge did not go through.' };
}

// ─── Receipts ────────────────────────────────────────────────────────────────

/** Receipt number from the charge id (stable, not guessable from other receipts). */
export function receiptNumberFor(chargeId: string, succeededAt: Date): string {
  const ymd = succeededAt.toISOString().slice(0, 10).replace(/-/g, '');
  return `R-${ymd}-${chargeId.slice(-8).toUpperCase()}`;
}

/** Charge month (YYYY-MM) from the practice's local date YYYY-MM-DD */
export function chargeMonthOf(practiceYmd: string): string {
  return practiceYmd.slice(0, 7);
}
