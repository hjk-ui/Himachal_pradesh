/**
 * Admin > Integrations > Logs: access rule, filters, health, retention and the detail / vendor
 * download (pure helpers + a dependency-injected detail loader so the audit rules are testable).
 *
 * Access: ADMIN and PRACTICE_DIRECTOR only (same rule as the HIPAA audit log, requireFullAdmin).
 * Billing / HR / front desk never see this page: no existing billing rule grants access to
 * clearinghouse call logs, so Waystar rows stay admin-only too.
 */
import { INTEGRATIONS, CALL_STATUSES, INTEGRATION_LABELS, type IntegrationName, type CallStatus } from './record';
import { maskPatientIdentifiers, prettyPrintXml, redactSecrets } from './redact';

export const INTEGRATION_LOG_ROLES = ['ADMIN', 'PRACTICE_DIRECTOR'] as const;
export const INTEGRATION_LOG_PATH = '/dashboard/admin/integrations/logs';
export const AUDIT_INTEGRATION_LOG_VIEW = 'INTEGRATION_LOG_VIEW';
export const AUDIT_INTEGRATION_LOG_DOWNLOAD = 'INTEGRATION_LOG_DOWNLOAD';

export function canViewIntegrationLogs(role: string | null | undefined): boolean {
  return (INTEGRATION_LOG_ROLES as readonly string[]).includes(String(role || '').toUpperCase());
}

// ─── Retention ────────────────────────────────────────────────────────────────

export const PAYLOAD_RETENTION_DAYS = 90;
export const METADATA_RETENTION_DAYS = 365;

