/**
 * Valant documents ZIP import job (server side; also run by scripts/import-valant-documents.ts).
 *
 * Streaming: the ZIP is never loaded into memory (archive reading: src/lib/migration/valantZip.ts).
 * Each entry is streamed straight into a hash and, when applying, into the private intake document
 * store. Deflate64 entries are read with 7-Zip when it is installed.
 *
 * Phases:
 *   dry_run  counts per type, folder match results, duplicates, unreadable (by reason) / unsupported
 *            files, total size. Writes no documents.
 *   apply    one DocumentIntake row per file (rules: resolveDocumentTarget): 'filed' to the chart on an
 *            exact client-folder, nested client-folder or file-name code match; practice billing
 *            records (ERA exceptions, claims, remittance, EOB) 'archived' with no client (billing
 *            archive, not the review queue); otherwise 'ready' + needs_review for the document intake
 *            review queue. Read-only.
 *   rematch  re-run of an applied batch with the current rules: review-queue documents that now
 *            resolve are filed / archived in place (never duplicated), and the archive is scanned
 *            again so entries that were unreadable before are imported; everything already imported
 *            is skipped by hash / Valant document id.
 *
 * Resumable and idempotent: the batch keeps a cursor (entries done, central-directory order) and
 * every document carries its sha256, so an interrupted or repeated run never duplicates a document.
 * A full disk (ENOSPC) stops the run as 'failed' at its cursor; Resume continues there.
 */
import { randomUUID } from 'crypto';
import { mkdir, rename, unlink } from 'fs/promises';
import type { Prisma } from '@prisma/client';
import type * as yauzl from 'yauzl';
import { prisma } from '@/lib/db/prisma';
import { uploadDir, uploadPath } from '@/lib/storage/privateUploads';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import {
  BILLING_ARCHIVE_FILING_PATH,
  BILLING_ARCHIVE_STATUS,
  BILLING_ARCHIVE_TYPE,
  bump,
  classifyReadError,
  classifyValantDocument,
  detectWrapperDepth,
  duplicateKeys,
  emptyCounts,
  extensionOf,
  filingPathFor,
  indexRoster,
  isDiskFullError,
  isDuplicate,
  maskPath,
  maskText,
  matchClientFolder,
  matchNestedFolder,
  MAX_IMPORT_FILE_BYTES,
  normalizeEntryPath,
  parseClientFolder,
  parseDocumentDate,
  parseValantFileName,
  planRematch,
  PRACTICE_BILLING_MATCH,
  recordUnreadable,
  resolveDocumentTarget,
  rememberDocument,
  sniffFileKind,
  splitArchivePath,
  SUPPORTED_EXTENSIONS,
  toFolderRoster,
  VALANT_DOC_SOURCE,
  type DuplicateInput,
  type FolderMatch,
  type ImportCounts,
  type ImportOptions,
  type ValantDocType,
} from './valantDocuments';
import { ArchiveReadError, DEFLATE64, freeBytes, openZip, readEntry, scanEntries, SEVEN_ZIP_HINT, sevenZipAvailable, valantDocsBucket, type ZipSource } from './valantZip';

export { S3RangeReader, isValantDocsS3Configured, openZip, readEntry, scanEntries, valantDocsBucket, valantDocsS3 } from './valantZip';
export type { ScannedEntry, ZipSource } from './valantZip';

export const VALANT_DOCS_PREFIX = 'migration/valant-docs/';
const KIND = 'intake-docs' as const;
/** A running batch whose heartbeat is older than this can be resumed */
export const STALE_AFTER_MS = 3 * 60 * 1000;
const REPORT_LIST_MAX = 300;
const REASON_LIST_MAX = 50;
const GB = 1024 ** 3;

export const sourceZipKey = (batchId: string) => `${VALANT_DOCS_PREFIX}${batchId}/source.zip`;

// ─── Batch lifecycle ──────────────────────────────────────────────────────────

export type Phase = 'dry_run' | 'apply' | 'rematch';
type Actor = { userId: string; role: string };

const RUNNING: Record<Phase, string> = { dry_run: 'dry_running', apply: 'applying', rematch: 'rematching' };
export const RUNNING_STATUSES = Object.values(RUNNING);

