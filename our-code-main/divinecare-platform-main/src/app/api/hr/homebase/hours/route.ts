import { NextResponse } from 'next/server';
import { requireHomebaseAccess } from '@/lib/homebase/route-gate';
import { listHours, resolveRange } from '@/lib/homebase/sync';
import { HomebaseError } from '@/lib/homebase/client';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireHomebaseAccess();
  if (gate.ok === false) return gate.response;
  const url = new URL(req.url);
  const range = resolveRange(url.searchParams.get('start'), url.searchParams.get('end'));
  if (!range) {
    return NextResponse.json(
      { success: false, error: 'Use start and end dates (YYYY-MM-DD), at most 92 days apart.' },
      { status: 400 }
    );
  }
  try {
    const hours = await listHours(gate.organizationId, range);
    await gate.audit('HR_HOMEBASE_HOURS');
    return NextResponse.json({ success: true, range, hours });
  } catch (err) {
    const message = err instanceof HomebaseError ? err.message : 'Could not load Homebase hours';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
