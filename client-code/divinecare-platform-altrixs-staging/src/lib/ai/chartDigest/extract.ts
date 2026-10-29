/**
 * Text extraction for chart documents (digest pipeline). No prisma / AWS imports: the store passes
 * real dependencies (store.ts), tests pass fakes.
 *
 * Order, cheapest first:
 *  1. cached by this pipeline (textExtractedAt + pageTexts);
 *  2. text already on the row from intake OCR (pageTexts / extractedText);
 *  3. PDF text layer, read locally (unpdf, no network);
 *  4. Textract only for pages with no text layer (scanned): those pages are copied into a small
 *     PDF (pdf-lib) and sent to async text detection; the job id is kept on the row and polled on
 *     the next run (never blocks a request). Images go to synchronous DetectDocumentText.
 * The result is cached on the DocumentIntake row (extractedText, pageTexts, pageCount, textMethod,
 * textExtractedAt). Page counts feed the cost estimator.
 */

/** A page with fewer characters than this is treated as scanned (no usable text layer) */
export const MIN_TEXT_LAYER_CHARS = 40;

export type ExtractDoc = {
  id: string;
  mimeType: string | null;
  fileName: string | null;
  s3RawKey: string;
  extractedText: string | null;
  pageTexts: unknown;
  pageCount: number | null;
  textMethod: string | null;
  textExtractedAt: Date | null;
  textOcrJobId: string | null;
};

export type TextMethod = 'existing' | 'pdf_text' | 'textract' | 'pdf_text+textract' | 'none';

export type OcrPoll = { state: 'running' } | { state: 'done'; pages: string[] } | { state: 'failed'; error: string };

export type ExtractDeps = {
  readFile(storedName: string): Promise<Uint8Array | null>;
  /** Text of each PDF page (index 0 = page 1) */
  pdfPageTexts(bytes: Uint8Array): Promise<string[]>;
  /** Copy the given 1-based pages into a new PDF */
  pdfSubset(bytes: Uint8Array, pages: number[]): Promise<Uint8Array>;
  textractConfigured(): boolean;
  startPdfOcr(docId: string, bytes: Uint8Array): Promise<string>;
  pollPdfOcr(docId: string, jobId: string): Promise<OcrPoll>;
  ocrImage(bytes: Uint8Array): Promise<string[]>;
  save(docId: string, data: { pages: string[]; method: TextMethod; ocrJobId: string | null; at: Date }): Promise<void>;
  now?: () => Date;
};

export type ExtractResult =
  | { state: 'ready'; pages: string[]; method: TextMethod; pageCount: number; scannedPages: number; ocrStarted?: undefined; reason?: undefined }
  | { state: 'pending'; pageCount: number; scannedPages: number; ocrStarted: boolean; pages?: undefined; method?: undefined; reason?: undefined }
  | { state: 'unavailable'; reason: 'file_missing' | 'unsupported_type' | 'ocr_not_configured' | 'ocr_failed' | 'read_failed'; pageCount: number; pages?: undefined; method?: undefined; scannedPages?: undefined; ocrStarted?: undefined };

export function storedPages(pageTexts: unknown): string[] | null {
  if (!Array.isArray(pageTexts)) return null;
  const pages = pageTexts.map((p) => (typeof p === 'string' ? p : ''));
  return pages.length ? pages : null;
}

export const isPdf = (d: Pick<ExtractDoc, 'mimeType' | 'fileName'>) => /pdf/i.test(d.mimeType ?? '') || /\.pdf$/i.test(d.fileName ?? '');
export const isImage = (d: Pick<ExtractDoc, 'mimeType' | 'fileName'>) => /^image\/(jpe?g|png)$/i.test(d.mimeType ?? '') || /\.(jpe?g|png)$/i.test(d.fileName ?? '');

/** Pages (1-based) with no usable text layer */
export function scannedPageNumbers(pages: string[]): number[] {
  return pages.map((p, i) => ({ n: i + 1, c: p.replace(/\s+/g, '').length })).filter((p) => p.c < MIN_TEXT_LAYER_CHARS).map((p) => p.n);
}

/** textOcrJobId = "<jobId>|<pages>" so the poll result maps back to the original page numbers */
export const encodeOcrJob = (jobId: string, pages: number[]) => `${jobId}|${pages.join(',')}`;
export function decodeOcrJob(v: string): { jobId: string; pages: number[] } {
  const [jobId, list = ''] = v.split('|');
  return { jobId, pages: list.split(',').map((n) => Number.parseInt(n, 10)).filter((n) => n > 0) };
}

/** Put OCR page texts back at their original positions */
export function mergeOcrPages(textPages: string[], ocrPages: string[], pageNumbers: number[], pageCount: number): string[] {
  const out = Array.from({ length: Math.max(pageCount, textPages.length) }, (_, i) => textPages[i] ?? '');
  pageNumbers.forEach((n, i) => {
    if (n >= 1 && n <= out.length) out[n - 1] = ocrPages[i] ?? '';
  });
  return out;
}

