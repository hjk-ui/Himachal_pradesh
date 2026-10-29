'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  History,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { HEALTHLAKE_RESOURCE_TYPES } from '@/lib/aws/healthlakeTypes';
import { PageHeader, Alert } from '@/components/ui';

type Settings = {
  enabled: boolean;
  allowPart2Sync: boolean;
  updatedAt: string | null;
  part2EnabledAt: string | null;
};

type LastRun = {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  scanned: number;
  queued: number;
  synced: number;
  deleted: number;
  failed: number;
  excluded: number;
  error: string | null;
  detail: { excluded?: Record<string, number> } | null;
};

type StatusResponse = {
  success: true;
  connected: boolean;
  code: string | null;
  message: string;
  config: {
    datastoreId: string | null;
    region: string;
    credentialMode: 'static-keys' | 'instance-role' | 'none';
    missing: string[];
    importReady: boolean;
    importMissing: string[];
    exportReady: boolean;
    exportMissing: string[];
  };
  datastore: { status: string | null; name: string | null; fhirVersion: string | null; createdAt: string | null; error: string | null } | null;
  settings: Settings;
  outbox: {
    byStatus: Record<string, number>;
    byType: Record<string, Record<string, number>>;
    recentErrors: Array<{
      resourceType: string;
      resourceId: string;
      operation: string;
      status: string;
      attempts: number;
      lastError: string | null;
      nextAttemptAt: string | null;
      updatedAt: string;
    }>;
    lastRun: LastRun | null;
  };
  setupSteps: string[];
};

type JobRow = {
  id: string;
  jobType: string;
  jobName: string;
  s3Uri: string | null;
  status: string;
  awsJobId: string | null;
  demoMode: boolean;
  createdAt: string;
};

const OUTBOX_STATUSES = ['PENDING', 'IMPORTING', 'SYNCED', 'ERROR', 'DEAD', 'DELETED'] as const;

const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  IMPORTING: 'bg-blue-100 text-blue-700',
  SYNCED: 'bg-emerald-100 text-emerald-700',
  ERROR: 'bg-amber-100 text-amber-800',
  DEAD: 'bg-rose-100 text-rose-700',
  DELETED: 'bg-slate-100 text-slate-500',
};

const EXCLUDE_LABELS: Record<string, string> = {
  part2_client: 'Part 2 client (whole record held back)',
  part2_content: 'Part 2 content (SUD diagnosis / medication / note)',
  part2_reason_codes_dropped: 'Visits with SUD reason codes removed',
  note_not_signed: 'Unsigned notes (never sent)',
  assessment_not_mapped: 'Assessments without a certain LOINC code',
};

function fmt(ts: string | null | undefined) {
  return ts ? new Date(ts).toLocaleString() : '—';
}

