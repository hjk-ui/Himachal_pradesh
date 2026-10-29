import type { PaymentMethod, Role } from '@prisma/client';
import { toPracticeWallTime } from '@/lib/time/practiceTime';

/**
 * Billing least-privilege rules (pure; no database). Route handlers call these after the proxy
 * gate (canAccessApiPath) and the page rule (canAccessPath):
 *
 * - BILLING_CORE (Admin, Director, Practice Director, Billing): full revenue-cycle work.
 * - Office Manager (2026-10-22 owner: patient-side billing only): no claims queues, A/R, denials, ERAs
 *   or payer settings; may post patient payments (copay, cash, card, check, ACH) with no claim link,
 *   same as Front Desk.
 * - Front Desk: patient payments only (copays at check-in / check-out), never insurance payments,
 *   adjustments or claim-linked payments; sees only patient payments in the ledger.
 * - Licensed clinicians: a draft claim from their OWN signed note; billing marks it READY and owns
 *   CPT changes on an existing claim.
 * - Primary care providers (Physician, Medical NP): charges for their own encounters only.
 */

export const BILLING_CORE_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'] as const satisfies readonly Role[];
type MaybeRole = Role | string | null | undefined;

export function isBillingCore(role: MaybeRole): boolean {
  return Boolean(role && (BILLING_CORE_ROLES as readonly string[]).includes(String(role)));
}

/** Billing queues (claims lists, A/R, ERA review, residential / crisis billing queue): billing core.
 * Office Manager read these until 2026-10-22 (owner: patient-side billing only). */
export function canReadBillingQueue(role: MaybeRole): boolean {
  return isBillingCore(role);
}

// ─── Claims and denials (client-safe: pages hide controls with these) ─────────

/** Note shown where a read-only billing role would otherwise see a claim / denial control. */
export const BILLING_STAFF_ONLY = 'Billing staff only';

/**
 * Claim work: edit / save, submit, resubmit, re-scrub, ERA sync and posting, Waystar retrieval and
 * 276 status requests. Billing core only. Same rule as claims.canMutateClaims.
 */
export function canEditClaims(role: MaybeRole): boolean {
  return isBillingCore(role);
}

/** Denials work queue (list, detail): billing core. */
export function canReadDenials(role: MaybeRole): boolean {
  return canReadBillingQueue(role);
}

/** Denial status changes (appeal filed, won, lost, written off, reopened): billing core only. */
export function canUpdateDenialStatus(role: MaybeRole): boolean {
  return isBillingCore(role);
}

// ─── Payments ────────────────────────────────────────────────────────────────

/** Money from the patient (or guarantor). INSURANCE is payer money; STUB is a dev-only test method. */
export const PATIENT_PAYMENT_METHODS = ['CARD', 'ACH', 'CASH', 'CHECK'] as const satisfies readonly PaymentMethod[];

export function isPatientPaymentMethod(method: string | null | undefined): boolean {
  return Boolean(method && (PATIENT_PAYMENT_METHODS as readonly string[]).includes(method));
}

export type PaymentPostDecision =
  | { ok: true; scope: 'full' | 'patient' }
  | { ok: false; status: 403; reason: string; error: string };

/**
 * Who may post a payment, by method and claim link. BILLING_CORE: any method, any claim.
 * Office Manager and Front Desk: patient methods (card / cash / check / ACH) with no claim link;
 * billing applies them to claims. Everyone else: no.
 */
export function paymentPostDecision(role: MaybeRole, input: { method: string; claimId?: string | null }): PaymentPostDecision {
  if (isBillingCore(role)) return { ok: true, scope: 'full' };
  if (role !== 'OFFICE_MANAGER' && role !== 'FRONT_DESK') {
    return { ok: false, status: 403, reason: 'role_not_permitted', error: 'Forbidden' };
  }
  if (!isPatientPaymentMethod(input.method)) {
    return {
      ok: false,
      status: 403,
      reason: 'non_patient_method',
      error: 'Only billing staff can post insurance payments. Record the patient payment as card, cash, check or ACH.',
    };
  }
  if (input.claimId) {
    return {
      ok: false,
      status: 403,
      reason: 'claim_linked_payment',
      error: 'Record the patient payment without a claim; billing staff apply payments to claims.',
    };
  }
  return { ok: true, scope: 'patient' };
}

/** Office Manager / Front Desk: patient payments only, no adjustments, write-offs or plans. */
export function isPatientPaymentOnlyRole(role: MaybeRole): boolean {
  return role === 'OFFICE_MANAGER' || role === 'FRONT_DESK';
}

export function canPostPatientPayment(role: MaybeRole, method: string, claimId?: string | null): boolean {
  return paymentPostDecision(role, { method, claimId }).ok;
}

/** Methods the Record Payment form offers for this role (empty: no form). */
export function paymentMethodsFor(role: MaybeRole): PaymentMethod[] {
  if (isBillingCore(role)) return [...PATIENT_PAYMENT_METHODS, 'INSURANCE'];
  if (role === 'OFFICE_MANAGER' || role === 'FRONT_DESK') return [...PATIENT_PAYMENT_METHODS];
  return [];
}

/** Front Desk sees patient payments only: patient method and not linked to a claim. */
export function isFrontDeskVisiblePayment(p: { method: string; claimId?: string | null }): boolean {
  return isPatientPaymentMethod(p.method) && !p.claimId;
}

