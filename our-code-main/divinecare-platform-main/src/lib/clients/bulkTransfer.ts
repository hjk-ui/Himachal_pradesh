import ExcelJS from 'exceljs';
import type { ClientStatus, RiskLevel } from '@prisma/client';

export const PATIENT_SHEET_NAME = 'Patients';
export const MAX_PATIENT_IMPORT_ROWS = 1000;
export const MAX_PATIENT_IMPORT_BYTES = 2 * 1024 * 1024;

export const PATIENT_COLUMNS = [
  { key: 'patientId', header: 'Patient ID', width: 26, readOnly: true },
  { key: 'name', header: 'Full Name *', width: 24 },
  { key: 'email', header: 'Email', width: 28 },
  { key: 'phone', header: 'Phone', width: 18 },
  { key: 'dateOfBirth', header: 'Date of Birth (YYYY-MM-DD)', width: 24 },
  { key: 'gender', header: 'Gender', width: 14 },
  { key: 'addressLine1', header: 'Address Line 1', width: 28 },
  { key: 'addressLine2', header: 'Address Line 2', width: 24 },
  { key: 'city', header: 'City', width: 18 },
  { key: 'state', header: 'State', width: 14 },
  { key: 'postalCode', header: 'Postal Code', width: 14 },
  { key: 'emergencyContactName', header: 'Emergency Contact Name', width: 24 },
  { key: 'emergencyContactPhone', header: 'Emergency Contact Phone', width: 22 },
  { key: 'insurancePayer', header: 'Insurance Payer', width: 24 },
  { key: 'insuranceMemberId', header: 'Insurance Member ID', width: 22 },
  { key: 'insuranceGroupNumber', header: 'Insurance Group Number', width: 22 },
  { key: 'primaryDiagnosis', header: 'Primary Diagnosis', width: 26 },
  { key: 'primaryDiagnosisCode', header: 'Primary Diagnosis Code', width: 22 },
  { key: 'secondaryDiagnoses', header: 'Secondary Diagnoses', width: 32 },
  { key: 'location', header: 'Location', width: 22 },
  { key: 'assignedClinicianEmail', header: 'Assigned Clinician Email', width: 28 },
  { key: 'status', header: 'Status', width: 14 },
  { key: 'riskLevel', header: 'Risk Level', width: 14 },
  { key: 'checkInStreak', header: 'Check-in Streak', width: 16 },
  { key: 'image', header: 'Image URL', width: 30 },
  { key: 'assignedSince', header: 'Assigned Since', width: 20, readOnly: true },
  { key: 'createdAt', header: 'Created At', width: 20, readOnly: true },
  { key: 'updatedAt', header: 'Updated At', width: 20, readOnly: true },
] as const;

export type PatientColumnKey = (typeof PATIENT_COLUMNS)[number]['key'];

export type PatientExportRow = Partial<Record<PatientColumnKey, string | number | Date | null>>;

export type PatientImportRow = {
  rowNumber: number;
  patientId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  insurancePayer: string | null;
  insuranceMemberId: string | null;
  insuranceGroupNumber: string | null;
  primaryDiagnosis: string | null;
  primaryDiagnosisCode: string | null;
  secondaryDiagnoses: string | null;
  location: string | null;
  assignedClinicianEmail: string | null;
  status: ClientStatus;
  riskLevel: RiskLevel;
  checkInStreak: number;
  image: string | null;
};

export type PatientImportError = { row: number; field?: string; message: string };

function textValue(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value && value.result != null) return String(value.result).trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
  }
  return String(value).trim();
}

function nullableText(value: ExcelJS.CellValue): string | null {
  const valueText = textValue(value);
  return valueText ? valueText : null;
}

