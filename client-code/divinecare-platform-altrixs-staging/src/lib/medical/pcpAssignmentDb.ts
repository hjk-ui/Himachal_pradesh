/**
 * Prisma side of PCP assignment (rules in pcpAssignment.ts). Server / scripts only.
 *
 * - loadPcpContext: staff + Valant provider code map for one organization.
 * - loadPcpDecisions: current PCP + evidence decision for a set of clients (batched queries).
 * - setPrimaryCareProvider: make a medical provider the one PCP care team member (idempotent),
 *   mirror MedicalPatient.assignedPcp, audit. Never touches Client.assignedToId.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { primaryCarePatientWhere, PRIMARY_CARE_VALANT_FACILITY } from '@/lib/medical/medicalProgram';
import { buildProviderCodeMap, providerCodeKey, type ProviderCodeMap } from '@/lib/migration/valantProviderMap';
import {
  decidePcp,
  isPcpEligible,
  isPcpTeamRole,
  pcpDisplayName,
  resolveCurrentPcp,
  runSetPcp,
  tallyEncounters,
  type CurrentPcp,
  type EvidenceSummary,
  type PcpDecision,
  type PcpStaff,
  type PcpWriteStore,
  type PcpWriteTx,
  type RawEncounter,
  type SetPcpResult,
} from '@/lib/medical/pcpAssignment';

const CHUNK = 500;

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type PcpContext = {
  organizationId: string;
  staff: Map<string, PcpStaff>;
  codeMap: ProviderCodeMap;
};

export async function loadPcpContext(organizationId: string): Promise<PcpContext> {
  const [users, mapRows] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, credentials: true, role: true, roles: true, status: true },
    }),
    // Table from 20261020_valant_provider_map.sql; before it is applied every code counts as unmapped
    prisma.valantProviderMap.findMany({ where: { organizationId }, select: { codeKey: true, userId: true } }).catch((err: unknown) => {
      console.error('[pcp] ValantProviderMap lookup failed; treating every code as unmapped', err instanceof Error ? err.name : 'error');
      return [] as { codeKey: string; userId: string }[];
    }),
  ]);
  const staff = new Map<string, PcpStaff>(
    users.map((u) => [u.id, { id: u.id, name: u.name, credentials: u.credentials, role: String(u.role), roles: u.roles.map(String), status: String(u.status) }])
  );
  // A mapping to a user outside this organization is ignored (never crosses tenants)
  const codeMap = buildProviderCodeMap(mapRows.filter((r) => staff.has(r.userId)));
  return { organizationId, staff, codeMap };
}

/** Active medical providers (PCP picker choices), by name */
export function pcpChoices(ctx: PcpContext): { id: string; name: string }[] {
  return [...ctx.staff.values()]
    .filter((s) => isPcpEligible(s))
    .map((s) => ({ id: s.id, name: pcpDisplayName(s) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Ids of the organization's primary care patients (medicalProgram.primaryCarePatientWhere) */
export async function primaryCareClientIds(organizationId: string, extra: Prisma.ClientWhereInput = {}): Promise<string[]> {
  const rows = await prisma.client.findMany({
    where: { AND: [clientOrgFilter(organizationId), primaryCarePatientWhere(), extra] },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => r.id);
}

export type PcpClientDecision = {
  clientId: string;
  mrn: string | null;
  clientStatus: string;
  decision: PcpDecision;
  summary: EvidenceSummary;
  pcpMemberCount: number;
};

export async function loadPcpDecisions(ctx: PcpContext, clientIds: readonly string[], now = new Date()): Promise<Map<string, PcpClientDecision>> {
  const out = new Map<string, PcpClientDecision>();
  const medicalIds = [...ctx.staff.values()].filter((s) => isPcpEligible(s)).map((s) => s.id);
  for (const ids of chunks([...new Set(clientIds)])) {
    const [clients, charges, visits, appts] = await Promise.all([
      prisma.client.findMany({
        where: { id: { in: ids }, AND: [clientOrgFilter(ctx.organizationId)] },
        select: {
          id: true,
          mrn: true,
          status: true,
          treatmentTeamMembers: {
            select: { id: true, providerId: true, name: true, role: true, credentials: true, isPrimary: true },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          },
        },
      }),
      prisma.valantTransaction.findMany({
        where: {
          organizationId: ctx.organizationId,
          clientId: { in: ids },
          category: 'charge',
          facility: { equals: PRIMARY_CARE_VALANT_FACILITY, mode: 'insensitive' },
          serviceDate: { not: null },
        },
        select: { clientId: true, providerCode: true, serviceDate: true },
      }),
      prisma.medicalVisit.findMany({
        where: { clientId: { in: ids } },
        select: { clientId: true, providerId: true, visitDate: true },
      }),
      medicalIds.length
        ? prisma.appointment.findMany({
            where: { clientId: { in: ids }, status: 'COMPLETED', startsAt: { lte: now }, clinicianId: { in: medicalIds } },
            select: { clientId: true, clinicianId: true, startsAt: true },
          })
        : Promise.resolve([] as { clientId: string; clinicianId: string | null; startsAt: Date }[]),
    ]);
    const mrns = clients.map((c) => c.mrn).filter((m): m is string => Boolean(m));
    const medicalPatients = await prisma.medicalPatient.findMany({
      where: { organizationId: ctx.organizationId, OR: [{ bhClientId: { in: ids } }, ...(mrns.length ? [{ mrn: { in: mrns } }] : [])] },
      select: { bhClientId: true, mrn: true, assignedPcp: true },
    });

    const enc = new Map<string, RawEncounter[]>();
    const push = (id: string | null, e: RawEncounter) => {
      if (!id) return;
      const list = enc.get(id) ?? [];
      list.push(e);
      enc.set(id, list);
    };
    for (const c of charges) push(c.clientId, { source: 'valant_charge', date: c.serviceDate!, providerCode: c.providerCode });
    for (const v of visits) push(v.clientId, { source: 'medical_visit', date: v.visitDate, providerUserId: v.providerId });
    for (const a of appts) push(a.clientId, { source: 'appointment', date: a.startsAt, providerUserId: a.clinicianId });

    for (const c of clients) {
      const texts = medicalPatients.filter((m) => m.bhClientId === c.id || (c.mrn && m.mrn === c.mrn)).map((m) => m.assignedPcp);
      const { current, pcpMemberCount } = resolveCurrentPcp({ team: c.treatmentTeamMembers, assignedPcpTexts: texts, staff: ctx.staff });
      const summary = tallyEncounters({ encounters: enc.get(c.id) ?? [], codeMap: ctx.codeMap, codeKey: providerCodeKey, staff: ctx.staff, now });
      const decision = decidePcp({ current, tallies: summary.tallies });
      out.set(c.id, { clientId: c.id, mrn: c.mrn, clientStatus: String(c.status), decision, summary, pcpMemberCount });
    }
  }
  return out;
}

/** Current PCP for one chart (banner, PCP picker, visit suggestion) */
export async function loadCurrentPcp(organizationId: string, clientId: string): Promise<CurrentPcp | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, AND: [clientOrgFilter(organizationId)] },
    select: {
      id: true,
      mrn: true,
      treatmentTeamMembers: {
        select: { id: true, providerId: true, name: true, role: true, credentials: true, isPrimary: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      },
    },
  });
  if (!client) return null;
  const hasMember = client.treatmentTeamMembers.some((m) => isPcpTeamRole(m.role) && m.providerId);
  const texts = hasMember
    ? []
    : (
        await prisma.medicalPatient.findMany({
          where: { organizationId, OR: [{ bhClientId: client.id }, ...(client.mrn ? [{ mrn: client.mrn }] : [])] },
          select: { assignedPcp: true },
        })
      ).map((m) => m.assignedPcp);
  // Staff are needed to label the member and to resolve legacy text (exact id / exact unique name)
  const users = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, credentials: true, role: true, roles: true, status: true },
  });
  const staff = new Map<string, PcpStaff>(
    users.map((u) => [u.id, { id: u.id, name: u.name, credentials: u.credentials, role: String(u.role), roles: u.roles.map(String), status: String(u.status) }])
  );
  return resolveCurrentPcp({ team: client.treatmentTeamMembers, assignedPcpTexts: texts, staff }).current;
}

