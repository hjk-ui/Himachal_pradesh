import {
  AppointmentStatus,
  MessageSender,
  PrismaClient,
  PriorAuthStatus,
  RiskLevel,
  Role,
  TreatmentPlanStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

function atToday(hours: number, minutes: number) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function atDayOffset(daysAgoCount: number, hours: number, minutes: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgoCount);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function daysAgo(d: number) {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

async function main() {
  const passwordHash = await hash('Altrixs@123', 12);

  // Keep legacy login emails compatible with older seed data.
  for (const [from, to] of [
    ['admin@bridgecare.local', 'admin@altrixs.local'],
    ['clinician@bridgecare.local', 'clinician@altrixs.local'],
  ] as const) {
    const oldUser = await prisma.user.findUnique({ where: { email: from } });
    const newUser = await prisma.user.findUnique({ where: { email: to } });
    if (oldUser && !newUser) {
      await prisma.user.update({ where: { id: oldUser.id }, data: { email: to } });
    }
  }

  // Demo clinic org should remain stable even if the DB already exists.
  let org = await prisma.organization.findUnique({
    where: { slug: 'demo-clinic' },
    include: { locations: true },
  });

  if (!org) {
    const legacy = await prisma.organization.findFirst({
      where: {
        OR: [
          { slug: 'altrixs' },
          { slug: 'bridgecare' },
          { name: { equals: 'Altrixs', mode: 'insensitive' } },
          { name: { contains: 'Divine', mode: 'insensitive' } },
          { name: { contains: 'Bridge', mode: 'insensitive' } },
        ],
      },
      include: { locations: true },
    });

    if (legacy) {
      org = await prisma.organization.update({
        where: { id: legacy.id },
        data: { name: 'Demo Clinic', slug: 'demo-clinic' },
        include: { locations: true },
      });
    }
  }

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Demo Clinic',
        slug: 'demo-clinic',
        locations: {
          create: [
            {
              name: 'Main Clinic',
              code: 'MAIN',
              city: 'Baltimore',
              state: 'MD',
              timezone: 'America/New_York',
              isPrimary: true,
            },
            {
              name: 'Telehealth Hub',
              code: 'TELE',
              city: 'Remote',
              state: 'MD',
              timezone: 'America/New_York',
              isPrimary: false,
            },
          ],
        },
      },
      include: { locations: true },
    });
  } else if (org.name !== 'Demo Clinic' || org.slug !== 'demo-clinic') {
    org = await prisma.organization.update({
      where: { id: org.id },
      data: { name: 'Demo Clinic', slug: 'demo-clinic' },
      include: { locations: true },
    });
  }

  let locations = org.locations;
  if (locations.length === 0) {
    await prisma.location.createMany({
      data: [
        {
          organizationId: org.id,
          name: 'Main Clinic',
          code: 'MAIN',
          city: 'Baltimore',
          state: 'MD',
          isPrimary: true,
        },
        {
          organizationId: org.id,
          name: 'Telehealth Hub',
          code: 'TELE',
          city: 'Remote',
          state: 'MD',
          isPrimary: false,
        },
      ],
    });
    locations = await prisma.location.findMany({ where: { organizationId: org.id } });
  }

  const primaryLocation = locations.find((l) => l.isPrimary) || locations[0] || null;

  const admin = await prisma.user.upsert({
    where: { email: 'admin@altrixs.local' },
    update: {
      primaryLocationId: primaryLocation?.id,
      organizationId: org.id,
      role: Role.ADMIN,
      roles: [Role.ADMIN, Role.DIRECTOR, Role.OFFICE_MANAGER, Role.BILLING],
    },
    create: {
      email: 'admin@altrixs.local',
      name: 'Clinic Admin',
      passwordHash,
      role: Role.ADMIN,
      roles: [Role.ADMIN, Role.DIRECTOR, Role.OFFICE_MANAGER, Role.BILLING],
      organizationId: org.id,
      primaryLocationId: primaryLocation?.id,
    },
  });

  const clinician = await prisma.user.upsert({
    where: { email: 'clinician@altrixs.local' },
    update: {
      primaryLocationId: primaryLocation?.id,
      organizationId: org.id,
      role: Role.THERAPIST,
      roles: [Role.THERAPIST, Role.CLINICIAN],
    },
    create: {
      email: 'clinician@altrixs.local',
      name: 'Dr. Sarah Smith',
      passwordHash,
      role: Role.THERAPIST,
      roles: [Role.THERAPIST, Role.CLINICIAN],
      organizationId: org.id,
      primaryLocationId: primaryLocation?.id,
    },
  });

  // Seed Persona: Sandra Lee, CPC (Billing Specialist)
  await prisma.user.upsert({
    where: { email: 's.lee@organization.com' },
    update: {
      primaryLocationId: primaryLocation?.id,
      organizationId: org.id,
      name: 'Sandra Lee, CPC',
      role: Role.BILLING,
      roles: [Role.BILLING],
      status: 'ACTIVE',
    },
    create: {
      email: 's.lee@organization.com',
      name: 'Sandra Lee, CPC',
      passwordHash,
      role: Role.BILLING,
      roles: [Role.BILLING],
      organizationId: org.id,
      primaryLocationId: primaryLocation?.id,
      status: 'ACTIVE',
    },
  });

  // Seed Persona: Kevin Davis (Office Manager)
  await prisma.user.upsert({
    where: { email: 'k.davis@organization.com' },
    update: {
      primaryLocationId: primaryLocation?.id,
      organizationId: org.id,
      name: 'Kevin Davis',
      role: Role.OFFICE_MANAGER,
      roles: [Role.OFFICE_MANAGER],
      status: 'ACTIVE',
    },
    create: {
      email: 'k.davis@organization.com',
      name: 'Kevin Davis',
      passwordHash,
      role: Role.OFFICE_MANAGER,
      roles: [Role.OFFICE_MANAGER],
      organizationId: org.id,
      primaryLocationId: primaryLocation?.id,
      status: 'ACTIVE',
    },
  });

  // Multi-role demo: switch Therapist ↔ Front Desk ↔ Office Manager ↔ Billing in the sidebar
  await prisma.user.upsert({
    where: { email: 'multirole@altrixs.local' },
    update: {
      primaryLocationId: primaryLocation?.id,
      organizationId: org.id,
      passwordHash,
      role: Role.THERAPIST,
      roles: [Role.THERAPIST, Role.FRONT_DESK, Role.OFFICE_MANAGER, Role.BILLING, Role.HR],
      status: 'ACTIVE',
    },
    create: {
      email: 'multirole@altrixs.local',
      name: 'Multi Role Demo',
      passwordHash,
      role: Role.THERAPIST,
      roles: [Role.THERAPIST, Role.FRONT_DESK, Role.OFFICE_MANAGER, Role.BILLING, Role.HR],
      organizationId: org.id,
      primaryLocationId: primaryLocation?.id,
      status: 'ACTIVE',
    },
  });

  if (primaryLocation) {
    await prisma.userLocation.upsert({
      where: {
        userId_locationId: { userId: admin.id, locationId: primaryLocation.id },
      },
      create: { userId: admin.id, locationId: primaryLocation.id, isPrimary: true },
      update: { isPrimary: true },
    });
    await prisma.userLocation.upsert({
      where: {
        userId_locationId: { userId: clinician.id, locationId: primaryLocation.id },
      },
      create: { userId: clinician.id, locationId: primaryLocation.id, isPrimary: true },
      update: { isPrimary: true },
    });
  }

  const clientDefs = [
    {
      name: 'Marcus Thompson',
      email: 'marcus.t@email.com',
      phone: '(555) 123-4567',
      riskLevel: RiskLevel.HIGH,
      checkInStreak: 7,
      assignedSince: new Date('2023-10-01'),
      mood: 2,
      stress: 9,
      checkInAt: hoursAgo(2),
    },
    {
      name: 'Janelle Williams',
      email: 'janelle.w@email.com',
      phone: '(555) 234-5678',
      riskLevel: RiskLevel.MEDIUM,
      checkInStreak: 14,
      assignedSince: new Date('2023-09-01'),
      mood: 4,
      stress: 7,
      checkInAt: hoursAgo(26),
    },
    {
      name: 'Sarah Martinez',
      email: 'sarah.m@email.com',
      phone: '(555) 345-6789',
      riskLevel: RiskLevel.LOW,
      checkInStreak: 21,
      assignedSince: new Date('2023-08-01'),
      mood: 7,
      stress: 4,
      checkInAt: hoursAgo(3),
    },
    {
      name: 'James Robinson',
      email: 'james.r@email.com',
      phone: '(555) 456-7890',
      riskLevel: RiskLevel.LOW,
      checkInStreak: 5,
      assignedSince: new Date('2023-11-01'),
      mood: 6,
      stress: 5,
      checkInAt: hoursAgo(12),
    },
    {
      name: 'Priya Lakshmi',
      email: 'priya.l@email.com',
      phone: '(555) 567-8901',
      riskLevel: RiskLevel.LOW,
      checkInStreak: 30,
      assignedSince: new Date('2023-07-01'),
      mood: 8,
      stress: 3,
      checkInAt: hoursAgo(8),
    },
    {
      name: 'David Kim',
      email: 'david.k@email.com',
      phone: '(555) 678-9012',
      riskLevel: RiskLevel.MEDIUM,
      checkInStreak: 3,
      assignedSince: new Date('2023-12-01'),
      mood: 5,
      stress: 9,
      checkInAt: hoursAgo(6),
    },
  ] as const;

  const clients = [];
  for (const def of clientDefs) {
    const c = await prisma.client.upsert({
      where: { email: def.email },
      update: {
        name: def.name,
        phone: def.phone,
        riskLevel: def.riskLevel,
        checkInStreak: def.checkInStreak,
        locationId: primaryLocation?.id,
        assignedToId: clinician.id,
        assignedSince: def.assignedSince,
      },
      create: {
        name: def.name,
        email: def.email,
        phone: def.phone,
        riskLevel: def.riskLevel,
        checkInStreak: def.checkInStreak,
        locationId: primaryLocation?.id,
        assignedToId: clinician.id,
        assignedSince: def.assignedSince,
        checkIns: {
          create: {
            mood: def.mood,
            stress: def.stress,
            createdAt: def.checkInAt,
          },
        },
      },
    });
    clients.push(c);
  }

  const byEmail = Object.fromEntries(clients.map((c) => [c.email!, c]));

  const todayWindowStart = atToday(0, 0);
  const todayWindowEnd = atToday(23, 59);

  const todaysApptDefs = [
    {
      email: 'marcus.t@email.com',
      type: 'Crisis Follow-up',
      start: atToday(9, 0),
      end: atToday(10, 0),
      status: AppointmentStatus.COMPLETED,
      isVirtual: true,
    },
    {
      email: 'sarah.m@email.com',
      type: 'Individual Therapy',
      start: atToday(10, 0),
      end: atToday(11, 0),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: false,
    },
    {
      email: 'james.r@email.com',
      type: 'Medication Review',
      start: atToday(11, 30),
      end: atToday(12, 0),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: true,
    },
    {
      email: 'priya.l@email.com',
      type: 'Individual Therapy',
      start: atToday(14, 0),
      end: atToday(15, 0),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: false,
    },
    {
      email: 'david.k@email.com',
      type: 'Initial Assessment',
      start: atToday(15, 30),
      end: atToday(16, 30),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: false,
    },
    {
      email: 'janelle.w@email.com',
      type: 'Individual Therapy',
      start: atToday(16, 45),
      end: atToday(17, 45),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: false,
    },
  ] as const;

  const existingTodayAppointments = await prisma.appointment.count({
    where: {
      startsAt: { gte: todayWindowStart, lte: todayWindowEnd },
      OR: [
        { client: { location: { organizationId: org.id } } },
        { clinician: { organizationId: org.id } },
      ],
    },
  });

  if (existingTodayAppointments < todaysApptDefs.length) {
    for (const a of todaysApptDefs) {
      await prisma.appointment.create({
        data: {
          clientId: byEmail[a.email].id,
          clinicianId: clinician.id,
          type: a.type,
          startsAt: a.start,
          endsAt: a.end,
          status: a.status,
          isVirtual: a.isVirtual,
        },
      });
    }
  }

  const weeklyCheckInCount = await prisma.checkIn.count({
    where: {
      createdAt: { gte: daysAgo(6) },
      client: {
        OR: [
          { location: { organizationId: org.id } },
          { assignedTo: { organizationId: org.id } },
        ],
      },
    },
  });

  if (weeklyCheckInCount < 18) {
    const trendPlans = [
      {
        email: 'marcus.t@email.com',
        moods: [2, 2, 3, 2, 4, 3, 2],
        stresses: [9, 8, 9, 8, 7, 8, 9],
        hour: 8,
      },
      {
        email: 'janelle.w@email.com',
        moods: [4, 4, 5, 4, 5, 4, 4],
        stresses: [7, 7, 6, 7, 6, 7, 7],
        hour: 9,
      },
      {
        email: 'sarah.m@email.com',
        moods: [7, 7, 8, 7, 7, 8, 7],
        stresses: [4, 4, 3, 4, 4, 3, 4],
        hour: 10,
      },
      {
        email: 'james.r@email.com',
        moods: [6, 6, 6, 7, 6, 6, 6],
        stresses: [5, 5, 5, 4, 5, 5, 5],
        hour: 11,
      },
      {
        email: 'priya.l@email.com',
        moods: [8, 8, 7, 8, 8, 8, 9],
        stresses: [3, 3, 4, 3, 3, 3, 2],
        hour: 13,
      },
      {
        email: 'david.k@email.com',
        moods: [5, 5, 4, 5, 6, 5, 5],
        stresses: [9, 8, 9, 8, 7, 8, 9],
        hour: 14,
      },
    ] as const;

    for (const plan of trendPlans) {
      for (let day = 0; day < plan.moods.length; day += 1) {
        await prisma.checkIn.create({
          data: {
            clientId: byEmail[plan.email].id,
            mood: plan.moods[day],
            stress: plan.stresses[day],
            createdAt: atDayOffset(6 - day, plan.hour, 15 + day),
          },
        });
      }
    }
  }

  const weeklyAppointmentCount = await prisma.appointment.count({
    where: {
      startsAt: { gte: daysAgo(6) },
      OR: [
        { client: { location: { organizationId: org.id } } },
        { clinician: { organizationId: org.id } },
      ],
    },
  });

  if (weeklyAppointmentCount < 12) {
    const trendAppointments = [
      {
        email: 'marcus.t@email.com',
        type: 'Crisis Follow-up',
        dayOffset: 6,
        startHour: 9,
        startMinute: 0,
        duration: 60,
        status: AppointmentStatus.COMPLETED,
        isVirtual: true,
      },
      {
        email: 'janelle.w@email.com',
        type: 'Medication Check',
        dayOffset: 5,
        startHour: 10,
        startMinute: 0,
        duration: 30,
        status: AppointmentStatus.SCHEDULED,
        isVirtual: false,
      },
      {
        email: 'sarah.m@email.com',
        type: 'Individual Therapy',
        dayOffset: 4,
        startHour: 11,
        startMinute: 0,
        duration: 60,
        status: AppointmentStatus.COMPLETED,
        isVirtual: false,
      },
      {
        email: 'james.r@email.com',
        type: 'Medication Review',
        dayOffset: 3,
        startHour: 12,
        startMinute: 30,
        duration: 30,
        status: AppointmentStatus.SCHEDULED,
        isVirtual: true,
      },
      {
        email: 'priya.l@email.com',
        type: 'Individual Therapy',
        dayOffset: 2,
        startHour: 14,
        startMinute: 0,
        duration: 60,
        status: AppointmentStatus.SCHEDULED,
        isVirtual: false,
      },
      {
        email: 'david.k@email.com',
        type: 'Initial Assessment',
        dayOffset: 1,
        startHour: 15,
        startMinute: 30,
        duration: 60,
        status: AppointmentStatus.SCHEDULED,
        isVirtual: false,
      },
    ] as const;

    for (const a of trendAppointments) {
      const start = atDayOffset(a.dayOffset, a.startHour, a.startMinute);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + a.duration);
      await prisma.appointment.create({
        data: {
          clientId: byEmail[a.email].id,
          clinicianId: clinician.id,
          type: a.type,
          startsAt: start,
          endsAt: end,
          status: a.status,
          isVirtual: a.isVirtual,
        },
      });
    }
  }

  const weeklyAlertCount = await prisma.riskAlert.count({
    where: {
      createdAt: { gte: daysAgo(6) },
      client: {
        OR: [
          { location: { organizationId: org.id } },
          { assignedTo: { organizationId: org.id } },
        ],
      },
    },
  });

  if (weeklyAlertCount < 3) {
    await prisma.riskAlert.createMany({
      data: [
        {
          clientId: byEmail['marcus.t@email.com'].id,
          type: 'Crisis keyword detected',
          description: 'Crisis keywords detected in journal entry',
          severity: RiskLevel.HIGH,
          mood: 2,
          stress: 9,
          reviewed: false,
          createdAt: hoursAgo(2),
        },
        {
          clientId: byEmail['janelle.w@email.com'].id,
          type: 'Low mood 3+ days',
          description: 'Mood below 4 for 3 consecutive days',
          severity: RiskLevel.MEDIUM,
          mood: 4,
          stress: 7,
          reviewed: false,
          createdAt: hoursAgo(5),
        },
        {
          clientId: byEmail['david.k@email.com'].id,
          type: 'High stress (9/10)',
          description: 'Stress level 9/10 - highest recorded this month',
          severity: RiskLevel.MEDIUM,
          mood: 5,
          stress: 9,
          reviewed: false,
          createdAt: daysAgo(1),
        },
      ],
    });
  }

  const weeklyMessageCount = await prisma.message.count({
    where: {
      createdAt: { gte: daysAgo(6) },
      client: {
        OR: [
          { location: { organizationId: org.id } },
          { assignedTo: { organizationId: org.id } },
        ],
      },
    },
  });

  if (weeklyMessageCount < 6) {
    await prisma.message.createMany({
      data: [
        {
          clientId: byEmail['marcus.t@email.com'].id,
          sender: MessageSender.STAFF,
          content: 'Good morning Marcus. How are you feeling today?',
          readAt: hoursAgo(3),
          createdAt: hoursAgo(3),
        },
        {
          clientId: byEmail['marcus.t@email.com'].id,
          sender: MessageSender.CLIENT,
          content: "I've been having a really hard time this week. Everything feels overwhelming.",
          readAt: hoursAgo(2.5),
          createdAt: hoursAgo(2.5),
        },
        {
          clientId: byEmail['marcus.t@email.com'].id,
          sender: MessageSender.CLIENT,
          content: "I couldn't sleep last night and I keep thinking negative thoughts.",
          readAt: null,
          createdAt: hoursAgo(2.4),
        },
        {
          clientId: byEmail['marcus.t@email.com'].id,
          sender: MessageSender.CLIENT,
          content: "I feel like no one understands what I'm going through.",
          readAt: null,
          createdAt: hoursAgo(2.3),
        },
        {
          clientId: byEmail['janelle.w@email.com'].id,
          sender: MessageSender.CLIENT,
          content: 'Thank you for the coping tools you recommended!',
          readAt: null,
          createdAt: hoursAgo(5),
        },
        {
          clientId: byEmail['sarah.m@email.com'].id,
          sender: MessageSender.CLIENT,
          content: 'See you at our session on Thursday.',
          readAt: hoursAgo(20),
          createdAt: hoursAgo(20),
        },
      ],
    });
  }

  const totalClients = await prisma.client.count();
  const totalAppointments = await prisma.appointment.count();
  const existingPlans = await prisma.treatmentPlan.count({
    where: { organizationId: org.id },
  });
  if (existingPlans === 0) {
    const daysFromNow = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      d.setHours(12, 0, 0, 0);
      return d;
    };
    await prisma.treatmentPlan.createMany({
      data: [
        {
          organizationId: org.id,
          clientId: byEmail['marcus.t@email.com'].id,
          clinicianId: clinician.id,
          title: 'Major Depressive Disorder, Moderate',
          diagnosisCodes: ['F33.1', 'F41.1'],
          status: TreatmentPlanStatus.ACTIVE,
          reviewDueAt: daysFromNow(5),
          presentingProblems: 'Persistent low mood, anhedonia, and rising crisis risk.',
          strengths: 'Engaged family support; prior response to CBT.',
          goals: {
            secondaryDx: 'Generalized Anxiety Disorder',
            clientSigned: true,
            items: [
              {
                id: 'G1',
                text: 'Reduce depressive symptoms and improve daily functioning',
                targetDate: daysFromNow(45).toISOString().slice(0, 10),
                objectives: [
                  'Track mood daily',
                  'Complete behavioral activation plan',
                  'Report PHQ-9 decrease by 5 points',
                ],
                interventions: ['CBT', 'Behavioral Activation', 'Psychoeducation'],
                progress: 68,
              },
            ],
          },
        },
        {
          organizationId: org.id,
          clientId: byEmail['janelle.w@email.com'].id,
          clinicianId: clinician.id,
          title: 'PTSD, Chronic',
          diagnosisCodes: ['F43.12'],
          status: TreatmentPlanStatus.ACTIVE,
          reviewDueAt: daysFromNow(21),
          presentingProblems: 'Trauma-related intrusions and sleep disruption.',
          strengths: 'Strong motivation for treatment; stable housing.',
          goals: {
            secondaryDx: 'Sleep disturbance',
            clientSigned: false,
            items: [
              {
                id: 'G1',
                text: 'Reduce trauma-related intrusions and improve sleep',
                targetDate: daysFromNow(50).toISOString().slice(0, 10),
                objectives: [
                  'Practice grounding skills',
                  'Complete sleep routine log',
                  'Review safety plan weekly',
                ],
                interventions: ['Trauma-focused CBT', 'Sleep hygiene', 'Safety planning'],
                progress: 42,
              },
            ],
          },
        },
        {
          organizationId: org.id,
          clientId: byEmail['sarah.m@email.com'].id,
          clinicianId: clinician.id,
          title: 'Bipolar I Disorder',
          diagnosisCodes: ['F31.10'],
          status: TreatmentPlanStatus.ACTIVE,
          reviewDueAt: daysFromNow(12),
          presentingProblems: 'Mood stability and medication adherence risk.',
          strengths: 'Consistent session attendance; insight into early warning signs.',
          goals: {
            secondaryDx: 'Medication adherence risk',
            clientSigned: true,
            items: [
              {
                id: 'G1',
                text: 'Maintain mood stability and medication consistency',
                targetDate: daysFromNow(60).toISOString().slice(0, 10),
                objectives: [
                  'Complete weekly mood chart',
                  'Attend med follow-up',
                  'Identify early warning signs',
                ],
                interventions: ['Medication management', 'Mood tracking', 'Psychoeducation'],
                progress: 74,
              },
            ],
          },
        },
      ],
    });
  }

  const totalAlerts = await prisma.riskAlert.count();
  const totalCheckIns = await prisma.checkIn.count();
  const totalPlans = await prisma.treatmentPlan.count({ where: { organizationId: org.id } });
  const existingAuths = await prisma.priorAuth.count({ where: { organizationId: org.id } });
  if (existingAuths === 0) {
    const daysFromNow = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      d.setHours(12, 0, 0, 0);
      return d;
    };
    await prisma.priorAuth.createMany({
      data: [
        {
          organizationId: org.id,
          clientId: byEmail['marcus.t@email.com'].id,
          payer: 'BCBS Maryland',
          authNumber: 'PA-EXP-5D',
          cptCodes: ['90837'],
          unitsApproved: 24,
          unitsUsed: 4,
          status: PriorAuthStatus.APPROVED,
          startDate: daysFromNow(-25),
          endDate: daysFromNow(5),
          notes: 'Individual Therapy',
          createdById: admin.id,
        },
        {
          organizationId: org.id,
          clientId: byEmail['janelle.w@email.com'].id,
          payer: 'Medicaid (MD)',
          authNumber: 'PA-LOW-UNITS',
          cptCodes: ['H2017'],
          unitsApproved: 8,
          unitsUsed: 6,
          status: PriorAuthStatus.APPROVED,
          startDate: daysFromNow(-10),
          endDate: daysFromNow(45),
          notes: 'PRP Supportive Services',
          createdById: admin.id,
        },
      ],
    });
  }
  const totalAuths = await prisma.priorAuth.count({ where: { organizationId: org.id } });

  const { seedStaffCredentialing } = await import('./credentialSeed');
  const credentialing = await seedStaffCredentialing(prisma, org.id, org.slug);
  const totalCreds = await prisma.staffCredential.count({ where: { organizationId: org.id } });

  const { seedClinicalSupervision } = await import('./supervisionSeed');
  const supervision = await seedClinicalSupervision(prisma, org.id, org.slug);
  const totalLogs = await prisma.supervisionLog.count({ where: { organizationId: org.id } });

  const { seedCommunityOutreach } = await import('./communitySeed');
  const community = await seedCommunityOutreach(prisma, org.id);
  const communityNote = community.skipped
    ? `community outreach: ${community.events} events (existing)`
    : `community outreach: ${community.events} events, ${community.partners} partners, ${community.volunteers} volunteers`;

  const { seedPrMarketing } = await import('./prSeed');
  const pr = await seedPrMarketing(prisma, org.id);
  const prNote = pr.skipped
    ? `PR & Marketing: existing campaigns (${pr.campaigns})`
    : `PR & Marketing: ${pr.campaigns} campaigns, ${pr.posts} posts, ${pr.coverage} coverage`;

  const { seedHrCorner } = await import('./hrCornerSeed');
  const hrCorner = await seedHrCorner(prisma, org.id, org.slug);
  const hrNote = hrCorner.skipped
    ? `HR Corner: ${hrCorner.staff} staff (existing)`
    : `HR Corner: ${hrCorner.staff} employees`;

  const { seedEnterpriseModules } = await import('./enterpriseSeeder');
  await seedEnterpriseModules(prisma, org.id);

  console.log('Seeded users + clinical demo data:');
  console.log('  admin@altrixs.local / Altrixs@123  (roles: ADMIN, DIRECTOR, BILLING)');
  console.log('  clinician@altrixs.local / Altrixs@123  (roles: THERAPIST, CLINICIAN)');
  console.log('  multirole@altrixs.local / Altrixs@123  (roles: THERAPIST, FRONT_DESK, BILLING, HR)');
  console.log(`  org: ${org.name} (${org.slug})`);
  console.log(`  locations: ${locations.length}`);
  console.log(`  clients: ${totalClients}`);
  console.log(`  appointments: ${totalAppointments}`);
  console.log(`  alerts: ${totalAlerts}`);
  console.log(`  check-ins: ${totalCheckIns}`);
  console.log(`  treatment plans: ${totalPlans}`);
  console.log(`  prior auths: ${totalAuths}`);
  console.log(
    credentialing.skipped
      ? `  staff credentials: ${totalCreds} (existing)`
      : `  staff credentials: ${totalCreds} (Renee, Marcus, Anita, Jasmine)`
  );
  console.log(
    supervision.skipped
      ? `  supervision logs: ${totalLogs} (existing tracks)`
      : `  supervision logs: ${totalLogs} (Jasmine Torres, Kevin Okafor, Dr. Renee Jackson)`
  );
  console.log(`  ${communityNote}`);
  console.log(`  ${prNote}`);
  console.log(`  ${hrNote}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
