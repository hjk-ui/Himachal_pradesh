import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  canOpenChartDocuments,
  canViewChartDocument,
  canVoidImportedDocument,
  classifyReadError,
  classifyValantDocument,
  DEFAULT_TYPE_RULES,
  detectWrapperDepth,
  fileCodeConflict,
  indexRoster,
  isDiskFullError,
  isDuplicate,
  isJunkEntry,
  normalizeClientCode,
  parseValantFileName,
  planRematchFiling,
  planRematch,
  resolveDocumentTarget,
  parseBillingPayer,
  fileNameClientCode,
  isBillingArchivePath,
  canViewBillingArchive,
  BILLING_ARCHIVE_STATUS,
  PRACTICE_BILLING_MATCH,
  VALANT_FILE_CODE_MATCH,
  recordUnreadable,
  type RematchRow,
  maskFileName,
  maskPath,
  maskSubfolder,
  maskText,
  matchClientFolder,
  parseClientFolder,
  parseDocumentDate,
  rememberDocument,
  sniffFileKind,
  splitArchivePath,
  toFolderRoster,
  type RosterInput,
} from '../src/lib/migration/valantDocuments';
import { FILING_PATH } from '../src/lib/docIntake/classify';
import { multipartPartSize } from '../src/lib/migration/valantDocumentsUpload';

// Synthetic people and ids only; no real patient data

// ─── Folder name parsing ──────────────────────────────────────────────────────

test('folder names: "Last, First" with (id), "- id", underscores, DOB formats, labels', () => {
  const a = parseClientFolder('Doe, Jane (12345)');
  assert.deepEqual([a.firstName, a.lastName, a.nameOrderKnown, a.sourceIds, a.dob], ['jane', 'doe', true, ['12345'], null]);
  assert.deepEqual(a.nameKeys, ['jane|doe']);

  const b = parseClientFolder('Jane Doe - 12345');
  assert.equal(b.nameOrderKnown, false);
  assert.deepEqual(b.sourceIds, ['12345']);
  assert.ok(b.nameKeys.includes('jane|doe') && b.nameKeys.includes('doe|jane'), 'order unknown: both orders');

  const c = parseClientFolder('Doe_Jane_12345');
  assert.deepEqual(c.sourceIds, ['12345']);
  assert.ok(c.nameKeys.includes('jane|doe'));

  assert.equal(parseClientFolder('Doe, Jane 1980-01-31').dob, '1980-01-31');
  assert.equal(parseClientFolder('Doe, Jane 01-31-1980').dob, '1980-01-31');
  assert.equal(parseClientFolder('Doe, Jane DOB 19800131').dob, '1980-01-31');
  assert.equal(parseClientFolder('Doe, Jane_1980-01-31_12345').dob, '1980-01-31');
  assert.deepEqual(parseClientFolder('Doe, Jane_1980-01-31_12345').sourceIds, ['12345'], 'date digits are not an id');
  assert.deepEqual(parseClientFolder('Doe, Jane MRN 000123').sourceIds, ['000123']);
  assert.deepEqual(parseClientFolder('DOE, JANE [SEMALE93]').sourceIds, ['SEMALE93'], 'Valant letter ids');
  assert.deepEqual(parseClientFolder('Jane Doe (WALYAS)').sourceIds, ['WALYAS']);
  assert.deepEqual(parseClientFolder('Jane Doe - DOEJAN').sourceIds, ['DOEJAN']);
});

test('folder names: nicknames, middle initials, suffixes and invalid dates are not part of the match', () => {
  const n = parseClientFolder('Doe, Jane (Janie)');
  assert.deepEqual(n.sourceIds, []);
  assert.deepEqual(n.nameKeys, ['jane|doe']);
  assert.deepEqual(parseClientFolder('Doe Jr, Jane A.').nameKeys, ['jane|doe']);
  assert.deepEqual(parseClientFolder('Doe, Mary Ann').nameKeys, ['mary ann|doe', 'mary|doe']);
  assert.equal(parseClientFolder('Doe, Jane 02-30-1980').dob, null, 'Feb 30 is not a date');
  assert.equal(parseClientFolder('Doe, Jane').dob, null);
  assert.deepEqual(parseClientFolder('12345').nameKeys, [], 'id only: no name');
});

// ─── Matching ─────────────────────────────────────────────────────────────────

const row = (id: string, first: string, last: string, dob: string | null, extra: Partial<RosterInput> = {}): RosterInput => ({
  id, name: `${first} ${last}`, legalFirstName: first, legalLastName: last,
  dateOfBirth: dob ? new Date(`${dob}T00:00:00.000Z`) : null, mrn: null, sourceId: null, ...extra,
});

const roster = indexRoster(
  toFolderRoster([
    row('c1', 'Jane', 'Doe', '1980-01-31', { sourceId: '12345' }),
    row('c2', 'John', 'Roe', '1975-05-05', { mrn: 'ALT-000777' }),
    row('c3', 'Sam', 'Twin', '1990-02-02'),
    row('c4', 'Sam', 'Twin', '1990-03-03'),
    row('c5', 'Ann', 'Solo', null),
    row('c6', 'Kim', 'Lee', '2000-01-01', { sourceId: '99999' }),
    { id: 'c7', name: 'Pat Quinn', legalFirstName: null, legalLastName: null, dateOfBirth: null, mrn: null, sourceId: null },
  ])
);

test('matching priority: Valant ID / MRN first', () => {
  const m = matchClientFolder(parseClientFolder('Doe, Jane (12345)'), roster);
  assert.equal(m.status, 'matched');
  assert.equal(m.clientId, 'c1');
  assert.equal(m.basis, 'id');
  assert.equal(matchClientFolder(parseClientFolder('Roe, John MRN ALT-000777'), roster).clientId, 'c2');
  // An id alone (no name) still matches exactly
  assert.equal(matchClientFolder(parseClientFolder('(12345)'), roster).clientId, 'c1');
});

