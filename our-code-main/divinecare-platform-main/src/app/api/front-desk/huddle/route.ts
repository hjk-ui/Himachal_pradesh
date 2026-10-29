import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { buildFrontDeskHuddle } from '@/lib/front-desk/huddle';
import { HUDDLE_TABS, type HuddleTab } from '@/lib/front-desk/huddle-checklist';

export const runtime = 'nodejs';

const FD_ROLES = new Set([
  'FRONT_DESK',
  'OFFICE_MANAGER',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!FD_ROLES.has(gate.role) && !canAccessPath(gate.role, '/dashboard/appointments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const tabParam = new URL(req.url).searchParams.get('tab') || 'today';
  const tab = (HUDDLE_TABS.includes(tabParam as HuddleTab) ? tabParam : 'today') as HuddleTab;
  const huddle = await buildFrontDeskHuddle(gate.organizationId, tab);
  return NextResponse.json({ success: true, ...huddle });
}
