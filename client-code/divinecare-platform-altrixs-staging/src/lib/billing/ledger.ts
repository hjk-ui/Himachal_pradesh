import type { ClaimDenialStatus, PaymentMethod, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { stripeConfigured } from '@/lib/stripe/config';
import { patientBalances } from '@/lib/billing/patientLedger';
import { canReadDenials, canUpdateDenialStatus } from '@/lib/billing/billingAccess';

export const DENIAL_STATUSES = ['OPEN', 'APPEALED', 'WON', 'LOST'] as const satisfies readonly ClaimDenialStatus[];
export const PAYMENT_METHODS = [
  'CARD',
  'ACH',
  'CASH',
  'CHECK',
  'INSURANCE',
  'STUB',
] as const satisfies readonly PaymentMethod[];

/** Ledger changes beyond a patient payment (adjustments / write-offs / reversals, bulk insurance
 * posting, payment plans, stored-card charges): billing roles only. Office Manager and Front Desk
 * post patient payments through paymentPostDecision (billingAccess.ts), never through this gate. */
const BILLING_CORE: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
/** Patient balances / ledger history: billing, front office (Front Desk and Office Manager: copays /
 * patient payments, kept 2026-10-22) and leadership. Therapists
 * removed (no clinician role reads the ledger; the chart billing card and Payments page already hid it). */
const LEDGER_READ: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'FRONT_DESK', 'OFFICE_MANAGER'];

export function canReadLedger(role: Role | undefined | null) {
  return Boolean(role && LEDGER_READ.includes(role));
}

export function canMutateLedger(role: Role | undefined | null) {
  return Boolean(role && BILLING_CORE.includes(role));
}

/** Denials queue read: billing core (Office Manager removed 2026-10-22). */
export function canAccessDenials(role: Role | undefined | null) {
  return canReadDenials(role);
}

/** Denial status changes: billing core only. */
export { canUpdateDenialStatus };

