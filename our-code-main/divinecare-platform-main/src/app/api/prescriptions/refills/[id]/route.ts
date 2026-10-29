import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auth } from '@/lib/auth';
import { writeAuditLog, auditMetaFromHeaders } from '@/lib/services/auditService';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    const body = await req.json();
    const { action, reason } = body;

    if (!['Approved', 'Denied'].includes(action)) {
      return NextResponse.json(
        { success: false, error: "Action must be 'Approved' or 'Denied'" },
        { status: 400 }
      );
    }

    if (action === 'Denied' && (!reason || !reason.trim())) {
      return NextResponse.json(
        { success: false, error: 'A denial reason is required (e.g. Appointment required for med review).' },
        { status: 400 }
      );
    }

    const refillRecords = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT * FROM ehr_refill_requests WHERE id = ${id} LIMIT 1
    `);

    if (refillRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Refill request not found' },
        { status: 404 }
      );
    }

    const refill = refillRecords[0];
    const decidedByName = session?.user?.name || 'Authorized Prescriber';

    if (action === 'Approved') {
      // 1. Update refill request
      await prisma.$executeRaw(Prisma.sql`
        UPDATE ehr_refill_requests
        SET status = 'Approved',
            decided_by_name = ${decidedByName},
            decided_at = NOW()
        WHERE id = ${id}
      `);

      // 2. Increment/update refills on ehr_prescriptions
      if (refill.prescription_id) {
        const requestedRefills = Number(refill.requested_refills) || 1;
        await prisma.$executeRaw(Prisma.sql`
          UPDATE ehr_prescriptions
          SET refills_remaining = refills_remaining + ${requestedRefills},
              last_filled_date = CURRENT_DATE,
              updated_at = NOW()
          WHERE id = ${String(refill.prescription_id)}
        `);
      }
    } else {
      // Denied
      await prisma.$executeRaw(Prisma.sql`
        UPDATE ehr_refill_requests
        SET status = 'Denied',
            decision_reason = ${reason || ''},
            decided_by_name = ${decidedByName},
            decided_at = NOW()
        WHERE id = ${id}
      `);
    }

    // HIPAA Audit Log
    const meta = auditMetaFromHeaders(req.headers);
    await writeAuditLog({
      actorUid: session?.user?.id || 'prescriber',
      actorRole: 'psychiatrist',
      action: action === 'Approved' ? 'WRITE' : 'DENIED',
      resourceType: 'prescription',
      resourceId: refill.prescription_id || id,
      patientId: refill.client_id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      outcome: 'SUCCESS',
      details: {
        refillRequestId: id,
        action,
        reason: reason || null,
        medicationName: refill.medication_name,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Refill request successfully ${action.toLowerCase()}.`,
    });
  } catch {
    console.error('[API /api/prescriptions/refills/[id] POST] request failed');
    return NextResponse.json(
      { success: false, error: 'Failed to process refill request' },
      { status: 500 }
    );
  }
}
