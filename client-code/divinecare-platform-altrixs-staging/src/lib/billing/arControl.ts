import 'server-only';

import type { ClaimDenialStatus, ClaimStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { readyBlockers } from '@/lib/billing/claims';
import { WAYSTAR_ENABLED, claimClearinghouseMode } from '@/lib/integrations/waystar';

export const AR_AGING_BUCKETS = [
  { key: '0-30', label: '0–30 days', minDays: 0, maxDays: 30, color: '#15803D' },
  { key: '31-60', label: '31–60 days', minDays: 31, maxDays: 60, color: '#B45309' },
  { key: '61-90', label: '61–90 days', minDays: 61, maxDays: 90, color: '#DC2626' },
  { key: '91-120', label: '91–120 days', minDays: 91, maxDays: 120, color: '#7C2D12' },
  { key: '120+', label: '120+ days', minDays: 121, maxDays: null, color: '#450A0A' },
] as const;

export type ArAgingBucketKey = (typeof AR_AGING_BUCKETS)[number]['key'];

export const AR_WORKLIST_ACTIONS = [
  'log_call',
  'resubmit',
  'send_statement',
] as const;

export type ArWorklistAction = (typeof AR_WORKLIST_ACTIONS)[number];

/** Billing + leadership. Office Manager removed 2026-10-22 (owner: patient-side billing only). */
const AR_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];

const OPEN_AR_STATUSES: ClaimStatus[] = ['READY', 'SUBMITTED', 'ACCEPTED', 'DENIED'];

export type ArActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export function canAccessArControl(role: Role | undefined | null) {
  return Boolean(role && AR_ROLES.includes(role));
}

function isMissingTable(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

function daysBetween(from: Date, to = new Date()) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function agingBucketForDays(days: number): ArAgingBucketKey {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  return '120+';
}

function claimAnchorDate(claim: {
  submittedAt: Date | null;
  createdAt: Date;
  appointment?: { startsAt: Date } | null;
}) {
  return claim.appointment?.startsAt ?? claim.submittedAt ?? claim.createdAt;
}

function outstandingCents(claim: {
  amountCents: number | null;
  paidAmount: number | null;
  patientResponsibility: number | null;
  payments: { amountCents: number }[];
}) {
  const billed = claim.amountCents ?? 0;
  const paidFromEra = Math.round((claim.paidAmount ?? 0) * 100);
  const paidFromLedger = claim.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const paid = Math.max(paidFromEra, paidFromLedger);
  const patientResp =
    claim.patientResponsibility != null ? Math.round(claim.patientResponsibility * 100) : null;
  if (patientResp != null && patientResp > 0) return patientResp;
  return Math.max(0, billed - paid);
}

type ArActivityEntry = {
  at: string;
  action: string;
  by: string;
  note?: string;
};

function readArActivity(submissionData: unknown): ArActivityEntry[] {
  if (!submissionData || typeof submissionData !== 'object' || Array.isArray(submissionData)) {
    return [];
  }
  const raw = (submissionData as { arActivity?: unknown }).arActivity;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (row): row is ArActivityEntry =>
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as ArActivityEntry).at === 'string' &&
      typeof (row as ArActivityEntry).action === 'string'
  );
}

export type ArWorklistItem = {
  claimId: string;
  displayId: string;
  clientId: string;
  clientName: string;
  payer: string;
  cptCode: string;
  amountCents: number;
  status: ClaimStatus;
  daysOutstanding: number;
  agingBucket: ArAgingBucketKey;
  denialId: string | null;
  denialStatus: ClaimDenialStatus | null;
  lastContactAt: string | null;
  serviceDate: string | null;
};

export type ArControlSnapshot = {
  schemaReady: boolean;
  syncedAt: string;
  eraMode: 'waystar' | 'demo';
  /** Altrixs-native claims visible to the actor (any status); 0 before go-live */
  claimCount: number;
  kpis: {
    totalArCents: number;
    over90Cents: number;
    activeDenials: number;
    inAppeal: number;
    firstPassRate: number | null;
    firstPassAccepted: number;
    firstPassTotal: number;
  };
  aging: Array<{
    key: ArAgingBucketKey;
    label: string;
    color: string;
    count: number;
    amountCents: number;
  }>;
  byPayer: Array<{
    payer: string;
    count: number;
    amountCents: number;
    color: string;
  }>;
  worklist: ArWorklistItem[];
};

function displayClaimId(id: string) {
  return `CLM-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`;
}

