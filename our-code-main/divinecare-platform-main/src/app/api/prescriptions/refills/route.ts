import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');

    const filter = status && status !== 'All' ? Prisma.sql`WHERE status = ${status}` : Prisma.empty;
    const refills = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        id,
        prescription_id AS "prescriptionId",
        client_id AS "clientId",
        client_name AS "clientName",
        medication_name AS "medicationName",
        pharmacy_name AS "pharmacyName",
        requested_refills AS "requestedRefills",
        request_date AS "requestDate",
        last_filled_date AS "lastFilledDate",
        status,
        decision_reason AS "decisionReason",
        decided_by_name AS "decidedByName",
        decided_at AS "decidedAt"
      FROM ehr_refill_requests
      ${filter}
      ORDER BY request_date DESC`);

    return NextResponse.json({
      success: true,
      data: refills,
    });
  } catch {
    console.error('[API /api/prescriptions/refills GET] query failed');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch refill requests' },
      { status: 500 }
    );
  }
}
