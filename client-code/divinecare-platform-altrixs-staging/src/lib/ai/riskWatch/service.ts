/**
 * Risk language watch: orchestration (rules → optional AI review → RiskAlert → audit).
 * Database, audit, AI and Part 2 lookups are injected so the whole flow is testable;
 * hooks.ts wires the real ones. Never sends anything to the patient.
 */
import type { AuditLogEntry } from '@/lib/audit/writeAuditLog';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { scanRiskText, SEVERITY_RANK, type RiskChannel, type RiskScan } from './engine';
import { reviewWithAi, type AiDowngrade, type AiInvoke } from './ai';
import type { RiskSeverity } from './phrases';
import {
  RISK_WATCH_SOURCE,
  RISK_WATCH_TYPE,
  SEVERITY_DB,
  SEVERITY_UI,
  alertRecipients,
  buildAlertDescription,
  planAlertWrite,
  riskSourceId,
  threadSourcePrefix,
  type ExistingAlert,
  type RecipientUser,
  type RiskSourceRef,
} from './routing';
import { patientSafetyPayload, type PatientSafetyPayload } from './crisisResources';

type Level = 'HIGH' | 'MEDIUM' | 'LOW';

/** Minimal database surface (a Prisma client satisfies it) */
export type RiskWatchDb = {
  client: {
    findFirst(args: unknown): Promise<{ id: string; name: string; assignedToId: string | null; legalFirstName?: string | null; legalLastName?: string | null } | null>;
  };
  riskAlert: {
    findMany(args: unknown): Promise<ExistingAlert[]>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  messageThread: {
    findFirst(args: unknown): Promise<{ id: string; risk: Level } | null>;
    update(args: { where: { id: string }; data: { risk: Level } }): Promise<unknown>;
  };
  user: {
    findMany(args: unknown): Promise<RecipientUser[]>;
  };
};

export type RiskWatchDeps = {
  db: RiskWatchDb;
  audit: (entry: AuditLogEntry) => Promise<void>;
  /** null when Bedrock is not configured → rules only */
  invoke: AiInvoke | null;
  model: string;
  /** Latest AI consent decision for the client */
  aiConsent: (organizationId: string, clientId: string) => Promise<'declined' | 'allowed'>;
  /** Client has a SensitiveRecord (Part 2 / protected) */
  isProtectedClient: (organizationId: string, clientId: string) => Promise<boolean>;
  /** Of these users, the ones who may not open the client's record */
  lockedUsers: (organizationId: string, clientId: string, users: RecipientUser[]) => Promise<Set<string>>;
};

export type RiskWatchInput = {
  organizationId: string;
  clientId: string;
  text: string;
  source: RiskSourceRef;
  /** Note-level 42 CFR Part 2 flag */
  part2?: boolean;
  /** Who caused the scan: the signing clinician, or null for a patient portal message */
  actor: { userId: string | null; role: string };
};

export type RiskWatchResult = {
  severity: RiskSeverity | null;
  ruleSeverity: RiskSeverity | null;
  action: 'none' | 'created' | 'updated' | 'skipped' | 'dismissed-by-ai' | 'error';
  alertId: string | null;
  skipReason?: string;
  ai: { status: 'skipped' | 'ok' | 'failed'; reason?: string; reviewed: number; downgrades: AiDowngrade[] };
  hits: { category: string; concept: string; severity: RiskSeverity }[];
  /** Patient portal only: crisis resources to show right away (never the matched words) */
  patientSafety: PatientSafetyPayload | null;
};

function channelFor(source: RiskSourceRef): RiskChannel {
  return source.kind === 'message' ? 'patient_message' : source.kind === 'note' ? 'note' : 'intake';
}

function summarizeHits(scan: RiskScan) {
  return scan.hits.map((h) => ({ category: h.category, concept: h.concept, severity: h.severity }));
}

export async function runRiskWatch(input: RiskWatchInput, deps: RiskWatchDeps): Promise<RiskWatchResult> {
  const channel = channelFor(input.source);
  const ruleScan = scanRiskText(input.text, channel);
  const base: RiskWatchResult = {
    severity: null,
    ruleSeverity: ruleScan.severity,
    action: 'none',
    alertId: null,
    ai: { status: 'skipped', reason: 'none-eligible', reviewed: 0, downgrades: [] },
    hits: [],
    patientSafety: null,
  };
  if (!ruleScan.hits.length) return base;

  const client = await deps.db.client.findFirst({
    where: { id: input.clientId, AND: [clientOrgFilter(input.organizationId)] },
    select: { id: true, name: true, assignedToId: true, legalFirstName: true, legalLastName: true },
  });
  if (!client) return { ...base, action: 'error', skipReason: 'client-not-found' };

  // ── Optional AI review: ambiguous low/medium only, consent respected, rules win on failure
  let scan = ruleScan;
  const eligible = ruleScan.hits.some((h) => h.ambiguous && h.severity !== 'high');
  if (eligible) {
    if (!deps.invoke) {
      base.ai = { status: 'skipped', reason: 'not-configured', reviewed: 0, downgrades: [] };
    } else if ((await deps.aiConsent(input.organizationId, client.id)) === 'declined') {
      base.ai = { status: 'skipped', reason: 'consent-declined', reviewed: 0, downgrades: [] };
    } else {
      const nameParts = [client.name, client.legalFirstName, client.legalLastName]
        .filter((s): s is string => Boolean(s))
        .flatMap((s) => s.split(/\s+/));
      const review = await reviewWithAi(ruleScan, deps.invoke, { nameParts });
      scan = review.scan;
      const reviewed = review.status === 'skipped' ? 0 : review.reviewed;
      base.ai = { status: review.status, reviewed, downgrades: review.downgrades };
      await deps.audit({
        action: 'AI_ACCESS',
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        organizationId: input.organizationId,
        resourceType: 'riskWatch',
        resourceId: riskSourceId(input.source),
        patientId: client.id,
        outcome: review.status === 'ok' ? 'SUCCESS' : 'FAILURE',
        metadata: {
          feature: 'risk-watch-classify',
          model: deps.model,
          sourceKind: input.source.kind,
          snippetCount: reviewed,
          // Every AI downgrade is logged (ids/enums only)
          downgrades: review.downgrades.map((d) => `${d.phraseId}:${d.from}->${d.to}:${d.reason}`),
        },
      });
    }
  }

  const severity = scan.severity;
  const result: RiskWatchResult = { ...base, severity, hits: summarizeHits(scan) };
  if (channel === 'patient_message' && (severity === 'high' || severity === 'medium')) {
    result.patientSafety = patientSafetyPayload(severity);
  }
  if (!severity) return { ...result, action: 'dismissed-by-ai' };
  // Guardrail: a rule-HIGH result can never come back lower
  if (ruleScan.severity === 'high' && severity !== 'high') throw new Error('risk-watch invariant: HIGH downgraded');

  const protectedRecord = Boolean(input.part2) || (await deps.isProtectedClient(input.organizationId, client.id));
  const sourceId = riskSourceId(input.source);
  const sourceLabel = RISK_WATCH_SOURCE[input.source.kind];
  const prefix = input.source.kind === 'message' ? threadSourcePrefix(input.source.threadId) : null;
  const existing = await deps.db.riskAlert.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: client.id,
      type: RISK_WATCH_TYPE,
      source: sourceLabel,
      ...(prefix ? { sourceId: { startsWith: prefix } } : { sourceId }),
    },
    select: { id: true, sourceId: true, severity: true, reviewed: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const plan = planAlertWrite(existing, sourceId, severity, prefix);
  const description = buildAlertDescription({ kind: input.source.kind, hits: scan.hits, protectedRecord, severity });

  let alertId: string;
  if (plan.kind === 'skip') {
    return { ...result, action: 'skipped', alertId: plan.alertId, skipReason: plan.reason };
  } else if (plan.kind === 'update') {
    await deps.db.riskAlert.update({ where: { id: plan.alertId }, data: { severity: SEVERITY_DB[severity], description } });
    alertId = plan.alertId;
  } else {
    const created = await deps.db.riskAlert.create({
      data: {
        organizationId: input.organizationId,
        clientId: client.id,
        clientName: client.name,
        clinicianId: client.assignedToId,
        type: RISK_WATCH_TYPE,
        severity: SEVERITY_DB[severity],
        source: sourceLabel,
        sourceId,
        description,
        reviewed: false,
      },
    });
    alertId = created.id;
  }

  // Extend the existing thread risk tag (never lowers it)
  if (input.source.kind === 'message') {
    const thread = await deps.db.messageThread.findFirst({ where: { id: input.source.threadId, organizationId: input.organizationId }, select: { id: true, risk: true } });
    if (thread && SEVERITY_RANK[SEVERITY_UI[thread.risk]] < SEVERITY_RANK[severity]) {
      await deps.db.messageThread.update({ where: { id: thread.id }, data: { risk: SEVERITY_DB[severity] } });
    }
  }

  // Routing: assigned clinician + crisis responders on HIGH, minus users locked out of a protected record
  const responders =
    severity === 'high'
      ? await deps.db.user.findMany({ where: { organizationId: input.organizationId, status: 'ACTIVE', OR: [{ role: 'CRISIS_RESPONDER' }, { roles: { has: 'CRISIS_RESPONDER' } }] }, select: { id: true, role: true }, take: 50 })
      : [];
  const candidates: RecipientUser[] = [...(client.assignedToId ? [{ id: client.assignedToId, role: 'ASSIGNED' }] : []), ...responders];
  const locked = protectedRecord ? await deps.lockedUsers(input.organizationId, client.id, candidates) : new Set<string>();
  const routed = alertRecipients({ severity, assignedClinicianId: client.assignedToId, crisisResponders: responders, lockedUserIds: locked });

  await deps.audit({
    action: plan.kind === 'create' ? 'CREATE' : 'UPDATE',
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    organizationId: input.organizationId,
    resourceType: 'riskAlert',
    resourceId: alertId,
    patientId: client.id,
    metadata: {
      feature: 'risk-watch',
      sourceKind: input.source.kind,
      severity,
      ruleSeverity: ruleScan.severity,
      concepts: [...new Set(scan.hits.map((h) => h.concept))],
      escalated: plan.kind === 'update',
      protectedRecord,
      routedCount: routed.userIds.length,
      crisisResponders: routed.crisisResponders,
      withheldProtected: routed.withheldProtected,
      unassigned: !client.assignedToId,
      aiStatus: result.ai.status,
      aiDowngrades: result.ai.downgrades.length,
    },
  });

  return { ...result, action: plan.kind === 'create' ? 'created' : 'updated', alertId };
}
