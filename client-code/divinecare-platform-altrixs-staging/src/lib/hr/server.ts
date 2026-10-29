/**
 * HR API plumbing: role gates, HR settings, the staff roster used by every HR screen, and audit.
 * Every query here is scoped by organizationId. No client PHI is read except assigned-client
 * COUNTS (offboarding handoff) and note signing timestamps (documentation metrics).
 */
import { NextResponse } from 'next/server';
import type { HrSettings, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { practiceToday } from '@/lib/time/practiceTime';
import { isCredentialingRole, isHrAdminRole, ymd, type CeuRequirementMap, type PtoPolicy } from './standard';

export type HrCtx = {
  organizationId: string;
  userId: string;
  role: string;
  name: string;
};

export type HrGateLevel = 'staff' | 'credentialing' | 'admin';

export function hrJsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * staff: any signed-in clinic staff (self-service; rows are then scoped to the viewer);
 * credentialing: HR, leadership, Office Manager; admin: HR + leadership.
 */
export async function hrGate(level: HrGateLevel): Promise<{ ok: true; ctx: HrCtx } | { ok: false; response: NextResponse }> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false, response: hrJsonError(gate.error, gate.status) };
  const role = normalizeStaffRole(String(gate.role));
  if (level === 'admin' && !isHrAdminRole(role)) return { ok: false, response: hrJsonError('Forbidden', 403) };
  if (level === 'credentialing' && !isCredentialingRole(role)) return { ok: false, response: hrJsonError('Forbidden', 403) };
  return {
    ok: true,
    ctx: {
      organizationId: gate.organizationId,
      userId: gate.userId,
      role,
      name: gate.session.user.name?.trim() || gate.session.user.email || 'Staff',
    },
  };
}

export function isMissingTable(err: unknown) {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2022' || code === 'P2010' || /does not exist/i.test(message);
}

export function hrServerError(tag: string, err: unknown) {
  if (isMissingTable(err)) {
    return hrJsonError('HR tables are not on this database yet. Run the 20261022_hr_standard migration.', 503);
  }
  console.error(`[hr ${tag}]`, err);
  return hrJsonError('Something went wrong. Try again.', 500);
}

