/**
 * Ports of the patient payments service (src/lib/patientPayments/service.ts): the database store, the
 * Stripe gateway and notifications. Production adapters: prismaStore.ts, stripeGateway.ts, server.ts.
 * Tests use in-memory fakes (tests/patient-autopay.test.ts), so no network or database is needed.
 */
import type { AuditLogEntry } from '@/lib/audit/writeAuditLog';
import type { PatientPaymentsConfig } from './config';
import type { StripeParams } from './params';
import type { AuthorizationRow, ChargeKind, ChargeStatus, PatientPaymentSettingsShape, PayerFacts } from './rules';

export type CardRecord = {
  id: string;
  organizationId: string;
  clientId: string;
  customerId: string | null;
  paymentMethodId: string | null;
  brand: string | null;
  last4: string | null;
  expiry: string | null;
  autopayEnabled: boolean;
  livemode: boolean;
};

export type ChargeRecord = {
  id: string;
  organizationId: string;
  clientId: string;
  kind: ChargeKind;
  status: ChargeStatus;
  amountCents: number;
  idempotencyKey: string;
  appointmentId: string | null;
  claimId: string | null;
  eraClaimId: string | null;
  chargeMonth: string;
  reason: string | null;
  cardOnFileId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  stripePaymentIntentId: string | null;
  livemode: boolean;
  attempts: number;
  lastAttemptAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  paymentId: string | null;
  refundedCents: number;
  receiptNumber: string | null;
  receiptEmailedAt: Date | null;
  patientNotifiedAt: Date | null;
  succeededAt: Date | null;
  createdAt: Date;
};

export type NewCharge = Omit<
  ChargeRecord,
  'id' | 'attempts' | 'lastAttemptAt' | 'failureCode' | 'failureMessage' | 'paymentId' | 'refundedCents' | 'receiptNumber' | 'receiptEmailedAt' | 'patientNotifiedAt' | 'succeededAt' | 'createdAt' | 'stripePaymentIntentId'
> & { createdById: string | null };

export type ChargePatch = Partial<Omit<ChargeRecord, 'id' | 'organizationId' | 'clientId' | 'idempotencyKey' | 'createdAt'>> & { updatedById?: string | null };

export type RefundRecord = {
  id: string;
  organizationId: string;
  chargeId: string;
  amountCents: number;
  kind: 'refund' | 'void';
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  stripeRefundId: string | null;
  reason: string | null;
  paymentId: string | null;
};

export type VisitFacts = {
  appointmentId: string;
  organizationId: string;
  clientId: string;
  status: string;
  selfPay: boolean;
  copayCents: number | null;
  /** Fee schedule amount for a self-pay visit (the visit's claim, else the appointment type's default CPT) */
  selfPayFeeCents: number | null;
  claimId: string | null;
  /** Practice no-show / late-cancel fee policy for this status (PracticeSettings) */
  missedVisitPolicy: { feeEnabled: boolean; feeCents: number | null } | null;
  /** Visit start; visits before the day the authorization was signed are never charged */
  startsAt?: Date | null;
};

export type EraFacts = {
  eraClaimId: string;
  organizationId: string;
  clientId: string;
  claimId: string;
  appointmentId: string | null;
  /** Patient responsibility on the claim across every posted remittance, in cents */
  patientResponsibilityCents: number;
};

export type SaveCardInput = {
  organizationId: string;
  clientId: string;
  customerId: string;
  paymentMethodId: string;
  brand: string;
  last4: string;
  expiry: string;
  postalCode: string | null;
  livemode: boolean;
  via: 'portal' | 'in_office';
  actorUserId: string | null;
  setupIntentId: string;
};

