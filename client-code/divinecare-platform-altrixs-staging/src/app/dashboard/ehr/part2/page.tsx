'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, CheckCircle2, Clock, AlertTriangle, PenLine, Shield, ClipboardList, Scale, ChevronRight } from 'lucide-react';
import { useClients } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { useModuleList } from '@/lib/modules/useModuleList';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';
import { Part2AuditTrail, type LegacyPart2AuditEntry } from './Part2AuditTrail';
import { Part2Disclosures } from './Part2Disclosures';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { buttonClasses, cardClasses, cx, PageHeader, StatusBadge, type Tone, StatCard, StatGrid } from '@/components/ui';

// ─── 42 CFR Part 2 — Substance Use Disorder Confidentiality ──────────────────
// Stricter than HIPAA: explicit written consent required before ANY disclosure
// of SUD treatment records, even between treating providers.

type ConsentStatus = 'active' | 'expired' | 'revoked' | 'pending';
type DisclosureType = 'treatment' | 'payment' | 'operations' | 'legal' | 'research' | 'referral';

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



const DISCLOSURE_TYPES: Record<DisclosureType, { tone: Tone; label: string }> = {
  treatment:   { tone: 'brand', label: 'Treatment' },
  payment:     { tone: 'brand', label: 'Payment' },
  operations:  { tone: 'brand', label: 'Operations' },
  legal:       { tone: 'danger', label: 'Legal' },
  research:    { tone: 'neutral', label: 'Research' },
  referral:    { tone: 'warning', label: 'Referral' },
};

const CONSENT_STATUS_CONFIG: Record<ConsentStatus, { tone: Tone; label: string }> = {
  active:  { tone: 'success', label: 'Active' },
  expired: { tone: 'warning', label: 'Expired' },
  revoked: { tone: 'danger', label: 'Revoked' },
  pending: { tone: 'warning', label: 'Pending' },
};

// Required consent elements (42 CFR §2.31). Also drives the downloadable blank template.
const REQUIRED_CONSENT_ELEMENTS = [
  'Name of patient',
  'Name/title of program disclosing the information',
  'Name/title of recipient of the information',
  'Purpose of the disclosure',
  'Description of information to be disclosed',
  'Patient signature and date',
  'Statement that consent can be revoked',
  'Date/event/condition upon which consent expires',
];

