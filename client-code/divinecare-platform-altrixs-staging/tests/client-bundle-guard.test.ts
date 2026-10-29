import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// A 'use client' file must not import a module that loads Prisma or is marked server-only:
// the browser bundle then breaks at runtime ("PrismaClient is unable to run in this browser environment").
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SERVER_MARK = /from ['"]@\/lib\/db\/prisma['"]|from ['"]@prisma\/client['"](?!;?\s*$)|^import ['"]server-only['"]/m;

function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolveAlias(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = path.join(SRC, spec.slice(2));
  for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

/** Imports that bring values (type-only imports are erased and are safe) */
function valueImports(src: string): string[] {
  const out: string[] = [];
  const re = /^import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[2]);
  return out;
}

function loadsServerCode(file: string): boolean {
  const s = fs.readFileSync(file, 'utf8');
  return /from ['"]@\/lib\/db\/prisma['"]/.test(s) || /^import ['"]server-only['"]/m.test(s);
}

test('client components do not import modules that load Prisma or server-only code', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/^\s*['"]use client['"]/.test(src)) continue;
    if (SERVER_MARK.test(src) && /from ['"]@\/lib\/db\/prisma['"]/.test(src)) offenders.push(`${path.relative(ROOT, file)} imports prisma directly`);
    for (const spec of valueImports(src)) {
      const target = resolveAlias(spec);
      if (target && loadsServerCode(target)) offenders.push(`${path.relative(ROOT, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});
