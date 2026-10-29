/**
 * CSV helpers for compliance exports. Cells are always quoted; cells that a spreadsheet would
 * run as a formula (=, +, -, @, tab, CR) are prefixed with an apostrophe (CSV injection guard).
 */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\r\n';
}
