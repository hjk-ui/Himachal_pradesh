import 'server-only';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';

/**
 * Waystar SFTP claim channel for the Claims page.
 *
 * Send:     READY claims -> prepareClaimsForWaystar() (mapper + pre-send checks) -> ONE 837P via
 *           submitClaimBatch() (S3 + Transfer Family connector -> Waystar /Upload)
 *           -> waystar_claim_batches row + per-claim submissionData.waystarSftp.
 * Retrieve: waystarInbound/retrieval.ts (shared with the cron job): 999, 277CA, 277,
 *           835 ERA posting and 271 eligibility answers.
 *
 * Used instead of the REST path when the connector + bucket are set, AWS is
 * live, and the Waystar REST API is not configured.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessClaims, type ClaimActor } from './claims';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { recordPriorAuthUsage, releasePriorAuthUsage } from './priorAuthUsage';
import type { WaystarSftpClaimInfo } from '@/features/billing/claimsApi';
import {
  billingConfigProblems,
  submitClaimBatch,
  waitForTransfer,
  waystarSftpConfig,
  type BatchResult,
  type ClaimForBatch,
} from '@/lib/services/waystarSftpService';
import { prepareClaimsForWaystar, waystarClaimInclude, type WaystarLoadedClaim } from './waystarClaimPrep';
import { outcomeForOrganization, runWaystarRetrieval, waystarRetrievalAvailable } from './waystarInbound/retrieval';

export const WAYSTAR_SFTP_PROVIDER = 'waystar_sftp';

// ─── Mode ─────────────────────────────────────────────────────────────────────

export function waystarSftpMode() {
  const cfg = waystarSftpConfig();
  const restConfigured = Boolean(
    process.env.WAYSTAR_CLIENT_SECRET && process.env.WAYSTAR_TOKEN_URL && process.env.WAYSTAR_CLAIMS_URL
  );
  const forcedDemo = process.env.CLINICAL_CLEARINGHOUSE_MODE === 'demo';
  const active = cfg.configured && cfg.live && !restConfigured && !forcedDemo;
  let statusLine: string | null = null;
  if (active) {
    statusLine = cfg.usageIndicator === 'P'
      ? 'Waystar SFTP (PRODUCTION — ISA15=P). Claims sent here go to payers.'
      : 'Waystar SFTP (test mode — ISA15=T). Files go to the Waystar test account; payers do not adjudicate them.';
  } else if (cfg.configured && restConfigured) {
    statusLine = 'Waystar REST API is configured, so claims use it instead of SFTP.';
  } else if (cfg.configured && forcedDemo) {
    statusLine = 'Waystar SFTP is set up, but CLINICAL_CLEARINGHOUSE_MODE=demo keeps claim submission in demo.';
  } else if (cfg.configured && !cfg.live) {
    statusLine = 'Waystar SFTP is set up, but AWS runs in demo mode on this server (AWS_LIVE not set). Nothing is sent.';
  }
  return {
    active,
    configured: cfg.configured,
    usageIndicator: cfg.usageIndicator,
    statusLine,
    billingNpi: cfg.groupNpi,
    configProblems: active ? billingConfigProblems() : [],
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function assertBillingRole(actor: ClaimActor) {
  // Same rule as clearinghouseClaims scope(): billing core roles only (Office Manager is read-only)
  if (!canAccessClaims(actor.actorRole)) {
    throw new ClearinghouseError('Forbidden', 403);
  }
}

export function claimDisplayId(id: string) {
  return `CLM-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export type WaystarSftpInfo = WaystarSftpClaimInfo;

/** Records (or updates) the waystar_claim_batches row for a sent batch. Never throws. */
export async function recordWaystarBatch(result: BatchResult, status?: string) {
  const rowStatus = status ?? (result.status === 'sent' ? 'transferred' : result.status === 'demo' ? 'demo' : 'staged');
  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO waystar_claim_batches (
        batch_control_number, s3_key, claim_count, total_charges, status, transfer_id, transferred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (batch_control_number) DO UPDATE
      SET status = $5, transfer_id = $6, transferred_at = NOW()
    `,
      result.batchId,
      result.s3Key,
      result.claimCount,
      result.totalCharges,
      rowStatus,
      result.transferId
    );
  } catch (dbErr) {
    console.warn('[waystar-batch] failed to save waystar_claim_batches row:', dbErr);
  }
}

// ─── ISA13 / GS06 control numbers ───────────────────────────────────────────

/**
 * Next 837 interchange control number from the waystar_interchange_control_seq sequence
 * (migration 20261019_rcm_blockers.sql): unique and increasing across servers. Throws when the
 * sequence is missing, so a file is never built with a made-up number.
 */
export async function nextInterchangeControlNumber(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`SELECT nextval('waystar_interchange_control_seq') AS n`;
    const n = Number(rows[0]?.n);
    if (!Number.isInteger(n) || n < 1 || n > 999999999) throw new Error(`sequence returned ${String(rows[0]?.n)}`);
    return n;
  } catch (err) {
    throw new Error(`837 control number unavailable (apply migration 20261019_rcm_blockers.sql): ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export type SftpClaimResult = {
  claimId: string;
  displayId: string;
  success: boolean;
  errors?: string[];
  error?: string;
  batchId?: string;
  dryRun?: boolean;
};

export type SftpSubmitOutcome = {
  channel: typeof WAYSTAR_SFTP_PROVIDER;
  dryRun: boolean;
  usageIndicator: 'T' | 'P';
  batch: null | {
    batchId: string;
    fileName: string;
    transferId: string;
    claimCount: number;
    totalCharges: number;
    delivery: 'completed' | 'unconfirmed';
    deliveryNote?: string;
  };
  configProblems: string[];
  results: SftpClaimResult[];
};

// Same include the outbound mapper loader expects (billing providers, payer mapping, coverages, COB)
const claimInclude = waystarClaimInclude;

type LoadedClaim = WaystarLoadedClaim;

function failureResult(id: string, errors: string[]): SftpClaimResult {
  return { claimId: id, displayId: claimDisplayId(id), success: false, errors, error: errors.join('; ') };
}

async function savePreSendErrors(organizationId: string, failed: SftpClaimResult[]) {
  for (const f of failed) {
    await prisma.claim.updateMany({
      where: { id: f.claimId, organizationId, submissionInProgress: false, status: { in: ['DRAFT', 'READY', 'DENIED'] } },
      data: { submissionError: `Pre-send check: ${(f.errors || []).join('; ')}`.slice(0, 2000) },
    });
  }
}

/**
 * Sends the selected claims in ONE 837P. Claims failing pre-send checks are
 * returned with their errors and are not sent. `dryRun` runs only the checks.
 */
export async function submitClaimsViaWaystarSftp(
  actor: ClaimActor,
  claimIds: string[],
  opts: { dryRun?: boolean } = {}
): Promise<SftpSubmitOutcome> {
  assertBillingRole(actor);
  const mode = waystarSftpMode();
  if (!mode.active) throw new ClearinghouseError('Waystar SFTP claim submission is not active on this server', 503);
  const dryRun = Boolean(opts.dryRun);
  const ids = Array.from(new Set(claimIds));

  const rows = await prisma.claim.findMany({
    where: { id: { in: ids }, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    include: claimInclude,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Billing providers, payer mapping, coverages, prior auth, earlier payers' 835 (COB), CLM01, the note,
  // rendering / supervising staff (legal names from the staff profile), taxonomy, service location
  const prepared = await prepareClaimsForWaystar(actor.organizationId, rows, {
    groupNpi: mode.billingNpi,
    usageIndicator: mode.usageIndicator,
  });

  const results: SftpClaimResult[] = [];
  const ready: Array<{ row: LoadedClaim; batchClaim: ClaimForBatch }> = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { results.push(failureResult(id, ['Claim not found'])); continue; }
    if (row.submissionInProgress) {
      results.push(failureResult(id, ['Submission pending or unconfirmed. Review Waystar before retrying.']));
      continue;
    }
    const mapped = prepared.get(id);
    if (!mapped) { results.push(failureResult(id, ['Claim could not be prepared for Waystar'])); continue; }
    if ('errors' in mapped) results.push(failureResult(id, mapped.errors));
    else ready.push({ row, batchClaim: mapped.claim });
  }

  // File-level problems (billing provider env) block every claim
  const configProblems = billingConfigProblems(ready.map((r) => r.batchClaim));
  if (configProblems.length) {
    for (const r of ready) results.push(failureResult(r.row.id, configProblems.map((p) => `Billing setup: ${p}`)));
    ready.length = 0;
  }

  await savePreSendErrors(actor.organizationId, results.filter((r) => !r.success && byId.has(r.claimId)));

  const base = { channel: WAYSTAR_SFTP_PROVIDER, dryRun, usageIndicator: mode.usageIndicator, configProblems } as const;

  if (dryRun || !ready.length) {
    if (dryRun && ready.length) {
      await prisma.claim.updateMany({
        where: { id: { in: ready.map((r) => r.row.id) }, organizationId: actor.organizationId, submissionInProgress: false },
        data: { submissionError: null },
      });
    }
    for (const r of ready) results.push({ claimId: r.row.id, displayId: claimDisplayId(r.row.id), success: true, dryRun: true });
    return { ...base, batch: null, results: orderLike(ids, results) };
  }

  // Reserve the claims so a second click can't send them twice
  const reservationKey = `waystar-sftp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.claim.updateMany({
    where: {
      id: { in: ready.map((r) => r.row.id) },
      organizationId: actor.organizationId,
      status: 'READY',
      submissionInProgress: false,
    },
    data: { submissionInProgress: true, submissionKey: reservationKey, submissionError: null },
  });
  const reservedIds = new Set(
    (await prisma.claim.findMany({ where: { id: { in: ready.map((r) => r.row.id) }, submissionKey: reservationKey }, select: { id: true } })).map((c) => c.id)
  );
  const toSend = ready.filter((r) => reservedIds.has(r.row.id));
  for (const r of ready) {
    if (!reservedIds.has(r.row.id)) results.push(failureResult(r.row.id, ['Claim changed while sending (another submission?). Refresh and retry.']));
  }
  if (!toSend.length) return { ...base, batch: null, results: orderLike(ids, results) };

  const release = async (message: string) => {
    await prisma.claim.updateMany({
      where: { id: { in: toSend.map((r) => r.row.id) }, submissionKey: reservationKey },
      data: { submissionInProgress: false, submissionError: message.slice(0, 2000) },
    });
  };

  let batch: BatchResult;
  const sendStartedAt = new Date();
  // Integration log (Admin > Integrations > Logs): file name + transfer status only, never claim contents
  const logSend = (status: 'success' | 'error', extra: { vendorStatus?: string; errorMessage?: string; correlationId?: string; sourceId?: string; metadata?: Record<string, unknown> }) =>
    recordIntegrationCall({
      integration: 'waystar', operation: 'sftp_upload_837p', direction: 'outbound', status,
      organizationId: actor.organizationId, actorUserId: actor.actorUserId, startedAt: sendStartedAt,
      sourceTable: extra.sourceId ? 'waystar_claim_batches' : null, ...extra,
      metadata: { claimCount: toSend.length, usageIndicator: mode.usageIndicator, ...(extra.metadata || {}) },
    });
  try {
    const controlNumber = await nextInterchangeControlNumber();
    batch = await submitClaimBatch(toSend.map((r) => r.batchClaim), actor.actorUserId, { controlNumber });
  } catch (err) {
    // Fails before or at StartFileTransfer: no transfer was started, so nothing reached Waystar
    const message = `Not sent to Waystar: ${err instanceof Error ? err.message : 'connector error'}`;
    await logSend('error', { vendorStatus: 'not_started', errorMessage: message });
    await release(message);
    await writeAuditLog({
      action: 'claim_submit_837p', actorUserId: actor.actorUserId, organizationId: actor.organizationId,
      resourceType: 'ClaimBatch', resourceId: reservationKey, outcome: 'FAILURE',
      metadata: { channel: WAYSTAR_SFTP_PROVIDER, claimCount: toSend.length, error: message.slice(0, 300) },
    });
    for (const r of toSend) results.push(failureResult(r.row.id, [message]));
    return { ...base, batch: null, results: orderLike(ids, results) };
  }

  // The connector accepted the transfer; wait briefly for delivery to /Upload
  const transfer = await waitForTransfer(batch.transferId, 20_000);
  const failed = transfer.files.find((f) => f.status === 'FAILED');
  if (failed) {
    const message = `Waystar transfer failed: ${failed.failure || 'unknown error'} (batch ${batch.batchId}, not delivered)`;
    await recordWaystarBatch(batch, 'failed');
    await logSend('error', {
      vendorStatus: 'transfer_failed', errorMessage: message, correlationId: batch.transferId, sourceId: batch.batchId,
      metadata: { fileName: batch.fileName, batchId: batch.batchId },
    });
    await release(message);
    await writeAuditLog({
      action: 'claim_submit_837p', actorUserId: actor.actorUserId, organizationId: actor.organizationId,
      resourceType: 'ClaimBatch', resourceId: batch.batchId, outcome: 'FAILURE',
      metadata: { channel: WAYSTAR_SFTP_PROVIDER, transferId: batch.transferId, claimCount: toSend.length },
    });
    for (const r of toSend) results.push(failureResult(r.row.id, [message]));
    return { ...base, batch: null, results: orderLike(ids, results) };
  }
  const completed = transfer.files.length > 0 && transfer.files.every((f) => f.status === 'COMPLETED');
  const delivery: WaystarSftpInfo['delivery'] = completed ? 'completed' : 'unconfirmed';
  const deliveryNote = completed
    ? undefined
    : transfer.error
      ? `Transfer started; delivery status could not be read (${transfer.error.slice(0, 160)})`
      : 'Transfer started; delivery still in progress when checked';

  await recordWaystarBatch(batch);
  await logSend('success', {
    vendorStatus: delivery, correlationId: batch.transferId, sourceId: batch.batchId,
    metadata: { fileName: batch.fileName, batchId: batch.batchId, deliveryNote: deliveryNote ?? null },
  });
  const stByClaim = new Map(batch.transactionSets.map((t) => [t.claimId, t.controlNumber]));
  const clm01ByClaim = new Map(batch.transactionSets.map((t) => [t.claimId, t.claimControlNumber]));
  const sentAt = new Date();
  for (const { row, batchClaim } of toSend) {
    const info: WaystarSftpInfo = {
      batchId: batch.batchId,
      fileName: batch.fileName,
      s3Key: batch.s3Key,
      transferId: batch.transferId,
      controlNumber: batch.controlNumber,
      stControlNumber: stByClaim.get(row.id) || '',
      sentAt: batch.sentAt,
      usageIndicator: mode.usageIndicator,
      delivery,
      ...(deliveryNote ? { deliveryNote } : {}),
      responses: [],
    };
    await prisma.claim.update({
      where: { id: row.id },
      data: {
        status: 'SUBMITTED',
        clearinghouseProvider: WAYSTAR_SFTP_PROVIDER,
        clearinghouseClaimId: batch.batchId,
        clearinghouseDemo: false,
        submittedAt: sentAt,
        submittedBy: actor.actorUserId,
        submissionInProgress: false,
        submissionError: null,
        submissionKey: batch.batchId,
        // claimControlNumber: the CLM01 actually sent (277CA / 835 / 276 matching; legacy batches sent Claim.id)
        submissionData: {
          ...jsonObject(row.submissionData),
          waystarSftp: { ...info, claimControlNumber: clm01ByClaim.get(row.id) || batchClaim.controlNumber || row.id },
        } as Prisma.InputJsonValue,
      },
    });
    // Prior auth units: a void gives them back; an original / corrected claim counts them once
    if (batchClaim.frequencyCode === '8') {
      await releasePriorAuthUsage({ organizationId: actor.organizationId, claimId: row.id, reason: 'void claim sent', actorUserId: actor.actorUserId });
    } else {
      await recordPriorAuthUsage({
        organizationId: actor.organizationId,
        claimId: row.id,
        authNumber: batchClaim.priorAuthNumber,
        lines: batchClaim.lines.map((l) => ({ cpt: l.cpt, units: l.units })),
        actorUserId: actor.actorUserId,
      });
    }
    await writeAuditLog({
      action: 'claim_submit_837p',
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      resourceType: 'Claim',
      resourceId: row.id,
      patientId: row.clientId,
      metadata: {
        clearinghouseProvider: WAYSTAR_SFTP_PROVIDER,
        batchId: batch.batchId,
        transferId: batch.transferId,
        usageIndicator: mode.usageIndicator,
        delivery,
      },
    });
    results.push({ claimId: row.id, displayId: claimDisplayId(row.id), success: true, batchId: batch.batchId });
  }

  return {
    ...base,
    batch: {
      batchId: batch.batchId,
      fileName: batch.fileName,
      transferId: batch.transferId,
      claimCount: batch.claimCount,
      totalCharges: batch.totalCharges,
      delivery,
      ...(deliveryNote ? { deliveryNote } : {}),
    },
    results: orderLike(ids, results),
  };
}

function orderLike(ids: string[], results: SftpClaimResult[]) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  return [...results].sort((a, b) => (pos.get(a.claimId) ?? 0) - (pos.get(b.claimId) ?? 0));
}

// ─── Recent batches (org-scoped through the claims that were sent) ───────────

export type RecentBatch = {
  batchId: string;
  fileName: string;
  sentAt: string;
  usageIndicator: string;
  delivery: string;
  claimCount: number;
  rowStatus: string | null;
  transferId: string | null;
  claims: Array<{ claimId: string; displayId: string; status: string; lastResponse: string | null }>;
};

export async function listRecentWaystarBatches(actor: ClaimActor, limit = 5): Promise<RecentBatch[]> {
  assertBillingRole(actor);
  const claims = await prisma.claim.findMany({
    where: { organizationId: actor.organizationId, clearinghouseProvider: WAYSTAR_SFTP_PROVIDER },
    select: { id: true, status: true, submissionData: true, submittedAt: true },
    orderBy: { submittedAt: 'desc' },
    take: 300,
  });
  const batches = new Map<string, RecentBatch>();
  for (const c of claims) {
    const info = jsonObject(c.submissionData).waystarSftp as WaystarSftpInfo | undefined;
    if (!info?.batchId) continue;
    let b = batches.get(info.batchId);
    if (!b) {
      if (batches.size >= limit) continue;
      b = {
        batchId: info.batchId, fileName: info.fileName, sentAt: info.sentAt, usageIndicator: info.usageIndicator,
        delivery: info.delivery, claimCount: 0, rowStatus: null, transferId: info.transferId, claims: [],
      };
      batches.set(info.batchId, b);
    }
    const last = info.responses?.length ? info.responses[info.responses.length - 1] : null;
    b.claimCount++;
    b.claims.push({
      claimId: c.id,
      displayId: claimDisplayId(c.id),
      status: c.status,
      lastResponse: last ? `${last.type}: ${last.accepted === true ? 'accepted' : last.accepted === false ? 'rejected' : 'informational'} — ${last.reason}` : null,
    });
  }
  if (batches.size) {
    try {
      const rows = await prisma.waystarClaimBatch.findMany({ where: { batchControlNumber: { in: Array.from(batches.keys()) } } });
      for (const r of rows) {
        const b = batches.get(r.batchControlNumber);
        if (b) { b.rowStatus = r.status; b.transferId = r.transferId; }
      }
    } catch (err) {
      console.warn('[waystar-batch] could not read waystar_claim_batches:', err);
    }
  }
  return Array.from(batches.values());
}

// ─── Retrieve: delegated to the shared Waystar inbound run ──────────────────

export type ResponseCheckOutcome = {
  listedFiles: number;
  listingError?: string;
  listingTruncated: boolean;
  newlyRequested: string[];
  notYetArrived: string[];
  files: Array<{ fileName: string; type: string; summary: string; unmatched: string[] }>;
  claimUpdates: Array<{ claimId: string; displayId: string; from: string; to: string; type: '999' | '277CA' | '277' | '835'; reason: string }>;
  era: { posted: number; review: number; duplicates: number };
  eligibilityUpdated: number;
  runId: string | null;
  errors: string[];
};

/**
 * "Check Waystar responses": the same run the cron job does (scripts/waystar-retrieve.ts), applied
 * deployment-wide (999, 277CA, 277, 835 ERA posting, 271), reported for the caller's organization only.
 */
export async function checkWaystarResponses(actor: ClaimActor): Promise<ResponseCheckOutcome> {
  assertBillingRole(actor);
  if (!waystarSftpMode().configured || !waystarRetrievalAvailable()) throw new ClearinghouseError('Waystar SFTP is not active on this server', 503);
  const run = outcomeForOrganization(await runWaystarRetrieval({ trigger: 'manual', actorUserId: actor.actorUserId }), actor.organizationId);
  return {
    listedFiles: run.listedFiles,
    ...(run.listingError ? { listingError: run.listingError } : {}),
    listingTruncated: run.listingTruncated,
    newlyRequested: run.newlyRequested,
    notYetArrived: run.notYetArrived,
    files: run.files.map((f) => ({ fileName: f.fileName, type: f.type, summary: f.summary, unmatched: f.unmatched })),
    claimUpdates: run.claimUpdates.map((u) => ({ claimId: u.claimId, displayId: u.displayId, from: u.from, to: u.to, type: u.type, reason: u.reason })),
    era: run.era,
    eligibilityUpdated: run.eligibilityUpdated,
    runId: run.runId,
    errors: run.errors,
  };
}
