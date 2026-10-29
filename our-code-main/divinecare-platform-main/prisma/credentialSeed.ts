import type { PrismaClient, Role, StaffCredentialType } from '@prisma/client';
import { hash } from 'bcryptjs';

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

function atNoon(isoDate: string) {
  return new Date(`${isoDate}T12:00:00.000`);
}

const PEOPLE = [
  { local: 'renee.jackson', name: 'Dr. Renee Jackson', role: 'CLINICIAN' as Role },
  { local: 'marcus.edwards', name: 'Marcus Edwards', role: 'THERAPIST' as Role },
  { local: 'anita.patel', name: 'Dr. Anita Patel', role: 'PSYCHIATRIST' as Role },
  { local: 'jasmine.torres', name: 'Jasmine Torres', role: 'THERAPIST' as Role },
] as const;

type SeedClient = Pick<PrismaClient, 'user' | 'staffCredential'>;

/**
 * Screenshot-matching staff credentialing roster (org-scoped).
 * Dates are relative to today so 9 / 29 / ~168 day urgency stays accurate.
 */
export async function seedStaffCredentialing(
  prisma: SeedClient,
  organizationId: string,
  orgSlug: string,
  opts: { replace?: boolean } = {}
) {
  const matching = await prisma.staffCredential.count({
    where: { organizationId, licenseNumber: 'LCSW-21445' },
  });
  const existing = await prisma.staffCredential.count({ where: { organizationId } });
  if (matching > 0 && !opts.replace) {
    return { skipped: true as const, credentials: existing, users: 0 };
  }

  await prisma.staffCredential.deleteMany({ where: { organizationId } });

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
        roles: [person.role],
        organizationId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    byLocal[person.local] = user;
  }

  const renee = byLocal['renee.jackson'].id;
  const marcus = byLocal['marcus.edwards'].id;
  const anita = byLocal['anita.patel'].id;
  const jasmine = byLocal['jasmine.torres'].id;

  const rows: {
    organizationId: string;
    userId: string;
    credentialType: StaffCredentialType;
    title: string;
    licenseNumber: string;
    issuer: string;
    issuedAt: Date;
    expiresAt: Date;
    ceuRequired: number;
    ceuCompleted: number;
    status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
  }[] = [
    {
      organizationId,
      userId: renee,
      credentialType: 'LICENSE',
      title: 'LCSW — Maryland',
      licenseNumber: 'LCSW-21445',
      issuer: 'MD Board of Social Work',
      issuedAt: daysFromNow(-168 - 730),
      expiresAt: daysFromNow(-168),
      ceuRequired: 60,
      ceuCompleted: 52,
      status: 'EXPIRED',
    },
    {
      organizationId,
      userId: renee,
      credentialType: 'MALPRACTICE',
      title: 'Professional Liability Insurance',
      licenseNumber: 'POL-2026-44812',
      issuer: 'HPSO',
      issuedAt: daysFromNow(9 - 365),
      expiresAt: daysFromNow(9),
      ceuRequired: 0,
      ceuCompleted: 0,
      status: 'EXPIRING_SOON',
    },
    {
      organizationId,
      userId: marcus,
      credentialType: 'LICENSE',
      title: 'LPC — Maryland',
      licenseNumber: 'LPC-18932',
      issuer: 'MD Board of Prof. Counselors',
      issuedAt: atNoon('2025-06-01'),
      expiresAt: atNoon('2027-06-01'),
      ceuRequired: 60,
      ceuCompleted: 30,
      status: 'ACTIVE',
    },
    {
      organizationId,
      userId: marcus,
      credentialType: 'CEU',
      title: 'CEU — 2025-2027 Cycle',
      licenseNumber: 'CEU-2027',
      issuer: 'MD Board of Prof. Counselors',
      issuedAt: atNoon('2025-06-01'),
      expiresAt: atNoon('2027-06-01'),
      ceuRequired: 60,
      ceuCompleted: 30,
      status: 'ACTIVE',
    },
    {
      organizationId,
      userId: anita,
      credentialType: 'DEA',
      title: 'Psychiatrist DEA',
      licenseNumber: 'BJ2481937',
      issuer: 'U.S. Drug Enforcement Administration',
      issuedAt: daysFromNow(29 - 1095),
      expiresAt: daysFromNow(29),
      ceuRequired: 0,
      ceuCompleted: 0,
      status: 'EXPIRING_SOON',
    },
    {
      organizationId,
      userId: jasmine,
      credentialType: 'LICENSE',
      title: 'LGPC — Maryland',
      licenseNumber: 'LGPC-55218',
      issuer: 'MD Board of Prof. Counselors',
      issuedAt: atNoon('2025-07-01'),
      expiresAt: atNoon('2028-07-01'),
      ceuRequired: 0,
      ceuCompleted: 0,
      status: 'ACTIVE',
    },
    {
      organizationId,
      userId: jasmine,
      credentialType: 'BACKGROUND_CHECK',
      title: 'CJIS Background Check',
      licenseNumber: 'CJIS-MD-44190',
      issuer: 'Maryland CJIS',
      issuedAt: daysFromNow(9 - 365),
      expiresAt: daysFromNow(9),
      ceuRequired: 0,
      ceuCompleted: 0,
      status: 'EXPIRING_SOON',
    },
  ];

  await prisma.staffCredential.createMany({ data: rows });

  return { skipped: false as const, credentials: rows.length, users: PEOPLE.length };
}
