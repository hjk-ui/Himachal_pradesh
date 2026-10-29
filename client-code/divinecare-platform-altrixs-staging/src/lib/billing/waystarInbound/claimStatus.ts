import 'server-only';

/**
 * 276 claim status requests (005010X212) for claims already sent to Waystar.
 * One file per request, one ST per claim; TRN02 and REF*EJ = the claim's CLM01, so the 277
 * answer is matched like a 277CA. Answers are applied by claimResponses.apply277Status().
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { generate276, validateClaimStatusInquiry, validateConfig, type ClaimStatusInquiry } from './generate';
import { inquiryConfig, sendX12File } from './transport';
import { clm01For } from './claimMatch';
import { claimDisplayId } from './claimResponses';
import { canAccessClaims } from '../claims';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
import { resolveWaystarPayerId, waystarEligibilityAvailable } from '@/lib/eligibility/waystar';
import { administrativeSexCode, x12PatientName, X12_NAME_MISSING } from '@/lib/clients/demographics';

export const STATUS_REQUESTABLE = ['SUBMITTED', 'ACCEPTED', 'DENIED'] as const;

export type StatusActor = { organizationId: string; actorUserId: string; actorRole: Role };

export type StatusRequestOutcome = {
  sent: Array<{ claimId: string; displayId: string }>;
  failed: Array<{ claimId: string; displayId: string; errors: string[] }>;
  batch: null | { batchId: string; fileName: string; delivery: string; deliveryNote?: string; usageIndicator: 'T' | 'P' };
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/** Legal name only (x12PatientName); a display name is never split. Blank parts fail validation. */
function splitName(client: { legalFirstName: string | null; legalLastName: string | null; middleInitial: string | null; needsNameReview?: boolean | null }) {
  return x12PatientName(client) ?? { firstName: '', lastName: '', middleInitial: null };
}

