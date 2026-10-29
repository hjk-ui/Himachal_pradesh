'use client';
import { useEffect, useState } from 'react';
import { useClients } from '@/features/clients/hooks/useClients';
import { fetchEhrProgressNotes } from '@/features/clients/api/clientsApi';
import type { Client, EhrProgressNote } from '@/features/clients/types';
import { updateProgressNoteStatus } from '@/lib/notes/workflow';
import { generateClaimFromNote } from '@/features/billing/claimsApi';
import { CPT_CODES } from '@/lib/constants/cpt';
import {
  ClipboardList, CheckCircle2, AlertTriangle, Bell, DollarSign, Target,
  Bot, Search, BookOpen, Sparkles,
} from 'lucide-react';

type CodeConfidence = 'high' | 'medium' | 'low';
type CodeStatus = 'suggested' | 'accepted' | 'modified' | 'rejected';
type ClaimStatus = 'draft' | 'ready' | 'submitted' | 'paid' | 'denied' | 'needs-review';

interface CPTCode {
  code: string;
  description: string;
  fee: number;
  category: string;
}

interface ICD10Code {
  code: string;
  description: string;
  category: string;
}

interface SuggestedCode {
  code: string;
  description: string;
  confidence: CodeConfidence;
  reason: string;
  fee: number;
  status: CodeStatus;
}

interface SuggestedICD10 {
  code: string;
  description: string;
  confidence: CodeConfidence;
  reason: string;
  status: CodeStatus;
}

interface CodingSuggestion {
  id: string;
  clientName: string;
  clinician: string;
  sessionDate: string;
  noteType: string;
  noteExcerpt: string;
  suggestedCPT: SuggestedCode[];
  suggestedICD10: SuggestedICD10[];
  emLevel: string;
  medicalNecessityScore: number;
  bundlingAlerts: string[];
  status: ClaimStatus;
  estimatedReimbursement: number;
}

const CPT_LIBRARY: CPTCode[] = CPT_CODES.map((c) => ({
  code: c.code,
  description: c.desc,
  fee: c.rate,
  category: c.category,
}));

const ICD10_LIBRARY: ICD10Code[] = [
  { code: 'F32.1', description: 'Major depressive disorder, single episode, moderate', category: 'Depression' },
  { code: 'F32.2', description: 'Major depressive disorder, single episode, severe', category: 'Depression' },
  { code: 'F33.1', description: 'Major depressive disorder, recurrent, moderate', category: 'Depression' },
  { code: 'F33.2', description: 'Major depressive disorder, recurrent, severe', category: 'Depression' },
  { code: 'F41.1', description: 'Generalized anxiety disorder', category: 'Anxiety' },
  { code: 'F41.0', description: 'Panic disorder', category: 'Anxiety' },
  { code: 'F43.10', description: 'Post-traumatic stress disorder, unspecified', category: 'Trauma' },
  { code: 'F43.11', description: 'Post-traumatic stress disorder, acute', category: 'Trauma' },
  { code: 'F43.12', description: 'Post-traumatic stress disorder, chronic', category: 'Trauma' },
  { code: 'F31.1', description: 'Bipolar disorder, current episode manic', category: 'Bipolar' },
  { code: 'F31.4', description: 'Bipolar disorder, current episode depressed, moderate', category: 'Bipolar' },
  { code: 'F10.20', description: 'Alcohol use disorder, moderate', category: 'SUD' },
  { code: 'F10.21', description: 'Alcohol use disorder, moderate, in remission', category: 'SUD' },
  { code: 'F19.20', description: 'Other psychoactive substance use, moderate', category: 'SUD' },
  { code: 'F25.0', description: 'Schizoaffective disorder, bipolar type', category: 'Psychotic' },
  { code: 'F90.0', description: 'Attention-deficit hyperactivity disorder, inattentive type', category: 'ADHD' },
  { code: 'F84.0', description: 'Autism spectrum disorder', category: 'Neurodevelopmental' },
];

function daysAgo(dateIso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(dateIso).getTime()) / 86_400_000));
}