test('matching: ID that disagrees with the name or DOB goes to review, never a guess', () => {
  const wrongName = matchClientFolder(parseClientFolder('Smith, Bob (12345)'), roster);
  assert.equal(wrongName.status, 'needs_review');
  assert.equal(wrongName.clientId, null);
  assert.equal(wrongName.candidates[0].clientId, 'c1');
  assert.equal(matchClientFolder(parseClientFolder('Doe, Jane 1999-09-09 (12345)'), roster).status, 'needs_review');
});

test('matching: full name + DOB, then a unique full name', () => {
  const nd = matchClientFolder(parseClientFolder('Twin, Sam 1990-03-03'), roster);
  assert.deepEqual([nd.status, nd.clientId, nd.basis], ['matched', 'c4', 'name_dob']);
  const unique = matchClientFolder(parseClientFolder('Roe, John'), roster);
  assert.deepEqual([unique.status, unique.clientId, unique.basis], ['matched', 'c2', 'name']);
  // Name only from Client.name when the legal fields are empty
  assert.equal(matchClientFolder(parseClientFolder('Quinn, Pat'), roster).clientId, 'c7');
  // A chart without a DOB still matches a folder with a DOB by unique name
  assert.equal(matchClientFolder(parseClientFolder('Solo, Ann 1970-01-01'), roster).clientId, 'c5');
});

test('matching: ambiguity and conflicts → needs_review; nothing found → unmatched', () => {
  const twins = matchClientFolder(parseClientFolder('Twin, Sam'), roster);
  assert.equal(twins.status, 'needs_review');
  assert.equal(twins.candidates.length, 2);
  assert.equal(matchClientFolder(parseClientFolder('Twin, Sam 1990-04-04'), roster).status, 'needs_review', 'DOB differs');
  assert.equal(matchClientFolder(parseClientFolder('Doe, Jane 1980-02-01'), roster).status, 'needs_review', 'name matches, DOB differs');
  // Name matches but the chart carries a different Valant ID
  assert.equal(matchClientFolder(parseClientFolder('Lee, Kim (55555)'), roster).status, 'needs_review');
  assert.equal(matchClientFolder(parseClientFolder('Nobody, Known'), roster).status, 'unmatched');
  assert.equal(matchClientFolder(parseClientFolder('scans'), roster).status, 'unmatched');
  // Name-only matching can be switched off
  assert.equal(matchClientFolder(parseClientFolder('Roe, John'), roster, { allowNameOnly: false }).status, 'needs_review');
});

test('matching: unknown name order ("First Last" or "Last First")', () => {
  assert.equal(matchClientFolder(parseClientFolder('John Roe'), roster).clientId, 'c2');
  assert.equal(matchClientFolder(parseClientFolder('Roe John'), roster).clientId, 'c2');
});

// ─── Document types ───────────────────────────────────────────────────────────

test('type keywords: all 12 Valant document types', () => {
  const cases: Array<[string[], string, string]> = [
    [['Progress Notes'], '2024-01-05.pdf', 'Progress Note'],
    [[], 'Intake Note 2023-02-01.pdf', 'Intake Note'],
    [['Progress Notes'], '2024-01-05 Addendum.pdf', 'Addendum'],
    [['Discharge Summary'], 'scan.pdf', 'Discharge Summary'],
    [['Measures'], 'PHQ-9.pdf', 'Measures'],
    [['Lab Report'], 'result.pdf', 'Lab Report'],
    [['Intake Consents'], 'form.pdf', 'Consent / ROI'],
    [['Intake Forms'], 'packet.pdf', 'Intake Form'],
    [['Patient ID'], 'front.jpg', 'Patient ID'],
    [['Demographic'], 'sheet.pdf', 'Demographics'],
    [['Payment Receipts'], '2024-03-01.pdf', 'Payment Receipt'],
    [['Other'], 'misc.pdf', 'Other'],
  ];
  for (const [subs, file, want] of cases) assert.equal(classifyValantDocument(subs, file).type, want, `${subs.join('/')}/${file}`);
  assert.equal(new Set(cases.map((c) => c[2])).size, 12);
});

test('type keywords: file name wins over folder, separators and camelCase, no false hits', () => {
  assert.deepEqual(classifyValantDocument(['Misc'], 'IntakeNote_20240105.pdf'), { type: 'Intake Note', matchedOn: 'file' });
  assert.equal(classifyValantDocument(['Intake Forms'], 'Consent_to_treat.pdf').type, 'Consent / ROI');
  assert.equal(classifyValantDocument(['progress-notes'], 'x.pdf').type, 'Progress Note');
  assert.equal(classifyValantDocument([], 'Payment receipt 2024.pdf').type, 'Payment Receipt');
  assert.equal(classifyValantDocument([], 'Drivers License.jpg').type, 'Patient ID');
  assert.equal(classifyValantDocument([], 'Face Sheet.pdf').type, 'Demographics');
  assert.equal(classifyValantDocument([], 'Labrador.pdf').type, 'Other', '"lab" needs a word boundary');
  assert.equal(classifyValantDocument(['Nested', 'Discharge'], 'a.pdf').type, 'Discharge Summary', 'deepest folder');
});

test('every import type has a filing path', () => {
  for (const r of DEFAULT_TYPE_RULES) assert.ok(FILING_PATH[r.type], r.type);
  assert.equal(FILING_PATH.Other, 'Chart › Documents › Other (Valant)');
  assert.equal(FILING_PATH['Intake Note'], 'Chart › Documents › Prior Records › Intake');
  assert.equal(FILING_PATH.Addendum, 'Chart › Documents › Prior Records › Addenda');
  assert.equal(FILING_PATH['Discharge Summary'], 'Chart › Documents › Prior Records › Discharge');
  assert.equal(FILING_PATH['Payment Receipt'], 'Chart › Documents › Billing documents');
});

// ─── Dates ────────────────────────────────────────────────────────────────────

