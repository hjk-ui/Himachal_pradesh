/**
 * Diagnose a Valant documents ZIP: prints ONLY counts (no names, no paths, no contents).
 *
 *   npx tsx scripts/diagnose-valant-zip.ts /data/valant/export.zip
 *   npx tsx scripts/diagnose-valant-zip.ts migration/valant-docs/<batch>/source.zip [--bucket my-bucket]
 *   npx tsx scripts/diagnose-valant-zip.ts s3://my-bucket/migration/valant-docs/<batch>/source.zip
 *   [--sample 50]   entries test-read per compression method (default 50)
 *
 * Reports: total entries (files / folders), entries by compression method number (0 Stored,
 * 8 Deflate, 9 Deflate64, ...), encrypted entries, ZIP64 yes/no, and for each compression method
 * the result of reading the first N file entries: OK, or the error class (classifyReadError). When
 * Deflate64 entries exist, they are also test-read through 7-Zip if it is installed.
 * Reads happen in memory only (nothing is written except a temp one-entry ZIP for 7-Zip, removed).
 */
import 'dotenv/config';
import { existsSync } from 'fs';
import path from 'path';
import { classifyReadError } from '@/lib/migration/valantDocuments';
import {
  DEFLATE64,
  entryUsesZip64,
  openZip,
  readEntry,
  scanEntries,
  SEVEN_ZIP_HINT,
  sevenZipAvailable,
  valantDocsBucket,
  type ZipSource,
} from '@/lib/migration/valantZip';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const SAMPLE = Math.max(1, Number(opt('sample')) || 50);

const METHOD_NAMES: Record<number, string> = { 0: 'Stored', 8: 'Deflate', 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 98: 'PPMd' };
const methodLabel = (m: number) => `${m} (${METHOD_NAMES[m] ?? 'other'})`;
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

function source(): ZipSource {
  if (!target) {
    console.error('Usage: npx tsx scripts/diagnose-valant-zip.ts <local path | s3 key | s3://bucket/key> [--bucket b] [--sample 50]');
    process.exit(1);
  }
  if (target.startsWith('s3://')) {
    const [, , bucket, ...rest] = target.split('/');
    return { kind: 's3', bucket, key: rest.join('/') };
  }
  if (existsSync(target)) return { kind: 'local', path: path.resolve(target) };
  const bucket = opt('bucket') || valantDocsBucket();
  if (!bucket) {
    console.error('No local file at that path, and no bucket (--bucket, VALANT_IMPORT_S3_BUCKET or DOC_INTAKE_S3_BUCKET)');
    process.exit(1);
  }
  return { kind: 's3', bucket, key: target.replace(/^\/+/, '') };
}

async function main() {
  const src = source();
  const { zip, size } = await openZip(src);
  try {
    const entries = await scanEntries(zip);
    const files = entries.filter((e) => !e.isDir);
    const byMethod = new Map<number, number>();
    for (const f of files) byMethod.set(f.compressionMethod, (byMethod.get(f.compressionMethod) ?? 0) + 1);
    const encrypted = files.filter((f) => f.encrypted).length;
    const zip64Entries = entries.filter((e) => entryUsesZip64(e.entry)).length;
    const zip64 = zip64Entries > 0 || entries.length >= 0xffff || size > 0xffffffff;

    console.log(`Source: ${src.kind === 's3' ? 'S3 object' : 'local file'}, ${(size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Entries: ${entries.length} (files ${files.length}, folders ${entries.length - files.length}, system files ${files.filter((f) => f.junk).length})`);
    console.log(`Uncompressed total: ${(files.reduce((n, f) => n + f.size, 0) / 1024 ** 3).toFixed(2)} GB`);
    console.log(`ZIP64: ${zip64 ? 'yes' : 'no'} (entries with the ZIP64 field: ${zip64Entries})`);
    console.log(`Encrypted entries: ${encrypted}`);
    console.log('Files by compression method:');
    for (const [m, n] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${methodLabel(m)}: ${n}`);
    console.log(`Empty files (0 bytes): ${files.filter((f) => f.size === 0).length}`);

    console.log(`\nTest read (first ${SAMPLE} non-empty, unencrypted files per method, with the import's reader, 7-Zip off):`);
    for (const m of [...byMethod.keys()].sort((a, b) => a - b)) {
      const sample = files.filter((f) => f.compressionMethod === m && !f.encrypted && f.size > 0).slice(0, SAMPLE);
      const results = new Map<string, number>();
      for (const f of sample) {
        try {
          await readEntry(zip, f.entry, null, { use7z: false });
          bump(results, 'ok');
        } catch (err) {
          bump(results, classifyReadError(err));
        }
      }
      console.log(`  method ${methodLabel(m)}: ${sample.length} read → ${[...results.entries()].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    }

    const d64 = files.filter((f) => f.compressionMethod === DEFLATE64 && !f.encrypted && f.size > 0);
    if (d64.length) {
      if (!sevenZipAvailable()) {
        console.log(`\n7-Zip: NOT installed. ${SEVEN_ZIP_HINT}`);
      } else {
        const results = new Map<string, number>();
        const sample = d64.slice(0, SAMPLE);
        for (const f of sample) {
          try {
            await readEntry(zip, f.entry, null, { use7z: true });
            bump(results, 'ok');
          } catch (err) {
            bump(results, classifyReadError(err));
          }
        }
        console.log(`\n7-Zip test read of Deflate64 files: ${sample.length} read → ${[...results.entries()].map(([k, n]) => `${k} ${n}`).join(', ')}`);
      }
    } else {
      console.log(`\n7-Zip: ${sevenZipAvailable() ? 'installed' : 'not installed'} (no Deflate64 files, not needed)`);
    }
  } finally {
    zip.close();
  }
}

main().catch((err) => {
  console.error('Could not read the archive:', classifyReadError(err));
  process.exit(1);
});
