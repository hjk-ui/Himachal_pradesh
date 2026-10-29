import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  KNOWN_EQUIVALENTS,
  clientNameMatches,
  groupValantPayers,
  journalPayerNames,
  nameSimilarity,
  normalizeNanpPhone,
  normalizePayerName,
  parseValantAddress,
  parseValantPayerRecords,
  planValantPayerImport,
  registryMatches,
  summarizeValantPayers,
  valantPayerHeaderOk,
  waystarValantReference,
  zipMatchesState,
  type ExistingValantPayer,
  type PlannedPayer,
} from '../src/lib/billing/valantPayers';
import { normalizePayerName as waystarNormalize } from '../src/lib/billing/waystarSftpClaims';

const HEADER = ['Name', 'Address', 'Tax IDs', 'Phone', 'EDI Payor Id', 'Active'];

// Shapes taken from the Valant insurance companies export (Oct 2026); tax-ID lists shortened
const ROWS: string[][] = [
  HEADER,
  ['Aetna Better Health of Maryland', 'P.O. Box 982968, El Paso, TX, 79998', '00-0000169,00-0000423', '', '128MD', 'Active'],
  ['All Savers Insurance UHC', 'A, B, MD, 45789-5567', '00-0000169', '(124) 568-9546', '81400', 'Active'],
  ['CareFirst BCBS - Maryland', 'CareFirst BCBS - Maryland, SA, MD, 54565', '00-0002758', '(455) 564-5645', 'SB690', 'Active'],
  ['CareFirst BCBS - Maryland', 'P.O. Box 14115, Lexington, KY, 40512', '00-0001556', '(156) 154-6256', 'SB690', 'Active'],
  ['CareFirst BCBS - Maryland', 'P.O. Box 14115, Lexington, KY, 40512', '00-0002631', '(456) 456-4456', 'SB690', 'Active'],
  ['CareFirst BCBS - Maryland', 'P.O. Box 981608, El Paso, TX, 79998', '92-3843658', '(301) 249-8100', 'SB690', 'Active'],
  ['MAIL ADMINISTRATOR', 'P.O. BOX 21014, EAGAN, MN, 55121', '92-3843658', '(732) 875-7700', 'Sb690', 'Active'],
  ['Maryland Public Behavioral Health System', '7550 Teague Rd, 5th floor, Hanover, MD, 21076', '00-0002631', '(800) 888-1965', 'BHOMD', 'Active'],
  ['Maryland Public Behavioral Health System', '201 WEST PRESTON STREET, BALTIMORE, MD, 21201', '00-0002631,52-6002033', '(410) 767-5503', 'BHOMD', 'Active'],
  ['Maryland Public Behavioral Health System', '7550 Teague Rd, 5th floor, Hanover, MD, 21076', '00-0002631,06-6033492', '(800) 888-1965', 'BHOMD', 'Active'],
  ['PHCS', 'PO Box 1628, Addison, TX, 75001', '06-6033492', '', '', 'Active'],
  ['PHCS', 'MultiPlan / PHCS Corporate, 115 Fifth Avenue, New York, NY, 10003', '92-3843658', '(800) 922-4362', '133306', 'Active'],
  ['UMR', 'PO Box 30541, Salt Lake City, UT, 84130-0541', '00-0000423', '(877) 217-7800', '39026', 'Active'],
  ['UMR', 'PO Box 30541, Salt Lake City, UT, 84130', '00-0001556', '(454) 564-6456', '39026', 'Active'],
  ['MARYLAND MEDICAL ASSITANCE (MARYLAND MED', '', '00-0002631', '', '', 'Active'],
  ['Medical Bill Repricer', 'P.o Box 21176, Eagen, NM, 55121', '', '(788) 278-4668', '87871', 'Inactive'],
  ['', '', '', '', '', ''],
];

const parsed = parseValantPayerRecords(ROWS);
const payers = groupValantPayers(parsed.rows);
const byName = (name: string, edi?: string) => payers.find((p) => p.name === name && (edi == null || p.ediPayerId === edi))!;

