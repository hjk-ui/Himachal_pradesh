import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { countUnsignedNotes, listStaffTasks, maskLockedTasks } from '@/lib/tasks/manage';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/tasks')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const actor = {
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    };
    const [raw, unsignedNotes] = await Promise.all([listStaffTasks(actor), countUnsignedNotes(actor)]);
    // Part 2 / protected records: mask tasks about clients the viewer cannot open (fail closed)
    const ids = [...new Set(raw.map((t) => t.clientId).filter((x): x is string => Boolean(x)))];
    let locked: Set<string> | null = new Set();
    if (ids.length) {
      try {
        locked = await lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds: ids });
      } catch (err) {
        console.error('[tasks GET] sensitive access lookup failed', err instanceof Error ? err.name : 'unknown');
        locked = null;
      }
    }
    const tasks = maskLockedTasks(raw, locked);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'task',
      metadata: { count: tasks.length, clientIds: tasks.map((t) => t.clientId).filter(Boolean).slice(0, 50) },
    });
    // counts are server totals (the task list itself is capped)
    return NextResponse.json({ success: true, tasks, counts: { unsignedNotes } });
  } catch (err) {
    console.error('[tasks GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load tasks' }, { status: 500 });
  }
}
