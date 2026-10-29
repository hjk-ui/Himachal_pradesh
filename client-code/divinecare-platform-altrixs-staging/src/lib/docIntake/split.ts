/**
 * Multi-patient documents (e.g. a Valant export holding many clients): find each patient's pages,
 * split the upload into one child document per patient, and build a PDF of just a child's pages
 * when staff file it. The original multi-patient file is never attached to a single chart.
 *
 * Nothing is filed here: children end in the review queue like any other document.
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { uploadDir, uploadPath } from '@/lib/storage/privateUploads';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { applyClassification, classifyDocument, FILING_PATH, type DocType } from './classify';
import { extractPatientIdentifiers, matchPatient, type ExtractedIdentifiers } from './patientMatcher';
import { extractPdfPages, PdfPagesError } from './pdfPages';
import { loadRoster, loadRosterForPages } from './roster';
import {
  formatPages,
  hasIdentifiers,
  identityKey,
  resolvePageTexts,
  segmentPages,
  shouldSplit,
  type PageGroup,
  type PageMatch,
} from './segment';

const KIND = 'intake-docs' as const;
export const SPLIT_FILING_PATH = 'Split by patient: file each part';

/** A split or child-PDF step that must stop without changing anything; the message is shown to staff */
export class IntakeSplitError extends Error {}

/** Identifiers and roster match for every page. The file name is not used: it names one patient at most. */
export async function matchPages(organizationId: string, pages: string[]): Promise<PageMatch[]> {
  const ids = pages.map((text) => extractPatientIdentifiers(text, ''));
  const rosters = await loadRosterForPages(organizationId, ids);
  return ids.map((pageIds, i): PageMatch => {
    const page = i + 1;
    if (!hasIdentifiers(pageIds)) return { page, kind: 'none' };
    const m = matchPatient(pageIds, rosters[i]);
    if (m.status === 'matched' && m.clientId) {
      const client = rosters[i].find((c) => c.clientId === m.clientId);
      return { page, kind: 'matched', clientId: m.clientId, lastName: client?.lastName, reason: m.reason };
    }
    return {
      page,
      kind: 'unresolved',
      key: identityKey(pageIds) ?? `page-${page}`,
      lastName: pageIds.lastName,
      nameOnly: Boolean(pageIds.lastName) && !pageIds.dob && pageIds.sourceIds.length === 0,
      reason: m.reason,
      candidates: m.candidates,
    };
  });
}

export async function segmentDocument(organizationId: string, pages: string[]) {
  const groups = segmentPages(await matchPages(organizationId, pages));
  return { groups, split: shouldSplit(groups) };
}

const textOf = (pages: string[], numbers: number[]) =>
  numbers.map((n) => pages[n - 1] ?? '').join('\n\n');

function childFileName(parentName: string, pages: number[]) {
  const stem = (parentName || 'document').replace(/\.pdf$/i, '');
  const suffix = ` (pages ${formatPages(pages).replace(/–/g, '-')}).pdf`;
  return stem.slice(0, 200 - suffix.length) + suffix;
}

/**
 * Turn a processed document into one child per group. The parent keeps the original file and
 * page texts, gets status 'split' and no client, so it never lands on a chart.
 */
