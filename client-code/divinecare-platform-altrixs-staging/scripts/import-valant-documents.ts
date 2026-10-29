/**
 * Valant documents ZIP import from the command line (for very large exports copied with the AWS CLI
 * or to the server disk). Same job, same rules and same batch records as Admin → Data import →
 * Valant documents; batches started here show on that page.
 *
 *   Dry run (default; writes no documents, prints the report):
 *     npx tsx scripts/import-valant-documents.ts --zip /data/valant-docs.zip --org ORG_ID --user admin@clinic.org
 *     npx tsx scripts/import-valant-documents.ts --zip s3://bucket/migration/valant-docs/x/source.zip --org ORG_ID --user USER_ID
 *     npx tsx scripts/import-valant-documents.ts --zip migration/valant-docs/x/source.zip --org ORG_ID --user USER_ID   (key in VALANT_IMPORT_S3_BUCKET / DOC_INTAKE_S3_BUCKET)
 *
 *   Apply after reviewing the dry run (or resume an interrupted apply):
 *     npx tsx scripts/import-valant-documents.ts --batch BATCH_ID --org ORG_ID --user admin@clinic.org --apply
 *
 *   --zip ... --apply runs the dry run and then the import in one go.
 *
 *   Re-run an imported batch with the updated matching (review-queue documents are placed in place by
 *   the current rules: client folder, nested client-code folder, file-name client code, or the
 *   practice billing archive; imports entries that were unreadable before; never duplicates; resumable):
 *     npx tsx scripts/import-valant-documents.ts --rematch --batch BATCH_ID --org ORG_ID --user admin@clinic.org
 *
 * Options: --no-name-only (never file on a unique full name alone), --ocr-later (mark for OCR later),
 * --wrapper-depth N (folders above the client folders; detected when omitted), --no-7z (do not read
 * Deflate64 entries with 7-Zip; by default they are, when p7zip-full is installed).
 * --user must be a Practice Director or Admin of the organization (the importing user on every record).
 * Output: counts and masked labels only.
 */
import 'dotenv/config';
import { existsSync } from 'fs';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { LEADERSHIP } from '@/lib/migration/referenceImport';
import { claimBatch, runValantDocBatch, valantDocsBucket, type Phase } from '@/lib/migration/valantDocumentsJob';
import type { ImportCounts } from '@/lib/migration/valantDocuments';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function usage(msg: string): never {
  console.error(msg);
  console.error('Usage: npx tsx scripts/import-valant-documents.ts (--zip <path | s3://bucket/key | key> | --batch <id>) --org <id> --user <id|email> [--apply | --rematch] [--no-7z]');
  process.exit(1);
}

function printReport(batchId: string, status: string, counts: ImportCounts, report: Record<string, unknown>, error: string | null) {
  const f = counts.folders;
  console.log(`\nBatch ${batchId}: ${status}${error ? ` (${error})` : ''}`);
  console.log(`  Files ${counts.files} (${(counts.totalBytes / 1024 / 1024).toFixed(1)} MB), system files ${counts.junk}, outside a client folder ${counts.looseFiles}`);
  console.log(`  Client folders ${f.total}: matched ${f.matched} (ID ${f.matchedById}, name+DOB ${f.matchedByNameDob}, unique name ${f.matchedByNameOnly}), needs review ${f.needsReview}, no match ${f.unmatched}`);
  if (f.matchedByCode !== undefined) console.log(`    of the ID matches, folder name = Valant client code: ${f.matchedByCode}`);
  if (f.nestedMatched !== undefined) console.log(`  Client-code folders nested in unmatched top folders: ${f.nestedMatched}`);
  if (report.phase === 'rematch') {
    console.log(`  Re-run: review-queue documents filed ${counts.refiled ?? 0} (client folder ${counts.refiledByFolder ?? 0}, nested client folder ${counts.refiledByNestedFolder ?? 0}, file-name client code ${counts.refiledByFileCode ?? 0}); moved to the practice billing archive ${counts.rearchivedBilling ?? 0}; already imported (skipped) ${counts.alreadyImported ?? 0}`);
  }
  console.log(`  ${report.phase === 'rematch' ? 'New documents' : 'Documents'} ${counts.documents}: filed ${counts.filed}, to review ${counts.needsReview}; duplicates ${counts.duplicates}; unreadable ${counts.unreadable}; not PDF/image ${counts.unsupported}; over 100 MB ${counts.tooLarge}`);
  console.log(`    of the filed: nested client folder ${counts.filedByNestedFolder ?? 0}, file-name client code ${counts.filedByFileCode ?? 0}; practice billing archive (no client, not in review) ${counts.billingArchived ?? 0}`);
  if (counts.codeMismatch) console.log(`  File-name client code differs from the folder (sent to review): ${counts.codeMismatch}`);
  if (counts.extractedWith7z) console.log(`  Read with 7-Zip (Deflate64): ${counts.extractedWith7z}`);
  const reasons = Object.entries(counts.unreadableByReason ?? {}).sort((a, b) => b[1] - a[1]);
  if (reasons.length) {
    console.log('  Unreadable by reason:');
    for (const [r, n] of reasons) console.log(`    ${r}: ${n}`);
  }
  const byReason = (report.unreadableByReason ?? {}) as Record<string, string[]>;
  for (const [r, list] of Object.entries(byReason)) {
    if (!list.length) continue;
    console.log(`  Unreadable (${r}), masked, first ${Math.min(10, list.length)}:`);
    for (const p of list.slice(0, 10)) console.log(`    ${p}`);
  }
  for (const w of Array.isArray(report.warnings) ? (report.warnings as string[]) : []) console.log(`  WARNING: ${w}`);
  console.log(`  With a date in the file name: ${counts.dated}`);
  console.log('  By type:');
  for (const [t, n] of Object.entries(counts.byType).sort((a, b) => b[1] - a[1])) console.log(`    ${t}: ${n}`);
  console.log('  By extension:', Object.entries(counts.byExtension).map(([e, n]) => `${e} ${n}`).join(', '));
  const rows = (k: string) => (Array.isArray(report[k]) ? (report[k] as Array<Record<string, unknown>>) : []);
  for (const [k, title] of [['foldersNeedingReview', 'Folders needing review'], ['foldersUnmatched', 'Folders with no match']] as const) {
    const list = rows(k);
    if (!list.length) continue;
    console.log(`  ${title} (masked, first 25 of ${list.length}):`);
    for (const r of list.slice(0, 25)) console.log(`    ${r.folder}  ${r.files} files  ${r.reason}`);
  }
}