export default function HealthLakePage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPart2, setConfirmPart2] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, jobRes] = await Promise.all([
        apiJson<StatusResponse>('/api/healthlake/status'),
        apiJson<{ success: true; jobs: JobRow[] }>('/api/healthlake/jobs'),
      ]);
      setStatus(st);
      setJobs(jobRes.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load HealthLake');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (key: string, url: string, init: RequestInit, done: (res: Record<string, unknown>) => string) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await apiJson<Record<string, unknown>>(url, init);
      setNotice(done(res));
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = (patch: Partial<Settings> & { confirmPart2?: boolean }) =>
    act('settings', '/api/healthlake/settings', { method: 'PATCH', body: JSON.stringify(patch) }, () => 'Settings saved.');

  const connected = status?.connected === true;
  const s = status?.settings;
  const lastRun = status?.outbox.lastRun;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Data exchange"
        description={<>Sync of chart data to the practice&apos;s HealthLake data store: connection, outbox, sync runs and jobs.</>}
        actions={<>
          <div className="flex flex-wrap items-center gap-2">
          {status && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
                connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {connected ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {connected ? 'CONNECTED' : 'NOT CONNECTED'}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        </>}
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{notice}</div>}

      {loading && !status ? (
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 animate-spin" size={18} /> Loading…
        </div>
      ) : status ? (
        <>
          {!connected && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={18} />
                <div className="min-w-0 space-y-3 text-sm text-amber-900">
                  <p className="font-semibold">{status.message}</p>
                  {status.config.missing.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Missing configuration</p>
                      <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                        {status.config.missing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Setup steps (docs/healthlake-setup.md)</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs">
                      {status.setupSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                  <p className="text-xs">No FHIR data is shown or sent until a data store is connected.</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-slate-500">
                <Database size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Data store</span>
              </div>
              <dl className="space-y-1 text-xs text-slate-600">
                <div>
                  <dt className="inline font-semibold">Id: </dt>
                  <dd className="inline break-all font-mono">{status.config.datastoreId || 'not set'}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Region: </dt>
                  <dd className="inline">{status.config.region}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Credentials: </dt>
                  <dd className="inline">
                    {status.config.credentialMode === 'instance-role'
                      ? 'EC2 instance role'
                      : status.config.credentialMode === 'static-keys'
                        ? 'Static keys'
                        : 'none'}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Status: </dt>
                  <dd className="inline">{status.datastore?.status || (status.config.datastoreId ? 'unknown' : '—')}</dd>
                </div>
                {status.datastore?.name && (
                  <div>
                    <dt className="inline font-semibold">Name: </dt>
                    <dd className="inline">{status.datastore.name}</dd>
                  </div>
                )}
                {status.datastore?.error && <p className="text-rose-700">{status.datastore.error}</p>}
              </dl>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="mb-2 flex items-center gap-2 text-slate-500">
                <ShieldAlert size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Sync settings</span>
              </div>
              <label className="flex items-center justify-between gap-2 text-sm text-slate-800">
                <span>Sync this organization</span>
                <input
                  type="checkbox"
                  checked={!!s?.enabled}
                  disabled={busy === 'settings'}
                  onChange={(e) => void saveSettings({ enabled: e.target.checked })}
                />
              </label>
              <label className="mt-3 flex items-center justify-between gap-2 text-sm text-slate-800">
                <span>Send 42 CFR Part 2 records</span>
                <input
                  type="checkbox"
                  checked={!!s?.allowPart2Sync}
                  disabled={busy === 'settings'}
                  onChange={(e) => {
                    if (e.target.checked) setConfirmPart2(true);
                    else void saveSettings({ allowPart2Sync: false });
                  }}
                />
              </label>
              <p className="mt-2 text-[11px] leading-snug text-slate-500">
                Off by default. While off, Part 2 clients are not sent at all and SUD diagnoses, SUD medications and Part 2
                notes are held back for everyone; anything already sent is deleted. When on, those resources are labeled
                42CFRPart2 / restricted. Protected-record clients are always labeled restricted. Unsigned notes are never sent.
              </p>
              {s?.updatedAt && <p className="mt-1 text-[11px] text-slate-500">Updated {fmt(s.updatedAt)}</p>}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-500">
                  <History size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wide">Last sync run</span>
                </div>
                <button
                  type="button"
                  disabled={!connected || !s?.enabled || busy === 'sync'}
                  title={!connected ? 'HealthLake is not connected' : !s?.enabled ? 'Turn on sync first' : undefined}
                  onClick={() =>
                    void act('sync', '/api/healthlake/sync', { method: 'POST' }, (r) => {
                      const sum = r.summary as LastRun | undefined;
                      return sum ? `Sync ${sum.status}: ${sum.synced} written, ${sum.deleted} deleted, ${sum.failed} failed.` : 'Sync finished.';
                    })
                  }
                  className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
                >
                  {busy === 'sync' ? 'Running…' : 'Run now'}
                </button>
              </div>
              {lastRun ? (
                <div className="space-y-1 text-xs text-slate-600">
                  <p>
                    <span className={`rounded px-1.5 py-0.5 font-bold ${STATUS_TONE[lastRun.status === 'SUCCESS' ? 'SYNCED' : lastRun.status === 'PARTIAL' ? 'ERROR' : lastRun.status === 'FAILED' ? 'DEAD' : 'PENDING']}`}>
                      {lastRun.status}
                    </span>{' '}
                    {lastRun.trigger} · {fmt(lastRun.startedAt)}
                  </p>
                  <p>
                    Scanned {lastRun.scanned} · queued {lastRun.queued} · written {lastRun.synced} · deleted {lastRun.deleted} · failed {lastRun.failed} · held back {lastRun.excluded}
                  </p>
                  {lastRun.detail?.excluded && Object.keys(lastRun.detail.excluded).length > 0 && (
                    <ul className="list-disc pl-4 text-[11px] text-slate-500">
                      {Object.entries(lastRun.detail.excluded).map(([k, v]) => (
                        <li key={k}>
                          {EXCLUDE_LABELS[k] || k}: {v}
                        </li>
                      ))}
                    </ul>
                  )}
                  {lastRun.error && <p className="text-rose-700">{lastRun.error}</p>}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No sync has run yet.</p>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Sync outbox</h2>
              <div className="flex flex-wrap gap-1.5">
                {OUTBOX_STATUSES.map((k) => (
                  <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[k]}`}>
                    {k} {status.outbox.byStatus[k] ?? 0}
                  </span>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-semibold">Resource</th>
                    {OUTBOX_STATUSES.map((k) => (
                      <th scope="col" key={k} className="px-3 py-2 text-right font-semibold">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {HEALTHLAKE_RESOURCE_TYPES.map((t) => (
                    <tr key={t}>
                      <td className="px-4 py-1.5 font-medium text-slate-800">{t}</td>
                      {OUTBOX_STATUSES.map((k) => (
                        <td key={k} className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                          {status.outbox.byType[t]?.[k] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {status.outbox.recentErrors.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Recent errors</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {status.outbox.recentErrors.map((e) => (
                  <div key={`${e.resourceType}/${e.resourceId}`} className="px-5 py-2.5 text-xs">
                    <p className="font-mono text-slate-800">
                      {e.operation} {e.resourceType}/{e.resourceId}{' '}
                      <span className={`ml-1 rounded px-1.5 py-0.5 font-sans font-bold ${STATUS_TONE[e.status]}`}>{e.status}</span>
                    </p>
                    <p className="mt-0.5 text-slate-600">{e.lastError}</p>
                    <p className="mt-0.5 text-slate-500">
                      Attempts {e.attempts} · updated {fmt(e.updatedAt)}
                      {e.nextAttemptAt ? ` · next try ${fmt(e.nextAttemptAt)}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Bulk load and export jobs</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!connected || !status.config.importReady || !s?.enabled || busy === 'import'}
                  title={!status.config.importReady ? `Needs ${status.config.importMissing.join(', ')}` : undefined}
                  onClick={() =>
                    void act('import', '/api/healthlake/import', { method: 'POST' }, (r) => `Import job started for ${r.resourceCount} resources.`)
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  <Upload size={12} /> {busy === 'import' ? 'Starting…' : 'Bulk initial load'}
                </button>
                <button
                  type="button"
                  disabled={!connected || !status.config.exportReady || busy === 'export'}
                  title={!status.config.exportReady ? `Needs ${status.config.exportMissing.join(', ')}` : undefined}
                  onClick={() => void act('export', '/api/healthlake/export', { method: 'POST' }, () => 'Export job started.')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Download size={12} /> {busy === 'export' ? 'Starting…' : 'Export'}
                </button>
              </div>
            </div>
            {jobs.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">No jobs.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <div key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                        job.jobType === 'import' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {job.jobType}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{job.jobName}</p>
                      <p className="truncate text-xs text-slate-500">{job.s3Uri}</p>
                    </div>
                    {job.demoMode ? (
                      <span
                        className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700"
                        title="Recorded by the old demo mode. No AWS job ran and no data moved."
                      >
                        DEMO RECORD — no AWS job ran
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-600">{job.status}</span>
                    )}
                    <span className="text-xs text-slate-500">{fmt(job.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {confirmPart2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xs">
            <h3 className="text-lg font-semibold text-slate-900">Send 42 CFR Part 2 records?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Substance use disorder records of Part 2 clients, SUD diagnoses and medications, and Part 2 progress notes will be
              written to HealthLake, labeled 42CFRPart2, no-redisclosure and restricted. Confirm only if the practice&apos;s Part 2
              policy and the AWS agreement cover this storage.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmPart2(false);
                  void saveSettings({ allowPart2Sync: true, confirmPart2: true });
                }}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white"
              >
                Confirm and turn on
              </button>
              <button
                type="button"
                onClick={() => setConfirmPart2(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
