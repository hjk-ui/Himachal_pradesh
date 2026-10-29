'use client';

import { useEffect, useState } from 'react';
import { 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Edit3, 
  FileCheck, 
  FileEdit, 
  FileText, 
  History, 
  Lock, 
  Plus, 
  Search, 
  ShieldCheck, 
  User, 
  UserCheck, 
  X 
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { apiJson } from '@/lib/api-client';
import { EVALUATION_TEMPLATES, EvaluationTemplate } from '@/features/ehr/evaluations/templates';
import { MentalStatusExamWidget } from '@/components/clinical/MentalStatusExamWidget';
import { RiskAssessmentWidget } from '@/components/clinical/RiskAssessmentWidget';
import { DiagnosisAutocomplete } from '@/components/clinical/DiagnosisAutocomplete';
import {
  CageAidWidget,
  emptyCageAid,
  scoreCageAid,
  type CageAidAnswers,
} from '@/components/clinical/CageAidWidget';
import {
  AsamDimensionsWidget,
  emptyAsam,
  type AsamScores,
} from '@/components/clinical/AsamDimensionsWidget';

interface AmendmentLog {
  id: string;
  version: number;
  amendedBy: string;
  amendedByRole?: string;
  rationale: string;
  contentChanges: Record<string, any>;
  createdAt: string;
}

interface EvaluationRecord {
  id: string;
  clientId: string;
  templateId: string;
  templateName: string;
  status: 'DRAFT' | 'PENDING_SUPERVISOR' | 'FINALIZED' | 'AMENDED';
  content: Record<string, any>;
  mseData?: any;
  riskData?: any;
  diagnoses?: any[];
  clinicianSignature?: string;
  clinicianSignedAt?: string;
  supervisorSignature?: string;
  supervisorSignedAt?: string;
  finalizedAt?: string;
  version: number;
  amendments?: AmendmentLog[];
  createdAt: string;
  updatedAt: string;
}

export default function ClinicalEvaluationsPage() {
  const { clients } = useClients();
  const [error, setError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'PENDING_SUPERVISOR' | 'FINALIZED'>('ALL');
  
  // Records List
  const [records, setRecords] = useState<EvaluationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Editor Modal / State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<EvaluationTemplate | null>(null);
  const [editingRecord, setEditingRecord] = useState<EvaluationRecord | null>(null);

  // Form Fields State
  const [formContent, setFormContent] = useState<Record<string, string>>({});
  const [mseState, setMseState] = useState<any>({});
  const [riskState, setRiskState] = useState<any>({});
  const [selectedDiagnoses, setSelectedDiagnoses] = useState<any[]>([]);
  const [cageAid, setCageAid] = useState<CageAidAnswers>(emptyCageAid());
  const [asamScores, setAsamScores] = useState<AsamScores>(emptyAsam());
  
  // Signatures State
  const [clinicianSig, setClinicianSig] = useState('');
  const [supervisorSig, setSupervisorSig] = useState('');
  const [isSupervisorRole, setIsSupervisorRole] = useState(false);

  // Amendment State
  const [isAmendmentMode, setIsAmendmentMode] = useState(false);
  const [amendmentRationale, setAmendmentRationale] = useState('');

  // View Amendment History Drawer
  const [viewHistoryRecord, setViewHistoryRecord] = useState<EvaluationRecord | null>(null);

  // Default client selection
  useEffect(() => {
    if (clients.length > 0 && !selectedClientId) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  // Load evaluations
  const loadEvaluations = async () => {
    setLoading(true);
    try {
      const url = selectedClientId 
        ? `/api/clinical/evaluations?clientId=${selectedClientId}`
        : '/api/clinical/evaluations';
      const res = await apiJson<{ success: boolean; data: EvaluationRecord[] }>(url);
      if (res.success && res.data) {
        setRecords(res.data);
      }
    } catch {
      // Endpoint handles errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvaluations();
  }, [selectedClientId]);

  // Filter records
  const filteredRecords = records.filter((r) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'FINALIZED') return r.status === 'FINALIZED' || r.status === 'AMENDED';
    return r.status === statusFilter;
  });

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  const openNewEvaluation = (template: EvaluationTemplate) => {
    setActiveTemplate(template);
    setEditingRecord(null);
    setFormContent({});
    setMseState({});
    setRiskState({});
    setSelectedDiagnoses([]);
    setCageAid(emptyCageAid());
    setAsamScores(emptyAsam());
    setClinicianSig('');
    setSupervisorSig('');
    setIsAmendmentMode(false);
    setAmendmentRationale('');
    setIsEditorOpen(true);
  };

  const openEditEvaluation = (record: EvaluationRecord) => {
    const tmpl = EVALUATION_TEMPLATES.find((t) => t.id === record.templateId) || EVALUATION_TEMPLATES[0];
    setActiveTemplate(tmpl);
    setEditingRecord(record);
    setFormContent(record.content || {});
    setMseState(record.mseData || {});
    setRiskState(record.riskData || {});
    setSelectedDiagnoses(record.diagnoses || []);
    const c = (record.content || {}) as Record<string, unknown>;
    setCageAid((c.cageAid as CageAidAnswers) || emptyCageAid());
    setAsamScores((c.asamScores as AsamScores) || emptyAsam());
    setClinicianSig(record.clinicianSignature || '');
    setSupervisorSig(record.supervisorSignature || '');

    if (record.status === 'FINALIZED' || record.status === 'AMENDED') {
      setIsAmendmentMode(true);
    } else {
      setIsAmendmentMode(false);
    }
    setAmendmentRationale('');
    setIsEditorOpen(true);
  };

  const handleSave = async (targetStatus: 'DRAFT' | 'PENDING_SUPERVISOR' | 'FINALIZED') => {
    if (!selectedClientId || !activeTemplate) return;
    setLoading(true);
    try {
      const payload: any = {
        id: editingRecord?.id,
        clientId: selectedClientId,
        templateId: activeTemplate.id,
        templateName: activeTemplate.name,
        status: targetStatus,
        content: {
          ...formContent,
          cageAid,
          cageAidScore: scoreCageAid(cageAid),
          asamScores,
        },
        mseData: mseState,
        riskData: riskState,
        diagnoses: selectedDiagnoses,
        clinicianSignature: clinicianSig || undefined,
        supervisorSignature: supervisorSig || undefined,
      };

      if (isAmendmentMode) {
        payload.amendmentRationale = amendmentRationale;
        payload.amendmentContent = {
          ...formContent,
          cageAid,
          cageAidScore: scoreCageAid(cageAid),
          asamScores,
        };
      }

      await apiJson('/api/clinical/evaluations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setIsEditorOpen(false);
      loadEvaluations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 font-sans">
      {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-purple-100 text-[#5C2D91]">
              <FileCheck size={22} />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Clinical Evaluations</h1>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Biopsychosocial, Psychiatric Diagnostic, Crisis, ASAM SUD, Discharge & Treatment Evaluation workflows.
          </p>
        </div>

        {/* Patient Selector, Status Filter & + New Evaluation Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button
            onClick={() => {
              const defaultTemplate = EVALUATION_TEMPLATES.find(t => t.id === 'biopsychosocial') || EVALUATION_TEMPLATES[0];
              openNewEvaluation(defaultTemplate);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
            id="new-evaluation-btn"
            data-testid="new-evaluation-btn"
          >
            <Plus size={16} />
            <span>+ New Evaluation</span>
          </button>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <User size={16} className="text-slate-400" />
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-800 focus:outline-none"
            >
              <option value="" disabled>Select Patient...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(0, 6)})
                </option>
              ))}
            </select>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            {(['ALL', 'DRAFT', 'PENDING_SUPERVISOR', 'FINALIZED'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === st
                    ? 'bg-white text-[#5C2D91] shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'ALL' ? 'All Records' : st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Template Launcher Cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
          Start New Clinical Evaluation Template
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {EVALUATION_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => openNewEvaluation(tmpl)}
              className="bg-white border border-slate-200/80 hover:border-purple-300 rounded-2xl p-4 text-left shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-50 text-[#5C2D91] rounded">
                    {tmpl.code || 'EVAL'}
                  </span>
                  {tmpl.requiresSupervisorCoSign && (
                    <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold">
                      Co-Sign Required
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-slate-900 group-hover:text-[#5C2D91] transition-colors">
                  {tmpl.name}
                </h4>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  {tmpl.description}
                </p>
              </div>
              <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-[#5C2D91]">
                <span>Launch Form</span>
                <Plus size={14} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Evaluations Records List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden space-y-4">
        <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">
            Evaluation Documents for {selectedClient?.name || 'All Patients'} ({filteredRecords.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading clinical evaluation records...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <FileText size={36} className="mx-auto mb-2 text-slate-300" />
            <p className="font-semibold text-slate-600">No Evaluation Documents Found</p>
            <p className="text-xs text-slate-400 mt-1">Select a template above to complete a clinical evaluation.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRecords.map((r) => (
              <div key={r.id} className="p-4 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-900 text-base">{r.templateName}</h4>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      r.status === 'FINALIZED' ? 'bg-emerald-100 text-emerald-700' :
                      r.status === 'AMENDED' ? 'bg-purple-100 text-[#5C2D91]' :
                      r.status === 'PENDING_SUPERVISOR' ? 'bg-amber-100 text-amber-800' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {r.status === 'FINALIZED' ? `Finalized (v${r.version})` : r.status === 'AMENDED' ? `Amended (v${r.version})` : `${r.status.replace('_', ' ')} (v${r.version})`}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-slate-500 font-medium">
                    <span className="flex items-center gap-1">
                      <Clock size={13} />
                      Created: {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                    {r.clinicianSignature && (
                      <span className="flex items-center gap-1 text-emerald-600 font-bold">
                        <CheckCircle2 size={13} /> Clinician Signed
                      </span>
                    )}
                    {r.supervisorSignature && (
                      <span className="flex items-center gap-1 text-purple-700 font-bold">
                        <ShieldCheck size={13} /> Supervisor Co-Signed
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {r.amendments && r.amendments.length > 0 && (
                    <button
                      onClick={() => setViewHistoryRecord(r)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
                    >
                      <History size={14} />
                      Version Log ({r.amendments.length})
                    </button>
                  )}

                  <button
                    onClick={() => openEditEvaluation(r)}
                    className="px-4 py-2 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <Edit3 size={14} />
                    {r.status === 'FINALIZED' || r.status === 'AMENDED' ? 'Amend Record' : 'Edit Document'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FULL EVALUATION EDITOR MODAL */}
      {isEditorOpen && activeTemplate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase bg-purple-100 text-[#5C2D91] px-2 py-0.5 rounded">
                  Clinical Document Editor
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-1">{activeTemplate.name}</h2>
                <p className="text-xs text-slate-500">Patient: <span className="font-bold text-slate-800">{selectedClient?.name || 'Selected Patient'}</span></p>
              </div>
              <button onClick={() => setIsEditorOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={22} />
              </button>
            </div>

            {/* Amendment Notice Banner */}
            {isAmendmentMode && (
              <div className="bg-purple-50 border-b border-purple-200 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-purple-900">
                  <AlertCircle size={16} className="text-[#5C2D91]" />
                  FINALIZED DOCUMENT AMENDMENT WORKFLOW (Version {editingRecord?.version || 1} → {(editingRecord?.version || 1) + 1})
                </div>
                <input
                  type="text"
                  placeholder="Enter required clinical rationale for this version amendment..."
                  value={amendmentRationale}
                  onChange={(e) => setAmendmentRationale(e.target.value)}
                  className="w-full bg-white p-2.5 border border-purple-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#5C2D91]"
                />
              </div>
            )}

            {/* Form Sections Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {(activeTemplate.id === 'sud_asam' || activeTemplate.code === 'SUD-ASAM') && (
                <div className="space-y-4">
                  <CageAidWidget value={cageAid} onChange={setCageAid} />
                  <AsamDimensionsWidget value={asamScores} onChange={setAsamScores} />
                </div>
              )}

              {activeTemplate.sections.map((sec) => (
                <div key={sec.id} className="space-y-2 bg-slate-50/50 p-4 rounded-xl border border-slate-200/80">
                  <label className="block text-sm font-bold text-slate-800">
                    {sec.title} {sec.required && <span className="text-red-500">*</span>}
                  </label>

                  {(sec.type === 'textarea' || sec.type === 'asam') && (
                    <textarea
                      rows={3}
                      placeholder={sec.placeholder}
                      value={formContent[sec.id] || ''}
                      onChange={(e) => setFormContent({ ...formContent, [sec.id]: e.target.value })}
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#5C2D91]"
                    />
                  )}

                  {sec.type === 'select' && (
                    <select
                      value={formContent[sec.id] || ''}
                      onChange={(e) => setFormContent({ ...formContent, [sec.id]: e.target.value })}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                    >
                      <option value="">Select option...</option>
                      {sec.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}

                  {sec.type === 'mse' && (
                    <MentalStatusExamWidget
                      value={mseState}
                      onChange={(val) => setMseState(val)}
                    />
                  )}

                  {sec.type === 'risk' && (
                    <RiskAssessmentWidget
                      value={riskState}
                      onChange={(val) => setRiskState(val)}
                    />
                  )}

                  {sec.type === 'diagnosis' && (
                    <DiagnosisAutocomplete
                      value={selectedDiagnoses}
                      onChange={(val) => setSelectedDiagnoses(val)}
                    />
                  )}
                </div>
              ))}

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-400"
                  title="AI Draft requires a configured clinical model"
                >
                  AI Draft
                </button>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  AI Draft is disabled — no clinical language model is configured. Complete the sections above manually (no simulated draft).
                </p>
              </div>

              {/* Signatures & Co-Sign Section */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <h4 className="text-xs font-bold uppercase text-slate-500">Signatures & Legal Authentication</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <label className="text-xs font-bold text-slate-700 block">Clinician Digital Signature</label>
                    <input
                      type="text"
                      placeholder="Type Full Name (e.g. Garry Smith, LCSW)"
                      value={clinicianSig}
                      onChange={(e) => setClinicianSig(e.target.value)}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold"
                    />
                    <p className="text-[11px] text-slate-400">By typing name, you certify assessment accuracy.</p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <label className="text-xs font-bold text-slate-700 block">
                      Supervisor Co-Signature {activeTemplate.requiresSupervisorCoSign && <span className="text-amber-600">(Required)</span>}
                    </label>
                    <input
                      type="text"
                      placeholder="Supervisor Signature (e.g. Dr. Jane Doe, MD)"
                      value={supervisorSig}
                      onChange={(e) => setSupervisorSig(e.target.value)}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                onClick={() => setIsEditorOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>

              <div className="flex gap-2">
                <button
                  disabled={loading}
                  onClick={() => handleSave('DRAFT')}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold"
                >
                  Save Draft
                </button>
                <button
                  disabled={loading || !clinicianSig.trim()}
                  onClick={() => handleSave('FINALIZED')}
                  className="px-5 py-2.5 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-50"
                >
                  {isAmendmentMode ? 'Save Amendment' : 'Sign & Finalize Evaluation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AMENDMENT HISTORY DRAWER */}
      {viewHistoryRecord && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-end">
          <div className="bg-white w-full max-w-lg h-full p-6 shadow-2xl overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <span className="text-[10px] uppercase font-extrabold bg-purple-100 text-[#5C2D91] px-2 py-0.5 rounded">
                  Version Audit Log
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{viewHistoryRecord.templateName}</h3>
              </div>
              <button onClick={() => setViewHistoryRecord(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-slate-500 font-medium">
                This document has undergone {viewHistoryRecord.amendments?.length} version amendment(s). Original signed content is preserved for HIPAA compliance.
              </p>

              <div className="space-y-3">
                {viewHistoryRecord.amendments?.map((am) => (
                  <div key={am.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-[#5C2D91] text-xs">Version {am.version}</span>
                      <span className="text-[11px] text-slate-400">{new Date(am.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="font-bold text-slate-800">Amended By: {am.amendedBy}</p>
                    <div className="p-2.5 bg-purple-50 text-purple-900 rounded-lg text-xs font-medium">
                      <span className="font-bold">Rationale:</span> {am.rationale}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <button
                onClick={() => setViewHistoryRecord(null)}
                className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
              >
                Close Audit Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