function isMissingTable(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

export type LedgerActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export type DenialListItem = {
  id: string;
  claimId: string;
  clientId: string;
  clientName: string;
  cptCode: string;
  payer: string | null;
  amountCents: number | null;
  reasonCode: string;
  reasonText: string;
  status: ClaimDenialStatus;
  claimStatus: string;
  createdAt: string;
};

export type PaymentListItem = {
  id: string;
  clientId: string;
  clientName: string;
  claimId: string | null;
  amountCents: number;
  method: PaymentMethod;
  paidAt: string;
  note: string | null;
  stub: boolean;
};

export type AutopayListItem = {
  clientId: string;
  clientName: string;
  active: boolean;
  last4: string | null;
  enrollmentId: string | null;
  /** True once a card has been captured in Altrixs (imported plans carry only the last 4) */
  hasCardOnFile: boolean;
  /** Ledger balance from patientBalance() (> 0 owes, < 0 credit); "Balance or $X" plans charge the lower */
  balanceCents: number | null;
  plan: AutopayPlanInfo | null;
};

export type AutopayPlanInfo = {
  source: string | null;
  planStatus: string | null;
  statusFlag: string | null;
  amountCents: number | null;
  upToBalance: boolean;
  amountLabel: string | null;
  recurrence: string | null;
  nextChargeAt: string | null;
  endsAt: string | null;
  cardLabel: string | null;
  cardExpiry: string | null;
  sourceBalanceCents: number | null;
  sourceAsOf: string | null;
};

const autopaySelect = {
  id: true,
  active: true,
  last4: true,
  source: true,
  planStatus: true,
  statusFlag: true,
  amountCents: true,
  upToBalance: true,
  amountLabel: true,
  recurrence: true,
  nextChargeAt: true,
  endsAt: true,
  cardLabel: true,
  cardExpiry: true,
  sourceBalanceCents: true,
  sourceAsOf: true,
} as const;

type AutopayRow = Prisma.AutopayEnrollmentGetPayload<{ select: typeof autopaySelect }>;

function toAutopayItem(
  client: { id: string; name: string },
  e: AutopayRow | null | undefined,
  hasCardOnFile: boolean,
  balanceCents: number | null = null
): AutopayListItem {
  return {
    clientId: client.id,
    clientName: client.name,
    active: e?.active ?? false,
    last4: e?.last4 ?? null,
    enrollmentId: e?.id ?? null,
    hasCardOnFile,
    balanceCents,
    plan: e?.source
      ? {
          source: e.source,
          planStatus: e.planStatus,
          statusFlag: e.statusFlag,
          amountCents: e.amountCents,
          upToBalance: e.upToBalance,
          amountLabel: e.amountLabel,
          recurrence: e.recurrence,
          nextChargeAt: e.nextChargeAt?.toISOString() ?? null,
          endsAt: e.endsAt?.toISOString() ?? null,
          cardLabel: e.cardLabel,
          cardExpiry: e.cardExpiry,
          sourceBalanceCents: e.sourceBalanceCents,
          sourceAsOf: e.sourceAsOf?.toISOString() ?? null,
        }
      : null,
  };
}

export async function listDenials(actor: LedgerActor) {
  try {
    const rows = await prisma.claimDenial.findMany({
      where: {
        organizationId: actor.organizationId,
        claim: { client: clientAccessWhere(actor) },
      },
      include: {
        claim: {
          select: {
            id: true,
            clientId: true,
            cptCode: true,
            payer: true,
            amountCents: true,
            status: true,
            client: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      schemaReady: true,
      denials: rows.map(
        (row): DenialListItem => ({
          id: row.id,
          claimId: row.claimId,
          clientId: row.claim.clientId,
          clientName: row.claim.client.name,
          cptCode: row.claim.cptCode,
          payer: row.claim.payer,
          amountCents: row.claim.amountCents,
          reasonCode: row.reasonCode,
          reasonText: row.reasonText,
          status: row.status,
          claimStatus: row.claim.status,
          createdAt: row.createdAt.toISOString(),
        })
      ),
    };
  } catch (err) {
    if (isMissingTable(err)) return { schemaReady: false, denials: [] as DenialListItem[] };
    throw err;
  }
}

const DENIAL_NEXT: Record<ClaimDenialStatus, ClaimDenialStatus[]> = {
  OPEN: ['APPEALED', 'LOST'],
  APPEALED: ['WON', 'LOST', 'OPEN'],
  WON: [],
  LOST: ['APPEALED'],
};

export async function updateDenialStatus(actor: LedgerActor, id: string, status: ClaimDenialStatus) {
  const existing = await prisma.claimDenial.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      claim: { client: clientAccessWhere(actor) },
    },
  });
  if (!existing) {
    return { ok: false as const, error: 'Denial not found', status: 404 as const };
  }
  const allowed = DENIAL_NEXT[existing.status] || [];
  if (!allowed.includes(status)) {
    return {
      ok: false as const,
      error: `Cannot move denial from ${existing.status} to ${status}`,
      status: 400 as const,
    };
  }
  await prisma.claimDenial.update({ where: { id: existing.id }, data: { status } });
  const listed = await listDenials(actor);
  const denial = listed.denials.find((d) => d.id === existing.id);
  if (!denial) {
    return { ok: false as const, error: 'Denial not found after update', status: 404 as const };
  }
  return { ok: true as const, denial };
}

export async function listPayments(actor: LedgerActor) {
  try {
    const rows = await prisma.payment.findMany({
      where: {
        organizationId: actor.organizationId,
        client: clientAccessWhere(actor),
      },
      include: { client: { select: { name: true } } },
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
    return {
      schemaReady: true,
      payments: rows.map(
        (row): PaymentListItem => ({
          id: row.id,
          clientId: row.clientId,
          clientName: row.client.name,
          claimId: row.claimId,
          amountCents: row.amountCents,
          method: row.method,
          paidAt: row.paidAt.toISOString(),
          note: row.note,
          stub: row.method === 'STUB',
        })
      ),
    };
  } catch (err) {
    if (isMissingTable(err)) return { schemaReady: false, payments: [] as PaymentListItem[] };
    throw err;
  }
}

export async function createPayment(
  actor: LedgerActor,
  input: {
    clientId: string;
    claimId?: string | null;
    amountCents: number;
    method: PaymentMethod;
    note?: string | null;
    paidAt?: string | null;
    /** One per form submission: a repeat (double click, retry) returns the first payment */
    idempotencyKey?: string | null;
  }
) {
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 100) || null;
  if (idempotencyKey) {
    const prior = await prisma.payment.findFirst({
      where: { organizationId: actor.organizationId, idempotencyKey },
      include: { client: { select: { name: true } } },
    });
    if (prior) return { ok: true as const, duplicate: true as const, payment: paymentItem(prior) };
  }
  // A STUB payment lowers the balance with no money moved: local development only (stubChargesAllowed)
  if (input.method === 'STUB' && !stubChargesAllowed()) {
    return { ok: false as const, error: STUB_CHARGE_BLOCKED, status: 403 as const };
  }
  const amountCents = Math.trunc(input.amountCents);
  if (amountCents <= 0) {
    return { ok: false as const, error: 'Amount must be greater than zero', status: 400 as const };
  }

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgFilter(actor.organizationId) },
    select: { id: true, name: true },
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 as const };
  }

  let claimId: string | null = input.claimId?.trim() || null;
  if (claimId) {
    const claim = await prisma.claim.findFirst({
      where: {
        id: claimId,
        organizationId: actor.organizationId,
        clientId: client.id,
      },
      select: { id: true },
    });
    if (!claim) {
      return { ok: false as const, error: 'Claim not found for this client', status: 404 as const };
    }
    claimId = claim.id;
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return { ok: false as const, error: 'Invalid paid date', status: 400 as const };
  }

  let row;
  try {
    row = await prisma.payment.create({
      data: {
        organizationId: actor.organizationId,
        clientId: client.id,
        claimId,
        amountCents,
        method: input.method,
        paidAt,
        note: input.note?.trim() || null,
        idempotencyKey,
      },
      include: { client: { select: { name: true } } },
    });
  } catch (err) {
    // Two concurrent submissions with the same key: the unique index lets one through
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'P2002' && idempotencyKey) {
      const prior = await prisma.payment.findFirst({ where: { organizationId: actor.organizationId, idempotencyKey }, include: { client: { select: { name: true } } } });
      if (prior) return { ok: true as const, duplicate: true as const, payment: paymentItem(prior) };
    }
    throw err;
  }

  return { ok: true as const, duplicate: false as const, payment: paymentItem(row) };
}

