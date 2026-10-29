'use client';
import { useState, useEffect } from 'react';
import { ScanSearch, CheckCircle2, XCircle, AlertTriangle, HelpCircle, Users, Zap, Brain, Shield, ChevronDown, ChevronUp, RefreshCw, BedDouble, ChevronRight, Sparkles, FileText, Quote } from 'lucide-react';
import { AssignSudMeasuresDialog } from '@/components/sud/AssignSudMeasuresDialog';
import { AUTO_ASSIGN_LABEL } from '@/lib/sud/measures';

type EligibilityStatus = 'eligible' | 'potential' | 'not_eligible' | 'needs_data';

interface ServiceEligibility {
  status: EligibilityStatus;
  metCriteria: string[];
  unmetCriteria: string[];
  missingData: string[];
  recommendation: string;
}

interface PatientRecord {
  id: string;
  name: string;
  age: number;
  primaryDx: string;
  icd10: string;
  insurance: string;
  clinician: string;
  lastVisit: string;
  prp: ServiceEligibility;
  spravato: ServiceEligibility;
  tms: ServiceEligibility;
  aot: ServiceEligibility;
  residential: ServiceEligibility;
}

// Residential ASAM 3.1/3.5 eligibility per patient (SUD level of care)
const NO_SUD_RESIDENTIAL: ServiceEligibility = {
  status: 'not_eligible',
  metCriteria: [],
  unmetCriteria: ['No substance use disorder diagnosis — ASAM residential (3.1/3.5) is an SUD level of care'],
  missingData: [],
  recommendation: 'Not indicated. Reassess if an SUD is diagnosed; routine SBIRT screening recommended.',
};

const RESIDENTIAL_BY_PATIENT: Record<string, ServiceEligibility> = {
  P001: NO_SUD_RESIDENTIAL,
  P002: {
    status: 'not_eligible',
    metCriteria: [],
    unmetCriteria: ['No SUD diagnosis', 'Medicare — no H0018/H0019 residential SUD benefit'],
    missingData: [],
    recommendation: 'Not indicated.',
  },
  P003: NO_SUD_RESIDENTIAL,
  P004: {
    status: 'needs_data',
    metCriteria: ['Chart notes reference episodic alcohol use'],
    unmetCriteria: [],
    missingData: ['SBIRT / AUDIT screening not completed', 'SUD diagnosis not established'],
    recommendation: 'Complete SBIRT screening. If an SUD is diagnosed, run the ASAM six-dimension assessment in Residential Admissions.',
  },
  P005: {
    status: 'eligible',
    metCriteria: ['Co-occurring AUD documented (F31.81 + AUD)', 'Medicaid enrolled — H0018/H0019 benefit (PA required)', 'Outpatient treatment insufficient to interrupt use pattern'],
    unmetCriteria: [],
    missingData: [],
    recommendation: 'Strong residential candidate. Run the ASAM six-dimension assessment in Residential Admissions — co-occurring severity suggests 3.5 vs 3.1 determination needed.',
  },
  P006: NO_SUD_RESIDENTIAL,
  P007: {
    status: 'eligible',
    metCriteria: ['AUD, Severe (F10.20)', 'Medicaid enrolled — H0018/H0019 benefit (PA required)', 'Continued use despite voluntary IOP — ASAM supports step-up to residential'],
    unmetCriteria: [],
    missingData: [],
    recommendation: 'Step-up indicated. Start a residential admission from the client list — the six-dimension assessment will confirm 3.5 vs 3.1 and check withdrawal-management exclusions.',
  },
  P008: {
    status: 'not_eligible',
    metCriteria: [],
    unmetCriteria: ['No SUD diagnosis', 'Medicare — no residential SUD benefit'],
    missingData: [],
    recommendation: 'Not indicated.',
  },
};

const PATIENTS_BASE: Omit<PatientRecord, 'residential'>[] = [];

const PATIENTS: PatientRecord[] = PATIENTS_BASE.map((p) => ({
  ...p,
  residential: RESIDENTIAL_BY_PATIENT[p.id] ?? NO_SUD_RESIDENTIAL,
}));

