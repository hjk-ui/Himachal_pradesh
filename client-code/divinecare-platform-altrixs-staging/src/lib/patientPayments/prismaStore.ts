import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { visitContext } from '@/lib/billing/feeSchedule';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { feeFor } from '@/lib/billing/feeScheduleDb';
import { loadLibrary, resolveSendable, createPacket } from '@/lib/consents/library/store';
import {
  CARD_AUTHORIZATION_FORM_KEY,
  CARD_AUTHORIZATION_KEY,
  DEFAULT_SETTINGS,
  copayCents,
  type ChargeKind,
  type ChargeStatus,
  type PatientPaymentSettingsShape,
} from './rules';
import type { CardRecord, ChargeRecord, PatientPaymentsStore, RefundRecord, VisitFacts } from './types';

/**
 * Prisma adapter of PatientPaymentsStore. Every lookup is organization-scoped; tables from
 * 20261021_patient_autopay.sql. A missing table (migration not applied) reads as "turned off".
 */

function code(err: unknown) {
  return typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
}

export function isMissingTable(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return code(err) === 'P2021' || code(err) === 'P2022' || /does not exist/i.test(message);
}

type ChargeRow = Prisma.PatientChargeGetPayload<object>;

export function toCharge(r: ChargeRow): ChargeRecord {
  return {
    id: r.id,
    organizationId: r.organizationId,
    clientId: r.clientId,
    kind: r.kind as ChargeKind,
    status: r.status as ChargeStatus,
    amountCents: r.amountCents,
    idempotencyKey: r.idempotencyKey,
    appointmentId: r.appointmentId,
    claimId: r.claimId,
    eraClaimId: r.eraClaimId,
    chargeMonth: r.chargeMonth,
    reason: r.reason,
    cardOnFileId: r.cardOnFileId,
    cardBrand: r.cardBrand,
    cardLast4: r.cardLast4,
    stripePaymentIntentId: r.stripePaymentIntentId,
    livemode: r.livemode,
    attempts: r.attempts,
    lastAttemptAt: r.lastAttemptAt,
    failureCode: r.failureCode,
    failureMessage: r.failureMessage,
    paymentId: r.paymentId,
    refundedCents: r.refundedCents,
    receiptNumber: r.receiptNumber,
    receiptEmailedAt: r.receiptEmailedAt,
    patientNotifiedAt: r.patientNotifiedAt,
    succeededAt: r.succeededAt,
    createdAt: r.createdAt,
  };
}

function toRefund(r: Prisma.PatientChargeRefundGetPayload<object>): RefundRecord {
  return {
    id: r.id,
    organizationId: r.organizationId,
    chargeId: r.chargeId,
    amountCents: r.amountCents,
    kind: r.kind === 'void' ? 'void' : 'refund',
    status: (['pending', 'succeeded', 'failed', 'canceled'].includes(r.status) ? r.status : 'pending') as RefundRecord['status'],
    stripeRefundId: r.stripeRefundId,
    reason: r.reason,
    paymentId: r.paymentId,
  };
}

export async function loadSettings(organizationId: string): Promise<PatientPaymentSettingsShape> {
  try {
    const row = await prisma.patientPaymentSettings.findUnique({ where: { organizationId } });
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      enabled: row.enabled,
      chargeCopays: row.chargeCopays,
      chargeAfterEra: row.chargeAfterEra,
      chargeSelfPay: row.chargeSelfPay,
      chargeMissedVisitFees: row.chargeMissedVisitFees,
      maxPerChargeCents: row.maxPerChargeCents,
      maxPerMonthCents: row.maxPerMonthCents,
      statementDescriptorSuffix: row.statementDescriptorSuffix,
      receiptSenderName: row.receiptSenderName,
      stripeAccountId: row.stripeAccountId,
    };
  } catch (err) {
    if (isMissingTable(err)) return { ...DEFAULT_SETTINGS };
    throw err;
  }
}