/** The server disk filled up: the run stops at its cursor instead of counting files unreadable */
export class DiskFullError extends Error {
  constructor() {
    super('The server disk is full (ENOSPC). Free disk space (or point UPLOADS_DIR / VALANT_IMPORT_TMP_DIR at a larger volume), then Resume: the run continues where it stopped.');
    this.name = 'DiskFullError';
  }
}

/**
 * Atomically take a batch for a phase. Dry run: after upload, after an earlier dry run, after a
 * failure before applying, or a stale run. Apply: after a dry run, or resuming a stale / failed apply.
 * Rematch: after an import (done, or a failed / stale apply: starts over at entry 0, everything
 * imported is skipped), or resuming a failed / stale rematch at its cursor.
 */
export async function claimBatch(batchId: string, organizationId: string, phase: Phase): Promise<boolean> {
  const stale = new Date(Date.now() - STALE_AFTER_MS);
  const staleRun = (status: string): Prisma.ValantDocImportBatchWhereInput => ({ status, OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: stale } }] });
  const data = { status: RUNNING[phase], phase, heartbeatAt: new Date(), error: null };
  if (phase === 'dry_run') {
    // A dry run always starts over (it writes nothing)
    const r = await prisma.valantDocImportBatch.updateMany({
      where: { id: batchId, organizationId, OR: [{ status: { in: ['uploaded', 'dry_run_done'] } }, { status: 'failed', phase: 'dry_run' }, staleRun('dry_running')] },
      data: { ...data, cursor: 0 },
    });
    return r.count === 1;
  }
  if (phase === 'rematch') {
    const fresh = await prisma.valantDocImportBatch.updateMany({
      where: { id: batchId, organizationId, OR: [{ status: 'done' }, { status: 'failed', phase: 'apply' }, staleRun('applying')] },
      data: { ...data, cursor: 0 },
    });
    if (fresh.count === 1) return true;
    const resumed = await prisma.valantDocImportBatch.updateMany({
      where: { id: batchId, organizationId, OR: [{ status: 'failed', phase: 'rematch' }, staleRun('rematching')] },
      data,
    });
    return resumed.count === 1;
  }
  // First apply after the dry run starts at entry 0; a failed / stale apply resumes at its cursor
  const fresh = await prisma.valantDocImportBatch.updateMany({
    where: { id: batchId, organizationId, status: 'dry_run_done' },
    data: { ...data, cursor: 0 },
  });
  if (fresh.count === 1) return true;
  const resumed = await prisma.valantDocImportBatch.updateMany({
    where: { id: batchId, organizationId, OR: [{ status: 'failed', phase: 'apply' }, staleRun('applying')] },
    data,
  });
  return resumed.count === 1;
}

type FolderInfo = { label: string; match: FolderMatch; files: number };

function safeError(err: unknown, folders: Iterable<string>): string {
  if (isDiskFullError(err)) err = new DiskFullError();
  let m = err instanceof Error ? `${err.name}: ${err.message.split('\n')[0]}` : 'Import failed';
  // Error text from the unzip library can carry a path (client names): mask any folder name in it
  for (const f of folders) if (f && m.includes(f)) m = m.split(f).join(maskText(f));
  return m.slice(0, 400);
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const asReasonLists = (v: unknown): Record<string, string[]> =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, string[]>) } : {};

/**
 * Run (or resume) one phase of a claimed batch. Call claimBatch first. Never throws: failures end
 * the batch in 'failed' with a PHI-free error, and the phase can be started again.
 */
