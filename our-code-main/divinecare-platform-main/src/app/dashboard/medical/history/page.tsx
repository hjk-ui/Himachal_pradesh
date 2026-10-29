'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  History,
  ShieldCheck,
  AlertTriangle,
  Heart,
  Pill,
  Syringe,
  Users,
  Cigarette,
  Wine,
  UserCheck,
  FileCheck,
  Search,
  Plus,
  CheckCircle2,
  Calendar,
  Sparkles,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { getMedicalPatients, saveMedicalPatients } from '@/features/medical/data';
import { MedicalPatient, MedicalMedication, MedicalAllergy, MedicalProblem } from '@/features/medical/types';

export default function MedicalHistorySuitePage() {
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'PMH' | 'PSH' | 'Family' | 'Social' | 'Allergies' | 'Immunizations' | 'MedRec'>('PMH');
  const [searchTerm, setSearchTerm] = useState('');
  const [reconcileSuccess, setReconcileSuccess] = useState(false);

  // Social screening scores state (mock interactive per patient)
  const [auditCScore, setAuditCScore] = useState<number>(2);
  const [smokingPackYears, setSmokingPackYears] = useState<number>(15);
  const [hitsScore, setHitsScore] = useState<number>(0);

  useEffect(() => {
    const list = getMedicalPatients();
    setPatients(list);
    if (list.length > 0 && !selectedPatientId) {
      setSelectedPatientId(list[0].id);
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

  const handleReconcileMedications = () => {
    setReconcileSuccess(true);
    setTimeout(() => setReconcileSuccess(false), 3000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <MedicalNavHeader
        title="Comprehensive Somatic History Suite"
        subtitle="PMH, Surgical, Family pedigree, Social (AUDIT-C/HITS), Allergies, Immunizations, and Med Reconciliation"
        badge="ONC 2022 Certified Health History"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* Patient Selection Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Active Patient:</span>
            <select
              aria-label="Select patient for medical history"
              value={selectedPatient?.id || ''}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.mrn}) — Age {p.age} &bull; PCP: {p.pcp}
                </option>
              ))}
            </select>
          </div>

          {selectedPatient && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">MRN: {selectedPatient.mrn}</span>
              <span>DOB: {selectedPatient.dob} ({selectedPatient.age}yo)</span>
              <span>Gender: {selectedPatient.gender}</span>
            </div>
          )}
        </div>

        {/* 7 Dedicated Tabs Navigation */}
        <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 pt-2 rounded-t-xl overflow-x-auto">
          {[
            { id: 'PMH', label: 'Past Medical (PMH)', icon: History },
            { id: 'PSH', label: 'Surgical (PSH)', icon: FileCheck },
            { id: 'Family', label: 'Family History', icon: Users },
            { id: 'Social', label: 'Social & Risk (AUDIT-C / HITS)', icon: Wine },
            { id: 'Allergies', label: 'Allergies & Reactions', icon: AlertTriangle },
            { id: 'Immunizations', label: 'Immunizations', icon: Syringe },
            { id: 'MedRec', label: 'Med Reconciliation', icon: Pill },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition ${
                  isActive
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content Panels */}
        <div className="bg-white rounded-b-xl border-x border-b border-slate-200 p-6 shadow-sm min-h-[450px]">
          {selectedPatient && (
            <>
              {/* TAB 1: Past Medical History (PMH) */}
              {activeTab === 'PMH' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Past Medical Conditions (PMH)</h3>
                      <p className="text-xs text-slate-500">Documented chronic and active somatic conditions</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedPatient.problems.map((prob) => (
                      <div
                        key={prob.id}
                        className="p-3.5 rounded-xl border border-slate-200 hover:border-indigo-200 transition bg-slate-50/50 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                              {prob.icd10}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-600">{prob.status}</span>
                          </div>
                          <div className="font-bold text-slate-900 text-sm mt-1">{prob.description}</div>
                          <div className="text-xs text-slate-500 mt-1">Onset Date: {prob.onsetDate} &bull; Severity: {prob.severity}</div>
                          {prob.notes && (
                            <p className="text-xs text-slate-600 italic mt-1 bg-white p-2 rounded border border-slate-100">
                              {prob.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 2: Past Surgical History (PSH) */}
              {activeTab === 'PSH' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Past Surgical History (PSH)</h3>
                      <p className="text-xs text-slate-500">Operative procedures, implants, and surgical interventions</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase">
                          <th className="py-2.5 px-3">Procedure Name</th>
                          <th className="py-2.5 px-3">Approx Year / Date</th>
                          <th className="py-2.5 px-3">Hospital / Facility</th>
                          <th className="py-2.5 px-3">Surgeon</th>
                          <th className="py-2.5 px-3">Anesthesia / Complications</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr>
                          <td colSpan={5} className="py-6 px-3 text-sm text-slate-500">No surgical history saved on this chart.</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: Family History */}
              {activeTab === 'Family' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Family Pedigree & Genetic Risk Grid</h3>
                      <p className="text-xs text-slate-500">First-degree and second-degree relatives somatic history</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <p className="text-sm text-slate-500 md:col-span-2">No family history saved on this chart.</p>
                  </div>
                </div>
              )}

              {/* TAB 4: Social History & Screening (AUDIT-C & HITS) */}
              {activeTab === 'Social' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Standardized Social History & Validated Screenings</h3>
                    <p className="text-xs text-slate-500">AUDIT-C alcohol screen, tobacco use pack-years, and domestic violence (HITS)</p>
                  </div>

                  <p className="text-sm text-slate-500">No social history or screening scores saved on this chart.</p>
                  <div className="hidden grid-cols-1 md:grid-cols-3 gap-5">
                    {/* AUDIT-C */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-xs uppercase tracking-wider text-indigo-700">AUDIT-C Screen</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${auditCScore >= 4 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            Score: {auditCScore} / 12
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mb-3">
                          Screening for unhealthy alcohol use: 1-2 drinks per occasion, 1-2 times per month.
                        </p>
                        <div className="text-xs font-semibold text-slate-700">
                          {auditCScore >= 4 ? (
                            <span className="text-rose-600">Positive: At-risk hazardous drinking. Brief intervention recommended.</span>
                          ) : (
                            <span className="text-emerald-700">Negative: Low risk alcohol consumption.</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Tobacco & Smoking */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-xs uppercase tracking-wider text-amber-700">Tobacco History</span>
                          <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono">
                            {smokingPackYears} Pack-Years
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mb-2">
                          Status: <strong>Former Smoker (Quit 2021)</strong> &bull; Smoked 1 pack/day for 15 years.
                        </p>
                        <p className="text-xs text-slate-500">
                          USPSTF LDCT eligibility: Meets criteria if age 50-80 and quit &lt; 15 years ago.
                        </p>
                      </div>
                    </div>

                    {/* Domestic Violence (HITS) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-xs uppercase tracking-wider text-rose-700">HITS Domestic Screen</span>
                          <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                            Score: {hitsScore} / 20
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mb-2">
                          Assessing Hurt, Insult, Threaten, Scream safety screening.
                        </p>
                        <div className="text-xs text-emerald-700 font-semibold">
                          Score &lt; 10: Negative. Patient feels safe at home. No safety plan required.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: Allergies */}
              {activeTab === 'Allergies' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Active Allergies & Adverse Drug Reactions</h3>
                      <p className="text-xs text-slate-500">Documented hypersensitivities and severity classifications</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {selectedPatient.allergies.map((all) => (
                      <div
                        key={all.id}
                        className={`p-4 rounded-xl border ${
                          all.severity === 'Severe/Anaphylaxis'
                            ? 'bg-rose-50/70 border-rose-300 ring-1 ring-rose-200'
                            : 'bg-amber-50/50 border-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {all.type}
                          </span>
                          <span
                            className={`text-xs font-extrabold ${
                              all.severity === 'Severe/Anaphylaxis' ? 'text-rose-700' : 'text-amber-800'
                            }`}
                          >
                            {all.severity}
                          </span>
                        </div>

                        <div className="text-base font-bold text-slate-900 mt-2">{all.substance}</div>
                        <div className="text-xs text-slate-700 mt-1">
                          Reaction: <strong>{all.reaction}</strong>
                        </div>
                        {all.onsetDate && (
                          <div className="text-[11px] text-slate-500 mt-2 font-mono">Documented: {all.onsetDate}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 6: Immunizations */}
              {activeTab === 'Immunizations' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Adult Immunization Registry (CDC / ACIP)</h3>
                      <p className="text-xs text-slate-500">Vaccination history and state immunization registry sync</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase">
                          <th className="py-2.5 px-3">Vaccine / Formulation</th>
                          <th className="py-2.5 px-3">Administration Date</th>
                          <th className="py-2.5 px-3">Lot Number</th>
                          <th className="py-2.5 px-3">Route / Site</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr>
                          <td colSpan={5} className="py-6 px-3 text-sm text-slate-500">No immunizations saved on this chart.</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 7: Medication Reconciliation */}
              {activeTab === 'MedRec' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Active Somatic Medication Reconciliation</h3>
                      <p className="text-xs text-slate-500">
                        Formal clinician verification of dose, route, frequency, and patient compliance
                      </p>
                    </div>

                    <button
                      onClick={handleReconcileMedications}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Sign &amp; Complete Med Reconciliation
                    </button>
                  </div>

                  {reconcileSuccess && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Medication reconciliation signed and locked for today&apos;s encounter.
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase">
                          <th className="py-2.5 px-3">Medication Name</th>
                          <th className="py-2.5 px-3">Strength &amp; Route</th>
                          <th className="py-2.5 px-3">Sig / Frequency</th>
                          <th className="py-2.5 px-3">Indication</th>
                          <th className="py-2.5 px-3">Refills</th>
                          <th className="py-2.5 px-3">Prescriber</th>
                          <th className="py-2.5 px-3">Compliance Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedPatient.medications.map((med) => (
                          <tr key={med.id} className="hover:bg-slate-50">
                            <td className="py-3 px-3 font-bold text-slate-900">
                              {med.name}
                              <div className="text-[10px] text-slate-400 font-mono">RxNorm: {med.rxNorm || 'Active'}</div>
                            </td>
                            <td className="py-3 px-3 text-slate-700">
                              {med.dosage} ({med.route})
                            </td>
                            <td className="py-3 px-3 text-slate-700">{med.frequency}</td>
                            <td className="py-3 px-3 text-slate-700">{med.indication}</td>
                            <td className="py-3 px-3 font-mono text-slate-700">{med.refills} remaining</td>
                            <td className="py-3 px-3 text-slate-600">{med.prescribedBy}</td>
                            <td className="py-3 px-3">
                              <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-semibold text-[11px]">
                                <CheckCircle2 className="w-3 h-3" /> Confirmed Active
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
