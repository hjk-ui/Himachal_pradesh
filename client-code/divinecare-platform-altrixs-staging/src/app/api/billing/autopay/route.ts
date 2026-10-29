import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canReadLedger, listAutopay, stubChargesAllowed, upsertAutopay } from '@/lib/billing/ledger';
import { canManageAutopayEnrollment } from '@/lib/patientPayments/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { autopayDetails } from './autopayDetails';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadLedger(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await listAutopay(actorFrom(gate));
    const details = await autopayDetails(gate.organizationId, data.enrollments.map((e) => e.clientId));
    const enrollments = data.enrollments.map((e) => ({
      ...e,
      ...(details.get(e.clientId) ?? { mrn: null, card: null, lastCharge: null }),
    }));
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'autopayEnrollment',
      metadata: { count: enrollments.length },
    });
    return NextResponse.json({
      success: true,
      ...data,
      enrollments,
      timeZone: await getPracticeTimeZone(gate.organizationId),
      // Enroll / pause / resume / cancel and in-office card capture: front desk, office manager, billing, leadership
      canMutate: canManageAutopayEnrollment(gate.role),
      // The stub posts a STUB payment without moving money: development + ALLOW_STUB_CHARGES=1 only (ledger.stubChargesAllowed)
      stubChargeAvailable: stubChargesAllowed(),
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
  if (!canManageAutopayEnrollment(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    const result = await upsertAutopay(actorFrom(gate), body);
    if (!result.ok) {
      if (result.status === 404) {
        await auditPhiAccess({
          gate, req, action: 'WRITE', resourceType: 'autopayEnrollment', patientId: body.clientId,
          outcome: 'DENIED', metadata: { reason: 'client_not_found' },
        });
      }
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'autopayEnrollment',
      resourceId: result.enrollment.enrollmentId, patientId: result.enrollment.clientId,
      metadata: { fields: ['active', ...(body.last4 !== undefined ? ['last4'] : [])] },
    });
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

const patchSchema = z.object({
  clientId: z.string().min(1).max(128),
  action: z.literal('cancel'),
});

/** Cancel an enrollment: stops it (active off) and marks the plan Ended today. Nothing is deleted. */
export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canManageAutopayEnrollment(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  try {
    const existing = await prisma.autopayEnrollment.findFirst({
      where: { clientId: body.clientId, organizationId: gate.organizationId },
      select: { id: true, source: true },
    });
    if (!existing) {
      await auditPhiAccess({
        gate, req, action: 'WRITE', resourceType: 'autopayEnrollment', patientId: body.clientId,
        outcome: 'DENIED', metadata: { reason: 'enrollment_not_found', op: 'cancel' },
      });
      return NextResponse.json({ success: false, error: 'Enrollment not found' }, { status: 404 });
    }
    await prisma.autopayEnrollment.update({
      where: { id: existing.id },
      data: {
        active: false,
        planStatus: 'Ended',
        endsAt: new Date(),
        // A plan with a source is shown with its status; Altrixs enrollments get one so "Ended" shows
        source: existing.source ?? 'altrixs',
      },
    });
    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'autopayEnrollment', resourceId: existing.id,
      patientId: body.clientId, metadata: { op: 'cancel', fields: ['active', 'planStatus', 'endsAt'] },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[billing autopay PATCH]', err);
    return NextResponse.json({ success: false, error: 'Could not cancel the enrollment' }, { status: 500 });
  }
}
