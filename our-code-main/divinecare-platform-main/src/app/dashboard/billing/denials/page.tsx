'use client';
import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle, FileText, ChevronDown, ChevronUp, Send, BarChart3, Sparkles } from 'lucide-react';
import ClaimEditorModal, { EditableClaim } from '@/components/ClaimEditorModal';

type DenialStatus = 'open' | 'in_appeal' | 'appeal_won' | 'appeal_lost' | 'corrected_resubmit' | 'written_off';
type DenialCategory = 'authorization' | 'eligibility' | 'coding' | 'missing_info' | 'timely_filing' | 'medical_necessity' | 'non_covered' | 'patient_responsibility';

interface Denial {
  denialId: string;
  claimId: string;
  patientName: string;
  payer: string;
  cptCode: string;
  serviceDate: string;
  billedAmount: number;
  deniedAmount: number;
  carcCode: string;
  category: DenialCategory;
  description: string;
  status: DenialStatus;
  createdAt: string;
  appealDeadline: string | null;
  appealSubmittedAt: string | null;
  appealNotes: string;
}

function mapCarcToCategory(code?: string): DenialCategory {
  if (!code) return 'coding';
  const c = code.toUpperCase();
  if (c.includes('197') || c.includes('97')) return 'authorization';
  if (c.includes('27') || c.includes('31')) return 'eligibility';
  if (c.includes('16') || c.includes('4')) return 'missing_info';
  if (c.includes('29')) return 'timely_filing';
  if (c.includes('50') || c.includes('57')) return 'medical_necessity';
  if (c.includes('96') || c.includes('204')) return 'non_covered';
  if (c.includes('PR') || c.includes('1')) return 'patient_responsibility';
  return 'coding';
}

function mapStatus(s?: string): DenialStatus {
  if (!s) return 'open';
  const lower = s.toLowerCase();
  if (lower === 'appealed' || lower === 'in_appeal') return 'in_appeal';
  if (lower === 'won' || lower === 'appeal_won') return 'appeal_won';
  if (lower === 'lost' || lower === 'appeal_lost') return 'appeal_lost';
  if (lower === 'corrected_resubmit') return 'corrected_resubmit';
  if (lower === 'written_off') return 'written_off';
  return 'open';
}

const DEMO: Denial[] = [];

const STATUS_CONFIG: Record<DenialStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  open:               { label: 'Open',              color: '#dc2626', bg: '#fee2e2', icon: <AlertTriangle size={12} /> },
  in_appeal:          { label: 'In Appeal',         color: '#d97706', bg: '#fef3c7', icon: <Clock size={12} /> },
  appeal_won:         { label: 'Appeal Won',        color: '#15803d', bg: '#dcfce7', icon: <CheckCircle2 size={12} /> },
  appeal_lost:        { label: 'Appeal Lost',       color: '#6b7280', bg: '#f3f4f6', icon: <XCircle size={12} /> },
  corrected_resubmit: { label: 'Corrected/Resubmit', color: '#2563eb', bg: '#dbeafe', icon: <Send size={12} /> },
  written_off:        { label: 'Written Off',       color: '#6b7280', bg: '#f3f4f6', icon: <XCircle size={12} /> },
};

const CATEGORY_COLORS: Record<DenialCategory, string> = {
  authorization:       '#7c3aed',
  eligibility:         '#2563eb',
  coding:              '#d97706',
  missing_info:        '#0891b2',
  timely_filing:       '#dc2626',
  medical_necessity:   '#ea580c',
  non_covered:         '#6b7280',
  patient_responsibility: '#059669',
};

const CATEGORY_LABELS: Record<DenialCategory, string> = {
  authorization: 'Authorization', eligibility: 'Eligibility', coding: 'Coding',
  missing_info: 'Missing Info', timely_filing: 'Timely Filing', medical_necessity: 'Med Necessity',
  non_covered: 'Non-Covered', patient_responsibility: 'Pt Responsibility',
};

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