test('document date only from the file name; none → null', () => {
  const now = new Date('2026-10-21T00:00:00Z');
  assert.equal(parseDocumentDate('2024-01-05 Progress Note.pdf', now), '2024-01-05');
  assert.equal(parseDocumentDate('Note_2024_01_05.pdf', now), '2024-01-05');
  assert.equal(parseDocumentDate('Note 01-05-2024.pdf', now), '2024-01-05');
  assert.equal(parseDocumentDate('Note 1-5-2024.pdf', now), '2024-01-05');
  assert.equal(parseDocumentDate('note20240105.pdf', now), '2024-01-05');
  assert.equal(parseDocumentDate('Progress Note.pdf', now), null);
  assert.equal(parseDocumentDate('note 12345678.pdf', now), null, 'not a valid date');
  assert.equal(parseDocumentDate('note 2024-02-30.pdf', now), null);
  assert.equal(parseDocumentDate('note 2031-01-01.pdf', now), null, 'far future is not a service date');
  assert.equal(parseDocumentDate('scan 1985-03-03.pdf', now), null, 'before 1990: not a service date');
});

// ─── Duplicates ───────────────────────────────────────────────────────────────

test('duplicate hash: same content for the same client is skipped; another client is not', () => {
  const seen = new Set<string>();
  rememberDocument(seen, { clientId: 'c1', sha256: 'abc', sourcePath: 'Doe, Jane/a.pdf' });
  assert.equal(isDuplicate(seen, { clientId: 'c1', sha256: 'abc', sourcePath: 'Doe, Jane/copy.pdf' }), true);
  assert.equal(isDuplicate(seen, { clientId: 'c2', sha256: 'abc', sourcePath: 'Roe, John/a.pdf' }), false);
  // An unmatched folder re-imported (even after staff filed the document) is found by path + hash
  rememberDocument(seen, { clientId: 'c9', sha256: 'def', sourcePath: 'Unknown, X/b.pdf' });
  assert.equal(isDuplicate(seen, { clientId: null, sha256: 'def', sourcePath: 'Unknown, X/b.pdf' }), true);
  assert.equal(isDuplicate(seen, { clientId: null, sha256: 'def', sourcePath: 'Other, Y/b.pdf' }), false);
});

// ─── Access by document type ──────────────────────────────────────────────────

test('access: payment receipts for billing, front desk and leadership only, never clinicians', () => {
  const see = (role: string, ehrAccess = false, onCareTeam = false) =>
    canViewChartDocument({ role, documentType: 'Payment Receipt', ehrAccess, onCareTeam });
  for (const r of ['BILLING', 'OFFICE_MANAGER', 'FRONT_DESK', 'PRACTICE_DIRECTOR', 'ADMIN']) assert.equal(see(r), true, r);
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'CASE_MANAGER', 'PHYSICIAN']) assert.equal(see(r, true, true), false, r);
});

test('access: patient ID and demographics for front office, billing, leadership and the care team', () => {
  for (const t of ['Patient ID', 'Demographics']) {
    for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'PRACTICE_DIRECTOR', 'ADMIN']) {
      assert.equal(canViewChartDocument({ role: r, documentType: t, ehrAccess: false, onCareTeam: false }), true, `${r} ${t}`);
    }
    assert.equal(canViewChartDocument({ role: 'THERAPIST', documentType: t, ehrAccess: true, onCareTeam: true }), true);
    assert.equal(canViewChartDocument({ role: 'THERAPIST', documentType: t, ehrAccess: true, onCareTeam: false }), false);
    assert.equal(canViewChartDocument({ role: 'HR', documentType: t, ehrAccess: false, onCareTeam: false }), false);
  }
});

test('access: clinical types follow chart access; front office does not see them', () => {
  for (const t of ['Progress Note', 'Intake Note', 'Addendum', 'Discharge Summary', 'Measures', 'Lab Report', 'Consent / ROI', 'Intake Form', 'Other']) {
    assert.equal(canViewChartDocument({ role: 'THERAPIST', documentType: t, ehrAccess: true, onCareTeam: false }), true, t);
    assert.equal(canViewChartDocument({ role: 'FRONT_DESK', documentType: t, ehrAccess: false, onCareTeam: false }), false, t);
    assert.equal(canViewChartDocument({ role: 'BILLING', documentType: t, ehrAccess: false, onCareTeam: false }), false, t);
  }
  assert.equal(canOpenChartDocuments('FRONT_DESK', false), true);
  assert.equal(canOpenChartDocuments('HR', false), false);
  assert.equal(canOpenChartDocuments('THERAPIST', true), true);
  assert.equal(canVoidImportedDocument('PRACTICE_DIRECTOR'), true);
  assert.equal(canVoidImportedDocument('THERAPIST'), false);
  assert.equal(canVoidImportedDocument('OFFICE_MANAGER'), false);
});

test('routes: chart documents and file download apply the type rules and the Part 2 lock; imports are read-only', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const docs = read('src/app/api/clients/[id]/documents/route.ts');
  assert.match(docs, /assertClientPhiAccess/);
  assert.match(docs, /chartDocumentFilter/);
  const files = read('src/app/api/files/[kind]/[name]/route.ts');
  assert.match(files, /assertClientPhiAccess/);
  assert.match(files, /filter\.canView\(doc\.documentType\)/);
  const intake = read('src/app/api/ehr/doc-intake/route.ts');
  assert.match(intake, /Imported records are read-only/);
  assert.match(intake, /canVoidImportedDocument/);
  const api = read('src/app/api/migration/valant-documents/route.ts');
  assert.match(api, /requireImportGate\('Valant documents'\)/);
  assert.match(api, /ServerSideEncryption: 'AES256'/);
});

// ─── Masking ──────────────────────────────────────────────────────────────────

test('masking: letters → X/x, digits → #, punctuation kept', () => {
  assert.equal(maskText('Doe, Jane (12345)'), 'Xxx, Xxxx (#####)');
  assert.equal(maskPath('Doe, Jane (12345)/Progress Notes/2024-01-05 Note.pdf'), 'Xxx, Xxxx (#####)/Xxxxxxxx Xxxxx/####-##-## Xxxx.pdf');
  assert.equal(maskText('Zoë'), 'Xxx');
  assert.equal(maskFileName('Doe.Jane'), 'Xxx.Xxxx', 'not a known extension: masked');
  assert.equal(maskFileName('Note.PDF'), 'Xxxx.pdf');
  assert.equal(maskSubfolder('Progress Notes'), 'Progress Notes', 'known type keyword, no digits');
  assert.equal(maskSubfolder('Progress Notes 2024'), 'Xxxxxxxx Xxxxx ####', 'digits: masked');
  assert.equal(maskSubfolder('Jane stuff'), 'Xxxx xxxxx', 'unknown: masked');
});

