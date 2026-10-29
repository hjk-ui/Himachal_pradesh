'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileArchive, Loader2, Play, RefreshCw, Repeat, Terminal, Upload } from 'lucide-react';
import { Alert, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { multipartPartSize } from '@/lib/migration/valantDocumentsUpload';

type Counts = {
  entries?: number;
  files?: number;
  totalBytes?: number;
  processed?: number;
  junk?: number;
  looseFiles?: number;
  byType?: Record<string, number>;
  byExtension?: Record<string, number>;
  dated?: number;
  documents?: number;
  filed?: number;
  needsReview?: number;
  duplicates?: number;
  unreadable?: number;
  unreadableByReason?: Record<string, number>;
  unsupported?: number;
  tooLarge?: number;
  alreadyImported?: number;
  refiled?: number;
  codeMismatch?: number;
  extractedWith7z?: number;
  filedByNestedFolder?: number;
  filedByFileCode?: number;
  billingArchived?: number;
  refiledByFolder?: number;
  refiledByNestedFolder?: number;
  refiledByFileCode?: number;
  rearchivedBilling?: number;
  folders?: {
    total: number;
    matched: number;
    matchedById: number;
    matchedByCode?: number;
    matchedByNameDob: number;
    matchedByNameOnly: number;
    needsReview: number;
    unmatched: number;
    nestedMatched?: number;
  };
};

type FolderRow = { folder: string; files: number; reason: string; candidates: number };
type Report = {
  phase?: string;
  wrapperDepth?: number;
  maxDepth?: number;
  archiveBytes?: number;
  foldersNeedingReview?: FolderRow[];
  foldersUnmatched?: FolderRow[];
  unreadable?: string[];
  unreadableByReason?: Record<string, string[]>;
  unsupported?: string[];
  warnings?: string[];
  firstRunCounts?: Counts | null;
  allowNameOnly?: boolean;
  ocrForSearch?: boolean;
};

type Batch = {
  id: string;
  status: string;
  sourceKind: string;
  fileName: string | null;
  fileSize: number | null;
  phase: string | null;
  counts: Counts;
  report: Report;
  error: string | null;
  ocrForSearch: boolean;
  stale: boolean;
  dryRunAt: string | null;
  appliedAt: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  uploading: 'Uploading',
  uploaded: 'Uploaded: ready for a dry run',
  dry_running: 'Dry run in progress',
  dry_run_done: 'Dry run done: review, then import',
  applying: 'Importing',
  rematching: 'Re-running with updated matching',
  done: 'Imported',
  failed: 'Failed',
};

const RUNNING = new Set(['dry_running', 'applying', 'rematching']);

/** Plain-language label for an unreadable-file reason class */
function reasonLabel(reason: string): string {
  if (reason === 'encrypted') return 'Encrypted (password-protected) in the ZIP';
  if (reason === 'zero_size') return 'Empty file (0 bytes)';
  if (reason === 'not_pdf_or_image') return 'Content is not a PDF / JPEG / PNG';
  if (reason === 'invalid_signature') return 'Damaged ZIP entry (invalid header signature)';
  if (reason === 'size_mismatch') return 'Damaged ZIP entry (size differs)';
  if (reason === 'truncated') return 'ZIP entry cut off (truncated archive)';
  if (reason === 'unsupported_compression:9') return 'Deflate64 compression (needs 7-Zip: p7zip-full)';
  if (reason.startsWith('unsupported_compression:')) return `Unsupported compression method ${reason.split(':')[1]}`;
  if (reason.startsWith('extract_7z_failed:')) return `7-Zip could not extract (exit ${reason.split(':')[1]})`;
  if (reason === 'read_error:ENOSPC') return 'Server disk full (ENOSPC)';
  return reason.replace(/^read_error:/, 'Read error: ');
}
const PARALLEL_PARTS = 4;

function fmtBytes(n: number | null | undefined) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}

