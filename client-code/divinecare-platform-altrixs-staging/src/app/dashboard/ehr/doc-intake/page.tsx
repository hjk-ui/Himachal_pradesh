'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText, CheckCircle2, AlertTriangle, RefreshCw,
  Sparkles, Shield, User, X, Upload, ExternalLink, Search,
  Scissors, ChevronDown, ChevronRight, Layers,
} from 'lucide-react';
import { demoToast } from '@/components/DemoActionProvider';
import { apiJson } from '@/lib/api-client';
import { formatPages } from '@/lib/docIntake/segment';
import { PageHeader, StatusBadge, type Tone, Alert } from '@/components/ui';

type DocType =
  | 'Insurance Card' | 'Lab Report' | 'Referral' | 'Court Order' | 'Prior Auth Letter'
  | 'Progress Note' | 'Treatment Plan' | 'Assessment' | 'Consent / ROI' | 'Discharge Summary'
  | 'Correspondence' | 'Unclassified'
  // Valant documents ZIP import (rule-based types)
  | 'Intake Note' | 'Addendum' | 'Measures' | 'Intake Form' | 'Patient ID' | 'Demographics'
  | 'Payment Receipt' | 'Other';

interface ExtractedField {
  label: string;
  value: string;
}

interface Candidate {
  clientId: string;
  name: string;
  dob: string;
  reason: string;
}

interface IntakeDoc {
  id: string;
  source: string;
  receivedAt: string;
  docType: DocType;
  confidence: number;
  suggestedClientId: string | null;
  suggestedClient: string | null;
  filesTo: string;
  fields: ExtractedField[];
  status: 'processing' | 'ready' | 'filed' | 'rejected' | 'split';
  fileName: string | null;
  mimeType: string | null;
  parentId: string | null;
  parentFileName: string | null;
  pageNumbers: number[];
  childCount: number;
  fileUrl: string | null;
  pageCount: number | null;
  matchStatus: string | null;
  matchReason: string | null;
  candidates: Candidate[];
  processingError: string | null;
  /** Imported record (Valant documents ZIP): no split / re-process; filed copies are read-only */
  readOnly: boolean;
}

const DOC_TYPE_CFG: Record<DocType, { tone: Tone }> = {
  'Insurance Card':     { tone: 'brand' },
  'Prior Auth Letter':  { tone: 'success' },
  'Lab Report':         { tone: 'info' },
  'Court Order':        { tone: 'warning' },
  'Referral':           { tone: 'brand' },
  'Progress Note':      { tone: 'info' },
  'Treatment Plan':     { tone: 'info' },
  'Assessment':         { tone: 'info' },
  'Consent / ROI':      { tone: 'warning' },
  'Discharge Summary':  { tone: 'info' },
  'Correspondence':     { tone: 'info' },
  'Unclassified':       { tone: 'neutral' },
  'Intake Note':        { tone: 'info' },
  'Addendum':           { tone: 'info' },
  'Measures':           { tone: 'info' },
  'Intake Form':        { tone: 'warning' },
  'Patient ID':         { tone: 'brand' },
  'Demographics':       { tone: 'brand' },
  'Payment Receipt':    { tone: 'success' },
  'Other':              { tone: 'neutral' },
};

const MATCH_LABEL: Record<string, string> = {
  matched: 'Matched (ID or name + DOB)',
  needs_review: 'Needs review',
  unmatched: 'No match found',
  staff_selected: 'Client picked by staff',
  confirmed: 'Confirmed by staff',
  valant_folder: 'Matched by Valant client folder',
};

/** "pages 3–7 of export.pdf" for a part of a split file */
function partLabel(d: IntakeDoc) {
  return `${d.pageNumbers.length === 1 ? 'page' : 'pages'} ${formatPages(d.pageNumbers)} of ${d.parentFileName || 'the original file'}`;
}

/** A processed multi-page PDF that has not been split yet */
function canSplit(d: IntakeDoc) {
  return !d.readOnly && !d.parentId && (d.status === 'ready' || d.status === 'filed') && d.mimeType === 'application/pdf' && (d.pageCount ?? 0) > 1;
}

