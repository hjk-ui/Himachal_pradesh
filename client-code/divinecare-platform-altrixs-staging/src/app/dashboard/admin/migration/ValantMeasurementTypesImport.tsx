'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { parseCsvText } from '@/lib/migration/valantReportCommon';
import { DATA_TYPE_LABEL, MEASUREMENT_TYPES_HEADER, measurementHeaderOk, type MeasurementDataType } from '@/lib/migration/valantMeasurementTypes';

type Report = {
  dryRun: boolean;
  rows: number;
  types: number;
  byCategory: Record<string, number>;
  byDataType: Record<string, number>;
  instruments: { group: string; instrumentKey: string | null; rows: number; subscores: number; note?: string }[];
  groupedRows: number;
  subscores: number;
  standalone: number;
  mappedRows: number;
  mappedInstrumentKeys: string[];
  instrumentTotals: number;
  scoreEntryOnly: number;
  vitalsMapped: { name: string; field: string }[];
  vitalsUnmapped: string[];
  duplicates: { name: string; lines: number[] }[];
  errors: { line: number; error: string }[];
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  notInFileCount: number;
  changed: { name: string; fields: string[] }[];
  notInFile: string[];
  imported?: number;
  jobId: string | null;
};

async function readRecords(file: File): Promise<string[][]> {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return XLSX.utils
      .sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
      .map((r) => r.map((c) => String(c ?? '')));
  }
  return parseCsvText(await file.text());
}

const CATEGORY_LABEL: Record<string, string> = { vital_sign: 'Vital sign', other: 'Other' };

/** Admin → EHR Migration → Import Measurement Types (Valant Setup › Measurement Types grid). Dry run first. */
export function ValantMeasurementTypesImport() {
  const [records, setRecords] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dry, setDry] = useState<Report | null>(null);
  const [done, setDone] = useState<Report | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setDry(null);
    setDone(null);
    try {
      const recs = await readRecords(file);
      if (!measurementHeaderOk(recs[0])) {
        setRecords([]);
        setError(`This is not the Valant Measurement Types export (expected header ${MEASUREMENT_TYPES_HEADER.join(', ')}).`);
        return;
      }
      setRecords(recs);
      setFileName(file.name);
    } catch {
      setError('Could not read the file');
    }
  };

  const run = async (dryRun: boolean) => {
    if (records.length < 2) return;
    if (!dryRun && !confirm(`Import the measurement types from ${fileName}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiJson<Report>('/api/migration/measurement-types', {
        method: 'POST',
        body: JSON.stringify({ platform: 'valant', dryRun, records }),
      });
      if (dryRun) {
        setDry(d);
        setDone(null);
      } else setDone(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Valant Measurement Types</h2>
        <p className="text-xs text-slate-500">
          Upload the Measurement Types grid export (.xlsx: Name, Documentation Code, Category, Data Type, Default Units, Status). Subscores are grouped
          under their instrument and linked to the Altrixs instrument where it is the same one; vitals are matched to the vitals fields. Importing
          again changes nothing that is already there and keeps the active toggles set in{' '}
          <Link href="/dashboard/admin/measurement-types" className="rounded font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            Admin › Measurement types
          </Link>
          . Definitions only, no patient data.
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
        <Upload className="mb-2 text-slate-500" size={24} />
        <p className="text-sm font-semibold text-slate-900">Upload the Measurement Types export</p>
        {fileName ? (
          <p className="mt-1 text-xs text-slate-500">
            {fileName} · {Math.max(0, records.length - 1)} rows
          </p>
        ) : null}
        <input type="file" accept=".xlsx,.xls,.csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
      </label>

      {records.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(true)}
            className={buttonClasses({ variant: 'secondary' })}
          >
            {busy ? 'Working…' : 'Run dry-run'}
          </button>
          <button
            type="button"
            disabled={busy || !dry}
            onClick={() => void run(false)}
            className={buttonClasses()}
          >
            Import measurement types
          </button>
        </div>
      ) : null}

      {dry ? <TypesReport r={dry} /> : null}
      {done ? <TypesReport r={done} /> : null}
    </div>
  );
}

function TypesReport({ r }: { r: Report }) {
  const items: [string, string | number][] = [
    ['Rows in file', r.rows],
    ['Measurement types', r.types],
    ['Duplicate rows (imported once)', r.duplicates.reduce((n, d) => n + d.lines.length - 1, 0)],
    [r.dryRun ? 'New' : 'Created', r.newCount],
    [r.dryRun ? 'Changed' : 'Updated', r.changedCount],
    ['Unchanged', r.unchangedCount],
    ['Instruments (grouped)', `${r.instruments.length} (${r.groupedRows} rows, ${r.subscores} subscores)`],
    ['Linked to an Altrixs instrument', `${r.mappedRows} rows · ${r.mappedInstrumentKeys.length} instruments`],
    ['Score entry only', r.scoreEntryOnly],
    ['Vitals matched / not matched', `${r.vitalsMapped.length} / ${r.vitalsUnmapped.length}`],
    ['In Altrixs, not in file (left as is)', r.notInFileCount],
  ];
  return (
    <div className={`rounded-lg border px-4 py-3 ${r.dryRun ? 'border-slate-200' : 'border-emerald-200 bg-emerald-50/40'}`}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900">
        {r.dryRun ? null : <CheckCircle2 size={14} className="text-emerald-600" />}
        {r.dryRun ? 'Dry run (nothing written)' : 'Import complete'}
      </p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-slate-600">
        By category: {Object.entries(r.byCategory).map(([k, v]) => `${CATEGORY_LABEL[k] ?? k} ${v}`).join(' · ')}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        By data type: {Object.entries(r.byDataType).map(([k, v]) => `${DATA_TYPE_LABEL[k as MeasurementDataType] ?? k} ${v}`).join(' · ')}
      </p>
      {r.duplicates.length ? (
        <p className="mt-1 text-xs text-slate-600">
          Duplicates: {r.duplicates.map((d) => `${d.name} (lines ${d.lines.join(', ')})`).join('; ')}
        </p>
      ) : null}
      <details className="mt-2 text-xs text-slate-700">
        <summary className="cursor-pointer font-semibold">Instruments ({r.instruments.length})</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {r.instruments.map((i) => (
            <li key={i.group}>
              <span className="font-semibold">{i.group}</span>: {i.rows} rows ({i.subscores} subscores) ·{' '}
              {i.instrumentKey ? `Altrixs ${i.instrumentKey}` : 'Score entry only'}
              {i.note ? <span className="text-slate-500"> · {i.note}</span> : null}
            </li>
          ))}
        </ul>
      </details>
      <details className="mt-1 text-xs text-slate-700">
        <summary className="cursor-pointer font-semibold">Vitals</summary>
        <p className="mt-1">Matched: {r.vitalsMapped.map((v) => `${v.name} → ${v.field}`).join(', ') || 'none'}</p>
        <p>No vitals field in Altrixs (recorded as measures only): {r.vitalsUnmapped.join(', ') || 'none'}</p>
      </details>
      {r.changed.length ? (
        <p className="mt-2 text-xs text-slate-600">
          Changed: {r.changed.slice(0, 40).map((c) => `${c.name} (${c.fields.join(', ')})`).join('; ')}
          {r.changed.length > 40 ? '…' : ''}
        </p>
      ) : null}
      {r.errors.length ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
            <AlertTriangle size={13} /> Rows to review ({r.errors.length})
          </p>
          <ul className="max-h-32 list-disc overflow-auto pl-5 text-xs text-amber-900">
            {r.errors.map((e) => (
              <li key={`${e.line}-${e.error}`}>
                Line {e.line}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