/** PUT one part to its presigned URL; S3 returns the part ETag (the bucket CORS rule must expose it) */
async function putPart(url: string, blob: Blob): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: blob });
      if (!res.ok) throw new Error(`S3 returned ${res.status}`);
      const etag = res.headers.get('ETag');
      if (!etag) throw new Error('S3 did not expose the ETag header (check the bucket CORS rule)');
      return etag;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Upload failed');
}

/**
 * Admin → Data import → Valant documents (ZIP, one folder per client). The browser uploads the ZIP
 * straight to S3 in parts; the server reads it from S3 as a stream. Dry run first, then import.
 */
export function ValantDocumentsImport() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [s3Configured, setS3Configured] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [allowNameOnly, setAllowNameOnly] = useState(true);
  const [ocrForSearch, setOcrForSearch] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ s3Configured: boolean; batches: Batch[] }>('/api/migration/valant-documents');
      setS3Configured(data.s3Configured);
      setBatches(data.batches);
      setSelectedId((cur) => cur ?? data.batches[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load imports');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a run is in progress
  const anyRunning = batches.some((b) => RUNNING.has(b.status));
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [anyRunning, load]);

  const post = (body: Record<string, unknown>) =>
    apiJson<Record<string, unknown>>('/api/migration/valant-documents', { method: 'POST', body: JSON.stringify(body) });

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    cancelRef.current = false;
    try {
      // Resume an interrupted upload of the same file (same name and size)
      const resumable = batches.find((b) => b.status === 'uploading' && b.fileName === file.name && b.fileSize === file.size);
      let id: string;
      const partSize = multipartPartSize(file.size);
      const total = Math.ceil(file.size / partSize);
      const etags = new Map<number, string>();
      if (resumable) {
        id = resumable.id;
        const { parts } = (await post({ action: 'list-parts', id })) as { parts: { partNumber: number; etag: string; size: number }[] };
        for (const p of parts) {
          const expected = p.partNumber === total ? file.size - (total - 1) * partSize : partSize;
          if (p.size === expected) etags.set(p.partNumber, p.etag);
        }
      } else {
        const created = (await post({
          action: 'create',
          fileName: file.name,
          fileSize: file.size,
          options: { allowNameOnly, ocrForSearch },
        })) as { batch: Batch };
        id = created.batch.id;
      }
      setSelectedId(id);
      const todo = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !etags.has(n));
      let doneBytes = [...etags.keys()].reduce((n, p) => n + Math.min(partSize, file.size - (p - 1) * partSize), 0);
      setUploadPct(Math.round((doneBytes / file.size) * 100));

      // Sign in groups, upload a few parts at a time
      for (let i = 0; i < todo.length; i += 20) {
        if (cancelRef.current) throw new Error('Upload paused. Choose the same file again to continue.');
        const group = todo.slice(i, i + 20);
        const { urls } = (await post({ action: 'sign-parts', id, partNumbers: group })) as { urls: { partNumber: number; url: string }[] };
        const queue = [...urls];
        const worker = async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            if (cancelRef.current) return;
            const start = (next.partNumber - 1) * partSize;
            const blob = file.slice(start, Math.min(file.size, start + partSize));
            etags.set(next.partNumber, await putPart(next.url, blob));
            doneBytes += blob.size;
            setUploadPct(Math.round((doneBytes / file.size) * 100));
          }
        };
        await Promise.all(Array.from({ length: PARALLEL_PARTS }, worker));
      }
      if (cancelRef.current) throw new Error('Upload paused. Choose the same file again to continue.');
      await post({
        action: 'complete',
        id,
        parts: [...etags.entries()].map(([partNumber, etag]) => ({ partNumber, etag })),
      });
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      await load();
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  };

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await post(body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const selected = batches.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <FileArchive className="mt-0.5 h-5 w-5 text-blue-600" aria-hidden />
          <div>
            <h2 className="text-base font-semibold text-slate-900">Valant documents (ZIP)</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              The Valant export with one folder per client (progress notes, intake, consents, receipts, discharge, measures,
              labs, ID, demographics, addenda, other). Folders that match a client exactly (the folder name is the Valant client
              code, a Valant ID / MRN, full name + date of birth, or a full name unique in the practice) are filed to that chart as read-only records. Everything else goes to
              Smart Document Intake for review. Re-running never duplicates a document. Text extraction (OCR) is not run.
            </p>
          </div>
        </div>

        {s3Configured === false ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <p className="flex items-center gap-1.5 font-semibold">
              <Terminal size={14} /> Browser upload is not available on this server (no S3 bucket configured)
            </p>
            <p className="mt-1">Copy the ZIP to the server (or to S3 with the AWS CLI), then run:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-white/70 p-2 font-mono text-xs">
              npx tsx scripts/import-valant-documents.ts --zip /path/to/export.zip --org ORG_ID --user YOUR_EMAIL{'\n'}
              npx tsx scripts/import-valant-documents.ts --batch BATCH_ID --org ORG_ID --user YOUR_EMAIL --apply
            </pre>
            <p className="mt-1">Batches started from the command line appear below with their reports.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
              {file ? <span className="text-xs text-slate-500">{fmtBytes(file.size)}</span> : null}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={allowNameOnly} onChange={(e) => setAllowNameOnly(e.target.checked)} disabled={busy} />
              File a folder by full name alone when exactly one client in the practice has that name (no ID or date of birth in the folder)
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={ocrForSearch} onChange={(e) => setOcrForSearch(e.target.checked)} disabled={busy} />
              Mark for text extraction later (search). Off by default: OCR is billed per page
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!file || busy}
                onClick={() => void upload()}
                className={buttonClasses()}
              >
                {busy && uploadPct !== null ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload ZIP
              </button>
              {uploadPct !== null ? (
                <>
                  <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-blue-600" style={{ width: `${uploadPct}%` }} />
                  </div>
                  <span className="text-xs text-slate-600">{uploadPct}%</span>
                  <button type="button" onClick={() => (cancelRef.current = true)} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                    Pause
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}

      {batches.length ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Imports</h2>
            <button type="button" onClick={() => void load()} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              <RefreshCw size={14} aria-hidden /> Refresh
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {batches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                aria-pressed={b.id === selectedId}
                className={`flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${b.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                <span className="min-w-0 font-semibold text-slate-900">
                  {b.fileName || (b.sourceKind === 'local' ? 'Server file' : 'Upload')} · {fmtBytes(b.fileSize)}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(b.createdAt).toLocaleString()} · {STATUS_LABEL[b.status] ?? b.status}
                  {b.stale ? ' (stopped)' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selected ? <BatchDetail batch={selected} busy={busy} onAct={act} /> : null}
    </div>
  );
}

function BatchDetail({ batch, busy, onAct }: { batch: Batch; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<void> }) {
  const c = batch.counts ?? {};
  const r = batch.report ?? {};
  const f = c.folders;
  const running = RUNNING.has(batch.status);
  const pct = c.files ? Math.min(100, Math.round(((c.processed ?? 0) / c.files) * 100)) : 0;
  const applyDone = batch.status === 'done';
  const rerun = batch.phase === 'rematch';
  const first = r.firstRunCounts ?? null;

  const stat = (label: string, value: number | string | undefined, tone = 'text-slate-900') => (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className={`text-lg font-semibold ${tone}`}>{value ?? '—'}</p>
    </div>
  );

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{STATUS_LABEL[batch.status] ?? batch.status}</h2>
          {batch.error ? <p className="mt-0.5 text-xs text-rose-700">{batch.error}</p> : null}
          {batch.ocrForSearch ? <p className="mt-0.5 text-xs text-slate-500">Marked for text extraction later</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {['uploaded', 'dry_run_done'].includes(batch.status) || (batch.status === 'failed' && batch.phase === 'dry_run') ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAct({ action: 'dry-run', id: batch.id })}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <Play size={13} /> {batch.status === 'uploaded' ? 'Run dry run' : 'Run dry run again'}
            </button>
          ) : null}
          {batch.status === 'dry_run_done' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Import ${c.documents ?? 0} documents? ${c.filed ?? 0} will be filed to charts as read-only records and ${c.needsReview ?? 0} will go to Smart Document Intake for review.`
                  )
                ) {
                  void onAct({ action: 'apply', id: batch.id, confirm: true });
                }
              }}
              className={buttonClasses({ size: 'sm' })}
            >
              <CheckCircle2 size={13} /> Approve and import
            </button>
          ) : null}
          {batch.status === 'done' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Re-run this import with the updated matching? Documents in the review queue that now match exactly (client folder, nested client-code folder, or client code in the file name) are filed to that chart (read-only, audited); practice billing records (ERA exceptions, claims, remittance, EOB) move to the Valant billing archive; files that could not be read before are imported. Nothing already imported is duplicated.'
                  )
                ) {
                  void onAct({ action: 'rematch', id: batch.id, confirm: true });
                }
              }}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <Repeat size={13} /> Re-run with updated matching
            </button>
          ) : null}
          {(running && batch.stale) || (batch.status === 'failed' && (batch.phase === 'apply' || batch.phase === 'rematch')) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAct({ action: 'resume', id: batch.id })}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <RefreshCw size={13} /> Resume
            </button>
          ) : null}
        </div>
      </div>

      {running ? (
        <div className="flex items-center gap-3">
          <Loader2 size={14} className="animate-spin text-blue-700" />
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-slate-600">
            {c.processed ?? 0} / {c.files ?? '…'} files
          </span>
        </div>
      ) : null}

      {r.warnings?.length ? (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {r.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      ) : null}

      {c.files !== undefined ? (
        <>
          {rerun ? (
            <p className="text-xs text-slate-600">
              Re-run with updated matching: {c.refiled ?? 0} review-queue documents filed to charts, {c.documents ?? 0} new documents,{' '}
              {c.alreadyImported ?? 0} already imported (skipped).
              {first ? ` First import: ${first.documents ?? 0} documents (${first.filed ?? 0} filed, ${first.needsReview ?? 0} to review), ${first.unreadable ?? 0} unreadable.` : ''}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {stat('Files', c.files)}
            {stat('Total size', fmtBytes(c.totalBytes))}
            {stat(rerun ? 'New documents (re-run)' : applyDone ? 'Documents imported' : 'Documents to import', c.documents)}
            {stat(applyDone ? 'Filed to charts' : 'Would file to charts', c.filed, 'text-emerald-700')}
            {stat('To review in Document Intake', c.needsReview, 'text-amber-700')}
            {c.filedByNestedFolder ? stat('Filed by nested client-code folder', c.filedByNestedFolder, 'text-emerald-700') : null}
            {c.filedByFileCode ? stat('Filed by client code in file name', c.filedByFileCode, 'text-emerald-700') : null}
            {c.billingArchived ? stat('Practice billing archive (no client)', c.billingArchived) : null}
            {rerun
              ? stat(
                  'Review queue → filed (re-run)',
                  `${c.refiled ?? 0} (folder ${c.refiledByFolder ?? 0} · nested ${c.refiledByNestedFolder ?? 0} · file code ${c.refiledByFileCode ?? 0})`,
                  'text-emerald-700'
                )
              : null}
            {rerun && c.rearchivedBilling ? stat('Review queue → billing archive (re-run)', c.rearchivedBilling) : null}
            {c.alreadyImported ? stat('Already imported (skipped)', c.alreadyImported) : null}
            {stat('Duplicates skipped', c.duplicates)}
            {stat('Unreadable', c.unreadable, c.unreadable ? 'text-rose-700' : undefined)}
            {stat('Not PDF / image (skipped)', c.unsupported)}
            {c.codeMismatch ? stat('File code differs from folder (to review)', c.codeMismatch, 'text-amber-700') : null}
            {c.extractedWith7z ? stat('Read with 7-Zip (Deflate64)', c.extractedWith7z) : null}
          </div>

          {c.unreadableByReason && Object.keys(c.unreadableByReason).length ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">Unreadable files by reason</p>
              <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">Reason</th>
                    <th scope="col" className="px-3 py-2 text-right">Files</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(c.unreadableByReason)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, n]) => (
                      <tr key={reason}>
                        <td className="px-3 py-2 text-slate-700">{reasonLabel(reason)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">{n}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : null}

          {f ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">Client folders</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {stat('Folders', f.total)}
                {stat(
                  'Matched',
                  `${f.matched} (ID ${f.matchedById}${f.matchedByCode ? `, of which client code ${f.matchedByCode}` : ''} · name+DOB ${f.matchedByNameDob} · name ${f.matchedByNameOnly})`,
                  'text-emerald-700'
                )}
                {stat('Needs review', f.needsReview, 'text-amber-700')}
                {stat('No match', f.unmatched, f.unmatched ? 'text-rose-700' : undefined)}
                {f.nestedMatched ? stat('Client-code folders nested in unmatched folders', f.nestedMatched, 'text-emerald-700') : null}
              </div>
            </div>
          ) : null}

          {c.byType && Object.keys(c.byType).length ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">Documents by type</p>
              <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">Document type</th>
                    <th scope="col" className="px-3 py-2 text-right">Documents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(c.byType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([t, n]) => (
                      <tr key={t}>
                        <td className="px-3 py-2 text-slate-700">{t}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">{n}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {c.dated ?? 0} with a date in the file name · {c.looseFiles ?? 0} outside a client folder · {c.tooLarge ?? 0} over 100 MB (skipped)
                {c.byExtension ? ` · extensions: ${Object.entries(c.byExtension).map(([e, n]) => `${e} ${n}`).join(', ')}` : ''}
              </p>
            </div>
          ) : null}

          <FolderList title="Folders needing review (masked)" rows={r.foldersNeedingReview} />
          <FolderList title="Folders with no matching client (masked)" rows={r.foldersUnmatched} />
          {r.unreadableByReason && Object.keys(r.unreadableByReason).length ? (
            Object.entries(r.unreadableByReason).map(([reason, rows]) => (
              <PathList key={reason} title={`Unreadable: ${reasonLabel(reason)} (masked, first ${rows.length})`} rows={rows} />
            ))
          ) : (
            <PathList title="Unreadable files (masked)" rows={r.unreadable} />
          )}
          <PathList title="Skipped: not PDF / JPEG / PNG (masked)" rows={r.unsupported} />
          <p className="text-xs text-slate-500">
            Labels are masked (letters X/x, digits #); the real names are reviewed in Smart Document Intake after the import.
          </p>
        </>
      ) : null}
    </div>
  );
}

function FolderList({ title, rows }: { title: string; rows?: FolderRow[] }) {
  if (!rows?.length) return null;
  return (
    <details className="rounded-lg border border-slate-200">
      <summary className="cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
        {title}: {rows.length}
      </summary>
      <div className="clinic-scroll-x overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2 text-left">Folder</th>
            <th scope="col" className="px-3 py-2 text-left">Reason</th>
            <th scope="col" className="px-3 py-2 text-right">Files</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="px-3 py-2 font-mono text-slate-700">{row.folder}</td>
              <td className="px-3 py-2 text-slate-600">{row.reason}</td>
              <td className="px-3 py-2 text-right text-slate-500">{row.files} files</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </details>
  );
}

function PathList({ title, rows }: { title: string; rows?: string[] }) {
  if (!rows?.length) return null;
  return (
    <details className="rounded-lg border border-slate-200">
      <summary className="cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
        {title}: {rows.length}
      </summary>
      <ul className="max-h-64 overflow-y-auto px-3 py-2 font-mono text-xs text-slate-600">
        {rows.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </details>
  );
}
