import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { parsePatientWorkbook, patientWorkbookBuffer } from '../src/lib/clients/bulkTransfer';

test('patient Excel template round-trips valid rows and validates invalid rows', async (t) => {
  await t.test('valid patient row parses with normalized values', async () => {
    const buffer = await patientWorkbookBuffer([{
      name: 'Alex Morgan', email: 'ALEX@EXAMPLE.COM', dateOfBirth: new Date('1990-05-20T00:00:00Z'),
      status: 'ACTIVE', riskLevel: 'MEDIUM', checkInStreak: 3, postalCode: '02108',
    }]);
    const result = await parsePatientWorkbook(buffer as ArrayBuffer);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].email, 'alex@example.com');
    assert.equal(result.rows[0].dateOfBirth?.toISOString().slice(0, 10), '1990-05-20');
    assert.equal(result.rows[0].postalCode, '02108');
    assert.equal(result.rows[0].riskLevel, 'MEDIUM');
  });

  await t.test('invalid spreadsheet returns row-level errors', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Patients');
    sheet.addRow(['Full Name *', 'Email', 'Date of Birth (YYYY-MM-DD)', 'Status']);
    sheet.addRow(['A', 'not-an-email', '02/30/2020', 'UNKNOWN']);
    const result = await parsePatientWorkbook(await workbook.xlsx.writeBuffer() as ArrayBuffer);
    assert.equal(result.rows.length, 1);
    assert.ok(result.errors.some((error) => error.field === 'Full Name'));
    assert.ok(result.errors.some((error) => error.field === 'Email'));
    assert.ok(result.errors.some((error) => error.field === 'Date of Birth'));
    assert.ok(result.errors.some((error) => error.field === 'Status'));
  });
});
