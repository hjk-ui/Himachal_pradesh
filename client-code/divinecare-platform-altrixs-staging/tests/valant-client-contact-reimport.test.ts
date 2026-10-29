/**
 * Valant client re-import, "contact & demographics only" scope (src/lib/migration/clientContact.ts)
 * and the column report shown in every client import preview (describeColumns in fieldMaps.ts).
 * Synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTACT_FIELDS,
  planClientContactUpdates,
  type ContactRow,
  type ExistingContactClient,
} from '../src/lib/migration/clientContact';
import { describeColumns, resolveClientFields, rowHeaders } from '../src/lib/migration/fieldMaps';

const base = (over: Partial<ExistingContactClient> = {}): ExistingContactClient => ({
  id: 'c1',
  mrn: 'MRN-1',
  sourceId: '1001',
  legalFirstName: 'Ada',
  legalLastName: 'Lovelace',
  dateOfBirth: new Date('1980-01-02T12:00:00.000Z'),
  addressLine1: '1 Main St',
  city: 'Bowie',
  state: null,
  postalCode: null,
  phone: null,
  email: null,
  race: [],
  ...over,
});

/** A Valant-style export row (headers as Valant names them) resolved through the field map */
const row = (cells: Record<string, string>, n = 1): ContactRow => ({ row: n, fields: resolveClientFields(cells, 'valant') });

test('fills only empty fields; ZIP, state, phone and coded demographics normalized', () => {
  const plan = planClientContactUpdates(
    [row({
      'Pt. ID': '1001', 'Pt. Address (Street1)': '1 Main St', 'Pt. Address (City)': 'Bowie', 'Pt. Address (State)': 'Maryland',
      'Pt. Address (Zip)': '207151234', 'Pt. Phone (Cell)': '301.555.2345', 'Pt. Email (Home)': 'Ada@Example.com',
      'Pt. Sex': 'Female', 'Pt. Race': 'White', 'Pt. Marital Status': 'Single',
    })],
    [base()]
  );
  assert.equal(plan.matched, 1);
  assert.equal(plan.updates.length, 1);
  const u = plan.updates[0];
  assert.deepEqual(u.data, {
    state: 'MD', postalCode: '20715-1234', email: 'ada@example.com', administrativeSex: 'F', race: ['2106-3'],
    maritalStatus: 'S', phone: '(301) 555-2345', phoneType: 'mobile',
  });
  // Unchanged address / city are not rewritten
  assert.ok(!('addressLine1' in u.data) && !('city' in u.data));
  assert.equal(plan.filled.postalCode, 1);
  assert.equal(plan.filled.phone, 1);
  assert.equal(plan.conflicts.length, 0);
  // Every write is guarded on the value read (null here): a concurrent edit makes the update a no-op
  assert.equal(u.expected.postalCode, null);
  assert.deepEqual(u.expected.race, []);
  // Only fields of this scope are ever written
  for (const f of u.fields) assert.ok((CONTACT_FIELDS as readonly string[]).includes(f));
});

test('idempotent: the same file against the updated chart writes nothing', () => {
  const r = row({ 'Pt. ID': '1001', 'Pt. Address (Zip)': '20715', 'Pt. Phone (Main)': '(301) 555-2345' });
  const first = planClientContactUpdates([r], [base()]);
  const after = base(first.updates[0].data as Partial<ExistingContactClient>);
  const again = planClientContactUpdates([r], [after]);
  assert.equal(again.updates.length, 0);
  assert.equal(again.unchanged, 1);
});

test('a different value already on the chart is a conflict (field + id / MRN only), never overwritten', () => {
  const plan = planClientContactUpdates(
    [row({ 'Pt. ID': '1001', 'Pt. Address (Street1)': '9 Other Rd', 'Pt. Address (Zip)': '20715', 'Pt. Phone (Main)': '3015552345' })],
    [base({ postalCode: '21201', phone: '410-555-0000', phoneSecondary: '410-555-1111' })]
  );
  assert.equal(plan.updates.length, 0);
  const fields = plan.conflicts.map((c) => c.field).sort();
  assert.deepEqual(fields, ['addressLine1', 'phone', 'postalCode']);
  assert.equal(plan.conflictsByField.postalCode, 1);
  for (const c of plan.conflicts) {
    assert.deepEqual(Object.keys(c).sort(), ['clientId', 'field', 'mrn', 'row']);
    assert.equal(c.mrn, 'MRN-1');
  }
  // No value from the file or the chart leaks into the result
  assert.ok(!JSON.stringify(plan).includes('9 Other Rd'));
  assert.ok(!JSON.stringify(plan).includes('21201'));
});

