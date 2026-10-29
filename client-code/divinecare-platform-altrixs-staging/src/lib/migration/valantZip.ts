/**
 * Valant documents ZIP: archive reading (no database). Used by the import job
 * (src/lib/migration/valantDocumentsJob.ts) and scripts/diagnose-valant-zip.ts.
 *
 * Streaming: the ZIP is never loaded into memory. yauzl reads the central directory, then each
 * entry is streamed (inflated) straight into a hash and, when applying, into a file. From S3 the
 * archive is read with ranged GETs (small reads share a block cache).
 *
 * Deflate64 (compression method 9, written by Windows "Send to → Compressed folder" for large
 * folders) is not supported by yauzl. Those entries are read with 7-Zip instead (p7zip-full on
 * Ubuntu): the entry's raw compressed bytes (a ranged read, also from S3) are wrapped in a one-entry
 * ZIP in a temp folder and `7z x -so` streams the content out. Disk need: one entry at a time.
 */
import { spawn, spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { open, statfs, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { PassThrough, Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import * as yauzl from 'yauzl';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { awsClientConfig } from '@/lib/aws/clientConfig';
import { isJunkEntry, normalizeEntryPath } from './valantDocuments';

const REGION = process.env.AWS_REGION?.trim() || 'us-east-1';

/** Bucket for the uploaded ZIP: a dedicated one if set, else the document intake staging bucket */
export function valantDocsBucket(): string {
  return process.env.VALANT_IMPORT_S3_BUCKET?.trim() || process.env.DOC_INTAKE_S3_BUCKET?.trim() || '';
}

/** Browser upload needs AWS credentials (keys or AWS_LIVE instance role) and a bucket */
export function isValantDocsS3Configured(): boolean {
  const creds = Boolean(process.env.AWS_ACCESS_KEY_ID?.trim()) || process.env.AWS_LIVE === 'true';
  return creds && Boolean(valantDocsBucket());
}

let s3: S3Client | null = null;
export function valantDocsS3() {
  s3 ??= new S3Client({ region: REGION, ...awsClientConfig({ requestTimeout: 120_000 }) });
  return s3;
}

// ─── Random access over S3 ────────────────────────────────────────────────────

const BLOCK = 4 * 1024 * 1024;
const SMALL_READ = 512 * 1024;
const MAX_BLOCKS = 8;

/** yauzl random access over an S3 object: ranged GETs, small reads served from cached 4 MB blocks */
export class S3RangeReader extends yauzl.RandomAccessReader {
  private blocks = new Map<number, Promise<Buffer>>();

  constructor(
    private client: S3Client,
    private bucket: string,
    private key: string,
    private size: number
  ) {
    super();
  }

  private async range(start: number, endInclusive: number): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key, Range: `bytes=${start}-${endInclusive}` })
    );
    return res.Body as Readable;
  }

  private block(i: number): Promise<Buffer> {
    let p = this.blocks.get(i);
    if (!p) {
      p = (async () => {
        const body = await this.range(i * BLOCK, Math.min(this.size, (i + 1) * BLOCK) - 1);
        const chunks: Buffer[] = [];
        for await (const c of body) chunks.push(Buffer.from(c as Buffer));
        return Buffer.concat(chunks);
      })();
      p.catch(() => this.blocks.delete(i));
      this.blocks.set(i, p);
      if (this.blocks.size > MAX_BLOCKS) this.blocks.delete(this.blocks.keys().next().value as number);
    }
    return p;
  }

  _readStreamForRange(start: number, end: number): Readable {
    const out = new PassThrough();
    (async () => {
      if (end - start <= SMALL_READ) {
        const parts: Buffer[] = [];
        for (let b = Math.floor(start / BLOCK); b * BLOCK < end; b++) {
          const buf = await this.block(b);
          parts.push(buf.subarray(Math.max(start, b * BLOCK) - b * BLOCK, Math.min(end, (b + 1) * BLOCK) - b * BLOCK));
        }
        out.end(Buffer.concat(parts));
        return;
      }
      const body = await this.range(start, end - 1);
      out.on('close', () => body.destroy());
      body.on('error', (e) => out.destroy(e));
      body.pipe(out);
    })().catch((e: Error) => out.destroy(e));
    return out;
  }
}

export type ZipSource = { kind: 's3'; bucket: string; key: string } | { kind: 'local'; path: string };