// ─── Archive layout / sniffing ────────────────────────────────────────────────

test('archive layout: wrapper folder detection, client folder split, junk entries', () => {
  assert.equal(detectWrapperDepth(['Export/A, B/x.pdf', 'Export/C, D/y.pdf']), 1);
  assert.equal(detectWrapperDepth(['A, B/x.pdf', 'C, D/y.pdf']), 0);
  assert.equal(detectWrapperDepth(['A, B/Notes/x.pdf']), 0, 'one client folder is not a wrapper');
  assert.deepEqual(splitArchivePath('Export/Doe, Jane/Notes/a.pdf', 1), { clientFolder: 'Doe, Jane', subfolders: ['Notes'], fileName: 'a.pdf' });
  assert.deepEqual(splitArchivePath('loose.pdf', 0), { clientFolder: null, subfolders: [], fileName: 'loose.pdf' });
  assert.equal(isJunkEntry('__MACOSX/Doe, Jane/._a.pdf'), true);
  assert.equal(isJunkEntry('Doe, Jane/Thumbs.db'), true);
  assert.equal(isJunkEntry('Doe, Jane/.DS_Store'), true);
  assert.equal(isJunkEntry('Doe, Jane/a.pdf'), false);
});

test('file type from bytes, not the extension', () => {
  assert.equal(sniffFileKind(new TextEncoder().encode('%PDF-1.7\n'))?.ext, 'pdf');
  assert.equal(sniffFileKind(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('%PDF-1.4')]))?.ext, 'pdf', 'short preamble');
  assert.equal(sniffFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext, 'jpg');
  assert.equal(sniffFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))?.ext, 'png');
  assert.equal(sniffFileKind(new TextEncoder().encode('<html>')), null);
  assert.equal(multipartPartSize(1024), 16 * 1024 * 1024);
  assert.ok(Math.ceil(50 * 1024 ** 3 / multipartPartSize(50 * 1024 ** 3)) <= 9000, '50 GB within the part limit');
});

/** Minimal ZIP writer (stored entries) for the streaming reader test */
function makeZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = zlib.crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, e.data);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('streaming reader: scans the central directory of a local ZIP without loading it', async () => {
  const { openZip, scanEntries } = await import('../src/lib/migration/valantDocumentsJob');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'valant-zip-'));
  const file = path.join(dir, 'export.zip');
  fs.writeFileSync(
    file,
    makeZip([
      { name: 'Export/Doe, Jane (12345)/Progress Notes/2024-01-05.pdf', data: Buffer.from('%PDF-1.4 a') },
      { name: 'Export/Roe, John/Payment Receipts/r.pdf', data: Buffer.from('%PDF-1.4 b') },
      { name: 'Export/Roe, John/.DS_Store', data: Buffer.from('x') },
    ])
  );
  try {
    const { zip } = await openZip({ kind: 'local', path: file });
    const entries = await scanEntries(zip);
    zip.close();
    assert.equal(entries.length, 3);
    assert.equal(entries.filter((e) => e.junk).length, 1);
    const files = entries.filter((e) => !e.junk).map((e) => e.path);
    assert.equal(detectWrapperDepth(files), 1);
    assert.equal(splitArchivePath(files[0], 1).clientFolder, 'Doe, Jane (12345)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S3 ranged reader (fake S3): entries read through the block cache hash to the original bytes', async () => {
  const { S3RangeReader, readEntry } = await import('../src/lib/migration/valantDocumentsJob');
  const yauzl = await import('yauzl');
  const { Readable } = await import('node:stream');
  const crypto = await import('node:crypto');
  const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(900 * 1024)]); // > the small-read limit
  const small = Buffer.from('%PDF-1.4 small');
  const zipBuf = makeZip([
    { name: 'Doe, Jane/a.pdf', data: small },
    { name: 'Doe, Jane/big.pdf', data: big },
  ]);
  let gets = 0;
  const fakeS3 = {
    send: async (cmd: { input: { Range: string } }) => {
      gets++;
      const [, s, e] = cmd.input.Range.match(/bytes=(\d+)-(\d+)/)!;
      return { Body: Readable.from([zipBuf.subarray(Number(s), Number(e) + 1)]) };
    },
  };
  const reader = new S3RangeReader(fakeS3 as never, 'bucket', 'key', zipBuf.length);
  const zip = await yauzl.fromRandomAccessReaderPromise(reader, zipBuf.length, { autoClose: false });
  const entries: import('yauzl').Entry[] = [];
  for await (const e of zip.eachEntry()) entries.push(e);
  const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  const a = await readEntry(zip, entries[0], null);
  const b = await readEntry(zip, entries[1], null);
  zip.close();
  assert.equal(a.sha256, sha(small));
  assert.equal(b.sha256, sha(big));
  assert.equal(b.bytes, big.length);
  assert.equal(sniffFileKind(b.head)?.ext, 'pdf');
  assert.ok(gets <= 4, `few ranged GETs (${gets})`);
});

// ─── Valant client code folders (the real export layout) ─────────────────────

const valantRoster = indexRoster(
  toFolderRoster([
    row('v1', 'Ann', 'Alpha', '1981-01-01', { sourceId: 'ALPANN', sourcePlatform: 'valant' }),
    row('v2', 'Bob', 'Beta', '1982-02-02', { sourceId: 'BETBOB93', sourcePlatform: 'VALANT_EXPORT' }),
    row('v3', 'Cy', 'Gamma', '1983-03-03', { sourceId: 'GAMCY7', sourcePlatform: 'Valant' }),
    row('v4', 'Di', 'Delta', null, { sourceId: 'AB CDE', sourcePlatform: 'valant' }),
    // Same code twice (a data problem): never guessed
    row('v5', 'Ed', 'Eps', null, { sourceId: 'DUPCOD', sourcePlatform: 'valant' }),
    row('v6', 'Eve', 'Eps', null, { sourceId: 'dupcod', sourcePlatform: 'valant' }),
    // Another platform's id does not take part in code matching
    row('v7', 'Fay', 'Phi', null, { sourceId: 'PHIFAY', sourcePlatform: 'simplepractice' }),
  ])
);

