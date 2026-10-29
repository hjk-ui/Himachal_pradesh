import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { daysUntilExpiry } from '@/lib/hr/credentials';

/** Same leadership set as the /dashboard/hr page (PRACTICE_DIRECTOR was missing: page opened, API refused) */
export const HR_CORNER_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR'];
const LICENSE_WINDOW_DAYS = 90;
const CREDENTIAL_BADGE_DAYS = 35;

export function canAccessHrCorner(role: Role | undefined | null) {
  return Boolean(role && HR_CORNER_ROLES.includes(role));
}

function isMissingTableError(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

function hireLabel(d: Date | null) {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function initials(name: string) {
  return name
    .replace(/^Dr\.\s+/i, '')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export type HrCornerEmployee = {
  id: string;
  userId: string;
  name: string;
  email: string;
  initials: string;
  jobTitle: string;
  department: string;
  employmentType: string;
  hrStatus: string;
  hireDate: string | null;
  hireLabel: string;
  managerName: string;
  role: Role;
  npi: string | null;
  deaNumber: string | null;
  sortOrder: number;
};

export type HrCornerLicense = {
  id: string;
  userId: string;
  clinician: string;
  department: string;
  credential: string;
  licenseNumber: string;
  npi: string | null;
  deaNumber: string | null;
  expiresAt: string;
  daysLeft: number;
  reminderAt: string | null;
};

function serializeEmployee(row: {
  id: string;
  jobTitle: string;
  department: string;
  employmentType: string;
  hrStatus: string;
  hireDate: Date | null;
  managerName: string;
  npi: string | null;
  deaNumber: string | null;
  sortOrder: number;
  user: { id: string; name: string | null; email: string; role: Role };
}): HrCornerEmployee {
  const name = row.user.name?.trim() || row.user.email;
  return {
    id: row.id,
    userId: row.user.id,
    name,
    email: row.user.email,
    initials: initials(name),
    jobTitle: row.jobTitle,
    department: row.department,
    employmentType: row.employmentType,
    hrStatus: row.hrStatus,
    hireDate: row.hireDate ? row.hireDate.toISOString().slice(0, 10) : null,
    hireLabel: hireLabel(row.hireDate),
    managerName: row.managerName,
    role: row.user.role,
    npi: row.npi,
    deaNumber: row.deaNumber,
    sortOrder: row.sortOrder,
  };
}

export async function getHrCorner(organizationId: string) {
  try {
    const [
      profiles,
      snapshot,
      payroll,
      benefits,
      leave,
      pto,
      requisitions,
      compliance,
      ceu,
      deposit,
      headcount,
      turnover,
      deptComp,
    ] = await Promise.all([
      prisma.staffHrProfile.findMany({
        where: { organizationId },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.hrOrgSnapshot.findUnique({ where: { organizationId } }),
      prisma.hrPayrollRun.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrBenefitPlan.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrLeaveRequest.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrPtoBalance.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrJobRequisition.findMany({
        where: { organizationId },
        include: { applicants: { orderBy: { createdAt: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.hrComplianceItem.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrCeuProgress.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrDirectDepositSetting.findUnique({ where: { organizationId } }),
      prisma.hrHeadcountPoint.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrTurnoverPoint.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.hrDeptCompensation.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
    ]);

    const employees = profiles.map(serializeEmployee);
    const userIds = employees.map((e) => e.userId);
    const creds = userIds.length
      ? await prisma.staffCredential.findMany({
          where: { organizationId, userId: { in: userIds }, credentialType: 'LICENSE' },
          include: { user: { select: { name: true, email: true } } },
          orderBy: { expiresAt: 'asc' },
        })
      : [];

    const profileByUser = new Map(employees.map((e) => [e.userId, e]));
    const licenses: HrCornerLicense[] = creds.map((row) => {
      const profile = profileByUser.get(row.userId);
      return {
        id: row.id,
        userId: row.userId,
        clinician: row.user.name?.trim() || row.user.email,
        department: profile?.department || '—',
        credential: row.title,
        licenseNumber: row.licenseNumber,
        npi: profile?.npi || null,
        deaNumber: profile?.deaNumber || null,
        expiresAt: row.expiresAt.toISOString().slice(0, 10),
        daysLeft: daysUntilExpiry(row.expiresAt),
        reminderAt: row.reminderAt?.toISOString() ?? null,
      };
    });

    // ── Computed KPIs (never the seeded HrOrgSnapshot numbers) ──────────────────
    const nowMs = Date.now();
    const hireDates = profiles
      .map((p) => p.hireDate)
      .filter((d): d is Date => d instanceof Date && Number.isFinite(d.getTime()) && d.getTime() <= nowMs);
    const avgTenureYears = hireDates.length
      ? Math.round((hireDates.reduce((s, d) => s + (nowMs - d.getTime()), 0) / hireDates.length / (365.25 * 86_400_000)) * 10) / 10
      : null;
    // CEU progress from the staff credentials that carry a CEU requirement.
    const ceuCreds = userIds.length
      ? await prisma.staffCredential.findMany({
          where: { organizationId, userId: { in: userIds }, ceuRequired: { gt: 0 } },
          include: { user: { select: { name: true, email: true } } },
          orderBy: { expiresAt: 'asc' },
        })
      : [];
    const ceuRows = ceuCreds.map((c) => ({
      id: c.id,
      clinician: c.user.name?.trim() || c.user.email,
      license: c.title,
      creditsEarned: c.ceuCompleted,
      creditsRequired: c.ceuRequired,
      pct: c.ceuRequired ? Math.min(100, Math.round((c.ceuCompleted / c.ceuRequired) * 100)) : 0,
    }));
    const ceuCompliancePct = ceuRows.length
      ? Math.round((ceuRows.filter((c) => c.creditsEarned >= c.creditsRequired).length / ceuRows.length) * 100)
      : null;
    const complianceScore = compliance.length
      ? Math.round((compliance.filter((c) => c.status === 'Compliant').length / compliance.length) * 100)
      : null;
    const avgVacationDays = pto.length
      ? Math.round((pto.reduce((s, r) => s + (r.vacationHrs || 0), 0) / pto.length / 8) * 10) / 10
      : null;
    const onLeaveToday = employees.filter((e) => e.hrStatus === 'On Leave').length;

    const activeLicenses = licenses.filter((l) => l.daysLeft >= 0).length;
    const expiring90 = licenses.filter((l) => l.daysLeft <= LICENSE_WINDOW_DAYS).length;
    const npiCount = new Set(employees.filter((e) => e.npi).map((e) => e.npi)).size;
    const deaCount = employees.filter((e) => e.deaNumber).length;
    const pendingLeave = leave.filter((r) => r.status === 'Pending').length;
    const alertItems = compliance.filter((c) => c.status === 'Alert');
    const reviewItems = compliance.filter((c) => c.status === 'Review');
    const compliantItems = compliance.filter((c) => c.status === 'Compliant');
    const credentialBadge = licenses.filter((l) => l.daysLeft > 0 && l.daysLeft <= CREDENTIAL_BADGE_DAYS).length;

    const ft = employees.filter((e) => e.employmentType === 'Full-Time').length;
    const pt = employees.filter((e) => e.employmentType === 'Part-Time').length;
    const contract = employees.filter((e) => e.employmentType === 'Contract').length;

    const deptOrder = ['Clinical', 'PRP', 'Administrative', 'Case Mgmt', 'Community'];
    const departments = deptOrder
      .map((name) => {
        const count = employees.filter((e) => e.department === name).length;
        return {
          name,
          count,
          pct: employees.length ? Math.round((count / employees.length) * 100) : 0,
        };
      })
      .filter((d) => d.count > 0);

    const leadership = {
      director: employees.find((e) => e.jobTitle === 'Practice Director') || employees.find((e) => e.role === 'DIRECTOR'),
      reports: [
        employees.find((e) => e.jobTitle === 'Psychiatrist'),
        employees.find((e) => e.jobTitle === 'Lead Therapist'),
        employees.find((e) => e.jobTitle === 'Front Desk' || e.jobTitle === 'Office Manager'),
        employees.find((e) => e.jobTitle === 'HR Manager'),
      ].filter((row): row is HrCornerEmployee => Boolean(row)),
    };

    const displayLicenses = licenses;
    const bannerParts = alertItems.map((i) => i.bannerText).filter(Boolean);
    const payrollDto = payroll.map((p) => ({
        id: p.id,
        period: p.period,
        periodHint: p.periodHint,
        employees: p.employees,
        gross: p.gross,
        taxes: p.taxes,
        benefits: p.benefits,
        net: p.net,
        runDate: p.runDate,
        status: p.status,
      }));
    const lastCompleted = payrollDto.find((p) => p.status === 'completed');
    const nextRun = payrollDto.find((p) => p.status === 'scheduled');

    return {
      schemaReady: true as const,
      employees,
      // null = not tracked in Altrixs (shown as such). The HrOrgSnapshot row only ever held seed
      // numbers, so it is no longer read for KPIs; values below come from real records or are null.
      snapshot: {
        ytdTurnoverPct: null,
        avgTenureYears,
        avgTimeToFillDays: null,
        timeToFillDeltaDays: null,
        costPerHire: null,
        fmlaHoursYtd: null,
        avgVacationDays,
        ceuCompliancePct,
        electiveOfferings: null,
        requiredTrainings: null,
        totalCreditsAvailable: null,
        benefitsCostMonthly: null,
        complianceScore,
        pendingW4: null,
        ytdPayroll: null,
        employeesOnLeaveToday: onLeaveToday,
        openEnrollmentNote: '',
        openEnrollmentDetail: '',
        payrollProviderNote: '',
      },
      payroll: payrollDto,
      benefits: benefits.map((b) => ({
        id: b.id,
        plan: b.plan,
        carrier: b.carrier,
        enrolled: b.enrolled,
        eligible: b.eligible,
        employerCost: b.employerCost,
        employeeCost: b.employeeCost,
        employerCostLabel: b.employerCostLabel,
        employeeCostLabel: b.employeeCostLabel,
        details: b.details,
      })),
      leave: leave.map((r) => ({
        id: r.id,
        employee: r.employee,
        leaveType: r.leaveType,
        dates: r.dates,
        days: r.days,
        submitted: r.submitted,
        notes: r.notes,
        status: r.status,
      })),
      pto: pto.map((r) => ({
        id: r.id,
        employee: r.employee,
        department: r.department,
        vacationHrs: r.vacationHrs,
        sickHrs: r.sickHrs,
        personalHrs: r.personalHrs,
        fmlaUsed: r.fmlaUsed,
        ytdUsed: r.ytdUsed,
        pendingRequest: r.pendingRequest,
      })),
      requisitions: requisitions.map((r) => ({
        id: r.id,
        title: r.title,
        department: r.department,
        priority: r.priority,
        type: r.type,
        posted: r.posted,
        salary: r.salary,
        applied: r.applied,
        screened: r.screened,
        interviews: r.interviews,
        offers: r.offers,
        hired: r.hired,
        applicants: r.applicants.map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          stage: a.stage,
          appliedAt: a.appliedAt,
          notes: a.notes,
        })),
      })),
      compliance: compliance.map((c) => ({
        id: c.id,
        title: c.title,
        detail: c.detail,
        status: c.status,
      })),
      // From StaffCredential.ceuRequired / ceuCompleted (the HrCeuProgress table was seed-only).
      ceu: ceuRows,
      deposit: deposit && {
        percentOnDd: deposit.percentOnDd,
        bankName: deposit.bankName,
        accountLast4: deposit.accountLast4,
        routingLast4: deposit.routingLast4,
      },
      // Headcount history, separations and salary data are not tracked in Altrixs: the seeded chart
      // tables are not shown. Department headcount comes from the staff directory.
      headcount: [] as { id: string; monthLabel: string; count: number }[],
      turnover: [] as { id: string; monthLabel: string; count: number }[],
      deptComp: departments.map((d) => ({
        id: d.name,
        department: d.name,
        headcount: d.count,
        avgSalary: null,
        totalPayrollYr: null,
        ceuPct: null,
        turnoverLabel: 'Not tracked',
        turnoverTone: 'slate',
      })),
      licenses: displayLicenses,
      kpis: {
        headcount: employees.length,
        fullTime: ft,
        partTime: pt,
        contract,
        ytdTurnoverPct: null,
        lastPayroll: lastCompleted?.gross ?? 0,
        lastPayrollHint: lastCompleted?.periodHint || '—',
        nextPayDate: nextRun?.runDate || '—',
        nextPayHint: nextRun?.periodHint || 'No run scheduled',
        ytdPayroll: null,
        pendingW4: null,
        nextRun,
        pendingLeave,
        onLeaveToday,
        openReqs: requisitions.length,
        totalApplicants: requisitions.reduce((s, r) => s + r.applied, 0),
        interviews: requisitions.reduce((s, r) => s + r.interviews, 0),
        offers: requisitions.reduce((s, r) => s + r.offers, 0),
        activeLicenses,
        expiring90,
        npiCount,
        deaCount,
        alertCount: alertItems.length,
        reviewCount: reviewItems.length,
        compliantCount: compliantItems.length,
      },
      badges: {
        payroll: 0,
        pto: pendingLeave,
        credentialing: credentialBadge,
        compliance: alertItems.length,
      },
      departments,
      leadership,
      alertBanner: alertItems.length
        ? {
            count: alertItems.length,
            text: bannerParts.join(' · ') || alertItems.map((i) => i.detail).join(' · '),
          }
        : null,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { schemaReady: false as const, error: 'HR Corner is not set up yet. Ask an administrator to finish setup.' };
    }
    throw err;
  }
}

/**
 * Adds an employee through the staff invite flow: the account is created INVITED with no
 * password, and the employee sets their own password from the emailed invite link. No shared
 * default password is ever set.
 */
export async function createHrEmployee(
  organizationId: string,
  input: {
    name: string;
    email: string;
    jobTitle: string;
    department: string;
    employmentType: string;
    managerName?: string;
    hireDate?: string;
    role?: Role;
  },
  invitedById: string
): Promise<
  | { ok: true; employee: HrCornerEmployee; emailMode?: string }
  | { ok: false; error: string; status: number }
> {
  const role = input.role || 'THERAPIST';
  // Lazy import: the invite module loads mail/server-only code; role checks import this file.
  const { createStaffInvite } = await import('@/lib/staff/invite');
  const invite = await createStaffInvite({
    name: input.name,
    email: input.email,
    role,
    roles: [role],
    invitedById,
    organizationId,
  });
  if (!invite.ok) return { ok: false, error: invite.error, status: invite.status };
  const user = { id: invite.user.id };
  const existingProfile = await prisma.staffHrProfile.findUnique({ where: { userId: user.id } });
  if (existingProfile) {
    return { ok: false, error: 'This person already has an HR profile', status: 409 };
  }
  const maxSort = await prisma.staffHrProfile.aggregate({
    where: { organizationId },
    _max: { sortOrder: true },
  });
  const profile = await prisma.staffHrProfile.create({
    data: {
      organizationId,
      userId: user.id,
      jobTitle: input.jobTitle.trim(),
      department: input.department,
      employmentType: input.employmentType,
      hrStatus: 'Active',
      // Only the hire date that was entered; never "today" by default.
      hireDate: input.hireDate ? new Date(`${input.hireDate}T12:00:00`) : null,
      managerName: input.managerName?.trim() || '—',
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  return {
    ok: true,
    employee: serializeEmployee(profile),
    emailMode: 'emailMode' in invite ? String(invite.emailMode) : undefined,
  };
}

export async function runPayroll(organizationId: string, id: string) {
  const row = await prisma.hrPayrollRun.findFirst({ where: { id, organizationId } });
  if (!row) return { ok: false as const, error: 'Pay run not found', status: 404 as const };
  const updated = await prisma.hrPayrollRun.update({
    where: { id },
    data: { status: 'completed' },
  });
  return { ok: true as const, payroll: updated };
}

export async function createLeave(
  organizationId: string,
  input: { employee: string; leaveType: string; dates: string; days: number; notes?: string }
) {
  const submitted = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return prisma.hrLeaveRequest.create({
    data: {
      organizationId,
      employee: input.employee.trim(),
      leaveType: input.leaveType,
      dates: input.dates.trim(),
      days: input.days,
      submitted,
      notes: input.notes?.trim() || '—',
      status: 'Pending',
    },
  });
}

export async function updateLeaveStatus(organizationId: string, id: string, status: 'Approved' | 'Denied') {
  const row = await prisma.hrLeaveRequest.findFirst({ where: { id, organizationId } });
  if (!row) return { ok: false as const, error: 'Leave request not found', status: 404 as const };
  const updated = await prisma.hrLeaveRequest.update({ where: { id }, data: { status } });
  return { ok: true as const, leave: updated };
}

export async function createRequisition(
  organizationId: string,
  input: { title: string; department: string; priority: string; type: string; salary?: string }
) {
  const posted = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return prisma.hrJobRequisition.create({
    data: {
      organizationId,
      title: input.title.trim(),
      department: input.department,
      priority: input.priority,
      type: input.type,
      posted,
      salary: input.salary?.trim() || 'To be determined',
      applied: 0,
      screened: 0,
      interviews: 0,
      offers: 0,
      hired: 0,
    },
  });
}

export async function scheduleInterview(organizationId: string, requisitionId: string, applicantId?: string) {
  const req = await prisma.hrJobRequisition.findFirst({ where: { id: requisitionId, organizationId } });
  if (!req) return { ok: false as const, error: 'Requisition not found', status: 404 as const };
  const updated = await prisma.hrJobRequisition.update({
    where: { id: requisitionId },
    data: { interviews: { increment: 1 } },
  });
  if (applicantId) {
    await prisma.hrJobApplicant.updateMany({
      where: { id: applicantId, requisitionId },
      data: { stage: 'Interview' },
    });
  }
  return { ok: true as const, requisition: updated };
}

export async function sendLicenseReminder(organizationId: string, id: string) {
  const row = await prisma.staffCredential.findFirst({ where: { id, organizationId } });
  if (!row) return { ok: false as const, error: 'License not found', status: 404 as const };
  const updated = await prisma.staffCredential.update({
    where: { id },
    data: { reminderAt: new Date() },
  });
  return { ok: true as const, reminderAt: updated.reminderAt?.toISOString() ?? null };
}

export async function resolveCompliance(organizationId: string, id: string) {
  const row = await prisma.hrComplianceItem.findFirst({ where: { id, organizationId } });
  if (!row) return { ok: false as const, error: 'Item not found', status: 404 as const };
  const updated = await prisma.hrComplianceItem.update({
    where: { id },
    data: { status: 'Compliant' },
  });
  return { ok: true as const, item: updated };
}

export async function updateDirectDeposit(
  organizationId: string,
  input: { bankName?: string; accountLast4?: string; routingLast4?: string; percentOnDd?: number }
) {
  return prisma.hrDirectDepositSetting.upsert({
    where: { organizationId },
    update: input,
    create: { organizationId, ...input },
  });
}

export function buildStaffCsv(employees: HrCornerEmployee[]) {
  const header = 'Employee,Email,Title,Department,Type,Status,Hire Date,Manager';
  const lines = employees.map((e) =>
    [e.name, e.email, e.jobTitle, e.department, e.employmentType, e.hrStatus, e.hireLabel, e.managerName]
      .map((v) => `"${String(v).replaceAll('"', '""')}"`)
      .join(',')
  );
  return [header, ...lines].join('\n');
}