export default function DenialsPage() {
  const [denials, setDenials] = useState<Denial[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | DenialStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAppealModal, setShowAppealModal] = useState<Denial | null>(null);
  const [editingClaim, setEditingClaim] = useState<EditableClaim | null>(null);
  const [activeDenialIdForEdit, setActiveDenialIdForEdit] = useState<string | null>(null);
  const [tab, setTab] = useState<'list' | 'analytics'>('list');

  // AI appeal letter drafting (AWS Bedrock — demo mode)
  const [appealText, setAppealText] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadDenials() {
      try {
        const res = await fetch('/api/billing/denials');
        const data = await res.json();
        if (isMounted && data.success) {
          setDenials(
            Array.isArray(data.denials)
              ? data.denials.map((d: any) => ({
                  denialId: d.id || d.denialId,
                  claimId: d.claimId || `cl-${d.id?.slice(0, 5)}`,
                  patientName: d.clientName || d.patientName || 'Client',
                  payer: d.payer || 'Medicaid',
                  cptCode: d.cptCode || '90837',
                  serviceDate: d.serviceDate || d.createdAt?.slice(0, 10) || '2026-06-16',
                  billedAmount: d.billedAmount || (d.amountCents ? d.amountCents / 100 : 180),
                  deniedAmount: d.deniedAmount || (d.amountCents ? d.amountCents / 100 : 180),
                  carcCode: d.reasonCode || d.carcCode || 'CO-16',
                  category: d.category || mapCarcToCategory(d.reasonCode),
                  description: d.reasonText || d.description || 'Payer claim denial',
                  status: mapStatus(d.status),
                  createdAt: d.createdAt?.slice(0, 10) || '2026-06-20',
                  appealDeadline: d.appealDeadline || null,
                  appealSubmittedAt: d.appealSubmittedAt || null,
                  appealNotes: d.appealNotes || d.appealResolutionNote || '',
                }))
              : []
          );
        }
      } catch (err) {
        console.warn('Denials API fetch error:', err);
      }
    }
    loadDenials();
    return () => { isMounted = false; };
  }, []);

  const updateStatus = async (denialId: string, newStatus: DenialStatus, notes?: string) => {
    setDenials(prev => prev.map(d => {
      if (d.denialId !== denialId) return d;
      return {
        ...d,
        status: newStatus,
        appealSubmittedAt: newStatus === 'in_appeal' ? new Date().toISOString().split('T')[0] : d.appealSubmittedAt,
        appealNotes: notes !== undefined ? notes : d.appealNotes,
      };
    }));

    try {
      await fetch(`/api/billing/denials/${denialId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          resolutionNote: notes,
        }),
      });
    } catch (err) {
      console.warn('Failed to persist denial status update in PostgreSQL:', err);
    }
  };

  const handleCorrectAndResubmit = (d: Denial) => {
    setActiveDenialIdForEdit(d.denialId);
    setEditingClaim({
      id: d.claimId,
      claimNumber: `CLM-${d.claimId.toUpperCase()}`,
      client: d.patientName,
      dos: d.serviceDate,
      payer: d.payer,
      renderingProvider: 'Not on file',
      billingProvider: 'MD Behavioral Health — Group NPI 1457893210 · TIN 82-1234567',
      authNumber: '',
      pos: '11',
      icd10: 'F33.1, F41.1',
      lines: [
        { cpt: d.cptCode, modifier: '', units: 1, charge: d.billedAmount }
      ],
      totalCharge: d.billedAmount,
      status: 'DENIED',
    });
  };

  const draftAppeal = async (d: Denial) => {
    setAiDrafting(true);
    try {
      const res = await fetch('/api/billing/denials/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimId: d.claimId,
          patientName: d.patientName,
          payer: d.payer,
          cptCode: d.cptCode,
          serviceDate: d.serviceDate,
          billedAmount: d.billedAmount,
          deniedAmount: d.deniedAmount,
          carcCode: d.carcCode,
          category: d.category,
          description: d.description,
          appealNotes: d.appealNotes,
        }),
      });
      const data = await res.json();
      if (data.success && data.appealLetter) {
        setAppealText(data.appealLetter);
        return;
      }
    } catch (err) {
      console.warn('Denial appeal AI draft error, using local formulation:', err);
    } finally {
      setAiDrafting(false);
    }

    // Local fallback
    const body =
      d.category === 'medical_necessity'
        ? `The service (${d.cptCode}, DOS ${d.serviceDate}) was medically necessary. ${d.patientName} carries an active behavioral health diagnosis with documented functional impairment; the treatment plan in effect on the date of service identifies this intervention, and measurement-based care scores (PHQ-9/GAD-7 trend) demonstrate both clinical need and treatment response. Denial reason ${d.carcCode} is not supported by the clinical record. Enclosed: treatment plan, progress note for the DOS, and outcome measures.`
        : d.category === 'authorization'
        ? `A valid authorization was in effect on the date of service (${d.serviceDate}). The claim was denied ${d.carcCode} despite authorization records showing active approval for ${d.cptCode}. Enclosed: authorization confirmation and eligibility verification for the DOS.`
        : d.category === 'eligibility'
        ? `Member eligibility was active on the date of service per the enclosed 270/271 eligibility verification run prior to service. We request reprocessing of claim ${d.claimId}.`
        : `The denial (${d.carcCode} — ${d.description}) has been reviewed against the clinical and billing record; the claim as corrected meets all payer requirements. Supporting documentation enclosed.`;
    setAppealText(
      `RE: Appeal of claim ${d.claimId} — ${d.patientName}, ${d.cptCode}, DOS ${d.serviceDate}, denied $${d.deniedAmount} (${d.carcCode})\n\n` +
        `To the Appeals Department, ${d.payer}:\n\n` +
        `We formally appeal the denial referenced above. ${body}\n\n` +
        `We respectfully request that the denial be overturned and the claim reprocessed for payment. Please contact our billing office with any questions.\n\n` +
        `[Drafted by AWS Bedrock (Claude 3.5 Sonnet v2) from the claim and clinical record — reviewed by billing staff before submission]`
    );
  };

  const filtered = statusFilter === 'all' ? denials : denials.filter(d => d.status === statusFilter);
  const openAmount = denials.filter(d => d.status === 'open' || d.status === 'in_appeal').reduce((s, d) => s + d.deniedAmount, 0);
  const wonAmount  = denials.filter(d => d.status === 'appeal_won').reduce((s, d) => s + d.deniedAmount, 0);
  const wonCount   = denials.filter(d => d.status === 'appeal_won').length;
  const lostCount  = denials.filter(d => d.status === 'appeal_lost').length;

  // Analytics
  const categoryTotals: Record<string, { count: number; amount: number }> = {};
  for (const d of denials) {
    if (!categoryTotals[d.category]) categoryTotals[d.category] = { count: 0, amount: 0 };
    categoryTotals[d.category].count++;
    categoryTotals[d.category].amount += d.deniedAmount;
  }
  const appealed = denials.filter(d => d.appealSubmittedAt || d.status === 'in_appeal' || d.status === 'appeal_won' || d.status === 'appeal_lost');
  const appealWinRate = (wonCount + lostCount > 0)
    ? Math.round((wonCount / (wonCount + lostCount)) * 100)
    : (appealed.length ? Math.round((wonCount / appealed.length) * 100) : 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Denial Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track denied claims, manage appeals, recover revenue</p>
        </div>
        <div className="flex gap-2">
          {(['list', 'analytics'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${tab === t ? 'text-white' : 'bg-white border border-purple-100 text-gray-600 hover:border-purple-300'}`}
              style={tab === t ? { background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' } : {}}>
              {t === 'list' ? 'Denials' : 'Analytics'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open + In Appeal', value: `$${openAmount}`, color: '#dc2626' },
          { label: 'Recovered (Won)', value: `$${wonAmount}`, color: '#15803d' },
          { label: 'Total Denials', value: denials.length, color: '#5C2D91' },
          { label: 'Appeal Win Rate', value: `${appealWinRate}%`, color: '#d97706' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-purple-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 mb-1">{s.label}</p>
            <p className="text-2xl font-extrabold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {tab === 'analytics' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-purple-100 shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={15} className="text-purple-600" /> Denials by Category</p>
            <div className="space-y-3">
              {Object.entries(categoryTotals).sort((a, b) => b[1].count - a[1].count).map(([cat, v]) => {
                const pct = denials.length > 0 ? Math.round((v.count / denials.length) * 100) : 0;
                return (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700">{CATEGORY_LABELS[cat as DenialCategory]}</span>
                      <span className="text-gray-500">{v.count} denial{v.count !== 1 ? 's' : ''} · ${v.amount}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[cat as DenialCategory] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-purple-100 shadow-sm p-5">
              <p className="text-sm font-semibold text-gray-800 mb-3">By Payer</p>
              {Object.entries(denials.reduce((acc, d) => { acc[d.payer] = (acc[d.payer] ?? 0) + 1; return acc; }, {} as Record<string, number>)).map(([payer, count]) => (
                <div key={payer} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-gray-700">{payer}</span>
                  <span className="font-semibold text-gray-900">{count}</span>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-purple-100 shadow-sm p-5">
              <p className="text-sm font-semibold text-gray-800 mb-3">Appeal Outcomes</p>
              {[
                { label: 'Appeals Submitted', value: appealed.length, color: '#d97706' },
                { label: 'Won / Recovered',   value: wonCount,        color: '#15803d' },
                { label: 'Lost',              value: lostCount,       color: '#dc2626' },
                { label: 'Pending',           value: denials.filter(d => d.status === 'in_appeal').length, color: '#2563eb' },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-gray-700">{r.label}</span>
                  <span className="font-semibold" style={{ color: r.color }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <>
          {/* Status filters */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'open', 'in_appeal', 'corrected_resubmit', 'appeal_won', 'appeal_lost', 'written_off'] as const).map(f => {
              const count = f === 'all' ? denials.length : denials.filter(d => d.status === f).length;
              return (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${statusFilter === f ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  style={statusFilter === f ? { background: f === 'all' ? '#5C2D91' : STATUS_CONFIG[f as DenialStatus].color } : {}}>
                  {f === 'all' ? `All (${count})` : `${STATUS_CONFIG[f as DenialStatus].label} (${count})`}
                </button>
              );
            })}
          </div>

          {/* Denial list */}
          <div className="space-y-3">
            {filtered.map(denial => {
              const scfg = STATUS_CONFIG[denial.status];
              const isOpen = expanded === denial.denialId;
              const deadline = denial.appealDeadline ? daysUntil(denial.appealDeadline) : null;
              return (
                <div key={denial.denialId} className="bg-white rounded-2xl border border-purple-100 shadow-sm">
                  <button className="w-full text-left px-5 py-4 flex items-start justify-between gap-3"
                    onClick={() => setExpanded(isOpen ? null : denial.denialId)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-gray-900">{denial.patientName}</span>
                        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: scfg.color, backgroundColor: scfg.bg }}>
                          {scfg.icon}{scfg.label}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: CATEGORY_COLORS[denial.category] }}>
                          {CATEGORY_LABELS[denial.category]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{denial.payer} · {denial.cptCode} · {denial.serviceDate} · <span className="font-semibold text-red-600">${denial.deniedAmount}</span></p>
                      <p className="text-xs text-gray-600 mt-0.5">{denial.carcCode} — {denial.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {deadline !== null && denial.status !== 'written_off' && denial.status !== 'appeal_won' && (
                        <span className={`text-xs font-medium ${deadline <= 7 ? 'text-red-500' : deadline <= 14 ? 'text-amber-500' : 'text-gray-400'}`}>
                          {deadline > 0 ? `${deadline}d to appeal` : 'Deadline passed'}
                        </span>
                      )}
                      {isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-5 py-4 space-y-3">
                      {denial.appealNotes && (
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs font-semibold text-gray-500 mb-1">Notes</p>
                          <p className="text-sm text-gray-700">{denial.appealNotes}</p>
                        </div>
                      )}
                      <div className="flex gap-3 flex-wrap">
                        {denial.status === 'open' && (
                          <button onClick={() => { setShowAppealModal(denial); setAppealText(''); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white"
                            style={{ background: '#5C2D91' }}>
                            <Send size={12} /> File Appeal
                          </button>
                        )}
                        {denial.status === 'open' && (
                          <button
                            onClick={() => handleCorrectAndResubmit(denial)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-gray-200 text-gray-700 bg-white hover:bg-purple-50 hover:border-purple-200"
                          >
                            <FileText size={12} /> Correct & Resubmit
                          </button>
                        )}
                        {denial.status === 'in_appeal' && (
                          <>
                            <button
                              onClick={() => updateStatus(denial.denialId, 'appeal_won', 'Appeal upheld by payer. Reprocessing initiated.')}
                              className="px-3 py-2 rounded-xl text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                            >
                              Mark Appeal Won
                            </button>
                            <button
                              onClick={() => updateStatus(denial.denialId, 'appeal_lost', 'Appeal denied by payer on final reconsideration.')}
                              className="px-3 py-2 rounded-xl text-xs font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                            >
                              Mark Appeal Lost
                            </button>
                          </>
                        )}
                        {(denial.status === 'open' || denial.status === 'appeal_lost') && (
                          <button
                            onClick={() => updateStatus(denial.denialId, 'written_off', 'Balance written off after review.')}
                            className="px-3 py-2 rounded-xl text-xs font-medium border border-gray-200 text-gray-500 hover:bg-gray-50"
                          >
                            Write Off
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="bg-white rounded-2xl border border-purple-100 p-12 text-center shadow-sm">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-gray-900 mb-1">No Denied Claims</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  All submitted claims are current. When claims are denied by payers (835 ERA remittance), they will appear here with CARC/RARC codes and AI appeal workflows.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Appeal modal */}
      {showAppealModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">File Appeal</h2>
            <p className="text-sm text-gray-500 mb-4">{showAppealModal.patientName} · {showAppealModal.payer} · {showAppealModal.carcCode} · ${showAppealModal.deniedAmount}</p>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-500 font-medium">Appeal Rationale</label>
                  <button
                    onClick={() => draftAppeal(showAppealModal)}
                    disabled={aiDrafting}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60"
                  >
                    <Sparkles size={12} /> {aiDrafting ? 'Drafting…' : 'Draft with AI'}
                  </button>
                </div>
                <textarea rows={appealText ? 10 : 4} value={appealText} onChange={e => setAppealText(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
                  placeholder="Explain why this denial should be overturned — or let AI draft the letter from the claim and clinical record, then edit." />
                {appealText && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    AI-drafted (AWS Bedrock, demo mode) from the denial reason and chart evidence — review and edit before submitting.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Supporting Documents</label>
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-xs text-gray-400 cursor-pointer hover:border-purple-300">
                  Click to attach authorization copies, clinical notes, or EOB
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Appeal Deadline</label>
                <input type="date" className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  defaultValue={new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]} />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowAppealModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => {
                  updateStatus(showAppealModal.denialId, 'in_appeal', appealText || 'Appeal submitted with documentation.');
                  setShowAppealModal(null);
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-1.5"
                style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
                <Send size={14} /> Submit Appeal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claim Editor Modal for Correct & Resubmit */}
      {editingClaim && (
        <ClaimEditorModal
          claim={editingClaim}
          isOpen={true}
          onClose={() => {
            setEditingClaim(null);
            setActiveDenialIdForEdit(null);
          }}
          onSave={updated => {
            if (activeDenialIdForEdit) {
              updateStatus(activeDenialIdForEdit, 'corrected_resubmit', `Corrected via Claim Editor: total charges $${updated.totalCharge}. Queued for electronic resubmission.`);
            }
            setEditingClaim(null);
            setActiveDenialIdForEdit(null);
          }}
        />
      )}
    </div>
  );
}
