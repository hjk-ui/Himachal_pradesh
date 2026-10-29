'use client';

import { useState } from 'react';
import { CheckCircle2, Upload, XCircle } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { formatCents, parseCsvText } from '@/lib/migration/valantReportCommon';

/**
 * Upload panel for the Valant reference-only reports (aging, insurance aging, combined aging,
 * prepayments, copays). The browser reads the file into raw cells (these reports repeat column
 * names), blanks columns the import never needs (names, phone, address), and posts the records.
 */

export type ReferenceReport = 'aging' | 'insurance-aging' | 'combined-aging' | 'prepayments' | 'copays' | 'authorizations';

type Result = Record<string, unknown>;

const CONFIG: Record<
  ReferenceReport,
  { title: string; file: string; description: string; note?: string; confirmLabel: string }
> = {
  aging: {
    title: 'Valant Patient Aging Summary',
    file: 'Patient Aging Summary.csv',
    description:
      'Upload the Patient Aging Summary export (CSV). Patients are matched by Valant ID (import Valant clients first). Each import is a snapshot for the report’s “as of” date: importing the same date again replaces it, and the newest date is shown as current.',
    confirmLabel: 'Import aging snapshot',
  },
  'insurance-aging': {
    title: 'Valant Insurance Aging Summary',
    file: 'Insurance Aging Summary.csv',
    description:
      'Upload the Insurance Aging Summary export (CSV): balance due by payer. Every payer line is kept as Valant printed it (the same name can appear for different plans). Importing the same “as of” date again replaces it.',
    confirmLabel: 'Import insurance aging',
  },
  'combined-aging': {
    title: 'Valant Combined Aging',
    file: 'Combined Aging.csv',
    description:
      'Upload the Combined Aging export (CSV): each patient’s balance split by responsible party (patient, primary, secondary payer) with the last billed date. Patients are matched by Valant ID. Phone and address columns are removed before upload and never stored.',
    confirmLabel: 'Import combined aging',
  },
  prepayments: {
    title: 'Valant Prepayments',
    file: 'Prepayments.csv',
    description:
      'Upload the Prepayments export (CSV). It has patient names only, so a row is matched only when exactly one Altrixs patient has that exact name; everything else goes to the Unmatched queue on Billing → Valant Balances. An import replaces all earlier Valant prepayment rows (patients chosen by staff are kept), so export from the earliest date you need.',
    note: 'The export only covers its date range. Prepayments received before the start date are missing, so a patient whose rows add up below zero is shown as incomplete, not as a credit.',
    confirmLabel: 'Import prepayments',
  },
  copays: {
    title: 'Valant Patient Copays',
    file: 'Patient Copays.csv',
    description:
      'Upload the Patient Copays export (CSV): copay settings per patient, payer, provider type and CPT rule. Patients are matched by Valant ID. Importing again replaces each patient’s Valant copay rules; copays entered in Altrixs and the client’s Copay field are not changed.',
    note: 'Valant’s last column (e.g. “$100” or “($9,999)”) is kept as “Valant limit (unconfirmed)” for reference only; nothing uses it.',
    confirmLabel: 'Import copays',
  },
  authorizations: {
    title: 'Valant Insurance Authorizations',
    file: 'Insurance Authorizations.csv',
    description:
      'Upload the Insurance Authorizations export (CSV). Unlike the balance reports, these become prior authorizations in Altrixs: claims use an approved auth for the payer and date of service (REF*G1). Patients are matched by Valant ID. Valant exports no CPT codes, so each auth covers any service for its payer and dates. Importing again updates the imported auths; auths entered in Altrixs are not changed. Patient name, birth date, group number and insured details are removed before upload.',
    note: 'Expired auths (Valant “!” or end date before today) are imported as Expired. Remaining visits below zero are kept and flagged over the limit.',
    confirmLabel: 'Import authorizations',
  },
};

/** Cells the import never needs, blanked in the browser before upload */
function minimizeRecords(report: ReferenceReport, records: string[][]): string[][] {
  if (!records.length) return records;
  const header = records[0].map((h) => h.trim());
  const blank = new Set<number>();
  let idNameCol = -1;
  if (report === 'aging') idNameCol = 17;
  if (report === 'combined-aging') {
    header.forEach((h, i) => {
      if (h === 'GroupDetailPhoneNumber' || h === 'GroupDetailPatientAddress') blank.add(i);
    });
    idNameCol = header.indexOf('GroupDetailPatientName');
  }
  if (report === 'copays') blank.add(6);
  if (report === 'authorizations') {
    header.forEach((h, i) => {
      if (['patientName', 'birthDate', 'groupNumber', 'insuredName', 'insuredAddress', 'insuredRelation', 'insuredPhone'].includes(h)) blank.add(i);
    });
  }
  return records.map((r, ri) => {
    if (ri === 0) return r;
    return r.map((c, i) => {
      if (blank.has(i)) return '';
      // "VALANTID: Name" -> "VALANTID:" (only the ID is used)
      if (i === idNameCol) return c.replace(/^(\s*[^:]{1,40}?\s*:)[\s\S]*$/, '$1');
      return c;
    });
  });
}

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

