'use client';

import { useEffect, useState, use } from 'react';
import { resolveDrugCode } from '@/lib/prescribing/drugCodes';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Edit,
  FileText,
  FlaskConical,
  HeartPulse,
  Info,
  Lock,
  Pencil,
  Pill,
  Plus,
  Printer,
  Shield,
  ShieldAlert,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import {
  getMedicalPatientById,
  saveMedicalPatients,
  getMedicalPatients,
  getBPStaging,
  calculateBMI,
} from '@/features/medical/data';
import type {
  MedicalPatient,
  MedicalProblem,
  MedicalMedication,
  MedicalAllergy,
  MedicalVitalRecord,
} from '@/features/medical/types';

export default function MedicalPatientChartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const patientId = unwrappedParams.id;

  const [patient, setPatient] = useState<MedicalPatient | null>(null);
  const [activeTab, setActiveTab] = useState<
    | 'summary'
    | 'problems'
    | 'meds'
    | 'allergies'
    | 'vitals'
    | 'labs'
    | 'visits'
    | 'preventive'
    | 'demographics'
  >('summary');

  // Modals state
  const [showAddProblemModal, setShowAddProblemModal] = useState(false);
  const [newProblem, setNewProblem] = useState({
    icd10: '',
    description: '',
    status: 'Active' as const,
    severity: 'Moderate' as const,
    category: 'Cardiovascular' as const,
    notes: '',
  });

  const [showAddVitalModal, setShowAddVitalModal] = useState(false);
  const [newVital, setNewVital] = useState({
    systolic: 120,
    diastolic: 80,
    heartRate: 72,
    respRate: 16,
    temperatureF: 98.6,
    heightInches: 69,
    weightLbs: 180,
    oxygenSat: 99,
  });

  const [showAddAllergyModal, setShowAddAllergyModal] = useState(false);
  const [newAllergy, setNewAllergy] = useState({
    substance: '',
    reaction: '',
    severity: 'Moderate' as const,
    type: 'Drug' as const,
    rxnormId: '',
  });

  const [toast, setToast] = useState('');

  const reloadPatient = async () => {
    try {
      const res = await fetch(`/api/medical/patients/${patientId}/chart`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && (data.patient || data.chart)) {
          const rawPat = data.patient || data.chart;
          const local = getMedicalPatientById(patientId);
          const dobStr = rawPat.dob || (rawPat.dateOfBirth ? new Date(rawPat.dateOfBirth).toISOString().split('T')[0] : '');
          const birthYear = parseInt(String(dobStr).split('-')[0], 10);
          const age = Number.isFinite(birthYear) ? Math.max(0, new Date().getFullYear() - birthYear) : 0;

          const constructed: MedicalPatient = local || {
            id: rawPat.id || patientId,
            mrn: rawPat.mrn || patientId,
            name: rawPat.name || 'Medical Patient',
            dob: dobStr,
            age,
            gender: rawPat.gender || 'Unknown',
            pronouns: rawPat.gender?.toLowerCase() === 'female' ? 'She/Her' : rawPat.gender?.toLowerCase() === 'male' ? 'He/Him' : '',
            pcp: rawPat.assignedPcp || '',
            phone: rawPat.phone || '',
            email: rawPat.email || '',
            hasCareGaps: Boolean(rawPat.hba1cOverdue || rawPat.egfrDeclining),
            hasAbnormalLabs: false,
            hasCriticalPanicLab: false,
            lastVisit: rawPat.lastVisit || '',
            demographics: {
              legalName: rawPat.name || 'Medical Patient',
              preferredName: rawPat.name?.split(' ')[0] || rawPat.name || 'Patient',
              dateOfBirth: dobStr,
              sexAtBirth: rawPat.gender?.toLowerCase() === 'female' ? 'Female' : rawPat.gender?.toLowerCase() === 'male' ? 'Male' : 'Unknown',
              genderIdentity: rawPat.gender || '',
              sexualOrientation: '',
              pronouns: rawPat.gender?.toLowerCase() === 'female' ? 'She/Her/Hers' : rawPat.gender?.toLowerCase() === 'male' ? 'He/Him/His' : '',
              ombRace: '',
              ombEthnicity: '',
              preferredLanguage: '',
              interpreterNeeded: false,
              portalStatus: '',
              primaryInsurance: {
                payerName: rawPat.primaryPayer || '',
                payerId: '',
                memberId: '',
                groupNumber: '',
                subscriberName: rawPat.name || '',
                subscriberDob: dobStr,
                relationship: 'Self',
              },
              guarantor: {
                name: rawPat.name || '',
                relationship: 'Self',
                phone: rawPat.phone || '',
                address: rawPat.address || '',
              },
              emergencyContacts: rawPat.emergencyContact
                ? [
                    {
                      name: rawPat.emergencyContact,
                      relationship: 'Contact',
                      phone: rawPat.phone || '',
                      isAuthorizedProxy: false,
                    },
                  ]
                : [],
              codeStatus: '',
              advanceDirectives: {
                hasLivingWill: false,
                hasPOLST: false,
              },
              chartFlags: [],
            },
            problems: (data.problems || []).map((p: any) => ({
              id: p.id || `prob-${Math.random()}`,
              icd10: p.icd10Code || p.icd10 || '',
              description: p.name || p.description || p.icd10Code || '',
              onsetDate: '',
              status: p.isChronic ? 'Chronic' : (p.status || 'Active'),
              severity: '',
              category: p.category || '',
            })),
            medications: data.medications || [],
            allergies: [],
            vitals: (data.vitals || []).map((v: any) => ({
              id: v.id || `vit-${Math.random()}`,
              recordedAt: v.recordedAt ? new Date(v.recordedAt).toISOString() : new Date().toISOString(),
              recordedBy: v.recordedBy || '',
              systolic: Number(v.systolic) || 0,
              diastolic: Number(v.diastolic) || 0,
              heartRate: Number(v.heartRate) || 0,
              respRate: Number(v.respRate) || 0,
              temperatureF: Number(v.temperatureF) || 0,
              heightInches: Number(v.heightInches) || 0,
              weightLbs: Number(v.weightLbs) || 0,
              bmi: Number(v.bmi) || 0,
              oxygenSat: Number(v.oxygenSat) || 0,
            })),
            labs: [],
            preventiveCare: [],
            referrals: [],
            encounters: [],
          };

          const bhRef = rawPat.behavioralHealthCrossReference || data.chart?.bhCrossReference || constructed.bhCrossReference || {
            hasBhChart: false,
            bhClientId: '',
            hasPart2Consent: false,
            therapist: '',
            prescriber: '',
            primaryDiagnosis: '',
          };

          const finalized = {
            ...constructed,
            bhCrossReference: bhRef,
          };

          setPatient(finalized);
          return;
        }
      }
    } catch {
      /* fallback to local cache or initial patient */
    }

    const p = getMedicalPatientById(patientId);
    if (p) {
      setPatient({
        ...p,
        bhCrossReference: p.bhCrossReference || {
          hasBhChart: false,
          bhClientId: '',
          hasPart2Consent: false,
          therapist: '',
          prescriber: '',
          primaryDiagnosis: '',
        },
      });
    }
  };

  useEffect(() => {
    void reloadPatient();
    window.addEventListener('medical_patients_updated', () => void reloadPatient());
    return () => window.removeEventListener('medical_patients_updated', () => void reloadPatient());
  }, [patientId]);

  if (!patient) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center">
        <h2 className="text-xl font-bold text-slate-800">Patient Chart Not Found</h2>
        <p className="mt-1 text-sm text-slate-500">
          The requested medical chart ID does not match any current records.
        </p>
        <Link
          href="/dashboard/medical/patients"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          <ArrowLeft size={16} /> Return to Medical Roster
        </Link>
      </div>
    );
  }

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const handleSaveProblem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProblem.icd10.trim() || !newProblem.description.trim()) return;

    const all = getMedicalPatients();
    const updated = all.map((p) => {
      if (p.id === patient.id) {
        return {
          ...p,
          problems: [
            ...p.problems,
            {
              id: `prob-${Date.now()}`,
              icd10: newProblem.icd10.trim().toUpperCase(),
              description: newProblem.description.trim(),
              onsetDate: new Date().toISOString().slice(0, 10),
              status: newProblem.status,
              severity: newProblem.severity,
              category: newProblem.category,
              notes: newProblem.notes.trim() || undefined,
            },
          ],
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setShowAddProblemModal(false);
    triggerToast(`Added condition ${newProblem.icd10} to problem list.`);
    setNewProblem({
      icd10: '',
      description: '',
      status: 'Active',
      severity: 'Moderate',
      category: 'Cardiovascular',
      notes: '',
    });
  };

  const handleDiscontinueMed = (medId: string, medName: string) => {
    const all = getMedicalPatients();
    const updated = all.map((p) => {
      if (p.id === patient.id) {
        return {
          ...p,
          medications: p.medications.map((m) =>
            m.id === medId ? { ...m, status: 'Discontinued' as const } : m
          ),
        };
      }
      return p;
    });
    saveMedicalPatients(updated);
    triggerToast(`Discontinued medication: ${medName}`);
  };

  const handleSaveVital = (e: React.FormEvent) => {
    e.preventDefault();
    const bmi = calculateBMI(newVital.weightLbs, newVital.heightInches);
    const newRecord: MedicalVitalRecord = {
      id: `vit-${Date.now()}`,
      recordedAt: new Date().toISOString(),
      recordedBy: 'Clinical Staff',
      systolic: Number(newVital.systolic),
      diastolic: Number(newVital.diastolic),
      heartRate: Number(newVital.heartRate),
      respRate: Number(newVital.respRate),
      temperatureF: Number(newVital.temperatureF),
      heightInches: Number(newVital.heightInches),
      weightLbs: Number(newVital.weightLbs),
      bmi,
      oxygenSat: Number(newVital.oxygenSat),
    };

    const all = getMedicalPatients();
    const updated = all.map((p) => {
      if (p.id === patient.id) {
        return {
          ...p,
          vitals: [newRecord, ...p.vitals],
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setShowAddVitalModal(false);
    triggerToast('New vital signs flowsheet entry recorded.');
  };

  const handleSaveAllergy = (e: React.FormEvent) => {
    e.preventDefault();
    const code = resolveDrugCode(newAllergy.substance, newAllergy.rxnormId);
    if (!newAllergy.substance.trim() || !code) {
      triggerToast('A standard drug code is required for this allergy.');
      return;
    }

    const newRec: MedicalAllergy = {
      id: `alg-${Date.now()}`,
      substance: newAllergy.substance.trim(),
      reaction: newAllergy.reaction.trim() || 'Unspecified reaction',
      severity: newAllergy.severity,
      type: newAllergy.type,
      onsetDate: new Date().toISOString().slice(0, 10),
      rxnormId: code,
    };

    void fetch(`/api/medical/patients/${patient.id}/allergies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        substance: newRec.substance,
        reaction: newRec.reaction,
        severity: newRec.severity,
        rxnormId: code,
        clientId: patient.id,
      }),
    });

    const all = getMedicalPatients();
    const updated = all.map((p) => {
      if (p.id === patient.id) {
        return {
          ...p,
          allergies: [...p.allergies, newRec],
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setShowAddAllergyModal(false);
    triggerToast(`Added allergy: ${newAllergy.substance}`);
    setNewAllergy({ substance: '', reaction: '', severity: 'Moderate', type: 'Drug', rxnormId: '' });
  };

  const latestVital = patient.vitals[0];
  const bpStaging = latestVital ? getBPStaging(latestVital.systolic, latestVital.diastolic) : null;
  const severeAllergies = patient.allergies.filter((a) => a.severity === 'Severe/Anaphylaxis');

  return (
    <div className="space-y-6 pb-16">
      {/* Back button and quick actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/medical/patients"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={14} /> Back to Medical Patients Roster
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/medical/visits?patient=${patient.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
          >
            <FileText size={14} /> Start Clinical Encounter (SOAP)
          </Link>
        </div>
      </div>

      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          ✓ {toast}
        </div>
      )}

      {/* Critical Allergy Banner */}
      {severeAllergies.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-rose-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
          <div className="text-xs">
            <span className="font-bold uppercase tracking-wider text-rose-900">
              CRITICAL ALLERGY ALERT:
            </span>{' '}
            {severeAllergies.map((a) => `${a.substance} (${a.reaction})`).join('; ')}
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900">{patient.name}</h1>
              {patient.preferredName && (
                <span className="text-sm font-medium text-slate-500">
                  (&ldquo;{patient.preferredName}&rdquo;)
                </span>
              )}
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 font-mono text-xs font-bold text-blue-700">
                MRN: {patient.mrn}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                {patient.gender} ({patient.pronouns})
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>
                <strong>DOB:</strong> {patient.dob} ({patient.age} yrs old)
              </span>
              <span>·</span>
              <span>
                <strong>PCP:</strong> {patient.pcp}
              </span>
              <span>·</span>
              <span>
                <strong>Phone:</strong> {patient.phone}
              </span>
              <span>·</span>
              <span>
                <strong>Insurance:</strong> {patient.demographics.primaryInsurance.payerName}
              </span>
            </div>

            {/* Chart Flags */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-400">Chart Flags:</span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                  patient.demographics.codeStatus === 'Full Code'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                Code Status: {patient.demographics.codeStatus}
              </span>
              {patient.demographics.advanceDirectives.hasLivingWill && (
                <span className="rounded-md bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-800">
                  Living Will On File
                </span>
              )}
              {patient.demographics.advanceDirectives.hasPOLST && (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  POLST Verified
                </span>
              )}
              {patient.demographics.chartFlags.map((flag) => (
                <span
                  key={flag}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                >
                  {flag}
                </span>
              ))}
            </div>
          </div>

          {/* Quick Vital Badge */}
          {latestVital && bpStaging && (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Latest Vitals ({new Date(latestVital.recordedAt).toLocaleDateString()})
              </div>
              <div className="mt-1 flex items-baseline justify-end gap-1.5">
                <span className="text-xl font-black text-slate-900">
                  {latestVital.systolic}/{latestVital.diastolic}
                </span>
                <span className="text-xs font-medium text-slate-500">mmHg</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${bpStaging.badgeClass}`}>
                  {bpStaging.stage}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                HR: <strong>{latestVital.heartRate}</strong> bpm · BMI: <strong>{latestVital.bmi}</strong> · SpO2: <strong>{latestVital.oxygenSat}%</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 9 Functional Tabs Navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex overflow-x-auto space-x-2 scrollbar-none" aria-label="Tabs">
          {[
            { id: 'summary', label: '1. Summary & Overview' },
            { id: 'problems', label: `2. Problem List (${patient.problems.length})` },
            { id: 'meds', label: `3. Medications (${patient.medications.length})` },
            { id: 'allergies', label: `4. Allergies (${patient.allergies.length})` },
            { id: 'vitals', label: `5. Vitals Flowsheet (${patient.vitals.length})` },
            { id: 'labs', label: `6. Labs & Diagnostics (${patient.labs.length})` },
            { id: 'visits', label: `7. Visits & Locked SOAP (${patient.encounters.length})` },
            { id: 'preventive', label: `8. USPSTF Preventive (${patient.preventiveCare.length})` },
            { id: 'demographics', label: '9. Demographics & Regulatory' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`whitespace-nowrap border-b-2 px-3.5 py-3 text-xs font-bold transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab 1: Summary */}
      {activeTab === 'summary' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Active Problems Snapshot */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">Active Somatic Conditions</h3>
                <button
                  type="button"
                  onClick={() => setShowAddProblemModal(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                >
                  <Plus size={14} /> Add Problem
                </button>
              </div>
              <div className="mt-3 divide-y divide-slate-100">
                {patient.problems.map((prob) => (
                  <div key={prob.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-blue-700 mr-2 text-xs">
                        {prob.icd10}
                      </span>
                      <span className="text-xs font-semibold text-slate-800">
                        {prob.description}
                      </span>
                      {prob.notes && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{prob.notes}</p>
                      )}
                    </div>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      {prob.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Medications Snapshot */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">Current Medications</h3>
                <span className="text-xs text-slate-400">{patient.medications.length} active</span>
              </div>
              <div className="mt-3 space-y-2">
                {patient.medications.map((med) => (
                  <div
                    key={med.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900">
                        {med.name} {med.dosage}
                      </div>
                      <div className="text-slate-500 mt-0.5">{med.instructions}</div>
                      <div className="text-[11px] text-slate-400">
                        Indication: {med.indication} · Prescribed by: {med.prescribedBy}
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      {med.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* Recent Vitals & BMI */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">Vitals Overview</h3>
                <button
                  type="button"
                  onClick={() => setShowAddVitalModal(true)}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  + Record
                </button>
              </div>
              {latestVital ? (
                <div className="mt-4 space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Blood Pressure:</span>
                    <span className="font-bold text-slate-900">
                      {latestVital.systolic} / {latestVital.diastolic} mmHg
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Heart Rate:</span>
                    <span className="font-bold text-slate-900">{latestVital.heartRate} bpm</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Body Mass Index (BMI):</span>
                    <span className="font-bold text-slate-900">{latestVital.bmi} kg/m²</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Weight & Height:</span>
                    <span className="font-bold text-slate-900">
                      {latestVital.weightLbs} lbs ({latestVital.heightInches} in)
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Oxygen Saturation:</span>
                    <span className="font-bold text-slate-900">{latestVital.oxygenSat}%</span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-400">No vitals on file.</p>
              )}
            </div>

            {/* Care Gaps Summary */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                Preventive Care Checklist
              </h3>
              <div className="mt-3 space-y-2">
                {patient.preventiveCare.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 truncate max-w-[180px]">{item.title}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        item.status === 'Up to Date'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* Integrated Care BH Cross-Reference Card */}
            <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-purple-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-[#5C2D91]">
                    <Shield size={16} />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Also in Behavioral Health</h3>
                    <p className="text-[11px] text-slate-500">Integrated Care Cross-Reference</p>
                  </div>
                </div>
                {patient.bhCrossReference?.hasPart2Consent ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    42 CFR Part 2 Consented
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 flex items-center gap-1">
                    <Lock size={10} /> Part 2 Guarded
                  </span>
                )}
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Assigned Therapist:</span>
                  <span className="font-semibold text-slate-800">
                    {patient.bhCrossReference?.therapist || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Psych Prescriber:</span>
                  <span className="font-semibold text-slate-800">
                    {patient.bhCrossReference?.prescriber || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">BH Diagnosis:</span>
                  {patient.bhCrossReference?.hasPart2Consent ? (
                    <span className="font-semibold text-purple-900 font-mono">
                      {patient.bhCrossReference?.primaryDiagnosis || '—'}
                    </span>
                  ) : (
                    <span className="italic text-slate-400">
                      Confidential (ROI signed consent required)
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-purple-100">
                <Link
                  href={`/dashboard/clients/${patient.bhCrossReference?.bhClientId || 'client-1'}`}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#5C2D91] px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#4A2475] transition"
                >
                  Open BH Chart &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Problem List */}
      {activeTab === 'problems' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Somatic Problem Registry</h3>
              <p className="text-xs text-slate-500">
                Active chronic and acute ICD-10 medical problems with onset date and monitoring status
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddProblemModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              <Plus size={15} /> Add Medical Condition
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">ICD-10 Code</th>
                  <th className="px-4 py-3">Clinical Description</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Onset Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {patient.problems.map((prob) => (
                  <tr key={prob.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-blue-700">{prob.icd10}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{prob.description}</td>
                    <td className="px-4 py-3 text-slate-500">{prob.category}</td>
                    <td className="px-4 py-3 text-slate-500">{prob.onsetDate}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        {prob.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{prob.severity}</td>
                    <td className="px-4 py-3 text-slate-400">{prob.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Medications */}
      {activeTab === 'meds' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Active Somatic Medications</h3>
              <p className="text-xs text-slate-500">
                Dosage, route, frequency, refills, indication, and discontinue workflow
              </p>
            </div>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {patient.medications.map((med) => (
              <div key={med.id} className="py-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {med.name} {med.dosage}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        med.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {med.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    <strong>Instructions:</strong> {med.instructions}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Route: {med.route} · Frequency: {med.frequency} · Refills: {med.refills} · Indication: {med.indication}
                  </p>
                </div>
                {med.status === 'Active' && (
                  <button
                    type="button"
                    onClick={() => handleDiscontinueMed(med.id, med.name)}
                    className="self-start rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 sm:self-center"
                  >
                    Discontinue
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Allergies */}
      {activeTab === 'allergies' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Allergies & Adverse Reactions</h3>
              <p className="text-xs text-slate-500">
                Drug, food, and environmental reactions categorized by clinical severity
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddAllergyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              <Plus size={14} /> Add Allergy
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {patient.allergies.map((alg) => (
              <div
                key={alg.id}
                className={`rounded-xl border p-4 shadow-sm ${
                  alg.severity === 'Severe/Anaphylaxis'
                    ? 'border-rose-200 bg-rose-50/50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900">{alg.substance}</h4>
                    {alg.rxnormId ? <p className="text-[11px] text-slate-500">Drug code {alg.rxnormId}</p> : null}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                      {alg.type}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      alg.severity === 'Severe/Anaphylaxis'
                        ? 'bg-rose-600 text-white'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {alg.severity}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  <strong>Reaction:</strong> {alg.reaction}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 5: Vitals Flowsheet */}
      {activeTab === 'vitals' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Historical Vitals Flowsheet</h3>
              <p className="text-xs text-slate-500">
                Blood pressure staging, automatic BMI calculation, and trend tracking
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddVitalModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              <Plus size={14} /> Record New Vitals
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date / Clinician</th>
                  <th className="px-4 py-3">Blood Pressure (mmHg)</th>
                  <th className="px-4 py-3">BP Staging</th>
                  <th className="px-4 py-3">Heart Rate</th>
                  <th className="px-4 py-3">BMI</th>
                  <th className="px-4 py-3">Height & Weight</th>
                  <th className="px-4 py-3">Temp / SpO2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {patient.vitals.map((vit) => {
                  const staging = getBPStaging(vit.systolic, vit.diastolic);
                  return (
                    <tr key={vit.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">
                          {new Date(vit.recordedAt).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-slate-400">{vit.recordedBy}</div>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-900">
                        {vit.systolic} / {vit.diastolic}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${staging.badgeClass}`}>
                          {staging.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3">{vit.heartRate} bpm</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{vit.bmi}</td>
                      <td className="px-4 py-3">
                        {vit.weightLbs} lbs / {vit.heightInches} in
                      </td>
                      <td className="px-4 py-3">
                        {vit.temperatureF}°F / {vit.oxygenSat}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 6: Labs */}
      {activeTab === 'labs' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Laboratory & Diagnostic Results</h3>
              <p className="text-xs text-slate-500">
                LOINC standard codes, numeric values, reference intervals, and clinical interpretations
              </p>
            </div>
            <Link
              href="/dashboard/medical/labs"
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              Order New Labs →
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {patient.labs.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">No lab results on file for this patient.</p>
            ) : (
              patient.labs.map((lab) => (
                <div
                  key={lab.id}
                  className="rounded-xl border border-slate-200 p-4 shadow-sm hover:border-slate-300"
                >
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900">{lab.testName}</h4>
                        <span className="font-mono text-xs text-slate-400">LOINC: {lab.loincCode}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            lab.flag === 'Critical/Panic'
                              ? 'bg-rose-600 text-white'
                              : lab.flag === 'High'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {lab.flag}
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-lg font-black text-slate-900">
                          {lab.value} {lab.unit}
                        </span>
                        <span className="text-xs text-slate-500">(Ref Range: {lab.referenceRange})</span>
                        <span className="text-xs text-slate-400">· Resulted: {lab.resultDate}</span>
                      </div>
                      {lab.interpretation && (
                        <p className="mt-2 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <strong>AI Clinical Interpretation:</strong> {lab.interpretation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 7: Visits & Locked SOAP Notes */}
      {activeTab === 'visits' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Chronological Locked Visits</h3>
              <p className="text-xs text-slate-500">
                Complete clinical encounter notes, E&M coding rationale, and digital lock signatures
              </p>
            </div>
            <Link
              href={`/dashboard/medical/visits?patient=${patient.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              <Plus size={14} /> New Visit Note
            </Link>
          </div>
          <div className="mt-4 space-y-4">
            {patient.encounters.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">No signed visits on file.</p>
            ) : (
              patient.encounters.map((enc) => (
                <div
                  key={enc.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 shadow-sm"
                >
                  <div className="flex flex-col justify-between gap-2 border-b border-slate-200 pb-3 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{enc.visitDate}</span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
                          {enc.visitType}
                        </span>
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 font-mono text-xs font-bold text-purple-800">
                          CPT {enc.recommendedCpt}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Provider: {enc.provider} · MDM Complexity: {enc.mdmComplexity}
                      </p>
                    </div>
                    {enc.isLocked && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                        <Lock size={14} /> Electronically Locked & Signed
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
                    <div>
                      <span className="font-bold text-slate-700 uppercase">Subjective (HPI):</span>
                      <p className="mt-1 text-slate-600 leading-relaxed">{enc.hpi}</p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-700 uppercase">Plan & Counseling:</span>
                      <p className="mt-1 text-slate-600 leading-relaxed">{enc.patientCounseling}</p>
                      <div className="mt-2 text-[11px] text-slate-500">
                        <strong>Prescriptions:</strong> {enc.prescriptions.join(', ')}
                      </div>
                    </div>
                  </div>
                  {enc.signedBy && (
                    <div className="mt-3 pt-2.5 border-t border-slate-200 text-[11px] text-slate-500 flex justify-between">
                      <span>Signed by: {enc.signedBy}</span>
                      <span>Timestamp: {enc.signedAt}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 8: Preventive Care */}
      {activeTab === 'preventive' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">USPSTF Health Maintenance Checklist</h3>
              <p className="text-xs text-slate-500">
                Grade A & B preventative recommendations tailored to age ({patient.age}) and sex ({patient.gender})
              </p>
            </div>
            <Link
              href="/dashboard/medical/preventive-care"
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              Open Full USPSTF Engine →
            </Link>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {patient.preventiveCare.map((item) => (
              <div key={item.id} className="py-3.5 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{item.title}</span>
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                      USPSTF Grade {item.uspstfGrade}
                    </span>
                    {item.cptCode && (
                      <span className="font-mono text-[11px] text-slate-400">CPT: {item.cptCode}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Target: {item.targetGroup} · Due: <strong>{item.dueDate}</strong>
                    {item.lastCompletedDate && ` · Last completed: ${item.lastCompletedDate}`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    item.status === 'Up to Date'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 9: Demographics & Regulatory */}
      {activeTab === 'demographics' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              ONC 2022 §170.315(a)(5) Compliant Demographics & Regulatory Data
            </h3>
            <p className="text-xs text-slate-500">
              Standardized SOGI, OMB race/ethnicity, language preferences, advance directives, and legal contacts
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 text-xs">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase text-[11px] border-b border-slate-200 pb-1">
                Identity & Demographics
              </h4>
              <div className="flex justify-between">
                <span className="text-slate-500">Legal Name:</span>
                <span className="font-medium text-slate-900">{patient.demographics.legalName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Preferred Name:</span>
                <span className="font-medium text-slate-900">{patient.demographics.preferredName || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sex at Birth:</span>
                <span className="font-medium text-slate-900">{patient.demographics.sexAtBirth}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Gender Identity:</span>
                <span className="font-medium text-slate-900">{patient.demographics.genderIdentity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sexual Orientation:</span>
                <span className="font-medium text-slate-900">{patient.demographics.sexualOrientation}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Preferred Pronouns:</span>
                <span className="font-medium text-slate-900">{patient.demographics.pronouns}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">OMB Race / Ethnicity:</span>
                <span className="font-medium text-slate-900">
                  {patient.demographics.ombRace} / {patient.demographics.ombEthnicity}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Language:</span>
                <span className="font-medium text-slate-900">
                  {patient.demographics.preferredLanguage}{' '}
                  {patient.demographics.interpreterNeeded ? '(Interpreter Needed)' : ''}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase text-[11px] border-b border-slate-200 pb-1">
                Insurance & Financial Guarantor
              </h4>
              <div className="flex justify-between">
                <span className="text-slate-500">Primary Payer:</span>
                <span className="font-medium text-slate-900">
                  {patient.demographics.primaryInsurance.payerName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Member ID / Group:</span>
                <span className="font-mono text-slate-900">
                  {patient.demographics.primaryInsurance.memberId} / {patient.demographics.primaryInsurance.groupNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Subscriber Name:</span>
                <span className="font-medium text-slate-900">
                  {patient.demographics.primaryInsurance.subscriberName} ({patient.demographics.primaryInsurance.relationship})
                </span>
              </div>
              {patient.demographics.secondaryInsurance && (
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-slate-500">Secondary Payer:</span>
                  <span className="font-medium text-slate-900">
                    {patient.demographics.secondaryInsurance.payerName}
                  </span>
                </div>
              )}
              <div className="border-t border-slate-200 pt-1.5 flex justify-between">
                <span className="text-slate-500">Guarantor:</span>
                <span className="font-medium text-slate-900">
                  {patient.demographics.guarantor.name} ({patient.demographics.guarantor.relationship})
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Problem */}
      {showAddProblemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Add Somatic Problem</h3>
              <button
                type="button"
                onClick={() => setShowAddProblemModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveProblem} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700">ICD-10 Code *</label>
                <input
                  type="text"
                  placeholder="e.g. I10, E11.9, K21.0"
                  value={newProblem.icd10}
                  onChange={(e) => setNewProblem({ ...newProblem, icd10: e.target.value })}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 font-mono text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Diagnosis Description *</label>
                <input
                  type="text"
                  placeholder="e.g. Essential (primary) hypertension"
                  value={newProblem.description}
                  onChange={(e) => setNewProblem({ ...newProblem, description: e.target.value })}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700">Status</label>
                  <select
                    value={newProblem.status}
                    onChange={(e) => setNewProblem({ ...newProblem, status: e.target.value as any })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  >
                    <option value="Active">Active</option>
                    <option value="Chronic">Chronic</option>
                    <option value="Acute">Acute</option>
                    <option value="Monitoring">Monitoring</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700">Severity</label>
                  <select
                    value={newProblem.severity}
                    onChange={(e) => setNewProblem({ ...newProblem, severity: e.target.value as any })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  >
                    <option value="Mild">Mild</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Severe">Severe</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Clinical Notes</label>
                <textarea
                  rows={2}
                  placeholder="Treatment goals, titration plan, monitoring schedule..."
                  value={newProblem.notes}
                  onChange={(e) => setNewProblem({ ...newProblem, notes: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddProblemModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
                >
                  Save to Problem List
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Vitals */}
      {showAddVitalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Record New Vitals</h3>
              <button
                type="button"
                onClick={() => setShowAddVitalModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveVital} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700">Systolic (mmHg)</label>
                  <input
                    type="number"
                    value={newVital.systolic}
                    onChange={(e) => setNewVital({ ...newVital, systolic: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                    required
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700">Diastolic (mmHg)</label>
                  <input
                    type="number"
                    value={newVital.diastolic}
                    onChange={(e) => setNewVital({ ...newVital, diastolic: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700">Heart Rate (bpm)</label>
                  <input
                    type="number"
                    value={newVital.heartRate}
                    onChange={(e) => setNewVital({ ...newVital, heartRate: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700">Height (inches)</label>
                  <input
                    type="number"
                    value={newVital.heightInches}
                    onChange={(e) => setNewVital({ ...newVital, heightInches: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700">Weight (lbs)</label>
                  <input
                    type="number"
                    value={newVital.weightLbs}
                    onChange={(e) => setNewVital({ ...newVital, weightLbs: Number(e.target.value) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800">
                Calculated BMI: <strong>{calculateBMI(newVital.weightLbs, newVital.heightInches)}</strong> kg/m²
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddVitalModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
                >
                  Save Vitals
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Allergy */}
      {showAddAllergyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Add Allergy / Adverse Reaction</h3>
              <button
                type="button"
                onClick={() => setShowAddAllergyModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveAllergy} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Substance / Medication *</label>
                <input
                  type="text"
                  placeholder="e.g. Penicillin, Codeine, Shellfish, Latex"
                  value={newAllergy.substance}
                  onChange={(e) => setNewAllergy({ ...newAllergy, substance: e.target.value })}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Drug code</label>
                <input
                  type="text"
                  placeholder="Filled from the medication name when a standard code is known"
                  value={newAllergy.rxnormId || resolveDrugCode(newAllergy.substance) || ''}
                  onChange={(e) => setNewAllergy({ ...newAllergy, rxnormId: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Observed Reaction</label>
                <input
                  type="text"
                  placeholder="e.g. Hives, anaphylaxis, facial angioedema, nausea"
                  value={newAllergy.reaction}
                  onChange={(e) => setNewAllergy({ ...newAllergy, reaction: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700">Severity</label>
                  <select
                    value={newAllergy.severity}
                    onChange={(e) => setNewAllergy({ ...newAllergy, severity: e.target.value as any })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  >
                    <option value="Severe/Anaphylaxis">Severe / Anaphylaxis</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Mild">Mild</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700">Type</label>
                  <select
                    value={newAllergy.type}
                    onChange={(e) => setNewAllergy({ ...newAllergy, type: e.target.value as any })}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  >
                    <option value="Drug">Drug</option>
                    <option value="Food">Food</option>
                    <option value="Environmental">Environmental</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddAllergyModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
                >
                  Save Allergy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