export async function getArControlSnapshot(actor: ArActor): Promise<ArControlSnapshot> {
  const syncedAt = new Date().toISOString();
  const { waystarEnabled, demoMode } = claimClearinghouseMode();
  const eraMode: 'waystar' | 'demo' = waystarEnabled && !demoMode ? 'waystar' : 'demo';

  try {
    const [claims, denials] = await Promise.all([
      prisma.claim.findMany({
        where: {
          organizationId: actor.organizationId,
          client: clientAccessWhere(actor),
        },
        include: {
          client: { select: { id: true, name: true } },
          appointment: { select: { startsAt: true } },
          payments: { select: { amountCents: true } },
          denials: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 2000,
      }),
      prisma.claimDenial.findMany({
        where: {
          organizationId: actor.organizationId,
          claim: { client: clientAccessWhere(actor) },
        },
        select: { id: true, status: true, claimId: true },
      }),
    ]);

    const openClaims = claims.filter((c) => OPEN_AR_STATUSES.includes(c.status));
    const worklist: ArWorklistItem[] = [];
    const agingMap = new Map<ArAgingBucketKey, { count: number; amountCents: number }>();
    for (const bucket of AR_AGING_BUCKETS) {
      agingMap.set(bucket.key, { count: 0, amountCents: 0 });
    }
    const payerMap = new Map<string, { count: number; amountCents: number }>();

    let totalArCents = 0;
    let over90Cents = 0;

    for (const claim of openClaims) {
      const amountCents = outstandingCents(claim);
      if (amountCents <= 0) continue;
      const days = daysBetween(claimAnchorDate(claim));
      const agingBucket = agingBucketForDays(days);
      const payer = (claim.payer || '').trim() || 'Unspecified';
      const activity = readArActivity(claim.submissionData);
      const lastContact = activity.filter((a) => a.action === 'log_call').at(-1)?.at ?? null;
      const latestDenial = claim.denials[0] ?? null;

      totalArCents += amountCents;
      if (days > 90) over90Cents += amountCents;

      const agingRow = agingMap.get(agingBucket)!;
      agingRow.count += 1;
      agingRow.amountCents += amountCents;

      const payerRow = payerMap.get(payer) || { count: 0, amountCents: 0 };
      payerRow.count += 1;
      payerRow.amountCents += amountCents;
      payerMap.set(payer, payerRow);

      worklist.push({
        claimId: claim.id,
        displayId: displayClaimId(claim.id),
        clientId: claim.client.id,
        clientName: claim.client.name,
        payer,
        cptCode: claim.cptCode,
        amountCents,
        status: claim.status,
        daysOutstanding: days,
        agingBucket,
        denialId: latestDenial?.id ?? null,
        denialStatus: latestDenial?.status ?? null,
        lastContactAt: lastContact,
        serviceDate: claim.appointment?.startsAt?.toISOString() ?? null,
      });
    }

    worklist.sort((a, b) => b.daysOutstanding - a.daysOutstanding || b.amountCents - a.amountCents);

    const decided = claims.filter((c) =>
      (['ACCEPTED', 'PAID', 'DENIED'] as ClaimStatus[]).includes(c.status)
    );
    const firstPassAccepted = decided.filter((c) => {
      if (c.status !== 'ACCEPTED' && c.status !== 'PAID') return false;
      return c.denials.length === 0 && !c.denialReason;
    }).length;
    const firstPassTotal = decided.length;
    const firstPassRate =
      firstPassTotal > 0 ? Math.round((firstPassAccepted / firstPassTotal) * 1000) / 10 : null;

    const activeDenials = denials.filter((d) => d.status === 'OPEN').length;
    const inAppeal = denials.filter((d) => d.status === 'APPEALED').length;

    return {
      schemaReady: true,
      syncedAt,
      eraMode,
      claimCount: claims.length,
      kpis: {
        totalArCents,
        over90Cents,
        activeDenials,
        inAppeal,
        firstPassRate,
        firstPassAccepted,
        firstPassTotal,
      },
      aging: AR_AGING_BUCKETS.map((bucket) => {
        const row = agingMap.get(bucket.key) || { count: 0, amountCents: 0 };
        return {
          key: bucket.key,
          label: bucket.label,
          color: bucket.color,
          count: row.count,
          amountCents: row.amountCents,
        };
      }),
      byPayer: Array.from(payerMap.entries())
        .map(([payer, row]) => ({
          payer,
          count: row.count,
          amountCents: row.amountCents,
          color: '#5C2D91',
        }))
        .sort((a, b) => b.amountCents - a.amountCents),
      worklist,
    };
  } catch (err) {
    if (isMissingTable(err)) {
      return {
        schemaReady: false,
        syncedAt,
        eraMode,
        claimCount: 0,
        kpis: {
          totalArCents: 0,
          over90Cents: 0,
          activeDenials: 0,
          inAppeal: 0,
          firstPassRate: null,
          firstPassAccepted: 0,
          firstPassTotal: 0,
        },
        aging: AR_AGING_BUCKETS.map((bucket) => ({
          key: bucket.key,
          label: bucket.label,
          color: bucket.color,
          count: 0,
          amountCents: 0,
        })),
        byPayer: [],
        worklist: [],
      };
    }
    throw err;
  }
}

export async function runArWorklistAction(
  actor: ArActor,
  claimId: string,
  action: ArWorklistAction,
  note?: string
) {
  const claim = await prisma.claim.findFirst({
    where: {
      id: claimId,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: { client: { select: { id: true, name: true } } },
  });
  if (!claim) {
    return { ok: false as const, error: 'Claim not found', status: 404 as const };
  }

  if (action === 'log_call') {
    const prev =
      claim.submissionData && typeof claim.submissionData === 'object' && !Array.isArray(claim.submissionData)
        ? { ...(claim.submissionData as Record<string, unknown>) }
        : {};
    const arActivity = [
      ...readArActivity(claim.submissionData),
      {
        at: new Date().toISOString(),
        action: 'log_call',
        by: actor.actorUserId,
        note: note?.trim() || 'Collection call logged',
      },
    ];
    await prisma.claim.update({
      where: { id: claim.id },
      data: { submissionData: { ...prev, arActivity } },
    });
    await writeAuditLog({
      action: 'ar.log_call',
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      resourceType: 'Claim',
      resourceId: claim.id,
      metadata: { note: note?.trim() || null },
    });
    return { ok: true as const, action };
  }

  if (action === 'resubmit') {
    if (!['DENIED', 'READY', 'DRAFT'].includes(claim.status)) {
      return {
        ok: false as const,
        error: `Cannot mark ${claim.status} claim for resubmit`,
        status: 400 as const,
      };
    }
    const blockers = await readyBlockers(claim);
    if (blockers.length) return { ok: false as const, error: blockers.join(' '), status: 400 as const };
    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: 'READY',
        denialReason: null,
        submissionInProgress: false,
        submissionError: null,
      },
    });
    await writeAuditLog({
      action: 'ar.resubmit',
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      resourceType: 'Claim',
      resourceId: claim.id,
    });
    return { ok: true as const, action, href: `/dashboard/billing/claims?claimId=${claim.id}` };
  }

  // send_statement
  const balanceCents = outstandingCents({
    amountCents: claim.amountCents,
    paidAmount: claim.paidAmount,
    patientResponsibility: claim.patientResponsibility,
    payments: await prisma.payment.findMany({
      where: { claimId: claim.id, organizationId: actor.organizationId },
      select: { amountCents: true },
    }),
  });
  const statement = await prisma.patientStatement.create({
    data: {
      organizationId: actor.organizationId,
      clientId: claim.client.id,
      clientName: claim.client.name,
      status: 'outstanding',
      balanceCents,
      periodLabel: `A/R follow-up · ${displayClaimId(claim.id)}`,
      delivery: 'portal',
      metaJson: { sourceClaimId: claim.id, createdFrom: 'ar-control' },
    },
  });
  await writeAuditLog({
    action: 'ar.send_statement',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    resourceType: 'PatientStatement',
    resourceId: statement.id,
    metadata: { claimId: claim.id },
  });
  return {
    ok: true as const,
    action,
    statementId: statement.id,
    href: `/dashboard/billing/statements?statementId=${statement.id}`,
  };
}