test('client code folders: exact, case-insensitive, trimmed; digit suffixes; inner space', () => {
  const m = matchClientFolder(parseClientFolder('ALPANN'), valantRoster);
  assert.deepEqual([m.status, m.clientId, m.basis, m.clientCode], ['matched', 'v1', 'code', 'ALPANN']);
  assert.equal(matchClientFolder(parseClientFolder('alpann'), valantRoster).clientId, 'v1', 'case');
  assert.equal(matchClientFolder(parseClientFolder('  ALPANN '), valantRoster).clientId, 'v1', 'whitespace');
  assert.equal(matchClientFolder(parseClientFolder('BETBOB93'), valantRoster).clientId, 'v2', 'two-digit suffix');
  assert.equal(matchClientFolder(parseClientFolder('GAMCY7'), valantRoster).clientId, 'v3', 'one-digit suffix');
  assert.equal(matchClientFolder(parseClientFolder('AB CDE'), valantRoster).clientId, 'v4', 'inner space');
  assert.equal(matchClientFolder(parseClientFolder('AB  CDE'), valantRoster).clientId, 'v4', 'inner spaces collapsed');
  // A near miss is not a match (no fuzzy matching)
  assert.notEqual(matchClientFolder(parseClientFolder('ALPAN'), valantRoster).status, 'matched');
  assert.notEqual(matchClientFolder(parseClientFolder('BETBOB9'), valantRoster).status, 'matched');
  assert.notEqual(matchClientFolder(parseClientFolder('BETBOB'), valantRoster).status, 'matched');
});

test('client code folders: a code shared by two clients goes to review; other platforms do not match by code', () => {
  const amb = matchClientFolder(parseClientFolder('DUPCOD'), valantRoster);
  assert.equal(amb.status, 'needs_review');
  assert.equal(amb.clientId, null);
  assert.equal(amb.candidates.length, 2);
  assert.notEqual(matchClientFolder(parseClientFolder('PHIFAY'), valantRoster).basis, 'code');
  assert.equal(normalizeClientCode(' ab  cde '), 'AB CDE');
  assert.equal(normalizeClientCode('Doe, Jane'), '', 'punctuation: not a code');
  assert.equal(normalizeClientCode('AB'), '', 'too short');
});

test('Valant file names: code, YYYYMMDD date, title, document id', () => {
  const now = new Date('2026-10-21T00:00:00Z');
  assert.deepEqual(parseValantFileName('ALPANN_20240105_Progress Note(123456789).pdf', now), {
    code: 'ALPANN', date: '2024-01-05', title: 'Progress Note', valantDocumentId: '123456789',
  });
  const b = parseValantFileName('BETBOB93_20230230_Intake Consent Form(000004567).pdf', now)!;
  assert.equal(b.date, null, 'Feb 30 is not a date');
  assert.equal(b.valantDocumentId, '4567', 'leading zeros dropped');
  assert.equal(b.code, 'BETBOB93');
  assert.equal(parseValantFileName('AB CDE_20220101_Payment Receipt (42).PDF', now)?.code, 'AB CDE');
  assert.equal(parseValantFileName('AB CDE_20220101_Payment Receipt (42).PDF', now)?.title, 'Payment Receipt');
  assert.equal(parseValantFileName('2024-01-05 Progress Note.pdf', now), null);
  assert.equal(parseValantFileName('ALPANN_2024015_Note(1).pdf', now), null, '7 digits');
  assert.equal(parseValantFileName('ALPANN_20240105_Note.pdf', now), null, 'no document id');
  // The title drives the type rules
  const p = parseValantFileName('ALPANN_20240105_Discharge Summary(9).pdf', now)!;
  assert.equal(classifyValantDocument(['Clinical Notes'], `${p.title}.pdf`).type, 'Discharge Summary');
});

test('file-name code must agree with the folder match, else that file goes to review', () => {
  const byCode = matchClientFolder(parseClientFolder('ALPANN'), valantRoster);
  assert.equal(fileCodeConflict(byCode, 'ALPANN', 'ALPANN'), null);
  assert.equal(fileCodeConflict(byCode, 'ALPANN', 'alpann'), null, 'case-insensitive');
  assert.equal(fileCodeConflict(byCode, 'ALPANN', null), null, 'no Valant pattern: folder match stands');
  assert.match(fileCodeConflict(byCode, 'ALPANN', 'BETBOB93')!, /differs from the folder code/);
  // Matched another way (name + DOB): the chart's Valant code must agree
  const byName = matchClientFolder(parseClientFolder('Alpha, Ann 1981-01-01'), valantRoster);
  assert.equal(byName.basis, 'name_dob');
  assert.equal(fileCodeConflict(byName, 'Alpha, Ann 1981-01-01', 'ALPANN'), null);
  assert.match(fileCodeConflict(byName, 'Alpha, Ann 1981-01-01', 'GAMCY7')!, /Valant code/);
  // Not matched: nothing to confirm (stays in review anyway)
  assert.equal(fileCodeConflict(matchClientFolder(parseClientFolder('ZZZZZZ'), valantRoster), 'ZZZZZZ', 'ZZZZZZ'), null);
});

test('duplicates: the same Valant document id for the same client is skipped', () => {
  const seen = new Set<string>();
  rememberDocument(seen, { clientId: 'v1', sha256: 'aaa', sourcePath: 'ALPANN/x/a.pdf', valantDocumentId: '77' });
  assert.equal(isDuplicate(seen, { clientId: 'v1', sha256: 'bbb', sourcePath: 'ALPANN/y/b.pdf', valantDocumentId: '77' }), true);
  assert.equal(isDuplicate(seen, { clientId: 'v2', sha256: 'bbb', sourcePath: 'BETBOB93/b.pdf', valantDocumentId: '77' }), false);
  assert.equal(isDuplicate(seen, { clientId: 'v1', sha256: 'ccc', sourcePath: 'ALPANN/c.pdf', valantDocumentId: '78' }), false);
});

