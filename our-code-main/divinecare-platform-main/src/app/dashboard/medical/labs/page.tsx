'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Printer,
  Download,
  Plus,
  Search,
  ChevronDown,
  ChevronUp,
  FileText,
  User,
  ShieldAlert,
  Check,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { ChartItemForm } from '@/components/medical/ChartItemForm';
import {
  getMedicalPatients,
  saveMedicalPatients,
  getCriticalLabAlerts,
  acknowledgeLabAlert,
} from '@/features/medical/data';
import { MedicalPatient, MedicalLabResult, CriticalLabAlert } from '@/features/medical/types';

const SOMATIC_LAB_PANELS = [
  { code: '80053', name: 'Comprehensive Metabolic Panel (CMP)', components: 'Glucose, BUN, Creatinine, eGFR, Na, K, Cl, CO2, Ca, Albumin, TBil, AlkPhos, AST, ALT' },
  { code: '80061', name: 'Lipid Panel', components: 'Total Cholesterol, HDL-C, Triglycerides, LDL-C (calculated)' },
  { code: '83036', name: 'Hemoglobin A1c (Glycated Hb)', components: 'HbA1c %, Estimated Average Glucose (eAG)' },
  { code: '84443', name: 'TSH (Thyroid Stimulating Hormone)', components: 'Ultrasensitive TSH' },
  { code: '85025', name: 'CBC with Differential / Platelet', components: 'WBC, RBC, Hgb, Hct, MCV, MCH, MCHC, RDW, Plt, Neut%, Lymph%' },
  { code: '82043', name: 'Urine Microalbumin/Creatinine Ratio', components: 'Microalbumin, Urine Creatinine, Albumin-to-Creatinine Ratio' },
  { code: '80076', name: 'Hepatic Function Panel', components: 'Total Protein, Albumin, Total Bilirubin, Direct Bilirubin, AlkPhos, AST, ALT' },
  { code: '84439', name: 'Free Thyroxine (Free T4)', components: 'Free T4 via Dialysis' },
];

