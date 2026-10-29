import { NextResponse } from 'next/server';
import { requireHomebaseAccess } from '@/lib/homebase/route-gate';
import { syncHomebase } from '@/lib/homebase/sync';

export const runtime = 'nodejs';

/** Sync now: reads from Homebase, writes only to our own link/run tables. */
export async function POST() {
  const gate = await requireHomebaseAccess();
  if (gate.ok === false) return gate.response;
  const result = await syncHomebase({ organizationId: gate.organizationId, trigger: 'manual', startedById: gate.userId });
  await gate.audit('HR_HOMEBASE_SYNC');
  if (result.connected && result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ success: true, ...result });
}
