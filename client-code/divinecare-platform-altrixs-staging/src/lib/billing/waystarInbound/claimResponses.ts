import 'server-only';

/**
 * Applies acknowledgments and claim statuses to claims (deployment-wide; each update is audited
 * under the claim's organization):
 *   999   005010X231A1  AK1 GS06 -> our 837 batch (claims) or a 270 / 276 file (waystar_outbound_files);
 *                       AK2 ST02 -> the claim / inquiry in that file
 *   277CA 005010X214    A2 accepted -> ACCEPTED; A3/A4/A6/A7/A8 -> DENIED (front-end rejection);
 *                       REF*1K -> Claim.payerClaimControlNumber
 *   277   005010X212    answer to our 276: notes on the claim (submissionData.waystarClaimStatus);
 *                       A2 / P* on a SUBMITTED claim -> ACCEPTED; A3/A4/A6/A7/A8 -> DENIED.
 *   Every front-end rejection opens a ClaimDenial work item (REJ-999 / REJ-277CA / REJ-277)
 *   and releases the prior auth units the claim counted.
 *                       F1 / F2 do not change status: the 835 posts payment / denial reasons.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { parse999 } from '../waystarSftpClaims';
import { claimReference, parse277, statusEffect, type ClaimStatusEntry } from './parse277';
import { matchClaimReference } from './claimMatch';
import { releasePriorAuthUsage } from '../priorAuthUsage';

/**
 * A front-end rejection (999 / 277CA / 277 A3-A8) never reached adjudication: it becomes a denial
 * work item (ClaimDenial OPEN) so it shows in the denial queue, and the prior auth units the claim
 * counted are given back. Idempotent per claim + source.
 */
async function openRejectionWorkItem(claim: { id: string; organizationId: string }, source: '999' | '277CA' | '277', reason: string) {
  const reasonCode = `REJ-${source}`;
  try {
    const open = await prisma.claimDenial.findFirst({ where: { claimId: claim.id, status: 'OPEN', reasonCode }, select: { id: true } });
    if (!open) {
      await prisma.claimDenial.create({
        data: { organizationId: claim.organizationId, claimId: claim.id, reasonCode, reasonText: `Front-end rejection (${source}): ${reason}`.slice(0, 1000), status: 'OPEN' },
      });
    }
  } catch (err) {
    console.warn('[waystar-inbound] rejection work item not created:', err instanceof Error ? err.message : err);
  }
  await releasePriorAuthUsage({ organizationId: claim.organizationId, claimId: claim.id, reason: `front-end rejection (${source})` });
}

export const WAYSTAR_SFTP_PROVIDER = 'waystar_sftp';

export type ClaimUpdate = {
  claimId: string;
  organizationId: string;
  displayId: string;
  from: string;
  to: string;
  type: '999' | '277CA' | '277' | '835';
  reason: string;
};

export type FileApplyOutcome = {
  summary: string;
  unmatched: string[];
  organizationIds: string[];
  claimUpdates: ClaimUpdate[];
  /** 999s for 270 files: eligibility checks moved to ERROR */
  eligibilityUpdated: number;
};

export type InboundCtx = { actorUserId: string | null; trigger: string };