export async function createSplitChildren(
  parentId: string,
  groups: PageGroup[],
  pages: string[],
  actor: { userId: string | null; role: string } = { userId: null, role: 'system' },
  auditMeta: Record<string, unknown> = {}
) {
  const parent = await prisma.documentIntake.findUniqueOrThrow({
    where: { id: parentId },
    select: { organizationId: true, uploadedById: true, source: true, fileName: true },
  });

  const children = await prisma.$transaction(async (tx) => {
    // Claim the parent first so two split requests can't both create children
    const claimed = await tx.documentIntake.updateMany({
      where: { id: parentId, status: { not: 'split' }, parentId: null },
      data: { status: 'split' },
    });
    if (claimed.count !== 1) throw new IntakeSplitError('This document has already been split by patient');
    const created: { id: string; pages: number[]; clientId: string | null }[] = [];
    for (const g of groups) {
      const matched = g.kind === 'matched';
      const child = await tx.documentIntake.create({
        data: {
          parentId,
          pageNumbers: g.pages,
          source: parent.source,
          documentType: 'Unclassified',
          confidenceScore: 0,
          suggestedFilingPath: FILING_PATH.Unclassified,
          // The child's own PDF is written when staff file it
          s3RawKey: 'pending',
          // Classified in the background by advanceProcessing (one Bedrock call per child)
          status: 'processing',
          organizationId: parent.organizationId,
          uploadedById: parent.uploadedById,
          fileName: childFileName(parent.fileName || '', g.pages),
          mimeType: 'application/pdf',
          pageCount: g.pages.length,
          extractedText: textOf(pages, g.pages).slice(0, 200_000),
          extractedFields: [],
          suggestedClientId: matched ? g.clientId : null,
          matchStatus: matched ? 'matched' : g.candidates.length ? 'needs_review' : 'unmatched',
          matchReason: g.reason.slice(0, 300),
          matchCandidates: (matched ? [] : g.candidates.slice(0, 5)) as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      created.push({ id: child.id, pages: g.pages, clientId: matched ? g.clientId : null });
    }
    await tx.documentIntake.update({
      where: { id: parentId },
      data: {
        status: 'split',
        ocrJobId: null,
        suggestedClientId: null,
        suggestedFilingPath: SPLIT_FILING_PATH,
        matchStatus: null,
        matchReason: `Split into ${groups.length} documents by patient`,
        matchCandidates: [] as unknown as Prisma.InputJsonValue,
        processingError: null,
      },
    });
    return created;
  });

  await writeAuditLog({
    action: 'SPLIT',
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId: parent.organizationId,
    resourceType: 'intakeDocument',
    resourceId: parentId,
    metadata: {
      ...auditMeta,
      parentId,
      childCount: children.length,
      children: children.map((c) => ({ childId: c.id, pages: c.pages, clientId: c.clientId })),
    },
  });
  return children;
}

export type SplitOutcome =
  | { ok: false; status: number; error: string }
  | { ok: true; split: false; message: string }
  | { ok: true; split: true; childCount: number; message: string };

/** "Split by patient" on an already-processed document: uses the stored page texts, no new OCR. */
export async function splitExistingDocument(
  id: string,
  organizationId: string,
  actor: { userId: string; role: string }
): Promise<SplitOutcome> {
  const doc = await prisma.documentIntake.findFirst({
    where: { id, organizationId },
    select: {
      status: true, parentId: true, mimeType: true, s3RawKey: true, pageCount: true,
      pageTexts: true, extractedText: true, suggestedClientId: true,
    },
  });
  if (!doc) return { ok: false, status: 404, error: 'Document not found' };
  if (doc.parentId) return { ok: false, status: 409, error: 'This document is already one part of a split file' };
  if (doc.status === 'split') return { ok: false, status: 409, error: 'This document has already been split by patient' };
  if (doc.status !== 'ready' && doc.status !== 'filed') {
    return { ok: false, status: 409, error: 'Only a processed document can be split' };
  }
  if (doc.mimeType !== 'application/pdf' || !doc.s3RawKey.endsWith('.pdf')) {
    return { ok: false, status: 400, error: 'Only PDF documents can be split by patient' };
  }
  if (!doc.pageCount || doc.pageCount < 2) {
    return { ok: false, status: 400, error: 'This document has a single page' };
  }

  const resolved = resolvePageTexts(doc);
  if ('error' in resolved) return { ok: false, status: 409, error: resolved.error };

  const { groups, split } = await segmentDocument(organizationId, resolved.pages);
  if (!split) {
    return {
      ok: true,
      split: false,
      message: groups.some((g) => g.kind === 'matched')
        ? 'Every identified page belongs to one patient, so the document was kept as one.'
        : 'No page could be tied to more than one patient, so the document was kept as one.',
    };
  }

  let children: Awaited<ReturnType<typeof createSplitChildren>>;
  try {
    children = await createSplitChildren(id, groups, resolved.pages, actor, {
      trigger: 'manual',
      previousStatus: doc.status,
      previousClientId: doc.suggestedClientId,
    });
  } catch (err) {
    if (err instanceof IntakeSplitError) return { ok: false, status: 409, error: err.message };
    throw err;
  }
  return {
    ok: true,
    split: true,
    childCount: children.length,
    message: `Split into ${children.length} documents by patient. Review and file each one.`,
  };
}

const inFlight = new Set<string>();

/** Classify split children waiting in 'processing', one Bedrock call at a time, within a time budget. */
export async function classifySplitChildren(organizationId: string, budgetMs = 20_000) {
  const started = Date.now();
  const pending = await prisma.documentIntake.findMany({
    where: { organizationId, status: 'processing', parentId: { not: null }, ocrJobId: null },
    select: { id: true, extractedText: true, matchStatus: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });
  for (const [i, child] of pending.entries()) {
    if (Date.now() - started > budgetMs) break;
    if (inFlight.has(child.id)) continue;
    inFlight.add(child.id);
    try {
      // Bedrock throttles bursts: space the calls out, and on throttling leave the part queued for the next poll
      if (i > 0) await new Promise((res) => setTimeout(res, 1500));
      const giveUp = Date.now() - child.createdAt.getTime() > 30 * 60 * 1000;
      const outcome = await classifyChild(organizationId, child.id, child.extractedText ?? '', child.matchStatus, giveUp);
      if (outcome === 'throttled') break;
    } catch (err) {
      await prisma.documentIntake.update({
        where: { id: child.id },
        data: { status: 'ready', processingError: `Classification failed: ${errorMessage(err)}`.slice(0, 500) },
      }).catch(() => undefined);
    } finally {
      inFlight.delete(child.id);
    }
  }
}

const isThrottle = (err: unknown) =>
  /throttl|too many requests|rate exceeded/i.test(`${(err as { name?: string })?.name ?? ''} ${errorMessage(err)}`);

async function classifyChild(
  organizationId: string,
  id: string,
  text: string,
  matchStatus: string | null,
  giveUp = false,
): Promise<'done' | 'throttled'> {
  if (!text.trim()) {
    await prisma.documentIntake.update({
      where: { id },
      data: { status: 'ready', processingError: 'No readable text on these pages. Open the original to review them.' },
    });
    return 'done';
  }
  let documentType: DocType = 'Unclassified';
  let confidence = 0;
  let fields: { label: string; value: string }[] = [];
  let processingError: string | null = null;
  let rematch: Prisma.DocumentIntakeUpdateInput = {};
  try {
    // No file name: on a split file it names one patient at most
    const c = await classifyDocument(text, '');
    documentType = c.documentType;
    confidence = c.confidence;
    const ids: ExtractedIdentifiers = extractPatientIdentifiers(text, '');
    const before = JSON.stringify(ids);
    fields = applyClassification(c, ids, { sourceIdMustAppearIn: text });
    // A page-level match stands; otherwise the model's reading may fill a gap (still rule-matched)
    if ((matchStatus === 'needs_review' || matchStatus === 'unmatched') && JSON.stringify(ids) !== before) {
      const m = matchPatient(ids, await loadRoster(organizationId, ids.sourceIds, ids.dob));
      if (m.status === 'matched' || m.candidates.length) {
        rematch = {
          suggestedClient: m.status === 'matched' && m.clientId ? { connect: { id: m.clientId } } : { disconnect: true },
          matchStatus: m.status,
          matchReason: m.reason.slice(0, 300),
          matchCandidates: m.candidates.slice(0, 5) as unknown as Prisma.InputJsonValue,
        };
      }
    }
  } catch (err) {
    // Throttled: stay in 'processing' and retry on the next poll (up to 30 minutes after the split)
    if (isThrottle(err) && !giveUp) return 'throttled';
    processingError = `AI classification unavailable (${errorMessage(err)}). Review and classify manually.`;
  }
  await prisma.documentIntake.update({
    where: { id },
    data: {
      status: 'ready',
      documentType,
      confidenceScore: confidence,
      extractedFields: fields,
      suggestedFilingPath: FILING_PATH[documentType],
      processingError,
      ...rematch,
    },
  });
  return 'done';
}

/**
 * Write a PDF holding only this child's pages of the parent file and point the child at it.
 * Refuses (IntakeSplitError) rather than file anything when the pages can't be matched up exactly.
 */
export async function writeChildPdf(child: { id: string; parentId: string; pageNumbers: number[] }) {
  const parent = await prisma.documentIntake.findUnique({
    where: { id: child.parentId },
    select: { s3RawKey: true, mimeType: true, pageCount: true, status: true },
  });
  if (!parent || parent.status !== 'split') throw new IntakeSplitError('The original split file is no longer available.');
  if (parent.mimeType !== 'application/pdf') throw new IntakeSplitError('The original file is not a PDF.');
  if (!child.pageNumbers.length) throw new IntakeSplitError('This document has no pages assigned.');

  const src = uploadPath(KIND, parent.s3RawKey);
  if (!src) throw new IntakeSplitError('The original file is no longer available.');
  let original: Uint8Array;
  try {
    original = await readFile(src);
  } catch {
    throw new IntakeSplitError('The original file is no longer available.');
  }
  let bytes: Uint8Array;
  try {
    bytes = await extractPdfPages(original, child.pageNumbers, parent.pageCount);
  } catch (err) {
    if (err instanceof PdfPagesError) throw new IntakeSplitError(err.message);
    throw err;
  }

  const storedName = `${child.id}.pdf`;
  const abs = uploadPath(KIND, storedName);
  if (!abs) throw new IntakeSplitError('Invalid stored file name');
  await mkdir(uploadDir(KIND), { recursive: true });
  await writeFile(abs, bytes);
  return { storedName, size: bytes.byteLength };
}

function errorMessage(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0].slice(0, 200);
}
