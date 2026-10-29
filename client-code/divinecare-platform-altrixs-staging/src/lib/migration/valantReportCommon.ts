/**
 * Shared helpers for Valant report exports (SSRS-style CSVs with generic headers such as
 * textBox1 / textBox2 that repeat, so rows are read by column POSITION after the header row is
 * verified). Pure: safe in tests, API routes and client components.
 */

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "$337.86", "($79.17)", "-$79.17", "1,448.37", "$0" -> cents. Blank or non-numeric -> null. */
export function reportMoneyToCents(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\$-/.test(s);
  const digits = s.replace(/[()$,\s-]/g, '');
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg && cents !== 0 ? -cents : cents;
}

/** Date-only value at noon UTC (no timezone drift when shown as a date). */
export function utcNoon(year: number, month: number, day: number): Date | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/** "October 17, 2026" -> Date (noon UTC) */
export function parseLongDate(raw: string): Date | null {
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return utcNoon(Number(m[3]), month, Number(m[2]));
}

/** "01/12/2026" (MM/DD/YYYY) -> Date (noon UTC) */
export function parseUsDate(raw: string | null | undefined): Date | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return utcNoon(Number(m[3]), Number(m[1]), Number(m[2]));
}

export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Header cells compared case-insensitively, ignoring surrounding space and a BOM. */
export function headerMatches(header: readonly string[], expected: readonly string[]): boolean {
  if (header.length < expected.length) return false;
  return expected.every((h, i) => String(header[i] ?? '').replace(/^﻿/, '').trim().toLowerCase() === h.toLowerCase());
}

/** Format cents as "$1,234.56" / "-$79.17" */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : ''}$${s}`;
}

/** CSV text -> records of cells (quoted cells may hold commas, "" and line breaks) */
export function parseCsvText(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((c) => c.trim())) records.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) records.push(row);
  return records;
}
