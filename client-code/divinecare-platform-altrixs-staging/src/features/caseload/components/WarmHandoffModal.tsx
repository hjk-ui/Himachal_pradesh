'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  FileCheck,
  Flame,
  Loader2,
  Shield,
  Shuffle,
  Sparkles,
  Star,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { Client, StaffMember, TreatmentTeam } from '@/features/clients/types';
import { updateClientTreatmentTeam } from '@/features/clients';
import {
  HANDOFF_TYPES,
  TRANSFER_REASONS,
  type HandoffType,
  type TransferReason,
} from '../types';
import {
  getDaysUntilLicenseExpiry,
  isLicenseExpiringSoon,
  ROLE_COLORS,
  ROLE_LABEL_MAP,
  scoreMatches,
  SLOT_NAME_MAP,
  STATUS_COLORS,
} from '../algorithms';
import { useCaseloadCounts } from '../useCaseloadCounts';

export interface WarmHandoffModalProps {
  open: boolean;
  client: Client | null;
  staffList: StaffMember[];
  /** Legacy: no longer used for capacity (counts come from the server across every active client) */
  allClients: Client[];
  initialRoleSlot?: keyof TreatmentTeam;
  onClose: () => void;
  onHandoffComplete: (updatedClient: Client) => void;
}

const ROLE_SLOTS: Array<{ key: keyof TreatmentTeam; label: string }> = [
  { key: 'primaryTherapistId', label: 'Primary Therapist' },
  { key: 'prescriberId', label: 'Prescriber' },
  { key: 'caseManagerId', label: 'Case Manager' },
  { key: 'prpSpecialistId', label: 'PRP Specialist' },
  { key: 'peerSupportId', label: 'Peer Support' },
];

