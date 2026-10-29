'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StartVisitButton } from '@/components/visits/StartVisitButton';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FlaskConical,
  HeartPulse,
  Lock,
  MapPin,
  Pill,
  RefreshCw,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { purgeLegacyMedicalStorage } from '@/features/medical/legacyStorage';
import { apiJson } from '@/lib/api-client';
import { MEDICAL_OVERVIEW_API, type MedicalOverview, type OverviewScope } from '@/lib/medical/primaryCareOverview';
import { useAuth } from '@/features/auth';
import { canManagePrimaryCareSettings, isMedicalAssistant, isPrimaryCareProvider } from '@/lib/medical/primaryCareWorkflow';
import { RoomingPanel } from '@/features/medical/components/RoomingPanel';
import { ProviderInBasket } from '@/features/medical/components/ProviderInBasket';
import { MaWorklist } from '@/features/medical/components/MaWorklist';
import { PrimaryCareSettingsCard } from '@/features/medical/components/PrimaryCareSettingsCard';

type OverviewResponse = MedicalOverview & { success: boolean };

const SCOPE_LABEL: Record<OverviewScope, string> = {
  provider: 'Your primary care schedule and your care-team patients',
  care_team: 'Primary care appointments and patients on your care team',
  caseload: 'Primary care appointments and patients on your caseload',
  organization: 'All primary care in your organization',
};

const QUEUE_ICON: Record<string, typeof FileSignature> = {
  unsigned_visits: FileSignature,
  labs_to_review: FlaskConical,
  labs_critical: AlertCircle,
  standing_overdue: FlaskConical,
  problems_needs_coding: ClipboardList,
  vitals_missing: HeartPulse,
  rx_requests: Pill,
};

const STATUS_CLASS: Record<string, string> = {
  SCHEDULED: 'bg-slate-100 text-slate-700',
  CHECKED_IN: 'bg-blue-50 text-blue-700',
  IN_SESSION: 'bg-brand-50 text-blue-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  NO_SHOW: 'bg-rose-50 text-rose-700',
  LATE_CANCEL: 'bg-amber-50 text-amber-800',
};

const FALLBACK_LINKS = {
  intake: '/dashboard/medical/patients/intake',
  patients: '/dashboard/medical/patients',
  labs: '/dashboard/medical/labs',
  vitals: '/dashboard/medical/vitals',
};

