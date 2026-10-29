import 'server-only';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';

/**
 * One pull of Waystar /Download, used by the Claims page button and scripts/waystar-retrieve.ts.
 *
 *   list /Download (connector StartDirectoryListing) -> new names -> RetrieveFilePaths to S3
 *   (Waystar moves collected files to /Download/Archive) -> waystar_inbound_files row per name
 *   (unique) -> each unprocessed file is locked (processing_started_at), read from S3, applied by
 *   type, then marked processed. A failed file is unlocked and retried on the next run (max 10).
 *
 * Types: 999 (X231A1), 277CA (X214), 277 (X212), 835 (X221A1), 271 (X279A1), TA1.
 * Deployment-wide: the mailbox is shared, every update is applied under its own organization.
 * One waystar_retrieval_runs row + one audit row per run (counts and ids only).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import {
  inboundS3Key,
  listRemoteResponseFiles,
  retrieveInboundFiles,
  waitForS3Objects,
  waystarSftpConfig,
} from '@/lib/services/waystarSftpService';
import { detectX12Kind, parseX12, type X12Kind } from './x12';
import { apply277CA, apply277Status, apply999, type ClaimUpdate } from './claimResponses';
import { parse277 } from './parse277';
import { apply835File } from './era';
import { apply271File } from '@/lib/eligibility/waystar';

export type InboundFileResult = {
  fileName: string;
  type: X12Kind;
  summary: string;
  unmatched: string[];
  organizationIds: string[];
};

export type RetrievalOutcome = {
  runId: string | null;
  skipped?: string;
  listedFiles: number;
  listingError?: string;
  listingTruncated: boolean;
  newlyRequested: string[];
  notYetArrived: string[];
  files: InboundFileResult[];
  claimUpdates: ClaimUpdate[];
  era: { posted: number; review: number; duplicates: number };
  eligibilityUpdated: number;
  errors: string[];
};

const LOCK_STALE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function guessTypeFromName(fileName: string): X12Kind {
  const n = fileName.toUpperCase();
  if (n.includes('835')) return '835';
  if (n.includes('999')) return '999';
  if (n.includes('271')) return '271';
  if (n.includes('277CA')) return '277CA';
  if (n.includes('277')) return '277';
  if (n.includes('TA1')) return 'TA1';
  return 'unknown';
}

export function waystarRetrievalAvailable() {
  const cfg = waystarSftpConfig();
  return cfg.configured && cfg.live;
}

function ta1Summary(content: string) {
  const ta1 = parseX12(content).segments.find((s) => s[0] === 'TA1');
  if (!ta1) return 'Interchange acknowledgment without TA1';
  const code = ta1[4] || '';
  return `Interchange ${ta1[1] || '?'}: ${code === 'A' ? 'accepted' : code === 'E' ? 'accepted with errors' : code === 'R' ? 'REJECTED' : code}${ta1[5] && ta1[5] !== '000' ? ` (note code ${ta1[5]})` : ''}`;
}

async function applyFile(
  file: { id: string; fileName: string },
  content: string,
  ctx: { actorUserId: string | null; trigger: string },
  out: RetrievalOutcome
): Promise<{ type: X12Kind; result: InboundFileResult; extra: Record<string, unknown> }> {
  const type = detectX12Kind(content);
  const base = { fileName: file.fileName, type, unmatched: [] as string[], organizationIds: [] as string[] };
  switch (type) {
    case '999': {
      const r = await apply999(ctx, file.fileName, content);
      out.claimUpdates.push(...r.claimUpdates);
      out.eligibilityUpdated += r.eligibilityUpdated;
      return { type, result: { ...base, summary: r.summary, unmatched: r.unmatched, organizationIds: r.organizationIds }, extra: { claimUpdates: r.claimUpdates.length } };
    }
    case '277CA': {
      const r = await apply277CA(ctx, file.fileName, parse277(content).filter((e) => e.kind === '277CA'));
      out.claimUpdates.push(...r.claimUpdates);
      return { type, result: { ...base, summary: r.summary, unmatched: r.unmatched, organizationIds: r.organizationIds }, extra: { claimUpdates: r.claimUpdates.length } };
    }
    case '277': {
      const r = await apply277Status(ctx, file.fileName, parse277(content).filter((e) => e.kind === '277'));
      out.claimUpdates.push(...r.claimUpdates);
      return { type, result: { ...base, summary: r.summary, unmatched: r.unmatched, organizationIds: r.organizationIds }, extra: { claimUpdates: r.claimUpdates.length } };
    }
    case '835': {
      const r = await apply835File(file, content, ctx);
      out.era.posted += r.posted;
      out.era.review += r.review;
      out.era.duplicates += r.duplicates;
      for (const u of r.claimUpdates) {
        out.claimUpdates.push({ ...u, displayId: `CLM-${u.claimId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`, type: '835' });
      }
      return {
        type,
        result: { ...base, summary: r.summary, organizationIds: r.organizationIds },
        extra: { remittances: r.remittances, posted: r.posted, review: r.review, duplicates: r.duplicates },
      };
    }
    case '271': {
      const r = await apply271File(ctx, file.fileName, content);
      out.eligibilityUpdated += r.updated;
      return { type, result: { ...base, summary: r.summary, unmatched: r.unmatched, organizationIds: r.organizationIds }, extra: { updated: r.updated } };
    }
    case 'TA1':
      return { type, result: { ...base, summary: ta1Summary(content) }, extra: {} };
    default:
      return { type, result: { ...base, summary: 'Not a 999, 277CA, 277, 835 or 271 file; left for manual review' }, extra: {} };
  }
}

/**
 * Runs one retrieval. `waitMs` bounds how long newly requested files are awaited in S3
 * (files that are still transferring are applied by the next run).
 */
