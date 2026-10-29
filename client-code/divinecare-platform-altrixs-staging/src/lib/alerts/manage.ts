import type { Prisma, Role, RiskLevel } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { formatRelativeTime } from '@/lib/date/relativeTime';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';

const RISK_UI = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' } as const;
const RISK_DB = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' } as const;

export type AlertSeverity = 'high' | 'medium' | 'low';
export type AlertType = 'crisis_keywords' | 'low_mood' | 'high_stress';
export type AlertSource = 'check_in' | 'journal' | 'assessment';

export type AlertDto = {
  id: string;
  clientId: string;
  clientName: string;
  clinicianId: string | null;
  organizationId: string | null;
  type: string;
  source: string;
  sourceId: string | null;
  severity: AlertSeverity;
  description: string;
  reviewNote: string | null;
  mood: number;
  stress: number;
  createdAt: string;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewedById: string | null;
};

export type AlertSummary = {
  high: number;
  medium: number;
  low: number;
  totalUnreviewed: number;
  total: number;
};

type AlertRow = {
  id: string;
  clientId: string;
  clientName: string | null;
  clinicianId: string | null;
  organizationId: string | null;
  type: string;
  source: string;
  sourceId: string | null;
  description: string | null;
  severity: RiskLevel;
  mood: number | null;
  stress: number | null;
  reviewed: boolean;
  reviewNote: string | null;
  reviewedAt: Date | null;
  reviewedById: string | null;
  createdAt: Date;
  client: { name: string };
};

function normalizeType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('crisis')) return 'crisis_keywords';
  if (t.includes('mood')) return 'low_mood';
  if (t.includes('stress')) return 'high_stress';
  return type;
}

function legacyReviewNote(description: string | null): string | null {
  if (!description) return null;
  const parts = description.split('\n\nResponse: ');
  return parts.length > 1 ? parts.slice(1).join('\n\nResponse: ').trim() || null : null;
}

function cleanDescription(description: string | null): string {
  if (!description) return 'Flagged for clinical review.';
  return description.split('\n\nResponse: ')[0] || 'Flagged for clinical review.';
}

function serialize(row: AlertRow): AlertDto {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName?.trim() || row.client.name,
    clinicianId: row.clinicianId,
    organizationId: row.organizationId,
    type: normalizeType(row.type),
    source: row.source || 'check_in',
    sourceId: row.sourceId,
    severity: RISK_UI[row.severity],
    description: cleanDescription(row.description),
    reviewNote: row.reviewNote || legacyReviewNote(row.description),
    mood: row.mood ?? 5,
    stress: row.stress ?? 5,
    createdAt: row.createdAt.toISOString(),
    reviewed: row.reviewed,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedById: row.reviewedById,
  };
}

const alertInclude = { client: { select: { name: true } } } as const;

