import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export type ZipEntry = {
  path: string;
  bytes: Buffer;
  /** ZIP compression method (8=deflate, 9=Deflate64) */
  method?: number;
};

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const LEN_EXTRA_64 = [...LEN_EXTRA.slice(0, 28), 16];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const DIST_EXTRA_64 = [...DIST_EXTRA, 14, 14];

function bases(extra: number[]) {
  const out = [1];
  for (let i = 0; i < extra.length - 1; i += 1) out.push(out[i] + (1 << extra[i]));
  return out;
}

const DIST_BASE = bases(DIST_EXTRA);
const DIST_BASE_64 = bases(DIST_EXTRA_64);

class BitReader {
  bit = 0;
  constructor(private readonly data: Buffer) {}
  pull(count: number) {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = this.data[this.bit >> 3];
      if (byte === undefined) throw new Error('Deflate64 stream ended early');
      value |= ((byte >> (this.bit & 7)) & 1) << i;
      this.bit += 1;
    }
    return value;
  }
  align() {
    this.bit = (this.bit + 7) & ~7;
  }
}

function inflate64(data: Buffer) {
  const reader = new BitReader(data);
  const out: number[] = [];
  let final = 0;
  while (!final) {
    final = reader.pull(1);
    const type = reader.pull(2);
    if (type === 0) {
      reader.align();
      const start = reader.bit >> 3;
      const len = data.readUInt16LE(start);
      const nlen = data.readUInt16LE(start + 2);
      if ((len ^ 0xffff) !== nlen) throw new Error('Bad stored block');
      for (let i = 0; i < len; i += 1) out.push(data[start + 4 + i]);
      reader.bit = (start + 4 + len) * 8;
      continue;
    }
    let literal: number[];
    let distance: number[];
    if (type === 1) {
      literal = fixedTree();
      distance = fixedDistance();
    } else if (type === 2) {
      const trees = dynamicTrees(reader);
      literal = trees.literal;
      distance = trees.distance;
    } else {
      throw new Error('Bad Deflate64 block');
    }
    for (;;) {
      const symbol = decode(reader, literal);
      if (symbol === 256) break;
      if (symbol < 256) {
        out.push(symbol);
        continue;
      }
      const index = symbol - 257;
      const extra = LEN_EXTRA_64[index] ?? 0;
      const length = Math.min(65538, (LEN_BASE[index] ?? 3) + (extra ? reader.pull(extra) : 0));
      const distSymbol = decode(reader, distance);
      const distExtra = DIST_EXTRA_64[distSymbol] ?? 0;
      const offset = (DIST_BASE_64[distSymbol] ?? 1) + (distExtra ? reader.pull(distExtra) : 0);
      if (offset <= 0 || offset > out.length) throw new Error('Bad distance');
      for (let i = 0; i < length; i += 1) out.push(out[out.length - offset]);
    }
  }
  return Buffer.from(out);
}

function dynamicTrees(reader: BitReader) {
  const hlit = reader.pull(5) + 257;
  const hdist = reader.pull(5) + 1;
  const hclen = reader.pull(4) + 4;
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codeLengths = Array(19).fill(0);
  for (let i = 0; i < hclen; i += 1) codeLengths[order[i]] = reader.pull(3);
  const all: number[] = [];
  while (all.length < hlit + hdist) {
    const symbol = decode(reader, codeLengths);
    if (symbol < 16) all.push(symbol);
    else if (symbol === 16) {
      const copy = all[all.length - 1] ?? 0;
      const times = reader.pull(2) + 3;
      for (let i = 0; i < times; i += 1) all.push(copy);
    } else if (symbol === 17) {
      const times = reader.pull(3) + 3;
      for (let i = 0; i < times; i += 1) all.push(0);
    } else {
      const times = reader.pull(7) + 11;
      for (let i = 0; i < times; i += 1) all.push(0);
    }
  }
  return { literal: all.slice(0, hlit), distance: all.slice(hlit, hlit + hdist) };
}

function decode(reader: BitReader, lengths: number[]) {
  const counts: number[] = [];
  lengths.forEach((len) => {
    if (len) counts[len] = (counts[len] || 0) + 1;
  });
  const next: number[] = [];
  let code = 0;
  for (let len = 1; len <= 15; len += 1) {
    code = (code + (counts[len - 1] || 0)) << 1;
    next[len] = code;
  }
  let value = 0;
  for (let len = 1; len <= 15; len += 1) {
    value = (value << 1) | reader.pull(1);
    const first = next[len] ?? 0;
    const count = counts[len] || 0;
    if (value >= first && value < first + count) {
      let seen = value - first;
      for (let symbol = 0; symbol < lengths.length; symbol += 1) {
        if (lengths[symbol] !== len) continue;
        if (seen === 0) return symbol;
        seen -= 1;
      }
    }
  }
  throw new Error('Bad Deflate64 symbol');
}

function fixedTree() {
  const lengths = Array(288).fill(8);
  for (let i = 144; i <= 255; i += 1) lengths[i] = 9;
  for (let i = 256; i <= 279; i += 1) lengths[i] = 7;
  for (let i = 280; i <= 287; i += 1) lengths[i] = 8;
  return lengths;
}

function fixedDistance() {
  return Array(32).fill(5);
}

function inflateEntry(method: number, data: Buffer) {
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  // Method 9 = Deflate64. In-process inflate64 is the default path (works without
  // shelling out). Optional alternative in locked-down hosts: p7zip / 7z binary.
  if (method === 9) return inflate64(data);
  throw new Error(`Unsupported ZIP method ${method}`);
}

function readZipFlat(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.slice(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (!name.endsWith('/')) {
      entries.push({
        path: name.replace(/\\/g, '/'),
        bytes: inflateEntry(method, buffer.slice(dataStart, dataEnd)),
        method,
      });
    }
    offset = dataEnd;
  }
  return entries;
}

/**
 * Read ZIP including nested .zip members (Valant exports often nest archives).
 * Depth-capped to avoid zip-bomb / cycles.
 */
export function readZip(buffer: Buffer, depth = 0): ZipEntry[] {
  const MAX_DEPTH = 3;
  const flat = readZipFlat(buffer);
  if (depth >= MAX_DEPTH) return flat;

  const out: ZipEntry[] = [];
  for (const entry of flat) {
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('.zip') && entry.bytes.length > 4 && entry.bytes.readUInt32LE(0) === 0x04034b50) {
      try {
        const nested = readZip(entry.bytes, depth + 1);
        const prefix = entry.path.replace(/\.zip$/i, '');
        for (const child of nested) {
          out.push({
            path: `${prefix}/${child.path}`.replace(/\/+/g, '/'),
            bytes: child.bytes,
          });
        }
      } catch {
        // Keep the nested zip as a binary artifact if it cannot be expanded
        out.push(entry);
      }
    } else {
      out.push(entry);
    }
  }
  return out;
}

export function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isBillingArchive(path: string) {
  return path.split('/').some((part) => /billing[\s_-]*archive/i.test(part));
}

export function clientCodeInPath(path: string, codes: string[]) {
  const haystack = path.toLowerCase();
  const ranked = codes.filter((code) => code.length >= 4).sort((a, b) => b.length - a.length);
  return ranked.find((code) => haystack.includes(code.toLowerCase())) || null;
}
