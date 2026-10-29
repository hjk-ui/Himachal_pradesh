/**
 * Clinical Insights — server helpers (prisma): scope, live single-client evaluation.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { isCaseloadRole, isMedicalRole } from '@/types/roles';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { INSIGHT_CLIENT_SELECT, loadBatch, scanContext, toInsightRow, type EvaluatedClient } from './load';
import { ruleBasedActions, NEXT_ACTIONS, type NextActionId } from './rules';
import { clientTimeline, type TimelineEvent } from './timeline';
import type { InsightRow } from './population';

/** Page path; also the access rule for every /api/insights/clinical route */
export const INSIGHTS_PATH = '/dashboard/ai-insights';

export type Viewer = { organizationId: string; userId: string; role: Role | string };

/**
 * Caseload-scoped roles refresh only their clients; leadership refreshes the organization. A
 * verified Medical Director (pass the request's actor) is org-wide, like leadership.
 */
export function insightsScopeFor(
  role: Role | string,
  actor?: { userId: string; organizationId: string }
): 'organization' | 'caseload' {
  if (actor && verifiedMedicalDirector({ userId: actor.userId, role: String(role), organizationId: actor.organizationId })) {
    return 'organization';
  }
  const r = String(role).toUpperCase();
  return isCaseloadRole(r) || isMedicalRole(r) || r === 'PEER_SUPPORT' || r === 'CRISIS_RESPONDER' ? 'caseload' : 'organization';
}

export function viewerClientWhere(v: Viewer) {
  return clientAccessWhere({ organizationId: v.organizationId, actorUserId: v.userId, actorRole: v.role as Role });
}

export const viewerLockedIds = (v: Viewer) => (clientIds: string[]) =>
  lockedSensitiveClientIds({ organizationId: v.organizationId, userId: v.userId, role: v.role, clientIds });

export type ClientInsightDetail = {
  evaluated: EvaluatedClient;
  row: InsightRow;
  timeline: TimelineEvent[];
  suggestions: { id: NextActionId; label: string; because: string[] }[];
  names: string[];
  today: string;
  evaluatedAt: string;
};

export type ClientInsightResult =
  | { ok: true; detail: ClientInsightDetail }
  | { ok: false; status: 403 | 404; reason: 'client_not_found' | 'sensitive_record' };

/**
 * Live evaluation of one client the viewer may open: org / caseload scope, active (or a recent
 * discharge case) and not a protected record locked for the viewer. The Part 2 check runs before
 * any clinical row is read.
 */
export async function loadClientInsight(viewer: Viewer, clientId: string, now = new Date()): Promise<ClientInsightResult> {
  const where = viewerClientWhere(viewer);
  const client = await prisma.client.findFirst({
    where: { AND: [where, { id: clientId }] },
    select: { ...INSIGHT_CLIENT_SELECT, preferredName: true },
  });
  if (!client) return { ok: false, status: 404, reason: 'client_not_found' };
  const locked = await lockedSensitiveClientIds({ organizationId: viewer.organizationId, userId: viewer.userId, role: viewer.role, clientIds: [client.id] });
  if (locked.has(client.id)) return { ok: false, status: 403, reason: 'sensitive_record' };
  const timeZone = await getPracticeTimeZone(viewer.organizationId);
  const ctx = await scanContext({
    organizationId: viewer.organizationId,
    actor: { userId: viewer.userId, role: viewer.role },
    clientWhere: { AND: [where, { id: client.id }] },
    timeZone,
    now,
    clientIds: [client.id],
  });
  if (client.status !== 'ACTIVE' && !ctx.discharges.has(client.id)) return { ok: false, status: 404, reason: 'client_not_found' };
  const { preferredName, ...row } = client;
  const [evaluated] = await loadBatch(ctx, [row]);
  return {
    ok: true,
    detail: {
      evaluated,
      row: toInsightRow(evaluated, now.toISOString()),
      timeline: clientTimeline(evaluated.facts),
      suggestions: ruleBasedActions(evaluated.evaluation).map((a) => ({ id: a.id, label: NEXT_ACTIONS[a.id], because: a.because })),
      names: [client.name, client.legalFirstName, client.legalLastName, preferredName].filter((n): n is string => Boolean(n)),
      today: ctx.today,
      evaluatedAt: now.toISOString(),
    },
  };
}

/** Any SensitiveRecord on the client keeps it out of the model, even when this viewer may open it. */
export async function isProtectedClient(organizationId: string, clientId: string): Promise<boolean> {
  return Boolean(await prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { id: true } }));
}
