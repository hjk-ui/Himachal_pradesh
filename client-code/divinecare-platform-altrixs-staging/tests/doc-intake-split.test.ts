import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  formatPages,
  hasIdentifiers,
  identityKey,
  LEADING_KEY,
  resolvePageTexts,
  segmentPages,
  shouldSplit,
  type PageMatch,
} from '../src/lib/docIntake/segment';
import { extractPdfPages, PdfPagesError } from '../src/lib/docIntake/pdfPages';
import { extractPatientIdentifiers } from '../src/lib/docIntake/patientMatcher';

// Synthetic ids only; no real patient data
const none = (page: number): PageMatch => ({ page, kind: 'none' });
const matched = (page: number, clientId: string, lastName = clientId): PageMatch =>
  ({ page, kind: 'matched', clientId, lastName, reason: 'Source patient ID match' });
const unresolved = (page: number, key: string, extra: Partial<Extract<PageMatch, { kind: 'unresolved' }>> = {}): PageMatch =>
  ({ page, kind: 'unresolved', key, nameOnly: false, reason: 'No client with that ID', candidates: [], ...extra });

const summary = (pages: PageMatch[]) =>
  segmentPages(pages).map((g) => `${g.kind === 'matched' ? g.clientId : `?${g.key}`}:${g.pages.join(',')}`);

test('pages without identifiers continue the previous patient', () => {
  const pages = [matched(1, 'A'), none(2), none(3), matched(4, 'B'), none(5)];
  assert.deepEqual(summary(pages), ['A:1,2,3', 'B:4,5']);
  assert.equal(shouldSplit(segmentPages(pages)), true);
});

test('the same client on non-adjacent pages becomes one group in page order', () => {
  const pages = [matched(1, 'A'), none(2), matched(3, 'B'), matched(4, 'A'), none(5), matched(6, 'C')];
  assert.deepEqual(summary(pages), ['A:1,2,4,5', 'B:3', 'C:6']);
});

test('input order does not matter', () => {
  const pages = [none(3), matched(2, 'B'), matched(1, 'A')];
  assert.deepEqual(summary(pages), ['A:1', 'B:2,3']);
});

test('unmatched pages start their own group; the same unknown patient shares one group', () => {
  const cand = { clientId: 'X1', name: 'Synthetic One', dob: '1990-01-01', reason: 'Name only' };
  const pages = [
    matched(1, 'A'),
    unresolved(2, 'id:ZZTOP', { candidates: [cand] }),
    none(3),
    matched(4, 'B'),
    unresolved(5, 'id:ZZTOP', { candidates: [cand] }),
    unresolved(6, 'person:other||1980-02-02'),
  ];
  const groups = segmentPages(pages);
  assert.deepEqual(summary(pages), ['A:1', '?id:ZZTOP:2,3,5', 'B:4', '?person:other||1980-02-02:6']);
  const unknown = groups.find((g) => g.kind === 'unresolved' && g.key === 'id:ZZTOP');
  assert.ok(unknown && unknown.kind === 'unresolved');
  assert.equal(unknown.candidates.length, 1, 'candidates are de-duplicated');
  assert.equal(shouldSplit(groups), true);
});

test('a single-patient document is not split, including name-only and cover pages', () => {
  const pages = [none(1), matched(2, 'A', 'Sample'), none(3), unresolved(4, 'person:sample||', { nameOnly: true, lastName: 'SAMPLE' })];
  const groups = segmentPages(pages);
  assert.deepEqual(summary(pages), [`?${LEADING_KEY}:1`, 'A:2,3,4']);
  assert.equal(shouldSplit(groups), false);
  assert.equal(shouldSplit(segmentPages([matched(1, 'A'), none(2), none(3)])), false);
});

test('a name-only page with a different last name starts a group for staff', () => {
  const pages = [matched(1, 'A', 'Sample'), unresolved(2, 'person:other|x|', { nameOnly: true, lastName: 'Other' })];
  assert.deepEqual(summary(pages), ['A:1', '?person:other|x|:2']);
  assert.equal(shouldSplit(segmentPages(pages)), true);
});

test('a document with no identifiers anywhere stays one document', () => {
  const groups = segmentPages([none(1), none(2), none(3)]);
  assert.equal(groups.length, 1);
  assert.equal(shouldSplit(groups), false);
});

test('leading pages before the first patient become their own group when the file is split', () => {
  const pages = [none(1), matched(2, 'A'), matched(3, 'B')];
  assert.deepEqual(summary(pages), [`?${LEADING_KEY}:1`, 'A:2', 'B:3']);
  assert.equal(shouldSplit(segmentPages(pages)), true);
});

test('identity keys normalize IDs and fall back to name + DOB', () => {
  assert.equal(identityKey({ sourceIds: ['00123', 'abc-9'] }), 'id:123,ABC9');
  assert.equal(identityKey({ sourceIds: [], lastName: "O'Neil", firstName: 'Pat Q', dob: '1990-01-01' }), 'person:oneil|pat|1990-01-01');
  assert.equal(identityKey({ sourceIds: [] }), null);
  assert.equal(hasIdentifiers({ sourceIds: [] }), false);
});

test('per-page identifiers ignore the file name; continuation pages have none', () => {
  const header = extractPatientIdentifiers('Progress Note\nPatient: Sample Person\nDOB: 01/02/1990\nPatient ID: 99881', '');
  assert.equal(header.lastName, 'Person');
  assert.equal(header.dob, '1990-01-02');
  assert.deepEqual(header.sourceIds, ['99881']);
  const continuation = extractPatientIdentifiers('Plan: continue weekly therapy.\nSigned by clinician', '');
  assert.equal(hasIdentifiers(continuation), false);
});

test('page ranges are formatted compactly', () => {
  assert.equal(formatPages([3, 1, 2, 5, 7, 8]), '1–3, 5, 7–8');
  assert.equal(formatPages([4]), '4');
});

test('stored page texts are used; older rows fall back only when the page count matches', () => {
  assert.deepEqual(resolvePageTexts({ pageTexts: ['a', '', 'c'], extractedText: null, pageCount: 3 }), { pages: ['a', '', 'c'] });
  assert.deepEqual(resolvePageTexts({ pageTexts: null, extractedText: 'p1 l1\np1 l2\n\np2', pageCount: 2 }), { pages: ['p1 l1\np1 l2', 'p2'] });
  const mismatch = resolvePageTexts({ pageTexts: null, extractedText: 'p1\n\np2', pageCount: 3 });
  assert.ok('error' in mismatch && /Re-process/.test(mismatch.error));
  assert.ok('error' in resolvePageTexts({ pageTexts: null, extractedText: '', pageCount: 2 }));
});

test('extractPdfPages copies only the chosen pages, in order', async () => {
  const src = await PDFDocument.create();
  for (let i = 1; i <= 5; i++) src.addPage([100 + i, 200]);
  const bytes = await src.save();

  const out = await PDFDocument.load(await extractPdfPages(bytes, [2, 4], 5));
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual(out.getPages().map((p) => p.getWidth()), [102, 104]);

  await assert.rejects(extractPdfPages(bytes, [6], 5), PdfPagesError);
  await assert.rejects(extractPdfPages(bytes, [1], 7), PdfPagesError);
  await assert.rejects(extractPdfPages(bytes, [], 5), PdfPagesError);
  await assert.rejects(extractPdfPages(new Uint8Array([1, 2, 3]), [1]), PdfPagesError);
});