function parseDate(value: ExcelJS.CellValue): Date | null | 'invalid' {
  if (value == null || textValue(value) === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const raw = textValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'invalid';
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw
    ? parsed
    : 'invalid';
}

function normalizeHeader(value: ExcelJS.CellValue) {
  return textValue(value).replace(/\s*\*\s*$/, '').trim().toLowerCase();
}

export async function createPatientWorkbook(rows: PatientExportRow[] = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Altrixs';
  workbook.created = new Date();

  const patients = workbook.addWorksheet(PATIENT_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }],
  });
  patients.columns = PATIENT_COLUMNS.map((column) => ({
    key: column.key,
    header: column.header,
    width: column.width,
  }));
  patients.autoFilter = { from: 'A1', to: `${patients.getColumn(PATIENT_COLUMNS.length).letter}1` };
  patients.getRow(1).height = 30;
  patients.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6868D0' } };
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF4E4EA8' } } };
  });

  for (const row of rows) patients.addRow(row);
  if (rows.length === 0) patients.addRow({});

  const lastInputRow = Math.max(1001, patients.rowCount);
  patients.getColumn('dateOfBirth').numFmt = 'yyyy-mm-dd';
  for (const key of ['assignedSince', 'createdAt', 'updatedAt'] as PatientColumnKey[]) {
    patients.getColumn(key).numFmt = 'yyyy-mm-dd hh:mm';
  }
  patients.getColumn('postalCode').numFmt = '@';
  patients.getColumn('phone').numFmt = '@';
  patients.getColumn('emergencyContactPhone').numFmt = '@';
  patients.getColumn('insuranceMemberId').numFmt = '@';
  patients.getColumn('insuranceGroupNumber').numFmt = '@';

  for (let row = 2; row <= lastInputRow; row += 1) {
    patients.getRow(row).getCell('status').dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"ACTIVE,INACTIVE,DISCHARGED"'],
    };
    patients.getRow(row).getCell('riskLevel').dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"LOW,MEDIUM,HIGH"'],
    };
    patients.getRow(row).getCell('checkInStreak').dataValidation = {
      type: 'whole', operator: 'between', allowBlank: true, formulae: [0, 100000],
    };
  }

  if (patients.rowCount > 1) {
    patients.getRows(2, patients.rowCount - 1)?.forEach((row) => {
      row.font = { name: 'Arial', size: 10, color: { argb: 'FF27324A' } };
      row.alignment = { vertical: 'middle' };
    });
  }

  const instructions = workbook.addWorksheet('Instructions');
  instructions.getColumn(1).width = 25;
  instructions.getColumn(2).width = 100;
  instructions.getCell('A2').value = 'Altrixs Patient Import';
  instructions.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF27324A' } };
  instructions.mergeCells('A2:B2');
  instructions.getCell('A4').value = 'How to use';
  instructions.getCell('B4').value = 'Enter one patient per row on the Patients sheet. Keep the header names unchanged, then upload the .xlsx file from Clients > Import Excel.';
  instructions.getCell('A5').value = 'Required field';
  instructions.getCell('B5').value = 'Full Name is required. Email is recommended and must be unique.';
  instructions.getCell('A6').value = 'Create or update';
  instructions.getCell('B6').value = 'Leave Patient ID blank to create a patient. For exported records, keep Patient ID to update the same patient. If Patient ID is blank and Email matches an existing patient, that patient is updated.';
  instructions.getCell('A7').value = 'Dates';
  instructions.getCell('B7').value = 'Use YYYY-MM-DD for Date of Birth. Do not enter age instead of date of birth.';
  instructions.getCell('A8').value = 'Locations and clinicians';
  instructions.getCell('B8').value = 'Location must match an active clinic location name. Assigned Clinician Email must match an active staff account in the clinic.';
  instructions.getCell('A9').value = 'Blank values';
  instructions.getCell('B9').value = 'Blank optional patient fields are saved as blank. Blank Location or Assigned Clinician Email preserves the current value during updates and uses the clinic default during creates.';
  instructions.getCell('A10').value = 'Read-only columns';
  instructions.getCell('B10').value = 'Patient ID, Assigned Since, Created At, and Updated At are generated by Altrixs. Do not change them except to keep Patient ID when updating an exported record.';
  instructions.getCell('A11').value = 'Import limit';
  instructions.getCell('B11').value = `Maximum ${MAX_PATIENT_IMPORT_ROWS.toLocaleString('en-US')} patient rows and 10 MB per file.`;
  instructions.getCell('A13').value = 'Privacy warning';
  instructions.getCell('B13').value = 'This workbook may contain protected health information (PHI). Share and store it only through approved secure channels.';
  for (let rowNumber = 4; rowNumber <= 13; rowNumber += 1) {
    const label = instructions.getCell(rowNumber, 1);
    const description = instructions.getCell(rowNumber, 2);
    label.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF27324A' } };
    description.font = { name: 'Arial', size: 10, color: { argb: 'FF475569' } };
    label.alignment = { vertical: 'top', wrapText: true };
    description.alignment = { vertical: 'top', wrapText: true };
    if (rowNumber <= 11) {
      label.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      description.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
    }
  }
  instructions.getRow(13).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } };
  });

  return workbook;
}

export async function patientWorkbookBuffer(rows: PatientExportRow[] = []) {
  const workbook = await createPatientWorkbook(rows);
  return workbook.xlsx.writeBuffer();
}

