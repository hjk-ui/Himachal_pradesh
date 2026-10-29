import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditHr, hrGate, hrJsonError } from '@/lib/hr/server';
import { saveLocationMappings } from '@/lib/hr/homebase/data';
import { homebaseServerError } from '@/lib/hr/homebase/http';

export const runtime = 'nodejs';

const putSchema = z.object({
  mappings: z
    .array(z.object({ homebaseId: z.string().min(1).max(100), altrixsLocationId: z.string().min(1).max(100).nullable() }))
    .min(1)
    .max(50),
});

/** PUT /api/hr/homebase/locations: HR maps Homebase locations to Altrixs locations. */
export async function PUT(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return hrJsonError('Invalid location mapping', 400);
  try {
    const updated = await saveLocationMappings(g.ctx.organizationId, g.ctx.userId, parsed.data.mappings);
    await auditHr(g.ctx, req, 'HR_HOMEBASE_LOCATION_MAP', 'HomebaseLocation', null, { requested: parsed.data.mappings.length, updated });
    return NextResponse.json({ success: true, updated });
  } catch (err) {
    return homebaseServerError('locations', err);
  }
}
