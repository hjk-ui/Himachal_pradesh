import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessCommunity, listCommunity } from '@/lib/community/manage';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessCommunity(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const data = await listCommunity(gate.organizationId);
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[community GET]', err);
    const missing =
      typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2021';
    return NextResponse.json(
      {
        success: false,
        error: missing
          ? 'Community tables are not on this database yet. Run prisma db push, then npm run db:seed:community.'
          : 'Could not load community outreach',
      },
      { status: 500 }
    );
  }
}
