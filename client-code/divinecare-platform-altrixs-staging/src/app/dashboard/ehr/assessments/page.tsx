'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  AlertTriangle, 
  BarChart2, 
  BookOpen, 
  CheckCircle2, 
  ClipboardList, 
  Clock, 
  Download, 
  FileText, 
  Filter, 
  Info, 
  Plus, 
  Search, 
  ShieldAlert, 
  Sparkles, 
  User, 
  X 
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { AssessmentTrends } from '@/components/clinical/AssessmentTrends';
import { apiJson } from '@/lib/api-client';
import { useOfflineDraft } from '@/lib/offline/useOfflineDraft';
import { 
  ASSESSMENT_CATALOG, 
  AssessmentInstrument, 
  InstrumentCategory, 
  AdministrationType 
} from '@/features/ehr/assessments/catalog';
import { cardClasses, cx, PageHeader, buttonClasses, Alert } from '@/components/ui';



interface AssessmentRecord {
  id: string;
  clientId: string;
  clientName?: string;
  instrumentId: string;
  instrumentName: string;
  category: string;
  adminType: string;
  totalScore: number;
  maxScore?: number;
  severity: string;
  interpretation: string;
  safetyFlagged: boolean;
  safetyNotes?: string;
  clinicianVerified: boolean;
  notes?: string;
  respondentType?: string;
  completedAt: string;
  answers?: Record<string, number>;
}

const CATEGORIES: ('All' | InstrumentCategory)[] = [
  'All',
  'Depression & Mood',
  'Anxiety',
  'Trauma & Dissociation',
  'ADHD & Cognition',
  'Substance Use',
  'Safety',
  'Functioning & Sleep',
  'Medication Monitoring',
];

const ADMIN_TYPES: ('All' | AdministrationType)[] = ['All', 'Self-Report', 'Clinician-Rated'];

function getSeverityBadgeColor(severity: string) {
  const lower = severity.toLowerCase();
  if (lower.includes('high') || lower.includes('severe') || lower.includes('provisional ptsd') || lower.includes('probable') || lower.includes('likely depression') || lower.includes('extremely dissatisfied') || lower.includes('dependence')) {
    return 'bg-rose-100 text-rose-700 border-rose-200';
  }
  if (lower.includes('moderate') || lower.includes('hazardous') || lower.includes('positive') || lower.includes('intermediate') || lower.includes('poor wellbeing') || lower.includes('dissatisfied') || lower.includes('needed') || lower.includes('required')) {
    return 'bg-amber-100 text-amber-800 border-amber-200';
  }
  if (lower.includes('mild') || lower.includes('low')) {
    return 'bg-blue-100 text-blue-700 border-blue-200';
  }
  return 'bg-emerald-100 text-emerald-700 border-emerald-200';
}

