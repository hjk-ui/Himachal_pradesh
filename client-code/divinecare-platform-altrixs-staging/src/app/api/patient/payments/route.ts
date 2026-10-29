import { z } from 'zod';
import { patientFail, patientGet, patientOk, patientOptions, patientPost, readPatientJson } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { completeCardSetup, patientConfirmation, startCardSetup } from '@/lib/patientPayments/service';
import { patientPaymentsDeps, patientTurnOffAutopay, portalPaymentsSummary } from '@/lib/patientPayments/server';

export function OPTIONS() {
  return patientOptions();
}

/**
 * GET /api/patient/payments — the active client's saved card (brand, last 4, expiry), whether automatic
 * payments are on, the signed authorization and the charges / receipts. The active client comes from the
 * patient session (a guardian proxy session resolves to the client they act for).
 */
export const GET = patientGet(async ({ req, ctx }) => {
  const summary = await portalPaymentsSummary(ctx.organizationId, ctx.clientId);
  await writeAuditLog({
    action: 'READ',
    actorUserId: ctx.accountId,
    actorRole: 'PATIENT',
    organizationId: ctx.organizationId,
    resourceType: 'PatientCharge',
    patientId: ctx.clientId,
    outcome: 'SUCCESS',
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-web', purpose: 'payments', charges: summary.charges.length },
  });
  return patientOk(summary);
}, ['patient-payments', 60]);

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup_start') }),
  z.object({ action: z.literal('setup_complete'), setupIntentId: z.string().regex(/^seti_[A-Za-z0-9]+$/) }),
  z.object({ action: z.literal('confirm'), chargeId: z.string().min(1).max(128) }),
  z.object({ action: z.literal('turn_off'), removeCard: z.boolean().optional(), confirm: z.literal(true) }),
]);

/** POST /api/patient/payments — save / replace the card (Stripe Elements), confirm a flagged payment, turn automatic payments off. */
export const POST = patientPost(async ({ req, ctx }) => {
  const body = bodySchema.parse(await readPatientJson(req));
  const deps = patientPaymentsDeps();
  const actor = { userId: null, role: 'PATIENT' };
  const base = { organizationId: ctx.organizationId, clientId: ctx.clientId };
  if (body.action === 'setup_start') {
    const r = await startCardSetup(deps, { ...base, via: 'portal', actor });
    if (r.ok === false) return patientFail(r.status === 409 ? 'CONFLICT' : 'UNAVAILABLE', r.error, r.status);
    return patientOk({ clientSecret: r.clientSecret, publishableKey: r.publishableKey, stripeAccount: r.stripeAccount, testMode: r.mode === 'test' });
  }
  if (body.action === 'setup_complete') {
    const r = await completeCardSetup(deps, { ...base, setupIntentId: body.setupIntentId, via: 'portal', actor });
    if (r.ok === false) return patientFail('VALIDATION_ERROR', r.error, r.status);
    return patientOk({ card: { brand: r.card.brand, last4: r.card.last4, expiry: r.card.expiry }, authorizationSent: Boolean(r.packetId) });
  }
  if (body.action === 'confirm') {
    const r = await patientConfirmation(deps, { ...base, chargeId: body.chargeId });
    if (r.ok === false) return patientFail(r.status === 404 ? 'NOT_FOUND' : 'CONFLICT', r.error, r.status);
    return patientOk({ clientSecret: r.clientSecret, paymentMethodId: r.paymentMethodId, publishableKey: r.publishableKey, stripeAccount: r.stripeAccount });
  }
  const r = await patientTurnOffAutopay({ ...base, accountId: ctx.accountId ?? null }, { removeCard: Boolean(body.removeCard) });
  return patientOk({ autopayOn: false, ...r });
}, ['patient-payments-write', 20]);
