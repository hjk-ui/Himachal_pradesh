/**
 * Report library export formatting (pure): cell display values and the CSV file.
 *
 * CSV injection guard: every text cell is quoted, and text that a spreadsheet would run as a
 * formula (starting with = + - @ tab or CR) gets a leading apostrophe. Numbers (counts, dollars,
 * percents) are written as plain numbers so they stay numeric in Excel.
 */
import { formatUsdCents } from '@/lib/format/money';
import type { CellValue, ColumnType, ReportRunResult } from './types';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvSafeText(value: string): string {
  const s = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${s.replace(/"/g, '""')}"`;
}

/** One CSV cell for a typed value. */
export function csvCellFor(value: CellValue, type: ColumnType): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (type === 'money') return (Math.round(value) / 100).toFixed(2);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return csvSafeText(String(value));
}

/** Display text for a cell (table, PDF, print). Money values are integer cents. */
export function displayCell(value: CellValue, type: ColumnType, timeZone = 'America/New_York'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && type !== 'text' && type !== 'date' && type !== 'datetime') return value;
  switch (type) {
    case 'money':
      return typeof value === 'number' ? formatUsdCents(value) : String(value);
    case 'percent':
      return typeof value === 'number' ? `${value}%` : String(value);
    case 'days':
      return typeof value === 'number' ? `${value} d` : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
    case 'date': {
      const s = String(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
      }
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });
    }
    case 'datetime': {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime())
        ? String(value)
        : d.toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    default:
      return String(value);
  }
}

function line(cells: string[]): string {
  return `${cells.join(',')}\r\n`;
}

export type ExportHeader = {
  organization: string | null;
  runBy: string | null;
};

/** Header block shared by CSV / XLSX / PDF: title, parameters, scope, freshness, notices. */
export function exportPreamble(r: ReportRunResult, h: ExportHeader): [string, string][] {
  const rows: [string, string][] = [
    ['Report', r.title],
    ['Organization', h.organization ?? ''],
    ['Parameters', r.paramLabel],
    ['Scope', r.scope === 'caseload' ? 'My caseload (clients assigned to me / my care team)' : 'Organization'],
    ['Generated', new Date(r.generatedAt).toLocaleString('en-US', { timeZone: r.timeZone })],
    ['Data as of', new Date(r.asOf).toLocaleString('en-US', { timeZone: r.timeZone })],
    ['Time zone', r.timeZone],
    ['Rows', String(r.totalRows)],
  ];
  if (h.runBy) rows.push(['Run by', h.runBy]);
  if (r.suppressed) rows.push(['Suppression', 'Counts under 10 are shown as <10 for this viewer']);
  if (r.hiddenSensitiveClients) rows.push(['Protected records', `${r.hiddenSensitiveClients} protected (42 CFR Part 2 / restricted) client(s) left out`]);
  if (r.truncated) rows.push(['Row limit', 'The report hit its row limit; narrow the parameters for the full list']);
  for (const s of r.sources) {
    const bits = [s.empty ? 'no data' : null, s.rows != null ? `${s.rows} rows read` : null, s.asOf ? `as of ${s.asOf}` : null, s.note ?? null].filter(Boolean);
    rows.push([`Source: ${s.name}`, bits.join('; ')]);
  }
  for (const n of r.notices) rows.push(['Note', n]);
  rows.push(['Confidential', 'Contains confidential information. Do not redistribute. Altrixs report library.']);
  return rows;
}

export function buildCsv(r: ReportRunResult, h: ExportHeader): string {
  let out = '';
  for (const [k, v] of exportPreamble(r, h)) out += line([csvSafeText(k), csvSafeText(v)]);
  out += '\r\n';
  out += line(r.columns.map((c) => csvSafeText(c.label)));
  for (const row of r.rows) out += line(r.columns.map((c) => csvCellFor(row[c.key] ?? null, c.type)));
  if (r.kpis.length) {
    out += '\r\n';
    out += line([csvSafeText('Summary'), csvSafeText('Value')]);
    for (const k of r.kpis) out += line([csvSafeText(k.label), csvCellFor(k.value, k.type)]);
  }
  if (r.definitions.length) {
    out += '\r\n';
    out += line([csvSafeText('Definition'), csvSafeText('Meaning')]);
    for (const [k, v] of r.definitions) out += line([csvSafeText(k), csvSafeText(v)]);
  }
  return out;
}

export function exportFileName(reportId: string, r: Pick<ReportRunResult, 'params' | 'generatedAt'>, ext: string): string {
  const range = r.params.fromDate && r.params.toDate ? `${r.params.fromDate}_to_${r.params.toDate}` : r.generatedAt.slice(0, 10);
  return `${reportId}_${range}.${ext}`.replace(/[^A-Za-z0-9_.-]/g, '-');
}
