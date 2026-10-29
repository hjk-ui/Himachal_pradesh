/**
 * Report library XLSX (exceljs) and PDF (pdf-lib) files. Both libraries are already dependencies.
 * Every file carries the same header block as the CSV: parameters, scope, as-of, sources, notes.
 */
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { displayCell, exportPreamble, type ExportHeader } from './exportFormat';
import type { ReportRunResult } from './types';

export async function buildXlsx(r: ReportRunResult, h: ExportHeader): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Altrixs';
  wb.created = new Date(r.generatedAt);
  const ws = wb.addWorksheet('Report');
  for (const [k, v] of exportPreamble(r, h)) {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5C2D91' } };
  });
  const headerRowNumber = header.number;
  for (const row of r.rows) {
    const values = r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return c.type === 'money' ? Math.round(v) / 100 : v;
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      return String(v);
    });
    const added = ws.addRow(values);
    r.columns.forEach((c, i) => {
      const cell = added.getCell(i + 1);
      if (typeof cell.value !== 'number') return;
      if (c.type === 'money') cell.numFmt = '$#,##0.00;[Red]-$#,##0.00';
      else if (c.type === 'percent') cell.numFmt = '0.0"%"';
      else cell.numFmt = '#,##0.##';
    });
  }
  ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  r.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.min(48, Math.max(12, c.label.length + 4));
  });
  if (r.kpis.length) {
    const ks = wb.addWorksheet('Summary');
    ks.addRow(['Measure', 'Value']).font = { bold: true };
    for (const k of r.kpis) ks.addRow([k.label, displayCell(k.value, k.type, r.timeZone)]);
    ks.getColumn(1).width = 40;
    ks.getColumn(2).width = 24;
  }
  const ds = wb.addWorksheet('Definitions');
  ds.addRow(['Term', 'Definition']).font = { bold: true };
  for (const [k, v] of r.definitions) ds.addRow([k, v]);
  ds.getColumn(1).width = 32;
  ds.getColumn(2).width = 110;
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** Standard PDF fonts use WinAnsi: map the few symbols the reports use, drop anything else outside it. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfSafe(text: string): string {
  return text
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/−/g, '-')
    .replace(/[   ]/g, ' ')
    .split('')
    .map((ch) => (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.has(ch) ? ch : '?'))
    .join('')
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, ' ');
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = pdfSafe(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

export async function buildPdf(r: ReportRunResult, h: ExportHeader): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(r.title));
  doc.setProducer('Altrixs');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612;
  const M = 32;
  const purple = rgb(0x5c / 255, 0x2d / 255, 0x91 / 255);
  const grey = rgb(0.35, 0.38, 0.45);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const text = (s: string, x: number, size = 8, f: PDFFont = font, color = rgb(0.1, 0.1, 0.15)) => page.drawText(pdfSafe(s), { x, y, size, font: f, color });

  text(r.title, M, 15, bold, purple);
  y -= 18;
  for (const [k, v] of exportPreamble(r, h)) {
    if (y < M + 40) newPage();
    text(`${k}:`, M, 7.5, bold, grey);
    page.drawText(fit(v, font, 7.5, W - M * 2 - 110), { x: M + 110, y, size: 7.5, font, color: grey });
    y -= 10;
  }
  if (r.kpis.length) {
    y -= 4;
    const kp = r.kpis.map((k) => `${k.label}: ${displayCell(k.value, k.type, r.timeZone)}`).join('    ');
    page.drawText(fit(kp, bold, 8.5, W - M * 2), { x: M, y, size: 8.5, font: bold, color: purple });
    y -= 14;
  }

  // Table: widths proportional to header / content length, capped
  const cols = r.columns;
  const sample = r.rows.slice(0, 200);
  const weights = cols.map((c) => Math.min(40, Math.max(c.label.length, ...sample.map((row) => displayCell(row[c.key] ?? null, c.type, r.timeZone).length), 6)));
  const total = weights.reduce((s, v) => s + v, 0);
  const widths = weights.map((w) => ((W - M * 2) * w) / total);
  const rowH = 11;
  const drawHeader = () => {
    page.drawRectangle({ x: M, y: y - 3, width: W - M * 2, height: rowH + 2, color: purple });
    let x = M + 2;
    cols.forEach((c, i) => {
      page.drawText(fit(c.label, bold, 7, widths[i] - 4), { x, y, size: 7, font: bold, color: rgb(1, 1, 1) });
      x += widths[i];
    });
    y -= rowH + 2;
  };
  if (y < M + 60) newPage();
  drawHeader();
  r.rows.forEach((row, idx) => {
    if (y < M + 20) {
      newPage();
      drawHeader();
    }
    if (idx % 2 === 1) page.drawRectangle({ x: M, y: y - 3, width: W - M * 2, height: rowH, color: rgb(0.96, 0.95, 0.98) });
    let x = M + 2;
    cols.forEach((c, i) => {
      page.drawText(fit(displayCell(row[c.key] ?? null, c.type, r.timeZone), font, 7, widths[i] - 4), { x, y, size: 7, font, color: rgb(0.1, 0.1, 0.15) });
      x += widths[i];
    });
    y -= rowH;
  });
  if (!r.rows.length) {
    text('No rows for these parameters.', M, 8, font, grey);
    y -= 12;
  }

  // Definitions
  y -= 10;
  if (y < M + 40) newPage();
  text('Definitions', M, 9, bold, purple);
  y -= 12;
  for (const [k, v] of r.definitions) {
    if (y < M + 20) newPage();
    page.drawText(fit(`${k}: ${v}`, font, 7, W - M * 2), { x: M, y, size: 7, font, color: grey });
    y -= 10;
  }

  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(pdfSafe(`Confidential. Altrixs report library · ${r.title} · page ${i + 1} of ${pages.length}`), { x: M, y: 14, size: 6.5, font, color: grey });
  });
  return doc.save();
}
