import { prisma } from '@/lib/db/prisma';
import {
  getAwsCredentials,
  hasAwsCredentials,
  healthLakeDatastoreId,
} from './credentials';
import { awsSignedFetch } from './sign';
import {
  HEALTHLAKE_RESOURCE_TYPES,
  type HealthLakeResourceType,
  isValidResourceType,
} from './healthlakeTypes';

export { HEALTHLAKE_RESOURCE_TYPES, isValidResourceType, type HealthLakeResourceType };

export type HealthLakeStatus = {
  demoMode: boolean;
  datastoreId: string | null;
  status: string;
  datastoreName: string;
  fhirVersion: string;
  resourceCounts: Record<string, number>;
};

function isDemoMode() {
  return !healthLakeDatastoreId();
}

export async function getHealthLakeStatus(organizationId: string): Promise<HealthLakeStatus> {
  const datastoreId = healthLakeDatastoreId();
  if (!datastoreId) {
    const clients = await prisma.client.count({ where: { organizationId } });
    const notes = await prisma.progressNote.count({
      where: { client: { organizationId } },
    });
    const appts = await prisma.appointment.count({ where: { organizationId } });
    return {
      demoMode: true,
      datastoreId: null,
      status: 'DEMO',
      datastoreName: 'Altrixs Demo FHIR R4 Store',
      fhirVersion: 'R4',
      resourceCounts: {
        Patient: clients,
        Encounter: appts,
        Condition: Math.max(0, Math.floor(clients * 1.4)),
        MedicationRequest: Math.max(0, Math.floor(clients * 0.8)),
        Observation: Math.max(0, Math.floor(notes * 1.2)),
        CarePlan: Math.max(0, Math.floor(clients * 0.6)),
        DocumentReference: notes,
        Practitioner: await prisma.user.count({ where: { organizationId } }),
      },
    };
  }

  if (!hasAwsCredentials()) {
    return {
      demoMode: false,
      datastoreId,
      status: 'UNCONFIGURED_CREDENTIALS',
      datastoreName: 'HealthLake datastore (credentials missing)',
      fhirVersion: 'R4',
      resourceCounts: Object.fromEntries(HEALTHLAKE_RESOURCE_TYPES.map((t) => [t, 0])),
    };
  }

  const creds = getAwsCredentials()!;
  const url = `https://healthlake.${creds.region}.amazonaws.com/datastore/${datastoreId}/r4/metadata`;
  const res = await awsSignedFetch({
    creds,
    service: 'healthlake',
    method: 'GET',
    url,
  });

  if (res.ok === false) {
    throw new Error(`HealthLake status failed: ${res.error}`);
  }

  let name = 'HealthLake datastore';
  try {
    const meta = JSON.parse(res.text) as { name?: string };
    if (meta.name) name = meta.name;
  } catch {
    /* metadata may be CapabilityStatement */
  }

  const resourceCounts: Record<string, number> = {};
  for (const type of HEALTHLAKE_RESOURCE_TYPES) {
    try {
      const bundle = await searchFhirResources(organizationId, type, 1);
      resourceCounts[type] = bundle.total;
    } catch {
      resourceCounts[type] = 0;
    }
  }

  return {
    demoMode: false,
    datastoreId,
    status: 'ACTIVE',
    datastoreName: name,
    fhirVersion: 'R4',
    resourceCounts,
  };
}

export async function listHealthLakeJobs(organizationId: string) {
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
    demoMode: j.demoMode,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  }));
}

