'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  DollarSign,
  CreditCard,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Filter,
  FileText,
  Send,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  ChevronRight,
  Printer,
  Copy,
  Check,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import {
  getMedicalClaims,
  saveMedicalClaims,
  getMedicalPatients,
} from '@/features/medical/data';
import { MedicalClaimItem, MedicalPatient } from '@/features/medical/types';

export default function MedicalBillingPage() {
  const [claims, setClaims] = useState<MedicalClaimItem[]>([]);
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
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
  const [icd10Pointers, setIcd10Pointers] = useState('I10, E11.9');
  const [billedAmount, setBilledAmount] = useState(195.0);
  const [payerName, setPayerName] = useState('CareFirst BlueCross BlueShield');
  const [payerId, setPayerId] = useState('00580');
  const [renderingNpi, setRenderingNpi] = useState('1497820194');

  useEffect(() => {
    // 1. Initial load from local fallback
    setClaims(getMedicalClaims());
    const patList = getMedicalPatients();
    setPatients(patList);
    if (patList.length > 0) {
      setPatientId(patList[0].id);
    }

    // 2. Fetch live data from backend database
    async function loadData() {
      try {
        const [chargesRes, patsRes] = await Promise.all([
          fetch('/api/medical/billing/charges'),
          fetch('/api/medical/patients'),
        ]);
        if (chargesRes.ok) {
          const data = await chargesRes.json();
          if (data.charges && Array.isArray(data.charges)) {
            setClaims(data.charges);
            saveMedicalClaims(data.charges);
          }
        }
        if (patsRes.ok) {
          const data = await patsRes.json();
          if (data.patients && Array.isArray(data.patients)) {
            setPatients(data.patients);
            if (data.patients.length > 0 && !patientId) {
              setPatientId(data.patients[0].id);
            }
          }
        }
      } catch (err) {
        console.error('Error loading live charges:', err);
      }
    }

    loadData();

    const handler = () => {
      setClaims(getMedicalClaims());
      setPatients(getMedicalPatients());
    };
    window.addEventListener('medical_claims_updated', handler);
    return () => window.removeEventListener('medical_claims_updated', handler);
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

  // Aggregate KPIs
  const totalBilled = useMemo(() => {
    return claims.reduce((sum, c) => sum + c.billedAmount, 0);
  }, [claims]);

  const cleanClaimRate = 96.4; // %
  const daysInAR = 24.8; // days
  const denialsCount = useMemo(() => {
    return claims.filter((c) => c.status === 'Denied').length;
  }, [claims]);

  const handleToggleModifier = (mod: string) => {
    setModifiers((prev) => (prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]));
  };

  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === patientId);
    if (!pat) return;

    const newClaim: MedicalClaimItem = {
      id: `CLM-${Date.now().toString().slice(-6)}`,
      patientId: pat.id,
      patientName: pat.name,
      mrn: pat.mrn,
      dos,
      cptCode,
      modifiers,
      icd10Pointers: icd10Pointers.split(',').map((s) => s.trim().toUpperCase()),
      billedAmount: Number(billedAmount),
      allowedAmount: Number(billedAmount) * 0.78,
      paidAmount: 0,
      balance: Number(billedAmount),
      payerName,
      payerId,
      status: 'Ready',
      renderingNpi,
    };

    try {
      await fetch('/api/medical/billing/charges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: pat.name,
          mrn: pat.mrn,
          dateOfService: dos,
          cptCode,
          modifier: modifiers.join(', '),
          units: 1,
          chargeAmount: Number(billedAmount),
          primaryIcd10: icd10Pointers.split(',')[0]?.trim().toUpperCase() || 'I10',
          secondaryIcd10: icd10Pointers.split(',').slice(1).join(', ') || undefined,
          renderingProvider: renderingNpi,
          payer: payerName,
          status: 'Ready',
        }),
      });
    } catch (err) {
      console.error('Failed to persist charge to API:', err);
    }

    const updated = [newClaim, ...claims];
    setClaims(updated);
    saveMedicalClaims(updated);
    setShowNewClaimModal(false);
  };

  const handleResubmitClaim = async (claimId: string) => {
    try {
      await fetch('/api/medical/billing/charges', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chargeId: claimId,
          status: 'Submitted',
        }),
      });
    } catch (err) {
      console.error('Failed to resubmit charge via API:', err);
    }

    const updated = claims.map((c) =>
      c.id === claimId
        ? {
            ...c,
            status: 'Submitted' as const,
            denialCode: undefined,
            denialReason: undefined,
          }
        : c
    );
    setClaims(updated);
    saveMedicalClaims(updated);
    setShowAppealModal(false);
  };

  const appealLetterText = useMemo(() => {
    if (!selectedClaimForAppeal) return '';
    return `========================================================================================
FORMAL HEALTHCARE CLAIM APPEAL & RECONSIDERATION REQUEST
DIVINECARE MEDICAL GROUP | NPI: 1497820194 | TAX ID: 52-1948201
========================================================================================

DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
TO: Claims Appeals Department — ${selectedClaimForAppeal.payerName}
PAYER ID: ${selectedClaimForAppeal.payerId}

RE: FORMAL DISPUTE OF CLAIM DENIAL
  - Patient Name: ${selectedClaimForAppeal.patientName}
  - Medical Record Number (MRN): ${selectedClaimForAppeal.mrn}
  - Claim Reference ID: ${selectedClaimForAppeal.id}
  - Date of Service (DOS): ${selectedClaimForAppeal.dos}
  - Procedure (CPT): ${selectedClaimForAppeal.cptCode} ${selectedClaimForAppeal.modifiers.join(', ')}
  - Billed Charges: $${selectedClaimForAppeal.billedAmount.toFixed(2)}
  - Denial Reason / CARC: ${selectedClaimForAppeal.denialCode || 'CO-4'} — ${selectedClaimForAppeal.denialReason || 'Procedure inconsistent with modifier'}

CLINICAL APPEAL RATIONALE & JUSTIFICATION:
Please accept this correspondence as a formal first-level appeal for the above-referenced claim.
Review of the attached clinical documentation indicates that the somatic service rendered on ${selectedClaimForAppeal.dos}
met all Centers for Medicare & Medicaid Services (CMS) and AMA coding guidelines for medical necessity.

Specifically:
1. Significant, separately identifiable Evaluation and Management (E&M) service was performed,
   satisfying the criteria for Modifier -25 attachment.
2. Active diagnoses documented include: ${selectedClaimForAppeal.icd10Pointers.join(', ')}.
3. Medical records substantiate that comprehensive examination and medical decision-making were conducted.

REQUESTED ACTION:
We respectfully request reprocessing of claim #${selectedClaimForAppeal.id} and immediate adjudication of the
allowed benefit balance of $${selectedClaimForAppeal.allowedAmount.toFixed(2)}.

Sincerely,
DivineCare Health Billing & Revenue Cycle Management
Toll-Free Appeals Line: (800) 555-0199 | Direct EDI Escalations: claims@divinecare.org
========================================================================================`;
  }, [selectedClaimForAppeal]);

  const handleCopyAppeal = () => {
    navigator.clipboard.writeText(appealLetterText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <MedicalNavHeader
        title="Medical Billing & Revenue Cycle Management"
        subtitle="Primary care charge capture, 837P electronic claim filing, modifier logic, and CARC denial adjudication"
        badge="HIPAA 5010 / 837P Compliant"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* KPI Summary Banners */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Billed Charges</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">
                ${totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <p className="text-[11px] text-emerald-600 mt-0.5 font-medium">+14.2% vs prior month</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <DollarSign className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Clean Claim Rate</p>
              <h3 className="text-2xl font-black text-emerald-600 mt-1">{cleanClaimRate}%</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Target: &ge;95% clean pass</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Days in A/R</p>
              <h3 className="text-2xl font-black text-indigo-600 mt-1">{daysInAR} <span className="text-sm font-normal text-slate-500">days</span></h3>
              <p className="text-[11px] text-emerald-600 mt-0.5 font-medium">Industry benchmark: &lt;35 days</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Denials</p>
              <h3 className="text-2xl font-black text-rose-600 mt-1">{denialsCount}</h3>
              <p className="text-[11px] text-rose-500 mt-0.5 font-medium">Appeal letters ready</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Filter and Action Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['All', 'Ready', 'Submitted', 'Paid', 'Denied'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab === 'All' ? 'All Claims' : tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search claim, patient, or payer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              onClick={() => setShowNewClaimModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition shrink-0 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Claim Entry
            </button>
          </div>
        </div>

        {/* Charge Capture Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">Medical Encounters & Charge Capture</h3>
              <p className="text-xs text-slate-500">837P electronic claim filing register</p>
            </div>
            <span className="text-xs text-slate-500">
              Showing <strong>{filteredClaims.length}</strong> claims
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                  <th className="py-3 px-4">Claim ID / DOS</th>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">CPT &amp; Modifiers</th>
                  <th className="py-3 px-4">ICD-10 Pointers</th>
                  <th className="py-3 px-4">Payer</th>
                  <th className="py-3 px-4">Billed / Allowed</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredClaims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-mono text-xs font-bold text-slate-900">{claim.id}</div>
                      <div className="text-[11px] text-slate-500 font-mono">DOS: {claim.dos}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link
                        href={`/dashboard/medical/patients/${claim.patientId}`}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 block"
                      >
                        {claim.patientName}
                      </Link>
                      <span className="text-[11px] text-slate-400 font-mono">{claim.mrn}</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono text-xs font-bold text-slate-800">{claim.cptCode}</span>
                      {claim.modifiers.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {claim.modifiers.map((m) => (
                            <span key={m} className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[10px] font-mono">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {claim.icd10Pointers.map((icd) => (
                          <span key={icd} className="bg-indigo-50 text-indigo-700 font-mono text-[11px] px-1.5 py-0.5 rounded">
                            {icd}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="text-xs text-slate-800 font-medium">{claim.payerName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">ID: {claim.payerId}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-bold text-slate-900">${claim.billedAmount.toFixed(2)}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Allowed: ${claim.allowedAmount.toFixed(2)}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          claim.status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                            : claim.status === 'Submitted'
                            ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
                            : claim.status === 'Ready'
                            ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                            : claim.status === 'Denied'
                            ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {claim.status}
                      </span>
                      {claim.denialCode && (
                        <div className="text-[10px] text-rose-600 font-bold font-mono mt-0.5">
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
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition shadow-sm"
                        >
                          <FileText className="w-3 h-3" />
                          Appeal Denial
                        </button>
                      ) : claim.status === 'Ready' ? (
                        <button
                          onClick={() => {
                            const updated = claims.map((c) =>
                              c.id === claim.id ? { ...c, status: 'Submitted' as const } : c
                            );
                            saveMedicalClaims(updated);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition shadow-sm"
                        >
                          <Send className="w-3 h-3" />
                          Submit 837P
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Settled</span>
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
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Denial Adjudication &amp; Level 1 Appeal Generator
                </h3>
              </div>
              <button
                onClick={() => setShowAppealModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
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
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
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

              <button
                type="button"
                onClick={() => handleResubmitClaim(selectedClaimForAppeal.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Re-submit Corrected Claim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Claim Modal */}
      {showNewClaimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                Create Primary Care Medical Claim (CMS-1500 / 837P)
              </h3>
              <button
                onClick={() => setShowNewClaimModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mrn}) — Age {p.age}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Date of Service (DOS) *
                  </label>
                  <input
                    type="date"
                    required
                    value={dos}
                    onChange={(e) => setDos(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    CPT Code *
                  </label>
                  <select
                    value={cptCode}
                    onChange={(e) => setCptCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
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
                      className={`px-3 py-1 rounded text-xs font-mono font-bold transition border ${
                        modifiers.includes(mod)
                          ? 'bg-indigo-600 text-white border-indigo-600'
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

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
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                >
                  Create &amp; Validate Claim
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
