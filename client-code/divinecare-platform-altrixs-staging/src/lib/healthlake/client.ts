/**
 * HealthLake transport: FHIR REST data plane (PUT / DELETE / search) and the control-plane
 * JSON API (Describe / StartFHIRImportJob / StartFHIRExportJob). SigV4 with the shared
 * credential chain (static keys, or the instance role when AWS_LIVE=true).
 * createHealthLakeTransport() returns null when HealthLake is not configured — callers must
 * report "not connected" rather than inventing results.
 */
import { resolveAwsCredentials, type AwsCredentials } from '@/lib/aws/credentials';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';
import { awsJsonPost, awsSignedFetch } from '@/lib/aws/sign';
import { fhirBaseUrl, healthLakeConfig, type HealthLakeConfig } from './config';

export type OpResult =
  | { ok: true; status: number; versionId?: string | null }
  | { ok: false; status: number; error: string; retryable: boolean };

export type FhirBundle = {
  resourceType: 'Bundle';
  type?: string;
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<{ fullUrl?: string; resource?: { resourceType?: string; id?: string; meta?: { tag?: Array<{ system?: string; code?: string }> } } & Record<string, unknown>; search?: unknown }>;
};

export type ControlResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type HealthLakeTransport = {
  put(resource: { resourceType: string; id: string }): Promise<OpResult>;
  delete(resourceType: string, id: string): Promise<OpResult>;
  search(resourceType: string, params: URLSearchParams): Promise<{ ok: true; bundle: FhirBundle } | { ok: false; status: number; error: string }>;
  describeDatastore(): Promise<ControlResult<{ DatastoreProperties?: Record<string, unknown> }>>;
  startImport(input: {
    jobName: string;
    inputS3Uri: string;
    outputS3Uri: string;
    kmsKeyArn: string;
    dataAccessRoleArn: string;
    clientToken: string;
  }): Promise<ControlResult<{ JobId?: string; JobStatus?: string }>>;
  describeImport(jobId: string): Promise<ControlResult<{ ImportJobProperties?: { JobStatus?: string; Message?: string } }>>;
  startExport(input: {
    jobName: string;
    outputS3Uri: string;
    kmsKeyArn: string;
    dataAccessRoleArn: string;
    clientToken: string;
  }): Promise<ControlResult<{ JobId?: string; JobStatus?: string }>>;
  describeExport(jobId: string): Promise<ControlResult<{ ExportJobProperties?: { JobStatus?: string; Message?: string } }>>;
};

export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
}

/** HealthLake error text -> short message (OperationOutcome issue code + diagnostics, truncated). */
export function summarizeFhirError(status: number, body: string | undefined): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body || '') as {
      resourceType?: string;
      issue?: Array<{ code?: string; diagnostics?: string }>;
      message?: string;
      Message?: string;
    };
    if (parsed.resourceType === 'OperationOutcome' && parsed.issue?.length) {
      detail = parsed.issue
        .slice(0, 3)
        .map((i) => [i.code, i.diagnostics].filter(Boolean).join(': '))
        .join('; ');
    } else {
      detail = parsed.message || parsed.Message || '';
    }
  } catch {
    detail = (body || '').slice(0, 200);
  }
  return `HTTP ${status}${detail ? ` ${detail}` : ''}`.slice(0, 300);
}

function versionFrom(text: string, headers?: Headers): string | null {
  try {
    const v = (JSON.parse(text) as { meta?: { versionId?: string } }).meta?.versionId;
    if (v) return String(v);
  } catch {
    /* ignore */
  }
  const etag = headers?.get('etag');
  const m = etag?.match(/W\/"([^"]+)"/);
  return m?.[1] ?? null;
}

