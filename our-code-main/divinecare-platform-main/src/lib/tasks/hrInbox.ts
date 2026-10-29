import { prisma } from '@/lib/db/prisma';
import type { StaffTask } from '@/lib/tasks/manage';

/** HR inbox: staff licenses and CEUs only. Never a client name. */
export async function listHrInboxTasks(organizationId: string): Promise<StaffTask[]> {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 90);
  const tasks: StaffTask[] = [];

  const credentials = await prisma.staffCredential.findMany({
    where: {
      organizationId,
      expiresAt: { lte: horizon },
    },
    orderBy: { expiresAt: 'asc' },
    take: 40,
    include: { user: { select: { name: true } } },
  });

  for (const row of credentials) {
    const days = Math.ceil((row.expiresAt.getTime() - Date.now()) / 86_400_000);
    const staffName = row.user.name || 'Staff member';
    tasks.push({
      taskId: `cred-${row.id}`,
      type: 'credential_expiring',
      priority: days <= 30 ? 'urgent' : 'normal',
      title: days < 0 ? 'License expired' : 'License expiring',
      description: `${staffName} · ${row.title}`,
      dueDate: row.expiresAt.toISOString().slice(0, 10),
      daysUntil: days,
      actionLabel: 'Open credentialing',
      actionHref: '/dashboard/hr/credentialing',
    });
    if (row.ceuRequired > row.ceuCompleted) {
      tasks.push({
        taskId: `ceu-${row.id}`,
        type: 'credential_expiring',
        priority: 'normal',
        title: 'CEUs due',
        description: `${staffName} · ${row.ceuCompleted} of ${row.ceuRequired} credits`,
        actionLabel: 'Open training',
        actionHref: '/dashboard/hr/training',
      });
    }
  }

  const ceus = await prisma.hrCeuProgress.findMany({
    where: { organizationId },
    take: 40,
  });
  for (const row of ceus) {
    if (row.creditsEarned >= row.creditsRequired) continue;
    tasks.push({
      taskId: `ceu-progress-${row.id}`,
      type: 'credential_expiring',
      priority: 'normal',
      title: 'CEUs due',
      description: `${row.clinician} · ${row.creditsEarned} of ${row.creditsRequired}`,
      actionLabel: 'Open training',
      actionHref: '/dashboard/hr/training',
    });
  }

  return tasks;
}
