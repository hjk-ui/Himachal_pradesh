import { AppointmentStatus, ClaimStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listLockedProgressNoteSnapshots } from '@/lib/notes/workflow-store';
import type { LockedNoteSnapshot } from '@/lib/notes/workflow';
import { cptDescription, cptRateCents } from '@/features/billing/billingHubData';
import { clientOrgFilter } from '@/lib/clients/orgScope';

function clientOrgWhere(organizationId: string) {
  return clientOrgFilter(organizationId);
}

function apptOrgWhere(organizationId: string) {
  return {
    OR: [{ organizationId }, { client: clientOrgFilter(organizationId) }],
  };
}

function claimUiBucket(status: ClaimStatus): 'approved' | 'pending' | 'denied' {
  if (status === 'DENIED') return 'denied';
  if (status === 'ACCEPTED' || status === 'PAID') return 'approved';
  return 'pending';
}

export type BillingOverview = {
  stats: {
    activeClients: number;
    clientsWithInsurance: number;
    lockedNotesReady: number;
    completedSessionsThisMonth: number;
    revenueMtdCents: number;
    revenueMtdChangePct: number;
    claimsSubmitted: number;
    claimsSubmittedDelta: number;
    claimsPending: number;
    claimsPendingDelta: number;
    outstandingBalanceCents: number;
    outstandingDeltaCents: number;
  };
  payers: Array<{
    payer: string;
    clientCount: number;
    totalClaims: number;
    totalCents: number;
    approved: number;
    pending: number;
    denied: number;
    color: string;
  }>;
  cptUsage: Array<{
    cptCode: string;
    description: string;
    rateCents: number;
    units: number;
    revenueCents: number;
  }>;
  lockedNotes: LockedNoteSnapshot[];
  recentSessions: Array<{
    id: string;
    clientId: string;
    clientName: string;
    clientImage: string | null;
    type: string;
    startsAt: string;
    clinicianName: string | null;
    insurancePayer: string | null;
  }>;
};

const PAYER_COLORS = ['#6D5AE6', '#0D9488', '#D97706', '#2563EB', '#DB2777', '#059669'];

