import type { ClientStatus, Prisma, RiskLevel, Role } from '@prisma/client';
import { invalidateCaseloadScopedCaches } from '@/lib/perf/cache';
import { prisma } from '@/lib/db/prisma';
import { getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import {
  canAccessClientRoster,
  canSeeClientCheckIns,
  canSeeClientDiagnoses,
  canSeeClientInsurance,
  careTeamClientWhereForRole,
  clientAccessWhere,
} from '@/lib/clients/orgScope';
import {
  DEFAULT_SORT_DIR,
  SEEN_APPOINTMENT_STATUSES,
  clientFilterWheres,
  clientSearchWhere,
  hasPhiRevealingFilter,
  matchesLetter,
  sortClients,
  upcomingAppointmentWhere,
  type ClientProgramValue,
  type ClientSortKey,
  type ClinicianRoleFilter,
  type SortDir,
  type SortableClient,
} from '@/lib/clients/listQuery';
import { allocateNextMrn, ensureClientMrn } from '@/lib/clients/mrn';
import { invitePatientForClient, type AppInviteResult } from '@/patient';
import { maskClientPii } from '@/lib/privacy/pii';
import { buildCareTeams, type CareTeamSeenRow, type ClientCareTeam } from '@/lib/clients/careTeam';
import { loadCareTeamStaff, loadSeenByRows } from '@/lib/clients/careTeamDb';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { isCaseloadRole } from '@/types/roles';
import { normalizeMiddleInitial } from '@/lib/clients/legalName';
import {
  demographicUpdateData,
  legacyGenderFromSex,
  normalizeStateCode,
  normalizeUsZip,
  type StructuredDemographics,
} from '@/lib/clients/demographics';
import { medicalProgramClientWhere } from '@/lib/medical/medicalProgram';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { formatApptWhenStaff } from '@/lib/clients/appointmentDisplay';

const RISK_UI: Record<RiskLevel, 'high' | 'medium' | 'low'> = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

function formatRelative(date: Date | null | undefined): string {
  if (!date) return 'Never';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatOnboardDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export type ClientListItem = {
  id: string;
  mrn: string | null;
  name: string;
  email: string;
  phone: string;
  image: string | null;
  assignedSince: string;
  lastCheckIn: string;
  avgMood: number;
  avgStress: number;
  streak: number;
  risk: 'high' | 'medium' | 'low';
  totalSessions: number;
  nextAppointment?: string;
  /** ISO start of the next upcoming visit (null when none or protected) */
  nextAppointmentAt: string | null;
  /** ISO start of the latest attended visit (completed / checked in / in session); null when none */
  lastSeenAt: string | null;
  /** ISO date the chart was created (Date added) */
  createdAt: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  preferredName: string | null;
  nameSuffix: string | null;
  status: ClientStatus;
  primaryDiagnosis: string | null;
  primaryDiagnosisCode: string | null;
  insurancePayer: string | null;
  insuranceMemberId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  locationName: string | null;
  primaryLocationId?: string | null;
  assignedToName: string | null;
  assignedToId: string | null;
  treatmentTeam: Prisma.JsonValue | null;
  /** Primary + other care team members (src/lib/clients/careTeam.ts); null for locked rows */
  careTeam: ClientCareTeam | null;
  hieLastQueryAt: string | null;
  /** Patient mobile app: no email / invite pending / password set */
  appAccess: 'none' | 'invite_sent' | 'active';
  /** Protected / sensitive record metadata (always present when flagged) */
  isSensitive?: boolean;
  sensitiveReason?: string | null;
  /** False → roster shows lock card; PHI fields may be masked */
  canAccessSensitive?: boolean;
};

export type CreateClientInput = StructuredDemographics & {
  name: string;
  phoneSecondary?: string | null;
  legalFirstName?: string | null;
  middleInitial?: string | null;
  legalLastName?: string | null;
  preferredName?: string | null;
  nameSuffix?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  insurancePayer?: string | null;
  insuranceMemberId?: string | null;
  insuranceGroupNumber?: string | null;
  primaryDiagnosis?: string | null;
  primaryDiagnosisCode?: string | null;
  secondaryDiagnoses?: string | null;
  locationId?: string | null;
  assignedToId?: string | null;
  status?: ClientStatus;
};

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

type ClientListActor = {
  id: string;
  role: Role;
  organizationId: string;
};

export type ClientListOptions = {
  search?: string;
  take?: number;
  skip?: number;
  status?: ClientStatus;
  locationId?: string;
  /** medical = Family Practice (src/lib/medical/medicalProgram.ts); prp; iop / php (mental-health intensive programs) */
  program?: ClientProgramValue;
  /** Staff list sort (src/lib/clients/listQuery.ts). Absent = legacy most-recently-updated order (pickers). */
  sort?: ClientSortKey;
  dir?: SortDir;
  /** Last-name initial A–Z or '#' */
  letter?: string;
  clinicianId?: string;
  clinicianRole?: ClinicianRoleFilter;
  /** Only the actor's own care-team clients (narrows; never widens clientAccessWhere) */
  mine?: boolean;
  payer?: string;
  risk?: RiskLevel;
  noUpcoming?: boolean;
  needsDemographics?: boolean;
  unassigned?: boolean;
};

/** Client ids in a mental-health intensive program now (admitted). SUD IOP / Part 2 enrollments are never used. */
async function intensiveProgramClientIds(organizationId: string, program: 'iop' | 'php'): Promise<string[]> {
  try {
    const programs = await prisma.intensiveProgram.findMany({
      where: { organizationId, programType: program === 'iop' ? 'MH_IOP' : 'PHP', part2: false },
      select: { id: true },
    });
    if (!programs.length) return [];
    const rows = await prisma.intensiveEnrollment.findMany({
      where: { organizationId, programId: { in: programs.map((p) => p.id) }, status: 'admitted', part2: false },
      select: { clientId: true },
    });
    return [...new Set(rows.map((r) => r.clientId))];
  } catch (err) {
    console.error('[clients list] intensive program lookup failed', err);
    return [];
  }
}

async function clientListWhere(actor: ClientListActor, options?: ClientListOptions): Promise<Prisma.ClientWhereInput> {
  // Doctors / caseload roles only see patients assigned to them.
  const where: Prisma.ClientWhereInput = clientAccessWhere({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorRole: actor.role,
  });
  const and: Prisma.ClientWhereInput[] = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];

  if (options?.search?.trim()) {
    // Diagnosis-code search only for roles that may see diagnoses (canSeeClientDiagnoses(actor.role); not Peer Support)
    const search = clientSearchWhere(options.search, { diagnosisCode: canSeeClientDiagnoses(actor.role) });
    if (search) and.push(search);
  }
  and.push(
    ...clientFilterWheres(
      {
        status: options?.status,
        locationId: options?.locationId,
        clinicianId: options?.clinicianId,
        clinicianRole: options?.clinicianRole ?? 'any',
        payer: options?.payer,
        risk: options?.risk,
        program: options?.program,
        noUpcoming: options?.noUpcoming ?? false,
        needsDemographics: options?.needsDemographics ?? false,
        unassigned: options?.unassigned ?? false,
      },
      { insurance: canSeeClientInsurance(actor.role) }
    )
  );
  if (options?.mine) and.push(careTeamClientWhereForRole(actor.id, actor.role));
  if (options?.program === 'medical') and.push(medicalProgramClientWhere());
  if (options?.program === 'iop' || options?.program === 'php') {
    and.push({ id: { in: await intensiveProgramClientIds(actor.organizationId, options.program) } });
  }
  if (and.length) where.AND = and;
  return where;
}

/** Sorted / letter-filtered requests: the whole matching set is ordered on the server, then paged. */
function needsKeyPass(options?: ClientListOptions): boolean {
  return Boolean(options?.sort || options?.letter);
}

type SensitiveInfo = { isSensitive: true; sensitiveReason: string; alias: string | null; canAccessSensitive: boolean };

/**
 * Ordered ids for one page of a sorted list, plus the total. Loads only the sort columns of the
 * matching (already scoped) set. Protected records sort and bucket by their alias, sort last on
 * clinical dates, and are left out when a filter would disclose something about them.
 */
async function sortedClientIds(
  actor: ClientListActor,
  where: Prisma.ClientWhereInput,
  options: ClientListOptions,
  take: number
): Promise<{ ids: string[]; total: number }> {
  const sort = options.sort ?? 'last';
  const dir = options.dir ?? DEFAULT_SORT_DIR[sort];
  const keys = await prisma.client.findMany({
    where,
    select: { id: true, name: true, legalFirstName: true, legalLastName: true, mrn: true, dateOfBirth: true, createdAt: true, status: true },
  });
  let sensitive = new Map<string, SensitiveInfo>();
  try {
    sensitive = await resolveSensitiveAccessMap({
      organizationId: actor.organizationId,
      userId: actor.id,
      role: actor.role,
      clientIds: keys.map((k) => k.id),
    });
  } catch (err) {
    // Fail closed: without the map every record is treated as protected for sort / letter purposes
    console.error('[clients list] sensitive access map failed (sort)', err);
    sensitive = new Map(keys.map((k) => [k.id, { isSensitive: true as const, sensitiveReason: 'other', alias: null, canAccessSensitive: false }]));
  }
  const now = new Date();
  const [nextRows, seenRows] = await Promise.all([
    sort === 'nextAppt'
      ? prisma.appointment.groupBy({ by: ['clientId'], where: { client: where, ...upcomingAppointmentWhere(now) }, _min: { startsAt: true } })
      : Promise.resolve([] as Array<{ clientId: string; _min: { startsAt: Date | null } }>),
    sort === 'lastSeen'
      ? prisma.appointment.groupBy({
          by: ['clientId'],
          where: { client: where, startsAt: { lt: now }, status: { in: [...SEEN_APPOINTMENT_STATUSES] } },
          _max: { startsAt: true },
        })
      : Promise.resolve([] as Array<{ clientId: string; _max: { startsAt: Date | null } }>),
  ]);
  const next = new Map(nextRows.map((r) => [r.clientId, r._min.startsAt]));
  const seen = new Map(seenRows.map((r) => [r.clientId, r._max.startsAt]));
  const hideLocked = hasPhiRevealingFilter(options);
  const rows: SortableClient[] = [];
  for (const k of keys) {
    const s = sensitive.get(k.id);
    const locked = Boolean(s && !s.canAccessSensitive);
    if (locked && hideLocked) continue;
    const row: SortableClient = locked
      ? { id: k.id, name: s?.alias || 'Protected Client', status: k.status }
      : { ...k, nextAppointmentAt: next.get(k.id) ?? null, lastSeenAt: seen.get(k.id) ?? null };
    if (!matchesLetter(row, options.letter)) continue;
    rows.push(row);
  }
  const ordered = sortClients(rows, sort, dir);
  const skip = options.skip || 0;
  return { ids: ordered.slice(skip, skip + take).map((r) => r.id), total: ordered.length };
}

/** Total for the same filters as listClientsForUser, for paging */
export async function countClientsForUser(actor: ClientListActor, options?: ClientListOptions): Promise<number> {
  if (!canAccessClientRoster(actor.role)) return 0;
  const where = await clientListWhere(actor, options);
  if (needsKeyPass(options)) return (await sortedClientIds(actor, where, options!, 0)).total;
  return prisma.client.count({ where });
}

/** One page plus the total for the same filters (one pass for sorted lists). */
export async function listClientPageForUser(
  actor: ClientListActor,
  options: ClientListOptions
): Promise<{ clients: ClientListItem[]; total: number }> {
  if (!canAccessClientRoster(actor.role)) return { clients: [], total: 0 };
  if (needsKeyPass(options)) {
    const where = await clientListWhere(actor, options);
    const take = options.take ? Math.min(options.take, 500) : 250;
    const { ids, total } = await sortedClientIds(actor, where, options, take);
    return { clients: await listClientsForUser(actor, options, { ids }), total };
  }
  const [clients, total] = await Promise.all([listClientsForUser(actor, options), countClientsForUser(actor, options)]);
  return { clients, total };
}

/** Distinct payers on the actor's scoped roster (filter choices). Empty for roles that may not see insurance. */
export async function listClientPayersForUser(actor: ClientListActor): Promise<string[]> {
  if (!canAccessClientRoster(actor.role) || !canSeeClientInsurance(actor.role)) return [];
  const where = clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.id, actorRole: actor.role });
  const rows = await prisma.client.groupBy({
    by: ['insurancePayer'],
    where: { AND: [where, { insurancePayer: { not: null } }] },
    _count: { _all: true },
  });
  const seen = new Map<string, string>();
  for (const r of rows) {
    const v = (r.insurancePayer ?? '').trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).slice(0, 200);
}