/** Audit an HR read / write (ids, enums and counts only; never personal values). */
export async function auditHr(
  ctx: HrCtx,
  req: Request | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE' = 'SUCCESS',
) {
  await writeAuditLog({
    action,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    organizationId: ctx.organizationId,
    resourceType,
    resourceId,
    outcome,
    ...auditRequestMeta(req),
    metadata: { area: 'hr', ...metadata },
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type HrSettingsView = {
  blockSchedulingWhenLicenseExpired: boolean;
  dueSoonDays: number;
  urgentDays: number;
  caqhAttestationDays: number;
  exclusionCheckIntervalDays: number;
  sickAccrualHoursWorked: number | null;
  sickAnnualAccrualCap: number | null;
  sickBalanceCap: number | null;
  sickAnnualUsageCap: number | null;
  ptoPolicy: PtoPolicy | null;
  ceuRequirements: CeuRequirementMap;
  immunizationPolicy: { fluRoles?: string[]; hepBRoles?: string[]; tbRoles?: string[]; tbIntervalMonths?: number | null };
  cprRequiredRoles: string[];
  i9StoreDocumentImages: boolean;
  aiDocumentExtract: boolean;
  aiWritingDrafts: boolean;
  aiReviewAssistant: boolean;
  aiPolicyQa: boolean;
  aiDigest: boolean;
  policyConfirmedAt: string | null;
  saved: boolean;
};

export const DEFAULT_HR_SETTINGS: HrSettingsView = {
  blockSchedulingWhenLicenseExpired: false,
  dueSoonDays: 60,
  urgentDays: 30,
  caqhAttestationDays: 120,
  exclusionCheckIntervalDays: 30,
  sickAccrualHoursWorked: 30,
  sickAnnualAccrualCap: null,
  sickBalanceCap: null,
  sickAnnualUsageCap: null,
  ptoPolicy: null,
  ceuRequirements: {},
  immunizationPolicy: {},
  cprRequiredRoles: [],
  i9StoreDocumentImages: false,
  aiDocumentExtract: false,
  aiWritingDrafts: false,
  aiReviewAssistant: false,
  aiPolicyQa: false,
  aiDigest: false,
  policyConfirmedAt: null,
  saved: false,
};

function settingsView(row: HrSettings | null): HrSettingsView {
  if (!row) return { ...DEFAULT_HR_SETTINGS };
  return {
    blockSchedulingWhenLicenseExpired: row.blockSchedulingWhenLicenseExpired,
    dueSoonDays: row.dueSoonDays,
    urgentDays: row.urgentDays,
    caqhAttestationDays: row.caqhAttestationDays,
    exclusionCheckIntervalDays: row.exclusionCheckIntervalDays,
    sickAccrualHoursWorked: row.sickAccrualHoursWorked,
    sickAnnualAccrualCap: row.sickAnnualAccrualCap,
    sickBalanceCap: row.sickBalanceCap,
    sickAnnualUsageCap: row.sickAnnualUsageCap,
    ptoPolicy: (row.ptoPolicy as PtoPolicy | null) ?? null,
    ceuRequirements: (row.ceuRequirements as CeuRequirementMap | null) ?? {},
    immunizationPolicy: (row.immunizationPolicy as HrSettingsView['immunizationPolicy'] | null) ?? {},
    cprRequiredRoles: row.cprRequiredRoles,
    i9StoreDocumentImages: row.i9StoreDocumentImages,
    aiDocumentExtract: row.aiDocumentExtract,
    aiWritingDrafts: row.aiWritingDrafts,
    aiReviewAssistant: row.aiReviewAssistant,
    aiPolicyQa: row.aiPolicyQa,
    aiDigest: row.aiDigest,
    policyConfirmedAt: row.policyConfirmedAt?.toISOString() ?? null,
    saved: true,
  };
}

export async function loadHrSettings(organizationId: string): Promise<HrSettingsView> {
  try {
    return settingsView(await prisma.hrSettings.findUnique({ where: { organizationId } }));
  } catch (err) {
    if (isMissingTable(err)) return { ...DEFAULT_HR_SETTINGS };
    throw err;
  }
}

export async function saveHrSettings(organizationId: string, userId: string, input: Partial<HrSettingsView> & { confirmPolicy?: boolean }) {
  const data: Prisma.HrSettingsUncheckedUpdateInput = { updatedById: userId };
  const keys: Array<keyof HrSettingsView> = [
    'blockSchedulingWhenLicenseExpired',
    'dueSoonDays',
    'urgentDays',
    'caqhAttestationDays',
    'exclusionCheckIntervalDays',
    'sickAccrualHoursWorked',
    'sickAnnualAccrualCap',
    'sickBalanceCap',
    'sickAnnualUsageCap',
    'cprRequiredRoles',
    'i9StoreDocumentImages',
    'aiDocumentExtract',
    'aiWritingDrafts',
    'aiReviewAssistant',
    'aiPolicyQa',
    'aiDigest',
  ];
  for (const k of keys) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
  if (input.ptoPolicy !== undefined) data.ptoPolicy = (input.ptoPolicy ?? undefined) as Prisma.InputJsonValue | undefined;
  if (input.ceuRequirements !== undefined) data.ceuRequirements = input.ceuRequirements as Prisma.InputJsonValue;
  if (input.immunizationPolicy !== undefined) data.immunizationPolicy = input.immunizationPolicy as Prisma.InputJsonValue;
  if (input.confirmPolicy) {
    data.policyConfirmedAt = new Date();
    data.policyConfirmedById = userId;
  }
  const row = await prisma.hrSettings.upsert({
    where: { organizationId },
    update: data,
    create: { organizationId, ...(data as Prisma.HrSettingsUncheckedCreateInput) },
  });
  return settingsView(row);
}

export async function practiceTodayFor(organizationId: string): Promise<string> {
  try {
    const p = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { timeZone: true } });
    return practiceToday(p?.timeZone || undefined);
  } catch {
    return practiceToday();
  }
}

// ─── Roster ──────────────────────────────────────────────────────────────────

export type RosterPerson = {
  userId: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  accountStatus: string;
  credentials: string | null;
  npi: string | null;
  image: string | null;
  profileId: string | null;
  jobTitle: string;
  department: string;
  employmentType: string;
  workerType: string | null;
  hrStatus: string;
  hireDate: string | null;
  terminationDate: string | null;
  managerUserId: string | null;
  clinicalSupervisorUserId: string | null;
  programs: string[];
  preferredName: string | null;
  pronouns: string | null;
  workPhone: string | null;
  locationIds: string[];
  locationNames: string[];
  primaryLocationName: string | null;
  licenseLevel: string | null;
};

/** Every staff account in the org with its HR profile (people without a profile still appear). */
export async function loadRoster(organizationId: string, opts: { includeDeactivated?: boolean } = {}): Promise<RosterPerson[]> {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      role: { not: 'SUPER_ADMIN' },
      ...(opts.includeDeactivated ? {} : { status: { not: 'DEACTIVATED' } }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roles: true,
      status: true,
      credentials: true,
      npi: true,
      image: true,
      licenseLevel: true,
      primaryLocation: { select: { id: true, name: true } },
      locations: { select: { location: { select: { id: true, name: true } } } },
      staffHrProfile: true,
    },
    orderBy: [{ name: 'asc' }],
  });
  return users.map((u) => {
    const p = u.staffHrProfile;
    const locs = new Map<string, string>();
    if (u.primaryLocation) locs.set(u.primaryLocation.id, u.primaryLocation.name);
    for (const l of u.locations) locs.set(l.location.id, l.location.name);
    return {
      userId: u.id,
      name: u.name?.trim() || u.email,
      email: u.email,
      role: String(u.role),
      roles: (u.roles || []).map(String),
      accountStatus: String(u.status),
      credentials: u.credentials?.trim() || null,
      npi: u.npi?.trim() || null,
      image: u.image,
      profileId: p?.id ?? null,
      jobTitle: p?.jobTitle || '',
      department: p?.department || '',
      employmentType: p?.employmentType || '',
      workerType: p?.workerType ?? null,
      hrStatus: p?.hrStatus || (u.status === 'DEACTIVATED' ? 'Terminated' : u.status === 'INVITED' ? 'Onboarding' : 'Active'),
      hireDate: ymd(p?.hireDate ?? null),
      terminationDate: ymd(p?.terminationDate ?? null),
      managerUserId: p?.managerUserId ?? null,
      clinicalSupervisorUserId: p?.clinicalSupervisorUserId ?? null,
      programs: p?.programs ?? [],
      preferredName: p?.preferredName ?? null,
      pronouns: p?.pronouns ?? null,
      workPhone: p?.workPhone ?? null,
      locationIds: [...locs.keys()],
      locationNames: [...locs.values()],
      primaryLocationName: u.primaryLocation?.name ?? null,
      licenseLevel: u.licenseLevel ?? null,
    };
  });
}

/** Org member check before any write about a staff member. */
export async function assertOrgUser(organizationId: string, userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, name: true, email: true, role: true, status: true },
  });
}

/** Ensure a minimal HR profile exists (people invited outside HR have none yet). */
export async function ensureProfile(organizationId: string, userId: string) {
  const existing = await prisma.staffHrProfile.findUnique({ where: { userId } });
  if (existing) {
    if (existing.organizationId !== organizationId) return null;
    return existing;
  }
  return prisma.staffHrProfile.create({
    data: { organizationId, userId, jobTitle: '', department: '', employmentType: 'Full-Time', hrStatus: 'Active', managerName: '' },
  });
}

export function displayName(roster: RosterPerson[], userId: string | null | undefined): string | null {
  if (!userId) return null;
  return roster.find((p) => p.userId === userId)?.name ?? null;
}
