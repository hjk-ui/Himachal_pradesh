/**
 * Employee record: one profile per staff member (personal, employment, compensation summary,
 * credentials and compliance, documents, training, time off, performance, onboarding), filtered
 * server-side by the viewer's relationship (src/lib/hr/standard.ts hrFieldAccess).
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  dateOnlyValue,
  hrFieldAccess,
  hrRelationship,
  redactEmployeeRecord,
  verificationLinkFor,
  ymd,
  type HrFieldAccess,
  type HrRelationship,
} from './standard';
import { ensureProfile, isMissingTable, loadRoster, type HrCtx, type RosterPerson } from './server';

export type EmergencyContact = { name: string; relationship?: string; phone: string; altPhone?: string };

export type EmployeeRecord = {
  userId: string;
  profileId: string | null;
  name: string;
  email: string;
  image: string | null;
  role: string;
  roles: string[];
  accountStatus: string;
  credentialsSuffix: string | null;
  npi: string | null;
  licenseLevel: string | null;
  // personal
  legalFirstName?: string | null;
  legalMiddleName?: string | null;
  legalLastName?: string | null;
  preferredName: string | null;
  pronouns: string | null;
  dateOfBirth?: string | null;
  personalEmail?: string | null;
  personalPhone?: string | null;
  workPhone: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  emergencyContacts?: EmergencyContact[];
  // employment
  jobTitle: string;
  department: string;
  programs: string[];
  employmentType: string;
  workerType?: string | null;
  fte?: number | null;
  employeeNumber?: string | null;
  hrStatus: string;
  hireDate?: string | null;
  terminationDate?: string | null;
  separationType?: string | null;
  rehireEligible?: boolean | null;
  managerUserId: string | null;
  managerName: string | null;
  clinicalSupervisorUserId: string | null;
  clinicalSupervisorName: string | null;
  supervisionTrack: { supervisorName: string; targetLicense: string; requiredHours: number } | null;
  locationNames: string[];
  primaryLocationName: string | null;
  // compensation (HR / leadership only)
  payType?: string | null;
  payRateCents?: number | null;
  compEffectiveOn?: string | null;
  payrollSystem?: string | null;
  payrollExternalId?: string | null;
  // credentialing ids
  caqhId?: string | null;
  medicaidProviderId?: string | null;
  deaNumber?: string | null;
};

export type EmployeeView = {
  relationship: HrRelationship;
  access: HrFieldAccess;
  record: EmployeeRecord;
};

const PERSONAL_SELF_FIELDS = [
  'preferredName',
  'pronouns',
  'personalEmail',
  'personalPhone',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'emergencyContacts',
  'legalFirstName',
  'legalMiddleName',
  'legalLastName',
] as const;
export type SelfServiceField = (typeof PERSONAL_SELF_FIELDS)[number];
export const SELF_SERVICE_FIELDS: readonly string[] = PERSONAL_SELF_FIELDS;

function nameOf(roster: RosterPerson[], id: string | null | undefined) {
  return id ? roster.find((p) => p.userId === id)?.name ?? null : null;
}

export async function loadEmployee(ctx: HrCtx, userId: string, roster?: RosterPerson[]): Promise<EmployeeView | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: ctx.organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      roles: true,
      status: true,
      credentials: true,
      npi: true,
      licenseLevel: true,
      primaryLocation: { select: { name: true } },
      locations: { select: { location: { select: { name: true } } } },
      staffHrProfile: true,
      supervisionTracksAsSupervisee: {
        where: { organizationId: ctx.organizationId },
        select: { targetLicense: true, requiredHours: true, supervisor: { select: { name: true, email: true } } },
        take: 1,
      },
    },
  });
  if (!user) return null;
  const p = user.staffHrProfile;
  const people = roster ?? (await loadRoster(ctx.organizationId, { includeDeactivated: true }));
  const relationship = hrRelationship(
    { userId: ctx.userId, role: ctx.role },
    { userId: user.id, managerUserId: p?.managerUserId, clinicalSupervisorUserId: p?.clinicalSupervisorUserId },
  );
  const access = hrFieldAccess(relationship);
  const track = user.supervisionTracksAsSupervisee[0];
  const locs = new Set<string>();
  if (user.primaryLocation) locs.add(user.primaryLocation.name);
  for (const l of user.locations) locs.add(l.location.name);
  const full: EmployeeRecord = {
    userId: user.id,
    profileId: p?.id ?? null,
    name: user.name?.trim() || user.email,
    email: user.email,
    image: user.image,
    role: String(user.role),
    roles: (user.roles || []).map(String),
    accountStatus: String(user.status),
    credentialsSuffix: user.credentials?.trim() || null,
    npi: user.npi?.trim() || p?.npi || null,
    licenseLevel: user.licenseLevel ?? null,
    legalFirstName: p?.legalFirstName ?? null,
    legalMiddleName: p?.legalMiddleName ?? null,
    legalLastName: p?.legalLastName ?? null,
    preferredName: p?.preferredName ?? null,
    pronouns: p?.pronouns ?? null,
    dateOfBirth: ymd(p?.dateOfBirth ?? null),
    personalEmail: p?.personalEmail ?? null,
    personalPhone: p?.personalPhone ?? null,
    workPhone: p?.workPhone ?? null,
    addressLine1: p?.addressLine1 ?? null,
    addressLine2: p?.addressLine2 ?? null,
    city: p?.city ?? null,
    state: p?.state ?? null,
    postalCode: p?.postalCode ?? null,
    emergencyContacts: Array.isArray(p?.emergencyContacts) ? (p!.emergencyContacts as unknown as EmergencyContact[]) : [],
    jobTitle: p?.jobTitle || '',
    department: p?.department || '',
    programs: p?.programs ?? [],
    employmentType: p?.employmentType || '',
    workerType: p?.workerType ?? null,
    fte: p?.fte ?? null,
    employeeNumber: p?.employeeNumber ?? null,
    hrStatus: p?.hrStatus || 'Active',
    hireDate: ymd(p?.hireDate ?? null),
    terminationDate: ymd(p?.terminationDate ?? null),
    separationType: p?.separationType ?? null,
    rehireEligible: p?.rehireEligible ?? null,
    managerUserId: p?.managerUserId ?? null,
    managerName: nameOf(people, p?.managerUserId) ?? (p?.managerName && p.managerName !== '—' ? p.managerName : null),
    clinicalSupervisorUserId: p?.clinicalSupervisorUserId ?? null,
    clinicalSupervisorName: nameOf(people, p?.clinicalSupervisorUserId),
    supervisionTrack: track
      ? { supervisorName: track.supervisor.name?.trim() || track.supervisor.email, targetLicense: track.targetLicense, requiredHours: track.requiredHours }
      : null,
    locationNames: [...locs],
    primaryLocationName: user.primaryLocation?.name ?? null,
    payType: p?.payType ?? null,
    payRateCents: p?.payRateCents ?? null,
    compEffectiveOn: ymd(p?.compEffectiveOn ?? null),
    payrollSystem: p?.payrollSystem ?? null,
    payrollExternalId: p?.payrollExternalId ?? null,
    caqhId: p?.caqhId ?? null,
    medicaidProviderId: p?.medicaidProviderId ?? null,
    deaNumber: p?.deaNumber ?? null,
  };
  const record = redactEmployeeRecord(full as unknown as Record<string, unknown>, access) as unknown as EmployeeRecord;
  if (!access.credentials) {
    delete record.caqhId;
    delete record.medicaidProviderId;
    delete record.deaNumber;
  }
  return { relationship, access, record };
}

export type EmployeeUpdate = Partial<{
  legalFirstName: string | null;
  legalMiddleName: string | null;
  legalLastName: string | null;
  preferredName: string | null;
  pronouns: string | null;
  dateOfBirth: string | null;
  personalEmail: string | null;
  personalPhone: string | null;
  workPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContacts: EmergencyContact[];
  jobTitle: string;
  department: string;
  programs: string[];
  employmentType: string;
  workerType: string | null;
  fte: number | null;
  employeeNumber: string | null;
  hrStatus: string;
  hireDate: string | null;
  terminationDate: string | null;
  separationType: string | null;
  rehireEligible: boolean | null;
  managerUserId: string | null;
  clinicalSupervisorUserId: string | null;
  payType: string | null;
  payRateCents: number | null;
  compEffectiveOn: string | null;
  payrollSystem: string | null;
  payrollExternalId: string | null;
  caqhId: string | null;
  medicaidProviderId: string | null;
  deaNumber: string | null;
  npi: string | null;
}>;

const DATE_FIELDS = new Set(['dateOfBirth', 'hireDate', 'terminationDate', 'compEffectiveOn']);
const COMP_FIELDS = new Set(['payType', 'payRateCents', 'compEffectiveOn', 'payrollSystem', 'payrollExternalId']);
const SEPARATION_FIELDS = new Set(['separationType', 'rehireEligible', 'terminationDate']);

/**
 * HR / leadership edit. Compensation fields are dropped unless the viewer may see them; manager /
 * supervisor must be staff in the same org. Returns the list of changed field NAMES for the audit.
 */