function days(env: string | undefined, fallback: number): number {
  const n = Number.parseInt(env || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Cutoffs for the purge: payload bodies (DrFirst) after 90 days, metadata rows after 1 year. */
export function retentionCutoffs(now = new Date(), env: Record<string, string | undefined> = process.env) {
  const payloadDays = days(env.DRFIRST_LOG_RETENTION_DAYS, PAYLOAD_RETENTION_DAYS);
  const metadataDays = Math.max(days(env.INTEGRATION_LOG_METADATA_RETENTION_DAYS, METADATA_RETENTION_DAYS), payloadDays);
  return {
    payloadDays,
    metadataDays,
    payloadBefore: new Date(now.getTime() - payloadDays * 86_400_000),
    metadataBefore: new Date(now.getTime() - metadataDays * 86_400_000),
  };
}

/** Which rows a purge removes (pure; the script applies the same rule in SQL). */
export function selectForPurge<T extends { createdAt: Date; hasPayload?: boolean }>(rows: T[], now = new Date(), env: Record<string, string | undefined> = {}) {
  const c = retentionCutoffs(now, env);
  return {
    deleteRows: rows.filter((r) => r.createdAt < c.metadataBefore),
    dropPayloads: rows.filter((r) => r.hasPayload && r.createdAt < c.payloadBefore && r.createdAt >= c.metadataBefore),
  };
}

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface LogFilters {
  integration: IntegrationName | null;
  operation: string | null;
  status: CallStatus | null;
  from: Date | null;
  to: Date | null;
  mrn: string | null;
  userId: string | null;
  page: number;
  pageSize: number;
}

function dateParam(v: string | null, endOfDay = false): Date | null {
  if (!v) return null;
  const s = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}` : v;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseLogFilters(sp: URLSearchParams): LogFilters {
  const integration = sp.get('integration');
  const status = sp.get('status');
  const op = sp.get('operation')?.trim().toLowerCase().slice(0, 80) || null;
  const page = Math.max(1, Number.parseInt(sp.get('page') || '1', 10) || 1);
  const pageSize = Math.min(Math.max(Number.parseInt(sp.get('pageSize') || '50', 10) || 50, 10), 200);
  return {
    integration: (INTEGRATIONS as readonly string[]).includes(integration || '') ? (integration as IntegrationName) : null,
    operation: op && /^[a-z0-9:/._ -]+$/.test(op) ? op : null,
    status: (CALL_STATUSES as readonly string[]).includes(status || '') ? (status as CallStatus) : null,
    from: dateParam(sp.get('from')),
    to: dateParam(sp.get('to'), true),
    mrn: sp.get('mrn')?.trim().slice(0, 40) || null,
    userId: sp.get('user')?.trim().slice(0, 64) || null,
    page,
    pageSize,
  };
}

/** Rows a practice can see: its own, plus deployment-wide rows (no organization: cron, SMS, Stripe ...). */
export function orgScope(organizationId: string) {
  return { OR: [{ organizationId }, { organizationId: null }] };
}

/** Prisma where for the list. `clientIds`: patients matching the MRN filter (empty = no match). */
export function buildLogWhere(f: LogFilters, organizationId: string, clientIds?: string[] | null) {
  const and: Record<string, unknown>[] = [orgScope(organizationId)];
  if (f.integration) and.push({ integration: f.integration });
  if (f.operation) and.push({ operation: { contains: f.operation } });
  if (f.status) and.push({ status: f.status });
  if (f.from || f.to) and.push({ createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  if (f.userId) and.push({ actorUserId: f.userId });
  if (clientIds) and.push({ clientId: { in: clientIds.length ? clientIds : ['__none__'] } });
  return { AND: and };
}

// ─── Health / tiles ───────────────────────────────────────────────────────────

export type HealthState = 'ok' | 'degraded' | 'failing' | 'idle';

/** From the last hour's calls: no errors = OK, error rate >= 50% = failing, otherwise degraded; no calls = idle. */
export function healthState(calls: number, errors: number): HealthState {
  if (calls <= 0) return 'idle';
  if (errors <= 0) return 'ok';
  return errors / calls >= 0.5 ? 'failing' : 'degraded';
}

export interface StatusCount {
  integration: string;
  status: string;
  count: number;
}

export interface IntegrationTile {
  integration: IntegrationName;
  label: string;
  calls24h: number;
  errors24h: number;
  errorRate24h: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  calls1h: number;
  errors1h: number;
  health: HealthState;
}

const isErrorStatus = (s: string) => s === 'error' || s === 'throttled';

export function buildTiles(input: {
  counts24h: StatusCount[];
  counts1h: StatusCount[];
  lastSuccess: Array<{ integration: string; at: Date | null }>;
  lastError: Array<{ integration: string; at: Date; message: string | null }>;
}): IntegrationTile[] {
  const sum = (rows: StatusCount[], integ: string, pred: (s: string) => boolean) =>
    rows.filter((r) => r.integration === integ && pred(r.status)).reduce((n, r) => n + r.count, 0);
  return INTEGRATIONS.map((integ) => {
    const calls24h = sum(input.counts24h, integ, (s) => s !== 'skipped');
    const errors24h = sum(input.counts24h, integ, isErrorStatus);
    const calls1h = sum(input.counts1h, integ, (s) => s !== 'skipped');
    const errors1h = sum(input.counts1h, integ, isErrorStatus);
    const ls = input.lastSuccess.find((r) => r.integration === integ)?.at ?? null;
    const le = input.lastError.find((r) => r.integration === integ) ?? null;
    return {
      integration: integ,
      label: INTEGRATION_LABELS[integ],
      calls24h,
      errors24h,
      errorRate24h: calls24h ? Math.round((errors24h / calls24h) * 1000) / 10 : null,
      lastSuccessAt: ls ? ls.toISOString() : null,
      lastErrorAt: le ? le.at.toISOString() : null,
      lastError: le?.message ?? null,
      calls1h,
      errors1h,
      health: healthState(calls1h, errors1h),
    };
  });
}

// ─── Detail + vendor download ─────────────────────────────────────────────────

export interface LogRowView {
  id: string;
  createdAt: Date;
  startedAt: Date;
  finishedAt: Date;
  organizationId: string | null;
  integration: string;
  operation: string;
  direction: string;
  status: string;
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
  metadata: unknown;
}

export interface StoredPayload {
  kind: string | null;
  text: string | null;
}

export interface DetailDeps {
  findLog(id: string, organizationId: string): Promise<LogRowView | null>;
  /** DrFirst: the decrypted, already-scrubbed payload from drfirst_api_logs (null when purged / none) */
  findPayload(row: LogRowView, organizationId: string): Promise<StoredPayload | null>;
  writeAudit(entry: {
    action: string;
    actorUserId: string;
    actorRole: string | null;
    organizationId: string;
    resourceType: string;
    resourceId: string;
    outcome: 'SUCCESS';
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface DetailCaller {
  userId: string;
  role: string | null;
  organizationId: string;
}

export type DetailResult =
  | { ok: true; row: LogRowView; payload: StoredPayload | null; masked: boolean; text?: string; fileName?: string; status?: undefined; error?: undefined }
  | { ok: false; status: number; error: string; row?: undefined; payload?: undefined; masked?: undefined; text?: undefined; fileName?: undefined };

/** Payload for display / download: secrets always redacted, patient identifiers masked unless asked. */
export function preparePayload(text: string | null, masked: boolean): string | null {
  if (!text) return null;
  const clean = redactSecrets(text);
  return prettyPrintXml(masked ? maskPatientIdentifiers(clean) : clean);
}

/** Plain-text file for the vendor's support team. */
export function buildVendorSupportText(row: LogRowView, payload: StoredPayload | null, masked: boolean): string {
  const label = INTEGRATION_LABELS[row.integration as IntegrationName] ?? row.integration;
  const body = preparePayload(payload?.text ?? null, masked);
  const lines = [
    `Altrixs integration call - ${label}`,
    `Log id:          ${row.id}`,
    `Correlation id:  ${row.correlationId ?? '-'}`,
    `Operation:       ${row.operation}`,
    `Direction:       ${row.direction}`,
    `Status:          ${row.status}${row.httpStatus ? ` (HTTP ${row.httpStatus})` : ''}${row.vendorStatus ? ` vendor: ${row.vendorStatus}` : ''}`,
    `Started (UTC):   ${row.startedAt.toISOString()}`,
    `Finished (UTC):  ${row.finishedAt.toISOString()}`,
    `Duration:        ${row.durationMs ?? '-'} ms`,
    `Error code:      ${row.errorCode ?? '-'}`,
    `Error:           ${row.errorMessage ? (masked ? maskPatientIdentifiers(row.errorMessage) : row.errorMessage) : '-'}`,
    `Patient identifiers: ${masked ? 'MASKED' : 'NOT MASKED (contains PHI - send only over a channel covered by the BAA)'}`,
    'Credentials (passwords, keys, tokens, MAC) are always removed.',
    '',
    payload?.text ? `----- ${payload.kind ?? 'payload'} -----` : '----- no stored payload -----',
    body ?? '',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Detail (view) or download of one log row. Both are HIPAA-audited with ids only:
 * INTEGRATION_LOG_VIEW / INTEGRATION_LOG_DOWNLOAD. Patient identifiers are masked by default.
 */
export async function loadIntegrationLogDetail(
  deps: DetailDeps,
  caller: DetailCaller,
  params: { id: string; download?: boolean; masked?: boolean }
): Promise<DetailResult> {
  if (!canViewIntegrationLogs(caller.role)) return { ok: false, status: 403, error: 'Only Admin / Practice Director can view integration logs' };
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return { ok: false, status: 400, error: 'Invalid id' };
  const row = await deps.findLog(params.id, caller.organizationId);
  if (!row) return { ok: false, status: 404, error: 'Not found' };
  const masked = params.masked !== false;
  const raw = row.sourceTable === 'drfirst_api_logs' ? await deps.findPayload(row, caller.organizationId) : null;
  await deps.writeAudit({
    action: params.download ? AUDIT_INTEGRATION_LOG_DOWNLOAD : AUDIT_INTEGRATION_LOG_VIEW,
    actorUserId: caller.userId,
    actorRole: caller.role,
    organizationId: caller.organizationId,
    resourceType: 'IntegrationCallLog',
    resourceId: row.id,
    outcome: 'SUCCESS',
    metadata: {
      logId: row.id,
      integration: row.integration,
      operation: row.operation,
      sourceId: row.sourceId,
      clientId: row.clientId,
      payload: Boolean(raw?.text),
      masked,
    },
  });
  if (params.download) {
    const stamp = row.startedAt.toISOString().replace(/[:.]/g, '-');
    return {
      ok: true,
      row,
      payload: raw,
      masked,
      text: buildVendorSupportText(row, raw, masked),
      fileName: `altrixs-${row.integration}-${row.operation.replace(/[^a-z0-9_-]+/gi, '-')}-${stamp}.txt`,
    };
  }
  return { ok: true, row, payload: raw ? { kind: raw.kind, text: preparePayload(raw.text, masked) } : null, masked };
}
