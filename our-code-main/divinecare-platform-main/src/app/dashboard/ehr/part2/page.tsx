'use client';
import { useState } from 'react';
import { Lock, CheckCircle2, Clock, AlertTriangle, Eye, Send, Printer, FileOutput, RefreshCw, PenLine, Shield, ClipboardList, Scale } from 'lucide-react';
import { useClients } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';

// ─── 42 CFR Part 2 — Substance Use Disorder Confidentiality ──────────────────
// Stricter than HIPAA: explicit written consent required before ANY disclosure
// of SUD treatment records, even between treating providers.

type ConsentStatus = 'active' | 'expired' | 'revoked' | 'pending';
type DisclosureType = 'treatment' | 'payment' | 'operations' | 'legal' | 'research' | 'referral';
type AuditAction = 'view' | 'share' | 'print' | 'fax' | 'referral' | 'consent-update';

interface Part2Client {
  id: string;
  name: string;
  dob: string;
  entity: string;
  program: string;
  flaggedDate: string;
  primaryClinician: string;
  consents: Part2Consent[];
  hasActiveConsent: boolean;
}

interface Part2Consent {
  id: string;
  clientId: string;
  disclosureTo: string;
  disclosureType: DisclosureType;
  purpose: string;
  informationCovered: string[];
  effectiveDate: string;
  expirationDate: string;
  status: ConsentStatus;
  revokedDate?: string;
  witnessedBy: string;
  signedBy: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  clientName: string;
  performedBy: string;
  disclosedTo?: string;
  consentVerified: boolean;
  notes: string;
}


const DISCLOSURE_TYPES: Record<DisclosureType, { label: string; color: string; bg: string }> = {
  treatment:   { label: 'Treatment', color: '#6868D0', bg: '#F5F3FF' },
  payment:     { label: 'Payment',   color: '#5555B8', bg: '#EEF0FE' },
  operations:  { label: 'Operations',color: '#5555B8', bg: '#EEF0FE' },
  legal:       { label: 'Legal',     color: '#DC2626', bg: '#FEF2F2' },
  research:    { label: 'Research',  color: '#6B7280', bg: '#F9FAFB' },
  referral:    { label: 'Referral',  color: '#B45309', bg: '#FFFBEB' },
};