export interface PatientPaymentsStore {
  settings(organizationId: string): Promise<PatientPaymentSettingsShape>;
  enrollment(organizationId: string, clientId: string): Promise<{ active: boolean } | null>;
  card(organizationId: string, clientId: string): Promise<CardRecord | null>;
  authorizationRows(organizationId: string, clientId: string): Promise<AuthorizationRow[]>;
  payer(organizationId: string, clientId: string): Promise<PayerFacts>;
  visit(appointmentId: string): Promise<VisitFacts | null>;
  era(eraClaimId: string): Promise<EraFacts | null>;
  /** Charges of one client (optionally one month / visit / claim) */
  charges(organizationId: string, filter: { clientId: string; month?: string; appointmentId?: string | null; claimId?: string | null }): Promise<ChargeRecord[]>;
  chargeByKey(organizationId: string, key: string): Promise<ChargeRecord | null>;
  chargeById(id: string): Promise<ChargeRecord | null>;
  chargeByPaymentIntent(paymentIntentId: string): Promise<ChargeRecord | null>;
  /** Insert unless the idempotency key exists (unique index): created=false returns the existing row */
  insertCharge(data: NewCharge): Promise<{ created: boolean; charge: ChargeRecord }>;
  /** Conditional update (status in onlyFrom): null when the row moved on (another worker) */
  updateCharge(id: string, patch: ChargePatch, onlyFrom?: readonly ChargeStatus[]): Promise<ChargeRecord | null>;
  /** Ledger Payment (method CARD, or negative for a refund); idempotent on the key */
  postLedgerPayment(input: { organizationId: string; clientId: string; claimId: string | null; amountCents: number; paidAt: Date; note: string; idempotencyKey: string }): Promise<{ paymentId: string; duplicate: boolean }>;
  stripeCustomer(organizationId: string, clientId: string, livemode: boolean): Promise<string | null>;
  saveStripeCustomer(organizationId: string, clientId: string, livemode: boolean, customerId: string): Promise<void>;
  saveCard(input: SaveCardInput): Promise<CardRecord>;
  /** Card authorization template sendable for this practice (approved + Active) */
  authorizationTemplate(organizationId: string): Promise<{ sendable: true } | { sendable: false; reason: string }>;
  sendAuthorization(input: { organizationId: string; clientId: string; method: 'portal' | 'in_office'; prefill: Record<string, string>; actorUserId: string | null }): Promise<{ ok: true; packetId: string } | { ok: false; error: string }>;
  insertRefund(data: Omit<RefundRecord, 'id' | 'stripeRefundId' | 'paymentId'> & { createdById: string | null }): Promise<RefundRecord>;
  updateRefund(id: string, patch: Partial<Omit<RefundRecord, 'id' | 'organizationId' | 'chargeId'>>): Promise<RefundRecord>;
  refundByStripeId(stripeRefundId: string): Promise<RefundRecord | null>;
  refundById(id: string): Promise<RefundRecord | null>;
  refunds(chargeId: string): Promise<RefundRecord[]>;
}

export type GatewayError = { code: string | null; decline_code: string | null; type: string | null };

export type GatewayPaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number | null;
  livemode: boolean;
  client_secret?: string | null;
  payment_method?: string | null;
  last_payment_error?: GatewayError | null;
  metadata?: Record<string, string> | null;
};

export type GatewayRefund = { id: string; status: string | null; amount: number; payment_intent: string | null; metadata?: Record<string, string> | null };

export interface PatientPaymentsGateway {
  createCustomer(params: StripeParams, opts: { idempotencyKey: string }): Promise<{ id: string }>;
  createSetupIntent(params: StripeParams): Promise<{ id: string; client_secret: string | null; status: string }>;
  retrieveSetupIntent(id: string): Promise<{ id: string; status: string; customer: string | null; payment_method: string | null; usage: string | null; metadata: Record<string, string> | null }>;
  retrievePaymentMethod(id: string): Promise<{ id: string; customer: string | null; card: { brand: string; last4: string; exp_month: number; exp_year: number } | null; postalCode: string | null }>;
  detachPaymentMethod(id: string): Promise<void>;
  /** Never throws for a card error: returns the error and the PaymentIntent Stripe left behind */
  createPaymentIntent(params: StripeParams, opts: { idempotencyKey: string }): Promise<{ ok: true; paymentIntent: GatewayPaymentIntent } | { ok: false; error: GatewayError; paymentIntent: GatewayPaymentIntent | null }>;
  retrievePaymentIntent(id: string): Promise<GatewayPaymentIntent>;
  cancelPaymentIntent(id: string): Promise<GatewayPaymentIntent>;
  createRefund(params: StripeParams, opts: { idempotencyKey: string }): Promise<GatewayRefund>;
}

export type PatientPaymentsNotifier = {
  /** "There's an update about your account in the portal" (SMS through the consent gate + email); no PHI */
  accountUpdate(organizationId: string, clientId: string): Promise<void>;
  /** Emailed receipt (no PHI); true when sent */
  receipt(charge: ChargeRecord, settings: PatientPaymentSettingsShape): Promise<boolean>;
  /** Billing review needed (held over a cap); no PHI in the message */
  billingReview(organizationId: string): Promise<void>;
};

export type ServiceDeps = {
  store: PatientPaymentsStore;
  config: (organizationId: string) => PatientPaymentsConfig;
  gateway: (config: Extract<PatientPaymentsConfig, { ok: true }>, settings: PatientPaymentSettingsShape) => PatientPaymentsGateway;
  notify: PatientPaymentsNotifier;
  audit: (entry: AuditLogEntry) => Promise<void>;
  now: () => Date;
  /** Practice-local date YYYY-MM-DD */
  practiceToday: (organizationId: string) => Promise<string>;
};

export type Actor = { userId: string | null; role: string | null };
