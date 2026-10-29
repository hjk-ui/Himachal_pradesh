import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import {
  DOC_CODE_INSTRUMENT_MAP,
  INSTRUMENT_GROUPS,
  STANDALONE_INSTRUMENT_MAP,
  classifyMeasurement,
  groupFor,
  mapCategory,
  measurementHeaderOk,
  normalizeDataType,
  normalizeUnits,
  parseMeasurementTypeRecords,
  planMeasurementTypeImport,
  summarizeMeasurementTypes,
  toRow,
  unitsDisplay,
  type ExistingMeasurementType,
} from '../src/lib/migration/valantMeasurementTypes';
import { measureDisplay, recordableAsMeasure, validateMeasureValue } from '../src/lib/clinical/measures';
import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';

const HEADER = ['Name', 'Documentation Code', 'Category', 'Data Type', 'Default Units', 'Status'];

// Rows as they appear in Valant's Measurement Types grid export (definitions only)
const ROWS: string[][] = [
  HEADER,
  ['ACE score', '', 'Other', 'Integer Number', '', 'Active'],
  ['ASRS V1.1', '', 'Other', 'Integer Number', '', 'Active'],
  ['ASRS V1.1', '', 'Other', 'Integer Number', '', 'Active'],
  ['ASRS V1.1 Part A', '', 'Other', 'Integer Number', '', 'Active'],
  ['Blood Pressure', 'BP', 'Vital Sign', 'Blood Pressure', 'mm[Hg]', 'Active'],
  ['BMI', 'BMI', 'Vital Sign', 'B M I', 'kg/m2', 'Active'],
  ['Diastolic Blood Pressure', 'DBP', 'Vital Sign', 'Real Number', 'mm[Hg]', 'Active'],
  ['Fasting Blood Glucose', 'FASTING_GLUCOSE', 'Vital Sign', 'Real Number', 'mg/dL', 'Active'],
  ['GAD-7 Score', 'GAD7', 'Other', 'Real Number', '', 'Active'],
  ['Heart Rate', 'PULSE', 'Vital Sign', 'Real Number', '/min', 'Active'],
  ['Height', 'height', 'Vital Sign', 'Length Height', 'in', 'Active'],
  ['NIDA-Modifed ASSIST Prescription Opioids SI', '', 'Other', 'Integer Number', '', 'Active'],
  ['NIDA-Modified ASSIST Cannabis SI', '', 'Other', 'Integer Number', '', 'Active'],
  ['PCL-C', '', 'Other', 'Integer Number', '', 'Active'],
  ['PCL5 - Arousal', '', 'Other', 'Integer Number', '', 'Active'],
  ['PCL5 - Total', '', 'Other', 'Integer Number', '', 'Active'],
  ['PHQ-9 Score', 'PHQ9', 'Other', 'Real Number', '', 'Active'],
  ['Respiration Rate', 'Respiration', 'Vital Sign', 'Integer Number', 'breaths per minute', 'Active'],
  ['Respiration Rate', 'Respiration', 'Vital Sign', 'Integer Number', 'breaths per minute', 'Active'],
  ['SCARED-parent_Panic/Significant Somatic Symptoms', '', 'Other', 'Integer Number', '', 'Active'],
  ['Sheehan', '', 'Other', 'Integer Number', '', 'Active'],
  ['Sheehan - Work/School', '', 'Other', 'Integer Number', '', 'Active'],
  ['Smoking Status', 'SMOKING', 'Other', 'Smoking Status', '', 'Active'],
  ['Systolic Blood Pressure', 'SBP', 'Vital Sign', 'Real Number', 'mm[Hg]', 'Active'],
  ['UNCOPE Score', '', 'Other', 'Real Number', '', 'Active'],
  ['Waist Circumference', 'WAIST', 'Vital Sign', 'Real Number', 'in', 'Active'],
  ['Weight', 'weight', 'Vital Sign', 'Mass Weight', 'lb', 'Active'],
  ['WHO-5 Percentage Score', '', 'Other', 'Real Number', '', 'Active'],
  ['WHO-5 Raw Score', '', 'Other', 'Real Number', '', 'Active'],
  ['WHODAS 2.0 12-item sum score', '', 'Other', 'Integer Number', '', 'Active'],
  ['WHODAS 2.0 Self-Care Raw', '', 'Other', 'Integer Number', '', 'Active'],
];

