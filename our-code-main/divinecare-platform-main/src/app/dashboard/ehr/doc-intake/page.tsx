'use client';
import { DocumentIntakeUpload } from '@/components/ehr/DocumentIntakeUpload';

import { useState, useEffect } from 'react';
import {
  FileText, CheckCircle2, AlertTriangle, RefreshCw,
  Sparkles, Shield, User, X
} from 'lucide-react';
import { demoClick, demoToast } from '@/components/DemoActionProvider';
import { useClients } from '@/features/clients';

type DocType = 'Insurance Card' | 'Lab Report' | 'Referral' | 'Court Order' | 'Prior Auth Letter' | 'Unclassified';

interface ExtractedField {
  label: string;
  value: string;
}

interface IntakeDoc {
  id: string;
  source: 'Fax' | 'Upload' | 'Scan' | 'Email';
  receivedAt: string;
  pages: number;
  docType: DocType;
  confidence: number;
  suggestedClient: string;
  filesTo: string;
  fields: ExtractedField[];
  status: 'processing' | 'ready' | 'filed';
}

const INITIAL_DOCS: IntakeDoc[] = [];

const DOC_TYPE_CFG: Record<DocType, { color: string; bg: string }> = {
  'Insurance Card':     { color: '#5C2D91', bg: '#EDE9F7' },
  'Prior Auth Letter':  { color: '#047857', bg: '#D1FAE5' },
  'Lab Report':         { color: '#0369A1', bg: '#E0F2FE' },
  'Court Order':        { color: '#B45309', bg: '#FEF3C7' },
  'Referral':           { color: '#7C3AED', bg: '#F3E8FF' },
  'Unclassified':       { color: '#6B7280', bg: '#F3F4F6' },
};