export async function updateEmployee(ctx: HrCtx, userId: string, input: EmployeeUpdate, access: HrFieldAccess) {
  if (!access.editRecord) return { ok: false as const, status: 403, error: 'Only HR or leadership can edit employee records' };
  const profile = await ensureProfile(ctx.organizationId, userId);
  if (!profile) return { ok: false as const, status: 404, error: 'Employee not found' };
  for (const ref of [input.managerUserId, input.clinicalSupervisorUserId]) {
    if (ref) {
      if (ref === userId) return { ok: false as const, status: 400, error: 'A person cannot be their own manager or supervisor' };
      const ok = await prisma.user.findFirst({ where: { id: ref, organizationId: ctx.organizationId }, select: { id: true } });
      if (!ok) return { ok: false as const, status: 400, error: 'Manager / supervisor must be staff in this practice' };
    }
  }
  const data: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (COMP_FIELDS.has(k) && !access.compensation) continue;
    if (SEPARATION_FIELDS.has(k) && !access.separation) continue;
    if (k === 'npi') continue;
    data[k] = DATE_FIELDS.has(k) ? dateOnlyValue(v as string | null) : k === 'emergencyContacts' ? (v as Prisma.InputJsonValue) : v;
    changed.push(k);
  }
  if (input.managerUserId !== undefined) {
    data.managerName = '';
  }
  await prisma.staffHrProfile.update({ where: { id: profile.id }, data: data as Prisma.StaffHrProfileUpdateInput });
  if (input.npi !== undefined) {
    await prisma.user.update({ where: { id: userId }, data: { npi: input.npi?.trim() || null } });
    changed.push('npi');
  }
  return { ok: true as const, changed };
}