function paymentItem(row: {
  id: string;
  clientId: string;
  claimId: string | null;
  amountCents: number;
  method: PaymentMethod;
  paidAt: Date;
  note: string | null;
  client: { name: string };
}): PaymentListItem {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    claimId: row.claimId,
    amountCents: row.amountCents,
    method: row.method,
    paidAt: row.paidAt.toISOString(),
    note: row.note,
    stub: row.method === 'STUB',
  };
}

/**
 * Payer take-back / reversal or a correcting adjustment on a claim (e.g. an 835 CLP02 22 reversal
 * or a negative payment posted outside the ERA queue). The amount may be negative; it must not be
 * zero, needs a reason and a claim of the client, and is audited. Idempotent with idempotencyKey.
 */
export async function createPaymentAdjustment(
  actor: LedgerActor,
  input: {
    clientId: string;
    claimId: string;
    amountCents: number;
    reason: string;
    kind: 'reversal' | 'adjustment';
    paidAt?: string | null;
    idempotencyKey?: string | null;
  }
) {
  if (!canMutateLedger(actor.actorRole)) return { ok: false as const, error: 'Forbidden', status: 403 as const };
  const amountCents = Math.trunc(input.amountCents);
  if (!Number.isFinite(amountCents) || amountCents === 0) return { ok: false as const, error: 'Amount cannot be zero', status: 400 as const };
  const reason = input.reason?.trim();
  if (!reason) return { ok: false as const, error: 'A reason is required for a reversal or adjustment', status: 400 as const };
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 100) || null;
  if (idempotencyKey) {
    const prior = await prisma.payment.findFirst({ where: { organizationId: actor.organizationId, idempotencyKey }, include: { client: { select: { name: true } } } });
    if (prior) return { ok: true as const, duplicate: true as const, payment: paymentItem(prior) };
  }
  const claim = await prisma.claim.findFirst({
    where: { id: input.claimId, organizationId: actor.organizationId, clientId: input.clientId, client: clientAccessWhere(actor) },
    select: { id: true, clientId: true },
  });
  if (!claim) return { ok: false as const, error: 'Claim not found for this client', status: 404 as const };
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) return { ok: false as const, error: 'Invalid date', status: 400 as const };
  const row = await prisma.payment.create({
    data: {
      organizationId: actor.organizationId,
      clientId: claim.clientId,
      claimId: claim.id,
      amountCents,
      method: 'INSURANCE',
      paidAt,
      note: `${input.kind === 'reversal' ? 'Payer reversal' : 'Adjustment'}: ${reason}`.slice(0, 200),
      idempotencyKey,
    },
    include: { client: { select: { name: true } } },
  });
  await writeAuditLog({
    action: input.kind === 'reversal' ? 'payment_reversal_posted' : 'payment_adjustment_posted',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    resourceType: 'Payment',
    resourceId: row.id,
    patientId: claim.clientId,
    metadata: { claimId: claim.id, amountCents, kind: input.kind },
  });
  return { ok: true as const, duplicate: false as const, payment: paymentItem(row) };
}

