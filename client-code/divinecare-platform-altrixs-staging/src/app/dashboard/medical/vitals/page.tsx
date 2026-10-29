'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Activity,
  Heart,
  TrendingUp,
  TrendingDown,
  Minus,
  Plus,
  Calendar,
  User,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Search,
  ChevronRight,
  Gauge,
  Thermometer,
  Wind,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { calculateBMI, getBPStaging } from '@/features/medical/vitalsCalc';
import { createVitals, fetchMedicalChart, fetchMedicalPatients } from '@/features/medical/api';
import { MedicalPatient, MedicalVitalRecord } from '@/features/medical/types';
import { displayAge, displayDob, vitalText } from '@/features/medical/format';
import { buttonClasses } from '@/components/ui';

export default function MedicalVitalsPage() {
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // New vitals state
  // Vitals start blank; inputs are `required`, so the clinician must enter measured values.
  const [systolic, setSystolic] = useState<string>('');
  const [diastolic, setDiastolic] = useState<string>('');
  const [heartRate, setHeartRate] = useState<string>('');
  const [respRate, setRespRate] = useState<string>('');
  const [temperatureF, setTemperatureF] = useState<string>('');
  const [heightInches, setHeightInches] = useState<string>('');
  const [weightLbs, setWeightLbs] = useState<string>('');
  const [oxygenSat, setOxygenSat] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pageMsg, setPageMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Roster from the API; the selected patient's flowsheet is loaded from their chart.
  useEffect(() => {
    fetchMedicalPatients()
      .then((list) => {
        setPatients(list);
        setSelectedPatientId((cur) => cur || list[0]?.id || '');
      })
      .catch((err) =>
        setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not load patients.' })
      );
  }, []);

  const loadVitals = async (patientId: string) => {
    try {
      const chart = await fetchMedicalChart(patientId);
      setPatients((prev) => prev.map((p) => (p.id === patientId ? { ...p, vitals: chart.vitals } : p)));
      const latest = chart.vitals[0];
      // Carry forward the patient's own last recorded height. Weight must be measured today,
      // so it starts blank; the prior weight is shown only as a placeholder hint.
      setHeightInches(latest?.heightInches ? String(latest.heightInches) : '');
      setWeightLbs('');
    } catch (err) {
      setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not load vitals.' });
    }
  };

  useEffect(() => {
    if (selectedPatientId) void loadVitals(selectedPatientId);
  }, [selectedPatientId]);

  const selectedPatient = useMemo(() => {
    return patients.find((p) => p.id === selectedPatientId) || patients[0];
  }, [patients, selectedPatientId]);

  const filteredPatients = useMemo(() => {
    if (!searchTerm.trim()) return patients;
    const q = searchTerm.toLowerCase();
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q)
    );
  }, [patients, searchTerm]);

  const vitalsHistory = useMemo(() => {
    if (!selectedPatient) return [];
    return [...selectedPatient.vitals].sort(
      (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    );
  }, [selectedPatient]);

  const latestVital: MedicalVitalRecord | undefined = vitalsHistory[0];
  const previousVital: MedicalVitalRecord | undefined = vitalsHistory[1];

  // Calculated live BMI for modal
  const liveBMI = useMemo(() => {
    if (!weightLbs.trim() || !heightInches.trim()) return 0;
    return calculateBMI(Number(weightLbs), Number(heightInches));
  }, [weightLbs, heightInches]);

  const liveBPStaging = useMemo(() => {
    if (!systolic.trim() || !diastolic.trim()) return null;
    return getBPStaging(Number(systolic), Number(diastolic));
  }, [systolic, diastolic]);

  const getTrendIcon = (current?: number | null, previous?: number | null) => {
    if (current == null || previous == null) {
      return <Minus className="w-4 h-4 text-slate-500 inline" />;
    }
    const diff = current - previous;
    if (Math.abs(diff) < 1) {
      return (
        <span title="Stable">
          <Minus className="w-4 h-4 text-slate-500 inline" />
        </span>
      );
    }
    if (diff > 0) {
      return (
        <span title={`+${diff.toFixed(1)}`}>
          <TrendingUp className="w-4 h-4 text-rose-600 inline" />
        </span>
      );
    }
    return (
      <span title={`${diff.toFixed(1)}`}>
        <TrendingDown className="w-4 h-4 text-emerald-700 inline" />
      </span>
    );
  };

  const handleRecordVitals = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || isSaving) return;
    setIsSaving(true);
    setFormError('');
    try {
      await createVitals(selectedPatient.id, {
        systolic: Number(systolic),
        diastolic: Number(diastolic),
        heartRate: Number(heartRate),
        respRate: Number(respRate),
        temperatureF: Number(temperatureF),
        heightInches: Number(heightInches),
        weightLbs: Number(weightLbs),
        oxygenSat: Number(oxygenSat),
      });
      await loadVitals(selectedPatient.id);
      setShowAddModal(false);
      setPageMsg({ type: 'success', text: 'Vitals saved to the chart.' });
      setSystolic('');
      setDiastolic('');
      setHeartRate('');
      setRespRate('');
      setTemperatureF('');
      setOxygenSat('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save vitals.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
      <MedicalNavHeader
        title="Vitals & Hemodynamic Monitoring"
        subtitle="Longitudinal biometric flowsheet, BP staging analytics, and automated BMI trends"
        badge="ACC / AHA Compliant"
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
        {/* Top Control Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <User className="w-5 h-5 text-blue-600" />
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search patient by name or MRN…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <select
              aria-label="Select medical patient"
              value={selectedPatient?.id || ''}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
            >
              {filteredPatients.length === 0 && <option value="">No patients</option>}
              {filteredPatients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.mrn}) — Age {displayAge(p)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <button
              onClick={() => {
                setFormError('');
                setShowAddModal(true);
              }}
              className={buttonClasses()}
            >
              <Plus className="w-4 h-4" />
              Record Vitals
            </button>
            {selectedPatient && (
              <Link
                href={`/dashboard/medical/patients/${selectedPatient.id}`}
                className="inline-flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                Chart View
                <ChevronRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>

        {!selectedPatient && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 text-center mb-6">
            <Activity className="w-12 h-12 text-slate-500 mx-auto mb-2" />
            <p className="text-slate-600 font-medium">No medical patients yet.</p>
          </div>
        )}

        {selectedPatient && (
          <>
            {/* Patient Header Quick Banner */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-semibold">{selectedPatient.name}</h2>
                  <span className="bg-blue-50 text-slate-600 text-xs px-2.5 py-0.5 rounded-full font-mono">
                    MRN: {selectedPatient.mrn}
                  </span>
                  <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-0.5 rounded-full">
                    DOB: {displayDob(selectedPatient)} ({displayAge(selectedPatient)}yo)
                  </span>
                </div>
                <p className="text-slate-500 text-sm mt-1">
                  PCP: <strong className="text-slate-900">{selectedPatient.pcp || '—'}</strong> &bull; Somatic Diagnoses:{' '}
                  {selectedPatient.problems.map((p) => p.description).slice(0, 3).join(', ') || 'None documented'}
                </p>
              </div>

              {latestVital && (
                <div className="flex items-center gap-4 bg-slate-50  rounded-xl px-4 py-3 border border-slate-200">
                  <div className="text-right">
                    <div className="text-xs text-slate-500 uppercase tracking-wider">Latest Encounter BP</div>
                    <div className="text-2xl font-semibold text-slate-900">
                      {vitalText(latestVital.systolic)}/{vitalText(latestVital.diastolic)}{' '}
                      <span className="text-xs font-normal text-slate-500">mmHg</span>
                    </div>
                  </div>
                  <div className="h-9 w-px bg-slate-200" />
                  <div className="text-right">
                    <div className="text-xs text-slate-500 uppercase tracking-wider">Latest BMI</div>
                    <div className="text-2xl font-semibold text-slate-900">
                      {vitalText(latestVital.bmi)}{' '}
                      <span className="text-xs font-normal text-slate-500">kg/m²</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* KPI Vitals Cards with Directional Trend Indicators */}
            {latestVital ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                {/* Blood Pressure */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs relative overflow-hidden">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span>Blood Pressure</span>
                    {getTrendIcon(latestVital.systolic, previousVital?.systolic)}
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {vitalText(latestVital.systolic)}/{vitalText(latestVital.diastolic)}
                  </div>
                  <div className="mt-2">
                    {(() => {
                      const staging = getBPStaging(latestVital.systolic, latestVital.diastolic);
                      return (
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ring-1 ring-inset ${staging.badgeClass}`}>
                          {staging.stage.split('(')[0]}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Heart Rate */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5 text-rose-600" /> Pulse
                    </span>
                    {getTrendIcon(latestVital.heartRate, previousVital?.heartRate)}
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {vitalText(latestVital.heartRate)} <span className="text-xs font-normal text-slate-500">bpm</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {latestVital.heartRate == null
                      ? 'Not recorded'
                      : latestVital.heartRate < 60
                      ? 'Bradycardia'
                      : latestVital.heartRate > 100
                      ? 'Tachycardia'
                      : 'Normal Sinus'}
                  </div>
                </div>

                {/* Oxygen Saturation */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-sky-700" /> SpO₂
                    </span>
                    {getTrendIcon(latestVital.oxygenSat, previousVital?.oxygenSat)}
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {vitalText(latestVital.oxygenSat)}%
                  </div>
                  <div className="mt-2 text-xs">
                    {latestVital.oxygenSat == null ? (
                      <span className="text-slate-500">Not recorded</span>
                    ) : latestVital.oxygenSat >= 95 ? (
                      <span className="text-emerald-700 font-medium">Adequate O₂</span>
                    ) : (
                      <span className="text-rose-600 font-medium">Hypoxia alert</span>
                    )}
                  </div>
                </div>

                {/* Respiration */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span>Resp Rate</span>
                    {getTrendIcon(latestVital.respRate, previousVital?.respRate)}
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {vitalText(latestVital.respRate)} <span className="text-xs font-normal text-slate-500">/min</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {latestVital.respRate == null
                      ? 'Not recorded'
                      : latestVital.respRate < 12
                      ? 'Bradypnea'
                      : latestVital.respRate > 20
                      ? 'Tachypnea'
                      : 'Eupneic'}
                  </div>
                </div>

                {/* Temperature */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Thermometer className="w-3.5 h-3.5 text-amber-700" /> Temp
                    </span>
                    {getTrendIcon(latestVital.temperatureF, previousVital?.temperatureF)}
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {vitalText(latestVital.temperatureF)}°F
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {latestVital.temperatureF == null ? 'Not recorded' : latestVital.temperatureF >= 100.4 ? 'Febrile' : 'Afebrile'}
                  </div>
                </div>

                {/* BMI & Weight */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Gauge className="w-3.5 h-3.5 text-blue-500" /> BMI
                    </span>
                    {getTrendIcon(latestVital.bmi, previousVital?.bmi)}
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {vitalText(latestVital.bmi)} <span className="text-xs font-normal text-slate-500">({vitalText(latestVital.weightLbs)} lbs)</span>
                  </div>
                  <div className="mt-2 text-xs font-medium">
                    {!latestVital.bmi ? (
                      <span className="text-slate-500">Not recorded</span>
                    ) : latestVital.bmi < 18.5 ? (
                      <span className="text-amber-700">Underweight</span>
                    ) : latestVital.bmi < 25 ? (
                      <span className="text-emerald-700">Normal BMI</span>
                    ) : latestVital.bmi < 30 ? (
                      <span className="text-amber-700">Overweight</span>
                    ) : (
                      <span className="text-rose-600">Obese Class I+</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center mb-6">
                <Activity className="w-12 h-12 text-slate-500 mx-auto mb-2" />
                <p className="text-slate-600 font-medium">No vitals on record for this patient yet.</p>
                <button
                  onClick={() => {
                setFormError('');
                setShowAddModal(true);
              }}
                  className={buttonClasses({ className: 'mt-3' })}
                >
                  Record Initial Baseline
                </button>
              </div>
            )}

            {/* AI Vitals Trend Summary Panel */}
            <div className="bg-white rounded-xl border border-blue-100 p-5 shadow-xs mb-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">Blood Pressure Staging Summary</h3>
                    <span className="bg-blue-100 text-blue-800 text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full">
                      Rule-based (ACC/AHA thresholds)
                    </span>
                  </div>
                  {/* Computed from the recorded readings only; no AI, and no claims about medications. */}
                  <p className="text-slate-700 text-sm mt-1 leading-relaxed">
                    {!latestVital || latestVital.systolic == null || latestVital.diastolic == null ? (
                      <>No blood pressure on the latest vitals entry.</>
                    ) : (
                      <>
                        Latest BP <strong>{latestVital.systolic}/{latestVital.diastolic} mmHg</strong> stages as{' '}
                        <strong>{getBPStaging(latestVital.systolic, latestVital.diastolic).stage}</strong>.
                        {previousVital && previousVital.systolic != null
                          ? ` Systolic change since the prior reading: ${latestVital.systolic - previousVital.systolic > 0 ? '+' : ''}${latestVital.systolic - previousVital.systolic} mmHg.`
                          : ' No prior reading to compare.'}{' '}
                        Clinical interpretation and treatment decisions remain with the treating provider.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Historical Flowsheet Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 py-4 sm:px-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900">Historical Biometric Flowsheet</h3>
                  <p className="text-xs text-slate-500">Sequential physiological encounters sorted newest first</p>
                </div>
                <span className="text-xs text-slate-500">
                  Total Observations: <strong>{vitalsHistory.length}</strong>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                      <th scope="col" className="py-3 px-4">Date / Time</th>
                      <th scope="col" className="py-3 px-4">BP (mmHg)</th>
                      <th scope="col" className="py-3 px-4">BP Classification</th>
                      <th scope="col" className="py-3 px-4">Pulse</th>
                      <th scope="col" className="py-3 px-4">SpO₂</th>
                      <th scope="col" className="py-3 px-4">RR</th>
                      <th scope="col" className="py-3 px-4">Temp</th>
                      <th scope="col" className="py-3 px-4">Weight</th>
                      <th scope="col" className="py-3 px-4">BMI</th>
                      <th scope="col" className="py-3 px-4">Clinician</th>
                      <th scope="col" className="py-3 px-4">Clinical Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vitalsHistory.map((v) => {
                      const staging = getBPStaging(v.systolic, v.diastolic);
                      return (
                        <tr key={v.id} className="hover:bg-slate-50/80 transition">
                          <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                            {new Date(v.recordedAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                            {vitalText(v.systolic)}/{vitalText(v.diastolic)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ring-1 ring-inset ${staging.badgeClass}`}>
                              {staging.stage}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-800">{vitalText(v.heartRate)} bpm</td>
                          <td className="py-3 px-4 text-slate-800">{vitalText(v.oxygenSat)}%</td>
                          <td className="py-3 px-4 text-slate-800">{vitalText(v.respRate)} /min</td>
                          <td className="py-3 px-4 text-slate-800">{vitalText(v.temperatureF)}°F</td>
                          <td className="py-3 px-4 text-slate-800">{vitalText(v.weightLbs)} lbs</td>
                          <td className="py-3 px-4 font-semibold text-slate-900">{vitalText(v.bmi)}</td>
                          <td className="py-3 px-4 text-xs text-slate-600 truncate max-w-[140px]">{v.recordedBy}</td>
                          <td className="py-3 px-4 text-xs text-slate-500 italic max-w-[200px] truncate">
                            {v.notes || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Record Vitals Modal with Real-Time BMI Calculator & BP Staging */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-2xl w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Record Clinical Vitals</h3>
                <p className="text-xs text-slate-500">
                  Patient: {selectedPatient?.name} ({selectedPatient?.mrn})
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleRecordVitals} className="space-y-5 mt-4">
              {/* BP Staging Live Preview */}
              <div className="p-3 rounded-lg border flex items-center justify-between bg-slate-50">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Live BP Classification:
                  </span>
                  <div className="text-base font-semibold text-slate-900">
                    {systolic || '—'}/{diastolic || '—'} mmHg
                  </div>
                </div>
                {liveBPStaging && (
                  <span className={`px-2.5 py-1 rounded text-xs font-semibold ring-1 ring-inset ${liveBPStaging.badgeClass}`}>
                    {liveBPStaging.stage}
                  </span>
                )}
              </div>

              {/* BP Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Systolic Blood Pressure (mmHg) *
                  </label>
                  <input
                    type="number"
                    min="60"
                    max="260"
                    required
                    value={systolic}
                    onChange={(e) => setSystolic(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Diastolic Blood Pressure (mmHg) *
                  </label>
                  <input
                    type="number"
                    min="30"
                    max="160"
                    required
                    value={diastolic}
                    onChange={(e) => setDiastolic(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Pulse & SpO2 & RR */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Heart Rate (bpm) *
                  </label>
                  <input
                    type="number"
                    min="30"
                    max="220"
                    required
                    value={heartRate}
                    onChange={(e) => setHeartRate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Oxygen Saturation SpO₂ (%) *
                  </label>
                  <input
                    type="number"
                    min="70"
                    max="100"
                    required
                    value={oxygenSat}
                    onChange={(e) => setOxygenSat(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Respiration (breaths/min) *
                  </label>
                  <input
                    type="number"
                    min="6"
                    max="60"
                    required
                    value={respRate}
                    onChange={(e) => setRespRate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Temp & Height & Weight */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Temperature (°F) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="90"
                    max="110"
                    required
                    value={temperatureF}
                    onChange={(e) => setTemperatureF(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Height (inches) *
                  </label>
                  <input
                    type="number"
                    min="20"
                    max="96"
                    required
                    value={heightInches}
                    onChange={(e) => setHeightInches(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Weight (lbs) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="20"
                    max="600"
                    required
                    value={weightLbs}
                    placeholder={latestVital?.weightLbs ? `Last: ${latestVital.weightLbs}` : undefined}
                    onChange={(e) => setWeightLbs(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Real-time Calculated BMI Callout */}
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-blue-900 uppercase">
                    Auto-Calculated Body Mass Index (BMI)
                  </div>
                  <div className="text-xs text-blue-700">Formula: (weight_lbs / height_in²) × 703</div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-semibold text-blue-950">{liveBMI || '—'}</span>{' '}
                  <span className="text-xs font-medium text-blue-700">kg/m²</span>
                </div>
              </div>

              {formError && <p className="text-xs font-semibold text-rose-700">{formError}</p>}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !selectedPatient}
                  className={buttonClasses()}
                >
                  {isSaving ? 'Saving…' : 'Save Vitals Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