export function createHealthLakeTransport(
  cfg: HealthLakeConfig = healthLakeConfig(),
  deps: { credentials?: () => Promise<AwsCredentials | null>; fetchImpl?: typeof fetch } = {}
): HealthLakeTransport | null {
  if (!cfg.configured || !cfg.datastoreId) return null;
  const base = fhirBaseUrl(cfg);
  const host = `healthlake.${cfg.region}.amazonaws.com`;
  const getCreds = async (): Promise<AwsCredentials> => {
    const c = await (deps.credentials ?? resolveAwsCredentials)();
    if (!c) throw new Error('AWS credentials unavailable (set AWS_LIVE=true on the instance-role server, or static keys)');
    return { ...c, region: cfg.region };
  };

  const control = async <T>(target: string, body: Record<string, unknown>): Promise<ControlResult<T>> => {
    let creds: AwsCredentials;
    try {
      creds = await getCreds();
    } catch (err) {
      return { ok: false, status: 503, error: err instanceof Error ? err.message : 'credentials unavailable' };
    }
    const startedAt = new Date();
    const res = await awsJsonPost<T>({
      creds,
      service: 'healthlake',
      host,
      target: `HealthLake.${target}`,
      body,
      contentType: 'application/x-amz-json-1.0',
    });
    void recordIntegrationCall({
      integration: 'healthlake', operation: target, direction: 'outbound', startedAt,
      status: res.ok === false ? (res.status === 429 ? 'throttled' : 'error') : 'success',
      httpStatus: res.ok === false ? res.status : 200, errorMessage: res.ok === false ? res.error : null,
    });
    if (res.ok === false) return { ok: false, status: res.status, error: res.error.slice(0, 300) };
    return { ok: true, data: res.data };
  };

  const rest = async (method: 'GET' | 'PUT' | 'DELETE', path: string, body?: string) => {
    let creds: AwsCredentials;
    try {
      creds = await getCreds();
    } catch (err) {
      return { ok: false as const, status: 503, error: err instanceof Error ? err.message : 'credentials unavailable', text: '' };
    }
    const startedAt = new Date();
    const res = await awsSignedFetch({
      creds,
      service: 'healthlake',
      method,
      url: `${base}/${path}`,
      body,
      headers: body ? { 'content-type': 'application/fhir+json', accept: 'application/fhir+json' } : { accept: 'application/fhir+json' },
      fetchImpl: deps.fetchImpl,
    });
    // Integration log: method + FHIR resource type only (no ids, no search parameters, no bodies)
    if (!deps.fetchImpl) {
      void recordIntegrationCall({
        integration: 'healthlake', operation: `${method.toLowerCase()}_${path.split(/[/?]/)[0] || 'root'}`, direction: 'outbound', startedAt,
        status: res.ok === true || (method === 'DELETE' && (res.status === 404 || res.status === 410)) ? 'success' : res.status === 429 ? 'throttled' : 'error',
        httpStatus: res.status, errorMessage: res.ok === true ? null : summarizeFhirError(res.status, res.text || res.error),
      });
    }
    return res;
  };

  return {
    async put(resource) {
      const res = await rest('PUT', `${resource.resourceType}/${encodeURIComponent(resource.id)}`, JSON.stringify(resource));
      if (res.ok === true) return { ok: true, status: res.status, versionId: versionFrom(res.text, res.headers) };
      return { ok: false, status: res.status, error: summarizeFhirError(res.status, res.text || res.error), retryable: isRetryableStatus(res.status) };
    },
    async delete(resourceType, id) {
      const res = await rest('DELETE', `${resourceType}/${encodeURIComponent(id)}`);
      if (res.ok === true || res.status === 404 || res.status === 410) return { ok: true, status: res.status };
      return { ok: false, status: res.status, error: summarizeFhirError(res.status, res.text || res.error), retryable: isRetryableStatus(res.status) };
    },
    async search(resourceType, params) {
      const qs = params.toString();
      const res = await rest('GET', `${resourceType}${qs ? `?${qs}` : ''}`);
      if (res.ok === false) return { ok: false, status: res.status, error: summarizeFhirError(res.status, res.text || res.error) };
      try {
        const bundle = JSON.parse(res.text) as FhirBundle;
        if (bundle.resourceType !== 'Bundle') return { ok: false, status: 502, error: 'HealthLake search did not return a Bundle' };
        return { ok: true, bundle };
      } catch {
        return { ok: false, status: 502, error: 'HealthLake search returned invalid JSON' };
      }
    },
    describeDatastore() {
      return control('DescribeFHIRDatastore', { DatastoreId: cfg.datastoreId });
    },
    startImport(input) {
      return control('StartFHIRImportJob', {
        JobName: input.jobName,
        InputDataConfig: { S3Uri: input.inputS3Uri },
        JobOutputDataConfig: { S3Configuration: { S3Uri: input.outputS3Uri, KmsKeyId: input.kmsKeyArn } },
        DatastoreId: cfg.datastoreId,
        DataAccessRoleArn: input.dataAccessRoleArn,
        ClientToken: input.clientToken,
      });
    },
    describeImport(jobId) {
      return control('DescribeFHIRImportJob', { DatastoreId: cfg.datastoreId, JobId: jobId });
    },
    startExport(input) {
      return control('StartFHIRExportJob', {
        JobName: input.jobName,
        OutputDataConfig: { S3Configuration: { S3Uri: input.outputS3Uri, KmsKeyId: input.kmsKeyArn } },
        DatastoreId: cfg.datastoreId,
        DataAccessRoleArn: input.dataAccessRoleArn,
        ClientToken: input.clientToken,
      });
    },
    describeExport(jobId) {
      return control('DescribeFHIRExportJob', { DatastoreId: cfg.datastoreId, JobId: jobId });
    },
  };
}
