import 'server-only';
import { Prisma, type IncidentReport, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { incidentTimeliness, practiceYear } from '@/lib/compliance/metrics';
import { practiceToday } from '@/lib/time/practiceTime';
import {
  canReviewAllIncidents,
  canWorkIncident,
  incidentVisibilityFilter,
  nextIncidentNumber,
  type IncidentStatusValue,
} from './access';

export type IncidentActor = { organizationId: string; userId: string; role: Role | string };

export function isIncidentReviewer(actor: IncidentActor): boolean {
  return canReviewAllIncidents(
    String(actor.role),
    verifiedMedicalDirector({ userId: actor.userId, role: actor.role, organizationId: actor.organizationId }),
  );
}

/** The page's Incident shape (src/features/compliance/incidentsData.ts) plus record id and rights. */
export function incidentToView(row: IncidentReport, actor: IncidentActor, reviewer: boolean) {
  const reportedAtTime = row.reportedAtTime?.toISOString();
  const occurredAt = row.occurredAt?.toISOString();
  return {
    recordId: row.id,
    id: row.incidentNumber,
    title: row.title,
    type: row.type,
    chartCategory: row.chartCategory ?? undefined,
    severity: row.severity,
    status: row.status,
    clientInitials: row.clientInitials ?? '',
    clientId: row.clientId,
    reportedBy: row.reportedByName ?? '',
    reporterUserId: row.reporterUserId,
    assignedTo: row.assignedToName ?? '',
    assignedToUserId: row.assignedToUserId,
    involvedStaffIds: row.involvedStaffIds,
    reportedAt: row.reportedDate,
    reportedAtTime,
    occurredAt,
    dueFollowUp: row.dueFollowUp ?? '',
    closedAt: row.closedAt ?? undefined,
    location: row.location ?? '',
    description: row.description,
    immediateAction: row.immediateAction ?? '',
    investigationNotes: row.investigationNotes ?? '',
    correctiveActions: row.correctiveActions,
    rootCause: row.rootCause ?? '',
    carfCategory: row.carfCategory ?? '',
    errorExplanation: row.errorExplanation ?? undefined,
    timeliness: incidentTimeliness(occurredAt, reportedAtTime),
    canWork: canWorkIncident(reviewer, row, actor.userId),
  };
}

/** Drop reports linked to a Part 2 / sensitive client the actor may not open (fails closed). */
async function withoutLocked(actor: IncidentActor, rows: IncidentReport[]): Promise<IncidentReport[]> {
  const ids = rows.map((r) => r.clientId).filter((id): id is string => Boolean(id));
  if (!ids.length) return rows;
  const locked = await lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds: ids });
  return rows.filter((r) => !r.clientId || !locked.has(r.clientId));
}

export async function listIncidents(actor: IncidentActor) {
  const reviewer = isIncidentReviewer(actor);
  const rows = await prisma.incidentReport.findMany({
    where: { organizationId: actor.organizationId, ...incidentVisibilityFilter(reviewer, actor.userId) },
    orderBy: [{ reportedDate: 'desc' }, { createdAt: 'desc' }],
    take: 2000,
  });
  const visible = await withoutLocked(actor, rows);
  return { reviewer, incidents: visible.map((r) => incidentToView(r, actor, reviewer)) };
}

export async function findVisibleIncident(actor: IncidentActor, recordId: string) {
  const reviewer = isIncidentReviewer(actor);
  const row = await prisma.incidentReport.findFirst({
    where: { id: recordId, organizationId: actor.organizationId, ...incidentVisibilityFilter(reviewer, actor.userId) },
  });
  if (!row) return { reviewer, row: null };
  const [kept] = await withoutLocked(actor, [row]);
  return { reviewer, row: kept ?? null };
}

/** Staff ids that are users of the organization (anything else is dropped). */
export async function orgStaff(organizationId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  return prisma.user.findMany({ where: { id: { in: unique }, organizationId }, select: { id: true, name: true, email: true } });
}

export class IncidentInputError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 = 400) {
    super(message);
  }
}

export type IncidentCreateInput = {
  title: string;
  type: string;
  chartCategory?: string | null;
  severity: string;
  clientInitials?: string | null;
  clientId?: string | null;
  location?: string | null;
  description: string;
  immediateAction?: string | null;
  carfCategory?: string | null;
  dueFollowUp?: string | null;
  occurredAt?: string | null;
  assignedToUserId?: string | null;
  involvedStaffIds?: string[];
};

