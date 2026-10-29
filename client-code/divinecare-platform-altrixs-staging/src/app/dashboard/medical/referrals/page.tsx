'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  FileText,
  Send,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Copy,
  Printer,
  Sparkles,
  Camera,
  UserCheck,
  Search,
  ExternalLink,
  ChevronRight,
  Check,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { fetchMedicalChart, fetchMedicalPatients } from '@/features/medical/api';
import { MedicalPatient, MedicalReferral } from '@/features/medical/types';
import { displayAge, displayDob, vitalText } from '@/features/medical/format';
import { buttonClasses } from '@/components/ui';

const IMAGING_CPT_PRESETS = [
  { modality: 'MRI Brain with and without contrast', cpt: '70553', indications: 'Intractable headache, stroke rule-out, neurol. deficit' },
  { modality: 'CT Abdomen and Pelvis with contrast', cpt: '74177', indications: 'Acute abdominal pain, diverticulitis, appendicitis' },
  { modality: 'Chest X-Ray 2 Views (PA & Lateral)', cpt: '71046', indications: 'Dyspnea, cough, pneumonia evaluation, CHF' },
  { modality: 'Echocardiogram Transthoracic Complete', cpt: '93306', indications: 'Murmur, heart failure, hypertensive heart disease' },
  { modality: 'Ultrasound Renal / Retroperitoneal', cpt: '76770', indications: 'Elevated creatinine, flank pain, hematuria, hydronephrosis' },
  { modality: 'Mammography Bilateral Diagnostic', cpt: '77066', indications: 'Palpable breast mass, abnormal screening call-back' },
  { modality: 'DEXA Bone Density Scan (Axial)', cpt: '77080', indications: 'Osteoporosis evaluation, postmenopausal baseline' },
];

