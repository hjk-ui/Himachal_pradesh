import { prisma } from '@/lib/db/prisma';
import type { PatientContext } from '@/patient/domain';
import { getNextPatientAppointment } from '@/patient/application/appointments/service';
import { getLatestPatientConversation } from '@/patient/application/messages/service';
import { logPatientAudit, proxyAuditFields } from '@/patient/infrastructure/persistence/audit';
import { proxyMayUse } from '@/patient/domain/proxy-policy';
import { mayViewItem } from '@/patient/application/proxy/visibility';

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function safetyPlanForClient(organizationId: string, clientId: string) {
  const row = await prisma.clinicModuleState.findUnique({
    where: {
      organizationId_module: { organizationId, module: 'ehr-safety-plans' },
    },
    select: { data: true },
  });
  if (!row?.data || !Array.isArray(row.data)) {
    return { available: false, clientSigned: false };
  }
  const plans = row.data as { clientId?: string; clientSigned?: boolean; steps?: unknown[] }[];
  const match = plans.find(
    (p) => p.clientId === clientId
  );
  if (!match) return { available: false, clientSigned: false };
  const steps = Array.isArray(match.steps) ? match.steps : [];
  const filled = steps.filter((s) => {
    const step = s as { content?: string };
    return Boolean(step.content?.trim());
  }).length;
  return {
    available: filled > 0,
    clientSigned: Boolean(match.clientSigned),
  };
}