export async function openZip(src: ZipSource): Promise<{ zip: yauzl.ZipFile; size: number }> {
  const options = { autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: false };
  if (src.kind === 'local') {
    const zip = await yauzl.openPromise(src.path, options);
    return { zip, size: zip.fileSize };
  }
  const head = await valantDocsS3().send(new HeadObjectCommand({ Bucket: src.bucket, Key: src.key }));
  const size = Number(head.ContentLength ?? 0);
  if (!size) throw new Error('The uploaded archive is empty');
  const reader = new S3RangeReader(valantDocsS3(), src.bucket, src.key, size);
  const zip = await yauzl.fromRandomAccessReaderPromise(reader, size, options);
  return { zip, size };
}

export type ScannedEntry = {
  index: number;
  path: string;
  isDir: boolean;
  junk: boolean;
  encrypted: boolean;
  size: number;
  compressionMethod: number;
  entry: yauzl.Entry;
};

/** Central directory only: names and sizes, no file data */
export async function scanEntries(zip: yauzl.ZipFile): Promise<ScannedEntry[]> {
  const out: ScannedEntry[] = [];
  let index = 0;
  for await (const entry of zip.eachEntry()) {
    const path = normalizeEntryPath(entry.fileName);
    const isDir = path.endsWith('/');
    out.push({
      index: index++,
      path,
      isDir,
      junk: !isDir && isJunkEntry(path),
      encrypted: entry.isEncrypted(),
      size: entry.uncompressedSize,
      compressionMethod: entry.compressionMethod,
      entry,
    });
  }
  return out;
}

/** ZIP64 in use: the zip64 extra field (0x0001) on an entry, or sizes / counts past the 32-bit limits */
export function entryUsesZip64(entry: yauzl.Entry): boolean {
  return entry.extraFields.some((f) => f.id === 0x0001);
}

// ─── Read errors ──────────────────────────────────────────────────────────────

/** A read failure with a fixed reason class (see classifyReadError); the message carries no path */
export class ArchiveReadError extends Error {
  constructor(
    message: string,
    public reason: string,
    public missing7z = false
  ) {
    super(message);
    this.name = 'ArchiveReadError';
  }
}

// ─── 7-Zip (Deflate64) ────────────────────────────────────────────────────────

export const DEFLATE64 = 9;
const sevenZipBin = () => process.env.VALANT_7Z_BIN?.trim() || '7z';
let sevenZipChecked: boolean | null = null;

/** Whether the 7z command (p7zip-full) can run on this server; checked once */
export function sevenZipAvailable(): boolean {
  if (sevenZipChecked === null) {
    const r = spawnSync(sevenZipBin(), ['i'], { stdio: 'ignore', timeout: 15_000 });
    sevenZipChecked = !r.error && r.status === 0;
  }
  return sevenZipChecked;
}

export const SEVEN_ZIP_HINT = 'Deflate64 entries need 7-Zip on the server: sudo apt-get install -y p7zip-full, then re-run (Resume or Re-run with updated matching)';

/** Temp folder for the one-entry ZIPs handed to 7-Zip */
export const valantTmpDir = () => process.env.VALANT_IMPORT_TMP_DIR?.trim() || os.tmpdir();

/**
 * Local header and trailer (central directory + end record) of a ZIP holding exactly one entry whose
 * raw compressed bytes go between them. The entry is named "entry.bin" (no client data on disk names).
 */
