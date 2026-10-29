import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canReadLedger } from '@/lib/billing/ledger';

export const AGING_COLUMNS = ['0-30', '31-60', '61-90', '91-120', 'Over 120'] as const;

type Buckets = Record<(typeof AGING_COLUMNS)[number], number>;

function emptyBuckets(): Buckets {
  return { '0-30': 0, '31-60': 0, '61-90': 0, '91-120': 0, 'Over 120': 0 };
}

function columnForAge(days: number): (typeof AGING_COLUMNS)[number] {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  return 'Over 120';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function agingReport(actor: { organizationId: string; role: Role }) {
  if (!canReadLedger(actor.role) && actor.role !== 'OFFICE_MANAGER') {
    return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  }
  const claims = await prisma.claim.findMany({
    where: { organizationId: actor.organizationId },
    select: {
      id: true,
      clientId: true,
      amountCents: true,
      paidAmount: true,
      status: true,
      createdAt: true,
      cptCode: true,
      payer: true,
      submissionData: true,
      clearinghouseProvider: true,
      client: { select: { name: true } },
    },
  });
  const shown = emptyBuckets();
  const stored = emptyBuckets();
  let legacyCents = 0;
  let newChargeCents = 0;
  const collections: Array<{ id: string; clientName: string; cptCode: string; balanceCents: number; legacy: boolean }> = [];

  for (const claim of claims) {
    const data = asRecord(claim.submissionData);
    const balance = Math.max(0, Math.round((claim.amountCents || 0) - Math.round(Number(claim.paidAmount || 0) * 100)));
    const legacy = data.legacy === true || data.legacyBalance === true || claim.clearinghouseProvider === 'legacy';
    const ageDays = Math.floor((Date.now() - claim.createdAt.getTime()) / 86400000);
    const natural = columnForAge(Math.max(0, ageDays));
    stored[natural] += balance;
    if (legacy) {
      shown['Over 120'] += balance;
      legacyCents += balance;
    } else {
      shown[natural] += balance;
      newChargeCents += balance;
    }
    if (balance > 0 && (claim.status === 'DENIED' || claim.status === 'SUBMITTED' || legacy)) {
      collections.push({
        id: claim.id,
        clientName: claim.client.name,
        cptCode: claim.cptCode,
        balanceCents: balance,
        legacy,
      });
    }
  }

  return {
    ok: true as const,
    columns: AGING_COLUMNS,
    shown,
    storedBuckets: stored,
    legacyCents,
    newChargeCents,
    collections,
  };
}