/** Primary care overview: today's schedule, work queues and panel summary from real records. */
export default function MedicalOverviewPage() {
  const { user } = useAuth();
  const role = String(user?.role || '');
  const [rooming, setRooming] = useState<string | null>(null);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiJson<OverviewResponse>(MEDICAL_OVERVIEW_API, { cache: 'no-store' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the primary care overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    purgeLegacyMedicalStorage();
    void load();
  }, [load]);

  const links = data?.links ?? FALLBACK_LINKS;
  const actions = [
    { href: links.intake, label: 'New primary care patient', icon: UserPlus },
    { href: links.patients, label: 'Primary care patients', icon: Users },
    { href: links.labs, label: 'Labs', icon: FlaskConical },
    { href: links.vitals, label: 'Vitals flowsheet', icon: HeartPulse },
  ];

  return (
    <div className="space-y-6 pb-12">
      {rooming ? <RoomingPanel appointmentId={rooming} onClose={() => setRooming(null)} onSaved={() => void load()} /> : null}
      <MedicalNavHeader
        title="Primary care overview"
        subtitle={data ? SCOPE_LABEL[data.scope] : 'Primary care at Silver Spring and Bowie'}
      />

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 font-semibold hover:underline">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Today */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 sm:p-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Calendar size={18} className="text-blue-600" /> Today
                </h2>
                <p className="text-xs text-slate-500">
                  {data ? `${data.dateLabel} · primary care appointments` : 'Primary care appointments'}
                </p>
              </div>
              {data && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {data.today.total} appointment{data.today.total === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {loading && !data && <p className="p-8 text-center text-sm text-slate-500">Loading today&apos;s schedule…</p>}
              {data && data.today.rows.length === 0 && (
                <p className="p-8 text-center text-sm text-slate-500">No primary care appointments today.</p>
              )}
              {data?.today.rows.map((r) => (
                <div key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-20 shrink-0 text-sm font-semibold text-slate-800 sm:w-24">{r.time}</span>
                    <div className="min-w-0">
                      {r.locked || !r.href ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                          <Lock size={13} className="text-slate-500" /> {r.patient}
                        </span>
                      ) : (
                        <Link href={r.href} className="font-semibold text-slate-900 hover:text-blue-700">
                          {r.patient}
                        </Link>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{r.visitType}</span>
                        {r.clinician && <span>· {r.clinician}</span>}
                        {r.isVirtual && (
                          <span className="inline-flex items-center gap-1 text-blue-700">
                            <Video size={12} /> Telehealth
                          </span>
                        )}
                        {r.vitalsMissing && !r.rooming && (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                            <HeartPulse size={12} /> Vitals not recorded
                          </span>
                        )}
                        {r.rooming && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                              r.rooming.status === 'ready' ? 'bg-emerald-50 text-emerald-800' : r.rooming.status === 'in_room' ? 'bg-blue-600/10 text-blue-600' : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            <ClipboardCheck size={12} /> {r.rooming.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:shrink-0 sm:self-center">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[r.status] ?? 'bg-slate-100 text-slate-700'}`}>
                      {r.statusLabel}
                    </span>
                    {r.clientId && !r.locked && data?.workflow?.canRoom && !['COMPLETED', 'NO_SHOW', 'LATE_CANCEL'].includes(r.status) && r.rooming?.status !== 'in_room' ? (
                      <button
                        type="button"
                        onClick={() => setRooming(r.id)}
                        className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-blue-600/30 px-2 text-[11px] font-semibold text-blue-600 hover:bg-blue-600/5 md:min-h-8"
                      >
                        <ClipboardCheck size={12} /> {r.rooming ? 'Rooming' : 'Room patient'}
                      </button>
                    ) : null}
                    {r.clientId && !r.locked ? (
                      <StartVisitButton
                        target="medical"
                        size="xs"
                        appointment={{ id: r.id, clientId: r.clientId, startsAt: r.startsAt, isVirtual: r.isVirtual, type: r.visitType, status: r.status }}
                      />
                    ) : null}
                    {r.href && (
                      <Link
                        href={r.href}
                        aria-label={`Open chart for ${r.patient}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:h-8 md:w-8"
                      >
                        <ArrowRight size={16} />
                      </Link>
                    )}
                  </div>
                </div>
              ))}
              {data?.today.truncated && (
                <p className="p-3 text-center text-xs text-slate-500">Showing the first {data.today.total} appointments.</p>
              )}
            </div>
          </section>

          {isPrimaryCareProvider(role) ? <ProviderInBasket /> : null}
          {isMedicalAssistant(role) ? <MaWorklist /> : null}

          {/* Work queues */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-base font-semibold text-slate-900">Work queues</h2>
            {loading && !data && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
            {data && data.queues.length === 0 && <p className="mt-3 text-sm text-slate-500">No work queues for your role.</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {data?.queues.map((q) => {
                const Icon = QUEUE_ICON[q.key] ?? ClipboardList;
                const urgent = q.key === 'labs_critical' && q.count > 0;
                return (
                  <Link
                    key={q.key}
                    href={q.href}
                    className={`flex items-start justify-between gap-3 rounded-xl border p-4 transition hover:shadow-sm ${
                      urgent ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50 hover:bg-brand-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon size={18} className={urgent ? 'text-rose-600' : 'text-blue-600'} />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{q.label}</p>
                        {q.detail && <p className="mt-0.5 text-xs text-slate-500">{q.detail}</p>}
                      </div>
                    </div>
                    <span className={`text-2xl font-semibold ${urgent ? 'text-rose-700' : 'text-slate-900'}`}>{q.count}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          {/* Panel summary */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Users size={18} className="text-blue-600" /> Panel
            </h2>
            {data ? (
              <>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active</dt>
                    <dd className="text-2xl font-semibold text-slate-900">{data.panel.active}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">New this month</dt>
                    <dd className="text-2xl font-semibold text-slate-900">{data.panel.newThisMonth}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Seen {data.panel.seenWindowDays} days</dt>
                    <dd className="text-2xl font-semibold text-slate-900">{data.panel.seenRecently}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] text-slate-500">
                  New this month: added through primary care intake. Seen: a primary care visit in the last{' '}
                  {data.panel.seenWindowDays} days.
                </p>
                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Active by location</h3>
                {data.panel.byLocation.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No active primary care patients.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {data.panel.byLocation.map((l) => (
                      <li key={l.locationId ?? 'none'} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-slate-700">
                          <MapPin size={13} className="text-slate-500" /> {l.name}
                        </span>
                        <span className="font-semibold text-slate-900">{l.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">{loading ? 'Loading…' : 'Not available.'}</p>
            )}
          </section>

          {/* Leadership edits; a primary care provider sees it to approve standing orders as Medical Director (server checks the flag) */}
          {canManagePrimaryCareSettings(role) || isPrimaryCareProvider(role) ? <PrimaryCareSettingsCard /> : null}

          {/* Quick actions */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Quick actions</h2>
            <div className="mt-3 space-y-2">
              {actions.map((a) => (
                <Link
                  key={a.label}
                  href={a.href}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm font-semibold text-slate-800 transition hover:bg-brand-50 hover:text-blue-700"
                >
                  <span className="flex items-center gap-2">
                    <a.icon size={15} /> {a.label}
                  </span>
                  <ArrowRight size={14} />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
