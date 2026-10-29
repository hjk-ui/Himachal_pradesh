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
import { createProblem, fetchMedicalPatients, setProblemCode, updateProblemStatus } from '@/features/medical/api';
import { MedicalPatient, MedicalProblem, SomaticStatus } from '@/features/medical/types';
import { displayAge } from '@/features/medical/format';
import { isMedicalProvider } from '@/features/medical/roles';
import { Icd10CodeInput } from '@/components/clinical/Icd10Picker';
import { buttonClasses } from '@/components/ui';

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
  const [isSaving, setIsSaving] = useState(false);
  const [busyProblemId, setBusyProblemId] = useState<string | null>(null);
  const [codingProblemId, setCodingProblemId] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState('');
  const [formError, setFormError] = useState('');
  const [pageMsg, setPageMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [category, setCategory] = useState<MedicalProblem['category']>('Cardiovascular');
  const [notes, setNotes] = useState('');

  // Scoped RBAC: write access for medical providers (see features/medical/roles.ts)
  const userRole = (user?.role || '').toUpperCase();
  // Same role set the problems API enforces, so the UI never disables what the server allows.
  const canWrite = isMedicalProvider(user?.role);

  const loadPatients = async () => {
    try {
      const list = await fetchMedicalPatients();
      setPatients(list);
      setTargetPatientForAdd((cur) => cur || list[0]?.id || '');
    } catch (err) {
      setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not load patients.' });
    }
  };

  useEffect(() => {
    void loadPatients();
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

  // Panel condition breakdown (unique patients per ICD-10, top 5)
  const panelBreakdown = useMemo(() => {
    const counts: Record<string, { label: string; patients: Set<string> }> = {};
    patients.forEach((pat) => {
      (pat.problems || []).forEach((prob) => {
        // Uncoded ("needs coding") problems are not grouped under a guessed code
        if (prob.status === 'Resolved' || !prob.icd10) return;
        if (!counts[prob.icd10]) counts[prob.icd10] = { label: prob.description, patients: new Set() };
        counts[prob.icd10].patients.add(pat.id);
      });
    });
    return Object.entries(counts)
      .map(([code, v]) => ({ code, label: v.label, count: v.patients.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [patients]);

  // Status badge helper
  const getStatusBadge = (st: SomaticStatus) => {
    switch (st) {
      case 'Chronic':
        return 'bg-blue-50 text-blue-700 ring-blue-200';
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

  const handleResolveProblem = async (patientId: string, problem: MedicalProblem) => {
    if (!canWrite || busyProblemId) return;
    const next: SomaticStatus = problem.status === 'Resolved' ? 'Active' : 'Resolved';
    setBusyProblemId(problem.id);
    setPageMsg(null);
    try {
      await updateProblemStatus(patientId, problem.id, next);
      await loadPatients();
      setPageMsg({
        type: 'success',
        text: `${problem.icd10 || problem.description} ${next === 'Resolved' ? 'marked resolved' : 're-activated'}.`,
      });
    } catch (err) {
      setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not update the problem.' });
    } finally {
      setBusyProblemId(null);
    }
  };

  // Uncoded problem: the provider searches / types the ICD-10-CM code; the server validates it against FY2027
  const handleSetCode = async (patientId: string, problem: MedicalProblem) => {
    if (!canWrite || busyProblemId || !codeDraft.trim()) return;
    setBusyProblemId(problem.id);
    setPageMsg(null);
    try {
      await setProblemCode(patientId, problem.id, codeDraft.trim());
      setCodingProblemId(null);
      setCodeDraft('');
      await loadPatients();
      setPageMsg({ type: 'success', text: `Coded "${problem.description}".` });
    } catch (err) {
      setPageMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not save the code.' });
    } finally {
      setBusyProblemId(null);
    }
  };

  const handleAddProblem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || isSaving) return;

    const targetPat = patients.find((p) => p.id === targetPatientForAdd);
    if (!targetPat) return;

    setIsSaving(true);
    setFormError('');
    try {
      await createProblem(targetPat.id, {
        icd10: icd10.trim().toUpperCase(),
        description: description.trim(),
        onsetDate,
        status,
        category,
        notes: notes.trim() || undefined,
      });
      await loadPatients();
      setShowAddModal(false);
      setPageMsg({ type: 'success', text: `Added ${icd10.trim().toUpperCase()} to the problem list.` });
      setIcd10('');
      setDescription('');
      setNotes('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the problem.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
      <MedicalNavHeader
        title="Somatic Problem List & Comorbidity Engine"
        subtitle="Active ICD-10 somatic problem tracking, resolution archiving, and clinical risk advisory"
        badge="ICD-10-CM Clinical Registry"
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
        {/* RBAC Notice Banner if Read-Only */}
        {!canWrite && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center gap-3 text-amber-900 text-sm">
            <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0" />
            <div>
              <strong className="font-semibold">Read-Only Mode:</strong> Your role ({userRole || 'Staff'}) has read-only access to somatic medical problem lists. Changes can only be made by a physician, nurse practitioner, psychiatrist, or practice director.
            </div>
          </div>
        )}

        {/* Filter Controls Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs mb-6 flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search diagnosis or patient…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Patient Selector */}
            <select
              aria-label="Filter by patient"
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
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
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
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
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
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
              onClick={() => {
                setFormError('');
                setShowAddModal(true);
              }}
              className={buttonClasses({ className: 'shrink-0' })}
            >
              <Plus className="w-4 h-4" />
              Add Problem
            </button>
          )}
        </div>

        {/* Main Grid: Problem Table + AI Comorbidity Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Somatic Problem List Table (2 cols) */}
          <div className="min-w-0 lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 py-4 sm:px-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900">Somatic Diagnoses & Clinical Conditions</h3>
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
                      <th scope="col" className="py-3 px-4">ICD-10 / Condition</th>
                      {selectedPatientId === 'all' && <th scope="col" className="py-3 px-4">Patient</th>}
                      <th scope="col" className="py-3 px-4">Status</th>
                      <th scope="col" className="py-3 px-4">Category</th>
                      <th scope="col" className="py-3 px-4">Onset Date</th>
                      <th scope="col" className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.map(({ patient, problem }) => (
                      <tr key={problem.id} className="hover:bg-slate-50/80 transition group">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {problem.needsCoding || !problem.icd10 ? (
                              <span className="text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                Needs coding
                              </span>
                            ) : (
                              <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                {problem.icd10}
                              </span>
                            )}
                            <span className="font-semibold text-slate-900">{problem.description}</span>
                          </div>
                          {problem.notes && (
                            <p className="text-xs text-slate-500 mt-0.5 italic">{problem.notes}</p>
                          )}
                          {canWrite && (problem.needsCoding || !problem.icd10) ? (
                            codingProblemId === problem.id ? (
                              <div className="mt-1 flex items-center gap-1.5">
                                <Icd10CodeInput
                                  value={codeDraft}
                                  onChange={(c) => setCodeDraft(c)}
                                  context="primary"
                                  clientId={patient.id}
                                  autoFocus
                                  placeholder="ICD-10-CM code or words"
                                  className="w-72 max-w-full"
                                  inputClassName="w-full rounded border border-slate-300 py-0.5 pl-7 pr-2 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSetCode(patient.id, problem)}
                                  disabled={busyProblemId !== null || !codeDraft.trim()}
                                  className={buttonClasses({ size: 'sm' })}
                                >
                                  {busyProblemId === problem.id ? 'Saving…' : 'Save code'}
                                </button>
                                <button type="button" onClick={() => setCodingProblemId(null)} className="text-xs text-slate-500 hover:underline">
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setCodingProblemId(problem.id);
                                  setCodeDraft('');
                                }}
                                className="mt-1 text-xs font-semibold text-blue-600 hover:underline"
                              >
                                Set code
                              </button>
                            )
                          ) : null}
                        </td>
                        {selectedPatientId === 'all' && (
                          <td className="py-3 px-4 whitespace-nowrap">
                            <Link
                              href={`/dashboard/medical/patients/${patient.id}`}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                              {patient.name}
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                            <span className="text-[11px] text-slate-500 font-mono">{patient.mrn}</span>
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
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {canWrite ? (
                            <button
                              onClick={() => void handleResolveProblem(patient.id, problem)}
                              disabled={busyProblemId !== null}
                              className={`text-xs font-medium px-2 py-1 rounded transition border disabled:opacity-50 ${
                                problem.status === 'Resolved'
                                  ? 'border-blue-200 text-blue-700 hover:bg-blue-50'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {busyProblemId === problem.id
                                ? 'Saving…'
                                : problem.status === 'Resolved'
                                  ? 'Re-activate'
                                  : 'Resolve'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 italic">Locked</span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          <Layers className="w-10 h-10 text-slate-500 mx-auto mb-2" />
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
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base">AI Comorbidity Insights</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Automated clinical surveillance evaluating multi-condition cardiovascular, renal, and metabolic triad risks.
              </p>

              <div className="space-y-3">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    No comorbidity insights yet. Advisories will appear as patient problem lists are documented.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Stats Panel */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <h4 className="font-semibold text-sm text-slate-900 mb-3">Panel Condition Breakdown</h4>
              <div className="space-y-2 text-xs">
                {panelBreakdown.length === 0 && (
                  <p className="py-2 text-slate-500">No conditions documented yet.</p>
                )}
                {panelBreakdown.map((row, idx) => (
                  <div
                    key={row.code}
                    className={`flex items-center justify-between py-1 ${idx < panelBreakdown.length - 1 ? 'border-b border-slate-100' : ''}`}
                  >
                    <span className="text-slate-600">
                      {row.label} ({row.code})
                    </span>
                    <span className="font-semibold text-slate-900">
                      {row.count} patient{row.count === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Problem Modal */}
      {showAddModal && canWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-xl w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Add Somatic Problem / Condition</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mrn}) — Age {displayAge(p)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ICD-10 Code *
                  </label>
                  <Icd10CodeInput
                    value={icd10}
                    onChange={(c, picked) => {
                      setIcd10(c);
                      if (picked) setDescription(picked.description);
                    }}
                    context="primary"
                    placeholder="I10 or hypertension"
                    ariaLabel="ICD-10 code"
                    inputClassName="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Organ Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Status *
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SomaticStatus)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Chronic">Chronic</option>
                    <option value="Active">Active</option>
                    <option value="Acute">Acute</option>
                    <option value="Monitoring">Monitoring</option>
                    <option value="Resolved">Resolved</option>
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
                  placeholder="e.g. Diagnosed at primary care visit; initiating ACEi therapy…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
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
                  disabled={isSaving}
                  className={buttonClasses()}
                >
                  {isSaving ? 'Saving…' : 'Save Problem'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
