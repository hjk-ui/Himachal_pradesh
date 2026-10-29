'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Lock,
  Printer,
  Trash2,
  CheckCircle2,
  Calculator,
  X,
  History,
  ListChecks,
} from 'lucide-react';
import { MedicalNavHeader } from '@/features/medical/components/MedicalNavHeader';
import { useAuth } from '@/features/auth';
import { calculateBMI, getBPStaging } from '@/features/medical/vitalsCalc';
import { fetchMedicalPatients, signVisit } from '@/features/medical/api';
import { apiJson } from '@/lib/api-client';
import type { MedicalPatient } from '@/features/medical/types';
import { displayAge, displayDob } from '@/features/medical/format';
import { Icd10CodeInput } from '@/components/clinical/Icd10Picker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { VisitGuidePanel, VisitGuideSignWarnings } from '@/components/visits/VisitGuidePanel';
import { useVisitGuide } from '@/components/visits/useVisitGuide';
import { PrimaryCareVisitWorkflow } from '@/features/medical/components/PrimaryCareVisitWorkflow';
import type { RoomingVitals } from '@/lib/medical/primaryCareWorkflow';
import { buttonClasses, Alert, IconButton } from '@/components/ui';
import { ChartHistoryCard, createChartDigestCache } from '@/components/ai/ChartHistoryCard';
import { SessionSideTabs, type SessionSideTab } from '@/components/ai/SessionSideTabs';
import { canSeeChartHistoryTab, canSeeMedicalHistoryTab } from '@/lib/ai/chartDigest/panelOrder';

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

