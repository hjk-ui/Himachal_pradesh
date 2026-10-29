/**
 * AWS SDK v3 middleware that records every command a client sends in the integration call log:
 * command name, HTTP status, AWS request id, duration and the error name. It never reads the
 * request input or the response body (no PHI, no prompts, no transcripts).
 *
 *   textract ??= instrumentAwsClient(new TextractClient({ ... }), 'textract');
 */
import { recordIntegrationCall, isThrottleError, type IntegrationName } from './record';

type MiddlewareStackLike = {
  add: (middleware: (next: (args: unknown) => Promise<unknown>, context: { commandName?: string }) => (args: unknown) => Promise<unknown>, options: { step: 'initialize'; name: string; override?: boolean }) => void;
};

type AwsOutputLike = { output?: { $metadata?: { httpStatusCode?: number; requestId?: string } } };
type AwsErrorLike = { name?: string; $metadata?: { httpStatusCode?: number; requestId?: string } };

export function instrumentAwsClient<C extends { middlewareStack: unknown }>(
  client: C,
  integration: IntegrationName,
  opts: { skipCommands?: string[] } = {}
): C {
  const stack = client.middlewareStack as MiddlewareStackLike;
  stack.add(
    (next, context) => async (args) => {
      const command = context.commandName || 'unknown';
      if (opts.skipCommands?.includes(command)) return next(args);
      const startedAt = new Date();
      try {
        const res = (await next(args)) as AwsOutputLike;
        void recordIntegrationCall({
          integration,
          operation: command,
          status: 'success',
          startedAt,
          httpStatus: res?.output?.$metadata?.httpStatusCode ?? null,
          correlationId: res?.output?.$metadata?.requestId ?? null,
        });
        return res;
      } catch (err) {
        const e = (err || {}) as AwsErrorLike;
        void recordIntegrationCall({
          integration,
          operation: command,
          status: isThrottleError(err) ? 'throttled' : 'error',
          startedAt,
          httpStatus: e.$metadata?.httpStatusCode ?? null,
          correlationId: e.$metadata?.requestId ?? null,
          errorCode: e.name ?? null,
          errorMessage: err,
        });
        throw err;
      }
    },
    { step: 'initialize', name: 'altrixsIntegrationCallLog', override: true }
  );
  return client;
}
