'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { parseCsvText } from '@/lib/migration/valantReportCommon';
import { FEE_SCHEDULE_HEADER, parseFeeScheduleRecords } from '@/lib/billing/feeSchedule';

type Report = {
  dryRun: boolean;
  rows: number;
  items: number;
  cptItems: number;
  adminItems: number;
  insuranceBillable: number;
  notBillable: number;
  byVariant: Record<string, number>;
  needsReview: { code: string; note: string }[];
  errors: { line: number; error: string }[];
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  keptEditsCount: number;
  overwrittenEditsCount: number;
  notInFileCount: number;
  newCodes: string[];
  changed: { code: string; fields: string[]; overwritesEdit: boolean }[];
  keptEdits: { code: string; changed: string[] }[];
  notInFile: string[];
  imported?: number;
  jobId: string | null;
};

const VARIANT_LABEL: Record<string, string> = {
  standard: 'Standard',
  telehealth: 'Telehealth',
  selfPay: 'Self-pay',
  child: 'Child',
  itp: 'With ITP',
  exactOnly: 'Exact code only',
};

/** Admin → EHR Migration → Import Fee Schedule (Valant "Fees" export). Dry run first. */
export function ValantFeeScheduleImport() {
  const [records, setRecords] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [overwriteEdits, setOverwriteEdits] = useState(false);
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
      const recs = parseCsvText(await file.text());
      if (!parseFeeScheduleRecords(recs.slice(0, 1)).headerOk) {
        setRecords([]);
        setError(`This is not the Valant Fees export (expected header ${FEE_SCHEDULE_HEADER.join(', ')}).`);
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
    if (!dryRun && !confirm(`Import the fee schedule from ${fileName}?${overwriteEdits ? ' Rows edited in Altrixs will be replaced.' : ''}`)) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiJson<Report>('/api/migration/fee-schedule', {
        method: 'POST',
        body: JSON.stringify({ platform: 'valant', dryRun, overwriteEdits, records }),
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
        <h2 className="text-sm font-semibold text-slate-900">Valant Fee Schedule</h2>
        <p className="text-xs text-slate-500">
          Upload the Fees export (CSV: description, fee, Valant code, billed code). Variant flags (telehealth, self-pay, child, ITP) are derived from the
          code suffix and description and can be corrected in{' '}
          <Link href="/dashboard/billing/fee-schedule" className="rounded font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            Billing → Fee Schedule
          </Link>
          . Importing again updates Valant rows and keeps rows edited in Altrixs unless you tick &quot;overwrite edits&quot;. Codes with no billed code are
          self-pay or admin fees and are never sent to insurance. No patient data.
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
        <Upload className="mb-2 text-slate-500" size={24} />
        <p className="text-sm font-semibold text-slate-900">Upload Fees.csv</p>
        {fileName ? (
          <p className="mt-1 text-xs text-slate-500">
            {fileName} · {Math.max(0, records.length - 1)} rows
          </p>
        ) : null}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
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
            Import fee schedule
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={overwriteEdits}
              onChange={(e) => {
                setOverwriteEdits(e.target.checked);
                setDry(null);
              }}
            />
            Overwrite edits made in Altrixs
          </label>
        </div>
      ) : null}

      {dry ? <FeeReport r={dry} /> : null}
      {done ? <FeeReport r={done} /> : null}
    </div>
  );
}

function FeeReport({ r }: { r: Report }) {
  const items: [string, string | number][] = [
    ['Fee items', r.items],
    ['CPT/HCPCS / admin codes', `${r.cptItems} / ${r.adminItems}`],
    ['Insurance-billable / not billed', `${r.insuranceBillable} / ${r.notBillable}`],
    [r.dryRun ? 'New' : 'Created', r.newCount],
    [r.dryRun ? 'Changed' : 'Updated', r.changedCount],
    ['Unchanged', r.unchangedCount],
    ['Altrixs edits kept', r.keptEditsCount],
    ['Altrixs edits overwritten', r.overwrittenEditsCount],
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
        By variant: {Object.entries(r.byVariant).map(([k, v]) => `${VARIANT_LABEL[k] ?? k} ${v}`).join(' · ')}
      </p>
      {r.needsReview.length ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
            <AlertTriangle size={13} /> Flagged for review ({r.needsReview.length}) — imported as is, not corrected
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
            {r.needsReview.map((n) => (
              <li key={n.code}>
                <span className="font-mono font-semibold">{n.code}</span>: {n.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.changed.length ? (
        <p className="mt-2 text-xs text-slate-600">
          Changed: {r.changed.slice(0, 40).map((c) => `${c.code} (${c.fields.join(', ')})`).join('; ')}
          {r.changed.length > 40 ? '…' : ''}
        </p>
      ) : null}
      {r.keptEdits.length ? (
        <p className="mt-2 text-xs text-slate-600">
          Kept Altrixs edits (Valant differs): {r.keptEdits.map((c) => c.code).join(', ')}
        </p>
      ) : null}
      {r.errors.length ? (
        <ul className="mt-2 max-h-32 list-disc overflow-auto pl-5 text-xs text-rose-700">
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
