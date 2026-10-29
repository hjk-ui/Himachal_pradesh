import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { requireOrgContext } from '@/lib/auth/tenant';
import { createLocation, listLocations } from '@/lib/org/locations';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(20).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(40).optional(),
  postalCode: z.string().max(20).optional(),
  phone: z.string().max(40).optional(),
  timezone: z.string().max(80).optional(),
  isPrimary: z.boolean().optional(),
  active: z.boolean().optional(),
});

type SwitcherRow = {
  id: string;
  name: string;
  shortCode: string | null;
  brandColor: string | null;
  bgColor: string | null;
  borderColor: string | null;
  city: string | null;
  isFlagship: boolean | null;
  specialtyType: string | null;
};

/**
 * Legacy practice_locations rows for the sidebar location switcher (ids 'bowie' | 'ss' | ...,
 * which Appointment.location_id still uses). Display fields only: the NPIs and street addresses
 * that table was seeded with were placeholders (src/lib/practice/placeholders.ts), so they are
 * never returned. Real per-site NPI / address live on Location (Practice settings › Locations).
 */
async function switcherRows(): Promise<SwitcherRow[]> {
  try {
    return await prisma.$queryRawUnsafe<SwitcherRow[]>(`
      SELECT id, name, short_code AS "shortCode", brand_color AS "brandColor", bg_color AS "bgColor",
             border_color AS "borderColor", city, is_flagship AS "isFlagship", specialty_type AS "specialtyType"
      FROM practice_locations
      WHERE active = true
      ORDER BY is_flagship DESC, name ASC
    `);
  } catch {
    // Table absent or a different shape: the switcher keeps its built-in list
    return [];
  }
}

/** GET: this organization's locations (any authenticated clinic staff) plus the switcher rows. */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const activeOnly = new URL(req.url).searchParams.get('active') === '1';
  const [locations, data] = await Promise.all([listLocations(gate.organizationId, activeOnly), switcherRows()]);
  return NextResponse.json({ success: true, locations, data });
}

/** POST: create a location (Admin / Practice Director, audited). */
export async function POST(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  try {
    const body = createSchema.parse(await req.json());
    const result = await createLocation(body, gate.organizationId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await writeAuditLog({
      action: 'location_created',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'Location',
      resourceId: result.location.id,
    });
    return NextResponse.json({ success: true, location: result.location }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof z.ZodError ? 'Check the location fields' : 'Could not create location' },
      { status: 400 }
    );
  }
}