export function singleEntryZipParts(e: {
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  lastModFileTime?: number;
  lastModFileDate?: number;
}): { header: Buffer; trailer: Buffer } {
  if (e.compressedSize > 0xfffffffe || e.uncompressedSize > 0xfffffffe) throw new ArchiveReadError('Entry too large for 7-Zip extraction', 'too_large_for_7z');
  const name = Buffer.from('entry.bin');
  const version = e.compressionMethod === DEFLATE64 ? 21 : 20;
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(version, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(e.compressionMethod, 8);
  header.writeUInt16LE(e.lastModFileTime ?? 0, 10);
  header.writeUInt16LE(e.lastModFileDate ?? 0x21, 12);
  header.writeUInt32LE(e.crc32 >>> 0, 14);
  header.writeUInt32LE(e.compressedSize, 18);
  header.writeUInt32LE(e.uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(version, 4);
  central.writeUInt16LE(version, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(e.compressionMethod, 10);
  central.writeUInt16LE(e.lastModFileTime ?? 0, 12);
  central.writeUInt16LE(e.lastModFileDate ?? 0x21, 14);
  central.writeUInt32LE(e.crc32 >>> 0, 16);
  central.writeUInt32LE(e.compressedSize, 20);
  central.writeUInt32LE(e.uncompressedSize, 24);
  central.writeUInt16LE(name.length, 28);
  // extra, comment, disk, internal / external attributes: 0; local header offset: 0
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(header.length + e.compressedSize, 16);
  return { header, trailer: Buffer.concat([central, end]) };
}

/** Write the entry's raw (still compressed) bytes into a one-entry ZIP at `file` */
async function writeSingleEntryZip(zip: yauzl.ZipFile, entry: yauzl.Entry, file: string) {
  const { header, trailer } = singleEntryZipParts(entry);
  const raw = await zip.openReadStreamPromise(entry, { decodeFileData: false });
  const fh = await open(file, 'wx', 0o600);
  try {
    await fh.write(header);
    let n = 0;
    for await (const chunk of raw) {
      const b = chunk as Buffer;
      n += b.length;
      await fh.write(b);
    }
    if (n !== entry.compressedSize) throw new ArchiveReadError('Compressed data size differs from the directory', 'size_mismatch');
    await fh.write(trailer);
  } finally {
    await fh.close();
  }
}

/** Stream the single entry of a one-entry ZIP through `7z x -so` into `tap` → `sink` */
async function extractWith7z(miniZip: string, tap: PassThrough, sink: Writable): Promise<void> {
  const child = spawn(sevenZipBin(), ['x', '-so', '-y', '-bd', miniZip], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume(); // messages are not logged (never needed, never PHI-checked)
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });
  try {
    await pipeline(child.stdout, tap, sink);
  } catch (err) {
    child.kill();
    await exited.catch(() => {});
    throw err;
  }
  const code = await exited.catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') throw new ArchiveReadError('7z is not installed', 'unsupported_compression:9', true);
    throw err;
  });
  if (code !== 0) throw new ArchiveReadError(`7z exited with code ${code}`, `extract_7z_failed:${code}`);
}

// ─── Reading one entry ────────────────────────────────────────────────────────

export type ReadOptions = {
  /** Read Deflate64 entries with 7-Zip. Default true */
  use7z?: boolean;
  /** Temp folder for the one-entry ZIP (default VALANT_IMPORT_TMP_DIR or the OS temp folder) */
  tmpDir?: string;
};

export type ReadResult = { sha256: string; head: Uint8Array; bytes: number; via: 'yauzl' | '7z' };

/**
 * Inflate one entry into a hash (and a file when `writeTo` is set); keeps the first 1 KB to sniff
 * the type. Stored / Deflate through yauzl; Deflate64 through 7-Zip (see the file comment).
 * Errors: ArchiveReadError with a reason class, file system errors (ENOSPC) as thrown.
 */
export async function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, writeTo: string | null, opts: ReadOptions = {}): Promise<ReadResult> {
  const hash = createHash('sha256');
  let head = Buffer.alloc(0);
  let bytes = 0;
  const tap = new PassThrough();
  tap.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
    if (head.length < 1024) head = Buffer.concat([head, chunk.subarray(0, 1024 - head.length)]);
  });
  const makeSink = (): Writable =>
    writeTo ? createWriteStream(writeTo, { flags: 'wx', mode: 0o600 }) : new Writable({ write: (_c, _e, cb) => cb() });
  const done = (via: ReadResult['via']): ReadResult => ({ sha256: hash.digest('hex'), head: new Uint8Array(head), bytes, via });

  const method = entry.compressionMethod;
  if (method === 0 || method === 8) {
    const stream = await zip.openReadStreamPromise(entry);
    await pipeline(stream, tap, makeSink());
    return done('yauzl');
  }
  if (method !== DEFLATE64) throw new ArchiveReadError(`unsupported compression method: ${method}`, `unsupported_compression:${method}`);
  if (opts.use7z === false) throw new ArchiveReadError('unsupported compression method: 9', 'unsupported_compression:9');
  if (!sevenZipAvailable()) throw new ArchiveReadError('7z is not installed', 'unsupported_compression:9', true);

  const mini = path.join(opts.tmpDir || valantTmpDir(), `valant-entry-${randomUUID()}.zip`);
  try {
    await writeSingleEntryZip(zip, entry, mini);
    await extractWith7z(mini, tap, makeSink());
  } finally {
    await unlink(mini).catch(() => {});
  }
  if (bytes !== entry.uncompressedSize) throw new ArchiveReadError('7z output size differs from the directory', 'size_mismatch');
  return done('7z');
}

/** Free bytes on the file system holding `dir` (null when unknown) */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}