test('header: Valant columns in any order; other exports are rejected', () => {
  assert.equal(valantPayerHeaderOk(HEADER), true);
  assert.equal(valantPayerHeaderOk(['EDI Payor Id', 'Name', 'Phone', 'Address', 'Active', 'Tax IDs']), true);
  assert.equal(valantPayerHeaderOk(['Name', 'Documentation Code', 'Category']), false);
  assert.equal(parseValantPayerRecords([['Name', 'Address'], ['x', 'y']]).headerOk, false);
  assert.equal(parsed.headerOk, true);
  assert.equal(parsed.rows.length, 16);
  assert.equal(parsed.blankRows, 1);
  assert.deepEqual(parsed.errors, []);
});

test('normalized name matches the Waystar payer mapping normalization', () => {
  for (const n of ['CareFirst BCBS (BlueChoice)', 'S&J SERVICES,INC.', 'Maryland Public Behavioral Health System']) {
    assert.equal(normalizePayerName(n), waystarNormalize(n));
  }
});

test('phone: valid NANP numbers normalize to 10 digits; malformed ones are kept raw and flagged', () => {
  assert.deepEqual(normalizeNanpPhone('(800) 888-1965'), { phone: '8008881965', raw: '(800) 888-1965', status: 'valid' });
  assert.equal(normalizeNanpPhone('1-410-767-5503').phone, '4107675503');
  assert.equal(normalizeNanpPhone('').status, 'missing');
  for (const bad of ['(124) 568-9546', '(030) 180-3865', '(899) 099-0990', '(454) 555-5555', '(911) 222-3333', '12345']) {
    const p = normalizeNanpPhone(bad);
    assert.equal(p.status, 'invalid', bad);
    assert.equal(p.phone, null);
    assert.equal(p.raw, bad);
    assert.ok(p.reason);
  }
});

test('address: "street, city, ST, ZIP" splits; ZIP+4 kept; placeholders flagged, never corrected', () => {
  const a = parseValantAddress('7550 Teague Rd, 5th floor, Hanover, MD, 21076');
  assert.deepEqual([a.line, a.city, a.state, a.zip, a.status], ['7550 Teague Rd, 5th floor', 'Hanover', 'MD', '21076', 'ok']);
  assert.equal(parseValantAddress('PO Box 30541, Salt Lake City, UT, 84130-0541').zip, '84130-0541');
  const junk = parseValantAddress('A, B, MD, 45789-5567');
  assert.equal(junk.status, 'suspect');
  assert.ok(junk.issues.some((i) => /not a MD ZIP/.test(i)));
  assert.ok(junk.issues.some((i) => /street is too short/.test(i)));
  assert.equal(junk.raw, 'A, B, MD, 45789-5567');
  assert.ok(parseValantAddress('CareFirst BCBS - Maryland, SA, MD, 54565', 'CareFirst BCBS - Maryland').issues.includes('street is the payer name'));
  assert.ok(parseValantAddress('P.o Box 21176, Eagen, NM, 55121').issues.some((i) => /not a NM ZIP/.test(i)));
  assert.equal(parseValantAddress('Humana Claims Lexington KY').status, 'unparsed');
  assert.equal(parseValantAddress('').status, 'missing');
  assert.equal(zipMatchesState('20716', 'MD'), true);
  assert.equal(zipMatchesState('20422', 'DC'), true);
  assert.equal(zipMatchesState('67854', 'MD'), false);
});

test('grouping: same normalized name + EDI ID -> one payer with every distinct address', () => {
  const cf = byName('CareFirst BCBS - Maryland', 'SB690');
  assert.equal(cf.sourceRowCount, 4);
  // two rows share PO Box 14115 Lexington -> 3 distinct addresses, both phones kept
  assert.equal(cf.addresses.length, 3);
  const lex = cf.addresses.find((a) => a.city === 'Lexington')!;
  assert.deepEqual(lex.phonesRaw, ['(156) 154-6256', '(456) 456-4456']);
  assert.equal(lex.phone, '4564564456');
  assert.equal(lex.taxIdsRaw.length, 2);
  // primary address is a well-formed one, not the placeholder row that came first
  assert.equal(cf.city, 'Lexington');

  const pbhs = byName('Maryland Public Behavioral Health System');
  assert.equal(pbhs.ediPayerId, 'BHOMD');
  assert.equal(pbhs.sourceRowCount, 3);
  assert.equal(pbhs.addresses.length, 2);
  assert.equal(pbhs.phone, '8008881965');

  // ZIP and ZIP+4 of the same PO box are one address; the fuller ZIP is kept
  const umr = byName('UMR');
  assert.equal(umr.addresses.length, 1);
  assert.equal(umr.addresses[0].zip, '84130-0541');

  // EDI IDs are upper-cased ("Sb690")
  assert.equal(byName('MAIL ADMINISTRATOR').ediPayerId, 'SB690');
  assert.equal(byName('Medical Bill Repricer').active, false);
});