// ─── Self-service change requests ────────────────────────────────────────────

export async function createChangeRequest(ctx: HrCtx, changes: Record<string, unknown>) {
  const allowed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) if (SELF_SERVICE_FIELDS.includes(k)) allowed[k] = v;
  if (!Object.keys(allowed).length) return { ok: false as const, status: 400, error: 'Nothing to change' };
  const pending = await prisma.hrProfileChangeRequest.count({ where: { organizationId: ctx.organizationId, userId: ctx.userId, status: 'pending' } });
  if (pending >= 5) return { ok: false as const, status: 429, error: 'You already have changes waiting for HR' };
  const row = await prisma.hrProfileChangeRequest.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, changes: allowed as Prisma.InputJsonValue },
  });
  return { ok: true as const, id: row.id, fields: Object.keys(allowed) };
}

export async function decideChangeRequest(ctx: HrCtx, id: string, decision: 'approved' | 'rejected', note?: string | null) {
  const row = await prisma.hrProfileChangeRequest.findFirst({ where: { id, organizationId: ctx.organizationId, status: 'pending' } });
  if (!row) return { ok: false as const, status: 404, error: 'Request not found' };
  if (row.userId === ctx.userId) return { ok: false as const, status: 403, error: 'Another HR team member must approve your own changes' };
  if (decision === 'approved') {
    const profile = await ensureProfile(ctx.organizationId, row.userId);
    if (!profile) return { ok: false as const, status: 404, error: 'Employee not found' };
    const changes = row.changes as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (!SELF_SERVICE_FIELDS.includes(k)) continue;
      data[k] = k === 'emergencyContacts' ? (v as Prisma.InputJsonValue) : v ?? null;
    }
    await prisma.staffHrProfile.update({ where: { id: profile.id }, data: data as Prisma.StaffHrProfileUpdateInput });
  }
  await prisma.hrProfileChangeRequest.update({
    where: { id },
    data: { status: decision, reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note?.trim() || null },
  });
  return { ok: true as const, userId: row.userId, fields: Object.keys(row.changes as Record<string, unknown>) };
}