function toCard(c: { id: string; organizationId: string; clientId: string; gatewayCustomerId: string | null; gatewayPaymentMethodId: string | null; cardBrand: string; last4: string; expiry: string; autopayEnabled: boolean; livemode: boolean }): CardRecord {
  return {
    id: c.id,
    organizationId: c.organizationId,
    clientId: c.clientId,
    customerId: /^cus_/.test(c.gatewayCustomerId ?? '') ? c.gatewayCustomerId : null,
    paymentMethodId: /^pm_/.test(c.gatewayPaymentMethodId ?? '') ? c.gatewayPaymentMethodId : null,
    brand: c.cardBrand || null,
    last4: c.last4 || null,
    expiry: c.expiry || null,
    autopayEnabled: c.autopayEnabled,
    livemode: c.livemode,
  };
}

const CARD_SELECT = {
  id: true,
  organizationId: true,
  clientId: true,
  gatewayCustomerId: true,
  gatewayPaymentMethodId: true,
  cardBrand: true,
  last4: true,
  expiry: true,
  autopayEnabled: true,
  livemode: true,
} as const;

/** Self-pay fee: the visit's claim amount, else the appointment type's default CPT priced at self-pay rates. */
async function selfPayFee(organizationId: string, appt: { type: string; isVirtual: boolean; startsAt: Date }, client: { dateOfBirth: Date | null }, claimAmountCents: number | null): Promise<number | null> {
  if (claimAmountCents && claimAmountCents > 0) return claimAmountCents;
  const sched = await prisma.schedulingSettings.findUnique({ where: { organizationId }, select: { servicesJson: true } }).catch(() => null);
  const services = Array.isArray(sched?.servicesJson) ? (sched!.servicesJson as { id?: string; title?: string; defaultCpt?: string }[]) : [];
  const type = appt.type.trim().toLowerCase();
  const svc = services.find((s) => (s.title ?? '').trim().toLowerCase() === type || (s.id ?? '').trim().toLowerCase() === type);
  const cpt = svc?.defaultCpt?.trim();
  if (!cpt) return null;
  const ctx = visitContext({ dateOfBirth: client.dateOfBirth, insurancePayer: null }, { serviceDate: appt.startsAt, telehealth: appt.isVirtual });
  const quote = await feeFor(organizationId, { cpt, selfPay: true, telehealth: ctx.telehealth, child: ctx.child });
  return quote.feeCents > 0 ? quote.feeCents : null;
}