test('grouping: same name with different EDI IDs stays separate, flagged as possible duplicates', () => {
  const blank = byName('PHCS', '');
  const edi = byName('PHCS', '133306');
  assert.notEqual(blank.key, edi.key);
  assert.ok(blank.duplicateGroup);
  assert.equal(blank.duplicateGroup, edi.duplicateGroup);
  // shared EDI ID under a different name (CareFirst SB690 vs MAIL ADMINISTRATOR Sb690)
  assert.equal(byName('MAIL ADMINISTRATOR').duplicateGroup, byName('CareFirst BCBS - Maryland').duplicateGroup);
  assert.equal(byName('Aetna Better Health of Maryland').duplicateGroup, null);
});

test('tax IDs are kept raw for reference only', () => {
  const cf = byName('CareFirst BCBS - Maryland');
  assert.match(cf.taxIdsRaw, /92-3843658/);
  assert.ok(!('taxId' in cf));
});

test('summary counts', () => {
  const s = summarizeValantPayers(parsed, payers);
  assert.equal(s.rows, 16);
  assert.equal(s.payers, 10);
  assert.equal(s.mergedRows, 6);
  assert.equal(s.withEdiId, 8);
  assert.ok(s.suspectAddresses >= 3);
  assert.ok(s.invalidPhones >= 2);
  assert.equal(s.possibleDuplicateGroups, 2);
});

function asExisting(list: PlannedPayer[]): ExistingValantPayer[] {
  return list.map((p, i) => ({ id: `id${i}`, normalizedName: p.normalizedName, ediPayerId: p.ediPayerId, sourceRowHash: p.sourceRowHash, duplicateGroup: p.duplicateGroup }));
}

test('import plan is idempotent: the same file twice changes nothing', () => {
  const first = planValantPayerImport([], payers);
  assert.equal(first.create.length, payers.length);
  const again = planValantPayerImport(asExisting(payers), groupValantPayers(parseValantPayerRecords(ROWS).rows));
  assert.equal(again.create.length, 0);
  assert.equal(again.update.length, 0);
  assert.equal(again.unchanged.length, payers.length);
  // row order does not matter
  const shuffled = [ROWS[0], ...ROWS.slice(1).reverse()];
  assert.equal(planValantPayerImport(asExisting(payers), groupValantPayers(parseValantPayerRecords(shuffled).rows)).update.length, 0);
});

test('import plan: changed rows update, new rows create, missing payers are kept (not deleted)', () => {
  const edited = ROWS.map((r) => (r[0] === 'UMR' && r[3] === '(454) 564-6456' ? [...r.slice(0, 3), '(800) 826-1300', ...r.slice(4)] : r))
    .filter((r) => r[0] !== 'Aetna Better Health of Maryland')
    .concat([['Wellpoint Maryland', '857 Elkridge Landing Road, Suite 300, Linthicum, MD, 21090', '', '(833) 707-0868', '26375', 'Active']]);
  const plan = planValantPayerImport(asExisting(payers), groupValantPayers(parseValantPayerRecords(edited).rows));
  assert.deepEqual(plan.create.map((p) => p.name), ['Wellpoint Maryland']);
  assert.deepEqual(plan.update.map((u) => u.payer.name), ['UMR']);
  assert.equal(plan.notInFile.length, 1);
});