export const STUB_CHARGE_BLOCKED =
  'Test (stub) charges are disabled: no money would move. Record a real payment on the Payments page or collect the card in Stripe.';

/**
 * Stub (no-money) charges only on a developer machine that opted in: NODE_ENV=development AND
 * ALLOW_STUB_CHARGES=1 AND Stripe not configured. Never on staging or production builds.
 */
export function stubChargesAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'development' && env.ALLOW_STUB_CHARGES === '1' && !stripeConfigured();
}

export async function stubCharge(
  actor: LedgerActor,
  input: { clientId: string; amountCents: number; last4?: string | null }
) {
  if (stripeConfigured()) {
    return {
      ok: false as const,
      error: 'Stripe is configured. Use a real charge path instead of the stub.',
      status: 409 as const,
    };
  }
  return createPayment(actor, {
    clientId: input.clientId,
    amountCents: input.amountCents,
    method: 'STUB',
    note: input.last4 ? `Autopay stub · card ${input.last4}` : 'Autopay stub (Stripe not configured)',
  });
}

export async function listAutopay(actor: LedgerActor) {
  try {
    const select = {
      id: true,
      name: true,
      autopayEnrollment: { select: autopaySelect },
      cardOnFile: { select: { id: true } },
    } as const;
    // Every enrolled client (imported plans included), then other active clients to enroll
    const enrolled = await prisma.client.findMany({
      where: { ...clientAccessWhere(actor), autopayEnrollment: { isNot: null } },
      select,
      orderBy: { name: 'asc' },
    });
    const others = await prisma.client.findMany({
      where: { status: 'ACTIVE', ...clientAccessWhere(actor), autopayEnrollment: { is: null } },
      select,
      orderBy: { name: 'asc' },
      take: 200,
    });
    const all = [...enrolled, ...others];
    const balances = await patientBalances(actor.organizationId, all.map((c) => c.id));
    return {
      schemaReady: true,
      enrollments: all.map((c) => toAutopayItem(c, c.autopayEnrollment, Boolean(c.cardOnFile), balances.get(c.id)?.balanceCents ?? null)),
    };
  } catch (err) {
    if (isMissingTable(err)) return { schemaReady: false, enrollments: [] as AutopayListItem[] };
    throw err;
  }
}

export async function upsertAutopay(
  actor: LedgerActor,
  input: { clientId: string; active: boolean; last4?: string | null }
) {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgFilter(actor.organizationId) },
    select: { id: true, name: true, cardOnFile: { select: { id: true } } },
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 as const };
  }

  const last4 = input.last4?.replace(/\D/g, '').slice(-4) || null;
  if (input.active && last4 && last4.length !== 4) {
    return { ok: false as const, error: 'last4 must be 4 digits', status: 400 as const };
  }

  const row = await prisma.autopayEnrollment.upsert({
    where: { clientId: client.id },
    create: {
      organizationId: actor.organizationId,
      clientId: client.id,
      active: input.active,
      last4: last4,
    },
    update: {
      active: input.active,
      last4: last4 === undefined ? undefined : last4,
    },
    select: autopaySelect,
  });

  const balance = (await patientBalances(actor.organizationId, [client.id])).get(client.id);
  return {
    ok: true as const,
    enrollment: toAutopayItem(client, row, Boolean(client.cardOnFile), balance?.balanceCents ?? null),
  };
}
