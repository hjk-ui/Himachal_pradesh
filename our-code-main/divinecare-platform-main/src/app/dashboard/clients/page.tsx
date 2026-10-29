'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CalendarDays,
  Clock3,
  FileText,
  Flame,
  LayoutGrid,
  List,
  Lock,
  Plus,
  Pencil,
  Search,
  Shuffle,
  TrendingDown,
  TrendingUp,
  Activity,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import { ClientIntakeModal, EditClientModal, useClients, type Client } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { isCaseloadRole } from '@/types/roles';
import { canAssignPatientToClinician, canEditClientProfile } from '@/lib/clients/orgScope';
import { useLocation } from '@/context/LocationContext';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { PatientBulkTransfer } from '@/features/clients/components/PatientBulkTransfer';
import { apiJson } from '@/lib/api-client';
import { isRowClickTarget } from '@/lib/layout/tableLayout';
import { chartHref } from '@/lib/clients/rowActions';
import { CareTeamSummary } from '@/components/clients/CareTeamSummary';
import { RowActionsMenu } from '@/components/clients/RowActionsMenu';
import {
  CaseloadAnalyticsView,
  WarmHandoffModal,
  INITIAL_STAFF_MEMBERS,
  staffUserToStaffMember,
  getVisibleClientsForUser,
  isClientOnWaitlist,
  FrequencyChip,
  getSuggestedFrequency,
  isOnMyCaseload,
} from '@/features/caseload';

const RISK_BADGE = {
  high: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  low: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
} as const;

function barTone(value: number | null, invert = false) {
  const v = value ?? 0;
  const bad = invert ? v >= 7 : v <= 3;
  const mid = invert ? v >= 4 && v <= 6 : v >= 4 && v <= 6;
  if (bad) return { bar: 'bg-rose-500', text: 'text-rose-600', bg: 'bg-rose-50', icon: 'text-rose-600' };
  if (mid) return { bar: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', icon: 'text-amber-600' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', icon: 'text-emerald-600' };
}

function MetricCell({
  label,
  value,
  max = 10,
  invert,
  icon,
}: {
  label: string;
  value: number | null;
  max?: number;
  invert?: boolean;
  icon: React.ReactNode;
}) {
  const tone = barTone(value, invert);
  const pct = Math.max(0, Math.min(100, ((value ?? 0) / max) * 100));
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.bg} ${tone.icon}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className={`text-sm font-bold tabular-nums ${tone.text}`}>
            {value == null ? '—' : `${value}/${max}`}
          </p>
          <p className="text-[11px] font-medium text-slate-400">{label}</p>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Unassigned for Assign Clinician CTA: no primary therapist AND no prescriber. */
function isUnassignedForAssignCta(client: Client): boolean {
  const team = client.treatmentTeam;
  return !team?.primaryTherapistId && !team?.prescriberId;
}

/** "1990-04-02" -> "04/02/1990" without timezone drift. */
function formatDob(dob?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '—';
}

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'] as const;

