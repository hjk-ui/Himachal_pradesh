'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PRIMARY_CARE_LOCATION_NAMES, MEDICAL_PROGRAM } from '@/lib/medical/medicalProgram';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BarChart2,
  CalendarDays,
  Clock3,
  FileText,
  Filter,
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
} from 'lucide-react';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import { RowActionsMenu, type RowMenuAction } from '@/components/ui/RowActionsMenu';
import { isRowClickTarget } from '@/components/ui/rowClick';
import { ClientIntakeModal, EditClientModal, useClients, type Client } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { isCaseloadRole } from '@/types/roles';
import { medicalDirectorActive } from '@/lib/auth/medicalDirector';
import { canAssignPatientToClinician, canEditClientProfile, canSeeClientInsurance } from '@/lib/clients/orgScope';
import { canViewCaseloadCounts } from '@/lib/clients/caseloadCounts';
import {
  CLIENT_PAGE_SIZES,
  CLIENT_SORT_LABELS,
  DEFAULT_SORT_DIR,
  DEFAULT_VIEW_STATE,
  LETTERS,
  ageFromDob,
  listDisplayName,
  viewStateFromParams,
  viewStateToApiParams,
  viewStateToParams,
  type ClientListViewState,
  type ClientSortKey,
} from '@/lib/clients/listQuery';
import { groupProviders, providerGroupLabel } from '@/features/appointments/providerGroups';
import { formatDateOnly } from '@/lib/time/dateOnly';
import { formatPracticeDate } from '@/lib/time/practiceTime';
import { useLocation } from '@/context/LocationContext';
import toast from 'react-hot-toast';
import { PatientBulkTransfer } from '@/features/clients/components/PatientBulkTransfer';
import { CareTeamSummary } from '@/features/clients/components/CareTeamSummary';
import { careTeamIsUnassigned } from '@/lib/clients/careTeam';
import { apiJson } from '@/lib/api-client';
import {
  CaseloadAnalyticsView,
  WarmHandoffModal,
  INITIAL_STAFF_MEMBERS,
  staffUserToStaffMember,
  ROLE_COLORS,
  CadenceChip,
  useCaseloadCounts,
  useSessionFrequency,
  type SessionFrequencyItem,
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
  if (mid) return { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', icon: 'text-amber-700' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', icon: 'text-emerald-700' };
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
          <p className="text-[11px] font-medium text-slate-500">{label}</p>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Treatment team role slot chips */
function TreatmentTeamBadges({ team }: { team?: Client['treatmentTeam'] }) {
  if (!team || (!team.primaryTherapistId && !team.prescriberId && !team.caseManagerId && !team.prpSpecialistId && !team.peerSupportId)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
        No team — waitlist
      </span>
    );
  }

  const chips: Array<{ role: string; label: string; name?: string; color: string }> = [];

  if (team.primaryTherapistId) {
    chips.push({
      role: 'Therapist',
      label: 'Therapist',
      name: team.primaryTherapistName,
      color: ROLE_COLORS.primaryTherapistId,
    });
  }
  if (team.prescriberId) {
    chips.push({
      role: 'Prescriber',
      label: 'Prescriber',
      name: team.prescriberName,
      color: ROLE_COLORS.prescriberId,
    });
  }
  if (team.caseManagerId) {
    chips.push({
      role: 'Case Mgr',
      label: 'Case Mgr',
      name: team.caseManagerName,
      color: ROLE_COLORS.caseManagerId,
    });
  }
  if (team.prpSpecialistId) {
    chips.push({
      role: 'PRP',
      label: 'PRP',
      name: team.prpSpecialistName,
      color: ROLE_COLORS.prpSpecialistId,
    });
  }
  if (team.peerSupportId) {
    chips.push({
      role: 'Peer',
      label: 'Peer',
      name: team.peerSupportName,
      color: ROLE_COLORS.peerSupportId,
    });
  }

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip, idx) => (
        <span
          key={idx}
          title={chip.name ? `${chip.label}: ${chip.name}` : chip.label}
          className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white shadow-xs"
          style={{ backgroundColor: chip.color }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Unassigned for Assign Clinician CTA: no clinical primary and nobody else on the care team
 * (a non-clinical assignee counts as none). Legacy rows without careTeam: no therapist / prescriber slot.
 */
function isUnassignedForAssignCta(client: Client): boolean {
  if (client.careTeam !== undefined) return careTeamIsUnassigned(client.careTeam);
  const team = client.treatmentTeam;
  return !team?.primaryTherapistId && !team?.prescriberId;
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
    <article className="relative flex flex-col rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/80 to-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Lock size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-slate-900">{client.name || 'Protected Client'}</p>
          <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200">
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
      <div className="relative z-10 w-full max-w-md rounded-xl border border-amber-100 bg-white p-5 shadow-xl sm:p-6">
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
            aria-label="Close break the glass"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <X size={18} aria-hidden />
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
  onOpenHandoff,
  onEditClient,
  cadence,
  cadenceLoading,
  cadenceEnabled,
}: {
  client: Client;
  canIntake: boolean;
  canAssignTeam: boolean;
  canEdit: boolean;
  onOpenHandoff: (c: Client) => void;
  onEditClient: (c: Client) => void;
  cadence?: SessionFrequencyItem;
  cadenceLoading?: boolean;
  cadenceEnabled?: boolean;
}) {
  const moodLow = (client.avgMood ?? 5) <= 3;
  const dx = client.diagnosis || client.primaryDiagnosis || 'Diagnosis pending';
  const unassigned = isUnassignedForAssignCta(client);

  return (
    <article className="group relative flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-blue-300 hover:shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <ClientAvatar name={client.name} image={client.image} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/dashboard/clients/${client.id}`}
                className="block truncate text-[15px] font-bold text-slate-900 hover:text-blue-600"
              >
                {client.name}
              </Link>
              {client.mrn ? (
                <p className="mt-0.5 truncate font-mono text-[11px] font-semibold tracking-wide text-slate-500" title={`MRN ${client.mrn}`}>
                  MRN {client.mrn}
                </p>
              ) : null}
              <p className="mt-0.5 truncate text-xs text-slate-500 font-medium" title={dx}>
                {dx}
              </p>
              <div className="mt-1.5 min-w-0">
                {client.careTeam !== undefined ? (
                  <CareTeamSummary team={client.careTeam} variant="card" />
                ) : (
                  <TreatmentTeamBadges team={client.treatmentTeam} />
                )}
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <Flame size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold tabular-nums text-slate-800">{client.streak || 0}d</p>
              <p className="text-[11px] font-medium text-slate-500">Streak</p>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-amber-400"
              style={{ width: `${Math.min(100, (client.streak || 0) * 8)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Check-in & Appointment info */}
      <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <p className="flex items-center gap-1.5">
          <Clock3 size={13} className="shrink-0 text-slate-500" />
          Last check-in: {client.lastCheckIn || '—'}
        </p>
        <p className="flex items-center gap-1.5">
          <FileText size={13} className="shrink-0 text-slate-500" />
          {client.totalSessions || 0} sessions total
        </p>
        {client.nextAppointment ? (
          <p className="flex items-center gap-1.5 font-semibold text-sky-700">
            <CalendarDays size={13} className="shrink-0 text-sky-700" />
            Next: {client.nextAppointment}
          </p>
        ) : null}
      </div>

      {/* Session frequency: recommended (with source) vs attended — same data as the alert */}
      {cadenceEnabled ? (
        <div className="mt-3.5">
          <CadenceChip item={cadence} loading={cadenceLoading} showDetail={true} />
        </div>
      ) : null}

      {/* Action Footer */}
      <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3">
        {canAssignTeam && unassigned ? (
          <button
            type="button"
            onClick={() => onOpenHandoff(client)}
            className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-sm transition bg-blue-600 hover:bg-blue-700"
          >
            <Shuffle size={12} />
            Assign Clinician
          </button>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          {canAssignTeam && !unassigned ? (
            <button
              type="button"
              onClick={() => onOpenHandoff(client)}
              className="inline-flex min-h-10 items-center gap-1 text-left text-xs font-semibold text-blue-600 transition hover:text-blue-700 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
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
                className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:text-blue-700 hover:bg-blue-50 transition"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
            <Link
              href={`/dashboard/clients/${client.id}`}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-blue-600 hover:bg-blue-50"
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

const STORAGE_PREFIX = 'altrixs_client_list_view:';

type ViewMode = 'list' | 'grid' | 'caseload';

type DirectoryUser = { id: string; name?: string | null; email: string; role: string; status?: string };

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'last:asc', label: 'Last name A–Z' },
  { value: 'last:desc', label: 'Last name Z–A' },
  { value: 'first:asc', label: 'First name A–Z' },
  { value: 'first:desc', label: 'First name Z–A' },
  { value: 'mrn:asc', label: 'MRN' },
  { value: 'dob:asc', label: 'Date of birth (oldest first)' },
  { value: 'dob:desc', label: 'Date of birth (youngest first)' },
  { value: 'nextAppt:asc', label: 'Next appointment (soonest)' },
  { value: 'lastSeen:desc', label: 'Last seen (most recent)' },
  { value: 'lastSeen:asc', label: 'Last seen (longest ago)' },
  { value: 'added:desc', label: 'Date added (newest)' },
  { value: 'added:asc', label: 'Date added (oldest)' },
  { value: 'status:asc', label: 'Status' },
];

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  DISCHARGED: 'Discharged',
  ALL: 'All statuses',
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  INACTIVE: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  DISCHARGED: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
};

const PROGRAM_LABEL: Record<string, string> = {
  medical: 'Primary care (Family Practice)',
  prp: 'PRP',
  iop: 'IOP (mental health)',
  php: 'PHP',
};

const RISK_LABEL: Record<string, string> = { HIGH: 'High risk', MEDIUM: 'Medium risk', LOW: 'Low risk' };

const CONTROL =
  'h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600/30';
/** Filter selects: full width in the 2-up phone grid, at least 8.5rem once they flow inline (never squeezed unreadable). */
const FILTER_SELECT = `${CONTROL} w-full sm:w-auto sm:min-w-[8.5rem] sm:shrink-0`;

function riskBadgeClass(risk: string | undefined) {
  return RISK_BADGE[(risk || '').toLowerCase() as keyof typeof RISK_BADGE] || 'bg-slate-100 text-slate-700';
}

function formatSeen(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatPracticeDate(iso, undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function DobCell({ dob }: { dob?: string | null }) {
  if (!dob) return <span className="text-slate-400">—</span>;
  const age = ageFromDob(dob);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatDateOnly(dob, 'numeric')}
      {age !== null ? <span className="text-slate-500"> ({age})</span> : null}
    </span>
  );
}

function NameCell({ c, compact = false, showMrn = false }: { c: Client; compact?: boolean; showMrn?: boolean }) {
  const { primary, preferred } = listDisplayName(c);
  return (
    <div className="min-w-0">
      <Link
        href={`/dashboard/clients/${c.id}`}
        className={`block truncate font-bold text-slate-900 hover:text-blue-600 focus:outline-none focus-visible:underline ${compact ? 'text-[15px]' : ''}`}
      >
        {primary}
      </Link>
      {preferred ? <p className="truncate text-[11px] text-slate-500">Preferred: {preferred}</p> : null}
      {showMrn && c.mrn ? <p className="truncate font-mono text-[11px] text-slate-500">MRN {c.mrn}</p> : null}
    </div>
  );
}

function SortHeader({
  k,
  label,
  view,
  onSort,
  className = '',
}: {
  k: ClientSortKey;
  label: string;
  view: ClientListViewState;
  onSort: (k: ClientSortKey) => void;
  className?: string;
}) {
  const active = view.sort === k;
  const Icon = !active ? ArrowUpDown : view.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (view.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-3 ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${active ? 'text-slate-900' : ''}`}
      >
        {label}
        <Icon size={12} aria-hidden className={active ? '' : 'opacity-40'} />
        <span className="sr-only">{active ? `, sorted ${view.dir === 'asc' ? 'ascending' : 'descending'}` : ', sortable'}</span>
      </button>
    </th>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" aria-busy="true" aria-label="Loading clients">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
          <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
          <div className="hidden h-3 w-24 animate-pulse rounded bg-slate-100 sm:block" />
          <div className="hidden h-3 w-20 animate-pulse rounded bg-slate-100 md:block" />
        </div>
      ))}
    </div>
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { activeLocationId, isAllLocations, activeLocation, locations, setActiveLocationId } = useLocation();
  const [view, setView] = useState<ClientListViewState>(DEFAULT_VIEW_STATE);
  const [ready, setReady] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [unlinkedNotice, setUnlinkedNotice] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [countsKey, setCountsKey] = useState(0);
  const lastUrl = useRef<string>('');

  // Restore once the user is known: the URL wins (links / back button), else this user's saved sort + filters
  useEffect(() => {
    if (!user?.id || ready) return;
    const qs = new URLSearchParams(window.location.search);
    setUnlinkedNotice(qs.get('unlinked') === '1');
    let base = DEFAULT_VIEW_STATE;
    try {
      const saved = window.localStorage.getItem(STORAGE_PREFIX + user.id);
      if (saved) base = viewStateFromParams(new URLSearchParams(saved));
    } catch {
      /* storage blocked: defaults */
    }
    const hasUrlState = [...qs.keys()].some((k) => k !== 'unlinked');
    const next = hasUrlState ? viewStateFromParams(qs) : base;
    // Normalize the URL to the restored state without adding a history entry
    const normalized = viewStateToParams(next).toString();
    lastUrl.current = normalized;
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${normalized ? `?${normalized}` : ''}`);
    } catch {
      /* ignore */
    }
    setView(next);
    setSearchText(next.q);
    setReady(true);
  }, [user?.id, ready]);

  // Back / forward: read the state back from the URL
  useEffect(() => {
    const onPop = () => {
      const next = viewStateFromParams(new URLSearchParams(window.location.search));
      lastUrl.current = viewStateToParams(next).toString();
      setView(next);
      setSearchText(next.q);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Reflect the view in the URL (search / page replace the entry; other changes push one) and remember it per user
  useEffect(() => {
    if (!ready) return;
    const qs = viewStateToParams(view).toString();
    if (qs !== lastUrl.current) {
      const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
      const prev = viewStateFromParams(new URLSearchParams(lastUrl.current));
      const minor = prev.q !== view.q || prev.page !== view.page;
      try {
        if (minor) window.history.replaceState(window.history.state, '', url);
        else window.history.pushState(window.history.state, '', url);
      } catch {
        /* ignore */
      }
      lastUrl.current = qs;
    }
    try {
      if (user?.id) {
        window.localStorage.setItem(STORAGE_PREFIX + user.id, viewStateToParams({ ...view, q: '', page: 0 }).toString());
      }
    } catch {
      /* storage blocked */
    }
  }, [view, ready, user?.id]);

  // Debounced server-side search
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      setView((v) => (v.q === searchText.trim() ? v : { ...v, q: searchText.trim(), page: 0 }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchText, ready]);

  /** Change filters / sort (back to page 1 unless the page itself is being set) */
  const patch = useCallback((p: Partial<ClientListViewState>) => {
    setView((v) => ({ ...v, ...p, page: p.page !== undefined ? p.page : 0 }));
  }, []);

  const locationId = isAllLocations ? undefined : activeLocationId || undefined;
  const apiParams = useMemo(() => viewStateToApiParams(view, { locationId }).toString(), [view, locationId]);

  const {
    clients: apiClients,
    total: serverTotal,
    loading,
    error,
    reload,
    addClient,
  } = useClients({ page: view.page, pageSize: view.pageSize, params: apiParams, enabled: ready && viewMode !== 'caseload' });

  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [staffList, setStaffList] = useState<typeof INITIAL_STAFF_MEMBERS>([]);
  const [payers, setPayers] = useState<string[]>([]);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [handoffModalOpen, setHandoffModalOpen] = useState(false);
  const [selectedHandoffClient, setSelectedHandoffClient] = useState<Client | null>(null);
  const [btgClient, setBtgClient] = useState<Client | null>(null);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  // Real clinic staff from the directory (clinician filter, handoff, caseload cards)
  useEffect(() => {
    async function loadDirectoryStaff() {
      try {
        const res = await fetch('/api/staff/directory');
        const data = await res.json();
        if (data.success && Array.isArray(data.users) && data.users.length > 0) {
          setDirectoryUsers(data.users);
          setStaffList(data.users.map((u: DirectoryUser) => staffUserToStaffMember(u)));
        }
      } catch (err) {
        console.error('Failed to load clinic staff directory:', err);
      }
    }
    void loadDirectoryStaff();
  }, []);

  const role = user?.role;
  const isAdmin =
    role === 'ADMIN' || role === 'DIRECTOR' || role === 'PRACTICE_DIRECTOR' || role === 'SUPER_ADMIN' || user?.baseRole === 'ADMIN';
  const insuranceVisible = canSeeClientInsurance(role);
  // Caseload-limited view (a Medical Director sees the whole practice; the API enforces the real rule)
  const caseloadScoped = isCaseloadRole(role) && !medicalDirectorActive(role, user);
  const showClinicianFilter = Boolean(user) && !caseloadScoped;
  const showMine = Boolean(user) && !caseloadScoped && (isCaseloadRole(role) || isAdmin);
  const countsVisible = canViewCaseloadCounts(role) || user?.baseRole === 'ADMIN';

  // Payer choices (only roles that may see insurance)
  useEffect(() => {
    if (!user || !insuranceVisible) return;
    let cancelled = false;
    fetch('/api/clients?facets=1&limit=1')
      .then((r) => r.json())
      .then((d) => !cancelled && setPayers(Array.isArray(d?.payers) ? d.payers : []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, insuranceVisible]);

  // Server counts for the header (unassigned) — never the loaded page
  const { unassigned: unassignedCount } = useCaseloadCounts({ locationId, enabled: Boolean(user) && countsVisible, reloadKey: countsKey });

  const clientList = useMemo<Client[]>(
    () =>
      loading
        ? []
        : apiClients.map((c) => ({
            ...c,
            diagnosis: c.diagnosis || c.primaryDiagnosis || undefined,
            insuranceType: c.insuranceType || c.insurancePayer || undefined,
            treatmentTeam: c.treatmentTeam && typeof c.treatmentTeam === 'object' ? (c.treatmentTeam as Client['treatmentTeam']) : undefined,
            hieLastQueryAt: c.hieLastQueryAt ?? null,
          })),
    [apiClients, loading]
  );

  const showCadence = isAdmin || role === 'OFFICE_MANAGER' || isCaseloadRole(role);
  const cadenceLocationId = locationId;
  // Banner: counts only for the whole scope (no item rows), loaded after first paint
  const {
    summary: cadenceSummary,
    loading: cadenceSummaryLoading,
    error: cadenceError,
  } = useSessionFrequency({
    locationId: cadenceLocationId,
    view: 'summary',
    buckets: [],
    enabled: Boolean(user) && showCadence,
  });
  // Chips: only the clients on this page
  const visibleClientIds = useMemo(() => clientList.map((c) => c.id), [clientList]);
  const { items: cadenceItems, loading: cadenceFetching } = useSessionFrequency({
    locationId: cadenceLocationId,
    clientIds: visibleClientIds,
    enabled: Boolean(user) && showCadence && !loading && visibleClientIds.length > 0,
  });
  const cadenceLoading = cadenceFetching || !user;
  const cadenceByClient = useMemo(() => new Map(cadenceItems.map((item) => [item.clientId, item])), [cadenceItems]);

  /** Assign Clinician / Warm Handoff — must match API canAssignPatientToClinician */
  const canAssignTeam = canAssignPatientToClinician(role);
  const canIntake = isAdmin || role === 'FRONT_DESK' || role === 'OFFICE_MANAGER' || isCaseloadRole(role);
  const canBulkTransfer = isAdmin || role === 'OFFICE_MANAGER';
  const canEdit = canEditClientProfile(role);

  // Clinician filter options: clinical staff grouped by role (same grouping as the schedule)
  const clinicianGroups = useMemo(
    () =>
      groupProviders(
        directoryUsers
          .filter((u) => (u.status ?? 'ACTIVE') !== 'DISABLED' && providerGroupLabel(u.role) !== 'Other staff')
          .map((u) => ({ id: u.id, name: u.name || u.email, role: u.role }))
      ),
    [directoryUsers]
  );
  const clinicianName = useCallback(
    (id: string) => {
      const u = directoryUsers.find((x) => x.id === id);
      return u ? u.name || u.email : 'Selected clinician';
    },
    [directoryUsers]
  );

  const totalCount = serverTotal ?? clientList.length;
  const pageStart = totalCount === 0 ? 0 : view.page * view.pageSize + 1;
  const pageEnd = Math.min(totalCount, view.page * view.pageSize + clientList.length);
  const pageCount = Math.max(1, Math.ceil(totalCount / view.pageSize));

  const onSort = useCallback(
    (k: ClientSortKey) => {
      setView((v) =>
        v.sort === k ? { ...v, dir: v.dir === 'asc' ? 'desc' : 'asc', page: 0 } : { ...v, sort: k, dir: DEFAULT_SORT_DIR[k], page: 0 }
      );
    },
    []
  );

  // Active filter chips
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (view.q) chips.push({ key: 'q', label: `Search: "${view.q}"`, clear: () => { setSearchText(''); patch({ q: '' }); } });
  if (view.letter) chips.push({ key: 'letter', label: `Last name: ${view.letter}`, clear: () => patch({ letter: '' }) });
  if (view.status !== DEFAULT_VIEW_STATE.status) chips.push({ key: 'status', label: STATUS_LABEL[view.status], clear: () => patch({ status: DEFAULT_VIEW_STATE.status }) });
  if (view.clinicianId) chips.push({ key: 'clin', label: `Clinician: ${clinicianName(view.clinicianId)}`, clear: () => patch({ clinicianId: '' }) });
  if (view.mine) chips.push({ key: 'mine', label: 'My caseload', clear: () => patch({ mine: false }) });
  if (!isAllLocations && activeLocation) chips.push({ key: 'loc', label: `Location: ${activeLocation.name}`, clear: () => setActiveLocationId('all') });
  if (view.payer) chips.push({ key: 'payer', label: `Payer: ${view.payer}`, clear: () => patch({ payer: '' }) });
  if (view.risk) chips.push({ key: 'risk', label: RISK_LABEL[view.risk], clear: () => patch({ risk: '' }) });
  if (view.program) chips.push({ key: 'program', label: `Program: ${PROGRAM_LABEL[view.program]}`, clear: () => patch({ program: '' }) });
  if (view.noUpcoming) chips.push({ key: 'noUp', label: 'No upcoming appointment', clear: () => patch({ noUpcoming: false }) });
  if (view.needsDemographics) chips.push({ key: 'demo', label: 'Needs demographics', clear: () => patch({ needsDemographics: false }) });
  if (view.unassigned) chips.push({ key: 'unassigned', label: 'No clinician or care team', clear: () => patch({ unassigned: false }) });

  const clearAll = () => {
    setSearchText('');
    setView((v) => ({ ...DEFAULT_VIEW_STATE, sort: v.sort, dir: v.dir, pageSize: v.pageSize }));
    if (!isAllLocations) setActiveLocationId('all');
  };

  const handleOpenHandoff = (c: Client) => {
    setSelectedHandoffClient(c);
    setHandoffModalOpen(true);
  };
  const handleHandoffComplete = () => {
    setCountsKey((k) => k + 1);
    void reload();
  };

  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const handleOpenEdit = (c: Client) => {
    setEditingClient(c);
    setEditModalOpen(true);
  };
  const handleEditComplete = () => {
    void reload();
  };

  const canEditRow = (c: Client) => canEdit && (!caseloadScoped || c.assignedToId === user?.id);
  const listBusy = !ready || loading;

  /** Row "more" menu: Assign/Transfer (care-team roles), Edit (profile editors), View chart (everyone). */
  const clientRowActions = (c: Client): RowMenuAction[] => {
    const unassigned = isUnassignedForAssignCta(c);
    return [
      ...(canAssignTeam
        ? [
            {
              key: 'handoff',
              label: unassigned ? 'Assign clinician' : 'Transfer (warm handoff)',
              icon: <Shuffle size={14} aria-hidden />,
              emphasis: unassigned,
              onSelect: () => handleOpenHandoff(c),
            },
          ]
        : []),
      ...(canEditRow(c)
        ? [{ key: 'edit', label: 'Edit client', icon: <Pencil size={14} aria-hidden />, onSelect: () => handleOpenEdit(c) }]
        : []),
      { key: 'view', label: 'View chart', icon: <ArrowRight size={14} aria-hidden />, href: `/dashboard/clients/${c.id}` },
    ];
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <ClientIntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} onSubmit={addClient} />

      <EditClientModal
        open={editModalOpen}
        client={editingClient}
        onClose={() => {
          setEditModalOpen(false);
          setEditingClient(null);
        }}
        onUpdated={handleEditComplete}
      />

      {/* 3-Step Warm Clinical Handoff Wizard (capacity from server caseload counts) */}
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

      <BreakGlassModal open={Boolean(btgClient)} client={btgClient} onClose={() => setBtgClient(null)} onGranted={() => void reload()} />

      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">Client Directory & Caseloads</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500" aria-live="polite">
            {listBusy ? (
              'Loading…'
            ) : (
              <>
                <span className="font-bold text-slate-800">{totalCount.toLocaleString()}</span>{' '}
                {caseloadScoped ? 'in your caseload' : 'clients'}
                {chips.length ? ' match the filters' : ''}
                {countsVisible && unassignedCount ? (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => {
                        patch({ unassigned: true, status: 'ACTIVE' });
                        setViewMode('list');
                      }}
                      className="font-bold text-amber-700 hover:underline"
                    >
                      {unassignedCount.toLocaleString()} active with no clinician
                    </button>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>

        {canIntake ? (
          <button
            type="button"
            onClick={() => setIntakeOpen(true)}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
          >
            <Plus size={16} aria-hidden />
            New Intake
          </button>
        ) : null}
      </div>

      {/* Session frequency alert — count comes from the same items the alerts list shows */}
      {showCadence && !cadenceSummaryLoading && !cadenceError && cadenceSummary.overdue + cadenceSummary.unassigned > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50/90 p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
              <AlertTriangle size={18} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-bold text-rose-900">
                Session Frequency Alert —{' '}
                <span className="text-rose-700">
                  {cadenceSummary.overdue} client{cadenceSummary.overdue === 1 ? '' : 's'} overdue
                </span>
                {cadenceSummary.due_soon > 0 ? ` · ${cadenceSummary.due_soon} due soon` : ''}
                {cadenceSummary.unassigned > 0 ? ` · ${cadenceSummary.unassigned} with no assigned clinician` : ''}
              </p>
              <p className="mt-0.5 text-xs text-rose-700/80">
                Individual therapy only. Overdue = days since last attended session past the recommended interval plus grace, with
                nothing booked in the grace window. Active clients
                {caseloadScoped ? ' on your caseload' : isAllLocations ? '' : ` at ${activeLocation?.name ?? 'this location'}`}.
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/alerts?tab=frequency"
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-xl bg-rose-600 px-4 text-xs font-bold text-white shadow-xs transition hover:bg-rose-700 active:scale-[0.98]"
          >
            View clients &rarr;
          </Link>
        </div>
      )}
      {showCadence && cadenceError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Session frequency could not be loaded: {cadenceError}
        </div>
      ) : null}

      {view.program === MEDICAL_PROGRAM ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-600">
          <span>
            <strong>Program: Family Practice.</strong> Primary care patients ({PRIMARY_CARE_LOCATION_NAMES.join(' / ')}): a primary
            care visit, vitals or charge on file, primary care intake, or imported Valant Family Practice visits.
          </span>
          <button type="button" className="font-bold underline-offset-2 hover:underline" onClick={() => patch({ program: '' })}>
            Show all clients
          </button>
        </div>
      ) : null}
      {unlinkedNotice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          That medical record is not linked to a client chart, so it could not be opened. Find the client here, or ask a practice
          director to reconcile it (scripts/medical-patient-reconciliation.ts).
        </div>
      ) : null}

      {canBulkTransfer ? <PatientBulkTransfer onImported={reload} /> : null}

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {/* Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
        <div className="flex flex-col gap-2.5">
          {/* Search gets its own full-width row below lg; on wide screens it shares the row (min 16rem) and the
              filters wrap to the next line instead of squeezing it. */}
          <div className="flex flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center">
            <label className="relative w-full min-w-0 lg:w-auto lg:min-w-[16rem] lg:flex-[1_1_20rem]">
              <span className="sr-only">Search clients</span>
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder='Name ("Last, First"), MRN, DOB MM/DD/YYYY, phone, Valant ID, email'
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/80 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-600/15"
              />
            </label>

            <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <select
                value={view.status}
                onChange={(e) => patch({ status: e.target.value as ClientListViewState['status'] })}
                aria-label="Client status"
                className={FILTER_SELECT}
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="DISCHARGED">Discharged</option>
                <option value="ALL">All statuses</option>
              </select>

              <select
                value={`${view.sort}:${view.dir}`}
                onChange={(e) => {
                  const [s, d] = e.target.value.split(':') as [ClientSortKey, 'asc' | 'desc'];
                  patch({ sort: s, dir: d });
                }}
                aria-label="Sort clients"
                className={FILTER_SELECT}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    Sort: {o.label}
                  </option>
                ))}
                {!SORT_OPTIONS.some((o) => o.value === `${view.sort}:${view.dir}`) ? (
                  <option value={`${view.sort}:${view.dir}`}>
                    Sort: {CLIENT_SORT_LABELS[view.sort]} ({view.dir === 'asc' ? 'ascending' : 'descending'})
                  </option>
                ) : null}
              </select>

              {showClinicianFilter ? (
                <select
                  value={view.clinicianId}
                  onChange={(e) => patch({ clinicianId: e.target.value })}
                  aria-label="Assigned clinician"
                  className={`${FILTER_SELECT} sm:max-w-[16rem]`}
                >
                  <option value="">All clinicians</option>
                  {clinicianGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {view.clinicianId && !directoryUsers.some((u) => u.id === view.clinicianId) ? (
                    <option value={view.clinicianId}>Selected clinician</option>
                  ) : null}
                </select>
              ) : null}

              <select
                value={isAllLocations ? 'all' : activeLocationId}
                onChange={(e) => setActiveLocationId(e.target.value)}
                aria-label="Location"
                className={FILTER_SELECT}
              >
                <option value="all">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setMoreFiltersOpen((o) => !o)}
                aria-expanded={moreFiltersOpen}
                aria-controls="client-more-filters"
                className={`${CONTROL} inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap`}
              >
                <Filter size={14} aria-hidden />
                More filters
              </button>
            </div>

            {/* View mode */}
            <div className="flex shrink-0 self-start overflow-hidden rounded-xl border border-slate-200 lg:self-auto" role="group" aria-label="View">
              {(
                [
                  { mode: 'list' as const, label: 'List', icon: <List size={15} aria-hidden /> },
                  { mode: 'grid' as const, label: 'Cards', icon: <LayoutGrid size={15} aria-hidden /> },
                  ...(isAdmin ? [{ mode: 'caseload' as const, label: 'Caseloads', icon: <BarChart2 size={15} aria-hidden /> }] : []),
                ]
              ).map((b, i) => (
                <button
                  key={b.mode}
                  type="button"
                  onClick={() => setViewMode(b.mode)}
                  aria-pressed={viewMode === b.mode}
                  title={b.label}
                  className={`flex h-10 min-w-10 items-center justify-center gap-1.5 px-3 text-xs font-bold transition ${i > 0 ? 'border-l border-slate-200' : ''} ${
                    viewMode === b.mode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {b.icon}
                  <span className="hidden sm:inline">{b.label}</span>
                </button>
              ))}
            </div>
          </div>

          {moreFiltersOpen ? (
            <div id="client-more-filters" className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-2.5 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
              {insuranceVisible ? (
                <select value={view.payer} onChange={(e) => patch({ payer: e.target.value })} aria-label="Payer" className={`${CONTROL} lg:max-w-[16rem]`}>
                  <option value="">All payers</option>
                  {payers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  {view.payer && !payers.includes(view.payer) ? <option value={view.payer}>{view.payer}</option> : null}
                </select>
              ) : null}
              <select value={view.risk} onChange={(e) => patch({ risk: e.target.value as ClientListViewState['risk'] })} aria-label="Risk level" className={CONTROL}>
                <option value="">Any risk level</option>
                <option value="HIGH">High risk</option>
                <option value="MEDIUM">Medium risk</option>
                <option value="LOW">Low risk</option>
              </select>
              <select value={view.program} onChange={(e) => patch({ program: e.target.value as ClientListViewState['program'] })} aria-label="Program" className={CONTROL}>
                <option value="">Any program</option>
                {Object.entries(PROGRAM_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {(
                [
                  ...(showMine ? [{ key: 'mine' as const, label: 'My caseload' }] : []),
                  { key: 'noUpcoming' as const, label: 'No upcoming appointment' },
                  { key: 'needsDemographics' as const, label: 'Needs demographics' },
                  { key: 'unassigned' as const, label: 'No clinician or care team' },
                ]
              ).map((f) => (
                <label key={f.key} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={view[f.key]}
                    onChange={(e) => patch({ [f.key]: e.target.checked } as Partial<ClientListViewState>)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          ) : null}

          {/* Alphabet jump bar: last-name initial */}
          {viewMode !== 'caseload' ? (
            <nav aria-label="Filter by last name initial" className="-mx-1 overflow-x-auto">
              <div className="flex min-w-max gap-0.5 px-1">
                <button
                  type="button"
                  onClick={() => patch({ letter: '' })}
                  aria-pressed={!view.letter}
                  className={`h-8 rounded-md px-2 text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    !view.letter ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All
                </button>
                {LETTERS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => patch({ letter: view.letter === l ? '' : l })}
                    aria-pressed={view.letter === l}
                    aria-label={l === '#' ? 'Last name starts with another character' : `Last name starts with ${l}`}
                    className={`h-8 w-7 rounded-md text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      view.letter === l ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </nav>
          ) : null}

          {chips.length ? (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              {chips.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-3 pr-1 text-xs font-semibold text-blue-800 ring-1 ring-blue-100">
                  {c.label}
                  <button
                    type="button"
                    onClick={c.clear}
                    aria-label={`Remove filter ${c.label}`}
                    className="rounded-full p-0.5 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              ))}
              <button type="button" onClick={clearAll} className="ml-1 text-xs font-bold text-slate-600 underline-offset-2 hover:underline">
                Clear all
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Main View Area */}
      {viewMode === 'caseload' && isAdmin ? (
        <CaseloadAnalyticsView
          staffList={staffList}
          locationId={locationId}
          reloadKey={countsKey}
          onOpenHandoff={handleOpenHandoff}
          onShowUnassigned={() => {
            patch({ unassigned: true, status: 'ACTIVE' });
            setViewMode('list');
          }}
          onShowClinician={(id) => {
            patch({ clinicianId: id, status: 'ACTIVE' });
            setViewMode('list');
          }}
          renderFrequency={showCadence ? (client) => <CadenceChip item={cadenceByClient.get(client.id)} loading={cadenceLoading} /> : undefined}
        />
      ) : listBusy ? (
        <ListSkeleton />
      ) : clientList.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-base font-bold text-slate-900">{chips.length ? 'No clients match your filters' : 'No clients in your clinic yet'}</p>
          <p className="mt-1 text-sm text-slate-500">
            {chips.length ? 'Try a different spelling, another letter, or clear the filters.' : 'New intakes and clients save to your organization database only.'}
          </p>
          {chips.length ? (
            <button type="button" onClick={clearAll} className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
              Clear all filters
            </button>
          ) : null}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clientList.map((c) =>
            c.isSensitive && c.canAccessSensitive === false ? (
              <ProtectedClientCard key={c.id} client={c} onBreakGlass={(client) => setBtgClient(client)} />
            ) : (
              <ClientGridCard
                key={c.id}
                client={c}
                canIntake={!!canIntake}
                canAssignTeam={canAssignTeam}
                canEdit={canEditRow(c)}
                onOpenHandoff={handleOpenHandoff}
                onEditClient={handleOpenEdit}
                cadence={cadenceByClient.get(c.id)}
                cadenceLoading={cadenceLoading}
                cadenceEnabled={showCadence}
              />
            )
          )}
        </div>
      ) : (
        <>
          {/* Phones: compact cards */}
          <ul className="space-y-2 md:hidden" aria-label="Clients">
            {clientList.map((c) =>
              c.isSensitive && c.canAccessSensitive === false ? (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Lock size={16} className="shrink-0 text-amber-700" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{c.name || 'Protected Client'}</p>
                      <p className="text-xs text-amber-800">{SENSITIVE_REASON_LABEL[c.sensitiveReason || 'other'] || c.sensitiveReason} · PHI locked</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setBtgClient(c)} className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-amber-700 px-3 text-xs font-bold text-white">
                    Break the Glass
                  </button>
                </li>
              ) : (
                <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                  <div className="flex items-start gap-3">
                    <ClientAvatar name={c.name} image={c.image} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <NameCell c={c} compact />
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${riskBadgeClass(c.risk)}`}>{c.risk}</span>
                      </div>
                      <p className="mt-0.5 break-words text-xs text-slate-500">
                        {c.mrn ? <span className="break-all font-mono">MRN {c.mrn}</span> : null}
                        {c.mrn && c.dateOfBirth ? ' · ' : null}
                        {c.dateOfBirth ? <DobCell dob={c.dateOfBirth} /> : null}
                      </p>
                      <CareTeamSummary team={c.careTeam} variant="mobile" className="mt-1 text-slate-600" />
                      {c.locationName ? <p className="mt-0.5 truncate text-xs text-slate-500">{c.locationName}</p> : null}
                      <p className="mt-0.5 text-xs text-slate-600">
                        Next: <span className="font-semibold text-sky-700">{c.nextAppointment || '—'}</span> · Last seen {formatSeen(c.lastSeenAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[c.status ?? ''] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABEL[c.status ?? ''] || c.status}
                    </span>
                    <Link href={`/dashboard/clients/${c.id}`} className="inline-flex min-h-10 items-center gap-1 px-1 text-xs font-bold text-blue-600">
                      View chart <ArrowRight size={13} aria-hidden />
                    </Link>
                  </div>
                </li>
              )
            )}
          </ul>

          {/* Tablet / desktop: sortable table. Sized to fit the content area (no fixed min width): Payer shows
              from xl, Last seen from lg, status + risk share one column, row actions sit in a "more" menu.
              The whole row opens the chart; the name link stays the keyboard / screen-reader target. */}
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs md:block">
            <div className="clinic-scroll-x">
              <table className="w-full text-left text-sm" data-testid="client-list-table">
                <caption className="sr-only">
                  Clients, sorted by {CLIENT_SORT_LABELS[view.sort]} {view.dir === 'asc' ? 'ascending' : 'descending'}. Select a row or a
                  client name to open the chart.
                </caption>
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <SortHeader k="last" label="Name / MRN" view={view} onSort={onSort} className="sticky left-0 z-10 bg-slate-50 pl-4" />
                    <SortHeader k="dob" label="DOB (age)" view={view} onSort={onSort} className="whitespace-nowrap" />
                    <th scope="col" className="px-3 py-3">Clinician / location</th>
                    {insuranceVisible ? <th scope="col" className="hidden px-3 py-3 xl:table-cell">Payer</th> : null}
                    <SortHeader k="nextAppt" label="Next appt" view={view} onSort={onSort} className="whitespace-nowrap" />
                    <SortHeader k="lastSeen" label="Last seen" view={view} onSort={onSort} className="hidden whitespace-nowrap lg:table-cell" />
                    <SortHeader k="status" label="Status / risk" view={view} onSort={onSort} className="whitespace-nowrap" />
                    <th scope="col" className="w-12 px-2 py-3 pr-3 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {clientList.map((c) =>
                    c.isSensitive && c.canAccessSensitive === false ? (
                      <tr key={c.id} className="bg-amber-50/50">
                        <td className="px-3 py-3 pl-4" colSpan={insuranceVisible ? 6 : 5}>
                          <div className="flex min-w-0 items-center gap-3">
                            <Lock size={16} className="shrink-0 text-amber-700" aria-hidden />
                            <div className="min-w-0">
                              <p className="truncate font-bold text-slate-900">{c.name || 'Protected Client'}</p>
                              <p className="text-xs text-amber-800">
                                {SENSITIVE_REASON_LABEL[c.sensitiveReason || 'other'] || c.sensitiveReason} · PHI locked
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 pr-3 text-right" colSpan={2}>
                          <button
                            type="button"
                            onClick={() => setBtgClient(c)}
                            className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg bg-amber-700 px-3 text-xs font-bold text-white"
                          >
                            Break the Glass
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={c.id}
                        onClick={(e) => {
                          if (isRowClickTarget(e)) router.push(`/dashboard/clients/${c.id}`);
                        }}
                        className="group cursor-pointer transition hover:bg-slate-50/80"
                      >
                        <td className="sticky left-0 z-10 max-w-[16rem] bg-white px-3 py-2.5 pl-4 group-hover:bg-slate-50">
                          <div className="flex min-w-0 items-center gap-3">
                            <ClientAvatar name={c.name} image={c.image} size="md" />
                            <NameCell c={c} showMrn />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-700">
                          <DobCell dob={c.dateOfBirth} />
                        </td>
                        <td className="max-w-[11rem] px-3 py-2.5 text-xs text-slate-700">
                          <CareTeamSummary team={c.careTeam} variant="cell" />
                          {c.locationName ? <p className="truncate text-[11px] text-slate-500">{c.locationName}</p> : null}
                        </td>
                        {insuranceVisible ? (
                          <td className="hidden max-w-[10rem] px-3 py-2.5 text-xs text-slate-700 xl:table-cell">
                            <p className="truncate" title={c.insurancePayer || undefined}>
                              {c.insurancePayer || '—'}
                            </p>
                          </td>
                        ) : null}
                        <td className="px-3 py-2.5 text-xs">
                          <p className="whitespace-nowrap font-semibold text-sky-700">{c.nextAppointment || '—'}</p>
                          {showCadence ? <CadenceChip item={cadenceByClient.get(c.id)} loading={cadenceLoading} inline /> : null}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-slate-700 lg:table-cell">{formatSeen(c.lastSeenAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[c.status ?? ''] || 'bg-slate-100 text-slate-600'}`}>
                              {STATUS_LABEL[c.status ?? ''] || c.status}
                            </span>
                            {c.risk ? (
                              <span
                                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${riskBadgeClass(c.risk)}`}
                                title={`${c.risk} risk`}
                              >
                                {c.risk}
                                <span className="sr-only"> risk</span>
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="w-12 px-2 py-2.5 pr-3 text-right">
                          <RowActionsMenu label={`Actions for ${listDisplayName(c).primary}`} actions={clientRowActions(c)} />
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {viewMode !== 'caseload' && !listBusy && totalCount > 0 ? (
        <div className="flex flex-col items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-xs sm:flex-row">
          <span aria-live="polite">
            Showing <span className="font-bold text-slate-900">{pageStart.toLocaleString()}</span>–
            <span className="font-bold text-slate-900">{pageEnd.toLocaleString()}</span> of{' '}
            <span className="font-bold text-slate-900">{totalCount.toLocaleString()}</span>
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <label className="inline-flex items-center gap-1.5">
              <span>Per page</span>
              <select value={view.pageSize} onChange={(e) => patch({ pageSize: Number(e.target.value) })} className="h-10 rounded-lg border border-slate-200 bg-white px-2 font-bold text-slate-700 md:h-8">
                {CLIENT_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={view.page === 0}
              onClick={() => patch({ page: Math.max(0, view.page - 1) })}
              className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-3 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 md:min-h-8"
            >
              Previous
            </button>
            <span>
              Page {(view.page + 1).toLocaleString()} of {pageCount.toLocaleString()}
            </span>
            <button
              type="button"
              disabled={view.page + 1 >= pageCount}
              onClick={() => patch({ page: view.page + 1 })}
              className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-3 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 md:min-h-8"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
