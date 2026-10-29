/**
 * Report library parameters: date presets in the practice time zone and validation of the raw
 * request values against a report's parameter specs. Pure and browser-safe.
 *
 * Raw values arrive as strings (JSON body of /run, or the query string of /export):
 *   preset, from, to (YYYY-MM-DD), site, provider, payer, plus each select param by its key.
 */
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday, zonedWallTimeToUtc } from '@/lib/time/practiceTime';
import { DATE_PRESETS, type DatePreset, type ReportMeta, type ResolvedParams } from './types';

const DAY_MS = 86_400_000;
export const DEFAULT_MAX_RANGE_DAYS = 3 * 366;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PAYER_MAX = 120;

export function validYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

function monthStart(y: number, m: number): string {
  return `${y}-${pad(m)}-01`;
}

function monthEnd(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Inclusive [fromDate, toDate] for a preset, relative to "today" on the practice clock. */
export function presetRange(preset: Exclude<DatePreset, 'custom'>, today: string): { fromDate: string; toDate: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const q = Math.floor((m - 1) / 3);
  switch (preset) {
    case 'this_month':
      return { fromDate: monthStart(y, m), toDate: today };
    case 'last_month': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { fromDate: monthStart(ly, lm), toDate: monthEnd(ly, lm) };
    }
    case 'last_30':
      return { fromDate: addDaysYmd(today, -29), toDate: today };
    case 'last_90':
      return { fromDate: addDaysYmd(today, -89), toDate: today };
    case 'qtd':
      return { fromDate: monthStart(y, q * 3 + 1), toDate: today };
    case 'last_quarter': {
      const lq = q === 0 ? 3 : q - 1;
      const ly = q === 0 ? y - 1 : y;
      return { fromDate: monthStart(ly, lq * 3 + 1), toDate: monthEnd(ly, lq * 3 + 3) };
    }
    case 'ytd':
      return { fromDate: `${y}-01-01`, toDate: today };
    case 'last_year':
      return { fromDate: `${y - 1}-01-01`, toDate: `${y - 1}-12-31` };
  }
}

/** Midnight of a calendar day on the practice clock, as a UTC instant. */
export function practiceDayStart(ymd: string, timeZone: string = DEFAULT_PRACTICE_TIME_ZONE): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return zonedWallTimeToUtc(y, m, d, 0, 0, timeZone);
}

export type RawParams = Record<string, unknown>;

export type ParamResult = { ok: true; params: ResolvedParams } | { ok: false; error: string };

function str(raw: RawParams, key: string): string {
  const v = raw[key];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).trim();
}

/**
 * Validate raw values against the report's specs. Unknown keys are ignored; values for params
 * the report does not declare are dropped (never passed to run()).
 */
export function resolveReportParams(
  meta: Pick<ReportMeta, 'params'>,
  raw: RawParams,
  opts: { now?: Date; timeZone?: string } = {}
): ParamResult {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone ?? DEFAULT_PRACTICE_TIME_ZONE;
  const out: ResolvedParams = { range: null, site: null, provider: null, payer: null, values: {} };

  for (const spec of meta.params) {
    switch (spec.kind) {
      case 'dateRange': {
        const presetRaw = str(raw, 'preset') || spec.defaultPreset;
        if (!DATE_PRESETS.some((p) => p.id === presetRaw)) return { ok: false, error: 'Unknown date preset' };
        const preset = presetRaw as DatePreset;
        let fromDate: string;
        let toDate: string;
        if (preset === 'custom') {
          fromDate = str(raw, 'from');
          toDate = str(raw, 'to');
          if (!validYmd(fromDate) || !validYmd(toDate)) return { ok: false, error: 'Custom range needs from and to as YYYY-MM-DD' };
        } else {
          ({ fromDate, toDate } = presetRange(preset, practiceToday(tz, now)));
        }
        if (fromDate > toDate) return { ok: false, error: 'The start date must be on or before the end date' };
        const maxDays = spec.maxDays ?? DEFAULT_MAX_RANGE_DAYS;
        const dayFrom = new Date(`${fromDate}T00:00:00.000Z`);
        const dayToExclusive = new Date(`${addDaysYmd(toDate, 1)}T00:00:00.000Z`);
        if ((dayToExclusive.getTime() - dayFrom.getTime()) / DAY_MS > maxDays) {
          return { ok: false, error: `The date range is limited to ${maxDays} days for this report` };
        }
        out.range = {
          preset,
          fromDate,
          toDate,
          from: practiceDayStart(fromDate, tz),
          toExclusive: practiceDayStart(addDaysYmd(toDate, 1), tz),
          dayFrom,
          dayToExclusive,
        };
        break;
      }
      case 'site':
      case 'provider': {
        const v = str(raw, spec.key);
        if (v && v !== 'all') {
          if (!ID_RE.test(v)) return { ok: false, error: `Invalid ${spec.label.toLowerCase()}` };
          out[spec.kind] = v;
        }
        break;
      }
      case 'payer': {
        const v = str(raw, 'payer');
        if (v && v !== 'all') {
          if (v.length > PAYER_MAX || /[\u0000-\u001f]/.test(v)) return { ok: false, error: 'Invalid payer' };
          out.payer = v;
        }
        break;
      }
      case 'select': {
        const v = str(raw, spec.key) || spec.default;
        if (!spec.options.some((o) => o.value === v)) return { ok: false, error: `Invalid value for ${spec.label}` };
        out.values[spec.key] = v;
        break;
      }
    }
  }
  return { ok: true, params: out };
}

/** Raw request values from a URLSearchParams (export links) */
export function rawFromSearchParams(sp: URLSearchParams): RawParams {
  const raw: RawParams = {};
  for (const [k, v] of sp.entries()) if (!(k in raw)) raw[k] = v;
  return raw;
}

/** Page / pageSize for the JSON view (exports always return every row). */
export function parsePaging(raw: RawParams): { page: number; pageSize: number } {
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(raw.page) || 1)));
  const sizeRaw = Math.floor(Number(raw.pageSize) || 50);
  const pageSize = [25, 50, 100, 250].includes(sizeRaw) ? sizeRaw : 50;
  return { page, pageSize };
}

function fmtDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Oct 1, 2026 - Oct 19, 2026 · Site: Bowie · Status: Active" */
export function describeParams(
  meta: Pick<ReportMeta, 'params'>,
  p: ResolvedParams,
  labels: { site?: string | null; provider?: string | null } = {}
): string {
  const parts: string[] = [];
  for (const spec of meta.params) {
    if (spec.kind === 'dateRange' && p.range) {
      const preset = DATE_PRESETS.find((x) => x.id === p.range!.preset)?.label;
      parts.push(`${fmtDay(p.range.fromDate)} - ${fmtDay(p.range.toDate)}${preset && p.range.preset !== 'custom' ? ` (${preset})` : ''}`);
    } else if (spec.kind === 'site') {
      parts.push(`Site: ${p.site ? labels.site ?? 'selected site' : 'All sites'}`);
    } else if (spec.kind === 'provider') {
      parts.push(`Provider: ${p.provider ? labels.provider ?? 'selected provider' : 'All providers'}`);
    } else if (spec.kind === 'payer') {
      parts.push(`Payer: ${p.payer ?? 'All payers'}`);
    } else if (spec.kind === 'select') {
      const v = p.values[spec.key];
      parts.push(`${spec.label}: ${spec.options.find((o) => o.value === v)?.label ?? v}`);
    }
  }
  return parts.join(' · ');
}