export function WarmHandoffModal({
  open,
  client,
  staffList,
  allClients,
  initialRoleSlot = 'primaryTherapistId',
  onClose,
  onHandoffComplete,
}: WarmHandoffModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedRoleSlot, setSelectedRoleSlot] = useState<keyof TreatmentTeam>(initialRoleSlot);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [handoffType, setHandoffType] = useState<HandoffType>('permanent');
  const [effectiveDate, setEffectiveDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [transferReason, setTransferReason] = useState<TransferReason>(TRANSFER_REASONS[0]);
  const [clinicalSummary, setClinicalSummary] = useState<string>('');
  const [checklist, setChecklist] = useState({
    sessionNote: false,
    treatmentPlan: false,
    upcomingAppt: false,
    safetyPlan: false,
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // Initialize form state when client changes
  React.useEffect(() => {
    if (client) {
      setStep(1);
      setSuccess(false);
      setSaving(false);
      setSelectedRoleSlot(initialRoleSlot);
      setSelectedStaffId('');
      setHandoffType('permanent');
      setEffectiveDate(new Date().toISOString().slice(0, 10));
      setTransferReason(TRANSFER_REASONS[0]);

      const isHighRisk = (client.risk || '').toLowerCase() === 'high';
      setChecklist({
        sessionNote: false,
        treatmentPlan: true,
        upcomingAppt: Boolean(client.nextAppointment),
        safetyPlan: isHighRisk,
      });

      const dx = client.diagnosis || client.primaryDiagnosis || 'Mental health condition';
      setClinicalSummary(
        `Presenting concerns: ${dx}\n` +
          `Effective interventions: CBT cognitive restructuring, emotion regulation drills, consistent therapeutic alliance.\n` +
          `Key triggers/sensitivities: Transition distress, scheduling changes, trauma-related cues.\n` +
          `Risk level: ${client.risk.toUpperCase()}\n` +
          `Recommendations for receiving clinician: Coordinate warm handoff introduction, review care plan goals, and confirm next appointment.`
      );
    }
  }, [client, initialRoleSlot, open]);

  // Current assignee for the selected role slot
  const currentAssigneeName = useMemo(() => {
    if (!client || !client.treatmentTeam) return null;
    const nameKey = SLOT_NAME_MAP[selectedRoleSlot];
    return (client.treatmentTeam as any)[nameKey] || null;
  }, [client, selectedRoleSlot]);

  // Capacity: server caseload counts across every active client (never the loaded list page)
  const { counts: caseloadCounts, loading: countsLoading } = useCaseloadCounts({ enabled: open });

  // Ranked clinicians using smart matching engine
  const rankedMatches = useMemo(() => {
    // Wait for the counts so the default Best Match is not picked on zeros
    if (!client || countsLoading) return [];
    return scoreMatches(client, staffList, allClients, selectedRoleSlot, caseloadCounts ?? {});
  }, [client, staffList, allClients, selectedRoleSlot, caseloadCounts, countsLoading]);

  // Select the top match by default if none selected
  React.useEffect(() => {
    if (rankedMatches.length > 0 && !selectedStaffId) {
      setSelectedStaffId(rankedMatches[0].staff.id);
    }
  }, [rankedMatches, selectedStaffId]);

  if (!open || !client) return null;

  const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

  const handleNext = () => {
    if (step === 1) {
      if (!selectedStaffId) return;
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  };

  const handleConfirmHandoff = async () => {
    if (!selectedStaff || !client) return;
    setSaving(true);

    const nameKey = SLOT_NAME_MAP[selectedRoleSlot];
    const updatedTeam: TreatmentTeam = {
      ...(client.treatmentTeam || {}),
      [selectedRoleSlot]: selectedStaff.id,
      [nameKey]: `${selectedStaff.name}, ${selectedStaff.credential}`,
    };

    const assignPrimary =
      selectedRoleSlot === 'primaryTherapistId' ? selectedStaff.id : undefined;

    try {
      // Persist to Postgres — refresh must show the same team
      if (!client.id.startsWith('client-') && !client.id.startsWith('demo-')) {
        await updateClientTreatmentTeam(
          client.id,
          updatedTeam,
          assignPrimary ?? undefined
        );
      }

      const updatedClient: Client = {
        ...client,
        treatmentTeam: updatedTeam,
        assignedToId: assignPrimary || client.assignedToId,
        assignedToName: assignPrimary
          ? `${selectedStaff.name}, ${selectedStaff.credential}`
          : client.assignedToName,
        assignedSince:
          handoffType === 'permanent' && selectedRoleSlot === 'primaryTherapistId'
            ? effectiveDate
            : client.assignedSince,
        insuranceType: client.insuranceType || client.insurancePayer || undefined,
      };

      setSaving(false);
      setSuccess(true);

      setTimeout(() => {
        onHandoffComplete(updatedClient);
        onClose();
      }, 800);
    } catch (err) {
      setSaving(false);
      console.error('[warm-handoff] persist failed', err);
      alert(err instanceof Error ? err.message : 'Could not save assignment. Try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4">
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-purple-100 bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-slate-100 bg-gradient-to-r from-[#F8F7FC] via-white to-purple-50/50 p-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-lg bg-[#5C2D91]/10 px-2 py-0.5 text-xs font-bold text-[#5C2D91]">
                  <Shuffle size={13} />
                  Warm Clinical Handoff
                </span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-bold capitalize text-white"
                  style={{
                    backgroundColor:
                      STATUS_COLORS[client.risk.toLowerCase() as keyof typeof STATUS_COLORS] ||
                      '#6B7280',
                  }}
                >
                  {client.risk} Risk
                </span>
              </div>
              <h2 className="mt-1.5 truncate text-xl font-bold text-slate-900">
                {client.name}
              </h2>
              <p className="truncate text-xs font-medium text-slate-500">
                Diagnosis: {client.diagnosis || client.primaryDiagnosis || 'Diagnostic assessment in progress'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close warm handoff"
              className="rounded-xl p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]"
            >
              <X size={20} aria-hidden />
            </button>
          </div>

          {/* Stepper Progress Bar */}
          {!success && (
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-semibold">
              <div
                className={`flex items-center gap-1.5 ${
                  step >= 1 ? 'text-[#5C2D91]' : 'text-slate-500'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    step >= 1 ? 'bg-[#5C2D91] text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  1
                </span>
                <span>Select Clinician</span>
              </div>
              <div className="h-0.5 flex-1 mx-2 bg-slate-200">
                <div
                  className="h-full bg-[#5C2D91] transition-all duration-300"
                  style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}
                />
              </div>
              <div
                className={`flex items-center gap-1.5 ${
                  step >= 2 ? 'text-[#5C2D91]' : 'text-slate-500'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    step >= 2 ? 'bg-[#5C2D91] text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  2
                </span>
                <span>Handoff Details</span>
              </div>
              <div className="h-0.5 flex-1 mx-2 bg-slate-200">
                <div
                  className="h-full bg-[#5C2D91] transition-all duration-300"
                  style={{ width: step === 3 ? '100%' : '0%' }}
                />
              </div>
              <div
                className={`flex items-center gap-1.5 ${
                  step >= 3 ? 'text-[#5C2D91]' : 'text-slate-500'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    step >= 3 ? 'bg-[#5C2D91] text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  3
                </span>
                <span>Clinical Summary</span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {success ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 animate-bounce">
                <CheckCircle2 size={38} />
              </div>
              <h3 className="mt-4 text-xl font-bold text-slate-900">
                Clinical Handoff Confirmed!
              </h3>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                {selectedStaff?.name} is now assigned as the {ROLE_LABEL_MAP[selectedRoleSlot]} for {client.name}.
                Client chart and care team notifications have been updated.
              </p>
            </div>
          ) : step === 1 ? (
            <div className="space-y-4">
              {/* Role selector pills */}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Select Treatment Team Role Slot
                </label>
                <div className="flex flex-wrap gap-2">
                  {ROLE_SLOTS.map((slot) => {
                    const isSelected = selectedRoleSlot === slot.key;
                    const nameKey = SLOT_NAME_MAP[slot.key];
                    const assigned = (client.treatmentTeam as any)?.[nameKey];
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        onClick={() => {
                          setSelectedRoleSlot(slot.key);
                          setSelectedStaffId('');
                        }}
                        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          isSelected
                            ? 'border-[#5C2D91] bg-[#5C2D91] text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-purple-200 hover:bg-purple-50/50'
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: ROLE_COLORS[slot.key] || '#5C2D91' }}
                        />
                        {slot.label}
                        {assigned && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Current assignee callout */}
                <div className="mt-2.5 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-500">Current Assignee:</span>
                  <span className="font-semibold text-slate-800">
                    {currentAssigneeName || 'None (Unassigned / Waitlist)'}
                  </span>
                </div>
              </div>

              {/* Ranked Clinicians list */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Smart-Match Recommendations
                  </label>
                  <span className="text-[11px] font-medium text-[#5C2D91]">
                    Ranked by specialty, capacity & payer fit
                  </span>
                </div>

                {rankedMatches.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                    No active clinicians found for this role slot.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {rankedMatches.map((match) => {
                      const staff = match.staff;
                      const isSelected = selectedStaffId === staff.id;
                      const isExpiring = isLicenseExpiringSoon(staff.licenseExpiry);
                      const daysExpiry = getDaysUntilLicenseExpiry(staff.licenseExpiry);
                      const initials = staff.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2);

                      return (
                        <div
                          key={staff.id}
                          onClick={() => setSelectedStaffId(staff.id)}
                          className={`group relative cursor-pointer rounded-2xl border p-3.5 transition ${
                            isSelected
                              ? 'border-[#5C2D91] bg-purple-50/40 shadow-sm ring-2 ring-[#5C2D91]/20'
                              : 'border-slate-200 bg-white hover:border-purple-200 hover:bg-slate-50/70'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Avatar */}
                            <div
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-inner"
                              style={{ backgroundColor: staff.color || '#5C2D91' }}
                            >
                              {initials}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <h4 className="text-sm font-bold text-slate-900">
                                    {staff.name}
                                  </h4>
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                                    {staff.credential}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {match.isBestMatch && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#5C2D91] to-[#7C3AED] px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                                      <Star size={11} className="fill-white" />
                                      Best Match
                                    </span>
                                  )}
                                  <span
                                    className="text-xs font-bold text-slate-600 tabular-nums"
                                    title="Primary caseload plus also on care team, active clients"
                                  >
                                    {countsLoading || !caseloadCounts ? '—' : match.assignedCount}/{match.maxCaseload} clients
                                  </span>
                                </div>
                              </div>

                              {/* Supervisee and License Warning Badges */}
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                {staff.isSupervisee && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200/60">
                                    <Shield size={12} />
                                    Supervised by {staff.supervisorName || 'Senior Clinician'}
                                  </span>
                                )}

                                {isExpiring && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200/60">
                                    <AlertTriangle size={12} />
                                    License expires in {daysExpiry}d — confirm supervision plan
                                  </span>
                                )}
                              </div>

                              {/* Match Reasons Pills */}
                              <div className="mt-2 flex flex-wrap gap-1">
                                {match.reasons.map((r, i) => (
                                  <span
                                    key={i}
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                      r.includes('Payer mismatch')
                                        ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                                        : r.includes('Specialty')
                                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                                          : 'bg-purple-50 text-[#5C2D91] ring-1 ring-purple-100'
                                    }`}
                                  >
                                    {r}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-4">
              {/* Selected Clinician summary banner */}
              {selectedStaff && (
                <div className="flex items-center gap-3 rounded-2xl border border-purple-100 bg-purple-50/50 p-3.5">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: selectedStaff.color }}
                  >
                    {selectedStaff.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#5C2D91]">
                      Target Provider ({ROLE_LABEL_MAP[selectedRoleSlot]})
                    </p>
                    <p className="text-sm font-bold text-slate-900">
                      {selectedStaff.name}, {selectedStaff.credential}
                    </p>
                  </div>
                </div>
              )}

              {/* Handoff Type Cards */}
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Handoff Type *
                </label>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {HANDOFF_TYPES.map((type) => {
                    const isSelected = handoffType === type.id;
                    return (
                      <div
                        key={type.id}
                        onClick={() => setHandoffType(type.id)}
                        className={`cursor-pointer rounded-2xl border p-3.5 transition ${
                          isSelected
                            ? 'border-[#5C2D91] bg-purple-50/50 shadow-sm ring-2 ring-[#5C2D91]/20'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-slate-900">{type.title}</p>
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-[#5C2D91] bg-[#5C2D91] text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check size={10} />}
                          </div>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                          {type.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Effective Date */}
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Effective Date *
                </label>
                <div className="relative">
                  <Calendar
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                  />
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-medium text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/15"
                  />
                </div>
              </div>

              {/* Transfer Reason */}
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Reason for Transfer *
                </label>
                <select
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value as TransferReason)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/15"
                >
                  {TRANSFER_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Clinical Summary */}
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Clinical Summary & Transition Notes *
                </label>
                <textarea
                  rows={6}
                  value={clinicalSummary}
                  onChange={(e) => setClinicalSummary(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 p-3.5 text-xs font-medium leading-relaxed text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/15"
                />
              </div>

              {/* Outstanding Clinical Checklist */}
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Outstanding Clinical Transition Checklist
                </label>
                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
                  <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklist.sessionNote}
                      onChange={(e) =>
                        setChecklist((p) => ({ ...p, sessionNote: e.target.checked }))
                      }
                      className="h-4 w-4 rounded text-[#5C2D91] focus:ring-[#5C2D91]"
                    />
                    <span>Session note pending signature before handoff</span>
                  </label>

                  <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklist.treatmentPlan}
                      onChange={(e) =>
                        setChecklist((p) => ({ ...p, treatmentPlan: e.target.checked }))
                      }
                      className="h-4 w-4 rounded text-[#5C2D91] focus:ring-[#5C2D91]"
                    />
                    <span>Treatment plan due for review with receiving clinician</span>
                  </label>

                  <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklist.upcomingAppt}
                      onChange={(e) =>
                        setChecklist((p) => ({ ...p, upcomingAppt: e.target.checked }))
                      }
                      className="h-4 w-4 rounded text-[#5C2D91] focus:ring-[#5C2D91]"
                    />
                    <span>
                      Upcoming appt: {client.nextAppointment || 'No appointment scheduled yet'}
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklist.safetyPlan}
                      onChange={(e) =>
                        setChecklist((p) => ({ ...p, safetyPlan: e.target.checked }))
                      }
                      className="h-4 w-4 rounded text-[#5C2D91] focus:ring-[#5C2D91]"
                    />
                    <span className={client.risk.toLowerCase() === 'high' ? 'font-bold text-rose-700' : ''}>
                      Safety plan — confirm currency {client.risk.toLowerCase() === 'high' ? '(Mandatory for High Risk)' : ''}
                    </span>
                  </label>
                </div>
              </div>

              {/* Compliance Notice */}
              <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-3.5 text-xs leading-relaxed text-[#5C2D91]">
                <p className="font-bold flex items-center gap-1.5">
                  <Shield size={14} />
                  Clinical & Legal Compliance Notice:
                </p>
                <p className="mt-1 text-slate-600">
                  This handoff becomes an immutable part of the clinical health record. Caseload
                  allocations update instantaneously, and an automated 2-week transition milestone
                  will be scheduled for collaborative care continuity.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        {!success && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 p-4 sm:px-6">
            {step > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <ArrowLeft size={14} />
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!selectedStaffId}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5C2D91] to-[#7C3AED] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                Continue to {step === 1 ? 'Details' : 'Summary'}
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirmHandoff}
                disabled={saving || !clinicalSummary.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5C2D91] to-[#7C3AED] px-5 py-2.5 text-xs font-bold text-white shadow-md hover:opacity-95 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Recording Handoff…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    Confirm Handoff
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
