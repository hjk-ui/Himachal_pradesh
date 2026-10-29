/**
 * Unified, append-only integration call log (table integration_call_logs).
 *
 * recordIntegrationCall() is called at each integration's call boundary (DrFirst, Waystar,
 * Availity, SMS, email, Stripe, Homebase, Bedrock, Textract, Transcribe, Chime, HealthLake,
 * cron jobs). It stores METADATA only: operation, outcome, HTTP / vendor status, sanitized error,
 * timing, correlation id, actor, patient (client) id and a reference to the integration's own
 * record (sourceTable / sourceId). Request / response bodies are never stored here; the only
 * bodies in the system are DrFirst's (drfirst_api_logs, encrypted, 90 days), reached through
 * sourceTable = 'drfirst_api_logs'.
 *
 * Never throws: a log failure must not fail the call being logged. Without DATABASE_URL (unit
 * tests, standalone scripts) it is a no-op unless a writer is injected with setIntegrationLogWriter.
 *
 * Retention: metadata 1 year (INTEGRATION_LOG_METADATA_RETENTION_DAYS), DrFirst payload bodies
 * 90 days (DRFIRST_LOG_RETENTION_DAYS); see scripts/integration-logs-purge.ts.
 */
import { randomUUID } from 'node:crypto';
import { isSecretKey, redactSecrets, redactValue, sanitizeErrorMessage, REDACTED } from './redact';
import { CALL_STATUSES, CALL_DIRECTIONS, type IntegrationName, type CallStatus, type CallDirection } from './constants';

export { INTEGRATIONS, INTEGRATION_LABELS, CALL_STATUSES, CALL_DIRECTIONS } from './constants';
export type { IntegrationName, CallStatus, CallDirection } from './constants';

/**
 * Integrations whose content is PHI or model text: metadata may carry counts, ids, template ids
 * and delivery status only. Keys that could hold a body, a prompt, an output or an address are dropped.
 */
export const NO_BODY_INTEGRATIONS: ReadonlySet<IntegrationName> = new Set([
  'sms',
  'email',
  'bedrock',
  'textract',
  'transcribe',
  'chime',
  'healthlake',
] as IntegrationName[]);

const BODY_KEY_RE =
  /^(?:body|text|html|message|messages|content|contents|prompt|userprompt|system|output|reply|completion|response|request|payload|transcript|subject|to|cc|bcc|from|replyto|phone|phonenumber|destination|destinationphonenumber|email|address|recipient|recipients|document|bytes|query|source)$/i;

export interface IntegrationCallInput {
  integration: IntegrationName;
  /** Short operation name, e.g. send_patient, sftp_upload, send_sms, invoke_model */
  operation: string;
  direction?: CallDirection;
  status: CallStatus;
  organizationId?: string | null;
  httpStatus?: number | null;
  /** Vendor's own status / code (e.g. Rcopia status, transfer status, Stripe event outcome) */
  vendorStatus?: string | null;
  errorCode?: string | null;
  /** Free text; secrets, emails and phone numbers are removed before it is stored */
  errorMessage?: unknown;
  durationMs?: number | null;
  startedAt?: Date;
  finishedAt?: Date;
  correlationId?: string | null;
  actorUserId?: string | null;
  /** Patient (Client.id) when the call was about one patient */
  clientId?: string | null;
  /** Where the integration keeps its own record of this call (e.g. drfirst_api_logs + id) */
  sourceTable?: string | null;
  sourceId?: string | null;
  /** Small, non-PHI facts (counts, file names, template ids, model id, token counts) */
  metadata?: Record<string, unknown> | null;
}

export interface IntegrationCallRow {
  id: string;
  createdAt: Date;
  startedAt: Date;
  finishedAt: Date;
  organizationId: string | null;
  integration: IntegrationName;
  operation: string;
  direction: CallDirection;
  status: CallStatus;
  httpStatus: number | null;
  vendorStatus: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  correlationId: string | null;
  actorUserId: string | null;
  clientId: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown> | null;
}

const clip = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);

/** Operation names: lower snake case, no ids, at most 80 characters. */
export function normalizeOperation(op: string): string {
  return (
    String(op || 'unknown')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/Command$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9:/._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'unknown'
  );
}

