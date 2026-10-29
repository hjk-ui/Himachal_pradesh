'use client';

import { useState } from 'react';
import { CheckCircle2, Upload, XCircle } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { formatCents, parseCsvText, reportMoneyToCents } from '@/lib/migration/valantReportCommon';
import {
  CATEGORY_LABEL,
  NAME_COL,
  chunkByPatient,
  isTransactionHeader,
  occurrenceNumbers,
  parseTransactionRow,
  type TransactionCategory,
} from '@/lib/migration/valantTransactions';
import {
  JOURNAL_FILTER_COLS,
  JOURNAL_HEADER,
  JOURNAL_PATIENT_ID_COL,
  isJournalHeader,
  journalOccurrenceNumbers,
  parseJournalBasis,
  parseJournalRow,
} from '@/lib/migration/valantTransactionJournal';

/**
 * Valant "Transactions" report upload (large: ~67k rows). Parsed in the browser, patient names
 * blanked, unused columns dropped, then sent in chunks of about 2,000 rows that never split a
 * patient. Reference only — nothing posts to the Altrixs ledger.
 *
 * The "Transaction Journal" export is detected by its header and merged instead: rows already stored
 * from the Transactions export gain facility / insurance, journal-only rows are added.
 */

const CHUNK = 2000;
const KEEP_COLS = 20;

type Totals = {
  dryRun: boolean;
  rows: number;
  patients: number;
  matchedPatients: number;
  unmatchedPatients: number;
  matchedRows: number;
  alreadyImported: number;
  inserted: number;
  wouldInsert: number;
  sumCents: number;
  subtotalMismatches: number;
  subtotalInconsistent: number;
  errorRows: number;
  byCategory: Record<string, { rows: number; cents: number }>;
  unmatchedIds: string[];
  errors: { line: number; error: string }[];
  minServiceDate: string | null;
  maxServiceDate: string | null;
  jobId: string | null;
  journalMatched: number;
  journalEnrich: number;
  journalAlreadyEnriched: number;
  existingNotInJournal: number;
  enriched: number;
  newByYearCategory: Record<string, { rows: number; cents: number }>;
};

const SUM_KEYS = [
  'rows', 'patients', 'matchedPatients', 'unmatchedPatients', 'matchedRows', 'alreadyImported', 'inserted', 'wouldInsert', 'sumCents',
  'subtotalMismatches', 'subtotalInconsistent', 'errorRows', 'journalMatched', 'journalEnrich', 'journalAlreadyEnriched',
  'existingNotInJournal', 'enriched',
] as const;

