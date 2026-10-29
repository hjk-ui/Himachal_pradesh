import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const batchLineSchema = z.object({
  clientId: z.string().optional().default(''),
  claimId: z.string().optional().default(''),
  clientName: z.string().optional(),
  dos: z.string().min(1),
  paid: z.number().min(0),
  adjustment: z.number().min(0).default(0),
});

const bulkBatchSchema = z.object({
  source: z.string().min(1),
  checkEftNumber: z.string().min(1),
  paymentDate: z.string().min(1),
  totalAmount: z.number().positive(),
  lines: z.array(batchLineSchema).min(1),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const batches = await prisma.paymentBatch.findMany({
      where: { organizationId: gate.organizationId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
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
          client: l.clientId || 'Client',
          dos: l.dos.toISOString().split('T')[0],
          paid: l.paidAmount,
          adjustment: l.adjustment,
        })),
        postedAt: b.createdAt.toISOString(),
      })),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to query batches';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = bulkBatchSchema.parse(await req.json());

    // Financial reconciliation calculation
    const appliedTotal = body.lines.reduce((s, l) => s + l.paid, 0);
    const remainder = Math.abs(body.totalAmount - appliedTotal);

    if (remainder > 0.009) {
      return NextResponse.json(
        {
          success: false,
          error: `Batch allocation is not balanced. Check total is $${body.totalAmount.toFixed(2)}, but lines total $${appliedTotal.toFixed(2)} (difference: $${(body.totalAmount - appliedTotal).toFixed(2)}). Allocate until remaining is $0.00 to post.`,
        },
        { status: 422 }
      );
    }

    const batchNumber = `BATCH-${Date.now().toString().slice(-6)}`;

    // Create PaymentBatch and lines in single transaction
    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.paymentBatch.create({
        data: {
          organizationId: gate.organizationId,
          batchNumber,
          payerSource: body.source,
          checkEftNumber: body.checkEftNumber,
          paymentDate: new Date(body.paymentDate),
          totalAmount: body.totalAmount,
          reconciled: true,
          postedById: gate.userId,
        },
      });

      for (const line of body.lines) {
        await tx.paymentBatchLine.create({
          data: {
            batchId: createdBatch.id,
            clientId: line.clientId || line.clientName || 'Unspecified',
            claimId: line.claimId || null,
            dos: new Date(line.dos),
            paidAmount: line.paid,
            adjustment: line.adjustment,
          },
        });
      }

      return createdBatch;
    });

    return NextResponse.json({
      success: true,
      data: {
        batchId: batch.batchNumber,
        status: 'POSTED_AND_RECONCILED',
        totalAmount: body.totalAmount,
        linesCount: body.lines.length,
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : 'Bulk batch post failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
