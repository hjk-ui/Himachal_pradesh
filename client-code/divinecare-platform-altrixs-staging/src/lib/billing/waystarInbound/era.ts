import 'server-only';

/**
 * 835 ERA storage and posting (005010X221A1).
 *
 *  apply835File()       parse -> store every remittance (era_remittances) and CLP (era_claim_payments)
 *                       -> auto-post exact, reconciling matches -> everything else to the ERA review queue.
 *  postEraClaimPayment() one CLP -> Payment (INSURANCE), era_adjustments (claim + line CAS),
 *                       Claim status / paid / adjustment / patient responsibility / payer claim control
 *                       number, ClaimDenial rows (CARC/RARC), PaymentBatch deposit line.
 *  primaryAdjudication() what the primary payer did, for secondary (COB) claims.
 *
 * Never double-posts: era_remittances is unique on TRN02 + TRN03 (a resent 835 is recorded as a
 * duplicate and posts nothing), and a CLP moves to 'posted' only through a conditional update
 * from pending/review inside the posting transaction.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { matchClaimReference } from './claimMatch';
import { allAdjustments, parse835, type CasAdjustment, type EraClaim, type EraServiceLine, type Remittance } from './parse835';
import {
  accumulatedTotals,
  crossoverSignal,
  describeAdjustments,
  plbBatchLines,
  planEraClaimPosting,
  remarkText,
  remittanceKey,
  type ClaimSnapshot,
  type MatchKind,
  type PostingPlan,
} from './eraPosting';
import { releasePriorAuthUsage } from '../priorAuthUsage';
import { CLP_STATUS, PLB_REASON } from './codes';

export type EraFileOutcome = {
  remittances: number;
  duplicates: number;
  posted: number;
  review: number;
  organizationIds: string[];
  claimUpdates: Array<{ claimId: string; organizationId: string; from: string; to: string; reason: string }>;
  summary: string;
};

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const isoDate = (d: string | null) => (d ? new Date(`${d}T12:00:00.000Z`) : null);

function jsonObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

async function claimSnapshot(claimId: string): Promise<ClaimSnapshot | null> {
  const c = await prisma.claim.findUnique({
    where: { id: claimId },
    select: {
      id: true, organizationId: true, clientId: true, status: true, amountCents: true,
      serviceLines: { select: { id: true, cptCode: true, modifier: true, totalCharge: true } },
    },
  });
  if (!c) return null;
  const linesTotal = c.serviceLines.reduce((t, l) => t + l.totalCharge, 0);
  const previously = await prisma.eraClaimPayment.count({ where: { claimId, postingStatus: 'posted' } });
  return {
    id: c.id,
    organizationId: c.organizationId,
    clientId: c.clientId,
    status: c.status,
    chargeTotal: Math.round((c.serviceLines.length ? linesTotal : (c.amountCents ?? 0) / 100) * 100) / 100,
    serviceLines: c.serviceLines,
    previouslyPosted: previously > 0,
  };
}

type Suggestion = { claimId: string; organizationId: string; score: number; why: string[] };

/** Candidate claims for an unmatched CLP: same member ID, then date of service and billed amount. */
async function suggestClaims(era: EraClaim): Promise<Suggestion[]> {
  const memberIds = Array.from(new Set([era.memberId, era.insuredMemberId, era.correctedMemberId].filter(Boolean)));
  const or: Prisma.ClaimWhereInput[] = [];
  if (memberIds.length) or.push({ client: { insuranceMemberId: { in: memberIds } } });
  if (era.patientControlNumber.length >= 8) or.push({ id: { startsWith: era.patientControlNumber.slice(0, 12) } });
  if (!or.length) return [];
  const rows = await prisma.claim.findMany({
    where: { OR: or, status: { in: ['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'] } },
    select: {
      id: true, organizationId: true, amountCents: true, status: true,
      appointment: { select: { startsAt: true } },
      serviceLines: { select: { totalCharge: true } },
      client: { select: { insuranceMemberId: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  const dos = era.statementFrom || era.lines.find((l) => l.serviceDate)?.serviceDate || null;
  return rows
    .map((r) => {
      const why: string[] = [];
      let score = 0;
      if (r.client.insuranceMemberId && memberIds.includes(r.client.insuranceMemberId)) { score += 2; why.push('member ID'); }
      const charge = r.serviceLines.length ? r.serviceLines.reduce((t, l) => t + l.totalCharge, 0) : (r.amountCents ?? 0) / 100;
      if (Math.abs(charge - era.charge) < 0.005) { score += 2; why.push('billed amount'); }
      const local = r.appointment?.startsAt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      if (dos && local === dos) { score += 2; why.push('date of service'); }
      if (r.id.startsWith(era.patientControlNumber.slice(0, 12))) { score += 1; why.push('claim number prefix'); }
      if (r.status === 'PAID') { score -= 1; why.push('already PAID'); }
      return { claimId: r.id, organizationId: r.organizationId, score, why };
    })
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function claimBalanced(era: EraClaim, remit: Remittance) {
  return !remit.balanceErrors.some((e) => e.startsWith(`Claim ${era.patientControlNumber}:`) || e.startsWith(`Claim ${era.patientControlNumber} line`));
}

function remitBalanced(remit: Remittance) {
  return !remit.balanceErrors.some((e) => e.startsWith('BPR02'));
}

async function singleOrganizationFallback(): Promise<string | null> {
  const only = process.env.DEFAULT_ORG?.trim();
  if (only) return only;
  const orgs = await prisma.organization.findMany({ where: { active: true }, select: { id: true }, take: 2 });
  return orgs.length === 1 ? orgs[0].id : null;
}

function storedLines(lines: EraServiceLine[]) {
  return lines.map((l) => ({
    seq: l.seq, procedureCode: l.procedureCode, modifiers: l.modifiers, charge: l.charge, paid: l.paid,
    unitsPaid: l.unitsPaid, originalProcedure: l.originalProcedure, serviceDate: l.serviceDate, serviceDateTo: l.serviceDateTo,
    lineControlNumber: l.lineControlNumber, allowed: l.allowed, adjustments: l.adjustments, remarks: l.remarks,
  }));
}

/** Parses an 835 file and stores / posts every remittance in it. Never throws on a duplicate. */
export async function apply835File(
  file: { id: string | null; fileName: string },
  content: string,
  ctx: { actorUserId: string | null; trigger: string }
): Promise<EraFileOutcome> {
  const out: EraFileOutcome = { remittances: 0, duplicates: 0, posted: 0, review: 0, organizationIds: [], claimUpdates: [], summary: '' };
  const remits = parse835(content);
  const orgs = new Set<string>();
  const parts: string[] = [];

  for (const remit of remits) {
    out.remittances++;
    // TRN02 when present; else a hash of payer + amount + date + CLP set (never the file name, so a
    // re-delivered file under another name is still a duplicate)
    const key = remittanceKey(remit);
    const existing = await prisma.eraRemittance.findUnique({ where: { traceNumber_payerTraceId: key }, select: { id: true } });
    if (existing) {
      out.duplicates++;
      parts.push(`Payment ${remit.traceNumber} already received in an earlier 835; nothing posted again`);
      continue;
    }

    // Match + plan every CLP
    const planned: Array<{ era: EraClaim; match: MatchKind; claim: ClaimSnapshot | null; plan: PostingPlan; suggestions: Suggestion[]; dup: boolean }> = [];
    for (const era of remit.claims) {
      const m = await matchClaimReference(era.patientControlNumber);
      const claim = m.kind !== 'none' && m.kind !== 'ambiguous' ? await claimSnapshot(m.claimIds[0]) : null;
      const dup = era.patientControlNumber
        ? (await prisma.eraClaimPayment.count({
            where: {
              patientControlNumber: era.patientControlNumber,
              payerClaimControlNumber: era.payerClaimControlNumber || null,
              remittance: { traceNumber: key.traceNumber },
              postingStatus: { in: ['posted', 'pending', 'review'] },
            },
          })) > 0
        : false;
      const plan = planEraClaimPosting({
        era, match: claim ? m.kind : m.kind === 'ambiguous' ? 'ambiguous' : 'none', claim,
        remitBalanced: remitBalanced(remit), claimBalanced: claimBalanced(era, remit), duplicate: dup,
      });
      const suggestions = plan.decision === 'review' && !claim ? await suggestClaims(era) : [];
      planned.push({ era, match: m.kind, claim, plan, suggestions, dup });
      if (claim) orgs.add(claim.organizationId);
    }

    const remitOrg = planned.find((p) => p.claim)?.claim?.organizationId ?? (await singleOrganizationFallback());
    let remitRow: { id: string };
    try {
      remitRow = await prisma.eraRemittance.create({
        data: {
          inboundFileId: file.id,
          fileName: file.fileName,
          organizationId: remitOrg,
          traceNumber: key.traceNumber,
          payerTraceId: key.payerTraceId,
          payerName: remit.payerName || null,
          payerId: remit.payerId || null,
          payeeNpi: remit.payeeNpi || null,
          paymentMethod: remit.paymentMethod || null,
          creditDebit: remit.creditDebit || null,
          paymentAmount: remit.paymentAmount,
          paymentDate: isoDate(remit.paymentDate),
          providerAdjustments: remit.providerAdjustments as unknown as Prisma.InputJsonValue,
          plbTotal: Math.round(remit.providerAdjustments.reduce((t, p) => t + p.amount, 0) * 100) / 100,
          claimCount: remit.claims.length,
          balanced: remit.balanceErrors.length === 0,
          balanceErrors: remit.balanceErrors.slice(0, 50),
          status: 'review',
          claims: {
            create: planned.map((p) => {
              const orgId = p.claim?.organizationId
                ?? (p.suggestions.length && p.suggestions.every((s) => s.organizationId === p.suggestions[0].organizationId) ? p.suggestions[0].organizationId : remitOrg);
              return {
                seq: p.era.seq,
                organizationId: orgId,
                claimId: p.claim?.id ?? null,
                matchKind: p.claim ? p.match : p.match === 'ambiguous' ? 'ambiguous' : 'none',
                patientControlNumber: p.era.patientControlNumber.slice(0, 50),
                statusCode: p.era.statusCode.slice(0, 4),
                chargeAmount: p.era.charge,
                paidAmount: p.era.paid,
                patientResponsibility: p.era.patientResponsibility,
                filingIndicator: p.era.filingIndicator || null,
                payerClaimControlNumber: p.era.payerClaimControlNumber || null,
                patientLabel: [p.era.patientLastName, p.era.patientFirstName].filter(Boolean).join(', ') || null,
                memberId: p.era.memberId || p.era.insuredMemberId || null,
                serviceDateFrom: isoDate(p.era.statementFrom || p.era.lines[0]?.serviceDate || null),
                serviceDateTo: isoDate(p.era.statementTo || p.era.lines[p.era.lines.length - 1]?.serviceDateTo || null),
                claimAdjustments: p.era.claimAdjustments as unknown as Prisma.InputJsonValue,
                serviceLines: storedLines(p.era.lines) as unknown as Prisma.InputJsonValue,
                remarks: p.era.claimRemarks,
                outcome: p.plan.outcome,
                postingStatus: p.dup ? 'duplicate' : p.plan.decision === 'auto' ? 'pending' : 'review',
                reviewReasons: p.plan.reasons,
                suggestions: p.suggestions.length ? (p.suggestions as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
              };
            }),
          },
        },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        out.duplicates++;
        parts.push(`Payment ${remit.traceNumber} was stored by a concurrent run; skipped`);
        continue;
      }
      throw err;
    }

    const rows = await prisma.eraClaimPayment.findMany({ where: { remittanceId: remitRow.id }, select: { id: true, seq: true, postingStatus: true, claimId: true } });
    let posted = 0;
    let review = 0;
    for (const row of rows) {
      if (row.postingStatus === 'pending' && row.claimId) {
        try {
          const r = await postEraClaimPayment(row.id, { actorUserId: ctx.actorUserId, organizationId: null, manual: false, trigger: ctx.trigger });
          posted++;
          out.claimUpdates.push({ claimId: r.claimId, organizationId: r.organizationId, from: r.from, to: r.to, reason: r.summary });
        } catch (err) {
          review++;
          await prisma.eraClaimPayment.updateMany({
            where: { id: row.id, postingStatus: 'pending' },
            data: { postingStatus: 'review', reviewReasons: { push: `Auto-post failed: ${err instanceof Error ? err.message.slice(0, 200) : 'error'}` } },
          });
        }
      } else if (row.postingStatus === 'review') review++;
    }
    await prisma.eraRemittance.update({
      where: { id: remitRow.id },
      data: { status: review === 0 && posted === rows.length ? 'posted' : posted > 0 ? 'partial' : 'review' },
    });
    out.posted += posted;
    out.review += review;
    if (remitOrg) orgs.add(remitOrg);
    const plb = remit.providerAdjustments.length
      ? `; provider adjustments ${remit.providerAdjustments.map((p) => `${p.reasonCode}${PLB_REASON[p.reasonCode] ? ` ${PLB_REASON[p.reasonCode]}` : ''} $${p.amount.toFixed(2)}`).join(', ')}`
      : '';
    parts.push(
      `${remit.payerName || 'Payer'} ${remit.paymentMethod || ''} ${remit.traceNumber}: $${remit.paymentAmount.toFixed(2)}, ${remit.claims.length} claim(s), ${posted} posted, ${review} to ERA review${plb}${remit.balanceErrors.length ? '; 835 does not balance' : ''}`
    );

    await writeAuditLog({
      action: 'era_835_received',
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorUserId ? null : 'system',
      organizationId: remitOrg,
      resourceType: 'EraRemittance',
      resourceId: remitRow.id,
      userAgent: ctx.trigger,
      metadata: { file: file.fileName, claimCount: remit.claims.length, posted, review, balanced: remit.balanceErrors.length === 0, plbCount: remit.providerAdjustments.length },
    });
  }

  out.organizationIds = Array.from(orgs);
  out.summary = remits.length ? parts.join(' | ') : 'No 835 transaction set found';
  return out;
}

export class EraPostingError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

/**
 * Posts one stored CLP. Auto-post (manual=false) requires the row to be 'pending'; staff posting
 * from the review queue (manual=true) may pick the claim and post a 'review' row.
 */
export async function postEraClaimPayment(
  eraClaimId: string,
  opts: { actorUserId: string | null; organizationId: string | null; manual: boolean; claimId?: string; note?: string; trigger?: string }
): Promise<{ claimId: string; organizationId: string; from: string; to: string; summary: string; paymentId: string | null }> {
  const row = await prisma.eraClaimPayment.findUnique({ where: { id: eraClaimId }, include: { remittance: true } });
  if (!row) throw new EraPostingError('Remittance line not found', 404);
  if (opts.organizationId && row.organizationId && row.organizationId !== opts.organizationId) throw new EraPostingError('Remittance line not found', 404);
  const allowed = opts.manual ? ['review', 'pending'] : ['pending'];
  if (!allowed.includes(row.postingStatus)) throw new EraPostingError(`Already ${row.postingStatus}`, 409);

  const claimId = opts.claimId || row.claimId;
  if (!claimId) throw new EraPostingError('Choose the claim this payment belongs to', 400);
  const snapshot = await claimSnapshot(claimId);
  if (!snapshot) throw new EraPostingError('Claim not found', 404);
  if (opts.organizationId && snapshot.organizationId !== opts.organizationId) throw new EraPostingError('Claim not found', 404);

  const era = rowToEraClaim(row);
  const plan = planEraClaimPosting({ era, match: opts.claimId ? 'claim_id' : (row.matchKind as MatchKind), claim: snapshot, remitBalanced: true, claimBalanced: true, duplicate: false });
  if (plan.outcome === 'forwarded') {
    throw new EraPostingError('Forwarded claims have nothing to post; dismiss this line', 422);
  }
  // Take-backs (CLP02 22) and negative payments are posted by staff from the review queue only:
  // a negative INSURANCE payment row, audited, with the claim totals reduced accordingly
  if ((plan.outcome === 'reversal' || plan.outcome === 'negative') && !opts.manual) {
    throw new EraPostingError(`${plan.outcome === 'reversal' ? 'Reversals' : 'Negative payments'} are posted by staff from the ERA review queue`, 422);
  }
  if (!opts.manual && plan.decision !== 'auto') throw new EraPostingError(plan.reasons.join('; '), 422);

  const paidAt = row.remittance.paymentDate ?? new Date();
  const payerLabel = (row.remittance.payerName || 'payer').slice(0, 60);
  const lineIndex = new Map(plan.lineMatches.map((m) => [m.eraLineSeq, m.serviceLineId]));

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.eraClaimPayment.updateMany({
      where: { id: row.id, postingStatus: { in: allowed } },
      data: {
        postingStatus: 'posted',
        claimId,
        organizationId: snapshot.organizationId,
        postedAt: new Date(),
        postedBy: opts.actorUserId ?? 'system:waystar-835',
        resolutionNote: opts.note?.slice(0, 500) || null,
        ...(opts.claimId && opts.claimId !== row.claimId ? { matchKind: 'manual' } : {}),
      },
    });
    if (claimed.count !== 1) throw new EraPostingError('This remittance line was posted by another run', 409);

    let paymentId: string | null = null;
    // Positive payments, and (staff-posted) reversals / negative payments as negative rows
    if (plan.paidCents > 0 || (opts.manual && plan.paidCents < 0)) {
      const payment = await tx.payment.create({
        data: {
          organizationId: snapshot.organizationId,
          clientId: snapshot.clientId,
          claimId,
          amountCents: plan.paidCents,
          method: 'INSURANCE',
          paidAt,
          note: `ERA 835${plan.paidCents < 0 ? ` ${plan.outcome === 'reversal' ? 'reversal (CLP02 22)' : 'negative payment'}` : ''} ${row.remittance.paymentMethod || ''} ${row.remittance.traceNumber} · ${payerLabel}`.replace(/\s+/g, ' ').slice(0, 200),
        },
        select: { id: true },
      });
      paymentId = payment.id;
    }

    const adjustments = allAdjustments(era);
    if (adjustments.length) {
      await tx.eraAdjustment.createMany({
        data: adjustments.map((a) => ({
          eraClaimId: row.id,
          organizationId: snapshot.organizationId,
          claimId,
          level: a.lineSeq == null ? 'claim' : 'line',
          lineSeq: a.lineSeq,
          serviceLineId: a.lineSeq == null ? null : lineIndex.get(a.lineSeq) ?? null,
          procedureCode: a.lineSeq == null ? null : era.lines.find((l) => l.seq === a.lineSeq)?.procedureCode.slice(0, 10) ?? null,
          groupCode: a.group.slice(0, 2),
          carc: a.carc.slice(0, 5),
          amount: a.amount,
          quantity: a.quantity,
        })),
      });
    }

    const current = await tx.claim.findUnique({
      where: { id: claimId },
      select: { status: true, paidAmount: true, adjustmentAmount: true, patientResponsibility: true, denialReason: true, submissionData: true },
    });
    const from = current?.status ?? snapshot.status;
    const to = plan.nextStatus ?? from;
    const denialText = plan.denials.map((d) => d.reasonText).join(' | ');
    // Medicare -> Medicaid crossover: the payer forwarded the claim; no manual secondary claim
    const signal = crossoverSignal(era);
    const crossover = signal ? { detected: true, reason: signal, payer: payerLabel, remittanceTrace: row.remittance.traceNumber, at: new Date().toISOString() } : null;
    await tx.claim.update({
      where: { id: claimId },
      data: {
        status: to as 'PAID' | 'DENIED',
        // A second remittance on the same claim (correction, reversal, second payment) adds to what
        // was already posted: paid, adjustments and patient responsibility all accumulate
        ...accumulatedTotals(current ?? null, { paid: era.paid, adjustmentTotal: plan.adjustmentTotal, patientResponsibility: era.patientResponsibility }, snapshot.previouslyPosted),
        ...(crossover ? { submissionData: { ...jsonObj(current?.submissionData), crossover } as Prisma.InputJsonValue } : {}),
        eraProcessedAt: new Date(),
        paidAt: plan.nextStatus === 'PAID' ? paidAt : undefined,
        ...(era.payerClaimControlNumber ? { payerClaimControlNumber: era.payerClaimControlNumber } : {}),
        ...(plan.nextStatus === 'DENIED' ? { denialReason: `ERA 835 denied: ${denialText}`.slice(0, 1000) } : {}),
      },
    });

    for (const d of plan.denials) {
      const open = await tx.claimDenial.findFirst({ where: { claimId, status: 'OPEN', reasonCode: d.reasonCode }, select: { id: true } });
      if (open) continue;
      await tx.claimDenial.create({
        data: { organizationId: snapshot.organizationId, claimId, reasonCode: d.reasonCode, carcCode: d.carcCode || null, reasonText: d.reasonText, status: 'OPEN' },
      });
    }

    // Deposit view on the Payments page: one PaymentBatch per 835 payment and organization
    const batchNumber = `ERA-${row.remittance.traceNumber}${row.remittance.payerTraceId ? `-${row.remittance.payerTraceId.slice(-4)}` : ''}-${snapshot.organizationId.slice(-4)}`.slice(0, 80);
    const batch = await tx.paymentBatch.upsert({
      where: { batchNumber },
      update: {},
      create: {
        organizationId: snapshot.organizationId,
        batchNumber,
        payerSource: payerLabel,
        checkEftNumber: row.remittance.traceNumber,
        paymentDate: paidAt,
        totalAmount: num(row.remittance.paymentAmount),
        reconciled: false,
        postedById: opts.actorUserId ?? 'system:waystar-835',
      },
      select: { id: true },
    });
    await tx.paymentBatchLine.create({
      data: {
        batchId: batch.id,
        clientId: snapshot.clientId,
        claimId,
        dos: row.serviceDateFrom ?? paidAt,
        paidAmount: era.paid,
        adjustment: plan.adjustmentTotal,
        patientBalance: era.patientResponsibility,
      },
    });
    const linked = await tx.eraRemittance.updateMany({ where: { id: row.remittanceId, paymentBatchId: null }, data: { paymentBatchId: batch.id } });
    // First posting from this 835 payment: its PLB provider adjustments go in the batch once, so the
    // batch lines add up to BPR02 (claims paid - PLB)
    if (linked.count === 1) {
      const plb = plbBatchLines(Array.isArray(row.remittance.providerAdjustments) ? (row.remittance.providerAdjustments as Array<{ reasonCode: string; reference?: string; amount: number }>) : []);
      for (const p of plb) {
        await tx.paymentBatchLine.create({
          data: { batchId: batch.id, clientId: null, claimId: null, unmatchedLabel: p.label, dos: paidAt, paidAmount: p.paidAmount, adjustment: 0, patientBalance: 0 },
        });
      }
    }
    if (paymentId) await tx.eraClaimPayment.update({ where: { id: row.id }, data: { paymentId } });
    return { from, to, paymentId };
  });
  if (result.to === 'DENIED' && result.from !== 'DENIED') {
    await releasePriorAuthUsage({ organizationId: snapshot.organizationId, claimId, reason: 'denied on 835', actorUserId: opts.actorUserId });
  }

  await writeAuditLog({
    action: opts.manual ? 'era_835_posted_manual' : 'era_835_posted_auto',
    actorUserId: opts.actorUserId,
    actorRole: opts.actorUserId ? null : 'system',
    organizationId: snapshot.organizationId,
    resourceType: 'Claim',
    resourceId: claimId,
    patientId: snapshot.clientId,
    userAgent: opts.trigger ?? null,
    metadata: {
      eraClaimId: row.id, remittanceId: row.remittanceId, outcome: plan.outcome, from: result.from, to: result.to,
      paidCents: plan.paidCents, denials: plan.denials.length, paymentId: result.paymentId,
    },
  });
  // AutoPay: coinsurance / deductible after insurance processed the claim (opted-in clients only; master
  // switch default off). Background, never blocks or fails the posting; idempotent per ERA claim payment.
  if (era.patientResponsibility > 0 && plan.paidCents >= 0) {
    void import('@/lib/patientPayments/server')
      .then((m) => m.runAutopayAfterEra(row.id))
      .catch(() => {});
  }
  return { claimId, organizationId: snapshot.organizationId, from: result.from, to: result.to, summary: plan.summary, paymentId: result.paymentId };
}

type StoredRow = Prisma.EraClaimPaymentGetPayload<{ include: { remittance: true } }>;

function rowToEraClaim(row: Pick<StoredRow, 'seq' | 'patientControlNumber' | 'statusCode' | 'chargeAmount' | 'paidAmount' | 'patientResponsibility' | 'filingIndicator' | 'payerClaimControlNumber' | 'claimAdjustments' | 'serviceLines' | 'remarks' | 'memberId'>): EraClaim {
  const lines = (Array.isArray(row.serviceLines) ? row.serviceLines : []) as unknown as EraServiceLine[];
  return {
    seq: row.seq,
    patientControlNumber: row.patientControlNumber,
    statusCode: row.statusCode,
    charge: num(row.chargeAmount),
    paid: num(row.paidAmount),
    patientResponsibility: num(row.patientResponsibility),
    filingIndicator: row.filingIndicator || '',
    payerClaimControlNumber: row.payerClaimControlNumber || '',
    facilityCode: '', frequencyCode: '',
    patientLastName: '', patientFirstName: '', memberId: row.memberId || '', insuredMemberId: '', correctedMemberId: '', renderingNpi: '',
    statementFrom: null, statementTo: null, receivedDate: null,
    claimAdjustments: (Array.isArray(row.claimAdjustments) ? row.claimAdjustments : []) as unknown as CasAdjustment[],
    claimRemarks: row.remarks,
    coverageAmount: null,
    lines: lines.map((l) => ({ ...l, qualifier: 'HC', revenueCode: null, originalUnits: null, adjustments: l.adjustments || [], remarks: l.remarks || [], modifiers: l.modifiers || [] })),
  };
}

/** Staff dismiss a review line (handled outside Altrixs, not ours, reversal posted manually...). */
export async function dismissEraClaimPayment(eraClaimId: string, opts: { actorUserId: string; organizationId: string; note: string }) {
  const row = await prisma.eraClaimPayment.findUnique({ where: { id: eraClaimId }, select: { id: true, organizationId: true, claimId: true, remittanceId: true } });
  if (!row || (row.organizationId && row.organizationId !== opts.organizationId)) throw new EraPostingError('Remittance line not found', 404);
  const done = await prisma.eraClaimPayment.updateMany({
    where: { id: eraClaimId, postingStatus: { in: ['review', 'pending', 'duplicate'] } },
    data: { postingStatus: 'dismissed', resolutionNote: opts.note.slice(0, 500), postedBy: opts.actorUserId, postedAt: new Date(), organizationId: row.organizationId ?? opts.organizationId },
  });
  if (done.count !== 1) throw new EraPostingError('This line is no longer in review', 409);
  await writeAuditLog({
    action: 'era_835_dismissed', actorUserId: opts.actorUserId, organizationId: opts.organizationId,
    resourceType: 'EraClaimPayment', resourceId: eraClaimId, metadata: { remittanceId: row.remittanceId, claimId: row.claimId },
  });
}

// ─── Review queue ────────────────────────────────────────────────────────────

export type EraReviewItem = {
  id: string;
  remittanceId: string;
  payerName: string | null;
  traceNumber: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  postingStatus: string;
  outcome: string;
  statusText: string;
  claimControlNumber: string;
  payerClaimControlNumber: string | null;
  patientLabel: string | null;
  memberId: string | null;
  serviceDate: string | null;
  charge: number;
  paid: number;
  patientResponsibility: number;
  claimId: string | null;
  matchKind: string;
  reasons: string[];
  adjustments: string[];
  remarks: string[];
  lines: Array<{ seq: number; procedure: string; charge: number; paid: number; serviceDate: string | null; adjustments: string[]; remarks: string[] }>;
  suggestions: Array<{ claimId: string; score: number; why: string[] }>;
  resolutionNote: string | null;
};

export async function listEraReview(organizationId: string, opts: { includeResolved?: boolean; take?: number } = {}): Promise<EraReviewItem[]> {
  const rows = await prisma.eraClaimPayment.findMany({
    where: {
      organizationId,
      postingStatus: opts.includeResolved ? { in: ['review', 'duplicate', 'posted', 'dismissed'] } : { in: ['review', 'duplicate'] },
    },
    include: { remittance: { select: { payerName: true, traceNumber: true, paymentDate: true, paymentMethod: true } } },
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 100,
  });
  return rows.map((r) => {
    const lines = (Array.isArray(r.serviceLines) ? r.serviceLines : []) as unknown as EraServiceLine[];
    const claimAdj = (Array.isArray(r.claimAdjustments) ? r.claimAdjustments : []) as unknown as CasAdjustment[];
    const sugg = (Array.isArray(r.suggestions) ? r.suggestions : []) as unknown as Suggestion[];
    return {
      id: r.id,
      remittanceId: r.remittanceId,
      payerName: r.remittance.payerName,
      traceNumber: r.remittance.traceNumber,
      paymentDate: r.remittance.paymentDate?.toISOString().slice(0, 10) ?? null,
      paymentMethod: r.remittance.paymentMethod,
      postingStatus: r.postingStatus,
      outcome: r.outcome,
      statusText: CLP_STATUS[r.statusCode] || `CLP02 ${r.statusCode}`,
      claimControlNumber: r.patientControlNumber,
      payerClaimControlNumber: r.payerClaimControlNumber,
      patientLabel: r.patientLabel,
      memberId: r.memberId,
      serviceDate: r.serviceDateFrom?.toISOString().slice(0, 10) ?? null,
      charge: num(r.chargeAmount),
      paid: num(r.paidAmount),
      patientResponsibility: num(r.patientResponsibility),
      claimId: r.claimId,
      matchKind: r.matchKind,
      reasons: r.reviewReasons,
      adjustments: describeAdjustments(claimAdj),
      remarks: r.remarks.map(remarkText),
      lines: lines.map((l) => ({
        seq: l.seq,
        procedure: [l.procedureCode, ...(l.modifiers || [])].join('-'),
        charge: l.charge,
        paid: l.paid,
        serviceDate: l.serviceDate,
        adjustments: describeAdjustments(l.adjustments || []),
        remarks: (l.remarks || []).map(remarkText),
      })),
      // Only suggestions inside the viewer's organization
      suggestions: sugg.filter((s) => s.organizationId === organizationId).map((s) => ({ claimId: s.claimId, score: s.score, why: s.why })),
      resolutionNote: r.resolutionNote,
    };
  });
}

// ─── Primary adjudication for secondary / COB claims ─────────────────────────

export type PrimaryAdjudication = {
  claimId: string;
  eraClaimId: string;
  remittanceTraceNumber: string;
  payerName: string | null;
  /** N1*PR REF*2U / XV payer id from the 835 (may differ from the Waystar payer id) */
  payerId: string | null;
  /** CLP02 (1 primary, 19 primary + forwarded, ...) */
  statusCode: string;
  /** 2320 AMT*D */
  paidAmount: number;
  /** YYYY-MM-DD: BPR16 payment date (use as 2330B DTP*573 / 2430 DTP*573) */
  paidDate: string | null;
  chargeAmount: number;
  patientResponsibility: number;
  payerClaimControlNumber: string | null;
  /** 2320 CAS (claim-level adjustments) */
  adjustments: Array<{ group: string; reason: string; amount: number; quantity: number | null }>;
  /** 2430 SVD / CAS / DTP*573 — lineNumber is the 835 SVC order (= the 837 LX order of the primary claim) */
  lines: Array<{
    lineNumber: number;
    serviceLineId: string | null;
    procedureCode: string;
    modifiers: string[];
    chargeAmount: number;
    paidAmount: number;
    unitsPaid: number | null;
    paidDate: string | null;
    adjustments: Array<{ group: string; reason: string; amount: number; quantity: number | null }>;
  }>;
};

/**
 * What the primary payer did with a claim, from its latest POSTED 835 claim payment
 * (prefers CLP02 1 / 19, "processed as primary"). Null when no posted ERA exists.
 * The amounts map onto the 837P COB loops: AMT*D = paidAmount, 2320 CAS = adjustments,
 * 2430 = lines (SVD02 paidAmount, CAS, DTP*573 paidDate).
 */
export async function primaryAdjudication(claimId: string): Promise<PrimaryAdjudication | null> {
  const rows = await prisma.eraClaimPayment.findMany({
    where: { claimId, postingStatus: 'posted' },
    include: { remittance: { select: { traceNumber: true, payerName: true, payerId: true, paymentDate: true } }, adjustments: true },
    orderBy: { postedAt: 'desc' },
  });
  const row = rows.find((r) => r.statusCode === '1' || r.statusCode === '19') ?? rows[0];
  if (!row) return null;
  const lines = (Array.isArray(row.serviceLines) ? row.serviceLines : []) as unknown as EraServiceLine[];
  const paidDate = row.remittance.paymentDate?.toISOString().slice(0, 10) ?? null;
  const cas = (a: CasAdjustment) => ({ group: a.group, reason: a.carc, amount: a.amount, quantity: a.quantity });
  const claimAdj = (Array.isArray(row.claimAdjustments) ? row.claimAdjustments : []) as unknown as CasAdjustment[];
  return {
    claimId,
    eraClaimId: row.id,
    remittanceTraceNumber: row.remittance.traceNumber,
    payerName: row.remittance.payerName,
    payerId: row.remittance.payerId,
    statusCode: row.statusCode,
    paidAmount: num(row.paidAmount),
    paidDate,
    chargeAmount: num(row.chargeAmount),
    patientResponsibility: num(row.patientResponsibility),
    payerClaimControlNumber: row.payerClaimControlNumber,
    adjustments: claimAdj.map(cas),
    lines: lines.map((l) => ({
      lineNumber: l.seq,
      serviceLineId: row.adjustments.find((a) => a.lineSeq === l.seq)?.serviceLineId ?? null,
      procedureCode: l.procedureCode,
      modifiers: l.modifiers || [],
      chargeAmount: l.charge,
      paidAmount: l.paid,
      unitsPaid: l.unitsPaid,
      paidDate,
      adjustments: (l.adjustments || []).map(cas),
    })),
  };
}

/** Payer claim control number (CLP07 / 277CA REF*1K) for a corrected (7) or void (8) claim. */
export async function payerClaimControlNumberFor(claimId: string): Promise<string | null> {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { payerClaimControlNumber: true } });
  if (claim?.payerClaimControlNumber) return claim.payerClaimControlNumber;
  const era = await prisma.eraClaimPayment.findFirst({
    where: { claimId, payerClaimControlNumber: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { payerClaimControlNumber: true },
  });
  return era?.payerClaimControlNumber ?? null;
}
