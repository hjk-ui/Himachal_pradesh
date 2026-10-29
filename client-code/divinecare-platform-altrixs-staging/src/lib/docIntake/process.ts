/**
 * Smart Document Intake pipeline: store → OCR (Textract) → classify (Claude) → match patient.
 *
 * Nothing here files to a chart: a document ends in status 'ready' with a suggested client
 * (only for a confident match), and staff confirm, change or reject it in the intake queue.
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { uploadDir, uploadPath } from '@/lib/storage/privateUploads';
import { isOcrConfigured, isPdfOcrConfigured, ocrImage, pollPdfOcr, startPdfOcr, type OcrText } from './ocr';
import { applyClassification, classifyDocument, FILING_PATH, type DocType } from './classify';
import { extractPatientIdentifiers, matchPatient } from './patientMatcher';
import { loadRoster } from './roster';
import { classifySplitChildren, createSplitChildren, segmentDocument } from './split';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const KIND = 'intake-docs' as const;

type FileType = { ext: 'pdf' | 'jpg' | 'png'; mime: string };

/** Sniff the real type from the bytes; the browser's content type is not trusted */
export function detectFileType(bytes: Uint8Array): FileType | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: 'pdf', mime: 'application/pdf' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  return null;
}

export function ocrUnavailableReason(type: FileType): string | null {
  if (!isOcrConfigured()) return 'Text extraction (Textract) is not configured on this server.';
  if (type.ext === 'pdf' && !isPdfOcrConfigured()) return 'PDF text extraction needs DOC_INTAKE_S3_BUCKET on this server.';
  return null;
}

export async function createIntakeDocument(input: {
  organizationId: string;
  userId: string;
  fileName: string;
  bytes: Uint8Array;
  type: FileType;
}) {
  const doc = await prisma.documentIntake.create({
    data: {
      source: 'Upload',
      documentType: 'Unclassified',
      confidenceScore: 0,
      suggestedFilingPath: 'Pending review',
      s3RawKey: 'pending',
      status: 'processing',
      organizationId: input.organizationId,
      uploadedById: input.userId,
      fileName: input.fileName.slice(0, 200),
      mimeType: input.type.mime,
      fileSize: input.bytes.byteLength,
      extractedFields: [],
    },
  });

  // Stored privately; served only through /api/files/intake-docs/<name> after an org check
  const storedName = `${doc.id}.${input.type.ext}`;
  const abs = uploadPath(KIND, storedName);
  if (!abs) throw new Error('Invalid stored file name');
  await mkdir(uploadDir(KIND), { recursive: true });
  await writeFile(abs, input.bytes);
  await prisma.documentIntake.update({ where: { id: doc.id }, data: { s3RawKey: storedName } });

  try {
    if (input.type.ext === 'pdf') {
      const jobId = await startPdfOcr(doc.id, input.bytes);
      await prisma.documentIntake.update({ where: { id: doc.id }, data: { ocrJobId: jobId } });
    } else {
      await finalize(doc.id, await ocrImage(input.bytes));
    }
  } catch (err) {
    await markReadyWithError(doc.id, `Text extraction failed: ${errorMessage(err)}`);
  }
  return doc.id;
}

