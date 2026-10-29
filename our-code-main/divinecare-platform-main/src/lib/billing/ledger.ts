import type { ClaimDenialStatus, PaymentMethod, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { stripeConfigured } from '@/lib/stripe/config';

export const DENIAL_STATUSES = ['OPEN', 'APPEALED', 'WON', 'LOST'] as const satisfies readonly ClaimDenialStatus[];
export const PAYMENT_METHODS = [
  'CARD',
  'ACH',
  'CASH',
  'CHECK',
  'INSURANCE',
  'STUB',
] as const satisfies readonly PaymentMethod[];

const BILLING_CORE: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
const LEDGER_READ: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'FRONT_DESK', 'OFFICE_MANAGER'];

export function canReadLedger(role: Role | undefined | null) {
  return Boolean(role && LEDGER_READ.includes(role));
}

export function canMutateLedger(role: Role | undefined | null) {
  return Boolean(role && BILLING_CORE.includes(role));
}

export function canAccessDenials(role: Role | undefined | null) {
  return canMutateLedger(role);
}

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
};

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
  }
) {
  const amountCents = Math.trunc(input.amountCents);
  if (amountCents <= 0) {
    return { ok: false as const, error: 'Amount must be greater than zero', status: 400 as const };
  }

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgFilter(actor.organizationId) },
    select: { id: true, name: true, treatmentTeam: true },
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

  const note = input.note?.trim() || '';
  if (/^copay\b/i.test(note)) {
    const team = client.treatmentTeam;
    const saved = team && typeof team === 'object' && !Array.isArray(team) && 'copay' in team
      ? Number((team as { copay?: { amount?: number } }).copay?.amount)
      : NaN;
    if (Number.isFinite(saved) && amountCents > Math.round(saved * 100)) {
      return { ok: false as const, error: 'Copay is above the saved maximum', status: 400 as const };
    }
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return { ok: false as const, error: 'Invalid paid date', status: 400 as const };
  }

  const row = await prisma.payment.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      claimId,
      amountCents,
      method: input.method,
      paidAt,
      note: input.note?.trim() === 'chargeback' ? 'Ins Chg Back' : input.note?.trim() || null,
    },
    include: { client: { select: { name: true } } },
  });

  return {
    ok: true as const,
    payment: {
      id: row.id,
      clientId: row.clientId,
      clientName: row.client.name,
      claimId: row.claimId,
      amountCents: row.amountCents,
      method: row.method,
      paidAt: row.paidAt.toISOString(),
      note: row.note,
      stub: row.method === 'STUB',
    } satisfies PaymentListItem,
  };
}

export async function stubCharge(
  actor: LedgerActor,
  input: { clientId: string; amountCents: number; last4?: string | null }
) {
  const { assertPatientPaymentsAllowed } = await import('@/lib/billing/patient-payments-gate');
  const paymentsGate = assertPatientPaymentsAllowed();
  if (paymentsGate.ok === false) {
    return { ok: false as const, error: paymentsGate.error, status: paymentsGate.status };
  }
  if (process.env.NODE_ENV !== 'development' || process.env.BILLING_STUB_CHARGES !== 'true' || stripeConfigured()) {
    return {
      ok: false as const,
      error: 'Card charges that are not real payments are refused outside local development.',
      status: 403 as const,
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
    const clients = await prisma.client.findMany({
      where: { status: 'ACTIVE', ...clientAccessWhere(actor) },
      select: {
        id: true,
        name: true,
        autopayEnrollment: { select: { id: true, active: true, last4: true } },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return {
      schemaReady: true,
      enrollments: clients.map(
        (c): AutopayListItem => ({
          clientId: c.id,
          clientName: c.name,
          active: c.autopayEnrollment?.active ?? false,
          last4: c.autopayEnrollment?.last4 ?? null,
          enrollmentId: c.autopayEnrollment?.id ?? null,
        })
      ),
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
    select: { id: true, name: true },
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
  });

  return {
    ok: true as const,
    enrollment: {
      clientId: client.id,
      clientName: client.name,
      active: row.active,
      last4: row.last4,
      enrollmentId: row.id,
    } satisfies AutopayListItem,
  };
}
