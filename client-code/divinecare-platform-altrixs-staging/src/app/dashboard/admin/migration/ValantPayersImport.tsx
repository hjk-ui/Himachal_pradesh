'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { parseCsvText } from '@/lib/migration/valantReportCommon';
import { VALANT_PAYER_HEADER, valantPayerHeaderOk } from '@/lib/billing/valantPayers';

type Report = {
  dryRun: boolean;
  rows: number;
  blankRows: number;
  payers: number;
  withEdiId: number;
  active: number;
  mergedRows: number;
  multiAddressPayers: number;
  addresses: number;
  suspectAddresses: number;
  unparsedAddresses: number;
  invalidPhones: number;
  possibleDuplicateGroups: number;
  errors: { line: number; error: string }[];
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  notInFileCount: number;
  merged: { name: string; ediPayerId: string; rows: number; addresses: number }[];
  duplicateGroups: { name: string; ediPayerId: string }[][];
  flagged: { name: string; lines: number[]; issues: string[] }[];
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

/**
 * Admin → EHR Migration → Import Insurance Companies (Valant DataGrid export). Also shown on
 * Billing → Insurance companies. Dry run first; importing again changes nothing.
 */
export function ValantPayersImport({ onImported }: { onImported?: () => void }) {
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
      if (!valantPayerHeaderOk(recs[0])) {
        setRecords([]);
        setError(`This is not the Valant insurance companies export (expected header ${VALANT_PAYER_HEADER.join(', ')}).`);
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
    if (!dryRun && !confirm(`Import the insurance companies from ${fileName}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiJson<Report>('/api/migration/valant-payers', {
        method: 'POST',
        body: JSON.stringify({ platform: 'valant', dryRun, records }),
      });
      if (dryRun) {
        setDry(d);
        setDone(null);
      } else {
        setDone(d);
        onImported?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const r = done ?? dry;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Valant Insurance Companies</h2>
        <p className="text-xs text-slate-500">
          Upload the insurance companies grid export (.xlsx: Name, Address, Tax IDs, Phone, EDI Payor Id, Active). Rows with the same name and EDI payer ID
          become one insurance company with all of its claim addresses. The Valant EDI payer ID is kept as a reference and is not copied into the Waystar
          payer IDs. The &quot;Tax IDs&quot; column is Valant&apos;s internal list and is kept as raw reference only. Review and link the results in{' '}
          <Link href="/dashboard/billing/insurance-companies" className="rounded font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            Billing → Insurance companies
          </Link>
          . Importing again updates changed companies and keeps the links you confirmed. No patient data.
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
        <Upload className="mb-2 text-slate-500" size={24} />
        <p className="text-sm font-semibold text-slate-900">Upload insurance companies export</p>
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
            Import insurance companies
          </button>
        </div>
      ) : null}

      {r ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            {done ? <CheckCircle2 size={14} className="text-emerald-600" /> : null}
            {done ? `Imported: ${done.imported ?? 0} insurance companies written` : 'Dry run (nothing saved)'}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Rows in file" value={r.rows} />
            <Stat label="Insurance companies" value={r.payers} hint={`${r.mergedRows} duplicate rows merged`} />
            <Stat label="With Valant EDI payer ID" value={r.withEdiId} />
            <Stat label="Claim addresses" value={r.addresses} hint={`${r.multiAddressPayers} companies have several`} />
            <Stat label="New" value={r.newCount} />
            <Stat label="Changed" value={r.changedCount} />
            <Stat label="Unchanged" value={r.unchangedCount} />
            <Stat label="In Altrixs, not in file" value={r.notInFileCount} hint="Kept" />
          </div>
          {r.suspectAddresses || r.invalidPhones || r.unparsedAddresses ? (
            <p className="flex items-start gap-1.5 text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {r.suspectAddresses} addresses look like placeholders, {r.unparsedAddresses} could not be split into street / city / state / ZIP, and{' '}
              {r.invalidPhones} phone numbers are not valid US numbers. They are imported as printed and flagged.
            </p>
          ) : null}
          {r.merged.length ? (
            <details>
              <summary className="cursor-pointer font-semibold">Merged rows ({r.merged.length} companies)</summary>
              <ul className="mt-1 space-y-0.5">
                {r.merged.map((m) => (
                  <li key={`${m.name}|${m.ediPayerId}`}>
                    {m.name} {m.ediPayerId ? <span className="font-mono">({m.ediPayerId})</span> : null}: {m.rows} rows → {m.addresses} addresses
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {r.duplicateGroups.length ? (
            <details>
              <summary className="cursor-pointer font-semibold">Possible duplicates to review ({r.duplicateGroups.length})</summary>
              <p className="mt-1 text-slate-500">Same name with a different EDI payer ID, or the same EDI payer ID under different names. Kept separate.</p>
              <ul className="mt-1 space-y-0.5">
                {r.duplicateGroups.map((g, i) => (
                  <li key={i}>{g.map((p) => `${p.name}${p.ediPayerId ? ` (${p.ediPayerId})` : ' (no EDI ID)'}`).join(' · ')}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {r.flagged.length ? (
            <details>
              <summary className="cursor-pointer font-semibold">Flagged addresses and phones ({r.flagged.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {r.flagged.map((f, i) => (
                  <li key={i}>
                    {f.name} (line {f.lines.join(', ')}): {f.issues.join('; ')}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {r.errors.length ? (
            <ul className="text-rose-700">
              {r.errors.slice(0, 20).map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-base font-semibold text-slate-900">{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
