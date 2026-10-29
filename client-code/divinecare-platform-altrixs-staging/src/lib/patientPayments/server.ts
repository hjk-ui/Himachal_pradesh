import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { sendEmail } from '@/lib/email/smtp';
import { sendPatientSms } from '@/lib/sms/patientSms';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { formatPracticeDate, practiceToday } from '@/lib/time/practiceTime';
import { revokeConsent } from '@/lib/consents/library/store2';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { patientPaymentsConfig, patientPaymentsEnvReport } from './config';
import { isMissingTable, loadSettings, prismaPatientPaymentsStore, toCharge } from './prismaStore';
import {
  AUTHORIZATION_VALUE,
  CARD_AUTHORIZATION_FORM_KEY,
  CHARGE_KIND_LABEL,
  CHARGE_STATUS_LABEL,
  REASON_TEXT,
  currentAuthorization,
  type ChargeKind,
  type ChargeStatus,
  type PatientPaymentSettingsShape,
} from './rules';
import { sanitizeDescriptorSuffix } from './params';
import { ACCOUNT_UPDATE_EMAIL, BILLING_REVIEW_EMAIL, RECEIPT_EMAIL_SUBJECT, accountUpdateSms, receiptEmailText, senderLine } from './messages';
import { chargeAfterEra, chargeForVisit, type ChargeOutcome } from './service';
import { stripePatientGateway } from './stripeGateway';
import type { SweepFinder } from './sweep';
import { NOT_IMPORTED_HISTORY } from '@/lib/appointments/importedHistory';
import type { Actor, ChargeRecord, PatientPaymentsNotifier, ServiceDeps } from './types';

function sender(settings: PatientPaymentSettingsShape) {
  return senderLine(settings.receiptSenderName);
}

async function clientContact(organizationId: string, clientId: string) {
  return prisma.client.findFirst({ where: clientByIdWhere(clientId, organizationId), select: { email: true, emailOptOutAt: true } }).catch(() => null);
}

export const patientPaymentsNotifier: PatientPaymentsNotifier = {
  async accountUpdate(organizationId, clientId) {
    const settings = await loadSettings(organizationId);
    await sendPatientSms({ clientId, organizationId, purpose: 'portal_notice', build: ({ sender: s }) => accountUpdateSms(s), actor: { role: 'system' } }).catch(() => null);
    const c = await clientContact(organizationId, clientId);
    if (c?.email && !c.emailOptOutAt) {
      await sendEmail({ to: c.email, subject: ACCOUNT_UPDATE_EMAIL.subject, text: ACCOUNT_UPDATE_EMAIL.text(sender(settings)), context: 'patient-account-update' }).catch(() => null);
    }
  },
  async receipt(charge, settings) {
    const c = await clientContact(charge.organizationId, charge.clientId);
    if (!c?.email || c.emailOptOutAt || !charge.receiptNumber) return false;
    const tz = await getPracticeTimeZone(charge.organizationId);
    const text = receiptEmailText({
      from: sender(settings),
      amountCents: charge.amountCents,
      cardBrand: charge.cardBrand,
      cardLast4: charge.cardLast4,
      paidOn: formatPracticeDate(charge.succeededAt ?? new Date(), tz, { month: 'long', day: 'numeric', year: 'numeric' }),
      receiptNumber: charge.receiptNumber,
    });
    try {
      const r = await sendEmail({ to: c.email, subject: RECEIPT_EMAIL_SUBJECT, text, context: 'patient-payment-receipt' });
      return r.mode !== 'console';
    } catch {
      return false;
    }
  },
  async billingReview(organizationId) {
    const p = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { billingContactEmail: true } }).catch(() => null);
    if (!p?.billingContactEmail) return;
    await sendEmail({
      to: p.billingContactEmail,
      subject: BILLING_REVIEW_EMAIL.subject,
      text: BILLING_REVIEW_EMAIL.text,
      context: 'patient-autopay-review',
    }).catch(() => null);
  },
};