// ─── Unreadable reasons ───────────────────────────────────────────────────────

test('unreadable reason classes', () => {
  const withCode = (code: string, message = 'x') => Object.assign(new Error(message), { code });
  assert.equal(classifyReadError(new Error('unsupported compression method: 9')), 'unsupported_compression:9');
  assert.equal(classifyReadError(new Error('unsupported compression method: 14')), 'unsupported_compression:14');
  assert.equal(classifyReadError(new Error('invalid local file header signature: 0x0')), 'invalid_signature');
  assert.equal(classifyReadError(new Error('entry is encrypted, and options.decodeFileData !== false')), 'encrypted');
  assert.equal(classifyReadError(new Error('not enough bytes in the stream. expected 10. got only 5')), 'size_mismatch');
  assert.equal(classifyReadError(new Error('file data overflows file bounds: 1 + 2 > 2')), 'truncated');
  assert.equal(classifyReadError(withCode('ENOSPC', 'no space left on device, write')), 'read_error:ENOSPC');
  assert.equal(classifyReadError(withCode('Z_DATA_ERROR', 'invalid distance too far back')), 'read_error:Z_DATA_ERROR');
  assert.equal(classifyReadError(new Error('7z exited with code 2')), 'extract_7z_failed:2');
  assert.equal(classifyReadError(Object.assign(new Error('boom'), { name: 'TimeoutError' })), 'read_error:TimeoutError');
  assert.equal(classifyReadError(new Error('boom')), 'read_error:unknown');
  assert.equal(classifyReadError(Object.assign(new Error('x'), { reason: 'zero_size' })), 'zero_size', 'an explicit reason wins');
  assert.equal(isDiskFullError(withCode('ENOSPC')), true);
  assert.equal(isDiskFullError(withCode('EDQUOT')), true);
  assert.equal(isDiskFullError(withCode('EIO')), false);

  const counts = { unreadable: 0, unreadableByReason: {} as Record<string, number> };
  const byReason: Record<string, string[]> = {};
  for (let i = 0; i < 5; i++) recordUnreadable(counts, byReason, 'zero_size', `XXXXXX/x${i}.pdf`, 3);
  recordUnreadable(counts, byReason, 'encrypted', 'XXXXXX/y.pdf', 3);
  assert.equal(counts.unreadable, 6);
  assert.deepEqual(counts.unreadableByReason, { zero_size: 5, encrypted: 1 });
  assert.equal(byReason.zero_size.length, 3, 'paths capped per reason');
});

// ─── Re-run with updated matching ─────────────────────────────────────────────

test('re-run plan: files only waiting review-queue rows whose folder now matches; a second run finds nothing', () => {
  const matchFor = (folder: string) => matchClientFolder(parseClientFolder(folder), valantRoster);
  const base = { status: 'ready', matchStatus: 'needs_review', suggestedClientId: null, voidedAt: null };
  const rows: RematchRow[] = [
    { id: 'd1', ...base, sourcePath: 'ALPANN/Clinical Notes/ALPANN_20240105_Progress Note(11).pdf' },
    { id: 'd2', ...base, sourcePath: 'ALPANN/Clinical Notes/BETBOB93_20240105_Progress Note(12).pdf' }, // code differs
    { id: 'd3', ...base, sourcePath: 'DUPCOD/a.pdf' }, // ambiguous code
    { id: 'd4', ...base, sourcePath: 'NOBODY/a.pdf' }, // no client
    { id: 'd5', ...base, status: 'rejected', sourcePath: 'ALPANN/b.pdf' }, // staff handled it
    { id: 'd6', ...base, suggestedClientId: 'v9', sourcePath: 'ALPANN/c.pdf' }, // already has a client
    { id: 'd7', ...base, voidedAt: new Date(), sourcePath: 'ALPANN/d.pdf' }, // voided
    { id: 'd8', ...base, sourcePath: 'loose.pdf' }, // outside a client folder
    { id: 'd9', ...base, sourcePath: 'GAMCY7/e.pdf', valantDocumentId: '5' },
  ];
  const plan = planRematchFiling(rows, matchFor);
  assert.deepEqual(
    plan.map((p) => [p.id, p.clientId, p.valantDocumentId]),
    [
      ['d1', 'v1', '11'],
      ['d9', 'v3', '5'],
    ]
  );
  // Apply the plan the way the job does (status filed, client set): a second run files nothing
  const after = rows.map((r) => {
    const p = plan.find((x) => x.id === r.id);
    return p ? { ...r, status: 'filed', matchStatus: 'valant_folder', suggestedClientId: p.clientId } : r;
  });
  assert.deepEqual(planRematchFiling(after, matchFor), []);
});

// ─── 7-Zip fallback plumbing ──────────────────────────────────────────────────

test('one-entry ZIP for 7-Zip: header + raw bytes + trailer is a valid ZIP (checked with a Deflate entry)', async () => {
  const { singleEntryZipParts } = await import('../src/lib/migration/valantZip');
  const yauzl = await import('yauzl');
  const data = Buffer.from('%PDF-1.4 ' + 'x'.repeat(5000));
  const raw = zlib.deflateRawSync(data);
  const { header, trailer } = singleEntryZipParts({ compressionMethod: 8, crc32: zlib.crc32(data), compressedSize: raw.length, uncompressedSize: data.length });
  const zipBuf = Buffer.concat([header, raw, trailer]);
  const zip = await yauzl.fromBufferPromise(zipBuf, { lazyEntries: true });
  const entries: import('yauzl').Entry[] = [];
  for await (const e of zip.eachEntry()) entries.push(e);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fileName, 'entry.bin', 'no client data in the temp file');
  const chunks: Buffer[] = [];
  for await (const c of await zip.openReadStreamPromise(entries[0])) chunks.push(c as Buffer);
  assert.deepEqual(Buffer.concat(chunks), data);
  zip.close();
});

