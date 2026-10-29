import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { canViewPrescriptions, canWritePrescriptions } from '@/lib/prescriptions/access';

export const dynamic = 'force-dynamic';

const PRESCRIPTION_SELECT = {
  id: true,
  rxNumber: true,
  clientId: true,
  clientName: true,
  prescriberId: true,
  prescriberName: true,
  prescriberNpi: true,
  prescriberDea: true,
  medicationName: true,
  medicationClass: true,
  deaSchedule: true,
  dosage: true,
  frequency: true,
  daysSupply: true,
  refillsAllowed: true,
  refillsRemaining: true,
  pharmacyId: true,
  pharmacyName: true,
  notesToPharmacist: true,
  pdmpChecked: true,
  pdmpCheckedAt: true,
  epcsAttested: true,
  status: true,
  transmissionStatus: true,
  lastFilledDate: true,
  rxnormId: true,
  rxnormTty: true,
  doseForm: true,
  strength: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EhrPrescriptionSelect;

export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canViewPrescriptions(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'prescription',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const clientId = sp.get('clientId');
    const status = sp.get('status');
    const schedule = sp.get('schedule');

    const where: Prisma.EhrPrescriptionWhereInput = {
      // Org scope (and assigned-client scope for caseload roles) through the linked Client.
      client: clientAccessWhere({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      }),
      ...(clientId ? { clientId } : {}),
      ...(status && status !== 'All' ? { status } : {}),
      ...(schedule && schedule !== 'All'
        ? schedule === 'Controlled'
          ? { deaSchedule: { not: 'None' } }
          : { deaSchedule: schedule }
        : {}),
    };

    const allRows = await prisma.ehrPrescription.findMany({
      where,
      select: PRESCRIPTION_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    // 42 CFR Part 2 / sensitive clients the caller may not open are dropped (same as the consents lists)
    const locked = await lockedSensitiveClientIds({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientIds: allRows.map((r) => r.clientId),
    });
    const rows = allRows.filter((r) => !locked.has(r.clientId));

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'prescription', patientId: clientId || null,
      metadata: {
        count: rows.length,
        sensitiveHidden: allRows.length - rows.length,
        status: status || null,
        schedule: schedule || null,
        clientIds: [...new Set(rows.map((r) => r.clientId))].slice(0, 50),
      },
    });

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch (err: unknown) {
    console.error('[API /api/prescriptions GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch prescriptions' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canWritePrescriptions(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'prescription',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json(
      { success: false, error: 'Only prescribers can issue prescriptions.' },
      { status: 403 }
    );
  }

  // Prescriptions are written, signed (EPCS) and transmitted in DrFirst Rcopia. This endpoint used to
  // save a local row marked 'Sent' without reaching any pharmacy; it no longer creates prescriptions.
  return NextResponse.json(
    {
      success: false,
      code: 'PRESCRIBE_IN_DRFIRST',
      error: 'Prescriptions are written and sent in DrFirst. Open the patient in DrFirst from E-Prescribing or the chart.',
    },
    { status: 410 }
  );

}
