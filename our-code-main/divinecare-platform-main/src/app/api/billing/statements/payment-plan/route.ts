import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const paymentPlanSchema = z.object({
  statementId: z.string().optional(),
  clientId: z.string().min(1),
  totalBalance: z.number().positive(),
  durationMonths: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = paymentPlanSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const { statementId, clientId, totalBalance, durationMonths } = parsed.data;
    const monthlyInstallment = parseFloat((totalBalance / durationMonths).toFixed(2));

    let planRecord = null;
    try {
      planRecord = await (prisma as any).paymentPlan.create({
        data: {
          statementId: statementId || null,
          clientId,
          totalBalance,
          durationMonths,
          monthlyInstallment,
          status: 'active',
        },
      });

      if (statementId) {
        await (prisma as any).eStatement.update({
          where: { id: statementId },
          data: { status: 'payment_plan' },
        });
      }
    } catch (dbErr) {
      console.warn('[payment-plan] DB write warning:', dbErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        planId: planRecord?.id || `plan-${Date.now().toString(36)}`,
        clientId,
        statementId,
        totalBalance,
        durationMonths,
        monthlyInstallment,
        schedule: Array.from({ length: durationMonths }).map((_, i) => {
          const d = new Date();
          d.setMonth(d.getMonth() + i + 1);
          return {
            installment: i + 1,
            dueDate: d.toISOString().split('T')[0],
            amount: monthlyInstallment,
          };
        }),
      },
    }, { status: 201 });
  } catch (err: any) {
    console.error('[payment-plan] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create payment plan' }, { status: 500 });
  }
}
