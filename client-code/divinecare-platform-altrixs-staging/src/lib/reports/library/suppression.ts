/**
 * Small-cell suppression for aggregate clinical reports (pure).
 *
 * Non-clinical viewers (Office Manager, Billing, HR, Front Desk) see counts of 1-9 people as
 * "<10", and rates whose denominator is 1-9 as "<10" too, so a small group cannot be re-identified
 * from an aggregate. Clinical viewers (leadership, licensed clinicians, Medical Director) see the
 * numbers; their patient scope already limits what they see. Zero stays 0 (it identifies no one).
 */
import { SMALL_CELL_THRESHOLD, SUPPRESSED_LABEL, isSmallCount } from './formulas';
import type { ReportKpi, ReportOutput, ReportRow } from './types';

export function suppressRows(rows: ReportRow[], columns: ReportOutput['columns']): { rows: ReportRow[]; changed: boolean } {
  const countCols = columns.filter((c) => c.smallCell === 'count').map((c) => c.key);
  const rateCols = columns
    .filter((c) => c.smallCell && typeof c.smallCell === 'object')
    .map((c) => ({ key: c.key, of: (c.smallCell as { rateOf: string }).rateOf }));
  if (!countCols.length && !rateCols.length) return { rows, changed: false };
  let changed = false;
  const out = rows.map((r) => {
    const next: ReportRow = { ...r };
    for (const r2 of rateCols) {
      // Judge the denominator BEFORE its own cell is masked
      if (isSmallCount(r[r2.of]) && r[r2.key] !== null && r[r2.key] !== undefined) {
        next[r2.key] = SUPPRESSED_LABEL;
        changed = true;
      }
    }
    for (const k of countCols) {
      if (isSmallCount(r[k])) {
        next[k] = SUPPRESSED_LABEL;
        changed = true;
      }
    }
    return next;
  });
  return { rows: out, changed };
}

export function suppressKpis(kpis: ReportKpi[]): { kpis: ReportKpi[]; changed: boolean } {
  let changed = false;
  const out = kpis.map((k) => {
    if (!k.smallCell) return k;
    const small =
      k.smallCell === 'count'
        ? isSmallCount(k.value)
        : k.smallCell.denominator > 0 && k.smallCell.denominator < SMALL_CELL_THRESHOLD;
    if (!small || k.value === null) return k;
    changed = true;
    return { ...k, value: SUPPRESSED_LABEL, type: 'text' as const, hint: `${k.hint ? `${k.hint} ` : ''}Suppressed: fewer than ${SMALL_CELL_THRESHOLD} clients.` };
  });
  return { kpis: out, changed };
}

/** Apply suppression to a whole report output (rows, KPIs, chart data). */
export function applySmallCellSuppression(output: ReportOutput): { output: ReportOutput; suppressed: boolean } {
  const rows = suppressRows(output.rows, output.columns);
  const kpis = suppressKpis(output.kpis ?? []);
  let chart = output.chart ?? null;
  let chartChanged = false;
  if (chart?.data) {
    const series = chart.series.map((s) => s.key);
    const data = chart.data.map((r) => {
      const n: ReportRow = { ...r };
      for (const k of series) {
        if (isSmallCount(r[k])) {
          n[k] = null;
          chartChanged = true;
        }
      }
      return n;
    });
    chart = { ...chart, data };
  }
  const suppressed = rows.changed || kpis.changed || chartChanged;
  return { output: { ...output, rows: rows.rows, kpis: kpis.kpis, chart }, suppressed };
}