const num = (d: Result, k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
const cents = (d: Result, k: string) => formatCents(typeof d[k] === 'number' ? (d[k] as number) : null);

function countsFor(report: ReferenceReport, d: Result): { label: string; value: string | number }[] {
  const dry = Boolean(d.dryRun);
  switch (report) {
    case 'aging':
      return [
        { label: 'As of', value: String(d.asOf ?? '—') },
        { label: 'Patient rows', value: num(d, 'rows') },
        { label: 'Matched', value: num(d, 'matched') },
        { label: 'Unmatched Valant IDs', value: num(d, 'unmatched') },
        { label: 'Rows where buckets ≠ total', value: num(d, 'rowsWithBucketMismatch') },
        { label: 'Total', value: cents(d, 'totalSumCents') },
        { label: 'Report total', value: cents(d, 'reportTotalCents') },
        { label: dry ? 'Would replace (same as-of)' : 'Replaced (same as-of)', value: num(d, 'replacesExistingSnapshot') },
      ];
    case 'insurance-aging':
      return [
        { label: 'As of', value: String(d.asOf ?? '—') },
        { label: 'Payer rows', value: num(d, 'rows') },
        { label: 'Distinct payer names', value: num(d, 'distinctPayers') },
        { label: 'Rows where buckets ≠ total', value: num(d, 'rowsWithBucketMismatch') },
        { label: 'Total', value: cents(d, 'totalSumCents') },
        { label: 'Report total', value: cents(d, 'reportTotalCents') },
        { label: dry ? 'Would replace (same as-of)' : 'Replaced (same as-of)', value: num(d, 'replacesExistingSnapshot') },
      ];
    case 'combined-aging':
      return [
        { label: 'As of', value: String(d.asOf ?? '—') },
        { label: 'Patients', value: num(d, 'patients') },
        { label: 'Responsible-party lines', value: num(d, 'partyRows') },
        { label: 'Matched patients', value: num(d, 'matched') },
        { label: 'Unmatched Valant IDs', value: num(d, 'unmatched') },
        { label: 'Patient total', value: cents(d, 'patientTotalSumCents') },
        { label: 'Party lines total', value: cents(d, 'partyTotalSumCents') },
        { label: 'Report grand total', value: cents(d, 'reportGrandTotalCents') },
      ];
    case 'prepayments':
      return [
        { label: 'Period', value: `${d.periodStart ?? '?'} to ${d.periodEnd ?? '?'}` },
        { label: 'Rows', value: num(d, 'rows') },
        { label: 'Received / applied', value: `${num(d, 'received')} / ${num(d, 'applied')}` },
        { label: 'Matched (unique name)', value: num(d, 'matchedByUniqueName') },
        { label: 'Matched (Valant ID)', value: num(d, 'matchedByValantId') },
        { label: 'Kept staff choices', value: num(d, 'keptStaffAssignments') },
        { label: 'Unmatched rows (no patient / same name)', value: `${num(d, 'unmatchedNoClient')} / ${num(d, 'unmatchedDuplicateName')}` },
        { label: 'Distinct names / unmatched names', value: `${num(d, 'distinctNames')} / ${num(d, 'unmatchedDistinctNames')}` },
        { label: 'Patients incomplete (net below 0)', value: num(d, 'clientsIncomplete') },
        { label: 'Sum / report net', value: `${cents(d, 'sumCents')} / ${cents(d, 'reportNetCents')}` },
        { label: dry ? 'Earlier rows to replace' : 'Earlier rows replaced', value: num(d, 'existingRowsReplaced') },
      ];
    case 'copays':
      return [
        { label: 'Rules', value: num(d, 'rules') },
        { label: 'Patients / payers', value: `${num(d, 'patients')} / ${num(d, 'payers')}` },
        { label: 'Matched patients', value: num(d, 'matchedPatients') },
        { label: 'Unmatched Valant IDs', value: num(d, 'unmatchedPatients') },
        { label: dry ? 'Rules to add' : 'Rules added', value: num(d, 'rulesAdded') },
        { label: 'Rules changed / unchanged', value: `${num(d, 'rulesChanged')} / ${num(d, 'rulesUnchanged')}` },
        { label: 'Valant rules removed', value: num(d, 'valantRulesRemoved') },
        { label: 'Altrixs rules kept', value: num(d, 'altrixsRulesKept') },
        { label: 'Errors', value: num(d, 'errorRows') },
      ];
    case 'authorizations':
      return [
        { label: 'Report date', value: String(d.reportDate ?? '—') },
        { label: 'Rows / patients', value: `${num(d, 'rows')} / ${num(d, 'patients')}` },
        { label: 'Matched patients', value: num(d, 'matchedPatients') },
        { label: 'Unmatched Valant IDs', value: num(d, 'unmatchedPatients') },
        { label: dry ? 'Auths to create' : 'Auths created', value: num(d, 'created') },
        { label: dry ? 'Auths to update' : 'Auths updated', value: num(d, 'updated') },
        { label: 'Unchanged', value: num(d, 'unchanged') },
        { label: 'Approved / expired', value: `${num(d, 'approved')} / ${num(d, 'expired')}` },
        { label: 'Over the visit limit', value: num(d, 'overLimit') },
        { label: 'Errors', value: num(d, 'errorRows') },
      ];
  }
}

function reconcileFor(report: ReferenceReport, d: Result): boolean | null {
  if (report === 'copays' || report === 'authorizations') return null;
  return typeof d.reconciles === 'boolean' ? d.reconciles : null;
}

export function ValantReferenceImport({ report }: { report: ReferenceReport }) {
  const cfg = CONFIG[report];
  const [records, setRecords] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dry, setDry] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setDry(null);
    setDone(null);
    try {
      const recs = minimizeRecords(report, await readRecords(file));
      setRecords(recs);
      setFileName(file.name);
    } catch {
      setRecords([]);
      setError('Could not read the file');
    }
  };

  const run = async (dryRun: boolean) => {
    if (records.length < 2) return;
    let confirmReplace = false;
    if (!dryRun) {
      if (report === 'prepayments' && dry && num(dry, 'existingRowsReplaced') > 0) {
        const outside = num(dry, 'existingRowsOutsideNewPeriod');
        if (!confirm(`Replace the ${num(dry, 'existingRowsReplaced')} Valant prepayment rows already imported?${outside ? ` ${outside} of them fall outside this file's period and will be removed.` : ''}`)) return;
        confirmReplace = true;
      } else if (!confirm(`${cfg.confirmLabel} from ${fileName}?`)) return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<Result>(`/api/migration/${report}`, {
        method: 'POST',
        body: JSON.stringify({ platform: 'valant', dryRun, confirmReplace, records }),
      });
      if (dryRun) setDry(data);
      else setDone(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{cfg.title}</h2>
        <p className="text-xs text-slate-500">{cfg.description}</p>
        {report === 'authorizations' ? (
          <Alert tone="info" className="mt-2">
            Creates prior authorizations that claims will use. No payments or charges are created.
          </Alert>
        ) : (
          <Alert tone="brand" className="mt-2">
            Reference only — not posted to the Altrixs ledger. No payments, charges or claims are created.
          </Alert>
        )}
        {cfg.note ? <Alert tone="warning" className="mt-2">{cfg.note}</Alert> : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
        <Upload className="mb-2 text-slate-500" size={24} />
        <p className="text-sm font-semibold text-slate-900">Upload {cfg.file}</p>
        {fileName ? (
          <p className="mt-1 text-xs text-slate-500">
            {fileName} · {Math.max(0, records.length - 1)} rows
          </p>
        ) : null}
        <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
      </label>

      {records.length > 1 ? (
        <div className="flex flex-wrap gap-2">
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
            {cfg.confirmLabel}
          </button>
        </div>
      ) : null}

      {dry ? <Counts report={report} data={dry} /> : null}
      {done ? <Counts report={report} data={done} /> : null}
    </div>
  );
}

function Counts({ report, data }: { report: ReferenceReport; data: Result }) {
  const dry = Boolean(data.dryRun);
  const rec = reconcileFor(report, data);
  const unmatchedIds = Array.isArray(data.unmatchedIds) ? (data.unmatchedIds as string[]) : [];
  const errors = Array.isArray(data.errors) ? (data.errors as { line: number; error: string }[]) : [];
  return (
    <div className={`rounded-lg border px-4 py-3 ${dry ? 'border-slate-200' : 'border-emerald-200 bg-emerald-50/40'}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-900">{dry ? 'Dry run (nothing written)' : 'Import complete'}</p>
        {rec !== null ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              rec ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
            }`}
          >
            {rec ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            Totals {rec ? 'reconcile with the report' : 'do not reconcile'}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {countsFor(report, data).map((i) => (
          <div key={i.label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{i.label}</dt>
            <dd className="text-sm font-semibold text-slate-900">{i.value}</dd>
          </div>
        ))}
      </dl>
      {unmatchedIds.length ? (
        <p className="mt-2 text-xs text-slate-600">
          Valant IDs with no Altrixs patient ({unmatchedIds.length}): {unmatchedIds.slice(0, 60).join(', ')}
          {unmatchedIds.length > 60 ? '…' : ''}
        </p>
      ) : null}
      {errors.length ? (
        <ul className="mt-2 max-h-32 list-disc overflow-auto pl-5 text-xs text-rose-700">
          {errors.map((e) => (
            <li key={`${e.line}-${e.error}`}>
              Line {e.line}: {e.error}
            </li>
          ))}
        </ul>
      ) : null}
      {!dry && typeof data.jobId === 'string' ? <p className="mt-2 text-xs text-slate-500">Job {data.jobId}</p> : null}
    </div>
  );
}
