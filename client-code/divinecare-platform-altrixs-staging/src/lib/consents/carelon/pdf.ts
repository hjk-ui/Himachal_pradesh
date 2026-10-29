/**
 * Carelon non-overlap attestation PDF (pdf-lib, already a dependency). Replicates the Carelon form
 * layout as text (no logo): page 1 header + Participant / Provider Information + Purpose,
 * page 2 Part A, page 3 Part B, footer "maryland.carelonbh.com" + page numbers on every page.
 * Dates are MM/DD/YYYY in the practice time zone. Pure (no database): the store passes the frozen
 * document of a signed record, or the live prefill for a blank / unsigned copy.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CarelonTemplate } from './template';
import type { PartASignature, PartBSignature } from './workflow';
import { formatPracticeMdY, formatTin } from './prefill';
import { formatPracticeTime, practiceZoneLabel } from '@/lib/time/practiceTime';

export type CarelonPdfInput = {
  template: CarelonTemplate;
  participant: { participantName: string | null; participantId: string | null; dateOfBirth: string | null };
  provider: { organizationName: string | null; npi: string | null; tin: string | null };
  partA: PartASignature | null;
  partB: PartBSignature | null;
  submission?: { submittedOn: string; recordedByName: string | null; reference: string | null } | null;
  /** ConsentForm id, printed small in the signature record */
  recordId: string | null;
  timeZone: string;
  generatedAt: Date;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.38, 0.38, 0.42);
const RULE = rgb(0.75, 0.75, 0.78);

/** pdf-lib standard fonts are WinAnsi: map smart punctuation, drop anything else unprintable. */
export function pdfSafe(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E -ÿ]/g, '?');
}

export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

class Cursor {
  y = PAGE_H - MARGIN;
  constructor(public page: PDFPage, public fonts: Fonts) {}

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number; lineGap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const indent = opts.indent ?? 0;
    const lineH = size + (opts.lineGap ?? 3.5);
    for (const l of wrapText(text, font, size, CONTENT_W - indent)) {
      this.y -= lineH;
      this.page.drawText(l, { x: MARGIN + indent, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 6;
  }

  rule(gap = 8) {
    this.y -= 4;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.8, color: RULE });
    this.y -= gap;
  }

  /** Labeled field: small label, the value on an underline (blank line when empty) */
  field(label: string, value: string | null, opts: { italicValue?: boolean; width?: number; x?: number; keepY?: boolean } = {}) {
    const x = MARGIN + (opts.x ?? 0);
    const width = opts.width ?? CONTENT_W;
    const top = this.y;
    let y = top - 10;
    this.page.drawText(pdfSafe(label), { x, y, size: 8, font: this.fonts.bold, color: MUTED });
    const font = opts.italicValue ? this.fonts.italic : this.fonts.regular;
    const size = opts.italicValue ? 13 : 10.5;
    const lines = value ? wrapText(value, font, size, width - 4) : [''];
    for (const l of lines) {
      y -= size + 5;
      if (l) this.page.drawText(l, { x: x + 2, y, size, font, color: INK });
    }
    y -= 3;
    this.page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.6, color: INK });
    const bottom = y - 10;
    if (!opts.keepY) this.y = bottom;
    return bottom;
  }

  checkbox(checked: boolean, label: string, indent: number) {
    const size = 10;
    const lines = wrapText(label, this.fonts.regular, size, CONTENT_W - indent - 18);
    const boxY = this.y - size - 2;
    this.page.drawRectangle({ x: MARGIN + indent, y: boxY, width: 10, height: 10, borderColor: INK, borderWidth: 0.9 });
    if (checked) {
      this.page.drawLine({ start: { x: MARGIN + indent + 2, y: boxY + 2 }, end: { x: MARGIN + indent + 8, y: boxY + 8 }, thickness: 1.2, color: INK });
      this.page.drawLine({ start: { x: MARGIN + indent + 2, y: boxY + 8 }, end: { x: MARGIN + indent + 8, y: boxY + 2 }, thickness: 1.2, color: INK });
    }
    for (const l of lines) {
      this.y -= size + 3.5;
      this.page.drawText(l, { x: MARGIN + indent + 18, y: this.y, size, font: this.fonts.regular, color: INK });
    }
    this.y -= 6;
  }
}

function footer(page: PDFPage, fonts: Fonts, footerText: string, n: number, total: number) {
  page.drawLine({ start: { x: MARGIN, y: 46 }, end: { x: PAGE_W - MARGIN, y: 46 }, thickness: 0.6, color: RULE });
  page.drawText(pdfSafe(footerText), { x: MARGIN, y: 32, size: 9, font: fonts.regular, color: MUTED });
  const label = `Page ${n} of ${total}`;
  page.drawText(label, { x: PAGE_W - MARGIN - fonts.regular.widthOfTextAtSize(label, 9), y: 32, size: 9, font: fonts.regular, color: MUTED });
}

function signedAtLine(iso: string, tz: string) {
  return `${formatPracticeMdY(iso, tz)} ${formatPracticeTime(iso, tz)} ${practiceZoneLabel(tz)}`;
}

