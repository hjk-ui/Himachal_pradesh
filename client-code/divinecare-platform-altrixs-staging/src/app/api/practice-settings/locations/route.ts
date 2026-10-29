import { NextResponse } from 'next/server';
import { loadPracticeOverview, savePracticeLocation } from '@/lib/practice/store';
import { practiceError, practiceGate } from '../_lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PUT: create or update a service location's practice fields (address, phone, NPI, POS, hours). Leadership only, audited. */
export async function PUT(request: Request) {
  const g = await practiceGate('write', 'practice_location_write');
  if (!g.ok) return g.response;
  try {
    const location = await savePracticeLocation(g.actor, await request.json().catch(() => ({})));
    const overview = await loadPracticeOverview(g.actor.organizationId);
    return NextResponse.json({ success: true, canEdit: true, location, ...overview });
  } catch (error) {
    return practiceError(error, 'Could not save the location');
  }
}
