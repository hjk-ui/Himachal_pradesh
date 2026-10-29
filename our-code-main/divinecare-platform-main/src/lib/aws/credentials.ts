/** Shared AWS credential helpers — never invent live success without env. */

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

export function healthLakeDatastoreId(): string | null {
  return process.env.AWS_HEALTHLAKE_DATASTORE_ID?.trim() || null;
}

export function personalizeCampaignArn(): string | null {
  return process.env.AWS_PERSONALIZE_CAMPAIGN_ARN?.trim() || null;
}

export function personalizeRankingArn(): string | null {
  return process.env.AWS_PERSONALIZE_RANKING_ARN?.trim() || null;
}