export default function MedicalReferralsPage() {
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [activeTab, setActiveTab] = useState<'Specialist' | 'Imaging' | 'Pending' | 'Completed'>('Specialist');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [showSpecialistModal, setShowSpecialistModal] = useState(false);
  const [showImagingModal, setShowImagingModal] = useState(false);
  const [showLetterModal, setShowLetterModal] = useState(false);
  const [consultLetterContent, setConsultLetterContent] = useState('');
  const [copied, setCopied] = useState(false);

  // Form states
  const [selectedPatId, setSelectedPatId] = useState('');
  const [specialty, setSpecialty] = useState('Cardiology');
  const [facility, setFacility] = useState('');
  const [referralReason, setReferralReason] = useState('');
  const [clinicalSummary, setClinicalSummary] = useState('');
  const [urgency, setUrgency] = useState<'Routine' | 'Urgent' | 'STAT'>('Routine');

  // Imaging form
  const [selectedImagingPreset, setSelectedImagingPreset] = useState(IMAGING_CPT_PRESETS[0]);
  const [imagingFacility, setImagingFacility] = useState('');
  const [imagingReason, setImagingReason] = useState('');

  const [isPreparing, setIsPreparing] = useState(false);
  // Letterhead from practice settings + the signed-in provider (NPI); null fields stay as [placeholders]
  const [letterhead, setLetterhead] = useState<{
    practiceName: string | null;
    address: string | null;
    phone: string | null;
    fax: string | null;
    providerName: string | null;
    providerCredentials: string | null;
    providerNpi: string | null;
  } | null>(null);
  useEffect(() => {
    fetch('/api/medical/referrals/letterhead')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) setLetterhead(d.letterhead);
      })
      .catch(() => undefined);
  }, []);
  const unresolvedPlaceholders = useMemo(
    () => Array.from(new Set(consultLetterContent.match(/\[[^\]\n]{2,80}\]/g) ?? [])),
    [consultLetterContent]
  );
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    fetchMedicalPatients()
      .then((list) => {
        setPatients(list);
        if (list.length > 0) setSelectedPatId((cur) => cur || list[0].id);
      })
      .catch((err) => setPageError(err instanceof Error ? err.message : 'Could not load patients.'));
  }, []);

  const flattenedReferrals = useMemo(() => {
    const list: { patient: MedicalPatient; referral: MedicalReferral }[] = [];
    patients.forEach((pat) => {
      pat.referrals.forEach((ref) => {
        list.push({ patient: pat, referral: ref });
      });
    });
    return list;
  }, [patients]);

  const filteredReferrals = useMemo(() => {
    return flattenedReferrals.filter(({ patient, referral }) => {
      if (activeTab === 'Specialist' && referral.type !== 'Specialist') return false;
      if (activeTab === 'Imaging' && referral.type !== 'Imaging') return false;
      if (activeTab === 'Pending' && referral.status === 'Completed') return false;
      if (activeTab === 'Completed' && referral.status !== 'Completed') return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mPat = patient.name.toLowerCase().includes(q) || patient.mrn.toLowerCase().includes(q);
        const mSpec = referral.specialtyOrModality.toLowerCase().includes(q);
        const mFac = referral.providerOrFacility.toLowerCase().includes(q);
        const mReason = referral.reason.toLowerCase().includes(q);
        if (!mPat && !mSpec && !mFac && !mReason) return false;
      }
      return true;
    });
  }, [flattenedReferrals, activeTab, searchTerm]);

  const handleGenerateConsultLetter = (patient: MedicalPatient, referral: MedicalReferral) => {
    const activeProblems = patient.problems.filter((p) => p.status !== 'Resolved').map((p) => `${p.icd10} - ${p.description}`).join('\n  - ');
    const activeMeds = patient.medications.filter((m) => m.status === 'Active').map((m) => `${m.name} ${m.dosage} (${m.frequency})`).join('\n  - ');
    const recentVitals = patient.vitals[0]
      ? `BP: ${vitalText(patient.vitals[0].systolic)}/${vitalText(patient.vitals[0].diastolic)} mmHg | HR: ${vitalText(patient.vitals[0].heartRate)} bpm | BMI: ${vitalText(patient.vitals[0].bmi)} (recorded ${patient.vitals[0].recordedAt.slice(0, 10) || 'date unknown'})`
      : 'No vitals recorded';
    // An empty allergy list means nothing was entered in Altrixs, not that the patient has none.
    const allergyText = patient.allergies.length
      ? patient.allergies.map((a) => `${a.substance} (${a.severity})`).join(', ')
      : 'No allergies recorded in Altrixs — verify with patient';
    const ins = patient.demographics.primaryInsurance;
    const insuranceText = ins.payerName
      ? `${ins.payerName}${ins.memberId ? ` (ID: ${ins.memberId})` : ' (Member ID not documented)'}`
      : 'Not documented';

    const lh = letterhead;
    const practice = lh?.practiceName || '[Practice name]';
    const fax = lh?.fax || '[Clinic Fax]';
    const provider = lh?.providerName
      ? `${lh.providerName}${lh.providerCredentials ? `, ${lh.providerCredentials}` : ''}`
      : '[Referring Provider Name, Credentials]';
    const npi = lh?.providerNpi || '[NPI]';
    const letter = `========================================================================================
${practice.toUpperCase()} — CLINICAL CONSULTATION REQUEST
${lh?.address || '[Clinic Address]'} | Phone: ${lh?.phone || '[Clinic Phone]'} | Fax: ${fax}
========================================================================================

DATE OF REFERRAL: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
REFERRING PROVIDER: ${provider} (NPI: ${npi})
SPECIALTY REQUESTED: ${referral.specialtyOrModality}
TARGET FACILITY / CLINIC: ${referral.providerOrFacility}
URGENCY LEVEL: ${referral.urgency}

PATIENT IDENTIFICATION:
  - Legal Name: ${patient.name}
  - Preferred Name: ${patient.preferredName || patient.name}
  - Date of Birth: ${displayDob(patient)} (Age: ${displayAge(patient)} years)
  - Medical Record Number (MRN): ${patient.mrn}
  - Phone: ${patient.phone} | Email: ${patient.email}
  - Primary Insurance: ${insuranceText}

REASON FOR CONSULTATION:
${referral.reason}

CLINICAL NARRATIVE & CONTEXT:
${referral.clinicalSummary}

RECENT BIOMETRIC VITALS:
${recentVitals}

ACTIVE SOMATIC PROBLEM LIST:
  - ${activeProblems || 'None documented'}

CURRENT MEDICATIONS:
  - ${activeMeds || 'No active medications'}

KNOWN ALLERGIES:
  - ${allergyText}

CLINICAL REQUEST & NEXT STEPS:
Please evaluate and provide recommended diagnostic and therapeutic management plan.
Kindly send the consultation report by secure fax to ${fax} upon encounter completion.

REFERRING PROVIDER SIGNATURE:
${provider}
National Provider Identifier (NPI): ${npi}
${practice}
========================================================================================`;

    setConsultLetterContent(letter);
    setShowLetterModal(true);
  };

  // There is no referral / imaging-order table yet, so nothing is saved or transmitted. The
  // form produces a printable letter from the live chart for the clinician to fax or send.
  const prepareLetter = async (referral: MedicalReferral) => {
    const pat = patients.find((p) => p.id === selectedPatId);
    if (!pat || isPreparing) return false;
    setIsPreparing(true);
    setPageError('');
    try {
      const chart = await fetchMedicalChart(pat.id, pat);
      handleGenerateConsultLetter(chart, referral);
      return true;
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Could not load the chart for this letter.');
      return false;
    } finally {
      setIsPreparing(false);
    }
  };

  const handleCreateSpecialistReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await prepareLetter({
      id: '',
      type: 'Specialist',
      specialtyOrModality: specialty,
      providerOrFacility: facility,
      status: 'Draft',
      orderDate: new Date().toISOString().split('T')[0],
      reason: referralReason,
      clinicalSummary: clinicalSummary || '[Clinician to add clinical summary]',
      urgency,
    });
    if (ok) setShowSpecialistModal(false);
  };

  const handleCreateImagingOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await prepareLetter({
      id: '',
      type: 'Imaging',
      specialtyOrModality: selectedImagingPreset.modality,
      cptCode: selectedImagingPreset.cpt,
      providerOrFacility: imagingFacility,
      status: 'Draft',
      orderDate: new Date().toISOString().split('T')[0],
      reason: imagingReason || selectedImagingPreset.indications,
      clinicalSummary: `Diagnostic imaging requested (CPT ${selectedImagingPreset.cpt}).`,
      urgency,
    });
    if (ok) setShowImagingModal(false);
  };

  const handleCopyLetter = () => {
    if (unresolvedPlaceholders.length > 0) return;
    navigator.clipboard.writeText(consultLetterContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
      <MedicalNavHeader
        title="Specialist Referrals & Diagnostic Imaging"
        subtitle="Inter-provider clinical consult orders, automated consult letters, and CPT imaging requisitions"
        badge="Print / fax only (not transmitted)"
      />

      <div className="min-w-0">
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
          Not connected yet: referrals and imaging orders are not stored or transmitted by Altrixs. Use the forms
          below to prepare a printable letter, then fax it and document the referral in the visit note.
        </div>
        {pageError && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {pageError}
          </div>
        )}
        {/* Top Actions & Filter Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab('Specialist')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Specialist'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Specialist Consults
            </button>
            <button
              onClick={() => setActiveTab('Imaging')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Imaging'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Diagnostic Imaging
            </button>
            <button
              onClick={() => setActiveTab('Pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Pending'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Pending Authorization
            </button>
            <button
              onClick={() => setActiveTab('Completed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Completed'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Completed / Reports In
            </button>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search consult or patient…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={() => setShowSpecialistModal(true)}
              className={buttonClasses({ size: 'sm', className: 'shrink-0' })}
            >
              <UserCheck className="w-4 h-4" />
              New Referral
            </button>

            <button
              onClick={() => setShowImagingModal(true)}
              className={buttonClasses({ size: 'sm', className: 'shrink-0' })}
            >
              <Camera className="w-4 h-4" />
              Order Imaging
            </button>
          </div>
        </div>

        {/* Referrals & Orders Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredReferrals.map(({ patient, referral }) => (
            <div
              key={referral.id}
              className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 flex flex-col justify-between hover:border-blue-300 transition"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                      referral.type === 'Specialist'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-sky-50 text-sky-700 border border-sky-200'
                    }`}
                  >
                    {referral.type === 'Specialist' ? <UserCheck className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                    {referral.type}
                  </span>

                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      referral.urgency === 'STAT'
                        ? 'bg-rose-100 text-rose-800 animate-pulse'
                        : referral.urgency === 'Urgent'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {referral.urgency}
                  </span>
                </div>

                <h3 className="font-semibold text-slate-900 text-base leading-snug">
                  {referral.specialtyOrModality}
                </h3>
                {referral.cptCode && (
                  <span className="font-mono text-xs text-blue-600 font-semibold">CPT {referral.cptCode}</span>
                )}

                <div className="mt-2 text-xs text-slate-600">
                  Target: <strong className="text-slate-800">{referral.providerOrFacility}</strong>
                </div>

                <div className="mt-3 bg-slate-50 rounded-lg p-2.5 border border-slate-100 text-xs">
                  <div className="text-slate-500 font-semibold mb-0.5">Clinical Rationale:</div>
                  <p className="text-slate-800 line-clamp-2">{referral.reason}</p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500 border-t border-slate-100 pt-2.5">
                  <div className="min-w-0 truncate">
                    <span className="text-slate-500">Patient: </span>
                    <Link
                      href={`/dashboard/medical/patients/${patient.id}`}
                      className="font-medium text-slate-800 hover:text-blue-600"
                    >
                      {patient.name}
                    </Link>
                  </div>
                  <span className="font-mono text-[11px]">{referral.orderDate}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    referral.status === 'Completed'
                      ? 'text-emerald-700'
                      : referral.status === 'Pending Authorization'
                      ? 'text-amber-700'
                      : 'text-blue-600'
                  }`}
                >
                  {referral.status === 'Completed' ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                  {referral.status}
                </span>

                <button
                  onClick={() => handleGenerateConsultLetter(patient, referral)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 rounded-lg text-xs font-semibold transition"
                >
                  <Sparkles className="w-3 h-3 text-blue-600" />
                  Consult Letter
                </button>
              </div>
            </div>
          ))}

          {filteredReferrals.length === 0 && (
            <div className="col-span-full py-12 text-center bg-white rounded-xl border border-slate-200">
              <FileText className="w-12 h-12 text-slate-500 mx-auto mb-2" />
              <p className="text-slate-600 font-medium">No referrals found in this view.</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Consult Letter Modal */}
      {showLetterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-3xl w-full p-6 max-h-[calc(100dvh-2rem)] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  Specialist Consult / Imaging Request Letter
                </h3>
              </div>
              <button
                onClick={() => setShowLetterModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto">
              <textarea
                value={consultLetterContent}
                onChange={(e) => setConsultLetterContent(e.target.value)}
                aria-label="Consult letter text (editable)"
                spellCheck
                className="h-[50vh] w-full p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl leading-relaxed border border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {unresolvedPlaceholders.length > 0 ? (
                <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Replace every bracketed placeholder before printing or copying: {unresolvedPlaceholders.join(', ')}.
                  Practice phone / fax come from Practice settings; your NPI and credentials from your profile.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 pt-4 border-t border-slate-200 mt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                Not saved and not transmitted. Print or copy this letter and fax it to the specialist.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLetter}
                  disabled={unresolvedPlaceholders.length > 0}
                  className="disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied to Clipboard' : 'Copy Letter Text'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (unresolvedPlaceholders.length === 0) window.print();
                  }}
                  disabled={unresolvedPlaceholders.length > 0}
                  className={buttonClasses({ size: 'sm' })}
                >
                  <Printer className="w-4 h-4" />
                  Print Consult
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Specialist Referral Modal */}
      {showSpecialistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-xl w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Create Specialist Referral Requisition
              </h3>
              <button
                onClick={() => setShowSpecialistModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateSpecialistReferral} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Patient *
                </label>
                <select
                  required
                  value={selectedPatId}
                  onChange={(e) => setSelectedPatId(e.target.value)}
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
                    Specialty Department *
                  </label>
                  <select
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Cardiology">Cardiology</option>
                    <option value="Endocrinology">Endocrinology</option>
                    <option value="Nephrology">Nephrology</option>
                    <option value="Gastroenterology">Gastroenterology</option>
                    <option value="Pulmonology">Pulmonology</option>
                    <option value="Neurology">Neurology</option>
                    <option value="Orthopedic Surgery">Orthopedic Surgery</option>
                    <option value="Ophthalmology / Optometry">Ophthalmology</option>
                    <option value="Dermatology">Dermatology</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Urgency Level *
                  </label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Routine">Routine (Within 14–30 days)</option>
                    <option value="Urgent">Urgent (Within 48–72 hours)</option>
                    <option value="STAT">STAT (Immediate &lt;24 hours)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Specialist Provider / Facility *
                </label>
                <input
                  type="text"
                  required
                  value={facility}
                  onChange={(e) => setFacility(e.target.value)}
                  placeholder="e.g. Metro Heart & Vascular Center"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Referral / Specific Question *
                </label>
                <input
                  type="text"
                  required
                  value={referralReason}
                  onChange={(e) => setReferralReason(e.target.value)}
                  placeholder="e.g. Evaluation for worsening exertional dyspnea and ischemic risk"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Summary & Rationale
                </label>
                <textarea
                  rows={3}
                  value={clinicalSummary}
                  onChange={(e) => setClinicalSummary(e.target.value)}
                  placeholder="Provide pertinent physical exam findings, recent lab values, and prior treatments…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowSpecialistModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPreparing}
                  title="Referrals are not saved or sent yet; this prepares a printable letter"
                  className={buttonClasses()}
                >
                  {isPreparing ? 'Preparing…' : 'Prepare Referral Letter (not saved)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Diagnostic Imaging Modal */}
      {showImagingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-xl w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Order Diagnostic Imaging
              </h3>
              <button
                onClick={() => setShowImagingModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateImagingOrder} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Patient *
                </label>
                <select
                  required
                  value={selectedPatId}
                  onChange={(e) => setSelectedPatId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mrn}) — Age {displayAge(p)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Imaging Modality & CPT Preset *
                </label>
                <select
                  value={selectedImagingPreset.cpt}
                  onChange={(e) => {
                    const preset = IMAGING_CPT_PRESETS.find((p) => p.cpt === e.target.value);
                    if (preset) setSelectedImagingPreset(preset);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {IMAGING_CPT_PRESETS.map((item) => (
                    <option key={item.cpt} value={item.cpt}>
                      {item.modality} (CPT {item.cpt})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-sky-50 border border-sky-100 rounded-lg text-xs">
                <span className="font-semibold text-sky-900">Guideline Indications:</span>{' '}
                <span className="text-sky-800">{selectedImagingPreset.indications}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Radiology Facility *
                  </label>
                  <input
                    type="text"
                    required
                    value={imagingFacility}
                    onChange={(e) => setImagingFacility(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Urgency *
                  </label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Routine">Routine</option>
                    <option value="Urgent">Urgent</option>
                    <option value="STAT">STAT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Specific Clinical Rationale / Pre-auth Notes
                </label>
                <textarea
                  rows={2}
                  value={imagingReason}
                  onChange={(e) => setImagingReason(e.target.value)}
                  placeholder={`e.g. Diagnostic scan to evaluate symptoms. ${selectedImagingPreset.indications}`}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowImagingModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPreparing}
                  title="Imaging orders are not saved or sent yet; this prepares a printable request"
                  className={buttonClasses()}
                >
                  {isPreparing ? 'Preparing…' : 'Prepare Imaging Request (not saved)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
