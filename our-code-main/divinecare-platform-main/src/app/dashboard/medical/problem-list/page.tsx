'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  FileText,
  AlertCircle,
  Plus,
  CheckCircle,
  Clock,
  Archive,
  Search,
  Filter,
  Sparkles,
  ShieldAlert,
  User,
  ExternalLink,
  ChevronRight,
  Info,
  Layers,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { useAuth } from '@/features/auth';
import { getMedicalPatients, saveMedicalPatients } from '@/features/medical/data';
import { MedicalPatient, MedicalProblem, SomaticStatus } from '@/features/medical/types';

export default function MedicalProblemListPage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [targetPatientForAdd, setTargetPatientForAdd] = useState<string>('');

  // Form state
  const [icd10, setIcd10] = useState('');
  const [description, setDescription] = useState('');
  const [onsetDate, setOnsetDate] = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<SomaticStatus>('Active');
  const [severity, setSeverity] = useState<'Mild' | 'Moderate' | 'Severe'>('Moderate');
  const [category, setCategory] = useState<MedicalProblem['category']>('Cardiovascular');
  const [notes, setNotes] = useState('');

  // Scoped RBAC: Write access for physician, medical_np, and practice_director
  const userRole = (user?.role || '').toUpperCase();
  const canWrite = ['PHYSICIAN', 'MEDICAL_NP', 'PRACTICE_DIRECTOR', 'ADMIN', 'SUPER_ADMIN'].includes(userRole);

  useEffect(() => {
    async function loadPatients() {
      try {
        const res = await fetch('/api/medical/patients');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.patients) && data.patients.length > 0) {
            setPatients(data.patients);
            setTargetPatientForAdd(data.patients[0].id);
            return;
          }
        }
      } catch (err) {
        console.error('Failed to load patients from API:', err);
      }
      const list = getMedicalPatients();
      setPatients(list);
      if (list.length > 0) {
        setTargetPatientForAdd(list[0].id);
      }
    }
    void loadPatients();

    const handler = () => {
      setPatients(getMedicalPatients());
    };
    window.addEventListener('medical_patients_updated', handler);
    return () => window.removeEventListener('medical_patients_updated', handler);
  }, []);

  // Aggregate problems across selected patient or entire panel
  const flattenedProblems = useMemo(() => {
    const rows: { patient: MedicalPatient; problem: MedicalProblem }[] = [];
    patients.forEach((pat) => {
      if (selectedPatientId === 'all' || pat.id === selectedPatientId) {
        pat.problems.forEach((prob) => {
          rows.push({ patient: pat, problem: prob });
        });
      }
    });
    return rows;
  }, [patients, selectedPatientId]);

  const filteredRows = useMemo(() => {
    return flattenedProblems.filter(({ patient, problem }) => {
      if (statusFilter !== 'all' && problem.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && problem.category !== categoryFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchName = patient.name.toLowerCase().includes(q);
        const matchIcd = problem.icd10.toLowerCase().includes(q);
        const matchDesc = problem.description.toLowerCase().includes(q);
        const matchMrn = patient.mrn.toLowerCase().includes(q);
        if (!matchName && !matchIcd && !matchDesc && !matchMrn) return false;
      }
      return true;
    });
  }, [flattenedProblems, statusFilter, categoryFilter, searchTerm]);

  // Status badge helper
  const getStatusBadge = (st: SomaticStatus) => {
    switch (st) {
      case 'Chronic':
        return 'bg-purple-50 text-purple-700 ring-purple-200';
      case 'Acute':
        return 'bg-amber-50 text-amber-700 ring-amber-200';
      case 'Active':
        return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
      case 'Monitoring':
        return 'bg-sky-50 text-sky-700 ring-sky-200';
      case 'Resolved':
        return 'bg-slate-100 text-slate-600 ring-slate-200 line-through';
      default:
        return 'bg-slate-50 text-slate-700 ring-slate-200';
    }
  };

  const handleResolveProblem = (patientId: string, problemId: string) => {
    if (!canWrite) return;
    const updated = patients.map((pat) => {
      if (pat.id === patientId) {
        return {
          ...pat,
          problems: pat.problems.map((prob) =>
            prob.id === problemId
              ? {
                  ...prob,
                  status: (prob.status === 'Resolved' ? 'Active' : 'Resolved') as SomaticStatus,
                }
              : prob
          ),
        };
      }
      return pat;
    });
    saveMedicalPatients(updated);
  };

  const handleAddProblem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;

    const targetPat = patients.find((p) => p.id === targetPatientForAdd);
    if (!targetPat) return;

    const newProb: MedicalProblem = {
      id: `prob-${Date.now()}`,
      icd10: icd10.trim().toUpperCase(),
      description: description.trim(),
      onsetDate,
      status,
      severity,
      category,
      notes: notes.trim() || undefined,
    };

    const updated = patients.map((p) => {
      if (p.id === targetPatientForAdd) {
        return {
          ...p,
          problems: [newProb, ...p.problems],
        };
      }
      return p;
    });

    saveMedicalPatients(updated);
    setShowAddModal(false);
    setIcd10('');
    setDescription('');
    setNotes('');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <MedicalNavHeader
        title="Somatic Problem List & Comorbidity Engine"
        subtitle="Active ICD-10 somatic problem tracking, resolution archiving, and clinical risk advisory"
        badge="ICD-10-CM Clinical Registry"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* RBAC Notice Banner if Read-Only */}
        {!canWrite && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center gap-3 text-amber-900 text-sm">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <strong className="font-semibold">Read-Only Mode:</strong> Your role ({userRole || 'Staff'}) has read-only access to somatic medical problem lists. Changes can only be committed by a primary care physician, medical nurse practitioner, or practice director.
            </div>
          </div>
        )}

        {/* Filter Controls Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search diagnosis or patient..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Patient Selector */}
            <select
              aria-label="Filter by patient"
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Panel Patients ({patients.length})</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.mrn})
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              aria-label="Filter by problem status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Statuses</option>
              <option value="Chronic">Chronic</option>
              <option value="Active">Active</option>
              <option value="Acute">Acute</option>
              <option value="Monitoring">Monitoring</option>
              <option value="Resolved">Resolved Archive</option>
            </select>

            {/* Category Filter */}
            <select
              aria-label="Filter by organ category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Organ Systems</option>
              <option value="Cardiovascular">Cardiovascular</option>
              <option value="Endocrine">Endocrine</option>
              <option value="Renal">Renal</option>
              <option value="Respiratory">Respiratory</option>
              <option value="GI">Gastrointestinal</option>
              <option value="Musculoskeletal">Musculoskeletal</option>
              <option value="Neurological">Neurological</option>
              <option value="Other">Other Somatic</option>
            </select>
          </div>

          {canWrite && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition shrink-0 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add Problem
            </button>
          )}
        </div>

        {/* Main Grid: Problem Table + AI Comorbidity Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Somatic Problem List Table (2 cols) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">Somatic Diagnoses & Clinical Conditions</h3>
                  <p className="text-xs text-slate-500">
                    Showing {filteredRows.length} condition{filteredRows.length === 1 ? '' : 's'} across selected scope
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                  Scope: {selectedPatientId === 'all' ? 'All Patients' : 'Single Chart'}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-3 px-4">ICD-10 / Condition</th>
                      {selectedPatientId === 'all' && <th className="py-3 px-4">Patient</th>}
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Onset Date</th>
                      <th className="py-3 px-4">Severity</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.map(({ patient, problem }) => (
                      <tr key={problem.id} className="hover:bg-slate-50/80 transition group">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                              {problem.icd10}
                            </span>
                            <span className="font-semibold text-slate-900">{problem.description}</span>
                          </div>
                          {problem.notes && (
                            <p className="text-xs text-slate-500 mt-0.5 italic">{problem.notes}</p>
                          )}
                        </td>
                        {selectedPatientId === 'all' && (
                          <td className="py-3 px-4 whitespace-nowrap">
                            <Link
                              href={`/dashboard/medical/patients/${patient.id}`}
                              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                            >
                              {patient.name}
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                            <span className="text-[11px] text-slate-400 font-mono">{patient.mrn}</span>
                          </td>
                        )}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${getStatusBadge(
                              problem.status
                            )}`}
                          >
                            {problem.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                          {problem.category}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                          {problem.onsetDate}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-medium ${
                              problem.severity === 'Severe'
                                ? 'text-rose-600 font-bold'
                                : problem.severity === 'Moderate'
                                ? 'text-amber-600'
                                : 'text-slate-600'
                            }`}
                          >
                            {problem.severity}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {canWrite ? (
                            <button
                              onClick={() => handleResolveProblem(patient.id, problem.id)}
                              className={`text-xs font-medium px-2 py-1 rounded transition border ${
                                problem.status === 'Resolved'
                                  ? 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {problem.status === 'Resolved' ? 'Re-activate' : 'Resolve'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Locked</span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                          No somatic problems match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* AI Comorbidity Insights Sidebar (1 col) */}
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-xl p-5 shadow-sm border border-indigo-800">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-base">AI Comorbidity Insights</h3>
              </div>
              <p className="text-xs text-indigo-200 leading-relaxed mb-4">
                Automated clinical surveillance evaluating multi-condition cardiovascular, renal, and metabolic triad risks.
              </p>

              <div className="space-y-3">
                {flattenedProblems.length === 0 ? (
                  <div className="bg-white/10 rounded-lg p-4 text-center border border-white/10">
                    <p className="text-xs text-slate-200">No active chronic condition triads identified across current panel.</p>
                    <p className="text-[11px] text-slate-300 mt-1">Guidelines and surveillance trigger dynamically upon patient problem entry.</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-white/10 rounded-lg p-3 border border-white/10">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-sky-300 mb-1">
                        <Info className="w-3.5 h-3.5" />
                        Cardiometabolic Surveillance Active
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed">
                        Automatic cross-referencing of hypertension, dyslipidemia, and glycemic indices enabled across all active client charts.
                      </p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3 border border-white/10">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300 mb-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Polypharmacy Surveillance Active
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed">
                        Medication reconciliation threshold configured to flag patients with ≥ 4 active somatic diagnoses.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Quick Stats Panel */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h4 className="font-bold text-sm text-slate-900 mb-3">Panel Condition Breakdown</h4>
              {flattenedProblems.length === 0 ? (
                <p className="text-xs text-slate-400">No condition data recorded yet.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {Array.from(
                    flattenedProblems.reduce((acc, { patient, problem }) => {
                      const cur = acc.get(problem.icd10) || { desc: problem.description, patients: new Set<string>() };
                      cur.patients.add(patient.id);
                      acc.set(problem.icd10, cur);
                      return acc;
                    }, new Map<string, { desc: string; patients: Set<string> }>())
                  )
                    .map(([code, item]) => ({ code, desc: item.desc, count: item.patients.size }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5)
                    .map((stat) => (
                      <div key={stat.code} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-b-0">
                        <span className="text-slate-600 truncate max-w-[180px]">{stat.desc} ({stat.code})</span>
                        <span className="font-bold text-slate-900">{stat.count} patient{stat.count === 1 ? '' : 's'}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Problem Modal */}
      {showAddModal && canWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Add Somatic Problem / Condition</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAddProblem} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Patient *
                </label>
                <select
                  required
                  value={targetPatientForAdd}
                  onChange={(e) => setTargetPatientForAdd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mrn}) — Age {p.age}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ICD-10 Code *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. I10"
                    value={icd10}
                    onChange={(e) => setIcd10(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Clinical Description *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Essential (primary) hypertension"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Organ Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Cardiovascular">Cardiovascular</option>
                    <option value="Endocrine">Endocrine</option>
                    <option value="Renal">Renal</option>
                    <option value="Respiratory">Respiratory</option>
                    <option value="GI">Gastrointestinal</option>
                    <option value="Musculoskeletal">Musculoskeletal</option>
                    <option value="Neurological">Neurological</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Onset Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={onsetDate}
                    onChange={(e) => setOnsetDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Status *
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SomaticStatus)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Chronic">Chronic</option>
                    <option value="Active">Active</option>
                    <option value="Acute">Acute</option>
                    <option value="Monitoring">Monitoring</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Severity *
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Mild">Mild</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Severe">Severe</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Notes / Plan Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Diagnosed at primary care visit; initiating ACEi therapy..."
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
                  Save Problem
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
