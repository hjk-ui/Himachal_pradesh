'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  Search,
  UserPlus,
  AlertTriangle,
  HeartPulse,
  FlaskConical,
  ChevronRight,
  Filter,
  ArrowUpDown,
  Calendar,
} from 'lucide-react';
import { MedicalNavHeader } from '@/features/medical/components/MedicalNavHeader';
import { getMedicalPatients } from '@/features/medical/data';
import type { MedicalPatient } from '@/features/medical/types';

export default function MedicalPatientsPage() {
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'gaps' | 'labs' | 'ccm' | 'today'>('all');

  useEffect(() => {
    async function loadPatients() {
      try {
        const res = await fetch('/api/medical/patients');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.patients) && data.patients.length > 0) {
            setPatients(data.patients);
            return;
          }
        }
      } catch (err) {
        console.error('Failed to load patients from API:', err);
      }
      setPatients(getMedicalPatients());
    }

    void loadPatients();
    const onUpdate = () => void loadPatients();
    window.addEventListener('medical_patients_updated', onUpdate);
    return () => window.removeEventListener('medical_patients_updated', onUpdate);
  }, []);

  const filtered = useMemo(() => {
    let list = [...patients];

    if (activeTab === 'gaps') {
      list = list.filter((p) => p.hasCareGaps);
    } else if (activeTab === 'labs') {
      list = list.filter((p) => p.hasAbnormalLabs || p.hasCriticalPanicLab);
    } else if (activeTab === 'ccm') {
      list = list.filter((p) => (p.problems || []).filter((pr) => pr?.status === 'Chronic').length >= 2);
    } else if (activeTab === 'today') {
      list = list.filter((p) => p.nextVisit && p.nextVisit.toLowerCase().includes('today'));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.mrn?.toLowerCase().includes(q) ||
          p.demographics?.primaryInsurance?.payerName?.toLowerCase().includes(q) ||
          (p as any).primaryPayer?.toLowerCase().includes(q) ||
          (p.problems || []).some(
            (prob) =>
              prob?.icd10?.toLowerCase().includes(q) ||
              prob?.description?.toLowerCase().includes(q)
          )
      );
    }

    return list;
  }, [patients, search, activeTab]);

  return (
    <div className="space-y-6 pb-12">
      <MedicalNavHeader
        title="Medical Patients Roster"
        subtitle="Primary Care Panel, Active Somatic Diagnoses, Lab & Preventive Screening Alerts"
        actionButton={
          <Link
            href="/dashboard/medical/patients/intake"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/30 transition hover:bg-blue-500"
          >
            <UserPlus size={16} />
            New Medical Patient (Intake Wizard)
          </Link>
        }
      />

      {/* Search and Filter Bar */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="relative flex-1 md:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by patient name, MRN, insurance, or ICD-10 condition..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 md:border-0 md:pt-0">
          {[
            { id: 'all', label: `All Patients (${patients.length})` },
            { id: 'today', label: "Today's Schedule" },
            { id: 'gaps', label: 'Overdue Gaps' },
            { id: 'labs', label: 'Abnormal Labs' },
            { id: 'ccm', label: 'Chronic Care (CCM)' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Patients Roster Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50/75 text-xs font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3.5">Patient / MRN</th>
                <th className="px-5 py-3.5">DOB / Age</th>
                <th className="px-5 py-3.5">Assigned PCP</th>
                <th className="px-5 py-3.5">Primary Insurance</th>
                <th className="px-5 py-3.5">Active Somatic Diagnoses</th>
                <th className="px-5 py-3.5">Clinical Alerts</th>
                <th className="px-5 py-3.5">Visits (Last / Next)</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                    No medical patients match your search criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((patient) => {
                  return (
                    <tr
                      key={patient.id}
                      className="transition hover:bg-blue-50/40"
                    >
                      <td className="whitespace-nowrap px-5 py-4">
                        <Link
                          href={`/dashboard/medical/patients/${patient.id}`}
                          className="font-bold text-slate-900 hover:text-blue-600"
                        >
                          {patient.name}
                        </Link>
                        <div className="flex items-center gap-1.5 font-mono text-xs text-slate-400">
                          <span>MRN: {patient.mrn}</span>
                          <span>·</span>
                          <span>{patient.gender || 'Unknown'} {patient.pronouns ? `(${patient.pronouns})` : ''}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-xs">
                        <div className="font-semibold text-slate-800">{patient.dob || 'N/A'}</div>
                        <div className="text-slate-400">{patient.age ? `${patient.age} yrs old` : ''}</div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-700">
                        {patient.pcp || (patient as any).assignedPcp || '—'}
                      </td>
                      <td className="px-5 py-4 text-xs">
                        <div className="font-semibold text-slate-800">
                          {patient.demographics?.primaryInsurance?.payerName || (patient as any).primaryPayer || '—'}
                        </div>
                        <div className="font-mono text-slate-400">
                          ID: {patient.demographics?.primaryInsurance?.memberId || patient.mrn}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {(patient.problems || []).slice(0, 3).map((prob) => (
                            <span
                              key={prob.id}
                              title={prob.description}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700"
                            >
                              <span className="font-bold text-blue-700">{prob.icd10}</span>
                              <span className="max-w-[120px] truncate text-[10px] text-slate-500">
                                {prob.description}
                              </span>
                            </span>
                          ))}
                          {(patient.problems || []).length > 3 && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                              +{(patient.problems || []).length - 3} more
                            </span>
                          )}
                          {(patient.problems || []).length === 0 && (
                            <span className="text-[11px] text-slate-400 italic">None documented</span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <div className="flex flex-col gap-1">
                          {patient.hasCriticalPanicLab && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">
                              <AlertTriangle size={11} /> Panic Lab Alert
                            </span>
                          )}
                          {patient.hasCareGaps && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                              <HeartPulse size={11} /> Care Gap Due
                            </span>
                          )}
                          {!patient.hasCriticalPanicLab && !patient.hasCareGaps && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                              ✓ All routine
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-xs">
                        <div>
                          <span className="text-slate-400">Last:</span>{' '}
                          <span className="font-medium text-slate-700">{patient.lastVisit}</span>
                        </div>
                        {patient.nextVisit && (
                          <div className="mt-0.5 text-blue-600 font-semibold">
                            {patient.nextVisit}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right">
                        <Link
                          href={`/dashboard/medical/patients/${patient.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-blue-600"
                        >
                          Chart <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
