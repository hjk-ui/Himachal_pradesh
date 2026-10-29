'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Pill,
  RefreshCw,
  Send,
  AlertTriangle,
  Lock,
  CheckCircle2,
  XCircle,
  Plus,
  Search,
  Building2,
  FileCheck,
  ShieldCheck,
  Clock,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { useClients } from '@/features/clients';
import { DrFirstPanel } from '@/components/drfirst/DrFirstPanel';
import { DrFirstWaitingPanel } from '@/components/drfirst/DrFirstWaiting';
import { getPrescribingUiState } from '@/lib/drfirst/uiState';
import { DrugAllergySearch } from '@/components/drfirst/DrugAllergySearch';
import { resolveDrugCode } from '@/lib/prescribing/drugCodes';

type RxStatus = 'Active' | 'Pending' | 'Discontinued' | 'Expired';
type DEASchedule = 'None' | 'II' | 'III' | 'IV' | 'V';

interface Prescription {
  id: string;
  rxNumber: string;
  clientId: string;
  clientName: string;
  medicationName: string;
  medicationClass?: string;
  deaSchedule: DEASchedule;
  dosage: string;
  frequency: string;
  daysSupply: number;
  refillsAllowed: number;
  refillsRemaining: number;
  pharmacyId?: string;
  pharmacyName: string;
  prescriberName?: string;
  prescriber?: string;
  notesToPharmacist?: string;
  pdmpChecked: boolean;
  pdmpCheckedAt?: string;
  epcsAttested: boolean;
  status: RxStatus;
  transmissionStatus: string;
  lastFilledDate?: string;
  createdAt: string;
}

interface RefillRequest {
  id: string;
  prescriptionId: string;
  clientId: string;
  clientName: string;
  medicationName: string;
  pharmacyName: string;
  requestedRefills: number;
  requestDate: string;
  lastFilledDate?: string;
  status: 'Pending' | 'Approved' | 'Denied';
  decisionReason?: string;
  decidedByName?: string;
  decidedAt?: string;
}

interface Pharmacy {
  id: string;
  ncpdpId: string;
  storeName: string;
  chainName?: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
}

const MEDICATIONS_LIST = [
  { name: 'Sertraline (Zoloft)', schedule: 'None' as DEASchedule, class: 'SSRI', defaultDose: '50mg' },
  { name: 'Escitalopram (Lexapro)', schedule: 'None' as DEASchedule, class: 'SSRI', defaultDose: '10mg' },
  { name: 'Fluoxetine (Prozac)', schedule: 'None' as DEASchedule, class: 'SSRI', defaultDose: '20mg' },
  { name: 'Bupropion XL (Wellbutrin)', schedule: 'None' as DEASchedule, class: 'NDRI', defaultDose: '150mg' },
  { name: 'Venlafaxine (Effexor)', schedule: 'None' as DEASchedule, class: 'SNRI', defaultDose: '75mg' },
  { name: 'Duloxetine (Cymbalta)', schedule: 'None' as DEASchedule, class: 'SNRI', defaultDose: '30mg' },
  { name: 'Lithium Carbonate', schedule: 'None' as DEASchedule, class: 'Mood Stabilizer', defaultDose: '300mg' },
  { name: 'Valproic Acid (Depakote)', schedule: 'None' as DEASchedule, class: 'Mood Stabilizer', defaultDose: '250mg' },
  { name: 'Lamotrigine (Lamictal)', schedule: 'None' as DEASchedule, class: 'Mood Stabilizer', defaultDose: '50mg' },
  { name: 'Aripiprazole (Abilify)', schedule: 'None' as DEASchedule, class: 'Atypical Antipsychotic', defaultDose: '10mg' },
  { name: 'Quetiapine (Seroquel)', schedule: 'None' as DEASchedule, class: 'Atypical Antipsychotic', defaultDose: '50mg' },
  { name: 'Risperidone (Risperdal)', schedule: 'None' as DEASchedule, class: 'Atypical Antipsychotic', defaultDose: '1mg' },
  { name: 'Buprenorphine/Naloxone (Suboxone)', schedule: 'III' as DEASchedule, class: 'MAT / Opioid Use', defaultDose: '8mg/2mg' },
  { name: 'Lorazepam (Ativan)', schedule: 'IV' as DEASchedule, class: 'Benzodiazepine', defaultDose: '0.5mg' },
  { name: 'Clonazepam (Klonopin)', schedule: 'IV' as DEASchedule, class: 'Benzodiazepine', defaultDose: '0.5mg' },
  { name: 'Alprazolam (Xanax)', schedule: 'IV' as DEASchedule, class: 'Benzodiazepine', defaultDose: '0.25mg' },
  { name: 'Amphetamine Salts (Adderall)', schedule: 'II' as DEASchedule, class: 'Stimulant (ADHD)', defaultDose: '20mg' },
  { name: 'Methylphenidate (Ritalin)', schedule: 'II' as DEASchedule, class: 'Stimulant (ADHD)', defaultDose: '10mg' },
  { name: 'Prazosin', schedule: 'None' as DEASchedule, class: 'Alpha Blocker (PTSD/Nightmares)', defaultDose: '2mg' },
  { name: 'Naltrexone', schedule: 'None' as DEASchedule, class: 'Opioid/Alcohol Antagonist', defaultDose: '50mg' },
];