export function ValantTransactionsImport() {
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [occ, setOcc] = useState<number[]>([]);
  const [fileName, setFileName] = useState('');
  const [journal, setJournal] = useState(false);
  const [reportLabel, setReportLabel] = useState<string | null>(null);
  const [reportTotal, setReportTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dry, setDry] = useState<Totals | null>(null);
  const [done, setDone] = useState<Totals | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setDry(null);
    setDone(null);
    setBusy(true);
    try {
      const recs = parseCsvText(await file.text());
      if (isJournalHeader(recs[0])) {
        // Transaction Journal: no name column; the repeated report filters (except the basis) are dropped
        const blank = new Set<number>(JOURNAL_FILTER_COLS);
        const data = recs
          .slice(1)
          .filter((r) => r.some((c) => c.trim()))
          .map((r) => r.slice(0, JOURNAL_HEADER.length).map((c, i) => (blank.has(i) ? '' : c)));
        setJournal(true);
        setHeader(recs[0].slice(0, JOURNAL_HEADER.length));
        setRows(data);
        setOcc(journalOccurrenceNumbers(data.map((c) => parseJournalRow(c).row ?? null)).map((n) => Math.max(1, n)));
        setReportLabel(parseJournalBasis(data[0]?.[1]).text);
        setReportTotal(null);
        setFileName(file.name);
        return;
      }
      if (!isTransactionHeader(recs[0])) {
        setRows([]);
        setError('This is not the Valant Transactions or Transaction Journal export (the header row does not match).');
        return;
      }
      setJournal(false);
      const data = recs
        .slice(1)
        .filter((r) => r.some((c) => c.trim()))
        .map((r) => r.slice(0, KEEP_COLS).map((c, i) => (i === NAME_COL ? '' : c)));
      setHeader(recs[0].slice(0, KEEP_COLS));
      setRows(data);
      setOcc(occurrenceNumbers(data.map((c) => parseTransactionRow(c).row ?? null)).map((n) => Math.max(1, n)));
      setReportLabel(data[0]?.[0]?.trim() || null);
      setReportTotal(reportMoneyToCents(data[0]?.[7] ?? ''));
      setFileName(file.name);
    } catch {
      setError('Could not read the file');
    } finally {
      setBusy(false);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!rows.length) return;
    const ask = journal
      ? `Merge the Transaction Journal (${rows.length.toLocaleString()} rows) from ${fileName}? Matching rows gain facility and insurance; the rest are added. Running it again changes nothing.`
      : `Import ${rows.length.toLocaleString()} Valant transactions from ${fileName}? Rows already imported are skipped.`;
    if (!dryRun && !confirm(ask)) return;
    setBusy(true);
    setError(null);
    const t: Totals = {
      dryRun, rows: 0, patients: 0, matchedPatients: 0, unmatchedPatients: 0, matchedRows: 0, alreadyImported: 0, inserted: 0,
      wouldInsert: 0, sumCents: 0, subtotalMismatches: 0, subtotalInconsistent: 0, errorRows: 0, byCategory: {}, unmatchedIds: [],
      errors: [], minServiceDate: null, maxServiceDate: null, jobId: null, journalMatched: 0, journalEnrich: 0, journalAlreadyEnriched: 0,
      existingNotInJournal: 0, enriched: 0, newByYearCategory: {},
    };
    let importId: string | undefined;
    const chunks = chunkByPatient(rows, CHUNK, journal ? JOURNAL_PATIENT_ID_COL : undefined);
    try {
      setProgress({ done: 0, total: rows.length });
      for (const [a, b] of chunks) {
        const d = await apiJson<Record<string, unknown>>('/api/migration/transactions', {
          method: 'POST',
          body: JSON.stringify({
            platform: 'valant', dryRun, header, rows: rows.slice(a, b), occurrences: occ.slice(a, b), rowOffset: a,
            jobId: t.jobId ?? undefined, importId,
          }),
        });
        const n = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
        for (const k of SUM_KEYS) t[k] += n(k);
        for (const [field, target] of [['byCategory', t.byCategory], ['newByYearCategory', t.newByYearCategory]] as const) {
          for (const [cat, v] of Object.entries((d[field] as Totals['byCategory']) ?? {})) {
            const c = (target[cat] ??= { rows: 0, cents: 0 });
            c.rows += v.rows;
            c.cents += v.cents;
          }
        }
        if (Array.isArray(d.unmatchedIds)) t.unmatchedIds.push(...(d.unmatchedIds as string[]));
        if (Array.isArray(d.errors) && t.errors.length < 50) t.errors.push(...(d.errors as Totals['errors']));
        const lo = d.minServiceDate as string | null;
        const hi = d.maxServiceDate as string | null;
        if (lo && (!t.minServiceDate || lo < t.minServiceDate)) t.minServiceDate = lo;
        if (hi && (!t.maxServiceDate || hi > t.maxServiceDate)) t.maxServiceDate = hi;
        if (typeof d.jobId === 'string') t.jobId = d.jobId;
        if (typeof d.importId === 'string') importId = d.importId;
        setProgress({ done: b, total: rows.length });
      }
      if (dryRun) setDry({ ...t });
      else setDone({ ...t });
    } catch (err: unknown) {
      setError(
        `${err instanceof Error ? err.message : 'Import failed'}${dryRun ? '' : '. Rows already imported are skipped, so you can run the import again to continue.'}`
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Valant Transactions / Transaction Journal</h2>
        <p className="text-xs text-slate-500">
          Upload the Transactions export (CSV): every charge, payment and adjustment. Patients are matched by Valant ID (ChartNumber); import Valant
          clients first. Patient names are removed before upload. Importing the same file again skips rows already stored, so a stopped import can be
          resumed. Large files are sent in parts. The Transaction Journal export is detected automatically and merged: rows already stored gain
          facility and insurance, and only rows not already stored are added (no double counting).
        </p>
        <Alert tone="brand" className="mt-2">
          Reference only — not posted to the Altrixs ledger. No payments, charges or claims are created.
        </Alert>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
        <Upload className="mb-2 text-slate-500" size={24} />
        <p className="text-sm font-semibold text-slate-900">Upload Transactions.csv or Transaction Journal.csv</p>
        {fileName ? (
          <p className="mt-1 text-xs text-slate-500">
            {journal ? 'Transaction Journal · ' : ''}
            {fileName} · {rows.length.toLocaleString()} rows{reportLabel ? ` · ${reportLabel}` : ''}
            {journal ? '' : ` · report total ${formatCents(reportTotal)}`}
          </p>
        ) : null}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
      </label>

      {rows.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void run(true)} className={buttonClasses({ variant: 'secondary' })}>
            {busy ? 'Working…' : 'Run dry-run'}
          </button>
          <button type="button" disabled={busy || !dry} onClick={() => void run(false)} className={buttonClasses()}>
            {journal ? 'Merge journal' : 'Import transactions'}
          </button>
        </div>
      ) : null}

      {progress ? (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {progress.done.toLocaleString()} / {progress.total.toLocaleString()} rows
          </p>
        </div>
      ) : null}

      {dry ? (journal ? <JournalCounts t={dry} /> : <TxnCounts t={dry} reportTotal={reportTotal} />) : null}
      {done ? (journal ? <JournalCounts t={done} /> : <TxnCounts t={done} reportTotal={reportTotal} />) : null}
    </div>
  );
}

