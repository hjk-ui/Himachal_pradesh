import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { careTeamClientWhereForRole, clientByIdWhere } from '@/lib/clients/orgScope';
import { primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { canReadLedger } from '@/lib/billing/ledger';
import { threadAssigneeOr } from '@/lib/messages/assignee';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { patientBalance } from '@/lib/billing/patientLedger';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';
import { redactLockedItem } from '@/lib/clinical/sessionFrequency';
import { clientCarelonRequirement } from '@/lib/consents/carelon/store';
import { loadCurrentPcp, loadPcpContext, loadPcpDecisions } from '@/lib/medical/pcpAssignmentDb';
import { pcpReviewDisplay } from '@/lib/medical/pcpAssignment';
import { buildClientCareTeam } from '@/lib/clients/careTeam';
import { loadCareTeamStaff, loadSeenByRows } from '@/lib/clients/careTeamDb';
import {
  decideChartAccess,
  type ChartAccessDecision,
  type ChartBannerSource,
  type ChartViewer,
  type SensitiveState,
} from '@/lib/clients/chartBanner';

/** Same rule as the chart billing card / GET /api/billing/patient-balance/[clientId] */
export function canSeeChartBilling(role: string): boolean {
  return (
    canReadLedger(role as Role) &&
    (canAccessPath(role, '/dashboard/billing/payments') || canAccessPath(role, '/dashboard/billing/valant-balances'))
  );
}

async function sensitiveState(viewer: ChartViewer, clientId: string, path: string): Promise<SensitiveState> {
  const exists = await prisma.sensitiveRecord.findFirst({
    where: { clientId, organizationId: viewer.organizationId },
    select: { id: true },
  });
  if (!exists) return 'none';
  try {
    // Logs whitelist / break-glass / admin bypass / denied in SensitiveAccessLog
    await assertClientPhiAccess({ organizationId: viewer.organizationId, userId: viewer.userId, role: viewer.role, clientId, path });
    return 'allowed';
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return 'locked';
    throw err;
  }
}

/**
 * Any caseload role: on the client's care team, the role-correct branch of clientAccessWhere
 * (behavioral: assigned / treatment team / appointment in the lookback or upcoming; primary care:
 * also a MedicalVisit; Peer Support: assigned / treatment team). One exists-query, no cache, so the
 * chart matches the client list.
 */
export async function hasCareTeamLink(viewer: ChartViewer, clientId: string): Promise<boolean> {
  const hit = await prisma.client.findFirst({
    where: { AND: [clientByIdWhere(clientId, viewer.organizationId), careTeamClientWhereForRole(viewer.userId, viewer.role)] },
    select: { id: true },
  });
  return Boolean(hit);
}

/** Primary-care patient (medicalProgram.primaryCarePatientWhere), one exists-query */
export async function isPrimaryCarePatient(clientId: string): Promise<boolean> {
  const hit = await prisma.client.findFirst({ where: { AND: [{ id: clientId }, primaryCarePatientWhere()] }, select: { id: true } });
  return Boolean(hit);
}

/** Mirrors GET /api/clients/[id]: a thread forwarded or assigned to this staff member */
export async function hasForwardedThread(viewer: ChartViewer, clientId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { name: true } });
  const actorName = user?.name?.trim();
  const thread = await prisma.messageThread.findFirst({
    where: {
      clientId,
      organizationId: viewer.organizationId,
      // Exact (case-insensitive) name / id match: a substring match let "Ann" open "Joanne"'s threads
      OR: threadAssigneeOr({ userId: viewer.userId, name: actorName }),
    },
    select: { id: true },
  });
  return Boolean(thread);
}

/**
 * Org + role + Part 2 + caseload gate for chart section routes. Returns the decision and the
 * scoped client's name fields (for name-matched practice module lists).
 */
export async function resolveChartAccess(
  viewer: ChartViewer,
  clientId: string,
  path: string
): Promise<
  | (Extract<ChartAccessDecision, { ok: true }> & {
      client: { id: string; name: string; legalFirstName: string | null; legalLastName: string | null; dateOfBirth: Date | null; status: string; assignedToId: string | null; primaryDiagnosis: string | null; primaryDiagnosisCode: string | null; secondaryDiagnoses: string | null };
    })
  | Extract<ChartAccessDecision, { ok: false }>