test('header check', () => {
  assert.equal(measurementHeaderOk(HEADER), true);
  assert.equal(measurementHeaderOk(['name', ' Documentation  Code ', 'category', 'data type', 'default units', 'status']), true);
  assert.equal(measurementHeaderOk(['Name', 'Code', 'Category']), false);
  assert.equal(measurementHeaderOk(undefined), false);
  const p = parseMeasurementTypeRecords([['PatientName1', 'ServiceDate11'], ['a', 'b']]);
  assert.equal(p.headerOk, false);
  assert.equal(p.types.length, 0);
});

test('data types, units and categories normalize', () => {
  assert.equal(normalizeDataType('Integer Number'), 'integer');
  assert.equal(normalizeDataType('Real Number'), 'real');
  assert.equal(normalizeDataType('Blood Pressure'), 'blood_pressure');
  assert.equal(normalizeDataType('B M I'), 'bmi');
  assert.equal(normalizeDataType('Length Height'), 'length');
  assert.equal(normalizeDataType('Mass Weight'), 'mass');
  assert.equal(normalizeDataType('Smoking Status'), 'smoking_status');
  assert.equal(normalizeDataType('Free Text'), null);

  assert.deepEqual(normalizeUnits('mm[Hg]'), { code: 'mm[Hg]', known: true });
  assert.deepEqual(normalizeUnits('breaths per minute'), { code: '/min', known: true });
  assert.deepEqual(normalizeUnits('in'), { code: '[in_i]', known: true });
  assert.deepEqual(normalizeUnits('lb'), { code: '[lb_av]', known: true });
  assert.deepEqual(normalizeUnits(''), { code: null, known: true });
  assert.deepEqual(normalizeUnits('furlongs'), { code: 'furlongs', known: false });
  assert.equal(unitsDisplay('mm[Hg]'), 'mmHg');
  assert.equal(unitsDisplay('kg/m2'), 'kg/m²');
  assert.equal(unitsDisplay('/min', 'respiratoryRate'), 'breaths/min');
  assert.equal(unitsDisplay('/min', 'heartRate'), 'beats/min');
  assert.equal(unitsDisplay('[lb_av]'), 'lb');

  assert.equal(mapCategory('Vital Sign'), 'vital_sign');
  assert.equal(mapCategory('Other'), 'other');
  assert.equal(mapCategory('Lab Result'), 'lab_result');
});

test('parse dedupes identical rows and reports them', () => {
  const p = parseMeasurementTypeRecords(ROWS);
  assert.equal(p.headerOk, true);
  assert.equal(p.rows, ROWS.length - 1);
  assert.equal(p.types.length, ROWS.length - 1 - 2);
  assert.deepEqual(p.duplicates, [
    { name: 'ASRS V1.1', lines: [3, 4] },
    { name: 'Respiration Rate', lines: [19, 20] },
  ]);
  assert.deepEqual(p.errors, []);
  const bp = p.types.find((t) => t.name === 'Blood Pressure')!;
  assert.equal(bp.dataType, 'blood_pressure');
  assert.equal(bp.defaultUnits, 'mm[Hg]');
  assert.equal(bp.category, 'vital_sign');
  assert.equal(bp.vitalField, 'bloodPressure');
  // Same name but a different data type is a different definition
  const p2 = parseMeasurementTypeRecords([HEADER, ['X', '', 'Other', 'Integer Number', '', 'Active'], ['X', '', 'Other', 'Real Number', '', 'Active']]);
  assert.equal(p2.types.length, 2);
  assert.equal(p2.duplicates.length, 0);
});

test('bad rows are reported, not guessed', () => {
  const p = parseMeasurementTypeRecords([
    HEADER,
    ['', 'X', 'Other', 'Integer Number', '', 'Active'],
    ['Thing', '', 'Other', 'Free Text', '', 'Active'],
    ['Odd units', '', 'Other', 'Real Number', 'furlongs', 'Inactive'],
    ['', '', '', '', '', ''],
  ]);
  assert.equal(p.rows, 3);
  assert.equal(p.types.length, 1);
  assert.equal(p.types[0].active, false);
  assert.equal(p.types[0].defaultUnits, 'furlongs');
  assert.deepEqual(p.errors.map((e) => e.line), [2, 3, 4]);
});

