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
import {
  getMedicalPatients,
  saveMedicalPatients,
  calculateBMI,
  getBPStaging,
} from '@/features/medical/data';
import { MedicalPatient, MedicalVitalRecord } from '@/features/medical/types';

export default function MedicalVitalsPage() {
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // New vitals state
  const [systolic, setSystolic] = useState<number>(120);
  const [diastolic, setDiastolic] = useState<number>(80);
  const [heartRate, setHeartRate] = useState<number>(72);
  const [respRate, setRespRate] = useState<number>(16);
  const [temperatureF, setTemperatureF] = useState<number>(98.6);
  const [heightInches, setHeightInches] = useState<number>(68);
  const [weightLbs, setWeightLbs] = useState<number>(165);
  const [oxygenSat, setOxygenSat] = useState<number>(98);
  const [vitalsNotes, setVitalsNotes] = useState<string>('');

  useEffect(() => {
    const list = getMedicalPatients();
    setPatients(list);
    if (list.length > 0 && !selectedPatientId) {
      setSelectedPatientId(list[0].id);
      if (list[0].vitals.length > 0) {
        const latest = list[0].vitals[0];
        setHeightInches(latest.heightInches || 68);
        setWeightLbs(latest.weightLbs || 165);
      }
    }

    const handler = () => {
      setPatients(getMedicalPatients());
    };
    window.addEventListener('medical_patients_updated', handler);
    return () => window.removeEventListener('medical_patients_updated', handler);
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
    return calculateBMI(weightLbs, heightInches);
  }, [weightLbs, heightInches]);

  const liveBPStaging = useMemo(() => {
    return getBPStaging(systolic, diastolic);
  }, [systolic, diastolic]);

  const getTrendIcon = (current?: number, previous?: number) => {
    if (current === undefined || previous === undefined) {
      return <Minus className="w-4 h-4 text-slate-400 inline" />;
    }
    const diff = current - previous;
    if (Math.abs(diff) < 1) {
      return (
        <span title="Stable">
          <Minus className="w-4 h-4 text-slate-400 inline" />
        </span>
      );
    }
    if (diff > 0) {
      return (
        <span title={`+${diff.toFixed(1)}`}>
          <TrendingUp className="w-4 h-4 text-rose-500 inline" />
        </span>
      );
    }
    return (
      <span title={`${diff.toFixed(1)}`}>
        <TrendingDown className="w-4 h-4 text-emerald-500 inline" />
      </span>
    );
  };

  const handleRecordVitals = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;

    const newRec: MedicalVitalRecord = {
      id: `vit-${Date.now()}`,
      recordedAt: new Date().toISOString(),
      recordedBy: '',
      systolic: Number(systolic),
      diastolic: Number(diastolic),
      heartRate: Number(heartRate),
      respRate: Number(respRate),
      temperatureF: Number(temperatureF),
      heightInches: Number(heightInches),
      weightLbs: Number(weightLbs),
      bmi: liveBMI,
      oxygenSat: Number(oxygenSat),
      notes: vitalsNotes.trim() || undefined,
    };

    const updatedPatients = patients.map((p) => {
      if (p.id === selectedPatient.id) {
        return {
          ...p,
          vitals: [newRec, ...p.vitals],
        };
      }
      return p;
    });

    saveMedicalPatients(updatedPatients);
    setShowAddModal(false);
    setVitalsNotes('');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <MedicalNavHeader
        title="Vitals & Hemodynamic Monitoring"
        subtitle="Longitudinal biometric flowsheet, BP staging analytics, and automated BMI trends"
        badge="ACC / AHA Compliant"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* Top Control Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <User className="w-5 h-5 text-indigo-600" />
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search patient by name or MRN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <select
              aria-label="Select medical patient"
              value={selectedPatient?.id || ''}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
            >
              {filteredPatients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.mrn}) — Age {p.age}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition shadow-sm"
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

        {selectedPatient && (
          <>
            {/* Patient Header Quick Banner */}
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-md mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-bold">{selectedPatient.name}</h2>
                  <span className="bg-indigo-500/30 text-indigo-200 text-xs px-2.5 py-0.5 rounded-full font-mono">
                    MRN: {selectedPatient.mrn}
                  </span>
                  <span className="bg-slate-800 text-slate-300 text-xs px-2.5 py-0.5 rounded-full">
                    DOB: {selectedPatient.dob} ({selectedPatient.age}yo)
                  </span>
                </div>
                <p className="text-slate-300 text-sm mt-1">
                  PCP: <strong className="text-white">{selectedPatient.pcp}</strong> &bull; Somatic Diagnoses:{' '}
                  {selectedPatient.problems.map((p) => p.description).slice(0, 3).join(', ') || 'None documented'}
                </p>
              </div>

              {latestVital && (
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/10">
                  <div className="text-right">
                    <div className="text-xs text-slate-300 uppercase tracking-wider">Latest Encounter BP</div>
                    <div className="text-2xl font-extrabold text-white">
                      {latestVital.systolic}/{latestVital.diastolic}{' '}
                      <span className="text-xs font-normal text-slate-300">mmHg</span>
                    </div>
                  </div>
                  <div className="h-9 w-px bg-white/20" />
                  <div className="text-right">
                    <div className="text-xs text-slate-300 uppercase tracking-wider">Latest BMI</div>
                    <div className="text-2xl font-extrabold text-white">
                      {latestVital.bmi}{' '}
                      <span className="text-xs font-normal text-slate-300">kg/m²</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* KPI Vitals Cards with Directional Trend Indicators */}
            {latestVital ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                {/* Blood Pressure */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span>Blood Pressure</span>
                    {getTrendIcon(latestVital.systolic, previousVital?.systolic)}
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    {latestVital.systolic}/{latestVital.diastolic}
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
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5 text-rose-500" /> Pulse
                    </span>
                    {getTrendIcon(latestVital.heartRate, previousVital?.heartRate)}
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    {latestVital.heartRate} <span className="text-xs font-normal text-slate-500">bpm</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {latestVital.heartRate < 60
                      ? 'Bradycardia'
                      : latestVital.heartRate > 100
                      ? 'Tachycardia'
                      : 'Normal Sinus'}
                  </div>
                </div>

                {/* Oxygen Saturation */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-sky-500" /> SpO₂
                    </span>
                    {getTrendIcon(latestVital.oxygenSat, previousVital?.oxygenSat)}
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    {latestVital.oxygenSat}%
                  </div>
                  <div className="mt-2 text-xs">
                    {latestVital.oxygenSat >= 95 ? (
                      <span className="text-emerald-600 font-medium">Adequate O₂</span>
                    ) : (
                      <span className="text-rose-600 font-medium">Hypoxia alert</span>
                    )}
                  </div>
                </div>

                {/* Respiration */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span>Resp Rate</span>
                    {getTrendIcon(latestVital.respRate, previousVital?.respRate)}
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    {latestVital.respRate} <span className="text-xs font-normal text-slate-500">/min</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {latestVital.respRate >= 12 && latestVital.respRate <= 20 ? 'Eupneic' : 'Tachypnea'}
                  </div>
                </div>

                {/* Temperature */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Thermometer className="w-3.5 h-3.5 text-amber-500" /> Temp
                    </span>
                    {getTrendIcon(latestVital.temperatureF, previousVital?.temperatureF)}
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    {latestVital.temperatureF}°F
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {latestVital.temperatureF >= 100.4 ? 'Febrile' : 'Afebrile'}
                  </div>
                </div>

                {/* BMI & Weight */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
                    <span className="flex items-center gap-1">
                      <Gauge className="w-3.5 h-3.5 text-indigo-500" /> BMI
                    </span>
                    {getTrendIcon(latestVital.bmi, previousVital?.bmi)}
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    {latestVital.bmi} <span className="text-xs font-normal text-slate-500">({latestVital.weightLbs} lbs)</span>
                  </div>
                  <div className="mt-2 text-xs font-medium">
                    {latestVital.bmi < 18.5 ? (
                      <span className="text-amber-600">Underweight</span>
                    ) : latestVital.bmi < 25 ? (
                      <span className="text-emerald-600">Normal BMI</span>
                    ) : latestVital.bmi < 30 ? (
                      <span className="text-yellow-600">Overweight</span>
                    ) : (
                      <span className="text-rose-600">Obese Class I+</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center mb-6">
                <Activity className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-600 font-medium">No vitals on record for this patient yet.</p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700"
                >
                  Record Initial Baseline
                </button>
              </div>
            )}

            {/* AI Vitals Trend Summary Panel */}
            <div className="bg-gradient-to-br from-indigo-50 to-white rounded-xl border border-indigo-100 p-5 shadow-sm mb-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">AI Hemodynamic & Cardiovascular Pattern Advisory</h3>
                    <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                      Automated Clinical Intelligence
                    </span>
                  </div>
                  <p className="text-slate-700 text-sm mt-1 leading-relaxed">
                    {latestVital && latestVital.systolic >= 140 ? (
                      <>
                        Patient exhibits <strong>Stage 2 Systolic Hypertension ({latestVital.systolic}/{latestVital.diastolic} mmHg)</strong>.
                        Comparing with prior measurements, systolic pressure has shifted by{' '}
                        {previousVital ? `${(latestVital.systolic - previousVital.systolic > 0 ? '+' : '')}${latestVital.systolic - previousVital.systolic} mmHg` : 'N/A'}.
                        Current medication regimen includes ACEi/ARB therapy. Recommend titration or addition of CCB/Thiazide diuretic if BP remains uncontrolled at two consecutive clinical visits. Screen for microalbuminuria.
                      </>
                    ) : latestVital && latestVital.systolic >= 130 ? (
                      <>
                        Blood pressure is staged at <strong>Stage 1 Hypertension ({latestVital.systolic}/{latestVital.diastolic} mmHg)</strong>.
                        Cardiovascular ASCVD risk score recalculation suggested. Lifestyle interventions (DASH diet, sodium restriction &lt; 2,000 mg/day, aerobic activity) and follow-up in 3 to 6 months advised.
                      </>
                    ) : (
                      <>
                        Hemodynamics are currently stable with blood pressure within goal range (&lt;120/80 mmHg). Resting pulse of {latestVital?.heartRate || 72} bpm demonstrates adequate chronotropic regulation. Continue current somatic preventive regimen.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Historical Flowsheet Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">Historical Biometric Flowsheet</h3>
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
                      <th className="py-3 px-4">Date / Time</th>
                      <th className="py-3 px-4">BP (mmHg)</th>
                      <th className="py-3 px-4">BP Classification</th>
                      <th className="py-3 px-4">Pulse</th>
                      <th className="py-3 px-4">SpO₂</th>
                      <th className="py-3 px-4">RR</th>
                      <th className="py-3 px-4">Temp</th>
                      <th className="py-3 px-4">Weight</th>
                      <th className="py-3 px-4">BMI</th>
                      <th className="py-3 px-4">Clinician</th>
                      <th className="py-3 px-4">Clinical Notes</th>
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
                          <td className="py-3 px-4 font-bold text-slate-900 whitespace-nowrap">
                            {v.systolic}/{v.diastolic}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ring-1 ring-inset ${staging.badgeClass}`}>
                              {staging.stage}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-800">{v.heartRate} bpm</td>
                          <td className="py-3 px-4 text-slate-800">{v.oxygenSat}%</td>
                          <td className="py-3 px-4 text-slate-800">{v.respRate} /min</td>
                          <td className="py-3 px-4 text-slate-800">{v.temperatureF}°F</td>
                          <td className="py-3 px-4 text-slate-800">{v.weightLbs} lbs</td>
                          <td className="py-3 px-4 font-semibold text-slate-900">{v.bmi}</td>
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
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Record Clinical Vitals</h3>
                <p className="text-xs text-slate-500">
                  Patient: {selectedPatient?.name} ({selectedPatient?.mrn})
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
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
                  <div className="text-base font-bold text-slate-900">
                    {systolic}/{diastolic} mmHg
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded text-xs font-bold ring-1 ring-inset ${liveBPStaging.badgeClass}`}>
                  {liveBPStaging.stage}
                </span>
              </div>

              {/* BP Grid */}
              <div className="grid grid-cols-2 gap-4">
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
                    onChange={(e) => setSystolic(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                    onChange={(e) => setDiastolic(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Pulse & SpO2 & RR */}
              <div className="grid grid-cols-3 gap-4">
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
                    onChange={(e) => setHeartRate(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                    onChange={(e) => setOxygenSat(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                    onChange={(e) => setRespRate(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Temp & Height & Weight */}
              <div className="grid grid-cols-3 gap-4">
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
                    onChange={(e) => setTemperatureF(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                    onChange={(e) => setHeightInches(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
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
                    onChange={(e) => setWeightLbs(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Real-time Calculated BMI Callout */}
              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-indigo-900 uppercase">
                    Auto-Calculated Body Mass Index (BMI)
                  </div>
                  <div className="text-xs text-indigo-700">Formula: (weight_lbs / height_in²) × 703</div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-extrabold text-indigo-950">{liveBMI}</span>{' '}
                  <span className="text-xs font-medium text-indigo-700">kg/m²</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Encounter Observation Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={vitalsNotes}
                  onChange={(e) => setVitalsNotes(e.target.value)}
                  placeholder="e.g. Left arm seated with adult cuff, resting 5 minutes prior..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

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
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                >
                  Save Vitals Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