export async function listChangeRequests(organizationId: string, opts: { userId?: string; status?: string } = {}) {
  try {
    const rows = await prisma.hrProfileChangeRequest.findMany({
      where: { organizationId, ...(opts.userId ? { userId: opts.userId } : {}), ...(opts.status ? { status: opts.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      changes: r.changes as Record<string, unknown>,
      status: r.status,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

// ─── New hire ────────────────────────────────────────────────────────────────

/**
 * New hire: staff invite (account INVITED, no password; they set it from the email) + HR profile.
 * An existing account in this org without a profile gets a profile only.
 */
export async function createEmployee(
  ctx: HrCtx,
  input: {
    name: string;
    email: string;
    role: string;
    jobTitle: string;
    department: string;
    employmentType: string;
    workerType?: string | null;
    hireDate?: string | null;
    managerUserId?: string | null;
    programs?: string[];
    sendInvite: boolean;
  },
) {
  let userId: string;
  const existing = await prisma.user.findFirst({ where: { email: input.email.trim().toLowerCase(), organizationId: ctx.organizationId }, select: { id: true } });
  let invited = false;
  if (existing) {
    userId = existing.id;
  } else {
    if (!input.sendInvite) return { ok: false as const, status: 400, error: 'No account with that email. Turn on "Send Altrixs invite" to create one.' };
    const { createStaffInvite } = await import('@/lib/staff/invite');
    const invite = await createStaffInvite({
      name: input.name,
      email: input.email,
      role: input.role as Role,
      roles: [input.role as Role],
      invitedById: ctx.userId,
      organizationId: ctx.organizationId,
    });
    if (!invite.ok) return { ok: false as const, status: invite.status, error: invite.error };
    userId = invite.user.id;
    invited = true;
  }
  const profile = await ensureProfile(ctx.organizationId, userId);
  if (!profile) return { ok: false as const, status: 409, error: 'This account belongs to another organization' };
  if (input.managerUserId) {
    const ok = await prisma.user.findFirst({ where: { id: input.managerUserId, organizationId: ctx.organizationId }, select: { id: true } });
    if (!ok) return { ok: false as const, status: 400, error: 'Manager must be staff in this practice' };
  }
  await prisma.staffHrProfile.update({
    where: { id: profile.id },
    data: {
      jobTitle: input.jobTitle.trim(),
      department: input.department.trim(),
      employmentType: input.employmentType,
      workerType: input.workerType ?? 'W2',
      hrStatus: 'Onboarding',
      hireDate: dateOnlyValue(input.hireDate ?? null),
      managerUserId: input.managerUserId ?? null,
      programs: input.programs ?? [],
    },
  });
  return { ok: true as const, userId, invited };
}

// ─── Credentials bundle for the profile tab ──────────────────────────────────

export async function loadCredentialBundle(organizationId: string, userId: string) {
  const [credentials, compliance, exclusions, enrollments] = await Promise.all([
    prisma.staffCredential.findMany({ where: { organizationId, userId }, orderBy: { expiresAt: 'desc' } }),
    prisma.staffComplianceRecord.findMany({ where: { organizationId, userId }, orderBy: [{ completedOn: 'desc' }, { createdAt: 'desc' }] }).catch((e) => {
      if (isMissingTable(e)) return [];
      throw e;
    }),
    prisma.hrExclusionCheck.findMany({ where: { organizationId, userId }, orderBy: { checkedOn: 'desc' }, take: 60 }).catch((e) => {
      if (isMissingTable(e)) return [];
      throw e;
    }),
    prisma.providerPayerEnrollment.findMany({ where: { providerUserId: userId }, orderBy: { payerName: 'asc' } }),
  ]);
  return {
    credentials: credentials.map((c) => ({
      id: c.id,
      credentialType: c.credentialType,
      title: c.title,
      licenseNumber: c.licenseNumber,
      licenseType: c.licenseType,
      issuer: c.issuer,
      state: c.credentialState,
      issuedAt: ymd(c.issuedAt),
      expiresAt: ymd(c.expiresAt)!,
      ceuRequired: c.ceuRequired,
      ceuCompleted: c.ceuCompleted,
      documentUrl: c.documentUrl,
      documentName: c.documentName,
      verifiedAt: c.verifiedAt?.toISOString() ?? null,
      verificationMethod: c.verificationMethod,
      verifiedByName: c.verifiedByName,
      verificationRef: c.verificationRef,
      details: (c.details as Record<string, unknown> | null) ?? null,
      lookup: verificationLinkFor(c.credentialType, c.licenseType),
    })),
    compliance: compliance.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      completedOn: ymd(r.completedOn),
      expiresOn: ymd(r.expiresOn),
      status: r.status,
      result: r.result,
      identifier: r.identifier,
      verifiedByName: r.verifiedByName,
      notes: r.notes,
    })),
    exclusions: exclusions.map((e) => ({
      id: e.id,
      source: e.source,
      checkedOn: ymd(e.checkedOn)!,
      result: e.result,
      reference: e.reference,
      checkedByName: e.checkedByName,
    })),
    payerEnrollments: enrollments.map((e) => ({
      id: e.id,
      payerName: e.payerName,
      status: e.status,
      effectiveDate: ymd(e.effectiveDate),
    })),
  };
}
