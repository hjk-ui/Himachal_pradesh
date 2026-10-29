import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIcd10CodeSet } from '../src/lib/icd10/codeSet';
import { COMMON_CODES, buildIcd10Index, chapterOf, lookupIcd10, searchIcd10 } from '../src/lib/icd10/search';
import { checkIcd10Code, validateIcd10Codes } from '../src/lib/icd10/validate';
import {
  formatIcd10,
  highlightCode,
  highlightSegments,
  icd10Key,
  isCodeQuery,
  mergeIcd10Options,
  pickerKey,
  type Icd10Option,
} from '../src/lib/icd10/normalize';
import { parseIcd10List } from '../src/lib/billing/claimLines';

// Reference data only: the official CDC/NCHS FY2027 ICD-10-CM code set. No patient data.
const set = loadIcd10CodeSet();
const ix = set.index;
const codes = (q: string, opts: Parameters<typeof searchIcd10>[2] = {}) => searchIcd10(ix, q, opts).map((h) => h.code);

// ─── Artifact ─────────────────────────────────────────────────────────────────

test('artifact is the FY2027 CDC/NCHS order file (all codes, billable flag per leaf)', () => {
  assert.equal(set.meta.fiscalYear, 2027);
  assert.equal(set.meta.effective, '2026-10-01');
  assert.match(set.meta.source, /ftp\.cdc\.gov\/pub\/Health_Statistics\/NCHS\/Publications\/ICD10CM\/2027\//);
  assert.equal(ix.keys.length, set.meta.totalCodes);
  assert.ok(ix.keys.length > 95000, 'whole tabular list, headers included');
  const billable = ix.billable.reduce((n, b) => n + b, 0);
  assert.equal(billable, set.meta.billableCodes);
  assert.ok(billable > 74000);
});

test('billable flag: category headers are not billable, leaf codes are', () => {
  assert.equal(lookupIcd10(ix, 'F33')?.billable, false);
  assert.equal(lookupIcd10(ix, 'F33.1')?.billable, true);
  assert.equal(lookupIcd10(ix, 'F32A')?.billable, true); // "Depression, unspecified"
  assert.equal(lookupIcd10(ix, 'E11')?.billable, false);
  assert.equal(lookupIcd10(ix, 'E11.9')?.billable, true);
  assert.equal(lookupIcd10(ix, 'I10')?.billable, true); // 3-character billable code
  assert.equal(lookupIcd10(ix, 'F43.1')?.billable, false);
  assert.equal(lookupIcd10(ix, 'F43.10')?.billable, true);
});

test('parent category and chapter', () => {
  const hit = lookupIcd10(ix, 'f331')!;
  assert.equal(hit.code, 'F33.1');
  assert.equal(hit.category.code, 'F33');
  assert.equal(hit.category.description, 'Major depressive disorder, recurrent');
  assert.equal(hit.chapter?.number, 5);
  assert.equal(chapterOf('O9A.1')?.number, 15);
  assert.equal(chapterOf('D49.0')?.number, 2);
  assert.equal(chapterOf('D50.9')?.number, 3);
  assert.equal(chapterOf('U07.1')?.number, 22);
});

test('every boosted "common" code is a billable FY2027 code', () => {
  for (const k of COMMON_CODES) assert.equal(lookupIcd10(ix, k)?.billable, true, k);
});

// ─── Search ranking ───────────────────────────────────────────────────────────

test('exact code first, with or without the dot, any case', () => {
  for (const q of ['F33.1', 'f33.1', 'F331', 'f331', ' F33.1 ']) assert.equal(codes(q)[0], 'F33.1', q);
});

test('code prefix: the category itself, then its children (shorter codes first)', () => {
  const r = codes('f33', { limit: 20 });
  assert.equal(r[0], 'F33');
  assert.ok(r.slice(1, 8).every((c) => c.startsWith('F33.') && c.length === 5), r.join(','));
  assert.ok(r.every((c) => c.startsWith('F33')));
  const dotted = codes('F33.4');
  assert.deepEqual(dotted.slice(0, 4), ['F33.4', 'F33.40', 'F33.41', 'F33.42']);
});

test('words in any order match the same codes', () => {
  const a = codes('major depress recurrent', { limit: 10 });
  const b = codes('recurrent depress major', { limit: 10 });
  const c = codes('RECURRENT, major depressive', { limit: 10 });
  assert.ok(a.length >= 6);
  assert.ok(a.every((x) => x.startsWith('F33')), a.join(','));
  assert.deepEqual(new Set(a), new Set(b));
  assert.ok(c.every((x) => x.startsWith('F33')), c.join(','));
});

test('every word must match; word prefixes and a crude stem ("depression")', () => {
  assert.deepEqual(codes('generalized anxiety'), ['F41.1']);
  assert.ok(codes('depression', { context: 'bh' }).includes('F32.A'));
  assert.deepEqual(codes('zzqx nonsense'), []);
  assert.deepEqual(codes('a'), []); // too short
});

test('abbreviations (synonyms) and common codes', () => {
  assert.equal(codes('gad', { context: 'bh' })[0], 'F41.1');
  assert.ok(codes('ptsd', { context: 'bh' }).slice(0, 4).every((c) => c.startsWith('F43.1')));
  assert.ok(codes('mdd', { context: 'bh' }).slice(0, 6).every((c) => /^F3[23]/.test(c)));
  assert.equal(codes('hypertension', { context: 'primary' })[0], 'I10');
  assert.equal(codes('htn', { context: 'primary' })[0], 'I10');
});

test('context=bh boosts Chapter 5 (F codes) on word searches only', () => {
  const bh = searchIcd10(ix, 'insomnia', { context: 'bh', limit: 5 });
  assert.ok(bh[0].code.startsWith('F'), bh.map((h) => h.code).join(','));
  const any = searchIcd10(ix, 'insomnia', { context: 'any', limit: 5 });
  assert.ok(any.some((h) => h.code.startsWith('G47')), any.map((h) => h.code).join(','));
  // code searches are not reordered by context
  assert.equal(codes('g47.0', { context: 'bh' })[0], 'G47.0');
});

test('billableOnly drops header codes', () => {
  const r = searchIcd10(ix, 'f33', { billableOnly: true, limit: 50 });
  assert.ok(r.length > 5);
  assert.ok(r.every((h) => h.billable));
  assert.ok(!r.some((h) => h.code === 'F33'));
  assert.ok(searchIcd10(ix, 'f33').some((h) => h.code === 'F33' && !h.billable));
});

test('ranking on a synthetic index: exact > prefix > description words', () => {
  const mini = buildIcd10Index([
    { key: 'A01', billable: false, short: 'Typhoid', long: 'Typhoid and paratyphoid fevers' },
    { key: 'A010', billable: false, short: 'Typhoid fever', long: 'Typhoid fever' },
    { key: 'A0100', billable: true, short: 'Typhoid fever, unsp', long: 'Typhoid fever, unspecified' },
    { key: 'B99', billable: true, short: 'Other infect', long: 'Other infectious disease mentioning A01 typhoid' },
  ]);
  assert.deepEqual(searchIcd10(mini, 'A01').map((h) => h.code), ['A01', 'A01.0', 'A01.00', 'B99']);
  assert.deepEqual(searchIcd10(mini, 'fever typhoid').map((h) => h.code).sort(), ['A01', 'A01.0', 'A01.00']);
  assert.ok(searchIcd10(mini, 'A01')[0].score > searchIcd10(mini, 'A01')[1].score);
});

test('search is fast enough for keystroke autocomplete', () => {
  const t0 = process.hrtime.bigint();
  for (const q of ['major depress recurrent', 'f3', 'diabetes', 'anx', 'fracture femur', 'z79', 'pain']) searchIcd10(ix, q, { limit: 20 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `7 searches took ${ms}ms`);
});

// ─── Validation ───────────────────────────────────────────────────────────────

test('validation helper: ok / not_billable / deleted / unknown / malformed', () => {
  assert.equal(checkIcd10Code('F33.1').status, 'ok');
  assert.equal(checkIcd10Code('f331').code, 'F33.1');
  assert.equal(checkIcd10Code('F33').status, 'ok'); // header allowed where billing is not required
  const header = checkIcd10Code('F33', { requireBillable: true });
  assert.equal(header.status, 'not_billable');
  assert.match(header.message!, /pick a more specific code/);
  const unknown = checkIcd10Code('F99.99');
  assert.equal(unknown.status, 'unknown');
  assert.match(unknown.message!, /not in FY2027 code set/);
  const deleted = set.meta.deletedCodes[0];
  assert.ok(deleted, 'addenda lists deleted codes');
  const del = checkIcd10Code(deleted.code);
  assert.equal(del.status, 'deleted');
  assert.match(del.message!, /not in FY2027 code set/);
  assert.equal(checkIcd10Code('hello').status, 'malformed');
});

test('validateIcd10Codes: de-duplicates, formats, skips codes already stored', () => {
  const r = validateIcd10Codes(['f331', 'F33.1', 'E119']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.codes, ['F33.1', 'E11.9']);
  const bad = validateIcd10Codes(['F33.1', 'Z99.999', 'F33'], { requireBillable: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
  // an imported code already on the record is not re-judged on update
  const kept = validateIcd10Codes(['F99.99', 'F41.1'], { skip: ['F99.99'] });
  assert.equal(kept.ok, true);
});

test('claims: parseIcd10List requires billable FY2027 codes', () => {
  assert.deepEqual(parseIcd10List('F33.1, F41.1').codes, ['F33.1', 'F41.1']);
  const header = parseIcd10List('F33.1, F33');
  assert.equal(header.ok, false);
  assert.match(header.error!, /F33/);
  assert.equal(parseIcd10List('Z99.999').ok, false);
  assert.equal(parseIcd10List('NOTACODE').ok, false);
});

// ─── Picker logic ─────────────────────────────────────────────────────────────

test('code formatting helpers', () => {
  assert.equal(icd10Key(' f33.1 '), 'F331');
  assert.equal(formatIcd10('s72001a'), 'S72.001A');
  assert.equal(formatIcd10('I10'), 'I10');
  assert.equal(isCodeQuery('f33'), true);
  assert.equal(isCodeQuery('F33.1'), true);
  assert.equal(isCodeQuery('major'), false);
});

test('picker keyboard: arrows wrap, Home/End, Enter selects, header blocked when billable required, Escape closes', () => {
  const opts = [
    { code: 'F33', billable: false },
    { code: 'F33.1', billable: true },
    { code: 'F33.2', billable: true },
  ];
  assert.deepEqual(pickerKey('ArrowDown', -1, opts), { type: 'move', index: 0 });
  assert.deepEqual(pickerKey('ArrowDown', 2, opts), { type: 'move', index: 0 });
  assert.deepEqual(pickerKey('ArrowUp', 0, opts), { type: 'move', index: 2 });
  assert.deepEqual(pickerKey('End', 0, opts), { type: 'move', index: 2 });
  assert.deepEqual(pickerKey('Home', 2, opts), { type: 'move', index: 0 });
  assert.deepEqual(pickerKey('Enter', 1, opts), { type: 'select', index: 1 });
  assert.deepEqual(pickerKey('Enter', 0, opts), { type: 'select', index: 0 }); // allowed on notes / plans
  const blocked = pickerKey('Enter', 0, opts, { requireBillable: true });
  assert.equal(blocked.type, 'blocked');
  assert.match((blocked as { reason: string }).reason, /Non-billable/);
  assert.deepEqual(pickerKey('Enter', -1, opts), { type: 'none' });
  assert.deepEqual(pickerKey('Escape', 1, opts), { type: 'close' });
  assert.deepEqual(pickerKey('ArrowDown', -1, []), { type: 'none' });
  assert.deepEqual(pickerKey('x', 0, opts), { type: 'none' });
});

test("picker options: the client's matching active diagnoses first, then search results, no duplicates", () => {
  const client: Icd10Option[] = [
    { code: 'F41.1', description: 'Generalized anxiety disorder', billable: true, source: 'client', sourceLabel: 'Chart diagnosis' },
    { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', billable: true, source: 'client' },
  ];
  const hits: Icd10Option[] = [
    { code: 'F41.9', description: 'Anxiety disorder, unspecified', billable: true, source: 'search' },
    { code: 'F41.1', description: 'Generalized anxiety disorder', billable: true, source: 'search' },
  ];
  assert.deepEqual(mergeIcd10Options(client, hits, 'anxiety').map((o) => `${o.source}:${o.code}`), ['client:F41.1', 'search:F41.9']);
  assert.deepEqual(mergeIcd10Options(client, [], '').map((o) => o.code), ['F41.1', 'E11.9']); // empty query: all suggestions
  assert.deepEqual(mergeIcd10Options(client, [], 'e11').map((o) => o.code), ['E11.9']);
});

test('highlighting marks word prefixes and the matched code prefix', () => {
  const segs = highlightSegments('Major depressive disorder, recurrent', 'recur depress');
  assert.deepEqual(segs.filter((s) => s.match).map((s) => s.text), ['depress', 'recur']);
  assert.equal(segs.map((s) => s.text).join(''), 'Major depressive disorder, recurrent');
  assert.deepEqual(highlightCode('F33.1', 'f331'), [{ text: 'F33.1', match: true }]);
  assert.deepEqual(highlightCode('F33.12', 'F33'), [{ text: 'F33', match: true }, { text: '.12', match: false }]);
  assert.deepEqual(highlightCode('F33.1', 'anxiety'), [{ text: 'F33.1', match: false }]);
});
