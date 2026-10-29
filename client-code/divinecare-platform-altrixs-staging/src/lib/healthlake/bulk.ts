/**
 * Bulk initial load (HealthLake StartFHIRImportJob over NDJSON we write to S3) and
 * whole-store export, plus job status refresh. Behind config: see healthLakeConfig().import / .export.
 * S3 objects are written with SSE-KMS using AWS_HEALTHLAKE_KMS_KEY_ARN.
 */
import { awsClientConfig } from '@/lib/aws/clientConfig';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { resolveAwsCredentials } from '@/lib/aws/credentials';
import { toNdjsonByType } from '@/lib/fhir/mapping/build';
import type { HealthLakeTransport } from './client';
import type { HealthLakeConfig } from './config';
import { outboxKey } from './outbox';
import { persistUpdates, scanOrganization } from './sync';

export type PutObject = (input: { bucket: string; key: string; body: string; kmsKeyArn: string }) => Promise<void>;

export function parseS3Uri(uri: string): { bucket: string; prefix: string } | null {
  const m = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/?(.*)$/.exec(uri.trim());
  if (!m) return null;
  return { bucket: m[1]!, prefix: m[2] ?? '' };
}

let s3Put: PutObject | null = null;

/** Default S3 writer (credentials from the shared chain). Loaded lazily so tests never touch AWS. */
export async function defaultPutObject(region: string): Promise<PutObject> {
  if (s3Put) return s3Put;
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    ...awsClientConfig(),
    region,
    credentials: async () => {
      const c = await resolveAwsCredentials();
      if (!c) throw new Error('AWS credentials unavailable');
      return { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken };
    },
  });
  s3Put = async ({ bucket, key, body, kmsKeyArn }) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/fhir+ndjson',
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: kmsKeyArn,
      })
    );
  };
  return s3Put;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

type JobOut = { ok: true; jobId: string; awsJobId: string | null; resourceCount: number } | { ok: false; status: number; error: string };

/**
 * Prepare NDJSON for every resource of this org still waiting for its first write (PENDING upserts),
 * write it under AWS_HEALTHLAKE_IMPORT_S3_URI/<org>/<stamp>/, and start a HealthLake import job.
 * Those outbox rows become IMPORTING until the job finishes (refreshJobs()).
 */
export async function startBulkImport(input: {
  db: PrismaClient;
  cfg: HealthLakeConfig;
  transport: Pick<HealthLakeTransport, 'startImport'>;
  organizationId: string;
  actorUserId: string;
  actorRole?: string | null;
  putObject?: PutObject;
  now?: Date;
}): Promise<JobOut> {
  const { db, cfg, organizationId } = input;
  const now = input.now ?? new Date();
  const imp = cfg.import;
  if (!imp.ready || !imp.s3Uri || !imp.outputS3Uri || !imp.kmsKeyArn || !imp.dataAccessRoleArn) {
    return { ok: false, status: 503, error: `Bulk import is not configured: set ${imp.missing.join(', ')}` };
  }
  const target = parseS3Uri(imp.s3Uri);
  if (!target) return { ok: false, status: 503, error: 'AWS_HEALTHLAKE_IMPORT_S3_URI must look like s3://bucket/prefix/' };

  const scan = await scanOrganization(db, organizationId);
  if (!scan) return { ok: false, status: 404, error: 'Organization not found' };
  const rows = scan.rows.filter((r) => r.operation === 'UPSERT' && r.status === 'PENDING' && scan.resources.has(outboxKey(r.resourceType, r.resourceId)));
  if (!rows.length) return { ok: false, status: 409, error: 'Nothing to import: every resource is already synced or in progress' };

  const resources = rows.map((r) => scan.resources.get(outboxKey(r.resourceType, r.resourceId))!);
  const files = toNdjsonByType(resources);
  const folder = `${target.prefix}${organizationId}/${stamp(now)}/`;
  const put = input.putObject ?? (await defaultPutObject(cfg.region));
  for (const [type, body] of files) {
    await put({ bucket: target.bucket, key: `${folder}${type}.ndjson`, body, kmsKeyArn: imp.kmsKeyArn });
  }

  const jobName = `altrixs-import-${stamp(now)}`.slice(0, 64);
  const res = await input.transport.startImport({
    jobName,
    inputS3Uri: `s3://${target.bucket}/${folder}`,
    outputS3Uri: `${imp.outputS3Uri}${organizationId}/${stamp(now)}/`,
    kmsKeyArn: imp.kmsKeyArn,
    dataAccessRoleArn: imp.dataAccessRoleArn,
    clientToken: randomUUID(),
  });
  const byType = Object.fromEntries([...files.keys()].map((t) => [t, resources.filter((r) => r.resourceType === t).length]));
  if (res.ok === false) {
    await writeAuditLog({
      action: 'HEALTHLAKE_IMPORT_START', actorUserId: input.actorUserId, actorRole: input.actorRole ?? null, organizationId,
      resourceType: 'HealthLakeJob', outcome: 'FAILURE', metadata: { resourceCount: resources.length, status: res.status },
    });
    return { ok: false, status: 502, error: `HealthLake import failed: ${res.error}` };
  }
  const job = await db.healthLakeJob.create({
    data: {
      organizationId,
      jobType: 'import',
      jobName,
      s3Uri: `s3://${target.bucket}/${folder}`,
      status: res.data.JobStatus || 'SUBMITTED',
      awsJobId: res.data.JobId ?? null,
      demoMode: false,
      createdById: input.actorUserId,
      detailJson: { source: 'aws', resourceCount: resources.length, byType },
    },
  });
  await persistUpdates(db, rows.map((r) => ({ id: r.id, data: { status: 'IMPORTING', importJobId: job.id } })));
  await writeAuditLog({
    action: 'HEALTHLAKE_IMPORT_START', actorUserId: input.actorUserId, actorRole: input.actorRole ?? null, organizationId,
    resourceType: 'HealthLakeJob', resourceId: job.id, metadata: { resourceCount: resources.length, byType, awsJobId: job.awsJobId },
  });
  return { ok: true, jobId: job.id, awsJobId: job.awsJobId, resourceCount: resources.length };
}