export default function MedicalSOAPBuilderPage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  /** Opened with "Start visit" (?patient=&appointmentId=&guide=1): Visit Guide for that visit */
  const [guideCtx, setGuideCtx] = useState<{ clientId: string; appointmentId: string | null } | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const patient = qs.get('patient');
    if (patient && (qs.get('guide') === '1' || qs.get('appointmentId'))) {
      setGuideCtx({ clientId: patient, appointmentId: qs.get('appointmentId') });
    }
  }, []);
  const guideCtrl = useVisitGuide(guideCtx ? { clientId: guideCtx.clientId, appointmentId: guideCtx.appointmentId } : null);
  /** Vitals the MA filed at rooming for this appointment: shown read-only, not entered twice */
  const [roomingFiled, setRoomingFiled] = useState(false);
  const [chiefComplaint, setChiefComplaint] = useState<string | null>(null);
  /** Code the provider picked from the E/M suggestions (else the MDM calculator code) */
  const [cptOverride, setCptOverride] = useState<string | null>(null);
  const [visitType, setVisitType] = useState<
    'Annual Physical' | 'HTN Follow-up' | 'Diabetes Management' | 'Acute Visit' | 'Well-Woman'
  >('Annual Physical');
  const [provider, setProvider] = useState('');
  const [isTelehealth, setIsTelehealth] = useState(false);

  // Subjective
  const [hpi, setHpi] = useState('');
  const [rosNarrative, setRosNarrative] = useState('');
  const [isAiScribing, setIsAiScribing] = useState(false);

  // Objective
  // Vitals start blank; the clinician must enter measured values before signing.
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [respRate, setRespRate] = useState('');
  const [tempF, setTempF] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [oxygenSat, setOxygenSat] = useState('');
  const [formError, setFormError] = useState('');
  // After signing: the chart has no PCP and the signer is a physician / medical NP (never auto-assigned)
  const [pcpSuggestion, setPcpSuggestion] = useState<{ clientId: string; userId: string; displayName: string } | null>(null);
  const [pcpSaving, setPcpSaving] = useState(false);
  const [pcpNote, setPcpNote] = useState('');
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
  const [isSigning, setIsSigning] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signedVisitId, setSignedVisitId] = useState<string | null>(null);
  // Removing a diagnosis / order from the visit asks first (one dialog for all four lists)
  const [pendingRemoval, setPendingRemoval] = useState<{ kind: string; item: string; remove: () => void } | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchMedicalPatients()
      .then((list) => {
        if (cancelled) return;
        setPatients(list);
        const requested = new URLSearchParams(window.location.search).get('patient');
        const match = requested
          ? list.find((p) => p.id === requested || p.mrn === requested || p.clientId === requested)
          : undefined;
        if (match) setSelectedPatientId(match.id);
        else if (list.length > 0) setSelectedPatientId(list[0].id);
      })
      .catch((err) => {
        if (!cancelled) setFormError(err instanceof Error ? err.message : 'Could not load patients.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPatient = useMemo(() => {
    return patients.find((p) => p.id === selectedPatientId) || patients[0];
  }, [patients, selectedPatientId]);

  // Side tabs (SessionSideTabs pattern): Visit guide / Medical history / Behavioral health history.
  // A history tab is fetched only when opened; a 403 / 404 (care team, protected record, not a
  // primary-care patient) hides that tab for this client.
  const [chartDigestCache] = useState(createChartDigestCache);
  const [deniedTabs, setDeniedTabs] = useState<string[]>([]);
  const [sideTab, setSideTab] = useState('guide');
  const role = user?.role ? String(user.role) : null;
  const historyClientId = selectedPatient?.clientId ?? null;
  const guideVisible = Boolean(guideCtx && selectedPatient && (selectedPatient.clientId === guideCtx.clientId || selectedPatient.id === guideCtx.clientId));
  const sideTabs: SessionSideTab[] = [];
  if (guideVisible && guideCtx) {
    sideTabs.push({
      id: 'guide',
      label: 'Visit guide',
      icon: <ListChecks size={12} aria-hidden />,
      render: () => <VisitGuidePanel compact collapsible={false} clientId={guideCtx.clientId} appointmentId={guideCtx.appointmentId} controller={guideCtrl} />,
    });
  }
  if (historyClientId && canSeeMedicalHistoryTab(role) && !deniedTabs.includes(`medical:${historyClientId}`)) {
    sideTabs.push({
      id: 'medical',
      label: 'Medical history',
      icon: <History size={12} aria-hidden />,
      render: () => (
        <ChartHistoryCard
          key={`medical:${historyClientId}`}
          kind="medical"
          variant="panel"
          clientId={historyClientId}
          role={role}
          cache={chartDigestCache}
          onDenied={() => setDeniedTabs((prev) => [...prev, `medical:${historyClientId}`])}
        />
      ),
    });
  }
  if (historyClientId && canSeeChartHistoryTab(role) && !deniedTabs.includes(`bh:${historyClientId}`)) {
    sideTabs.push({
      id: 'bh',
      label: 'Behavioral health history',
      icon: <History size={12} aria-hidden />,
      render: () => (
        <ChartHistoryCard
          key={`bh:${historyClientId}`}
          variant="panel"
          clientId={historyClientId}
          role={role}
          cache={chartDigestCache}
          onDenied={() => setDeniedTabs((prev) => [...prev, `bh:${historyClientId}`])}
        />
      ),
    });
  }
  const activeSideTab = sideTabs.some((t) => t.id === sideTab) ? sideTab : sideTabs[0]?.id ?? 'guide';

  const bmi = useMemo(
    () => (weightLbs.trim() && heightIn.trim() ? calculateBMI(Number(weightLbs), Number(heightIn)) : 0),
    [weightLbs, heightIn]
  );
  const bpStaging = useMemo(
    () => (systolic.trim() && diastolic.trim() ? getBPStaging(Number(systolic), Number(diastolic)) : null),
    [systolic, diastolic]
  );

  const handleIntake = useCallback((intake: { vitals: RoomingVitals | null; filed: boolean; chiefComplaint: string | null }) => {
    setChiefComplaint(intake.chiefComplaint);
    const v = intake.vitals;
    if (!intake.filed || !v) {
      setRoomingFiled(false);
      return;
    }
    const str = (x: number | null | undefined) => (x == null ? '' : String(x));
    // The recheck is the reading of record when the first BP was elevated
    setSystolic(str(v.recheck?.systolic ?? v.systolic));
    setDiastolic(str(v.recheck?.diastolic ?? v.diastolic));
    setHeartRate(str(v.heartRate));
    setRespRate(str(v.respRate));
    setTempF(str(v.temperatureF));
    setHeightIn(str(v.heightIn));
    setWeightLbs(str(v.weightLbs));
    setOxygenSat(str(v.spO2));
    setRoomingFiled(true);
  }, []);

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

  // AI Scribe: sends the clinician's own HPI text to /api/medical/ai/bedrock-soap (AWS Bedrock)
  // and replaces it with the structured Subjective section. Nothing is inserted if Bedrock fails.
  const handleAiScribe = async () => {
    if (!hpi.trim()) {
      setFormError('Type or dictate the HPI first; AI Scribe structures your own notes.');
      return;
    }
    setIsAiScribing(true);
    setFormError('');
    setToast('');
    try {
      const data = await apiJson<{ soap?: { subjective?: string } }>('/api/medical/ai/bedrock-soap', {
        method: 'POST',
        body: JSON.stringify({ rawNote: hpi, visitType }),
      });
      if (!data.soap?.subjective) throw new Error('AI Scribe returned no draft.');
      setHpi(data.soap.subjective);
      setToast('AI Scribe draft inserted. Review and edit before signing.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'AI Scribe is not available right now.');
    } finally {
      setIsAiScribing(false);
    }
  };

  // Insert Normal Defaults for Physical Exam
  const handleInsertNormalPE = () => {
    const normals = Object.fromEntries(PHYSICAL_EXAM_SYSTEMS.map((s) => [s.id, s.normal]));
    setPeExam(normals);
    setToast('Inserted 9-system normal physical exam defaults.');
  };

  // AI Differential: Amazon Comprehend Medical ICD-10-CM inference over the documented text.
  // These are coding suggestions drawn from the note, not a generated differential diagnosis.
  const handleAiDiff = async () => {
    const text = [hpi, rosNarrative, ...diagnoses.map((d) => d.description)].join('\n').trim();
    if (text.length < 10) {
      setFormError('Document the HPI first; suggestions are drawn from the note text.');
      return;
    }
    setIsAiDiffLoading(true);
    setAiDifferentials([]);
    setFormError('');
    setToast('');
    try {
      const data = await apiJson<{ icd10?: Array<{ code: string; description: string; score: number }> }>(
        '/api/medical/ai/comprehend',
        { method: 'POST', body: JSON.stringify({ text }) }
      );
      const seen = new Set<string>();
      const items: string[] = [];
      for (const c of data.icd10 || []) {
        if (!c.code || seen.has(c.code)) continue;
        seen.add(c.code);
        items.push(`${c.code} — ${c.description} (confidence ${Math.round(c.score * 100)}%)`);
        if (items.length >= 8) break;
      }
      setAiDifferentials(items);
      setToast(
        items.length > 0
          ? 'Comprehend Medical returned ICD-10 suggestions. Review before adding any.'
          : 'No ICD-10 suggestions found in the note text.'
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'ICD-10 suggestions are not available right now.');
    } finally {
      setIsAiDiffLoading(false);
    }
  };

  // Sign & lock: persists a signed MedicalVisit (+ the visit vitals) server-side. The editor
  // only locks after the server confirms the save.
  const handleLockRecord = async () => {
    if (!selectedPatient || isSigning) return;
    const vitalFields: Array<[string, string]> = [
      ['Systolic BP', systolic],
      ['Diastolic BP', diastolic],
      ['Heart rate', heartRate],
      ['Respiratory rate', respRate],
      ['Temperature', tempF],
      ['Height', heightIn],
      ['Weight', weightLbs],
      ['SpO2', oxygenSat],
    ];
    const missing = roomingFiled
      ? []
      : vitalFields.filter(([, v]) => !v.trim() || !Number.isFinite(Number(v)) || Number(v) <= 0).map(([label]) => label);
    if (!provider) missing.unshift('Rendering clinician');
    if (!hpi.trim()) missing.unshift('HPI');
    if (missing.length > 0) {
      setFormError(`Enter the following before signing: ${missing.join(', ')}.`);
      return;
    }
    setFormError('');
    setToast('');

    const peLines = PHYSICAL_EXAM_SYSTEMS.filter((sys) => peExam[sys.id]?.trim()).map(
      (sys) => `${sys.label}: ${peExam[sys.id].trim()}`
    );
    const objective = [
      `Vitals${roomingFiled ? ' (MA rooming)' : ''}: BP ${systolic || '—'}/${diastolic || '—'} mmHg, HR ${heartRate || '—'} bpm, RR ${respRate || '—'}, Temp ${tempF || '—'} F, SpO2 ${oxygenSat || '—'}%, Ht ${heightIn || '—'} in, Wt ${weightLbs || '—'} lbs${bmi ? `, BMI ${bmi}` : ''}`,
      peLines.length > 0 ? `Physical exam:\n${peLines.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const assessment = [
      ...diagnoses.map((d) => `${d.icd10} — ${d.description}`),
      `MDM complexity: ${mdmComplexity} (CPT ${cptOverride ?? emCalculation.code})`,
    ].join('\n');
    const plan = [
      prescriptions.length > 0 ? `Prescriptions: ${prescriptions.join('; ')}` : '',
      labOrders.length > 0 ? `Labs: ${labOrders.join('; ')}` : '',
      referrals.length > 0 ? `Referrals: ${referrals.join('; ')}` : '',
      patientCounseling.trim() ? `Counseling: ${patientCounseling.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    setIsSigning(true);
    try {
      const data = await signVisit(selectedPatient.id, {
        visitType,
        isTelehealth,
        chiefComplaint: chiefComplaint || undefined,
        appointmentId: guideCtx?.appointmentId ?? null,
        subjective: rosNarrative.trim() ? `${hpi.trim()}\n\nROS: ${rosNarrative.trim()}` : hpi.trim(),
        objective,
        assessment,
        plan: plan || undefined,
        cptCode: cptOverride ?? emCalculation.code,
        icd10Codes: diagnoses.map((d) => d.icd10),
        vitals: roomingFiled ? undefined : {
          systolic: Number(systolic),
          diastolic: Number(diastolic),
          heartRate: Number(heartRate),
          respRate: Number(respRate),
          temperatureF: Number(tempF),
          heightInches: Number(heightIn),
          weightLbs: Number(weightLbs),
          oxygenSat: Number(oxygenSat),
        },
      });
      setIsLocked(true);
      setSignedAt(data.visit?.signedAt ? String(data.visit.signedAt) : null);
      setSignedVisitId(data.visit?.id ? String(data.visit.id) : null);
      setToast('Encounter signed and saved to the chart. It can no longer be edited.');
      setPcpNote('');
      setPcpSuggestion(data.pcpSuggestion && data.clientId ? { clientId: data.clientId, ...data.pcpSuggestion } : null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not sign the visit. Nothing was saved.');
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {pendingRemoval && (
        <ConfirmDialog
          title={`Remove this ${pendingRemoval.kind}?`}
          tone="danger"
          confirmLabel="Remove"
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => {
            pendingRemoval.remove();
            setPendingRemoval(null);
          }}
        >
          <p>
            <strong>{pendingRemoval.item}</strong> will be removed from this visit before it is signed.
          </p>
        </ConfirmDialog>
      )}
      <MedicalNavHeader
        title="Medical Visits & SOAP Builder"
        subtitle="Comprehensive primary care clinical documentation, AI differential diagnosis, live E&M calculator, and electronic locking"
      />

      {pcpSuggestion && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
          <span>
            This patient has no primary care provider (PCP) on file. Make <strong>{pcpSuggestion.displayName}</strong> the PCP?
          </span>
          <button
            type="button"
            disabled={pcpSaving}
            onClick={async () => {
              setPcpSaving(true);
              try {
                const res = await fetch(`/api/clients/${encodeURIComponent(pcpSuggestion.clientId)}/pcp`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ providerId: pcpSuggestion.userId, via: 'visit-suggestion' }),
                });
                const body = await res.json().catch(() => ({}));
                setPcpNote(res.ok && body.success ? 'PCP set.' : body.error || 'Could not set the PCP.');
                if (res.ok && body.success) setPcpSuggestion(null);
              } finally {
                setPcpSaving(false);
              }
            }}
            className={buttonClasses({ size: 'sm' })}
          >
            Set as PCP
          </button>
          <button type="button" onClick={() => setPcpSuggestion(null)} className="rounded-lg px-2 py-1 text-xs font-semibold text-sky-800 hover:underline">
            Not now
          </button>
        </div>
      )}
      {pcpNote && !pcpSuggestion ? <p className="text-sm text-slate-600">{pcpNote}</p> : null}

      {toast && (
        <Alert tone="success">{toast}</Alert>
      )}

      {formError && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">
          {formError}
        </div>
      )}

      {sideTabs.length ? (
        <section aria-label="Visit side panel" className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <SessionSideTabs tabs={sideTabs} active={activeSideTab} onChange={setSideTab} />
        </section>
      ) : null}

      {guideVisible && guideCtx ? (
        <>
          <PrimaryCareVisitWorkflow
            clientId={guideCtx.clientId}
            appointmentId={guideCtx.appointmentId}
            visitType={visitType}
            mdm={mdmComplexity}
            icd10Codes={diagnoses.map((d) => d.icd10)}
            locked={isLocked}
            onUseCode={(code) => {
              setCptOverride(code);
              setToast(`CPT ${code} selected for this visit.`);
            }}
            onIntake={handleIntake}
            onChanged={guideCtrl.reload}
          />
        </>
      ) : null}

      {/* Patient Selector & Visit Type Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div>
            <label className="font-semibold text-slate-700">Select Patient *</label>
            <select
              value={selectedPatientId}
              disabled={isLocked}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm font-medium outline-none focus:border-blue-600 disabled:bg-slate-100"
            >
              {patients.length === 0 && <option value="">No patients yet</option>}
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
              <option value="">Select rendering clinician</option>
              {user?.name && <option value={user.name}>{user.name}</option>}
            </select>
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-xs sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Lock size={18} className="text-emerald-700" />
            <span className="text-sm font-semibold">
              Visit Signed &amp; Locked
            </span>
            <span className="text-xs text-emerald-700">
              ({signedAt ? new Date(signedAt).toLocaleString() : ''})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-100"
          >
            <Printer size={14} /> Print Preview
          </button>
        </div>
      )}

      {/* 4 SOAP SECTIONS */}
      <div className="space-y-6">
        {/* S: SUBJECTIVE */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-semibold text-white">
                S
              </span>
              <h2 className="text-base font-semibold text-slate-900">
                Subjective: History of Present Illness (HPI)
              </h2>
            </div>
            <button
              type="button"
              disabled={isLocked || isAiScribing}
              onClick={() => void handleAiScribe()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
            >
              <Sparkles size={14} />
              {isAiScribing ? 'AI Scribe generating…' : 'AI Scribe Draft'}
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
                placeholder="Type the presenting history (rough dictation is fine), then click 'AI Scribe Draft' to structure it, or document it directly…"
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
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-semibold text-white">
                O
              </span>
              <h2 className="text-base font-semibold text-slate-900">
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
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 pb-2 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
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
                    disabled={isLocked || roomingFiled}
                    value={systolic}
                    onChange={(e) => setSystolic(e.target.value)}
                    className="w-16 rounded-lg border p-1.5 font-mono text-center font-semibold"
                  />
                  <span>/</span>
                  <input
                    type="number"
                    disabled={isLocked || roomingFiled}
                    value={diastolic}
                    onChange={(e) => setDiastolic(e.target.value)}
                    className="w-16 rounded-lg border p-1.5 font-mono text-center font-semibold"
                  />
                </div>
                {bpStaging && (
                  <span className={`mt-1 inline-block rounded px-1 text-[11px] font-semibold ${bpStaging.badgeClass}`}>
                    {bpStaging.stage}
                  </span>
                )}
              </div>

              <div>
                <label className="text-slate-600">Heart Rate (bpm)</label>
                <input
                  type="number"
                  disabled={isLocked || roomingFiled}
                  value={heartRate}
                  onChange={(e) => setHeartRate(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-semibold"
                />
              </div>

              <div>
                <label className="text-slate-600">Resp Rate</label>
                <input
                  type="number"
                  disabled={isLocked || roomingFiled}
                  value={respRate}
                  onChange={(e) => setRespRate(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-semibold"
                />
              </div>

              <div>
                <label className="text-slate-600">Temp (°F)</label>
                <input
                  type="number"
                  step="0.1"
                  disabled={isLocked || roomingFiled}
                  value={tempF}
                  onChange={(e) => setTempF(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-semibold"
                />
              </div>

              <div>
                <label className="text-slate-600">SpO2 (%)</label>
                <input
                  type="number"
                  disabled={isLocked || roomingFiled}
                  value={oxygenSat}
                  onChange={(e) => setOxygenSat(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-semibold"
                />
              </div>

              <div>
                <label className="text-slate-600">Height (in)</label>
                <input
                  type="number"
                  disabled={isLocked || roomingFiled}
                  value={heightIn}
                  onChange={(e) => setHeightIn(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-semibold"
                />
              </div>

              <div>
                <label className="text-slate-600">Weight (lbs)</label>
                <input
                  type="number"
                  disabled={isLocked || roomingFiled}
                  value={weightLbs}
                  onChange={(e) => setWeightLbs(e.target.value)}
                  className="mt-1 w-full rounded-lg border p-1.5 font-mono text-center font-semibold"
                />
              </div>

              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[11px] uppercase font-semibold text-slate-500">Calculated BMI</span>
                <div className="mt-0.5 text-lg font-semibold text-blue-700">{bmi || '—'}</div>
                <span className="text-[11px] text-slate-500">kg/m²</span>
              </div>
            </div>
          </div>

          {/* 9 Physical Exam Systems */}
          <div className="mt-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              9-System Physical Examination
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
              {PHYSICAL_EXAM_SYSTEMS.map((sys) => (
                <div key={sys.id} className="rounded-xl border border-slate-200 p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800">{sys.label}</span>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setPeExam({ ...peExam, [sys.id]: sys.normal })}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      Normal
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    disabled={isLocked}
                    value={peExam[sys.id] || ''}
                    onChange={(e) => setPeExam({ ...peExam, [sys.id]: e.target.value })}
                    placeholder="Findings…"
                    className="w-full rounded border border-slate-100 p-1.5 text-[11px] outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* A: ASSESSMENT */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-600 text-xs font-semibold text-white">
                A
              </span>
              <h2 className="text-base font-semibold text-slate-900">
                Assessment: ICD-10 Diagnoses & E&M MDM Calculation
              </h2>
            </div>
            <button
              type="button"
              disabled={isLocked || isAiDiffLoading}
              onClick={() => void handleAiDiff()}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline disabled:opacity-50"
            >
              <Sparkles size={14} /> {isAiDiffLoading ? 'Analyzing note…' : 'ICD-10 Suggestions (Comprehend Medical)'}
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
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs"
                  >
                    <div className="min-w-0 break-words">
                      <span className="font-mono font-semibold text-blue-700 mr-2">{dx.icd10}</span>
                      <span className="font-medium text-slate-800">{dx.description}</span>
                    </div>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingRemoval({
                            kind: 'diagnosis',
                            item: `${dx.icd10} ${dx.description}`.trim(),
                            remove: () => setDiagnoses((prev) => prev.filter((_, i) => i !== idx)),
                          })
                        }
                        aria-label={`Remove diagnosis ${dx.icd10} ${dx.description}`.trim()}
                        title="Remove diagnosis"
                        className="text-rose-600 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!isLocked && (
                <div className="flex flex-col gap-2 text-xs sm:flex-row">
                  <Icd10CodeInput
                    value={newDxIcd}
                    onChange={(c, picked) => {
                      setNewDxIcd(c);
                      if (picked) setNewDxDesc(picked.description);
                    }}
                    context="primary"
                    placeholder="E11.9 or words"
                    ariaLabel="ICD-10 code"
                    className="w-full sm:w-56 sm:shrink-0"
                    inputClassName="w-full rounded-lg border py-2 pl-7 pr-2 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Description"
                    value={newDxDesc}
                    onChange={(e) => setNewDxDesc(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border p-2"
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
                    className={buttonClasses()}
                  >
                    + Add
                  </button>
                </div>
              )}

              {/* AI Differentials suggestion box */}
              {aiDifferentials.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-950">
                  <span className="font-semibold flex items-center gap-1 mb-1">
                    <Sparkles size={13} /> Comprehend Medical ICD-10 suggestions (verify before adding):
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 pb-2">
                <span className="text-xs font-semibold uppercase text-blue-900 flex items-center gap-1.5">
                  <Calculator size={15} /> Live 2023 AMA E&M Code Calculator
                </span>
                <span className="rounded-full bg-blue-600 px-2.5 py-0.5 font-mono text-xs font-semibold text-white">
                  CPT {cptOverride ?? emCalculation.code}
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Medical Decision Making (MDM) Complexity:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
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
                <p className="font-semibold text-slate-900">{emCalculation.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  <strong>Documentation Rationale:</strong> {emCalculation.rationale}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* P: PLAN */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-semibold text-white">
              P
            </span>
            <h2 className="text-base font-semibold text-slate-900">
              Plan: Prescriptions, Diagnostic Orders & Patient Counseling
            </h2>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3 text-xs">
            {/* Prescriptions */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
              <span className="font-semibold text-slate-800 uppercase text-[11px] block">
                Prescriptions & Refills
              </span>
              <ul className="space-y-1 text-slate-700">
                {prescriptions.map((rx, idx) => (
                  <li key={idx} className="flex justify-between items-center gap-2">
                    <span>• {rx}</span>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingRemoval({
                            kind: 'prescription',
                            item: rx,
                            remove: () => setPrescriptions((prev) => prev.filter((_, i) => i !== idx)),
                          })
                        }
                        aria-label={`Remove prescription ${rx}`}
                        title="Remove prescription"
                        className="text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!isLocked && (
                <div className="flex gap-1 pt-1">
                  <input
                    type="text"
                    placeholder="New prescription…"
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
                    className={buttonClasses()}
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Lab Orders */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
              <span className="font-semibold text-slate-800 uppercase text-[11px] block">
                Laboratory Requisitions
              </span>
              <ul className="space-y-1 text-slate-700">
                {labOrders.map((lab, idx) => (
                  <li key={idx} className="flex justify-between items-center gap-2">
                    <span>• {lab}</span>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingRemoval({
                            kind: 'lab order',
                            item: lab,
                            remove: () => setLabOrders((prev) => prev.filter((_, i) => i !== idx)),
                          })
                        }
                        aria-label={`Remove lab order ${lab}`}
                        title="Remove lab order"
                        className="text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!isLocked && (
                <div className="flex gap-1 pt-1">
                  <input
                    type="text"
                    placeholder="Add lab (e.g. HbA1c)…"
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
                    className={buttonClasses()}
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Referrals */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
              <span className="font-semibold text-slate-800 uppercase text-[11px] block">
                Specialist / Imaging Referrals
              </span>
              <ul className="space-y-1 text-slate-700">
                {referrals.length === 0 ? (
                  <li className="text-slate-500 italic">None ordered today.</li>
                ) : (
                  referrals.map((ref, idx) => (
                    <li key={idx} className="flex justify-between items-center gap-2">
                      <span>• {ref}</span>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() =>
                            setPendingRemoval({
                              kind: 'referral',
                              item: ref,
                              remove: () => setReferrals((prev) => prev.filter((_, i) => i !== idx)),
                            })
                          }
                          aria-label={`Remove referral ${ref}`}
                          title="Remove referral"
                          className="text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                        >
                          <Trash2 size={12} aria-hidden />
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
                    placeholder="Referral (e.g. Nephrology)…"
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
                    className={buttonClasses()}
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

      {guideCtx && !isLocked ? <VisitGuideSignWarnings controller={guideCtrl} /> : null}

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <button
          type="button"
          onClick={() => setShowPrintModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer size={15} /> Print Preview Layout
        </button>

        {!isLocked ? (
          <button
            type="button"
            onClick={() => void handleLockRecord()}
            disabled={isSigning || !selectedPatient}
            className={buttonClasses({ size: 'sm' })}
          >
            <Lock size={15} /> {isSigning ? 'Signing…' : 'Sign & Electronic Lock'}
          </button>
        ) : (
          <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={16} /> Signed by {provider}
          </span>
        )}
      </div>

      {/* Print Preview Clean Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl sm:p-8">
            <div className="flex justify-between items-start border-b pb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  CLINICAL ENCOUNTER SUMMARY
                </h2>
                <p className="text-xs text-slate-500">
                  Altrixs Medical Primary Care · Family Medicine Suite
                </p>
              </div>
              <IconButton
                label="Close"
                icon={<X className="h-4 w-4" />}
                onClick={() => setShowPrintModal(false)}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>

            <div className="mt-4 space-y-4 text-xs text-slate-800">
              <div className="grid grid-cols-1 gap-2 border-b pb-3 sm:grid-cols-2">
                <div>
                  <strong>Patient:</strong> {selectedPatient?.name} (MRN: {selectedPatient?.mrn})
                </div>
                <div>
                  <strong>DOB:</strong> {displayDob(selectedPatient)} ({displayAge(selectedPatient)} yrs)
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
                  BP: {systolic || '—'}/{diastolic || '—'} mmHg{bpStaging ? ` (${bpStaging.stage})` : ''} · HR: {heartRate || '—'} bpm · RR: {respRate || '—'} · Temp: {tempF || '—'}°F · SpO2: {oxygenSat || '—'}% · BMI: {bmi || '—'} kg/m²
                </p>
              </div>

              <div>
                <strong className="text-amber-800 uppercase block mb-1">Assessment & E&M Code:</strong>
                <p className="font-semibold">Recommended E&M: CPT {emCalculation.code} ({emCalculation.title})</p>
                <ul className="list-disc pl-5 mt-1">
                  {diagnoses.map((d, i) => (
                    <li key={i}>{d.icd10} — {d.description}</li>
                  ))}
                </ul>
              </div>

              <div>
                <strong className="text-blue-800 uppercase block mb-1">Plan:</strong>
                <p><strong>Prescriptions:</strong> {prescriptions.join(', ') || 'None'}</p>
                <p><strong>Labs:</strong> {labOrders.join(', ') || 'None'}</p>
                <p className="mt-1"><strong>Counseling:</strong> {patientCounseling}</p>
              </div>

              <div className="border-t pt-4 text-[11px] text-slate-500 flex flex-wrap justify-between gap-2">
                <span>Electronic Signature: {provider}</span>
                <span>Visit ID: {signedVisitId || '—'}</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t pt-4">
              <button
                type="button"
                onClick={() => window.print()}
                className={buttonClasses({ size: 'sm' })}
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