export async function buildCarelonPdf(input: CarelonPdfInput): Promise<Uint8Array> {
  const t = input.template;
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} - ${t.subtitle}`);
  doc.setSubject(`${t.formKey} version ${t.version}`);
  doc.setProducer('Altrixs');
  doc.setCreator('Altrixs');
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const tz = input.timeZone;
  const header = (c: Cursor, small = false) => {
    c.text(t.title, { size: small ? 11 : 16, bold: true, gap: 2 });
    c.text(t.subtitle, { size: small ? 9 : 12, bold: true, gap: 2 });
    c.rule(small ? 6 : 10);
  };

  // ── Page 1: header, participant / provider information, purpose ──
  const p1 = new Cursor(doc.addPage([PAGE_W, PAGE_H]), fonts);
  header(p1);
  p1.text(t.participantInfo.heading, { size: 12, bold: true, gap: 2 });
  p1.field(t.participantInfo.fields[0].label, input.participant.participantName);
  const half = (CONTENT_W - 18) / 2;
  const b1 = p1.field(t.participantInfo.fields[1].label, input.participant.participantId, { width: half, keepY: true });
  const b2 = p1.field(t.participantInfo.fields[2].label, input.participant.dateOfBirth, { width: half, x: half + 18, keepY: true });
  p1.y = Math.min(b1, b2) - 6;
  p1.text(t.providerInfo.heading, { size: 12, bold: true, gap: 2 });
  p1.field(t.providerInfo.fields[0].label, input.provider.organizationName);
  const b3 = p1.field(t.providerInfo.fields[1].label, input.provider.npi, { width: half, keepY: true });
  const b4 = p1.field(t.providerInfo.fields[2].label, formatTin(input.provider.tin) ?? input.provider.tin, { width: half, x: half + 18, keepY: true });
  p1.y = Math.min(b3, b4) - 6;
  p1.text(t.purpose.heading, { size: 12, bold: true, gap: 4 });
  for (const para of t.purpose.paragraphs) p1.text(para, { size: 10, gap: 8 });

  // ── Page 2: Part A ──
  const p2 = new Cursor(doc.addPage([PAGE_W, PAGE_H]), fonts);
  header(p2, true);
  const a = input.partA;
  p2.text(t.partA.heading, { size: 12, bold: true, gap: 4 });
  p2.text(t.partA.lead, { size: 10, gap: 6 });
  p2.text(t.partA.statement1.before, { size: 10, gap: 4 });
  p2.checkbox(a?.signerType === 'participant', t.partA.statement1.optionParticipant, 14);
  p2.text(t.partA.statement1.or, { size: 10, bold: true, indent: 14, gap: 4 });
  p2.checkbox(a?.signerType === 'representative', t.partA.statement1.optionRepresentative, 14);
  for (const s of t.partA.statements) p2.text(s, { size: 10, gap: 6 });
  p2.y -= 4;
  const rep = a?.signerType === 'representative';
  p2.field(t.partA.fields[0].label, a?.printedName ?? null);
  p2.field(t.partA.fields[1].label, rep ? a?.relationship ?? null : null);
  p2.field(t.partA.fields[2].label, rep ? a?.authority ?? null : null);
  const s1 = p2.field(t.partA.fields[3].label, a?.signature ?? null, { italicValue: true, width: CONTENT_W * 0.62, keepY: true });
  const s2 = p2.field(t.partA.fields[4].label, a?.dateSigned ?? null, { width: CONTENT_W * 0.33, x: CONTENT_W * 0.67, keepY: true });
  p2.y = Math.min(s1, s2);

  // ── Page 3: Part B + electronic signature record ──
  const p3 = new Cursor(doc.addPage([PAGE_W, PAGE_H]), fonts);
  header(p3, true);
  const b = input.partB;
  p3.text(t.partB.heading, { size: 12, bold: true, gap: 4 });
  p3.text(t.partB.lead, { size: 10, gap: 6 });
  for (const s of t.partB.statements) p3.text(s, { size: 10, gap: 6 });
  p3.y -= 4;
  const n1 = p3.field(t.partB.fields[0].label, b?.printedName ?? null, { width: CONTENT_W * 0.55, keepY: true });
  const n2 = p3.field(t.partB.fields[1].label, b?.title ?? null, { width: CONTENT_W * 0.4, x: CONTENT_W * 0.6, keepY: true });
  p3.y = Math.min(n1, n2);
  const s3 = p3.field(t.partB.fields[2].label, b?.signature ?? null, { italicValue: true, width: CONTENT_W * 0.62, keepY: true });
  const s4 = p3.field(t.partB.fields[3].label, b?.dateSigned ?? null, { width: CONTENT_W * 0.33, x: CONTENT_W * 0.67, keepY: true });
  p3.y = Math.min(s3, s4) - 10;

  const record: string[] = [];
  if (a) {
    const how = a.method === 'portal' ? 'patient portal' : a.method === 'intake' ? 'intake packet' : `in office${a.recordedByName ? `, recorded by ${a.recordedByName}` : ''}`;
    record.push(`Part A signed electronically (typed signature, ${how}) on ${signedAtLine(a.signedAt, tz)}.`);
  }
  if (b) record.push(`Part B signed electronically (typed signature) on ${signedAtLine(b.signedAt, tz)}.`);
  if (input.submission) record.push(`Submitted to Carelon through the provider portal on ${input.submission.submittedOn}${input.submission.recordedByName ? ` (recorded by ${input.submission.recordedByName})` : ''}${input.submission.reference ? `, reference ${input.submission.reference}` : ''}.`);
  record.push(`Form version ${t.version}${input.recordId ? ` · record ${input.recordId}` : ''} · generated ${signedAtLine(input.generatedAt.toISOString(), tz)} by Altrixs.`);
  if (a || b) p3.text('Electronic signature record', { size: 8, bold: true, color: MUTED, gap: 1 });
  for (const r of record) p3.text(r, { size: 7.5, color: MUTED, gap: 1, lineGap: 2 });

  const pages = doc.getPages();
  pages.forEach((pg, i) => footer(pg, fonts, t.footer, i + 1, pages.length));
  return doc.save();
}
