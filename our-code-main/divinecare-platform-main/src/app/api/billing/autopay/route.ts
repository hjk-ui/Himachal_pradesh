import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canMutateLedger, canReadLedger, listAutopay, upsertAutopay } from '@/lib/billing/ledger';
import {
  assertPatientPaymentsAllowed,
  patientPaymentsModeLabel,
} from '@/lib/billing/patient-payments-gate';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadLedger(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await listAutopay(actorFrom(gate));
    const paymentsGate = assertPatientPaymentsAllowed();
    return NextResponse.json({
      success: true,
      ...data,
      paymentsMode: patientPaymentsModeLabel(),
      paymentsAllowed: paymentsGate.ok,
    });
  } catch (err) {
    console.error('[billing autopay GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load autopay' }, { status: 500 });
  }
}

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  active: z.boolean(),
  last4: z.string().trim().max(4).optional().nullable(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const officeAutopay = gate.role === 'OFFICE_MANAGER';
  if ((!canMutateLedger(gate.role) && !officeAutopay) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    const result = await upsertAutopay(actorFrom(gate), body);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, enrollment: result.enrollment });
  } catch (err: unknown) {
    const missing =
      typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2021';
    const message = missing
      ? 'Autopay table is not on this database yet'
      : err instanceof z.ZodError
        ? 'Invalid autopay enrollment'
        : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not save autopay' }, { status: 400 });
  }
}