export async function buildPatientDashboard(ctx: PatientContext) {
  const todayStart = startOfLocalDay(new Date());
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [
    client,
    todayCheckIn,
    latestCheckIn,
    unreadMessages,
    latestThread,
    activePlan,
    weekCheckIns,
    upcomingAlerts,
    nextAppointment,
    safetyPlan,
    activeMedications,
  ] = await Promise.all([
    prisma.client.findUnique({
      where: { id: ctx.clientId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        checkInStreak: true,
        riskLevel: true,
      },
    }),
    prisma.checkIn.findFirst({
      where: { clientId: ctx.clientId, createdAt: { gte: todayStart } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.checkIn.findFirst({
      where: { clientId: ctx.clientId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.threadMessage.count({
      where: {
        // Same per-login thread scope as src/patient/application/messages/service.ts
        thread: { clientId: ctx.clientId, organizationId: ctx.organizationId, proxyPortalUserId: ctx.access?.isProxy ? ctx.accountId : null },
        senderType: 'FRONT_OFFICE',
        read: false,
      },
    }),
    getLatestPatientConversation(ctx),
    prisma.treatmentPlan.findFirst({
      where: { clientId: ctx.clientId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, goals: true, reviewDueAt: true },
    }),
    prisma.checkIn.findMany({
      where: { clientId: ctx.clientId, createdAt: { gte: weekAgo } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.riskAlert.findMany({
      where: { clientId: ctx.clientId, reviewed: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, type: true, severity: true, createdAt: true },
    }),
    getNextPatientAppointment(ctx.clientId, ctx),
    safetyPlanForClient(ctx.organizationId, ctx.clientId),
    prisma.medicationSchedule?.findMany
      ? prisma.medicationSchedule.findMany({
          where: { clientId: ctx.clientId, isActive: true },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            medicationName: true,
            dosage: true,
            instructions: true,
            doseTimes: true,
            startDate: true,
            endDate: true,
            isActive: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const moods = weekCheckIns.map((c) => c.mood);
  const stresses = weekCheckIns.map((c) => c.stress);
  const sleeps = weekCheckIns.map((c) => c.sleep).filter((s): s is number => s != null);

  const avg = (nums: number[]) =>
    nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;

  const goals = activePlan?.goals;
  const goalList = Array.isArray(goals) ? goals : [];
  const pendingTasks = goalList
    .slice(0, 5)
    .map((g, i) => {
      const item = g as { title?: string; text?: string; completed?: boolean };
      const title = item.title || item.text || `Goal ${i + 1}`;
      return { id: `goal-${i}`, title, completed: Boolean(item.completed) };
    })
    .filter((t) => !t.completed);

  const notifications = upcomingAlerts.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity.toLowerCase(),
    createdAt: a.createdAt.toISOString(),
    message: 'Your care team has an update for you',
  }));

  const recommendedWellnessTool =
    latestCheckIn && latestCheckIn.mood <= 4
      ? 'breathing'
      : latestCheckIn && latestCheckIn.stress >= 7
        ? 'grounding'
        : 'mindfulness';

  void logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    action: 'dashboard.viewed',
    ...proxyAuditFields(ctx),
  });

  const dashboard = {
    profile: client
      ? {
          id: client.id,
          name: client.name,
          email: ctx.email,
          phone: client.phone,
          image: client.image,
          checkInStreak: client.checkInStreak,
        }
      : null,
    todayCheckIn: todayCheckIn
      ? {
          completed: true,
          mood: todayCheckIn.mood,
          stress: todayCheckIn.stress,
          sleep: todayCheckIn.sleep,
          createdAt: todayCheckIn.createdAt.toISOString(),
        }
      : { completed: false, mood: null, stress: null, sleep: null, createdAt: null },
    latestScores: latestCheckIn
      ? {
          mood: latestCheckIn.mood,
          stress: latestCheckIn.stress,
          sleep: latestCheckIn.sleep,
          recordedAt: latestCheckIn.createdAt.toISOString(),
        }
      : { mood: null, stress: null, sleep: null, recordedAt: null },
    nextAppointment,
    unreadMessageCount: unreadMessages,
    unreadMessages,
    unread_messages: unreadMessages,
    unreadCount: unreadMessages,
    unread_count: unreadMessages,
    unread: unreadMessages,
    badge: unreadMessages,
    count: unreadMessages,
    latestConversation: latestThread
      ? {
          ...latestThread,
          preview: latestThread.lastMessage || latestThread.preview || '',
          lastMessage: latestThread.lastMessage || latestThread.preview || '',
          last_message: latestThread.lastMessage || latestThread.preview || '',
          latestMessage: latestThread.lastMessage || latestThread.preview || '',
          latest_message: latestThread.lastMessage || latestThread.preview || '',
          message: latestThread.lastMessage || latestThread.preview || '',
          content: latestThread.lastMessage || latestThread.preview || '',
          body: latestThread.lastMessage || latestThread.preview || '',
          unreadCount: latestThread.unreadCount ?? unreadMessages,
          unread_count: latestThread.unreadCount ?? unreadMessages,
          unread: latestThread.unreadCount ?? unreadMessages,
          unreadMessages: latestThread.unreadCount ?? unreadMessages,
          badge: latestThread.unreadCount ?? unreadMessages,
        }
      : null,
    medicationSummary: activePlan
      ? {
          planId: activePlan.id,
          title: activePlan.title,
          reviewDueAt: activePlan.reviewDueAt?.toISOString() ?? null,
          activeGoalsCount: goalList.length,
        }
      : null,
    weeklyProgress: {
      checkInsCompleted: weekCheckIns.length,
      averageMood: avg(moods),
      averageStress: avg(stresses),
      averageSleep: avg(sleeps),
    },
    pendingTasks,
    notifications,
    safetyPlan,
    recommendedWellnessTool,
    medications: (activeMedications || []).map((m) => ({
      id: m.id,
      medicationName: m.medicationName,
      dosage: m.dosage,
      instructions: m.instructions,
      doseTimes: m.doseTimes,
      startDate: m.startDate.toISOString(),
      endDate: m.endDate ? m.endDate.toISOString() : null,
      isActive: m.isActive,
    })),
  };
  if (!ctx.access?.isProxy) return dashboard;
  // Treatment plan goals = mental health record: proxy rules + the clinician's override for that plan
  const planVisible = activePlan ? await mayViewItem(ctx, 'treatment_plan', { id: activePlan.id, category: 'mental_health' }) : false;
  return proxyDashboard(dashboard, ctx.access, planVisible);
}

/**
 * Guardian / representative view of the dashboard: no mood check-ins or scores, risk notifications,
 * safety plan or wellness tool (the client's own); treatment plan goals and medications only when the
 * proxy rules allow (limited access + minor self-consent hides mental health records).
 */
function proxyDashboard<T extends Record<string, unknown>>(d: T, access: NonNullable<import('@/patient/domain').PatientContext['access']>, planVisible: boolean) {
  const mh = planVisible;
  return {
    ...d,
    todayCheckIn: { completed: false, mood: null, stress: null, sleep: null, createdAt: null },
    latestScores: { mood: null, stress: null, sleep: null, recordedAt: null },
    weeklyProgress: { checkInsCompleted: 0, averageMood: null, averageStress: null, averageSleep: null },
    notifications: [],
    safetyPlan: { available: false, clientSigned: false },
    recommendedWellnessTool: null,
    medicationSummary: mh ? d.medicationSummary : null,
    pendingTasks: mh ? d.pendingTasks : [],
    medications: proxyMayUse(access, 'medications') ? d.medications : [],
    profile: d.profile ? { ...(d.profile as Record<string, unknown>), checkInStreak: null } : null,
    actingAs: { isProxy: true, relationship: access.relationship, accessLevel: access.accessLevel, actorName: access.actorName },
  };
}