> {
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(clientId, viewer.organizationId),
    select: {
      id: true,
      name: true,
      legalFirstName: true,
      legalLastName: true,
      dateOfBirth: true,
      status: true,
      assignedToId: true,
      primaryDiagnosis: true,
      primaryDiagnosisCode: true,
      secondaryDiagnoses: true,
    },
  });
  if (!client) return { ok: false, status: 404, reason: 'client_not_found' };
  const state = await sensitiveState(viewer, client.id, path);
  const decision = await decideChartAccess({
    role: viewer.role,
    userId: viewer.userId,
    organizationId: viewer.organizationId,
    client,
    sensitive: state,
    hasForwardedThread: () => hasForwardedThread(viewer, client.id),
    hasCareTeamLink: () => hasCareTeamLink(viewer, client.id),
  });
  if (decision.ok === false) return decision;
  return { ...decision, client };
}

const ATTENDED_OR_CANCELLED = ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL', 'COMPLETED'] as const;

export function prismaChartBannerSource(path: string): ChartBannerSource {
  return {
    async findClient(organizationId, clientId) {
      const c = await prisma.client.findFirst({
        where: clientByIdWhere(clientId, organizationId),
        select: {
          id: true,
          name: true,
          legalFirstName: true,
          middleInitial: true,
          legalLastName: true,
          mrn: true,
          dateOfBirth: true,
          status: true,
          riskLevel: true,
          assignedToId: true,
          assignedTo: { select: { name: true } },
          location: { select: { name: true } },
          insurancePayer: true,
          insuranceMemberId: true,
          primaryDiagnosis: true,
          primaryDiagnosisCode: true,
          secondaryDiagnoses: true,
          // Banner pronouns / preferred name and the demographics-incomplete notice
          preferredName: true,
          pronouns: true,
          needsNameReview: true,
          administrativeSex: true,
          gender: true,
          addressLine1: true,
          addressStatus: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
          insuranceType: true,
          medicaidId: true,
        },
      });
      if (!c) return null;
      return {
        id: c.id,
        name: c.name,
        legalFirstName: c.legalFirstName,
        middleInitial: c.middleInitial,
        legalLastName: c.legalLastName,
        mrn: c.mrn,
        dateOfBirth: c.dateOfBirth,
        status: c.status,
        riskLevel: c.riskLevel,
        assignedToId: c.assignedToId,
        assignedToName: c.assignedTo?.name ?? null,
        locationName: c.location?.name ?? null,
        insurancePayer: c.insurancePayer,
        insuranceMemberId: c.insuranceMemberId,
        primaryDiagnosis: c.primaryDiagnosis,
        primaryDiagnosisCode: c.primaryDiagnosisCode,
        secondaryDiagnoses: c.secondaryDiagnoses,
        preferredName: c.preferredName,
        pronouns: c.pronouns,
        needsNameReview: c.needsNameReview,
        administrativeSex: c.administrativeSex,
        gender: c.gender,
        addressLine1: c.addressLine1,
        addressStatus: c.addressStatus,
        city: c.city,
        state: c.state,
        postalCode: c.postalCode,
        phone: c.phone,
        insuranceType: c.insuranceType,
        medicaidId: c.medicaidId,
      };
    },
    sensitiveState: (viewer, clientId) => sensitiveState(viewer, clientId, path),
    async primaryCareProvider(organizationId, clientId) {
      const pcp = await loadCurrentPcp(organizationId, clientId);
      return pcp ? { id: pcp.userId, name: pcp.displayName } : null;
    },
    async careTeam(organizationId, clientId) {
      const c = await prisma.client.findFirst({
        where: clientByIdWhere(clientId, organizationId),
        select: { id: true, assignedToId: true, treatmentTeam: true, assignedTo: { select: { id: true, name: true, role: true, roles: true } } },
      });
      if (!c) return null;
      const now = new Date();
      const [members, seen] = await Promise.all([
        prisma.clientTreatmentTeamMember.findMany({
          where: { clientId: c.id },
          select: { clientId: true, providerId: true, name: true, role: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        }),
        loadSeenByRows([c.id], now).catch(() => []),
      ]);
      const staff = await loadCareTeamStaff(organizationId, [...members.map((m) => m.providerId), ...seen.map((s) => s.providerId)]);
      return buildClientCareTeam(c, members, new Map(staff.map((u) => [u.id, u])), seen, now);
    },
    async pcpReview(organizationId, clientId) {
      const ctx = await loadPcpContext(organizationId);
      const d = (await loadPcpDecisions(ctx, [clientId])).get(clientId);
      return d ? pcpReviewDisplay(d.decision, ctx.staff) : null;
    },
    async sensitiveAlias(organizationId, clientId) {
      const r = await prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { alias: true } });
      return r?.alias ?? null;
    },
    hasForwardedThread,
    hasCareTeamLink,
    allergies: (clientId) =>
      prisma.medicalAllergy.findMany({
        where: { clientId },
        select: { allergen: true, reaction: true, severity: true, status: true, source: true },
        orderBy: { createdAt: 'asc' },
      }),
    priorAuths: (organizationId, clientId) =>
      prisma.priorAuth.findMany({
        where: { organizationId, clientId },
        select: { id: true, payer: true, authNumber: true, cptCodes: true, unitsApproved: true, unitsUsed: true, status: true, startDate: true, endDate: true },
      }),
    riskAlerts: (organizationId, clientId) =>
      prisma.riskAlert.findMany({
        where: { clientId, OR: [{ organizationId }, { organizationId: null }] },
        select: { id: true, type: true, severity: true, reviewed: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    latestCssrs: (organizationId, clientId) =>
      prisma.clinicalAssessmentRecord.findFirst({
        where: { organizationId, clientId, instrumentId: { startsWith: 'c-ssrs' } },
        select: { id: true, instrumentName: true, totalScore: true, severity: true, safetyFlagged: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    async nextAppointment(clientId, now) {
      const a = await prisma.appointment.findFirst({
        where: { clientId, startsAt: { gte: now }, status: { notIn: [...ATTENDED_OR_CANCELLED] } },
        select: { id: true, startsAt: true, type: true, clinicianName: true, clinician: { select: { name: true } }, isVirtual: true },
        orderBy: { startsAt: 'asc' },
      });
      return a ? { id: a.id, startsAt: a.startsAt, type: a.type, clinicianName: a.clinician?.name ?? a.clinicianName ?? null, isVirtual: a.isVirtual } : null;
    },
    practiceTimeZone: (organizationId) => getPracticeTimeZone(organizationId),
    async balanceCents(organizationId, clientId) {
      const b = await patientBalance(organizationId, clientId);
      return b ? b.balanceCents : null;
    },
    isPrimaryCarePatient,
    async carelonAttestation(organizationId, clientId) {
      const r = await clientCarelonRequirement(organizationId, clientId);
      return r ? r.requirement.state : null;
    },
    async consentGaps(organizationId, clientId) {
      const { clientConsentGaps } = await import('@/lib/consents/library/store');
      return (await clientConsentGaps(organizationId, clientId)).map((g) => ({ title: g.title, state: g.state }));
    },
    async sessionFrequency(viewer, clientId) {
      const { items } = await loadSessionFrequency(
        { organizationId: viewer.organizationId, actorUserId: viewer.userId, actorRole: viewer.role as Role },
        { clientId }
      );
      const item = items[0] ? redactLockedItem(items[0]) : null;
      if (!item) return null;
      return {
        bucket: item.bucket,
        recommendation: item.therapy.recommendation.label,
        statusDetail: item.therapy.statusDetail,
        status: item.therapy.status,
        therapyLastAttended: item.therapy.lastAttended,
        medLastAttended: item.medManagement.lastAttended,
        therapyNextScheduled: item.therapy.nextScheduled,
        medNextScheduled: item.medManagement.nextScheduled,
      };
    },
  };
}
