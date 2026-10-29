import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FILTER_BAR,
  TABLE_SCROLL,
  TABLE_STICKY_ACTIONS,
  TABLE_STICKY_FIRST,
} from '../src/lib/layout/tableLayout';
import { PORTAL_BUTTON, PORTAL_FIELD, PORTAL_MAIN } from '../src/lib/layout/portalLayout';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/**
 * Heuristic: a `grid-cols-N` (N >= 3) with no breakpoint prefix (sm:/md:/lg:/xl:/2xl:) forces N columns on a
 * 390px phone. Returns the offending class names.
 */
function bareLargeGrids(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(/(?<![\w:-])grid-cols-(\d+)\b/g)) {
    if (Number(m[1]) >= 3) hits.push(m[0]);
  }
  return hits;
}

test('clinic-scroll-x is a positioned containing block', () => {
  const css = read('src/app/globals.css');
  const block = css.match(/\.clinic-scroll-x\s*\{([^}]*)\}/);
  assert.ok(block, '.clinic-scroll-x rule exists');
  assert.match(block![1], /position:\s*relative/);
  assert.match(block![1], /overflow-x-auto/);
});

test('TABLE_SCROLL is exported and uses clinic-scroll-x', () => {
  assert.equal(typeof TABLE_SCROLL, 'string');
  assert.match(TABLE_SCROLL, /\bclinic-scroll-x\b/);
  assert.match(TABLE_SCROLL, /\boverflow-x-auto\b/);
  assert.match(read('src/lib/layout/tableLayout.ts'), /export const TABLE_SCROLL\b/);
});

test('sticky table columns and filter bar tokens stay shrink-safe', () => {
  assert.match(TABLE_STICKY_FIRST, /\bsticky\b.*\bleft-0\b/);
  assert.match(TABLE_STICKY_ACTIONS, /\bsticky\b.*\bright-0\b/);
  assert.match(FILTER_BAR, /\bflex-wrap\b/);
  assert.match(FILTER_BAR, /\bmin-w-0\b/);
});

test('portal layout tokens keep 44px touch targets', () => {
  assert.match(PORTAL_BUTTON, /\bmin-h-11\b/);
  assert.match(PORTAL_FIELD, /\bmin-h-11\b/);
  assert.match(PORTAL_MAIN, /\bmax-w-2xl\b/);
});

test('bareLargeGrids heuristic', () => {
  assert.deepEqual(bareLargeGrids('grid grid-cols-3 gap-3'), ['grid-cols-3']);
  assert.deepEqual(bareLargeGrids('grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4'), []);
  assert.deepEqual(bareLargeGrids('grid grid-cols-2 md:grid-cols-6'), []);
});

const KEY_FILES = [
  'src/app/dashboard/scribe/page.tsx',
  'src/components/scribe/RecordingStatusBar.tsx',
  'src/components/scribe/DraftSuggestions.tsx',
  'src/components/chart/ChartHistoryCard.tsx',
  'src/components/visits/VisitSessionTabs.tsx',
  'src/components/visits/VisitGuide.tsx',
];

for (const file of KEY_FILES) {
  test(`no bare large grids in ${file}`, () => {
    assert.deepEqual(bareLargeGrids(read(file)), []);
  });
}

test('new Oct 25 controls meet the 44px touch target', () => {
  for (const file of [
    'src/components/scribe/RecordingStatusBar.tsx',
    'src/components/scribe/DraftSuggestions.tsx',
    'src/components/chart/ChartHistoryCard.tsx',
    'src/components/visits/VisitSessionTabs.tsx',
  ]) {
    assert.match(read(file), /\bmin-h-11\b/, `${file} has min-h-11 buttons`);
  }
});