export async function startHealthLakeImport(input: {
  organizationId: string;
  actorUserId: string;
  jobName: string;
  s3Uri: string;
}): Promise<{ ok: true; job: Awaited<ReturnType<typeof listHealthLakeJobs>>[0] } | { ok: false; status: number; error: string }> {
  const demo = isDemoMode();
  let awsJobId: string | null = null;
  let status = 'SUBMITTED';

  if (!demo) {
    if (!hasAwsCredentials()) {
      return {
        ok: false,
        status: 503,
        error:
          'AWS_HEALTHLAKE_DATASTORE_ID is set but AWS credentials are missing. Cannot start a live import.',
      };
    }
    const creds = getAwsCredentials()!;
    const datastoreId = healthLakeDatastoreId()!;
    const url = `https://healthlake.${creds.region}.amazonaws.com/datastore/${datastoreId}/r4/$import`;
    const res = await awsSignedFetch({
      creds,
      service: 'healthlake',
      method: 'POST',
      url,
      body: JSON.stringify({
        JobName: input.jobName,
        InputDataConfig: { S3Uri: input.s3Uri },
        DataAccessRoleArn:
          process.env.AWS_HEALTHLAKE_DATA_ACCESS_ROLE_ARN ||
          process.env.AWS_HEALTHLAKE_ROLE_ARN ||
          undefined,
      }),
      headers: { 'content-type': 'application/json' },
    });
    if (res.ok === false) {
      return { ok: false, status: res.status, error: `HealthLake import failed: ${res.error}` };
    }
    try {
      const parsed = JSON.parse(res.text) as { jobId?: string; JobId?: string };
      awsJobId = parsed.jobId || parsed.JobId || null;
    } catch {
      /* keep null */
    }
    status = 'IN_PROGRESS';
  } else {
    status = 'COMPLETED';
    awsJobId = `demo-import-${Date.now()}`;
  }

  const row = await prisma.healthLakeJob.create({
    data: {
      organizationId: input.organizationId,
      jobType: 'import',
      jobName: input.jobName,
      s3Uri: input.s3Uri,
      status,
      awsJobId,
      demoMode: demo,
      createdById: input.actorUserId,
      detailJson: { source: demo ? 'demo' : 'aws' },
    },
  });

  return {
    ok: true,
    job: {
      id: row.id,
      jobType: row.jobType,
      jobName: row.jobName,
      s3Uri: row.s3Uri,
      status: row.status,
      awsJobId: row.awsJobId,
      demoMode: row.demoMode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export async function startHealthLakeExport(input: {
  organizationId: string;
  actorUserId: string;
  jobName: string;
  s3Uri: string;
}): Promise<{ ok: true; job: Awaited<ReturnType<typeof listHealthLakeJobs>>[0] } | { ok: false; status: number; error: string }> {
  const demo = isDemoMode();
  let awsJobId: string | null = null;
  let status = 'SUBMITTED';

  if (!demo) {
    if (!hasAwsCredentials()) {
      return {
        ok: false,
        status: 503,
        error:
          'AWS_HEALTHLAKE_DATASTORE_ID is set but AWS credentials are missing. Cannot start a live export.',
      };
    }
    const creds = getAwsCredentials()!;
    const datastoreId = healthLakeDatastoreId()!;
    const url = `https://healthlake.${creds.region}.amazonaws.com/datastore/${datastoreId}/r4/$export`;
    const res = await awsSignedFetch({
      creds,
      service: 'healthlake',
      method: 'POST',
      url,
      body: JSON.stringify({
        JobName: input.jobName,
        OutputDataConfig: { S3Uri: input.s3Uri },
        DataAccessRoleArn:
          process.env.AWS_HEALTHLAKE_DATA_ACCESS_ROLE_ARN ||
          process.env.AWS_HEALTHLAKE_ROLE_ARN ||
          undefined,
      }),
      headers: { 'content-type': 'application/json' },
    });
    if (res.ok === false) {
      return { ok: false, status: res.status, error: `HealthLake export failed: ${res.error}` };
    }
    try {
      const parsed = JSON.parse(res.text) as { jobId?: string; JobId?: string };
      awsJobId = parsed.jobId || parsed.JobId || null;
    } catch {
      /* keep null */
    }
    status = 'IN_PROGRESS';
  } else {
    status = 'COMPLETED';
    awsJobId = `demo-export-${Date.now()}`;
  }

  const row = await prisma.healthLakeJob.create({
    data: {
      organizationId: input.organizationId,
      jobType: 'export',
      jobName: input.jobName,
      s3Uri: input.s3Uri,
      status,
      awsJobId,
      demoMode: demo,
      createdById: input.actorUserId,
      detailJson: { source: demo ? 'demo' : 'aws' },
    },
  });

  return {
    ok: true,
    job: {
      id: row.id,
      jobType: row.jobType,
      jobName: row.jobName,
      s3Uri: row.s3Uri,
      status: row.status,
      awsJobId: row.awsJobId,
      demoMode: row.demoMode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export async function searchFhirResources(
  organizationId: string,
  resourceType: HealthLakeResourceType,
  _limit = 20
): Promise<{ demoMode: boolean; total: number; entries: unknown[] }> {
  if (isDemoMode()) {
    const status = await getHealthLakeStatus(organizationId);
    const count = status.resourceCounts[resourceType] || 0;
    const entries = Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      resourceType,
      id: `demo-${resourceType.toLowerCase()}-${i + 1}`,
      meta: { source: 'demo' },
    }));
    return { demoMode: true, total: count, entries };
  }

  if (!hasAwsCredentials()) {
    throw new Error(
      'AWS_HEALTHLAKE_DATASTORE_ID is set but AWS credentials are missing. Cannot query FHIR.'
    );
  }

  const creds = getAwsCredentials()!;
  const datastoreId = healthLakeDatastoreId()!;
  const url = `https://healthlake.${creds.region}.amazonaws.com/datastore/${datastoreId}/r4/${resourceType}?_count=${_limit}`;
  const res = await awsSignedFetch({
    creds,
    service: 'healthlake',
    method: 'GET',
    url,
  });
  if (res.ok === false) {
    throw new Error(`FHIR search failed: ${res.error}`);
  }

  const bundle = JSON.parse(res.text) as {
    total?: number;
    entry?: Array<{ resource?: unknown }>;
  };
  return {
    demoMode: false,
    total: bundle.total ?? bundle.entry?.length ?? 0,
    entries: (bundle.entry || []).map((e) => e.resource).filter(Boolean),
  };
}
