'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Shield,
  Upload,
  Users,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { apiJson } from '@/lib/api-client';
import { PLATFORMS, type MigrationPlatform } from '@/lib/migration/platforms';

type Tab = 'clients' | 'staff' | 'history';

type HistoryJob = {
  id: string;
  type?: string;
  kind?: string;
  status?: string;
  platform?: string | null;
  sourcePlatform?: string | null;
  dryRun?: boolean;
  total?: number;
  imported?: number;
  errors?: number;
  createdCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  createdAt?: string;
  summary?: string | null;
  errorJson?: unknown;
  sections?: Array<{ kind: string; created: number; updated: number; skipped: number }>;
};

const STEPS = ['Select platform', 'Upload CSV', 'Preview & dry-run', 'Import'] as const;

function canMigrate(role?: string | null) {
  return role === 'PRACTICE_DIRECTOR' || role === 'ADMIN';
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export default function MigrationPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = canMigrate(user?.role);

  const [tab, setTab] = useState<Tab>('clients');
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<MigrationPlatform | null>(null);
  const [showAllPlatforms, setShowAllPlatforms] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [dryResult, setDryResult] = useState<Record<string, unknown> | null>(null);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [staffRows, setStaffRows] = useState<Record<string, string>[]>([]);
  const [staffFile, setStaffFile] = useState('');
  const [staffResult, setStaffResult] = useState<Record<string, unknown> | null>(null);

  const [history, setHistory] = useState<HistoryJob[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const data = await apiJson<{ success: true; jobs?: HistoryJob[]; history?: HistoryJob[] }>(
        '/api/migration/history'
      );
      setHistory(data.jobs || data.history || []);
    } catch (err: unknown) {
      setHistory([]);
      setHistoryError(
        err instanceof Error
          ? err.message
          : 'Migration history API not available yet'
      );
    }
  }, []);

  useEffect(() => {
    if (tab === 'history' && allowed) void loadHistory();
  }, [tab, allowed, loadHistory]);

  const previewRows = useMemo(() => rows.slice(0, 8), [rows]);

  const onClientFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setDryResult(null);
    setImportResult(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    setFileName(file.name);
    if (parsed.length) setStep(2);
  };

  const runClientDry = async () => {
    if (!platform || !rows.length) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<Record<string, unknown>>('/api/migration/clients', {
        method: 'POST',
        body: JSON.stringify({
          platform: platform.id,
          sourcePlatform: platform.id,
          dryRun: true,
          rows,
        }),
      });
      setDryResult(data);
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dry-run failed (API may still be deploying)');
    } finally {
      setBusy(false);
    }
  };

  const runClientImport = async () => {
    if (!platform || !rows.length) return;
    if (!confirm(`Import ${rows.length} client rows from ${platform.label}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<Record<string, unknown>>('/api/migration/clients', {
        method: 'POST',
        body: JSON.stringify({
          platform: platform.id,
          sourcePlatform: platform.id,
          dryRun: false,
          rows,
        }),
      });
      setImportResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const onStaffFile = async (file: File | null) => {
    if (!file) return;
    setStaffResult(null);
    setError(null);
    const text = await file.text();
    setStaffRows(parseCsv(text));
    setStaffFile(file.name);
  };

  const runStaffImport = async (dryRun: boolean) => {
    if (!staffRows.length) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<Record<string, unknown>>('/api/migration/staff', {
        method: 'POST',
        body: JSON.stringify({ dryRun, rows: staffRows }),
      });
      setStaffResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Staff import failed');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
        <Shield className="mx-auto mb-3 text-rose-500" size={28} />
        <h1 className="text-lg font-bold text-rose-900">Admin access required</h1>
        <p className="mt-2 text-sm text-rose-700">
          EHR data migration is limited to Practice Director and Clinic Admin.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-200">
            <Shield size={12} /> HIPAA
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">EHR Data Migration</h1>
        <p className="mt-1 text-sm text-slate-500">
          Import clients and staff from your previous EHR. Dry-run first, then commit to Postgres.
        </p>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <p className="font-bold">Business Associate Agreement (BAA)</p>
        <p className="mt-1 text-xs leading-relaxed text-blue-800/90">
          Uploaded CSV files may contain PHI. Use only on a secure clinic workstation. Altrixs processes
          migration data under your organization&apos;s BAA. Do not email PHI exports. Prefer dry-run
          before a live import. Temporary staff passwords are issued as INVITED accounts.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {(
          [
            { id: 'clients' as const, label: 'Import Clients', icon: Users },
            { id: 'staff' as const, label: 'Import Staff', icon: Upload },
            { id: 'history' as const, label: 'Import History', icon: History },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition sm:flex-none sm:px-4 ${
              tab === t.id
                ? 'bg-[#5C2D91] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {tab === 'clients' ? (
        <div className="space-y-5">
          <ol className="flex flex-wrap gap-2">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                  i === step
                    ? 'bg-[#5C2D91] text-white'
                    : i < step
                      ? 'bg-purple-100 text-[#5C2D91]'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px]">
                  {i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>

          {step === 0 || !platform ? (
            <div>
              <p className="mb-3 text-sm font-semibold text-slate-700">
                Choose your previous EHR platform
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(showAllPlatforms
                  ? PLATFORMS
                  : PLATFORMS.filter((p) => p.popular)
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPlatform(p);
                      setStep(1);
                      setRows([]);
                      setDryResult(null);
                      setImportResult(null);
                    }}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-purple-300 hover:shadow-md"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="text-sm font-bold text-slate-900">{p.label}</span>
                      {p.popular ? (
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
                          Popular
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">{p.note}</p>
                    <p className="mt-2 text-[11px] font-medium text-slate-400">{p.exportHint}</p>
                  </button>
                ))}
              </div>
              {!showAllPlatforms ? (
                <button
                  type="button"
                  className="mt-4 text-sm font-semibold text-[#5C2D91] hover:underline"
                  onClick={() => setShowAllPlatforms(true)}
                >
                  Show all 10 platforms →
                </button>
              ) : (
                <button
                  type="button"
                  className="mt-4 text-sm font-semibold text-slate-500 hover:underline"
                  onClick={() => setShowAllPlatforms(false)}
                >
                  Show popular only
                </button>
              )}
            </div>
          ) : null}

          {platform && step >= 1 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {platform.label}
                    <button
                      type="button"
                      className="ml-2 text-xs font-semibold text-[#5C2D91] hover:underline"
                      onClick={() => {
                        setPlatform(null);
                        setStep(0);
                      }}
                    >
                      Change
                    </button>
                  </p>
                  <p className="text-xs text-slate-500">{platform.exportHint}</p>
                </div>
              </div>

              {step === 1 || (step >= 1 && !rows.length) ? (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center hover:border-[#5C2D91]/40">
                  <FileSpreadsheet className="mb-2 text-slate-400" size={28} />
                  <p className="text-sm font-bold text-slate-800">Upload client CSV</p>
                  <p className="mt-1 text-xs text-slate-500">Parsed in your browser — PHI stays local until import</p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => void onClientFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              ) : null}

              {rows.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">
                    <span className="font-bold text-slate-900">{rows.length}</span> rows from{' '}
                    <span className="font-semibold">{fileName}</span>
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-400">
                        <tr>
                          {Object.keys(previewRows[0] || {})
                            .slice(0, 8)
                            .map((h) => (
                              <th key={h} className="px-3 py-2">
                                {h}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {previewRows.map((row, i) => (
                          <tr key={i}>
                            {Object.keys(previewRows[0] || {})
                              .slice(0, 8)
                              .map((h) => (
                                <td key={h} className="max-w-[140px] truncate px-3 py-2 text-slate-700">
                                  {row[h]}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runClientDry()}
                      className="rounded-xl border border-[#5C2D91] px-4 py-2 text-xs font-bold text-[#5C2D91] hover:bg-purple-50 disabled:opacity-50"
                    >
                      Run dry-run
                    </button>
                    <button
                      type="button"
                      disabled={busy || !dryResult}
                      onClick={() => void runClientImport()}
                      className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                      style={{ background: '#5C2D91' }}
                    >
                      Import clients
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRows([]);
                        setFileName('');
                        setDryResult(null);
                        setImportResult(null);
                        setStep(1);
                      }}
                      className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                    >
                      Clear file
                    </button>
                  </div>

                  {dryResult ? (
                    <ResultBox title="Dry-run result" data={dryResult} />
                  ) : null}
                  {importResult ? (
                    <ResultBox title="Import result" data={importResult} success />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'staff' ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Bulk staff import</p>
              <p className="text-xs text-slate-500">
                Creates INVITED users with temporary passwords. Download the CSV template first.
              </p>
            </div>
            <a
              href="/api/migration/template/staff"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-white"
            >
              <Download size={14} />
              Staff template
            </a>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center hover:border-[#5C2D91]/40">
            <Upload className="mb-2 text-slate-400" size={24} />
            <p className="text-sm font-bold text-slate-800">Upload staff CSV</p>
            {staffFile ? (
              <p className="mt-1 text-xs text-slate-500">
                {staffFile} · {staffRows.length} rows
              </p>
            ) : null}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void onStaffFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {staffRows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runStaffImport(true)}
                className="rounded-xl border border-[#5C2D91] px-4 py-2 text-xs font-bold text-[#5C2D91]"
              >
                Dry-run
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runStaffImport(false)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-white"
                style={{ background: '#5C2D91' }}
              >
                Import staff
              </button>
            </div>
          ) : null}

          {staffResult ? <ResultBox title="Staff import" data={staffResult} /> : null}
        </div>
      ) : null}

      {tab === 'history' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-900">Import history</p>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="text-xs font-bold text-[#5C2D91] hover:underline"
            >
              Refresh
            </button>
          </div>
          {historyError ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{historyError}</p>
          ) : null}
          {!history.length && !historyError ? (
            <p className="py-8 text-center text-sm text-slate-500">No migration jobs yet</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {history.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {j.kind || j.type || 'Import'} · {j.sourcePlatform || j.platform || '—'}
                      {j.dryRun ? ' (dry-run)' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {j.createdAt ? new Date(j.createdAt).toLocaleString() : '—'} ·{' '}
                      {j.status || 'done'}
                      {j.summary ? ` · ${j.summary}` : ''}
                    </p>
                  </div>
                  <div className="text-xs text-slate-600">
                    {(j.sections || []).map((section) => (
                      <p key={section.kind}>
                        {section.kind}: created {section.created}, updated {section.updated}, skipped {section.skipped}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ResultBox({
  title,
  data,
  success,
}: {
  title: string;
  data: Record<string, unknown>;
  success?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-xs ${
        success
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
    >
      <p className="mb-1 flex items-center gap-1.5 font-bold">
        {success ? <CheckCircle2 size={14} /> : null}
        {title}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
