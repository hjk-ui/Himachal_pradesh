'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { parseCsvText } from '@/lib/migration/valantReportCommon';
import { programLabel } from '@/lib/locations/facilityMapping';
import { FACILITY_LIST_HEADER, facilityListHeaderOk } from '@/lib/locations/valantFacilities';

type Row = {
  line: number;
  facilityName: string;
  action: 'create' | 'update' | 'unchanged';
  mapping: 'suggested' | 'kept_owner' | 'unmatched';
  changed: string[];
  kind: string;
  mappedTo: string | null;
  needsConfirmation: boolean;
  billingEntityName: string | null;
  timezone: string | null;
  active: boolean | null;
};
type Report = {
  dryRun: boolean;
  rows: number;
  counts: { create: number; update: number; unchanged: number; unmatched: number; keptOwner: number };
  duplicates: { facilityName: string; lines: number[] }[];
  errors: { line: number; error: string }[];
  facilities: Row[];
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

const ACTION_LABEL = { create: 'New', update: 'Update', unchanged: 'Unchanged' } as const;
const MAPPING_LABEL = { suggested: 'Suggested mapping applied', kept_owner: 'Your saved mapping kept', unmatched: 'No match: map it on Admin › Locations' } as const;

/** Admin → Data import → Import Facilities (Valant Setup › Facilities grid). Dry run first. */
export function ValantFacilitiesImport() {
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
      if (!facilityListHeaderOk(recs[0])) {
        setRecords([]);
        setError(`This is not the Valant facility list (expected header ${FACILITY_LIST_HEADER.join(', ')}).`);
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
    if (!dryRun && !confirm(`Import the facilities from ${fileName}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiJson<Report>('/api/migration/facilities', {
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
        <h2 className="text-sm font-semibold text-slate-900">Valant Facilities</h2>
        <p className="text-xs text-slate-500">
          Upload the Facilities grid export (.xlsx: Facility Id, Name, Local Time Zone, Active). Each facility is saved with its billing entity
          name, time zone and active flag, and mapped to a location or program (Bowie clinic → Bowie, STM → Lexington Park, Family Practice →
          primary care, IOP, PRP). Mappings you edited are kept. Importing again changes nothing. Review on{' '}
          <Link href="/dashboard/admin/locations#mapping" className="rounded font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            Admin › Locations
          </Link>
          . No patient data.
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
        <Upload className="mb-2 text-slate-500" size={24} />
        <p className="text-sm font-semibold text-slate-900">Upload the Facilities export</p>
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
            Import facilities
          </button>
        </div>
      ) : null}

      {dry ? <FacilityReport r={dry} /> : null}
      {done ? <FacilityReport r={done} /> : null}
    </div>
  );
}

function FacilityReport({ r }: { r: Report }) {
  const items: [string, number][] = [
    ['Facilities', r.facilities.length],
    [r.dryRun ? 'New' : 'Created', r.counts.create],
    [r.dryRun ? 'Changed' : 'Updated', r.counts.update],
    ['Unchanged', r.counts.unchanged],
    ['Your mapping kept', r.counts.keptOwner],
    ['No match', r.counts.unmatched],
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
      <div className="clinic-scroll-x mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">Facility</th>
              <th scope="col" className="px-3 py-2">Billing entity</th>
              <th scope="col" className="px-3 py-2">Time zone / active</th>
              <th scope="col" className="px-3 py-2">Maps to</th>
              <th scope="col" className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.facilities.map((f) => (
              <tr key={f.facilityName}>
                <td className="px-3 py-2 font-semibold text-slate-900">{f.facilityName}</td>
                <td className="px-3 py-2">{f.billingEntityName ?? '—'}</td>
                <td className="px-3 py-2">{f.timezone ?? '—'} · {f.active === null ? '—' : f.active ? 'Active' : 'Inactive'}</td>
                <td className="px-3 py-2">
                  {f.kind === 'program' ? programLabel(f.mappedTo) : f.mappedTo}
                  {f.needsConfirmation ? <span className="ml-1 text-amber-700">(to confirm)</span> : null}
                  <span className="block text-xs text-slate-500">{MAPPING_LABEL[f.mapping]}</span>
                </td>
                <td className="px-3 py-2">
                  {ACTION_LABEL[f.action]}
                  {f.changed.length ? <span className="block text-xs text-slate-500">{f.changed.join(', ')}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.duplicates.length ? (
        <p className="mt-2 text-xs text-slate-600">Duplicates (imported once): {r.duplicates.map((d) => `${d.facilityName} (lines ${d.lines.join(', ')})`).join('; ')}</p>
      ) : null}
      {r.errors.length ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
            <AlertTriangle size={13} /> Rows to review ({r.errors.length})
          </p>
          <ul className="max-h-32 list-disc overflow-auto pl-5 text-xs text-amber-900">
            {r.errors.map((e) => (
              <li key={`${e.line}-${e.error}`}>Line {e.line}: {e.error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