test('grouping uses the explicit prefix table', () => {
  assert.equal(groupFor('PCL5 - Arousal')?.group, 'PCL-5');
  assert.equal(groupFor('PCL-C B Items')?.group, 'PCL-C');
  assert.equal(groupFor('NIDA-Modifed ASSIST Prescription Opioids SI')?.group, 'NIDA-Modified ASSIST');
  assert.equal(groupFor('SCARED-parent_Panic/Significant Somatic Symptoms')?.group, 'SCARED-Parent');
  assert.equal(groupFor('SCARED-child')?.group, 'SCARED-Child');
  assert.equal(groupFor('Sheehan - Work/School')?.group, 'Sheehan Disability Scale');
  assert.equal(groupFor('MDQ 2')?.group, 'MDQ');
  assert.equal(groupFor('WHODAS 2.0 Total Raw')?.group, 'WHODAS 2.0');
  assert.equal(groupFor('WHO-5 Raw Score')?.group, 'WHO-5');
  assert.equal(groupFor('BADS-SF Total'), null);
  assert.equal(groupFor('AIMSX'), null);
  assert.equal(groupFor('UNCOPE Score'), null);

  const total = classifyMeasurement('PCL5 - Total', null, 'other');
  assert.deepEqual(total, { parentInstrument: 'PCL-5', isSubscore: false, instrumentKey: 'pcl-5', vitalField: null });
  assert.equal(classifyMeasurement('PCL5 - Arousal', null, 'other').isSubscore, true);
  // ASRS: grouped, deliberately not linked to the Altrixs 6-item screener
  assert.equal(classifyMeasurement('ASRS V1.1', null, 'other').instrumentKey, null);
  assert.equal(classifyMeasurement('PHQ-9 Score', 'PHQ9', 'other').instrumentKey, 'phq-9');
  assert.equal(classifyMeasurement('GAD-7 Score', 'GAD7', 'other').instrumentKey, 'gad-7');
  assert.equal(classifyMeasurement('CAGE-AID Score', null, 'other').instrumentKey, 'cage-aid');
  assert.equal(classifyMeasurement('UNCOPE Score', null, 'other').instrumentKey, null);
});

test('every mapped Altrixs instrument exists in the assessment catalog', () => {
  const ids = new Set(ASSESSMENT_CATALOG.map((i) => i.id));
  const keys = [
    ...Object.values(STANDALONE_INSTRUMENT_MAP),
    ...Object.values(DOC_CODE_INSTRUMENT_MAP),
    ...INSTRUMENT_GROUPS.flatMap((g) => (g.instrumentKey ? [g.instrumentKey] : [])),
  ];
  for (const k of keys) assert.ok(ids.has(k), `mapping names unknown Altrixs instrument ${k}`);
  // Every declared total belongs to its own group
  for (const g of INSTRUMENT_GROUPS) for (const t of g.totals) assert.equal(groupFor(t)?.group, g.group, t);
});

test('summary: instruments, subscores, mappings, vitals', () => {
  const s = summarizeMeasurementTypes(parseMeasurementTypeRecords(ROWS).types);
  assert.equal(s.types, 29);
  assert.deepEqual(
    s.vitalsMapped.map((v) => v.field).sort(),
    ['bloodPressure', 'bmi', 'bpDiastolic', 'bpSystolic', 'heartRate', 'heightInches', 'respiratoryRate', 'weightLbs'].sort()
  );
  assert.deepEqual(s.vitalsUnmapped.sort(), ['Fasting Blood Glucose', 'Smoking Status', 'Waist Circumference']);
  const pcl5 = s.instruments.find((i) => i.group === 'PCL-5')!;
  assert.deepEqual(pcl5, { group: 'PCL-5', instrumentKey: 'pcl-5', rows: 2, subscores: 1, note: undefined });
  assert.ok(s.mappedInstrumentKeys.includes('nida-assist'));
  assert.ok(s.mappedInstrumentKeys.includes('aces'));
});

const asExisting = (rows: ReturnType<typeof toRow>[]): ExistingMeasurementType[] =>
  rows.map((r, i) => ({ id: `mt${i}`, ...r, source: 'valant' }));

test('import plan is idempotent and keeps the practice active toggle', () => {
  const { types } = parseMeasurementTypeRecords(ROWS);
  const first = planMeasurementTypeImport([], types);
  assert.equal(first.create.length, types.length);
  assert.equal(first.update.length, 0);

  // Re-import against what the first import wrote: nothing to do
  const stored = asExisting(first.create);
  const again = planMeasurementTypeImport(stored, types);
  assert.equal(again.create.length, 0);
  assert.equal(again.update.length, 0);
  assert.equal(again.unchanged.length, types.length);

  // A practice toggled one off: re-import does not touch active
  stored[0] = { ...stored[0], ...{ active: false } } as ExistingMeasurementType;
  assert.equal(planMeasurementTypeImport(stored, types).update.length, 0);

  // A mapping table change updates only the import-owned field
  stored[1] = { ...stored[1], instrumentKey: 'something-else' };
  const changed = planMeasurementTypeImport(stored, types);
  assert.equal(changed.update.length, 1);
  assert.deepEqual(changed.update[0].changed, ['instrumentKey']);

  // A Valant row no longer in the file is reported, not deleted
  const fewer = planMeasurementTypeImport(stored, types.slice(1));
  assert.deepEqual(fewer.notInFile, [stored[0].name]);
});