export function frontDeskPaymentFilter<T extends { method: string; claimId?: string | null }>(role: MaybeRole, payments: T[]): T[] {
  return role === 'FRONT_DESK' ? payments.filter(isFrontDeskVisiblePayment) : payments;
}

// ─── Claims from a signed note ───────────────────────────────────────────────

function baseCpt(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase().split('-')[0];
}

export type ClaimFromNoteDecision =
  | {
      ok: true;
      /** markReady to pass to generateClaimFromNote (false for non-billing callers) */
      markReady: boolean;
      /** CPT to pass (undefined: keep the existing claim's code / use the note's) */
      cptCode: string | undefined;
      markReadyDropped: boolean;
    }
  | { ok: false; status: 403; reason: 'not_own_note' | 'cpt_change_requires_billing'; error: string };

/**
 * Billing core: any org note, markReady and CPT as requested. Anyone else (licensed clinicians
 * through Coding / Scribe): only a note they wrote (note.clinicianId), never READY (billing marks
 * it ready), and no CPT change on a claim that already exists.
 */
export function claimFromNoteDecision(input: {
  role: MaybeRole;
  actorUserId: string;
  noteClinicianId: string | null | undefined;
  existingClaimCpt: string | null | undefined;
  requestedCpt?: string | null;
  markReady?: boolean;
}): ClaimFromNoteDecision {
  const requested = input.requestedCpt?.trim() || undefined;
  if (isBillingCore(input.role)) {
    return { ok: true, markReady: input.markReady === true, cptCode: requested, markReadyDropped: false };
  }
  if (!input.noteClinicianId || input.noteClinicianId !== input.actorUserId) {
    return { ok: false, status: 403, reason: 'not_own_note', error: 'You can create a claim only from a note you wrote.' };
  }
  const markReadyDropped = input.markReady === true;
  if (input.existingClaimCpt != null) {
    if (requested && baseCpt(requested) !== baseCpt(input.existingClaimCpt)) {
      return {
        ok: false,
        status: 403,
        reason: 'cpt_change_requires_billing',
        error: 'A claim already exists for this note. Billing changes its CPT; add an addendum with the correct code and notify billing.',
      };
    }
    return { ok: true, markReady: false, cptCode: undefined, markReadyDropped };
  }
  return { ok: true, markReady: false, cptCode: requested, markReadyDropped };
}

export function canCreateClaimFromNote(role: MaybeRole, note: { clinicianId: string | null }, actorUserId: string): boolean {
  return claimFromNoteDecision({ role, actorUserId, noteClinicianId: note.clinicianId, existingClaimCpt: null }).ok;
}

// ─── Primary care charges (/api/medical/billing) ─────────────────────────────

const PRIMARY_CARE_PROVIDERS = ['PHYSICIAN', 'MEDICAL_NP'];

export function isPrimaryCareProvider(role: MaybeRole): boolean {
  return Boolean(role && PRIMARY_CARE_PROVIDERS.includes(String(role).toUpperCase()));
}

/** 'org': the charge worklist; 'own_encounters': a provider's own visits; null: refused. */
export function medicalChargeReadScope(role: MaybeRole): 'org' | 'own_encounters' | null {
  if (canReadBillingQueue(role)) return 'org';
  if (isPrimaryCareProvider(role)) return 'own_encounters';
  return null;
}

/** New charge: billing core for any visit; a primary care provider for their own encounter. */
export function medicalChargeCreateScope(role: MaybeRole): 'any' | 'own_encounter' | null {
  if (isBillingCore(role)) return 'any';
  if (isPrimaryCareProvider(role)) return 'own_encounter';
  return null;
}

/** Status changes (Submitted / Paid / Denied ...): billing core only. */
export function canUpdateMedicalChargeStatus(role: MaybeRole): boolean {
  return isBillingCore(role);
}

/** Practice-wide primary care billing summary and the charge-form patient picker. */
export function canReadMedicalBillingSummary(role: MaybeRole): boolean {
  return canReadBillingQueue(role);
}

/** Patient picker: billing readers, plus primary care providers (scoped to their care team). */
export function canUseMedicalBillingPicker(role: MaybeRole): boolean {
  return canReadBillingQueue(role) || isPrimaryCareProvider(role);
}

export function encounterKey(clientId: string, ymd: string): string {
  return `${clientId}|${ymd}`;
}

/** Charge DOS is stored as UTC midnight of the date of service. */
export function chargeDosYmd(dos: Date | string): string {
  return (typeof dos === 'string' ? new Date(dos) : dos).toISOString().slice(0, 10);
}

export function onOwnEncounter(charge: { clientId: string; dos: Date | string }, encounterKeys: ReadonlySet<string>): boolean {
  return encounterKeys.has(encounterKey(charge.clientId, chargeDosYmd(charge.dos)));
}

/** Provider's visits -> client|practice-date keys (a visit at 9 PM ET is that ET day, not UTC's). */
export function encounterKeysFromVisits(visits: Array<{ clientId: string; visitDate: Date | string }>, timeZone: string): Set<string> {
  return new Set(visits.map((v) => encounterKey(v.clientId, toPracticeWallTime(v.visitDate, timeZone).date)));
}
