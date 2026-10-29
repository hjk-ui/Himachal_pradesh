/** Shared AWS credential helpers — never invent live success without env. */
import { defaultProvider } from '@aws-sdk/credential-provider-node';

export type AwsCredentials = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export function awsRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    'us-east-1'
  );
}

export function hasAwsCredentials(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY
  );
}

export function getAwsCredentials(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  return {
    region: awsRegion(),
    accessKeyId,
    secretAccessKey,
    sessionToken: sessionToken || undefined,
  };
}

/**
 * Static keys, or AWS_LIVE=true on a server with an instance role. Only for services the
 * role is granted (Comprehend Medical on staging); the others stay on hasAwsCredentials().
 */
export function hasAwsRoleOrKeys(): boolean {
  return hasAwsCredentials() || process.env.AWS_LIVE === 'true';
}

let roleProvider: ReturnType<typeof defaultProvider> | null = null;

/** Static keys when set, otherwise temporary credentials from the default chain (instance role). */
export async function resolveAwsCredentials(): Promise<AwsCredentials | null> {
  const fromEnv = getAwsCredentials();
  if (fromEnv) return fromEnv;
  if (process.env.AWS_LIVE !== 'true') return null;
  roleProvider ??= defaultProvider();
  const c = await roleProvider();
  return {
    region: awsRegion(),
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    sessionToken: c.sessionToken,
  };
}

export function healthLakeDatastoreId(): string | null {
  return process.env.AWS_HEALTHLAKE_DATASTORE_ID?.trim() || null;
}

export function personalizeCampaignArn(): string | null {
  return process.env.AWS_PERSONALIZE_CAMPAIGN_ARN?.trim() || null;
}

export function personalizeRankingArn(): string | null {
  return process.env.AWS_PERSONALIZE_RANKING_ARN?.trim() || null;
}
