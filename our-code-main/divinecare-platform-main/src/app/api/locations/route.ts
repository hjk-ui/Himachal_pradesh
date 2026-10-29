import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const locations = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        id,
        name,
        short_code AS "shortCode",
        brand_color AS "brandColor",
        bg_color AS "bgColor",
        border_color AS "borderColor",
        address_line1 AS "addressLine1",
        city,
        state,
        zip_code AS "zipCode",
        location_npi AS "locationNpi",
        is_flagship AS "isFlagship",
        specialty_type AS "specialtyType",
        active
      FROM practice_locations
      WHERE active = true
      ORDER BY is_flagship DESC, name ASC
    `);

    return NextResponse.json({
      success: true,
      data: locations,
    });
  } catch {
    console.error('[API /api/locations GET] query failed');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch practice locations' },
      { status: 500 }
    );
  }
}
