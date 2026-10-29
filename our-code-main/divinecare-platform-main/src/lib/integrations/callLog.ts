import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type IntegrationId =
  | 'drfirst'
  | 'waystar'
  | 'availity'
  | 'sms'
  | 'email'
  | 'stripe'
  | 'homebase'
  | 'bedrock'
  | 'textract'
  | 'transcribe'
  | 'chime'
  | 'healthlake'
  | 'jobs';

export type IntegrationCallStatus = 'success' | 'error' | 'throttled' | 'skipped';

export const INTEGRATION_LABELS: Record<IntegrationId, string> = {
  drfirst: 'DrFirst Rcopia',
  waystar: 'Waystar (SFTP)',
  availity: 'Availity eligibility',
  sms: 'SMS (AWS)',
  email: 'Email (SES)',
  stripe: 'Stripe',
  homebase: 'Homebase',
  bedrock: 'Bedrock AI',
  textract: 'Textract OCR',
  transcribe: 'Transcribe',
  chime: 'Chime telehealth',
  healthlake: 'HealthLake FHIR',
  jobs: 'Scheduled jobs',
};

const NO_BODY_INTEGRATIONS = new Set<string>([
  'sms',
  'email',
  'bedrock',
  'textract',
  'transcribe',
  'chime',
  'healthlake',
]);

const BODY_KEYS = /body|payload|request|response|xml|raw|content|mac|password|secret|token/i;

export function redactMetadata(
  integration: string,
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (NO_BODY_INTEGRATIONS.has(integration) && BODY_KEYS.test(k)) continue;
    if (BODY_KEYS.test(k) && typeof v === 'string' && v.length > 80) {
      out[k] = '[redacted]';
      continue;
    }
    if (k.toLowerCase().includes('mac') || k.toLowerCase().includes('password')) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function maskMrn(mrn?: string | null): string | undefined {
  if (!mrn) return undefined;
  const s = String(mrn);
  if (s.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

export type RecordIntegrationCallInput = {
  organizationId: string;
  integration: IntegrationId | string;
  operation: string;
  status: IntegrationCallStatus;
  httpStatus?: number | null;
  durationMs?: number | null;
  userId?: string | null;
  clientId?: string | null;
  mrn?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Never throws — soft no-op if table missing or DB error. */
export async function recordIntegrationCall(input: RecordIntegrationCallInput): Promise<void> {
  try {
    // Soft write — invalid org / missing table must never surface to callers.
    await prisma.integrationCallLog
      .create({
        data: {
          organizationId: input.organizationId,
          integration: input.integration,
          operation: input.operation,
          status: input.status,
          httpStatus: input.httpStatus ?? null,
          durationMs: input.durationMs ?? null,
          userId: input.userId ?? null,
          clientId: input.clientId ?? null,
          mrnMasked: maskMrn(input.mrn) ?? null,
          error: input.error ? String(input.error).slice(0, 500) : null,
          metadata: (redactMetadata(input.integration, input.metadata) ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      })
      .catch(() => undefined);
  } catch {
    // never throw into vendor calls
  }
}

export async function withIntegrationCall<T>(
  input: Omit<RecordIntegrationCallInput, 'status' | 'durationMs' | 'error' | 'httpStatus'> & {
    status?: IntegrationCallStatus;
  },
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await recordIntegrationCall({
      ...input,
      status: input.status || 'success',
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    await recordIntegrationCall({
      ...input,
      status: 'error',
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function integrationHealthFromCounts(ok: number, err: number, total: number) {
  if (total === 0) return 'No calls (1h)' as const;
  if (err === 0) return 'OK' as const;
  if (err / Math.max(total, 1) >= 0.5) return 'Failing' as const;
  return 'Degraded' as const;
}

export const INTEGRATION_LOGS_FORBIDDEN =
  'Only Admin / Practice Director can view integration logs';
