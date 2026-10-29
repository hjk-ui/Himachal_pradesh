import type { ClientStatus, Prisma, RiskLevel, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import { canAccessClientRoster, clientAccessWhere } from '@/lib/clients/orgScope';
import { allocateNextMrn, ensureClientMrn } from '@/lib/clients/mrn';
import { invitePatientForClient, type AppInviteResult } from '@/patient';
import { maskClientPii } from '@/lib/privacy/pii';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { isCaseloadRole } from '@/types/roles';
import { limitPrimaryCareToOwnLocations } from '@/lib/clients/locationScope';
import type { SeenByProvider } from '@/lib/clients/careTeamSummary';
import { loadSeenBy } from '@/lib/clients/seenBy';

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
  /** Staff role of the assigned user (a non-clinical assignee is not shown as the clinician). */
  assignedToRole: string | null;
  /** Providers with a COMPLETED visit in the last 18 months (staff names only — no PHI). */
  seenBy: SeenByProvider[];
  treatmentTeam: Prisma.JsonValue | null;
  hieLastQueryAt: string | null;
  /** Patient mobile app: no email / invite pending / password set */
  appAccess: 'none' | 'invite_sent' | 'active';
  /** Protected / sensitive record metadata (always present when flagged) */
  isSensitive?: boolean;
  sensitiveReason?: string | null;
  /** False → roster shows lock card; PHI fields may be masked */
  canAccessSensitive?: boolean;
};

export type CreateClientInput = {
  name: string;
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
  legalFirstName?: string | null;
  middleInitial?: string | null;
  legalLastName?: string | null;
  locationId?: string | null;
  assignedToId?: string | null;
  status?: ClientStatus;
};

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function listClientsForUser(
  actor: {
    id: string;
    role: Role;
    organizationId: string;
  },
  options?: { search?: string; take?: number; skip?: number }
): Promise<ClientListItem[]> {
  if (!canAccessClientRoster(actor.role)) {
    return [];
  }

  // Doctors / caseload roles only see patients assigned to them.
  const where: Prisma.ClientWhereInput = await limitPrimaryCareToOwnLocations(clientAccessWhere({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorRole: actor.role,
  }), actor);

  if (options?.search?.trim()) {
    const q = options.search.trim();
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { mrn: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { primaryDiagnosisCode: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }

  const take = options?.take ? Math.min(options.take, 500) : 250;

  const baseInclude = {
    location: { select: { name: true } },
    assignedTo: { select: { name: true, role: true } },
    checkIns: {
      orderBy: { createdAt: 'desc' as const },
      take: 10,
      select: { mood: true, stress: true, createdAt: true },
    },
    appointments: {
      where: { status: 'SCHEDULED' as const, startsAt: { gte: new Date() } },
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
      orderBy: { updatedAt: 'desc' },
      take,
      skip: options?.skip || 0,
      include: {
        ...baseInclude,
        patientAccount: { select: { status: true } },
      },
    });
  } catch (err) {
    console.error('[clients list] patientAccount include failed; listing without portal status', err);
    rows = await prisma.client.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take,
      skip: options?.skip || 0,
      include: baseInclude,
    });
  }

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

  // Seen-by never loads for locked sensitive rows.
  let seenByMap = new Map<string, SeenByProvider[]>();
  try {
    seenByMap = await loadSeenBy(
      rows.filter((r) => !sensitiveMap.get(r.id) || sensitiveMap.get(r.id)!.canAccessSensitive).map((r) => r.id)
    );
  } catch (err) {
    console.error('[clients list] seen-by failed', err);
  }

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
      lastCheckIn: locked ? '—' : formatRelative(c.checkIns[0]?.createdAt),
      avgMood: locked ? 0 : avgMood,
      avgStress: locked ? 0 : avgStress,
      streak: locked ? 0 : c.checkInStreak,
      risk: locked ? ('low' as const) : RISK_UI[c.riskLevel],
      totalSessions: locked ? 0 : c._count.appointments,
      nextAppointment: locked
        ? undefined
        : next
          ? `${next.type} · ${next.startsAt.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}`
          : undefined,
      status: c.status,
      primaryDiagnosis: locked ? null : c.primaryDiagnosis,
      primaryDiagnosisCode: locked ? null : c.primaryDiagnosisCode,
      insurancePayer: locked ? null : c.insurancePayer,
      insuranceMemberId: locked ? null : c.insuranceMemberId,
      dateOfBirth: locked ? null : c.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: locked ? null : c.gender,
      locationName: locked ? null : c.location?.name ?? null,
      primaryLocationId: locked ? null : (c as any).primaryLocationId || (c as any).primary_location_id || c.locationId || 'bowie',
      assignedToName: locked ? null : c.assignedTo?.name ?? null,
      assignedToId: locked ? null : c.assignedToId,
      assignedToRole: locked ? null : c.assignedTo?.role ?? null,
      seenBy: locked ? [] : seenByMap.get(c.id) ?? [],
      treatmentTeam: locked ? null : c.treatmentTeam ?? null,
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

export async function countClientsForUser(
  actor: {
    id: string;
    role: Role;
    organizationId: string;
  },
  options?: { search?: string }
): Promise<number> {
  if (!canAccessClientRoster(actor.role)) {
    return 0;
  }

  const where: Prisma.ClientWhereInput = await limitPrimaryCareToOwnLocations(clientAccessWhere({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorRole: actor.role,
  }), actor);

  if (options?.search?.trim()) {
    const q = options.search.trim();
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { mrn: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { primaryDiagnosisCode: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }

  return prisma.client.count({ where });
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
          state: emptyToNull(input.state),
          postalCode: emptyToNull(input.postalCode),
          emergencyContactName: emptyToNull(input.emergencyContactName),
          emergencyContactPhone: emptyToNull(input.emergencyContactPhone),
          insurancePayer: emptyToNull(input.insurancePayer),
          insuranceMemberId: emptyToNull(input.insuranceMemberId),
          insuranceGroupNumber: emptyToNull(input.insuranceGroupNumber),
          primaryDiagnosis: emptyToNull(input.primaryDiagnosis),
          primaryDiagnosisCode: emptyToNull(input.primaryDiagnosisCode),
          secondaryDiagnoses: emptyToNull(input.secondaryDiagnoses),
          legalFirstName: emptyToNull(input.legalFirstName),
          middleInitial: emptyToNull(input.middleInitial)?.toUpperCase().slice(0, 1) || null,
          legalLastName: emptyToNull(input.legalLastName),
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

  return { ok: true as const, client, appInvite };
}
