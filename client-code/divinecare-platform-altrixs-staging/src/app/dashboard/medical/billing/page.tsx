'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Plus,
  Search,
  FileText,
  Send,
  RefreshCw,
  Printer,
  Copy,
  Check,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { apiJson } from '@/lib/api-client';
import { MedicalClaimItem } from '@/features/medical/types';

/** Charge-form picker row (/api/medical/billing/patients): no chart data. */
type BillingPatient = { id: string; clientId: string | null; mrn: string; name: string; dob: string; age: number };
import { displayAge } from '@/features/medical/format';
import { medicalChartHref } from '@/lib/medical/medicalProgram';
import { MedicalBillingSummaryPanel } from '@/features/billing/overview/MedicalBillingSummaryPanel';
import { useAuth } from '@/features/auth';
import { canUpdateMedicalChargeStatus, medicalChargeCreateScope } from '@/lib/billing/billingAccess';
import { buttonClasses } from '@/components/ui';

export default function MedicalBillingPage() {
  const [claims, setClaims] = useState<MedicalClaimItem[]>([]);
  const [patients, setPatients] = useState<BillingPatient[]>([]);
  const [activeTab, setActiveTab] = useState<'All' | 'Ready' | 'Submitted' | 'Paid' | 'Denied'>('All');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [showNewClaimModal, setShowNewClaimModal] = useState(false);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [selectedClaimForAppeal, setSelectedClaimForAppeal] = useState<MedicalClaimItem | null>(null);
  const [copied, setCopied] = useState(false);

  // New Claim Form
  const [patientId, setPatientId] = useState('');
  const [dos, setDos] = useState(new Date().toISOString().split('T')[0]);
  const [cptCode, setCptCode] = useState('99214');
  const [modifiers, setModifiers] = useState<string[]>(['-25']);
  const [icd10Pointers, setIcd10Pointers] = useState('');
  const [billedAmount, setBilledAmount] = useState(195.0);
  const [payerName, setPayerName] = useState('');
  const [payerId, setPayerId] = useState('');
  const [renderingNpi, setRenderingNpi] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [pageMsg, setPageMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { user } = useAuth();
  // Same rules as /api/medical/billing/charges: status changes (Mark Submitted / Resubmitted) are
  // billing core only; new charges are billing core (any visit) or PHYSICIAN / MEDICAL_NP (own visit).
  const canMarkSubmitted = canUpdateMedicalChargeStatus(user?.role);
  const canCreateCharge = medicalChargeCreateScope(user?.role) !== null;

  // Charges and patients come from the database; nothing is cached in the browser.
  const loadClaims = async () => {
    const data = await apiJson<{ charges: MedicalClaimItem[] }>('/api/medical/billing/charges');
    setClaims(Array.isArray(data.charges) ? data.charges : []);
  };

  useEffect(() => {
    loadClaims().catch((err) =>
      setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not load charges.' })
    );
    apiJson<{ patients: BillingPatient[] }>('/api/medical/billing/patients')
      .then((data) => Array.isArray(data.patients) ? data.patients : [])
      .then((list) => {
        setPatients(list);
        if (list.length > 0) setPatientId((cur) => cur || list[0].id);
      })
      .catch((err) =>
        setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not load patients.' })
      );
  }, []);

  // Filtered claims
  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      if (activeTab !== 'All' && claim.status !== activeTab) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mPat = claim.patientName.toLowerCase().includes(q) || claim.mrn.toLowerCase().includes(q);
        const mCpt = claim.cptCode.toLowerCase().includes(q);
        const mPayer = claim.payerName.toLowerCase().includes(q);
        if (!mPat && !mCpt && !mPayer) return false;
      }
      return true;
    });
  }, [claims, activeTab, searchTerm]);

  const handleToggleModifier = (mod: string) => {
    setModifiers((prev) => (prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]));
  };

  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === patientId);
    if (!pat || isSaving) return;
    const icds = icd10Pointers
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (icds.length === 0) {
      setFormError('Enter at least one ICD-10 code.');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      await apiJson('/api/medical/billing/charges', {
        method: 'POST',
        body: JSON.stringify({
          clientId: pat.clientId || undefined,
          mrn: pat.mrn,
          dateOfService: dos,
          cptCode,
          modifier: modifiers.join(', '),
          units: 1,
          chargeAmount: Number(billedAmount),
          primaryIcd10: icds[0],
          secondaryIcd10: icds.slice(1).join(', ') || undefined,
          renderingProvider: renderingNpi,
          payer: payerName,
          payerId,
          status: 'Ready',
        }),
      });
      await loadClaims();
      setShowNewClaimModal(false);
      setPageMsg({ type: 'success', text: 'Charge saved as Ready. It has not been submitted to a payer.' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the charge.');
    } finally {
      setIsSaving(false);
    }
  };

  // Records that a claim was (re)submitted outside Altrixs. Nothing is transmitted from here.
  const handleMarkSubmitted = async (claimId: string) => {
    if (busyClaimId) return;
    if (
      !window.confirm(
        'Record this claim as submitted? Altrixs does not transmit medical claims; only do this after you have submitted it through the clearinghouse.'
      )
    ) {
      return;
    }
    setBusyClaimId(claimId);
    try {
      await apiJson('/api/medical/billing/charges', {
        method: 'PATCH',
        body: JSON.stringify({ chargeId: claimId, status: 'Submitted' }),
      });
      await loadClaims();
      setShowAppealModal(false);
      setPageMsg({ type: 'success', text: 'Claim status recorded as Submitted.' });
    } catch (err) {
      setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not update the claim.' });
    } finally {
      setBusyClaimId(null);
    }
  };

  const appealLetterText = useMemo(() => {
    if (!selectedClaimForAppeal) return '';
    const claim = selectedClaimForAppeal;
    const hasMod25 = claim.modifiers.some((m) => m.replace(/^-/, '').trim() === '25');
    const rationale = [
      ...(hasMod25
        ? [
            `A significant, separately identifiable Evaluation and Management (E&M) service was performed by the rendering provider (NPI: ${claim.renderingNpi || '[Rendering NPI]'}), supporting Modifier -25. [Confirm against the visit note before sending.]`,
          ]
        : []),
      `Diagnoses billed on this claim: ${claim.icd10Pointers.join(', ') || '[Diagnosis codes]'}.`,
      '[Summarize the documentation that supports medical necessity for this service.]',
    ]
      .map((line, i) => `${i + 1}. ${line}`)
      .join('\n');
    return `========================================================================================
FORMAL HEALTHCARE CLAIM APPEAL & RECONSIDERATION REQUEST
MD BEHAVIORAL HEALTH | NPI: [Group NPI] | TAX ID: [Tax ID]
========================================================================================

DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
TO: Claims Appeals Department — ${claim.payerName}
PAYER ID: ${claim.payerId || '[Payer ID]'}

RE: FORMAL DISPUTE OF CLAIM DENIAL
  - Patient Name: ${claim.patientName}
  - Medical Record Number (MRN): ${claim.mrn}
  - Claim Reference ID: ${claim.id}
  - Date of Service (DOS): ${claim.dos}
  - Procedure (CPT): ${claim.cptCode} ${claim.modifiers.join(', ')}
  - Billed Charges: $${claim.billedAmount.toFixed(2)}
  - Denial Reason / CARC: ${claim.denialCode || '[Denial code]'} — ${claim.denialReason || '[Denial reason]'}

CLINICAL APPEAL RATIONALE & JUSTIFICATION:
Please accept this correspondence as a formal first-level appeal for the above-referenced claim
for the service rendered on ${claim.dos}.

Specifically:
${rationale}

REQUESTED ACTION:
We respectfully request reprocessing of claim #${claim.id} and adjudication of the
billed charges of $${claim.billedAmount.toFixed(2)}.

Sincerely,
MD Behavioral Health Billing & Revenue Cycle Management
Appeals Line: [Billing Office Phone] | EDI Escalations: [Billing Office Email]
========================================================================================`;
  }, [selectedClaimForAppeal]);

  const handleCopyAppeal = () => {
    navigator.clipboard.writeText(appealLetterText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
      <MedicalNavHeader
        title="Medical Billing & Revenue Cycle Management"
        subtitle="Primary care charge capture, modifier logic, claim status tracking, and denial appeal letters"
        badge="Claims are not transmitted from this page"
      />

      <div className="min-w-0">
        {pageMsg && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
              pageMsg.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {pageMsg.text}
          </div>
        )}
        {/* Billing summary: Valant Family Practice (imported) and Altrixs medical charges (live), never summed */}
        <MedicalBillingSummaryPanel refreshKey={claims} />

        {/* Filter and Action Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['All', 'Ready', 'Submitted', 'Paid', 'Denied'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab === 'All' ? 'All Claims' : tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search claim, patient, or payer…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {canCreateCharge && (
            <button
              onClick={() => {
                setFormError('');
                setShowNewClaimModal(true);
              }}
              className={buttonClasses({ size: 'sm', className: 'shrink-0' })}
            >
              <Plus className="w-4 h-4" />
              New Claim Entry
            </button>
            )}
          </div>
        </div>

        {/* Charge Capture Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">Medical Encounters & Charge Capture</h3>
              <p className="text-xs text-slate-500">Charge register (submit claims through the clearinghouse, then mark them here)</p>
            </div>
            <span className="text-xs text-slate-500">
              Showing <strong>{filteredClaims.length}</strong> claims
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                  <th scope="col" className="py-3 px-4">Claim ID / DOS</th>
                  <th scope="col" className="py-3 px-4">Patient</th>
                  <th scope="col" className="py-3 px-4">CPT &amp; Modifiers</th>
                  <th scope="col" className="py-3 px-4">ICD-10 Pointers</th>
                  <th scope="col" className="py-3 px-4">Payer</th>
                  <th scope="col" className="py-3 px-4">Billed / Allowed</th>
                  <th scope="col" className="py-3 px-4">Status</th>
                  <th scope="col" className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredClaims.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                      {claims.length === 0 ? 'No medical claims yet.' : 'No claims match your filters.'}
                    </td>
                  </tr>
                )}
                {filteredClaims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-mono text-xs font-semibold text-slate-900">{claim.id}</div>
                      <div className="text-[11px] text-slate-500 font-mono">DOS: {claim.dos}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link
                        href={medicalChartHref(claim.patientId)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 block"
                      >
                        {claim.patientName}
                      </Link>
                      <span className="text-[11px] text-slate-500 font-mono">{claim.mrn}</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono text-xs font-semibold text-slate-800">{claim.cptCode}</span>
                      {claim.modifiers.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {claim.modifiers.map((m) => (
                            <span key={m} className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[11px] font-mono">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {claim.icd10Pointers.map((icd) => (
                          <span key={icd} className="bg-blue-50 text-blue-700 font-mono text-[11px] px-1.5 py-0.5 rounded">
                            {icd}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="text-xs text-slate-800 font-medium">{claim.payerName}</div>
                      {claim.payerId && (
                        <div className="text-[11px] text-slate-500 font-mono">ID: {claim.payerId}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">${claim.billedAmount.toFixed(2)}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          claim.status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                            : claim.status === 'Submitted'
                            ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
                            : claim.status === 'Ready'
                            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                            : claim.status === 'Denied'
                            ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {claim.status}
                      </span>
                      {claim.denialCode && (
                        <div className="text-[11px] text-rose-600 font-semibold font-mono mt-0.5">
                          {claim.denialCode}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {claim.status === 'Denied' ? (
                        <button
                          onClick={() => {
                            setSelectedClaimForAppeal(claim);
                            setShowAppealModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition shadow-xs"
                        >
                          <FileText className="w-3 h-3" />
                          Appeal Denial
                        </button>
                      ) : claim.status === 'Ready' && canMarkSubmitted ? (
                        <button
                          onClick={() => void handleMarkSubmitted(claim.id)}
                          disabled={busyClaimId !== null}
                          title="Records the status only; Altrixs does not transmit medical 837P claims yet"
                          className={buttonClasses({ size: 'sm' })}
                        >
                          <Send className="w-3 h-3" />
                          {busyClaimId === claim.id ? 'Saving…' : 'Mark Submitted'}
                        </button>
                      ) : claim.status === 'Ready' ? (
                        <span className="text-xs text-slate-500 font-medium">Ready for billing</span>
                      ) : (
                        <span className="text-xs text-slate-500 font-medium">Settled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Appeal Denial Modal */}
      {showAppealModal && selectedClaimForAppeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-3xl w-full p-6 max-h-[calc(100dvh-2rem)] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  Denial Adjudication &amp; Level 1 Appeal Generator
                </h3>
              </div>
              <button
                onClick={() => setShowAppealModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
              >
                &times;
              </button>
            </div>

            <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900">
              <strong>CARC Denial Code:</strong> {selectedClaimForAppeal.denialCode || 'CO-4'}{' '}
              &bull; {selectedClaimForAppeal.denialReason || 'The procedure code is inconsistent with the modifier used.'}
            </div>

            <div className="mt-3 flex-1 overflow-y-auto">
              <pre className="p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl overflow-x-auto whitespace-pre leading-relaxed border border-slate-800">
                {appealLetterText}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyAppeal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied to Clipboard' : 'Copy Appeal Letter'}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="w-4 h-4" />
                  Print
                </button>
              </div>

              {canMarkSubmitted && (
              <button
                type="button"
                onClick={() => void handleMarkSubmitted(selectedClaimForAppeal.id)}
                disabled={busyClaimId !== null}
                title="Records the status only; nothing is sent to the payer"
                className={buttonClasses({ size: 'sm' })}
              >
                <RefreshCw className="w-4 h-4" />
                Mark Corrected Claim Resubmitted
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Claim Modal */}
      {showNewClaimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-xl w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Create Primary Care Medical Claim (CMS-1500 / 837P)
              </h3>
              <button
                onClick={() => setShowNewClaimModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateClaim} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Patient *
                </label>
                <select
                  required
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mrn}) — Age {displayAge(p)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Date of Service (DOS) *
                  </label>
                  <input
                    type="date"
                    required
                    value={dos}
                    onChange={(e) => setDos(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    CPT Code *
                  </label>
                  <select
                    value={cptCode}
                    onChange={(e) => setCptCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="99212">99212 — Office Visit Level 2</option>
                    <option value="99213">99213 — Office Visit Level 3</option>
                    <option value="99214">99214 — Office Visit Level 4 (Moderate MDM)</option>
                    <option value="99215">99215 — Office Visit Level 5 (High MDM)</option>
                    <option value="99395">99395 — Preventive Physical (18-39 yo)</option>
                    <option value="99396">99396 — Preventive Physical (40-64 yo)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Billing Modifiers
                </label>
                <div className="flex flex-wrap gap-2">
                  {['-25', '-59', '-95', '-GT'].map((mod) => (
                    <button
                      type="button"
                      key={mod}
                      onClick={() => handleToggleModifier(mod)}
                      className={`px-3 py-1 rounded text-xs font-mono font-semibold transition border ${
                        modifiers.includes(mod)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-100 text-slate-700 border-slate-300'
                      }`}
                    >
                      {mod} {mod === '-25' ? '(Significant E&M)' : mod === '-95' ? '(Telehealth)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ICD-10 Diagnostic Pointers (Box 24E) *
                </label>
                <input
                  type="text"
                  required
                  value={icd10Pointers}
                  onChange={(e) => setIcd10Pointers(e.target.value)}
                  placeholder="e.g. I10, E11.9, E78.5"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Billed Charges ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={billedAmount}
                    onChange={(e) => setBilledAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Rendering Provider NPI *
                  </label>
                  <input
                    type="text"
                    required
                    value={renderingNpi}
                    onChange={(e) => setRenderingNpi(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Electronic Payer ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={payerId}
                    onChange={(e) => setPayerId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {formError && <p className="text-xs font-semibold text-rose-700">{formError}</p>}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewClaimModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className={buttonClasses()}
                >
                  {isSaving ? 'Saving…' : 'Save Charge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
