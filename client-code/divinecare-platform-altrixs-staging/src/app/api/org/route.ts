import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getOrganizationWithLocations } from '@/lib/org/locations';

/** Authenticated clinic staff: own org + locations overview */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const organization = await getOrganizationWithLocations(gate.organizationId);
    return NextResponse.json({ success: true, organization });
  } catch (err) {
    console.error('[org]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load organization' },
      { status: 500 }
    );
  }
}