test('Deflate64 entry with 7-Zip switched off: unreadable as unsupported_compression:9 (not a crash)', async () => {
  const { readEntry } = await import('../src/lib/migration/valantZip');
  const fakeEntry = { compressionMethod: 9, uncompressedSize: 10, compressedSize: 10 } as unknown as import('yauzl').Entry;
  await assert.rejects(readEntry({} as never, fakeEntry, null, { use7z: false }), (err: unknown) => classifyReadError(err) === 'unsupported_compression:9');
  const other = { compressionMethod: 14, uncompressedSize: 10, compressedSize: 10 } as unknown as import('yauzl').Entry;
  await assert.rejects(readEntry({} as never, other, null), (err: unknown) => classifyReadError(err) === 'unsupported_compression:14');
});

// ─── Files outside client folders: file-level code, nested folders, billing archive ──

const top = (folder: string) => matchClientFolder(parseClientFolder(folder), valantRoster);
const target = (p: string) => {
  const parts = p.split('/');
  const fileName = parts.pop()!;
  const topFolder = parts[0] ?? null;
  return resolveDocumentTarget({ topFolder, subfolders: parts.slice(1), fileName }, topFolder ? top(topFolder) : null, valantRoster);
};

test('rule 1: a file name starting with one client code files to that client; ambiguous or unknown → review', () => {
  const t = target('Signatures/ESignature Eligible/ALPANN_20240105_Consent Form(123456789).pdf');
  assert.deepEqual(t.kind === 'client' ? [t.clientId, t.basis, t.matchStatus] : t, ['v1', 'file_code', VALANT_FILE_CODE_MATCH]);
  assert.equal(target('Signatures/x/alpann_Statement.pdf').kind, 'client', 'case-insensitive, prefix without the full Valant pattern');
  const amb = target('Signatures/ESignature Eligible/DUPCOD_20240105_Consent(1).pdf');
  assert.equal(amb.kind, 'review');
  assert.equal(amb.kind === 'review' && amb.candidates.length, 2);
  assert.equal(target('Signatures/ESignature Eligible/ZZZZZZ_20240105_Consent(2).pdf').kind, 'review', 'no such client');
  assert.equal(target('Signatures/x/PHIFAY_20240105_Consent(3).pdf').kind, 'review', 'another platform: no code match');
  assert.equal(target('Signatures/x/ALPAN_20240105_Consent(4).pdf').kind, 'review', 'near miss');
  assert.equal(target('ALPANN_20240105_Note(5).pdf').kind, 'client', 'loose file at the top');
  assert.equal(fileNameClientCode('ERA_Exceptions_ACME_20240101(1).pdf'), null, 'billing word is not a code');
  // A top folder that points at other clients by name conflicts with the file code
  const byName = { status: 'needs_review' as const, clientId: null, basis: null, reason: 'Several clients have this name', candidates: [{ clientId: 'v1', name: 'Ann Alpha', dob: '', reason: 'Same name' }] };
  const conflict = resolveDocumentTarget({ topFolder: 'Alpha, Ann', subfolders: [], fileName: 'BETBOB93_20240105_Note(6).pdf' }, byName, valantRoster);
  assert.equal(conflict.kind, 'review');
  const agrees = resolveDocumentTarget({ topFolder: 'Alpha, Ann', subfolders: [], fileName: 'ALPANN_20240105_Note(6).pdf' }, byName, valantRoster);
  assert.equal(agrees.kind === 'client' && agrees.clientId, 'v1');
});

test('rule 2: client-code folders up to two levels below an unmatched top folder', () => {
  const a = target('Archived/ALPANN/Clinical/Note 01.02.23(123456789).pdf');
  assert.deepEqual(a.kind === 'client' ? [a.clientId, a.basis, a.matchStatus] : a, ['v1', 'nested_folder', 'valant_folder']);
  const b = target('Archived/Inactive/BETBOB93/xxx-12345678(987654321).pdf');
  assert.deepEqual(b.kind === 'client' ? [b.clientId, b.basis] : b, ['v2', 'nested_folder']);
  assert.equal(target('Archived/A/B/GAMCY7/x.pdf').kind, 'review', 'deeper than 2 levels: not a client folder');
  assert.equal(target('Archived/DUPCOD/x.pdf').kind, 'review', 'ambiguous nested code');
  assert.equal(target('Archived/ALPANN/GAMCY7/x.pdf').kind, 'review', 'two nested codes of different clients');
  const mismatch = target('Archived/ALPANN/BETBOB93_20240105_Note(7).pdf');
  assert.equal(mismatch.kind === 'review' && mismatch.codeMismatch, true, 'file code differs from the nested folder');
  assert.equal(target('Archived/ALPANN/ALPANN_20240105_Note(8).pdf').kind, 'client');
});

test('rule 3: practice billing records go to the billing archive (not review); client files never do', () => {
  const era = target('Billing/ERA Exceptions/ERA_Exceptions_ACME HEALTH PLAN, LLC._20240105(123456789).pdf');
  assert.equal(era.kind, 'billing');
  assert.equal(era.kind === 'billing' && era.payer, 'ACME HEALTH PLAN, LLC.');
  assert.equal(target('Billing/Claims/batch 2024.pdf').kind, 'billing');
  assert.equal(target('Billing/Other/x.pdf').kind, 'review', 'no billing keyword');
  assert.equal(target('Billing/Medical Record for Review/x.pdf').kind, 'review');
  // A client code in a billing folder still files to the client
  const c = target('Billing/Claims/GAMCY7_20240105_Claim(9).pdf');
  assert.equal(c.kind === 'client' && c.clientId, 'v3');
  // A Valant client file name with an unknown code is a patient record: review, not the archive
  assert.equal(target('Billing/Claims/ZZZZZZ_20240105_Claim(10).pdf').kind, 'review');
  // Inside a matched client folder: filed to the client
  assert.equal(target('ALPANN/Claims/x.pdf').kind, 'client');
  // A folder that points at clients (needs review) never feeds the archive
  assert.equal(top('DUPCOD').status, 'needs_review');
  assert.equal(target('DUPCOD/Claims/x.pdf').kind, 'review');
  assert.equal(isBillingArchivePath(['Remittance Advice'], 'x.pdf'), true);
  assert.equal(isBillingArchivePath(['Progress Notes'], 'EOB 2024.pdf'), true);
  assert.equal(isBillingArchivePath(['Progress Notes'], 'Operation note.pdf'), false, 'whole words only');
  assert.equal(parseBillingPayer('ERA_Exceptions_ACME_20240105(1).pdf'), 'ACME');
  assert.equal(parseBillingPayer('ERA_Exceptions_20240105(1).pdf'), null);
});