export const prismaPatientPaymentsStore: PatientPaymentsStore = {
  settings: loadSettings,

  async enrollment(organizationId, clientId) {
    const e = await prisma.autopayEnrollment.findFirst({ where: { organizationId, clientId }, select: { active: true, planStatus: true } }).catch(() => null);
    if (!e) return null;
    return { active: e.active && (e.planStatus ?? '').toLowerCase() !== 'ended' };
  },

  async card(organizationId, clientId) {
    const c = await prisma.cardOnFile.findFirst({ where: { organizationId, clientId }, select: CARD_SELECT });
    return c ? toCard(c) : null;
  },

  async authorizationRows(organizationId, clientId) {
    return prisma.consentForm.findMany({
      where: { organizationId, clientId, formKey: CARD_AUTHORIZATION_FORM_KEY },
      select: { id: true, status: true, formKey: true, revokedAt: true, expiresAt: true, signedAt: true, formData: true },
    });
  },

  async payer(organizationId, clientId) {
    const [c, coverages] = await Promise.all([
      prisma.client.findFirst({
        where: clientByIdWhere(clientId, organizationId),
        select: { insuranceType: true, insurancePayer: true, medicaidId: true, insuranceMemberId: true, insuranceEffectiveTo: true },
      }),
      prisma.clientInsuranceCoverage
        .findMany({ where: { organizationId, clientId }, select: { payerName: true, memberId: true, claimFilingCode: true, active: true, rank: true } })
        .catch(() => []),
    ]);
    return {
      insuranceType: c?.insuranceType ?? null,
      insurancePayer: c?.insurancePayer ?? null,
      medicaidId: c?.medicaidId ?? null,
      insuranceMemberId: c?.insuranceMemberId ?? null,
      insuranceEffectiveTo: c?.insuranceEffectiveTo ?? null,
      coverages: coverages.sort((a, b) => a.rank.localeCompare(b.rank)),
    };
  },

  async visit(appointmentId): Promise<VisitFacts | null> {
    const a = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        status: true,
        type: true,
        isVirtual: true,
        startsAt: true,
        client: { select: { organizationId: true, insurancePayer: true, insuranceEffectiveTo: true, dateOfBirth: true, copayAmount: true } },
        claims: { select: { id: true, amountCents: true, status: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!a) return null;
    const organizationId = a.organizationId ?? a.client.organizationId;
    if (!organizationId || (a.client.organizationId && a.client.organizationId !== organizationId)) return null;
    const ctx = visitContext(a.client, { serviceDate: a.startsAt, telehealth: a.isVirtual });
    const claim = a.claims[0] ?? null;
    const [rules, practice] = await Promise.all([
      prisma.clientCopayRule.findMany({ where: { organizationId, clientId: a.clientId }, select: { payerName: true, providerType: true, cptRule: true, amountCents: true } }).catch(() => []),
      prisma.practiceSettings
        .findUnique({ where: { organizationId }, select: { noShowFeeEnabled: true, noShowFeeCents: true, lateCancelFeeEnabled: true, lateCancelFeeCents: true } })
        .catch(() => null),
    ]);
    const missedVisitPolicy =
      a.status === 'NO_SHOW'
        ? { feeEnabled: Boolean(practice?.noShowFeeEnabled), feeCents: practice?.noShowFeeCents ?? null }
        : a.status === 'LATE_CANCEL'
          ? { feeEnabled: Boolean(practice?.lateCancelFeeEnabled), feeCents: practice?.lateCancelFeeCents ?? null }
          : null;
    return {
      appointmentId: a.id,
      organizationId,
      clientId: a.clientId,
      status: a.status,
      selfPay: ctx.selfPay,
      copayCents: ctx.selfPay ? null : copayCents({ copayAmount: a.client.copayAmount, insurancePayer: a.client.insurancePayer, rules }),
      selfPayFeeCents: ctx.selfPay && a.status === 'COMPLETED' ? await selfPayFee(organizationId, a, a.client, claim?.amountCents ?? null) : null,
      claimId: claim?.id ?? null,
      missedVisitPolicy,
      startsAt: a.startsAt,
    };
  },

  async era(eraClaimId) {
    const row = await prisma.eraClaimPayment.findUnique({ where: { id: eraClaimId }, select: { id: true, claimId: true, postingStatus: true } });
    if (!row?.claimId || row.postingStatus !== 'posted') return null;
    const claim = await prisma.claim.findUnique({ where: { id: row.claimId }, select: { id: true, organizationId: true, clientId: true, appointmentId: true, patientResponsibility: true } });
    if (!claim) return null;
    return {
      eraClaimId: row.id,
      organizationId: claim.organizationId,
      clientId: claim.clientId,
      claimId: claim.id,
      appointmentId: claim.appointmentId,
      patientResponsibilityCents: Math.round((claim.patientResponsibility ?? 0) * 100),
    };
  },

  async charges(organizationId, f) {
    const rows = await prisma.patientCharge.findMany({
      where: {
        organizationId,
        clientId: f.clientId,
        ...(f.month ? { chargeMonth: f.month } : {}),
        ...(f.appointmentId ? { appointmentId: f.appointmentId } : {}),
        ...(f.claimId ? { claimId: f.claimId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map(toCharge);
  },

  async chargeByKey(organizationId, key) {
    const r = await prisma.patientCharge.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: key } } });
    return r ? toCharge(r) : null;
  },

  async chargeById(id) {
    const r = await prisma.patientCharge.findUnique({ where: { id } });
    return r ? toCharge(r) : null;
  },

  async chargeByPaymentIntent(paymentIntentId) {
    const r = await prisma.patientCharge.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    return r ? toCharge(r) : null;
  },

  async insertCharge(data) {
    try {
      const r = await prisma.patientCharge.create({ data });
      return { created: true, charge: toCharge(r) };
    } catch (err) {
      if (code(err) !== 'P2002') throw err;
      const r = await prisma.patientCharge.findUnique({ where: { organizationId_idempotencyKey: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey } } });
      if (!r) throw err;
      return { created: false, charge: toCharge(r) };
    }
  },

  async updateCharge(id, patch, onlyFrom) {
    if (onlyFrom?.length) {
      const res = await prisma.patientCharge.updateMany({ where: { id, status: { in: [...onlyFrom] } }, data: patch });
      if (res.count !== 1) return null;
      const r = await prisma.patientCharge.findUnique({ where: { id } });
      return r ? toCharge(r) : null;
    }
    return toCharge(await prisma.patientCharge.update({ where: { id }, data: patch }));
  },

  async postLedgerPayment(input) {
    const prior = await prisma.payment.findFirst({ where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey }, select: { id: true } });
    if (prior) return { paymentId: prior.id, duplicate: true };
    try {
      const p = await prisma.payment.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          claimId: input.claimId,
          amountCents: input.amountCents,
          method: 'CARD',
          paidAt: input.paidAt,
          note: input.note.slice(0, 200),
          idempotencyKey: input.idempotencyKey,
        },
        select: { id: true },
      });
      return { paymentId: p.id, duplicate: false };
    } catch (err) {
      if (code(err) === 'P2002') {
        const again = await prisma.payment.findFirst({ where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey }, select: { id: true } });
        if (again) return { paymentId: again.id, duplicate: true };
      }
      throw err;
    }
  },

  async stripeCustomer(organizationId, clientId, livemode) {
    const r = await prisma.patientStripeCustomer.findUnique({ where: { organizationId_clientId_livemode: { organizationId, clientId, livemode } } });
    return r?.stripeCustomerId ?? null;
  },

  async saveStripeCustomer(organizationId, clientId, livemode, customerId) {
    await prisma.patientStripeCustomer.upsert({
      where: { organizationId_clientId_livemode: { organizationId, clientId, livemode } },
      create: { organizationId, clientId, livemode, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  },

  async saveCard(i) {
    const data = {
      organizationId: i.organizationId,
      gatewayToken: i.paymentMethodId,
      cardBrand: i.brand,
      last4: i.last4,
      expiry: i.expiry,
      billingZip: i.postalCode ?? '',
      autopayEnabled: true,
      gatewayCustomerId: i.customerId,
      gatewayPaymentMethodId: i.paymentMethodId,
      livemode: i.livemode,
      capturedVia: i.via,
      capturedById: i.actorUserId,
      setupIntentId: i.setupIntentId,
      validatedAt: new Date(),
    };
    const card = await prisma.$transaction(async (tx) => {
      const c = await tx.cardOnFile.upsert({ where: { clientId: i.clientId }, create: { clientId: i.clientId, ...data }, update: data, select: CARD_SELECT });
      await tx.autopayEnrollment.upsert({
        where: { clientId: i.clientId },
        create: { organizationId: i.organizationId, clientId: i.clientId, active: true, last4: i.last4, source: 'altrixs', cardLabel: i.brand, cardExpiry: i.expiry },
        update: { active: true, last4: i.last4, cardLabel: i.brand, cardExpiry: i.expiry, endsAt: null, planStatus: null },
      });
      return c;
    });
    return toCard(card);
  },

  async authorizationTemplate(organizationId) {
    const lib = await loadLibrary(organizationId);
    const r = resolveSendable(lib, CARD_AUTHORIZATION_KEY);
    return 'template' in r ? { sendable: true } : { sendable: false, reason: r.reason };
  },

  async sendAuthorization(i) {
    // Staff route / patient route already checked access to the client; the packet is recorded as
    // created by the staff member, or by the patient portal
    const r = await createPacket({ organizationId: i.organizationId, userId: i.actorUserId ?? 'patient-portal', role: 'ADMIN' }, i.clientId, {
      method: i.method,
      keys: [CARD_AUTHORIZATION_KEY],
      prefill: { [CARD_AUTHORIZATION_KEY]: i.prefill },
    });
    return r.ok === true ? { ok: true, packetId: r.packetId } : { ok: false, error: r.error };
  },

  async insertRefund(data) {
    return toRefund(await prisma.patientChargeRefund.create({ data }));
  },

  async updateRefund(id, patch) {
    return toRefund(await prisma.patientChargeRefund.update({ where: { id }, data: patch }));
  },

  async refundByStripeId(stripeRefundId) {
    const r = await prisma.patientChargeRefund.findUnique({ where: { stripeRefundId } });
    return r ? toRefund(r) : null;
  },

  async refundById(id) {
    const r = await prisma.patientChargeRefund.findUnique({ where: { id } });
    return r ? toRefund(r) : null;
  },

  async refunds(chargeId) {
    return (await prisma.patientChargeRefund.findMany({ where: { chargeId } })).map(toRefund);
  },
};