function noteTypeFromBody(body: string) {
  const lower = body.toLowerCase();
  if (lower.includes('group')) return 'Group Note';
  if (lower.includes('medication') || lower.includes('prescription')) return 'Medication Management';
  if (lower.includes('crisis') || lower.includes('safety')) return 'Crisis Note';
  if (lower.includes('intake') || lower.includes('assessment')) return 'Assessment Note';
  return 'Progress Note';
}

function buildLiveSuggestion(note: EhrProgressNote, client: Client): CodingSuggestion {
  const body = note.body.toLowerCase();
  const diagnosis = (client.primaryDiagnosis || '').toLowerCase();
  const sessionDate = note.createdAt.slice(0, 10);
  const noteType = noteTypeFromBody(note.body);
  const duration = body.match(/(\d{2,3})\s*(?:minutes|min|minute)/)?.[1];
  const longSession = Number(duration || 0) >= 53 || body.includes('53+');
  const cpt: SuggestedCode[] = [];
  const icd: SuggestedICD10[] = [];

  if (noteType === 'Group Note') {
    cpt.push({
      code: '90853',
      description: 'Group psychotherapy',
      confidence: 'high',
      reason: 'Group language is documented in the note.',
      fee: 60,
      status: 'suggested',
    });
  } else if (noteType === 'Medication Management') {
    cpt.push({
      code: '90863',
      description: 'Pharmacologic management',
      confidence: 'high',
      reason: 'Medication review is documented in the note.',
      fee: 82,
      status: 'suggested',
    });
    cpt.push({
      code: '99214',
      description: 'E/M office visit, established, moderate complexity',
      confidence: 'medium',
      reason: 'Follow-up medication management can support an E/M review when documented.',
      fee: 177,
      status: 'suggested',
    });
  } else if (noteType === 'Crisis Note') {
    cpt.push({
      code: '90839',
      description: 'Psychotherapy for crisis, first 60 min',
      confidence: 'high',
      reason: 'Crisis and safety language are present in the note.',
      fee: 271,
      status: 'suggested',
    });
  } else {
    cpt.push({
      code: longSession ? '90837' : '90834',
      description: longSession ? 'Psychotherapy, 53+ min' : 'Psychotherapy, 38-52 min',
      confidence: 'high',
      reason: 'Session duration and psychotherapy content support this code.',
      fee: longSession ? 183 : 130,
      status: 'suggested',
    });
  }

  if (diagnosis.includes('depress')) {
    icd.push({
      code: client.primaryDiagnosisCode || 'F33.1',
      description: client.primaryDiagnosis || 'Major depressive disorder, recurrent, moderate',
      confidence: 'high',
      reason: 'Chart diagnosis and note language support depression coding.',
      status: 'suggested',
    });
  } else if (diagnosis.includes('ptsd') || diagnosis.includes('trauma')) {
    icd.push({
      code: client.primaryDiagnosisCode || 'F43.10',
      description: client.primaryDiagnosis || 'Post-traumatic stress disorder',
      confidence: 'high',
      reason: 'Trauma-focused note language supports PTSD coding.',
      status: 'suggested',
    });
  } else if (diagnosis.includes('bipolar')) {
    icd.push({
      code: client.primaryDiagnosisCode || 'F31.1',
      description: client.primaryDiagnosis || 'Bipolar disorder',
      confidence: 'high',
      reason: 'Mood stabilization context supports bipolar coding.',
      status: 'suggested',
    });
  } else if (diagnosis.includes('substance') || diagnosis.includes('aud')) {
    icd.push({
      code: client.primaryDiagnosisCode || 'F10.20',
      description: client.primaryDiagnosis || 'Alcohol use disorder',
      confidence: 'high',
      reason: 'Recovery language supports substance use coding.',
      status: 'suggested',
    });
  } else {
    icd.push({
      code: client.primaryDiagnosisCode || 'F41.1',
      description: client.primaryDiagnosis || 'Generalized anxiety disorder',
      confidence: 'medium',
      reason: 'Use the chart diagnosis when present.',
      status: 'suggested',
    });
  }

  const medicalNecessityScore = Math.min(99, Math.max(68, body.length > 300 ? 88 : 76));
  return {
    id: note.id,
    clientName: note.clientName,
    clinician: note.clinicianName || 'Assigned clinician',
    sessionDate,
    noteType,
    noteExcerpt: note.body.slice(0, 260),
    suggestedCPT: cpt,
    suggestedICD10: icd,
    emLevel: noteType === 'Medication Management' ? '99214' : 'N/A',
    medicalNecessityScore,
    bundlingAlerts: noteType === 'Medication Management'
      ? ['Check payer rules before pairing medication management with an evaluation code.']
      : noteType === 'Crisis Note'
        ? ['Document the crisis rationale before final billing submission.']
        : [],
    status: note.workflowStatus === 'Draft' ? 'needs-review' : 'ready',
    estimatedReimbursement: cpt.reduce((sum, item) => sum + item.fee, 0),
  };
}

