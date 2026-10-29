import { NextResponse } from 'next/server';
import { requireHomebaseAccess } from '@/lib/homebase/route-gate';
import { listHomebaseLocationsFor } from '@/lib/homebase/sync';
import { HomebaseError } from '@/lib/homebase/client';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireHomebaseAccess();
  if (gate.ok === false) return gate.response;
  try {
    const locations = await listHomebaseLocationsFor(gate.organizationId);
    await gate.audit('HR_HOMEBASE_LOCATIONS');
    return NextResponse.json({ success: true, locations });
  } catch (err) {
    const message = err instanceof HomebaseError ? err.message : 'Could not load Homebase locations';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