function TxnCounts({ t, reportTotal }: { t: Totals; reportTotal: number | null }) {
  const totalOk = reportTotal !== null && reportTotal === t.sumCents;
  const items: [string, string | number][] = [
    ['Rows', t.rows.toLocaleString()],
    ['Service dates', `${t.minServiceDate ?? '?'} to ${t.maxServiceDate ?? '?'}`],
    ['Patients', t.patients.toLocaleString()],
    ['Matched / unmatched patients', `${t.matchedPatients} / ${t.unmatchedPatients}`],
    [t.dryRun ? 'New rows to store' : 'Rows stored', (t.dryRun ? t.wouldInsert : t.inserted).toLocaleString()],
    ['Already imported (skipped)', t.alreadyImported.toLocaleString()],
    ['Sum of amounts / report total', `${formatCents(t.sumCents)} / ${formatCents(reportTotal)}`],
    ['Patient subtotal mismatches', t.subtotalMismatches + t.subtotalInconsistent],
    ['Errors', t.errorRows],
  ];
  return (
    <div className={`rounded-lg border px-4 py-3 ${t.dryRun ? 'border-slate-200' : 'border-emerald-200 bg-emerald-50/40'}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-900">{t.dryRun ? 'Dry run (nothing written)' : 'Import complete'}</p>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${totalOk && t.subtotalMismatches === 0 ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'}`}>
          {totalOk && t.subtotalMismatches === 0 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          Totals {totalOk && t.subtotalMismatches === 0 ? 'reconcile with the report' : 'do not reconcile'}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="clinic-scroll-x mt-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2 text-left">Category</th>
            <th scope="col" className="px-3 py-2 text-right">Rows</th>
            <th scope="col" className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Object.entries(t.byCategory).map(([cat, v]) => (
            <tr key={cat}>
              <td className="px-3 py-2">{CATEGORY_LABEL[cat as TransactionCategory] ?? cat}</td>
              <td className="px-3 py-2 text-right tabular-nums">{v.rows.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCents(v.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {t.unmatchedIds.length ? (
        <p className="mt-2 text-xs text-slate-600">
          Valant IDs with no Altrixs patient ({t.unmatchedIds.length}): {t.unmatchedIds.slice(0, 60).join(', ')}
          {t.unmatchedIds.length > 60 ? '…' : ''}
        </p>
      ) : null}
      {t.errors.length ? (
        <ul className="mt-2 max-h-32 list-disc overflow-auto pl-5 text-xs text-rose-700">
          {t.errors.map((e) => (
            <li key={`${e.line}-${e.error}`}>
              Line {e.line}: {e.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function JournalCounts({ t }: { t: Totals }) {
  const enrich = t.dryRun ? t.journalEnrich : t.enriched;
  const added = t.dryRun ? t.wouldInsert : t.inserted;
  const items: [string, string | number][] = [
    ['Rows', t.rows.toLocaleString()],
    ['Service dates', `${t.minServiceDate ?? '?'} to ${t.maxServiceDate ?? '?'}`],
    ['Patients', t.patients.toLocaleString()],
    ['Matched / unmatched patients', `${t.matchedPatients} / ${t.unmatchedPatients}`],
    ['Matched stored rows', t.journalMatched.toLocaleString()],
    [t.dryRun ? 'Rows to enrich' : 'Rows enriched', enrich.toLocaleString()],
    ['Already enriched (unchanged)', t.journalAlreadyEnriched.toLocaleString()],
    [t.dryRun ? 'New rows to add' : 'Rows added', added.toLocaleString()],
    ['Added by an earlier journal import (skipped)', t.alreadyImported.toLocaleString()],
    ['Stored rows of these patients not in the journal (untouched)', t.existingNotInJournal.toLocaleString()],
    ['Sum of journal amounts', formatCents(t.sumCents)],
    ['Errors', t.errorRows],
  ];
  const years = Object.entries(t.newByYearCategory).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    <div className={`rounded-lg border px-4 py-3 ${t.dryRun ? 'border-slate-200' : 'border-emerald-200 bg-emerald-50/40'}`}>
      <p className="mb-1 text-xs font-semibold text-slate-900">{t.dryRun ? 'Dry run (nothing written)' : 'Merge complete'}</p>
      <p className="mb-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900">
        Transaction Journal detected — {t.dryRun ? 'will enrich' : 'enriched'} {enrich.toLocaleString()} existing rows with facility/insurance and{' '}
        {t.dryRun ? 'add' : 'added'} {added.toLocaleString()} rows.
      </p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      {years.length ? (
        <div className="clinic-scroll-x mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">New rows: service year</th>
              <th scope="col" className="px-3 py-2 text-left">Category</th>
              <th scope="col" className="px-3 py-2 text-right">Rows</th>
              <th scope="col" className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {years.map(([key, v]) => {
              const [year, cat] = key.split('|');
              return (
                <tr key={key}>
                  <td className="px-3 py-2">{year === 'none' ? 'No date' : year}</td>
                  <td className="px-3 py-2">{CATEGORY_LABEL[cat as TransactionCategory] ?? cat}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.rows.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(v.cents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      ) : null}
      {t.unmatchedIds.length ? (
        <p className="mt-2 text-xs text-slate-600">
          Valant IDs with no Altrixs patient ({t.unmatchedIds.length}): {t.unmatchedIds.slice(0, 60).join(', ')}
          {t.unmatchedIds.length > 60 ? '…' : ''}
        </p>
      ) : null}
      {t.errors.length ? (
        <ul className="mt-2 max-h-32 list-disc overflow-auto pl-5 text-xs text-rose-700">
          {t.errors.map((e) => (
            <li key={`${e.line}-${e.error}`}>
              Line {e.line}: {e.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