const SERVICE_META = {
  prp: {
    label: 'PRP',
    fullName: 'Psychiatric Rehabilitation Program',
    icon: Users,
    color: '#5C2D91',
    bg: '#F3EEF9',
    criteria: 'SMI diagnosis (Schizophrenia, Schizoaffective, Bipolar I, MDD Severe) · Medicaid enrolled · Functional impairment in ≥2 life domains · Maryland COMAR 10.21.16',
  },
  spravato: {
    label: 'Spravato',
    fullName: 'Spravato (Esketamine/TRD)',
    icon: Zap,
    color: '#B45309',
    bg: '#FFF9EC',
    criteria: 'MDD diagnosis · Age ≥18 · Failed ≥2 adequate antidepressant trials · No active psychosis or uncontrolled HTN · REMS certification required',
  },
  tms: {
    label: 'TMS',
    fullName: 'Transcranial Magnetic Stimulation',
    icon: Brain,
    color: '#0369A1',
    bg: '#EFF6FF',
    criteria: 'MDD or OCD diagnosis · Age ≥18 · Failed ≥1 antidepressant trial · No seizure history · No metallic head/neck implants',
  },
  aot: {
    label: 'AOT',
    fullName: 'Assisted Outpatient Treatment',
    icon: Shield,
    color: '#DC2626',
    bg: '#FEF2F2',
    criteria: 'Serious & persistent mental illness · Age ≥18 · 3-yr history prong (2× hospitalizations ≥48 hrs / detention services OR violent act / credible threat) · Unlikely to adhere voluntarily · Least restrictive for health & safety · HG § 10-6A-05',
  },
  residential: {
    label: 'Residential',
    fullName: 'Residential SUD — ASAM 3.1 / 3.5',
    icon: BedDouble,
    color: '#0E7490',
    bg: '#ECFEFF',
    criteria: 'SUD diagnosis · ASAM six-dimension assessment determines 3.5 vs 3.1 · Payer PA required (H0018/H0019) · Exclusions: high-risk withdrawal (→ 3.7-WM), acute medical or psychiatric instability',
  },
} as const;

// ─── SUD Referral Radar — AI scan findings ─────────────────────────────────
interface SudSignal {
  patient: string;
  patientId: string;
  source: 'diagnosis' | 'note-keyword';
  detected: string;
  evidence: string;
  confidence: number;
  recommendation: string;
  actionLabel: string;
  actionHref: string;
}

const SUD_RADAR: SudSignal[] = [];

// Internal referral routes — where "refer in-house" lands for each program
const REFERRAL_ROUTES: Record<ServiceKey, { href: string; label: string }> = {
  prp: { href: '/dashboard/prp/referral', label: 'Start PRP Referral' },
  spravato: { href: '/dashboard/ehr/tms-spravato', label: 'Refer to Spravato Clinic' },
  tms: { href: '/dashboard/ehr/tms-spravato', label: 'Refer to TMS' },
  aot: { href: '/dashboard/aot', label: 'Start AOT Eligibility Screen' },
  residential: { href: '/dashboard/residential', label: 'Start Residential Admission' },
};

type ServiceKey = keyof typeof SERVICE_META;

const STATUS_CONFIG: Record<EligibilityStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  eligible: { label: 'Eligible', color: '#15803D', bg: '#DCFCE7', icon: <CheckCircle2 size={12} /> },
  potential: { label: 'Potential', color: '#B45309', bg: '#FEF3C7', icon: <AlertTriangle size={12} /> },
  not_eligible: { label: 'Not Eligible', color: '#6B7280', bg: '#F3F4F6', icon: <XCircle size={12} /> },
  needs_data: { label: 'Needs Data', color: '#0369A1', bg: '#DBEAFE', icon: <HelpCircle size={12} /> },
};

