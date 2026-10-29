import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canMutateLedger } from '@/lib/billing/ledger';
import { clientByIdWhere } from '@/lib/clients/orgScope';

export const dynamic = 'force-dynamic';

const paymentPlanSchema = z.object({
  statementId: z.string().optional(),
  clientId: z.string().min(1),
  totalBalance: z.number().positive(),
  durationMonths: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]),
});

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!canMutateLedger(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'paymentPlan',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const json = await req.json().catch(() => null);
    const parsed = paymentPlanSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const { statementId, clientId, totalBalance, durationMonths } = parsed.data;

    const client = await prisma.client.findFirst({
      where: clientByIdWhere(clientId, gate.organizationId),
      select: { id: true },
    });
    if (!client) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'paymentPlan', patientId: clientId,
        outcome: 'DENIED', metadata: { reason: 'client_not_found', statementId: statementId ?? null },
      });
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    if (statementId) {
      const statement = await prisma.eStatement.findFirst({
        where: { id: statementId, organizationId: gate.organizationId, clientId: client.id },
        select: { id: true },
      });
      if (!statement) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'paymentPlan', patientId: client.id,
          outcome: 'DENIED', metadata: { reason: 'statement_not_found', statementId },
        });
        return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
      }
    }

    const monthlyInstallment = parseFloat((totalBalance / durationMonths).toFixed(2));

    let planRecord: { id: string } | null = null;
    try {
      planRecord = await prisma.$transaction(async (tx) => {
        const plan = await tx.paymentPlan.create({
          data: {
            statementId: statementId || null,
            clientId: client.id,
            totalBalance,
            durationMonths,
            monthlyInstallment,
            status: 'active',
          },
          select: { id: true },
        });
        if (statementId) {
          await tx.eStatement.update({
            where: { id: statementId },
            data: { status: 'payment_plan' },
          });
        }
        return plan;
      });
    } catch (dbErr) {
      console.warn('[payment-plan] DB write warning:', dbErr);
    }

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'paymentPlan',
      resourceId: planRecord?.id ?? null, patientId: client.id,
      outcome: planRecord ? 'SUCCESS' : 'FAILURE',
      metadata: { statementId: statementId ?? null, durationMonths, persisted: Boolean(planRecord) },
    });

    return NextResponse.json({
      success: true,
      data: {
        planId: planRecord?.id || `plan-${Date.now().toString(36)}`,
        clientId: client.id,
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
  } catch (err: unknown) {
    console.error('[payment-plan] error:', err);
    return NextResponse.json({ error: 'Failed to create payment plan' }, { status: 500 });
  }
}