export function claimDisplayId(id: string) {
  return `CLM-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

type ClaimRow = { id: string; organizationId: string; status: string; submissionData: Prisma.JsonValue; clientId: string };
const claimSelect = { id: true, organizationId: true, status: true, submissionData: true, clientId: true } as const;

async function recordAck(
  ctx: InboundCtx,
  claim: ClaimRow,
  response: { file: string; type: '999' | '277CA'; accepted: boolean | null; reason: string; payerClaimNumber?: string },
  out: FileApplyOutcome
) {
  const sd = obj(claim.submissionData);
  const info = obj(sd.waystarSftp);
  const responses = [...((info.responses as unknown[]) || []), { file: response.file, type: response.type, accepted: response.accepted, reason: response.reason, at: new Date().toISOString() }].slice(-20);
  // Only move claims still waiting on the clearinghouse; never override PAID / DENIED handled by staff
  let next: 'ACCEPTED' | 'DENIED' | null = null;
  if (response.accepted === false && (claim.status === 'SUBMITTED' || claim.status === 'ACCEPTED')) next = 'DENIED';
  if (response.accepted === true && response.type === '277CA' && claim.status === 'SUBMITTED') next = 'ACCEPTED';
  const label = response.type === '999' ? 'Waystar 999 rejected' : 'Waystar 277CA rejected';
  const nextSd = { ...sd, waystarSftp: { ...info, responses } };
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      submissionData: nextSd as Prisma.InputJsonValue,
      ...(next ? { status: next } : {}),
      ...(next === 'DENIED' ? { denialReason: `${label}: ${response.reason}`.slice(0, 1000) } : {}),
      ...(response.payerClaimNumber ? { payerClaimControlNumber: response.payerClaimNumber.slice(0, 50) } : {}),
    },
  });
  if (!out.organizationIds.includes(claim.organizationId)) out.organizationIds.push(claim.organizationId);
  if (next) {
    out.claimUpdates.push({ claimId: claim.id, organizationId: claim.organizationId, displayId: claimDisplayId(claim.id), from: claim.status, to: next, type: response.type, reason: response.reason });
    await writeAuditLog({
      action: 'claim_waystar_response',
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorUserId ? null : 'system',
      organizationId: claim.organizationId,
      resourceType: 'Claim',
      resourceId: claim.id,
      patientId: claim.clientId,
      userAgent: ctx.trigger,
      metadata: { type: response.type, file: response.file, from: claim.status, to: next },
    });
    if (next === 'DENIED') await openRejectionWorkItem(claim, response.type, response.reason);
    claim.status = next;
  }
  claim.submissionData = nextSd as Prisma.JsonValue;
}

async function setBatchStatus(batchId: string, status: string) {
  try {
    await prisma.waystarClaimBatch.updateMany({ where: { batchControlNumber: batchId }, data: { status } });
  } catch (err) {
    console.warn('[waystar-inbound] batch status update failed:', err instanceof Error ? err.message : err);
  }
}

/** 999 for a 270 / 276 file we sent. */
async function ackOutboundFile(ctx: InboundCtx, fileName: string, g: ReturnType<typeof parse999>['groups'][number], out: FileApplyOutcome): Promise<boolean> {
  const sent = await prisma.waystarOutboundFile.findUnique({ where: { controlNumber: g.groupControlNumber } });
  if (!sent) return false;
  const rejectedSets = g.sets.filter((s) => !s.accepted);
  const wholeRejected = g.code === 'R' || (g.sets.length > 0 && rejectedSets.length === g.sets.length);
  const detail = `999 ${g.code || '?'}${g.received != null ? ` (${g.acceptedCount ?? '?'} of ${g.received} accepted)` : ''}${rejectedSets.length ? `; rejected ST ${rejectedSets.map((s) => `${s.stControlNumber}${s.errors.length ? ` [${s.errors.join('; ')}]` : ''}`).join(', ')}` : ''}`;
  await prisma.waystarOutboundFile.update({
    where: { id: sent.id },
    data: { status: wholeRejected ? 'rejected_999' : rejectedSets.length ? 'partially_rejected_999' : 'acknowledged_999', ackAt: new Date(), ackDetail: detail.slice(0, 2000) },
  });
  if (!out.organizationIds.includes(sent.organizationId)) out.organizationIds.push(sent.organizationId);

  const rejectedIds = wholeRejected && !g.sets.length
    ? sent.itemIds
    : rejectedSets.map((s) => sent.itemIds[Number(s.stControlNumber) - 1]).filter((id): id is string => Boolean(id));
  if (sent.kind === '270' && rejectedIds.length) {
    for (const id of rejectedIds) {
      const check = await prisma.eligibilityCheck.findUnique({ where: { id }, select: { id: true, status: true, rawResponse: true } });
      if (!check || check.status !== 'PENDING') continue;
      await prisma.eligibilityCheck.update({
        where: { id },
        data: {
          status: 'ERROR',
          checkedAt: new Date(),
          rawResponse: { ...obj(check.rawResponse), channel: 'waystar_sftp', error: `Waystar rejected the 270 (${detail.slice(0, 300)})` } as Prisma.InputJsonValue,
        },
      });
      out.eligibilityUpdated++;
    }
  }
  if (sent.kind === '276' && rejectedIds.length) {
    for (const id of rejectedIds) await appendStatusNote(id, { file: fileName, kind: '999', effect: 'error', text: `276 status request rejected by Waystar: ${detail.slice(0, 300)}` });
  }
  await writeAuditLog({
    action: 'waystar_999_inquiry', actorUserId: ctx.actorUserId, actorRole: ctx.actorUserId ? null : 'system',
    organizationId: sent.organizationId, resourceType: 'WaystarOutboundFile', resourceId: sent.id, userAgent: ctx.trigger,
    metadata: { kind: sent.kind, code: g.code, rejected: rejectedIds.length },
  });
  return true;
}

export async function apply999(ctx: InboundCtx, fileName: string, content: string): Promise<FileApplyOutcome> {
  const out: FileApplyOutcome = { summary: '', unmatched: [], organizationIds: [], claimUpdates: [], eligibilityUpdated: 0 };
  const { groups } = parse999(content);
  const parts: string[] = [];
  for (const g of groups) {
    const accepted = g.code === 'A' || g.code === 'E';
    parts.push(`batch control ${g.groupControlNumber}: ${accepted ? 'accepted' : g.code === 'P' ? 'partially accepted' : g.code === 'R' ? 'rejected' : `code ${g.code || '?'}`}${g.received != null ? ` (${g.acceptedCount ?? '?'} of ${g.received} transaction sets accepted)` : ''}`);
    if (await ackOutboundFile(ctx, fileName, g, out)) continue;

    const claims: ClaimRow[] = await prisma.claim.findMany({
      where: { clearinghouseProvider: WAYSTAR_SFTP_PROVIDER, submissionData: { path: ['waystarSftp', 'controlNumber'], equals: g.groupControlNumber } },
      select: claimSelect,
    });
    if (!claims.length) { out.unmatched.push(`batch control ${g.groupControlNumber}`); continue; }
    const batchId = (obj(obj(claims[0].submissionData).waystarSftp).batchId as string) || '';
    if (batchId) await setBatchStatus(batchId, g.code === 'R' ? 'failed' : 'acknowledged_999');

    if (g.sets.length) {
      for (const set of g.sets) {
        const claim = claims.find((c) => (obj(obj(c.submissionData).waystarSftp).stControlNumber as string) === set.stControlNumber);
        if (!claim) { out.unmatched.push(`batch ${g.groupControlNumber} transaction set ${set.stControlNumber}`); continue; }
        await recordAck(ctx, claim, {
          file: fileName,
          type: '999',
          accepted: set.accepted ? null : false, // a 999 accept is syntax only; the 277CA decides acceptance
          reason: set.accepted
            ? `Transaction set accepted${set.code === 'E' ? ' with errors' : ''}${set.errors.length ? `: ${set.errors.join('; ')}` : ''}`
            : `Transaction set rejected (IK5 ${set.code})${set.errors.length ? `: ${set.errors.join('; ')}` : ''}`,
        }, out);
      }
    } else if (g.code === 'A' || g.code === 'E' || g.code === 'R') {
      for (const claim of claims) {
        await recordAck(ctx, claim, { file: fileName, type: '999', accepted: g.code === 'R' ? false : null, reason: g.code === 'R' ? 'Whole batch rejected (AK9 R)' : 'Batch accepted (AK9)' }, out);
      }
    } else {
      out.unmatched.push(`batch control ${g.groupControlNumber}: code ${g.code || '?'} without per-claim detail`);
    }
  }
  out.summary = parts.join('; ') || 'No AK1 group found';
  return out;
}

async function findClaim(ref: string): Promise<ClaimRow | null> {
  const m = await matchClaimReference(ref);
  if (m.kind === 'none' || m.kind === 'ambiguous') return null;
  return prisma.claim.findUnique({ where: { id: m.claimIds[0] }, select: claimSelect });
}

export async function apply277CA(ctx: InboundCtx, fileName: string, entries: ClaimStatusEntry[]): Promise<FileApplyOutcome> {
  const out: FileApplyOutcome = { summary: '', unmatched: [], organizationIds: [], claimUpdates: [], eligibilityUpdated: 0 };
  let acc = 0;
  let rej = 0;
  for (const e of entries) {
    const effect = statusEffect(e);
    const accepted = effect === 'accepted' ? true : effect === 'rejected' ? false : null;
    if (accepted === true) acc++;
    if (accepted === false) rej++;
    const ref = claimReference(e);
    if (!ref) { out.unmatched.push('claim with no TRN reference'); continue; }
    const claim = await findClaim(ref);
    if (!claim) { out.unmatched.push(`claim reference ${ref} (${e.statuses[0]?.category || '?'})`); continue; }
    await recordAck(ctx, claim, {
      file: fileName, type: '277CA', accepted,
      reason: e.statuses.map((s) => s.text).join(' | '),
      payerClaimNumber: e.payerClaimControlNumber || undefined,
    }, out);
  }
  out.summary = `${entries.length} claim status(es): ${acc} accepted, ${rej} rejected, ${entries.length - acc - rej} informational`;
  return out;
}

export type ClaimStatusNote = {
  at: string;
  file: string;
  kind: '277' | '999';
  effect: string;
  text: string;
  payerClaimControlNumber?: string;
  paidAmount?: number | null;
  checkNumber?: string;
  adjudicatedDate?: string | null;
};

async function appendStatusNote(claimId: string, note: Omit<ClaimStatusNote, 'at'>) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { submissionData: true } });
  if (!claim) return;
  const sd = obj(claim.submissionData);
  const notes = [...(Array.isArray(sd.waystarClaimStatus) ? (sd.waystarClaimStatus as unknown[]) : []), { ...note, at: new Date().toISOString() }].slice(-20);
  await prisma.claim.update({ where: { id: claimId }, data: { submissionData: { ...sd, waystarClaimStatus: notes } as Prisma.InputJsonValue } });
}

export async function apply277Status(ctx: InboundCtx, fileName: string, entries: ClaimStatusEntry[]): Promise<FileApplyOutcome> {
  const out: FileApplyOutcome = { summary: '', unmatched: [], organizationIds: [], claimUpdates: [], eligibilityUpdated: 0 };
  const counts: Record<string, number> = {};
  for (const e of entries) {
    const effect = statusEffect(e);
    counts[effect] = (counts[effect] || 0) + 1;
    const ref = claimReference(e) || e.traceNumber;
    const claim = ref ? await findClaim(ref) : null;
    if (!claim) { out.unmatched.push(`claim reference ${ref || '(none)'} (${e.statuses[0]?.category || '?'})`); continue; }
    if (!out.organizationIds.includes(claim.organizationId)) out.organizationIds.push(claim.organizationId);
    const text = e.statuses.map((s) => s.text).join(' | ') || 'No STC';
    await appendStatusNote(claim.id, {
      file: fileName, kind: '277', effect, text: text.slice(0, 1000),
      ...(e.payerClaimControlNumber ? { payerClaimControlNumber: e.payerClaimControlNumber } : {}),
      paidAmount: e.paidAmount, checkNumber: e.checkNumber || undefined, adjudicatedDate: e.adjudicatedDate,
    });
    let next: 'ACCEPTED' | 'DENIED' | null = null;
    // A4 (claim not found at the payer) is a rejection too: the payer has nothing to adjudicate
    if ((effect === 'rejected' || effect === 'not_found') && (claim.status === 'SUBMITTED' || claim.status === 'ACCEPTED')) next = 'DENIED';
    if ((effect === 'accepted' || effect === 'pending') && claim.status === 'SUBMITTED') next = 'ACCEPTED';
    if (next || e.payerClaimControlNumber) {
      await prisma.claim.update({
        where: { id: claim.id },
        data: {
          ...(next ? { status: next } : {}),
          ...(next === 'DENIED' ? { denialReason: `Waystar 277 rejected: ${text}`.slice(0, 1000) } : {}),
          ...(e.payerClaimControlNumber ? { payerClaimControlNumber: e.payerClaimControlNumber.slice(0, 50) } : {}),
        },
      });
    }
    if (next) out.claimUpdates.push({ claimId: claim.id, organizationId: claim.organizationId, displayId: claimDisplayId(claim.id), from: claim.status, to: next, type: '277', reason: text });
    if (next === 'DENIED') await openRejectionWorkItem(claim, '277', text);
    await writeAuditLog({
      action: 'claim_status_277',
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorUserId ? null : 'system',
      organizationId: claim.organizationId,
      resourceType: 'Claim',
      resourceId: claim.id,
      patientId: claim.clientId,
      userAgent: ctx.trigger,
      metadata: { file: fileName, effect, categories: e.statuses.map((s) => s.category), from: claim.status, to: next ?? claim.status },
    });
  }
  out.summary = `${entries.length} claim status response(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') || 'none'}`;
  return out;
}

export function parse277File(content: string) {
  return parse277(content);
}
