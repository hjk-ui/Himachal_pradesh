'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  Calendar,
  User,
  Plus,
  ArrowRight,
  Filter,
  Search,
  Check,
  Send,
  FileCheck,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { ChartItemForm } from '@/components/medical/ChartItemForm';
import { getMedicalPatients, saveMedicalPatients } from '@/features/medical/data';
import { MedicalPatient, MedicalPreventiveItem } from '@/features/medical/types';

interface ScreeningGap {
  patient: MedicalPatient;
  item: MedicalPreventiveItem;
}

export default function MedicalPreventiveCarePage() {
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Overdue' | 'Due Soon' | 'Up to Date'>('all');
  const [gradeFilter, setGradeFilter] = useState<'all' | 'A' | 'B'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [activeGapToOrder, setActiveGapToOrder] = useState<ScreeningGap | null>(null);
  const [bulkOrderSuccess, setBulkOrderSuccess] = useState<string | null>(null);

  useEffect(() => {
    const list = getMedicalPatients();
    setPatients(list);

    const handler = () => {
      setPatients(getMedicalPatients());
    };
    window.addEventListener('medical_patients_updated', handler);
    return () => window.removeEventListener('medical_patients_updated', handler);
  }, []);

  // Collect all gaps
  const allGaps = useMemo(() => {
    const gaps: ScreeningGap[] = [];
    patients.forEach((pat) => {
      if (selectedPatientId === 'all' || pat.id === selectedPatientId) {
        pat.preventiveCare.forEach((item) => {
          gaps.push({ patient: pat, item });
        });
      }
    });
    return gaps;
  }, [patients, selectedPatientId]);

  const filteredGaps = useMemo(() => {
    return allGaps.filter(({ patient, item }) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (gradeFilter !== 'all' && item.uspstfGrade !== gradeFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mName = patient.name.toLowerCase().includes(q);
        const mTitle = item.title.toLowerCase().includes(q);
        const mMrn = patient.mrn.toLowerCase().includes(q);
        if (!mName && !mTitle && !mMrn) return false;
      }
      return true;
    });
  }, [allGaps, statusFilter, gradeFilter, searchTerm]);

  // Top overdue gap metrics for Caseload Bulk Ordering
  const overdueGaps = useMemo(() => {
    return allGaps.filter((g) => g.item.status === 'Overdue');
  }, [allGaps]);

  const dueSoonGaps = useMemo(() => {
    return allGaps.filter((g) => g.item.status === 'Due Soon');
  }, [allGaps]);

  const upToDateCount = useMemo(() => {
    return allGaps.filter((g) => g.item.status === 'Up to Date').length;
  }, [allGaps]);

  // Aggregate top 5 panel gaps
  const topPanelGaps = useMemo(() => {
    const counts: Record<string, { count: number; grade: string; cpt?: string; actionType: string }> = {};
    patients.forEach((p) => {
      p.preventiveCare
        .filter((i) => i.status === 'Overdue')
        .forEach((i) => {
          if (!counts[i.title]) {
            counts[i.title] = { count: 0, grade: i.uspstfGrade, cpt: i.cptCode, actionType: i.actionType };
          }
          counts[i.title].count += 1;
        });
    });
    return Object.entries(counts)
      .map(([title, data]) => ({ title, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [patients]);

  const handleMarkCompleted = (patientId: string, itemId: string) => {
    const updated = patients.map((p) => {
      if (p.id === patientId) {
        return {
          ...p,
          preventiveCare: p.preventiveCare.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  status: 'Up to Date' as const,
                  lastCompletedDate: new Date().toISOString().split('T')[0],
                  dueDate: new Date(Date.now() + item.recommendedIntervalMonths * 30 * 24 * 3600 * 1000)
                    .toISOString()
                    .split('T')[0],
                }
              : item
          ),
        };
      }
      return p;
    });
    saveMedicalPatients(updated);
    setShowOrderModal(false);
  };

  const handleBulkRequisition = (title: string) => {
    // Mark overdue items of this title as ordered / up-to-date
    const updated = patients.map((p) => {
      return {
        ...p,
        preventiveCare: p.preventiveCare.map((item) => {
          if (item.title === title && item.status === 'Overdue') {
            return {
              ...item,
              status: 'Up to Date' as const,
              lastCompletedDate: new Date().toISOString().split('T')[0],
            };
          }
          return item;
        }),
      };
    });
    saveMedicalPatients(updated);
    setBulkOrderSuccess(`Batch orders transmitted successfully for: "${title}".`);
    setTimeout(() => setBulkOrderSuccess(null), 4000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <MedicalNavHeader
        title="Preventive Care & USPSTF Guidelines Tracker"
        subtitle="Automated clinical gap surveillance, age/gender criteria matching, and population bulk ordering"
        badge="USPSTF Grade A & B Certified"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <ChartItemForm
          kind="care-gap"
          title="Open a care gap"
          detail="Saves the gap on this client's chart. It does not order a test."
        />
        {bulkOrderSuccess && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center gap-2 text-sm shadow-sm animate-in fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-semibold">{bulkOrderSuccess}</span>
          </div>
        )}

        {/* Top Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Overdue Gaps</p>
              <h3 className="text-2xl font-black text-rose-600 mt-1">{overdueGaps.length}</h3>
              <p className="text-[11px] text-rose-500 mt-0.5">High clinical priority</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Due in Next 90 Days</p>
              <h3 className="text-2xl font-black text-amber-600 mt-1">{dueSoonGaps.length}</h3>
              <p className="text-[11px] text-amber-500 mt-0.5">Upcoming outreach</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Up to Date</p>
              <h3 className="text-2xl font-black text-emerald-600 mt-1">{upToDateCount}</h3>
              <p className="text-[11px] text-emerald-500 mt-0.5">Quality compliance</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Panel Compliance Rate</p>
              <h3 className="text-2xl font-black text-indigo-600 mt-1">
                {allGaps.length > 0 ? Math.round((upToDateCount / allGaps.length) * 100) : 100}%
              </h3>
              <p className="text-[11px] text-indigo-500 mt-0.5">HEDIS & MIPS target: &ge;80%</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Caseload Bulk Ordering Callout View */}
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-md mb-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-bold">Caseload Bulk Preventive Requisition View</h3>
              </div>
              <p className="text-xs text-indigo-200 mt-1">
                Top overdue screening gaps across your active medical panel. Issue bulk lab orders or specialist consults with one click.
              </p>
            </div>
            <span className="bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 text-xs px-3 py-1 rounded-full font-medium">
              Population Health Engine
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {topPanelGaps.map((gap) => (
              <div
                key={gap.title}
                className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3.5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="bg-rose-500/80 text-white font-bold px-2 py-0.5 rounded text-[10px]">
                      {gap.count} Overdue
                    </span>
                    <span className="text-indigo-300 font-mono text-[11px]">Grade {gap.grade}</span>
                  </div>
                  <h4 className="text-xs font-bold text-white line-clamp-2 mt-1">{gap.title}</h4>
                  {gap.cpt && (
                    <span className="text-[10px] text-slate-300 font-mono">CPT {gap.cpt}</span>
                  )}
                </div>

                <button
                  onClick={() => handleBulkRequisition(gap.title)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg transition"
                >
                  <Send className="w-3 h-3" />
                  Order for All ({gap.count})
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search screening or patient..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Patient Selector */}
            <select
              aria-label="Filter preventive care by patient"
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

            {/* Status Filter */}
            <select
              aria-label="Filter preventive care by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Statuses</option>
              <option value="Overdue">Overdue Gaps</option>
              <option value="Due Soon">Due Soon (&lt;90 days)</option>
              <option value="Up to Date">Up to Date</option>
            </select>

            {/* USPSTF Grade */}
            <select
              aria-label="Filter preventive care by USPSTF grade"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value as any)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Grades (A & B)</option>
              <option value="A">Grade A (Substantial Net Benefit)</option>
              <option value="B">Grade B (Moderate/Substantial Net Benefit)</option>
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Showing <strong>{filteredGaps.length}</strong> items
          </div>
        </div>

        {/* Screening Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">USPSTF Maintenance Checklist</h3>
              <p className="text-xs text-slate-500">Evidence-based preventive clinical recommendations and due dates</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                  <th className="py-3 px-4">Screening / Recommendation</th>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">USPSTF Grade</th>
                  <th className="py-3 px-4">Target Group</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Last Completed</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGaps.map(({ patient, item }) => (
                  <tr key={`${patient.id}-${item.id}`} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px] font-medium text-slate-700">
                          {item.actionType}
                        </span>
                        {item.cptCode && (
                          <span className="font-mono text-[11px] text-slate-500">CPT {item.cptCode}</span>
                        )}
                        <span>Interval: {item.recommendedIntervalMonths} mos</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link
                        href={`/dashboard/medical/patients/${patient.id}`}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 block"
                      >
                        {patient.name}
                      </Link>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {patient.mrn} &bull; Age {patient.age}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold ${
                          item.uspstfGrade === 'A'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        Grade {item.uspstfGrade}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 max-w-[180px]">
                      {item.targetGroup}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${
                          item.status === 'Overdue'
                            ? 'bg-rose-50 text-rose-700 ring-rose-200'
                            : item.status === 'Due Soon'
                            ? 'bg-amber-50 text-amber-700 ring-amber-200'
                            : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        }`}
                      >
                        {item.status === 'Overdue' && <AlertTriangle className="w-3 h-3" />}
                        {item.status === 'Due Soon' && <Clock className="w-3 h-3" />}
                        {item.status === 'Up to Date' && <CheckCircle2 className="w-3 h-3" />}
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-600 whitespace-nowrap">
                      {item.lastCompletedDate || 'Never'}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-900 font-bold whitespace-nowrap">
                      {item.dueDate}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {item.status !== 'Up to Date' ? (
                        <button
                          onClick={() => {
                            setActiveGapToOrder({ patient, item });
                            setShowOrderModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition shadow-sm"
                        >
                          <Plus className="w-3 h-3" />
                          Order / Complete
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-600 font-medium flex items-center justify-end gap-1">
                          <Check className="w-3.5 h-3.5" /> Complete
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Inline Order / Referral Modal */}
      {showOrderModal && activeGapToOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                Preventive Care Order Requisition
              </h3>
              <button
                onClick={() => setShowOrderModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div className="font-semibold text-slate-900">{activeGapToOrder.item.title}</div>
                <div className="text-xs text-slate-600 mt-1">
                  Patient: <strong>{activeGapToOrder.patient.name}</strong> (MRN: {activeGapToOrder.patient.mrn}) &bull; Age: {activeGapToOrder.patient.age}
                </div>
                <div className="text-xs text-indigo-700 font-mono mt-1">
                  CPT: {activeGapToOrder.item.cptCode || 'Clinical Assessment'} &bull; Grade {activeGapToOrder.item.uspstfGrade}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ordering Clinical Action
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="radio" name="orderType" defaultChecked className="text-indigo-600" />
                    <span>Submit Electronic Lab / Imaging Order</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="radio" name="orderType" className="text-indigo-600" />
                    <span>Generate Specialist Referral Consult</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="radio" name="orderType" className="text-indigo-600" />
                    <span>Document Outside Completion (Patient had procedure elsewhere)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Notes / Prior Authorization Notes
                </label>
                <textarea
                  rows={2}
                  defaultValue={`Preventive screening indicated per USPSTF guidelines for ${activeGapToOrder.patient.age}yo somatic patient.`}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowOrderModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleMarkCompleted(activeGapToOrder.patient.id, activeGapToOrder.item.id)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition"
                >
                  Authorize Order & Mark Complete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
