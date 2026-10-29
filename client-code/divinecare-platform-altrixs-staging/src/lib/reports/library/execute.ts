/**
 * Report library executor: role check -> parameter validation -> context -> run (with a timeout)
 * -> small-cell suppression -> paging -> audit. The database-facing pieces (context builder,
 * audit writer) are injected, so this module is unit tested without a database.
 *
 * Audit metadata never holds PHI: report id, parameters (dates, preset, ids / flags), row count,
 * scope, suppression, duration. Denied runs and failures are audited too.
 */
import type { AccessCapabilities } from '@/lib/auth/medicalDirector';
import { canRunReport, isClinicalViewer } from './access';
import { describeParams, parsePaging, resolveReportParams, type RawParams } from './params';
import { applySmallCellSuppression } from './suppression';
import type { ReportDefinition } from './registry';
import type { ReportContext } from './context';
import type { ReportRunResult, ResolvedParams } from './types';

export const REPORT_TIMEOUT_MS = 25_000;
/** Rows a runner may return (the JSON view pages through them; exports get all of them). */
export const REPORT_ROW_CAP = 10_000;

export class ReportTimeoutError extends Error {
  constructor() {
    super('The report took too long. Narrow the date range or add a site / provider filter.');
  }
}

export type AuditWriter = (entry: {
  action: 'READ' | 'EXPORT';
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  resourceId: string;
  metadata: Record<string, unknown>;
}) => Promise<void>;

export type ExecuteDeps = {
  viewer: { organizationId: string; userId: string; role: string; capabilities?: AccessCapabilities | null };
  timeZone: string;
  now: Date;
  buildContext: (params: ResolvedParams) => Promise<ReportContext>;
  audit: AuditWriter;
  timeoutMs?: number;
};

export type ExecuteResult =
  | { ok: true; result: ReportRunResult }
  | { ok: false; status: 400 | 403 | 504 | 500; error: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReportTimeoutError()), ms);
  });
  return Promise.race([p, t]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Parameter echo for audit metadata: dates, preset, ids and select values; payer as a flag only. */
export function auditParams(p: ResolvedParams): Record<string, unknown> {
  return {
    preset: p.range?.preset ?? null,
    fromDate: p.range?.fromDate ?? null,
    toDate: p.range?.toDate ?? null,
    siteId: p.site,
    providerId: p.provider,
    payerFilter: Boolean(p.payer),
    values: p.values,
  };
}

/** Sort request: a column key of this report + asc / desc; anything else = the report's own order. */
export function parseSort(raw: RawParams, keys: string[]): { key: string; dir: 'asc' | 'desc' } | null {
  const key = typeof raw.sort === 'string' ? raw.sort : '';
  if (!key || !keys.includes(key)) return null;
  return { key, dir: raw.dir === 'desc' ? 'desc' : 'asc' };
}

/** Stable sort; numbers numerically, text case-insensitively, empty values last either way. */
export function sortRows<T extends Record<string, unknown>>(rows: T[], key: string, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = a.r[key];
      const y = b.r[key];
      const xe = x === null || x === undefined || x === '';
      const ye = y === null || y === undefined || y === '';
      if (xe || ye) return xe && ye ? a.i - b.i : xe ? 1 : -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { sensitivity: 'base', numeric: true });
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.r);
}