export function patientPaymentsDeps(): ServiceDeps {
  return {
    store: prismaPatientPaymentsStore,
    config: (organizationId) => patientPaymentsConfig(process.env, organizationId),
    gateway: (config, settings) => stripePatientGateway(config, settings),
    notify: patientPaymentsNotifier,
    audit: (entry) => writeAuditLog(entry),
    now: () => new Date(),
    practiceToday: async (organizationId) => practiceToday(await getPracticeTimeZone(organizationId)),
  };
}

/** Visit status hook (appointment PATCH, after the response). Never throws. */
export async function runAutopayForVisit(appointmentId: string, actor?: Actor): Promise<ChargeOutcome | null> {
  try {
    return await chargeForVisit(patientPaymentsDeps(), appointmentId, actor);
  } catch (err) {
    if (!isMissingTable(err)) console.error('[patient autopay] visit', appointmentId, err instanceof Error ? err.message : err);
    return null;
  }
}

/** ERA posting hook (after an 835 claim payment is posted). Never throws. */
export async function runAutopayAfterEra(eraClaimId: string): Promise<ChargeOutcome | null> {
  try {
    return await chargeAfterEra(patientPaymentsDeps(), eraClaimId);
  } catch (err) {
    if (!isMissingTable(err)) console.error('[patient autopay] era', eraClaimId, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

export { canEditPatientPaymentSettings } from './access';

export async function savePatientPaymentSettings(organizationId: string, input: Partial<PatientPaymentSettingsShape>, actor: { userId: string; role: string }) {
  const before = await loadSettings(organizationId);
  const data = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.chargeCopays !== undefined ? { chargeCopays: input.chargeCopays } : {}),
    ...(input.chargeAfterEra !== undefined ? { chargeAfterEra: input.chargeAfterEra } : {}),
    ...(input.chargeSelfPay !== undefined ? { chargeSelfPay: input.chargeSelfPay } : {}),
    ...(input.chargeMissedVisitFees !== undefined ? { chargeMissedVisitFees: input.chargeMissedVisitFees } : {}),
    ...(input.maxPerChargeCents !== undefined ? { maxPerChargeCents: input.maxPerChargeCents } : {}),
    ...(input.maxPerMonthCents !== undefined ? { maxPerMonthCents: input.maxPerMonthCents } : {}),
    ...(input.statementDescriptorSuffix !== undefined ? { statementDescriptorSuffix: sanitizeDescriptorSuffix(input.statementDescriptorSuffix) } : {}),
    ...(input.receiptSenderName !== undefined ? { receiptSenderName: input.receiptSenderName?.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60) || null } : {}),
    ...(input.stripeAccountId !== undefined ? { stripeAccountId: input.stripeAccountId?.trim() || null } : {}),
    updatedById: actor.userId,
  };
  await prisma.patientPaymentSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  const after = await loadSettings(organizationId);
  const changed = (Object.keys(after) as (keyof PatientPaymentSettingsShape)[]).filter((k) => before[k] !== after[k]);
  await writeAuditLog({
    action: 'patient_payments_settings_updated',
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId,
    resourceType: 'PatientPaymentSettings',
    resourceId: organizationId,
    metadata: { changed, enabled: after.enabled, masterSwitch: before.enabled !== after.enabled ? (after.enabled ? 'on' : 'off') : null },
  });
  return after;
}

export async function patientPaymentsStatus(organizationId: string) {
  const settings = await loadSettings(organizationId);
  const config = patientPaymentsConfig(process.env, organizationId);
  const template = await prismaPatientPaymentsStore.authorizationTemplate(organizationId).catch(() => ({ sendable: false as const, reason: 'Consent library unavailable' }));
  return {
    settings,
    configured: config.ok,
    mode: config.ok ? config.mode : null,
    configProblem: config.ok === false ? config.message : null,
    webhookConfigured: config.ok ? Boolean(config.webhookSecret) : false,
    env: patientPaymentsEnvReport(),
    authorizationTemplateReady: template.sendable,
    authorizationTemplateReason: template.sendable === false ? template.reason : null,
  };
}

