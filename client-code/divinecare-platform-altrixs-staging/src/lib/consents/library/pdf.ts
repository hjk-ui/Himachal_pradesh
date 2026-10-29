/**
 * Signed consent PDF (pdf-lib): one or more frozen sections (exact text as signed, template key +
 * version + SHA-256), the signer's responses, and the electronic signature record. Pure: callers
 * pass the frozen record from ConsentForm.formData / ConsentPacket.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { pdfSafe, wrapText } from '@/lib/consents/carelon/pdf';
import { formatPracticeTime, practiceZoneLabel } from '@/lib/time/practiceTime';
import { formatPracticeMdY } from '@/lib/consents/carelon/prefill';
import type { FrozenSection } from './types';
import type { SectionResponse } from './signing';

export type PdfSection = {
  frozen: FrozenSection;
  response: SectionResponse | null;
  /** standalone authorization signed separately */
  ownSignature: { typed: string; signedAt: string } | null;
  declined: boolean;
  revoked: { at: string; method: string; receivedVia: string } | null;
};

export type ConsentPdfInput = {
  title: string;
  practiceName: string | null;
  clientName: string;
  clientDob: string | null;
  sections: PdfSection[];
  signer: { signerType: 'self' | 'representative'; printedName: string; relationship: string | null; authority: string | null; signature: string; signedAt: string; method: string; recordedByName: string | null } | null;
  recordId: string;
  timeZone: string;
  generatedAt: Date;
  /** E-signature audit trail (evidence.ts evidenceLines): sent / viewed / signed, device, witness, hashes */
  auditTrail?: string[];
};

const W = 612;
const H = 792;
const M = 54;
const CW = W - M * 2;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.38, 0.38, 0.42);
const BRAND = rgb(0.36, 0.18, 0.57);

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

class Flow {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private fonts: Fonts, private header: string) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
    this.page.drawText(pdfSafe(this.header), { x: M, y: H - 34, size: 8, font: this.fonts.regular, color: MUTED });
  }
  ensure(h: number) {
    if (this.y - h < M + 20) this.newPage();
  }
  text(t: string, o: { size?: number; bold?: boolean; italic?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.fonts.bold : o.italic ? this.fonts.italic : this.fonts.regular;
    const indent = o.indent ?? 0;
    for (const l of wrapText(t, font, size, CW - indent)) {
      this.ensure(size + 4);
      this.y -= size + 3.5;
      this.page.drawText(l, { x: M + indent, y: this.y, size, font, color: o.color ?? INK });
    }
    this.y -= o.gap ?? 5;
  }
}

function dt(iso: string, tz: string) {
  return `${formatPracticeMdY(iso, tz)} ${formatPracticeTime(iso, tz)} ${practiceZoneLabel(tz)}`;
}

function valueText(v: string | string[] | boolean | undefined, labels?: { value: string; label: string }[]): string {
  if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const one = (x: string) => labels?.find((o) => o.value === x)?.label ?? x;
  return Array.isArray(v) ? v.map(one).join('; ') : one(v);
}

export async function buildConsentPdf(input: ConsentPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setProducer('Altrixs');
  doc.setCreator('Altrixs');
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const f = new Flow(doc, fonts, `${input.practiceName ?? ''} · ${input.title} · ${input.clientName}`);
  f.text(input.practiceName ?? '', { size: 10, bold: true, color: BRAND, gap: 2 });
  f.text(input.title, { size: 15, bold: true, gap: 4 });
  f.text(`Client: ${input.clientName}${input.clientDob ? ` · Date of birth ${input.clientDob}` : ''}`, { size: 10, gap: 10 });

  for (const s of input.sections) {
    const fr = s.frozen;
    f.ensure(60);
    f.text(fr.title, { size: 12, bold: true, color: BRAND, gap: 2 });
    f.text(`Template ${fr.key} · version ${fr.version} · text SHA-256 ${fr.sha256.slice(0, 16)}…`, { size: 7, color: MUTED, gap: 6 });
    for (const b of fr.blocks) {
      if (b.kind === 'h') f.text(b.text, { size: 10.5, bold: true, gap: 3 });
      else if (b.kind === 'p') f.text(b.text);
      else if (b.kind === 'note') f.text(b.text, { italic: true });
      else if (b.kind === 'lead') f.text(`${b.label} ${b.text}`);
      else b.items.forEach((it, i) => f.text(`${b.kind === 'ol' ? `${i + 1}.` : '-'} ${it}`, { indent: 12, gap: 2 }));
    }
    const r = s.response;
    if (s.declined) f.text('The signer DECLINED this authorization.', { bold: true, gap: 6 });
    else if (r) {
      for (const c of fr.choices) f.text(`${c.label}: ${valueText(r.choices?.[c.key], c.options)}`, { size: 9, bold: true, gap: 2 });
      for (const c of fr.checkboxes) f.text(`[${r.checkboxes?.[c.key] ? 'X' : ' '}] ${c.label}`, { size: 9, gap: 2 });
      for (const fd of fr.fields) f.text(`${fd.label}: ${valueText(r.fields?.[fd.key], fd.options)}`, { size: 9, gap: 2 });
      f.text(`[${r.acknowledged ? 'X' : ' '}] ${fr.acknowledgment}`, { size: 9, bold: true, gap: 4 });
    }
    if (s.ownSignature) f.text(`Signed separately (typed signature): ${s.ownSignature.typed} on ${dt(s.ownSignature.signedAt, input.timeZone)}`, { size: 9, italic: true, gap: 4 });
    if (s.revoked) f.text(`REVOKED on ${s.revoked.at.slice(0, 10)} (${s.revoked.method}, received ${s.revoked.receivedVia}).`, { size: 9, bold: true, gap: 4 });
    f.y -= 6;
  }

  f.ensure(110);
  f.text('Signature', { size: 12, bold: true, color: BRAND, gap: 4 });
  const sg = input.signer;
  if (sg) {
    f.text(`Printed name: ${sg.printedName}`, { size: 10, gap: 2 });
    if (sg.signerType === 'representative') {
      f.text(`Signed as representative · Relationship to the client: ${sg.relationship ?? '—'}`, { size: 10, gap: 2 });
      f.text(`Authority: ${sg.authority ?? '—'}`, { size: 10, gap: 2 });
    } else f.text('Signed by the client', { size: 10, gap: 2 });
    f.text(`Signature: ${sg.signature}`, { size: 13, italic: true, gap: 2 });
    f.text(`Date: ${formatPracticeMdY(sg.signedAt, input.timeZone)}`, { size: 10, gap: 8 });
    f.text(`Signed electronically (typed signature, ${sg.method === 'portal' ? 'patient portal' : sg.method === 'intake' ? 'intake packet' : `in office${sg.recordedByName ? `, recorded by ${sg.recordedByName}` : ''}`}) on ${dt(sg.signedAt, input.timeZone)}.`, { size: 7.5, color: MUTED, gap: 1 });
  } else f.text('Not signed.', { size: 10 });
  if (input.auditTrail?.length) {
    f.ensure(40);
    f.text('Audit trail', { size: 10, bold: true, color: BRAND, gap: 2 });
    for (const line of input.auditTrail) f.text(line, { size: 7.5, color: MUTED, gap: 1 });
    f.y -= 4;
  }
  f.text(`Record ${input.recordId} · generated ${dt(input.generatedAt.toISOString(), input.timeZone)} by Altrixs.`, { size: 7.5, color: MUTED, gap: 1 });

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: W - M - fonts.regular.widthOfTextAtSize(label, 8), y: 30, size: 8, font: fonts.regular, color: MUTED });
  });
  return doc.save();
}