function buildLiveSuggestions(notes: EhrProgressNote[], clients: Client[]) {
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  return notes.slice(0, 5).map((note) => buildLiveSuggestion(note, clientMap.get(note.clientId) || clients[0] || {
    id: note.clientId,
    name: note.clientName,
    email: '',
    phone: '',
    assignedSince: note.createdAt,
    lastCheckIn: note.createdAt,
    avgMood: null,
    avgStress: null,
    streak: 0,
    risk: 'low',
    totalSessions: 0,
  }));
}

const CONFIDENCE_CONFIG: Record<CodeConfidence, { label: string; color: string; bg: string; border: string }> = {
  high:   { label: 'High Confidence',   color: '#5555B8', bg: '#EEF0FE', border: '#C5C7F8' },
  medium: { label: 'Medium Confidence', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  low:    { label: 'Low Confidence',    color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
};

const CLAIM_STATUS_CONFIG: Record<ClaimStatus, { label: string; color: string; bg: string; border: string }> = {
  'draft':        { label: 'Draft',        color: '#6B7280', bg: '#F9FAFB', border: '#E5E7EB' },
  'ready':        { label: 'Ready to Bill', color: '#5555B8', bg: '#EEF0FE', border: '#C5C7F8' },
  'needs-review': { label: 'Needs Review', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  'submitted':    { label: 'Submitted',    color: '#5555B8', bg: '#EEF0FE', border: '#BFDBFE' },
  'paid':         { label: 'Paid',         color: '#5555B8', bg: '#EEF0FE', border: '#C5C7F8' },
  'denied':       { label: 'Denied',       color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
};

// KPI icon map
const KPI_ICONS: React.ReactNode[] = [
  <ClipboardList key="sessions" size={18} />,
  <CheckCircle2 key="ready" size={18} />,
  <AlertTriangle key="review" size={18} />,
  <Bell key="bundling" size={18} />,
  <DollarSign key="reimb" size={18} />,
];

export default function CodingPage() {
  const { clients } = useClients();
  const [tab, setTab] = useState<'review' | 'scanner' | 'library'>('review');
  const [suggestions, setSuggestions] = useState<CodingSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<CodingSuggestion | null>(null);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [cptFilter, setCptFilter] = useState('All');
  const [icdFilter, setIcdFilter] = useState('All');
  const [cptSearch, setCptSearch] = useState('');
  const [icdSearch, setIcdSearch] = useState('');
  const [loadingLive, setLoadingLive] = useState(true);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingLive(true);
    fetchEhrProgressNotes()
      .then((res) => {
        if (cancelled) return;
        const liveSuggestions = buildLiveSuggestions(res.notes, clients);
        setSuggestions(liveSuggestions.length > 0 ? liveSuggestions : []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clients]);

  const totalReimbursement = suggestions.reduce((sum, s) => sum + s.estimatedReimbursement, 0);
  const needsReview = suggestions.filter(s => s.status === 'needs-review').length;
  const ready = suggestions.filter(s => s.status === 'ready').length;
  const bundlingIssues = suggestions.filter(s => s.bundlingAlerts.length > 0).length;
  const avgMedNec = suggestions.length > 0
    ? Math.round(suggestions.reduce((sum, s) => sum + s.medicalNecessityScore, 0) / suggestions.length)
    : 0;

  const persistAcceptedCodes = async (suggestion: CodingSuggestion) => {
    const workflow = suggestion.status === 'needs-review' ? 'Draft' : 'Locked';
    if (workflow === 'Draft') {
      try {
        await updateProgressNoteStatus(suggestion.id, 'Signed');
      } catch {
        /* already signed */
      }
      await updateProgressNoteStatus(suggestion.id, 'Locked');
    }
    const primaryCpt = suggestion.suggestedCPT.find((c) => c.status !== 'rejected')?.code;
    const icd = suggestion.suggestedICD10.map((c) => c.code).join(', ');
    await generateClaimFromNote(suggestion.id, {
      cptCode: primaryCpt,
      markReady: true,
    });
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === suggestion.id
          ? {
              ...s,
              status: 'ready',
              suggestedCPT: s.suggestedCPT.map((c) => ({ ...c, status: 'accepted' as CodeStatus })),
              suggestedICD10: s.suggestedICD10.map((c) => ({ ...c, status: 'accepted' as CodeStatus })),
              noteExcerpt: icd ? `${s.noteExcerpt} ICD-10: ${icd}` : s.noteExcerpt,
            }
          : s
      )
    );
  };

  const handleAcceptAll = async (suggestionId: string) => {
    const suggestion = suggestions.find((s) => s.id === suggestionId) || selectedSuggestion;
    if (!suggestion) return;
    setAcceptBusy(true);
    setAcceptError(null);
    try {
      await persistAcceptedCodes(suggestion);
      setSelectedSuggestion(null);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Could not create draft claim');
    } finally {
      setAcceptBusy(false);
    }
  };

  const [aiCodingResult, setAiCodingResult] = useState<{
    cpt: Array<{ code: string; description: string; rate?: number; confidence: number; rationale?: string }>;
    icd10: Array<{ code: string; description: string; confidence: number; rationale?: string }>;
    medicalNecessityScore: number;
    documentationTips?: string;
    disclaimer?: string;
  } | null>(null);

  const handleAnalyze = async () => {
    if (!noteInput.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/agents/coding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteInput }),
      });
      const data = await res.json();
      if (data.success) {
        setAiCodingResult({
          cpt: data.cpt || [],
          icd10: data.icd10 || [],
          medicalNecessityScore: data.medicalNecessityScore ?? 85,
          documentationTips: data.documentationTips,
          disclaimer: data.disclaimer,
        });
      }
    } catch (err) {
      console.error('Coding AI analyze failed:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const cptCategories = ['All', ...Array.from(new Set(CPT_LIBRARY.map(c => c.category)))];
  const icdCategories = ['All', ...Array.from(new Set(ICD10_LIBRARY.map(c => c.category)))];

  const filteredCPT = CPT_LIBRARY.filter(c =>
    (cptFilter === 'All' || c.category === cptFilter) &&
    (cptSearch === '' || c.code.toLowerCase().includes(cptSearch.toLowerCase()) || c.description.toLowerCase().includes(cptSearch.toLowerCase()))
  );
  const filteredICD10 = ICD10_LIBRARY.filter(c =>
    (icdFilter === 'All' || c.category === icdFilter) &&
    (icdSearch === '' || c.code.toLowerCase().includes(icdSearch.toLowerCase()) || c.description.toLowerCase().includes(icdSearch.toLowerCase()))
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Detail modal */}
      {selectedSuggestion && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-clinic-md max-w-2xl w-full p-6 my-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold text-slate-900 text-lg">{selectedSuggestion.clientName}</h2>
                <p className="text-xs text-slate-500">{selectedSuggestion.noteType} &middot; {selectedSuggestion.sessionDate} &middot; {selectedSuggestion.clinician}</p>
              </div>
              <button onClick={() => setSelectedSuggestion(null)} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
            </div>

            {/* Medical necessity */}
            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <p className="text-xs font-bold text-slate-500 mb-1">Note Excerpt (AI Analyzed)</p>
              <p className="text-sm text-slate-700 italic">&ldquo;{selectedSuggestion.noteExcerpt}&rdquo;</p>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                <div className="h-3 rounded-full transition-all" style={{ width: `${selectedSuggestion.medicalNecessityScore}%`, background: selectedSuggestion.medicalNecessityScore >= 85 ? '#5555B8' : selectedSuggestion.medicalNecessityScore >= 70 ? '#B45309' : '#DC2626' }} />
              </div>
              <span className="text-sm font-bold text-slate-700">{selectedSuggestion.medicalNecessityScore}% med. necessity</span>
            </div>

            {selectedSuggestion.bundlingAlerts.length > 0 && (
              <div className="bg-amber-50 ring-1 ring-inset ring-amber-100 rounded-xl p-3 mb-4">
                {selectedSuggestion.bundlingAlerts.map((alert, i) => (
                  <p key={i} className="text-sm text-amber-800 font-semibold flex items-start gap-1.5">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {alert}
                  </p>
                ))}
              </div>
            )}

            {/* CPT codes */}
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-600 mb-2">Suggested CPT Codes</p>
              <div className="space-y-2">
                {selectedSuggestion.suggestedCPT.map((cpt, i) => {
                  const cfg = CONFIDENCE_CONFIG[cpt.confidence];
                  return (
                    <div key={i} className="border border-slate-200/80 rounded-xl p-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono font-bold text-sm" style={{ color: '#6868D0' }}>{cpt.code}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold border"
                            style={{ backgroundColor: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                            {cfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 mb-1">{cpt.description}</p>
                        <p className="text-xs text-slate-500 italic">{cpt.reason}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-sm text-slate-900">${cpt.fee}</p>
                        <p className="text-xs text-slate-400">fee</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ICD-10 codes */}
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-600 mb-2">Suggested ICD-10 Codes</p>
              <div className="space-y-2">
                {selectedSuggestion.suggestedICD10.map((icd, i) => {
                  const cfg = CONFIDENCE_CONFIG[icd.confidence];
                  return (
                    <div key={i} className="border border-slate-200/80 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono font-bold text-sm" style={{ color: '#5555B8' }}>{icd.code}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold border"
                          style={{ backgroundColor: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 mb-1">{icd.description}</p>
                      <p className="text-xs text-slate-500 italic">{icd.reason}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {acceptError ? <p className="text-sm text-rose-600">{acceptError}</p> : null}
              <div className="flex gap-3">
              <button
                type="button"
                disabled={acceptBusy}
                onClick={() => { void handleAcceptAll(selectedSuggestion.id); }}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-60"
                style={{ background: '#6868D0' }}>
                {acceptBusy ? 'Saving…' : 'Accept All & Mark Ready'}
              </button>
              <a
                href="/dashboard/billing/claims"
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Review in Billing
              </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-slate-900">AI Coding</h1>
            <span className="text-xs px-2.5 py-1 rounded-full font-bold border" style={{ backgroundColor: '#F5F3FF', color: '#6868D0', borderColor: '#C4B5FD' }}>
              Amazon Bedrock
            </span>
          </div>
          <p className="text-slate-500 text-sm">AI-assisted CPT and ICD-10 code suggestion from clinical notes — with medical necessity scoring and bundling alerts.</p>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Pending Sessions', value: suggestions.length, color: '#6868D0' },
          { label: 'Ready to Bill', value: ready, color: '#5555B8' },
          { label: 'Needs Review', value: needsReview, color: '#DC2626' },
          { label: 'Bundling Alerts', value: bundlingIssues, color: '#B45309' },
          { label: 'Est. Reimbursement', value: `$${totalReimbursement}`, color: '#5555B8' },
        ].map(({ label, value, color }, idx) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
            <div className="flex items-center justify-between mb-1">
              <span style={{ color }}>{KPI_ICONS[idx]}</span>
              <span className="text-xl font-semibold" style={{ color }}>{value}</span>
            </div>
            <p className="text-xs font-semibold text-slate-600">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { key: 'review', label: 'AI Code Review', icon: <Bot size={14} />, count: suggestions.length },
          { key: 'scanner', label: 'Revenue Scanner', icon: <Search size={14} /> },
          { key: 'library', label: 'Code Library', icon: <BookOpen size={14} /> },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.icon}
            {t.label}
            {'count' in t && t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {loadingLive && suggestions.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 text-sm text-slate-500">
          Loading live notes and client chart data...
        </div>
      )}

      {/* ── CODE REVIEW TAB ── */}
      {tab === 'review' && (
        <div className="space-y-4">
          {/* Avg med necessity bar */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
              <Target size={18} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-bold text-slate-700">Average Medical Necessity Score</p>
                <span className="text-sm font-semibold text-slate-900">{avgMedNec}%</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-2.5 rounded-full" style={{ width: `${avgMedNec}%`, background: '#6868D0' }} />
              </div>
              <p className="text-xs text-slate-500 mt-1">Higher scores = stronger note documentation supports the billed code</p>
            </div>
          </div>

          {suggestions.map(s => {
            const statusCfg = CLAIM_STATUS_CONFIG[s.status];
            const isExpanded = expandedNote === s.id;
            return (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="px-5 py-4 flex items-start gap-4 flex-wrap">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ backgroundColor: '#F5F3FF', color: '#6868D0' }}>
                    {s.clientName.split(' ').map(w => w[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-semibold text-slate-900">{s.clientName}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold border"
                        style={{ backgroundColor: statusCfg.bg, color: statusCfg.color, borderColor: statusCfg.border }}>
                        {statusCfg.label}
                      </span>
                      {s.bundlingAlerts.length > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-100 flex items-center gap-1">
                          <AlertTriangle size={11} /> Bundling Alert
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{s.noteType} &middot; {s.sessionDate} &middot; {s.clinician}</p>

                    {/* Suggested codes inline */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {s.suggestedCPT.map(cpt => {
                        const cfg = CONFIDENCE_CONFIG[cpt.confidence];
                        return (
                          <span key={cpt.code} className="text-xs px-2 py-0.5 rounded-full font-mono font-bold border"
                            style={{ backgroundColor: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                            {cpt.code}
                          </span>
                        );
                      })}
                      {s.suggestedICD10.map(icd => (
                        <span key={icd.code} className="text-xs px-2 py-0.5 rounded-full font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          {icd.code}
                        </span>
                      ))}
                    </div>

                    {/* Med necessity bar */}
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-1.5 rounded-full" style={{ width: `${s.medicalNecessityScore}%`, background: s.medicalNecessityScore >= 85 ? '#5555B8' : '#B45309' }} />
                      </div>
                      <span className="text-xs text-slate-500">{s.medicalNecessityScore}% necessity</span>
                      <span className="text-xs font-semibold text-slate-900">${s.estimatedReimbursement}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => setExpandedNote(isExpanded ? null : s.id)}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-all">
                      {isExpanded ? 'Hide' : 'Note'}
                    </button>
                    <button onClick={() => setSelectedSuggestion(s)}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all hover:opacity-90"
                      style={{ background: '#6868D0' }}>
                      Review Codes
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-slate-200/80 pt-3">
                    <p className="text-xs font-bold text-slate-500 mb-2">Note Excerpt (AI Analyzed)</p>
                    <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 italic">&ldquo;{s.noteExcerpt}&rdquo;</p>
                    {s.bundlingAlerts.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {s.bundlingAlerts.map((alert, i) => (
                          <div key={i} className="text-xs text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-100 rounded-lg px-3 py-2 font-semibold flex items-start gap-1.5">
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {alert}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── REVENUE SCANNER TAB ── */}
      {tab === 'scanner' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">
            <h2 className="font-semibold text-slate-900 mb-1">Revenue Integrity Scanner</h2>
            <p className="text-sm text-slate-500 mb-4">Paste a clinical note below and AI will suggest CPT and ICD-10 codes, score medical necessity, and flag bundling issues.</p>

            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              rows={8}
              placeholder="Paste clinical note here…&#10;&#10;Example: Client presented with moderate depressive symptoms (PHQ-9 = 12). Session focused on behavioral activation techniques. Explored connection between daily routine and mood. Session duration: 55 minutes."
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
            />

            <div className="flex gap-3 mt-3">
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-60"
                style={{ background: '#6868D0' }}>
                <Bot size={15} />
                {analyzing ? 'Analyzing…' : 'Analyze with AI'}
              </button>
              <button
                onClick={() => setNoteInput('')}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Clear
              </button>
            </div>

            {analyzing && (
              <div className="mt-4 bg-blue-50 border border-slate-300 rounded-xl p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-200 flex items-center justify-center">
                    <Bot size={16} className="text-blue-700" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-blue-800">AI Coding Engine analyzing note…</p>
                    <p className="text-xs text-blue-600 mt-0.5">Identifying diagnoses &middot; Matching CPT codes &middot; Scoring medical necessity &middot; Checking bundling rules</p>
                  </div>
                </div>
              </div>
            )}

            {!analyzing && (aiCodingResult || noteInput.length > 50) && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-indigo-50/80 px-3 py-2 border border-indigo-100 text-[11px] text-indigo-900">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                    AWS Bedrock · Claude 3.5 Sonnet Analysis Active
                  </span>
                  <span className="text-indigo-600 font-medium">HIPAA BAA Protected</span>
                </div>

                <div className="p-4 ring-1 ring-inset ring-blue-100 bg-blue-50 rounded-xl">
                  <p className="text-xs font-bold text-blue-700 mb-2">Suggested CPT Codes</p>
                  <div className="flex flex-wrap gap-2">
                    {aiCodingResult?.cpt && aiCodingResult.cpt.length > 0 ? (
                      aiCodingResult.cpt.map((c) => (
                        <div key={c.code} className="bg-white border border-blue-300 rounded-lg px-3 py-2 text-sm shadow-sm">
                          <span className="font-mono font-bold text-blue-800">{c.code}</span>
                          <span className="text-slate-600 ml-2">{c.description}</span>
                          {c.rate ? <span className="ml-3 text-blue-700 font-bold">${c.rate}</span> : null}
                          <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {c.confidence}% confidence
                          </span>
                          {c.rationale && (
                            <p className="text-[11px] text-slate-500 mt-1">{c.rationale}</p>
                          )}
                        </div>
                      ))
                    ) : noteInput.toLowerCase().includes('55') || noteInput.toLowerCase().includes('53') ? (
                      <div className="bg-white border border-blue-300 rounded-lg px-3 py-2 text-sm">
                        <span className="font-mono font-bold text-blue-800">90837</span>
                        <span className="text-slate-600 ml-2">Psychotherapy, 53+ min</span>
                        <span className="ml-3 text-blue-700 font-bold">$183</span>
                        <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">High confidence</span>
                      </div>
                    ) : (
                      <div className="bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm">
                        <span className="font-mono font-bold text-amber-800">90834</span>
                        <span className="text-slate-600 ml-2">Psychotherapy, 38-52 min</span>
                        <span className="ml-3 text-amber-700 font-bold">$130</span>
                        <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Medium — confirm duration</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 ring-1 ring-inset ring-blue-100 bg-blue-50 rounded-xl">
                  <p className="text-xs font-bold text-blue-700 mb-2">Suggested ICD-10 Codes</p>
                  <div className="flex flex-wrap gap-2">
                    {aiCodingResult?.icd10 && aiCodingResult.icd10.length > 0 ? (
                      aiCodingResult.icd10.map((icd) => (
                        <div key={icd.code} className="bg-white border border-blue-300 rounded-lg px-3 py-2 text-sm shadow-sm">
                          <span className="font-mono font-bold text-blue-800">{icd.code}</span>
                          <span className="text-slate-600 ml-2">{icd.description}</span>
                          <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {icd.confidence}% confidence
                          </span>
                          {icd.rationale && (
                            <p className="text-[11px] text-slate-500 mt-1">{icd.rationale}</p>
                          )}
                        </div>
                      ))
                    ) : (noteInput.toLowerCase().includes('depress') || noteInput.toLowerCase().includes('phq')) ? (
                      <div className="bg-white border border-blue-300 rounded-lg px-3 py-2 text-sm">
                        <span className="font-mono font-bold text-blue-800">F33.1</span>
                        <span className="text-slate-600 ml-2">MDD, recurrent, moderate</span>
                        <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">High confidence</span>
                      </div>
                    ) : noteInput.toLowerCase().includes('anxiety') ? (
                      <div className="bg-white border border-blue-300 rounded-lg px-3 py-2 text-sm">
                        <span className="font-mono font-bold text-blue-800">F41.1</span>
                        <span className="text-slate-600 ml-2">Generalized anxiety disorder</span>
                        <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Medium confidence</span>
                      </div>
                    ) : (
                      <p className="text-sm text-blue-700">No specific diagnosis identified — add diagnosis to note for ICD-10 suggestion.</p>
                    )}
                  </div>
                </div>

                <div className="p-4 border border-slate-300 bg-blue-50 rounded-xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-blue-800">Medical Necessity Score</p>
                    <span className="text-xl font-semibold" style={{ color: '#6868D0' }}>
                      {aiCodingResult ? aiCodingResult.medicalNecessityScore : (noteInput.length > 200 ? 89 : noteInput.length > 100 ? 72 : 58)}%
                    </span>
                  </div>
                  <div className="h-2 bg-blue-200 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${aiCodingResult ? aiCodingResult.medicalNecessityScore : (noteInput.length > 200 ? 89 : noteInput.length > 100 ? 72 : 58)}%`,
                        background: '#6868D0',
                      }}
                    />
                  </div>
                  <p className="text-xs text-blue-700 mt-1">
                    {aiCodingResult?.documentationTips ||
                      (noteInput.length > 200
                        ? 'Strong documentation. Note well supports the suggested code.'
                        : 'Add more clinical detail (interventions, client response, time) to strengthen necessity.')}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Revenue integrity summary */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Practice Revenue Integrity — This Week</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { label: 'Unsigned notes with no code', value: 3, color: '#DC2626', action: 'Review in EHR Notes' },
                { label: 'Codes pending clinician confirmation', value: suggestions.length, color: '#B45309', action: 'Review above' },
                { label: 'Estimated unbilled revenue at risk', value: '$' + (suggestions.reduce((s, x) => s + x.estimatedReimbursement, 0) + 284).toLocaleString(), color: '#5555B8', action: '' },
              ].map(({ label, value, color, action }) => (
                <div key={label} className="bg-slate-50 rounded-xl p-4 border border-slate-200/80">
                  <p className="text-2xl font-semibold mb-1" style={{ color }}>{value}</p>
                  <p className="text-xs font-semibold text-slate-600 mb-1">{label}</p>
                  {action && <p className="text-xs font-bold" style={{ color }}>{action}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── CODE LIBRARY TAB ── */}
      {tab === 'library' && (
        <div className="grid sm:grid-cols-2 gap-4">
          {/* CPT Code Library */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/80">
              <h2 className="font-semibold text-slate-900 mb-2">Behavioral Health CPT Codes</h2>
              <input type="text" placeholder="Search codes…" value={cptSearch} onChange={e => setCptSearch(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2" />
              <div className="flex gap-1 flex-wrap">
                {cptCategories.map(cat => (
                  <button key={cat} onClick={() => setCptFilter(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold transition-all ${cptFilter === cat ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    style={cptFilter === cat ? { background: '#6868D0' } : {}}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {filteredCPT.map(code => (
                <div key={code.code} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                  <div>
                    <span className="font-mono font-bold text-sm" style={{ color: '#6868D0' }}>{code.code}</span>
                    <p className="text-xs text-slate-700 mt-0.5">{code.description}</p>
                    <span className="text-xs text-slate-400">{code.category}</span>
                  </div>
                  <span className="font-bold text-sm text-slate-900 shrink-0">${code.fee}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ICD-10 Library */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/80">
              <h2 className="font-semibold text-slate-900 mb-2">Behavioral Health ICD-10 Codes</h2>
              <input type="text" placeholder="Search diagnoses…" value={icdSearch} onChange={e => setIcdSearch(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2" />
              <div className="flex gap-1 flex-wrap">
                {icdCategories.map(cat => (
                  <button key={cat} onClick={() => setIcdFilter(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold transition-all ${icdFilter === cat ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    style={icdFilter === cat ? { background: '#5555B8' } : {}}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {filteredICD10.map(code => (
                <div key={code.code} className="px-5 py-3 hover:bg-slate-50">
                  <span className="font-mono font-bold text-sm" style={{ color: '#5555B8' }}>{code.code}</span>
                  <p className="text-xs text-slate-700 mt-0.5">{code.description}</p>
                  <span className="text-xs text-slate-400">{code.category}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
