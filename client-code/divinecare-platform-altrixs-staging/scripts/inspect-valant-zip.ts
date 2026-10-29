/**
 * Inspect a Valant documents ZIP WITHOUT printing any PHI: only the masked structure.
 * Reads the central directory only (names and sizes); no document contents are read or printed.
 *
 *   npx tsx scripts/inspect-valant-zip.ts /path/to/export.zip [--sample 60] [--all]
 *
 * Masking: letters → X / x, digits → # ("Xxxx, Xxxx (#####)/Xxxxxxxx Xxxxx/####-##-## Xxxxxx.pdf").
 * Subfolder names below the client folder are shown unmasked only when they contain no digits and
 * match a document type keyword ("Progress Notes"); anything else is masked.
 */
import * as yauzl from 'yauzl';
import {
  classifyValantDocument,
  detectWrapperDepth,
  extensionOf,
  isJunkEntry,
  maskFileName,
  maskPath,
  maskSubfolder,
  maskText,
  normalizeClientCode,
  normalizeEntryPath,
  parseDocumentDate,
  parseValantFileName,
  splitArchivePath,
} from '../src/lib/migration/valantDocuments';

const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith('--'));
const sampleArg = args.indexOf('--sample');
const SAMPLE = args.includes('--all') ? Infinity : sampleArg >= 0 ? Number(args[sampleArg + 1]) || 60 : 60;

if (!zipPath) {
  console.error('Usage: npx tsx scripts/inspect-valant-zip.ts <local zip path> [--sample N] [--all]');
  process.exit(1);
}

/** Shape of a masked name: letter runs → A ("Xxxx, Xxxx (#####)" → "A, A (#####)") */
const shape = (s: string) => maskText(s).replace(/[Xx]+/g, 'A');
const fileShape = (s: string) => maskFileName(s).replace(/[Xx]+/g, 'A');
const fmtBytes = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m: Map<string, number>, n = 40) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

async function main() {
  const zip = await yauzl.openPromise(zipPath!, { autoClose: false, decodeStrings: true, strictFileNames: false });
  const paths: { path: string; size: number; dir: boolean }[] = [];
  for await (const e of zip.eachEntry()) {
    const p = normalizeEntryPath(e.fileName);
    paths.push({ path: p, size: e.uncompressedSize, dir: p.endsWith('/') });
  }
  zip.close();

  const files = paths.filter((p) => !p.dir && !isJunkEntry(p.path));
  const junk = paths.filter((p) => !p.dir && isJunkEntry(p.path)).length;
  const wrapper = detectWrapperDepth(files.map((f) => f.path));
  const depth = new Map<string, number>();
  const ext = new Map<string, number>();
  const subfolders = new Map<string, number>();
  const folderShapes = new Map<string, number>();
  const fileShapes = new Map<string, number>();
  const types = new Map<string, number>();
  const clientFolders = new Set<string>();
  let loose = 0;
  let dated = 0;
  let valantNamed = 0;
  let codeAgrees = 0;

  for (const f of files) {
    bump(depth, String(f.path.split('/').length));
    bump(ext, extensionOf(f.path) || '(none)');
    const { clientFolder, subfolders: subs, fileName } = splitArchivePath(f.path, wrapper);
    if (!clientFolder) loose++;
    else clientFolders.add(clientFolder);
    for (const s of subs) bump(subfolders, maskSubfolder(s));
    bump(fileShapes, fileShape(fileName));
    bump(types, classifyValantDocument(subs, fileName).type);
    if (parseDocumentDate(fileName)) dated++;
    const vn = parseValantFileName(fileName);
    if (vn) {
      valantNamed++;
      if (clientFolder && normalizeClientCode(vn.code) && normalizeClientCode(vn.code) === normalizeClientCode(clientFolder)) codeAgrees++;
    }
  }
  for (const c of clientFolders) bump(folderShapes, shape(c));

  const out = (s = '') => console.log(s);
  out(`Archive: ${fmtBytes(paths.reduce((n, p) => n + p.size, 0))} uncompressed`);
  out(`Entries: ${paths.length} (files ${files.length}, folders ${paths.filter((p) => p.dir).length}, system files ${junk})`);
  out(`Wrapper folders above the client folders: ${wrapper}`);
  out(`Client folders: ${clientFolders.size}; files outside a client folder: ${loose}`);
  out(`Files with a date in the name: ${dated}`);
  out(`Files named CODE_YYYYMMDD_Title(DocId): ${valantNamed} (code equals the client folder name: ${codeAgrees})`);
  out(`Client folders that look like a Valant client code: ${[...clientFolders].filter((c) => normalizeClientCode(c)).length}`);
  out(`Total size of files: ${fmtBytes(files.reduce((n, f) => n + f.size, 0))}`);
  out();
  out('Depth (path segments per file):');
  for (const [d, n] of [...depth.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) out(`  ${d}: ${n}`);
  out('Files by extension:');
  for (const [e, n] of top(ext)) out(`  ${e}: ${n}`);
  out('Document type by the keyword rules:');
  for (const [t, n] of top(types)) out(`  ${t}: ${n}`);
  out('Distinct subfolder names (masked unless a known type keyword):');
  for (const [s, n] of top(subfolders, 100)) out(`  ${s}: ${n}`);
  out('Client folder name patterns (letters → A):');
  for (const [s, n] of top(folderShapes, 30)) out(`  ${s}: ${n}`);
  out('File name patterns (letters → A):');
  for (const [s, n] of top(fileShapes, 30)) out(`  ${s}: ${n}`);
  out();
  out(`Masked structure (${SAMPLE === Infinity ? 'all' : `first ${Math.min(SAMPLE, files.length)}`} files):`);
  for (const f of files.slice(0, SAMPLE === Infinity ? files.length : SAMPLE)) out(`  ${maskPath(f.path)}`);
}

main().catch((err) => {
  console.error('Could not read the archive:', err instanceof Error ? err.name : 'error');
  process.exit(1);
});
