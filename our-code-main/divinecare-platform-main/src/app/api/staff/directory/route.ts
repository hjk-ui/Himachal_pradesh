import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { listStaffUsers } from '@/lib/staff/manage';

export const runtime = 'nodejs';

/** Org staff names for pickers (forward, assign). No invite/admin fields. */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const users = await listStaffUsers(gate.organizationId);
    const directory = users
      .filter((u) => u.status === 'ACTIVE' || u.status === 'INVITED')
      .map((u) => ({
        id: u.id,
        name: u.name || u.email,
        email: u.email,
        role: u.role,
        roles: u.roles,
        status: u.status,
        image: u.image,
      }));
    return NextResponse.json({ success: true, users: directory });
  } catch (err) {
    console.error('[staff directory GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load staff directory' },
      { status: 500 }
    );
  }
}
