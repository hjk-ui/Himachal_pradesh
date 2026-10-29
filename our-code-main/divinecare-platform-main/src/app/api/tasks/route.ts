import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listStaffTasks } from '@/lib/tasks/manage';
import { listHrInboxTasks } from '@/lib/tasks/hrInbox';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (gate.role === 'HR') {
    if (!canAccessPath(gate.role, '/dashboard/inbox')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const tasks = await listHrInboxTasks(gate.organizationId);
    return NextResponse.json({ success: true, tasks });
  }
  if (!canAccessPath(gate.role, '/dashboard/tasks')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const tasks = await listStaffTasks({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, tasks });
  } catch (err) {
    console.error('[tasks GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load tasks' }, { status: 500 });
  }
}
