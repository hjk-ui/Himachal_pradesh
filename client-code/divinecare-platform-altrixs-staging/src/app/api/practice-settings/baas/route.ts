import { NextResponse } from 'next/server';
import { loadPracticeOverview, savePracticeBaa } from '@/lib/practice/store';
import { practiceError, practiceGate } from '../_lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PUT: record a vendor BAA status (status and dates only). Leadership only, audited. */
export async function PUT(request: Request) {
  const g = await practiceGate('write', 'practice_baa_write');
  if (!g.ok) return g.response;
  try {
    await savePracticeBaa(g.actor, await request.json().catch(() => ({})));
    const overview = await loadPracticeOverview(g.actor.organizationId);
    return NextResponse.json({ success: true, canEdit: true, ...overview });
  } catch (error) {
    return practiceError(error, 'Could not save the BAA status');
  }
}