test('same state / ZIP / phone in a non-standard form is rewritten to the standard form', () => {
  const plan = planClientContactUpdates(
    [row({ 'Pt. ID': '1001', 'Pt. Address (State)': 'MD', 'Pt. Address (Zip)': '20715-1234', 'Pt. Phone (Main)': '301-555-2345' })],
    [base({ state: 'maryland', postalCode: '207151234', phone: '301 555 2345 cell' })]
  );
  assert.deepEqual(plan.updates[0].data, { state: 'MD', postalCode: '20715-1234', phone: '(301) 555-2345' });
  assert.equal(plan.formatFixed.state, 1);
  assert.equal(plan.formatFixed.postalCode, 1);
  assert.equal(plan.formatFixed.phone, 1);
  assert.equal(plan.conflicts.length, 0);
  // A valid number in another format is left alone (no churn)
  const ok = planClientContactUpdates([row({ 'Pt. ID': '1001', 'Pt. Phone (Main)': '301-555-2345' })], [base({ phone: '3015552345' })]);
  assert.equal(ok.updates.length, 0);
});

test('invalid ZIP / phone / state / Medicaid ID are rejected and reported per field', () => {
  const plan = planClientContactUpdates(
    [row({
      'Pt. ID': '1001', 'Pt. Address (Zip)': '2071', 'Pt. Phone (Main)': '555-1234', 'Pt. Phone (Cell)': '(123) 456-7890',
      'Pt. Address (State)': 'Narnia', 'Pt. Medicaid ID': '12345', 'Pt. Emergency Contact Phone': '1-800-FLOWERS',
    })],
    [base()]
  );
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.invalid.postalCode, 1);
  assert.equal(plan.invalid.phone, 1);
  assert.equal(plan.invalid.phoneMobile, 1);
  assert.equal(plan.invalid.state, 1);
  assert.equal(plan.invalid.medicaidId, 1);
  assert.equal(plan.invalid.emergencyContactPhone, 1);
  assert.ok(plan.warnings.every((w) => !/2071|555-1234|12345/.test(w.reason)));
});

test('a blank cell (or Valant "None") never clears a stored value', () => {
  const plan = planClientContactUpdates(
    [row({ 'Pt. ID': '1001', 'Pt. Address (Zip)': '', 'Pt. Phone (Main)': '   ', 'Pt. Address (County)': 'None', 'Pt. Race': '' })],
    [base({ postalCode: '20715', phone: '(301) 555-2345', county: 'Prince George', race: ['2054-5'] })]
  );
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.unchanged, 1);
});

test('legal first / last name and DOB are never written; a mismatch is a conflict', () => {
  const plan = planClientContactUpdates(
    [row({ 'Pt. ID': '1001', 'Pt. Name (First)': 'Augusta', 'Pt. Name (Last)': 'King', 'Pt. Birth Date': '3/4/1981', 'Pt. Address (Zip)': '20715' })],
    [base({ legalFirstName: 'Ada', legalLastName: 'Lovelace' }), base({ id: 'c2', sourceId: '1002', legalFirstName: null, legalLastName: null, dateOfBirth: null })]
  );
  const u = plan.updates[0];
  assert.deepEqual(Object.keys(u.data), ['postalCode']);
  assert.deepEqual(plan.conflicts.map((c) => c.field).sort(), ['dateOfBirth', 'legalFirstName', 'legalLastName']);
  // Even an empty legal name / DOB is not filled in this mode
  const empty = planClientContactUpdates(
    [row({ 'Pt. ID': '1002', 'Pt. Name (First)': 'Grace', 'Pt. Name (Last)': 'Hopper', 'Pt. Birth Date': '12/9/1956' })],
    [base({ id: 'c2', sourceId: '1002', legalFirstName: null, legalLastName: null, dateOfBirth: null })]
  );
  assert.equal(empty.updates.length, 0);
  // Same name in different case is not a conflict
  const same = planClientContactUpdates([row({ 'Pt. ID': '1001', 'Pt. Name (First)': 'ADA', 'Pt. Name (Last)': 'lovelace', 'Pt. Birth Date': '1/2/1980' })], [base()]);
  assert.equal(same.conflicts.length, 0);
});