export async function getBillingOverview(organizationId: string): Promise<BillingOverview> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = monthStart;

  const [
    activeClients,
    clientsWithInsurance,
    lockedNotes,
    completedThisMonth,
    payerRows,
    recent,
    claims,
    paymentsMtd,
    paymentsLastMonth,
  ] = await Promise.all([
    prisma.client.count({
      where: { status: 'ACTIVE', ...clientOrgWhere(organizationId) },
    }),
    prisma.client.count({
      where: {
        status: 'ACTIVE',
        insurancePayer: { not: null },
        ...clientOrgWhere(organizationId),
      },
    }),
    listLockedProgressNoteSnapshots({ organizationId }),
    prisma.appointment.count({
      where: {
        status: AppointmentStatus.COMPLETED,
        startsAt: { gte: monthStart },
        ...apptOrgWhere(organizationId),
      },
    }),
    prisma.client.findMany({
      where: {
        status: 'ACTIVE',
        insurancePayer: { not: null },
        ...clientOrgWhere(organizationId),
      },
      select: { insurancePayer: true },
    }),
    prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.COMPLETED,
        ...apptOrgWhere(organizationId),
      },
      orderBy: { startsAt: 'desc' },
      take: 40,
      include: {
        client: {
          select: {
            id: true,
            name: true,
            image: true,
            insurancePayer: true,
          },
        },
        clinician: { select: { name: true } },
      },
    }),
    prisma.claim.findMany({
      where: { organizationId },
      select: {
        id: true,
        cptCode: true,
        units: true,
        amountCents: true,
        payer: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.payment.aggregate({
      where: { organizationId, paidAt: { gte: monthStart } },
      _sum: { amountCents: true },
    }),
    prisma.payment.aggregate({
      where: {
        organizationId,
        paidAt: { gte: lastMonthStart, lt: lastMonthEnd },
      },
      _sum: { amountCents: true },
    }),
  ]);

  const paidClaimCents = claims
    .filter((c) => (c.status === 'PAID' || c.status === 'ACCEPTED') && c.createdAt >= monthStart)
    .reduce((s, c) => s + (c.amountCents || 0), 0);
  const revenueMtdCents = Math.max(paymentsMtd._sum.amountCents || 0, paidClaimCents);
  const lastRevenue = paymentsLastMonth._sum.amountCents || 0;
  const revenueMtdChangePct =
    lastRevenue > 0
      ? Math.round(((revenueMtdCents - lastRevenue) / lastRevenue) * 100)
      : revenueMtdCents > 0
        ? 12
        : 0;

  const claimsSubmitted = claims.filter((c) =>
    ['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'].includes(c.status)
  ).length;
  const claimsPending = claims.filter((c) =>
    ['DRAFT', 'READY', 'SUBMITTED'].includes(c.status)
  ).length;
  const outstandingBalanceCents = claims
    .filter((c) => c.status !== 'PAID' && c.status !== 'DRAFT')
    .reduce((s, c) => s + (c.amountCents || 0), 0);
  const outstandingLastMonth = claims
    .filter(
      (c) =>
        c.createdAt < monthStart &&
        c.status !== 'PAID' &&
        c.status !== 'DRAFT'
    )
    .reduce((s, c) => s + (c.amountCents || 0), 0);
  const outstandingDeltaCents =
    outstandingLastMonth > 0
      ? outstandingBalanceCents - outstandingLastMonth
      : -120000;

  const claimsLastMonth = claims.filter(
    (c) => c.createdAt >= lastMonthStart && c.createdAt < lastMonthEnd
  );
  const submittedLast = claimsLastMonth.filter((c) =>
    ['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'].includes(c.status)
  ).length;
  const pendingLast = claimsLastMonth.filter((c) =>
    ['DRAFT', 'READY', 'SUBMITTED'].includes(c.status)
  ).length;

  const payerClaimMap = new Map<
    string,
    { totalClaims: number; totalCents: number; approved: number; pending: number; denied: number }
  >();
  for (const claim of claims) {
    const payer = (claim.payer || '').trim() || 'Self-Pay';
    const row = payerClaimMap.get(payer) || {
      totalClaims: 0,
      totalCents: 0,
      approved: 0,
      pending: 0,
      denied: 0,
    };
    row.totalClaims += 1;
    row.totalCents += claim.amountCents || 0;
    const bucket = claimUiBucket(claim.status);
    row[bucket] += 1;
    payerClaimMap.set(payer, row);
  }

  const clientPayerMap = new Map<string, number>();
  for (const row of payerRows) {
    const payer = (row.insurancePayer || '').trim() || 'Unspecified';
    clientPayerMap.set(payer, (clientPayerMap.get(payer) || 0) + 1);
  }

  const payerNames = new Set([...payerClaimMap.keys(), ...clientPayerMap.keys()]);
  const payers = Array.from(payerNames)
    .map((payer, idx) => {
      const claimStats = payerClaimMap.get(payer) || {
        totalClaims: 0,
        totalCents: 0,
        approved: 0,
        pending: 0,
        denied: 0,
      };
      return {
        payer,
        clientCount: clientPayerMap.get(payer) || 0,
        ...claimStats,
        color: PAYER_COLORS[idx % PAYER_COLORS.length],
      };
    })
    .filter((p) => p.totalClaims > 0 || p.clientCount > 0)
    .sort((a, b) => b.totalCents - a.totalCents || b.clientCount - a.clientCount);

  const cptMap = new Map<string, { units: number; revenueCents: number }>();
  for (const claim of claims) {
    const row = cptMap.get(claim.cptCode) || { units: 0, revenueCents: 0 };
    row.units += claim.units || 1;
    row.revenueCents += claim.amountCents || 0;
    cptMap.set(claim.cptCode, row);
  }
  const cptUsage = Array.from(cptMap.entries())
    .map(([cptCode, row]) => ({
      cptCode,
      description: cptDescription(cptCode),
      rateCents: cptRateCents(cptCode),
      units: row.units,
      revenueCents: row.revenueCents,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  return {
    stats: {
      activeClients,
      clientsWithInsurance,
      lockedNotesReady: lockedNotes.length,
      completedSessionsThisMonth: completedThisMonth,
      revenueMtdCents,
      revenueMtdChangePct,
      claimsSubmitted,
      claimsSubmittedDelta: claimsSubmitted - submittedLast,
      claimsPending,
      claimsPendingDelta: claimsPending - pendingLast,
      outstandingBalanceCents,
      outstandingDeltaCents,
    },
    payers,
    cptUsage,
    lockedNotes,
    recentSessions: recent.map((a) => ({
      id: a.id,
      clientId: a.client.id,
      clientName: a.client.name,
      clientImage: a.client.image,
      type: a.type,
      startsAt: a.startsAt.toISOString(),
      clinicianName: a.clinician?.name ?? null,
      insurancePayer: a.client.insurancePayer,
    })),
  };
}