export async function extractDocumentText(deps: ExtractDeps, doc: ExtractDoc, opts: { allowOcr: boolean }): Promise<ExtractResult> {
  const now = (deps.now ?? (() => new Date()))();
  const cached = storedPages(doc.pageTexts);
  if (doc.textExtractedAt && cached && !doc.textOcrJobId) {
    return { state: 'ready', pages: cached, method: (doc.textMethod as TextMethod) || 'existing', pageCount: cached.length, scannedPages: 0 };
  }

  // Pending Textract job from an earlier run
  if (doc.textOcrJobId) {
    const { jobId, pages: ocrPages } = decodeOcrJob(doc.textOcrJobId);
    const poll = await deps.pollPdfOcr(doc.id, jobId);
    const base = cached ?? [];
    const pageCount = Math.max(doc.pageCount ?? 0, base.length);
    if (poll.state === 'running') return { state: 'pending', pageCount, scannedPages: ocrPages.length, ocrStarted: false };
    if (poll.state === 'failed') {
      // Keep whatever the text layer gave; the scanned pages stay empty
      await deps.save(doc.id, { pages: base, method: base.some((p) => p.trim()) ? 'pdf_text' : 'none', ocrJobId: null, at: now });
      return base.some((p) => p.trim())
        ? { state: 'ready', pages: base, method: 'pdf_text', pageCount, scannedPages: ocrPages.length }
        : { state: 'unavailable', reason: 'ocr_failed', pageCount };
    }
    const pages = ocrPages.length ? mergeOcrPages(base, poll.pages, ocrPages, pageCount) : poll.pages;
    const method: TextMethod = base.some((p) => p.trim()) ? 'pdf_text+textract' : 'textract';
    await deps.save(doc.id, { pages, method, ocrJobId: null, at: now });
    return { state: 'ready', pages, method, pageCount: pages.length, scannedPages: ocrPages.length };
  }

  // Text from intake OCR already on the row
  if (cached && cached.some((p) => p.trim())) {
    await deps.save(doc.id, { pages: cached, method: 'existing', ocrJobId: null, at: now });
    return { state: 'ready', pages: cached, method: 'existing', pageCount: cached.length, scannedPages: 0 };
  }
  if (doc.extractedText?.trim()) {
    const pages = doc.extractedText.split('\f');
    await deps.save(doc.id, { pages, method: 'existing', ocrJobId: null, at: now });
    return { state: 'ready', pages, method: 'existing', pageCount: pages.length, scannedPages: 0 };
  }

  if (!isPdf(doc) && !isImage(doc)) return { state: 'unavailable', reason: 'unsupported_type', pageCount: doc.pageCount ?? 0 };
  let bytes: Uint8Array | null;
  try {
    bytes = doc.s3RawKey && doc.s3RawKey !== 'pending' ? await deps.readFile(doc.s3RawKey) : null;
  } catch {
    return { state: 'unavailable', reason: 'read_failed', pageCount: doc.pageCount ?? 0 };
  }
  if (!bytes) return { state: 'unavailable', reason: 'file_missing', pageCount: doc.pageCount ?? 0 };

  if (isImage(doc)) {
    if (!opts.allowOcr || !deps.textractConfigured()) return { state: 'unavailable', reason: 'ocr_not_configured', pageCount: 1 };
    const pages = await deps.ocrImage(bytes);
    await deps.save(doc.id, { pages, method: 'textract', ocrJobId: null, at: now });
    return { state: 'ready', pages, method: 'textract', pageCount: pages.length, scannedPages: 1 };
  }

  let textPages: string[];
  try {
    textPages = await deps.pdfPageTexts(bytes);
  } catch {
    return { state: 'unavailable', reason: 'read_failed', pageCount: doc.pageCount ?? 0 };
  }
  const scanned = scannedPageNumbers(textPages);
  // Blank the near-empty pages so a stray header is not mistaken for content
  const cleaned = textPages.map((p, i) => (scanned.includes(i + 1) ? '' : p));
  if (!scanned.length) {
    await deps.save(doc.id, { pages: cleaned, method: 'pdf_text', ocrJobId: null, at: now });
    return { state: 'ready', pages: cleaned, method: 'pdf_text', pageCount: cleaned.length, scannedPages: 0 };
  }
  if (!opts.allowOcr || !deps.textractConfigured()) {
    if (cleaned.some((p) => p.trim())) {
      // Usable text-layer pages now; scanned pages are left for a later OCR run (not cached as done)
      return { state: 'ready', pages: cleaned, method: 'pdf_text', pageCount: cleaned.length, scannedPages: scanned.length };
    }
    return { state: 'unavailable', reason: 'ocr_not_configured', pageCount: cleaned.length };
  }
  const subset = scanned.length === cleaned.length ? bytes : await deps.pdfSubset(bytes, scanned);
  const jobId = await deps.startPdfOcr(doc.id, subset);
  await deps.save(doc.id, { pages: cleaned, method: 'pdf_text', ocrJobId: encodeOcrJob(jobId, scanned), at: now });
  return { state: 'pending', pageCount: cleaned.length, scannedPages: scanned.length, ocrStarted: true };
}

/** Local-only inspection for the estimator: page count and text-vs-scanned pages (no AWS) */
export async function inspectPdfText(deps: Pick<ExtractDeps, 'pdfPageTexts'>, bytes: Uint8Array): Promise<{ pageCount: number; pageChars: number[]; scannedPages: number }> {
  const pages = await deps.pdfPageTexts(bytes);
  const scanned = scannedPageNumbers(pages);
  return { pageCount: pages.length, pageChars: pages.map((p, i) => (scanned.includes(i + 1) ? 0 : p.length)), scannedPages: scanned.length };
}
