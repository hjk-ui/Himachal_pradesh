import { hash } from 'bcryptjs';
import type { PrismaClient, Role } from '@prisma/client';

const SEED_KEY = 'hr-corner';
const PASSWORD = 'Altrixs@123';

function atNoon(isoDate: string) {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

const STAFF: {
  key: string;
  name: string;
  localPart: string;
  role: Role;
  jobTitle: string;
  department: string;
  employmentType: string;
  hrStatus: string;
  hireDate: string;
  managerName: string;
  npi?: string;
  deaNumber?: string;
  sortOrder: number;
  license?: {
    title: string;
    licenseNumber: string;
    issuer: string;
    expiresAt: string;
    credentialLabel: string;
  };
  pto: {
    vacationHrs: number;
    sickHrs: number;
    personalHrs: number;
    fmlaUsed: string;
    ytdUsed: number;
    pendingRequest: string;
  };
  ceu?: { license: string; earned: number; required: number };
}[] = [
  {
    key: 'marcus',
    name: 'Marcus Johnson',
    localPart: 'marcus.johnson',
    role: 'DIRECTOR',
    jobTitle: 'Practice Director',
    department: 'Clinical',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2018-04-01',
    managerName: '—',
    npi: '1234567890',
    sortOrder: 0,
    license: {
      title: 'LCPC',
      licenseNumber: 'LCPC-11002',
      issuer: 'MD Board of Professional Counselors',
      expiresAt: '2027-02-01',
      credentialLabel: 'LCPC',
    },
    pto: { vacationHrs: 18, sickHrs: 8, personalHrs: 3, fmlaUsed: '—', ytdUsed: 4, pendingRequest: '—' },
  },
  {
    key: 'sarah',
    name: 'Dr. Sarah Smith',
    localPart: 'sarah.smith',
    role: 'THERAPIST',
    jobTitle: 'Licensed Clinical Therapist',
    department: 'Clinical',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2021-03-15',
    managerName: 'Marcus Johnson',
    npi: '2345678901',
    sortOrder: 1,
    license: {
      title: 'LCSW',
      licenseNumber: 'LCSW-07823',
      issuer: 'MD Board of Social Work',
      expiresAt: '2026-09-30',
      credentialLabel: 'LCSW',
    },
    pto: { vacationHrs: 8.5, sickHrs: 6, personalHrs: 2, fmlaUsed: '—', ytdUsed: 7.5, pendingRequest: '—' },
    ceu: { license: 'LCSW-07823', earned: 28, required: 30 },
  },
  {
    key: 'james',
    name: 'Dr. James Park',
    localPart: 'james.park',
    role: 'PSYCHIATRIST',
    jobTitle: 'Psychiatrist',
    department: 'Clinical',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2020-01-10',
    managerName: 'Marcus Johnson',
    npi: '9876543210',
    deaNumber: 'BP1234567',
    sortOrder: 2,
    license: {
      title: 'MD',
      licenseNumber: 'MD-48291',
      issuer: 'MD Board of Physicians',
      expiresAt: '2027-03-15',
      credentialLabel: 'MD',
    },
    pto: { vacationHrs: 15, sickHrs: 8, personalHrs: 3, fmlaUsed: '—', ytdUsed: 3, pendingRequest: '—' },
    ceu: { license: 'MD-48291', earned: 40, required: 40 },
  },
  {
    key: 'maria',
    name: 'Maria Rivera',
    localPart: 'maria.rivera',
    role: 'NP',
    jobTitle: 'Nurse Practitioner (PMHNP)',
    department: 'Clinical',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2022-05-02',
    managerName: 'Dr. James Park',
    npi: '5432167890',
    deaNumber: 'MR9876543',
    sortOrder: 3,
    license: {
      title: 'PMHNP',
      licenseNumber: 'CRNP-31892',
      issuer: 'MD Board of Nursing',
      expiresAt: '2026-12-10',
      credentialLabel: 'PMHNP',
    },
    pto: { vacationHrs: 10, sickHrs: 5, personalHrs: 2, fmlaUsed: '—', ytdUsed: 2, pendingRequest: '2d' },
    ceu: { license: 'CRNP-31892', earned: 22, required: 24 },
  },
  {
    key: 'tony',
    name: 'Tony Williams',
    localPart: 'tony.williams',
    role: 'PRP_SPECIALIST',
    jobTitle: 'PRP Specialist',
    department: 'PRP',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2022-08-08',
    managerName: 'Dr. Sarah Smith',
    sortOrder: 4,
    license: {
      title: 'CPRS',
      licenseNumber: 'CPRS-19023',
      issuer: 'MD PRP Credentialing',
      expiresAt: '2026-06-20',
      credentialLabel: 'CPRS',
    },
    pto: { vacationHrs: 6, sickHrs: 4, personalHrs: 1, fmlaUsed: '—', ytdUsed: 8, pendingRequest: '—' },
    ceu: { license: 'CPRS-19023', earned: 15, required: 15 },
  },
  {
    key: 'lisa',
    name: 'Lisa Chen',
    localPart: 'lisa.chen',
    role: 'CASE_MANAGER',
    jobTitle: 'Case Manager',
    department: 'Case Mgmt',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2021-09-12',
    managerName: 'Dr. Sarah Smith',
    npi: '7654321098',
    sortOrder: 5,
    license: {
      title: 'LGSW',
      licenseNumber: 'LGSW-84201',
      issuer: 'MD Board of Social Work',
      expiresAt: '2027-04-18',
      credentialLabel: 'LGSW',
    },
    pto: { vacationHrs: 9, sickHrs: 7, personalHrs: 2, fmlaUsed: '40h', ytdUsed: 12, pendingRequest: '—' },
    ceu: { license: 'LGSW-84201', earned: 20, required: 20 },
  },
  {
    key: 'angela',
    name: 'Angela Brooks',
    localPart: 'angela.brooks',
    role: 'PRP_SPECIALIST',
    jobTitle: 'PRP Specialist',
    department: 'PRP',
    employmentType: 'Part-Time',
    hrStatus: 'Active',
    hireDate: '2022-11-14',
    managerName: 'Tony Williams',
    sortOrder: 6,
    license: {
      title: 'CPRS',
      licenseNumber: 'CPRS-22047',
      issuer: 'MD PRP Credentialing',
      expiresAt: '2026-11-10',
      credentialLabel: 'CPRS',
    },
    pto: { vacationHrs: 4, sickHrs: 3, personalHrs: 1, fmlaUsed: '—', ytdUsed: 5, pendingRequest: '—' },
    ceu: { license: 'CPRS-22047', earned: 12, required: 15 },
  },
  {
    key: 'kevin',
    name: 'Kevin Davis',
    localPart: 'kevin.davis',
    role: 'FRONT_DESK',
    jobTitle: 'Front Desk',
    department: 'Administrative',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2020-06-01',
    managerName: 'Marcus Johnson',
    sortOrder: 7,
    pto: { vacationHrs: 12, sickHrs: 8, personalHrs: 3, fmlaUsed: '—', ytdUsed: 6, pendingRequest: '—' },
  },
  {
    key: 'sandra',
    name: 'Sandra Lee',
    localPart: 'sandra.lee',
    role: 'BILLING',
    jobTitle: 'Billing Specialist (CPC)',
    department: 'Administrative',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2022-04-18',
    managerName: 'Kevin Davis',
    sortOrder: 8,
    license: {
      title: 'CPC',
      licenseNumber: 'CPC-55821',
      issuer: 'AAPC',
      expiresAt: '2026-07-01',
      credentialLabel: 'CPC',
    },
    pto: { vacationHrs: 7, sickHrs: 5, personalHrs: 2, fmlaUsed: '—', ytdUsed: 4, pendingRequest: '—' },
  },
  {
    key: 'darius',
    name: 'Darius Roberts',
    localPart: 'darius.roberts',
    role: 'PEER_SUPPORT',
    jobTitle: 'Peer Support Specialist',
    department: 'Community',
    employmentType: 'Part-Time',
    hrStatus: 'Active',
    hireDate: '2023-01-09',
    managerName: 'Lisa Chen',
    sortOrder: 9,
    license: {
      title: 'CPSS',
      licenseNumber: 'CPSS-66301',
      issuer: 'MD Peer Support Certification',
      expiresAt: '2026-05-15',
      credentialLabel: 'CPSS',
    },
    pto: { vacationHrs: 3, sickHrs: 2, personalHrs: 1, fmlaUsed: '—', ytdUsed: 1, pendingRequest: '1d' },
  },
  {
    key: 'nicole',
    name: 'Dr. Nicole Williams',
    localPart: 'nicole.williams',
    role: 'THERAPIST',
    jobTitle: 'Licensed Psychologist (PhD)',
    department: 'Clinical',
    employmentType: 'Contract',
    hrStatus: 'On Leave',
    hireDate: '2019-06-03',
    managerName: 'Marcus Johnson',
    sortOrder: 10,
    license: {
      title: 'Psychologist',
      licenseNumber: 'PSY-44110',
      issuer: 'MD Board of Examiners of Psychologists',
      expiresAt: '2026-10-05',
      credentialLabel: 'PhD',
    },
    pto: { vacationHrs: 0, sickHrs: 0, personalHrs: 0, fmlaUsed: '440h', ytdUsed: 440, pendingRequest: '—' },
  },
  {
    key: 'rachel',
    name: 'Rachel Thomas',
    localPart: 'rachel.thomas',
    role: 'HR',
    jobTitle: 'HR Manager',
    department: 'Administrative',
    employmentType: 'Full-Time',
    hrStatus: 'Active',
    hireDate: '2021-07-20',
    managerName: 'Marcus Johnson',
    sortOrder: 11,
    pto: { vacationHrs: 11, sickHrs: 6, personalHrs: 2, fmlaUsed: '—', ytdUsed: 5, pendingRequest: '—' },
  },
];

function emailFor(localPart: string, slug: string, primary: boolean) {
  return primary ? `${localPart}@divinecounseling.com` : `${localPart}@${slug}.divinecounseling.com`;
}

export async function seedHrCorner(
  prisma: PrismaClient,
  organizationId: string,
  orgSlug: string,
  opts?: { replace?: boolean }
) {
  const existing = await prisma.staffHrProfile.count({
    where: { organizationId, seedKey: SEED_KEY },
  });
  if (existing > 0 && !opts?.replace) {
    return { skipped: true as const, staff: existing };
  }

  if (opts?.replace) {
    const profiles = await prisma.staffHrProfile.findMany({
      where: { organizationId, seedKey: SEED_KEY },
      select: { userId: true },
    });
    const userIds = profiles.map((p) => p.userId);
    await prisma.hrJobApplicant.deleteMany({
      where: { requisition: { organizationId } },
    });
    await prisma.hrJobRequisition.deleteMany({ where: { organizationId } });
    await prisma.hrPayrollRun.deleteMany({ where: { organizationId } });
    await prisma.hrBenefitPlan.deleteMany({ where: { organizationId } });
    await prisma.hrLeaveRequest.deleteMany({ where: { organizationId } });
    await prisma.hrPtoBalance.deleteMany({ where: { organizationId } });
    await prisma.hrComplianceItem.deleteMany({ where: { organizationId } });
    await prisma.hrCeuProgress.deleteMany({ where: { organizationId } });
    await prisma.hrHeadcountPoint.deleteMany({ where: { organizationId } });
    await prisma.hrTurnoverPoint.deleteMany({ where: { organizationId } });
    await prisma.hrDeptCompensation.deleteMany({ where: { organizationId } });
    await prisma.hrOrgSnapshot.deleteMany({ where: { organizationId } });
    await prisma.hrDirectDepositSetting.deleteMany({ where: { organizationId } });
    if (userIds.length) {
      await prisma.staffCredential.deleteMany({
        where: { organizationId, userId: { in: userIds } },
      });
      await prisma.staffHrProfile.deleteMany({ where: { organizationId, seedKey: SEED_KEY } });
      await prisma.user.deleteMany({
        where: {
          id: { in: userIds },
          email: { contains: 'divinecounseling.com' },
        },
      });
    }
  }

  const passwordHash = await hash(PASSWORD, 10);
  const primary = orgSlug === 'demo-clinic';
  const byKey: Record<string, string> = {};

  for (const row of STAFF) {
    const email = emailFor(row.localPart, orgSlug, primary);
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name: row.name,
        role: row.role,
        roles: [row.role],
        status: 'ACTIVE',
        organizationId,
        npi: row.npi ?? undefined,
        passwordHash,
      },
      create: {
        name: row.name,
        email,
        role: row.role,
        roles: [row.role],
        status: 'ACTIVE',
        organizationId,
        npi: row.npi ?? undefined,
        passwordHash,
      },
    });
    byKey[row.key] = user.id;

    await prisma.staffHrProfile.upsert({
      where: { userId: user.id },
      update: {
        organizationId,
        jobTitle: row.jobTitle,
        department: row.department,
        employmentType: row.employmentType,
        hrStatus: row.hrStatus,
        hireDate: atNoon(row.hireDate),
        managerName: row.managerName,
        npi: row.npi ?? null,
        deaNumber: row.deaNumber ?? null,
        sortOrder: row.sortOrder,
        seedKey: SEED_KEY,
      },
      create: {
        organizationId,
        userId: user.id,
        jobTitle: row.jobTitle,
        department: row.department,
        employmentType: row.employmentType,
        hrStatus: row.hrStatus,
        hireDate: atNoon(row.hireDate),
        managerName: row.managerName,
        npi: row.npi ?? null,
        deaNumber: row.deaNumber ?? null,
        sortOrder: row.sortOrder,
        seedKey: SEED_KEY,
      },
    });

    if (row.license) {
      const existingLic = await prisma.staffCredential.findFirst({
        where: { organizationId, userId: user.id, licenseNumber: row.license.licenseNumber },
      });
      const data = {
        organizationId,
        userId: user.id,
        credentialType: 'LICENSE' as const,
        title: row.license.title,
        licenseNumber: row.license.licenseNumber,
        issuer: row.license.issuer,
        issuedAt: atNoon('2023-01-15'),
        expiresAt: atNoon(row.license.expiresAt),
        status: 'ACTIVE' as const,
        ceuRequired: row.ceu?.required ?? 0,
        ceuCompleted: row.ceu?.earned ?? 0,
      };
      if (existingLic) {
        await prisma.staffCredential.update({ where: { id: existingLic.id }, data });
      } else {
        await prisma.staffCredential.create({ data });
      }
    }

    await prisma.hrPtoBalance.upsert({
      where: { userId: user.id },
      update: {
        organizationId,
        employee: row.name,
        department: row.department,
        ...row.pto,
        sortOrder: row.sortOrder,
      },
      create: {
        organizationId,
        userId: user.id,
        employee: row.name,
        department: row.department,
        ...row.pto,
        sortOrder: row.sortOrder,
      },
    });

    if (row.ceu) {
      await prisma.hrCeuProgress.upsert({
        where: { userId: user.id },
        update: {
          organizationId,
          clinician: row.name,
          license: row.ceu.license,
          creditsEarned: row.ceu.earned,
          creditsRequired: row.ceu.required,
          sortOrder: row.sortOrder,
        },
        create: {
          organizationId,
          userId: user.id,
          clinician: row.name,
          license: row.ceu.license,
          creditsEarned: row.ceu.earned,
          creditsRequired: row.ceu.required,
          sortOrder: row.sortOrder,
        },
      });
    }
  }

  const extras: { userId: string; title: string; licenseNumber: string; issuer: string; expiresAt: string }[] = [
    {
      userId: byKey.maria,
      title: 'RN',
      licenseNumber: 'RN-22011',
      issuer: 'MD Board of Nursing',
      expiresAt: '2027-05-01',
    },
    {
      userId: byKey.kevin,
      title: 'Notary Public',
      licenseNumber: 'NOT-MD-441',
      issuer: 'MD Secretary of State',
      expiresAt: '2027-01-20',
    },
    {
      userId: byKey.rachel,
      title: 'PHR',
      licenseNumber: 'PHR-90211',
      issuer: 'HRCI',
      expiresAt: '2027-06-15',
    },
  ];
  for (const extra of extras) {
    const found = await prisma.staffCredential.findFirst({
      where: { organizationId, userId: extra.userId, licenseNumber: extra.licenseNumber },
    });
    const data = {
      organizationId,
      userId: extra.userId,
      credentialType: 'LICENSE' as const,
      title: extra.title,
      licenseNumber: extra.licenseNumber,
      issuer: extra.issuer,
      issuedAt: atNoon('2023-06-01'),
      expiresAt: atNoon(extra.expiresAt),
      status: 'ACTIVE' as const,
    };
    if (found) await prisma.staffCredential.update({ where: { id: found.id }, data });
    else await prisma.staffCredential.create({ data });
  }

  await prisma.hrOrgSnapshot.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });

  await prisma.hrDirectDepositSetting.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });

  await prisma.hrPayrollRun.deleteMany({ where: { organizationId } });
  await prisma.hrPayrollRun.createMany({
    data: [
      {
        organizationId,
        period: 'Mar 1 – Mar 15, 2026',
        periodHint: 'Mar 1–15 period',
        employees: 12,
        gross: 98420,
        taxes: 18440,
        benefits: 8640,
        net: 71340,
        runDate: 'Mar 20, 2026',
        status: 'scheduled',
        sortOrder: 0,
      },
      {
        organizationId,
        period: 'Feb 16 – Feb 28, 2026',
        periodHint: 'Feb 16–28',
        employees: 12,
        gross: 96810,
        taxes: 18110,
        benefits: 8598,
        net: 70102,
        runDate: 'Mar 5, 2026',
        status: 'completed',
        sortOrder: 1,
      },
      {
        organizationId,
        period: 'Feb 1 – Feb 15, 2026',
        periodHint: 'Feb 1–15',
        employees: 11,
        gross: 91200,
        taxes: 17080,
        benefits: 8070,
        net: 66050,
        runDate: 'Feb 20, 2026',
        status: 'completed',
        sortOrder: 2,
      },
      {
        organizationId,
        period: 'Jan 16 – Jan 31, 2026',
        periodHint: 'Jan 16–31',
        employees: 11,
        gross: 91200,
        taxes: 17080,
        benefits: 8070,
        net: 66050,
        runDate: 'Feb 5, 2026',
        status: 'completed',
        sortOrder: 3,
      },
    ],
  });

  await prisma.hrBenefitPlan.deleteMany({ where: { organizationId } });
  await prisma.hrBenefitPlan.createMany({
    data: [
      {
        organizationId,
        plan: 'Medical — BCBS Blue Preferred (PPO)',
        carrier: 'CareFirst BCBS',
        enrolled: 9,
        eligible: 10,
        employerCost: 520,
        employeeCost: 180,
        employerCostLabel: '$520/mo',
        employeeCostLabel: '$180/mo',
        details:
          'CareFirst Blue Preferred PPO. In-network deductible $500 individual / $1,000 family. Employer pays $520/mo per enrolled employee.',
        sortOrder: 0,
      },
      {
        organizationId,
        plan: 'Dental — Delta Dental PPO',
        carrier: 'Delta Dental',
        enrolled: 8,
        eligible: 10,
        employerCost: 40,
        employeeCost: 12,
        employerCostLabel: '$40/mo',
        employeeCostLabel: '$12/mo',
        details: 'Delta Dental PPO. Preventative 100%, basic 80%, major 50% after deductible.',
        sortOrder: 1,
      },
      {
        organizationId,
        plan: 'Vision — VSP Choice',
        carrier: 'VSP',
        enrolled: 7,
        eligible: 10,
        employerCost: 15,
        employeeCost: 5,
        employerCostLabel: '$15/mo',
        employeeCostLabel: '$5/mo',
        details: 'VSP Choice. Annual exam, $150 frame allowance, lenses covered in-network.',
        sortOrder: 2,
      },
      {
        organizationId,
        plan: '403(b) Retirement — Fidelity',
        carrier: 'Fidelity Investments',
        enrolled: 6,
        eligible: 10,
        employerCost: 0,
        employeeCost: 0,
        employerCostLabel: '4% match',
        employeeCostLabel: 'Varies',
        details: 'Fidelity 403(b). Dollar-for-dollar match up to 4% of eligible wages.',
        sortOrder: 3,
      },
      {
        organizationId,
        plan: 'FSA — Healthcare',
        carrier: 'WEX Health',
        enrolled: 4,
        eligible: 10,
        employerCost: 0,
        employeeCost: 0,
        employerCostLabel: '$0',
        employeeCostLabel: 'Up to $3,050/yr',
        details: 'Healthcare FSA via WEX. 2026 IRS max $3,050. Use-it-or-lose-it with $640 rollover.',
        sortOrder: 4,
      },
      {
        organizationId,
        plan: 'Life / AD&D (1x salary)',
        carrier: 'MetLife',
        enrolled: 10,
        eligible: 10,
        employerCost: 51.5,
        employeeCost: 0,
        employerCostLabel: '100% employer paid',
        employeeCostLabel: '$0',
        details: 'MetLife basic life and AD&D equal to 1x annual salary. 100% employer paid.',
        sortOrder: 5,
      },
    ],
  });

  await prisma.hrLeaveRequest.deleteMany({ where: { organizationId } });
  await prisma.hrLeaveRequest.createMany({
    data: [
      {
        organizationId,
        userId: byKey.maria,
        employee: 'Maria Rivera',
        leaveType: 'Vacation',
        dates: 'Mar 20–21, 2026',
        days: 2,
        submitted: 'Mar 2',
        notes: 'Family commitment',
        status: 'Pending',
        sortOrder: 0,
      },
      {
        organizationId,
        userId: byKey.lisa,
        employee: 'Lisa Chen',
        leaveType: 'FMLA',
        dates: 'Mar 10–14, 2026',
        days: 5,
        submitted: 'Mar 1',
        notes: 'Approved - medical',
        status: 'Approved',
        sortOrder: 1,
      },
      {
        organizationId,
        userId: byKey.angela,
        employee: 'Angela Brooks',
        leaveType: 'Sick',
        dates: 'Mar 7, 2026',
        days: 1,
        submitted: 'Mar 6',
        notes: '—',
        status: 'Approved',
        sortOrder: 2,
      },
      {
        organizationId,
        userId: byKey.darius,
        employee: 'Darius Roberts',
        leaveType: 'Personal',
        dates: 'Mar 15, 2026',
        days: 1,
        submitted: 'Mar 5',
        notes: '—',
        status: 'Pending',
        sortOrder: 3,
      },
    ],
  });

  await prisma.hrJobRequisition.deleteMany({ where: { organizationId } });
  const reqs = await Promise.all([
    prisma.hrJobRequisition.create({
      data: {
        organizationId,
        title: 'Licensed Therapist (LCSW/LGPC)',
        department: 'Clinical',
        priority: 'high',
        type: 'Full-Time',
        posted: 'Feb 10, 2026',
        salary: '$68k–$82k',
        applied: 14,
        screened: 8,
        interviews: 3,
        offers: 1,
        hired: 0,
        sortOrder: 0,
        applicants: {
          create: [
            { name: 'Amina Cole', email: 'amina.cole@email.com', stage: 'Offer', appliedAt: 'Feb 12, 2026', notes: 'LGPC, 4 yrs CMH' },
            { name: 'Jordan Hale', email: 'jordan.hale@email.com', stage: 'Interview', appliedAt: 'Feb 18, 2026' },
            { name: 'Priya Shah', email: 'priya.shah@email.com', stage: 'Screened', appliedAt: 'Feb 20, 2026' },
          ],
        },
      },
    }),
    prisma.hrJobRequisition.create({
      data: {
        organizationId,
        title: 'PRP Specialist',
        department: 'PRP',
        priority: 'medium',
        type: 'Full-Time',
        posted: 'Feb 25, 2026',
        salary: '$42k–$52k',
        applied: 7,
        screened: 4,
        interviews: 2,
        offers: 0,
        hired: 0,
        sortOrder: 1,
        applicants: {
          create: [
            { name: 'Devon Miles', email: 'devon.miles@email.com', stage: 'Interview', appliedAt: 'Mar 1, 2026' },
            { name: 'Casey Nguyen', email: 'casey.nguyen@email.com', stage: 'Screened', appliedAt: 'Mar 3, 2026' },
          ],
        },
      },
    }),
    prisma.hrJobRequisition.create({
      data: {
        organizationId,
        title: 'Community Outreach Coordinator',
        department: 'Community',
        priority: 'medium',
        type: 'Part-Time',
        posted: 'Mar 1, 2026',
        salary: '$18–$22/hr',
        applied: 9,
        screened: 5,
        interviews: 2,
        offers: 0,
        hired: 0,
        sortOrder: 2,
        applicants: {
          create: [{ name: 'Riley Grant', email: 'riley.grant@email.com', stage: 'Interview', appliedAt: 'Mar 4, 2026' }],
        },
      },
    }),
    prisma.hrJobRequisition.create({
      data: {
        organizationId,
        title: 'Billing Specialist (CPC)',
        department: 'Administrative',
        priority: 'low',
        type: 'Part-Time',
        posted: 'Mar 2, 2026',
        salary: '$24–$30/hr',
        applied: 33,
        screened: 16,
        interviews: 0,
        offers: 0,
        hired: 0,
        sortOrder: 3,
        applicants: {
          create: [{ name: 'Sam Ortiz', email: 'sam.ortiz@email.com', stage: 'Applied', appliedAt: 'Mar 5, 2026' }],
        },
      },
    }),
  ]);

  await prisma.hrComplianceItem.deleteMany({ where: { organizationId } });
  await prisma.hrComplianceItem.createMany({
    data: [
      {
        organizationId,
        title: 'Employment Eligibility (I-9)',
        detail: '2 employees with expiring work authorization documents (within 90 days)',
        status: 'Alert',
        bannerText: 'I-9 document expired (Darius Roberts) — action required within 3 business days',
        sortOrder: 0,
      },
      {
        organizationId,
        title: 'OIG Exclusion Screening',
        detail: 'Monthly OIG LEIE screening has not been run for March.',
        status: 'Alert',
        bannerText: 'OIG Exclusion Screening not run for March',
        sortOrder: 1,
      },
      {
        organizationId,
        title: 'Maryland COMAR 10.21.20 (PRP)',
        detail: 'Supervisor-to-staff ratio documentation due by Mar 31',
        status: 'Review',
        sortOrder: 2,
      },
      {
        organizationId,
        title: 'Form I-9 Section 3 reverification',
        detail: 'Reverification packet for one part-time community staff member.',
        status: 'Review',
        sortOrder: 3,
      },
      {
        organizationId,
        title: 'Wage & Hour audit pack',
        detail: 'Semi-monthly timesheet attestations for March pending HR sign-off.',
        status: 'Review',
        sortOrder: 4,
      },
      {
        organizationId,
        title: 'HIPAA Workforce Training',
        detail: '11/12 staff completed annual HIPAA training. 1 overdue (Darius Roberts)',
        status: 'Compliant',
        sortOrder: 5,
      },
      {
        organizationId,
        title: 'Background Checks',
        detail: 'All 12 active employees — cleared within last 3 years',
        status: 'Compliant',
        sortOrder: 6,
      },
      {
        organizationId,
        title: 'OSHA 300 log',
        detail: 'No recordable workplace injuries YTD. Log posted.',
        status: 'Compliant',
        sortOrder: 7,
      },
      {
        organizationId,
        title: 'EEO-1 snapshot',
        detail: '2025 EEO-1 Component 1 filed.',
        status: 'Compliant',
        sortOrder: 8,
      },
      {
        organizationId,
        title: 'Employee handbook acknowledgment',
        detail: '12/12 staff signed the 2026 handbook addendum.',
        status: 'Compliant',
        sortOrder: 9,
      },
      {
        organizationId,
        title: 'Workers’ compensation coverage',
        detail: 'Policy current through Dec 2026 (Injured Workers’ Insurance Fund).',
        status: 'Compliant',
        sortOrder: 10,
      },
    ],
  });

  await prisma.hrHeadcountPoint.deleteMany({ where: { organizationId } });
  await prisma.hrHeadcountPoint.createMany({
    data: ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'].map((monthLabel, sortOrder) => ({
      organizationId,
      monthLabel,
      count: sortOrder < 3 ? 11 : 12,
      sortOrder,
    })),
  });

  await prisma.hrTurnoverPoint.deleteMany({ where: { organizationId } });
  await prisma.hrTurnoverPoint.createMany({
    data: [0, 1, 0, 0, 0, 1, 0, 0].map((count, sortOrder) => ({
      organizationId,
      monthLabel: ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'][sortOrder],
      count,
      sortOrder,
    })),
  });

  await prisma.hrDeptCompensation.deleteMany({ where: { organizationId } });
  await prisma.hrDeptCompensation.createMany({
    data: [
      {
        organizationId,
        department: 'Clinical',
        headcount: 5,
        avgSalary: 122000,
        totalPayrollYr: 610000,
        ceuPct: 96,
        turnoverLabel: '0 departures',
        turnoverTone: 'green',
        sortOrder: 0,
      },
      {
        organizationId,
        department: 'PRP',
        headcount: 2,
        avgSalary: 36000,
        totalPayrollYr: 72000,
        ceuPct: 90,
        turnoverLabel: '1 departure',
        turnoverTone: 'amber',
        sortOrder: 1,
      },
      {
        organizationId,
        department: 'Administrative',
        headcount: 3,
        avgSalary: 60000,
        totalPayrollYr: 180000,
        ceuPct: 100,
        turnoverLabel: '0 departures',
        turnoverTone: 'green',
        sortOrder: 2,
      },
      {
        organizationId,
        department: 'Case Mgmt',
        headcount: 1,
        avgSalary: 48000,
        totalPayrollYr: 48000,
        ceuPct: 100,
        turnoverLabel: '0 departures',
        turnoverTone: 'green',
        sortOrder: 3,
      },
      {
        organizationId,
        department: 'Community',
        headcount: 1,
        avgSalary: 28000,
        totalPayrollYr: 28000,
        ceuPct: 80,
        turnoverLabel: '1 departure',
        turnoverTone: 'amber',
        sortOrder: 4,
      },
    ],
  });

  return { skipped: false as const, staff: STAFF.length, requisitions: reqs.length };
}