const CONSENT_STATUS_CONFIG: Record<ConsentStatus, { label: string; color: string; bg: string; border: string }> = {
  active:  { label: 'Active',  color: '#5555B8', bg: '#EEF0FE', border: '#C5C7F8' },
  expired: { label: 'Expired', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  revoked: { label: 'Revoked', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  pending: { label: 'Pending', color: '#5555B8', bg: '#EEF0FE', border: '#BFDBFE' },
};

const AUDIT_CONFIG: Record<AuditAction, { label: string; iconName: string; color: string }> = {
  view:           { label: 'Record Viewed',   iconName: 'eye',     color: '#5555B8' },
  share:          { label: 'Record Shared',   iconName: 'send',    color: '#6868D0' },
  print:          { label: 'Record Printed',  iconName: 'printer', color: '#6B7280' },
  fax:            { label: 'Record Faxed',    iconName: 'fileout', color: '#6B7280' },
  referral:       { label: 'Referral Sent',   iconName: 'refresh', color: '#5555B8' },
  'consent-update':{ label: 'Consent Updated', iconName: 'pen',   color: '#B45309' },
};

const INFORMATION_TYPES = [
  'Substance use treatment records',
  'Urine drug screen results',
  'Medication-assisted treatment (MAT)',
  'Attendance and participation records',
  'Clinical assessment summary',
  'Substance use history',
  'Current medications',
  'Diagnosis information',
  'Treatment plan goals',
];


export default function Part2Page() {
  const { clients: roster } = useClients();
  const [tab, setTab] = useState<'clients' | 'consents' | 'audit' | 'policy'>('clients');
  const [clients, setClients] = useModuleList<Part2Client>('part2-clients', []);
  const [auditLog, setAuditLog] = useModuleList<AuditEntry>('part2-audit', []);
  const [now] = useState(() => Date.now());
  const [selectedClient, setSelectedClient] = useState<Part2Client | null>(null);
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [warningClient, setWarningClient] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [newConsent, setNewConsent] = useState({
    clientId: '',
    disclosureTo: '',
    disclosureType: 'treatment' as DisclosureType,
    purpose: '',
    informationCovered: [] as string[],
    effectiveDate: '',
    expirationDate: '',
  });

  const flaggedCount = clients.length;
  const activeConsents = clients.flatMap(c => c.consents).filter(c => c.status === 'active').length;
  const expiredConsents = clients.flatMap(c => c.consents).filter(c => c.status === 'expired').length;
  const noConsent = clients.filter(c => !c.hasActiveConsent).length;
  const unauthorizedAccess = auditLog.filter(a => !a.consentVerified).length;

  const allConsents = clients.flatMap(c =>
    c.consents.map(con => ({ ...con, clientName: c.name, program: c.program }))
  );

  const handleAccessWithWarning = (clientName: string) => {
    setWarningClient(clientName);
    setShowWarning(true);
  };

  const acknowledgeAccess = () => {
    setAuditLog((prev) => [
      {
        id: `audit-${Date.now()}`,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
        action: 'view',
        clientName: warningClient,
        performedBy: 'Staff',
        consentVerified: clients.some((c) => c.name === warningClient && c.hasActiveConsent),
        notes: 'Staff opened Part 2 protected record',
      },
      ...prev,
    ]);
    setShowWarning(false);
  };

  const saveConsent = () => {
    const clientId = newConsent.clientId || selectedClient?.id || '';
    if (!clientId || !newConsent.disclosureTo.trim() || !newConsent.purpose.trim()) {
      setFormError('Patient, recipient, and purpose are required.');
      return;
    }
    const rosterClient = roster.find((c) => c.id === clientId);
    const existing = clients.find((c) => c.id === clientId);
    const consent: Part2Consent = {
      id: `c-${Date.now()}`,
      clientId,
      disclosureTo: newConsent.disclosureTo.trim(),
      disclosureType: newConsent.disclosureType,
      purpose: newConsent.purpose.trim(),
      informationCovered: newConsent.informationCovered,
      effectiveDate: newConsent.effectiveDate || new Date().toISOString().slice(0, 10),
      expirationDate: newConsent.expirationDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      status: 'pending',
      witnessedBy: 'Clinic staff',
      signedBy: existing?.name || rosterClient?.name || 'Patient',
    };
    if (existing) {
      setClients((prev) =>
        prev.map((c) =>
          c.id === clientId
            ? { ...c, consents: [consent, ...c.consents], hasActiveConsent: c.hasActiveConsent }
            : c
        )
      );
    } else {
      setClients((prev) => [
        {
          id: clientId,
          name: rosterClient?.name || 'Client',
          dob: rosterClient?.dateOfBirth || '',
          entity: 'This clinic',
          program: rosterClient?.primaryDiagnosis || 'SUD / dual diagnosis',
          flaggedDate: new Date().toISOString().slice(0, 10),
          primaryClinician: rosterClient?.assignedToName || 'Assigned clinician',
          hasActiveConsent: false,
          consents: [consent],
        },
        ...prev,
      ]);
    }
    setAuditLog((prev) => [
      {
        id: `audit-${Date.now()}`,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
        action: 'consent-update',
        clientName: existing?.name || rosterClient?.name || 'Client',
        performedBy: 'Staff',
        consentVerified: true,
        notes: `New Part 2 consent pending — ${consent.disclosureTo}`,
      },
      ...prev,
    ]);
    setShowConsentForm(false);
    setSelectedClient(null);
    setFormError(null);
    setNewConsent({
      clientId: '',
      disclosureTo: '',
      disclosureType: 'treatment',
      purpose: '',
      informationCovered: [],
      effectiveDate: '',
      expirationDate: '',
    });
  };

  const revokeConsent = (clientId: string, consentId: string) => {
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== clientId) return c;
        const consents = c.consents.map((con) =>
          con.id === consentId
            ? { ...con, status: 'revoked' as const, revokedDate: new Date().toISOString().slice(0, 10) }
            : con
        );
        return {
          ...c,
          consents,
          hasActiveConsent: consents.some((con) => con.status === 'active'),
        };
      })
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Re-disclosure warning modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-clinic-md max-w-md w-full p-6">
            <div className="text-center mb-4">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={28} className="text-red-600" />
              </div>
              <h2 className="text-lg font-bold text-red-700">42 CFR Part 2 — Protected Record</h2>
            </div>
            <div className="bg-red-50 ring-1 ring-inset ring-red-100 rounded-xl p-4 mb-4 text-sm text-red-800 space-y-2">
              <p><strong>Federal Law Notice:</strong>Records for<strong>{warningClient}</strong>contain substance use disorder treatment information protected under 42 CFR Part 2.</p>
              <p>This information<strong>cannot be disclosed</strong>to any person or entity, including other treating providers, without a valid written consent signed by the patient.</p>
              <p><strong>Violations are subject to federal criminal penalties.</strong></p>
            </div>
            <p className="text-xs text-slate-500 mb-4 text-center">
              Prohibition on re-disclosure: Any recipient of this information is bound by the same confidentiality requirements.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowWarning(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel Access
              </button>
              <button onClick={acknowledgeAccess}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold"
                style={{ background: '#DC2626' }}>
                I Acknowledge — Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-slate-900">42 CFR Part 2</h1>
            <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-bold ring-1 ring-inset ring-red-100">Federal Confidentiality</span>
          </div>
          <p className="text-slate-500 text-sm">Substance Use Disorder record protection — stricter than HIPAA. Explicit written consent required for all disclosures.</p>
        </div>
        <button onClick={() => setShowConsentForm(true)}
          className="px-4 py-2.5 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-all"
          style={{ background: '#6868D0' }}>
          + New Consent Authorization
        </button>
      </div>

      {/* Federal mandate banner */}
      <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 flex gap-4">
        <Scale size={22} className="text-red-600 shrink-0 mt-0.5" />
        <div className="text-sm text-red-800">
          <p className="font-bold mb-1">Federal Law: 42 CFR Part 2 — Confidentiality of Substance Use Disorder Patient Records</p>
          <p>These records may not be shared with<strong>anyone</strong>without a signed patient consent — including other treating providers, insurers, courts, or law enforcement — unless a specific exception applies. Violations are subject to<strong>federal criminal penalties</strong>. All access is audit-logged.</p>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Part 2 Clients', value: flaggedCount, color: '#6868D0', iconName: 'lock' },
          { label: 'Active Consents', value: activeConsents, color: '#5555B8', iconName: 'check' },
          { label: 'Expired Consents', value: expiredConsents, color: '#B45309', iconName: 'clock' },
          { label: 'No Active Consent', value: noConsent, color: '#DC2626', iconName: 'alert' },
          { label: 'Unauthorized Access', value: unauthorizedAccess, color: '#DC2626', iconName: 'shield' },
        ].map(({ label, value, color, iconName }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color + '18' }}>
                {iconName === 'lock' && <Lock size={14} style={{ color }} />}
                {iconName === 'check' && <CheckCircle2 size={14} style={{ color }} />}
                {iconName === 'clock' && <Clock size={14} style={{ color }} />}
                {iconName === 'alert' && <AlertTriangle size={14} style={{ color }} />}
                {iconName === 'shield' && <Shield size={14} style={{ color }} />}
              </div>
              <span className="text-2xl font-semibold" style={{ color }}>{value}</span>
            </div>
            <p className="text-xs font-semibold text-slate-600">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'clients', label: `Protected Clients (${flaggedCount})` },
          { key: 'consents', label: `Consent Log (${allConsents.length})` },
          { key: 'audit', label: `Audit Trail (${auditLog.length})` },
          { key: 'policy', label: 'Policy & Templates' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CLIENTS TAB ── */}
      {tab === 'clients' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200/80">
            <h2 className="font-semibold text-slate-900">Part 2 Protected Client Registry</h2>
            <p className="text-xs text-slate-400 mt-0.5">Clients whose records contain SUD treatment information under 42 CFR Part 2</p>
          </div>
          <div className="divide-y divide-slate-100">
            {clients.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                No Part 2 flagged clients yet. Use <strong>+ New Consent Authorization</strong> to add a patient from the live roster.
              </div>
            )}
            {clients.map(client => (
              <div key={client.id} className="px-5 py-4 hover:bg-slate-50 flex items-start gap-4 flex-wrap">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-sm font-bold text-red-700 shrink-0">
                  {client.name.split(' ').map(w => w[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold text-slate-900">{client.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold ring-1 ring-inset ring-red-100">42 CFR Part 2</span>
                    {!client.hasActiveConsent && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold ring-1 ring-inset ring-amber-100 flex items-center gap-1"><AlertTriangle size={11} />No Active Consent</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{client.program} · {client.entity}</p>
                  <p className="text-xs text-slate-400">Clinician: {client.primaryClinician} · Flagged: {client.flaggedDate}</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {client.consents.map(con => {
                      const cfg = CONSENT_STATUS_CONFIG[con.status];
                      return (
                        <span key={con.id} className="text-xs px-2 py-0.5 rounded-full font-semibold border inline-flex items-center gap-1"
                          style={{ backgroundColor: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                          {con.status === 'active' && <CheckCircle2 size={11} />}
                          {con.status === 'expired' && <Clock size={11} />}
                          {con.status === 'revoked' && <AlertTriangle size={11} />}
                          {con.status === 'pending' && <Clock size={11} />}
                          {con.disclosureTo.split('—')[0].trim()} · {cfg.label}
                        </span>
                      );
                    })}
                    {client.consents.length === 0 && (
                      <span className="text-xs text-slate-400 italic">No consents on file</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleAccessWithWarning(client.name)}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-all">
                    View Record
                  </button>
                  <button onClick={() => { setSelectedClient(client); setNewConsent((f) => ({ ...f, clientId: client.id })); setShowConsentForm(true); }}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all hover:opacity-90"
                    style={{ background: '#6868D0' }}>
                    + Consent
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CONSENT LOG TAB ── */}
      {tab === 'consents' && (
        <div className="space-y-4">
          {allConsents.length === 0 && (
            <div className="text-center py-16 bg-white rounded-xl border border-slate-200/80">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                <PenLine size={22} className="text-slate-400" />
              </div>
              <p className="font-semibold text-slate-600">No consent records on file</p>
            </div>
          )}
          {allConsents.map((con) => {
            const statusCfg = CONSENT_STATUS_CONFIG[con.status];
            const typeCfg = DISCLOSURE_TYPES[con.disclosureType];
            const daysLeft = Math.ceil((new Date(con.expirationDate).getTime() - now) / 86400000);
            return (
              <div key={con.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs px-2.5 py-1 rounded-full font-bold border inline-flex items-center gap-1"
                      style={{ backgroundColor: statusCfg.bg, color: statusCfg.color, borderColor: statusCfg.border }}>
                      {con.status === 'active' && <CheckCircle2 size={11} />}
                      {con.status === 'expired' && <Clock size={11} />}
                      {con.status === 'revoked' && <AlertTriangle size={11} />}
                      {con.status === 'pending' && <Clock size={11} />}
                      {statusCfg.label}
                    </span>
                    <p className="text-sm font-semibold text-slate-900">{(con as any).clientName}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: typeCfg.bg, color: typeCfg.color }}>
                      {typeCfg.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{(con as any).program}</p>
                </div>
                <div className="p-5 grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">Disclosure To</p>
                    <p className="text-sm text-slate-900">{con.disclosureTo}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">Purpose</p>
                    <p className="text-sm text-slate-900">{con.purpose}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">Information Covered</p>
                    <div className="flex flex-wrap gap-1">
                      {con.informationCovered.map(i => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full">{i}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">Validity Period</p>
                    <p className="text-sm text-slate-900">{con.effectiveDate} → {con.expirationDate}</p>
                    {con.status === 'active' && daysLeft > 0 && (
                      <p className={`text-xs font-semibold mt-0.5 ${daysLeft <= 30 ? 'text-amber-600' : 'text-blue-600'}`}>
                        {daysLeft <= 30 ? `Expires in ${daysLeft} days` : `${daysLeft} days remaining`}
                      </p>
                    )}
                    {con.status === 'revoked' && con.revokedDate && (
                      <p className="text-xs text-red-600 font-semibold mt-0.5">Revoked: {con.revokedDate}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">Signed By</p>
                    <p className="text-sm text-slate-900">{con.signedBy}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">Witnessed By</p>
                    <p className="text-sm text-slate-900">{con.witnessedBy}</p>
                  </div>
                </div>
                <div className="px-5 pb-4 border-t border-slate-200/80 pt-3 flex gap-2 flex-wrap">
                  <div className="text-xs text-red-700 bg-red-50 ring-1 ring-inset ring-red-100 rounded-lg px-3 py-2 flex-1">
                    <strong>Re-disclosure prohibited.</strong> Recipients may not re-disclose this information without a separate written patient consent.
                  </div>
                  {con.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => revokeConsent(con.clientId, con.id)}
                      className="text-xs px-3 py-2 rounded-lg font-semibold bg-red-50 text-red-700 ring-1 ring-inset ring-red-100 hover:bg-red-100 transition-all"
                    >
                      Revoke Consent
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── AUDIT TRAIL TAB ── */}
      {tab === 'audit' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200/80">
            <h2 className="font-semibold text-slate-900">Access & Disclosure Audit Log</h2>
            <p className="text-xs text-slate-400 mt-0.5">All access to 42 CFR Part 2 protected records is automatically logged and tamper-evident</p>
          </div>
          <div className="divide-y divide-slate-100">
            {auditLog.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                No audit events yet. Viewing a protected record logs access here.
              </div>
            )}
            {auditLog.map(entry => {
              const cfg = AUDIT_CONFIG[entry.action];
              return (
                <div key={entry.id} className={`px-5 py-4 flex items-start gap-4 hover:bg-slate-50 ${!entry.consentVerified ? 'bg-red-50' : ''}`}>
                  <span className="shrink-0">
                  {cfg.iconName === 'eye' && <Eye size={18} style={{ color: cfg.color }} />}
                  {cfg.iconName === 'send' && <Send size={18} style={{ color: cfg.color }} />}
                  {cfg.iconName === 'printer' && <Printer size={18} style={{ color: cfg.color }} />}
                  {cfg.iconName === 'fileout' && <FileOutput size={18} style={{ color: cfg.color }} />}
                  {cfg.iconName === 'refresh' && <RefreshCw size={18} style={{ color: cfg.color }} />}
                  {cfg.iconName === 'pen' && <PenLine size={18} style={{ color: cfg.color }} />}
                </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-semibold text-slate-900">{entry.clientName}</p>
                      <span className="text-xs font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                      {!entry.consentVerified && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold ring-1 ring-inset ring-red-100 inline-flex items-center gap-1"><AlertTriangle size={11} />CONSENT NOT VERIFIED</span>
                      )}
                      {entry.consentVerified && (
                        <span className="text-xs text-blue-600 font-semibold flex items-center gap-0.5"><CheckCircle2 size={11} />Consent verified</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">{entry.notes}</p>
                    {entry.disclosedTo && <p className="text-xs text-slate-500 mt-0.5">Disclosed to: {entry.disclosedTo}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">{entry.performedBy} · {entry.timestamp}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── POLICY TAB ── */}
      {tab === 'policy' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              {
                title: '42 CFR Part 2 — Key Requirements', iconName: 'scale', color: '#DC2626',
                items: [
                  'Written patient consent required before ANY disclosure',
                  'Consent must name specific recipient — cannot disclose to unnamed third parties',
                  'Re-disclosure by recipients is prohibited without new consent',
                  'Cannot be compelled by subpoena or court order (with limited exceptions)',
                  'Applies to records related to SUD diagnosis, treatment, or referral',
                  'More restrictive than HIPAA Treatment/Payment/Operations allowances',
                  'Patient may revoke consent in writing at any time',
                ],
              },
              {
                title: 'Exceptions to Consent Requirement', iconName: 'clipboard', color: '#B45309',
                items: [
                  'Medical emergency — immediate threat to life',
                  'Research with IRB approval and no patient identification',
                  'Audit or evaluation by oversight entities',
                  'Court order meeting specific legal standards (higher bar than HIPAA)',
                  'Crimes on program premises or against program staff',
                  'Child abuse/neglect reporting as required by state law',
                  'FDA oversight for investigational drugs',
                ],
              },
            ].map(({ title, iconName, color, items }) => (
              <div key={title} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  {iconName === 'scale' && <Scale size={18} style={{ color }} />}
                  {iconName === 'clipboard' && <ClipboardList size={18} style={{ color }} />}
                  {title}
                </h3>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-0.5 shrink-0 text-xs font-bold" style={{ color }}>▸</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Consent form template */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <h3 className="font-semibold text-slate-900 mb-2">Required Elements — Valid 42 CFR Part 2 Consent Form</h3>
            <p className="text-xs text-slate-500 mb-4">A consent form is invalid if any of these 8 elements are missing (45 CFR §2.31)</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                '1. Name of patient',
                '2. Name/title of program disclosing the information',
                '3. Name/title of recipient of the information',
                '4. Purpose of the disclosure',
                '5. Description of information to be disclosed',
                '6. Patient signature and date',
                '7. Statement that consent can be revoked',
                '8. Date/event/condition upon which consent expires',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
                  <CheckCircle2 size={14} className="text-blue-500 shrink-0" /> {item}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => { setSelectedClient(null); setFormError(null); setShowConsentForm(true); }}
                className="px-4 py-2.5 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-all"
                style={{ background: '#6868D0' }}>
                Generate Consent Form
              </button>
              <button className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all">
                Download Blank Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New consent form modal */}
      {showConsentForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-clinic-md max-w-lg w-full p-6 my-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">New 42 CFR Part 2 Consent Authorization</h2>
              <button onClick={() => { setShowConsentForm(false); setSelectedClient(null); }} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <div className="space-y-4">
              {formError ? <p className="text-xs font-medium text-rose-700">{formError}</p> : null}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Patient *</label>
                <select
                  value={newConsent.clientId || selectedClient?.id || ''}
                  onChange={(e) => setNewConsent((f) => ({ ...f, clientId: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select patient…</option>
                  {roster.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Disclosure To (Recipient) *</label>
                <input
                  type="text"
                  value={newConsent.disclosureTo}
                  onChange={(e) => setNewConsent((f) => ({ ...f, disclosureTo: e.target.value }))}
                  placeholder="Name of person, program, or organization"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Type of Disclosure *</label>
                <select
                  value={newConsent.disclosureType}
                  onChange={(e) => setNewConsent((f) => ({ ...f, disclosureType: e.target.value as DisclosureType }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {Object.entries(DISCLOSURE_TYPES).map(([key, val]) =><option key={key} value={key}>{val.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Purpose of Disclosure *</label>
                <textarea
                  rows={2}
                  value={newConsent.purpose}
                  onChange={(e) => setNewConsent((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="Specific reason for sharing this information…"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2">Information to be Disclosed *</label>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {INFORMATION_TYPES.map(info => (
                    <label key={info} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newConsent.informationCovered.includes(info)}
                        onChange={() =>
                          setNewConsent((f) => ({
                            ...f,
                            informationCovered: f.informationCovered.includes(info)
                              ? f.informationCovered.filter((i) => i !== info)
                              : [...f.informationCovered, info],
                          }))
                        }
                        className="accent-blue-600"
                      />
                      {info}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Effective Date *</label>
                  <input
                    type="date"
                    value={newConsent.effectiveDate}
                    onChange={(e) => setNewConsent((f) => ({ ...f, effectiveDate: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Expiration Date *</label>
                  <input
                    type="date"
                    value={newConsent.expirationDate}
                    onChange={(e) => setNewConsent((f) => ({ ...f, expirationDate: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div className="bg-red-50 ring-1 ring-inset ring-red-100 rounded-xl p-3 text-xs text-red-700">
                <strong>Notice:</strong> Patient must be informed they have the right to revoke this consent at any time. This disclosure is limited to the information and recipient specified above.
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowConsentForm(false); setSelectedClient(null); setFormError(null); }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={saveConsent}
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-all"
                  style={{ background: '#6868D0' }}>
                  Save & Print for Signature
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
