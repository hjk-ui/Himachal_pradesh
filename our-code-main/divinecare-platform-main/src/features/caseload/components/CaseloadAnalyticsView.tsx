'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Flame,
  Shield,
  Shuffle,
  Star,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import type { Client, StaffMember, TreatmentTeam } from '@/features/clients/types';
import {
  calculateSafeAcuityCeiling,
  calculateStaffCaseload,
  getDaysUntilLicenseExpiry,
  isClientOnWaitlist,
  isLicenseExpiringSoon,
  ROLE_COLORS,
  ROLE_LABEL_MAP,
  STATUS_COLORS,
} from '../algorithms';
import { FrequencyChip } from '../frequencyEngine';

export interface CaseloadAnalyticsViewProps {
  clients: Client[];
  staffList: StaffMember[];
  onOpenHandoff: (client: Client, defaultRoleSlot?: keyof TreatmentTeam) => void;
}

export function CaseloadAnalyticsView({
  clients,
  staffList,
  onOpenHandoff,
}: CaseloadAnalyticsViewProps) {
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);

  // Identify waitlist clients (no therapist, prescriber, or case manager)
  const waitlistClients = useMemo(
    () => clients.filter(isClientOnWaitlist),
    [clients]
  );

  // Compute caseload metrics for each clinician
  const staffMetrics = useMemo(() => {
    // Only show clinical roles with maxCaseload > 0
    const clinicians = staffList.filter(
      (s) =>
        s.role === 'therapist' ||
        s.role === 'psychiatrist' ||
        s.role === 'np' ||
        s.role === 'case_manager' ||
        s.role === 'prp_specialist' ||
        s.role === 'peer_support'
    );

    return clinicians.map((staff) => calculateStaffCaseload(staff, clients));
  }, [staffList, clients]);

  const toggleExpand = (id: string) => {
    setExpandedStaffId((curr) => (curr === id ? null : id));
  };

  return (
    <div className="space-y-6">
      {/* Waitlist Banner */}
      {waitlistClients.length > 0 && (
        <div className="rounded-3xl border border-amber-200/80 bg-gradient-to-r from-amber-50/90 via-orange-50/50 to-amber-50/90 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-sm">
                <AlertTriangle size={20} />
              </span>
              <div>
                <h3 className="text-base font-bold text-amber-950">
                  {waitlistClients.length} client{waitlistClients.length === 1 ? '' : 's'} on waitlist
                  — no treatment team assigned
                </h3>
                <p className="mt-0.5 text-xs font-medium text-amber-800">
                  These individuals require clinical intake and clinician assignment to enter active
                  care continuity.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons for Waitlist Clients */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-amber-200/60 pt-3">
            {waitlistClients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => onOpenHandoff(client, 'primaryTherapistId')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 shadow-sm transition hover:bg-amber-100/60 active:scale-95"
              >
                <span>{client.name}</span>
                <span className="text-amber-500">Assign team →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clinician Caseload Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {staffMetrics.map((item) => {
          const { staff, assignedClients, totalClients, highRiskCount, upcomingAppointmentsCount } =
            item;
          const isExpiring = isLicenseExpiringSoon(staff.licenseExpiry);
          const daysExpiry = getDaysUntilLicenseExpiry(staff.licenseExpiry);
          const isExpanded = expandedStaffId === staff.id;
          const initials = staff.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2);

          // Headcount color
          const headcountColorClass =
            item.headcountPct > 85
              ? 'bg-rose-500'
              : item.headcountPct >= 65
                ? 'bg-amber-500'
                : 'bg-emerald-500';

          const acuityColorClass =
            item.acuityPct > 85
              ? 'bg-rose-500'
              : item.acuityPct >= 65
                ? 'bg-amber-500'
                : 'bg-emerald-500';

          return (
            <article
              key={staff.id}
              className="flex flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-purple-200 hover:shadow-md"
            >
              {/* Header with Avatar & Details */}
              <div className="flex items-start gap-3">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm"
                  style={{ backgroundColor: staff.color || '#5C2D91' }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0">
                      <h4 className="truncate text-base font-bold text-slate-900">
                        {staff.name}
                      </h4>
                      <p className="text-xs font-semibold text-slate-500">
                        {staff.credential} · <span className="capitalize">{staff.role.replace('_', ' ')}</span>
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        item.statusLabel === 'Near limit'
                          ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                          : item.statusLabel === 'Moderate'
                            ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                            : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      }`}
                    >
                      {item.statusLabel}
                    </span>
                  </div>

                  {/* Supervisee and License Warning Badges */}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    {staff.isSupervisee && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200">
                        <Shield size={12} className="text-amber-600" />
                        Supervised by {staff.supervisorName || 'Senior Clinician'}
                      </span>
                    )}

                    {isExpiring && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200">
                        <AlertTriangle size={12} />
                        License expires in {daysExpiry}d
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Specialty Tags */}
              <div className="mt-3 flex flex-wrap gap-1">
                {staff.specialties.slice(0, 4).map((spec) => (
                  <span
                    key={spec}
                    className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 uppercase tracking-wider"
                  >
                    {spec}
                  </span>
                ))}
              </div>

              {/* Stat Counters */}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-lg font-bold tabular-nums text-slate-800">{totalClients}</p>
                  <p className="text-[10px] font-bold uppercase text-slate-400">Total</p>
                </div>
                <div className="rounded-xl bg-rose-50/70 p-2">
                  <p className="text-lg font-bold tabular-nums text-rose-600">{highRiskCount}</p>
                  <p className="text-[10px] font-bold uppercase text-rose-500">High Risk</p>
                </div>
                <div className="rounded-xl bg-teal-50/70 p-2">
                  <p className="text-lg font-bold tabular-nums text-teal-600">
                    {upcomingAppointmentsCount}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-teal-600">Upcoming</p>
                </div>
              </div>

              {/* Dual Capacity Progress Bar Component */}
              <div className="mt-4 space-y-3 rounded-2xl bg-slate-50/80 p-3.5">
                {/* Line 1: Headcount Capacity */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-600">Client Headcount</span>
                    <span className="tabular-nums text-slate-900">
                      {totalClients} / {staff.maxCaseload} ({item.headcountPct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${headcountColorClass}`}
                      style={{ width: `${Math.min(100, item.headcountPct)}%` }}
                    />
                  </div>
                </div>

                {/* Line 2: Acuity Score Capacity */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-600">Acuity Score</span>
                    <span className="tabular-nums text-slate-900">
                      {item.totalAcuity} / {item.safeCeiling} pts ({item.acuityPct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${acuityColorClass}`}
                      style={{ width: `${Math.min(100, item.acuityPct)}%` }}
                    />
                  </div>
                </div>

                {/* Risk breakdown dots */}
                <div className="flex items-center justify-between border-t border-slate-200/60 pt-2 text-[11px] font-medium text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                    <span>{item.highRiskCount} High</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span>{item.mediumRiskCount} Med</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span>{item.lowRiskCount} Low</span>
                  </div>
                </div>
              </div>

              {/* Assigned Roster Expansion */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => toggleExpand(staff.id)}
                  className="flex w-full items-center justify-between text-xs font-bold text-slate-600 hover:text-[#5C2D91]"
                >
                  <span>
                    Assigned Caseload ({assignedClients.length})
                  </span>
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {isExpanded && (
                  <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2">
                    {assignedClients.length === 0 ? (
                      <p className="py-2 text-center text-xs text-slate-400">
                        No clients currently assigned to this clinician.
                      </p>
                    ) : (
                      assignedClients.map((client) => (
                        <div
                          key={client.id}
                          className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0 flex-1 pr-2 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate font-bold text-slate-900">{client.name}</p>
                              <FrequencyChip client={client} compact={true} />
                            </div>
                            <p className="truncate text-[10px] text-slate-400">
                              {client.diagnosis || client.primaryDiagnosis || 'No Dx'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => onOpenHandoff(client)}
                              className="rounded-lg bg-white px-2 py-1 font-semibold text-[#5C2D91] shadow-xs border border-purple-200 hover:bg-purple-50"
                            >
                              Transfer
                            </button>
                            <Link
                              href={`/dashboard/clients/${client.id}`}
                              className="rounded-lg bg-white px-2 py-1 font-semibold text-slate-600 shadow-xs border border-slate-200 hover:bg-slate-100"
                            >
                              View
                            </Link>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
