/**
 * Seed a single demo clinic with one user for every staff role and starter clinic data.
 *
 * Usage:
 *   ROLE_DEMO_PASSWORD="Altrixs@123" npm run db:create-role-demo-clinic
 *
 * Default password:
 *   Altrixs@123
 */
import { AppointmentStatus, MessageSender, PrismaClient, RiskLevel, Role } from '@prisma/client';
import { updateProgressNoteWorkflow } from '@/lib/notes/workflow-store';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const ORG_SLUG = 'role-demo-clinic';
const TARGET_ORG_ID = process.env.TARGET_ORG_ID?.trim() || '';
const TARGET_ORG_SLUG = process.env.TARGET_ORG_SLUG?.trim() || '';
const PASSWORD = process.env.ROLE_DEMO_PASSWORD?.trim() || 'Altrixs@123';

type DemoUser = {
  role: Role;
  name: string;
  email: string;
};

const DEMO_USERS: DemoUser[] = [
  { role: Role.ADMIN, name: 'Clinic Admin', email: 'admin@role-demo.local' },
  { role: Role.DIRECTOR, name: 'Practice Director', email: 'director@role-demo.local' },
  { role: Role.FRONT_DESK, name: 'Front Desk', email: 'office@role-demo.local' },
  { role: Role.THERAPIST, name: 'Therapist Nia Patel', email: 'therapist@role-demo.local' },
  { role: Role.PSYCHIATRIST, name: 'Dr. Samir Shah', email: 'psychiatrist@role-demo.local' },
  { role: Role.NP, name: 'Maya Lewis, NP', email: 'np@role-demo.local' },
  { role: Role.PRP_SPECIALIST, name: 'PRP Specialist Jordan Reed', email: 'prp@role-demo.local' },
  { role: Role.CASE_MANAGER, name: 'Case Manager Elena Brooks', email: 'case@role-demo.local' },
  { role: Role.PEER_SUPPORT, name: 'Peer Support Tariq Ahmed', email: 'peer@role-demo.local' },
  { role: Role.BILLING, name: 'Billing Specialist Nina Clark', email: 'billing@role-demo.local' },
  { role: Role.HR, name: 'HR Manager Sofia Jones', email: 'hr@role-demo.local' },
];

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

