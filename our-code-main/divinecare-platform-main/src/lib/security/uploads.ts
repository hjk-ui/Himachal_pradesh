export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_PAGES = 30;
export const MAX_TEXT_CHARACTERS = 30_000;

export function sanitizeFilename(value: string) {
  const base = value.split(/[\\/]/).pop() || 'document';
  return base.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').slice(0, 160) || 'document';
}

export function isSafeDocumentId(value: string) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export async function readFileBounded(file: File, maxBytes = MAX_DOCUMENT_BYTES) {
  if (file.size > maxBytes) throw new Error('File must be 2 MB or smaller');
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('File must be 2 MB or smaller');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(result);
}

export function validatePdf(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Invalid PDF file');
  const source = buffer.toString('latin1');
  const pageCount = source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pageCount < 1) throw new Error('PDF page structure is not supported');
  if (pageCount > MAX_PDF_PAGES) throw new Error('PDF must have 30 pages or fewer');
  return pageCount;
}

export function validateUtf8Text(buffer: Buffer) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (text.length > MAX_TEXT_CHARACTERS) throw new Error('Text file must contain 30,000 characters or fewer');
  return text;
}

function startsWith(buffer: Buffer, bytes: number[]) {
  return bytes.every((value, index) => buffer[index] === value);
}

export function validateDocumentBytes(buffer: Buffer, mimeType: string, filename: string) {
  const lower = filename.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    validatePdf(buffer);
    return;
  }
  if (mimeType === 'text/plain' || lower.endsWith('.txt')) {
    validateUtf8Text(buffer);
    return;
  }
  const validImage =
    startsWith(buffer, [0xff, 0xd8, 0xff]) ||
    startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF89a' ||
    (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
  const validOffice = startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (!validImage && !validOffice) throw new Error('File content does not match an allowed document type');
}
