'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Shield } from 'lucide-react';
import type { Client, StaffMember, TreatmentTeam } from '@/features/clients/types';
import { groupProviders } from '@/features/appointments/providerGroups';
import { caseloadAcuity, caseloadHeadcount, type StaffCaseloadCount } from '@/lib/clients/caseloadCounts';
import { calculateSafeAcuityCeiling, getDaysUntilLicenseExpiry, getThresholdStatus, isLicenseExpiringSoon } from '../algorithms';
import { useCaseloadCounts } from '../useCaseloadCounts';

export interface CaseloadAnalyticsViewProps {
  staffList: StaffMember[];
  onOpenHandoff: (client: Client, defaultRoleSlot?: keyof TreatmentTeam) => void;
  /** Session-frequency chip from the shared session-frequency data (omitted = not shown) */
  renderFrequency?: (client: Client) => React.ReactNode;
  /** The page's location selector (not the search box); undefined = all locations */
  locationId?: string;
  /** Switch the directory to the unassigned (waitlist) filter */
  onShowUnassigned?: () => void;
  /** Bump to refetch after a handoff */
  reloadKey?: number;
  /** Open the directory filtered to one clinician's clients */
  onShowClinician?: (staffId: string) => void;
}

/** Caseload roles shown as cards (StaffMember.role is lower-case) */
const CASELOAD_CARD_ROLES = new Set([
  'therapist',
  'clinician',
  'psychiatrist',
  'np',
  'physician',
  'medical_np',
  'case_manager',
  'prp_specialist',
  'peer_support',
]);

type ClientRowsState = { loading: boolean; error: string | null; clients: Client[]; total: number };