/** Move this organization's running OCR jobs forward; called by the queue's GET (the page polls). */
export async function advanceProcessing(organizationId: string) {
  const running = await prisma.documentIntake.findMany({
    where: { organizationId, status: 'processing', ocrJobId: { not: null } },
    select: { id: true, ocrJobId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  for (const doc of running) {
    try {
      const poll = await pollPdfOcr(doc.id, doc.ocrJobId!);
      if (poll.state === 'running') {
        if (Date.now() - doc.createdAt.getTime() > 30 * 60 * 1000) {
          await markReadyWithError(doc.id, 'Text extraction did not finish within 30 minutes.');
        }
        continue;
      }
      if (poll.state === 'failed') {
        await markReadyWithError(doc.id, `Text extraction failed: ${poll.error}`);
        continue;
      }
      // Two polls (tabs, refreshes) can both see the finished job: only the one that claims it finalizes
      const claimed = await prisma.documentIntake.updateMany({
        where: { id: doc.id, status: 'processing', ocrJobId: doc.ocrJobId },
        data: { ocrJobId: null },
      });
      if (claimed.count !== 1) continue;
      await finalize(doc.id, poll.result);
    } catch (err) {
      await markReadyWithError(doc.id, `Text extraction failed: ${errorMessage(err)}`);
    }
  }
  // Parts of a split multi-patient file wait here for classification
  await classifySplitChildren(organizationId);
}

/**
 * Read a stored PDF again with Textract (e.g. an older upload whose page texts were not kept).
 * Only for a document still waiting in the queue; nothing that was filed is touched.
 */
export async function reprocessDocument(id: string, organizationId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const doc = await prisma.documentIntake.findFirst({
    where: { id, organizationId },
    select: { status: true, parentId: true, mimeType: true, s3RawKey: true },
  });
  if (!doc) return { ok: false, status: 404, error: 'Document not found' };
  if (doc.parentId || doc.status !== 'ready') return { ok: false, status: 409, error: 'Only a document waiting for review can be re-processed' };
  if (doc.mimeType !== 'application/pdf') return { ok: false, status: 400, error: 'Only PDF documents can be re-processed' };
  const unavailable = ocrUnavailableReason({ ext: 'pdf', mime: 'application/pdf' });
  if (unavailable) return { ok: false, status: 503, error: unavailable };
  const bytes = await readIntakeFile(doc.s3RawKey);
  if (!bytes) return { ok: false, status: 404, error: 'The stored file is missing' };
  const claimed = await prisma.documentIntake.updateMany({
    where: { id, status: 'ready' },
    data: { status: 'processing', processingError: null, suggestedClientId: null, matchStatus: null, matchReason: null },
  });
  if (claimed.count !== 1) return { ok: false, status: 409, error: 'This document changed; refresh and try again' };
  try {
    const jobId = await startPdfOcr(id, bytes, `${id}-r${Date.now()}`);
    await prisma.documentIntake.update({ where: { id }, data: { ocrJobId: jobId } });
  } catch (err) {
    await markReadyWithError(id, `Text extraction failed: ${errorMessage(err)}`);
  }
  return { ok: true };
}

async function markReadyWithError(id: string, message: string) {
  // Only a document still being read: never undo a finished split or filing
  await prisma.documentIntake.updateMany({
    where: { id, status: 'processing' },
    data: { status: 'ready', ocrJobId: null, processingError: message.slice(0, 500), suggestedFilingPath: FILING_PATH.Unclassified },
  });
}

async function finalize(id: string, ocr: OcrText) {
  const { text, pageCount, pages } = ocr;
  const doc = await prisma.documentIntake.findUniqueOrThrow({
    where: { id },
    select: { organizationId: true, fileName: true },
  });
  const organizationId = doc.organizationId!;
  const fileName = doc.fileName || '';

  if (!text.trim()) {
    await prisma.documentIntake.update({
      where: { id },
      data: {
        status: 'ready', ocrJobId: null, pageCount, extractedText: '', pageTexts: pages,
        processingError: 'No readable text was found in this document.',
        suggestedFilingPath: FILING_PATH.Unclassified, matchStatus: 'unmatched', matchReason: 'No text to match on',
      },
    });
    return;
  }

  // Several patients in one file (e.g. a Valant export): one child document per patient
  if (pages.length > 1) {
    const { groups, split } = await segmentDocument(organizationId, pages);
    if (split) {
      await prisma.documentIntake.update({
        where: { id },
        data: { pageCount, extractedText: text.slice(0, 200_000), pageTexts: pages },
      });
      await createSplitChildren(id, groups, pages, { userId: null, role: 'system' }, { trigger: 'upload' });
      return;
    }
  }

  // Identity: printed identifiers first, the model only fills gaps; matching is always rule-based
  const ids = extractPatientIdentifiers(text, fileName);
  let documentType: DocType = 'Unclassified';
  let confidence = 0;
  let fields: { label: string; value: string }[] = [];
  let processingError: string | null = null;
  try {
    const c = await classifyDocument(text, fileName);
    documentType = c.documentType;
    confidence = c.confidence;
    fields = applyClassification(c, ids);
  } catch (err) {
    processingError = `AI classification unavailable (${errorMessage(err)}). Review and classify manually.`;
  }

  const roster = await loadRoster(organizationId, ids.sourceIds, ids.dob);
  const match = matchPatient(ids, roster);

  await prisma.documentIntake.update({
    where: { id },
    data: {
      status: 'ready',
      ocrJobId: null,
      pageCount,
      extractedText: text.slice(0, 200_000),
      pageTexts: pages,
      documentType,
      confidenceScore: confidence,
      extractedFields: fields,
      suggestedFilingPath: FILING_PATH[documentType],
      // Only a confident match pre-selects a client; staff still confirm every filing
      suggestedClientId: match.status === 'matched' ? match.clientId! : null,
      matchStatus: match.status,
      matchReason: match.reason.slice(0, 300),
      matchCandidates: match.candidates.slice(0, 5) as unknown as Prisma.InputJsonValue,
      processingError,
    },
  });
}

export async function readIntakeFile(storedName: string) {
  const abs = uploadPath(KIND, storedName);
  return abs ? readFile(abs) : null;
}

function errorMessage(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0].slice(0, 200);
}