export async function runValantDocBatch(
  batchId: string,
  phase: Phase,
  actor: Actor,
  log: (line: string) => void = () => {}
): Promise<void> {
  const batch = await prisma.valantDocImportBatch.findUniqueOrThrow({ where: { id: batchId } });
  const organizationId = batch.organizationId;
  const options = (batch.options ?? {}) as ImportOptions;
  const use7z = options.use7z !== false;
  const writes = phase !== 'dry_run';
  const folderNames = new Set<string>();
  let zip: yauzl.ZipFile | null = null;
  try {
    const src: ZipSource =
      batch.sourceKind === 's3' ? { kind: 's3', bucket: batch.sourceBucket || valantDocsBucket(), key: batch.sourceKey } : { kind: 'local', path: batch.sourceKey };
    const opened = await openZip(src);
    zip = opened.zip;
    log(`Opened archive (${(opened.size / 1024 / 1024).toFixed(1)} MB)`);
    const entries = await scanEntries(zip);
    const files = entries.filter((e) => !e.isDir && !e.junk);
    const wrapperDepth = options.wrapperDepth ?? detectWrapperDepth(files.map((f) => f.path));

    // Client folders → exact match against the organization's clients (one roster load)
    const rosterRows = await prisma.client.findMany({
      where: { organizationId },
      select: { id: true, name: true, legalFirstName: true, legalLastName: true, dateOfBirth: true, mrn: true, sourceId: true, sourcePlatform: true },
    });
    const roster = toFolderRoster(rosterRows);
    const rosterById = new Map(roster.map((c) => [c.clientId, c]));
    const index = indexRoster(roster);
    const allowNameOnly = options.allowNameOnly ?? true;
    const folders = new Map<string, FolderInfo>();
    const folderInfo = (name: string): FolderInfo => {
      let info = folders.get(name);
      if (!info) {
        info = { label: maskText(name), match: matchClientFolder(parseClientFolder(name), index, { allowNameOnly }), files: 0 };
        folders.set(name, info);
      }
      return info;
    };
    // Client-code folders below unmatched top folders ("Archived/WALYAS/...")
    const nestedFolders = new Set<string>();
    for (const f of files) {
      const { clientFolder, subfolders } = splitArchivePath(f.path, wrapperDepth);
      if (!clientFolder) continue;
      folderNames.add(clientFolder);
      const info = folderInfo(clientFolder);
      info.files++;
      if (info.match.status !== 'matched') {
        const nested = matchNestedFolder(subfolders, index);
        if (nested.status === 'matched') nestedFolders.add(`${clientFolder}/${nested.folder}`);
      }
    }

    // Counts: archive-level numbers are recomputed; file counters resume with the cursor
    // claimBatch set the phase and reset the cursor unless this resumes an interrupted run
    const resume = writes && batch.cursor > 0;
    const prevReport = (batch.report ?? {}) as Record<string, unknown>;
    const counts: ImportCounts = resume ? { ...emptyCounts(), ...(batch.counts as Partial<ImportCounts>) } : emptyCounts();
    counts.unreadableByReason ??= {};
    counts.entries = entries.length;
    counts.files = files.length;
    counts.junk = entries.filter((e) => e.junk).length;
    counts.totalBytes = files.reduce((n, f) => n + f.size, 0);
    counts.byExtension = {};
    for (const f of files) bump(counts.byExtension, extensionOf(f.path) || '(none)');
    counts.folders = { total: folders.size, matched: 0, matchedById: 0, matchedByCode: 0, matchedByNameDob: 0, matchedByNameOnly: 0, needsReview: 0, unmatched: 0, nestedMatched: nestedFolders.size };
    for (const { match } of folders.values()) {
      if (match.status === 'matched') {
        counts.folders.matched++;
        if (match.basis === 'code' || match.basis === 'id') counts.folders.matchedById++;
        if (match.basis === 'code') counts.folders.matchedByCode++;
        else if (match.basis === 'name_dob') counts.folders.matchedByNameDob++;
        else if (match.basis === 'name') counts.folders.matchedByNameOnly++;
      } else if (match.status === 'needs_review') counts.folders.needsReview++;
      else counts.folders.unmatched++;
    }
    const startCursor = resume ? batch.cursor : 0;
    if (!resume) counts.processed = 0;

    // A re-run keeps the counts of the first import for comparison
    const firstRunCounts = phase === 'rematch' ? (prevReport.firstRunCounts ?? (resume ? null : batch.counts)) : undefined;

    const listed = (m: FolderMatch['status']) =>
      [...folders.values()]
        .filter((f) => f.match.status === m)
        .slice(0, REPORT_LIST_MAX)
        .map((f) => ({ folder: f.label, files: f.files, reason: f.match.reason, candidates: f.match.candidates.length }));
    const unreadable: string[] = resume ? asList(prevReport.unreadable) : [];
    const unreadableByReason: Record<string, string[]> = resume ? asReasonLists(prevReport.unreadableByReason) : {};
    const unsupported: string[] = resume ? asList(prevReport.unsupported) : [];
    const warnings: string[] = [];
    const deflate64 = files.filter((f) => f.compressionMethod === DEFLATE64).length;
    const otherMethods = files.filter((f) => f.compressionMethod !== 0 && f.compressionMethod !== 8 && f.compressionMethod !== DEFLATE64).length;
    if (deflate64) {
      if (!use7z) warnings.push(`${deflate64} files use Deflate64 compression and 7-Zip reading is switched off for this batch: they are counted unreadable`);
      else if (!sevenZipAvailable()) warnings.push(`${deflate64} files use Deflate64 compression. ${SEVEN_ZIP_HINT}`);
    }
    if (otherMethods) warnings.push(`${otherMethods} files use a compression method other than Stored, Deflate or Deflate64: counted unreadable`);
    const report = () => ({
      phase,
      wrapperDepth,
      maxDepth: files.reduce((n, f) => Math.max(n, f.path.split('/').length), 0),
      archiveBytes: opened.size,
      foldersNeedingReview: listed('needs_review'),
      foldersUnmatched: listed('unmatched'),
      unreadable: unreadable.slice(0, REPORT_LIST_MAX),
      unreadableByReason,
      unsupported: unsupported.slice(0, REPORT_LIST_MAX),
      warnings,
      deflate64Files: deflate64,
      sevenZip: deflate64 ? { enabled: use7z, available: use7z ? sevenZipAvailable() : null } : null,
      ...(firstRunCounts !== undefined ? { firstRunCounts } : {}),
      ocrForSearch: Boolean(options.ocrForSearch),
      allowNameOnly,
    });

    if (writes) {
      await mkdir(uploadDir(KIND), { recursive: true });
      // Room for what is left to import (an estimate: the uncompressed size of the remaining files)
      const need = files.filter((f) => f.index >= startCursor && f.size <= MAX_IMPORT_FILE_BYTES).reduce((n, f) => n + f.size, 0);
      const free = await freeBytes(uploadDir(KIND));
      if (free !== null && free < need + GB) {
        warnings.push(
          `Low disk space for the document store: ${(free / GB).toFixed(1)} GB free, up to ${(need / GB).toFixed(1)} GB to write. The run stops (and can be resumed) if the disk fills.`
        );
      }
    }

    await prisma.valantDocImportBatch.update({
      where: { id: batchId },
      data: {
        phase,
        cursor: startCursor,
        counts: counts as unknown as Prisma.InputJsonValue,
        report: report() as unknown as Prisma.InputJsonValue,
        heartbeatAt: new Date(),
        ...(phase === 'apply' ? { appliedById: actor.userId } : {}),
      },
    });
    log(
      `${files.length} files in ${folders.size} client folders; matched ${counts.folders.matched} (client code ${counts.folders.matchedByCode}), review ${counts.folders.needsReview}, unmatched ${counts.folders.unmatched}; client-code folders nested in unmatched folders ${counts.folders.nestedMatched}`
    );
    for (const w of warnings) log(`Warning: ${w}`);

    // Earlier imports of this organization: never import the same content (or Valant document) twice.
    // Keys of this batch's own rows tell "already imported here" apart from a duplicate elsewhere.
    const seen = new Set<string>();
    const ownKeys = new Set<string>();
    const existing = await prisma.documentIntake.findMany({
      where: { organizationId, sha256: { not: null } },
      select: { suggestedClientId: true, sha256: true, sourcePath: true, valantDocumentId: true, fileName: true, importBatchId: true },
    });
    for (const d of existing) {
      const input: DuplicateInput = {
        clientId: d.suggestedClientId,
        sha256: d.sha256!,
        sourcePath: d.sourcePath,
        valantDocumentId: d.valantDocumentId ?? (d.fileName ? parseValantFileName(d.fileName)?.valantDocumentId : null) ?? null,
      };
      rememberDocument(seen, input);
      if (d.importBatchId === batchId) rememberDocument(ownKeys, input);
    }

    // Re-run: review-queue documents that the current rules place (in place, audited): filed to a
    // client (folder, nested client folder, file-name code) or moved to the practice billing archive
    if (phase === 'rematch') {
      const rows = await prisma.documentIntake.findMany({
        where: { organizationId, importBatchId: batchId },
        select: {
          id: true, status: true, matchStatus: true, suggestedClientId: true, voidedAt: true, sourcePath: true, valantDocumentId: true, sha256: true, extractedFields: true,
        },
      });
      const plan = planRematch(rows, (folder) => folderInfo(folder).match, index);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const waiting = { organizationId, importBatchId: batchId, status: 'ready', matchStatus: 'needs_review', suggestedClientId: null, voidedAt: null } as const;
      for (const p of plan.file) {
        const now = new Date();
        const r = await prisma.documentIntake.updateMany({
          where: { id: p.id, ...waiting },
          data: {
            suggestedClientId: p.clientId,
            status: 'filed',
            matchStatus: p.matchStatus,
            matchReason: p.reason.slice(0, 300),
            matchCandidates: [] as unknown as Prisma.InputJsonValue,
            filedByUserId: actor.userId,
            filedAt: now,
            ...(p.valantDocumentId ? { valantDocumentId: p.valantDocumentId } : {}),
          },
        });
        if (r.count !== 1) continue;
        counts.refiled++;
        if (p.basis === 'nested_folder') counts.refiledByNestedFolder++;
        else if (p.basis === 'file_code') counts.refiledByFileCode++;
        else counts.refiledByFolder++;
        const row = byId.get(p.id)!;
        if (row.sha256) {
          const input = { clientId: p.clientId, sha256: row.sha256, sourcePath: row.sourcePath, valantDocumentId: p.valantDocumentId };
          rememberDocument(seen, input);
          rememberDocument(ownKeys, input);
        }
        await writeAuditLog({
          action: 'IMPORT_TO_CHART',
          actorUserId: actor.userId,
          actorRole: actor.role,
          organizationId,
          resourceType: 'intakeDocument',
          resourceId: p.id,
          patientId: p.clientId,
          metadata: { batchId, source: 'valant_documents_zip', rematch: true, basis: p.basis },
        });
      }
      for (const p of plan.archive) {
        const row = byId.get(p.id)!;
        const fields = Array.isArray(row.extractedFields) ? (row.extractedFields as Array<{ label?: string }>).filter((f) => f?.label !== 'Payer') : [];
        const r = await prisma.documentIntake.updateMany({
          where: { id: p.id, ...waiting },
          data: {
            status: BILLING_ARCHIVE_STATUS,
            documentType: BILLING_ARCHIVE_TYPE,
            suggestedFilingPath: BILLING_ARCHIVE_FILING_PATH,
            matchStatus: PRACTICE_BILLING_MATCH,
            matchReason: p.reason.slice(0, 300),
            matchCandidates: [] as unknown as Prisma.InputJsonValue,
            extractedFields: [...fields, ...(p.payer ? [{ label: 'Payer', value: p.payer.slice(0, 200) }] : [])] as unknown as Prisma.InputJsonValue,
          },
        });
        if (r.count === 1) counts.rearchivedBilling++;
      }
      if (counts.rearchivedBilling) {
        await writeAuditLog({
          action: 'VALANT_DOCS_BILLING_ARCHIVE',
          actorUserId: actor.userId,
          actorRole: actor.role,
          organizationId,
          resourceType: 'valantDocImportBatch',
          resourceId: batchId,
          metadata: { batchId, source: 'valant_documents_zip', rematch: true, archived: counts.rearchivedBilling },
        });
      }
      // Record the Valant document id on this batch's rows that do not have it yet
      const backfill = rows
        .filter((r) => !r.valantDocumentId && r.sourcePath)
        .map((r) => ({ id: r.id, docId: parseValantFileName(r.sourcePath!.split('/').pop() || '')?.valantDocumentId }))
        .filter((r): r is { id: string; docId: string } => Boolean(r.docId));
      for (let i = 0; i < backfill.length; i += 200) {
        await prisma.$transaction(
          backfill.slice(i, i + 200).map((b) => prisma.documentIntake.updateMany({ where: { id: b.id, valantDocumentId: null }, data: { valantDocumentId: b.docId } }))
        );
      }
      log(
        `Re-run: ${counts.refiled} review-queue documents filed (client folder ${counts.refiledByFolder}, nested client folder ${counts.refiledByNestedFolder}, file-name code ${counts.refiledByFileCode}); ${counts.rearchivedBilling} moved to the practice billing archive; ${backfill.length} Valant document ids recorded`
      );
    }

    let lastSave = Date.now();
    let sinceSave = 0;
    const save = async (cursor: number) => {
      await prisma.valantDocImportBatch.update({
        where: { id: batchId },
        data: { cursor, counts: counts as unknown as Prisma.InputJsonValue, report: report() as unknown as Prisma.InputJsonValue, heartbeatAt: new Date() },
      });
      lastSave = Date.now();
      sinceSave = 0;
    };
    const markUnreadable = (reason: string, relPath: string) => {
      const masked = maskPath(relPath);
      recordUnreadable(counts, unreadableByReason, reason, masked, REASON_LIST_MAX);
      if (unreadable.length < REPORT_LIST_MAX) unreadable.push(masked);
    };
    let missing7zWarned = warnings.some((w) => w.includes('p7zip-full'));

    for (const f of entries) {
      if (f.index < startCursor || f.isDir || f.junk) continue;
      if (sinceSave >= 100 || Date.now() - lastSave > 5000) await save(f.index);
      sinceSave++;
      counts.processed++;

      const { clientFolder, subfolders, fileName } = splitArchivePath(f.path, wrapperDepth);
      const relPath = normalizeEntryPath(f.path).split('/').filter(Boolean).slice(wrapperDepth).join('/');
      const ext = extensionOf(fileName);
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        counts.unsupported++;
        if (unsupported.length < REPORT_LIST_MAX) unsupported.push(maskPath(relPath));
        continue;
      }
      if (f.size > MAX_IMPORT_FILE_BYTES) {
        counts.tooLarge++;
        continue;
      }
      if (f.encrypted) {
        markUnreadable('encrypted', relPath);
        continue;
      }
      if (f.size === 0) {
        markUnreadable('zero_size', relPath);
        continue;
      }

      const id = randomUUID();
      const tmp = writes ? uploadPath(KIND, `${id}.part`) : null;
      let read: Awaited<ReturnType<typeof readEntry>>;
      try {
        read = await readEntry(zip, f.entry, tmp, { use7z });
      } catch (err) {
        if (tmp) await unlink(tmp).catch(() => {});
        if (isDiskFullError(err)) {
          // Stop here: this entry is redone on Resume
          counts.processed--;
          await save(f.index).catch(() => {});
          throw new DiskFullError();
        }
        if (err instanceof ArchiveReadError && err.missing7z && !missing7zWarned) {
          warnings.push(SEVEN_ZIP_HINT);
          missing7zWarned = true;
        }
        markUnreadable(classifyReadError(err), relPath);
        continue;
      }
      if (read.via === '7z') counts.extractedWith7z++;
      const kind = sniffFileKind(read.head);
      if (!kind) {
        if (tmp) await unlink(tmp).catch(() => {});
        markUnreadable('not_pdf_or_image', relPath);
        continue;
      }

      const folder = clientFolder ? folders.get(clientFolder)! : null;
      const match = folder?.match ?? null;
      const parsedName = parseValantFileName(fileName);
      const target = resolveDocumentTarget({ topFolder: clientFolder, subfolders, fileName }, match, index);
      const conflict = target.kind === 'review' && target.codeMismatch ? target.reason : null;
      const clientId = target.kind === 'client' ? target.clientId : null;
      const billing = target.kind === 'billing' ? target : null;
      const valantDocumentId = parsedName?.valantDocumentId ?? null;
      const dupInput: DuplicateInput = { clientId, sha256: read.sha256, sourcePath: relPath, valantDocumentId };
      if (isDuplicate(seen, dupInput)) {
        if (tmp) await unlink(tmp).catch(() => {});
        if (duplicateKeys(dupInput).some((k) => ownKeys.has(k))) counts.alreadyImported++;
        else counts.duplicates++;
        continue;
      }
      rememberDocument(seen, dupInput);
      rememberDocument(ownKeys, dupInput);

      const type = billing ? BILLING_ARCHIVE_TYPE : classifyValantDocument(subfolders, parsedName?.title ? `${parsedName.title}.pdf` : fileName).type;
      const date = parsedName ? parsedName.date : parseDocumentDate(fileName);
      // Counters of this file (undone when the disk fills while it is written)
      const tally = (by: 1 | -1) => {
        if (!clientFolder) counts.looseFiles += by;
        if (conflict) counts.codeMismatch += by;
        counts.documents += by;
        bump(counts.byType, type, by);
        if (date) counts.dated += by;
        if (target.kind === 'client') {
          counts.filed += by;
          if (target.basis === 'nested_folder') counts.filedByNestedFolder += by;
          if (target.basis === 'file_code') counts.filedByFileCode += by;
        } else if (billing) counts.billingArchived += by;
        else counts.needsReview += by;
      };
      tally(1);
      if (!writes) continue;

      const storedName = `${id}.${kind.ext}`;
      const finalPath = uploadPath(KIND, storedName)!;
      const conflictClient = target.kind === 'review' && target.conflictClientId ? rosterById.get(target.conflictClientId) : null;
      const candidates = conflictClient
        ? [{ clientId: conflictClient.clientId, name: conflictClient.displayName, dob: conflictClient.dob, reason: 'Folder match; the file name carries another client code' }]
        : target.kind === 'review'
          ? target.candidates
          : [];
      const now = new Date();
      try {
        await rename(tmp!, finalPath);
        await prisma.documentIntake.create({
          data: {
            id,
            source: VALANT_DOC_SOURCE,
            documentType: type,
            confidenceScore: 1,
            suggestedClientId: clientId,
            suggestedFilingPath: billing ? BILLING_ARCHIVE_FILING_PATH : filingPathFor(type as ValantDocType),
            s3RawKey: storedName,
            extractedFields: [
              ...(date ? [{ label: 'Document date', value: date }] : []),
              { label: 'Imported from', value: 'Valant' },
              ...(valantDocumentId ? [{ label: 'Valant document id', value: valantDocumentId }] : []),
              ...(subfolders.length ? [{ label: 'Valant folder', value: subfolders.join(' / ').slice(0, 300) }] : []),
              ...(billing?.payer ? [{ label: 'Payer', value: billing.payer.slice(0, 200) }] : []),
            ],
            status: clientId ? 'filed' : billing ? BILLING_ARCHIVE_STATUS : 'ready',
            filedByUserId: clientId ? actor.userId : null,
            filedAt: clientId ? now : null,
            organizationId,
            fileName: fileName.slice(0, 200),
            mimeType: kind.mime,
            fileSize: read.bytes,
            uploadedById: actor.userId,
            matchStatus: target.kind === 'client' ? target.matchStatus : billing ? PRACTICE_BILLING_MATCH : 'needs_review',
            matchReason: target.reason.slice(0, 300),
            matchCandidates: candidates as unknown as Prisma.InputJsonValue,
            sourcePath: relPath.slice(0, 1000),
            sha256: read.sha256,
            valantDocumentId,
            importBatchId: batchId,
            readOnly: true,
          },
        });
      } catch (err) {
        await unlink(finalPath).catch(() => {});
        await unlink(tmp!).catch(() => {});
        if (isDiskFullError(err)) {
          // Undo this entry's counters and stop; Resume redoes it
          counts.processed--;
          tally(-1);
          await save(f.index).catch(() => {});
          throw new DiskFullError();
        }
        throw err;
      }
      if (clientId) {
        await writeAuditLog({
          action: 'IMPORT_TO_CHART',
          actorUserId: actor.userId,
          actorRole: actor.role,
          organizationId,
          resourceType: 'intakeDocument',
          resourceId: id,
          patientId: clientId,
          metadata: { batchId, documentType: type, source: 'valant_documents_zip', basis: target.kind === 'client' ? target.basis : null, ...(phase === 'rematch' ? { rematch: true } : {}) },
        });
      }
    }

    const finishedAt = new Date();
    await prisma.valantDocImportBatch.update({
      where: { id: batchId },
      data: {
        status: writes ? 'done' : 'dry_run_done',
        cursor: entries.length,
        counts: counts as unknown as Prisma.InputJsonValue,
        report: report() as unknown as Prisma.InputJsonValue,
        heartbeatAt: finishedAt,
        finishedAt,
        ...(phase === 'apply' ? { appliedAt: finishedAt } : phase === 'dry_run' ? { dryRunAt: finishedAt } : {}),
      },
    });
    await writeAuditLog({
      action: phase === 'apply' ? 'VALANT_DOCS_IMPORT_APPLY' : phase === 'rematch' ? 'VALANT_DOCS_REMATCH' : 'VALANT_DOCS_IMPORT_DRY_RUN',
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId,
      resourceType: 'valantDocImportBatch',
      resourceId: batchId,
      metadata: {
        files: counts.files,
        documents: counts.documents,
        filed: counts.filed,
        needsReview: counts.needsReview,
        filedByNestedFolder: counts.filedByNestedFolder,
        filedByFileCode: counts.filedByFileCode,
        billingArchived: counts.billingArchived,
        refiled: counts.refiled,
        refiledByFolder: counts.refiledByFolder,
        refiledByNestedFolder: counts.refiledByNestedFolder,
        refiledByFileCode: counts.refiledByFileCode,
        rearchivedBilling: counts.rearchivedBilling,
        alreadyImported: counts.alreadyImported,
        duplicates: counts.duplicates,
        unreadable: counts.unreadable,
        unreadableByReason: counts.unreadableByReason,
        folders: counts.folders.total,
      },
    });
    log(
      `Done: ${counts.documents} new documents (${counts.filed} filed [nested folder ${counts.filedByNestedFolder}, file code ${counts.filedByFileCode}], ${counts.billingArchived} billing archive, ${counts.needsReview} to review), ${counts.refiled} re-filed, ${counts.rearchivedBilling} moved to the billing archive, ${counts.alreadyImported} already imported, ${counts.duplicates} duplicates, ${counts.unreadable} unreadable`
    );
  } catch (err) {
    const error = safeError(err, folderNames);
    console.error('[valant-docs] batch failed', batchId, error);
    await prisma.valantDocImportBatch
      .update({ where: { id: batchId }, data: { status: 'failed', error, heartbeatAt: new Date() } })
      .catch(() => {});
    log(`Failed: ${error}`);
  } finally {
    try {
      zip?.close();
    } catch {
      /* already closed */
    }
  }
}

/** JSON-safe batch for the admin page (BigInt size → number) */
export function batchDto(b: {
  id: string; status: string; sourceKind: string; fileName: string | null; fileSize: bigint | null; phase: string | null;
  cursor: number; counts: unknown; report: unknown; error: string | null; ocrForSearch: boolean; options: unknown;
  heartbeatAt: Date | null; dryRunAt: Date | null; appliedAt: Date | null; finishedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  const running = RUNNING_STATUSES.includes(b.status);
  return {
    id: b.id,
    status: b.status,
    sourceKind: b.sourceKind,
    fileName: b.fileName,
    fileSize: b.fileSize === null ? null : Number(b.fileSize),
    phase: b.phase,
    cursor: b.cursor,
    counts: b.counts,
    report: b.report,
    error: b.error,
    ocrForSearch: b.ocrForSearch,
    options: b.options,
    stale: running && (!b.heartbeatAt || Date.now() - b.heartbeatAt.getTime() > STALE_AFTER_MS),
    dryRunAt: b.dryRunAt,
    appliedAt: b.appliedAt,
    finishedAt: b.finishedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}
