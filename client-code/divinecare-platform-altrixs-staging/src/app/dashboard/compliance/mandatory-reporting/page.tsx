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
import {
  Alert,
  Button,
  Card,
  EmptyState,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  buttonClasses,
  cx,
  inputClasses,
} from '@/components/ui';

const LABEL = 'mb-1.5 block text-sm font-medium text-slate-700';
const CHECKBOX = 'h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-600';

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
  documentedInChart: boolean | null;
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
    bgLightClass: 'bg-rose-50 border-rose-200 text-rose-900',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
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
    bgLightClass: 'bg-amber-50 border-amber-200 text-amber-900',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
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
    bgLightClass: 'bg-rose-50 border-rose-200 text-rose-900',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
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
    bgLightClass: 'bg-rose-50 border-rose-200 text-rose-900',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
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
    bgLightClass: 'bg-rose-50 border-rose-200 text-rose-900',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
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
    bgLightClass: 'bg-slate-50 border-slate-200 text-slate-900',
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

  // Expandable Feed Cards (first record expanded by default)
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});

  // Document Report Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('cps');
  const [modalClientId, setModalClientId] = useState('');
  const [modalClinician, setModalClinician] = useState('');
  const [dateOfDisclosure, setDateOfDisclosure] = useState(new Date().toISOString().slice(0, 10));
  const [urgency, setUrgency] = useState<UrgencyLevel>('immediate');
  const [disclosureNarrative, setDisclosureNarrative] = useState('');
  const [identifiedVictim, setIdentifiedVictim] = useState('');
  const [identifiedThreat, setIdentifiedThreat] = useState('');
  const [reportedTo, setReportedTo] = useState(REPORT_TYPE_CONFIGS['cps'].agency);
  const [reportNumber, setReportNumber] = useState('');
  const [actionsTaken, setActionsTaken] = useState<string[]>([]);
  
  // Compliance verification checkboxes
  const [supervisorConsulted, setSupervisorConsulted] = useState(false);
  const [lawEnforcementNotified, setLawEnforcementNotified] = useState(false);
  const [warningGiven, setWarningGiven] = useState(false);
  const [legalConsultation, setLegalConsultation] = useState(false);
  const [clientInformed, setClientInformed] = useState(false);
  const [documentedInChart, setDocumentedInChart] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [notes, setNotes] = useState('');

  // Status Update Modal State
  const [updateModalReport, setUpdateModalReport] = useState<MandatoryReport | null>(null);
  const [updateStatus, setUpdateStatus] = useState<ReportStatus>('reported');
  const [updateFollowUpNotes, setUpdateFollowUpNotes] = useState('');
  const [updateReportedTo, setUpdateReportedTo] = useState('');
  const [updateReportNumber, setUpdateReportNumber] = useState('');

  // No auto-selected patient: the reporter must choose the client explicitly.

  const loadReports = async () => {
    setLoading(true);
    try {
      const url = selectedClientId 
        ? `/api/compliance/mandatory-reporting?clientId=${selectedClientId}`
        : '/api/compliance/mandatory-reporting';
      const res = await apiJson<{ success: boolean; data: MandatoryReport[]; metrics: typeof metrics }>(url);
      if (res.success && res.data) {
        setRecords(res.data);
        if (res.data.length > 0) {
          setExpandedCardIds({ [res.data[0].id]: true });
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
    // Start with nothing ticked: each action is checked only when it was actually done.
    setActionsTaken([]);
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
    setModalClientId('');
    setActionsTaken([]);
    setSupervisorConsulted(false);
    setLawEnforcementNotified(false);
    setWarningGiven(false);
    setLegalConsultation(false);
    setClientInformed(false);
    setDocumentedInChart(false);
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
    <Page>
      {error && (
        <Alert
          tone="danger"
          actions={
            <IconButton
              label="Dismiss error"
              icon={<X size={16} />}
              onClick={() => setError(null)}
              className="p-1 text-rose-700 hover:bg-rose-100"
            />
          }
        >
          {error}
        </Alert>
      )}

      <PageHeader
        title="Mandatory Reporting"
        description={<>Duty-to-warn, CPS, APS &amp; mandated reporter documentation · MD Law COMAR 07.02.07</>}
        actions={
          <>
            <a href="tel:8003326347" className={buttonClasses({ variant: 'secondary' })}>
              <PhoneCall size={16} className="text-rose-600" aria-hidden />
              <span>CPS Hotline</span>
            </a>
            <Button
              icon={<Plus />}
              onClick={() => {
                handleReportTypeSelect('cps');
                setIsModalOpen(true);
              }}
            >
              Document Report
            </Button>
          </>
        }
      />

      {/* EMERGENCY RESOURCES BANNER */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-[11px] uppercase font-semibold text-amber-800 tracking-wider">MD CPS HOTLINE</p>
            <p className="text-base font-semibold text-amber-950 font-mono mt-0.5">800-332-6347</p>
            <p className="text-xs text-amber-800">Child abuse/neglect</p>
          </div>

          <div>
            <p className="text-[11px] uppercase font-semibold text-amber-800 tracking-wider">MD APS HOTLINE</p>
            <p className="text-base font-semibold text-amber-950 font-mono mt-0.5">800-917-7383</p>
            <p className="text-xs text-amber-800">Vulnerable adult abuse</p>
          </div>

          <div>
            <p className="text-[11px] uppercase font-semibold text-amber-800 tracking-wider">MD DV NETWORK</p>
            <p className="text-base font-semibold text-amber-950 font-mono mt-0.5">800-634-4357</p>
            <p className="text-xs text-amber-800">24-hr domestic violence</p>
          </div>

          <div>
            <p className="text-[11px] uppercase font-semibold text-amber-800 tracking-wider">988 CRISIS</p>
            <p className="text-base font-semibold text-amber-950 font-mono mt-0.5">988</p>
            <p className="text-xs text-amber-800">Suicide/crisis lifeline</p>
          </div>
        </div>
      </div>

      {/* SUMMARY ANALYTICS CARDS (90-Day Metrics) */}
      <StatGrid columns={4}>
        <StatCard label="Total reports (90d)" value={metrics.total90d} icon={<FileText />} tone="brand" />
        <StatCard label="Open cases" value={metrics.openCases} icon={<ShieldAlert />} tone="danger" />
        <StatCard label="Follow-up required" value={metrics.followUpRequired} icon={<Clock />} tone="warning" />
        <StatCard label="Filed with agency" value={metrics.filedWithAgency} icon={<CheckCircle2 />} tone="success" />
      </StatGrid>

      {/* FILTER BAR TABS */}
      <Tabs<'all' | ReportStatus>
        label="Filter reports by status"
        controlsPanels={false}
        value={selectedStatusTab}
        onChange={setSelectedStatusTab}
        items={STATUS_TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
      />

      {/* CASE CARD FEED */}
      <div className="space-y-4">
        {loading ? (
          <Card>
            <LoadingState label="Loading mandatory report records…" />
          </Card>
        ) : filteredRecords.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ShieldAlert />}
              title="No Mandatory Reports Found"
              description={<>Use the &quot;Document Report&quot; button to file new mandatory compliance disclosures.</>}
            />
          </Card>
        ) : (
          filteredRecords.map((r) => {
            const config = REPORT_TYPE_CONFIGS[r.reportType] || REPORT_TYPE_CONFIGS['other'];
            const isExpanded = Boolean(expandedCardIds[r.id]);

            return (
              <Card key={r.id} className="overflow-hidden">
                {/* Header Line */}
                <div className="p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">{r.clientName}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {config.label} · {new Date(r.dateOfDisclosure).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {r.clinician}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="danger" icon={<ShieldAlert />}>
                      IMMEDIATE — Report Now
                    </StatusBadge>

                    <StatusBadge tone="success">Report Filed</StatusBadge>

                    <IconButton
                      label={isExpanded ? 'Collapse report' : 'Expand report'}
                      aria-expanded={isExpanded}
                      icon={isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      onClick={() => toggleCardExpand(r.id)}
                      className="p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    />
                  </div>
                </div>

                {/* EXPANDED CONTENT */}
                {isExpanded && (
                  <div className="p-5 border-t border-slate-100 space-y-4">
                    <div className="rounded-lg bg-slate-50 p-4 space-y-1">
                      <h4 className="text-sm font-semibold text-slate-900">{config.label}</h4>
                      <p className="text-xs text-slate-600">
                        Reported to: <strong className="font-semibold text-slate-800">{r.reportedTo || config.agency}</strong>
                      </p>
                    </div>

                    {/* Disclosure Narrative */}
                    <div>
                      <h5 className="text-xs font-semibold text-slate-700 mb-1">Clinical Fact Summary &amp; Disclosures</h5>
                      <p className="text-sm text-slate-700 bg-slate-50 p-4 rounded-lg leading-relaxed">
                        {r.disclosureNarrative}
                      </p>
                    </div>

                    {/* Actions Taken Checklist */}
                    {r.actionsTaken.length > 0 && (
                      <div>
                        <h5 className="text-xs font-semibold text-slate-700 mb-2">Actions Taken Checklist</h5>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-4 rounded-lg">
                          {r.actionsTaken.map((action, idx) => (
                            <li key={idx} className="flex items-center gap-2 text-xs text-slate-800 font-medium">
                              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" aria-hidden />
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="text-xs text-slate-500">
                      Documented in chart:{' '}
                      <span className="font-semibold text-slate-900">
                        {r.documentedInChart === null ? 'Not recorded' : r.documentedInChart ? 'Yes' : 'No'}
                      </span>
                    </div>

                    {/* Case Number & Action Buttons */}
                    <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
                      <div className="text-xs text-slate-500">
                        Case / Report #: <span className="case-number font-semibold text-slate-900">{r.reportNumber || 'Not assigned'}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary" size="sm" icon={<Printer />} onClick={() => window.print()}>
                          Print Report
                        </Button>

                        <Button
                          size="sm"
                          onClick={() => {
                            setUpdateModalReport(r);
                            setUpdateStatus(r.status);
                            setUpdateReportedTo(r.reportedTo || '');
                            setUpdateReportNumber(r.reportNumber || '');
                            setUpdateFollowUpNotes(r.notes || '');
                          }}
                        >
                          Update Status
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* DOCUMENT MANDATORY REPORT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mr-document-title"
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={20} className="text-blue-600" aria-hidden />
                  <h2 id="mr-document-title" className="text-base font-semibold text-slate-900">Document Mandatory Report</h2>
                </div>
                <p className="text-xs text-amber-800 font-medium mt-1">
                  This creates a permanent, time-stamped clinical record of the disclosure and actions taken.
                </p>
              </div>
              <IconButton
                label="Close"
                icon={<X size={20} />}
                onClick={() => setIsModalOpen(false)}
                className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              />
            </div>

            <div className="space-y-5 px-5 py-5">
              {/* STEP 1: REPORT TYPE SELECTOR */}
              <fieldset>
                <legend className={LABEL}>1. Select Mandatory Report Type *</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(REPORT_TYPE_CONFIGS) as ReportType[]).map((type) => {
                    const cfg = REPORT_TYPE_CONFIGS[type];
                    const isSelected = reportType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => handleReportTypeSelect(type)}
                        className={cx(
                          'p-3 rounded-lg text-left border transition text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
                          isSelected
                            ? 'border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-600'
                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-800'
                        )}
                      >
                        <div className="font-semibold">{cfg.label}</div>
                        <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{cfg.description}</div>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* TARGET AGENCY BANNER */}
              <Alert tone="brand" icon={<Building2 />}>
                <span className="font-semibold">Target Agency Destination: {REPORT_TYPE_CONFIGS[reportType].agency}</span>
              </Alert>

              {/* PRIMARY METADATA GRID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="mr-patient" className={LABEL}>Patient *</label>
                  <select
                    id="mr-patient"
                    value={modalClientId}
                    onChange={(e) => setModalClientId(e.target.value)}
                    className={inputClasses}
                  >
                    <option value="" disabled>Select Patient…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="mr-clinician" className={LABEL}>Reporting Clinician *</label>
                  <input
                    id="mr-clinician"
                    type="text"
                    value={modalClinician}
                    onChange={(e) => setModalClinician(e.target.value)}
                    placeholder="Clinician name"
                    className={inputClasses}
                  />
                </div>

                <div>
                  <label htmlFor="mr-date" className={LABEL}>Date of Disclosure *</label>
                  <input
                    id="mr-date"
                    type="date"
                    value={dateOfDisclosure}
                    onChange={(e) => setDateOfDisclosure(e.target.value)}
                    className={inputClasses}
                  />
                </div>

                <div>
                  <label htmlFor="mr-urgency" className={LABEL}>Urgency Level *</label>
                  <select
                    id="mr-urgency"
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as UrgencyLevel)}
                    className={inputClasses}
                  >
                    <option value="immediate">IMMEDIATE — Report Now</option>
                    <option value="within_24h">Within 24 Hours</option>
                    <option value="within_72h">Within 72 Hours</option>
                    <option value="routine">Routine</option>
                  </select>
                </div>
              </div>

              {/* DISCLOSURE NARRATIVE */}
              <div>
                <label htmlFor="mr-narrative" className={LABEL}>Clinical Disclosure Narrative *</label>
                <textarea
                  id="mr-narrative"
                  rows={4}
                  value={disclosureNarrative}
                  onChange={(e) => setDisclosureNarrative(e.target.value)}
                  placeholder="Objective, factual description of disclosures, clinical observation, context, and immediate safety concerns…"
                  className={cx(inputClasses, 'resize-y')}
                />
              </div>

              {/* CONDITIONAL PARTIES INPUT */}
              {['cps', 'aps'].includes(reportType) && (
                <div>
                  <label htmlFor="mr-victim" className={LABEL}>Identified Victim (Name, Age, Relationship)</label>
                  <input
                    id="mr-victim"
                    type="text"
                    value={identifiedVictim}
                    onChange={(e) => setIdentifiedVictim(e.target.value)}
                    placeholder="e.g. Minor Child (Age 8, Son of client)"
                    className={inputClasses}
                  />
                </div>
              )}

              {reportType === 'duty_to_warn' && (
                <div>
                  <label htmlFor="mr-threat" className="mb-1.5 block text-sm font-semibold text-rose-800">
                    Identified Threatened Third Party (Duty to Warn) *
                  </label>
                  <input
                    id="mr-threat"
                    type="text"
                    value={identifiedThreat}
                    onChange={(e) => setIdentifiedThreat(e.target.value)}
                    placeholder="e.g. Former Employer (Targeted Individual)"
                    className={cx(inputClasses, 'border-rose-300')}
                  />
                </div>
              )}

              {/* FILING DETAILS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="mr-reported-to" className={LABEL}>Reported To Agency / Caseworker</label>
                  <input
                    id="mr-reported-to"
                    type="text"
                    value={reportedTo}
                    onChange={(e) => setReportedTo(e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label htmlFor="mr-report-number" className={LABEL}>Case / Report Number (if assigned)</label>
                  <input
                    id="mr-report-number"
                    type="text"
                    value={reportNumber}
                    onChange={(e) => setReportNumber(e.target.value)}
                    placeholder="e.g. BPD-2026-449821"
                    className={cx(inputClasses, 'case-number')}
                  />
                </div>
              </div>

              {/* DYNAMIC ACTIONS TAKEN CHECKLIST */}
              <fieldset>
                <legend className={LABEL}>Actions Taken Checklist (Check all that apply)</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm bg-slate-50 p-3 rounded-lg">
                  {REPORT_TYPE_CONFIGS[reportType].actionsChecklist.map((item) => {
                    const isChecked = actionsTaken.includes(item);
                    return (
                      <label key={item} className="flex items-center gap-2 cursor-pointer text-slate-800">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleAction(item)}
                          className={CHECKBOX}
                        />
                        <span>{item}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* COMPLIANCE VERIFICATION CHECKBOXES */}
              <fieldset>
                <legend className={LABEL}>Compliance Verification Matrix</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                  <label className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer text-slate-800">
                    <input type="checkbox" className={CHECKBOX} checked={supervisorConsulted} onChange={(e) => setSupervisorConsulted(e.target.checked)} />
                    <span>Supervisor Consulted</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer text-slate-800">
                    <input type="checkbox" className={CHECKBOX} checked={lawEnforcementNotified} onChange={(e) => setLawEnforcementNotified(e.target.checked)} />
                    <span>Law Enforcement Notified</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer text-slate-800">
                    <input type="checkbox" className={CHECKBOX} checked={warningGiven} onChange={(e) => setWarningGiven(e.target.checked)} />
                    <span>Warning Given to 3rd Party</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer text-slate-800">
                    <input type="checkbox" className={CHECKBOX} checked={legalConsultation} onChange={(e) => setLegalConsultation(e.target.checked)} />
                    <span>Legal Consultation</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer text-slate-800">
                    <input type="checkbox" className={CHECKBOX} checked={clientInformed} onChange={(e) => setClientInformed(e.target.checked)} />
                    <span>Client Informed</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer text-slate-800">
                    <input type="checkbox" className={CHECKBOX} checked={documentedInChart} onChange={(e) => setDocumentedInChart(e.target.checked)} />
                    <span>Documented in Chart</span>
                  </label>
                </div>
              </fieldset>
            </div>

            {/* FORM ACTIONS */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
              <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={submitting || !modalClientId || !disclosureNarrative.trim()}
                onClick={handleCreateReportSubmit}
              >
                {submitting ? 'Filing Report…' : 'Save Mandatory Report'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* STATUS UPDATE MODAL */}
      {updateModalReport && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mr-update-title"
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <h2 id="mr-update-title" className="text-base font-semibold text-slate-900">Update Report Status</h2>
              <IconButton
                label="Close"
                icon={<X size={18} />}
                onClick={() => setUpdateModalReport(null)}
                className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              />
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <label htmlFor="mr-update-status" className={LABEL}>Status Lifecycle *</label>
                <select
                  id="mr-update-status"
                  value={updateStatus}
                  onChange={(e) => setUpdateStatus(e.target.value as ReportStatus)}
                  className={inputClasses}
                >
                  <option value="documented">Documented</option>
                  <option value="reported">Report Filed</option>
                  <option value="pending_review">Pending Review</option>
                  <option value="follow_up_required">Follow-Up Req</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div>
                <label htmlFor="mr-update-reported-to" className={LABEL}>Reported To Agency Name</label>
                <input
                  id="mr-update-reported-to"
                  type="text"
                  value={updateReportedTo}
                  onChange={(e) => setUpdateReportedTo(e.target.value)}
                  className={inputClasses}
                />
              </div>

              <div>
                <label htmlFor="mr-update-report-number" className={LABEL}>Case / Report Tracking Number</label>
                <input
                  id="mr-update-report-number"
                  type="text"
                  value={updateReportNumber}
                  onChange={(e) => setUpdateReportNumber(e.target.value)}
                  className={cx(inputClasses, 'case-number')}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
              <Button variant="ghost" onClick={() => setUpdateModalReport(null)}>
                Cancel
              </Button>
              <Button disabled={submitting} onClick={handleUpdateStatusSubmit}>
                {submitting ? 'Updating…' : 'Save Status Update'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