export async function syncArEra(actor: ArActor) {
  if (!WAYSTAR_ENABLED()) {
    return {
      ok: false as const,
      error:
        'Waystar ERA is not configured. Set WAYSTAR_CLIENT_ID (and related credentials) to sync ERA files.',
      status: 503 as const,
      demoMode: true as const,
    };
  }
  const eraUrl = process.env.WAYSTAR_ERA_URL?.trim();
  if (!eraUrl) {
    return {
      ok: false as const,
      error:
        'WAYSTAR_ERA_URL is not set. ERA sync cannot run until the Waystar 835/ERA endpoint is configured.',
      status: 503 as const,
      demoMode: false as const,
    };
  }

  try {
    const { waystarRequest } = await import('@/lib/integrations/waystar');
    const payload = await waystarRequest(eraUrl, undefined, `era-sync-${actor.organizationId}`);
    await writeAuditLog({
      action: 'ar.sync_era',
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      resourceType: 'EraSync',
      metadata: { keys: Object.keys(payload) },
    });
    return {
      ok: true as const,
      demoMode: false as const,
      syncedAt: new Date().toISOString(),
      message: 'ERA sync request accepted by Waystar.',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ERA sync failed';
    return { ok: false as const, error: message, status: 502 as const, demoMode: false as const };
  }
}

export function buildArExportCsv(snapshot: ArControlSnapshot) {
  const header = [
    'claimId',
    'clientName',
    'payer',
    'cptCode',
    'amountCents',
    'daysOutstanding',
    'agingBucket',
    'status',
  ];
  const lines = [header.join(',')];
  for (const row of snapshot.worklist) {
    lines.push(
      [
        row.displayId,
        JSON.stringify(row.clientName),
        JSON.stringify(row.payer),
        row.cptCode,
        String(row.amountCents),
        String(row.daysOutstanding),
        row.agingBucket,
        row.status,
      ].join(',')
    );
  }
  return lines.join('\n');
}
