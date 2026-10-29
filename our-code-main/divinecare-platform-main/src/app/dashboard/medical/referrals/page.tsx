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
import { ChartItemForm } from '@/components/medical/ChartItemForm';
import { getMedicalPatients, saveMedicalPatients } from '@/features/medical/data';
import { MedicalPatient, MedicalReferral } from '@/features/medical/types';

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
  const [facility, setFacility] = useState('Metro Heart & Vascular Center');
  const [referralReason, setReferralReason] = useState('');
  const [clinicalSummary, setClinicalSummary] = useState('');
  const [urgency, setUrgency] = useState<'Routine' | 'Urgent' | 'STAT'>('Routine');

  // Imaging form
  const [selectedImagingPreset, setSelectedImagingPreset] = useState(IMAGING_CPT_PRESETS[0]);
  const [imagingFacility, setImagingFacility] = useState('Advanced Medical Imaging Specialists');
  const [imagingReason, setImagingReason] = useState('');

  useEffect(() => {
    const list = getMedicalPatients();
    setPatients(list);
    if (list.length > 0) {
      setSelectedPatId(list[0].id);
    }

    const handler = () => {
      setPatients(getMedicalPatients());
    };
    window.addEventListener('medical_patients_updated', handler);
    return () => window.removeEventListener('medical_patients_updated', handler);
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
      ? `BP: ${patient.vitals[0].systolic}/${patient.vitals[0].diastolic} mmHg | HR: ${patient.vitals[0].heartRate} bpm | BMI: ${patient.vitals[0].bmi}`
      : 'No vitals recorded';

    const letter = `========================================================================================
DIVINECARE MEDICAL GROUP — FORMAL CLINICAL CONSULTATION REQUISITION
Clinical consultation request
========================================================================================

DATE OF REFERRAL: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
REFERRING PROVIDER: ${patient.pcp || ''}
SPECIALTY REQUESTED: ${referral.specialtyOrModality}
TARGET FACILITY / CLINIC: ${referral.providerOrFacility}
URGENCY LEVEL: ${referral.urgency}

PATIENT IDENTIFICATION:
  - Legal Name: ${patient.name}
  - Preferred Name: ${patient.preferredName || patient.name}
  - Date of Birth: ${patient.dob} (Age: ${patient.age} years)
  - Medical Record Number (MRN): ${patient.mrn}
  - Phone: ${patient.phone} | Email: ${patient.email}
  - Primary Insurance: ${patient.demographics.primaryInsurance.payerName} (ID: ${patient.demographics.primaryInsurance.memberId})

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
  - ${patient.allergies.map((a) => `${a.substance} (${a.severity})`).join(', ') || 'No Known Drug Allergies (NKDA)'}

CLINICAL REQUEST & NEXT STEPS:
Please evaluate and provide recommended diagnostic and therapeutic management plan.
Kindly transmit the consultation report back to the referring clinic upon encounter completion.

ELECTRONIC SIGNATURE:
/s/ ${patient.pcp || ''}
========================================================================================`;

    setConsultLetterContent(letter);
    setShowLetterModal(true);
  };

  const handleCreateSpecialistReferral = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === selectedPatId);
    if (!pat) return;

    const newRef: MedicalReferral = {
      id: `ref-${Date.now()}`,
      type: 'Specialist',
      specialtyOrModality: specialty,
      providerOrFacility: facility,
      status: 'Sent',
      orderDate: new Date().toISOString().split('T')[0],
      reason: referralReason,
      clinicalSummary: clinicalSummary || `Comprehensive consult requested for ${specialty.toLowerCase()} evaluation.`,
      urgency,
    };

    const updated = patients.map((p) => {
      if (p.id === selectedPatId) {
        return {
          ...p,
          referrals: [newRef, ...p.referrals],
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setShowSpecialistModal(false);
    setReferralReason('');
    setClinicalSummary('');
  };

  const handleCreateImagingOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === selectedPatId);
    if (!pat) return;

    const newRef: MedicalReferral = {
      id: `img-${Date.now()}`,
      type: 'Imaging',
      specialtyOrModality: selectedImagingPreset.modality,
      cptCode: selectedImagingPreset.cpt,
      providerOrFacility: imagingFacility,
      status: 'Sent',
      orderDate: new Date().toISOString().split('T')[0],
      reason: imagingReason || selectedImagingPreset.indications,
      clinicalSummary: `Diagnostic radiology requisition per CPT ${selectedImagingPreset.cpt}. Rule out underlying somatic etiology.`,
      urgency,
    };

    const updated = patients.map((p) => {
      if (p.id === selectedPatId) {
        return {
          ...p,
          referrals: [newRef, ...p.referrals],
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setShowImagingModal(false);
    setImagingReason('');
  };

  const handleCopyLetter = () => {
    navigator.clipboard.writeText(consultLetterContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <MedicalNavHeader
        title="Specialist Referrals & Diagnostic Imaging"
        subtitle="Inter-provider clinical consult orders, automated consult letters, and CPT imaging requisitions"
        badge="Direct Messaging & Fax Connected"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <ChartItemForm kind="order" title="Save an order or referral" detail="Saved on this client's chart." />
        {/* Top Actions & Filter Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab('Specialist')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Specialist'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Specialist Consults
            </button>
            <button
              onClick={() => setActiveTab('Imaging')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Imaging'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Diagnostic Imaging
            </button>
            <button
              onClick={() => setActiveTab('Pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Pending'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Pending Authorization
            </button>
            <button
              onClick={() => setActiveTab('Completed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'Completed'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Completed / Reports In
            </button>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search consult or patient..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              onClick={() => setShowSpecialistModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition shrink-0"
            >
              <UserCheck className="w-4 h-4" />
              New Referral
            </button>

            <button
              onClick={() => setShowImagingModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-semibold rounded-lg hover:bg-sky-700 transition shrink-0"
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
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between hover:border-indigo-300 transition"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                      referral.type === 'Specialist'
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
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

                <h3 className="font-bold text-slate-900 text-base leading-snug">
                  {referral.specialtyOrModality}
                </h3>
                {referral.cptCode && (
                  <span className="font-mono text-xs text-indigo-600 font-bold">CPT {referral.cptCode}</span>
                )}

                <div className="mt-2 text-xs text-slate-600">
                  Target: <strong className="text-slate-800">{referral.providerOrFacility}</strong>
                </div>

                <div className="mt-3 bg-slate-50 rounded-lg p-2.5 border border-slate-100 text-xs">
                  <div className="text-slate-500 font-semibold mb-0.5">Clinical Rationale:</div>
                  <p className="text-slate-800 line-clamp-2">{referral.reason}</p>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2.5">
                  <div>
                    <span className="text-slate-400">Patient: </span>
                    <Link
                      href={`/dashboard/medical/patients/${patient.id}`}
                      className="font-medium text-slate-800 hover:text-indigo-600"
                    >
                      {patient.name}
                    </Link>
                  </div>
                  <span className="font-mono text-[11px]">{referral.orderDate}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    referral.status === 'Completed'
                      ? 'text-emerald-600'
                      : referral.status === 'Pending Authorization'
                      ? 'text-amber-600'
                      : 'text-indigo-600'
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
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-semibold transition"
                >
                  <Sparkles className="w-3 h-3 text-indigo-600" />
                  Consult Letter
                </button>
              </div>
            </div>
          ))}

          {filteredReferrals.length === 0 && (
            <div className="col-span-full py-12 text-center bg-white rounded-xl border border-slate-200">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-600 font-medium">No referrals found in this view.</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Consult Letter Modal */}
      {showLetterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">
                  AI Formatted Specialist Consult Letter
                </h3>
              </div>
              <button
                onClick={() => setShowLetterModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto">
              <pre className="p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl overflow-x-auto whitespace-pre leading-relaxed border border-slate-800">
                {consultLetterContent}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
              <div className="text-xs text-slate-500">
                Encrypted Electronic Transmission via Direct Protocol
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLetter}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied to Clipboard' : 'Copy Letter Text'}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition"
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
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                Create Specialist Referral Requisition
              </h3>
              <button
                onClick={() => setShowSpecialistModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
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
                    Specialty Department *
                  </label>
                  <select
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Routine">Routine (Within 14-30 days)</option>
                    <option value="Urgent">Urgent (Within 48-72 hours)</option>
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                  placeholder="Provide pertinent physical exam findings, recent lab values, and prior treatments..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                >
                  Transmit Referral
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Diagnostic Imaging Modal */}
      {showImagingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                Order Diagnostic Imaging
              </h3>
              <button
                onClick={() => setShowImagingModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mrn}) — Age {p.age}
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 font-medium"
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Radiology Facility *
                  </label>
                  <input
                    type="text"
                    required
                    value={imagingFacility}
                    onChange={(e) => setImagingFacility(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Urgency *
                  </label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                  className="px-5 py-2 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 transition"
                >
                  Submit Imaging Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
