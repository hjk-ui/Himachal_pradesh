import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { parseValantAutopayRow, type ValantAutopayPlan } from '@/lib/migration/valantAutopay';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  // Header-keyed rows from the Valant payment plan grid (Excel or CSV)
  rows: z.array(z.record(z.string().max(60), z.string().max(500))).min(1).max(5000),
});

/**
 * POST /api/migration/autopay — import Valant autopay plans (Active and Paused; Ended are skipped).
 * Patients are matched by Valant Pt. ID. Balances are stored for reference and never posted to the
 * ledger. Valant keeps the cards, so each plan needs its card captured again before it can charge.
 * Enrollments set up in Altrixs (not by this import) are left alone.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Practice Director or Admin can import autopay plans' },
      { status: 403 }
    );
  }

  try {
    const body = bodySchema.parse(await req.json());
    const errors: { row: number; error: string }[] = [];
    const plans: ValantAutopayPlan[] = [];
    let noPlan = 0;
    let ended = 0;
    body.rows.forEach((row, i) => {
      const r = parseValantAutopayRow(row);
      if (r.kind === 'plan') plans.push(r.plan);
      else if (r.kind === 'error') errors.push({ row: i + 2, error: r.error });
      else if (r.reason === 'no-plan') noPlan += 1;
      else if (r.reason === 'ended') ended += 1;
    });

    const clients = await prisma.client.findMany({
      where: {
        organizationId: gate.organizationId,
        sourcePlatform: 'valant',
        sourceId: { in: plans.map((p) => p.sourcePatientId) },
      },
      select: {
        id: true,
        sourceId: true,
        autopayEnrollment: { select: { id: true, source: true } },
        cardOnFile: { select: { id: true } },
      },
    });
    const bySource = new Map(clients.map((c) => [String(c.sourceId).toUpperCase(), c]));

    const asOf = new Date();
    let imported = 0;
    let keptAltrixs = 0;
    const notFound: string[] = [];
    const preview: Record<string, unknown>[] = [];
    const touchedClientIds: string[] = [];

    for (const p of plans) {
      const client = bySource.get(p.sourcePatientId);
      if (!client) {
        notFound.push(p.sourcePatientId);
        continue;
      }
      if (client.autopayEnrollment && client.autopayEnrollment.source !== 'valant') {
        keptAltrixs += 1;
        continue;
      }
      const plan = {
        source: 'valant',
        planStatus: p.planStatus,
        statusFlag: p.statusFlag,
        amountCents: p.amountCents,
        upToBalance: p.upToBalance,
        amountLabel: p.amountLabel,
        recurrence: p.recurrence,
        nextChargeAt: p.nextChargeAt,
        endsAt: p.endsAt,
        cardLabel: p.cardLabel,
        cardExpiry: p.cardExpiry,
        sourceBalanceCents: p.balanceCents,
        sourceUnappliedCreditCents: p.unappliedCreditCents,
        sourcePrepaymentCents: p.prepaymentCents,
        sourceAsOf: asOf,
      };
      // A card captured in Altrixs since the last import keeps its own last 4 and on/off state
      const cardState = client.cardOnFile ? {} : { active: p.planStatus === 'Active', last4: p.last4 };
      if (preview.length < 10) {
        preview.push({
          plan: p.planStatus,
          flag: p.statusFlag,
          amount: p.amountLabel,
          recurrence: p.recurrence,
          next: p.nextChargeAt?.toISOString().slice(0, 10) ?? null,
        });
      }
      if (!body.dryRun) {
        await prisma.autopayEnrollment.upsert({
          where: { clientId: client.id },
          create: { organizationId: gate.organizationId, clientId: client.id, active: false, ...cardState, ...plan },
          update: { ...cardState, ...plan },
        });
      }
      imported += 1;
      touchedClientIds.push(client.id);
    }

    for (const id of notFound) errors.push({ row: 0, error: `Patient ${id} not found — import Valant clients first` });

    const summary = {
      totalRows: body.rows.length,
      plans: plans.length,
      imported: body.dryRun ? 0 : imported,
      wouldImport: body.dryRun ? imported : undefined,
      active: plans.filter((p) => p.planStatus === 'Active').length,
      paused: plans.filter((p) => p.planStatus === 'Paused').length,
      planFailedFlag: plans.filter((p) => p.statusFlag).length,
      skippedEnded: ended,
      skippedNoPlan: noPlan,
      keptAltrixsEnrollment: keptAltrixs,
      patientsNotFound: notFound.length,
      errorRows: errors.length,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'autopay', platform: body.platform, dryRun: true, ...summary, clientIds: touchedClientIds.slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, preview, errors: errors.slice(0, 50), jobId: null });
    }

    const status = errors.length === 0 ? 'success' : imported > 0 ? 'partial' : 'failed';
    const job = await prisma.migrationJob.create({
      data: {
        organizationId: gate.organizationId,
        type: 'autopay',
        platform: 'valant',
        total: plans.length,
        imported,
        errors: errors.length,
        status,
        createdById: gate.userId,
        errorJson: errors.length ? (errors.slice(0, 100) as Prisma.InputJsonValue[]) : undefined,
      },
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'autopay', platform: body.platform, dryRun: false, jobId: job.id, status, ...summary, clientIds: touchedClientIds.slice(0, 50) },
    });

    return NextResponse.json({ success: true, dryRun: false, ...summary, preview, errors: errors.slice(0, 50), jobId: job.id, status });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid import payload', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[migration/autopay POST]', err);
    return NextResponse.json({ success: false, error: 'Autopay import failed' }, { status: 500 });
  }
}
