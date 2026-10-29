import 'server-only';

/** Clearinghouse page data for one organization (no PHI beyond what billing staff already see). */
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';
import { waystarRetrievalAvailable } from './retrieval';
import { claimDisplayId } from './claimResponses';
import { eligibilityChannels } from '@/lib/eligibility/waystar';

export type ClearinghouseOverview = {
  active: boolean;
  usageIndicator: 'T' | 'P';
  eligibility: ReturnType<typeof eligibilityChannels>;
  lastRun: null | { id: string; trigger: string; startedAt: string; finishedAt: string | null; status: string; applied: number; listed: number; eraPosted: number; eraReview: number; error: string | null };
  lastCronRun: null | { startedAt: string; status: string };
  filesByType: Record<string, Array<{ fileName: string; receivedAt: string; processed: boolean; processedAt: string | null; error: string | null; summary: Record<string, unknown> | null }>>;
  reviewCount: number;
  remittances: Array<{ id: string; payerName: string | null; traceNumber: string; paymentDate: string | null; paymentAmount: number; claimCount: number; status: string; balanced: boolean; plbTotal: number }>;
  outbound: Array<{ kind: string; batchId: string; createdAt: string; status: string; itemCount: number; ackDetail: string | null }>;
  awaitingAdjudication: Array<{ claimId: string; displayId: string; status: string; submittedAt: string | null; lastStatus: string | null }>;
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function clearinghouseOverview(actor: { organizationId: string; actorUserId: string; actorRole: Role }): Promise<ClearinghouseOverview> {
  const orgId = actor.organizationId;
  const [lastRun, lastCron, files, reviewCount, remits, outbound, claims] = await Promise.all([
    prisma.waystarRetrievalRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.waystarRetrievalRun.findFirst({ where: { trigger: 'cron' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true, status: true } }),
    prisma.waystarInboundFile.findMany({ orderBy: { receivedAt: 'desc' }, take: 150 }),
    prisma.eraClaimPayment.count({ where: { organizationId: orgId, postingStatus: { in: ['review', 'duplicate'] } } }),
    prisma.eraRemittance.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.waystarOutboundFile.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.claim.findMany({
      where: { organizationId: orgId, clearinghouseProvider: 'waystar_sftp', status: { in: ['SUBMITTED', 'ACCEPTED'] }, client: clientAccessWhere(actor) },
      select: { id: true, status: true, submittedAt: true, submissionData: true },
      orderBy: { submittedAt: 'asc' },
      take: 100,
    }),
  ]);

  const filesByType: ClearinghouseOverview['filesByType'] = {};
  for (const f of files) {
    const summary = f.summary ? obj(f.summary) : null;
    const orgs = Array.isArray(summary?.organizationIds) ? (summary!.organizationIds as string[]) : [];
    if (orgs.length && !orgs.includes(orgId)) continue;
    const key = f.fileType || 'unknown';
    (filesByType[key] ||= []);
    if (filesByType[key].length >= 15) continue;
    filesByType[key].push({
      fileName: f.fileName,
      receivedAt: f.receivedAt.toISOString(),
      processed: f.processed,
      processedAt: f.processedAt?.toISOString() ?? null,
      error: f.error,
      summary,
    });
  }

  const channels = eligibilityChannels();
  return {
    active: waystarRetrievalAvailable(),
    usageIndicator: channels.usageIndicator,
    eligibility: channels,
    lastRun: lastRun
      ? {
          id: lastRun.id, trigger: lastRun.trigger, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          status: lastRun.status, applied: lastRun.applied, listed: lastRun.listed, eraPosted: lastRun.eraPosted, eraReview: lastRun.eraReview, error: lastRun.error,
        }
      : null,
    lastCronRun: lastCron ? { startedAt: lastCron.startedAt.toISOString(), status: lastCron.status } : null,
    filesByType,
    reviewCount,
    remittances: remits.map((r) => ({
      id: r.id, payerName: r.payerName, traceNumber: r.traceNumber, paymentDate: r.paymentDate?.toISOString().slice(0, 10) ?? null,
      paymentAmount: Number(r.paymentAmount), claimCount: r.claimCount, status: r.status, balanced: r.balanced, plbTotal: Number(r.plbTotal),
    })),
    outbound: outbound.map((o) => ({ kind: o.kind, batchId: o.batchId, createdAt: o.createdAt.toISOString(), status: o.status, itemCount: o.itemCount, ackDetail: o.ackDetail })),
    awaitingAdjudication: claims.map((c) => {
      const sd = obj(c.submissionData);
      const notes = Array.isArray(sd.waystarClaimStatus) ? (sd.waystarClaimStatus as Array<{ text?: string; at?: string }>) : [];
      const responses = Array.isArray(obj(sd.waystarSftp).responses) ? (obj(sd.waystarSftp).responses as Array<{ type?: string; reason?: string }>) : [];
      const last = notes[notes.length - 1];
      const lastResp = responses[responses.length - 1];
      return {
        claimId: c.id,
        displayId: claimDisplayId(c.id),
        status: c.status,
        submittedAt: c.submittedAt?.toISOString() ?? null,
        lastStatus: last?.text ? `277: ${last.text}` : lastResp?.reason ? `${lastResp.type}: ${lastResp.reason}` : null,
      };
    }),
  };
}