// ─── Write ───────────────────────────────────────────────────────────────────

export type { SetPcpActor, SetPcpResult } from '@/lib/medical/pcpAssignment';

const toStaff = (u: { id: string; name: string | null; credentials: string | null; role: unknown; roles: unknown[]; status: unknown }): PcpStaff => ({
  id: u.id,
  name: u.name,
  credentials: u.credentials,
  role: String(u.role),
  roles: u.roles.map(String),
  status: String(u.status),
});

function prismaTx(tx: Prisma.TransactionClient): PcpWriteTx {
  return {
    findClient: (organizationId, clientId) =>
      tx.client.findFirst({ where: { id: clientId, AND: [clientOrgFilter(organizationId)] }, select: { id: true, mrn: true } }),
    team: (clientId) =>
      tx.clientTreatmentTeamMember.findMany({
        where: { clientId },
        select: { id: true, providerId: true, name: true, role: true, credentials: true, isPrimary: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    async deleteMembers(clientId, memberIds) {
      await tx.clientTreatmentTeamMember.deleteMany({ where: { clientId, id: { in: memberIds } } });
    },
    async setMemberRole(memberId, role, assignedBy) {
      await tx.clientTreatmentTeamMember.update({ where: { id: memberId }, data: { role, assignedBy } });
    },
    async createMember(clientId, staff, role, assignedBy) {
      const name = String(staff.name ?? '').trim() || 'Provider';
      const parts = name.split(/\s+/).filter(Boolean);
      await tx.clientTreatmentTeamMember.create({
        data: {
          clientId,
          providerId: staff.id,
          name,
          role,
          credentials: staff.credentials ?? null,
          isPrimary: false,
          initials: parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase(),
          assignedBy,
        },
      });
    },
    async mirrorAssignedPcp(organizationId, client, displayName) {
      const res = await tx.medicalPatient.updateMany({
        where: {
          organizationId,
          OR: [{ bhClientId: client.id }, ...(client.mrn ? [{ mrn: client.mrn }] : [])],
          NOT: { assignedPcp: displayName },
        },
        data: { assignedPcp: displayName },
      });
      return res.count;
    },
    async syncTeamJson(clientId) {
      // Same JSON shape treatmentTeamService writes
      const all = await tx.clientTreatmentTeamMember.findMany({ where: { clientId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
      await tx.client.update({
        where: { id: clientId },
        data: {
          treatmentTeam: all.map((m) => ({
            id: m.providerId || m.id,
            name: m.name,
            role: m.role,
            credentials: m.credentials,
            primary: m.isPrimary,
            avatarColor: m.avatarColor,
            initials: m.initials,
          })) as Prisma.InputJsonValue,
        },
      });
    },
  };
}

export const prismaPcpWriteStore: PcpWriteStore = {
  async findStaff(organizationId, userId) {
    const u = await prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, name: true, credentials: true, role: true, roles: true, status: true },
    });
    return u ? toStaff(u) : null;
  },
  transaction: (fn) => prisma.$transaction((tx) => fn(prismaTx(tx))),
  async audit(entry) {
    await writeAuditLog({
      action: 'UPDATE',
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      organizationId: entry.organizationId,
      resourceType: 'primaryCareProvider',
      resourceId: entry.clientId,
      patientId: entry.clientId,
      ...(entry.requestMeta ?? {}),
      metadata: entry.metadata,
    });
  },
};

/** Set the PCP (runSetPcp with the Prisma store). See runSetPcp in pcpAssignment.ts. */
export function setPrimaryCareProvider(input: Parameters<typeof runSetPcp>[1]): Promise<SetPcpResult> {
  return runSetPcp(prismaPcpWriteStore, input);
}

/** Evidence counts for audit metadata (ids and numbers only) */
export function evidenceAuditDetail(d: PcpClientDecision): Record<string, unknown> {
  return {
    statusBefore: d.decision.status,
    basis: d.decision.basis,
    evidenceProviderId: d.decision.evidence?.userId ?? null,
    evidenceInWindow: d.decision.evidence?.inWindow ?? 0,
    evidenceTotal: d.decision.evidence?.total ?? 0,
    evidenceLastDate: d.decision.evidence?.lastDate ?? null,
    currentInWindow: d.summary.tallies.find((t) => t.userId && t.userId === d.decision.current?.userId)?.inWindow ?? 0,
  };
}
