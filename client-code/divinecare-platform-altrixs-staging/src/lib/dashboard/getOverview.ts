import { AppointmentStatus, RiskLevel } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { formatRelativeTime, shortClientName } from '@/lib/date/relativeTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { formatPracticeTime, toPracticeWallTime } from '@/lib/time/practiceTime';
import { addDaysYmd, practiceDayBounds, practiceTodayBounds, weekdayOfYmd } from '@/lib/dashboard/practiceDay';
import type { DashboardOverview } from '@/types/dashboard';

const RISK_UI: Record<RiskLevel, 'high' | 'medium' | 'low'> = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};


export async function getDashboardOverview(
  organizationId: string
): Promise<DashboardOverview> {
  // "Today" and the 7-day chart are practice-clock days (the server runs in UTC, so local
  // midnight here would be UTC midnight = 8 PM ET the evening before).
  const timeZone = await getPracticeTimeZone(organizationId);
  const today = practiceTodayBounds(timeZone);
  const dayStart = today.start;
  const dayEnd = new Date(today.end.getTime() - 1);
  const historyStart = practiceDayBounds(addDaysYmd(today.ymd, -6), timeZone).start;
  const dayKey = (date: Date) => toPracticeWallTime(date, timeZone).date;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const clientInOrg = clientOrgFilter(organizationId);

  const apptOrg = {
    OR: [{ organizationId }, { client: clientOrgFilter(organizationId) }],
  };

  // SSH tunnel pool is 3–5 connections. Never fire 14 queries at once (P2024).
  const [activeClients, newClientsThisWeek] = await Promise.all([
    prisma.client.count({ where: { active: true, ...clientInOrg } }),
    prisma.client.count({
      where: { active: true, createdAt: { gte: weekAgo }, ...clientInOrg },
    }),
  ]);
  const [unreviewedAlerts, highAlerts] = await Promise.all([
    prisma.riskAlert.count({
      where: { reviewed: false, client: clientInOrg },
    }),
    prisma.riskAlert.count({
      where: {
        reviewed: false,
        severity: RiskLevel.HIGH,
        client: clientInOrg,
      },
    }),
  ]);
  const [todaysAppointments, remainingToday] = await Promise.all([
    prisma.appointment.count({
      where: {
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED] },
        ...apptOrg,
      },
    }),
    prisma.appointment.count({
      where: {
        startsAt: { gte: new Date(), lte: dayEnd },
        status: AppointmentStatus.SCHEDULED,
        ...apptOrg,
      },
    }),
  ]);
  const unreadMessages = await prisma.message.count({
    where: { sender: 'CLIENT', readAt: null, client: clientInOrg },
  });

  const [recentAlerts, todayAppts] = await Promise.all([
    prisma.riskAlert.findMany({
      where: { reviewed: false, client: clientInOrg },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { client: { select: { name: true, image: true } } },
    }),
    prisma.appointment.findMany({
      where: {
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED] },
        ...apptOrg,
      },
      orderBy: { startsAt: 'asc' },
      take: 8,
      include: { client: { select: { name: true, image: true } } },
    }),
  ]);
  const clientRows = await prisma.client.findMany({
    where: { active: true, ...clientInOrg },
    orderBy: [{ riskLevel: 'asc' }, { name: 'asc' }],
    take: 8,
    include: {
      checkIns: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const [weeklyCheckIns, weeklyAppointments] = await Promise.all([
    prisma.checkIn.findMany({
      where: {
        createdAt: { gte: historyStart, lte: dayEnd },
        client: clientInOrg,
      },
      select: { mood: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.appointment.findMany({
      where: {
        startsAt: { gte: historyStart, lte: dayEnd },
        ...apptOrg,
      },
      select: { startsAt: true, status: true },
      orderBy: { startsAt: 'asc' },
    }),
  ]);
  const [weeklyAlerts, riskMix] = await Promise.all([
    prisma.riskAlert.findMany({
      where: { createdAt: { gte: historyStart, lte: dayEnd }, client: clientInOrg },
      select: { createdAt: true },
    }),
    prisma.client.groupBy({
      by: ['riskLevel'],
      where: { active: true, ...clientInOrg },
      _count: { _all: true },
    }),
  ]);

  // RiskLevel enum order in Prisma is HIGH, MEDIUM, LOW — we want high first.
  // Re-sort client rows by risk priority.
  const riskRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  clientRows.sort(
    (a, b) => riskRank[a.riskLevel] - riskRank[b.riskLevel] || a.name.localeCompare(b.name)
  );

  const stats: DashboardOverview['stats'] = [
    {
      label: 'Active clients',
      value: String(activeClients),
      delta: newClientsThisWeek > 0 ? `+${newClientsThisWeek} this week` : 'Steady this week',
      icon: '',
      color: '',
      border: '',
    },
    {
      label: 'Unreviewed alerts',
      value: String(unreviewedAlerts),
      delta: highAlerts > 0 ? `${highAlerts} high severity` : 'None high severity',
      icon: '',
      color: '',
      border: '',
    },
    {
      label: "Today's appointments",
      value: String(todaysAppointments),
      delta: `${remainingToday} remaining`,
      icon: '',
      color: '',
      border: '',
    },
    {
      label: 'Unread messages',
      value: String(unreadMessages),
      delta: unreadMessages > 0 ? 'Needs review' : 'Inbox clear',
      icon: '',
      color: '',
      border: '',
    },
  ];

  const alerts: DashboardOverview['alerts'] = recentAlerts.map((a) => ({
    id: a.id,
    clientId: a.clientId,
    clientName: shortClientName(a.client.name),
    clientImage: a.client.image,
    type: a.type,
    severity: RISK_UI[a.severity],
    time: formatRelativeTime(a.createdAt),
    mood: a.mood ?? 5,
  }));

  const appointments: DashboardOverview['appointments'] = todayAppts.map((a) => ({
    id: a.id,
    clientId: a.clientId,
    clientName: shortClientName(a.client.name),
    clientImage: a.client.image,
    time: formatPracticeTime(a.startsAt, timeZone, { withZone: true }),
    type: a.type,
    status: a.status === AppointmentStatus.COMPLETED ? 'completed' : 'upcoming',
    isVirtual: a.isVirtual,
  }));

  const clients: DashboardOverview['clients'] = clientRows.map((c) => {
    const last = c.checkIns[0];
    return {
      id: c.id,
      name: shortClientName(c.name),
      image: c.image,
      lastCheckIn: formatRelativeTime(last?.createdAt),
      mood: last?.mood ?? 5,
      risk: RISK_UI[c.riskLevel],
      streak: c.checkInStreak,
    };
  });

  const weeklyMap = new Map<
    string,
    DashboardOverview['weekly'][number]
  >();
  for (let i = 6; i >= 0; i -= 1) {
    const key = addDaysYmd(today.ymd, -i);
    weeklyMap.set(key, {
      label: weekdayOfYmd(key),
      mood: 0,
      checkIns: 0,
      appointments: 0,
      alerts: 0,
    });
  }

  for (const row of weeklyCheckIns) {
    const key = dayKey(row.createdAt);
    const entry = weeklyMap.get(key);
    if (!entry) continue;
    entry.mood += row.mood;
    entry.checkIns += 1;
  }

  for (const row of weeklyAppointments) {
    const key = dayKey(row.startsAt);
    const entry = weeklyMap.get(key);
    if (!entry) continue;
    entry.appointments += 1;
  }

  for (const row of weeklyAlerts) {
    const key = dayKey(row.createdAt);
    const entry = weeklyMap.get(key);
    if (!entry) continue;
    entry.alerts += 1;
  }

  const weekly = [...weeklyMap.values()].map((entry) => ({
    ...entry,
    mood: entry.checkIns > 0 ? Math.round((entry.mood / entry.checkIns) * 10) / 10 : 0,
  }));

  const riskBreakdown = [
    { name: 'High', value: 0, fill: '#E11D48' },
    { name: 'Medium', value: 0, fill: '#D97706' },
    { name: 'Low', value: 0, fill: '#2563EB' },
  ];
  for (const row of riskMix) {
    if (row.riskLevel === RiskLevel.HIGH) riskBreakdown[0].value = row._count._all;
    if (row.riskLevel === RiskLevel.MEDIUM) riskBreakdown[1].value = row._count._all;
    if (row.riskLevel === RiskLevel.LOW) riskBreakdown[2].value = row._count._all;
  }

  return { stats, alerts, appointments, clients, weekly, riskBreakdown };
}