/** Metadata safe to store: secrets redacted; for no-body integrations, body-like keys dropped; <= 4 KB. */
export function sanitizeMetadata(integration: IntegrationName, metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const strict = NO_BODY_INTEGRATIONS.has(integration);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v === undefined) continue;
    if (strict && BODY_KEY_RE.test(k.replace(/[-_]/g, ''))) continue;
    out[k] = isSecretKey(k) ? REDACTED : redactValue(v);
  }
  let json = JSON.stringify(out);
  if (json.length > 4096) {
    for (const k of Object.keys(out).reverse()) {
      delete out[k];
      out._truncated = true;
      json = JSON.stringify(out);
      if (json.length <= 4096) break;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** The row recordIntegrationCall stores (pure; exported for tests). */
export function buildIntegrationCallRow(input: IntegrationCallInput, now = new Date()): IntegrationCallRow {
  const finishedAt = input.finishedAt ?? now;
  const durationMs =
    typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
      ? Math.max(0, Math.round(input.durationMs))
      : input.startedAt
        ? Math.max(0, finishedAt.getTime() - input.startedAt.getTime())
        : null;
  const startedAt = input.startedAt ?? new Date(finishedAt.getTime() - (durationMs ?? 0));
  const status: CallStatus = (CALL_STATUSES as readonly string[]).includes(input.status) ? input.status : 'error';
  const direction: CallDirection = input.direction && (CALL_DIRECTIONS as readonly string[]).includes(input.direction) ? input.direction : 'outbound';
  return {
    id: randomUUID(),
    createdAt: now,
    startedAt,
    finishedAt,
    organizationId: input.organizationId ?? null,
    integration: input.integration,
    operation: normalizeOperation(input.operation),
    direction,
    status,
    httpStatus: typeof input.httpStatus === 'number' && Number.isFinite(input.httpStatus) ? Math.trunc(input.httpStatus) : null,
    vendorStatus: clip(input.vendorStatus ? redactSecrets(String(input.vendorStatus)) : null, 80),
    errorCode: clip(input.errorCode ? redactSecrets(String(input.errorCode)) : null, 80),
    errorMessage: status === 'success' && !input.errorMessage ? null : sanitizeErrorMessage(input.errorMessage),
    durationMs,
    correlationId: clip(input.correlationId ? redactSecrets(String(input.correlationId)) : null, 120),
    actorUserId: clip(input.actorUserId, 64),
    clientId: clip(input.clientId, 64),
    sourceTable: clip(input.sourceTable, 64),
    sourceId: clip(input.sourceId, 120),
    metadata: sanitizeMetadata(input.integration, input.metadata),
  };
}

export type IntegrationLogWriter = (row: IntegrationCallRow) => Promise<void>;
let injectedWriter: IntegrationLogWriter | null = null;

/** Tests / scripts: capture rows instead of writing them (null restores the database writer). */
export function setIntegrationLogWriter(writer: IntegrationLogWriter | null) {
  injectedWriter = writer;
}

async function prismaWriter(row: IntegrationCallRow): Promise<void> {
  const { prisma } = await import('@/lib/db/prisma');
  await prisma.integrationCallLog.create({
    data: { ...row, metadata: (row.metadata ?? undefined) as never },
  });
}

/** Store one row. Never throws. Returns the row (or null when nothing was written). */
export async function recordIntegrationCall(input: IntegrationCallInput): Promise<IntegrationCallRow | null> {
  try {
    const writer = injectedWriter ?? (process.env.DATABASE_URL ? prismaWriter : null);
    if (!writer) return null;
    const row = buildIntegrationCallRow(input);
    await writer(row);
    return row;
  } catch (err) {
    console.error('[integration-log] write failed:', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

/** Times `fn` and records it: success when it resolves, error (rethrown) when it throws. */
export async function withIntegrationCall<T>(
  base: Omit<IntegrationCallInput, 'status' | 'durationMs' | 'startedAt' | 'finishedAt'>,
  fn: () => Promise<T>,
  describe?: (result: T) => Partial<IntegrationCallInput>
): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await fn();
    await recordIntegrationCall({ ...base, status: 'success', startedAt, ...(describe ? describe(result) : {}) });
    return result;
  } catch (err) {
    await recordIntegrationCall({
      ...base,
      status: isThrottleError(err) ? 'throttled' : 'error',
      startedAt,
      errorCode: errorCodeOf(err),
      errorMessage: err,
      httpStatus: httpStatusOf(err),
    });
    throw err;
  }
}

export function errorCodeOf(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; name?: unknown; Code?: unknown };
  const v = e.code ?? e.Code ?? e.name;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

export function httpStatusOf(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: unknown; statusCode?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const v = e.$metadata?.httpStatusCode ?? e.statusCode ?? e.status;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function isThrottleError(err: unknown): boolean {
  const code = errorCodeOf(err) || '';
  return httpStatusOf(err) === 429 || /throttl|toomanyrequests|ratelimit|rate_limit|slowdown/i.test(code);
}
