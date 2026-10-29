/**
 * Shared AWS SDK v3 client settings: bounded connect / request timeouts and 3 attempts, so a
 * hung AWS endpoint cannot hold a request (or a cron job) open indefinitely.
 *
 *   new S3Client({ region, ...awsClientConfig() })
 *   new BedrockRuntimeClient({ region, ...awsClientConfig({ requestTimeout: BEDROCK_REQUEST_TIMEOUT_MS }) })
 *
 * Spread it before client-specific options only when those options must win; credentials and
 * region are never set here.
 */
import { NodeHttpHandler } from '@smithy/node-http-handler';

export const AWS_CONNECTION_TIMEOUT_MS = 3_000;
export const AWS_REQUEST_TIMEOUT_MS = 30_000;
/** Model generation can take well over 30 s for long notes. */
export const BEDROCK_REQUEST_TIMEOUT_MS = 120_000;
export const AWS_MAX_ATTEMPTS = 3;

export type AwsClientConfig = {
  requestHandler: NodeHttpHandler;
  maxAttempts: number;
};

export function awsClientConfig(opts: { requestTimeout?: number; connectionTimeout?: number } = {}): AwsClientConfig {
  return {
    requestHandler: new NodeHttpHandler({
      connectionTimeout: opts.connectionTimeout ?? AWS_CONNECTION_TIMEOUT_MS,
      requestTimeout: opts.requestTimeout ?? AWS_REQUEST_TIMEOUT_MS,
    }),
    maxAttempts: AWS_MAX_ATTEMPTS,
  };
}

/** For BedrockRuntimeClient (InvokeModel): 120 s request timeout. */
export function bedrockClientConfig(): AwsClientConfig {
  return awsClientConfig({ requestTimeout: BEDROCK_REQUEST_TIMEOUT_MS });
}
