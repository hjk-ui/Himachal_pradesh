/**
 * AWS HealthLake (FHIR R4) configuration — read from env only, never invented.
 * Credentials use the shared chain in lib/aws/credentials: static keys when set,
 * otherwise the EC2 instance role when AWS_LIVE=true.
 */
import { awsRegion, hasAwsCredentials } from '@/lib/aws/credentials';

export const HEALTHLAKE_NOT_CONFIGURED = 'HEALTHLAKE_NOT_CONFIGURED';
export const HEALTHLAKE_NOT_CONFIGURED_MESSAGE = 'HealthLake is not connected — no data store configured';
export const HEALTHLAKE_IMPORT_NOT_CONFIGURED = 'HEALTHLAKE_IMPORT_NOT_CONFIGURED';
export const HEALTHLAKE_EXPORT_NOT_CONFIGURED = 'HEALTHLAKE_EXPORT_NOT_CONFIGURED';
export const HEALTHLAKE_SYNC_DISABLED = 'HEALTHLAKE_SYNC_DISABLED';

export type CredentialMode = 'static-keys' | 'instance-role' | 'none';

export type HealthLakeConfig = {
  /** Data store id + credentials present: the server can talk to HealthLake */
  configured: boolean;
  datastoreId: string | null;
  region: string;
  credentialMode: CredentialMode;
  /** env vars still needed for `configured` */
  missing: string[];
  import: {
    ready: boolean;
    s3Uri: string | null;
    outputS3Uri: string | null;
    kmsKeyArn: string | null;
    dataAccessRoleArn: string | null;
    missing: string[];
  };
  export: {
    ready: boolean;
    s3Uri: string | null;
    kmsKeyArn: string | null;
    dataAccessRoleArn: string | null;
    missing: string[];
  };
};

function env(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function withSlash(uri: string | null): string | null {
  if (!uri) return null;
  return uri.endsWith('/') ? uri : `${uri}/`;
}

export function credentialMode(): CredentialMode {
  if (hasAwsCredentials()) return 'static-keys';
  if (process.env.AWS_LIVE === 'true') return 'instance-role';
  return 'none';
}

const DATASTORE_ID_RE = /^[a-f0-9]{32}$/i;

export function healthLakeConfig(): HealthLakeConfig {
  const datastoreId = env('AWS_HEALTHLAKE_DATASTORE_ID');
  const mode = credentialMode();
  const missing: string[] = [];
  if (!datastoreId) missing.push('AWS_HEALTHLAKE_DATASTORE_ID');
  else if (!DATASTORE_ID_RE.test(datastoreId)) missing.push('AWS_HEALTHLAKE_DATASTORE_ID (must be the 32-character data store id)');
  if (mode === 'none') missing.push('AWS_LIVE=true (instance role) or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY');

  const roleArn = env('AWS_HEALTHLAKE_DATA_ACCESS_ROLE_ARN') || env('AWS_HEALTHLAKE_ROLE_ARN');
  const kms = env('AWS_HEALTHLAKE_KMS_KEY_ARN');
  const importUri = withSlash(env('AWS_HEALTHLAKE_IMPORT_S3_URI'));
  const importOut = withSlash(env('AWS_HEALTHLAKE_IMPORT_OUTPUT_S3_URI')) || (importUri ? `${importUri}job-output/` : null);
  const exportUri = withSlash(env('AWS_HEALTHLAKE_EXPORT_S3_URI'));

  const shared = [
    ...(roleArn ? [] : ['AWS_HEALTHLAKE_DATA_ACCESS_ROLE_ARN']),
    ...(kms ? [] : ['AWS_HEALTHLAKE_KMS_KEY_ARN']),
  ];
  const importMissing = [...missing, ...shared, ...(importUri ? [] : ['AWS_HEALTHLAKE_IMPORT_S3_URI'])];
  const exportMissing = [...missing, ...shared, ...(exportUri ? [] : ['AWS_HEALTHLAKE_EXPORT_S3_URI'])];

  return {
    configured: missing.length === 0,
    datastoreId,
    region: env('AWS_HEALTHLAKE_REGION') || awsRegion(),
    credentialMode: mode,
    missing,
    import: {
      ready: importMissing.length === 0,
      s3Uri: importUri,
      outputS3Uri: importOut,
      kmsKeyArn: kms,
      dataAccessRoleArn: roleArn,
      missing: importMissing,
    },
    export: {
      ready: exportMissing.length === 0,
      s3Uri: exportUri,
      kmsKeyArn: kms,
      dataAccessRoleArn: roleArn,
      missing: exportMissing,
    },
  };
}

export function fhirBaseUrl(cfg: Pick<HealthLakeConfig, 'region' | 'datastoreId'>): string {
  return `https://healthlake.${cfg.region}.amazonaws.com/datastore/${cfg.datastoreId}/r4`;
}

/** JSON body for routes when HealthLake is not connected (503). */
export function notConfiguredBody(cfg: HealthLakeConfig = healthLakeConfig()) {
  return {
    success: false as const,
    code: HEALTHLAKE_NOT_CONFIGURED,
    error: HEALTHLAKE_NOT_CONFIGURED_MESSAGE,
    connected: false,
    missing: cfg.missing,
  };
}

/** Steps shown on the status page and in docs/healthlake-setup.md. */
export const SETUP_STEPS = [
  'Owner approval: a HealthLake data store bills hourly while it exists (about $200/month at minimum).',
  'Create a customer-managed KMS key and the FHIR R4 data store (preload: none) — docs/healthlake-setup.md step 1-2.',
  'Attach the HealthLake policy to the EC2 instance role (read/write/search, import/export, describe) — step 3.',
  'Create the import/export data-access role with S3 + KMS permissions and the HealthLake trust policy — step 4.',
  'Set AWS_HEALTHLAKE_DATASTORE_ID (and AWS_LIVE=true on the instance-role server); for bulk load / export also AWS_HEALTHLAKE_DATA_ACCESS_ROLE_ARN, AWS_HEALTHLAKE_KMS_KEY_ARN, AWS_HEALTHLAKE_IMPORT_S3_URI, AWS_HEALTHLAKE_EXPORT_S3_URI — step 5.',
  'Turn on sync for the organization on this page (Part 2 sync stays off unless explicitly enabled).',
  'Optional: run the bulk initial load ($import), then add the cron line for scripts/healthlake-sync.ts — step 6.',
];