async function ensureDemoOrg() {
  if (TARGET_ORG_ID) {
    const org = await prisma.organization.findUnique({
      where: { id: TARGET_ORG_ID },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
    if (!org) {
      throw new Error(`Organization not found for TARGET_ORG_ID=${TARGET_ORG_ID}`);
    }
    return org;
  }

  if (TARGET_ORG_SLUG) {
    const org = await prisma.organization.findUnique({
      where: { slug: TARGET_ORG_SLUG },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
    if (org) return org;
  }

  let org = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
    include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });

  if (!org) {
    const legacy = await prisma.organization.findFirst({
      where: {
        OR: [
          { slug: 'demo-clinic' },
          { slug: 'altrixs' },
          { slug: 'bridgecare' },
          { name: { equals: 'Demo Clinic', mode: 'insensitive' } },
        ],
      },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });

    if (legacy) {
      org = await prisma.organization.update({
        where: { id: legacy.id },
        data: { name: 'Role Demo Clinic', slug: ORG_SLUG },
        include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
      });
    }
  }

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Role Demo Clinic',
        slug: ORG_SLUG,
        locations: {
          create: [
            {
              name: 'Main Clinic',
              code: 'MAIN',
              city: 'Baltimore',
              state: 'MD',
              timezone: 'America/New_York',
              isPrimary: true,
              active: true,
            },
            {
              name: 'Telehealth Hub',
              code: 'TELE',
              city: 'Remote',
              state: 'MD',
              timezone: 'America/New_York',
              isPrimary: false,
              active: true,
            },
          ],
        },
      },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
  } else if (org.locations.length === 0) {
    await prisma.location.createMany({
      data: [
        {
          organizationId: org.id,
          name: 'Main Clinic',
          code: 'MAIN',
          city: 'Baltimore',
          state: 'MD',
          timezone: 'America/New_York',
          isPrimary: true,
          active: true,
        },
        {
          organizationId: org.id,
          name: 'Telehealth Hub',
          code: 'TELE',
          city: 'Remote',
          state: 'MD',
          timezone: 'America/New_York',
          isPrimary: false,
          active: true,
        },
      ],
    });
    org = await prisma.organization.findUniqueOrThrow({
      where: { slug: ORG_SLUG },
      include: { locations: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
    });
  }

  return org;
}

async function main() {
  if (PASSWORD.length < 8) {
    console.error('ROLE_DEMO_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const org = await ensureDemoOrg();
  const primary =
    org.locations.find((l) => l.isPrimary && l.active) || org.locations[0] || null;
  const passwordHash = await hash(PASSWORD, 12);

  const created: { role: Role; email: string; name: string }[] = [];

  for (const entry of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: entry.email },
      update: {
        name: entry.name,
        passwordHash,
        role: entry.role,
        status: 'ACTIVE',
        organizationId: org.id,
        primaryLocationId: primary?.id ?? null,
      },
      create: {
        name: entry.name,
        email: entry.email,
        passwordHash,
        role: entry.role,
        status: 'ACTIVE',
        organizationId: org.id,
        primaryLocationId: primary?.id ?? null,
      },
    });

    if (primary) {
      await prisma.userLocation.upsert({
        where: {
          userId_locationId: { userId: user.id, locationId: primary.id },
        },
        create: { userId: user.id, locationId: primary.id, isPrimary: true },
        update: { isPrimary: true },
      });
    }

    created.push({ role: entry.role, email: user.email, name: user.name || entry.name });
  }

  const therapist = await prisma.user.findUniqueOrThrow({
    where: { email: 'therapist@role-demo.local' },
  });

  const clientDefs = [
    {
      name: 'Marcus Thompson',
      email: 'marcus.t@role-demo.local',
      phone: '(555) 123-4567',
      riskLevel: RiskLevel.HIGH,
      checkInStreak: 7,
      assignedSince: new Date('2023-10-01'),
      mood: 2,
      stress: 9,
      checkInAt: hoursAgo(2),
      diagnosis: 'Major Depressive Disorder, Moderate',
      diagnosisCode: 'F33.1',
      insurance: 'BCBS Maryland',
    },
    {
      name: 'Janelle Williams',
      email: 'janelle.w@role-demo.local',
      phone: '(555) 234-5678',
      riskLevel: RiskLevel.MEDIUM,
      checkInStreak: 14,
      assignedSince: new Date('2023-09-01'),
      mood: 4,
      stress: 7,
      checkInAt: hoursAgo(26),
      diagnosis: 'Generalized Anxiety Disorder',
      diagnosisCode: 'F41.1',
      insurance: 'Medicaid (MD)',
    },
    {
      name: 'Sarah Martinez',
      email: 'sarah.m@role-demo.local',
      phone: '(555) 345-6789',
      riskLevel: RiskLevel.LOW,
      checkInStreak: 21,
      assignedSince: new Date('2023-08-01'),
      mood: 7,
      stress: 4,
      checkInAt: hoursAgo(3),
      diagnosis: 'PTSD, Chronic',
      diagnosisCode: 'F43.12',
      insurance: 'Cigna',
    },
    {
      name: 'James Robinson',
      email: 'james.r@role-demo.local',
      phone: '(555) 456-7890',
      riskLevel: RiskLevel.LOW,
      checkInStreak: 5,
      assignedSince: new Date('2023-11-01'),
      mood: 6,
      stress: 5,
      checkInAt: hoursAgo(12),
      diagnosis: 'Bipolar I Disorder',
      diagnosisCode: 'F31.10',
      insurance: 'Aetna Behavioral',
    },
    {
      name: 'Priya Lakshmi',
      email: 'priya.l@role-demo.local',
      phone: '(555) 567-8901',
      riskLevel: RiskLevel.LOW,
      checkInStreak: 30,
      assignedSince: new Date('2023-07-01'),
      mood: 8,
      stress: 3,
      checkInAt: hoursAgo(8),
      diagnosis: 'Social Anxiety Disorder',
      diagnosisCode: 'F40.10',
      insurance: 'Medicare Part B',
    },
    {
      name: 'David Kim',
      email: 'david.k@role-demo.local',
      phone: '(555) 678-9012',
      riskLevel: RiskLevel.MEDIUM,
      checkInStreak: 3,
      assignedSince: new Date('2023-12-01'),
      mood: 5,
      stress: 9,
      checkInAt: hoursAgo(6),
      diagnosis: 'ADHD, Combined Presentation',
      diagnosisCode: 'F90.2',
      insurance: 'Self-pay / none',
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
        locationId: primary?.id,
        assignedToId: therapist.id,
        assignedSince: def.assignedSince,
        primaryDiagnosis: def.diagnosis,
        primaryDiagnosisCode: def.diagnosisCode,
        insurancePayer: def.insurance,
      },
      create: {
        name: def.name,
        email: def.email,
        phone: def.phone,
        riskLevel: def.riskLevel,
        checkInStreak: def.checkInStreak,
        locationId: primary?.id,
        assignedToId: therapist.id,
        assignedSince: def.assignedSince,
        primaryDiagnosis: def.diagnosis,
        primaryDiagnosisCode: def.diagnosisCode,
        insurancePayer: def.insurance,
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
      email: 'marcus.t@role-demo.local',
      type: 'Crisis Follow-up',
      start: atToday(9, 0),
      end: atToday(10, 0),
      status: AppointmentStatus.COMPLETED,
      isVirtual: true,
    },
    {
      email: 'sarah.m@role-demo.local',
      type: 'Individual Therapy',
      start: atToday(10, 0),
      end: atToday(11, 0),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: false,
    },
    {
      email: 'james.r@role-demo.local',
      type: 'Medication Review',
      start: atToday(11, 30),
      end: atToday(12, 0),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: true,
    },
    {
      email: 'priya.l@role-demo.local',
      type: 'Individual Therapy',
      start: atToday(14, 0),
      end: atToday(15, 0),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: false,
    },
    {
      email: 'david.k@role-demo.local',
      type: 'Initial Assessment',
      start: atToday(15, 30),
      end: atToday(16, 30),
      status: AppointmentStatus.SCHEDULED,
      isVirtual: false,
    },
    {
      email: 'janelle.w@role-demo.local',
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
      const existing = await prisma.appointment.findFirst({
        where: {
          clientId: byEmail[a.email].id,
          type: a.type,
          startsAt: a.start,
        },
      });
      if (existing) continue;
      await prisma.appointment.create({
        data: {
          clientId: byEmail[a.email].id,
          clinicianId: therapist.id,
          type: a.type,
          startsAt: a.start,
          endsAt: a.end,
          status: a.status,
          isVirtual: a.isVirtual,
        },
      }).catch(async () => {
        await prisma.appointment.create({
          data: {
            clientId: byEmail[a.email].id,
            clinicianId: therapist.id,
            type: a.type,
            startsAt: a.start,
            endsAt: a.end,
            status: a.status,
            isVirtual: a.isVirtual,
          },
        });
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
      { email: 'marcus.t@role-demo.local', moods: [2, 2, 3, 2, 4, 3, 2], stresses: [9, 8, 9, 8, 7, 8, 9], hour: 8 },
      { email: 'janelle.w@role-demo.local', moods: [4, 4, 5, 4, 5, 4, 4], stresses: [7, 7, 6, 7, 6, 7, 7], hour: 9 },
      { email: 'sarah.m@role-demo.local', moods: [7, 7, 8, 7, 7, 8, 7], stresses: [4, 4, 3, 4, 4, 3, 4], hour: 10 },
      { email: 'james.r@role-demo.local', moods: [6, 6, 6, 7, 6, 6, 6], stresses: [5, 5, 5, 4, 5, 5, 5], hour: 11 },
      { email: 'priya.l@role-demo.local', moods: [8, 8, 7, 8, 8, 8, 9], stresses: [3, 3, 4, 3, 3, 3, 2], hour: 13 },
      { email: 'david.k@role-demo.local', moods: [5, 5, 4, 5, 6, 5, 5], stresses: [9, 8, 9, 8, 7, 8, 9], hour: 14 },
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
          clientId: byEmail['marcus.t@role-demo.local'].id,
          type: 'Crisis keyword detected',
          description: 'Crisis keywords detected in journal entry',
          severity: RiskLevel.HIGH,
          mood: 2,
          stress: 9,
          reviewed: false,
          createdAt: hoursAgo(2),
        },
        {
          clientId: byEmail['janelle.w@role-demo.local'].id,
          type: 'Low mood 3+ days',
          description: 'Mood below 4 for 3 consecutive days',
          severity: RiskLevel.MEDIUM,
          mood: 4,
          stress: 7,
          reviewed: false,
          createdAt: hoursAgo(5),
        },
        {
          clientId: byEmail['david.k@role-demo.local'].id,
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

  if (weeklyMessageCount < 10) {
    await prisma.message.createMany({
      data: [
        {
          clientId: byEmail['marcus.t@role-demo.local'].id,
          sender: MessageSender.STAFF,
          content: 'Good morning Marcus. How are you feeling today?',
          readAt: hoursAgo(3),
          createdAt: hoursAgo(3),
        },
        {
          clientId: byEmail['marcus.t@role-demo.local'].id,
          sender: MessageSender.CLIENT,
          content: "I've been having a really hard time this week. Everything feels overwhelming.",
          readAt: hoursAgo(2.5),
          createdAt: hoursAgo(2.5),
        },
        {
          clientId: byEmail['marcus.t@role-demo.local'].id,
          sender: MessageSender.CLIENT,
          content: "I couldn't sleep last night and I keep thinking negative thoughts.",
          readAt: null,
          createdAt: hoursAgo(2.4),
        },
        {
          clientId: byEmail['marcus.t@role-demo.local'].id,
          sender: MessageSender.CLIENT,
          content: "I feel like no one understands what I'm going through.",
          readAt: null,
          createdAt: hoursAgo(2.3),
        },
        {
          clientId: byEmail['janelle.w@role-demo.local'].id,
          sender: MessageSender.CLIENT,
          content: 'Thank you for the coping tools you recommended!',
          readAt: null,
          createdAt: hoursAgo(5),
        },
        {
          clientId: byEmail['sarah.m@role-demo.local'].id,
          sender: MessageSender.CLIENT,
          content: 'See you at our session on Thursday.',
          readAt: hoursAgo(20),
          createdAt: hoursAgo(20),
        },
        {
          clientId: byEmail['janelle.w@role-demo.local'].id,
          sender: MessageSender.STAFF,
          content: 'Thanks for the update, Janelle. Keep using the grounding plan and send a note if sleep worsens.',
          readAt: hoursAgo(6),
          createdAt: hoursAgo(6),
        },
        {
          clientId: byEmail['janelle.w@role-demo.local'].id,
          sender: MessageSender.CLIENT,
          content: 'I will. The breathing practice helped a bit this morning.',
          readAt: hoursAgo(5.5),
          createdAt: hoursAgo(5.5),
        },
        {
          clientId: byEmail['priya.l@role-demo.local'].id,
          sender: MessageSender.CLIENT,
          content: 'I can do Friday after 2 PM if that works for the check-in.',
          readAt: null,
          createdAt: hoursAgo(10),
        },
        {
          clientId: byEmail['david.k@role-demo.local'].id,
          sender: MessageSender.STAFF,
          content: 'Please confirm your new insurance card when you get a chance.',
          readAt: null,
          createdAt: hoursAgo(9),
        },
      ],
    });
  }

  const noteSeeds = [
    {
      noteId: 'role-demo-note-1',
      clientEmail: 'marcus.t@role-demo.local',
      body:
        'Client reported elevated stress, disrupted sleep, and repeated negative self-talk. Reviewed coping plan, grounding steps, and safety check-in. Client agreed to use the evening routine and message the care team if symptoms worsen.',
      createdAt: hoursAgo(26),
      status: 'Locked' as const,
    },
    {
      noteId: 'role-demo-note-2',
      clientEmail: 'janelle.w@role-demo.local',
      body:
        'Client processed recent family stressors and practiced a cognitive reframing exercise. Response was engaged and future-oriented. Discussed next-session goals and transportation plan.',
      createdAt: daysAgo(2),
      status: 'Locked' as const,
    },
    {
      noteId: 'role-demo-note-3',
      clientEmail: 'sarah.m@role-demo.local',
      body:
        'Initial progress note drafted after therapy session. Client shared improved sleep and stronger use of grounding skills. Note left signed for later lock after final review.',
      createdAt: daysAgo(1),
      status: 'Signed' as const,
    },
  ] as const;

  for (const seed of noteSeeds) {
    const client = byEmail[seed.clientEmail];
    if (!client) continue;

    const note = await prisma.progressNote.upsert({
      where: { id: seed.noteId },
      update: {
        clientId: client.id,
        clinicianId: therapist.id,
        body: seed.body,
        createdAt: seed.createdAt,
      },
      create: {
        id: seed.noteId,
        clientId: client.id,
        clinicianId: therapist.id,
        body: seed.body,
        createdAt: seed.createdAt,
      },
    });

    await updateProgressNoteWorkflow({
      noteId: note.id,
      organizationId: org.id,
      actorUserId: therapist.id,
      actorRole: Role.THERAPIST,
      status: seed.status,
      attested: true,
    });
  }

  const { seedCommunityOutreach } = await import('./communitySeed');
  await seedCommunityOutreach(prisma, org.id);

  console.log('Role demo clinic ready:');
  console.log(`  org=${org.slug}`);
  console.log(`  locations=${org.locations.length}`);
  console.log(`  password=${PASSWORD}`);
  console.log('');
  console.log('Users:');
  for (const user of created) {
    console.log(`  ${user.role}: ${user.email} (${user.name})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
