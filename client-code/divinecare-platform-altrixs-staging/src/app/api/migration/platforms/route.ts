import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { PLATFORMS } from '@/lib/migration/fieldMaps';
import { ROLE_ALIASES, ROLE_ALIAS_COUNT } from '@/lib/migration/roleAliases';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    platforms: PLATFORMS,
    roleAliasCount: ROLE_ALIAS_COUNT,
    roleAliases: ROLE_ALIASES,
  });
}
