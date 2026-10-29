import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import type { PaymentMethod } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { canMutateLedger } from '@/lib/billing/ledger';
import { batchCents, bulkBatchNumber } from '@/lib/billing/paymentBatchMath';

export const runtime = 'nodejs';

const batchLineSchema = z.object({
  clientId: z.string().optional().default(''),
  claimId: z.string().optional().default(''),
  clientName: z.string().max(200).optional(),
  dos: z.string().min(1),
  paid: z.number().min(0),
  adjustment: z.number().min(0).default(0),
});

const bulkBatchSchema = z.object({
  source: z.string().min(1),
  checkEftNumber: z.string().min(1),
  paymentDate: z.string().min(1),
  totalAmount: z.number().positive(),
  lines: z.array(batchLineSchema).min(1).max(500),
  method: z.enum(['CARD', 'ACH', 'CASH', 'CHECK', 'INSURANCE']).optional(),
  /** One per posting attempt (also accepted as the Idempotency-Key header) */
  idempotencyKey: z.string().trim().min(8).max(100).optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // Same billing role gate as POST.
  if (!canAccessPath(gate.role, '/dashboard/billing')) {
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'paymentBatch',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const batches = await prisma.paymentBatch.findMany({
      where: { organizationId: gate.organizationId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'paymentBatch',
      metadata: { count: batches.length, lineCount: batches.reduce((s, b) => s + b.lines.length, 0) },
    });

    return NextResponse.json({
      success: true,
      batches: batches.map(b => ({
        batchId: b.batchNumber,
        source: b.payerSource,
        refNumber: b.checkEftNumber,
        payDate: b.paymentDate.toISOString().split('T')[0],
        totalAmount: b.totalAmount,
        reconciled: b.reconciled,
        lines: b.lines.map(l => ({
          invoiceId: l.claimId || l.id,
          client: l.clientId || l.unmatchedLabel || 'Client',
          clientId: l.clientId,
          matched: Boolean(l.clientId),
          dos: l.dos.toISOString().split('T')[0],
          paid: l.paidAmount,
          adjustment: l.adjustment,
        })),
        postedAt: b.createdAt.toISOString(),
      })),
    });
  } catch (error: unknown) {
    console.error('[billing/payments/bulk-batch GET] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to query batches' }, { status: 500 });
  }
}

/**
 * Posts a deposit (check / EFT) as a payment batch. Every matched line becomes a ledger Payment
 * (so client balances and claim payments see it); unmatched lines stay in the batch for matching.
 * Totals are checked in integer cents. Claims must belong to the line's client in this
 * organization. Batch numbers are unique; an idempotency key (body or Idempotency-Key header)
 * makes a retry / double click return the first batch. Posting is not reconciliation: the batch
 * stays unreconciled until it is matched to the bank deposit.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  // Payer batch posting (insurance payments and adjustments): billing core only (canMutateLedger)
  if (!canMutateLedger(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'paymentBatch', outcome: 'DENIED', metadata: { reason: 'payer_posting_requires_billing' } });
    return NextResponse.json({ success: false, error: 'Only billing staff can post payer batches' }, { status: 403 });
  }

  try {
    const body = bulkBatchSchema.parse(await req.json());

    const sums = batchCents(body.totalAmount, body.lines);
    if (!sums.balanced) {
      return NextResponse.json(
        {
          success: false,
          error: `Batch allocation is not balanced. Check total is $${(sums.totalCents / 100).toFixed(2)}, but lines total $${(sums.appliedCents / 100).toFixed(2)} (difference: $${((sums.totalCents - sums.appliedCents) / 100).toFixed(2)}). Allocate until remaining is $0.00 to post.`,
        },
        { status: 422 }
      );
    }
    const paidAt = new Date(body.paymentDate);
    if (Number.isNaN(paidAt.getTime())) return NextResponse.json({ success: false, error: 'Invalid payment date' }, { status: 400 });

    const idempotencyKey = (body.idempotencyKey || req.headers.get('idempotency-key') || '').trim().slice(0, 100) || null;
    const batchNumber = bulkBatchNumber(gate.organizationId, idempotencyKey, {
      hash: (t) => createHash('sha256').update(t).digest('hex'),
      random: () => randomBytes(5).toString('hex'),
      now: new Date(),
    });
    if (idempotencyKey) {
      const prior = await prisma.paymentBatch.findFirst({ where: { batchNumber, organizationId: gate.organizationId }, include: { lines: true } });
      if (prior) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          data: { batchId: prior.batchNumber, status: 'POSTED', totalAmount: prior.totalAmount, linesCount: prior.lines.length },
        });
      }
    }

    // Every client id on the batch must be a client of the caller's org.
    const lineClientIds = [...new Set(body.lines.map((l) => l.clientId.trim()).filter(Boolean))];
    if (lineClientIds.length) {
      const found = await prisma.client.findMany({
        where: { id: { in: lineClientIds }, AND: [clientOrgFilter(gate.organizationId)] },
        select: { id: true },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const missing = lineClientIds.filter((id) => !foundIds.has(id));
      if (missing.length) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'paymentBatch',
          outcome: 'DENIED', metadata: { reason: 'client_not_found', clientIds: missing.slice(0, 50) },
        });
        return NextResponse.json({ success: false, error: 'One or more clients were not found' }, { status: 404 });
      }
    }
    // Every claim id must be a claim of this organization and of the line's client
    const claimIds = [...new Set(body.lines.map((l) => l.claimId.trim()).filter(Boolean))];
    if (claimIds.length) {
      const claims = await prisma.claim.findMany({ where: { id: { in: claimIds }, organizationId: gate.organizationId }, select: { id: true, clientId: true } });
      const clientOf = new Map(claims.map((c) => [c.id, c.clientId]));
      const bad = body.lines.filter((l) => l.claimId.trim() && clientOf.get(l.claimId.trim()) !== l.clientId.trim());
      if (bad.length) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'paymentBatch',
          outcome: 'DENIED', metadata: { reason: 'claim_not_found_for_client', claimIds: bad.map((l) => l.claimId).slice(0, 50) },
        });
        return NextResponse.json({ success: false, error: "One or more claims were not found for the line's client" }, { status: 404 });
      }
    }
    const method: PaymentMethod = body.method ?? (/self[\s-]*pay/i.test(body.source) ? 'CHECK' : 'INSURANCE');

    const { batch, paymentCount } = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.paymentBatch.create({
        data: {
          organizationId: gate.organizationId,
          batchNumber,
          payerSource: body.source,
          checkEftNumber: body.checkEftNumber,
          paymentDate: paidAt,
          totalAmount: sums.totalCents / 100,
          reconciled: false,
          postedById: gate.userId,
        },
      });

      let payments = 0;
      for (let i = 0; i < body.lines.length; i++) {
        const line = body.lines[i];
        const clientId = line.clientId.trim() || null;
        const paidCents = sums.lineCents[i];
        await tx.paymentBatchLine.create({
          data: {
            batchId: createdBatch.id,
            // Id column holds ids only; an unmatched line keeps the payer's label separately.
            clientId,
            unmatchedLabel: clientId ? null : line.clientName?.trim() || null,
            claimId: line.claimId.trim() || null,
            dos: new Date(line.dos),
            paidAmount: paidCents / 100,
            adjustment: Math.round(line.adjustment * 100) / 100,
          },
        });
        // Matched, non-zero lines post to the ledger (unmatched lines wait for matching)
        if (clientId && paidCents > 0) {
          await tx.payment.create({
            data: {
              organizationId: gate.organizationId,
              clientId,
              claimId: line.claimId.trim() || null,
              amountCents: paidCents,
              method,
              paidAt,
              note: `Batch ${batchNumber} · ${body.source} ${body.checkEftNumber}`.slice(0, 200),
              idempotencyKey: `${batchNumber}:${i + 1}`,
            },
          });
          payments++;
        }
      }
      return { batch: createdBatch, paymentCount: payments };
    });

    const clientIds = [...new Set(body.lines.map((l) => l.clientId).filter(Boolean))];
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'paymentBatch', resourceId: batch.id,
      patientId: clientIds.length === 1 ? clientIds[0] : null,
      metadata: {
        batchNumber: batch.batchNumber,
        payerSource: body.source,
        lineCount: body.lines.length,
        paymentCount,
        clientIds: clientIds.slice(0, 50),
        claimIds: claimIds.slice(0, 50),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        batchId: batch.batchNumber,
        status: 'POSTED',
        totalAmount: sums.totalCents / 100,
        linesCount: body.lines.length,
        paymentsPosted: paymentCount,
        unmatchedLines: body.lines.filter((l) => !l.clientId.trim()).length,
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    console.error('[billing/payments/bulk-batch POST] error:', error);
    return NextResponse.json({ success: false, error: 'Bulk batch post failed' }, { status: 500 });
  }
}