async function main() {
  const orgId = arg('org') || usage('--org is required');
  const userArg = arg('user') || usage('--user is required (a Practice Director or Admin of the organization)');
  const apply = flag('apply');
  const rematch = flag('rematch');
  if (apply && rematch) usage('Use --apply or --rematch, not both');
  if (rematch && !arg('batch')) usage('--rematch needs --batch <id> (an imported batch)');
  const user = await prisma.user.findFirst({
    where: { OR: [{ id: userArg }, { email: userArg.toLowerCase() }], organizationId: orgId },
    select: { id: true, role: true },
  });
  if (!user || !LEADERSHIP.has(String(user.role))) usage('--user must be a Practice Director or Admin of this organization');
  const actor = { userId: user.id, role: String(user.role) };

  let batchId = arg('batch');
  if (!batchId) {
    const zip = arg('zip') || usage('--zip or --batch is required');
    let source: { sourceKind: string; sourceBucket: string | null; sourceKey: string; fileName: string };
    if (zip.startsWith('s3://')) {
      const [, , bucket, ...rest] = zip.split('/');
      source = { sourceKind: 's3', sourceBucket: bucket, sourceKey: rest.join('/'), fileName: path.basename(zip) };
    } else if (existsSync(zip)) {
      source = { sourceKind: 'local', sourceBucket: null, sourceKey: path.resolve(zip), fileName: path.basename(zip) };
    } else {
      const bucket = valantDocsBucket() || usage(`No local file at that path and no S3 bucket configured`);
      source = { sourceKind: 's3', sourceBucket: bucket, sourceKey: zip.replace(/^\/+/, ''), fileName: path.basename(zip) };
    }
    const depth = arg('wrapper-depth');
    if (depth !== undefined && !/^[0-5]$/.test(depth)) usage('--wrapper-depth must be a number from 0 to 5');
    const options = {
      allowNameOnly: !flag('no-name-only'),
      ocrForSearch: flag('ocr-later'),
      ...(flag('no-7z') ? { use7z: false } : {}),
      ...(depth !== undefined ? { wrapperDepth: Number(depth) } : {}),
    };
    const batch = await prisma.valantDocImportBatch.create({
      data: {
        organizationId: orgId,
        status: 'uploaded',
        ...source,
        options: options as Prisma.InputJsonValue,
        ocrForSearch: options.ocrForSearch,
        createdById: actor.userId,
      },
    });
    batchId = batch.id;
    console.log(`Created batch ${batchId}`);
  }

  const run = async (phase: Phase) => {
    if (!(await claimBatch(batchId!, orgId, phase))) {
      const b = await prisma.valantDocImportBatch.findFirst({ where: { id: batchId, organizationId: orgId }, select: { status: true } });
      const what = phase === 'apply' ? 'the import' : phase === 'rematch' ? 'a re-run' : 'a dry run';
      const hint = phase === 'apply' ? ' (run a dry run first)' : phase === 'rematch' ? ' (the batch must be imported, or a stopped re-run)' : '';
      usage(b ? `Cannot start ${what} while the batch is "${b.status}"${hint}` : 'Batch not found in this organization');
    }
    console.log(phase === 'apply' ? 'Importing…' : phase === 'rematch' ? 'Re-running with the updated matching…' : 'Dry run…');
    await runValantDocBatch(batchId!, phase, actor, (line) => console.log(`  ${line}`));
    const b = await prisma.valantDocImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    printReport(b.id, b.status, b.counts as unknown as ImportCounts, b.report as Record<string, unknown>, b.error);
    return b.status;
  };

  const existing = await prisma.valantDocImportBatch.findFirst({ where: { id: batchId, organizationId: orgId }, select: { status: true, options: true } });
  if (!existing) usage('Batch not found in this organization');
  if (flag('no-7z') && arg('batch')) {
    const opts = { ...((existing.options ?? {}) as Record<string, unknown>), use7z: false };
    await prisma.valantDocImportBatch.update({ where: { id: batchId }, data: { options: opts as Prisma.InputJsonValue } });
  }
  if (rematch) {
    const status = await run('rematch');
    if (status !== 'done') process.exit(1);
    return;
  }
  if (!apply || existing.status === 'uploaded') {
    const status = await run('dry_run');
    if (status !== 'dry_run_done') process.exit(1);
    if (!apply) {
      console.log(`\nReview the report, then import with: npx tsx scripts/import-valant-documents.ts --batch ${batchId} --org ${orgId} --user ${userArg} --apply`);
      return;
    }
  }
  const status = await run('apply');
  if (status !== 'done') process.exit(1);
}

main()
  .catch((err) => {
    console.error('Import failed:', err instanceof Error ? err.name : 'error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
