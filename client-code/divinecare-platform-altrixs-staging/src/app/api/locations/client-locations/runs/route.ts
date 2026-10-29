import { NextResponse } from 'next/server';
import { listLocationRuns, requireLeadership } from '@/lib/locations/server';

export const dynamic = 'force-dynamic';

/** Applied "Recompute client locations" runs (counts only). */
export async function GET() {
  const gate = await requireLeadership();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  return NextResponse.json({ success: true, runs: await listLocationRuns(gate.organizationId) });
}
