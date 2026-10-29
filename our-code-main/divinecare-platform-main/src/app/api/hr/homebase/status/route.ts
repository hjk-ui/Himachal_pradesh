import { NextResponse } from 'next/server';
import { requireHomebaseAccess } from '@/lib/homebase/route-gate';
import { getHomebaseStatus } from '@/lib/homebase/sync';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireHomebaseAccess();
  if (gate.ok === false) return gate.response;
  const status = await getHomebaseStatus(gate.organizationId);
  await gate.audit('HR_HOMEBASE_STATUS');
  return NextResponse.json({ success: true, ...status });
}
