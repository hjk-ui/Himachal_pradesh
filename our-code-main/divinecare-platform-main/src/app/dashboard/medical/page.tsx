'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  FlaskConical,
  HeartPulse,
  Info,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  User,
  Video,
  ArrowRight,
} from 'lucide-react';
import { MedicalNavHeader } from '@/features/medical/components/MedicalNavHeader';
import {
  getCriticalLabAlerts,
  getMedicalPatients,
  INITIAL_TODAYS_APPOINTMENTS,
  acknowledgeLabAlert,
} from '@/features/medical/data';
import type { CriticalLabAlert, MedicalPatient } from '@/features/medical/types';
import { ProviderInBasket } from '@/components/medical/ProviderInBasket';
import { MaWorklist } from '@/components/medical/MaWorklist';
import { PrimaryCareSettingsCard } from '@/components/medical/PrimaryCareSettingsCard';
import { RoomingPanel } from '@/components/medical/RoomingPanel';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { parseMedicalDeepLink, deepLinkIsComplete } from '@/lib/medical/deep-link';

function MedicalOverviewInner() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const deepLink = useMemo(
    () => parseMedicalDeepLink(searchParams),
    [searchParams]
  );
  const [patients, setPatients] = useState<MedicalPatient[]>([]);
  const [alerts, setAlerts] = useState<CriticalLabAlert[]>([]);
  const [selectedAlertForAction, setSelectedAlertForAction] = useState<CriticalLabAlert | null>(null);
  const [actionSuccessToast, setActionSuccessToast] = useState('');
  const canManageSettings =
    user?.role === 'ADMIN' ||
    user?.role === 'DIRECTOR' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'PHYSICIAN';

  useEffect(() => {
    setPatients(getMedicalPatients());
    setAlerts(getCriticalLabAlerts());

    const handleUpdate = () => {
      setPatients(getMedicalPatients());
      setAlerts(getCriticalLabAlerts());
    };
    window.addEventListener('medical_alerts_updated', handleUpdate);
    window.addEventListener('medical_patients_updated', handleUpdate);
    return () => {
      window.removeEventListener('medical_alerts_updated', handleUpdate);
      window.removeEventListener('medical_patients_updated', handleUpdate);
    };
  }, []);

  const pendingAlerts = alerts.filter((a) => !a.acknowledged);

  const handleAcknowledge = (id: string) => {
    acknowledgeLabAlert(id);
    setActionSuccessToast('Critical panic lab acknowledged and noted in clinical chart.');
    setSelectedAlertForAction(null);
    setTimeout(() => setActionSuccessToast(''), 4000);
  };

  return (
    <div className="space-y-6 pb-12">
      <MedicalNavHeader
        title="Medical Practice Overview"
        subtitle="Primary Care & Family Medicine Clinical Operations, Somatic Encounters, and Quality Measures"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderInBasket />
        <MaWorklist />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PrimaryCareSettingsCard canManage={canManageSettings} />
        {deepLinkIsComplete(deepLink) ? (
          <RoomingPanel
            appointmentId={deepLink.appointmentId!}
            clientId={deepLink.clientId!}
          />
        ) : deepLink.appointmentId || deepLink.clientId ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Open rooming from the schedule (needs both appointment and patient). Invalid or partial link.
          </section>
        ) : (
          <RoomingPanel />
        )}
      </div>
      {deepLinkIsComplete(deepLink) ? (
        <p className="text-xs text-slate-500">
          Provider visit for this appointment:{' '}
          <Link
            className="font-semibold text-sky-800 underline"
            href={`/dashboard/medical/visits?appointmentId=${encodeURIComponent(deepLink.appointmentId!)}&clientId=${encodeURIComponent(deepLink.clientId!)}&clientName=${encodeURIComponent(deepLink.clientName || '')}`}
          >
            Open PC visit workflow
          </Link>
        </p>
      ) : null}

      {actionSuccessToast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm">
          ✓ {actionSuccessToast}
        </div>
      )}

      {/* Critical Panic Lab Alert Banner */}
      {pendingAlerts.length > 0 && (
        <div className="rounded-2xl border-2 border-rose-500 bg-rose-50/90 p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-rose-200 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 animate-ping rounded-full bg-rose-600" />
              <ShieldAlert className="h-6 w-6 text-rose-600" />
              <h2 className="text-base font-bold text-rose-950">
                CRITICAL / PANIC LAB ALERTS ({pendingAlerts.length} Unacknowledged)
              </h2>
            </div>
            <Link
              href="/dashboard/medical/labs"
              className="text-xs font-bold text-rose-700 underline hover:text-rose-900"
            >
              View All Labs →
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {pendingAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex flex-col justify-between rounded-xl border border-rose-300 bg-white p-4 shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/dashboard/medical/patients/${alert.patientId}`}
                        className="text-sm font-bold text-slate-900 hover:text-blue-600"
                      >
                        {alert.patientName}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-slate-500">MRN: {alert.mrn}</span>
                    </div>
                    <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                      PANIC VALUE
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-sm font-medium text-slate-700">{alert.testName}:</span>
                    <span className="text-lg font-black text-rose-600">
                      {alert.value} {alert.unit}
                    </span>
                    <span className="text-xs text-slate-400">(Ref: {alert.refRange})</span>
                  </div>
                  <p className="mt-1 text-xs text-rose-800">{alert.clinicalSignificance}</p>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
                  <button
                    type="button"
                    onClick={() => handleAcknowledge(alert.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <CheckCircle2 size={13} className="text-emerald-600" />
                    Acknowledge
                  </button>
                  <Link
                    href={`/dashboard/medical/visits?patient=${alert.patientId}`}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    Order Follow-up
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Today's Encounters
            </span>
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
              <Calendar size={18} />
            </div>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-slate-900">
            {INITIAL_TODAYS_APPOINTMENTS.length}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center font-semibold text-emerald-600">
              <TrendingUp size={13} className="mr-0.5" /> {INITIAL_TODAYS_APPOINTMENTS.length} Scheduled
            </span>
            <span className="text-slate-400">· Realtime schedule</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pending Lab Results
            </span>
            <div className="rounded-xl bg-purple-50 p-2 text-purple-600">
              <FlaskConical size={18} />
            </div>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-slate-900">
            {alerts.length}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-rose-600">
              {pendingAlerts.length} Panic Value{pendingAlerts.length !== 1 ? 's' : ''}
            </span>
            <Link
              href="/dashboard/medical/labs"
              className="font-semibold text-blue-600 hover:underline"
            >
              Review Labs →
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Preventive Care Gaps
            </span>
            <div className="rounded-xl bg-amber-50 p-2 text-amber-600">
              <HeartPulse size={18} />
            </div>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-slate-900">
            {patients.filter((p) => p.hasCareGaps).length}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-amber-700">
              {patients.filter((p) => p.hasCareGaps).length} Overdue Screenings
            </span>
            <Link
              href="/dashboard/medical/preventive-care"
              className="font-semibold text-blue-600 hover:underline"
            >
              View Gaps →
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Medical Patients
            </span>
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <User size={18} />
            </div>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-slate-900">{patients.length}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Primary Care Panel</span>
            <Link
              href="/dashboard/medical/patients"
              className="font-semibold text-blue-600 hover:underline"
            >
              Patient List →
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column (2/3): Today's Appointments & Somatic Prevalence */}
        <div className="space-y-6 lg:col-span-2">
          {/* Today's Appointments Panel */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Today's Medical Encounters</h2>
                <p className="text-xs text-slate-500">
                  Primary care physicals, chronic condition follow-ups, and telehealth visits
                </p>
              </div>
              <Link
                href="/dashboard/medical/visits"
                className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-500"
              >
                + New Encounter
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {INITIAL_TODAYS_APPOINTMENTS.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <Calendar className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                  <p className="text-sm font-semibold text-slate-700">No medical encounters scheduled for today</p>
                  <p className="text-xs text-slate-400 mt-1">New scheduled appointments and walk-ins will appear here.</p>
                </div>
              ) : (
                INITIAL_TODAYS_APPOINTMENTS.map((appt) => (
                  <div
                    key={appt.id}
                    className="flex flex-col justify-between gap-3 p-4 transition hover:bg-slate-50 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-700">
                        {appt.time}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/medical/patients/${appt.patientId}`}
                            className="font-bold text-slate-900 hover:text-blue-600"
                          >
                            {appt.patientName}
                          </Link>
                          <span className="font-mono text-xs text-slate-400">MRN: {appt.mrn}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                            {appt.visitType}
                          </span>
                          <span className="text-xs text-slate-500">{appt.room}</span>
                          {appt.isTelehealth && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                              <Video size={11} /> Telehealth
                            </span>
                          )}
                          <span className="text-xs text-slate-400">· {appt.provider}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <Link
                        href={`/dashboard/medical/visits?patient=${appt.patientId}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                      >
                        Chart Note
                      </Link>
                      <Link
                        href={`/dashboard/medical/patients/${appt.patientId}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Somatic Diagnoses Bar Chart */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Panel Somatic Diagnoses Prevalence
                </h2>
                <p className="text-xs text-slate-500">
                  Top somatic chronic conditions across active patient panel
                </p>
              </div>
              <Link
                href="/dashboard/medical/problem-list"
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Problem Registry →
              </Link>
            </div>
            <div className="mt-4 space-y-4">
              <div className="py-8 text-center text-slate-400 text-xs">
                No patient diagnosis prevalence data available yet. Diagnoses will calibrate automatically as clinical encounters are recorded.
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (1/3): AI Clinical Insights & Quick Actions */}
        <div className="space-y-6">
          {/* AI Clinical Insights Panel */}
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/60 to-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-indigo-900">
              <div className="rounded-lg bg-indigo-600 p-1.5 text-white">
                <Sparkles size={16} />
              </div>
              <h2 className="text-base font-bold">AI Clinical Insights</h2>
            </div>
            <p className="mt-1 text-xs text-indigo-700">
              Evidence-based comorbidity alerts, polypharmacy surveillance & USPSTF reminders
            </p>

            <div className="mt-4 space-y-3">
              {pendingAlerts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-indigo-200 bg-white/70 p-6 text-center">
                  <Sparkles className="mx-auto h-6 w-6 text-indigo-400 mb-2" />
                  <p className="text-xs font-semibold text-indigo-900">All Patient Panels Monitored</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    AI comorbidity surveillance and drug interaction checks will trigger automatically as encounters and lab panels are entered.
                  </p>
                </div>
              ) : (
                pendingAlerts.map((alert) => (
                  <div key={alert.id} className="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
                      <ShieldAlert size={14} /> Panic Lab Result: {alert.testName}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      <strong>{alert.patientName} ({alert.mrn})</strong>: {alert.testName} resulted at {alert.value} {alert.unit} (Ref: {alert.refRange}). {alert.clinicalSignificance}
                    </p>
                    <div className="mt-2 text-right">
                      <Link
                        href={`/dashboard/medical/patients/${alert.patientId}`}
                        className="text-[11px] font-bold text-rose-600 hover:underline"
                      >
                        Action Needed →
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-indigo-100 text-center">
              <Link
                href="/dashboard/medical/ai"
                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-900"
              >
                Open Medical AI Assistant Suite →
              </Link>
            </div>
          </div>


          {/* Quick Shortcuts */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Primary Care Quick Actions
            </h3>
            <div className="mt-3 space-y-2">
              <Link
                href="/dashboard/medical/patients/intake"
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs font-bold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
              >
                <span>6-Step Medical Intake Wizard</span>
                <span>→</span>
              </Link>
              <Link
                href="/dashboard/medical/preventive-care"
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs font-bold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
              >
                <span>USPSTF Caseload Bulk Ordering</span>
                <span>→</span>
              </Link>
              <Link
                href="/dashboard/medical/labs"
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs font-bold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
              >
                <span>Print Quest/Labcorp Requisition</span>
                <span>→</span>
              </Link>
              <Link
                href="/dashboard/medical/billing"
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs font-bold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
              >
                <span>Somatic E&M Charge Capture & Denials</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MedicalOverviewPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading medical…</div>}>
      <MedicalOverviewInner />
    </Suspense>
  );
}
