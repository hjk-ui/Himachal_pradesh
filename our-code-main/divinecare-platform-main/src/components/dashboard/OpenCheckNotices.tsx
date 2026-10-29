import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireSession';

export async function SessionGapNotice() {
  const gate = await requireSession();
  if (!gate.ok || !gate.organizationId) return null;
  const role = String(gate.role || '');
  const leadership = role === 'ADMIN' || role === 'DIRECTOR' || role === 'PRACTICE_DIRECTOR';
  const clinician = role === 'THERAPIST' || role === 'CLINICIAN' || leadership;
  if (!clinician) return null;
  const gapCutoff = new Date(Date.now() - 21 * 86_400_000);
  const rows = await prisma.client.findMany({
    where: {
      AND: [
        { organizationId: gate.organizationId },
        { status: 'ACTIVE' },
        { appointments: { some: { status: 'COMPLETED' } } },
        { appointments: { none: { status: 'COMPLETED', startsAt: { gte: gapCutoff } } } },
        ...(leadership ? [] : [{ assignedToId: gate.session.user.id }]),
      ],
    },
    select: { id: true },
    take: 1,
  });
  if (!rows.length) return null;
  return <p className="px-6 pt-4 text-sm font-semibold text-slate-800">Session frequency gap</p>;
}

export async function SchedulingThreadNotice() {
  const gate = await requireSession();
  if (!gate.ok || !gate.organizationId) return null;
  if (gate.role !== 'FRONT_DESK' && gate.role !== 'OFFICE_MANAGER') return null;
  const rows = await prisma.messageThread.findMany({
    where: {
      organizationId: gate.organizationId,
      topic: { in: ['SCHEDULING', 'BILLING', 'GENERAL'] },
    },
    select: { lastMessage: true },
    orderBy: { lastMessageAt: 'desc' },
    take: 20,
  });
  return (
    <ul className="px-6 pt-4 text-sm text-slate-700">
      {rows.map((row, index) => (
        <li key={`${index}-${row.lastMessage || 'thread'}`}>{row.lastMessage}</li>
      ))}
    </ul>
  );
}

export async function IncidentNarrativeNotice() {
  const gate = await requireSession();
  if (!gate.ok || !gate.organizationId) return null;
  const review = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'].includes(gate.role);
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: gate.organizationId, module: { startsWith: 'incident:' } },
    select: { data: true },
    take: 40,
  });
  const lines = rows
    .map((row) => (row.data && typeof row.data === 'object' ? row.data : {}) as { description?: string; reportedById?: string })
    .filter((row) => review || row.reportedById === gate.session.user.id)
    .map((row) => String(row.description || ''))
    .filter(Boolean);
  return (
    <div className="px-6 pt-4 text-sm text-slate-700">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

export async function LivePlanNotice() {
  const gate = await requireSession();
  if (!gate.ok || !gate.organizationId) return null;
  const plan = await prisma.treatmentPlan.findFirst({
    where: { organizationId: gate.organizationId, title: { contains: 'Imported', mode: 'insensitive' } },
    select: { id: true },
  });
  if (!plan) return null;
  return (
    <form action={`/api/ehr/treatment-plans/${plan.id}`} method="post" className="px-6 pt-4">
      <input type="hidden" name="action" value="make-live" />
      <button
        type="submit"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700"
      >
        Use as live plan
      </button>
    </form>
  );
}
