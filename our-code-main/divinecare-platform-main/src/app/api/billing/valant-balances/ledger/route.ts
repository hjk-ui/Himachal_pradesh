import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { parseDay } from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

const KINDS = ['opening_balance', 'prepayment_credit'] as const;

function summary(rows: Array<{ amountCents: number; asOf: Date }>) {
  const asOf = rows.length ? new Date(Math.max(...rows.map((row) => row.asOf.getTime()))).toISOString() : null;
  return {
    asOf,
    count: rows.length,
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action === 'preview') {
    const parsed = z.object({ action: z.literal('preview'), kind: z.enum(KINDS) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid preview' }, { status: 400 });
    const rows = await prisma.patientLedgerEntry.findMany({
      where: { organizationId: gate.organizationId, kind: parsed.data.kind, source: 'valant', supersededAt: null },
      select: { amountCents: true, asOf: true },
    });
    return NextResponse.json({ success: true, action: 'preview', kind: parsed.data.kind, ...summary(rows) });
  }
  if (action === 'unpost') {
    const parsed = z.object({
      action: z.literal('unpost'),
      kind: z.enum(KINDS).optional(),
      confirm: z.literal(true),
    }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Unpost requires confirm' }, { status: 400 });
    const result = await prisma.patientLedgerEntry.updateMany({
      where: {
        organizationId: gate.organizationId,
        source: 'valant',
        supersededAt: null,
        kind: parsed.data.kind ?? { in: [...KINDS] },
      },
      data: { supersededAt: new Date(), supersededByUserId: gate.userId },
    });
    return NextResponse.json({ success: true, action: 'unpost', count: result.count });
  }
  if (action === 'post') {
    const parsed = z.object({
      action: z.literal('post'),
      kind: z.enum(KINDS),
      confirm: z.literal(true),
      expected: z.object({
        asOf: z.string().nullable(),
        count: z.number().int().nonnegative(),
        totalCents: z.number().int(),
      }),
    }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Post requires confirm and expected totals' }, { status: 400 });
    const active = await prisma.patientLedgerEntry.findMany({
      where: { organizationId: gate.organizationId, kind: parsed.data.kind, source: 'valant', supersededAt: null },
    });
    const current = summary(active);
    const expectedAsOf = parsed.data.expected.asOf ? parseDay(parsed.data.expected.asOf.slice(0, 10)) : null;
    const currentDay = current.asOf ? current.asOf.slice(0, 10) : null;
    const expectedDay = parsed.data.expected.asOf ? parsed.data.expected.asOf.slice(0, 10) : null;
    if (
      current.count !== parsed.data.expected.count ||
      current.totalCents !== parsed.data.expected.totalCents ||
      currentDay !== expectedDay ||
      (expectedAsOf == null && parsed.data.expected.asOf != null && parsed.data.expected.count > 0)
    ) {
      return NextResponse.json({ success: false, error: 'Expected totals do not match the active ledger', current }, { status: 409 });
    }
    if (!active.length) {
      return NextResponse.json({ success: false, error: 'Nothing to post' }, { status: 400 });
    }
    const postedAt = new Date();
    const batchId = `ledger-${postedAt.getTime()}`;
    await prisma.$transaction(async (tx) => {
      for (const row of active) {
        const created = await tx.patientLedgerEntry.create({
          data: {
            organizationId: row.organizationId,
            clientId: row.clientId,
            kind: row.kind,
            amountCents: row.amountCents,
            asOf: row.asOf,
            source: 'valant',
            sourceRef: row.sourceRef,
            note: row.note,
            postingBatchId: batchId,
            postedById: gate.userId,
            postedAt,
          },
        });
        await tx.patientLedgerEntry.update({
          where: { id: row.id },
          data: { supersededAt: postedAt, supersededById: created.id, supersededByUserId: gate.userId },
        });
      }
    });
    return NextResponse.json({ success: true, action: 'post', kind: parsed.data.kind, count: active.length });
  }
  return NextResponse.json({ success: false, error: 'Unknown ledger action' }, { status: 400 });
}
