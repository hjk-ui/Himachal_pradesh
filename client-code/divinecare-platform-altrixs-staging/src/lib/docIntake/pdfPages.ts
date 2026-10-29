/**
 * Copy selected pages of a PDF into a new PDF (pdf-lib, pure JS). Used to file one patient's part
 * of a multi-patient upload without ever attaching the whole file to a chart.
 */
import { PDFDocument } from 'pdf-lib';

export class PdfPagesError extends Error {}

/**
 * pageNumbers are 1-based. With expectedPageCount, refuses a PDF whose page count differs from
 * what OCR read (the page numbers would point at the wrong pages).
 */
export async function extractPdfPages(
  source: Uint8Array,
  pageNumbers: number[],
  expectedPageCount?: number | null
): Promise<Uint8Array> {
  if (!pageNumbers.length) throw new PdfPagesError('No pages selected.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source);
  } catch (err) {
    const m = err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'unknown error';
    throw new PdfPagesError(`The original PDF could not be opened (${m}).`);
  }
  const total = doc.getPageCount();
  if (expectedPageCount && expectedPageCount !== total) {
    throw new PdfPagesError(`The original PDF has ${total} pages but ${expectedPageCount} were read; not filing.`);
  }
  const indices = pageNumbers.map((n) => n - 1);
  if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= total)) {
    throw new PdfPagesError('Page numbers are outside the original PDF.');
  }
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(doc, indices)) out.addPage(page);
  return out.save();
}