// Blank, printable consent form built in the browser — contains no patient data.
function downloadBlankTemplate() {
  const line = '<div style="border-bottom:1px solid #333;height:28px;margin-bottom:14px"></div>';
  const field = (label: string) => `<p style="margin:0 0 4px;font-weight:600">${label}</p>${line}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>42 CFR Part 2 Consent for Disclosure</title></head>
<body style="font-family:Arial,sans-serif;max-width:720px;margin:32px auto;font-size:13px;color:#111">
<h1 style="font-size:18px">Consent for the Disclosure of Substance Use Disorder Records (42 CFR Part 2)</h1>
${field('1. Patient name')}
${field('Date of birth')}
${field('2. Program disclosing the information (name/title)')}
${field('3. Recipient of the information (name/title or organization)')}
${field('4. Purpose of the disclosure')}
<p style="margin:0 0 4px;font-weight:600">5. Information to be disclosed (check all that apply)</p>
<ul style="list-style:none;padding:0;margin:0 0 14px">
${INFORMATION_TYPES.map((t) => `<li>&#9744; ${t}</li>`).join('\n')}
<li>&#9744; Other: ______________________________</li>
</ul>
<p style="margin:0 0 4px;font-weight:600">6. Right to revoke</p>
<p>I understand that I may revoke this consent at any time, except to the extent that action has already been taken in reliance on it. I understand that my records are protected under federal confidentiality regulations (42 CFR Part 2) and cannot be disclosed without my written consent unless otherwise provided for by the regulations.</p>
${field('7. This consent expires on (date, event, or condition)')}
${field('8. Patient signature')}
${field('Date signed')}
${field('Signature of parent/guardian/authorized representative (if applicable) and relationship')}
${field('Witness')}
<p style="font-size:11px;color:#555;margin-top:24px">Notice to recipient: 42 CFR Part 2 prohibits unauthorized re-disclosure of these records.</p>
</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'part2-consent-blank-template.html';
  a.click();
  // Revoking synchronously can cancel the download in some browsers (Firefox).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  const router = useRouter();
  const { user } = useAuth();
  const privileged = isSensitivePrivilegedRole(user?.role);
  const [tab, setTab] = useState<'clients' | 'consents' | 'audit' | 'disclosures' | 'policy'>('clients');
  const [clients, setClients] = useModuleList<Part2Client>('part2-clients', []);
  // Old browser-editable "audit" list: read-only legacy display, never written to again
  const [legacyAudit] = useModuleList<LegacyPart2AuditEntry>('part2-audit', []);
  const [deniedCount, setDeniedCount] = useState<number | null>(null);

  // Denied-access KPI from the real audit trail (leadership only), loaded on page open
  useEffect(() => {
    if (!privileged) return;
    let cancelled = false;
    fetch('/api/part2/audit-trail?page=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { success?: boolean; denied?: number }) => {
        if (!cancelled && d?.success) setDeniedCount(d.denied ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [privileged]);
  const [now] = useState(() => Date.now());
  const [selectedClient, setSelectedClient] = useState<Part2Client | null>(null);
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [warningClient, setWarningClient] = useState<{ id: string; name: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Revoking a Part 2 consent is a legal disclosure control: confirm before it takes effect
  const [pendingRevoke, setPendingRevoke] = useState<Part2Consent | null>(null);

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

  const allConsents = clients.flatMap(c =>
    c.consents.map(con => ({ ...con, clientName: c.name, program: c.program }))
  );

  const handleAccessWithWarning = (client: { id: string; name: string }) => {
    setWarningClient(client);
    setShowWarning(true);
  };

  // Opening the chart is what gets audited (server-side AuditLog + protected-record checks)
  const acknowledgeAccess = () => {
    setShowWarning(false);
    if (warningClient) router.push(`/dashboard/clients/${encodeURIComponent(warningClient.id)}`);
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
      id: crypto.randomUUID(),
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
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      {pendingRevoke && (
        <ConfirmDialog
          title="Revoke this Part 2 consent?"
          tone="danger"
          confirmLabel="Revoke consent"
          onCancel={() => setPendingRevoke(null)}
          onConfirm={() => {
            revokeConsent(pendingRevoke.clientId, pendingRevoke.id);
            setPendingRevoke(null);
          }}
        >
          <p>
            Disclosures to <strong>{pendingRevoke.disclosureTo}</strong> stop being permitted as of today. Information
            already disclosed in reliance on this consent is not recalled.
          </p>
          <p className="mt-2">Only revoke when the patient has asked to, in writing.</p>
        </ConfirmDialog>
      )}

      {/* Re-disclosure warning modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-clinic-md max-w-md w-full p-6">
            <div className="text-center mb-4">
              <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={28} className="text-rose-600" />
              </div>
              <h2 className="text-lg font-bold text-rose-700">42 CFR Part 2 — Protected Record</h2>
            </div>
            <div className="bg-rose-50 ring-1 ring-inset ring-rose-100 rounded-xl p-4 mb-4 text-sm text-rose-800 space-y-2">
              <p><strong>Federal Law Notice:</strong> Records for <strong>{warningClient?.name}</strong> contain substance use disorder treatment information protected under 42 CFR Part 2.</p>
              <p>This information <strong>cannot be disclosed</strong> to any person or entity, including other treating providers, without a valid written consent signed by the patient.</p>
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
                className={buttonClasses({ variant: 'danger', className: 'flex-1' })}>
                I Acknowledge — Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="42 CFR Part 2"
        description="Substance Use Disorder record protection — stricter than HIPAA. Explicit written consent required for all disclosures."
        actions={<>
          <button onClick={() => setShowConsentForm(true)}
          className={buttonClasses({ variant: 'primary' })}>
          + New Consent Authorization
        </button>
        </>}
      />

      {/* Federal mandate banner */}
      <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 flex gap-4">
        <Scale size={22} className="text-rose-600 shrink-0 mt-0.5" />
        <div className="text-sm text-rose-800">
          <p className="font-bold mb-1">Federal Law: 42 CFR Part 2 — Confidentiality of Substance Use Disorder Patient Records</p>
          <p>These records may not be shared with <strong>anyone</strong> without a signed patient consent — including other treating providers, insurers, courts, or law enforcement — unless a specific exception applies. Violations are subject to <strong>federal criminal penalties</strong>. All access is audit-logged.</p>
        </div>
      </div>

      {/* KPI bar */}
      <StatGrid columns={5}>
        {[
          { label: 'Part 2 Clients', value: flaggedCount, tone: 'brand' as const, iconName: 'lock' },
          { label: 'Active Consents', value: activeConsents, tone: 'success' as const, iconName: 'check' },
          { label: 'Expired Consents', value: expiredConsents, tone: 'warning' as const, iconName: 'clock' },
          { label: 'No Active Consent', value: noConsent, tone: 'danger' as const, iconName: 'alert' },
          { label: 'Denied Access (audit log)', value: privileged ? (deniedCount ?? '—') : '—', tone: 'danger' as const, iconName: 'shield' },
        ].map(({ label, value, tone, iconName }) => (
          <StatCard key={label} label={label} value={value} tone={tone} icon={iconName === 'lock' ? <Lock /> : iconName === 'check' ? <CheckCircle2 /> : iconName === 'clock' ? <Clock /> : iconName === 'alert' ? <AlertTriangle /> : <Shield />} />
        ))}
      </StatGrid>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'clients', label: `Protected Clients (${flaggedCount})` },
          { key: 'consents', label: `Consent Log (${allConsents.length})` },
          { key: 'audit', label: 'Audit Trail' },
          { key: 'disclosures', label: 'Disclosures' },
          { key: 'policy', label: 'Policy & Templates' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.key ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CLIENTS TAB ── */}
      {tab === 'clients' && (
        <div className={cx(cardClasses, 'overflow-hidden')}>
          <div className="px-5 py-4 border-b border-slate-200/80">
            <h2 className="font-semibold text-slate-900">Part 2 Protected Client Registry</h2>
            <p className="text-xs text-slate-500 mt-0.5">Clients whose records contain SUD treatment information under 42 CFR Part 2</p>
          </div>
          <div className="divide-y divide-slate-100">
            {clients.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                No Part 2 flagged clients yet. Use <strong>+ New Consent Authorization</strong> to add a patient from the live roster.
              </div>
            )}
            {clients.map(client => (
              <div key={client.id} className="px-5 py-4 hover:bg-slate-50 flex items-start gap-4 flex-wrap">
                <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-sm font-bold text-rose-700 shrink-0">
                  {client.name.split(' ').map(w => w[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold text-slate-900">{client.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold ring-1 ring-inset ring-rose-100">42 CFR Part 2</span>
                    {!client.hasActiveConsent && (
                      <StatusBadge tone="warning" size="sm" icon={<AlertTriangle />}>No Active Consent</StatusBadge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{client.program} · {client.entity}</p>
                  <p className="text-xs text-slate-500">Clinician: {client.primaryClinician} · Flagged: {client.flaggedDate}</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {client.consents.map(con => {
                      const cfg = CONSENT_STATUS_CONFIG[con.status];
                      return (
                        <StatusBadge key={con.id} tone={cfg.tone} size="sm">
                          {con.status === 'active' && <CheckCircle2 size={11} />}
                          {con.status === 'expired' && <Clock size={11} />}
                          {con.status === 'revoked' && <AlertTriangle size={11} />}
                          {con.status === 'pending' && <Clock size={11} />}
                          {con.disclosureTo.split('—')[0].trim()} · {cfg.label}
                        </StatusBadge>
                      );
                    })}
                    {client.consents.length === 0 && (
                      <span className="text-xs text-slate-500 italic">No consents on file</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleAccessWithWarning({ id: client.id, name: client.name })}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-all">
                    View Record
                  </button>
                  <button onClick={() => { setSelectedClient(client); setNewConsent((f) => ({ ...f, clientId: client.id })); setShowConsentForm(true); }}
                    className={buttonClasses({ variant: 'primary', size: 'sm' })}>
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
                <PenLine size={22} className="text-slate-500" />
              </div>
              <p className="font-semibold text-slate-600">No consent records on file</p>
            </div>
          )}
          {allConsents.map((con) => {
            const statusCfg = CONSENT_STATUS_CONFIG[con.status];
            const typeCfg = DISCLOSURE_TYPES[con.disclosureType];
            const daysLeft = Math.ceil((new Date(con.expirationDate).getTime() - now) / 86400000);
            return (
              <div key={con.id} className={cx(cardClasses, 'overflow-hidden')}>
                <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <StatusBadge tone={statusCfg.tone} size="sm">
                      {con.status === 'active' && <CheckCircle2 size={11} />}
                      {con.status === 'expired' && <Clock size={11} />}
                      {con.status === 'revoked' && <AlertTriangle size={11} />}
                      {con.status === 'pending' && <Clock size={11} />}
                      {statusCfg.label}
                    </StatusBadge>
                    <p className="text-sm font-semibold text-slate-900">{(con as any).clientName}</p>
                    <StatusBadge tone={typeCfg.tone} size="sm">
                      {typeCfg.label}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-slate-500">{(con as any).program}</p>
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
                      <p className={`text-xs font-semibold mt-0.5 ${daysLeft <= 30 ? 'text-amber-700' : 'text-blue-600'}`}>
                        {daysLeft <= 30 ? `Expires in ${daysLeft} days` : `${daysLeft} days remaining`}
                      </p>
                    )}
                    {con.status === 'revoked' && con.revokedDate && (
                      <p className="text-xs text-rose-600 font-semibold mt-0.5">Revoked: {con.revokedDate}</p>
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
                  <div className="text-xs text-rose-700 bg-rose-50 ring-1 ring-inset ring-rose-100 rounded-lg px-3 py-2 flex-1">
                    <strong>Re-disclosure prohibited.</strong> Recipients may not re-disclose this information without a separate written patient consent.
                  </div>
                  {con.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => setPendingRevoke(con)}
                      className="text-xs px-3 py-2 rounded-lg font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100 hover:bg-rose-100 transition-all"
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

      {/* ── AUDIT TRAIL TAB (real AuditLog + protected-record access log, read-only) ── */}
      {tab === 'audit' && (
        <Part2AuditTrail privileged={privileged} legacy={privileged ? legacyAudit : []} onDeniedCount={setDeniedCount} />
      )}

      {/* ── DISCLOSURES TAB (append-only Part2Disclosure + accounting of disclosures) ── */}
      {tab === 'disclosures' && (
        <Part2Disclosures roster={roster.map((c) => ({ id: c.id, name: c.name }))} informationTypes={INFORMATION_TYPES} />
      )}

      {/* ── POLICY TAB ── */}
      {tab === 'policy' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              {
                title: '42 CFR Part 2 — Key Requirements', iconName: 'scale', iconCls: 'text-rose-700',
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
                title: 'Exceptions to Consent Requirement', iconName: 'clipboard', iconCls: 'text-amber-700',
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
            ].map(({ title, iconName, iconCls, items }) => (
              <div key={title} className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-5">
                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  {iconName === 'scale' && <Scale size={18} aria-hidden className={iconCls} />}
                  {iconName === 'clipboard' && <ClipboardList size={18} aria-hidden className={iconCls} />}
                  {title}
                </h3>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <ChevronRight size={14} aria-hidden className={`mt-0.5 shrink-0 ${iconCls}`} />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Consent form template */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-5">
            <h3 className="font-semibold text-slate-900 mb-2">Required Elements — Valid 42 CFR Part 2 Consent Form</h3>
            <p className="text-xs text-slate-500 mb-4">A consent form is invalid if any of these 8 elements are missing (42 CFR §2.31)</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {REQUIRED_CONSENT_ELEMENTS.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
                  <CheckCircle2 size={14} className="text-blue-500 shrink-0" /> {i + 1}. {item}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => { setSelectedClient(null); setFormError(null); setShowConsentForm(true); }}
                className={buttonClasses({ variant: 'primary' })}>
                Generate Consent Form
              </button>
              <button type="button" onClick={downloadBlankTemplate}
                className={buttonClasses({ variant: 'secondary' })}>
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
              <button onClick={() => { setShowConsentForm(false); setSelectedClient(null); }} className="text-slate-500 hover:text-slate-600">&times;</button>
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
              <div className="bg-rose-50 ring-1 ring-inset ring-rose-100 rounded-xl p-3 text-xs text-rose-700">
                <strong>Notice:</strong> Patient must be informed they have the right to revoke this consent at any time. This disclosure is limited to the information and recipient specified above.
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowConsentForm(false); setSelectedClient(null); setFormError(null); }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={saveConsent}
                  className={buttonClasses({ variant: 'primary', className: 'flex-1' })}>
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
