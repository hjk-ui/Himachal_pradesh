/**
 * Stripe request parameters for patient payments (pure). NO PHI goes to Stripe (Stripe does not sign a
 * BAA): no names, emails, phones, dates of birth, diagnoses, service / visit names, provider names or
 * specialties. Every request carries only:
 *   - a neutral description ("Patient payment" / "Patient account" / "Patient card setup"),
 *   - metadata with opaque Altrixs ids (account = internal client id, charge id, organization id),
 *   - the practice's statement descriptor suffix (A-Z, 0-9, space).
 * assertNoPhi() checks every request before it is sent (src/lib/patientPayments/stripeGateway.ts).
 */

export const PAYMENT_DESCRIPTION = 'Patient payment';
export const CUSTOMER_DESCRIPTION = 'Patient account';
export const SETUP_DESCRIPTION = 'Patient card setup';
const ALLOWED_DESCRIPTIONS = new Set([PAYMENT_DESCRIPTION, CUSTOMER_DESCRIPTION, SETUP_DESCRIPTION]);

/** Only these metadata keys, with opaque id values. */
export const ALLOWED_METADATA_KEYS = new Set(['altrixs_account', 'altrixs_charge', 'altrixs_org', 'altrixs_capture', 'altrixs_refund']);
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Keys that are never allowed anywhere in a patient payments request. */
const FORBIDDEN_KEYS = new Set(['name', 'email', 'phone', 'address', 'receipt_email', 'shipping', 'statement_descriptor', 'tax_id_data', 'invoice_settings']);

export type StripeParams = Record<string, unknown>;

/**
 * Statement descriptor suffix: A-Z, 0-9 and spaces, at most 10 characters, at least one letter.
 * Anything else (punctuation Stripe refuses, words longer than allowed) is dropped. Blank -> null.
 */
export function sanitizeDescriptorSuffix(raw: string | null | undefined): string | null {
  const s = (raw ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 10).trim();
  return s && /[A-Z]/.test(s) ? s : null;
}

export function buildCustomerParams(input: { organizationId: string; clientId: string }): StripeParams {
  return { description: CUSTOMER_DESCRIPTION, metadata: { altrixs_account: input.clientId, altrixs_org: input.organizationId } };
}

export function buildSetupIntentParams(input: { organizationId: string; clientId: string; customerId: string; via: 'portal' | 'in_office' }): StripeParams {
  return {
    customer: input.customerId,
    usage: 'off_session',
    payment_method_types: ['card'],
    description: SETUP_DESCRIPTION,
    metadata: { altrixs_account: input.clientId, altrixs_org: input.organizationId, altrixs_capture: input.via },
  };
}

/** Off-session, confirm-now PaymentIntent for a saved card (merchant-initiated, stored credential). */
export function buildPaymentIntentParams(input: {
  organizationId: string;
  clientId: string;
  chargeId: string;
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  descriptorSuffix: string | null;
}): StripeParams {
  const suffix = sanitizeDescriptorSuffix(input.descriptorSuffix);
  return {
    amount: Math.trunc(input.amountCents),
    currency: 'usd',
    customer: input.customerId,
    payment_method: input.paymentMethodId,
    payment_method_types: ['card'],
    off_session: true,
    confirm: true,
    description: PAYMENT_DESCRIPTION,
    ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
    metadata: { altrixs_charge: input.chargeId, altrixs_account: input.clientId, altrixs_org: input.organizationId },
  };
}

export function buildRefundParams(input: { paymentIntentId: string; amountCents: number; chargeId: string; refundId: string }): StripeParams {
  return {
    payment_intent: input.paymentIntentId,
    amount: Math.trunc(input.amountCents),
    reason: 'requested_by_customer',
    metadata: { altrixs_charge: input.chargeId, altrixs_refund: input.refundId },
  };
}

/** Request fields whose values are Stripe ids / enums, not free text. */
const ID_FIELDS = new Set(['customer', 'payment_method', 'payment_intent', 'currency', 'usage', 'reason', 'statement_descriptor_suffix', 'cancellation_reason']);

/**
 * Throws when a request could carry PHI: a forbidden key, a description other than the neutral
 * ones, metadata outside the allowlist or with non-id values, or free text in any other string.
 */
export function assertNoPhi(params: StripeParams): void {
  const problems = phiProblems(params);
  if (problems.length) throw new Error(`Refused to send patient data to Stripe: ${problems.join('; ')}`);
}

export function phiProblems(params: StripeParams): string[] {
  const out: string[] = [];
  const walk = (obj: unknown, path: string) => {
    if (obj == null) return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.has(k)) out.push(`${p} is not allowed`);
      else if (k === 'description') {
        if (typeof v !== 'string' || !ALLOWED_DESCRIPTIONS.has(v)) out.push(`${p} must be a neutral description`);
      } else if (k === 'metadata') {
        if (v && typeof v === 'object') {
          for (const [mk, mv] of Object.entries(v as Record<string, unknown>)) {
            if (!ALLOWED_METADATA_KEYS.has(mk)) out.push(`metadata.${mk} is not allowed`);
            else if (typeof mv !== 'string' || !OPAQUE_ID.test(mv)) out.push(`metadata.${mk} must be an id`);
          }
        }
      } else if (k === 'statement_descriptor_suffix') {
        if (typeof v !== 'string' || sanitizeDescriptorSuffix(v) !== v) out.push(`${p} must be A-Z / 0-9 only`);
      } else if (typeof v === 'string') {
        if (!ID_FIELDS.has(k) && !OPAQUE_ID.test(v)) out.push(`${p} looks like free text`);
        else if (ID_FIELDS.has(k) && !/^[A-Za-z0-9_ -]{1,255}$/.test(v)) out.push(`${p} is not an id`);
      } else if (typeof v === 'object') {
        walk(v, p);
      }
    }
  };
  walk(params, '');
  return out;
}