// ─── Staff list ──────────────────────────────────────────────────────────────

export type ChargeListItem = {
  id: string;
  clientId: string;
  clientName: string;
  mrn: string | null;
  kind: ChargeKind;
  kindLabel: string;
  status: ChargeStatus;
  statusLabel: string;
  amountCents: number;
  refundedCents: number;
  reason: string | null;
  reasonText: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  card: string | null;
  livemode: boolean;
  attempts: number;
  receiptNumber: string | null;
  appointmentId: string | null;
  claimId: string | null;
  createdAt: string;
  succeededAt: string | null;
};

const ATTENTION: ChargeStatus[] = ['failed', 'needs_action', 'held'];

export async function listPatientCharges(organizationId: string, clientWhere: Prisma.ClientWhereInput, filter: { view: 'attention' | 'open' | 'all'; clientId?: string | null }) {
  try {
    const allowed = await prisma.client.findMany({ where: { AND: [clientWhere, ...(filter.clientId ? [{ id: filter.clientId }] : [])] }, select: { id: true, name: true, mrn: true }, take: 5000 });
    const byId = new Map(allowed.map((c) => [c.id, c]));
    const rows = await prisma.patientCharge.findMany({
      where: {
        organizationId,
        clientId: { in: [...byId.keys()] },
        ...(filter.view === 'attention' ? { status: { in: ATTENTION } } : filter.view === 'open' ? { status: { in: [...ATTENTION, 'pending', 'processing', 'skipped'] } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const items: ChargeListItem[] = rows.map((r) => {
      const c = toCharge(r);
      const client = byId.get(c.clientId);
      const reasonText = c.reason && c.reason in REASON_TEXT ? REASON_TEXT[c.reason as keyof typeof REASON_TEXT] : c.reason === 'voided' ? 'Voided by billing' : null;
      return {
        id: c.id,
        clientId: c.clientId,
        clientName: client?.name ?? 'Client',
        mrn: client?.mrn ?? null,
        kind: c.kind,
        kindLabel: CHARGE_KIND_LABEL[c.kind] ?? c.kind,
        status: c.status,
        statusLabel: CHARGE_STATUS_LABEL[c.status] ?? c.status,
        amountCents: c.amountCents,
        refundedCents: c.refundedCents,
        reason: c.reason,
        reasonText,
        failureCode: c.failureCode,
        failureMessage: c.failureMessage,
        card: c.cardLast4 ? `${c.cardBrand ?? 'Card'} ending ${c.cardLast4}` : null,
        livemode: c.livemode,
        attempts: c.attempts,
        receiptNumber: c.receiptNumber,
        appointmentId: c.appointmentId,
        claimId: c.claimId,
        createdAt: c.createdAt.toISOString(),
        succeededAt: c.succeededAt?.toISOString() ?? null,
      };
    });
    const counts = await prisma.patientCharge.groupBy({ by: ['status'], where: { organizationId, clientId: { in: [...byId.keys()] } }, _count: { _all: true } });
    return { schemaReady: true, charges: items, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
  } catch (err) {
    if (isMissingTable(err)) return { schemaReady: false, charges: [] as ChargeListItem[], counts: {} as Record<string, number> };
    throw err;
  }
}

// ─── Patient portal ──────────────────────────────────────────────────────────

const AUTH_LABEL: Record<string, string> = {
  copay: 'Copays after each visit',
  patient_responsibility: 'Copays, coinsurance and deductibles after insurance',
  self_pay: 'Self-pay visit fees',
  missed_visit: 'Missed-appointment fees',
  payment_plan: 'Payment-plan installments',
};

export async function portalPaymentsSummary(organizationId: string, clientId: string) {
  const status = await patientPaymentsStatus(organizationId);
  const now = new Date();
  const [card, enrollment, authRows, pendingAuth, charges] = await Promise.all([
    prismaPatientPaymentsStore.card(organizationId, clientId).catch(() => null),
    prismaPatientPaymentsStore.enrollment(organizationId, clientId).catch(() => null),
    prismaPatientPaymentsStore.authorizationRows(organizationId, clientId).catch(() => []),
    prisma.consentForm.count({ where: { organizationId, clientId, formKey: CARD_AUTHORIZATION_FORM_KEY, status: 'PENDING' } }).catch(() => 0),
    prisma.patientCharge
      .findMany({ where: { organizationId, clientId, status: { notIn: ['skipped', 'held'] } }, orderBy: { createdAt: 'desc' }, take: 50 })
      .catch(() => []),
  ]);
  const auth = currentAuthorization(authRows, now);
  return {
    available: status.settings.enabled && status.configured,
    authorizationTemplateReady: status.authorizationTemplateReady,
    testMode: status.mode === 'test',
    card: card && card.paymentMethodId ? { brand: card.brand, last4: card.last4, expiry: card.expiry } : null,
    autopayOn: Boolean(enrollment?.active && card?.autopayEnabled && auth),
    authorization: auth
      ? { signedAt: auth.signedAt?.toISOString() ?? null, covers: auth.chargeTypes.map((t) => AUTH_LABEL[t] ?? t), consentFormId: auth.consentFormId }
      : null,
    authorizationToSign: pendingAuth > 0,
    charges: charges.map((r) => {
      const c = toCharge(r);
      return {
        id: c.id,
        kind: CHARGE_KIND_LABEL[c.kind] ?? 'Payment',
        amountCents: c.amountCents,
        refundedCents: c.refundedCents,
        status: c.status,
        statusLabel: CHARGE_STATUS_LABEL[c.status] ?? c.status,
        needsAction: c.status === 'needs_action',
        receiptNumber: c.receiptNumber,
        card: c.cardLast4 ? `${c.cardBrand ?? 'Card'} ending ${c.cardLast4}` : null,
        date: (c.succeededAt ?? c.createdAt).toISOString(),
      };
    }),
  };
}

/**
 * The patient turns automatic payments off in the portal: every active Card-on-File Authorization is
 * revoked in writing through the consent library (its effect turns autopay off), and autopay is set off
 * on the card and enrollment even when no authorization was signed yet.
 */
export async function patientTurnOffAutopay(ctx: { organizationId: string; clientId: string; accountId: string | null }, opts: { removeCard: boolean }) {
  const tz = await getPracticeTimeZone(ctx.organizationId);
  const rows = await prisma.consentForm.findMany({
    where: { organizationId: ctx.organizationId, clientId: ctx.clientId, formKey: CARD_AUTHORIZATION_FORM_KEY, status: 'SIGNED', revokedAt: null },
    select: { id: true },
  });
  const revoked: string[] = [];
  for (const r of rows) {
    const res = await revokeConsent({ organizationId: ctx.organizationId, userId: null, role: 'PATIENT', clientId: ctx.clientId }, r.id, {
      receivedOn: practiceToday(tz),
      method: 'written',
      receivedVia: 'portal',
      note: 'Turned off automatic payments in the patient portal',
    });
    if (res.ok === true) revoked.push(r.id);
  }
  await prisma.cardOnFile.updateMany({ where: { organizationId: ctx.organizationId, clientId: ctx.clientId }, data: { autopayEnabled: false } });
  await prisma.autopayEnrollment.updateMany({ where: { organizationId: ctx.organizationId, clientId: ctx.clientId, active: true }, data: { active: false } });
  let removed = false;
  if (opts.removeCard) removed = await removeSavedCard(ctx.organizationId, ctx.clientId);
  await writeAuditLog({
    action: 'patient_autopay_turned_off',
    actorUserId: ctx.accountId,
    actorRole: 'PATIENT',
    organizationId: ctx.organizationId,
    resourceType: 'autopayEnrollment',
    patientId: ctx.clientId,
    metadata: { revokedAuthorizations: revoked.length, cardRemoved: removed, via: 'portal' },
  });
  return { revoked: revoked.length, cardRemoved: removed };
}

/** Detach the saved card in Stripe (best effort) and delete it from Altrixs; autopay off. */
export async function removeSavedCard(organizationId: string, clientId: string): Promise<boolean> {
  const card = await prismaPatientPaymentsStore.card(organizationId, clientId);
  if (!card) return false;
  const config = patientPaymentsConfig(process.env, organizationId);
  if (config.ok && card.paymentMethodId && card.livemode === config.livemode) {
    const settings = await loadSettings(organizationId);
    await stripePatientGateway(config, settings).detachPaymentMethod(card.paymentMethodId).catch(() => {});
  }
  await prisma.cardOnFile.deleteMany({ where: { organizationId, clientId } });
  await prisma.autopayEnrollment.updateMany({ where: { organizationId, clientId }, data: { active: false } });
  return true;
}

export function authorizationCoversLabel(kind: ChargeKind) {
  return AUTH_LABEL[AUTHORIZATION_VALUE[kind]];
}

export type { ChargeRecord };

// ─── Nightly sweep finder ────────────────────────────────────────────────────

/**
 * Sweep candidates: visits (completed / no-show / late cancel, started and updated within the window)
 * and posted ERA claim payments with patient responsibility, only for clients with an active AutoPay
 * enrollment and a saved card, and only those with no PatientCharge row for their key yet.
 */
export const prismaSweepFinder: SweepFinder = {
  async visits(organizationId, since) {
    const enrolled = await enrolledClientIds(organizationId);
    if (!enrolled.length) return [];
    const appts = await prisma.appointment.findMany({
      // Imported Valant history is never charged here (its copays were handled in Valant)
      where: { organizationId, clientId: { in: enrolled }, status: { in: ['COMPLETED', 'NO_SHOW', 'LATE_CANCEL'] }, startsAt: { gte: since }, updatedAt: { gte: since }, ...NOT_IMPORTED_HISTORY },
      select: { id: true },
      take: 5000,
    });
    if (!appts.length) return [];
    const done = await prisma.patientCharge.findMany({ where: { organizationId, appointmentId: { in: appts.map((a) => a.id) }, idempotencyKey: { startsWith: 'visit:' } }, select: { appointmentId: true } });
    const seen = new Set(done.map((d) => d.appointmentId));
    return appts.map((a) => a.id).filter((id) => !seen.has(id));
  },
  async eras(organizationId, since) {
    const enrolled = await enrolledClientIds(organizationId);
    if (!enrolled.length) return [];
    const rows = await prisma.eraClaimPayment.findMany({
      where: { organizationId, postingStatus: 'posted', postedAt: { gte: since }, patientResponsibility: { gt: 0 }, claimId: { not: null } },
      select: { id: true, claimId: true },
      take: 5000,
    });
    if (!rows.length) return [];
    const claims = await prisma.claim.findMany({ where: { id: { in: rows.map((r) => r.claimId!) }, clientId: { in: enrolled } }, select: { id: true } });
    const ok = new Set(claims.map((c) => c.id));
    const keys = rows.filter((r) => ok.has(r.claimId!)).map((r) => `era:${r.id}:coinsurance`);
    const done = await prisma.patientCharge.findMany({ where: { organizationId, idempotencyKey: { in: keys } }, select: { idempotencyKey: true } });
    const seen = new Set(done.map((d) => d.idempotencyKey));
    return rows.filter((r) => ok.has(r.claimId!) && !seen.has(`era:${r.id}:coinsurance`)).map((r) => r.id);
  },
};

async function enrolledClientIds(organizationId: string): Promise<string[]> {
  const rows = await prisma.autopayEnrollment.findMany({
    where: { organizationId, active: true, client: { cardOnFile: { isNot: null } } },
    select: { clientId: true },
  });
  return rows.map((r) => r.clientId);
}
