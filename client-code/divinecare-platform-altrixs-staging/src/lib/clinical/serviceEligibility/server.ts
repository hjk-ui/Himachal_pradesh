/**
 * Service Eligibility Scanner — server helpers (prisma): per-client live evaluation with access
 * checks, fee-schedule / payer-fit decoration and program-lead routing.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { isCaseloadRole, isMedicalRole } from '@/types/roles';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { CLIENT_ROW_SELECT, loadCharts, scannedClient } from './load';
import { evaluateClient, type ClientChart } from './rules';
import { payerFit, type PayerFit } from './payerFit';
import { revenueEstimate, PROGRAM_REVENUE, type FeeRow } from './revenue';
import { decisionState } from './snapshot';
import { PROGRAMS, type ProgramKey, type ScannedClient } from './types';
import type { DecisionState, RevenueEstimate, ScannerRow } from './view';

export const SERVICE_SCANNER_PATH = '/dashboard/ehr/scanner';

export type Viewer = { organizationId: string; userId: string; role: Role | string };

/**
 * Caseload-scoped roles re-scan only their clients; everyone else re-scans the organization.
 * A verified Medical Director (pass the request's actor) is org-wide.
 */
export function scanScopeFor(
  role: Role | string,
  actor?: { userId: string; organizationId: string }
): 'organization' | 'caseload' {
  if (actor && verifiedMedicalDirector({ userId: actor.userId, role: String(role), organizationId: actor.organizationId })) {
    return 'organization';
  }
  const r = String(role).toUpperCase();
  return isCaseloadRole(r) || isMedicalRole(r) || r === 'PEER_SUPPORT' ? 'caseload' : 'organization';
}

export async function loadFees(organizationId: string): Promise<FeeRow[]> {
  const codes = [...new Set(Object.values(PROGRAM_REVENUE).flatMap((p) => p.codes))];
  return prisma.feeScheduleItem.findMany({
    where: { organizationId, active: true, OR: [{ code: { in: codes } }, { baseCpt: { in: codes } }] },
    select: { code: true, baseCpt: true, feeCents: true, selfPay: true, child: true, telehealth: true, insuranceBillable: true, active: true },
  });
}

export function decorate<T extends { payer: string | null; statuses: Record<ProgramKey, string> }>(row: T, fees: FeeRow[]) {
  const fit: Partial<Record<ProgramKey, PayerFit>> = {};
  const revenue: Partial<Record<ProgramKey, RevenueEstimate>> = {};
  for (const p of PROGRAMS) {
    const s = row.statuses[p];
    if (s === 'not_indicated' || s === 'enrolled') continue;
    fit[p] = payerFit(p, row.payer);
    revenue[p] = revenueEstimate(p, fees);
  }
  return { ...row, payerFit: fit, revenue };
}

export async function decorateRows(organizationId: string, rows: ScannerRow[]): Promise<ScannerRow[]> {
  if (!rows.length) return rows;
  const fees = await loadFees(organizationId);
  return rows.map((r) => decorate(r, fees));
}

export type ClientDetail = {
  client: ScannedClient;
  decisions: Partial<Record<ProgramKey, DecisionState>>;
  payerFit: Partial<Record<ProgramKey, PayerFit>>;
  revenue: Partial<Record<ProgramKey, RevenueEstimate>>;
  chart: ClientChart;
  evaluatedAt: string;
  names: string[];
};

export type DetailResult = { ok: true; detail: ClientDetail } | { ok: false; status: 403 | 404; reason: 'client_not_found' | 'sensitive_record' };

/**
 * Live evaluation of one client the viewer may open: org / caseload scope (clientAccessWhere),
 * active, and not a protected record locked for the viewer.
 */
export async function loadClientDetail(viewer: Viewer, clientId: string, now = new Date()): Promise<DetailResult> {
  const where = clientAccessWhere({ organizationId: viewer.organizationId, actorUserId: viewer.userId, actorRole: viewer.role as Role });
  const row = await prisma.client.findFirst({
    where: { AND: [where, { id: clientId }, { status: 'ACTIVE' }] },
    select: { ...CLIENT_ROW_SELECT, legalFirstName: true, legalLastName: true, preferredName: true },
  });
  if (!row) return { ok: false, status: 404, reason: 'client_not_found' };
  const locked = await lockedSensitiveClientIds({ organizationId: viewer.organizationId, userId: viewer.userId, role: viewer.role, clientIds: [row.id] });
  if (locked.has(row.id)) return { ok: false, status: 403, reason: 'sensitive_record' };
  const timeZone = await getPracticeTimeZone(viewer.organizationId);
  const [chart] = await loadCharts(prisma, viewer.organizationId, [row], now, timeZone);
  const results = evaluateClient(chart, now);
  const client = scannedClient(row, chart, results, now);
  const [decisions, fees] = await Promise.all([
    prisma.serviceEligibilityDecision.findMany({
      where: { organizationId: viewer.organizationId, clientId: row.id },
      select: { clientId: true, program: true, action: true, reason: true, reasonNote: true, snoozeUntil: true, outcome: true, decidedAt: true, decidedById: true },
    }),
    loadFees(viewer.organizationId),
  ]);
  const dec: Partial<Record<ProgramKey, DecisionState>> = {};
  for (const d of decisions) if ((PROGRAMS as readonly string[]).includes(d.program)) dec[d.program as ProgramKey] = decisionState(d);
  const statuses = Object.fromEntries(PROGRAMS.map((p) => [p, results[p].status])) as Record<ProgramKey, string>;
  const decorated = decorate({ payer: client.payer, statuses }, fees);
  return {
    ok: true,
    detail: {
      client,
      decisions: dec,
      payerFit: decorated.payerFit,
      revenue: decorated.revenue,
      chart,
      evaluatedAt: now.toISOString(),
      names: [row.name, row.legalFirstName, row.legalLastName, row.preferredName].filter((n): n is string => Boolean(n)),
    },
  };
}

/** A client the viewer may act on in the scanner (scope + active + Part 2 lock). */
export async function scannerClient(
  viewer: Viewer,
  clientId: string
): Promise<{ ok: true; client: { id: string; name: string; assignedToId: string | null } } | { ok: false; status: 403 | 404; reason: 'client_not_found' | 'sensitive_record' }> {
  const where = clientAccessWhere({ organizationId: viewer.organizationId, actorUserId: viewer.userId, actorRole: viewer.role as Role });
  const client = await prisma.client.findFirst({
    where: { AND: [where, { id: clientId }, { status: 'ACTIVE' }] },
    select: { id: true, name: true, assignedToId: true },
  });
  if (!client) return { ok: false, status: 404, reason: 'client_not_found' };
  const locked = await lockedSensitiveClientIds({ organizationId: viewer.organizationId, userId: viewer.userId, role: viewer.role, clientIds: [client.id] });
  if (locked.has(client.id)) return { ok: false, status: 403, reason: 'sensitive_record' };
  return { ok: true, client };
}

/** Program lead configured for the organization (active staff of the same org), or null. */
export async function resolveProgramLead(organizationId: string, program: ProgramKey): Promise<{ userId: string; name: string | null } | null> {
  const lead = await prisma.serviceEligibilityProgramLead.findUnique({
    where: { organizationId_program: { organizationId, program } },
    select: { leadUserId: true },
  });
  if (!lead) return null;
  const user = await prisma.user.findFirst({
    where: { id: lead.leadUserId, organizationId, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  return user ? { userId: user.id, name: user.name } : null;
}
