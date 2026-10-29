/**
 * Report library run context (server). Built once per run from the signed-in viewer and the
 * validated parameters. Reuses the Outcomes report scope (resolveReportScope / reportClientWhere):
 *   - organization scope always;
 *   - caseload roles: only their assigned / care-team clients (clientAccessWhere);
 *     leadership and a database-verified Medical Director: the organization;
 *   - site filter = the client's home location; provider filter validated against the org;
 *   - 42 CFR Part 2 / protected clients the viewer cannot open are left out everywhere and counted.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  isCaseloadScope,
  reportClientWhere,
  valantReportWhere,
  type ReportFilters,
  type ReportScope,
} from '@/lib/reports/outcomesReports';
import { ReportFilterError, resolveReportScope } from '@/lib/reports/outcomesReportsQueries';
import { isMedicalRole } from '@/types/roles';
import { verifiedMedicalDirector, type AccessCapabilities } from '@/lib/auth/medicalDirector';
import type { ReportScopeKind, ResolvedParams } from './types';

export { ReportFilterError };

export type ReportViewer = {
  organizationId: string;
  userId: string;
  role: string;
  capabilities?: AccessCapabilities | null;
};

export type ReportContext = {
  organizationId: string;
  userId: string;
  role: string;
  now: Date;
  timeZone: string;
  scope: ReportScope;
  scopeKind: ReportScopeKind;
  siteLabel: string | null;
  providerLabel: string | null;
  /** Clients this viewer may report on (+ site filter; byAssignee adds the provider as assigned clinician) */
  clientWhere(opts?: { byAssignee?: boolean }): Prisma.ClientWhereInput;
  /**
   * For tables with a clientId column but no Client relation (Part 2 disclosures, SDOH screenings,
   * PRP attendance, crisis episodes...). null = organization-wide with nothing to exclude.
   */
  clientIdFilter(opts?: { byAssignee?: boolean }): Promise<{ in: string[] } | { notIn: string[] } | null>;
  /** Imported Valant transactions in a service-date range, same scope rules as the Outcomes report */
  valantWhere(range: { from: Date; toExclusive: Date }): Prisma.ValantTransactionWhereInput;
  /** Protected clients in scope that were left out (count only) */
  hiddenSensitiveClients(): Promise<number>;
};

export async function buildReportContext(
  viewer: ReportViewer,
  params: ResolvedParams,
  opts: { now: Date; timeZone: string }
): Promise<ReportContext> {
  const scope = await resolveReportScope(
    { organizationId: viewer.organizationId, userId: viewer.userId, role: viewer.role },
    { locationId: params.site, clinicianId: params.provider } as ReportFilters
  );
  const [site, provider] = await Promise.all([
    params.site ? prisma.location.findFirst({ where: { id: params.site, organizationId: viewer.organizationId }, select: { name: true } }) : null,
    params.provider ? prisma.user.findFirst({ where: { id: params.provider, organizationId: viewer.organizationId }, select: { name: true, email: true } }) : null,
  ]);
  const md = verifiedMedicalDirector({ userId: viewer.userId, role: viewer.role, organizationId: viewer.organizationId });
  const caseload = isCaseloadScope(scope) || (isMedicalRole(viewer.role) && !md);
  const idCache = new Map<string, Promise<{ in: string[] } | { notIn: string[] } | null>>();

  const ctx: ReportContext = {
    organizationId: viewer.organizationId,
    userId: viewer.userId,
    role: viewer.role,
    now: opts.now,
    timeZone: opts.timeZone,
    scope,
    scopeKind: caseload ? 'caseload' : 'organization',
    siteLabel: site?.name ?? null,
    providerLabel: provider ? provider.name || provider.email : null,
    clientWhere: (o = {}) => reportClientWhere(scope, { byAssignee: Boolean(o.byAssignee) }),
    clientIdFilter: (o = {}) => {
      const key = o.byAssignee ? 'a' : 'n';
      const hit = idCache.get(key);
      if (hit) return hit;
      const needList = caseload || Boolean(scope.locationId) || (Boolean(o.byAssignee) && Boolean(scope.clinicianId));
      const p = needList
        ? prisma.client
            .findMany({ where: reportClientWhere(scope, { byAssignee: Boolean(o.byAssignee) }), select: { id: true } })
            .then((rows) => ({ in: rows.map((r) => r.id) }))
        : Promise.resolve(scope.lockedClientIds.length ? { notIn: scope.lockedClientIds } : null);
      idCache.set(key, p);
      return p;
    },
    valantWhere: (range) => valantReportWhere(scope, range),
    hiddenSensitiveClients: async () => {
      if (!scope.lockedClientIds.length) return 0;
      return prisma.client.count({
        where: { AND: [reportClientWhere({ ...scope, lockedClientIds: [] }, { byAssignee: false }), { id: { in: scope.lockedClientIds } }] },
      });
    },
  };
  return ctx;
}

/** Prisma filter for a relation-less clientId column from ctx.clientIdFilter(). */
export function clientIdWhere(f: { in: string[] } | { notIn: string[] } | null): { clientId?: { in: string[] } | { notIn: string[] } } {
  if (!f) return {};
  return { clientId: f };
}