test('xlsx workbook rows parse the same as CSV rows', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ROWS), 'Sheet');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const read = XLSX.read(buf, { type: 'array' });
  const records = XLSX.utils
    .sheet_to_json<string[]>(read.Sheets[read.SheetNames[0]], { header: 1, raw: false, defval: '' })
    .map((r) => r.map((c) => String(c ?? '')));
  assert.deepEqual(parseMeasurementTypeRecords(records).types, parseMeasurementTypeRecords(ROWS).types);
});

test('value validation by data type', () => {
  const ok = (r: ReturnType<typeof validateMeasureValue>) => ('error' in r ? assert.fail(r.error) : r);
  assert.deepEqual(ok(validateMeasureValue({ dataType: 'blood_pressure', vitalField: 'bloodPressure' }, '120/80')), {
    ok: true, valueNumeric: 120, valueSecondary: 80, valueText: null, display: '120/80',
  });
  assert.equal(ok(validateMeasureValue({ dataType: 'blood_pressure' }, ' 118 / 76 ')).valueSecondary, 76);
  for (const bad of ['120', '120-80', '80/120', '400/80', 'abc']) {
    assert.equal(validateMeasureValue({ dataType: 'blood_pressure' }, bad).ok, false, bad);
  }
  assert.equal(ok(validateMeasureValue({ dataType: 'integer' }, '14')).valueNumeric, 14);
  assert.equal(validateMeasureValue({ dataType: 'integer' }, '14.5').ok, false);
  assert.equal(validateMeasureValue({ dataType: 'integer' }, '-1').ok, false);
  assert.equal(validateMeasureValue({ dataType: 'integer' }, '').ok, false);
  assert.equal(ok(validateMeasureValue({ dataType: 'real' }, '2.75')).valueNumeric, 2.75);
  assert.equal(validateMeasureValue({ dataType: 'real' }, '2,75').ok, false);
  // Known vital ranges
  assert.equal(validateMeasureValue({ dataType: 'integer', vitalField: 'respiratoryRate' }, '16').ok, true);
  assert.equal(validateMeasureValue({ dataType: 'integer', vitalField: 'respiratoryRate' }, '160').ok, false);
  assert.equal(validateMeasureValue({ dataType: 'real', vitalField: 'heartRate' }, '72').ok, true);
  assert.equal(validateMeasureValue({ dataType: 'real', documentationCode: 'FASTING_GLUCOSE' }, '95').ok, true);
  assert.equal(validateMeasureValue({ dataType: 'real', documentationCode: 'WAIST' }, '500').ok, false);
  assert.equal(validateMeasureValue({ dataType: 'bmi' }, '24.1').ok, true);
  assert.equal(validateMeasureValue({ dataType: 'mass' }, '0').ok, false);
  // Smoking status: SNOMED code or label from the value set only
  const smoke = ok(validateMeasureValue({ dataType: 'smoking_status' }, 'Never smoker'));
  assert.equal(smoke.valueText, '266919005');
  assert.equal(measureDisplay({ valueNumeric: null, valueSecondary: null, valueText: '266919005' }, 'smoking_status'), 'Never smoker');
  assert.equal(validateMeasureValue({ dataType: 'smoking_status' }, 'sometimes').ok, false);
  assert.equal(validateMeasureValue({ dataType: 'text' }, 'x').ok, false);
});

test('picker excludes built-in instrument totals and inactive types', () => {
  assert.equal(recordableAsMeasure({ instrumentKey: 'phq-9', isSubscore: false, active: true }), false);
  assert.equal(recordableAsMeasure({ instrumentKey: 'pcl-5', isSubscore: true, active: true }), true);
  assert.equal(recordableAsMeasure({ instrumentKey: null, isSubscore: false, active: true }), true);
  assert.equal(recordableAsMeasure({ instrumentKey: null, isSubscore: false, active: false }), false);
});