export async function parsePatientWorkbook(buffer: ArrayBuffer | Uint8Array): Promise<{
  rows: PatientImportRow[];
  errors: PatientImportError[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const sheet = workbook.getWorksheet(PATIENT_SHEET_NAME) || workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: [{ row: 1, message: 'Workbook has no worksheet' }] };

  const headerMap = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    headerMap.set(normalizeHeader(cell.value), columnNumber);
  });
  const expected = new Map(PATIENT_COLUMNS.map((column) => [normalizeHeader(column.header), column.key]));
  const keyToColumn = new Map<PatientColumnKey, number>();
  for (const [header, key] of expected) {
    const column = headerMap.get(header);
    if (column) keyToColumn.set(key, column);
  }
  if (!keyToColumn.has('name')) {
    return { rows: [], errors: [{ row: 1, field: 'Full Name', message: 'Missing required Full Name column' }] };
  }

  const rows: PatientImportRow[] = [];
  const errors: PatientImportError[] = [];
  const get = (row: ExcelJS.Row, key: PatientColumnKey) => {
    const column = keyToColumn.get(key);
    return column ? row.getCell(column).value : null;
  };

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const hasData = [...keyToColumn.values()].some((column) => textValue(row.getCell(column).value) !== '');
    if (!hasData) continue;
    if (rows.length >= MAX_PATIENT_IMPORT_ROWS) {
      errors.push({ row: rowNumber, message: `Import is limited to ${MAX_PATIENT_IMPORT_ROWS} patient rows` });
      break;
    }

    const name = textValue(get(row, 'name'));
    const email = nullableText(get(row, 'email'))?.toLowerCase() ?? null;
    const rawDate = parseDate(get(row, 'dateOfBirth'));
    const statusText = textValue(get(row, 'status')).toUpperCase() || 'ACTIVE';
    const riskText = textValue(get(row, 'riskLevel')).toUpperCase() || 'LOW';
    const streakText = textValue(get(row, 'checkInStreak'));
    const streak = streakText === '' ? 0 : Number(streakText);

    if (name.length < 2 || name.length > 120) errors.push({ row: rowNumber, field: 'Full Name', message: 'Full Name must be 2–120 characters' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ row: rowNumber, field: 'Email', message: 'Email is invalid' });
    if (rawDate === 'invalid') errors.push({ row: rowNumber, field: 'Date of Birth', message: 'Use a valid YYYY-MM-DD date' });
    if (!['ACTIVE', 'INACTIVE', 'DISCHARGED'].includes(statusText)) errors.push({ row: rowNumber, field: 'Status', message: 'Use ACTIVE, INACTIVE, or DISCHARGED' });
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(riskText)) errors.push({ row: rowNumber, field: 'Risk Level', message: 'Use LOW, MEDIUM, or HIGH' });
    if (!Number.isInteger(streak) || streak < 0 || streak > 100000) errors.push({ row: rowNumber, field: 'Check-in Streak', message: 'Use a whole number from 0 to 100000' });

    rows.push({
      rowNumber,
      patientId: nullableText(get(row, 'patientId')),
      name,
      email,
      phone: nullableText(get(row, 'phone')),
      dateOfBirth: rawDate === 'invalid' ? null : rawDate,
      gender: nullableText(get(row, 'gender')),
      addressLine1: nullableText(get(row, 'addressLine1')),
      addressLine2: nullableText(get(row, 'addressLine2')),
      city: nullableText(get(row, 'city')),
      state: nullableText(get(row, 'state')),
      postalCode: nullableText(get(row, 'postalCode')),
      emergencyContactName: nullableText(get(row, 'emergencyContactName')),
      emergencyContactPhone: nullableText(get(row, 'emergencyContactPhone')),
      insurancePayer: nullableText(get(row, 'insurancePayer')),
      insuranceMemberId: nullableText(get(row, 'insuranceMemberId')),
      insuranceGroupNumber: nullableText(get(row, 'insuranceGroupNumber')),
      primaryDiagnosis: nullableText(get(row, 'primaryDiagnosis')),
      primaryDiagnosisCode: nullableText(get(row, 'primaryDiagnosisCode')),
      secondaryDiagnoses: nullableText(get(row, 'secondaryDiagnoses')),
      location: nullableText(get(row, 'location')),
      assignedClinicianEmail: nullableText(get(row, 'assignedClinicianEmail'))?.toLowerCase() ?? null,
      status: statusText as ClientStatus,
      riskLevel: riskText as RiskLevel,
      checkInStreak: Number.isInteger(streak) ? streak : 0,
      image: nullableText(get(row, 'image')),
    });
  }

  if (rows.length === 0 && errors.length === 0) errors.push({ row: 2, message: 'No patient rows found' });
  return { rows, errors };
}