export async function runWaystarRetrieval(opts: { trigger: 'cron' | 'manual'; actorUserId: string | null; waitMs?: number }): Promise<RetrievalOutcome> {
  const out: RetrievalOutcome = {
    runId: null, listedFiles: 0, listingTruncated: false, newlyRequested: [], notYetArrived: [], files: [],
    claimUpdates: [], era: { posted: 0, review: 0, duplicates: 0 }, eligibilityUpdated: 0, errors: [],
  };
  if (!waystarRetrievalAvailable()) {
    out.skipped = 'Waystar SFTP is not configured or AWS is in demo mode on this server';
    return out;
  }
  const ctx = { actorUserId: opts.actorUserId, trigger: opts.trigger === 'cron' ? 'waystar-retrieve-cron' : 'waystar-retrieve-manual' };
  const run = await prisma.waystarRetrievalRun.create({ data: { trigger: opts.trigger, actorUserId: opts.actorUserId }, select: { id: true } });
  out.runId = run.id;
  const runStartedAt = new Date();

  try {
    const listing = await listRemoteResponseFiles(opts.actorUserId || 'system:waystar-retrieve');
    out.listedFiles = listing.files.length;
    out.listingTruncated = listing.truncated;
    if (listing.error) out.listingError = listing.error;

    if (listing.files.length) {
      const known = new Set(
        (await prisma.waystarInboundFile.findMany({ where: { fileName: { in: listing.files.map((f) => f.fileName) } }, select: { fileName: true } })).map((f) => f.fileName)
      );
      const fresh = listing.files.filter((f) => !known.has(f.fileName)).slice(0, 50);
      if (fresh.length) {
        await retrieveInboundFiles(fresh.map((f) => f.remotePath), opts.actorUserId || 'system:waystar-retrieve');
        await prisma.waystarInboundFile.createMany({
          data: fresh.map((f) => ({ fileName: f.fileName, fileType: guessTypeFromName(f.fileName), s3Key: inboundS3Key(f.fileName), processed: false })),
          skipDuplicates: true,
        });
        out.newlyRequested = fresh.map((f) => f.fileName);
      }
    }

    const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
    const pending = await prisma.waystarInboundFile.findMany({
      where: { processed: false, attempts: { lt: MAX_ATTEMPTS }, OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }] },
      orderBy: { receivedAt: 'asc' },
      take: 50,
    });
    if (pending.length) {
      const contents = await waitForS3Objects(pending.map((p) => p.s3Key), opts.waitMs ?? (out.newlyRequested.length ? 25_000 : 5_000));
      for (const file of pending) {
        const content = contents.get(file.s3Key);
        if (content == null) { out.notYetArrived.push(file.fileName); continue; }
        // Lock: only one run applies a file
        const locked = await prisma.waystarInboundFile.updateMany({
          where: { id: file.id, processed: false, OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }] },
          data: { processingStartedAt: new Date(), attempts: { increment: 1 } },
        });
        if (locked.count !== 1) continue;
        try {
          const { type, result, extra } = await applyFile({ id: file.id, fileName: file.fileName }, content, ctx, out);
          out.files.push(result);
          await prisma.waystarInboundFile.update({
            where: { id: file.id },
            data: {
              processed: true,
              processedAt: new Date(),
              processingStartedAt: null,
              fileType: type,
              error: null,
              summary: { type, organizationIds: result.organizationIds, unmatched: result.unmatched.length, ...extra } as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[waystar-retrieve] could not apply', file.fileName, message);
          out.errors.push(`${file.fileName}: ${message.slice(0, 200)}`);
          out.files.push({ fileName: file.fileName, type: guessTypeFromName(file.fileName), summary: 'Could not be applied; it will be retried on the next retrieval', unmatched: [], organizationIds: [] });
          await prisma.waystarInboundFile.update({ where: { id: file.id }, data: { processingStartedAt: null, error: message.slice(0, 1000) } });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out.errors.push(message.slice(0, 300));
  }

  const status = out.errors.length ? (out.files.length ? 'partial' : 'failed') : 'ok';
  const byType: Record<string, number> = {};
  for (const f of out.files) byType[f.type] = (byType[f.type] || 0) + 1;
  await prisma.waystarRetrievalRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      status,
      listed: out.listedFiles,
      requested: out.newlyRequested.length,
      applied: out.files.length,
      claimUpdates: out.claimUpdates.length,
      eraPosted: out.era.posted,
      eraReview: out.era.review,
      eligibilityUpdated: out.eligibilityUpdated,
      error: out.errors.join(' | ').slice(0, 2000) || null,
      summary: { byType, notYetArrived: out.notYetArrived.length, listingError: out.listingError ?? null, files: out.files.map((f) => f.fileName).slice(0, 50) } as Prisma.InputJsonValue,
    },
  });
  // Integration log: deployment-wide run, counts and file names only
  await recordIntegrationCall({
    integration: 'waystar', operation: 'sftp_retrieve', direction: opts.trigger === 'cron' ? 'job' : 'inbound',
    status: status === 'ok' ? 'success' : 'error', vendorStatus: status, startedAt: runStartedAt,
    actorUserId: opts.actorUserId, errorMessage: out.errors.join(' | ') || null,
    sourceTable: 'waystar_retrieval_runs', sourceId: run.id,
    metadata: {
      trigger: opts.trigger, listed: out.listedFiles, requested: out.newlyRequested.length, applied: out.files.length,
      claimUpdates: out.claimUpdates.length, eraPosted: out.era.posted, eraReview: out.era.review,
      eligibilityUpdated: out.eligibilityUpdated, byType, files: out.files.map((f) => f.fileName).slice(0, 20),
    },
  });
  await writeAuditLog({
    action: 'waystar_retrieval_run',
    actorUserId: opts.actorUserId,
    actorRole: opts.actorUserId ? null : 'system',
    organizationId: null,
    resourceType: 'WaystarRetrievalRun',
    resourceId: run.id,
    outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
    userAgent: ctx.trigger,
    metadata: {
      trigger: opts.trigger, listed: out.listedFiles, requested: out.newlyRequested.length, applied: out.files.length,
      byType, claimUpdates: out.claimUpdates.length, eraPosted: out.era.posted, eraReview: out.era.review,
      eligibilityUpdated: out.eligibilityUpdated, errors: out.errors.length,
    },
  });
  return out;
}

/** Restricts a run's outcome to what one organization may see (file names and counts stay). */
export function outcomeForOrganization(out: RetrievalOutcome, organizationId: string): RetrievalOutcome {
  return {
    ...out,
    files: out.files
      .filter((f) => f.organizationIds.length === 0 || f.organizationIds.includes(organizationId))
      .map((f) => (f.organizationIds.length > 1 ? { ...f, summary: `${f.summary} (file also covers another practice)` } : f)),
    claimUpdates: out.claimUpdates.filter((u) => u.organizationId === organizationId),
  };
}
