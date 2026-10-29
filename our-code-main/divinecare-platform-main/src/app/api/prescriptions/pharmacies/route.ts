import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const pharmacies = await prisma.$queryRaw<any[]>(Prisma.sql`
       SELECT id, ncpdp_id AS "ncpdpId", store_name AS "storeName", chain_name AS "chainName",
              phone, fax, address_line1 AS "addressLine1", city, state, zip_code AS "zipCode", active
       FROM practice_pharmacies
       WHERE active = true
       ORDER BY store_name ASC`);

    return NextResponse.json({
      success: true,
      data: pharmacies,
    });
  } catch {
    console.error('[API /api/prescriptions/pharmacies] query failed');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pharmacies' },
      { status: 500 }
    );
  }
}
