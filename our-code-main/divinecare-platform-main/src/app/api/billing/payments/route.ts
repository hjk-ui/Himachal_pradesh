import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { prisma } from '@/lib/db/prisma';
import {
  PAYMENT_METHODS,
  canMutateLedger,
  canReadLedger,
  createPayment,
  listPayments,
} from '@/lib/billing/ledger';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadLedger(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/payments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await listPayments(actorFrom(gate));
    const payments = gate.role === 'FRONT_DESK'
      ? data.payments.filter((row) => row.method !== 'INSURANCE' && !row.claimId)
      : data.payments;
    let ledgerEntries: Array<{
      id: string;
      clientId: string;
      kind: string;
      amountCents: number;
      asOf: string;
      source: string;
      note: string | null;
      supersededAt: null;
    }> = [];
    try {
      const rows = await prisma.patientLedgerEntry.findMany({
        where: {
          organizationId: gate.organizationId,
          supersededAt: null,
          client: clientAccessWhere({
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role,
          }),
        },
        select: { id: true, clientId: true, kind: true, amountCents: true, asOf: true, source: true, note: true },
        orderBy: { asOf: 'desc' },
        take: 200,
      });
      ledgerEntries = rows.map((row) => ({
        ...row,
        asOf: row.asOf.toISOString(),
        supersededAt: null,
      }));
    } catch {
      ledgerEntries = [];
    }
    return NextResponse.json({ success: true, ...data, payments, ledgerEntries });
  } catch (err) {
    console.error('[billing payments GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load payments' }, { status: 500 });
  }
}

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  claimId: z.string().min(1).max(128).optional().nullable(),
  amountCents: z.number().int(),
  method: z.enum(PAYMENT_METHODS),
  note: z.string().trim().max(400).optional().nullable(),
  paidAt: z.string().trim().max(40).optional().nullable(),
  kind: z.enum(['copay', 'adjustment', 'legacy', 'chargeback']).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing/payments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const parsed = createSchema.parse(await req.json());
    const kind = parsed.kind || (/^copay\b/i.test(parsed.note || '') ? 'copay' : 'adjustment');
    const patientSide = gate.role === 'FRONT_DESK' || gate.role === 'OFFICE_MANAGER';
    if (patientSide) {
      if (parsed.method === 'INSURANCE' || parsed.method === 'STUB') {
        return NextResponse.json({ success: false, error: 'Insurance payments are refused' }, { status: 403 });
      }
      if (parsed.claimId) {
        return NextResponse.json({ success: false, error: 'A payment tied to a claim is refused' }, { status: 403 });
      }
      if (kind === 'legacy' || kind === 'chargeback') {
        return NextResponse.json({ success: false, error: 'Opening balances are refused' }, { status: 403 });
      }
    }
    if (gate.role === 'FRONT_DESK' && kind !== 'copay') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (!patientSide && !canMutateLedger(gate.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const { kind: _kind, ...payment } = parsed;
    const note = kind === 'chargeback'
      ? 'Ins Chg Back'
      : kind === 'copay'
        ? (/^copay\b/i.test(parsed.note || '') ? parsed.note : `copay ${parsed.note || ''}`.trim())
        : kind === 'legacy'
          ? parsed.note || 'Legacy balance'
          : parsed.note;
    const result = await createPayment(actorFrom(gate), {
      ...payment,
      amountCents: kind === 'chargeback' ? Math.abs(payment.amountCents) : payment.amountCents,
      note,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    if (kind === 'legacy') {
      await prisma.claim.create({
        data: {
          organizationId: gate.organizationId,
          clientId: parsed.clientId,
          cptCode: '99213',
          amountCents: Math.abs(parsed.amountCents),
          status: 'SUBMITTED',
          clearinghouseProvider: 'legacy',
          submissionData: { legacyBalance: true },
          createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        },
      });
    }
    return NextResponse.json({ success: true, payment: result.payment }, { status: 201 });
  } catch (err: unknown) {
    const missing =
      typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2021';
    const message = missing
      ? 'Payments table is not on this database yet'
      : err instanceof z.ZodError
        ? 'Invalid payment'
        : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not record payment' }, { status: 400 });
  }
}