/** A-Z for the first letter of the name, "#" for anything else. */
function letterOf(name: string): string {
  const ch = (name || '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

const SENSITIVE_REASON_LABEL: Record<string, string> = {
  employee: 'Employee',
  vip: 'VIP',
  legal: 'Legal',
  other: 'Protected',
};

function ProtectedClientCard({
  client,
  onBreakGlass,
}: {
  client: Client;
  onBreakGlass: (c: Client) => void;
}) {
  const reason = client.sensitiveReason || 'other';
  return (
    <article className="relative flex flex-col rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/80 to-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <Lock size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-slate-900">{client.name || 'Protected Client'}</p>
          <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200">
            {SENSITIVE_REASON_LABEL[reason] || reason}
          </span>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            PHI is restricted. Request break-the-glass access (24 hours) if clinically necessary. This
            action is audited under HIPAA.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onBreakGlass(client)}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-700 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-800"
      >
        <Lock size={13} />
        Break the Glass
      </button>
    </article>
  );
}

function BreakGlassModal({
  client,
  open,
  onClose,
  onGranted,
}: {
  client: Client | null;
  open: boolean;
  onClose: () => void;
  onGranted: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open || !client) return null;

  const submit = async () => {
    if (reason.trim().length < 15) {
      toast.error('Reason must be at least 15 characters');
      return;
    }
    setBusy(true);
    try {
      await apiJson(`/api/sensitive-records/${client.id}/break-glass`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast.success('Break-the-glass granted for 24 hours');
      onGranted();
      onClose();
      setReason('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-amber-100 bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Break the Glass</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Emergency access to {client.name || 'protected client'} — expires in 24 hours.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>
        <label className="block text-xs font-bold text-slate-600">
          Clinical / emergency reason (min 15 characters)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
            placeholder="Describe why emergency PHI access is required…"
          />
        </label>
        <p className="mt-2 text-[11px] text-amber-800">
          Your name, timestamp, and reason will be written to the sensitive-access audit log.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            Confirm access
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientGridCard({
  client,
  canIntake,
  canAssignTeam,
  canEdit,
  canSetPcp,
  onOpenHandoff,
  onEditClient,
  onPcpSet,
}: {
  client: Client;
  canIntake: boolean;
  canAssignTeam: boolean;
  canEdit: boolean;
  canSetPcp: boolean;
  onOpenHandoff: (c: Client) => void;
  onEditClient: (c: Client) => void;
  onPcpSet: () => void;
}) {
  const moodLow = (client.avgMood ?? 5) <= 3;
  const dx = client.diagnosis || client.primaryDiagnosis || 'Diagnosis pending';
  const unassigned = isUnassignedForAssignCta(client);

  return (
    <article className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-purple-300 hover:shadow-md sm:p-5">
      <div className="flex items-start gap-3">
        <ClientAvatar name={client.name} image={client.image} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/dashboard/clients/${client.id}`}
                className="block truncate text-[15px] font-bold text-slate-900 hover:text-[#5C2D91]"
              >
                {client.name}
              </Link>
              {client.mrn ? (
                <p className="mt-0.5 font-mono text-[11px] font-semibold tracking-wide text-slate-500">
                  MRN {client.mrn}
                </p>
              ) : null}
              <p className="mt-0.5 truncate text-xs text-slate-500 font-medium" title={dx}>
                {dx}
              </p>
              <div className="mt-1.5">
                <CareTeamSummary
                  clientId={client.id}
                  treatmentTeam={client.treatmentTeam}
                  assignedToId={client.assignedToId}
                  assignedToName={client.assignedToName}
                  assignedToRole={client.assignedToRole}
                  seenBy={client.seenBy}
                  canSetPcp={canSetPcp}
                  onPcpSet={onPcpSet}
                />
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${
                RISK_BADGE[client.risk.toLowerCase() as keyof typeof RISK_BADGE] || 'bg-slate-100 text-slate-700'
              }`}
            >
              {client.risk}
            </span>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        <MetricCell
          label="Mood"
          value={client.avgMood}
          invert={false}
          icon={moodLow ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
        />
        <MetricCell
          label="Stress"
          value={client.avgStress}
          invert
          icon={<Activity size={14} />}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
              <Flame size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold tabular-nums text-slate-800">{client.streak || 0}d</p>
              <p className="text-[11px] font-medium text-slate-400">Streak</p>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-orange-400"
              style={{ width: `${Math.min(100, (client.streak || 0) * 8)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Check-in & Appointment info */}
      <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <p className="flex items-center gap-1.5">
          <Clock3 size={13} className="shrink-0 text-slate-400" />
          Last check-in: {client.lastCheckIn || '—'}
        </p>
        <p className="flex items-center gap-1.5">
          <FileText size={13} className="shrink-0 text-slate-400" />
          {client.totalSessions || 0} sessions total
        </p>
        {client.nextAppointment ? (
          <p className="flex items-center gap-1.5 font-semibold text-teal-700">
            <CalendarDays size={13} className="shrink-0 text-teal-600" />
            Next: {client.nextAppointment}
          </p>
        ) : null}
      </div>

      {/* Clinical Frequency Recommendation */}
      <div className="mt-3.5">
        <FrequencyChip client={client} showRationale={true} />
      </div>

      {/* Action Footer */}
      <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3">
        {canAssignTeam && unassigned ? (
          <button
            type="button"
            onClick={() => onOpenHandoff(client)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-95"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
          >
            <Shuffle size={12} />
            Assign Clinician
          </button>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          {canAssignTeam && !unassigned ? (
            <button
              type="button"
              onClick={() => onOpenHandoff(client)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91] opacity-0 transition group-hover:opacity-100 hover:text-[#4A2475]"
            >
              <Shuffle size={12} />
              Warm Handoff / Transfer Team
            </button>
          ) : (
            <span />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {canEdit && (
              <button
                type="button"
                onClick={() => onEditClient(client)}
                className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:text-purple-700 hover:bg-purple-50 transition"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
            <Link
              href={`/dashboard/clients/${client.id}`}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-[#5C2D91] hover:bg-purple-50"
            >
              View Chart
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

const RISK_FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'high' as const, label: 'High risk' },
  { value: 'medium' as const, label: 'Medium risk' },
  { value: 'low' as const, label: 'Low risk' },
];

export default function ClientsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { activeLocationId, isAllLocations, activeLocation } = useLocation();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    clients: apiClients,
    total: apiTotal,
    page: currentPage,
    totalPages,
    goToPage,
    loading,
    error,
    reload,
    addClient,
  } = useClients({ search: debouncedSearch, limit: 250 });

  const [clientList, setClientList] = useState<Client[]>([]);
  const [staffList, setStaffList] = useState<typeof INITIAL_STAFF_MEMBERS>([]);
  const [clinicianFilter, setClinicianFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'caseload'>('grid');
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [handoffModalOpen, setHandoffModalOpen] = useState(false);
  const [selectedHandoffClient, setSelectedHandoffClient] = useState<Client | null>(null);
  const [btgClient, setBtgClient] = useState<Client | null>(null);
  const [letterFilter, setLetterFilter] = useState<string>('all');
  const [myCaseloadOnly, setMyCaseloadOnly] = useState(false);
  const [caseloadCounts, setCaseloadCounts] = useState<{
    all: number;
    mine: number;
    unassigned: number;
  } | null>(null);

  // Counts only (no PHI) — same scoping as the list, so pills match rows.
  useEffect(() => {
    let cancelled = false;
    const qs = !isAllLocations && activeLocationId ? `?locationId=${encodeURIComponent(activeLocationId)}` : '';
    apiJson<{ counts: { all: number; mine: number; unassigned: number } }>(
      `/api/clients/caseload-counts${qs}`
    )
      .then((res) => {
        if (!cancelled) setCaseloadCounts(res.counts);
      })
      .catch(() => {
        if (!cancelled) setCaseloadCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLocationId, isAllLocations, apiClients]);

  // Load real clinic clinicians from staff directory
  useEffect(() => {
    async function loadDirectoryStaff() {
      try {
        const res = await fetch('/api/staff/directory');
        const data = await res.json();
        if (data.success && Array.isArray(data.users) && data.users.length > 0) {
          const mapped = data.users.map((u: any) => staffUserToStaffMember(u));
          setStaffList(mapped);
        }
      } catch (err) {
        console.error('Failed to load clinic staff directory:', err);
      }
    }
    void loadDirectoryStaff();
  }, []);

  // Sync API clients — database is source of truth (including empty roster)
  useEffect(() => {
    if (loading) return;
    setClientList(
      apiClients.map((c) => ({
        ...c,
        diagnosis: c.diagnosis || c.primaryDiagnosis || undefined,
        insuranceType: c.insuranceType || c.insurancePayer || undefined,
        treatmentTeam:
          c.treatmentTeam && typeof c.treatmentTeam === 'object'
            ? (c.treatmentTeam as Client['treatmentTeam'])
            : undefined,
        hieLastQueryAt: c.hieLastQueryAt ?? null,
      }))
    );
  }, [apiClients, loading]);

  const isAdmin =
    user?.role === 'ADMIN' ||
    user?.role === 'DIRECTOR' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.baseRole === 'ADMIN';

  /** Assign Clinician / Warm Handoff — must match API canAssignPatientToClinician */
  const canAssignTeam = canAssignPatientToClinician(user?.role);

  const canIntake =
    isAdmin ||
    user?.role === 'FRONT_DESK' ||
    user?.role === 'OFFICE_MANAGER' ||
    isCaseloadRole(user?.role);
  const canBulkTransfer = isAdmin || user?.role === 'OFFICE_MANAGER';
  const canEdit = canEditClientProfile(user?.role);

  // Apply RBAC and Supervision Visibility
  const visibleClients = useMemo(() => {
    return getVisibleClientsForUser(user as any, clientList, staffList);
  }, [user, clientList, staffList]);

  // Subtitle metrics
  const totalCount = visibleClients.length;
  const highRiskCount = useMemo(
    () => visibleClients.filter((c) => (c.risk || '').toLowerCase() === 'high').length,
    [visibleClients]
  );
  const waitlistCount = useMemo(
    () => visibleClients.filter(isClientOnWaitlist).length,
    [visibleClients]
  );

  // Filtered clients
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return visibleClients.filter((c) => {
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.mrn || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.diagnosis || '').toLowerCase().includes(q) ||
        (c.primaryDiagnosis || '').toLowerCase().includes(q) ||
        (c.insurancePayer || '').toLowerCase().includes(q) ||
        (c.sensitiveReason || '').toLowerCase().includes(q);

      const matchRisk = riskFilter === 'all' || (c.risk || '').toLowerCase() === riskFilter;

      let matchClinician = true;
      if (clinicianFilter !== 'all') {
        const team = c.treatmentTeam;
        matchClinician =
          team?.primaryTherapistId === clinicianFilter ||
          team?.prescriberId === clinicianFilter ||
          team?.caseManagerId === clinicianFilter ||
          team?.prpSpecialistId === clinicianFilter ||
          team?.peerSupportId === clinicianFilter ||
          (c as any).assignedToId === clinicianFilter;
      }

      let matchLocation = true;
      if (!isAllLocations) {
        const loc = (c as any).primaryLocationId || (c as any).primary_location_id || (c as any).locationId;
        matchLocation = loc === activeLocationId || !loc;
      }

      const matchLetter = letterFilter === 'all' || letterOf(c.name) === letterFilter;
      const matchMine = !myCaseloadOnly || isOnMyCaseload(c, user?.id);

      return (
        matchSearch && matchRisk && matchClinician && matchLocation && matchLetter && matchMine
      );
    });
  }, [
    visibleClients,
    search,
    riskFilter,
    clinicianFilter,
    activeLocationId,
    isAllLocations,
    letterFilter,
    myCaseloadOnly,
    user?.id,
  ]);

  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    for (const c of visibleClients) set.add(letterOf(c.name));
    return set;
  }, [visibleClients]);

  const paginationRange = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | '...')[] = [];
    pages.push(1);

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);

    return pages;
  }, [currentPage, totalPages]);

  const handlePageChange = (newPage: number) => {
    goToPage(newPage);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleOpenHandoff = (c: Client) => {
    setSelectedHandoffClient(c);
    setHandoffModalOpen(true);
  };

  const handleHandoffComplete = (updatedClient: Client) => {
    setClientList((prev) =>
      prev.map((c) => (c.id === updatedClient.id ? updatedClient : c))
    );
    void reload();
  };

  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const handleOpenEdit = (c: Client) => {
    setEditingClient(c);
    setEditModalOpen(true);
  };

  const handleEditComplete = (updated: Partial<Client>) => {
    setClientList((prev) =>
      prev.map((c) => (c.id === updated.id ? ({ ...c, ...updated } as Client) : c))
    );
    void reload();
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <Toaster position="top-right" />

      {/* Client Intake Modal */}
      <ClientIntakeModal
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        onSubmit={addClient}
      />

      {/* Edit Client Profile Modal */}
      <EditClientModal
        open={editModalOpen}
        client={editingClient}
        onClose={() => {
          setEditModalOpen(false);
          setEditingClient(null);
        }}
        onUpdated={handleEditComplete}
      />

      {/* 3-Step Warm Clinical Handoff Wizard */}
      <WarmHandoffModal
        open={handoffModalOpen}
        client={selectedHandoffClient}
        staffList={staffList}
        allClients={clientList}
        onClose={() => {
          setHandoffModalOpen(false);
          setSelectedHandoffClient(null);
        }}
        onHandoffComplete={handleHandoffComplete}
      />

      <BreakGlassModal
        open={Boolean(btgClient)}
        client={btgClient}
        onClose={() => setBtgClient(null)}
        onGranted={() => void reload()}
      />

      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
            Client Directory & Caseloads
          </h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            {isAdmin ? (
              <>
                <span className="font-bold text-slate-800">
                  {apiTotal > 0 ? apiTotal.toLocaleString() : totalCount}
                </span>{' '}
                total clients
                {totalPages > 1 && (
                  <span className="text-slate-400">
                    {' '}· Page {currentPage} of {totalPages} ({clientList.length} shown)
                  </span>
                )}{' '}
                · <span className="font-bold text-amber-600">{waitlistCount}</span> on current page waitlist
              </>
            ) : (
              <>
                <span className="font-bold text-slate-800">
                  {apiTotal > 0 ? apiTotal.toLocaleString() : totalCount}
                </span>{' '}
                in your caseload
                {totalPages > 1 && (
                  <span className="text-slate-400">
                    {' '}· Page {currentPage} of {totalPages}
                  </span>
                )}{' '}
                · <span className="font-bold text-rose-600">{highRiskCount}</span> high risk
              </>
            )}
          </p>
        </div>

        {canIntake ? (
          <button
            type="button"
            onClick={() => setIntakeOpen(true)}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-bold text-white shadow-sm transition hover:opacity-95 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
          >
            <Plus size={16} />
            New Intake
          </button>
        ) : null}
      </div>

      {/* Top Session Frequency Compliance Alert Banner */}
      {(isAdmin || isCaseloadRole(user?.role)) && (
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
              <AlertTriangle size={18} />
            </span>
            <div>
              <p className="text-sm font-bold text-rose-900">
                Session Frequency Alert — <span className="text-rose-700">2 clients overdue</span> (high risk, past 2× window) · 4 clients past recommended window
              </p>
              <p className="mt-0.5 text-xs text-rose-700/80">
                APA Practice Guidelines recommend safety planning and cadence re-alignment for off-track clients.
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/alerts"
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-xl bg-rose-600 px-4 text-xs font-bold text-white shadow-xs transition hover:bg-rose-700 active:scale-[0.98]"
          >
            View Alerts &rarr;
          </Link>
        </div>
      )}

      {canBulkTransfer ? <PatientBulkTransfer onImported={reload} /> : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Controls Toolbar: Search + Clinician dropdown + Risk filter + View mode */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            {/* Search input */}
            <label className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, MRN, email, diagnosis…"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/80 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#5C2D91] focus:bg-white focus:ring-2 focus:ring-[#5C2D91]/15"
              />
            </label>

            {/* Admin-only Clinician Filter Dropdown */}
            {isAdmin && (
              <div className="relative">
                <select
                  value={clinicianFilter}
                  onChange={(e) => setClinicianFilter(e.target.value)}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-[#5C2D91]"
                >
                  <option value="all">All Clinicians ({clientList.length})</option>
                  {staffList
                    .filter((s) => s.role !== 'admin' && s.role !== 'office_manager')
                    .map((staff) => {
                      const count = clientList.filter(
                        (c) =>
                          c.treatmentTeam?.primaryTherapistId === staff.id ||
                          c.treatmentTeam?.prescriberId === staff.id ||
                          c.treatmentTeam?.caseManagerId === staff.id ||
                          c.treatmentTeam?.prpSpecialistId === staff.id ||
                          c.treatmentTeam?.peerSupportId === staff.id ||
                          (c as any).assignedToId === staff.id
                      ).length;
                      return (
                        <option key={staff.id} value={staff.id}>
                          {staff.name} ({count})
                        </option>
                      );
                    })}
                </select>
              </div>
            )}

            {/* Risk filter pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMyCaseloadOnly((v) => !v)}
                aria-pressed={myCaseloadOnly}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition sm:text-[13px] ${
                  myCaseloadOnly
                    ? 'bg-[#5C2D91] text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-purple-200 hover:text-[#5C2D91]'
                }`}
              >
                My caseload
                {caseloadCounts ? (
                  <span className="tabular-nums opacity-80">{caseloadCounts.mine}</span>
                ) : null}
              </button>
              {RISK_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setRiskFilter(f.value)}
                  className={`inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-xs font-bold transition sm:text-[13px] ${
                    riskFilter === f.value
                      ? 'bg-[#5C2D91] text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-purple-200 hover:text-[#5C2D91]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* View Mode Toggle: Grid, Table, Caseload Analytics (Admin only) */}
            <div className="flex overflow-hidden rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Grid View"
                className={`flex h-10 items-center gap-1.5 px-3 text-xs font-bold transition ${
                  viewMode === 'grid'
                    ? 'bg-[#5C2D91] text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <LayoutGrid size={15} />
                <span className="hidden sm:inline">Grid</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                title="Table View"
                className={`flex h-10 items-center gap-1.5 border-l border-slate-200 px-3 text-xs font-bold transition ${
                  viewMode === 'table'
                    ? 'bg-[#5C2D91] text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <List size={15} />
                <span className="hidden sm:inline">Table</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setViewMode('caseload')}
                  title="Caseload Analytics View"
                  className={`flex h-10 items-center gap-1.5 border-l border-slate-200 px-3 text-xs font-bold transition ${
                    viewMode === 'caseload'
                      ? 'bg-[#5C2D91] text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <BarChart2 size={15} />
                  <span className="hidden sm:inline">Caseload Analytics</span>
                </button>
              )}
            </div>
          </div>

          {/* Letter bar: A-Z + # */}
          <nav aria-label="Filter clients by first letter" className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setLetterFilter('all')}
              aria-pressed={letterFilter === 'all'}
              className={`min-h-8 rounded-md px-2.5 text-xs font-bold transition ${
                letterFilter === 'all'
                  ? 'bg-[#5C2D91] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              All
            </button>
            {LETTERS.map((l) => {
              const has = availableLetters.has(l);
              return (
                <button
                  key={l}
                  type="button"
                  disabled={!has}
                  onClick={() => setLetterFilter(letterFilter === l ? 'all' : l)}
                  aria-pressed={letterFilter === l}
                  className={`min-h-8 min-w-8 rounded-md px-1.5 text-xs font-bold transition ${
                    letterFilter === l
                      ? 'bg-[#5C2D91] text-white'
                      : has
                        ? 'text-slate-700 hover:bg-purple-50 hover:text-[#5C2D91]'
                        : 'cursor-not-allowed text-slate-300'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main View Area */}
      {viewMode === 'caseload' && isAdmin ? (
        <CaseloadAnalyticsView
          clients={clientList}
          staffList={staffList}
          onOpenHandoff={handleOpenHandoff}
        />
      ) : loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-base font-bold text-slate-900">Loading clients from database…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-base font-bold text-slate-900">
            {clientList.length === 0
              ? 'No clients in your clinic yet'
              : 'No clients match your filters'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {clientList.length === 0
              ? 'New intakes and clients save to your organization database only.'
              : 'Try clearing search, risk, or clinician filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {viewMode === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((c) =>
                c.isSensitive && c.canAccessSensitive === false ? (
                  <ProtectedClientCard
                    key={c.id}
                    client={c}
                    onBreakGlass={(client) => setBtgClient(client)}
                  />
                ) : (
                  <ClientGridCard
                    key={c.id}
                    client={c}
                    canIntake={!!canIntake}
                    canAssignTeam={canAssignTeam}
                    canEdit={canEdit && (!isCaseloadRole(user?.role) || c.assignedToId === user?.id)}
                    canSetPcp={canEdit}
                    onOpenHandoff={handleOpenHandoff}
                    onEditClient={handleOpenEdit}
                    onPcpSet={() => void reload()}
                  />
                )
              )}
            </div>
          ) : (
            /* Table View */
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5 sm:px-5">Name / MRN</th>
                      <th className="px-4 py-2.5 sm:px-5">DOB</th>
                      <th className="px-4 py-2.5 sm:px-5">Clinician / location</th>
                      <th className="px-4 py-2.5 sm:px-5">Risk</th>
                      <th className="px-4 py-2.5 sm:px-5">Next Appt</th>
                      <th className="px-4 py-2.5 text-right sm:px-5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map((c) =>
                      c.isSensitive && c.canAccessSensitive === false ? (
                        <tr key={c.id} className="bg-amber-50/50">
                          <td className="px-4 py-2.5 sm:px-5" colSpan={5}>
                            <div className="flex items-center gap-3">
                              <Lock size={16} className="text-amber-700" />
                              <div>
                                <p className="font-bold text-slate-900">{c.name || 'Protected Client'}</p>
                                <p className="text-xs text-amber-800">
                                  {SENSITIVE_REASON_LABEL[c.sensitiveReason || 'other'] ||
                                    c.sensitiveReason}{' '}
                                  · PHI locked
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right sm:px-5">
                            <button
                              type="button"
                              onClick={() => setBtgClient(c)}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white"
                            >
                              Break the Glass
                            </button>
                          </td>
                        </tr>
                      ) : (
                      <tr
                        key={c.id}
                        onClick={(e) => {
                          if (isRowClickTarget(e.target)) router.push(chartHref(c.id));
                        }}
                        className="group cursor-pointer transition hover:bg-slate-50/80"
                      >
                        <td className="sticky left-0 z-10 bg-white px-4 py-2.5 group-hover:bg-slate-50 sm:px-5">
                          <div className="flex items-center gap-3">
                            <ClientAvatar name={c.name} image={c.image} size="md" />
                            <div className="min-w-0">
                              <Link
                                href={`/dashboard/clients/${c.id}`}
                                className="block max-w-[220px] truncate font-bold text-slate-900 hover:text-[#5C2D91]"
                              >
                                {c.name}
                              </Link>
                              <p className="truncate font-mono text-[11px] font-semibold text-slate-500">
                                {c.mrn ? `MRN ${c.mrn}` : '—'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs font-medium tabular-nums text-slate-600 sm:px-5">
                          {formatDob(c.dateOfBirth)}
                        </td>
                        <td className="px-4 py-2.5 sm:px-5">
                          <CareTeamSummary
                            clientId={c.id}
                            treatmentTeam={c.treatmentTeam}
                            assignedToId={c.assignedToId}
                            assignedToName={c.assignedToName}
                            assignedToRole={c.assignedToRole}
                            seenBy={c.seenBy}
                            canSetPcp={canEdit}
                            onPcpSet={() => void reload()}
                            maxChips={2}
                          />
                          <p className="truncate text-[11px] font-medium text-slate-400">
                            {c.locationName || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 sm:px-5">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${
                              RISK_BADGE[c.risk.toLowerCase() as keyof typeof RISK_BADGE] || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {c.risk}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-teal-700 font-semibold sm:px-5">
                          {c.nextAppointment || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right sm:px-5">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={chartHref(c.id)}
                              className="inline-flex min-h-10 items-center gap-0.5 rounded-lg px-2 text-xs font-bold text-[#5C2D91] hover:underline md:min-h-8"
                            >
                              View
                              <ArrowRight size={13} />
                            </Link>
                            <RowActionsMenu
                              clientId={c.id}
                              clientName={c.name}
                              unassigned={isUnassignedForAssignCta(c)}
                              canAssignTeam={canAssignTeam}
                              canEditRow={canEdit && (!isCaseloadRole(user?.role) || c.assignedToId === user?.id)}
                              onHandoff={() => handleOpenHandoff(c)}
                              onEdit={() => handleOpenEdit(c)}
                            />
                          </div>
                        </td>
                      </tr>
                      )
                    )}
                  </tbody></table>
              </div>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-semibold text-slate-500">
                Showing{' '}
                <span className="font-bold text-slate-900">
                  {((currentPage - 1) * 250 + 1).toLocaleString()}
                </span>
                –
                <span className="font-bold text-slate-900">
                  {Math.min(currentPage * 250, apiTotal).toLocaleString()}
                </span>{' '}
                of <span className="font-bold text-slate-900">{apiTotal.toLocaleString()}</span> clients
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/* First page */}
                <button
                  type="button"
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage <= 1 || loading}
                  title="First Page"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronsLeft size={16} />
                </button>

                {/* Previous page */}
                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                  <span className="hidden sm:inline">Prev</span>
                </button>

                {/* Page number pills */}
                {paginationRange.map((p, idx) =>
                  p === '...' ? (
                    <span key={`dots-${idx}`} className="px-2 text-xs font-bold text-slate-400">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePageChange(p)}
                      disabled={loading}
                      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-xl px-2.5 text-xs font-bold transition ${
                        currentPage === p
                          ? 'bg-[#5C2D91] text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-purple-200 hover:text-[#5C2D91]'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}

                {/* Next page */}
                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || loading}
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight size={16} />
                </button>

                {/* Last page */}
                <button
                  type="button"
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage >= totalPages || loading}
                  title="Last Page"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronsRight size={16} />
                </button>

                {/* Quick Jump */}
                {totalPages > 5 && (
                  <div className="flex items-center gap-1.5 pl-2 text-xs font-medium text-slate-500">
                    <span className="hidden md:inline">Go to:</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      defaultValue={currentPage}
                      key={currentPage}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = parseInt((e.target as HTMLInputElement).value, 10);
                          if (!isNaN(val) && val >= 1 && val <= totalPages) {
                            handlePageChange(val);
                          }
                        }
                      }}
                      className="h-9 w-14 rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-xs font-bold text-slate-800 outline-none focus:border-[#5C2D91] focus:bg-white"
                      title="Press Enter to jump"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
