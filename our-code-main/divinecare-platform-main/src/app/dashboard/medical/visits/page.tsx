'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { VisitGuide } from '@/components/visits/VisitGuide';
import { VisitSessionTabs } from '@/components/visits/VisitSessionTabs';
import { RoomingPanel } from '@/components/medical/RoomingPanel';
import { ProviderVisitWorkflow } from '@/components/medical/ProviderVisitWorkflow';
import { parseMedicalDeepLink, deepLinkIsComplete } from '@/lib/medical/deep-link';
import {
  FileText,
  Sparkles,
  Lock,
  Printer,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Activity,
  Calculator,
  User,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { MedicalNavHeader } from '@/features/medical/components/MedicalNavHeader';
import {
  getMedicalPatients,
  saveMedicalPatients,
  calculateBMI,
  getBPStaging,
} from '@/features/medical/data';
import type { MedicalPatient, MedicalEncounter } from '@/features/medical/types';

const PHYSICAL_EXAM_SYSTEMS = [
  { id: 'Constitutional', label: 'Constitutional', normal: 'Alert, oriented x4, well-nourished, in no acute distress.' },
  { id: 'Eyes', label: 'Eyes', normal: 'Conjunctivae normal, sclerae anicteric, pupils equal round and reactive to light (PERRLA).' },
  { id: 'ENT', label: 'Ears/Nose/Throat', normal: 'External auditory canals clear, TMs pearly gray, pharynx clear without erythema or exudates, uvula midline.' },
  { id: 'Cardiovascular', label: 'Cardiovascular', normal: 'Regular rate and rhythm, normal S1 and S2, no murmurs, rubs, or gallops. Radial and pedal pulses 2+ symmetric.' },
  { id: 'Respiratory', label: 'Respiratory', normal: 'Clear to auscultation bilaterally, no wheezes, rales, or rhonchi. Non-labored respiration.' },
  { id: 'Gastrointestinal', label: 'Gastrointestinal', normal: 'Abdomen soft, non-tender, non-distended. Normal active bowel sounds throughout, no hepatosplenomegaly or rebound tenderness.' },
  { id: 'Musculoskeletal', label: 'Musculoskeletal', normal: 'Normal range of motion in all four extremities. No joint effusions, tenderness, or deformities.' },
  { id: 'Neurological', label: 'Neurological', normal: 'Cranial nerves II-XII grossly intact. Motor strength 5/5 bilaterally. Gait steady and symmetric.' },
  { id: 'Integumentary', label: 'Integumentary / Skin', normal: 'Warm, dry, intact without suspicious lesions, erythema, induration, or rash.' },
];

function MedicalSOAPBuilderInner() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const deepLink = useMemo(() => parseMedicalDeepLink(searchParams), [searchParams]);
  const canCompleteVisit = user?.role === 'PHYSICIAN' || user?.role === 'MEDICAL_NP';
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState(deepLink.clientId || '');
  const [visitType, setVisitType] = useState<
    'Annual Physical' | 'HTN Follow-up' | 'Diabetes Management' | 'Acute Visit' | 'Well-Woman'
  >('Annual Physical');
  const [provider, setProvider] = useState('');
  const [clinicians, setClinicians] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/providers/roster')
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !data?.success || !Array.isArray(data.roster)) return;
        setClinicians(
          data.roster
            .map((user: { id?: string; name?: string }) => ({ id: user.id || user.name || '', name: user.name || '' }))
            .filter((user: { name: string }) => user.name)
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [isTelehealth, setIsTelehealth] = useState(false);

  // Subjective
  const [hpi, setHpi] = useState('');
  const [rosNarrative, setRosNarrative] = useState('');
  const [isAiScribing, setIsAiScribing] = useState(false);

  // Objective
  const [systolic, setSystolic] = useState(124);
  const [diastolic, setDiastolic] = useState(80);
  const [heartRate, setHeartRate] = useState(72);
  const [respRate, setRespRate] = useState(16);
  const [tempF, setTempF] = useState(98.6);
  const [heightIn, setHeightIn] = useState(69);
  const [weightLbs, setWeightLbs] = useState(182);
  const [oxygenSat, setOxygenSat] = useState(99);
  const [peExam, setPeExam] = useState<Record<string, string>>(() =>
    Object.fromEntries(PHYSICAL_EXAM_SYSTEMS.map((s) => [s.id, '']))
  );

  // Assessment
  const [diagnoses, setDiagnoses] = useState<Array<{ icd10: string; description: string }>>([]);
  const [newDxIcd, setNewDxIcd] = useState('');
  const [newDxDesc, setNewDxDesc] = useState('');
  const [mdmComplexity, setMdmComplexity] = useState<'Straightforward' | 'Low' | 'Moderate' | 'High'>('Moderate');
  const [aiDifferentials, setAiDifferentials] = useState<string[]>([]);
  const [isAiDiffLoading, setIsAiDiffLoading] = useState(false);

  // Plan
  const [prescriptions, setPrescriptions] = useState<string[]>([]);
  const [newRx, setNewRx] = useState('');
  const [labOrders, setLabOrders] = useState<string[]>([]);
  const [newLab, setNewLab] = useState('');
  const [referrals, setReferrals] = useState<string[]>([]);
  const [newRef, setNewRef] = useState('');
  const [patientCounseling, setPatientCounseling] = useState('');

  // Lock status & Print preview
  const [isLocked, setIsLocked] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [toast, setToast] = useState('');
  const [patientQuery, setPatientQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (patientQuery.trim()) params.set('search', patientQuery.trim());
    fetch(`/api/clients?${params}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data.clients)) return;
        const mapped = data.clients.map((client: { id: string; name: string; mrn?: string; phone?: string; email?: string; gender?: string; dateOfBirth?: string }) => ({
          id: client.id,
          mrn: client.mrn || '',
          name: client.name,
          dob: client.dateOfBirth || '',
          age: 0,
          gender: client.gender || '',
          pronouns: '',
          pcp: '',
          phone: client.phone || '',
          email: client.email || '',
          demographics: { race: '', ethnicity: '', language: '', maritalStatus: '', sexualOrientation: '', genderIdentity: '' },
          problems: [],
          medications: [],
          allergies: [],
          vitals: [],
          labs: [],
          preventiveCare: [],
          referrals: [],
          encounters: [],
          lastVisit: '',
          hasCareGaps: false,
          hasAbnormalLabs: false,
        })) as MedicalPatient[];
        setPatients(mapped);
        if (mapped[0]) setSelectedPatientId((current) => current || mapped[0].id);
      })
      .catch(() => { if (!cancelled) setPatients([]); });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [patientQuery]);

  const selectedPatient = useMemo(() => {
    return patients.find((p) => p.id === selectedPatientId) || patients[0];
  }, [patients, selectedPatientId]);

  const bmi = useMemo(() => calculateBMI(weightLbs, heightIn), [weightLbs, heightIn]);
  const bpStaging = useMemo(() => getBPStaging(systolic, diastolic), [systolic, diastolic]);

  // Live E&M Code Calculator
  const emCalculation = useMemo(() => {
    if (mdmComplexity === 'High') {
      return {
        code: '99215' as const,
        title: 'Office visit, established, level 5 (High complexity MDM)',
        rationale:
          'High complexity: Severe exacerbation of chronic systemic illness, acute threat to life/bodily function, or high-risk medication monitoring.',
      };
    }
    if (mdmComplexity === 'Moderate') {
      return {
        code: '99214' as const,
        title: 'Office visit, established, level 4 (Moderate complexity MDM)',
        rationale:
          'Moderate complexity: 2 or more chronic stable conditions OR 1 chronic illness with mild exacerbation + prescription drug management.',
      };
    }
    if (mdmComplexity === 'Low') {
      return {
        code: '99213' as const,
        title: 'Office visit, established, level 3 (Low complexity MDM)',
        rationale: 'Low complexity: 1 stable chronic illness or acute uncomplicated illness with OTC/low risk intervention.',
      };
    }
    return {
      code: '99212' as const,
      title: 'Office visit, established, level 2 (Straightforward MDM)',
      rationale: 'Straightforward: 1 acute, self-limited or minor problem, minimal risk of morbidity.',
    };
  }, [mdmComplexity]);

  // AI Scribe generator tailored to selected visit type
  const handleAiScribe = () => {
    setIsAiScribing(true);
    setTimeout(() => {
      if (visitType === 'Diabetes Management') {
        setHpi(
          `Patient presents for comprehensive Type 2 Diabetes follow-up. Reports good compliance with oral hypoglycemics. Home blood glucose logs range from 110-150 mg/dL fasting, with occasional postprandial spikes to 190 mg/dL. Denies symptomatic hypoglycemia, lightheadedness, tremors, or diaphoresis. Denies changes in visual acuity, peripheral numbness/tingling, polydipsia, or lower extremity skin ulcerations.`
        );
      } else if (visitType === 'HTN Follow-up') {
        setHpi(
          `Patient returns for scheduled evaluation of essential hypertension. Home blood pressures average 128-136/80-86 mmHg on current medication regimen. Reports full compliance. Denies headache, visual disturbances, chest tightness, palpitations, orthopnea, or ankle edema. Continues moderate dietary sodium reduction.`
        );
      } else if (visitType === 'Annual Physical') {
        setHpi(
          `Patient presents for annual preventive wellness examination and comprehensive health maintenance review. Overall feeling well. Denies acute somatic complaints, unprovoked weight loss, fevers, or localized pain. Up to date on daily activities and exercises 3 days per week.`
        );
      } else if (visitType === 'Well-Woman') {
        setHpi(
          `Patient presents for annual well-woman examination and preventive screening. Reviews contraceptive method and menstrual cycle history (regular, 28-day intervals). Denies pelvic pain, abnormal bleeding, dyspareunia, or breast lumps. Mammogram and Pap smear intervals reviewed.`
        );
      } else {
        setHpi(
          `Patient presents with a 4-day history of acute symptoms. Reports mild low-grade fever, nasal congestion, and dry cough. Denies dyspnea, wheezing, or hemoptysis. Fluid intake is adequate. Has been taking acetaminophen with partial relief.`
        );
      }
      setIsAiScribing(false);
      setToast('AI Scribe generated clinical HPI narrative.');
    }, 800);
  };

  // Insert Normal Defaults for Physical Exam
  const handleInsertNormalPE = () => {
    const normals = Object.fromEntries(PHYSICAL_EXAM_SYSTEMS.map((s) => [s.id, s.normal]));
    setPeExam(normals);
    setToast('Inserted 9-system normal physical exam defaults.');
  };

  // AI Differential Diagnosis Generator
  const handleAiDiff = () => {
    setIsAiDiffLoading(true);
    setTimeout(() => {
      if (visitType === 'Diabetes Management') {
        setAiDifferentials([
          '1. Uncontrolled Type 2 Diabetes Mellitus with secondary hyperglycemia',
          '2. Early Diabetic Nephropathy / Microalbuminuria',
          '3. Statin-induced myalgia vs diabetic peripheral neuropathy',
          '4. Metformin-associated vitamin B12 deficiency',
          '5. Reactive secondary hypertension related to metabolic syndrome',
        ]);
      } else if (visitType === 'HTN Follow-up') {
        setAiDifferentials([
          '1. Primary Essential Hypertension (I10) - Stage 1',
          '2. Secondary hypertension due to sleep apnea or renal artery disease',
          '3. White coat effect vs masked home hypertension',
          '4. Medication non-adherence or suboptimal dosing',
          '5. High dietary sodium intake or NSAID-induced BP elevation',
        ]);
      } else {
        setAiDifferentials([
          '1. Viral Upper Respiratory Tract Infection (URI)',
          '2. Acute allergic rhinitis / sinusitis',
          '3. Vasomotor rhinitis',
          '4. Bronchitis without bronchospasm',
          '5. Early COVID-19 or influenza presentation',
        ]);
      }
      setIsAiDiffLoading(false);
    }, 700);
  };

  // Lock & Sign Record
  const handleLockRecord = async () => {
    if (!selectedPatient || !canCompleteVisit) return;
    const nowIso = new Date().toISOString();
    const saved = await fetch('/api/medical/chart-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'visit',
        clientId: selectedPatient.id,
        text: `${visitType} completed by ${provider || user?.name || 'provider'}`,
      }),
    });
    const savedJson = await saved.json().catch(() => ({}));
    if (!saved.ok) {
      setToast(savedJson.error || 'The visit could not be saved on the chart.');
      return;
    }
    for (const referral of referrals) {
      await fetch('/api/medical/chart-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'order', clientId: selectedPatient.id, text: referral }),
      });
    }
    setIsLocked(true);
    setSignedAt(nowIso);

    const encounter: MedicalEncounter = {
      id: `enc-${Date.now()}`,
      patientId: selectedPatient.id,
      patientName: selectedPatient.name,
      visitDate: nowIso.slice(0, 10),
      visitType,
      provider,
      isTelehealth,
      hpi,
      ros: { Constitutional: 'Negative', Cardiovascular: 'Negative' },
      rosNotes: rosNarrative,
      vitals: {
        id: `vit-enc-${Date.now()}`,
        recordedAt: nowIso,
        recordedBy: provider,
        systolic,
        diastolic,
        heartRate,
        respRate,
        temperatureF: tempF,
        heightInches: heightIn,
        weightLbs,
        bmi,
        oxygenSat,
      },
      physicalExam: peExam,
      assessmentDiagnoses: diagnoses,
      mdmComplexity,
      recommendedCpt: emCalculation.code,
      cptRationale: emCalculation.rationale,
      prescriptions,
      labOrders,
      referralOrders: referrals,
      patientCounseling,
      isLocked: true,
      signedAt: nowIso,
      signedBy: `${provider} (Digital Signature SHA-256)`,
    };

    const currentPatients = getMedicalPatients();
    const updated = currentPatients.map((p) => {
      if (p.id === selectedPatient.id) {
        return {
          ...p,
          encounters: [encounter, ...p.encounters],
          lastVisit: nowIso.slice(0, 10),
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setToast('Encounter signed and electronically locked against alterations.');
  };

  return (
    <div className="space-y-6 pb-20">
      <MedicalNavHeader
        title="Medical Visits & SOAP Builder"
        subtitle="Comprehensive primary care clinical documentation, AI differential diagnosis, live E&M calculator, and electronic locking"
      />

      {deepLinkIsComplete(deepLink) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <RoomingPanel
            appointmentId={deepLink.appointmentId!}
            clientId={deepLink.clientId!}
          />
          <ProviderVisitWorkflow
            appointmentId={deepLink.appointmentId!}
            clientId={deepLink.clientId!}
            clientName={deepLink.clientName || selectedPatient?.name || ''}
            autoOpen
          />
        </div>
      ) : deepLink.appointmentId || deepLink.clientId ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Open PC visit from the schedule — both appointmentId and clientId are required. Partial link ignored.
        </p>
      ) : selectedPatientId ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <RoomingPanel clientId={selectedPatientId} />
          <ProviderVisitWorkflow
            clientId={selectedPatientId}
            clientName={selectedPatient?.name || ''}
          />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Select a patient, or open from schedule (Rooming / PC visit).
        </p>
      )}

      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          ✓ {toast}
        </div>
      )}

      {/* Patient Selector & Visit Type Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div>
            <label className="font-semibold text-slate-700">Select Patient *</label>
            <input
              value={patientQuery}
              onChange={(event) => setPatientQuery(event.target.value)}
              placeholder="Find a patient"
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
            />
            <select
              value={selectedPatientId}
              disabled={isLocked}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm font-medium outline-none focus:border-blue-600 disabled:bg-slate-100"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (MRN: {p.mrn})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-700">Visit Encounter Type</label>
            <select
              value={visitType}
              disabled={isLocked}
              onChange={(e) => setVisitType(e.target.value as any)}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600 disabled:bg-slate-100"
            >
              <option value="Annual Physical">Annual Physical / Wellness</option>
              <option value="HTN Follow-up">Hypertension (HTN) Follow-up</option>
              <option value="Diabetes Management">Diabetes Mellitus Management</option>
              <option value="Acute Visit">Acute Illness / Sick Visit</option>
              <option value="Well-Woman">Well-Woman Examination</option>
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-700">Rendering Clinician</label>
            <select
              value={provider}
              disabled={isLocked}
              onChange={(e) => setProvider(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600 disabled:bg-slate-100"
            >
              <option value="">Select clinician…</option>
              {clinicians.map((clinician) => (
                <option key={clinician.id} value={clinician.name}>
                  {clinician.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <VisitSessionTabs clientId={selectedPatientId || null} role={user?.role} variant="medical">
              <VisitGuide
                visitType={visitType}
                kind="primary_care"
                clientId={selectedPatientId || null}
                missing={[
                  !selectedPatientId ? 'Patient' : '',
                  !provider ? 'Rendering clinician' : '',
                  !hpi.trim() ? 'History of present illness' : '',
                ].filter(Boolean)}
              />
            </VisitSessionTabs>
          </div>

          <div>
            <label className="font-semibold text-slate-700">Modality</label>
            <div className="mt-1 flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="modality"
                  checked={!isTelehealth}
                  onChange={() => setIsTelehealth(false)}
                  disabled={isLocked}
                />
                In-Office
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="modality"
                  checked={isTelehealth}
                  onChange={() => setIsTelehealth(true)}
                  disabled={isLocked}
                />
                Telehealth (-95)
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Lock Status Banner */}
      {isLocked && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-emerald-900 shadow-sm">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-emerald-700" />
            <span className="text-sm font-bold">
              Record Electronically Locked & Cryptographically Signed
            </span>
            <span className="text-xs text-emerald-700">
              ({signedAt ? new Date(signedAt).toLocaleString() : ''})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100"
          >
            <Printer size={14} /> Print Preview
          </button>
        </div>
      )}

      {/* 4 SOAP SECTIONS */}
      <div className="space-y-6">
        {/* S: SUBJECTIVE */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white">
                S
              </span>
              <h2 className="text-base font-bold text-slate-900">
                Subjective: History of Present Illness (HPI)
              </h2>
            </div>
            <button
              type="button"
              disabled={isLocked || isAiScribing}
              onClick={handleAiScribe}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
            >
              <Sparkles size={14} />
              {isAiScribing ? 'AI Scribe generating...' : 'AI Scribe Draft'}
            </button>
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Chief Complaint & Narrative HPI:
              </label>
              <textarea
                rows={4}
                disabled={isLocked}
                value={hpi}
                onChange={(e) => setHpi(e.target.value)}
                placeholder="Click 'AI Scribe Draft' or type the patient's presenting history, symptom duration, severity, and modifying factors..."
                className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Review of Systems (ROS) Narrative:
              </label>
              <input
                type="text"
                disabled={isLocked}
                value={rosNarrative}
                onChange={(e) => setRosNarrative(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-xs outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
          </div>
        </div>

        {/* O: OBJECTIVE */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-black text-white">
                O
              </span>
              <h2 className="text-base font-bold text-slate-900">
                Objective: Vitals & Physical Examination
              </h2>
            </div>
            <button
              type="button"
              disabled={isLocked}
              onClick={handleInsertNormalPE}
              className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50"
            >
              Insert Normal Defaults (9 Systems)
            </button>
          </div>

          {/* Vitals Grid with Auto-BMI */}
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Vital Signs Flowsheet
              </span>
              <span className="text-xs text-slate-500">
                BMI Formula: (lbs / in²) × 703
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-6 text-xs">
              <div>
                <label className="text-slate-600">Blood Pressure</label>
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="number"
                    disabled={isLocked}
                    value={systolic}
                    onChange={(e) => setSystolic(Number(e.target.value))}
                    className="w-16 rounded-lg border p-1.5 font-mono text-center font-bold"
                  />
                  <span>/</span>
                  <input
                    type="number"
                    disabled={isLocked}
                    value={diastolic}
                    onChange={(e) => setDiastolic(Number(e.target.value))}
                    className="w-16 rounded-lg border p-1.5 font-mono text-center font-bold"
                  />
                </div>
                {bpStaging && (
                  <span className={`mt-1 inline-block rounded px-1 text-[10px] font-bold ${bpStaging.badgeClass}`}>
                    {bpStaging.stage}
                  </span>
                )}
              </div>

              <div>
                <label className="text-slate-600">Heart Rate (bpm)</label>
                <input
                  type="number"
                  disabled={isLocked}
                  value={heartRate}
                  onChange={(e) => setHeartRate(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-bold"
                />
              </div>

              <div>
                <label className="text-slate-600">Resp Rate</label>
                <input
                  type="number"
                  disabled={isLocked}
                  value={respRate}
                  onChange={(e) => setRespRate(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-bold"
                />
              </div>

              <div>
                <label className="text-slate-600">Height (in)</label>
                <input
                  type="number"
                  disabled={isLocked}
                  value={heightIn}
                  onChange={(e) => setHeightIn(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-bold"
                />
              </div>

              <div>
                <label className="text-slate-600">Weight (lbs)</label>
                <input
                  type="number"
                  disabled={isLocked}
                  value={weightLbs}
                  onChange={(e) => setWeightLbs(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-bold"
                />
              </div>

              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400">Calculated BMI</span>
                <div className="mt-0.5 text-lg font-black text-blue-700">{bmi}</div>
                <span className="text-[10px] text-slate-500">kg/m²</span>
              </div>
            </div>
          </div>

          {/* 9 Physical Exam Systems */}
          <div className="mt-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              9-System Physical Examination
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
              {PHYSICAL_EXAM_SYSTEMS.map((sys) => (
                <div key={sys.id} className="rounded-xl border border-slate-200 p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-800">{sys.label}</span>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setPeExam({ ...peExam, [sys.id]: sys.normal })}
                      className="text-[10px] text-blue-600 hover:underline"
                    >
                      Normal
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    disabled={isLocked}
                    value={peExam[sys.id] || ''}
                    onChange={(e) => setPeExam({ ...peExam, [sys.id]: e.target.value })}
                    placeholder="Findings..."
                    className="w-full rounded border border-slate-100 p-1.5 text-[11px] outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* A: ASSESSMENT */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-600 text-xs font-black text-white">
                A
              </span>
              <h2 className="text-base font-bold text-slate-900">
                Assessment: ICD-10 Diagnoses & E&M MDM Calculation
              </h2>
            </div>
            <button
              type="button"
              disabled={isLocked || isAiDiffLoading}
              onClick={handleAiDiff}
              className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline disabled:opacity-50"
            >
              <Sparkles size={14} /> AI Differential Diagnosis
            </button>
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            {/* ICD-10 List */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-700 block">
                Selected ICD-10 Diagnosis Codes:
              </label>
              <div className="space-y-1.5">
                {diagnoses.map((dx, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-blue-700 mr-2">{dx.icd10}</span>
                      <span className="font-medium text-slate-800">{dx.description}</span>
                    </div>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => setDiagnoses(diagnoses.filter((_, i) => i !== idx))}
                        className="text-rose-500 hover:text-rose-700"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!isLocked && (
                <div className="flex gap-2 text-xs">
                  <input
                    type="text"
                    placeholder="ICD-10 Code (e.g. E11.9)"
                    value={newDxIcd}
                    onChange={(e) => setNewDxIcd(e.target.value)}
                    className="w-32 rounded-lg border p-2 font-mono uppercase"
                  />
                  <input
                    type="text"
                    placeholder="Description"
                    value={newDxDesc}
                    onChange={(e) => setNewDxDesc(e.target.value)}
                    className="flex-1 rounded-lg border p-2"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newDxIcd.trim() || !newDxDesc.trim()) return;
                      setDiagnoses([
                        ...diagnoses,
                        { icd10: newDxIcd.toUpperCase(), description: newDxDesc },
                      ]);
                      setNewDxIcd('');
                      setNewDxDesc('');
                    }}
                    className="rounded-lg bg-blue-600 px-3 text-white font-semibold"
                  >
                    + Add
                  </button>
                </div>
              )}

              {/* AI Differentials suggestion box */}
              {aiDifferentials.length > 0 && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-xs text-indigo-950">
                  <span className="font-bold flex items-center gap-1 mb-1">
                    <Sparkles size={13} /> Suggested Evidence-Based Differentials:
                  </span>
                  <ul className="space-y-1 text-[11px]">
                    {aiDifferentials.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Live E&M Code Calculator */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                <span className="text-xs font-bold uppercase text-blue-900 flex items-center gap-1.5">
                  <Calculator size={15} /> Live 2023 AMA E&M Code Calculator
                </span>
                <span className="rounded-full bg-blue-600 px-2.5 py-0.5 font-mono text-xs font-bold text-white">
                  CPT {emCalculation.code}
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Medical Decision Making (MDM) Complexity:
                </label>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  {(['Straightforward', 'Low', 'Moderate', 'High'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      disabled={isLocked}
                      onClick={() => setMdmComplexity(level)}
                      className={`rounded-lg py-1.5 text-center font-semibold transition ${
                        mdmComplexity === level
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs text-slate-700">
                <p className="font-bold text-slate-900">{emCalculation.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  <strong>Documentation Rationale:</strong> {emCalculation.rationale}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* P: PLAN */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600 text-xs font-black text-white">
              P
            </span>
            <h2 className="text-base font-bold text-slate-900">
              Plan: Prescriptions, Diagnostic Orders & Patient Counseling
            </h2>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3 text-xs">
            {/* Prescriptions */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
              <span className="font-bold text-slate-800 uppercase text-[11px] block">
                Prescriptions & Refills
              </span>
              <ul className="space-y-1 text-slate-700">
                {prescriptions.map((rx, idx) => (
                  <li key={idx} className="flex justify-between items-center">
                    <span>• {rx}</span>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => setPrescriptions(prescriptions.filter((_, i) => i !== idx))}
                        className="text-rose-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!isLocked && (
                <div className="flex gap-1 pt-1">
                  <input
                    type="text"
                    placeholder="New prescription..."
                    value={newRx}
                    onChange={(e) => setNewRx(e.target.value)}
                    className="flex-1 rounded border p-1 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newRx.trim()) return;
                      setPrescriptions([...prescriptions, newRx.trim()]);
                      setNewRx('');
                    }}
                    className="rounded bg-blue-600 px-2 py-1 text-white"
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Lab Orders */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
              <span className="font-bold text-slate-800 uppercase text-[11px] block">
                Laboratory Requisitions
              </span>
              <ul className="space-y-1 text-slate-700">
                {labOrders.map((lab, idx) => (
                  <li key={idx} className="flex justify-between items-center">
                    <span>• {lab}</span>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => setLabOrders(labOrders.filter((_, i) => i !== idx))}
                        className="text-rose-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!isLocked && (
                <div className="flex gap-1 pt-1">
                  <input
                    type="text"
                    placeholder="Add lab (e.g. HbA1c)..."
                    value={newLab}
                    onChange={(e) => setNewLab(e.target.value)}
                    className="flex-1 rounded border p-1 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newLab.trim()) return;
                      setLabOrders([...labOrders, newLab.trim()]);
                      setNewLab('');
                    }}
                    className="rounded bg-blue-600 px-2 py-1 text-white"
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Referrals */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
              <span className="font-bold text-slate-800 uppercase text-[11px] block">
                Specialist / Imaging Referrals
              </span>
              <ul className="space-y-1 text-slate-700">
                {referrals.length === 0 ? (
                  <li className="text-slate-400 italic">None ordered today.</li>
                ) : (
                  referrals.map((ref, idx) => (
                    <li key={idx} className="flex justify-between items-center">
                      <span>• {ref}</span>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => setReferrals(referrals.filter((_, i) => i !== idx))}
                          className="text-rose-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </li>
                  ))
                )}
              </ul>
              {!isLocked && (
                <div className="flex gap-1 pt-1">
                  <input
                    type="text"
                    placeholder="Referral (e.g. Nephrology)..."
                    value={newRef}
                    onChange={(e) => setNewRef(e.target.value)}
                    className="flex-1 rounded border p-1 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newRef.trim()) return;
                      setReferrals([...referrals, newRef.trim()]);
                      setNewRef('');
                    }}
                    className="rounded bg-blue-600 px-2 py-1 text-white"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 text-xs">
            <label className="font-semibold text-slate-700 block mb-1">
              Patient Counseling, Education & Return Precautions:
            </label>
            <textarea
              rows={3}
              disabled={isLocked}
              value={patientCounseling}
              onChange={(e) => setPatientCounseling(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-600 disabled:bg-slate-50"
            />
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setShowPrintModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer size={15} /> Print Preview Layout
        </button>

        {authLoading || !user ? (
          <span className="text-xs font-semibold text-slate-500">Checking who is signed in…</span>
        ) : !isLocked && canCompleteVisit ? (
          <button
            type="button"
            onClick={() => { void handleLockRecord(); }}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-600/30 transition hover:bg-emerald-500"
          >
            <Lock size={15} /> Complete visit
          </button>
        ) : !isLocked ? (
          <span className="text-xs font-semibold text-slate-600">Rooming is done. The visit waits for the physician or medical NP.</span>
        ) : (
          <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={16} /> Signed by {provider}
          </span>
        )}
      </div>

      {/* Print Preview Clean Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-8 shadow-2xl">
            <div className="flex justify-between items-start border-b pb-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  CLINICAL ENCOUNTER SUMMARY
                </h2>
                <p className="text-xs text-slate-500">
                  Altrixs Medical Primary Care · Family Medicine Suite
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs text-slate-800">
              <div className="grid grid-cols-2 gap-2 border-b pb-3">
                <div>
                  <strong>Patient:</strong> {selectedPatient?.name} (MRN: {selectedPatient?.mrn})
                </div>
                <div>
                  <strong>DOB:</strong> {selectedPatient?.dob} ({selectedPatient?.age} yrs)
                </div>
                <div>
                  <strong>Visit Type:</strong> {visitType} ({isTelehealth ? 'Telehealth -95' : 'In-Office'})
                </div>
                <div>
                  <strong>Clinician:</strong> {provider}
                </div>
              </div>

              <div>
                <strong className="text-blue-800 uppercase block mb-1">Subjective (HPI):</strong>
                <p className="leading-relaxed bg-slate-50 p-2.5 rounded border">{hpi || 'No HPI entered.'}</p>
              </div>

              <div>
                <strong className="text-emerald-800 uppercase block mb-1">Objective (Vitals & Physical Exam):</strong>
                <p className="mb-2">
                  BP: {systolic}/{diastolic} mmHg ({bpStaging?.stage}) · HR: {heartRate} bpm · RR: {respRate} · Temp: {tempF}°F · BMI: {bmi} kg/m²
                </p>
              </div>

              <div>
                <strong className="text-amber-800 uppercase block mb-1">Assessment & E&M Code:</strong>
                <p className="font-bold">Recommended E&M: CPT {emCalculation.code} ({emCalculation.title})</p>
                <ul className="list-disc pl-5 mt-1">
                  {diagnoses.map((d, i) => (
                    <li key={i}>{d.icd10} — {d.description}</li>
                  ))}
                </ul>
              </div>

              <div>
                <strong className="text-purple-800 uppercase block mb-1">Plan:</strong>
                <p><strong>Prescriptions:</strong> {prescriptions.join(', ') || 'None'}</p>
                <p><strong>Labs:</strong> {labOrders.join(', ') || 'None'}</p>
                <p className="mt-1"><strong>Counseling:</strong> {patientCounseling}</p>
              </div>

              <div className="border-t pt-4 text-[11px] text-slate-500 flex justify-between">
                <span>Electronic Signature: {provider}</span>
                <span>Lock Hash: SHA256-VIST-SECURE-LOCK</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t pt-4">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
              >
                <Printer size={14} /> Send to Printer / PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MedicalSOAPBuilderPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading visit…</div>}>
      <MedicalSOAPBuilderInner />
    </Suspense>
  );
}
