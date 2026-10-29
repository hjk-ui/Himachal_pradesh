/**
 * Report library server glue for the API routes: the page gate, the library listing for a role,
 * parameter options, and running a report with the real context builder + audit writer.
 */
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import type { AccessCapabilities } from '@/lib/auth/medicalDirector';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { loadOptions } from '@/lib/reports/outcomesReportsQueries';
import { reportsForRole } from './access';
import { buildReportContext } from './context';
import { executeReport, type ExecuteResult } from './execute';
import type { RawParams } from './params';
import { LIBRARY_LINKS, REPORTS, getReport, reportMeta, type ReportDefinition } from './registry';
import type { LibraryLink, ReportMeta, ReportOptions } from './types';

export const REPORT_LIBRARY_PATH = '/dashboard/reports';
export const REPORT_AUDIT_RESOURCE = 'reportLibrary';

export type LibraryGate = {
  organizationId: string;
  userId: string;
  role: string;
  capabilities?: AccessCapabilities | null;
};

export function canOpenLibrary(role: string | null | undefined, caps?: AccessCapabilities | null): boolean {
  return canAccessPath(role, REPORT_LIBRARY_PATH, caps);
}

export function libraryFor(role: string, caps?: AccessCapabilities | null): { reports: ReportMeta[]; links: LibraryLink[] } {
  return {
    reports: reportsForRole(REPORTS, role, caps).map(reportMeta),
    links: LIBRARY_LINKS.filter((l) => canAccessPath(role, l.gatePath, caps)),
  };
}

export async function reportOptions(organizationId: string): Promise<ReportOptions> {
  const [base, claimPayers, chartPayers] = await Promise.all([
    loadOptions(organizationId),
    prisma.claim.groupBy({ by: ['payer'], where: { organizationId, payer: { not: null } }, _count: { _all: true } }),
    prisma.client.groupBy({ by: ['insurancePayer'], where: { organizationId, status: 'ACTIVE', insurancePayer: { not: null } }, _count: { _all: true } }),
  ]);
  const payers = new Map<string, number>();
  for (const p of claimPayers) if (p.payer?.trim()) payers.set(p.payer.trim(), (payers.get(p.payer.trim()) ?? 0) + p._count._all);
  for (const p of chartPayers) if (p.insurancePayer?.trim()) payers.set(p.insurancePayer.trim(), (payers.get(p.insurancePayer.trim()) ?? 0) + p._count._all);
  return {
    sites: base.locations,
    providers: base.clinicians,
    payers: [...payers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([p]) => p).sort((a, b) => a.localeCompare(b)),
  };
}

export async function runLibraryReport(
  gate: LibraryGate,
  req: Request,
  def: ReportDefinition,
  raw: RawParams,
  mode: { kind: 'view' } | { kind: 'export'; format: string }
): Promise<ExecuteResult & { timeZone?: string }> {
  const now = new Date();
  const timeZone = await getPracticeTimeZone(gate.organizationId);
  const result = await executeReport(def, raw, mode, {
    viewer: gate,
    timeZone,
    now,
    buildContext: (params) => buildReportContext(gate, params, { now, timeZone }),
    audit: (e) =>
      auditPhiAccess({
        gate,
        req,
        action: e.action,
        resourceType: REPORT_AUDIT_RESOURCE,
        resourceId: e.resourceId,
        outcome: e.outcome,
        metadata: e.metadata,
      }),
  });
  return { ...result, timeZone };
}

export { getReport };