export default function ClinicalAssessmentsPage() {
  const { clients, loading: clientsLoading, error: clientsError } = useClients();
  const { save: saveAssessmentOffline } = useOfflineDraft({
    url: '/api/clinical/assessments',
    onlinePost: async (body) =>
      apiJson<{ success: boolean; safetyFlagged?: boolean }>('/api/clinical/assessments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
  const historyRequest = useRef(0);
  const [activeTab, setActiveTab] = useState<'library' | 'history'>('library');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | InstrumentCategory>('All');
  const [selectedAdminType, setSelectedAdminType] = useState<'All' | AdministrationType>('All');

  // Modals & Drawers
  const [infoInstrument, setInfoInstrument] = useState<AssessmentInstrument | null>(null);
  const [digitalModalInst, setDigitalModalInst] = useState<AssessmentInstrument | null>(null);
  const [manualModalInst, setManualModalInst] = useState<AssessmentInstrument | null>(null);
  const [viewDetailRecord, setViewDetailRecord] = useState<AssessmentRecord | null>(null);

  useEffect(() => {
    if (!viewDetailRecord) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [viewDetailRecord]);

  // Digital Questionnaire State
  const [digitalAnswers, setDigitalAnswers] = useState<Record<string, number>>({});
  const [digitalNotes, setDigitalNotes] = useState('');
  const [digitalVerified, setDigitalVerified] = useState(false);

  // Manual Score State
  const [manualSafetyFlag, setManualSafetyFlag] = useState(false);
  const [manualScore, setManualScore] = useState<number>(0);
  const [manualSeverity, setManualSeverity] = useState('');
  const [manualInterpretation, setManualInterpretation] = useState('');
  const [manualRespondent, setManualRespondent] = useState('Client');
  const [manualNotes, setManualNotes] = useState('');
  const [manualVerified, setManualVerified] = useState(false);

  // History State
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alertNotice, setAlertNotice] = useState<string | null>(null);

  // Default client selection (?clientId= from the Visit Guide preselects that client)
  useEffect(() => {
    if (clients.length > 0 && !selectedClientId) {
      const requested = new URLSearchParams(window.location.search).get('clientId');
      setSelectedClientId(clients.find((c) => c.id === requested)?.id ?? clients[0].id);
    }
  }, [clients, selectedClientId]);

  // ?instrument=PHQ-9 (Visit Guide "Give PHQ-9"): filter the library to that instrument
  useEffect(() => {
    const instrument = new URLSearchParams(window.location.search).get('instrument');
    if (instrument) setSearchQuery(instrument);
  }, []);

  // Load history records
  const loadHistory = useCallback(async () => {
    const requestId = ++historyRequest.current;
    setRecords([]);
    if (!selectedClientId) { setLoadingHistory(false); return; }
    setLoadingHistory(true);
    try {
      const data = await apiJson<{ success: boolean; data: AssessmentRecord[] }>(`/api/clinical/assessments?clientId=${encodeURIComponent(selectedClientId)}`);
      if (requestId === historyRequest.current) setRecords(data.data);
    } catch (error) {
      if (requestId === historyRequest.current) setAlertNotice(error instanceof Error ? error.message : 'Could not load history');
    } finally { if (requestId === historyRequest.current) setLoadingHistory(false); }
  }, [selectedClientId]);
  useEffect(() => {
    const requests = historyRequest;
    void loadHistory();
    return () => { requests.current++; };
  }, [loadHistory]);

  // Filter Catalog Instruments
  const filteredCatalog = useMemo(() => {
    return ASSESSMENT_CATALOG.filter((inst) => {
      const matchesSearch = 
        inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inst.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inst.description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCat = selectedCategory === 'All' || inst.category === selectedCategory;
      const matchesAdmin = selectedAdminType === 'All' || inst.adminType === selectedAdminType;

      return matchesSearch && matchesCat && matchesAdmin;
    });
  }, [searchQuery, selectedCategory, selectedAdminType]);

  // Active Patient Name
  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // Digital Questionnaire Calculation
  const digitalResult = useMemo(() => {
    if (!digitalModalInst || !digitalModalInst.calculateResult) return null;
    return digitalModalInst.calculateResult(digitalAnswers);
  }, [digitalModalInst, digitalAnswers]);

  const handleDigitalSubmit = async () => {
    if (!digitalModalInst || !selectedClientId) return;
    if (!digitalVerified || !digitalModalInst.questions?.every(q => digitalAnswers[q.id] !== undefined)) { setAlertNotice('Answer every question and verify the assessment before saving.'); return; }
    setSubmitting(true);
    setAlertNotice(null);
    try {
      const result = digitalModalInst.calculateResult(digitalAnswers);
      const payload = {
        clientId: selectedClientId,
        instrumentId: digitalModalInst.id,
        instrumentName: digitalModalInst.name,
        category: digitalModalInst.category,
        administrationType: 'Digital',
        totalScore: result.totalScore,
        severity: result.severity,
        interpretation: result.interpretation,
        safetyFlagged: result.safetyFlagged,
        safetyNotes: result.safetyNotes,
        clinicianVerified: digitalVerified,
        notes: digitalNotes,
        answers: digitalAnswers,
        respondentType: 'Client',
      };

      const res = (await saveAssessmentOffline(payload, 'assessment')) as {
        success?: boolean;
        safetyFlagged?: boolean;
        offline?: boolean;
      };

      if (digitalModalInst.id === 'rms' && result.totalScore >= 5) {
        setAlertNotice('RMS ≥ 5: Screen Positive — Bipolar I. Consider administering MDQ and psychiatric referral.');
      } else if (res.safetyFlagged || result.safetyFlagged) {
        setAlertNotice(`High Risk Safety Flag: ${digitalModalInst.name} triggered a safety alert. Review clinical protocol.`);
      }
      if (res.offline) {
        setAlertNotice('Saved offline — will sync when back online.');
      }

      setDigitalModalInst(null);
      setDigitalAnswers({});
      setDigitalNotes('');
      loadHistory();
    } catch (err) {
      setAlertNotice(err instanceof Error ? err.message : 'Could not save assessment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualModalInst || !selectedClientId) return;
    if (!manualVerified || !Number.isFinite(manualScore) || manualScore < 0 || manualScore > (manualModalInst.maxScore ?? Infinity)) { setAlertNotice('Verify the paper record and enter a score within the instrument range.'); return; }
    setAlertNotice(null);
    setSubmitting(true);
    try {
      const payload = {
        clientId: selectedClientId,
        instrumentId: manualModalInst.id,
        instrumentName: manualModalInst.name,
        category: manualModalInst.category,
        administrationType: 'Manual',
        totalScore: Number(manualScore),
        severity: manualSeverity || 'Completed',
        interpretation: manualInterpretation || `${manualModalInst.name} score: ${manualScore}`,
        safetyFlagged: manualSafetyFlag,
        clinicianVerified: manualVerified,
        notes: manualNotes,
        respondentType: manualRespondent,
      };

      const offlineRes = (await saveAssessmentOffline(payload, 'assessment')) as {
        offline?: boolean;
      };
      if (offlineRes.offline) {
        setAlertNotice('Saved offline — will sync when back online.');
      }

      setManualModalInst(null);
      setManualScore(0);
      setManualSeverity('');
      setManualInterpretation('');
      setManualNotes('');
      loadHistory();
    } catch (err) {
      setAlertNotice(err instanceof Error ? err.message : 'Could not save assessment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">
      {clientsError && <Alert tone="danger">{clientsError}</Alert>}
      {!clientsLoading && !clients.length && <Alert tone="warning">No patients are available. Add or select an assigned patient before recording assessments.</Alert>}
      {/* Top Header */}
      <PageHeader
        title="Clinical Assessments"
        description={<>Standardized digital questionnaires, manual score entry, outcome measurement & longitudinal trend tracking.</>}
        actions={<>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <User size={16} className="text-slate-500" />
            <select
              disabled={Boolean(digitalModalInst || manualModalInst)} aria-label="Assessment patient" value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-800 focus:outline-none"
            >
              <option value="" disabled>Select Patient…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(0, 6)})
                </option>
              ))}
            </select>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('library')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'library'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen size={16} />
              Library
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'history'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart2 size={16} />
              History & Trends ({records.length})
            </button>
          </div>
        </div>
        </>}
      />

      {/* Alert Banner */}
      {alertNotice && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-center justify-between gap-3 animate-fadeIn">
          <div className="flex min-w-0 items-center gap-3">
            <ShieldAlert className="text-rose-600 shrink-0" size={22} />
            <p className="text-sm font-medium">{alertNotice}</p>
          </div>
          <button type="button" onClick={() => setAlertNotice(null)} aria-label="Dismiss alert" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-100 hover:text-rose-700">
            <X size={18} />
          </button>
        </div>
      )}

      {/* MAIN TAB: LIBRARY */}
      {activeTab === 'library' && (
        <div className="space-y-6">
          {/* Filters & Search Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3.5 top-3 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search instruments by title, full name, or keywords (e.g. PHQ-9, GAD-7, PTSD)…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter size={16} className="text-slate-500" />
                <select
                  aria-label="Assessment administration type" value={selectedAdminType}
                  onChange={(e) => setSelectedAdminType(e.target.value as any)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 focus:outline-none"
                >
                  {ADMIN_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type === 'All' ? 'All Types' : type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Category Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    selectedCategory === cat
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Instrument Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCatalog.map((inst) => (
              <div
                data-instrument={inst.id} key={inst.id}
                className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs hover:shadow-sm hover:border-blue-200 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-600 mb-1.5">
                        {inst.category}
                      </span>
                      <h3 className="text-lg font-bold text-slate-900">{inst.name}</h3>
                      <p className="text-xs text-slate-500 font-medium">{inst.fullName}</p>
                    </div>
                    <button
                      onClick={() => setInfoInstrument(inst)}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="View Instrument Details & Cutoffs"
                    >
                      <Info size={18} />
                    </button>
                  </div>

                  <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                    {inst.description}
                  </p>

                  <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 font-medium">
                    <span className="flex items-center gap-1">
                      <Clock size={13} className="text-slate-500" />
                      {inst.estimatedTime}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText size={13} className="text-slate-500" />
                      {inst.questionCount} Questions
                    </span>
                    <span className="px-2 py-0.5 bg-slate-100 rounded text-[11px]">
                      {inst.adminType}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-5 flex items-center gap-2 pt-3 border-t border-slate-100">
                  {inst.hasDigitalQuestionnaire ? (
                    <button
                      disabled={!selectedClientId}
                      onClick={() => {
                        setDigitalAnswers({});
                        setDigitalNotes(''); setDigitalVerified(false); setAlertNotice(null); setDigitalModalInst(inst);
                      }}
                      className="flex-1 bg-blue-600 hover:bg-blue-900 text-white font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                    >
                      <Sparkles size={14} />
                      Start Digital Questionnaire
                    </button>
                  ) : (
                    <button
                      disabled={!selectedClientId}
                      onClick={() => {
                        setManualScore(0);
                        setManualNotes(''); setManualSeverity(''); setManualInterpretation(''); setManualVerified(false); setManualSafetyFlag(false); setAlertNotice(null); setManualModalInst(inst);
                      }}
                      className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                    >
                      <Plus size={14} />
                      Enter Manual Score
                    </button>
                  )}

                  <button
                    disabled={!selectedClientId}
                    onClick={() => {
                      setManualScore(0);
                      setManualNotes(''); setManualSeverity(''); setManualInterpretation(''); setManualVerified(false); setManualSafetyFlag(false); setAlertNotice(null); setManualModalInst(inst);
                    }}
                    className="p-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold"
                    title="Manual paper entry"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MAIN TAB: HISTORY & TRENDS */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs">
              <p className="text-xs font-bold text-slate-500 uppercase">Total Assessments Recorded</p>
              <h3 className="text-2xl font-semibold text-slate-900 mt-1">{records.length}</h3>
              <p className="text-xs text-slate-500 mt-1">
                For patient: <span className="font-semibold text-slate-700">{selectedClient?.name || 'All Patients'}</span>
              </p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs">
              <p className="text-xs font-bold text-slate-500 uppercase">Safety Flagged Results</p>
              <h3 className="text-2xl font-semibold text-rose-600 mt-1">
                {records.filter((r) => r.safetyFlagged).length}
              </h3>
              <p className="text-xs text-slate-500 mt-1">Requires clinical follow-up</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs">
              <p className="text-xs font-bold text-slate-500 uppercase">Clinician Verified Ratio</p>
              <h3 className="text-2xl font-semibold text-emerald-700 mt-1">
                {records.length > 0
                  ? Math.round((records.filter((r) => r.clinicianVerified).length / records.length) * 100)
                  : 100}
                %
              </h3>
              <p className="text-xs text-slate-500 mt-1">Valid EHR record standards</p>
            </div>
          </div>

          <AssessmentTrends key={selectedClientId + records.length} clientId={selectedClientId} records={records} />
          {/* Records Table */}
          <div className={cx(cardClasses, 'overflow-hidden')}>
            <div className="p-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900">Historical Assessments</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!records.length}
                  onClick={() => {
                    const cell = (value: unknown) => '"' + String(value ?? '').replace(/^(?=[=+@-])/, "'").replace(/"/g, '""') + '"';
                    const csv = [['Date', 'Instrument', 'Score', 'Severity', 'Safety flagged'], ...records.map(record => [record.completedAt, record.instrumentName, record.totalScore, record.severity, record.safetyFlagged])].map(row => row.map(cell).join(',')).join('\r\n');
                    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
                    const link = document.createElement('a'); link.href = url; link.download = 'assessment-history.csv'; link.click(); URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  <Download size={14} />
                  Export CSV
                </button>
              </div>
            </div>

            {loadingHistory ? (
              <div className="p-8 text-center text-slate-500 text-sm">Loading assessment records…</div>
            ) : records.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <ClipboardList size={36} className="mx-auto mb-2 text-slate-500" />
                <p className="font-semibold text-slate-600">No Assessment Records Found</p>
                <p className="text-xs text-slate-500 mt-1">
                  Administer an instrument from the Library tab to begin tracking history.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200/80 text-xs font-bold uppercase text-slate-500">
                    <tr>
                      <th scope="col" className="py-3 px-4">Date</th>
                      <th scope="col" className="py-3 px-4">Instrument</th>
                      <th scope="col" className="py-3 px-4">Category</th>
                      <th scope="col" className="py-3 px-4">Score</th>
                      <th scope="col" className="py-3 px-4">Severity</th>
                      <th scope="col" className="py-3 px-4">Safety Flag</th>
                      <th scope="col" className="py-3 px-4">Verified</th>
                      <th scope="col" className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {records.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-600">
                          {new Date(r.completedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">{r.instrumentName}</td>
                        <td className="py-3.5 px-4 text-xs text-slate-500">{r.category}</td>
                        <td className="py-3.5 px-4">
                          <span className="font-semibold text-slate-900">{r.totalScore}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getSeverityBadgeColor(r.severity)}`}>
                            {r.severity}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          {r.safetyFlagged ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                              <AlertTriangle size={12} />
                              FLAGGED
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">None</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {r.clinicianVerified ? (
                            <span className="text-emerald-700 font-bold text-xs flex items-center gap-1">
                              <CheckCircle2 size={14} /> Yes
                            </span>
                          ) : (
                            <span className="text-amber-700 text-xs">Pending</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setViewDetailRecord(r)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-900 transition-all border border-blue-100/80 shadow-xs"
                          >
                            <FileText size={13} />
                            <span>View Details</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: INSTRUMENT INFO / KEY / NORMS */}
      {infoInstrument && (
        <div role="dialog" aria-modal="true" aria-label="Instrument guidance" className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{infoInstrument.fullName}</h3>
                <p className="text-xs text-blue-600 font-semibold">{infoInstrument.category} · {infoInstrument.adminType}</p>
              </div>
              <button aria-label="Close guidance" onClick={() => setInfoInstrument(null)} className="text-slate-500 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px]">Description</h4>
                <p className="mt-1 leading-relaxed">{infoInstrument.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl">
                <div>
                  <span className="font-bold text-slate-700">Target Population:</span>
                  <p>{infoInstrument.ageGuidance}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-700">Estimated Duration:</span>
                  <p>{infoInstrument.estimatedTime}</p>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px]">Scoring & Thresholds Guidance</h4>
                {infoInstrument.itemContentPending && <p className="mt-1 text-xs font-semibold text-amber-800">Item content pending licensed copy: administer the official form; no automatic scoring.</p>}
                {infoInstrument.scoreRanges?.map(range => <p key={range.label} className="mt-1 text-xs">{range.min}–{range.max}: {range.label}</p>)}
                {infoInstrument.alertNote && <p className="mt-2 text-rose-700">{infoInstrument.alertNote}</p>}
                <Alert tone="info" className="mt-1">
                  {infoInstrument.hasDigitalQuestionnaire ? "Complete every item before saving. Review the score and any safety flags." : "Administer using the instrument form and enter the clinician-reviewed result."}
                </Alert>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setInfoInstrument(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
              >
                Close Guidance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: DIGITAL QUESTIONNAIRE */}
      {digitalModalInst && (
        <div role="dialog" aria-modal="true" aria-label="Digital assessment questionnaire" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[calc(100dvh-2rem)] flex flex-col shadow-xs overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase bg-blue-100 text-blue-600 px-2 py-0.5 rounded">
                  Digital Questionnaire
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-1">{digitalModalInst.fullName}</h2>
                <p className="text-xs text-slate-500">Patient: <span className="font-bold text-slate-800">{selectedClient?.name || 'Selected Patient'}</span></p>
              </div>
              <button aria-label="Close questionnaire" onClick={() => setDigitalModalInst(null)} className="text-slate-500 hover:text-slate-600">
                <X size={22} />
              </button>
            </div>

            {/* Content Questions */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {digitalModalInst.questions?.map((q, idx) => (
                <div data-testid={`question-${q.id}`} key={q.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-slate-800">
                      {idx + 1}. {q.text}
                    </p>
                    {q.flagged && (
                      <span className="text-[11px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">
                        Safety Critical
                      </span>
                    )}
                  </div>

                  {q.note && <p className="text-xs text-slate-600">{q.note}</p>}
                  <div role="radiogroup" aria-label={q.text} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {q.options.map((opt) => {
                      const isSelected = digitalAnswers[q.id] === opt.score;
                      return (
                        <button
                          role="radio" aria-checked={isSelected} key={opt.label}
                          type="button"
                          onClick={() => setDigitalAnswers((prev) => ({ ...prev, [q.id]: opt.score }))}
                          className={`p-2.5 rounded-xl border text-xs font-semibold text-center transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                          }`}
                        >
                          <div>{opt.label}</div>
                          <div className={`text-[11px] mt-0.5 ${isSelected ? 'text-blue-200' : 'text-slate-500'}`}>
                            Score: {opt.score}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {alertNotice && <Alert tone="danger">{alertNotice}</Alert>}
              {/* Real-time Result Summary Box */}
              {digitalResult && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-blue-900">Calculated Score</span>
                    <span className="text-xl font-semibold text-blue-600">{digitalResult.totalScore}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-blue-800 font-semibold">Severity Rating:</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getSeverityBadgeColor(digitalResult.severity)}`}>
                      {digitalResult.severity}
                    </span>
                  </div>
                  {digitalResult.safetyFlagged && (
                    <div className="p-2.5 bg-rose-100 text-rose-800 rounded-lg text-xs font-bold flex items-center gap-2">
                      <AlertTriangle size={16} className="shrink-0 text-rose-600" />
                      CRITICAL SAFETY FLAG DETECTED — Response requires risk protocol documentation.
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Clinician Notes & Summary</label>
                <textarea
                  rows={2}
                  value={digitalNotes}
                  onChange={(e) => setDigitalNotes(e.target.value)}
                  placeholder="Optional observations, patient presentation, or test environment notes…"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="digVer"
                  checked={digitalVerified}
                  onChange={(e) => setDigitalVerified(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <label htmlFor="digVer" className="text-xs text-slate-700 font-medium">
                  I verify that these answers reflect the patient&apos;s submitted administration.
                </label>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                onClick={() => setDigitalModalInst(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                disabled={submitting || !digitalVerified || !digitalModalInst.questions?.every(q => digitalAnswers[q.id] !== undefined)}
                onClick={handleDigitalSubmit}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Submit & Save Assessment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: MANUAL SCORE ENTRY */}
      {manualModalInst && (
        <div role="dialog" aria-modal="true" aria-label="Manual assessment entry" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Manual Score Entry</h3>
                <p className="text-xs text-slate-500">{manualModalInst.name} — Paper or External Form</p>
              </div>
              <button aria-label="Close manual entry" onClick={() => setManualModalInst(null)} className="text-slate-500 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Respondent Type</label>
                <select
                  value={manualRespondent}
                  onChange={(e) => setManualRespondent(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                >
                  <option value="Client">Client (Self-Report)</option>
                  <option value="Parent/Guardian">Parent / Guardian</option>
                  <option value="Teacher">Teacher</option>
                  <option value="Clinician">Clinician-Rated</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Total Score</label>
                <input
                  type="number"
                  min={0}
                  max={manualModalInst.maxScore} aria-label="Manual assessment score" value={manualScore}
                  onChange={(e) => setManualScore(Number(e.target.value))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Severity / Classification</label>
                <input
                  type="text"
                  placeholder="e.g. Moderate, High Risk, Zone II…"
                  value={manualSeverity}
                  onChange={(e) => setManualSeverity(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Clinical Interpretation Summary</label>
                <textarea
                  rows={2}
                  placeholder="Summary interpretation for medical record…"
                  value={manualInterpretation}
                  onChange={(e) => setManualInterpretation(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                />
              </div>

              {alertNotice && <Alert tone="danger">{alertNotice}</Alert>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={manualSafetyFlag} onChange={e => setManualSafetyFlag(e.target.checked)} />Safety concern identified during this assessment</label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="manVer"
                  checked={manualVerified}
                  onChange={(e) => setManualVerified(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <label htmlFor="manVer" className="text-slate-700 font-medium">
                  Verified against paper record on file.
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setManualModalInst(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                disabled={submitting || !manualVerified}
                onClick={handleManualSubmit}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                {submitting ? 'Saving…' : 'Save Manual Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Beautifully centered Record Details Modal with backdrop blur */}
      {viewDetailRecord && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Assessment record details"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewDetailRecord(null);
          }}
        >
          <div
            className="bg-white rounded-xl max-w-3xl w-full max-h-[calc(100dvh-2rem)] flex flex-col shadow-xs overflow-hidden border border-slate-200/80 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <div>
                <span className="text-[11px] uppercase font-semibold bg-blue-100 text-blue-600 px-2.5 py-0.5 rounded-md">
                  Record Detail
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{viewDetailRecord.instrumentName}</h3>
                <p className="mt-0.5 text-xs text-slate-500">Patient: <span className="font-semibold text-slate-700">{selectedClient?.name || 'Selected Patient'}</span></p>
              </div>
              <button
                autoFocus
                aria-label="Close assessment details"
                onClick={() => setViewDetailRecord(null)}
                className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            {(() => {
              const currentInstrument = ASSESSMENT_CATALOG.find((inst) => {
                const idMatch = inst.id.toLowerCase() === viewDetailRecord.instrumentId?.toLowerCase();
                const nameMatch = inst.name.toLowerCase() === viewDetailRecord.instrumentName?.toLowerCase();
                const fullMatch = inst.fullName.toLowerCase() === viewDetailRecord.instrumentName?.toLowerCase();
                return idMatch || nameMatch || fullMatch;
              });

              const sortedAnswers = viewDetailRecord.answers
                ? Object.entries(viewDetailRecord.answers).sort(([a], [b]) => {
                    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
                    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
                    return numA - numB;
                  })
                : [];

              return (
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6 text-sm text-slate-700">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2.5">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <span className="text-slate-500 font-medium">Date Administered:</span>
                      <span className="font-bold text-slate-800">
                        {new Date(viewDetailRecord.completedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Total Score:</span>
                      <span className="font-semibold text-slate-900 text-lg">
                        {viewDetailRecord.totalScore}
                        {currentInstrument?.maxScore ? ` / ${currentInstrument.maxScore}` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Severity Rating:</span>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getSeverityBadgeColor(viewDetailRecord.severity)}`}>
                        {viewDetailRecord.severity}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-800 uppercase text-[11px] tracking-wider">Clinical Interpretation</h4>
                    <p className="mt-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-700 leading-relaxed text-xs sm:text-sm">
                      {viewDetailRecord.interpretation || 'No interpretation summary recorded.'}
                    </p>
                  </div>

                  {viewDetailRecord.safetyNotes && (
                    <div>
                      <h4 className="font-bold text-rose-700 uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                        <ShieldAlert size={15} /> Safety Notes
                      </h4>
                      <Alert tone="danger" className="mt-1.5">
                        {viewDetailRecord.safetyNotes}
                      </Alert>
                    </div>
                  )}

                  {viewDetailRecord.notes && (
                    <div>
                      <h4 className="font-bold text-slate-800 uppercase text-[11px] tracking-wider">Clinician Notes</h4>
                      <p className="mt-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-700 text-xs sm:text-sm">
                        {viewDetailRecord.notes}
                      </p>
                    </div>
                  )}

                  {/* Complete Question & Answer Breakdown */}
                  {sortedAnswers.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <h4 className="font-bold text-slate-800 uppercase text-[11px] tracking-wider">
                          Questions & Recorded Answers ({sortedAnswers.length} items)
                        </h4>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {currentInstrument?.fullName || currentInstrument?.name || viewDetailRecord.instrumentName}
                        </span>
                      </div>

                      <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                        {sortedAnswers.map(([key, val]) => {
                          const qIndex = parseInt(key.replace(/\D/g, ''), 10) - 1;
                          const question =
                            currentInstrument?.questions?.find((q) => q.id.toLowerCase() === key.toLowerCase()) ||
                            (qIndex >= 0 && currentInstrument?.questions ? currentInstrument.questions[qIndex] : null);

                          const questionNumber = qIndex >= 0 ? qIndex + 1 : key.replace(/^q/i, '');
                          const questionText = question?.text || `Question ${key.toUpperCase()}`;

                          const selectedOption = question?.options?.find((opt) => opt.score === Number(val));
                          const selectedLabel = selectedOption?.label || (typeof val === 'number' ? `Score: ${val}` : String(val));
                          const isSafetyItem = Boolean(
                            selectedOption?.flagged ||
                            (question?.flagged && Number(val) > 0) ||
                            (currentInstrument?.id === 'phq-9' && key.toLowerCase() === 'q9' && Number(val) > 0)
                          );

                          return (
                            <div
                              key={key}
                              className={`rounded-xl border p-3.5 transition-colors ${
                                isSafetyItem
                                  ? 'border-rose-200 bg-rose-50/50'
                                  : 'border-slate-200/80 bg-slate-50/60 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2.5 min-w-0">
                                  <span
                                    className={`inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-xs font-bold shrink-0 ${
                                      isSafetyItem
                                        ? 'bg-rose-100 text-rose-800'
                                        : 'bg-blue-100 text-blue-600'
                                    }`}
                                  >
                                    Q{questionNumber}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug">
                                      {questionText}
                                    </p>
                                    {question?.note && (
                                      <p className="text-[11px] text-slate-500 mt-0.5 italic">
                                        {question.note}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600 border border-blue-100">
                                    Score {val}
                                  </span>
                                  {isSafetyItem && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                                      <ShieldAlert size={11} /> Flagged
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-8">
                                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                                  Answer Selected:
                                </span>
                                <span className="inline-flex items-center rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 border border-slate-200 shadow-2xs">
                                  {selectedLabel}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Modal Footer */}
            <div className="flex shrink-0 justify-end border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <button
                onClick={() => setViewDetailRecord(null)}
                className="w-full sm:w-auto rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-blue-900 transition-colors shadow-sm cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
