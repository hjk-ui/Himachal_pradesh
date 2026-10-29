import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { loadCredentialBundle, loadEmployee, listChangeRequests } from '@/lib/hr/people';
import { computeExpirations, syncHrReminders } from '@/lib/hr/expirations';
import { canSeeDocument, HR_DOC_CATEGORIES, listHrDocuments } from '@/lib/hr/documents';
import { trainingMatrix } from '@/lib/hr/training';
import { balancesFor, ledgerFor, listTimeOff, SCHEDULE_INTEGRATION } from '@/lib/hr/timeOff';
import { listDiscipline, listGoals, listReviews } from '@/lib/hr/performance';
import { listChecklists } from '@/lib/hr/checklists';
import { listPolicies } from '@/lib/hr/policies';
import { hrGate, hrJsonError, hrServerError, isMissingTable, loadHrSettings, loadRoster, practiceTodayFor } from '@/lib/hr/server';
import { TIME_OFF_TYPES, ymd } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/**
 * GET /api/hr/me: "My HR" for any staff member: their own record (no pay data), credentials and
 * expirations, trainings / CEUs, time off, documents, onboarding tasks, reviews and goals,
 * policies to acknowledge, reminders, and for supervisors a "My team" summary (work data only).
 */
export async function GET() {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { organizationId, userId } = g.ctx;
  try {
    await syncHrReminders(organizationId).catch((err) => console.error('[hr reminders]', err));
    const roster = await loadRoster(organizationId);
    const view = await loadEmployee(g.ctx, userId, roster);
    if (!view) return hrJsonError('Your account was not found', 404);
    const team = roster.filter((p) => p.managerUserId === userId || p.clinicalSupervisorUserId === userId);
    const teamIds = team.map((p) => p.userId);
    const today = await practiceTodayFor(organizationId);
    const [settings, credentials, expirations, documents, training, requests, balances, ledger, reviews, goals, discipline, checklists, policies, changeRequests] =
      await Promise.all([
        loadHrSettings(organizationId),
        loadCredentialBundle(organizationId, userId),
        computeExpirations(organizationId, { userId, roster }),
        listHrDocuments(organizationId, userId),
        trainingMatrix(organizationId, { userIds: [userId], roster }),
        listTimeOff(g.ctx, { userIds: [userId, ...teamIds] }),
        balancesFor(organizationId, [userId, ...teamIds]),
        ledgerFor(organizationId, userId),
        listReviews(g.ctx, { userIds: [userId, ...teamIds] }),
        listGoals(organizationId, [userId, ...teamIds]),
        listDiscipline(organizationId, { userId, employeeView: true }),
        listChecklists(organizationId, { userIds: [userId, ...teamIds], status: 'active', today }),
        listPolicies(organizationId, userId),
        listChangeRequests(organizationId, { userId }),
      ]);
    let reminders: Awaited<ReturnType<typeof prisma.hrTask.findMany>> = [];
    try {
      reminders = await prisma.hrTask.findMany({ where: { organizationId, assigneeUserId: userId, status: 'open' }, orderBy: { dueOn: 'asc' }, take: 100 });
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }
    const myChecklists = checklists.filter((c) => c.userId === userId);
    // Tasks on other people's checklists assigned to me (e.g. a manager's 30-day check-in).
    const assignedToMe = checklists
      .filter((c) => c.userId !== userId)
      .flatMap((c) => c.tasks.filter((t) => t.assigneeUserId === userId && t.status === 'open').map((t) => ({ ...t, checklistId: c.id, staffName: c.staffName, kind: c.kind })));
    const teamAttention = teamIds.length ? (await computeExpirations(organizationId, { attentionOnly: true, roster: team })).items : [];
    return NextResponse.json({
      success: true,
      today: expirations.today,
      record: view.record,
      access: view.access,
      credentials,
      expirations: expirations.items,
      documents: documents.filter((d) => canSeeDocument({ userId, relationship: 'self', access: view.access }, d)),
      documentCategories: HR_DOC_CATEGORIES.filter((c) => !['discipline', 'performance', 'i9'].includes(c.key)),
      training: training.rows[0] ?? null,
      requirements: training.requirements,
      timeOff: {
        requests: requests.filter((r) => r.userId === userId),
        balance: balances[userId] ?? { pto: 0, sick: 0 },
        ledger,
        types: TIME_OFF_TYPES,
        scheduleIntegration: SCHEDULE_INTEGRATION,
      },
      reviews: reviews.filter((r) => r.userId === userId),
      goals: goals.filter((x) => x.userId === userId),
      discipline,
      checklists: myChecklists,
      assignedToMe,
      policies: policies.map((p) => ({ ...p, sections: p.sections.slice(0, 60) })),
      changeRequests,
      reminders: reminders.map((t) => ({ id: t.id, title: t.title, detail: t.detail, dueOn: ymd(t.dueOn), severity: t.severity, kind: t.kind })),
      aiPolicyQa: settings.aiPolicyQa,
      team: team.map((p) => ({
        userId: p.userId,
        name: p.name,
        jobTitle: p.jobTitle,
        role: p.role,
        hrStatus: p.hrStatus,
        attention: teamAttention.filter((i) => i.userId === p.userId).length,
        pendingTimeOff: requests.filter((r) => r.userId === p.userId && r.status === 'pending').length,
        reviewsOpen: reviews.filter((r) => r.userId === p.userId && r.status !== 'complete').length,
        balance: balances[p.userId] ?? { pto: 0, sick: 0 },
      })),
      teamTimeOff: requests.filter((r) => r.userId !== userId),
      teamReviews: reviews.filter((r) => r.userId !== userId),
      teamGoals: goals.filter((x) => x.userId !== userId),
    });
  } catch (err) {
    return hrServerError('my hr', err);
  }
}