const SCHEDULE_BADGES: Record<string, { bg: string; text: string; border: string }> = {
  'II': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  'III': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  'IV': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  'V': { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200' },
  'None': { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
};

function PrescriptionsContent() {
  const searchParams = useSearchParams();
  const initialClientId = searchParams.get('clientId') || '';
  const initialClientName = searchParams.get('clientName') || '';

  const { user } = useAuth();
  const { clients } = useClients();
  const { canPrescribe } = getPrescribingUiState(user);

  const [activeTab, setActiveTab] = useState<'active' | 'controlled' | 'refills' | 'history' | 'drfirst'>('active');
  const [search, setSearch] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('All');

  // Database Data
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [refills, setRefills] = useState<RefillRequest[]>([]);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New Rx Modal State
  const [showNewRxModal, setShowNewRxModal] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState(initialClientId);
  const [selectedClientName, setSelectedClientName] = useState(initialClientName);
  const [selectedMedication, setSelectedMedication] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSchedule, setSelectedSchedule] = useState<DEASchedule>('None');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('Once daily (morning)');
  const [daysSupply, setDaysSupply] = useState(30);
  const [refillsAllowed, setRefillsAllowed] = useState(selectedSchedule === 'II' ? 0 : 5);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState('');
  const [notesToPharmacist, setNotesToPharmacist] = useState('');
  const [pdmpAttested, setPdmpAttested] = useState(false);
  const [submittingRx, setSubmittingRx] = useState(false);

  // Refill Denial Modal State
  const [denialModalId, setDenialModalId] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState('Patient requires clinical evaluation prior to refill authorization.');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  const [drFirstCounts, setDrFirstCounts] = useState({
    pending_prescription: 0,
    need_signing: 0,
    refill: 0,
    rx_change: 0,
  });
  const [drFirstLastSync, setDrFirstLastSync] = useState<string | undefined>();

  // Open modal automatically if clientId was passed in URL query
  useEffect(() => {
    if (initialClientId) {
      setSelectedClientId(initialClientId);
      if (initialClientName) {
        setSelectedClientName(decodeURIComponent(initialClientName));
      }
      setShowNewRxModal(true);
    }
  }, [initialClientId, initialClientName]);

  // Load Prescriptions from PostgreSQL
  const loadPrescriptions = async () => {
    try {
      const res = await fetch('/api/prescriptions');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setPrescriptions(data.data);
      }
    } catch (err) {
      console.error('Failed to load prescriptions from PostgreSQL:', err);
    }
  };

  // Load Refills from PostgreSQL
  const loadRefills = async () => {
    try {
      const res = await fetch('/api/prescriptions/refills');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setRefills(data.data);
      }
    } catch (err) {
      console.error('Failed to load refills from PostgreSQL:', err);
    }
  };

  // Load Pharmacies from PostgreSQL
  const loadPharmacies = async () => {
    try {
      const res = await fetch('/api/prescriptions/pharmacies');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setPharmacies(data.data);
        if (data.data.length > 0 && !selectedPharmacyId) {
          setSelectedPharmacyId(data.data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load pharmacies:', err);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPrescriptions(), loadRefills(), loadPharmacies()]).finally(() => {
      setLoading(false);
    });
    fetch('/api/drfirst/notifications')
      .then((r) => r.json())
      .then((data) => {
        if (data?.counts) setDrFirstCounts(data.counts);
        if (data?.lastSyncLabel) setDrFirstLastSync(data.lastSyncLabel);
        else if (data?.lastSyncAt) {
          const agoMs = Date.now() - new Date(data.lastSyncAt).getTime();
          const mins = Math.max(0, Math.round(agoMs / 60_000));
          setDrFirstLastSync(mins < 1 ? 'just now' : `${mins} min ago`);
        }
      })
      .catch(() => undefined);
  }, []);

  // When Medication changes in Modal, update schedule and default dosage
  const handleMedicationChange = (medName: string) => {
    setSelectedMedication(medName);
    const med = MEDICATIONS_LIST.find((m) => m.name === medName);
    if (med) {
      setSelectedSchedule(med.schedule);
      setSelectedClass(med.class);
      setDosage(med.defaultDose);
      if (med.schedule === 'II') {
        setRefillsAllowed(0);
        setPdmpAttested(false);
      } else if (['III', 'IV', 'V'].includes(med.schedule)) {
        setRefillsAllowed(Math.min(refillsAllowed, 5));
        setPdmpAttested(false);
      } else {
        setRefillsAllowed(5);
        setPdmpAttested(true);
      }
    }
  };

  // Save an internal medication-order draft. This route does not transmit to a pharmacy.
  const handleCreatePrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !selectedMedication) {
      setActionMessage({ type: 'error', text: 'Choose a patient and a medication with a standard drug code.' });
      return;
    }

    if (selectedSchedule !== 'None' && !pdmpAttested) {
      setActionMessage({
        type: 'error',
        text: 'Maryland law requires checking the PDMP (CRISP) before prescribing controlled substances.',
      });
      return;
    }

    setSubmittingRx(true);
    setActionMessage(null);

    try {
      const selectedPharm = pharmacies.find((p) => p.id === selectedPharmacyId);
      const payload = {
        clientId: selectedClientId,
        clientName: selectedClientName,
        medicationName: selectedMedication,
        rxnormId: resolveDrugCode(selectedMedication) || undefined,
        medicationClass: selectedClass,
        deaSchedule: selectedSchedule,
        dosage,
        frequency,
        daysSupply: Number(daysSupply),
        refillsAllowed: selectedSchedule === 'II' ? 0 : Number(refillsAllowed),
        pharmacyId: selectedPharmacyId || null,
        pharmacyName: selectedPharm ? selectedPharm.storeName : 'Local Maryland Pharmacy',
        notesToPharmacist: notesToPharmacist.trim() || null,
        pdmpChecked: selectedSchedule !== 'None' ? pdmpAttested : false,
        epcsAttested: selectedSchedule !== 'None',
      };

      const res = await fetch('/api/prescriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit prescription.');
      }

      setActionMessage({
        type: 'success',
        text: `Medication order ${data.data.rxNumber || ''} saved as an internal draft. It was not transmitted to a pharmacy.`,
      });
      setShowNewRxModal(false);
      await loadPrescriptions();
      setActiveTab('active');
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error saving medication-order draft.' });
    } finally {
      setSubmittingRx(false);
    }
  };

  // Refill Decision Handlers
  const handleRefillDecision = async (id: string, action: 'Approved' | 'Denied', reason?: string) => {
    setSubmittingDecision(true);
    try {
      const res = await fetch(`/api/prescriptions/refills/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to process refill.`);
      }

      setActionMessage({
        type: 'success',
        text: `Refill request successfully ${action.toLowerCase()}.`,
      });
      setDenialModalId(null);
      await Promise.all([loadRefills(), loadPrescriptions()]);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error processing refill.' });
    } finally {
      setSubmittingDecision(false);
    }
  };

  // Filter Prescriptions
  const filteredPrescriptions = useMemo(() => {
    return prescriptions.filter((rx) => {
      const matchSearch =
        rx.clientName.toLowerCase().includes(search.toLowerCase()) ||
        rx.medicationName.toLowerCase().includes(search.toLowerCase()) ||
        rx.rxNumber.toLowerCase().includes(search.toLowerCase());

      const matchSchedule =
        scheduleFilter === 'All' ||
        (scheduleFilter === 'Controlled' && rx.deaSchedule !== 'None') ||
        rx.deaSchedule === scheduleFilter;

      if (!matchSearch || !matchSchedule) return false;

      if (activeTab === 'active') return rx.status === 'Active';
      if (activeTab === 'controlled') return rx.deaSchedule !== 'None' && rx.status === 'Active';
      if (activeTab === 'history') return rx.status !== 'Active';
      return true;
    });
  }, [prescriptions, search, scheduleFilter, activeTab]);

  const pendingRefills = useMemo(() => {
    return refills.filter((r) => r.status === 'Pending');
  }, [refills]);

  const todayStr = new Date().toISOString().split('T')[0];
  const createdTodayCount = prescriptions.filter(
    (p) => p.createdAt && p.createdAt.startsWith(todayStr)
  ).length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl p-2.5 text-white" style={{ background: '#5C2D91' }}>
              <Pill size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                E-Prescribing & Medication Management
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                DrFirst staging gateway · Pharmacy transmission and EPCS occur only inside the certified DrFirst portal
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab('drfirst');
            }}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:opacity-95 transition cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
          >
            <Plus size={16} /> New Prescription in DrFirst
          </button>
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-xl border text-sm font-medium ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 size={18} className="text-emerald-600" />
            ) : (
              <XCircle size={18} className="text-rose-600" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-xs opacity-70 hover:opacity-100 ml-4"
          >
            &times;
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Rx</span>
            <Pill size={16} className="text-purple-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {prescriptions.filter((p) => p.status === 'Active').length}
          </p>
          <span className="text-[11px] text-emerald-600 font-medium">PostgreSQL live active</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Refill Queue</span>
            <RefreshCw size={16} className="text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {pendingRefills.length}
          </p>
          <span className="text-[11px] text-amber-600 font-medium">
            {pendingRefills.length > 0 ? 'Pending clinician action' : 'All refills reviewed'}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">EPCS Controlled</span>
            <Lock size={16} className="text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {prescriptions.filter((p) => p.deaSchedule !== 'None' && p.status === 'Active').length}
          </p>
          <span className="text-[11px] text-rose-600 font-medium">Local records; verify in DrFirst</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recorded Today</span>
            <Send size={16} className="text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{createdTodayCount}</p>
          <span className="text-[11px] text-slate-500 font-medium">Local records created</span>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-px">
        <button
          type="button"
          onClick={() => setActiveTab('active')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'active'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Pill size={15} />
          Active Prescriptions
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 font-bold">
            {prescriptions.filter((p) => p.status === 'Active').length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('controlled')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'controlled'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Lock size={15} />
          Controlled Substances (EPCS)
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700 font-bold">
            {prescriptions.filter((p) => p.deaSchedule !== 'None' && p.status === 'Active').length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('refills')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'refills'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <RefreshCw size={15} />
          Refill Queue
          {pendingRefills.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 font-bold">
              {pendingRefills.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'history'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock size={15} />
          Discontinued / History
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('drfirst')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'drfirst'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 size={15} />
          DrFirst Certified Gateway
        </button>
      </div>

      {/* Tab: DrFirst Gateway */}
      {activeTab === 'drfirst' && (
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {canPrescribe ? (
            <DrFirstWaitingPanel counts={drFirstCounts} lastSyncLabel={drFirstLastSync} />
          ) : null}
          <DrFirstPanel prescriber={Boolean(canPrescribe)} defaultClientId={initialClientId} />
          {canPrescribe && <DrugAllergySearch />}
        </div>
      )}

      {/* Tab: Refill Queue */}
      {activeTab === 'refills' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Pharmacy Refill Renewal Requests</h3>
              <p className="text-xs text-slate-500">
                Local refill workflow. DrFirst download synchronization is not enabled until vendor certification is complete.
              </p>
            </div>
            <button
              type="button"
              onClick={loadRefills}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {refills.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
              <p className="text-sm font-semibold text-slate-700">Refill queue is completely clear!</p>
              <p className="text-xs text-slate-400 mt-1">No pending pharmacy renewal requests.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-hidden">
              {refills.map((refill) => (
                <div key={refill.id} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{refill.clientName}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          refill.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : refill.status === 'Denied'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {refill.status}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-purple-900 mt-0.5">
                      {refill.medicationName} · Requested Refills: {refill.requestedRefills}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                      <span>Pharmacy: {refill.pharmacyName}</span>
                      <span>&bull;</span>
                      <span>Requested: {new Date(refill.requestDate).toLocaleDateString()}</span>
                      {refill.lastFilledDate && (
                        <>
                          <span>&bull;</span>
                          <span>Last Filled: {new Date(refill.lastFilledDate).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                    {refill.decisionReason && (
                      <p className="text-xs text-rose-600 font-medium mt-1">
                        Denial Reason: {refill.decisionReason} (by {refill.decidedByName || 'Clinician'})
                      </p>
                    )}
                  </div>

                  {refill.status === 'Pending' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={submittingDecision}
                        onClick={() => handleRefillDecision(refill.id, 'Approved')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition cursor-pointer"
                      >
                        <CheckCircle2 size={13} /> Approve Refill
                      </button>
                      <button
                        type="button"
                        disabled={submittingDecision}
                        onClick={() => {
                          setDenialModalId(refill.id);
                          setDenialReason('Patient requires medication reconciliation visit prior to authorization.');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                      >
                        <XCircle size={13} /> Deny
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* EPCS Compliance Banner (DEA 21 CFR Part 1311) */}
      {activeTab === 'controlled' && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-blue-950 shadow-2xs">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-600 p-2 text-white shrink-0 mt-0.5">
              <Lock size={18} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-blue-900">
                EPCS requires DrFirst enrollment and certification
              </h3>
              <p className="text-xs text-blue-800 leading-relaxed">
                Do not use local records as evidence of pharmacy transmission. Schedule II–V prescriptions must be created, signed, and transmitted inside the certified DrFirst workflow with DrFirst-managed two-factor authentication.
                Schedule II medications are locked to 0 refills. Schedule III–V allow max 5 refills / 6 months.
                Maryland Health-General § 21-2A-04.2 mandates checking the state PDMP (CRISP) before prescribing.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs: Active Rx, Controlled, History */}
      {(activeTab === 'active' || activeTab === 'controlled' || activeTab === 'history') && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Table Filters */}
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by patient, medication, or Rx number…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-slate-500">DEA Schedule:</span>
              <select
                value={scheduleFilter}
                onChange={(e) => setScheduleFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
              >
                <option value="All">All Schedules</option>
                <option value="None">Non-Controlled</option>
                <option value="Controlled">Controlled (II-V)</option>
                <option value="II">Schedule II (Adderall/Ritalin)</option>
                <option value="III">Schedule III (Suboxone)</option>
                <option value="IV">Schedule IV (Benzos)</option>
              </select>
            </div>
          </div>

          {/* Table Data */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Rx Number</th>
                  <th className="py-3 px-4">Patient Client</th>
                  <th className="py-3 px-4">Medication & Dosage</th>
                  <th className="py-3 px-4">Schedule</th>
                  <th className="py-3 px-4">Sig / Directions</th>
                  <th className="py-3 px-4 text-center">Refills Left</th>
                  <th className="py-3 px-4">Pharmacy</th>
                  <th className="py-3 px-4">Prescriber / EPCS</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPrescriptions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No prescriptions found matching your search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredPrescriptions.map((rx) => {
                    const badge = SCHEDULE_BADGES[rx.deaSchedule] || SCHEDULE_BADGES['None'];
                    return (
                      <tr key={rx.id} className="hover:bg-purple-50/30 transition">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-700">
                          {rx.rxNumber}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          {rx.clientName}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-purple-950">{rx.medicationName}</div>
                          <div className="text-[11px] text-slate-500">{rx.dosage} {rx.medicationClass ? `· ${rx.medicationClass}` : ''}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${badge.bg} ${badge.text} ${badge.border}`}
                          >
                            {rx.deaSchedule !== 'None' ? <Lock size={9} /> : null}
                            Schedule {rx.deaSchedule}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-slate-800">{rx.frequency}</div>
                          <div className="text-[10px] text-slate-400">{rx.daysSupply} days supply</div>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] ${
                              rx.refillsRemaining === 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {rx.refillsRemaining}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {rx.pharmacyName}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-slate-800 font-medium">{rx.prescriberName}</div>
                          {rx.epcsAttested && (
                            <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
                              <ShieldCheck size={11} /> EPCS Attested
                            </div>
                          )}
                          {rx.pdmpChecked && (
                            <div className="flex items-center gap-1 text-[10px] text-purple-600 font-semibold">
                              <FileCheck size={11} /> CRISP PDMP Check
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              rx.status === 'Active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {rx.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interactive New Prescription Modal */}
      {showNewRxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-8">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between" style={{ background: '#5C2D91' }}>
              <div className="flex items-center gap-2.5 text-white">
                <Pill size={20} />
                <h2 className="text-base font-bold">New Electronic Prescription (E-Prescribe)</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowNewRxModal(false)}
                className="text-white/80 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreatePrescription} className="p-6 space-y-4">
              {/* Patient Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Patient Client <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedClientId}
                  onChange={(e) => {
                    setSelectedClientId(e.target.value);
                    const matched = clients.find((c) => c.id === e.target.value);
                    if (matched) setSelectedClientName(matched.name);
                  }}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                >
                  <option value="">Select a patient…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.mrn ? `(MRN: ${c.mrn})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Medication Formulary Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Formulary Drug <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={selectedMedication}
                    onChange={(e) => handleMedicationChange(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                  >
                    <option value="">Choose a medication</option>
                    {MEDICATIONS_LIST.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} [{m.schedule !== 'None' ? `Sched ${m.schedule}` : 'Legend'}]
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Dosage & Strength <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={dosage}
                    onChange={(e) => setDosage(e.target.value)}
                    placeholder="e.g. 50mg, 100mg"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                  />
                </div>
              </div>

              {/* DEA Schedule Warning Alert */}
              {selectedSchedule === 'II' && (
                <div className="p-3.5 rounded-xl border border-red-200 bg-red-50 text-red-900 text-xs flex items-start gap-2.5">
                  <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Schedule II Controlled Substance</span>: This local form creates a draft only. Complete signing and EPCS two-factor authentication in DrFirst.
                  </div>
                </div>
              )}

              {['III', 'IV', 'V'].includes(selectedSchedule) && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5">
                  <Lock size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Schedule {selectedSchedule} Controlled Substance</span>: Max 5 refills / 6 months validity per federal law.
                  </div>
                </div>
              )}

              {/* Sig Directions Builder */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Frequency <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                  >
                    <option value="Once daily (morning)">Once daily (morning)</option>
                    <option value="Once daily (evening)">Once daily (evening)</option>
                    <option value="Twice daily">Twice daily</option>
                    <option value="Three times daily">Three times daily</option>
                    <option value="Once nightly at bedtime">Once nightly at bedtime</option>
                    <option value="As needed PRN">As needed PRN</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Days Supply
                  </label>
                  <select
                    value={daysSupply}
                    onChange={(e) => setDaysSupply(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                  >
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Refills Authorized
                  </label>
                  <select
                    value={refillsAllowed}
                    disabled={selectedSchedule === 'II'}
                    onChange={(e) => setRefillsAllowed(Number(e.target.value))}
                    className={`w-full rounded-xl border p-2.5 text-xs text-slate-900 ${
                      selectedSchedule === 'II'
                        ? 'bg-slate-100 cursor-not-allowed border-slate-200 text-slate-400'
                        : 'bg-white border-slate-300'
                    }`}
                  >
                    {selectedSchedule === 'II' ? (
                      <option value={0}>0 (Locked by DEA)</option>
                    ) : (
                      <>
                        <option value={0}>0 refills</option>
                        <option value={1}>1 refill</option>
                        <option value={2}>2 refills</option>
                        <option value={3}>3 refills</option>
                        <option value={4}>4 refills</option>
                        <option value={5}>5 refills</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Pharmacy Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Dispensing Pharmacy <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedPharmacyId}
                  onChange={(e) => setSelectedPharmacyId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                >
                  {pharmacies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.storeName} ({p.addressLine1}, {p.city}, {p.state} {p.zipCode}) — Phone: {p.phone}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes to Pharmacist */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Special Notes to Pharmacist (Optional)
                </label>
                <input
                  type="text"
                  value={notesToPharmacist}
                  onChange={(e) => setNotesToPharmacist(e.target.value)}
                  placeholder="e.g. Do not substitute generic; take with food."
                  className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
                />
              </div>

              {/* Maryland Mandatory PDMP Attestation Checkbox */}
              {selectedSchedule !== 'None' && (
                <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/70">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pdmpAttested}
                      onChange={(e) => setPdmpAttested(e.target.checked)}
                      className="mt-0.5 rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-xs font-semibold text-purple-950">
                      I attest that I have consulted the Maryland PDMP (CRISP) database prior to issuing this controlled substance prescription as required by Maryland Health-General § 21-2A-04.2.
                    </span>
                  </label>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewRxModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRx || (selectedSchedule !== 'None' && !pdmpAttested)}
                  className="inline-flex items-center gap-2 rounded-xl text-white px-5 py-2.5 text-xs font-bold shadow-sm hover:opacity-95 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
                >
                  {selectedSchedule !== 'None' ? <Lock size={14} /> : <Send size={14} />}
                  {submittingRx ? 'Saving draft…' : 'Save internal draft (not transmitted)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Denial Reason Modal */}
      {denialModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-2">Deny Pharmacy Refill Request</h3>
            <p className="text-xs text-slate-500 mb-4">
              Please record the clinical rationale for this local refill decision. It is not returned electronically to the pharmacy until the certified DrFirst synchronization is enabled.
            </p>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Standard Denial Reason:</label>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    setDenialReason(e.target.value);
                  }
                }}
                className="w-full rounded-xl border border-slate-300 p-2 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 mb-2"
                defaultValue=""
              >
                <option value="" disabled>Choose a standard reason…</option>
                <option value="Too early to refill">Too early to refill</option>
                <option value="Medication change">Medication change</option>
                <option value="Missing appointment">Missing appointment</option>
                <option value="Controlled substance review required">Controlled substance review required</option>
                <option value="Patient requires medication reconciliation visit prior to authorization">Patient requires medication reconciliation visit</option>
              </select>
            </div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Pharmacist Notice / Additional Notes:</label>
            <textarea
              rows={3}
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 mb-4"
              placeholder="e.g. Appointment needed for clinical review."
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDenialModalId(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingDecision || !denialReason.trim()}
                onClick={() => handleRefillDecision(denialModalId, 'Denied', denialReason)}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {submittingDecision ? 'Processing…' : 'Confirm Denial'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PrescriptionsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-400">
          Loading E-Prescribing Engine…
        </div>
      }
    >
      <PrescriptionsContent />
    </Suspense>
  );
}
