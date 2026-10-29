/**
 * AWS HealthLake facade for the /api/healthlake routes. Never fabricates FHIR data or jobs:
 * when HealthLake is not configured, callers get HEALTHLAKE_NOT_CONFIGURED.
 */
import { prisma } from '@/lib/db/prisma';
import { createHealthLakeTransport, type HealthLakeTransport } from '@/lib/healthlake/client';
import {
  HEALTHLAKE_NOT_CONFIGURED,
  HEALTHLAKE_NOT_CONFIGURED_MESSAGE,
  SETUP_STEPS,
  healthLakeConfig,
  type HealthLakeConfig,
} from '@/lib/healthlake/config';
import { refreshJobs } from '@/lib/healthlake/bulk';
import { getSyncSettings } from '@/lib/healthlake/settings';
import { outboxOverview } from '@/lib/healthlake/sync';
import { buildScopedSearch, scopeBundle } from '@/lib/healthlake/search';
import {
  HEALTHLAKE_RESOURCE_TYPES,
  type HealthLakeResourceType,
  isValidResourceType,
} from './healthlakeTypes';

export { HEALTHLAKE_RESOURCE_TYPES, isValidResourceType, type HealthLakeResourceType };

export type HealthLakeStatus = {
  connected: boolean;
  code: string | null;
  message: string;
  config: {
    datastoreId: string | null;
    region: string;
    credentialMode: HealthLakeConfig['credentialMode'];
    missing: string[];
    importReady: boolean;
    importMissing: string[];
    exportReady: boolean;
    exportMissing: string[];
  };
  datastore: { status: string | null; name: string | null; fhirVersion: string | null; createdAt: string | null; error: string | null } | null;
  settings: Awaited<ReturnType<typeof getSyncSettings>>;
  outbox: Awaited<ReturnType<typeof outboxOverview>>;
  setupSteps: string[];
};

export async function getHealthLakeStatus(
  organizationId: string,
  deps: { cfg?: HealthLakeConfig; transport?: HealthLakeTransport | null } = {}
): Promise<HealthLakeStatus> {
  const cfg = deps.cfg ?? healthLakeConfig();
  const [settings, outbox] = await Promise.all([
    getSyncSettings(prisma, organizationId),
    outboxOverview(prisma, organizationId).catch((err) => {
      // FhirSyncState / FhirSyncRun missing until prisma/migrations/20261017_fhir_sync.sql is applied
      console.error('[healthlake] outbox overview failed:', err instanceof Error ? err.message : err);
      return { byStatus: {}, byType: {}, recentErrors: [], lastRun: null } as Awaited<ReturnType<typeof outboxOverview>>;
    }),
  ]);
  const config = {
    datastoreId: cfg.datastoreId,
    region: cfg.region,
    credentialMode: cfg.credentialMode,
    missing: cfg.missing,
    importReady: cfg.import.ready,
    importMissing: cfg.import.missing,
    exportReady: cfg.export.ready,
    exportMissing: cfg.export.missing,
  };
  const base = { config, settings, outbox, setupSteps: SETUP_STEPS };
  if (!cfg.configured) {
    return { connected: false, code: HEALTHLAKE_NOT_CONFIGURED, message: HEALTHLAKE_NOT_CONFIGURED_MESSAGE, datastore: null, ...base };
  }
  const transport = deps.transport !== undefined ? deps.transport : createHealthLakeTransport(cfg);
  const res = transport ? await transport.describeDatastore() : null;
  if (!res || res.ok === false) {
    const error = res && res.ok === false ? res.error : 'no transport';
    return {
      connected: false,
      code: 'HEALTHLAKE_UNREACHABLE',
      message: `HealthLake data store is configured but could not be reached: ${error}`,
      datastore: { status: null, name: null, fhirVersion: null, createdAt: null, error },
      ...base,
    };
  }
  const p = (res.data.DatastoreProperties ?? {}) as Record<string, unknown>;
  const created = p.CreatedAt;
  const status = typeof p.DatastoreStatus === 'string' ? p.DatastoreStatus : null;
  return {
    connected: status === 'ACTIVE',
    code: status === 'ACTIVE' ? null : 'HEALTHLAKE_NOT_ACTIVE',
    message: status === 'ACTIVE' ? 'Connected to HealthLake' : `HealthLake data store status is ${status ?? 'unknown'}`,
    datastore: {
      status,
      name: typeof p.DatastoreName === 'string' ? p.DatastoreName : null,
      fhirVersion: typeof p.DatastoreTypeVersion === 'string' ? p.DatastoreTypeVersion : null,
      createdAt:
        typeof created === 'number' ? new Date(created * 1000).toISOString() : typeof created === 'string' ? created : null,
      error: null,
    },
    ...base,
  };
}

export async function listHealthLakeJobs(organizationId: string, deps: { transport?: HealthLakeTransport | null } = {}) {
  const transport = deps.transport !== undefined ? deps.transport : createHealthLakeTransport();
  if (transport) {
    try {
      await refreshJobs(prisma, organizationId, transport);
    } catch (err) {
      console.error('[healthlake] job refresh failed:', err instanceof Error ? err.message : err);
    }
  }
  const jobs = await prisma.healthLakeJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return jobs.map((j) => ({
    id: j.id,
    jobType: j.jobType,
    jobName: j.jobName,
    s3Uri: j.s3Uri,
    status: j.status,
    awsJobId: j.awsJobId,
    /** Rows written by the old demo mode: no AWS job ever ran */
    demoMode: j.demoMode || (j.awsJobId ?? '').startsWith('demo-'),
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  }));
}

export type SearchOutcome =
  | { ok: true; bundle: unknown; count: number; dropped: number }
  | { ok: false; status: number; code: string; error: string };

/** Org-scoped FHIR search; the caller has already checked configuration and role. */
export async function searchFhirResources(input: {
  organizationId: string;
  resourceType: HealthLakeResourceType;
  query: URLSearchParams;
  transport: Pick<HealthLakeTransport, 'search'>;
  routePath: string;
}): Promise<SearchOutcome> {
  const scoped = buildScopedSearch(input.organizationId, input.query);
  if (scoped.ok === false) return { ok: false, status: 400, code: 'INVALID_SEARCH', error: scoped.error };
  const res = await input.transport.search(input.resourceType, scoped.params);
  if (res.ok === false) return { ok: false, status: 502, code: 'HEALTHLAKE_SEARCH_FAILED', error: res.error };
  const { bundle, dropped } = scopeBundle(res.bundle, input.organizationId, input.routePath);
  if (dropped) console.warn('[healthlake] search dropped entries without the caller org tag', { count: dropped });
  return { ok: true, bundle, count: bundle.entry?.length ?? 0, dropped };
}