test('billing archive: billing roles and leadership; never Office Manager (2026-10-22) or clinicians; queue and file route', () => {
  for (const r of ['BILLING', 'PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR', 'SUPER_ADMIN', 'billing']) assert.equal(canViewBillingArchive(r), true, r);
  for (const r of ['OFFICE_MANAGER', 'THERAPIST', 'PSYCHIATRIST', 'FRONT_DESK', 'HR', 'CASE_MANAGER', '', null]) assert.equal(canViewBillingArchive(r), false, String(r));
  assert.equal(BILLING_ARCHIVE_STATUS, 'archived');
  assert.equal(PRACTICE_BILLING_MATCH, 'practice_billing');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  assert.match(read('src/app/api/ehr/doc-intake/route.ts'), /'filed', 'voided', BILLING_ARCHIVE_STATUS/);
  assert.match(read('src/app/api/files/[kind]/[name]/route.ts'), /doc\.status === BILLING_ARCHIVE_STATUS\) return canViewBillingArchive\(role\)/);
  const api = read('src/app/api/billing/valant-archive/route.ts');
  assert.match(api, /canViewBillingArchive/);
  assert.match(api, /auditPhiAccess/);
  assert.match(api, /suggestedClientId: null/);
});

test('billing archive list: payer / file-name text and document date filters', async () => {
  const { filterBillingArchive, toBillingArchiveRow } = await import('../src/lib/billing/valantBillingArchive');
  const mk = (id: string, fileName: string, payer: string, date: string | null) =>
    toBillingArchiveRow({
      id, fileName, fileSize: 2048, s3RawKey: `${id}.pdf`, createdAt: new Date('2026-10-21T00:00:00Z'),
      extractedFields: [{ label: 'Payer', value: payer }, ...(date ? [{ label: 'Document date', value: date }] : [])],
    });
  const rows = [mk('a', 'ERA_Exceptions_ACME_20240105(1).pdf', 'ACME', '2024-01-05'), mk('b', 'ERA_Exceptions_BLUE_20240301(2).pdf', 'BLUE', '2024-03-01'), mk('c', 'claims.pdf', 'claims', null)];
  assert.equal(rows[0].url, '/api/files/intake-docs/a.pdf');
  assert.deepEqual(filterBillingArchive(rows, { q: 'acme' }).map((r) => r.id), ['a']);
  assert.deepEqual(filterBillingArchive(rows, { from: '2024-02-01' }).map((r) => r.id), ['b']);
  assert.deepEqual(filterBillingArchive(rows, { to: '2024-02-01' }).map((r) => r.id), ['a']);
  assert.deepEqual(filterBillingArchive(rows, {}).map((r) => r.id), ['b', 'a', 'c'], 'newest first, undated last');
});

test('re-run plan with rules 1-3: places waiting rows in place, never staff-handled ones; a second run finds nothing', () => {
  const matchFor = (folder: string) => matchClientFolder(parseClientFolder(folder), valantRoster);
  const base = { status: 'ready', matchStatus: 'needs_review', suggestedClientId: null, voidedAt: null };
  const rows: RematchRow[] = [
    { id: 'f1', ...base, sourcePath: 'Signatures/ESignature Eligible/ALPANN_20240105_Consent(11).pdf' },
    { id: 'f2', ...base, sourcePath: 'Archived/BETBOB93/Notes/Note 01.02.23(12).pdf' },
    { id: 'f3', ...base, sourcePath: 'Billing/ERA Exceptions/ERA_Exceptions_ACME, LLC._20240105(13).pdf' },
    { id: 'f4', ...base, sourcePath: 'Signatures/ESignature Eligible/DUPCOD_20240105_Consent(14).pdf' }, // ambiguous
    { id: 'f5', ...base, sourcePath: 'Billing/Other/x.pdf' }, // stays in review
    { id: 'f6', ...base, status: 'rejected', sourcePath: 'Billing/Claims/y.pdf' }, // staff handled
    { id: 'f7', ...base, voidedAt: new Date(), sourcePath: 'Signatures/x/ALPANN_20240105_Consent(15).pdf' }, // voided
    { id: 'f8', ...base, sourcePath: 'ALPANN_20240105_Note(16).pdf' }, // loose file with a code
  ];
  const plan = planRematch(rows, matchFor, valantRoster);
  assert.deepEqual(
    plan.file.map((p) => [p.id, p.clientId, p.basis, p.matchStatus, p.valantDocumentId]),
    [
      ['f1', 'v1', 'file_code', 'valant_file_code', '11'],
      ['f2', 'v2', 'nested_folder', 'valant_folder', null], // not the CODE_YYYYMMDD_Title(id) pattern: no document id
      ['f8', 'v1', 'file_code', 'valant_file_code', '16'],
    ]
  );
  assert.deepEqual(plan.archive.map((p) => [p.id, p.payer]), [['f3', 'ACME, LLC.']]);
  // Apply the plan the way the job does (updateMany guarded by status 'ready' + needs_review)
  const after = rows.map((r) => {
    const f = plan.file.find((x) => x.id === r.id);
    if (f) return { ...r, status: 'filed', matchStatus: f.matchStatus, suggestedClientId: f.clientId };
    if (plan.archive.some((x) => x.id === r.id)) return { ...r, status: 'archived', matchStatus: 'practice_billing' };
    return r;
  });
  assert.deepEqual(planRematch(after, matchFor, valantRoster), { file: [], archive: [] });
  assert.deepEqual(planRematchFiling(rows, matchFor, valantRoster).map((p) => p.id), ['f1', 'f2', 'f8']);
});
