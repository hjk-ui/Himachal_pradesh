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
import { fetchMedicalPatients } from '@/features/medical/api';
import { MedicalPatient, MedicalPreventiveItem } from '@/features/medical/types';
import { displayAge } from '@/features/medical/format';
import { buttonClasses } from '@/components/ui';

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
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchMedicalPatients()
      .then(setPatients)
      .catch((err) => setNotice(err instanceof Error ? err.message : 'Could not load patients.'));
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

  // Preventive-care items and screening orders have no table in the database yet, so these
  // actions cannot be saved or sent. Tell the user plainly instead of faking completion.
  const NOT_CONNECTED =
    'Not connected yet: preventive-care orders and completions are not saved by Altrixs. Nothing was ordered or recorded. Place the order from Labs or Referrals and document it in the visit note.';

  const handleMarkCompleted = () => {
    setShowOrderModal(false);
    setNotice(NOT_CONNECTED);
  };

  const handleBulkRequisition = () => {
    setNotice(NOT_CONNECTED);
  };

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
      <MedicalNavHeader
        title="Preventive Care & USPSTF Guidelines Tracker"
        subtitle="Automated clinical gap surveillance, age/gender criteria matching, and population bulk ordering"
        badge="USPSTF Grade A & B Certified"
      />

      <div className="min-w-0">
        {notice && (
          <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl flex items-center gap-2 text-sm shadow-xs">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <span className="font-semibold">{notice}</span>
          </div>
        )}

        {/* Top Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Overdue Gaps</p>
              <h3 className="text-2xl font-semibold text-rose-600 mt-1">{overdueGaps.length}</h3>
              <p className="text-[11px] text-rose-600 mt-0.5">High clinical priority</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-semibold">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Due in Next 90 Days</p>
              <h3 className="text-2xl font-semibold text-amber-700 mt-1">{dueSoonGaps.length}</h3>
              <p className="text-[11px] text-amber-700 mt-0.5">Upcoming outreach</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Up to Date</p>
              <h3 className="text-2xl font-semibold text-emerald-700 mt-1">{upToDateCount}</h3>
              <p className="text-[11px] text-emerald-700 mt-0.5">Quality compliance</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Panel Compliance Rate</p>
              <h3 className="text-2xl font-semibold text-blue-600 mt-1">
                {allGaps.length > 0 ? `${Math.round((upToDateCount / allGaps.length) * 100)}%` : '—'}
              </h3>
              <p className="text-[11px] text-blue-500 mt-0.5">HEDIS & MIPS target: &ge;80%</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Caseload Bulk Ordering Callout View */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs mb-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Caseload Bulk Preventive Requisition View</h3>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Top overdue screening gaps across your active medical panel. Issue bulk lab orders or specialist consults with one click.
              </p>
            </div>
            <span className="bg-blue-50 text-slate-600 border border-blue-200 text-xs px-3 py-1 rounded-full font-medium">
              Population Health Engine
            </span>
          </div>

          {topPanelGaps.length === 0 && (
            <p className="text-xs text-slate-600">No overdue screening gaps across the panel.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {topPanelGaps.map((gap) => (
              <div
                key={gap.title}
                className="bg-slate-50  border border-white/15 rounded-xl p-3.5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="bg-rose-500/80 text-slate-900 font-semibold px-2 py-0.5 rounded text-[11px]">
                      {gap.count} Overdue
                    </span>
                    <span className="text-slate-600 font-mono text-[11px]">Grade {gap.grade}</span>
                  </div>
                  <h4 className="text-xs font-semibold text-slate-900 line-clamp-2 mt-1">{gap.title}</h4>
                  {gap.cpt && (
                    <span className="text-[11px] text-slate-500 font-mono">CPT {gap.cpt}</span>
                  )}
                </div>

                <button
                  onClick={handleBulkRequisition}
                  title="Not connected yet: bulk orders cannot be placed from here"
                  className={buttonClasses({ size: 'sm', className: 'mt-3 w-full' })}
                >
                  <Send className="w-3 h-3" />
                  Order for All ({gap.count}) (not available)
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs mb-6 flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search screening or patient…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Patient Selector */}
            <select
              aria-label="Filter preventive care by patient"
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
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
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
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
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-4 sm:px-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900">USPSTF Maintenance Checklist</h3>
              <p className="text-xs text-slate-500">Evidence-based preventive clinical recommendations and due dates</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                  <th scope="col" className="py-3 px-4">Screening / Recommendation</th>
                  <th scope="col" className="py-3 px-4">Patient</th>
                  <th scope="col" className="py-3 px-4">USPSTF Grade</th>
                  <th scope="col" className="py-3 px-4">Target Group</th>
                  <th scope="col" className="py-3 px-4">Status</th>
                  <th scope="col" className="py-3 px-4">Last Completed</th>
                  <th scope="col" className="py-3 px-4">Due Date</th>
                  <th scope="col" className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGaps.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                      {patients.length === 0 ? 'No medical patients yet.' : 'No preventive care items match your filters.'}
                    </td>
                  </tr>
                )}
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
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 block"
                      >
                        {patient.name}
                      </Link>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {patient.mrn} &bull; Age {displayAge(patient)}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded text-xs font-semibold ${
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
                    <td className="py-3 px-4 text-xs font-mono text-slate-900 font-semibold whitespace-nowrap">
                      {item.dueDate}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {item.status !== 'Up to Date' ? (
                        <button
                          onClick={() => {
                            setActiveGapToOrder({ patient, item });
                            setShowOrderModal(true);
                          }}
                          className={buttonClasses({ size: 'sm' })}
                        >
                          <Plus className="w-3 h-3" />
                          Order / Complete
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-700 font-medium flex items-center justify-end gap-1">
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
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Preventive Care Order Requisition
              </h3>
              <button
                onClick={() => setShowOrderModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-semibold"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div className="font-semibold text-slate-900">{activeGapToOrder.item.title}</div>
                <div className="text-xs text-slate-600 mt-1">
                  Patient: <strong>{activeGapToOrder.patient.name}</strong> (MRN: {activeGapToOrder.patient.mrn}) &bull; Age: {displayAge(activeGapToOrder.patient)}
                </div>
                <div className="text-xs text-blue-700 font-mono mt-1">
                  CPT: {activeGapToOrder.item.cptCode || 'Clinical Assessment'} &bull; Grade {activeGapToOrder.item.uspstfGrade}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ordering Clinical Action
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="radio" name="orderType" defaultChecked className="text-blue-600" />
                    <span>Submit Electronic Lab / Imaging Order</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="radio" name="orderType" className="text-blue-600" />
                    <span>Generate Specialist Referral Consult</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="radio" name="orderType" className="text-blue-600" />
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
                  defaultValue={`Preventive screening indicated per USPSTF guidelines for ${displayAge(activeGapToOrder.patient)}yo somatic patient.`}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
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
                  onClick={handleMarkCompleted}
                  title="Not connected yet: completion cannot be saved"
                  className={buttonClasses({ size: 'sm' })}
                >
                  Authorize Order &amp; Mark Complete (not available)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