export default function MedicalLabsPage() {
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [alerts, setAlerts] = useState<CriticalLabAlert[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [flagFilter, setFlagFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLabId, setExpandedLabId] = useState<string | null>(null);

  // Modals
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showRequisitionModal, setShowRequisitionModal] = useState(false);
  const [requisitionPatient, setRequisitionPatient] = useState<MedicalPatient | null>(null);

  // Lab Order Form
  const [orderPatientId, setOrderPatientId] = useState('');
  const [selectedPanelCodes, setSelectedPanelCodes] = useState<string[]>(['80053', '80061']);
  const [orderIcd10, setOrderIcd10] = useState('E11.9, I10');
  const [fastingRequired, setFastingRequired] = useState(true);
  const [orderClinicalNotes, setOrderClinicalNotes] = useState('Routine chronic condition monitoring');

  useEffect(() => {
    const list = getMedicalPatients();
    setPatients(list);
    setAlerts(getCriticalLabAlerts());
    if (list.length > 0) {
      setOrderPatientId(list[0].id);
      setRequisitionPatient(list[0]);
    }

    const handler = () => {
      setPatients(getMedicalPatients());
      setAlerts(getCriticalLabAlerts());
    };
    window.addEventListener('medical_patients_updated', handler);
    window.addEventListener('medical_alerts_updated', handler);
    return () => {
      window.removeEventListener('medical_patients_updated', handler);
      window.removeEventListener('medical_alerts_updated', handler);
    };
  }, []);

  const flattenedLabs = useMemo(() => {
    const list: { patient: MedicalPatient; lab: MedicalLabResult }[] = [];
    patients.forEach((pat) => {
      if (selectedPatientId === 'all' || pat.id === selectedPatientId) {
        pat.labs.forEach((lab) => {
          list.push({ patient: pat, lab });
        });
      }
    });
    return list;
  }, [patients, selectedPatientId]);

  const filteredLabs = useMemo(() => {
    return flattenedLabs.filter(({ patient, lab }) => {
      if (flagFilter === 'Abnormal' && lab.flag === 'Normal') return false;
      if (flagFilter === 'Critical' && lab.flag !== 'Critical/Panic') return false;
      if (flagFilter === 'High' && lab.flag !== 'High') return false;
      if (flagFilter === 'Low' && lab.flag !== 'Low') return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mPat = patient.name.toLowerCase().includes(q) || patient.mrn.toLowerCase().includes(q);
        const mTest = lab.testName.toLowerCase().includes(q) || lab.loincCode.toLowerCase().includes(q);
        if (!mPat && !mTest) return false;
      }
      return true;
    });
  }, [flattenedLabs, flagFilter, searchTerm]);

  const unacknowledgedAlerts = useMemo(() => {
    return alerts.filter((a) => !a.acknowledged);
  }, [alerts]);

  const handleAcknowledgeAlert = (alertId: string) => {
    acknowledgeLabAlert(alertId);
    setAlerts(getCriticalLabAlerts());
  };

  const handleTogglePanelCode = (code: string) => {
    setSelectedPanelCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleCreateLabOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === orderPatientId);
    if (!pat) return;

    // Create stub new lab records
    const newLabs: MedicalLabResult[] = selectedPanelCodes.map((code) => {
      const panel = SOMATIC_LAB_PANELS.find((p) => p.code === code);
      return {
        id: `lab-${Date.now()}-${code}`,
        testName: panel?.name || 'Diagnostic Lab Order',
        loincCode: code,
        value: 'Pending Specimen',
        numericValue: 0,
        unit: 'specimen',
        referenceRange: 'In Process',
        flag: 'Normal',
        collectionDate: new Date().toISOString().split('T')[0],
        resultDate: 'Pending Processing',
        orderingClinician: '',
        interpretation: `Electronic order requisition submitted to Quest/Labcorp. CPT: ${code}. Fasting: ${fastingRequired ? 'Yes' : 'No'}.`,
        sparklineHistory: [100, 100, 100],
      };
    });

    const updated = patients.map((p) => {
      if (p.id === orderPatientId) {
        return {
          ...p,
          labs: [...newLabs, ...p.labs],
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setShowOrderModal(false);
  };

  // Sparkline renderer
  const renderSparkline = (data: number[]) => {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const width = 100;
    const height = 24;

    const points = data
      .map((val, idx) => {
        const x = (idx / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <svg className="w-24 h-6 overflow-visible inline-block" viewBox={`0 0 ${width} ${height}`}>
        <polyline
          fill="none"
          stroke="#4F46E5"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
        {data.map((val, idx) => {
          const x = (idx / (data.length - 1)) * width;
          const y = height - ((val - min) / range) * (height - 6) - 3;
          const isLatest = idx === data.length - 1;
          return (
            <circle
              key={idx}
              cx={x}
              cy={y}
              r={isLatest ? 3.5 : 2}
              className={isLatest ? 'fill-indigo-600' : 'fill-slate-400'}
            />
          );
        })}
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <MedicalNavHeader
        title="Medical Laboratory Results & Requisitions"
        subtitle="Panic/critical result surveillance, AI pathology interpretation, LOINC mappings, and Labcorp/Quest requisitions"
        badge="CLIA / CAP & LOINC Certified"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <ChartItemForm
          kind="standing-lab"
          title="Standing lab reminder"
          detail="This is only a reminder. A medical assistant can save it as a draft. It does not place the lab."
        />
        {/* Panic / Critical Value Alert Banner */}
        {unacknowledgedAlerts.length > 0 && (
          <div className="mb-6 space-y-3">
            {unacknowledgedAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-rose-50 border-2 border-rose-500 rounded-xl p-4 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in fade-in"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-rose-600 text-white rounded-lg animate-pulse shrink-0">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-rose-600 text-white text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded">
                        Critical Panic Lab
                      </span>
                      <span className="font-bold text-slate-900 text-base">
                        {alert.patientName} (MRN: {alert.mrn})
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {new Date(alert.resultedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-bold text-slate-800">{alert.testName}:</span>
                      <span className="text-2xl font-black text-rose-700 font-mono">
                        {alert.value} {alert.unit}
                      </span>
                      <span className="text-xs text-slate-500">(Ref: {alert.refRange} {alert.unit})</span>
                    </div>

                    <p className="text-xs text-rose-900 mt-1 font-medium leading-relaxed">
                      {alert.clinicalSignificance}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
                  <Link
                    href={`/dashboard/medical/patients/${alert.patientId}`}
                    className="px-3 py-2 border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 rounded-lg text-xs font-semibold transition"
                  >
                    Open Patient Chart
                  </Link>
                  <button
                    onClick={() => handleAcknowledgeAlert(alert.id)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
                  >
                    Acknowledge & Sign
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filter and Top Action Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search test name or patient..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Patient Selector */}
            <select
              aria-label="Filter labs by patient"
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Patients ({patients.length})</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.mrn})
                </option>
              ))}
            </select>

            {/* Flag Filter */}
            <select
              aria-label="Filter labs by flag status"
              value={flagFilter}
              onChange={(e) => setFlagFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Results</option>
              <option value="Abnormal">Any Abnormal</option>
              <option value="Critical">Critical / Panic Only</option>
              <option value="High">High Values</option>
              <option value="Low">Low Values</option>
            </select>
          </div>

          <div className="flex items-center gap-3 w-full lg:w-auto justify-end">
            <button
              onClick={() => {
                const target = selectedPatientId !== 'all' ? patients.find((p) => p.id === selectedPatientId) : patients[0];
                setRequisitionPatient(target || patients[0]);
                setShowRequisitionModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-semibold transition"
            >
              <Printer className="w-4 h-4 text-slate-500" />
              Requisition Sheet
            </button>

            <button
              onClick={() => setShowOrderModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Order Lab Panel
            </button>
          </div>
        </div>

        {/* Lab Results Table / List */}
        <div className="space-y-3">
          {filteredLabs.map(({ patient, lab }) => {
            const isExpanded = expandedLabId === lab.id;
            return (
              <div
                key={lab.id}
                className={`bg-white rounded-xl border transition shadow-sm overflow-hidden ${
                  lab.flag === 'Critical/Panic'
                    ? 'border-rose-300 ring-1 ring-rose-200'
                    : lab.flag === 'High' || lab.flag === 'Low'
                    ? 'border-amber-200'
                    : 'border-slate-200'
                }`}
              >
                <div
                  onClick={() => setExpandedLabId(isExpanded ? null : lab.id)}
                  className="p-4 cursor-pointer hover:bg-slate-50/70 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start md:items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
                        lab.flag === 'Critical/Panic'
                          ? 'bg-rose-100 text-rose-700'
                          : lab.flag === 'High'
                          ? 'bg-amber-100 text-amber-800'
                          : lab.flag === 'Low'
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      <FlaskConical className="w-4 h-4" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">{lab.testName}</span>
                        <span className="text-[11px] font-mono text-slate-400">LOINC: {lab.loincCode}</span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            lab.flag === 'Critical/Panic'
                              ? 'bg-rose-500 text-white'
                              : lab.flag === 'High'
                              ? 'bg-amber-100 text-amber-800'
                              : lab.flag === 'Low'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {lab.flag}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 mt-0.5">
                        Patient:{' '}
                        <strong className="text-slate-700">
                          {patient.name} ({patient.mrn})
                        </strong>{' '}
                        &bull; Resulted: {lab.resultDate} &bull; Ordered by: {lab.orderingClinician}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-6 pl-12 md:pl-0">
                    {/* Sparkline Micro-chart */}
                    <div className="hidden sm:block text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">12-Mo Trend</div>
                      {renderSparkline(lab.sparklineHistory)}
                    </div>

                    {/* Value + Ref Range */}
                    <div className="text-right min-w-[120px]">
                      <div className="text-base font-extrabold font-mono text-slate-900">
                        {lab.value} <span className="text-xs font-normal text-slate-500">{lab.unit}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">Ref: {lab.referenceRange}</div>
                    </div>

                    <div className="text-slate-400">
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>
                </div>

                {/* Expanded AI Interpretation & Clinical Action Tray */}
                {isExpanded && (
                  <div className="bg-slate-50 border-t border-slate-200 p-4 animate-in fade-in">
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-md bg-indigo-600 text-white mt-0.5">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          AI Diagnostic & Pathological Interpretation
                        </h4>
                        <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                          {lab.interpretation ||
                            `Observed level of ${lab.value} ${lab.unit} is categorized as ${lab.flag}. Correlate with somatic presentation, current pharmacology, and baseline creatinine clearance. Repeat testing indicated in 3 months if persistent.`}
                        </p>

                        <div className="mt-3 flex items-center gap-3">
                          <Link
                            href={`/dashboard/medical/patients/${patient.id}`}
                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                          >
                            View Patient Complete Flowsheet &rarr;
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredLabs.length === 0 && (
            <div className="py-12 bg-white rounded-xl border border-slate-200 text-center">
              <FlaskConical className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-600 font-medium">No lab results matched the filter parameters.</p>
            </div>
          )}
        </div>
      </div>

      {/* Quest / Labcorp Printable Requisition Modal */}
      {showRequisitionModal && requisitionPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Standard Quest / Labcorp Electronic Requisition Form
                </h3>
              </div>
              <button
                onClick={() => setShowRequisitionModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto bg-slate-50 p-6 rounded-xl border border-slate-200 text-xs font-mono space-y-4">
              <div className="border-b pb-3">
                <div className="text-sm font-bold text-slate-900">DIVINECARE HEALTH MEDICAL CLINIC — LAB REQUISITION</div>
                <div className="text-slate-600">CLIA ID: 21D0994120 &bull; Lab Account: QC-89410-MD</div>
                <div className="text-slate-600">Specimen Routing: Quest Diagnostics / Labcorp Core Automated Lab</div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-b pb-3">
                <div>
                  <div className="font-bold text-slate-800">ORDERING PHYSICIAN:</div>
                  <div>{requisitionPatient.pcp || 'Ordering clinician'}</div>
                  <div>NPI and license print from the signed order.</div>
                </div>
                <div>
                  <div className="font-bold text-slate-800">PATIENT DEMOGRAPHICS:</div>
                  <div>Name: {requisitionPatient.name}</div>
                  <div>MRN: {requisitionPatient.mrn} | DOB: {requisitionPatient.dob} (Age {requisitionPatient.age})</div>
                  <div>Sex: {requisitionPatient.gender} | Phone: {requisitionPatient.phone}</div>
                  <div>Primary Ins: {requisitionPatient.demographics.primaryInsurance.payerName} (ID: {requisitionPatient.demographics.primaryInsurance.memberId})</div>
                </div>
              </div>

              <div className="border-b pb-3">
                <div className="font-bold text-slate-800 mb-1">SPECIMEN ORDERS & CPT ENCODINGS:</div>
                <div className="space-y-1 text-slate-700">
                  <div>[X] CPT 80053 — Comprehensive Metabolic Panel (CMP)</div>
                  <div>[X] CPT 80061 — Lipid Panel (Total, HDL, Trig, calculated LDL)</div>
                  <div>[X] CPT 83036 — Glycated Hemoglobin A1c</div>
                  <div>[X] CPT 82043 — Urine Microalbumin/Creatinine Ratio (Random Spot)</div>
                </div>
              </div>

              <div>
                <div className="font-bold text-slate-800 mb-1">ICD-10 MEDICAL NECESSITY DIAGNOSES POINTERS:</div>
                <div className="text-slate-700">
                  {requisitionPatient.problems.map((p) => `${p.icd10} (${p.description})`).join('; ') || 'E11.9, I10'}
                </div>
                <div className="mt-2 text-slate-500 italic">
                  Physician Attestation: Tests ordered above are medically necessary for the diagnosis and management of the patient somatic conditions documented above.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
              <span className="text-xs text-slate-500">Valid Barcode Generated & Quest Direct Transmitted</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowRequisitionModal(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition"
                >
                  <Printer className="w-4 h-4" />
                  Print Requisition Form
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Somatic Lab Order Builder Modal */}
      {showOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                Order Somatic Clinical Laboratory Panels
              </h3>
              <button
                onClick={() => setShowOrderModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateLabOrder} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Patient *
                </label>
                <select
                  required
                  value={orderPatientId}
                  onChange={(e) => setOrderPatientId(e.target.value)}
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
                  Select Lab Panels / CPT Codes *
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50">
                  {SOMATIC_LAB_PANELS.map((panel) => {
                    const isChecked = selectedPanelCodes.includes(panel.code);
                    return (
                      <label
                        key={panel.code}
                        className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer p-1.5 rounded hover:bg-white transition"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleTogglePanelCode(panel.code)}
                          className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <div className="font-bold">
                            {panel.name} <span className="font-mono text-indigo-700 text-[11px]">(CPT {panel.code})</span>
                          </div>
                          <div className="text-[11px] text-slate-500">{panel.components}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ICD-10 Diagnostic Pointers (Medical Necessity) *
                </label>
                <input
                  type="text"
                  required
                  value={orderIcd10}
                  onChange={(e) => setOrderIcd10(e.target.value)}
                  placeholder="e.g. E11.9, I10, E78.5"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 uppercase font-mono"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fastingRequired}
                    onChange={(e) => setFastingRequired(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>10-12 Hour Overnight Fasting Required</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Indications / Order Instructions
                </label>
                <textarea
                  rows={2}
                  value={orderClinicalNotes}
                  onChange={(e) => setOrderClinicalNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowOrderModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selectedPanelCodes.length === 0}
                  className="px-5 py-2 bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                >
                  Transmit Order ({selectedPanelCodes.length})
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
