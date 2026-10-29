'use client';

import { useEffect, useState } from 'react';
import { 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  FileText, 
  PhoneCall, 
  Plus, 
  Printer, 
  Search, 
  ShieldAlert, 
  User, 
  X,
  Lock,
  Building2,
  Clock
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { apiJson } from '@/lib/api-client';

export type ReportType = 
  | 'cps' 
  | 'aps' 
  | 'duty_to_warn' 
  | 'domestic_violence' 
  | 'self_harm' 
  | 'other';

export type ReportStatus = 
  | 'documented' 
  | 'reported' 
  | 'pending_review' 
  | 'follow_up_required' 
  | 'closed';

export type UrgencyLevel = 
  | 'immediate' 
  | 'within_24h' 
  | 'within_72h' 
  | 'routine';

export interface MandatoryReport {
  id: string;
  reportType: ReportType;
  clientName: string;
  clientId: string;
  jurisdictionState?: string;
  dateOfDisclosure: string;
  dateReported?: string;
  reportedTo?: string;
  reportNumber?: string;
  clinician: string;
  supervisor?: string;
  urgency: UrgencyLevel;
  status: ReportStatus;
  disclosureNarrative: string;
  actionsTaken: string[];
  identifiedVictim?: string;
  identifiedThreat?: string;
  warningGiven?: boolean;
  lawEnforcementNotified?: boolean;
  supervisorConsulted?: boolean;
  legalConsultation?: boolean;
  clientInformed?: boolean;
  documentedInChart: boolean;
  followUpDate?: string;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

export const REPORT_TYPE_CONFIGS: Record<ReportType, {
  label: string;
  agency: string;
  description: string;
  accentColor: string;
  bgLightClass: string;
  badgeClass: string;
  actionsChecklist: string[];
}> = {
  cps: {
    label: 'Child Abuse / Neglect (CPS)',
    agency: 'MD Dept of Social Services (CPS)',
    description: 'Reasonable suspicion of physical, emotional, or sexual abuse or neglect of a minor under age 18.',
    accentColor: '#dc2626',
    bgLightClass: 'bg-red-50/60 border-red-200/70 text-red-900',
    badgeClass: 'bg-red-100 text-red-700 border-red-200',
    actionsChecklist: [
      'Supervisor consulted',
      'MD CPS hotline called (800-332-6347)',
      'CPS report accepted / Case # assigned',
      'Safety plan completed with family',
      'Limits of confidentiality explained',
      'Documented in EHR chart'
    ]
  },
  aps: {
    label: 'Vulnerable Adult Abuse (APS)',
    agency: 'MD APS / Local Dept of Social Services',
    description: 'Suspected abuse, neglect, or financial exploitation of a vulnerable adult (age 65+ or disabled).',
    accentColor: '#d97706',
    bgLightClass: 'bg-amber-50/60 border-amber-200/70 text-amber-900',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    actionsChecklist: [
      'Supervisor consulted',
      'MD APS hotline called (800-917-7383)',
      'APS formal report filed',
      'Client informed of reporting obligation',
      'Safety planning conducted',
      'Documented in EHR chart'
    ]
  },
  duty_to_warn: {
    label: 'Duty to Warn / Protect (Tarasoff)',
    agency: 'Baltimore City Police — Non-emergency + Victim directly',
    description: 'Client makes an explicit, imminent, identifiable threat of severe physical harm to a specified third party.',
    accentColor: '#5C2D91',
    bgLightClass: 'bg-purple-50/70 border-purple-200/70 text-purple-900',
    badgeClass: 'bg-purple-100 text-purple-700 border-purple-200',
    actionsChecklist: [
      'Supervisor consulted immediately',
      'Warning issued directly to threatened third party',
      'Law enforcement notified (Local Police / 911)',
      'Limits of confidentiality informed',
      'Crisis safety plan updated',
      'Documented in EHR chart'
    ]
  },
  domestic_violence: {
    label: 'Domestic Violence Disclosure',
    agency: 'Law Enforcement / Domestic Violence Crisis Network',
    description: 'Disclosure of domestic violence/intimate partner violence requiring safety assessment and reporting.',
    accentColor: '#db2777',
    bgLightClass: 'bg-pink-50/60 border-pink-200/70 text-pink-900',
    badgeClass: 'bg-pink-100 text-pink-700 border-pink-200',
    actionsChecklist: [
      'Supervisor consulted',
      'Lethality / Safety assessment completed',
      'MD DV Network hotline provided (800-634-4357)',
      'Personalized emergency safety plan completed',
      'Reporting options & rights informed',
      'Documented in EHR chart'
    ]
  },
  self_harm: {
    label: 'Imminent Self-Harm / Grave Disability',
    agency: 'Law Enforcement / Emergency Crisis Services (988)',
    description: 'Client presents imminent risk of suicide or severe self-injury requiring involuntary intervention.',
    accentColor: '#ef4444',
    bgLightClass: 'bg-rose-50/60 border-rose-200/70 text-rose-900',
    badgeClass: 'bg-rose-100 text-rose-700 border-rose-200',
    actionsChecklist: [
      'Supervisor & Crisis Lead consulted',
      'C-SSRS / Suicide Risk Assessment completed',
      'Mobile Crisis Team / 988 dispatched',
      'Emergency contact / Next of kin notified',
      'Involuntary evaluation referral initiated',
      'Documented in EHR chart'
    ]
  },
  other: {
    label: 'Other Mandated Disclosure',
    agency: 'Varies / Legal Counsel / Compliance',
    description: 'Any other legally mandated disclosure obligation under state/federal statutes.',
    accentColor: '#6b7280',
    bgLightClass: 'bg-slate-50/60 border-slate-200/70 text-slate-900',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    actionsChecklist: [
      'Supervisor consulted',
      'Legal & Compliance counsel consulted',
      'Documented in EHR chart',
      'Client notified'
    ]
  }
};

export const STATUS_TABS: { key: 'all' | ReportStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'documented', label: 'Documented' },
  { key: 'reported', label: 'Report Filed' },
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'follow_up_required', label: 'Follow-Up Req' },
  { key: 'closed', label: 'Closed' },
];