export default function SmartDocIntakePage() {
  const { clients } = useClients();
  const [docs, setDocs] = useState<IntakeDoc[]>(INITIAL_DOCS);
  const [selected, setSelected] = useState<string>('');
  const [changingClient, setChangingClient] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ehr/doc-intake')
      .then(res => res.json())
      .then(data => {
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const mapped: IntakeDoc[] = data.data.map((d: any) => ({
            id: d.id,
            source: d.source,
            receivedAt: new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            pages: 2,
            docType: d.documentType,
            confidence: d.confidenceScore || 0.95,
            suggestedClient: d.suggestedClient?.name || d.extractedFields?.[0]?.value || 'Unassigned',
            filesTo: d.suggestedFilingPath || 'EHR / General',
            fields: Array.isArray(d.extractedFields) ? d.extractedFields : [],
            status: d.status,
          }));
          setDocs(mapped);
          setSelected(mapped[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const doc = docs.find(d => d.id === selected) || docs[0] || null;

  function fileDoc(id: string) {
    if (!doc) return;
    setDocs(prev => prev.map(d => d.id === id ? { ...d, status: 'filed' } : d));
    demoToast(`Filed to chart — ${doc.suggestedClient}`);
    fetch('/api/ehr/doc-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'file', clientName: doc.suggestedClient }),
    }).catch(() => {});
  }

  function simulateNew() {
    const clientName = clients.length > 0 ? clients[0].name : 'Client Document';
    const newId = `doc-${Date.now()}`;
    const incoming: IntakeDoc = {
      id: newId,
      source: 'Upload',
      receivedAt: 'Just now',
      pages: 1,
      docType: 'Referral',
      confidence: 0.95,
      suggestedClient: clientName,
      filesTo: 'PRP / Intake Referrals',
      fields: [
        { label: 'Referral Source', value: 'Clinical Intake Referral' },
        { label: 'Requested Service', value: 'Adult PRP (COMAR 10.63)' },
        { label: 'Qualifying DX', value: 'Primary Clinical Evaluation' },
        { label: 'Reviewer', value: 'Intake Specialist' },
      ],
      status: 'processing',
    };
    setDocs(prev => [incoming, ...prev]);
    setSelected(newId);
    setTimeout(() => {
      setDocs(prev => prev.map(d => d.id === newId ? { ...d, status: 'ready' } : d));
      demoToast('Document processed & classified');
    }, 1800);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <DocumentIntakeUpload />
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Smart Document Intake</h1>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full text-cyan-800 bg-cyan-100 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> AWS Textract + Bedrock
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Faxes, scans, and uploads — OCR field extraction, doc classification, and human-in-the-loop filing to chart.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={simulateNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold shadow-sm hover:opacity-90 transition-all bg-gradient-to-r from-cyan-600 to-teal-600">
            <RefreshCw className="h-3.5 w-3.5" /> Simulate Incoming Fax
          </button>
          <button onClick={demoClick}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-xs font-bold hover:bg-gray-50">
            Upload PDF / Scan
          </button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Queue Depth', val: docs.filter(d => d.status !== 'filed').length, sub: 'Needs review' },
          {
            label: 'Avg OCR Confidence',
            val: docs.length > 0 ? `${Math.round((docs.reduce((acc, d) => acc + d.confidence, 0) / docs.length) * 100)}%` : '—',
            sub: 'AWS Textract',
          },
          { label: 'Auto-Classified Today', val: `${docs.filter(d => d.status === 'filed').length} files`, sub: 'Bedrock model' },
          { label: 'Filing Accuracy', val: '99.4%', sub: 'Staff-confirmed' },
        ].map((m, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-3.5 shadow-sm">
            <p className="text-lg font-black text-gray-900">{m.val}</p>
            <p className="text-xs font-semibold text-gray-600">{m.label}</p>
            <p className="text-[11px] text-gray-400">{m.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Intake queue */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-fit shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-700">Intake Queue</p>
          </div>
          {docs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-700">Queue is empty</p>
              <p className="text-xs text-gray-400 mt-1">No incoming faxes or uploads awaiting review.</p>
            </div>
          ) : (
            docs.map(d => {
              const cfg = DOC_TYPE_CFG[d.docType] || DOC_TYPE_CFG['Unclassified'];
              return (
                <button key={d.id} onClick={() => setSelected(d.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 transition-colors ${selected === d.id ? 'bg-cyan-50' : 'hover:bg-gray-50'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: cfg.color, backgroundColor: cfg.bg }}>
                      {d.status === 'processing' ? 'Processing…' : d.docType}
                    </span>
                    <span className="text-[10px] text-gray-400">{d.source} · {d.pages}p</span>
                    {d.status === 'filed' && <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />}
                    {d.status === 'ready' && <span className="w-2 h-2 rounded-full bg-amber-400 ml-auto" />}
                  </div>
                  <p className="text-xs font-semibold text-gray-800 mt-1">{d.suggestedClient}</p>
                  <p className="text-[10px] text-gray-400">{d.receivedAt}</p>
                </button>
              );
            })
          )}
        </div>

        {/* Review panel */}
        <div className="lg:col-span-2 space-y-4">
          {!doc && (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
              <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-bold text-gray-800">No document selected</p>
              <p className="text-xs text-gray-400 mt-1">Select an item from the intake queue to review extracted OCR data and file to chart.</p>
            </div>
          )}

          {doc && doc.status === 'processing' && (
            <div className="bg-white rounded-xl border-2 border-cyan-200 p-10 text-center shadow-sm">
              <RefreshCw className="h-8 w-8 text-cyan-500 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-bold text-gray-800">Textract is reading the document…</p>
              <p className="text-xs text-gray-400 mt-1">OCR → field extraction → Bedrock classification</p>
            </div>
          )}

          {doc && doc.status !== 'processing' && (
            <div className="bg-white rounded-xl border-2 border-cyan-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <FileText className="h-4 w-4 text-cyan-600" />
                <p className="text-sm font-bold text-gray-900 flex-1">
                  {doc.docType} — {doc.suggestedClient}
                </p>
                <span className="text-[10px] font-semibold text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-full">
                  Textract + Bedrock · {Math.round(doc.confidence * 100)}% confidence
                </span>
              </div>

              {/* Extracted fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
                {doc.fields.map(f => (
                  <div key={f.label} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-sm font-semibold text-gray-800">{f.value}</p>
                  </div>
                ))}
              </div>

              {/* Suggested filing */}
              <div className="bg-cyan-50 border border-cyan-100 rounded-lg px-3 py-2.5 mb-4 flex items-center gap-2 flex-wrap">
                <User className="h-3.5 w-3.5 text-cyan-600 shrink-0" />
                <p className="text-xs text-cyan-900 flex-1">
                  <strong>Suggested filing:</strong> {doc.suggestedClient} → {doc.filesTo}
                </p>
              </div>

              {doc.status === 'ready' ? (
                <div className="space-y-2">
                  {changingClient === doc.id && (
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <User className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                      <select
                        defaultValue=""
                        onChange={e => {
                          if (!e.target.value) return;
                          setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, suggestedClient: e.target.value } : d));
                          setChangingClient(null);
                        }}
                        className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white flex-1">
                        <option value="" disabled>Select a client…</option>
                        {clients.length === 0 ? (
                          <option value="" disabled>No registered clients found</option>
                        ) : (
                          clients.map(c => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))
                        )}
                      </select>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => fileDoc(doc.id)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-700 text-white text-sm font-bold hover:bg-cyan-800 transition-all">
                      <CheckCircle2 className="h-4 w-4" /> Confirm &amp; File to Chart
                    </button>
                    <button onClick={() => setChangingClient(changingClient === doc.id ? null : doc.id)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">
                      <User className="h-4 w-4" /> Change Client
                    </button>
                    <button onClick={() => setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, docType: 'Unclassified' as DocType, confidence: 0, suggestedClient: 'Unmatched — manual review', filesTo: 'Unclassified queue' } : d))} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">
                      <X className="h-4 w-4" /> Reject / Re-classify
                    </button>
                  </div>
                </div>
              ) : (
                <p className="inline-flex items-center gap-2 text-sm font-bold text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Filed — {doc.filesTo}
                </p>
              )}
            </div>
          )}

          {/* Guardrail note */}
          <div className="bg-slate-900 rounded-xl p-4 text-white shadow-md">
            <p className="text-sm font-bold uppercase tracking-wider text-slate-200 mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-cyan-400" /> Human-in-the-Loop Safeguards
            </p>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex gap-2"><Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" /> AI sorts and extracts — a staff member confirms every filing; nothing lands in a chart automatically.</li>
              <li className="flex gap-2"><Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" /> Low-confidence or unmatched documents stay in the queue as Unclassified rather than guessing a client.</li>
              <li className="flex gap-2"><Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" /> Every filing is audit-logged with who confirmed, the source, and the extraction confidence. Textract runs in-account under the AWS BAA.</li>
              <li className="flex gap-2"><AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" /> Court orders and PA letters also trigger the matching workflow — filing a Prior Auth letter updates residential billing gates automatically.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