test('client insurance matching: exact names count, similar names are suggestions only', () => {
  const names = [
    { name: 'Maryland Public Behavioral Health System', count: 120 },
    { name: 'MARYLAND PUBLIC BEHAVIORAL HEALTH SYSTEM', count: 3 },
    { name: 'Maryland Public Behavioral Health', count: 4 },
    { name: 'CareFirst', count: 9 },
  ];
  const pbhs = byName('Maryland Public Behavioral Health System');
  const m = clientNameMatches(pbhs, names);
  assert.deepEqual(m.filter((x) => x.kind === 'exact').map((x) => x.count), [120, 3]);
  const similar = m.filter((x) => x.kind === 'similar');
  assert.deepEqual(similar.map((x) => x.name), ['Maryland Public Behavioral Health']);
  // confirmed alias then counts
  const confirmed = clientNameMatches({ ...pbhs, confirmedAliases: ['Maryland Public Behavioral Health'] }, names);
  assert.equal(confirmed.find((x) => x.name === 'Maryland Public Behavioral Health')?.kind, 'confirmed');
  // truncated Valant names still suggest
  assert.ok(nameSimilarity('MARYLAND MEDICAL ASSITANCE (MARYLAND MED', 'Maryland Medical Assitance (Maryland Medicaid)') >= 0.6);
  assert.ok(nameSimilarity('Aetna', 'Cigna') < 0.6);
});

test('registry matching by EDI ID and/or name', () => {
  const registry = [
    { id: 'r1', payerId: 'bhomd', name: 'Optum Maryland' },
    { id: 'r2', payerId: 'X1', name: 'Maryland Public Behavioral Health System' },
    { id: 'r3', payerId: '62308', name: 'Cigna' },
  ];
  const m = registryMatches(byName('Maryland Public Behavioral Health System'), registry);
  assert.deepEqual(m.map((x) => [x.id, x.by]), [['r1', 'edi'], ['r2', 'name']]);
  assert.deepEqual(registryMatches(byName('PHCS', ''), registry), []);
});

test('Waystar reference: shows Valant EDI IDs and discrepancies, including known program equivalents', () => {
  const mappings = [
    { id: 'm1', payerName: 'Maryland Medicaid', aliases: ['MD Medicaid', 'Maryland Medical Assistance'], waystarPayerId: '100198', verified: false, active: true },
    { id: 'm2', payerName: 'Aetna Better Health of Maryland', aliases: [], waystarPayerId: '128MD', verified: true, active: true },
  ];
  const valant = payers.map((p) => ({ id: p.key, name: p.name, normalizedName: p.normalizedName, ediPayerId: p.ediPayerId }));
  const refs = waystarValantReference(mappings, valant);
  const md = refs.find((r) => r.mappingId === 'm1')!;
  assert.deepEqual(md.valant.map((v) => [v.name, v.ediPayerId, v.match]), [['Maryland Public Behavioral Health System', 'BHOMD', 'equivalent']]);
  assert.deepEqual(md.discrepancies, ['BHOMD']);
  const aetna = refs.find((r) => r.mappingId === 'm2')!;
  assert.deepEqual(aetna.discrepancies, []);
  assert.equal(aetna.valant[0].match, 'name');
  assert.ok(KNOWN_EQUIVALENTS.length >= 1);
  // pure: inputs untouched
  assert.equal(mappings[0].waystarPayerId, '100198');
});

test('no automatic writes to the Waystar payer mapping', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'src/lib/billing/valantPayers.ts',
    'src/lib/billing/valantPayersDb.ts',
    'src/app/api/migration/valant-payers/route.ts',
    'src/app/api/billing/insurance-companies/route.ts',
    'src/app/api/billing/insurance-companies/[id]/route.ts',
    'src/app/api/billing/insurance-companies/waystar-check/route.ts',
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /savePayerMapping|waystarPayerMapping\.(create|update|upsert|delete|createMany|updateMany)|INSERT INTO waystar_payer_mappings/i, f);
  }
});

test('journal insurance cells: single payer names with commas are not split', () => {
  const known = new Set(['ALLEGIANCE BENEFIT PLAN MANAGEMENT, INC.', 'Cigna'].map(normalizePayerName));
  assert.deepEqual(journalPayerNames('ALLEGIANCE BENEFIT PLAN MANAGEMENT, INC.', known), ['ALLEGIANCE BENEFIT PLAN MANAGEMENT, INC.']);
  assert.deepEqual(journalPayerNames('Cigna, ALLEGIANCE BENEFIT PLAN MANAGEMENT, INC.', known), ['Cigna', 'ALLEGIANCE BENEFIT PLAN MANAGEMENT, INC.']);
  assert.deepEqual(journalPayerNames('', known), []);
});