test('unknown ids are listed (never created); an id matching several clients is skipped', () => {
  const plan = planClientContactUpdates(
    [row({ 'Pt. ID': '9999', 'Pt. Address (Zip)': '20715' }, 1), row({ 'Pt. ID': '1001', 'Pt. Address (Zip)': '20715' }, 2), row({ 'Pt. Address (Zip)': '20715' }, 3)],
    [base(), base({ id: 'c9', mrn: 'MRN-9' })]
  );
  assert.deepEqual(plan.notFound, [{ row: 1, sourceId: '9999' }]);
  assert.deepEqual(plan.ambiguous, [{ row: 2, sourceId: '1001', clients: 2 }]);
  assert.equal(plan.noSourceId, 1);
  assert.equal(plan.updates.length, 0);
});

test('an email already on another patient is not copied', () => {
  const plan = planClientContactUpdates(
    [row({ 'Pt. ID': '1001', 'Pt. Email (Home)': 'family@example.com' })],
    [base()],
    new Map([['family@example.com', 'other-client']])
  );
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.emailInUse, 1);
});

test('a second number fills the empty secondary slot; a number already on the chart stays where it is', () => {
  const plan = planClientContactUpdates(
    [row({ 'Pt. ID': '1001', 'Pt. Phone (Main)': '(301) 555-2345', 'Pt. Phone (Home)': '(301) 555-9876', 'Pt. Phone (Cell)': '(301) 555-2345' })],
    [base({ phone: '(301) 555-9876', phoneType: 'home' })]
  );
  assert.deepEqual(plan.updates[0].data, { phoneSecondary: '(301) 555-2345', phoneSecondaryType: 'mobile' });
  assert.equal(plan.conflicts.length, 0);
});

test('column report lists recognized headers with their fields and the ignored ones', () => {
  const headers = ['Pt. ID', 'Pt. Address (Zip)', 'Pt. Phone (Cell)', 'Pt. Address (Street1)', 'Pt. Favorite Color', 'Zip+4 Plus'];
  const rep = describeColumns(headers, 'valant');
  const by = new Map(rep.recognized.map((r) => [r.header, r.fields]));
  assert.deepEqual(by.get('Pt. Address (Zip)'), ['postalCode']);
  assert.ok(by.get('Pt. Phone (Cell)')?.includes('phoneMobile'));
  assert.deepEqual(by.get('Pt. ID'), ['sourceId']);
  assert.deepEqual(rep.ignored, ['Pt. Favorite Color', 'Zip+4 Plus']);
  assert.deepEqual(rowHeaders([{ a: '1' }, { a: '2', b: '3' }]), ['a', 'b']);
  // Generic CSV map also works (all client import modes)
  assert.deepEqual(describeColumns(['zip', 'mystery'], 'generic').ignored, ['mystery']);
});

test('route: the contact scope is fill-only, guarded, audited, and every mode returns the column report', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/app/api/migration/clients/route.ts'), 'utf8');
  assert.match(src, /updateScope: z\.enum\(\['facility', 'contact'\]\)/);
  assert.match(src, /prisma\.client\.updateMany\(\{\s*where: \{ id: u\.clientId, organizationId: gate\.organizationId, AND: contactGuard\(u\) \}/);
  assert.match(src, /source: 'valant_contact_reimport', fieldsSet: u\.fields/);
  assert.match(src, /importType: 'clients_contact'/);
  // The contact branch never creates clients
  const contact = src.slice(src.indexOf("if (scope === 'contact')"), src.indexOf("if (scope === 'facility')"));
  assert.ok(!/client\.create|allocateNextMrn/.test(contact));
  assert.equal((src.match(/^\s+columns,$/gm) ?? []).length, 4);
});

test('a stored 5-digit ZIP is extended to the matching ZIP+4 (format fix, not a conflict)', () => {
  const plan = planClientContactUpdates([row({ 'Pt. ID': '1001', 'Pt. Address (Zip)': '207151234' })], [base({ postalCode: '20715' })]);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.updates[0].data.postalCode, '20715-1234');
  // a different 5-digit ZIP is still a conflict
  const other = planClientContactUpdates([row({ 'Pt. ID': '1001', 'Pt. Address (Zip)': '207161234' })], [base({ postalCode: '20715' })]);
  assert.equal(other.conflictsByField.postalCode, 1);
});