function alertAccessWhere(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Prisma.RiskAlertWhereInput {
  return {
    client: clientAccessWhere(input),
  };
}

export async function listRiskAlerts(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  unreviewed?: boolean | null;
}): Promise<AlertDto[]> {
  const rows = await prisma.riskAlert.findMany({
    where: {
      AND: [
        alertAccessWhere(input),
        input.unreviewed === true ? { reviewed: false } : {},
        input.unreviewed === false ? { reviewed: true } : {},
      ],
    },
    orderBy: [{ reviewed: 'asc' }, { severity: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    include: alertInclude,
  });
  return rows.map(serialize);
}

export async function summarizeRiskAlerts(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<AlertSummary> {
  const where = alertAccessWhere(input);
  const [total, totalUnreviewed, high, medium, low] = await Promise.all([
    prisma.riskAlert.count({ where }),
    prisma.riskAlert.count({ where: { AND: [where, { reviewed: false }] } }),
    prisma.riskAlert.count({
      where: { AND: [where, { reviewed: false, severity: 'HIGH' }] },
    }),
    prisma.riskAlert.count({
      where: { AND: [where, { reviewed: false, severity: 'MEDIUM' }] },
    }),
    prisma.riskAlert.count({
      where: { AND: [where, { reviewed: false, severity: 'LOW' }] },
    }),
  ]);
  return { high, medium, low, totalUnreviewed, total };
}

export async function reviewRiskAlert(input: {
  alertId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  note?: string | null;
}): Promise<{ ok: true; alert: AlertDto } | { ok: false; status: number; error: string }> {
  const existing = await prisma.riskAlert.findFirst({
    where: {
      id: input.alertId,
      AND: [alertAccessWhere(input)],
    },
    include: alertInclude,
  });

  if (!existing) {
    return { ok: false, status: 404, error: 'Alert not found' };
  }

  const note = input.note?.trim() || '';
  if (existing.severity === 'HIGH' && note.length < 8) {
    return {
      ok: false,
      status: 400,
      error: 'High-severity alerts require a documented response (at least 8 characters).',
    };
  }

  const updated = await prisma.riskAlert.update({
    where: { id: existing.id },
    data: {
      reviewed: true,
      reviewNote: note || null,
      reviewedAt: new Date(),
      reviewedById: input.actorUserId,
      // Keep description clean (strip any legacy embedded response)
      description: cleanDescription(existing.description),
    },
    include: alertInclude,
  });

  return { ok: true, alert: serialize(updated) };
}

export async function createRiskAlert(input: {
  organizationId: string;
  clientId: string;
  type: AlertType | string;
  severity: AlertSeverity;
  description: string;
  mood?: number | null;
  stress?: number | null;
  source?: AlertSource | string;
  sourceId?: string | null;
  clinicianId?: string | null;
  clientName?: string | null;
  reviewed?: boolean;
  reviewNote?: string | null;
  reviewedAt?: Date | null;
  reviewedById?: string | null;
}): Promise<{ ok: true; alert: AlertDto } | { ok: false; status: number; error: string }> {
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientOrgFilter(input.organizationId),
    },
    select: { id: true, name: true, assignedToId: true },
  });
  if (!client) {
    return { ok: false, status: 404, error: 'Client not found' };
  }

  const created = await prisma.riskAlert.create({
    data: {
      organizationId: input.organizationId,
      clientId: client.id,
      clientName: input.clientName?.trim() || client.name,
      clinicianId: input.clinicianId ?? client.assignedToId,
      type: normalizeType(input.type),
      severity: RISK_DB[input.severity],
      description: input.description,
      mood: input.mood ?? null,
      stress: input.stress ?? null,
      source: input.source || 'check_in',
      sourceId: input.sourceId ?? null,
      reviewed: input.reviewed ?? false,
      reviewNote: input.reviewNote ?? null,
      reviewedAt: input.reviewedAt ?? null,
      reviewedById: input.reviewedById ?? null,
    },
    include: alertInclude,
  });

  return { ok: true, alert: serialize(created) };
}

const CRISIS_RE =
  /\b(suicid|kill myself|end my life|want to die|self-harm|hurt myself|homicid|no point|give up|can't go on|cant go on|want to disappear|disappear)\b/i;

export async function maybeCreateCheckInAlert(input: {
  clientId: string;
  mood: number;
  stress: number;
  note: string | null;
}) {
  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: {
      id: true,
      name: true,
      assignedToId: true,
      location: { select: { organizationId: true } },
      assignedTo: { select: { organizationId: true } },
    },
  });
  if (!client) return;

  const organizationId =
    client.location?.organizationId || client.assignedTo?.organizationId || null;

  const crisis = Boolean(input.note && CRISIS_RE.test(input.note));
  let type: AlertType = 'low_mood';
  let severity: RiskLevel | null = null;
  let description = '';
  let source: AlertSource = 'check_in';

  if (crisis) {
    type = 'crisis_keywords';
    severity = 'HIGH';
    source = 'journal';
    description = `Crisis keywords detected in journal entry: "${input.note!.slice(0, 180)}"`;
  } else if (input.mood <= 3) {
    type = 'low_mood';
    severity = input.mood <= 2 ? 'HIGH' : 'MEDIUM';
    description = `Mood scored ${input.mood}/10 on check-in.`;
  } else if (input.stress >= 9) {
    type = 'high_stress';
    severity = 'MEDIUM';
    description = `Stress scored ${input.stress}/10 on check-in.`;
  }

  if (!severity) return;

  const since = new Date(Date.now() - 18 * 60 * 60 * 1000);
  const duplicate = await prisma.riskAlert.findFirst({
    where: {
      clientId: input.clientId,
      type,
      reviewed: false,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  if (duplicate) return;

  await prisma.riskAlert.create({
    data: {
      clientId: input.clientId,
      clientName: client.name,
      clinicianId: client.assignedToId,
      organizationId,
      type,
      description,
      severity,
      mood: input.mood,
      stress: input.stress,
      source,
      reviewed: false,
    },
  });
}

export function formatAlertTime(iso: string) {
  return formatRelativeTime(iso);
}
