import { NextResponse } from 'next/server';
import { listHealthLakeJobs } from '@/lib/aws/healthlake';
import { healthLakeGate } from '../_lib/gate';

export const runtime = 'nodejs';

/** Import / export job rows for the caller's org (live jobs are refreshed when HealthLake is configured). */
export async function GET() {
  const g = await healthLakeGate();
  if (g.ok === false) return g.response;
  const jobs = await listHealthLakeJobs(g.gate.organizationId);
  return NextResponse.json({ success: true, jobs }, { headers: { 'Cache-Control': 'no-store' } });
}
