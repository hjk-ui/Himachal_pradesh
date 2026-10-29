'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Database,
  Download,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { HEALTHLAKE_RESOURCE_TYPES } from '@/lib/aws/healthlakeTypes';

type StatusResponse = {
  success: true;
  demoMode: boolean;
  datastoreId: string | null;
  status: string;
  datastoreName: string;
  fhirVersion: string;
  resourceCounts: Record<string, number>;
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

export default function HealthLakePage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState('FHIR bundle import');
  const [importUri, setImportUri] = useState('s3://example-bucket/fhir-import/');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

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

  const submitImport = async () => {
    setImportBusy(true);
    setImportMsg(null);
    try {
      const res = await apiJson<{ success: true; job: JobRow; demoMode: boolean }>(
        '/api/healthlake/import',
        {
          method: 'POST',
          body: JSON.stringify({ jobName: importName, s3Uri: importUri }),
        }
      );
      setImportMsg(
        res.demoMode
          ? `Demo import recorded (${res.job.id}). No AWS job was submitted.`
          : `Import submitted: ${res.job.awsJobId || res.job.id}`
      );
      setShowImport(false);
      await refresh();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const submitExport = async () => {
    setExportBusy(true);
    setImportMsg(null);
    try {
      const res = await apiJson<{ success: true; job: JobRow; demoMode: boolean }>(
        '/api/healthlake/export',
        {
          method: 'POST',
          body: JSON.stringify({
            jobName: `export-${new Date().toISOString().slice(0, 10)}`,
            s3Uri: 's3://example-bucket/fhir-export/',
          }),
        }
      );
      setImportMsg(
        res.demoMode
          ? `Demo export recorded (${res.job.id}).`
          : `Export submitted: ${res.job.awsJobId || res.job.id}`
      );
      await refresh();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">AWS HealthLake FHIR R4</h1>
          <p className="mt-1 text-sm text-slate-500">
            Datastore status, resource counts, and import/export jobs for practice directors and admins.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status?.demoMode && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              DEMO MODE
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
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {importMsg && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {importMsg}
        </div>
      )}

      {loading && !status ? (
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 animate-spin" size={18} /> Loading datastore…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-slate-500">
                <Database size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Datastore</span>
              </div>
              <p className="text-sm font-semibold text-slate-900">{status?.datastoreName}</p>
              <p className="mt-1 text-xs text-slate-500">
                Status: <strong>{status?.status}</strong> · FHIR {status?.fhirVersion}
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {status?.datastoreId || 'AWS_HEALTHLAKE_DATASTORE_ID unset'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-500">
                  <Activity size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wide">Resource counts</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowImport(true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-bold text-white"
                  >
                    <Upload size={12} /> Import
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    onClick={() => void submitExport()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Download size={12} /> {exportBusy ? 'Exporting…' : 'Export'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {HEALTHLAKE_RESOURCE_TYPES.map((type) => (
                  <Link
                    key={type}
                    href={`/dashboard/ehr/healthlake?resource=${type}`}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 hover:border-[#C7CBF5]"
                  >
                    <p className="text-[11px] font-semibold text-slate-500">{type}</p>
                    <p className="text-lg font-bold text-slate-900">
                      {status?.resourceCounts?.[type] ?? 0}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Import / export jobs</h2>
            </div>
            {jobs.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">No jobs yet. Start an import to persist a HealthLakeJob.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {jobs.map((job) => (
                  <div key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        job.jobType === 'import'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {job.jobType}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{job.jobName}</p>
                      <p className="truncate text-xs text-slate-400">{job.s3Uri}</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">{job.status}</span>
                    {job.demoMode && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        DEMO
                      </span>
                    )}
                    <span className="text-xs text-slate-400">
                      {new Date(job.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Start FHIR import</h3>
            <p className="mt-1 text-xs text-slate-500">
              Calls POST /api/healthlake/import (persists HealthLakeJob). Demo when datastore ID unset.
            </p>
            <label className="mt-4 block text-xs font-semibold text-slate-600">
              Job name
              <input
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              S3 URI
              <input
                value={importUri}
                onChange={(e) => setImportUri(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
              />
            </label>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={importBusy || !importName.trim() || !importUri.trim()}
                onClick={() => void submitImport()}
                className="flex-1 rounded-xl bg-[#5C2D91] py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {importBusy ? 'Submitting…' : 'Submit import'}
              </button>
              <button
                type="button"
                onClick={() => setShowImport(false)}
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
