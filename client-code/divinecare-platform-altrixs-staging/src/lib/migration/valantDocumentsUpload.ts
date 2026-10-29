/**
 * Browser-safe helpers for the Valant documents ZIP upload (no server imports: the admin page
 * bundles this file).
 */

const MIN_PART_BYTES = 16 * 1024 * 1024;
const MAX_PART_COUNT = 9000;

/** S3 multipart part size for a file (whole MB, at least 16 MB, at most 9000 parts); same on server and browser */
export function multipartPartSize(fileSize: number): number {
  return Math.max(MIN_PART_BYTES, Math.ceil(fileSize / MAX_PART_COUNT / (1024 * 1024)) * 1024 * 1024);
}

export const partCount = (fileSize: number) => Math.ceil(fileSize / multipartPartSize(fileSize));