/**
 * Whole data store export to AWS_HEALTHLAKE_EXPORT_S3_URI. HealthLake export cannot filter by
 * organization, so it is refused when the data store holds any other organization's resources.
 */
export async function startStoreExport(input: {
  db: PrismaClient;
  cfg: HealthLakeConfig;
  transport: Pick<HealthLakeTransport, 'startExport'>;
  organizationId: string;
  actorUserId: string;
  actorRole?: string | null;
  now?: Date;
}): Promise<JobOut> {
  const { db, cfg, organizationId } = input;
  const now = input.now ?? new Date();
  const exp = cfg.export;
  if (!exp.ready || !exp.s3Uri || !exp.kmsKeyArn || !exp.dataAccessRoleArn) {
    return { ok: false, status: 503, error: `Export is not configured: set ${exp.missing.join(', ')}` };
  }
  const otherOrgs = await db.fhirSyncState.count({
    where: { organizationId: { not: organizationId }, status: { in: ['SYNCED', 'IMPORTING', 'ERROR', 'DEAD'] } },
  });
  if (otherOrgs > 0) {
    return { ok: false, status: 409, error: 'The data store also holds other organizations’ resources; a whole-store export would cross tenants.' };
  }
  const jobName = `altrixs-export-${stamp(now)}`.slice(0, 64);
  const outputS3Uri = `${exp.s3Uri}${organizationId}/${stamp(now)}/`;
  const res = await input.transport.startExport({
    jobName,
    outputS3Uri,
    kmsKeyArn: exp.kmsKeyArn,
    dataAccessRoleArn: exp.dataAccessRoleArn,
    clientToken: randomUUID(),
  });
  if (res.ok === false) {
    await writeAuditLog({
      action: 'HEALTHLAKE_EXPORT_START', actorUserId: input.actorUserId, actorRole: input.actorRole ?? null, organizationId,
      resourceType: 'HealthLakeJob', outcome: 'FAILURE', metadata: { status: res.status },
    });
    return { ok: false, status: 502, error: `HealthLake export failed: ${res.error}` };
  }
  const job = await db.healthLakeJob.create({
    data: {
      organizationId,
      jobType: 'export',
      jobName,
      s3Uri: outputS3Uri,
      status: res.data.JobStatus || 'SUBMITTED',
      awsJobId: res.data.JobId ?? null,
      demoMode: false,
      createdById: input.actorUserId,
      detailJson: { source: 'aws' },
    },
  });
  await writeAuditLog({
    action: 'HEALTHLAKE_EXPORT_START', actorUserId: input.actorUserId, actorRole: input.actorRole ?? null, organizationId,
    resourceType: 'HealthLakeJob', resourceId: job.id, metadata: { awsJobId: job.awsJobId },
  });
  return { ok: true, jobId: job.id, awsJobId: job.awsJobId, resourceCount: 0 };
}

const OPEN_STATUSES = ['SUBMITTED', 'QUEUED', 'IN_PROGRESS', 'CANCEL_SUBMITTED', 'CANCEL_IN_PROGRESS'];
const DONE_OK = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS']);
const DONE_FAIL = new Set(['FAILED', 'CANCEL_COMPLETED', 'CANCEL_FAILED']);

/** Poll open live jobs; when an import finishes, its IMPORTING outbox rows become SYNCED (or PENDING again). */
export async function refreshJobs(db: PrismaClient, organizationId: string, transport: Pick<HealthLakeTransport, 'describeImport' | 'describeExport'>, now = new Date()) {
  const open = await db.healthLakeJob.findMany({
    where: { organizationId, demoMode: false, awsJobId: { not: null }, status: { in: OPEN_STATUSES } },
    take: 10,
  });
  for (const job of open) {
    const res =
      job.jobType === 'import' ? await transport.describeImport(job.awsJobId!) : await transport.describeExport(job.awsJobId!);
    if (res.ok === false) continue;
    const props =
      'ImportJobProperties' in res.data ? res.data.ImportJobProperties : (res.data as { ExportJobProperties?: { JobStatus?: string } }).ExportJobProperties;
    const status = props?.JobStatus;
    if (!status || status === job.status) continue;
    await db.healthLakeJob.update({ where: { id: job.id }, data: { status } });
    if (job.jobType !== 'import') continue;
    if (DONE_OK.has(status)) {
      // COMPLETED_WITH_ERRORS: the worker re-PUTs every row (idempotent) so failed lines are not lost.
      if (status === 'COMPLETED') {
        const rows = await db.fhirSyncState.findMany({ where: { organizationId, importJobId: job.id, status: 'IMPORTING' }, select: { id: true, hash: true } });
        await persistUpdates(db, rows.map((r) => ({ id: r.id, data: { status: 'SYNCED', syncedHash: r.hash, lastSyncedAt: now, importJobId: null } })));
      } else {
        await db.fhirSyncState.updateMany({ where: { organizationId, importJobId: job.id, status: 'IMPORTING' }, data: { status: 'PENDING', importJobId: null } });
      }
    } else if (DONE_FAIL.has(status)) {
      await db.fhirSyncState.updateMany({ where: { organizationId, importJobId: job.id, status: 'IMPORTING' }, data: { status: 'PENDING', importJobId: null } });
    }
  }
}