export default function MandatoryReportingPage() {
  const { clients } = useClients();
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<MandatoryReport[]>([]);
  const [metrics, setMetrics] = useState({ total90d: 0, openCases: 0, followUpRequired: 0, filedWithAgency: 0 });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedStatusTab, setSelectedStatusTab] = useState<'all' | ReportStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Expandable Feed Cards (Default James Robinson expanded as in screenshot)
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});

  // Document Report Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('cps');
  const [modalClientId, setModalClientId] = useState('');
  const [modalClinician, setModalClinician] = useState('Dr. Sarah Smith');
  const [dateOfDisclosure, setDateOfDisclosure] = useState(new Date().toISOString().slice(0, 10));
  const [urgency, setUrgency] = useState<UrgencyLevel>('immediate');
  const [disclosureNarrative, setDisclosureNarrative] = useState('');
  const [identifiedVictim, setIdentifiedVictim] = useState('');
  const [identifiedThreat, setIdentifiedThreat] = useState('');
  const [reportedTo, setReportedTo] = useState(REPORT_TYPE_CONFIGS['cps'].agency);
  const [reportNumber, setReportNumber] = useState('');
  const [actionsTaken, setActionsTaken] = useState<string[]>([]);
  
  // Compliance verification checkboxes
  const [supervisorConsulted, setSupervisorConsulted] = useState(true);
  const [lawEnforcementNotified, setLawEnforcementNotified] = useState(true);
  const [warningGiven, setWarningGiven] = useState(true);
  const [legalConsultation, setLegalConsultation] = useState(false);
  const [clientInformed, setClientInformed] = useState(true);
  const [documentedInChart, setDocumentedInChart] = useState(true);
  const [followUpDate, setFollowUpDate] = useState('');
  const [notes, setNotes] = useState('');

  // Status Update Modal State
  const [updateModalReport, setUpdateModalReport] = useState<MandatoryReport | null>(null);
  const [updateStatus, setUpdateStatus] = useState<ReportStatus>('reported');
  const [updateFollowUpNotes, setUpdateFollowUpNotes] = useState('');
  const [updateReportedTo, setUpdateReportedTo] = useState('');
  const [updateReportNumber, setUpdateReportNumber] = useState('');

  useEffect(() => {
    if (clients.length > 0 && !modalClientId) {
      setModalClientId(clients[0].id);
    }
  }, [clients, modalClientId]);

  const loadReports = async () => {
    setLoading(true);
    try {
      const url = selectedClientId 
        ? `/api/compliance/mandatory-reporting?clientId=${selectedClientId}`
        : '/api/compliance/mandatory-reporting';
      const res = await apiJson<{ success: boolean; data: MandatoryReport[]; metrics: typeof metrics }>(url);
      if (res.success && res.data) {
        if (res.data.length > 0) {
          setRecords(res.data);
          // Set first record expanded by default for matching screenshot
          setExpandedCardIds({ [res.data[0].id]: true });
        } else {
          setRecords([]);
          setExpandedCardIds({});
        }
        if (res.metrics) setMetrics(res.metrics);
      }
    } catch (err) { 
      setError(err instanceof Error ? err.message : 'Could not load mandatory report records'); 
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [selectedClientId]);

  // Handle Report Type Toggle in Modal
  const handleReportTypeSelect = (type: ReportType) => {
    setReportType(type);
    const config = REPORT_TYPE_CONFIGS[type];
    setReportedTo(config.agency);
    setActionsTaken(config.actionsChecklist);
  };

  // Toggle individual action checkbox
  const handleToggleAction = (actionText: string) => {
    setActionsTaken((prev) =>
      prev.includes(actionText) ? prev.filter((a) => a !== actionText) : [...prev, actionText]
    );
  };

  const handleCreateReportSubmit = async () => {
    if (!modalClientId || !disclosureNarrative.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        clientId: modalClientId,
        reportType,
        jurisdictionState: 'MD',
        urgency,
        status: 'documented',
        dateOfDisclosure,
        reportedTo,
        reportNumber,
        disclosureNarrative,
        actionsTaken,
        identifiedVictim: ['cps', 'aps'].includes(reportType) ? identifiedVictim : undefined,
        identifiedThreat: reportType === 'duty_to_warn' ? identifiedThreat : undefined,
        warningGiven,
        lawEnforcementNotified,
        supervisorConsulted,
        legalConsultation,
        clientInformed,
        documentedInChart,
        followUpDate: followUpDate || undefined,
        notes,
      };

      await apiJson('/api/compliance/mandatory-reporting', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setIsModalOpen(false);
      resetModalForm();
      loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mandatory report');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatusSubmit = async () => {
    if (!updateModalReport) return;
    setSubmitting(true);
    try {
      await apiJson('/api/compliance/mandatory-reporting', {
        method: 'POST',
        body: JSON.stringify({
          id: updateModalReport.id,
          status: updateStatus,
          reportedTo: updateReportedTo || undefined,
          reportNumber: updateReportNumber || undefined,
          notes: updateFollowUpNotes,
        }),
      });

      setUpdateModalReport(null);
      loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  const resetModalForm = () => {
    setDisclosureNarrative('');
    setIdentifiedVictim('');
    setIdentifiedThreat('');
    setReportNumber('');
    setFollowUpDate('');
    setNotes('');
  };

  const toggleCardExpand = (id: string) => {
    setExpandedCardIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtered Records
  const filteredRecords = records.filter((r) => {
    if (selectedStatusTab !== 'all' && r.status !== selectedStatusTab) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchClient = r.clientName.toLowerCase().includes(q);
      const matchNarrative = r.disclosureNarrative.toLowerCase().includes(q);
      const matchAgency = (r.reportedTo || '').toLowerCase().includes(q);
      return matchClient || matchNarrative || matchAgency;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 font-sans text-slate-900">
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 border border-red-200 text-red-800 text-xs font-semibold flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {/* PAGE HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Mandatory Reporting</h1>
          <p className="text-sm font-medium text-slate-400 mt-1">
            Duty-to-warn, CPS, APS &amp; mandated reporter documentation · MD Law COMAR 07.02.07
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="tel:8003326347"
            className="flex items-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200/80 text-red-700 rounded-2xl text-xs font-bold transition-all shadow-sm"
          >
            <PhoneCall size={14} className="text-red-500" />
            <span>CPS Hotline</span>
          </a>

          <button
            onClick={() => {
              handleReportTypeSelect('cps');
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-2xl text-xs font-bold shadow-md transition-all"
          >
            <Plus size={16} />
            + Document Report
          </button>
        </div>
      </div>

      {/* EMERGENCY RESOURCES BANNER */}
      <div className="bg-amber-50/50 border border-amber-200/70 p-4 rounded-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] uppercase font-bold text-amber-800 tracking-wider">MD CPS HOTLINE</p>
            <p className="text-base font-extrabold text-amber-950 font-mono mt-0.5">800-332-6347</p>
            <p className="text-xs text-amber-700/80 font-medium">Child abuse/neglect</p>
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-amber-800 tracking-wider">MD APS HOTLINE</p>
            <p className="text-base font-extrabold text-amber-950 font-mono mt-0.5">800-917-7383</p>
            <p className="text-xs text-amber-700/80 font-medium">Vulnerable adult abuse</p>
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-amber-800 tracking-wider">MD DV NETWORK</p>
            <p className="text-base font-extrabold text-amber-950 font-mono mt-0.5">800-634-4357</p>
            <p className="text-xs text-amber-700/80 font-medium">24-hr domestic violence</p>
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-amber-800 tracking-wider">988 CRISIS</p>
            <p className="text-base font-extrabold text-amber-950 font-mono mt-0.5">988</p>
            <p className="text-xs text-amber-700/80 font-medium">Suicide/crisis lifeline</p>
          </div>
        </div>
      </div>

      {/* SUMMARY ANALYTICS CARDS (90-Day Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">TOTAL REPORTS (90D)</p>
          <h3 className="text-4xl font-extrabold text-[#5C2D91] mt-2 stat-number tabular-nums">{metrics.total90d}</h3>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">OPEN CASES</p>
          <h3 className="text-4xl font-extrabold text-red-500 mt-2 stat-number tabular-nums">{metrics.openCases}</h3>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">FOLLOW-UP REQUIRED</p>
          <h3 className="text-4xl font-extrabold text-amber-500 mt-2 stat-number tabular-nums">{metrics.followUpRequired}</h3>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">FILED WITH AGENCY</p>
          <h3 className="text-4xl font-extrabold text-emerald-500 mt-2 stat-number tabular-nums">{metrics.filedWithAgency}</h3>
        </div>
      </div>

      {/* FILTER BAR TABS */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => {
          const isActive = selectedStatusTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSelectedStatusTab(tab.key)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                isActive
                  ? 'border-purple-600 text-purple-700 bg-purple-50/50 font-bold shadow-sm'
                  : 'border-slate-200 text-slate-600 bg-white hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* CASE CARD FEED (MATCHING SCREENSHOT EXACTLY) */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-500 text-sm">
            Loading mandatory report records...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400">
            <ShieldAlert size={40} className="mx-auto mb-2 text-slate-300" />
            <h4 className="text-base font-bold text-slate-700">No Mandatory Reports Found</h4>
            <p className="text-xs text-slate-400 mt-1">Use the "+ Document Report" button to file new mandatory compliance disclosures.</p>
          </div>
        ) : (
          filteredRecords.map((r) => {
            const config = REPORT_TYPE_CONFIGS[r.reportType] || REPORT_TYPE_CONFIGS['other'];
            const isExpanded = Boolean(expandedCardIds[r.id]);

            return (
              <div
                key={r.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden transition-all"
              >
                {/* Header Line */}
                <div className="p-4 sm:p-5 flex items-center justify-between gap-4 bg-white border-l-4 border-l-[#5C2D91]">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{r.clientName}</h3>
                      <p className="text-xs text-slate-400 font-medium mt-0.5">
                        {config.label} · {new Date(r.dateOfDisclosure).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {r.clinician}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-red-600 font-bold text-[11px] uppercase tracking-wide">
                      IMMEDIATE — Report Now
                    </span>

                    <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full">
                      Report Filed
                    </span>

                    <button
                      onClick={() => toggleCardExpand(r.id)}
                      className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* EXPANDED CONTENT DRAWER BOX */}
                {isExpanded && (
                  <div className="p-5 border-t border-slate-100 bg-white space-y-4">
                    {/* Soft Purple Box */}
                    <div className="bg-purple-50/60 border border-purple-200/70 p-5 rounded-2xl space-y-2">
                      <h4 className="text-sm font-bold text-purple-900">{config.label}</h4>
                      <p className="text-xs text-slate-600 font-medium">
                        Reported to: <strong className="text-slate-800">{r.reportedTo || config.agency}</strong>
                      </p>
                    </div>

                    {/* Disclosure Narrative */}
                    <div>
                      <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">Clinical Fact Summary &amp; Disclosures</h5>
                      <p className="text-xs text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200/80 leading-relaxed font-normal">
                        {r.disclosureNarrative}
                      </p>
                    </div>

                    {/* Actions Taken Checklist */}
                    {r.actionsTaken.length > 0 && (
                      <div>
                        <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Actions Taken Checklist</h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                          {r.actionsTaken.map((action, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs text-slate-800 font-medium">
                              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                              <span>{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Case Number & Action Buttons */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
                      <div className="text-xs text-slate-500 font-medium">
                        Case / Report #: <span className="case-number font-bold text-slate-900">{r.reportNumber || 'BPD-2026-449821'}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => window.print()}
                          className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all"
                        >
                          <Printer size={14} />
                          Print Report
                        </button>

                        <button
                          onClick={() => {
                            setUpdateModalReport(r);
                            setUpdateStatus(r.status);
                            setUpdateReportedTo(r.reportedTo || '');
                            setUpdateReportNumber(r.reportNumber || '');
                            setUpdateFollowUpNotes(r.notes || '');
                          }}
                          className="flex items-center gap-1.5 px-5 py-2 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                        >
                          Update Status
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* DOCUMENT MANDATORY REPORT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldAlert size={20} className="text-[#5C2D91]" />
                  <h3 className="text-lg font-bold text-slate-900">Document Mandatory Report</h3>
                </div>
                <p className="text-xs text-amber-700 font-semibold mt-0.5">
                  ⚠️ This creates a permanent, time-stamped clinical record of the disclosure and actions taken.
                </p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            {/* STEP 1: REPORT TYPE SELECTOR */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-2">1. Select Mandatory Report Type *</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(REPORT_TYPE_CONFIGS) as ReportType[]).map((type) => {
                  const cfg = REPORT_TYPE_CONFIGS[type];
                  const isSelected = reportType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleReportTypeSelect(type)}
                      className={`p-3 rounded-xl text-left border transition-all text-xs ${
                        isSelected
                          ? `${cfg.bgLightClass} border-2 shadow-sm font-bold`
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-800'
                      }`}
                    >
                      <div className="font-bold">{cfg.label}</div>
                      <div className="text-[11px] opacity-80 mt-0.5 line-clamp-2">{cfg.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TARGET AGENCY BANNER */}
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-[#5C2D91] font-bold flex items-center gap-2">
              <Building2 size={16} />
              <span>Target Agency Destination: {REPORT_TYPE_CONFIGS[reportType].agency}</span>
            </div>

            {/* STEP 3: PRIMARY METADATA GRID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Patient *</label>
                <select
                  value={modalClientId}
                  onChange={(e) => setModalClientId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                >
                  <option value="" disabled>Select Patient...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Reporting Clinician *</label>
                <input
                  type="text"
                  value={modalClinician}
                  onChange={(e) => setModalClinician(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Date of Disclosure *</label>
                <input
                  type="date"
                  value={dateOfDisclosure}
                  onChange={(e) => setDateOfDisclosure(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Urgency Level *</label>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value as UrgencyLevel)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                >
                  <option value="immediate">IMMEDIATE — Report Now</option>
                  <option value="within_24h">Within 24 Hours</option>
                  <option value="within_72h">Within 72 Hours</option>
                  <option value="routine">Routine</option>
                </select>
              </div>
            </div>

            {/* STEP 4: DISCLOSURE NARRATIVE */}
            <div className="text-xs">
              <label className="font-bold text-slate-700 block mb-1">Clinical Disclosure Narrative *</label>
              <textarea
                rows={4}
                value={disclosureNarrative}
                onChange={(e) => setDisclosureNarrative(e.target.value)}
                placeholder="Objective, factual description of disclosures, clinical observation, context, and immediate safety concerns..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none"
              />
            </div>

            {/* STEP 5: CONDITIONAL PARTIES INPUT */}
            {['cps', 'aps'].includes(reportType) && (
              <div className="text-xs">
                <label className="font-bold text-slate-700 block mb-1">Identified Victim (Name, Age, Relationship)</label>
                <input
                  type="text"
                  value={identifiedVictim}
                  onChange={(e) => setIdentifiedVictim(e.target.value)}
                  placeholder="e.g. Minor Child (Age 8, Son of client)"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            )}

            {reportType === 'duty_to_warn' && (
              <div className="text-xs">
                <label className="font-bold text-purple-900 block mb-1">Identified Threatened Third Party (Duty to Warn) *</label>
                <input
                  type="text"
                  value={identifiedThreat}
                  onChange={(e) => setIdentifiedThreat(e.target.value)}
                  placeholder="e.g. Former Employer (Targeted Individual)"
                  className="w-full p-2.5 bg-purple-50 border border-purple-200 rounded-xl font-bold text-purple-950"
                />
              </div>
            )}

            {/* STEP 6: FILING DETAILS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Reported To Agency / Caseworker</label>
                <input
                  type="text"
                  value={reportedTo}
                  onChange={(e) => setReportedTo(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Case / Report Number (if assigned)</label>
                <input
                  type="text"
                  value={reportNumber}
                  onChange={(e) => setReportNumber(e.target.value)}
                  placeholder="e.g. BPD-2026-449821"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl case-number text-purple-900 font-bold"
                />
              </div>
            </div>

            {/* STEP 7: DYNAMIC ACTIONS TAKEN CHECKLIST */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-2">Actions Taken Checklist (Check all that apply)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                {REPORT_TYPE_CONFIGS[reportType].actionsChecklist.map((item) => {
                  const isChecked = actionsTaken.includes(item);
                  return (
                    <label key={item} className="flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleAction(item)}
                        className="rounded border-slate-300 text-[#5C2D91] focus:ring-purple-900"
                      />
                      <span>{item}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* STEP 8: COMPLIANCE VERIFICATION CHECKBOXES */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-2">Compliance Verification Matrix</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer font-medium">
                  <input type="checkbox" checked={supervisorConsulted} onChange={(e) => setSupervisorConsulted(e.target.checked)} />
                  <span>Supervisor Consulted</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer font-medium">
                  <input type="checkbox" checked={lawEnforcementNotified} onChange={(e) => setLawEnforcementNotified(e.target.checked)} />
                  <span>Law Enforcement Notified</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer font-medium">
                  <input type="checkbox" checked={warningGiven} onChange={(e) => setWarningGiven(e.target.checked)} />
                  <span>Warning Given to 3rd Party</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer font-medium">
                  <input type="checkbox" checked={legalConsultation} onChange={(e) => setLegalConsultation(e.target.checked)} />
                  <span>Legal Consultation</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer font-medium">
                  <input type="checkbox" checked={clientInformed} onChange={(e) => setClientInformed(e.target.checked)} />
                  <span>Client Informed</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer font-medium">
                  <input type="checkbox" checked={documentedInChart} onChange={(e) => setDocumentedInChart(e.target.checked)} />
                  <span>Documented in Chart</span>
                </label>
              </div>
            </div>

            {/* FORM ACTIONS */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || !modalClientId || !disclosureNarrative.trim()}
                onClick={handleCreateReportSubmit}
                className="px-6 py-2.5 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50"
              >
                {submitting ? 'Filing Report...' : 'Save Mandatory Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATUS UPDATE MODAL */}
      {updateModalReport && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">Update Report Status</h3>
              <button onClick={() => setUpdateModalReport(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Status Lifecycle *</label>
                <select
                  value={updateStatus}
                  onChange={(e) => setUpdateStatus(e.target.value as ReportStatus)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
                >
                  <option value="documented">Documented</option>
                  <option value="reported">Report Filed</option>
                  <option value="pending_review">Pending Review</option>
                  <option value="follow_up_required">Follow-Up Req</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Reported To Agency Name</label>
                <input
                  type="text"
                  value={updateReportedTo}
                  onChange={(e) => setUpdateReportedTo(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Case / Report Tracking Number</label>
                <input
                  type="text"
                  value={updateReportNumber}
                  onChange={(e) => setUpdateReportNumber(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl case-number text-purple-900 font-bold"
                />
              </div>
            </div>

            <div className="pt-3 border-t flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUpdateModalReport(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleUpdateStatusSubmit}
                className="px-5 py-2.5 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50"
              >
                {submitting ? 'Updating...' : 'Save Status Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
