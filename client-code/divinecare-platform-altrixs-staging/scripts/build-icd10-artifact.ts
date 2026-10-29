/**
 * Build data/icd10cm/icd10cm-<FY>.tsv.gz from the official CDC/NCHS ICD-10-CM "order" file.
 *
 * Source (public domain): https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/<FY>/icd10cm-code-descriptions-<FY>.zip
 * Unzip it and pass the order file:
 *   npx tsx scripts/build-icd10-artifact.ts <path>/icd10cm-order-2027.txt 2027 <sha256 of the zip> <path>/icd10cm-order-addenda-2027.txt
 * The addenda file (optional) supplies the codes deleted this fiscal year (kept in the meta JSON so
 * a stored code can be reported as "deleted in FY2027" rather than just "unknown").
 *
 * Order file layout (fixed width, see icd10OrderFiles.pdf in the zip):
 *   1-5 order number, 7-13 code (no dot), 15 billable flag (1 = valid for HIPAA transactions),
 *   17-76 short description, 78+ long description.
 * Output: gzipped TSV, one row per code, header line first:
 *   code \t billable(0|1) \t short \t long      (short is "" when identical to long)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [input, fy, zipSha, addendaPath] = process.argv.slice(2);
if (!input || !/^\d{4}$/.test(fy || '')) {
  console.error('usage: tsx scripts/build-icd10-artifact.ts <icd10cm-order-FY.txt> <FY> [zip sha256]');
  process.exit(1);
}

const lines = fs.readFileSync(input, 'latin1').split(/\r?\n/).filter((l) => l.trim());
const rows: string[] = [];
let billable = 0;
const seen = new Set<string>();
for (const line of lines) {
  const code = line.slice(6, 13).trim();
  const flag = line.slice(14, 15);
  const short = line.slice(16, 76).trim();
  const long = line.slice(77).trim();
  if (!/^[A-Z][0-9A-Z]{2,6}$/.test(code) || (flag !== '0' && flag !== '1') || !long) {
    throw new Error(`Unexpected order-file line: ${JSON.stringify(line.slice(0, 90))}`);
  }
  if (seen.has(code)) throw new Error(`Duplicate code ${code}`);
  seen.add(code);
  if (flag === '1') billable++;
  if (/[\t\n]/.test(short + long)) throw new Error(`Tab/newline in description for ${code}`);
  rows.push([code, flag, short === long ? '' : short, long].join('\t'));
}

// Codes deleted this FY: a "Delete:" addenda line whose code is not in the new order file.
const deletedCodes: { code: string; description: string }[] = [];
if (addendaPath) {
  for (const line of fs.readFileSync(addendaPath, 'latin1').split(/\r?\n/)) {
    const m = /^Delete:\s+[01]\s+([A-Z][0-9A-Z]{2,6})\s+(.{1,60}?)\s{2,}/.exec(line);
    if (m && !seen.has(m[1])) deletedCodes.push({ code: m[1], description: m[2].trim() });
  }
}

const outDir = path.join(__dirname, '..', 'data', 'icd10cm');
fs.mkdirSync(outDir, { recursive: true });
const body = `code\tbillable\tshort\tlong\n${rows.join('\n')}\n`;
const gz = zlib.gzipSync(Buffer.from(body, 'utf8'), { level: 9 });
const out = path.join(outDir, `icd10cm-${fy}.tsv.gz`);
fs.writeFileSync(out, gz);
const meta = {
  fiscalYear: Number(fy),
  label: `FY${fy}`,
  effective: `${Number(fy) - 1}-10-01`,
  source: `https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/${fy}/icd10cm-code-descriptions-${fy}.zip`,
  sourceFile: path.basename(input),
  sourceZipSha256: zipSha || null,
  publisher: 'CDC / National Center for Health Statistics (public domain)',
  totalCodes: rows.length,
  billableCodes: billable,
  artifact: path.basename(out),
  artifactBytes: gz.length,
  deletedCodes,
};
fs.writeFileSync(path.join(outDir, `icd10cm-${fy}.meta.json`), JSON.stringify(meta, null, 2) + '\n');
console.log({ ...meta, deletedCodes: deletedCodes.length });