export async function createIncident(actor: IncidentActor, input: IncidentCreateInput) {
  const reviewer = isIncidentReviewer(actor);
  const [me] = await orgStaff(actor.organizationId, [actor.userId]);
  const staff = await orgStaff(actor.organizationId, [...(input.involvedStaffIds ?? []), ...(input.assignedToUserId ? [input.assignedToUserId] : [])]);
  const staffIds = new Set(staff.map((s) => s.id));
  const involved = [...new Set((input.involvedStaffIds ?? []).filter((id) => staffIds.has(id)))];
  if ((input.involvedStaffIds ?? []).some((id) => !staffIds.has(id))) throw new IncidentInputError('Involved staff must be members of this practice');
  if (input.assignedToUserId && !staffIds.has(input.assignedToUserId)) throw new IncidentInputError('The assignee must be a member of this practice');
  const assignee = input.assignedToUserId ? staff.find((s) => s.id === input.assignedToUserId) : null;
  if (input.clientId) {
    // A client link must be a client the reporter may open (caseload / care team, not locked)
    const client = await prisma.client.findFirst({
      where: { AND: [{ id: input.clientId }, clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role })] },
      select: { id: true },
    });
    if (!client) throw new IncidentInputError('Client not found in your caseload', 404);
    const locked = await lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds: [input.clientId] });
    if (locked.has(input.clientId)) throw new IncidentInputError('Protected record: open the chart (break-the-glass) first', 403);
  }
  const occurred = input.occurredAt ? new Date(input.occurredAt) : null;
  const year = practiceYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const numbers = await prisma.incidentReport.findMany({
      where: { organizationId: actor.organizationId, incidentNumber: { startsWith: `INC-${year}-` } },
      select: { incidentNumber: true },
    });
    const incidentNumber = nextIncidentNumber(numbers.map((n) => n.incidentNumber), year);
    try {
      const row = await prisma.incidentReport.create({
        data: {
          organizationId: actor.organizationId,
          incidentNumber,
          title: input.title,
          type: input.type,
          chartCategory: input.chartCategory ?? null,
          severity: input.severity,
          status: 'reported',
          reporterUserId: actor.userId,
          reportedByName: me?.name || me?.email || null,
          involvedStaffIds: involved,
          assignedToUserId: assignee?.id ?? null,
          assignedToName: assignee ? assignee.name || assignee.email : null,
          clientId: input.clientId ?? null,
          clientInitials: input.clientInitials || null,
          reportedDate: practiceToday(),
          reportedAtTime: new Date(),
          occurredAt: occurred && Number.isFinite(occurred.getTime()) ? occurred : null,
          dueFollowUp: input.dueFollowUp || null,
          location: input.location || null,
          description: input.description,
          immediateAction: input.immediateAction || null,
          carfCategory: input.carfCategory || null,
          updatedById: actor.userId,
        },
      });
      return incidentToView(row, actor, reviewer);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
  throw new Error('Could not assign an incident number');
}

export type IncidentUpdateInput = {
  status?: IncidentStatusValue;
  investigationNotes?: string;
  rootCause?: string;
  correctiveActions?: string[];
  errorExplanation?: string;
  assignedToUserId?: string | null;
  involvedStaffIds?: string[];
  dueFollowUp?: string;
};

export async function updateIncident(actor: IncidentActor, recordId: string, input: IncidentUpdateInput) {
  const { reviewer, row } = await findVisibleIncident(actor, recordId);
  if (!row) throw new IncidentInputError('Incident not found', 404);
  if (!canWorkIncident(reviewer, row, actor.userId)) {
    throw new IncidentInputError('Only quality / leadership reviewers or the assigned investigator can update this report', 403);
  }
  // Assignment and the involved-staff list are review decisions
  if (!reviewer && (input.assignedToUserId !== undefined || input.involvedStaffIds !== undefined)) {
    throw new IncidentInputError('Only reviewers can change the assignment or the involved staff', 403);
  }
  if (input.status === 'filed_in_error' && !input.errorExplanation?.trim() && !row.errorExplanation) {
    throw new IncidentInputError('Explain why the report was filed in error');
  }
  const data: Prisma.IncidentReportUpdateInput = { updatedById: actor.userId };
  if (input.status) {
    data.status = input.status;
    if (input.status === 'closed' && !row.closedAt) data.closedAt = practiceToday();
  }
  if (input.investigationNotes !== undefined) data.investigationNotes = input.investigationNotes;
  if (input.rootCause !== undefined) data.rootCause = input.rootCause;
  if (input.correctiveActions !== undefined) data.correctiveActions = input.correctiveActions.filter((a) => a.trim());
  if (input.errorExplanation !== undefined) data.errorExplanation = input.errorExplanation;
  if (input.dueFollowUp !== undefined) data.dueFollowUp = input.dueFollowUp || null;
  if (input.assignedToUserId !== undefined || input.involvedStaffIds !== undefined) {
    const staff = await orgStaff(actor.organizationId, [...(input.involvedStaffIds ?? []), ...(input.assignedToUserId ? [input.assignedToUserId] : [])]);
    const ids = new Set(staff.map((s) => s.id));
    if (input.assignedToUserId && !ids.has(input.assignedToUserId)) throw new IncidentInputError('The assignee must be a member of this practice');
    if ((input.involvedStaffIds ?? []).some((id) => !ids.has(id))) throw new IncidentInputError('Involved staff must be members of this practice');
    if (input.assignedToUserId !== undefined) {
      const a = input.assignedToUserId ? staff.find((s) => s.id === input.assignedToUserId) : null;
      data.assignedToUserId = a?.id ?? null;
      data.assignedToName = a ? a.name || a.email : null;
    }
    if (input.involvedStaffIds !== undefined) data.involvedStaffIds = [...new Set(input.involvedStaffIds)];
  }
  const updated = await prisma.incidentReport.update({ where: { id: row.id }, data });
  return incidentToView(updated, actor, reviewer);
}

/** Org-wide rows for reviewer-only server readers (report library, CARF scorecard percentages). */
export async function incidentsForOrgMetrics(organizationId: string) {
  return prisma.incidentReport.findMany({
    where: { organizationId },
    select: { status: true, severity: true, type: true, reportedDate: true, reportedAtTime: true, occurredAt: true, closedAt: true },
  });
}

/** Rows in the shape the CARF readiness / report code reads (reportedAt = YYYY-MM-DD). */
export function incidentMetricRecord(r: Awaited<ReturnType<typeof incidentsForOrgMetrics>>[number]) {
  return {
    status: r.status,
    severity: r.severity,
    type: r.type,
    reportedAt: r.reportedDate,
    reportedAtTime: r.reportedAtTime?.toISOString(),
    occurredAt: r.occurredAt?.toISOString(),
    closedAt: r.closedAt ?? undefined,
  };
}
