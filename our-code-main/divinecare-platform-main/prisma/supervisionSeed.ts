import type { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

function atNoon(isoDate: string) {
  return new Date(`${isoDate}T12:00:00.000`);
}

const PEOPLE = [
  {
    local: 'renee.jackson',
    name: 'Dr. Renee Jackson',
    role: 'CLINICIAN' as Role,
  },
  {
    local: 'jasmine.torres',
    name: 'Jasmine Torres',
    role: 'THERAPIST' as Role,
  },
  {
    local: 'kevin.okafor',
    name: 'Kevin Okafor',
    role: 'THERAPIST' as Role,
  },
] as const;

type SeedClient = Pick<
  PrismaClient,
  'user' | 'supervisionTrack' | 'supervisionLog'
>;

/**
 * Screenshot-matching clinical supervision roster + sessions (org-scoped).
 */
export async function seedClinicalSupervision(
  prisma: SeedClient,
  organizationId: string,
  orgSlug: string,
  opts: { replace?: boolean } = {}
) {
  const existingTracks = await prisma.supervisionTrack.count({ where: { organizationId } });
  if (existingTracks > 0 && !opts.replace) {
    const logs = await prisma.supervisionLog.count({ where: { organizationId } });
    return { skipped: true as const, tracks: existingTracks, logs, users: 0 };
  }

  await prisma.supervisionLog.deleteMany({ where: { organizationId } });
  await prisma.supervisionTrack.deleteMany({ where: { organizationId } });

  const passwordHash = await hash('Altrixs@123', 12);
  const byLocal: Record<string, { id: string }> = {};

  for (const person of PEOPLE) {
    const email = `${person.local}@${orgSlug}.altrixs.local`;
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: person.name,
        passwordHash,
        role: person.role,
        roles: [person.role],
        status: 'ACTIVE',
        organizationId,
      },
      update: {
        name: person.name,
        role: person.role,
        organizationId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    byLocal[person.local] = user;
  }

  const renee = byLocal['renee.jackson'];
  const jasmine = byLocal['jasmine.torres'];
  const kevin = byLocal['kevin.okafor'];

  await prisma.supervisionTrack.createMany({
    data: [
      {
        organizationId,
        superviseeId: jasmine.id,
        supervisorId: renee.id,
        licenseTrack: 'LGPC',
        targetLicense: 'LPC',
        requiredHours: 200,
        startedAt: atNoon('2025-07-01'),
      },
      {
        organizationId,
        superviseeId: kevin.id,
        supervisorId: renee.id,
        licenseTrack: 'LGSW',
        targetLicense: 'LCSW',
        requiredHours: 3000,
        startedAt: atNoon('2025-01-15'),
      },
    ],
  });

  const signed = (iso: string) => atNoon(iso);

  await prisma.supervisionLog.createMany({
    data: [
      {
        organizationId,
        supervisorId: renee.id,
        superviseeId: jasmine.id,
        sessionAt: atNoon('2026-06-23'),
        sessionType: 'Individual',
        durationMin: 60,
        topics: 'Treatment planning, progress note quality review',
        clientRefs: ['Marcus Johnson'],
        signedBySupervisorAt: signed('2026-06-23'),
        signedBySuperviseeAt: null,
      },
      {
        organizationId,
        supervisorId: renee.id,
        superviseeId: jasmine.id,
        sessionAt: atNoon('2026-06-16'),
        sessionType: 'Individual',
        durationMin: 90,
        topics: 'Trauma-informed care, cultural competency',
        clientRefs: ['Aaliyah Brooks'],
        signedBySupervisorAt: signed('2026-06-16'),
        signedBySuperviseeAt: signed('2026-06-16'),
      },
      {
        organizationId,
        supervisorId: renee.id,
        superviseeId: jasmine.id,
        sessionAt: atNoon('2026-06-09'),
        sessionType: 'Individual',
        durationMin: 90,
        topics: 'Differential diagnosis, crisis planning, note quality',
        clientRefs: ['Devon Carter'],
        signedBySupervisorAt: signed('2026-06-09'),
        signedBySuperviseeAt: signed('2026-06-09'),
      },
      {
        organizationId,
        supervisorId: renee.id,
        superviseeId: jasmine.id,
        sessionAt: atNoon('2026-06-02'),
        sessionType: 'Individual',
        durationMin: 90,
        topics: 'Ethics, dual relationships, informed consent',
        clientRefs: ['Priya Shah'],
        signedBySupervisorAt: signed('2026-06-02'),
        signedBySuperviseeAt: signed('2026-06-02'),
      },
      {
        organizationId,
        supervisorId: renee.id,
        superviseeId: kevin.id,
        sessionAt: atNoon('2026-06-17'),
        sessionType: 'Triadic',
        durationMin: 90,
        topics: 'Group facilitation skills, boundary setting',
        clientRefs: ['Andre Mitchell', 'Keisha Brown'],
        signedBySupervisorAt: signed('2026-06-17'),
        signedBySuperviseeAt: signed('2026-06-17'),
      },
      {
        organizationId,
        supervisorId: renee.id,
        superviseeId: kevin.id,
        sessionAt: atNoon('2026-06-03'),
        sessionType: 'Individual',
        durationMin: 60,
        topics: 'Motivational interviewing, dual diagnosis',
        clientRefs: ['Tyrone Davis'],
        signedBySupervisorAt: signed('2026-06-03'),
        signedBySuperviseeAt: signed('2026-06-03'),
      },
    ],
  });

  return {
    skipped: false as const,
    tracks: 2,
    logs: 6,
    users: PEOPLE.length,
  };
}
