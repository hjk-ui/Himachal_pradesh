/**
 * Server-side ICD-10-CM code set: the official CDC/NCHS FY2027 order file, checked in as
 * data/icd10cm/icd10cm-2027.tsv.gz (built by scripts/build-icd10-artifact.ts). Loaded and indexed
 * once per server process on first use (~100k codes, well under a second), then shared.
 *
 * Do not import from a 'use client' file (reads the file system); the pickers call
 * GET /api/icd10/search instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ICD10_FISCAL_YEAR } from './normalize';
import { buildIcd10Index, type Icd10Index, type Icd10Row } from './search';

export type Icd10Meta = {
  fiscalYear: number;
  label: string;
  effective: string;
  source: string;
  totalCodes: number;
  billableCodes: number;
  deletedCodes: { code: string; description: string }[];
};

export type Icd10CodeSet = { index: Icd10Index; meta: Icd10Meta; deleted: Map<string, string> };

let cached: Icd10CodeSet | null = null;

export function icd10DataDir(): string {
  return process.env.ICD10_DATA_DIR || path.join(process.cwd(), 'data', 'icd10cm');
}

/** Parse the artifact TSV (header: code, billable, short, long). */
export function parseIcd10Tsv(text: string): Icd10Row[] {
  const lines = text.split('\n');
  if (!lines[0]?.startsWith('code\tbillable')) throw new Error('ICD-10 artifact: unexpected header');
  const rows: Icd10Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [key, flag, short, long] = line.split('\t');
    rows.push({ key, billable: flag === '1', short: short || long, long });
  }
  return rows;
}

export function loadIcd10CodeSet(): Icd10CodeSet {
  if (cached) return cached;
  const dir = icd10DataDir();
  const fy = ICD10_FISCAL_YEAR;
  const gz = fs.readFileSync(path.join(dir, `icd10cm-${fy}.tsv.gz`));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `icd10cm-${fy}.meta.json`), 'utf8')) as Icd10Meta;
  const rows = parseIcd10Tsv(zlib.gunzipSync(gz).toString('utf8'));
  if (rows.length !== meta.totalCodes) throw new Error(`ICD-10 artifact: ${rows.length} rows, meta says ${meta.totalCodes}`);
  const deleted = new Map((meta.deletedCodes || []).map((d) => [d.code, d.description] as const));
  cached = { index: buildIcd10Index(rows), meta, deleted };
  return cached;
}
