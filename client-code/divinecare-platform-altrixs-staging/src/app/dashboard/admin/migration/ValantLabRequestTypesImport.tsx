'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { parseCsvText } from '@/lib/migration/valantReportCommon';
import { VALANT_LAB_TYPES_HEADER, parseValantLabTypes, type CatalogMapping } from '@/lib/labs/catalogImport';

type Report = {
  dryRun: boolean;
  rows: number;
  errors: { line: number; error: string }[];
  orderables: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  mapping: CatalogMapping[];
  duplicatesMerged: { key: string; names: string[] }[];
  review: { valantName: string; note: string }[];
  changed: { key: string; fields: string[] }[];
  created?: number;
  updated?: number;
  jobId: string | null;
};

const RELATION_LABEL: Record<CatalogMapping['relation'], string> = { same: 'Same test', alias: 'Alias of', new: 'New test' };

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

/** Admin → EHR Migration → Import Lab Request Types (Valant DataGrid export). Dry run first. */
export function ValantLabRequestTypesImport() {
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
      const recs = (await readRecords(file)).filter((r) => r.some((c) => c.trim()));
      if (!parseValantLabTypes(recs.slice(0, 1)).headerOk) {
        setRecords([]);
        setError(`This is not the Valant lab request types export (expected header ${VALANT_LAB_TYPES_HEADER.join(', ')}).`);
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
    if (!dryRun && !confirm(`Import the lab request types from ${fileName}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiJson<Report>('/api/migration/lab-request-types', { method: 'POST', body: JSON.stringify({ platform: 'valant', dryRun, records }) });
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
        <h2 className="text-sm font-semibold text-slate-900">Valant Lab Request Types</h2>
        <p className="text-xs text-slate-500">
          Upload the lab request types grid (XLSX or CSV: Name, Is Lab Panel?, LOINC Code, Status). Each name is matched to the Altrixs lab catalog; names
          for the same test (for example &quot;Liver Function Tests (LFTs)&quot; and &quot;Hepatic Function Panel&quot;) become one orderable test with
          aliases. LOINC / CPT codes come only from the verified catalog — codes in the file are reported, not imported. Importing again changes nothing. No
          patient data. The catalog is used by{' '}
          <Link href="/dashboard/ehr/labs" className="rounded font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            EHR → Labs
          </Link>
          .
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
        <Upload className="mb-2 text-slate-500" size={24} />
        <p className="text-sm font-semibold text-slate-900">Upload lab request types (.xlsx / .csv)</p>
        {fileName ? (
          <p className="mt-1 text-xs text-slate-500">
            {fileName} · {Math.max(0, records.length - 1)} rows
          </p>
        ) : null}
        <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
      </label>

      {records.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={() => void run(true)} className={buttonClasses({ variant: 'secondary' })}>
            {busy ? 'Working…' : 'Run dry-run'}
          </button>
          <button type="button" disabled={busy || !dry} onClick={() => void run(false)} className={buttonClasses()}>
            Import lab request types
          </button>
        </div>
      ) : null}

      {dry ? <LabTypesReport r={dry} /> : null}
      {done ? <LabTypesReport r={done} /> : null}
    </div>
  );
}

function LabTypesReport({ r }: { r: Report }) {
  const stats: [string, number][] = [
    ['Rows in file', r.rows],
    ['Orderable tests', r.orderables],
    [r.dryRun ? 'New' : 'Created', r.newCount],
    [r.dryRun ? 'Changed' : 'Updated', r.changedCount],
    ['Unchanged', r.unchangedCount],
    ['Names merged as aliases', r.duplicatesMerged.reduce((n, d) => n + d.names.length - 1, 0)],
  ];
  return (
    <div className={`space-y-3 rounded-lg border px-4 py-3 ${r.dryRun ? 'border-slate-200' : 'border-emerald-200 bg-emerald-50/40'}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
        {r.dryRun ? null : <CheckCircle2 size={14} className="text-emerald-600" />}
        {r.dryRun ? 'Dry run (nothing written)' : 'Import complete'}
      </p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">Valant name</th>
              <th scope="col" className="px-3 py-2">Mapping</th>
              <th scope="col" className="px-3 py-2">Altrixs test</th>
              <th scope="col" className="px-3 py-2">CPT</th>
              <th scope="col" className="px-3 py-2">LOINC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.mapping.map((m, i) => (
              <tr key={`${m.valantName}-${i}`}>
                <td className="px-3 py-2 font-semibold text-slate-900">{m.valantName}</td>
                <td className="px-3 py-2">
                  {RELATION_LABEL[m.relation]}
                  {m.mergedWith.length ? <span className="block text-xs text-slate-500">with {m.mergedWith.join(', ')}</span> : null}
                </td>
                <td className="px-3 py-2">{m.altrixsName}</td>
                <td className="px-3 py-2 font-mono">{m.cpt ?? <span className="font-sans text-amber-700">code needed</span>}</td>
                <td className="px-3 py-2 font-mono">{m.loinc ?? <span className="font-sans text-amber-700">code needed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.review.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
            <AlertTriangle size={13} /> For review ({r.review.length})
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
            {r.review.map((n, i) => (
              <li key={`${n.valantName}-${i}`}>
                <span className="font-semibold">{n.valantName}</span>: {n.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.errors.length ? (
        <ul className="max-h-32 list-disc overflow-auto pl-5 text-xs text-rose-700">
          {r.errors.map((e) => (
            <li key={`${e.line}-${e.error}`}>
              Line {e.line}: {e.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