/**
 * Batched reads for a page (no N+1): team members + "Seen by" groups (completed appointments /
 * medical visits, one grouped query per source) for the unlocked clients, then one staff lookup.
 */
async function loadCareTeams(
  organizationId: string,
  rows: Array<{ id: string; assignedToId: string | null; assignedTo: { id: string; name: string | null; role: string; roles: string[] } | null; treatmentTeam: Prisma.JsonValue | null }>,
  lockedIds: Set<string>
): Promise<Map<string, ClientCareTeam>> {
  if (!rows.length) return new Map();
  try {
    const now = new Date();
    const [members, seen] = await Promise.all([
      prisma.clientTreatmentTeamMember.findMany({
        where: { clientId: { in: rows.map((r) => r.id) } },
        select: { clientId: true, providerId: true, name: true, role: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
      loadSeenByRows(rows.map((r) => r.id), now).catch((err: unknown) => {
        console.error('[clients list] seen-by load failed', err instanceof Error ? err.name : 'error');
        return [] as CareTeamSeenRow[];
      }),
    ]);
    const staff = await loadCareTeamStaff(organizationId, [...members.map((m) => m.providerId), ...seen.map((s) => s.providerId)]);
    return buildCareTeams(
      rows.map((r) => ({ id: r.id, assignedToId: r.assignedToId, assignedTo: r.assignedTo, treatmentTeam: r.treatmentTeam })),
      members,
      { lockedIds, staff, seen, now }
    );
  } catch (err) {
    console.error('[clients list] care team load failed', err);
    return buildCareTeams(
      rows.map((r) => ({ id: r.id, assignedToId: r.assignedToId, assignedTo: r.assignedTo, treatmentTeam: r.treatmentTeam })),
      [],
      { lockedIds }
    );
  }
}

export async function listClientsForUser(
  actor: ClientListActor,
  options?: ClientListOptions,
  /** Exact ids in display order (a sorted page from sortedClientIds) */
  pinned?: { ids: string[] }
): Promise<ClientListItem[]> {
  if (!canAccessClientRoster(actor.role)) {
    return [];
  }

  const take = options?.take ? Math.min(options.take, 500) : 250;
  let ids = pinned?.ids;
  if (!ids && needsKeyPass(options)) {
    ids = (await sortedClientIds(actor, await clientListWhere(actor, options), options!, take)).ids;
  }
  if (ids && ids.length === 0) return [];
  // A pinned page is still re-scoped (clientAccessWhere) — the id list never widens access
  const where: Prisma.ClientWhereInput = ids
    ? {
        AND: [
          clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.id, actorRole: actor.role }),
          { id: { in: ids } },
        ],
      }
    : await clientListWhere(actor, options);
  const paging: { orderBy?: Prisma.ClientOrderByWithRelationInput[]; take: number; skip?: number } = ids
    ? { take: ids.length }
    : { orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take, skip: options?.skip || 0 };

  const baseInclude = {
    location: { select: { name: true } },
    assignedTo: { select: { id: true, name: true, role: true, roles: true } },
    checkIns: {
      orderBy: { createdAt: 'desc' as const },
      take: 10,
      select: { mood: true, stress: true, createdAt: true },
    },
    appointments: {
      where: upcomingAppointmentWhere(new Date()),
      orderBy: { startsAt: 'asc' as const },
      take: 1,
      select: { startsAt: true, type: true },
    },
    _count: { select: { appointments: true } },
  };

  type Row = Prisma.ClientGetPayload<{ include: typeof baseInclude }> & {
    patientAccount?: { status: string } | null;
  };

  let rows: Row[];
  try {
    rows = await prisma.client.findMany({
      where,
      ...paging,
      include: {
        ...baseInclude,
        patientAccount: { select: { status: true } },
      },
    });
  } catch (err) {
    console.error('[clients list] patientAccount include failed; listing without portal status', err);
    rows = await prisma.client.findMany({
      where,
      ...paging,
      include: baseInclude,
    });
  }

  if (ids) {
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  // Last seen = latest attended visit (completed / checked in / in session) before now; never a guess
  const lastSeenRows = rows.length
    ? await prisma.appointment.groupBy({
        by: ['clientId'],
        where: { clientId: { in: rows.map((r) => r.id) }, startsAt: { lt: new Date() }, status: { in: [...SEEN_APPOINTMENT_STATUSES] } },
        _max: { startsAt: true },
      })
    : [];
  const lastSeenBy = new Map(lastSeenRows.map((r) => [r.clientId, r._max.startsAt]));

  // Lazy backfill organizationId + MRN for legacy rows (idempotent)
  await Promise.all(
    rows
      .filter((c) => !c.mrn || !c.organizationId)
      .map(async (c) => {
        try {
          const ensured = await ensureClientMrn(c.id);
          c.mrn = ensured.mrn;
          c.organizationId = ensured.organizationId;
        } catch (err) {
          console.error('[clients list] MRN ensure failed', c.id, err);
        }
      })
  );

  let sensitiveMap = new Map<
    string,
    {
      isSensitive: true;
      sensitiveReason: string;
      alias: string | null;
      canAccessSensitive: boolean;
    }
  >();
  try {
    sensitiveMap = await resolveSensitiveAccessMap({
      organizationId: actor.organizationId,
      userId: actor.id,
      role: actor.role,
      clientIds: rows.map((r) => r.id),
    });
  } catch (err) {
    console.error('[clients list] sensitive access map failed', err);
  }

  // Care team for the page in one batched query (no N+1); locked rows get none
  const lockedIds = new Set(rows.filter((r) => sensitiveMap.get(r.id)?.canAccessSensitive === false).map((r) => r.id));
  const careTeams = await loadCareTeams(
    actor.organizationId,
    rows.filter((r) => !lockedIds.has(r.id)),
    lockedIds
  );

  // Next appointment is shown on the practice clock (server runs in UTC).
  const timeZone = await getPracticeTimeZone(actor.organizationId);

  // Minimum necessary per role (orgScope): insurance (not Peer Support), BH diagnoses (care team +
  // Billing; not Front Desk / Office Manager / primary care), check-in scores (BH care team only).
  const insuranceVisible = canSeeClientInsurance(actor.role);
  const diagnosesVisible = canSeeClientDiagnoses(actor.role);
  const checkInsVisible = canSeeClientCheckIns(actor.role);
  return rows.map((c) => {
    const moods = c.checkIns.map((x) => x.mood);
    const stresses = c.checkIns.map((x) => x.stress);
    const avgMood = moods.length
      ? Math.round(moods.reduce((a, b) => a + b, 0) / moods.length)
      : 5;
    const avgStress = stresses.length
      ? Math.round(stresses.reduce((a, b) => a + b, 0) / stresses.length)
      : 5;
    const next = c.appointments[0];
    const sensitive = sensitiveMap.get(c.id);
    const locked = Boolean(sensitive && !sensitive.canAccessSensitive);

    const base = {
      id: c.id,
      mrn: locked ? null : c.mrn ?? null,
      name: locked ? sensitive?.alias || 'Protected Client' : c.name,
      email: locked ? '' : c.email || '',
      phone: locked ? '' : c.phone || '',
      image: locked ? null : c.image,
      assignedSince: locked ? '—' : formatOnboardDate(c.createdAt),
      lastCheckIn: locked || !checkInsVisible ? '—' : formatRelative(c.checkIns[0]?.createdAt),
      avgMood: locked || !checkInsVisible ? 0 : avgMood,
      avgStress: locked || !checkInsVisible ? 0 : avgStress,
      streak: locked || !checkInsVisible ? 0 : c.checkInStreak,
      risk: locked ? ('low' as const) : RISK_UI[c.riskLevel],
      totalSessions: locked ? 0 : c._count.appointments,
      nextAppointment: locked
        ? undefined
        : next
          ? `${next.type} · ${formatApptWhenStaff({ startsAt: next.startsAt, timeZone }, { dateOpts: { month: 'short', day: 'numeric' } })}`
          : undefined,
      nextAppointmentAt: locked || !next ? null : next.startsAt.toISOString(),
      lastSeenAt: locked ? null : lastSeenBy.get(c.id)?.toISOString() ?? null,
      createdAt: locked ? null : c.createdAt.toISOString(),
      legalFirstName: locked ? null : c.legalFirstName ?? null,
      legalLastName: locked ? null : c.legalLastName ?? null,
      preferredName: locked ? null : c.preferredName ?? null,
      nameSuffix: locked ? null : c.nameSuffix ?? null,
      status: c.status,
      primaryDiagnosis: locked || !diagnosesVisible ? null : c.primaryDiagnosis,
      primaryDiagnosisCode: locked || !diagnosesVisible ? null : c.primaryDiagnosisCode,
      insurancePayer: locked || !insuranceVisible ? null : c.insurancePayer,
      insuranceMemberId: locked || !insuranceVisible ? null : c.insuranceMemberId,
      dateOfBirth: locked ? null : c.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: locked ? null : c.gender,
      locationName: locked ? null : c.location?.name ?? null,
      primaryLocationId: locked ? null : (c as any).primaryLocationId || (c as any).primary_location_id || c.locationId || 'bowie',
      assignedToName: locked ? null : c.assignedTo?.name ?? null,
      assignedToId: locked ? null : c.assignedToId,
      treatmentTeam: locked ? null : c.treatmentTeam ?? null,
      careTeam: locked ? null : careTeams.get(c.id) ?? null,
      hieLastQueryAt: locked ? null : c.hieLastQueryAt?.toISOString() ?? null,
      appAccess: locked
        ? ('none' as const)
        : c.patientAccount?.status === 'ACTIVE'
          ? ('active' as const)
          : c.patientAccount?.status === 'INVITED'
            ? ('invite_sent' as const)
            : ('none' as const),
      isSensitive: Boolean(sensitive),
      sensitiveReason: sensitive?.sensitiveReason ?? null,
      canAccessSensitive: sensitive ? sensitive.canAccessSensitive : true,
    };

    // Locked sensitive rows already blank contact fields; still mask for non-privileged roles.
    return maskClientPii(base, actor.role);
  });
}

export async function createClient(
  input: CreateClientInput,
  actorUserId: string,
  organizationId: string,
  actorRole?: Role | null
) {
  const name = input.name.trim();
  if (name.length < 2) {
    return { ok: false as const, error: 'Client name is required', status: 400 };
  }

  const email = emptyToNull(input.email)?.toLowerCase() ?? null;
  if (email) {
    const exists = await prisma.client.findUnique({ where: { email } });
    if (exists) {
      return {
        ok: false as const,
        error: 'A client with this email already exists',
        status: 409,
      };
    }
  }

  let locationId = input.locationId || null;
  if (locationId) {
    const loc = await prisma.location.findFirst({
      where: { id: locationId, organizationId, active: true },
    });
    if (!loc) {
      return { ok: false as const, error: 'Location not found in your organization', status: 400 };
    }
  } else {
    locationId = await getPrimaryLocationId(organizationId);
  }

  if (input.assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assignedToId, organizationId, status: { in: ['ACTIVE', 'INVITED'] } },
    });
    if (!assignee) {
      return { ok: false as const, error: 'Assignee not found in your organization', status: 400 };
    }
  }

  const status = input.status || 'ACTIVE';
  const dob = emptyToNull(input.dateOfBirth);
  let dateOfBirth: Date | null = null;
  if (dob) {
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false as const, error: 'Invalid date of birth', status: 400 };
    }
    dateOfBirth = parsed;
  }

  let client;
  try {
    client = await prisma.$transaction(async (tx) => {
      const mrn = await allocateNextMrn(organizationId, tx);
      return tx.client.create({
        data: {
          name,
          legalFirstName: emptyToNull(input.legalFirstName),
          middleInitial: normalizeMiddleInitial(input.middleInitial),
          legalLastName: emptyToNull(input.legalLastName),
          preferredName: emptyToNull(input.preferredName),
          nameSuffix: emptyToNull(input.nameSuffix),
          email,
          phone: emptyToNull(input.phone),
          status,
          active: status === 'ACTIVE',
          organizationId,
          mrn,
          dateOfBirth,
          gender: emptyToNull(input.gender),
          addressLine1: emptyToNull(input.addressLine1),
          addressLine2: emptyToNull(input.addressLine2),
          city: emptyToNull(input.city),
          // Standard forms ("MD", "21201-1234") when the value parses; otherwise kept as entered so the
          // demographics checks show it to staff (never dropped, never guessed)
          state: normalizeStateCode(input.state) ?? emptyToNull(input.state),
          postalCode: normalizeUsZip(input.postalCode) ?? emptyToNull(input.postalCode),
          phoneSecondary: emptyToNull(input.phoneSecondary),
          ...demographicUpdateData(input),
          // Legacy display value follows the structured sex when only the structured value was given
          ...(input.administrativeSex && !emptyToNull(input.gender) ? { gender: legacyGenderFromSex(input.administrativeSex) } : {}),
          emergencyContactName: emptyToNull(input.emergencyContactName),
          emergencyContactPhone: emptyToNull(input.emergencyContactPhone),
          insurancePayer: emptyToNull(input.insurancePayer),
          insuranceMemberId: emptyToNull(input.insuranceMemberId),
          insuranceGroupNumber: emptyToNull(input.insuranceGroupNumber),
          primaryDiagnosis: emptyToNull(input.primaryDiagnosis),
          primaryDiagnosisCode: emptyToNull(input.primaryDiagnosisCode),
          secondaryDiagnoses: emptyToNull(input.secondaryDiagnoses),
          locationId,
          // Caseload clinicians creating a client default to self; FD/OM/Admin leave unassigned unless chosen.
          assignedToId: input.assignedToId
            ? input.assignedToId
            : actorRole && isCaseloadRole(actorRole)
              ? actorUserId
              : null,
          assignedSince: new Date(),
        },
      });
    });
  } catch (err) {
    console.error('[createClient]', err);
    return {
      ok: false as const,
      error: 'Could not create client with a unique MRN. Please try again.',
      status: 500,
    };
  }

  let appInvite: AppInviteResult = { invited: false };
  if (email) {
    try {
      appInvite = await invitePatientForClient(client.id);
    } catch (err) {
      console.error('[createClient app invite]', err);
      appInvite = { invited: false, error: 'Could not start app invite' };
    }
  }

  // A new client assigned at intake shows on the assignee's caseload views right away
  invalidateCaseloadScopedCaches(organizationId);
  return { ok: true as const, client, appInvite };
}