export async function requestClaimStatus(actor: StatusActor, claimIds: string[]): Promise<StatusRequestOutcome> {
  // A 276 is a payer transaction sent for the practice: billing core only (Office Manager reads claims).
  if (!canAccessClaims(actor.actorRole)) throw new ClearinghouseError('Only billing staff can request claim status', 403);
  if (!waystarEligibilityAvailable()) throw new ClearinghouseError('Waystar SFTP is not active on this server', 503);
  const out: StatusRequestOutcome = { sent: [], failed: [], batch: null };
  const ids = Array.from(new Set(claimIds)).slice(0, 99);
  const rows = await prisma.claim.findMany({
    where: { id: { in: ids }, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    include: {
      client: { select: { name: true, legalFirstName: true, legalLastName: true, middleInitial: true, needsNameReview: true, dateOfBirth: true, administrativeSex: true, gender: true, insurancePayer: true, insuranceMemberId: true } },
      appointment: { select: { startsAt: true } },
      serviceLines: { select: { totalCharge: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const base = inquiryConfig();
  const cfgProblems = validateConfig(base);

  const ready: Array<{ claimId: string; inquiry: ClaimStatusInquiry; clientId: string }> = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { out.failed.push({ claimId: id, displayId: claimDisplayId(id), errors: ['Claim not found'] }); continue; }
    const sd = obj(row.submissionData);
    const errors = [...cfgProblems];
    if (!(STATUS_REQUESTABLE as readonly string[]).includes(row.status)) errors.push(`Claim is ${row.status}; only submitted claims can be status-checked`);
    if (!obj(sd.waystarSftp).batchId) errors.push('Claim was not sent through Waystar SFTP');
    const payerName = row.payer || row.client.insurancePayer || '';
    const payerId = (typeof sd.payerId === 'string' && sd.payerId) || (payerName ? await resolveWaystarPayerId(actor.organizationId, payerName) : null) || '';
    const memberId = (typeof sd.memberId === 'string' && sd.memberId) || row.client.insuranceMemberId || '';
    const dos = row.appointment?.startsAt
      ? row.appointment.startsAt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      : typeof sd.serviceDate === 'string' ? sd.serviceDate : '';
    const charge = row.serviceLines.length ? row.serviceLines.reduce((t, l) => t + l.totalCharge, 0) : (row.amountCents ?? 0) / 100;
    const clm01 = clm01For(row);
    const inquiry: ClaimStatusInquiry = {
      traceNumber: clm01,
      claimControlNumber: clm01,
      payerClaimControlNumber: row.payerClaimControlNumber,
      payerName,
      payerId,
      subscriber: {
        ...splitName(row.client),
        dateOfBirth: row.client.dateOfBirth ? row.client.dateOfBirth.toISOString().slice(0, 10) : null,
        gender: administrativeSexCode(row.client),
        memberId,
      },
      chargeAmount: Math.round(charge * 100) / 100,
      serviceFrom: dos,
    };
    if (!x12PatientName(row.client)) errors.push(X12_NAME_MISSING);
    errors.push(...validateClaimStatusInquiry(inquiry));
    if (errors.length) { out.failed.push({ claimId: id, displayId: claimDisplayId(id), errors }); continue; }
    ready.push({ claimId: id, inquiry, clientId: row.clientId });
  }
  if (!ready.length) return out;

  // The billing provider on the claim, when the claim names a 10-digit NPI
  const npis = new Set(rows.map((r) => (/\b(\d{10})\b/.exec(r.billingNpi || '') || [])[1]).filter(Boolean));
  const cfg = npis.size === 1 ? { ...base, providerNpi: Array.from(npis)[0] as string } : base;

  let file = generate276(ready.map((r) => r.inquiry), cfg);
  for (let i = 0; i < 3 && (await prisma.waystarOutboundFile.findUnique({ where: { controlNumber: file.controlNumber } })); i++) {
    file = generate276(ready.map((r) => r.inquiry), cfg);
  }
  const fileName = `${file.batchId}.276`;
  let sent;
  try {
    sent = await sendX12File('276', fileName, file.content);
  } catch (err) {
    const message = `Not sent to Waystar: ${err instanceof Error ? err.message : 'connector error'}`.slice(0, 300);
    for (const r of ready) out.failed.push({ claimId: r.claimId, displayId: claimDisplayId(r.claimId), errors: [message] });
    await writeAuditLog({
      action: 'claim_status_276_sent', actorUserId: actor.actorUserId, organizationId: actor.organizationId, outcome: 'FAILURE',
      resourceType: 'WaystarOutboundFile', resourceId: file.batchId, metadata: { count: ready.length },
    });
    return out;
  }
  await prisma.waystarOutboundFile.create({
    data: {
      kind: '276', organizationId: actor.organizationId, batchId: file.batchId, controlNumber: file.controlNumber, fileName,
      s3Key: sent.s3Key, transferId: sent.transferId, status: sent.delivery === 'failed' ? 'failed' : sent.demo ? 'demo' : 'transferred',
      usageIndicator: cfg.usageIndicator, itemCount: ready.length, itemIds: ready.map((r) => r.claimId), createdBy: actor.actorUserId,
    },
  });
  if (sent.delivery === 'failed') {
    for (const r of ready) out.failed.push({ claimId: r.claimId, displayId: claimDisplayId(r.claimId), errors: [`Waystar transfer failed: ${sent.deliveryNote || 'unknown'}`] });
  } else {
    for (const r of ready) {
      const row = byId.get(r.claimId)!;
      const sd = obj(row.submissionData);
      const requests = [...(Array.isArray(sd.waystarStatusRequests) ? (sd.waystarStatusRequests as unknown[]) : []), { batchId: file.batchId, at: new Date().toISOString(), delivery: sent.delivery }].slice(-10);
      await prisma.claim.update({ where: { id: r.claimId }, data: { submissionData: { ...sd, waystarStatusRequests: requests } as Prisma.InputJsonValue } });
      out.sent.push({ claimId: r.claimId, displayId: claimDisplayId(r.claimId) });
    }
  }
  out.batch = { batchId: file.batchId, fileName, delivery: sent.delivery, ...(sent.deliveryNote ? { deliveryNote: sent.deliveryNote } : {}), usageIndicator: cfg.usageIndicator };
  await writeAuditLog({
    action: 'claim_status_276_sent', actorUserId: actor.actorUserId, organizationId: actor.organizationId,
    outcome: sent.delivery === 'failed' ? 'FAILURE' : 'SUCCESS',
    resourceType: 'WaystarOutboundFile', resourceId: file.batchId,
    metadata: { count: ready.length, claimIds: ready.map((r) => r.claimId).slice(0, 50), delivery: sent.delivery },
  });
  return out;
}