function EligibilityBadge({ status }: { status: EligibilityStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function CriteriaList({ items, type }: { items: string[]; type: 'met' | 'unmet' | 'missing' }) {
  if (!items.length) return null;
  const configs = {
    met: { color: 'text-green-700', icon: <CheckCircle2 size={12} className="text-green-500 shrink-0 mt-0.5" /> },
    unmet: { color: 'text-red-700', icon: <XCircle size={12} className="text-red-500 shrink-0 mt-0.5" /> },
    missing: { color: 'text-blue-700', icon: <HelpCircle size={12} className="text-blue-500 shrink-0 mt-0.5" /> },
  };
  const cfg = configs[type];
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className={`flex items-start gap-1.5 text-xs ${cfg.color}`}>
          {cfg.icon}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ScannerPage() {
  const [serviceFilter, setServiceFilter] = useState<ServiceKey | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<EligibilityStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [expandedService, setExpandedService] = useState<ServiceKey | null>(null);
  const [lastScan, setLastScan] = useState('Oct 7, 2026 — 09:14 AM');
  const [scanning, setScanning] = useState(false);
  const [aiScanDone, setAiScanDone] = useState(false);
  const [sudFilter, setSudFilter] = useState<'all' | 'diagnosis' | 'note-keyword'>('all');
  const [radarList, setRadarList] = useState<SudSignal[]>(SUD_RADAR);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignClientIds, setAssignClientIds] = useState<string[]>([]);
  const [autoAssignSud, setAutoAssignSud] = useState(false);
  const [part2Hidden] = useState(0);

  useEffect(() => {
    fetch('/api/ehr/scanner/sud-radar')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.signals) && data.signals.length > 0) {
          setRadarList(
            data.signals.map((s: any) => ({
              patient: s.client?.name || s.detectedCondition,
              patientId: s.clientId || 'P001',
              source: s.detectionSource === 'diagnosis' ? 'diagnosis' : 'note-keyword',
              detected: s.detectedCondition,
              evidence: s.quotedEvidence,
              confidence: (s.confidencePercent || 85) / 100,
              recommendation: s.recommendation,
              actionLabel: s.actionLabel || 'Review Record',
              actionHref: s.actionHref || '/dashboard/residential',
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const counts = (service: ServiceKey) => ({
    eligible: PATIENTS.filter(p => p[service].status === 'eligible').length,
    potential: PATIENTS.filter(p => p[service].status === 'potential').length,
    needs_data: PATIENTS.filter(p => p[service].status === 'needs_data').length,
  });

  const filteredPatients = PATIENTS.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.primaryDx.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (serviceFilter === 'all' && statusFilter === 'all') return true;
    if (serviceFilter !== 'all' && statusFilter !== 'all') return p[serviceFilter].status === statusFilter;
    if (serviceFilter !== 'all') return p[serviceFilter].status !== 'not_eligible';
    const services: ServiceKey[] = ['prp', 'spravato', 'tms', 'aot', 'residential'];
    return services.some(s => p[s].status === statusFilter);
  });

  const handleRescan = async () => {
    setScanning(true);
    try {
      await fetch('/api/ehr/scanner/run-ai-scan', { method: 'POST' });
      const res = await fetch('/api/ehr/scanner/sud-radar');
      const data = await res.json();
      if (data.success && Array.isArray(data.signals) && data.signals.length > 0) {
        setRadarList(
          data.signals.map((s: any) => ({
            patient: s.client?.name || s.detectedCondition,
            patientId: s.clientId || 'P001',
            source: s.detectionSource === 'diagnosis' ? 'diagnosis' : 'note-keyword',
            detected: s.detectedCondition,
            evidence: s.quotedEvidence,
            confidence: (s.confidencePercent || 85) / 100,
            recommendation: s.recommendation,
            actionLabel: s.actionLabel || 'Review Record',
            actionHref: s.actionHref || '/dashboard/residential',
          }))
        );
      }
    } catch (err) {
      console.warn('AI Rescan error:', err);
    } finally {
      setScanning(false);
      setAiScanDone(true);
      setLastScan(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    }
  };

  const filteredRadar = radarList.filter(s => sudFilter === 'all' || s.source === sudFilter);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Eligibility Scanner</h1>
          <p className="text-gray-500 text-sm mt-1">AI-assisted screening for PRP · Spravato · TMS · AOT · Residential SUD — based on chart diagnoses, medication history, and clinical data</p>
        </div>
        <button onClick={handleRescan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shrink-0 hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
          {scanning ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {scanning ? 'AI scanning charts…' : 'Run AI Scan'}
        </button>
      </div>

      {/* Clinical Decision Support Disclaimer */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
        <ScanSearch size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Clinical Decision Support — Not a Clinical Determination</p>
          <p className="text-xs text-blue-700 mt-0.5">The AI scan runs Comprehend Medical ICD-10 inference over problem lists and Bedrock keyword/context analysis over the last 90 days of note text to flag potential candidates. Results are screening suggestions only — a licensed clinician must conduct a full assessment before initiating any referral or treatment. Last scan: <strong>{lastScan}</strong>.</p>
        </div>
      </div>

      {/* ── SUD Referral Radar — AI scan findings ─────────────────────────── */}
      {aiScanDone && (
        <div className="bg-white rounded-2xl border-2 border-cyan-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#0E7490' }}>
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">SUD Referral Radar — {radarList.length} signals found</p>
              <p className="text-xs text-gray-400">
                {radarList.filter(s => s.source === 'diagnosis').length} from diagnosis codes (F10–F19) ·{' '}
                {radarList.filter(s => s.source === 'note-keyword').length} from note language with <strong>no SUD diagnosis on the problem list</strong>
              </p>
            </div>
            <div className="ml-auto flex gap-1.5 flex-wrap items-center">
              {([
                { id: 'all', label: 'All' },
                { id: 'diagnosis', label: 'Diagnosis' },
                { id: 'note-keyword', label: 'Note Keywords' },
              ] as { id: 'all' | 'diagnosis' | 'note-keyword'; label: string }[]).map(f => (
                <button key={f.id} onClick={() => setSudFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${sudFilter === f.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  style={sudFilter === f.id ? { background: '#0E7490' } : {}}>
                  {f.label}
                </button>
              ))}
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                onClick={() => {
                  setAssignClientIds(filteredRadar.map((s) => s.patientId).filter(Boolean));
                  setAssignOpen(true);
                }}
              >
                Assign substance-use measures
              </button>
            </div>
          </div>
          {part2Hidden > 0 ? (
            <p className="px-5 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
              {part2Hidden} signal(s) hidden — protected (42 CFR Part 2) records you are not authorized to open.
            </p>
          ) : null}
          <label className="flex items-center gap-2 px-5 py-2 text-xs text-slate-600 border-b border-slate-100">
            <input
              type="checkbox"
              checked={autoAssignSud}
              onChange={(e) => setAutoAssignSud(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            {AUTO_ASSIGN_LABEL}
            <span className="text-slate-400">(default OFF)</span>
          </label>
          <div className="divide-y divide-gray-50">
            {filteredRadar.map(s => (
              <div key={`${s.patientId}-${s.detected}`} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg, #0E7490, #06B6D4)' }}>
                  {s.patient.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{s.patient}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.source === 'diagnosis' ? 'bg-cyan-100 text-cyan-700' : 'bg-amber-100 text-amber-700'}`}>
                      {s.source === 'diagnosis' ? 'Diagnosis code' : 'Note keyword — not on problem list'}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400">{Math.round(s.confidence * 100)}% confidence</span>
                  </div>
                  <p className="text-xs font-semibold text-gray-700 mt-1">{s.detected}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 flex items-start gap-1">
                    <Quote size={10} className="shrink-0 mt-0.5 text-gray-300" /> {s.evidence}
                  </p>
                  <p className="text-[11px] text-cyan-800 mt-1"><strong>Recommended:</strong> {s.recommendation}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setAssignClientIds([s.patientId]);
                      setAssignOpen(true);
                    }}
                  >
                    Assign substance-use measures
                  </button>
                  <a href={s.actionHref}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white hover:opacity-90 shadow-xs"
                    style={{ background: '#0E7490' }}>
                    {s.actionLabel} <ChevronRight size={12} />
                  </a>
                </div>
              </div>
            ))}
          </div>
          <AssignSudMeasuresDialog
            open={assignOpen}
            clientIds={assignClientIds}
            onClose={() => setAssignOpen(false)}
          />
          <div className="px-5 py-3 bg-cyan-50 border-t border-cyan-100 text-[11px] text-cyan-800 flex items-start gap-2">
            <FileText size={12} className="shrink-0 mt-0.5" />
            <span>
              Note-keyword hits are the high-value catches — SUD language documented in session notes but missing from the
              problem list. Each finding needs clinician confirmation; a confirmed screen flows into the ASAM six-dimension
              assessment in <a href="/dashboard/residential" className="font-semibold underline">Residential Admissions</a>.
            </span>
          </div>
        </div>
      )}

      {/* Service Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {(Object.keys(SERVICE_META) as ServiceKey[]).map(svc => {
          const meta = SERVICE_META[svc];
          const Icon = meta.icon;
          const c = counts(svc);
          const isActive = serviceFilter === svc;
          return (
            <button key={svc} onClick={() => setServiceFilter(isActive ? 'all' : svc)}
              className={`text-left p-4 rounded-2xl border-2 transition-all ${isActive ? 'border-2' : 'border border-gray-100 bg-white hover:border-gray-200'}`}
              style={isActive ? { borderColor: meta.color, backgroundColor: meta.bg } : {}}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: meta.color }}>
                  <Icon size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-800">{meta.label}</p>
                  <p className="text-xs text-gray-400 leading-none">{meta.fullName}</p>
                </div>
              </div>
              <div className="flex items-baseline gap-3">
                <div className="text-center">
                  <p className="text-xl font-extrabold" style={{ color: meta.color }}>{c.eligible}</p>
                  <p className="text-xs text-gray-500">Eligible</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-extrabold text-amber-600">{c.potential}</p>
                  <p className="text-xs text-gray-500">Potential</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-extrabold text-blue-600">{c.needs_data}</p>
                  <p className="text-xs text-gray-500">Needs Data</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Service criteria reference */}
      {serviceFilter !== 'all' && (
        <div className="rounded-2xl border p-4 text-sm" style={{ backgroundColor: SERVICE_META[serviceFilter].bg, borderColor: SERVICE_META[serviceFilter].color + '40' }}>
          <p className="text-xs font-bold uppercase mb-1" style={{ color: SERVICE_META[serviceFilter].color }}>
            {SERVICE_META[serviceFilter].fullName} — Key Eligibility Criteria
          </p>
          <p className="text-xs text-gray-700">{SERVICE_META[serviceFilter].criteria}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col sm:flex-row gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by patient name or diagnosis..."
          className="flex-1 border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as EligibilityStatus | 'all')}
          className="border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
          <option value="all">All Statuses</option>
          <option value="eligible">Eligible</option>
          <option value="potential">Potential</option>
          <option value="needs_data">Needs Data</option>
          <option value="not_eligible">Not Eligible</option>
        </select>
      </div>

      {/* Patient Results Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">{filteredPatients.length} patient{filteredPatients.length !== 1 ? 's' : ''} shown</p>
          <p className="text-xs text-gray-400">Click a row to see full criteria breakdown</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-50">
                <th className="text-left px-5 py-3 font-semibold">Patient</th>
                <th className="text-left px-5 py-3 font-semibold">Primary Diagnosis</th>
                <th className="text-center px-3 py-3 font-semibold">PRP</th>
                <th className="text-center px-3 py-3 font-semibold">Spravato</th>
                <th className="text-center px-3 py-3 font-semibold">TMS</th>
                <th className="text-center px-3 py-3 font-semibold">AOT</th>
                <th className="text-center px-3 py-3 font-semibold">Residential</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredPatients.map(p => {
                const isExpanded = expandedPatient === p.id;
                return (
                  <>
                    <tr key={p.id}
                      onClick={() => setExpandedPatient(isExpanded ? null : p.id)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
                            {p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                            <p className="text-xs text-gray-400">{p.clinician} · {p.insurance}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-sm text-gray-700">{p.primaryDx}</p>
                        <p className="text-xs text-gray-400">{p.icd10}</p>
                      </td>
                      <td className="px-3 py-3 text-center"><EligibilityBadge status={p.prp.status} /></td>
                      <td className="px-3 py-3 text-center"><EligibilityBadge status={p.spravato.status} /></td>
                      <td className="px-3 py-3 text-center"><EligibilityBadge status={p.tms.status} /></td>
                      <td className="px-3 py-3 text-center"><EligibilityBadge status={p.aot.status} /></td>
                      <td className="px-3 py-3 text-center"><EligibilityBadge status={p.residential.status} /></td>
                      <td className="px-5 py-3 text-right">
                        {isExpanded
                          ? <ChevronUp size={16} className="text-gray-400 inline" />
                          : <ChevronDown size={16} className="text-gray-400 inline" />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${p.id}-detail`}>
                        <td colSpan={8} className="bg-gray-50 px-5 py-5 border-b border-gray-100">
                          <div className="mb-3 flex items-center gap-2">
                            <p className="text-sm font-bold text-gray-800">Eligibility Breakdown — {p.name}</p>
                            <span className="text-xs text-gray-400">Age {p.age} · Last visit: {p.lastVisit}</span>
                          </div>

                          {/* Service selector tabs */}
                          <div className="flex gap-2 mb-4 flex-wrap">
                            {(Object.keys(SERVICE_META) as ServiceKey[]).map(svc => {
                              const meta = SERVICE_META[svc];
                              const status = p[svc].status;
                              const cfg = STATUS_CONFIG[status];
                              const isActive = expandedService === svc;
                              return (
                                <button key={svc}
                                  onClick={e => { e.stopPropagation(); setExpandedService(isActive ? null : svc); }}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${isActive ? 'border-purple-400 bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                                  <span style={{ color: meta.color }}>{meta.label}</span>
                                  <span className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                                    style={{ color: cfg.color, backgroundColor: cfg.bg }}>
                                    {cfg.label}
                                  </span>
                                  {isActive ? <ChevronUp size={11} className="text-gray-400" /> : <ChevronDown size={11} className="text-gray-400" />}
                                </button>
                              );
                            })}
                          </div>

                          {/* Criteria detail */}
                          {expandedService && (
                            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-gray-800">{SERVICE_META[expandedService].fullName}</p>
                                <EligibilityBadge status={p[expandedService].status} />
                              </div>

                              <div className="grid sm:grid-cols-3 gap-4">
                                {p[expandedService].metCriteria.length > 0 && (
                                  <div>
                                    <p className="text-xs font-bold text-green-700 uppercase mb-2">Criteria Met</p>
                                    <CriteriaList items={p[expandedService].metCriteria} type="met" />
                                  </div>
                                )}
                                {p[expandedService].unmetCriteria.length > 0 && (
                                  <div>
                                    <p className="text-xs font-bold text-red-700 uppercase mb-2">Criteria Not Met</p>
                                    <CriteriaList items={p[expandedService].unmetCriteria} type="unmet" />
                                  </div>
                                )}
                                {p[expandedService].missingData.length > 0 && (
                                  <div>
                                    <p className="text-xs font-bold text-blue-700 uppercase mb-2">Missing Data</p>
                                    <CriteriaList items={p[expandedService].missingData} type="missing" />
                                  </div>
                                )}
                              </div>

                              <div className="border-t border-gray-100 pt-3">
                                <p className="text-xs font-bold text-gray-500 uppercase mb-1">Clinical Recommendation</p>
                                <p className="text-sm text-gray-700">{p[expandedService].recommendation}</p>
                              </div>

                              {/* Action buttons — internal referral routes into each program's intake */}
                              <div className="flex gap-2 pt-1 flex-wrap">
                                {(p[expandedService].status === 'eligible' || p[expandedService].status === 'potential') && (
                                  <a href={REFERRAL_ROUTES[expandedService].href}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90"
                                    style={{ background: '#5C2D91' }}>
                                    {REFERRAL_ROUTES[expandedService].label} <ChevronRight size={12} />
                                  </a>
                                )}
                                {p[expandedService].status === 'needs_data' && (
                                  <button className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                                    style={{ background: '#0369A1' }}>
                                    Add Missing Data to Chart
                                  </button>
                                )}
                                <button className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
                                  Add to Care Plan
                                </button>
                                <button className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
                                  Document in Chart
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          {filteredPatients.length === 0 && (
            <div className="text-center py-12 text-gray-400">No patients match the current filters</div>
          )}
        </div>
      </div>

      {/* AOT Legal Reference */}
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
        <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">AOT — Legal Process Note (Maryland)</p>
          <p className="text-xs text-red-700 mt-0.5">Assisted Outpatient Treatment in Maryland is governed by Health-General § 10-6A-05. A petition may be filed by the director of a State-funded mental health program (Subtitle 9, Part I) or an individual 18+ with a legitimate interest in the respondent's welfare, in the county where the respondent resides. This scanner flags clinical indicators only — run the full statutory eligibility screen in the <a href="/dashboard/aot" className="font-semibold underline">AOT module</a>, and never initiate a petition based on scanner results alone.</p>
        </div>
      </div>

      {/* Spravato REMS Note */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
        <Zap size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Spravato (Esketamine) — REMS Program Required</p>
          <p className="text-xs text-amber-700 mt-0.5">Spravato is available only through a restricted distribution program (SPRAVATO REMS). The prescribing provider AND the healthcare setting must be certified. Each dose must be self-administered by the patient under direct observation in a certified clinical setting with ≥2 hours post-dose monitoring. Contact JANSSEN CAREPATH (1-844-4JNSSEN) to enroll. Do not prescribe outside of REMS.</p>
        </div>
      </div>
    </div>
  );
}