async function fetchClinicianClients(staffId: string, role: 'primary' | 'team', locationId?: string): Promise<{ clients: Client[]; total: number }> {
  const params = new URLSearchParams({
    clinicianId: staffId,
    clinicianRole: role,
    status: 'ACTIVE',
    sort: 'last',
    dir: 'asc',
    limit: '100',
    withTotal: '1',
  });
  if (locationId) params.set('locationId', locationId);
  const res = await fetch(`/api/clients?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.error || 'Could not load clients');
  return { clients: body.clients ?? [], total: typeof body.total === 'number' ? body.total : (body.clients ?? []).length };
}

function ClinicianClientList({
  staffId,
  role,
  locationId,
  label,
  onOpenHandoff,
  renderFrequency,
  onShowClinician,
}: {
  staffId: string;
  role: 'primary' | 'team';
  locationId?: string;
  label: string;
  onOpenHandoff: (client: Client) => void;
  renderFrequency?: (client: Client) => React.ReactNode;
  onShowClinician?: (staffId: string) => void;
}) {
  const [state, setState] = useState<ClientRowsState>({ loading: true, error: null, clients: [], total: 0 });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchClinicianClients(staffId, role, locationId)
      .then((r) => !cancelled && setState({ loading: false, error: null, clients: r.clients, total: r.total }))
      .catch((err: Error) => !cancelled && setState({ loading: false, error: err.message, clients: [], total: 0 }));
    return () => {
      cancelled = true;
    };
  }, [staffId, role, locationId]);

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label} {state.loading ? '' : `(${state.total.toLocaleString()})`}
      </p>
      {state.loading ? (
        <p className="flex items-center gap-1.5 py-1 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" aria-hidden /> Loading…
        </p>
      ) : state.error ? (
        <p className="text-xs text-rose-700">{state.error}</p>
      ) : state.clients.length === 0 ? (
        <p className="py-1 text-xs text-slate-500">None.</p>
      ) : (
        <>
          {state.clients.map((client) => (
            <div key={client.id} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 space-y-1 pr-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="min-w-0 max-w-full truncate font-bold text-slate-900">{client.name}</p>
                  {renderFrequency?.(client)}
                </div>
                <p className="truncate text-[11px] text-slate-500">{client.diagnosis || client.primaryDiagnosis || 'No Dx'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {client.canAccessSensitive !== false ? (
                  <button
                    type="button"
                    onClick={() => onOpenHandoff(client)}
                    className="inline-flex min-h-9 items-center rounded-lg border border-purple-200 bg-white px-2 font-semibold text-[#5C2D91] shadow-xs hover:bg-purple-50"
                  >
                    Transfer
                  </button>
                ) : null}
                <Link
                  href={`/dashboard/clients/${client.id}`}
                  className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-2 font-semibold text-slate-600 shadow-xs hover:bg-slate-100"
                >
                  View
                </Link>
              </div>
            </div>
          ))}
          {state.total > state.clients.length ? (
            <p className="pt-1 text-xs text-slate-600">
              Showing {state.clients.length} of {state.total.toLocaleString()}.{' '}
              {onShowClinician ? (
                <button type="button" onClick={() => onShowClinician(staffId)} className="font-bold text-blue-600 hover:underline">
                  Open the full list
                </button>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function UnassignedBanner({
  count,
  locationId,
  onOpenHandoff,
  onShowUnassigned,
}: {
  count: number;
  locationId?: string;
  onOpenHandoff: (client: Client, slot?: keyof TreatmentTeam) => void;
  onShowUnassigned?: () => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ unassigned: '1', status: 'ACTIVE', sort: 'last', dir: 'asc', limit: '12' });
    if (locationId) params.set('locationId', locationId);
    fetch(`/api/clients?${params}`)
      .then((r) => r.json())
      .then((body) => !cancelled && setClients(Array.isArray(body?.clients) ? body.clients : []))
      .catch(() => !cancelled && setClients([]));
    return () => {
      cancelled = true;
    };
  }, [locationId, count]);

  return (
    <div className="rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50/90 via-orange-50/50 to-amber-50/90 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
            <AlertTriangle size={20} aria-hidden />
          </span>
          <div>
            <h3 className="text-base font-bold text-amber-950">
              {count.toLocaleString()} active client{count === 1 ? '' : 's'} with no assigned clinician or care team
            </h3>
            <p className="mt-0.5 text-xs font-medium text-amber-800">
              No primary clinician on the chart and nobody on the care team.
            </p>
          </div>
        </div>
        {onShowUnassigned ? (
          <button
            type="button"
            onClick={onShowUnassigned}
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700"
          >
            Show all in the list
          </button>
        ) : null}
      </div>
      {clients.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-amber-200/60 pt-3">
          {clients
            .filter((c) => c.canAccessSensitive !== false)
            .map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => onOpenHandoff(client, 'primaryTherapistId')}
                className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 shadow-sm transition hover:bg-amber-100/60"
              >
                <span className="min-w-0 truncate">{client.name}</span>
                <span className="shrink-0 text-amber-600">Assign team</span>
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function barClass(p: number): string {
  return p > 85 ? 'bg-rose-500' : p >= 65 ? 'bg-amber-500' : 'bg-emerald-500';
}

/**
 * Caseload view. Every number comes from GET /api/clients/caseload-counts (all active clients in
 * scope, at the selected location) — never from the page of clients loaded in the directory.
 */
export function CaseloadAnalyticsView({
  staffList,
  onOpenHandoff,
  renderFrequency,
  locationId,
  onShowUnassigned,
  reloadKey,
  onShowClinician,
}: CaseloadAnalyticsViewProps) {
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);
  const { counts, unassigned, activeTotal, loading, error } = useCaseloadCounts({ locationId, reloadKey });

  const groups = useMemo(
    () => groupProviders(staffList.filter((s) => CASELOAD_CARD_ROLES.has(String(s.role).toLowerCase()))),
    [staffList]
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading caseload counts">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        ))}
      </div>
    );
  }
  if (error || !counts) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        Caseload counts could not be loaded{error ? `: ${error}` : ''}.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs font-medium text-slate-500">
        Counts cover all {activeTotal?.toLocaleString() ?? 0} active clients{locationId ? ' at the selected location' : ''}. Primary
        caseload = the chart&apos;s assigned clinician; also on care team = on the client&apos;s care team but not the primary.
      </p>

      {unassigned ? (
        <UnassignedBanner count={unassigned} locationId={locationId} onOpenHandoff={onOpenHandoff} onShowUnassigned={onShowUnassigned} />
      ) : null}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">No clinicians in the staff directory.</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{group.label}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((staff) => {
              const c: StaffCaseloadCount | undefined = counts[staff.id];
              const headcount = caseloadHeadcount(c);
              const max = staff.maxCaseload > 0 ? staff.maxCaseload : 25;
              const headcountPct = pct(headcount, max);
              const ceiling = calculateSafeAcuityCeiling(staff);
              const acuity = caseloadAcuity(c);
              const acuityPct = pct(acuity, ceiling);
              const { status } = getThresholdStatus(Math.max(headcountPct, acuityPct));
              const isExpiring = isLicenseExpiringSoon(staff.licenseExpiry);
              const daysExpiry = getDaysUntilLicenseExpiry(staff.licenseExpiry);
              const isExpanded = expandedStaffId === staff.id;
              const initials = staff.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2);
              return (
                <article
                  key={staff.id}
                  className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-purple-200 hover:shadow-md sm:p-5"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
                      style={{ backgroundColor: staff.color || '#5C2D91' }}
                      aria-hidden
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <h4 className="truncate text-base font-bold text-slate-900">{staff.name}</h4>
                          <p className="truncate text-xs font-semibold text-slate-500">
                            {staff.credential} · <span className="capitalize">{String(staff.role).replace(/_/g, ' ')}</span>
                          </p>
                        </div>
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            status === 'Near limit'
                              ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                              : status === 'Moderate'
                                ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        {staff.isSupervisee && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200">
                            <Shield size={12} className="text-amber-600" aria-hidden />
                            Supervised by {staff.supervisorName || 'Senior Clinician'}
                          </span>
                        )}
                        {isExpiring && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200">
                            <AlertTriangle size={12} aria-hidden />
                            License expires in {daysExpiry}d
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-center sm:grid-cols-4 md:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-2">
                      <dd className="text-lg font-bold tabular-nums text-slate-800">{c?.primary ?? 0}</dd>
                      <dt className="text-[11px] font-bold uppercase text-slate-500">Primary caseload</dt>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2">
                      <dd className="text-lg font-bold tabular-nums text-slate-800">{c?.careTeam ?? 0}</dd>
                      <dt className="text-[11px] font-bold uppercase text-slate-500">Also on care team</dt>
                    </div>
                    <div className="rounded-xl bg-rose-50/70 p-2">
                      <dd className="text-lg font-bold tabular-nums text-rose-600">{c?.highRisk ?? 0}</dd>
                      <dt className="text-[11px] font-bold uppercase text-rose-600">High risk (primary)</dt>
                    </div>
                    <div className="rounded-xl bg-teal-50/70 p-2">
                      <dd className="text-lg font-bold tabular-nums text-teal-700">{c?.upcomingAppointments ?? 0}</dd>
                      <dt className="text-[11px] font-bold uppercase text-teal-700">Upcoming appt (primary)</dt>
                    </div>
                  </dl>

                  <div className="mt-4 space-y-3 rounded-xl bg-slate-50/80 p-3.5">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs font-semibold">
                        <span className="text-slate-600">Headcount (primary + care team)</span>
                        <span className="tabular-nums text-slate-900">
                          {headcount} / {max} ({headcountPct}%)
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${barClass(headcountPct)}`} style={{ width: `${Math.min(100, headcountPct)}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs font-semibold">
                        <span className="text-slate-600">Acuity score</span>
                        <span className="tabular-nums text-slate-900">
                          {acuity} / {ceiling} pts ({acuityPct}%)
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${barClass(acuityPct)}`} style={{ width: `${Math.min(100, acuityPct)}%` }} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 pt-2 text-[11px] font-medium text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden />
                        {c?.highRisk ?? 0} High
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                        {c?.mediumRisk ?? 0} Med
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                        {c?.lowRisk ?? 0} Low
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedStaffId((curr) => (curr === staff.id ? null : staff.id))}
                      aria-expanded={isExpanded}
                      className="flex min-h-10 w-full items-center justify-between text-xs font-bold text-slate-600 hover:text-[#5C2D91]"
                    >
                      <span>Clients ({headcount})</span>
                      {isExpanded ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                    </button>
                    {isExpanded ? (
                      <div className="mt-2.5 space-y-3 border-t border-slate-100 pt-2">
                        <ClinicianClientList
                          staffId={staff.id}
                          role="primary"
                          locationId={locationId}
                          label="Primary caseload"
                          onOpenHandoff={onOpenHandoff}
                          renderFrequency={renderFrequency}
                          onShowClinician={onShowClinician}
                        />
                        <ClinicianClientList
                          staffId={staff.id}
                          role="team"
                          locationId={locationId}
                          label="Also on care team"
                          onOpenHandoff={onOpenHandoff}
                          renderFrequency={renderFrequency}
                          onShowClinician={onShowClinician}
                        />
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