function toDoc(d: any): IntakeDoc {
  return {
    id: d.id,
    source: d.source,
    receivedAt: new Date(d.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    docType: (d.documentType in DOC_TYPE_CFG ? d.documentType : 'Unclassified') as DocType,
    confidence: d.confidenceScore ?? 0,
    suggestedClientId: d.suggestedClientId ?? null,
    suggestedClient: d.suggestedClient?.name ?? null,
    filesTo: d.suggestedFilingPath,
    fields: Array.isArray(d.extractedFields) ? d.extractedFields : [],
    status: d.status,
    fileName: d.fileName ?? null,
    mimeType: d.mimeType ?? null,
    parentId: d.parentId ?? null,
    parentFileName: d.parentFileName ?? null,
    pageNumbers: Array.isArray(d.pageNumbers) ? d.pageNumbers : [],
    childCount: d.childCount ?? 0,
    fileUrl: d.fileUrl ?? null,
    pageCount: d.pageCount ?? null,
    matchStatus: d.matchStatus ?? null,
    matchReason: d.matchReason ?? null,
    candidates: Array.isArray(d.matchCandidates) ? d.matchCandidates : [],
    processingError: d.processingError ?? null,
    readOnly: Boolean(d.readOnly),
  };
}

export default function SmartDocIntakePage() {
  const [docs, setDocs] = useState<IntakeDoc[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [changingClient, setChangingClient] = useState<string | null>(null);
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<{ id: string; name: string; dob?: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reprocessable, setReprocessable] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ data: any[] }>('/api/ehr/doc-intake');
      if (Array.isArray(data.data)) setDocs(data.data.map(toDoc));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the intake queue');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While anything is processing, poll so text extraction can finish
  const processing = docs.some((d) => d.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [processing, load]);

  // Server-side patient search for "Change client" (the roster is too large for a dropdown)
  useEffect(() => {
    const q = clientQuery.trim();
    if (q.length < 2) {
      setClientResults([]);
      return;
    }
    const t = setTimeout(() => {
      apiJson<{ clients: { id: string; name: string; dateOfBirth?: string | null }[] }>(
        `/api/clients?q=${encodeURIComponent(q)}&limit=15`
      )
        .then((r) => setClientResults((r.clients || []).map((c) => ({ id: c.id, name: c.name, dob: c.dateOfBirth?.slice(0, 10) ?? null }))))
        .catch(() => setClientResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [clientQuery]);

  const doc = docs.find((d) => d.id === selected) || docs[0];
  const ids = new Set(docs.map((d) => d.id));
  // Parts of a split file are listed under their original
  const topLevel = docs.filter((d) => !d.parentId || !ids.has(d.parentId));
  const childrenOf = (id: string) =>
    docs.filter((d) => d.parentId === id).sort((a, b) => (a.pageNumbers[0] ?? 0) - (b.pageNumbers[0] ?? 0));

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setActionError(null);
    const failures: string[] = [];
    for (const f of Array.from(files)) {
      setUploading(f.name);
      const form = new FormData();
      form.append('file', f);
      try {
        const res = await fetch('/api/ehr/doc-intake/upload', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) failures.push(`${f.name}: ${data.error || `HTTP ${res.status}`}`);
      } catch (err) {
        failures.push(`${f.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      }
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = '';
    if (failures.length) setActionError(failures.join(' · '));
    await load();
  }

  async function postAction(body: Record<string, unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      return await apiJson<{ message?: string }>('/api/ehr/doc-intake', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the document');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function fileDoc(target: IntakeDoc) {
    if (!target.suggestedClientId) {
      setActionError('Pick a client before filing.');
      return;
    }
    const res = await postAction({
      id: target.id,
      action: 'file',
      clientId: target.suggestedClientId,
      clientName: target.suggestedClient ?? undefined,
    });
    if (!res) return;
    demoToast(res.message || 'Document filed to chart.');
    await load();
  }

  async function changeClient(target: IntakeDoc, clientId: string) {
    const res = await postAction({ id: target.id, action: 'changeClient', clientId });
    if (!res) return;
    setChangingClient(null);
    setClientQuery('');
    await load();
  }

  async function splitDoc(target: IntakeDoc) {
    const warning = target.status === 'filed'
      ? `Split ${target.fileName || 'this document'} by patient? It will be removed from ${target.suggestedClient || 'the chart'} and each part will need to be filed again.`
      : `Split ${target.fileName || 'this document'} into one document per patient? Each part still needs staff confirmation.`;
    if (!window.confirm(warning)) return;
    setReprocessable(null);
    const res = await postAction({ id: target.id, action: 'split' });
    if (!res) {
      // Older uploads may not have per-page text; offer to read the file again
      setReprocessable(target.id);
      return;
    }
    demoToast(res.message || 'Document split by patient.');
    await load();
  }

  async function reprocessDoc(target: IntakeDoc) {
    const res = await postAction({ id: target.id, action: 'reprocess' });
    if (!res) return;
    setReprocessable(null);
    demoToast(res.message || 'Reading the document again.');
    await load();
  }

  async function rejectDoc(target: IntakeDoc) {
    const res = await postAction({ id: target.id, action: 'reject' });
    if (!res) return;
    demoToast(res.message || 'Document rejected.');
    await load();
  }

  function renderRow(d: IntakeDoc, child: boolean) {
    const cfg = DOC_TYPE_CFG[d.docType];
    return (
      <button key={d.id} onClick={() => setSelected(d.id)}
        className={`w-full text-left ${child ? 'pl-8 pr-4' : 'px-4'} py-3 border-b border-slate-100 last:border-0 transition-colors ${doc?.id === d.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          {d.status === 'split' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full text-brand-700 bg-brand-50">
              <Layers className="h-3 w-3" /> Several patients
            </span>
          ) : (
            <StatusBadge tone={cfg.tone} size="sm">
              {d.status === 'processing' ? 'Processing…' : d.docType}
            </StatusBadge>
          )}
          <span className="text-[11px] text-slate-500">{d.source}</span>
          {d.status === 'filed' && <CheckCircle2 className="h-3 w-3 text-emerald-700 ml-auto" />}
          {d.status === 'rejected' && <X className="h-3 w-3 text-rose-600 ml-auto" />}
          {d.status === 'ready' && <span className="w-2 h-2 rounded-full bg-amber-400 ml-auto" />}
        </div>
        <p className="text-xs font-semibold text-slate-800 mt-1 truncate" title={d.fileName ?? undefined}>
          {d.status === 'split'
            ? d.fileName || 'Split document'
            : d.suggestedClient || (child ? 'Patient not matched' : d.fileName) || 'Unmatched'}
        </p>
        <p className="text-[11px] text-slate-500 truncate">
          {child
            ? `${d.pageNumbers.length === 1 ? 'Page' : 'Pages'} ${formatPages(d.pageNumbers)}`
            : `${d.receivedAt}${d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}` : ''}`}
        </p>
      </button>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">
      {/* Header */}
      <PageHeader
        title="Smart Document Intake"
        description={<>Upload PDFs, scans or photos. Text is read with Amazon Textract, the document type and key fields with AI, and the patient is matched by ID or name + date of birth. Staff confirm every filing.</>}
        actions={<>
          <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => void uploadFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={!!uploading}
            onClick={() => fileInput.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 disabled:opacity-60"
          >
            {uploading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? `Uploading ${uploading}…` : 'Upload PDF / Scan'}
          </button>
        </div>
        </>}
      >
        {loadError && <p className="text-xs text-rose-600 mt-1">{loadError}</p>}
      </PageHeader>

      {actionError && (
        <Alert tone="danger">{actionError}</Alert>
      )}

      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Needs Review', val: docs.filter((d) => d.status === 'ready').length, sub: 'Ready to confirm' },
          { label: 'Processing', val: docs.filter((d) => d.status === 'processing').length, sub: 'Reading text' },
          { label: 'Matched', val: docs.filter((d) => d.status === 'ready' && d.matchStatus === 'matched').length, sub: 'ID or name + DOB' },
          { label: 'Filed', val: docs.filter((d) => d.status === 'filed').length, sub: 'Staff-confirmed' },
        ].map((m, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-100 p-3.5 shadow-xs">
            <p className="text-lg font-semibold text-slate-900">{m.val}</p>
            <p className="text-xs font-semibold text-slate-600">{m.label}</p>
            <p className="text-[11px] text-slate-500">{m.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Intake queue */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-fit shadow-xs">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-700">Intake Queue</p>
            <button type="button" onClick={() => void load()} className="text-slate-500 hover:text-slate-800" title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {docs.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-slate-500">No documents yet. Upload a PDF or scan to start.</p>
          )}
          {topLevel.map((top) => {
            const kids = top.status === 'split' ? childrenOf(top.id) : [];
            const open = !collapsed.has(top.id);
            return (
              <div key={top.id}>
                {renderRow(top, false)}
                {top.status === 'split' && (
                  <button type="button"
                    onClick={() => setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(top.id)) next.delete(top.id); else next.add(top.id);
                      return next;
                    })}
                    className="w-full flex items-center gap-1.5 px-4 py-1.5 border-b border-slate-100 bg-slate-50 text-[11px] font-bold text-brand-700 hover:bg-brand-50">
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Split into {top.childCount} document{top.childCount === 1 ? '' : 's'}
                    <span className="font-semibold text-slate-500">
                      · {kids.filter((k) => k.status === 'ready' || k.status === 'processing').length} to review
                    </span>
                  </button>
                )}
                {open && kids.map((k) => renderRow(k, true))}
              </div>
            );
          })}
        </div>

        {/* Review panel */}
        <div className="lg:col-span-2 space-y-4">
          {doc && doc.status === 'processing' && (
            <div className="bg-white rounded-xl border-2 border-brand-200 p-10 text-center shadow-xs">
              <RefreshCw className="h-8 w-8 text-brand-600 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-bold text-slate-800">
                {doc.parentId ? `Classifying ${partLabel(doc)}…` : `Reading ${doc.fileName || 'the document'}…`}
              </p>
              <p className="text-xs text-slate-500 mt-1">Multi-page PDFs can take a minute. This page refreshes on its own.</p>
            </div>
          )}

          {doc && doc.status === 'split' && (
            <div className="bg-white rounded-xl border-2 border-brand-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Layers className="h-4 w-4 text-brand-600" />
                <p className="text-sm font-bold text-slate-900 flex-1 min-w-0 truncate" title={doc.fileName ?? undefined}>
                  {doc.fileName || 'Document'}
                </p>
                {doc.fileUrl && (
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:underline">
                    View original <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-600">
                This file holds records for several patients, so it was split into {doc.childCount} documents by
                patient{doc.pageCount ? ` (${doc.pageCount} pages)` : ''}. The original is never filed to a chart.
                File each part below; each is filed as a PDF of only its own pages.
              </p>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {childrenOf(doc.id).map((k) => (
                  <button key={k.id} type="button" onClick={() => setSelected(k.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-xs hover:bg-slate-50">
                    <span className="w-28 shrink-0 font-semibold text-slate-600">
                      {k.pageNumbers.length === 1 ? 'Page' : 'Pages'} {formatPages(k.pageNumbers)}
                    </span>
                    <span className="flex-1 min-w-0 truncate font-semibold text-slate-800">
                      {k.suggestedClient || 'Patient not matched'}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {k.status === 'processing'
                        ? 'Classifying…'
                        : k.status === 'filed'
                          ? 'Filed'
                          : k.status === 'rejected'
                            ? 'Rejected'
                            : MATCH_LABEL[k.matchStatus ?? ''] || 'Needs review'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {doc && doc.status !== 'processing' && doc.status !== 'split' && (
            <div className="bg-white rounded-xl border-2 border-brand-200 p-5 shadow-xs">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <FileText className="h-4 w-4 text-brand-600" />
                <p className="text-sm font-bold text-slate-900 flex-1 min-w-0 truncate" title={doc.fileName ?? undefined}>
                  {doc.docType} — {doc.fileName || 'document'}
                </p>
                {doc.confidence > 0 && (
                  <span className="text-[11px] font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
                    {Math.round(doc.confidence * 100)}% type confidence (AI)
                  </span>
                )}
                {doc.fileUrl && (
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:underline">
                    {doc.parentId
                      ? doc.status === 'filed' ? 'View filed pages' : `View in original (page ${doc.pageNumbers[0] ?? 1})`
                      : 'View original'}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {doc.parentId && (
                <p className="mb-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                  <Layers className="inline h-3.5 w-3.5 mr-1 text-brand-600" />
                  Part of a multi-patient file: {partLabel(doc)}. Filing saves a PDF of only these pages to the chart.
                </p>
              )}

              {canSplit(doc) && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="flex-1 min-w-[12rem] text-xs text-slate-600">
                    Several patients in this file? Split it so each patient&apos;s pages go to their own chart.
                  </p>
                  <button type="button" disabled={busy} onClick={() => void splitDoc(doc)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                    <Scissors className="h-3.5 w-3.5" /> Split by patient
                  </button>
                  {reprocessable === doc.id && doc.status === 'ready' && (
                    <button type="button" disabled={busy} onClick={() => void reprocessDoc(doc)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                      <RefreshCw className="h-3.5 w-3.5" /> Re-process
                    </button>
                  )}
                </div>
              )}

              {doc.processingError && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                  {doc.processingError}
                </p>
              )}

              {/* Extracted fields */}
              {doc.fields.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
                  {doc.fields.map((f, i) => (
                    <div key={`${f.label}-${i}`} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{f.label}</p>
                      <p className="text-sm font-semibold text-slate-800 break-words">{f.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-4 text-xs text-slate-500">No fields were extracted. Open the original to review it.</p>
              )}

              {/* Patient match */}
              <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2.5 mb-4 space-y-1.5">
                <p className="text-xs text-brand-900 flex items-center gap-2 flex-wrap">
                  <User className="h-3.5 w-3.5 text-brand-600 shrink-0" />
                  <strong>Patient:</strong> {doc.suggestedClient || 'Not selected'}
                  {doc.matchStatus && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-brand-700 border border-brand-100">
                      {MATCH_LABEL[doc.matchStatus] || doc.matchStatus}
                    </span>
                  )}
                </p>
                {doc.matchReason && <p className="text-[11px] text-brand-900">{doc.matchReason}</p>}
                <p className="text-[11px] text-brand-900"><strong>Files to:</strong> {doc.filesTo}</p>
                {doc.status === 'ready' && doc.candidates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {doc.candidates.map((c) => (
                      <button key={c.clientId} type="button" disabled={busy}
                        onClick={() => void changeClient(doc, c.clientId)}
                        className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-50"
                        title={c.reason}>
                        {c.name} · {c.dob} · {c.reason}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {doc.status === 'ready' ? (
                <div className="space-y-2">
                  {changingClient === doc.id && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                      <label className="flex items-center gap-2">
                        <Search className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <input
                          autoFocus
                          value={clientQuery}
                          onChange={(e) => setClientQuery(e.target.value)}
                          placeholder="Search patients by name, MRN or Valant ID…"
                          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white flex-1"
                        />
                      </label>
                      {clientResults.map((c) => (
                        <button key={c.id} type="button" disabled={busy} onClick={() => void changeClient(doc, c.id)}
                          className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-white disabled:opacity-50">
                          {c.name}{c.dob ? ` · DOB ${c.dob}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => void fileDoc(doc)}
                      disabled={busy || !doc.suggestedClientId}
                      title={doc.suggestedClientId ? undefined : 'Pick a patient first'}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 transition-all disabled:opacity-50">
                      {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm &amp; File to Chart
                    </button>
                    <button disabled={busy} onClick={() => setChangingClient(changingClient === doc.id ? null : doc.id)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
                      <User className="h-4 w-4" /> Change Patient
                    </button>
                    <button disabled={busy} onClick={() => void rejectDoc(doc)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
                      <X className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </div>
              ) : doc.status === 'rejected' ? (
                <p className="inline-flex items-center gap-2 text-sm font-bold text-rose-600">
                  <X className="h-4 w-4" /> Rejected — not filed to any chart
                </p>
              ) : (
                <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Filed — {doc.filesTo}
                </p>
              )}
            </div>
          )}

          {/* Guardrail note */}
          <div className="bg-slate-900 rounded-xl p-4 text-white shadow-xs">
            <p className="text-sm font-bold uppercase tracking-wider text-slate-200 mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-brand-300" /> Human-in-the-Loop Safeguards
            </p>
            <ul className="space-y-1.5 text-xs text-slate-500">
              <li className="flex gap-2"><Sparkles className="h-3.5 w-3.5 text-brand-300 shrink-0 mt-0.5" /> A staff member confirms every filing; nothing lands in a chart automatically.</li>
              <li className="flex gap-2"><Sparkles className="h-3.5 w-3.5 text-brand-300 shrink-0 mt-0.5" /> A patient is pre-selected only on a Valant ID / MRN or full name + date of birth match. Name alone never matches.</li>
              <li className="flex gap-2"><Sparkles className="h-3.5 w-3.5 text-brand-300 shrink-0 mt-0.5" /> Uploads, filings and views are recorded in the HIPAA audit log.</li>
              <li className="flex gap-2"><AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" /> Filing does not update other workflows — enter court orders, insurance and prior-auth details in their own modules.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
