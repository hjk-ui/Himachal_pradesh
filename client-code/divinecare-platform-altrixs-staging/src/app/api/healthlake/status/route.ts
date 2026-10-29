import { NextResponse } from 'next/server';
import { getHealthLakeStatus } from '@/lib/aws/healthlake';
import { healthLakeGate } from '../_lib/gate';

export const runtime = 'nodejs';

/** Connection state, org sync settings, outbox counts, last run, setup steps. No PHI. */
export async function GET() {
  const g = await healthLakeGate();
  if (g.ok === false) return g.response;
  try {
    const status = await getHealthLakeStatus(g.gate.organizationId);
    return NextResponse.json({ success: true, ...status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[healthlake status]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'HealthLake status failed' }, { status: 500 });
  }
}