export async function executeReport(
  def: ReportDefinition,
  raw: RawParams,
  mode: { kind: 'view' } | { kind: 'export'; format: string },
  deps: ExecuteDeps
): Promise<ExecuteResult> {
  const action = mode.kind === 'export' ? 'EXPORT' : 'READ';
  const base = { reportId: def.id, category: def.category, output: def.output, format: mode.kind === 'export' ? mode.format : 'view' };

  if (!canRunReport(def, deps.viewer.role, deps.viewer.capabilities)) {
    await deps.audit({ action, outcome: 'DENIED', resourceId: def.id, metadata: { ...base, reason: 'role_not_permitted' } });
    return { ok: false, status: 403, error: 'You do not have access to this report' };
  }

  const parsed = resolveReportParams(def, raw, { now: deps.now, timeZone: deps.timeZone });
  if ('error' in parsed) return { ok: false, status: 400, error: parsed.error };
  const params = parsed.params;

  const started = Date.now();
  let ctx: ReportContext;
  try {
    ctx = await deps.buildContext(params);
  } catch (err) {
    if (err instanceof Error && err.name === 'ReportFilterError') return { ok: false, status: 400, error: err.message };
    if (err instanceof Error && /^Unknown (location|clinician)$/.test(err.message)) return { ok: false, status: 400, error: err.message };
    throw err;
  }

  let output;
  try {
    output = await withTimeout(def.run(ctx, params), deps.timeoutMs ?? REPORT_TIMEOUT_MS);
  } catch (err) {
    const timedOut = err instanceof ReportTimeoutError;
    await deps.audit({
      action, outcome: 'FAILURE', resourceId: def.id,
      metadata: { ...base, ...auditParams(params), error: timedOut ? 'timeout' : (err instanceof Error ? err.name : 'unknown'), durationMs: Date.now() - started },
    });
    if (timedOut) return { ok: false, status: 504, error: (err as Error).message };
    console.error('[reports/library run]', def.id, err instanceof Error ? err.name : 'unknown', err instanceof Error ? err.message.slice(0, 300) : '');
    return { ok: false, status: 500, error: 'Could not run the report' };
  }

  let suppressed = false;
  if (def.suppressSmallCells && def.output === 'aggregate' && !isClinicalViewer(deps.viewer.role, deps.viewer.capabilities)) {
    const s = applySmallCellSuppression(output);
    output = s.output;
    suppressed = s.suppressed;
  }

  const truncated = Boolean(output.truncated) || output.rows.length > REPORT_ROW_CAP;
  const capped = output.rows.length > REPORT_ROW_CAP ? output.rows.slice(0, REPORT_ROW_CAP) : output.rows;
  const sort = parseSort(raw, output.columns.map((c) => c.key));
  const allRows = sort ? sortRows(capped, sort.key, sort.dir) : capped;
  const { page, pageSize } = parsePaging(raw);
  const rows = mode.kind === 'view' ? allRows.slice((page - 1) * pageSize, page * pageSize) : allRows;
  const notices = [...(output.notices ?? [])];
  if (suppressed) notices.push('Counts under 10 are shown as "<10" for your role (small-cell suppression).');
  if (truncated) notices.push(`Only the first ${REPORT_ROW_CAP.toLocaleString('en-US')} rows are included. Narrow the parameters for the full list.`);
  const generatedAt = deps.now.toISOString();
  const durationMs = Date.now() - started;

  const result: ReportRunResult = {
    reportId: def.id,
    title: def.title,
    category: def.category,
    output: def.output,
    generatedAt,
    asOf: output.asOf ?? generatedAt,
    timeZone: deps.timeZone,
    scope: ctx.scopeKind,
    params: {
      preset: params.range?.preset ?? null,
      fromDate: params.range?.fromDate ?? null,
      toDate: params.range?.toDate ?? null,
      site: params.site,
      provider: params.provider,
      payer: params.payer,
      values: params.values,
    },
    paramLabel: describeParams(def, params, { site: ctx.siteLabel, provider: ctx.providerLabel }),
    columns: output.columns,
    rows,
    totalRows: allRows.length,
    page: mode.kind === 'view' ? page : 1,
    pageSize: mode.kind === 'view' ? pageSize : allRows.length,
    kpis: output.kpis ?? [],
    chart: output.chart ?? null,
    sources: output.sources,
    notices,
    definitions: def.definitions,
    suppressed,
    truncated,
    hiddenSensitiveClients: output.hiddenSensitiveClients ?? 0,
    durationMs,
  };

  await deps.audit({
    action,
    outcome: 'SUCCESS',
    resourceId: def.id,
    metadata: {
      ...base,
      ...auditParams(params),
      rowCount: allRows.length,
      page: result.page,
      scope: ctx.scopeKind,
      suppressed,
      hiddenSensitiveClients: result.hiddenSensitiveClients,
      durationMs,
    },
  });
  return { ok: true, result };
}
