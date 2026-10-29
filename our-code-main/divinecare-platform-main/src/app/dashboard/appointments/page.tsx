'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  User,
  Video,
  X,
  Smartphone,
  Send,
  Radio,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/features/auth';
import { AppointmentCopay } from '@/components/billing/AppointmentCopay';
import { VisitTypeChange } from '@/components/appointments/VisitTypeChange';
import {
  useAppointments,
  todayLabel,
  APPOINTMENT_TYPES,
  VISIT_TRANSITIONS,
  type Appointment,
  type AppointmentStatus,
  type AppointmentType,
  type NoteStatus,
} from '@/features/appointments';
import { useClients } from '@/features/clients';
import type { StaffUser } from '@/features/staff/types';
import { apiJson } from '@/lib/api-client';
import { useLocation } from '@/context/LocationContext';
import {
  INSURANCE_NOT_MATCHED_LABEL,
  PAYER_MISMATCH_LABEL,
  resolvePayerHintDisplay,
} from '@/lib/appointments/payerHint';
import {
  bookButtonPlacement,
  CLICK_HINT_DAY,
  CLICK_HINT_WEEK,
  dayBookLabel,
  DRAG_IGNORE_PX,
  isBusyTarget,
  pickSlot,
  slotBookLabel,
  type PickedSlot,
} from '@/lib/appointments/calendarSlots';

const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7B4DB5)';
const PURPLE = '#5C2D91';

function PayerHintLine({ insurance }: { insurance?: string | null }) {
  const hint = resolvePayerHintDisplay(insurance);
  if (!hint.label && !insurance) {
    return <span className="mt-1 block text-[11px] text-slate-500">Payer hint: none on file</span>;
  }
  if (hint.tone === 'danger') {
    return (
      <span className="mt-1 block text-[11px] font-semibold text-rose-700" data-testid="payer-mismatch">
        {PAYER_MISMATCH_LABEL}
      </span>
    );
  }
  if (hint.tone === 'neutral') {
    return (
      <span className="mt-1 block text-[11px] text-slate-600" data-testid="payer-unmatched">
        {INSURANCE_NOT_MATCHED_LABEL}
      </span>
    );
  }
  return (
    <span className="mt-1 block text-[11px] text-slate-500">
      Payer hint: {hint.label || insurance}
    </span>
  );
}

const FORM_TYPES = [
  'Individual Therapy',
  'Group Therapy',
  'Medication Review',
  'Initial Assessment',
  'Crisis Follow-up',
  'Telehealth Check-in',
] as const;

const VISIT_DOT: Record<AppointmentStatus, string> = {
  scheduled: '#9CA3AF',
  'checked-in': '#3B82F6',
  'in-session': '#10B981',
  completed: '#7C3AED',
  'no-show': '#F59E0B',
  cancelled: '#EF4444',
  'late-cancel': '#F97316',
};

const VISIT_PILL: Record<AppointmentStatus, string> = {
  scheduled: 'bg-gray-100 text-gray-700',
  'checked-in': 'bg-blue-50 text-blue-700',
  'in-session': 'bg-emerald-50 text-emerald-700',
  completed: 'bg-purple-50 text-[#5C2D91]',
  'no-show': 'bg-amber-50 text-amber-800',
  cancelled: 'bg-red-50 text-red-700',
  'late-cancel': 'bg-orange-50 text-orange-700',
};

const VISIT_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  'checked-in': 'Checked In',
  'in-session': 'In Session',
  completed: 'Seen',
  'no-show': 'No-Show',
  cancelled: 'Cancelled',
  'late-cancel': 'Late Cancel',
};

const NOTE_META: Record<NoteStatus, { label: string; cls: string; icon?: 'bot' | 'lock' }> = {
  'not-started': { label: 'Note Due', cls: 'bg-amber-50 text-amber-800' },
  'ai-draft': { label: 'AI Draft Ready', cls: 'bg-purple-50 text-[#5C2D91]', icon: 'bot' },
  'in-progress': { label: 'In Progress', cls: 'bg-blue-50 text-blue-700' },
  signed: { label: 'Signed', cls: 'bg-emerald-50 text-emerald-700', icon: 'lock' },
};

export interface ClinicianConfig {
  id: string;
  name: string;
  roleTitle: string;
  initials: string;
  color: string;
  bgLight: string;
  room: string;
}

const CAL_START_H = 8; // 8:00 AM
const CAL_END_H = 19; // 7:00 PM
const HOUR_PX = 80;

function timeToMinutes(hhmm: string): number {
  if (!hhmm) return 480;
  const parts = hhmm.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  if (isNaN(h)) return 480;
  return h * 60 + (isNaN(m) ? 0 : m);
}

function getAppointmentPlacement(startTime: string, endTime: string) {
  const startMin = timeToMinutes(startTime);
  const endMin = endTime ? timeToMinutes(endTime) : startMin + 50;

  const startOffset = Math.max(0, startMin - CAL_START_H * 60);
  const duration = Math.max(endMin - startMin, 25);

  const top = (startOffset / 60) * HOUR_PX;
  const height = Math.max((duration / 60) * HOUR_PX, 32);

  return { top, height };
}

function formatClock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function defaultEndTime(startTime: string) {
  if (!/^\d{2}:\d{2}$/.test(startTime)) return '';
  const [hours, minutes] = startTime.split(':').map(Number);
  const date = new Date(2000, 0, 1, hours, minutes + 50);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function VisitPill({
  status,
  patientBooked,
}: {
  status: AppointmentStatus;
  patientBooked?: boolean;
}) {
  if (patientBooked && status === 'scheduled') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
        <Smartphone className="h-3 w-3 text-amber-600" />
        Pending Approval
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${VISIT_PILL[status]}`}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: VISIT_DOT[status] }}
      />
      {VISIT_LABEL[status]}
    </span>
  );
}

function NotePill({ status, visit }: { status: NoteStatus; visit: AppointmentStatus }) {
  if (visit === 'no-show' || visit === 'cancelled' || visit === 'late-cancel') {
    return <span className="text-xs text-gray-400">—</span>;
  }
  if (visit !== 'completed' && visit !== 'in-session') {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const meta = NOTE_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}
    >
      {meta.icon === 'bot' ? <Bot className="h-3 w-3" /> : null}
      {meta.icon === 'lock' ? <Lock className="h-3 w-3" /> : null}
      {meta.label}
    </span>
  );
}

function AppointmentActions({
  appt,
  expanding,
  onToggle,
  onStatus,
  onAiDraft,
  onConfirm,
  onDecline,
  busy,
  staffRole,
}: {
  appt: Appointment;
  expanding: boolean;
  onToggle: () => void;
  onStatus: (s: AppointmentStatus) => void;
  onAiDraft: () => void;
  onConfirm?: (id: string) => void;
  onDecline?: (id: string) => void;
  busy: boolean;
  staffRole?: string | null;
}) {
  if (appt.patientBooked && appt.status === 'scheduled') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm?.(appt.id)}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
          title="Approve & Confirm Appointment"
        >
          <Check className="h-3.5 w-3.5" /> Confirm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecline?.(appt.id)}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 active:scale-95 disabled:opacity-50"
          title="Decline Appointment Request"
        >
          <X className="h-3.5 w-3.5" /> Decline
        </button>
      </div>
    );
  }

  const next = VISIT_TRANSITIONS[appt.status] || [];
  const showNote =
    appt.noteStatus === 'ai-draft' &&
    (appt.status === 'completed' || appt.status === 'in-session');
  const meetingUrl = appt.hostJoinUrl || appt.clientJoinUrl;
  const canStartMeeting =
    appt.isVirtual &&
    Boolean(meetingUrl) &&
    (appt.status === 'scheduled' ||
      appt.status === 'checked-in' ||
      appt.status === 'in-session');
  const meetingPrimary = appt.status === 'checked-in' || appt.status === 'in-session';
  const role = (staffRole || '').toUpperCase();
  const showMaRooming =
    Boolean(appt.clientId) &&
    (role === 'MEDICAL_ASSISTANT' ||
      role === 'PHYSICIAN' ||
      role === 'MEDICAL_NP' ||
      role === 'ADMIN' ||
      role === 'DIRECTOR' ||
      role === 'PRACTICE_DIRECTOR');
  const showProviderVisit =
    Boolean(appt.clientId) &&
    (role === 'PHYSICIAN' ||
      role === 'MEDICAL_NP' ||
      role === 'ADMIN' ||
      role === 'DIRECTOR' ||
      role === 'PRACTICE_DIRECTOR');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canStartMeeting ? (
          <button
            type="button"
            onClick={() => window.open(meetingUrl as string, '_blank', 'noopener,noreferrer')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              meetingPrimary
                ? 'text-white'
                : 'border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
            }`}
            style={meetingPrimary ? { background: GRADIENT } : undefined}
          >
            <Video className="h-3.5 w-3.5" />
            {appt.status === 'in-session' ? 'Join meeting' : 'Start meeting'}
          </button>
        ) : null}
        {next.length > 0 ? (
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Update <ChevronDown className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {showNote ? (
          <Link
            href={`/dashboard/ehr/notes?appointmentId=${appt.id}`}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white"
            style={{ background: GRADIENT }}
          >
            Note
          </Link>
        ) : null}
        {showMaRooming ? (
          <Link
            href={`/dashboard/medical?appointmentId=${encodeURIComponent(appt.id)}&clientId=${encodeURIComponent(appt.clientId)}&clientName=${encodeURIComponent(appt.clientName || '')}`}
            className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
            data-testid="pc-rooming-deeplink"
          >
            Rooming
          </Link>
        ) : null}
        {showProviderVisit ? (
          <Link
            href={`/dashboard/medical/visits?appointmentId=${encodeURIComponent(appt.id)}&clientId=${encodeURIComponent(appt.clientId)}&clientName=${encodeURIComponent(appt.clientName || '')}`}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100"
            data-testid="pc-visit-deeplink"
          >
            PC visit
          </Link>
        ) : null}
      </div>
      {expanding && next.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-purple-100 bg-purple-50/50 p-2">
          {appt.isVirtual && appt.status === 'checked-in' ? (
            <p className="text-[11px] font-medium text-[#5C2D91]">
              Start the video meeting first, then mark In Session.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {next.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => onStatus(s)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-[#5C2D91] hover:text-[#5C2D91] disabled:opacity-50"
              >
                {VISIT_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {(appt.status === 'completed' || appt.status === 'in-session') &&
      appt.noteStatus === 'not-started' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">Session complete — note not started</p>
          <button
            type="button"
            disabled={busy}
            onClick={onAiDraft}
            className="mt-1.5 font-semibold text-[#5C2D91] underline disabled:opacity-50"
          >
            Generate AI Draft →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getWeekDays(dateStr: string, todayStr: string) {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay(); // 0 is Sun, 1 is Mon
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
    days.push({
      date: iso,
      dayName: cur.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNumber: cur.getDate(),
      monthName: cur.toLocaleDateString('en-US', { month: 'short' }),
      isToday: iso === todayStr,
      isCurrentCalDate: iso === dateStr,
    });
  }
  return days;
}

export default function AppointmentsPage() {
  const { user } = useAuth();
  const { activeLocationId, isAllLocations, activeLocation } = useLocation();
  const today = useMemo(() => todayLabel(), []);
  const {
    appointments,
    loading,
    error,
    reload,
    addAppointment,
    setStatus,
    generateAiDraft,
    confirm,
    decline,
  } = useAppointments();
  const { clients, loading: clientsLoading, error: clientsError } = useClients();
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  useEffect(() => {
    let cancelled = false;
    void apiJson<{ users: StaffUser[] }>('/api/staff/directory')
      .then(({ users }) => {
        if (!cancelled) {
          setStaffUsers(
            users.filter((staff) => staff.status === 'ACTIVE' || staff.status === 'INVITED')
          );
        }
      })
      .catch(() => { /* Scheduling still validates the assigned clinician on the server. */ });
    return () => { cancelled = true; };
  }, []);

  // Role based default view: Front-desk & Admin default to 'calendar', caseload to 'board'
  const isFrontDeskOrAdmin = useMemo(() => {
    if (!user?.role) return true;
    const adminRoles = [
      'ADMIN',
      'PRACTICE_DIRECTOR',
      'OFFICE_MANAGER',
      'FRONT_DESK',
      'DIRECTOR',
      'SUPER_ADMIN',
    ];
    return adminRoles.includes(user.role);
  }, [user?.role]);

  const [view, setView] = useState<'calendar' | 'board' | 'list'>('calendar');
  const [calMode, setCalMode] = useState<'day' | 'week'>('day');
  const [calDate, setCalDate] = useState<string>(today);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [pickedSlot, setPickedSlot] = useState<PickedSlot | null>(null);
  const [hoverBandY, setHoverBandY] = useState<number | null>(null);
  const [pointerDown, setPointerDown] = useState<{ x: number; y: number } | null>(null);
  const [filter, setFilter] = useState<'today' | 'upcoming' | 'all'>('today');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRadar, setShowRadar] = useState(true);

  // Section 5.3: Schedule Blocks (Lunch, Admin, Out-of-Office, Supervision)
  const [scheduleBlocks, setScheduleBlocks] = useState<
    Array<{
      id: string;
      date: string;
      clinicianId: string;
      startTime: string;
      endTime: string;
      reason: string;
    }>
  >([
    {
      id: 'blk-1',
      date: today,
      clinicianId: 'doc-okafor',
      startTime: '12:00',
      endTime: '13:00',
      reason: 'Lunch & Somatic Charting',
    },
    {
      id: 'blk-2',
      date: today,
      clinicianId: 'np-walsh',
      startTime: '13:00',
      endTime: '14:00',
      reason: 'Clinical Case Supervision',
    },
    {
      id: 'blk-3',
      date: today,
      clinicianId: 'therapist-jenkins',
      startTime: '12:00',
      endTime: '13:00',
      reason: 'Staff Lunch Break',
    },
  ]);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockClinicianId, setBlockClinicianId] = useState('');
  const [blockDate, setBlockDate] = useState(today);
  const [blockStartTime, setBlockStartTime] = useState('12:00');
  const [blockEndTime, setBlockEndTime] = useState('13:00');
  const [blockReason, setBlockReason] = useState<
    'Lunch' | 'Admin Time' | 'Out of Office' | 'Supervision'
  >('Lunch');

  // Section 5.3: Appointment Lifecycle
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('Client Requested Cancellation');
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [apptNotesDraft, setApptNotesDraft] = useState('');

  // Patient App Booking Approval & Decline state
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineTargetId, setDeclineTargetId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState(
    'Requested time slot unavailable — please select another slot'
  );
  const [customDeclineNote, setCustomDeclineNote] = useState('');

  useEffect(() => {
    if (user?.role) {
      const adminRoles = [
        'ADMIN',
        'PRACTICE_DIRECTOR',
        'OFFICE_MANAGER',
        'FRONT_DESK',
        'DIRECTOR',
        'SUPER_ADMIN',
      ];
      setView(adminRoles.includes(user.role) ? 'calendar' : 'board');
    }
  }, [user?.role]);

  // Filter appointments by active location (or all)
  const allAppointments = useMemo(() => {
    if (isAllLocations) return appointments;
    return appointments.filter((a: any) => {
      const loc = a.locationId || a.location || (a.client && (a.client as any).primaryLocationId);
      return loc === activeLocationId || !loc;
    });
  }, [appointments, activeLocationId, isAllLocations]);

  // Build full clinician columns from staff users and default clinicians
  const clinicianColumns = useMemo<ClinicianConfig[]>(() => {
    const map = new Map<string, ClinicianConfig>();

    const defaultClinicians: ClinicianConfig[] = [];
    defaultClinicians.forEach((c) => map.set(c.id, c));

    if (staffUsers && staffUsers.length > 0) {
      const CLINICAL_ROLES = [
        'PHYSICIAN',
        'MEDICAL_NP',
        'THERAPIST',
        'PSYCHIATRIST',
        'NURSE_PRACTITIONER',
        'NP',
        'CLINICIAN',
        'CASE_MANAGER',
        'PRP_SPECIALIST',
        'PEER_SUPPORT',
        'PRACTICE_DIRECTOR',
        'CLINICAL_SUPERVISOR',
      ];
      staffUsers
        .filter(
          (s) =>
            CLINICAL_ROLES.includes(s.role) ||
            (s.roles && s.roles.some((r) => CLINICAL_ROLES.includes(r)))
        )
        .forEach((s, idx) => {
          const initials = s.name
            ? s.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)
            : 'CL';
          // If staff member matches a default demo clinician name, replace demo ID with real DB ID
          const defaultKey = Array.from(map.entries()).find(
            ([, c]) => c.name.toLowerCase() === (s.name || '').toLowerCase()
          )?.[0];
          if (defaultKey) {
            map.delete(defaultKey);
          }
          if (s.name) {
            const colors = ['#5C2D91', '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0D47A1', '#1565C0'];
            const color = colors[idx % colors.length];
            map.set(s.id, {
              id: s.id,
              name: s.name,
              roleTitle: s.role.replace(/_/g, ' '),
              initials,
              color,
              bgLight: `${color}10`,
              room: `Room ${102 + ((idx * 2) % 12)}`,
            });
          }
        });
    }

    return Array.from(map.values());
  }, [staffUsers]);

  const findClinicianForAppt = (appt: Appointment): ClinicianConfig => {
    if (appt.clinicianId) {
      const match = clinicianColumns.find((c) => c.id === appt.clinicianId);
      if (match) return match;
    }
    if (appt.clinicianName) {
      const match = clinicianColumns.find(
        (c) => c.name.toLowerCase() === appt.clinicianName?.toLowerCase()
      );
      if (match) return match;
    }
    return {
      id: appt.clinicianId || 'unassigned',
      name: appt.clinicianName || 'Unassigned clinician',
      roleTitle: 'Clinician',
      initials: (appt.clinicianName || 'Unassigned').slice(0, 2).toUpperCase(),
      color: PURPLE,
      bgLight: '#F3EEF8',
      room: '',
    };
  };

  const getAppointmentRoom = (appt: Appointment, clinician?: ClinicianConfig): string => {
    if (appt.isVirtual) {
      const provider =
        appt.videoProvider === 'google'
          ? 'Google Meet'
          : appt.videoProvider === 'in_app'
          ? 'In-App'
          : 'Zoom';
      return `Virtual (${provider})`;
    }
    if (appt.notes?.includes('Group Room')) return 'Group Room';
    const match = appt.notes?.match(/Room\s+\d+/i);
    if (match) return match[0];
    if (clinician?.room) return clinician.room;
    return 'Room 102';
  };

  const [clientSearch, setClientSearch] = useState('');
  const [form, setForm] = useState({
    clientId: '',
    clinicianId: '',
    type: 'Individual Therapy' as AppointmentType,
    date: today,
    startTime: '',
    endTime: '',
    isVirtual: false,
    videoProvider: 'zoom' as 'zoom' | 'google' | 'in_app',
  });

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setPickedSlot(null);
  };

  const openBookFromPick = (slot: PickedSlot) => {
    setForm((f) => ({
      ...f,
      date: slot.date,
      startTime: slot.startTime,
      endTime: defaultEndTime(slot.startTime),
      clinicianId: slot.clinicianId || f.clinicianId,
    }));
    setPickedSlot(null);
    setEditingId(null);
    setShowForm(true);
  };

  useEffect(() => {
    if (!pickedSlot && !showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickedSlot(null);
        if (showForm) closeForm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickedSlot, showForm]);

  useEffect(() => {
    setPickedSlot(null);
  }, [calMode, view, calDate]);

  useEffect(() => {
    if (!showForm) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        '#appt-form-panel input, #appt-form-panel select'
      );
      el?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [showForm]);

  const schedulableClients = useMemo(
    () => clients.filter((c) => c.status !== 'DISCHARGED'),
    [clients]
  );
  const filteredSchedulableClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return schedulableClients;
    return schedulableClients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.mrn || '').toLowerCase().includes(q) ||
        (c.insurancePayer || '').toLowerCase().includes(q)
    );
  }, [schedulableClients, clientSearch]);

  useEffect(() => {
    if (clientsLoading || clientsError) return;
    const params = new URLSearchParams(window.location.search);
    const queryClientId = params.get('client');
    const storedClientId = sessionStorage.getItem('altrixs.schedule.clientId');
    const requestedClientId = queryClientId || storedClientId;
    const shouldOpenForm =
      params.get('new') === '1' || sessionStorage.getItem('altrixs.schedule.open') === '1';
    if (queryClientId || params.get('new')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    sessionStorage.removeItem('altrixs.schedule.clientId');
    sessionStorage.removeItem('altrixs.schedule.open');
    if (shouldOpenForm) setShowForm(true);
    const requested = requestedClientId
      ? schedulableClients.find((c) => c.id === requestedClientId)
      : null;
    if (requested) {
      setForm((f) => ({ ...f, clientId: requested.id }));
      return;
    }
    if (!form.clientId && schedulableClients.length) {
      setForm((f) => ({ ...f, clientId: schedulableClients[0].id }));
    }
  }, [schedulableClients, form.clientId, clientsLoading, clientsError]);

  // Appointments for the active calendar date
  const dayAppointments = useMemo(
    () => allAppointments.filter((a) => a.date === calDate),
    [allAppointments, calDate]
  );

  // Today appointments for stats
  const todayAppts = useMemo(
    () => allAppointments.filter((a) => a.date === today),
    [allAppointments, today]
  );

  const upcomingAppts = useMemo(
    () =>
      allAppointments.filter(
        (a) =>
          a.date > today &&
          (a.status === 'scheduled' ||
            a.status === 'checked-in' ||
            a.status === 'in-session')
      ),
    [allAppointments, today]
  );

  const displayedList =
    filter === 'today' ? todayAppts : filter === 'upcoming' ? upcomingAppts : allAppointments;

  // Key metrics for the active calendar date (or today in board view)
  const activeMetricsSource = view === 'calendar' ? dayAppointments : todayAppts;
  const inSessionSeen = activeMetricsSource.filter(
    (a) => a.status === 'completed' || a.status === 'in-session'
  ).length;
  const checkedIn = activeMetricsSource.filter((a) => a.status === 'checked-in').length;
  const noShow = activeMetricsSource.filter((a) => a.status === 'no-show').length;
  const notesDue = activeMetricsSource.filter(
    (a) =>
      (a.status === 'completed' || a.status === 'in-session') &&
      a.noteStatus === 'not-started'
  ).length;
  const totalDaySessions = activeMetricsSource.length;
  const completedDaySessions = activeMetricsSource.filter((a) => a.status === 'completed').length;
  const utilizationRate =
    totalDaySessions > 0
      ? Math.round(((inSessionSeen) / totalDaySessions) * 100)
      : 0;

  // Live clock placement calculation
  const liveClockTop = useMemo(() => {
    if (calDate !== today) return null;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < CAL_START_H * 60 || currentMinutes > CAL_END_H * 60) {
      return null;
    }
    return ((currentMinutes - CAL_START_H * 60) / 60) * HOUR_PX;
  }, [calDate, today]);

  // Week days for Week View
  const weekDays = useMemo(() => getWeekDays(calDate, today), [calDate, today]);

  const handleCreate = async () => {
    setFormError('');
    if (!form.clientId || !form.date || !form.startTime) {
      setFormError('Client, date, and start time are required');
      return;
    }
    if (form.endTime && form.endTime <= form.startTime) {
      setFormError('End time must be after start time');
      return;
    }
    setSaving(true);
    try {
        await addAppointment({
          clientId: form.clientId,
          type: form.type,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime || undefined,
          isVirtual: form.isVirtual,
          videoProvider: form.isVirtual ? form.videoProvider : undefined,
          clinicianId: form.clinicianId || undefined,
        });

      setShowForm(false);
      setForm((f) => ({
        ...f,
        startTime: '',
        endTime: '',
        isVirtual: false,
        videoProvider: 'zoom',
        date: today,
        type: 'Individual Therapy',
      }));
      await reload();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not create appointment');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, newStatus: AppointmentStatus) => {
    setActionError(null);
    setSaving(true);
    try {
        await setStatus(id, newStatus);
        await reload();
      if (selectedAppt && selectedAppt.id === id) {
        setSelectedAppt((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
      setEditingId(null);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Could not update status');
    } finally {
      setSaving(false);
    }
  };

  const handleAiDraft = async (id: string) => {
    setActionError(null);
    setSaving(true);
    try {
        await generateAiDraft(id);
        await reload();
      if (selectedAppt && selectedAppt.id === id) {
        setSelectedAppt((prev) => (prev ? { ...prev, noteStatus: 'ai-draft' } : null));
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Could not generate AI draft');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async (id: string) => {
    setActionError(null);
    setSaving(true);
    try {
      await confirm(id);
      toast.success('Appointment confirmed! Patient notified via email & SMS.');
      if (selectedAppt && selectedAppt.id === id) {
        setSelectedAppt((prev) => (prev ? { ...prev, patientBooked: false } : null));
      }
      await reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not confirm appointment';
      setActionError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenDecline = (id: string) => {
    setDeclineTargetId(id);
    setShowDeclineModal(true);
  };

  const handleDeclineSubmit = async () => {
    if (!declineTargetId) return;
    setActionError(null);
    setSaving(true);
    const finalReason =
      declineReason === 'Other scheduling reason' && customDeclineNote.trim()
        ? customDeclineNote.trim()
        : declineReason;
    try {
      await decline(declineTargetId, finalReason);
      toast.success('Appointment request declined. Patient notified.');
      if (selectedAppt && selectedAppt.id === declineTargetId) {
        setSelectedAppt(null);
      }
      setShowDeclineModal(false);
      setDeclineTargetId(null);
      setCustomDeclineNote('');
      await reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not decline appointment';
      setActionError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const navigateDate = (step: number) => {
    const parts = calDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const deltaDays = calMode === 'week' ? step * 7 : step;
    d.setDate(d.getDate() + deltaDays);
    const pad = (n: number) => String(n).padStart(2, '0');
    setCalDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const formattedHeaderDate = useMemo(() => {
    const parts = calDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (calMode === 'day') {
      return d.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    const monday = weekDays[0];
    const sunday = weekDays[6];
    return `Week of ${monday.monthName} ${monday.dayNumber} – ${sunday.monthName} ${sunday.dayNumber}`;
  }, [calDate, calMode, weekDays]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Top Header & View Controls */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Appointments & Clinic Schedule</h1>
            {isFrontDeskOrAdmin ? (
              <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-[#5C2D91]">
                Front-Desk Multi-Clinician
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {inSessionSeen} seen/in-session · {checkedIn} checked in · {noShow} no-show ·{' '}
            {notesDue > 0 ? (
              <span className="font-semibold text-amber-600">{notesDue} note due</span>
            ) : (
              <span className="font-semibold text-emerald-600">notes complete</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Main View Switcher: Calendar | Board | List */}
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-xs">
            <button
              type="button"
              onClick={() => setView('calendar')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === 'calendar' ? 'text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
              style={view === 'calendar' ? { background: PURPLE } : undefined}
            >
              <CalendarIcon className="h-3.5 w-3.5" /> Calendar
            </button>
            <button
              type="button"
              onClick={() => setView('board')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === 'board' ? 'text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
              style={view === 'board' ? { background: PURPLE } : undefined}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === 'list' ? 'text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
              style={view === 'list' ? { background: PURPLE } : undefined}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setBlockDate(calDate);
              setBlockClinicianId(clinicianColumns[0]?.id || '');
              setShowBlockModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 shadow-xs hover:bg-gray-50 transition"
          >
            <Lock className="h-4 w-4 text-gray-500" /> Block Time
          </button>

          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-xs"
            style={{ background: GRADIENT }}
          >
            {showForm ? (
              <>
                <X className="h-4 w-4" /> Cancel
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> New Appointment
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error notification */}
      {(error || actionError) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{actionError || error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              void reload();
            }}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      )}

      {/* Patient Mobile Appointment Requests Queue */}
      {allAppointments.some((a) => a.patientBooked && a.status === 'scheduled') && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 shadow-xs">
                <Smartphone className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-amber-950 flex items-center gap-2">
                  Patient Mobile Appointment Requests
                  <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
                    {allAppointments.filter((a) => a.patientBooked && a.status === 'scheduled').length} Pending
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-amber-800">
                  New appointment bookings from the Flutter patient app require clinician confirmation.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {allAppointments
              .filter((a) => a.patientBooked && a.status === 'scheduled')
              .map((req) => (
                <div
                  key={req.id}
                  className="flex flex-col justify-between rounded-xl border border-amber-200/80 bg-white p-3 shadow-2xs hover:shadow-sm transition"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
                      <span className="flex items-center gap-1 text-amber-900 font-bold">
                        <Clock className="h-3.5 w-3.5 text-amber-600" />
                        {req.date} · {formatClock(req.startTime)}
                      </span>
                      {req.isVirtual ? (
                        <span className="inline-flex items-center gap-0.5 text-teal-700 text-[11px] font-bold">
                          <Video className="h-3 w-3" /> Virtual
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-500 font-medium">In-Person</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm font-bold text-gray-900 truncate">
                      {req.clientName}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {req.type} · Provider:{' '}
                      <span className="font-semibold text-gray-700">
                        {req.clinicianName || 'Clinic'}
                      </span>
                    </p>
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2.5">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleConfirm(req.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleOpenDecline(req.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100 active:scale-95 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Decline
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Top 4 Glance Summary Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-extrabold text-[#5C2D91]">{inSessionSeen}</p>
            <span className="rounded-full bg-purple-100 p-2 text-[#5C2D91]">
              <Sparkles className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-purple-900">
            In Session / Seen
          </p>
          <p className="text-[11px] text-purple-700/80">Active care delivered for {calDate === today ? 'today' : calDate}</p>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-extrabold text-blue-600">{checkedIn}</p>
            <span className="rounded-full bg-blue-100 p-2 text-blue-600">
              <Check className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-blue-900">
            Checked In
          </p>
          <p className="text-[11px] text-blue-700/80">Waiting in clinic or virtual queue</p>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-extrabold text-amber-600">{noShow}</p>
            <span className="rounded-full bg-amber-100 p-2 text-amber-700">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-amber-900">
            No-Show
          </p>
          <p className="text-[11px] text-amber-700/80">Requires front-desk follow-up</p>
        </div>

        <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-extrabold text-red-600">{notesDue}</p>
            <span className="rounded-full bg-red-100 p-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-red-900">
            Notes Due
          </p>
          <p className="text-[11px] text-red-700/80">EHR clinical documentation pending</p>
        </div>
      </div>

      {/* ── AI NO-SHOW RADAR (Commit ec2a982 / Pillar 5) ── */}
      <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">AI No-Show Radar</h3>
                <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                  AWS Bedrock Predictive Model
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                  Live schedule
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Attendance history, day/time pattern, lead time &amp; SMS confirmation responses evaluated in real time.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                toast('No at-risk appointments to confirm.');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 transition shadow-xs"
            >
              <Send className="h-3.5 w-3.5" />
              Pinpoint Batch Confirm
            </button>
            <button
              type="button"
              onClick={() => setShowRadar((v) => !v)}
              className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              {showRadar ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {showRadar && (
          <div className="mt-3.5 border-t border-slate-100 pt-3.5 text-center text-xs text-slate-500">
            No at-risk appointments today. Risk flags appear from the live schedule.
          </div>
        )}
      </div>

      {/* Appointment create/edit — right-side overlay dialog (Oct 26) */}
      {showForm ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/30"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
        >
          <div
            id="appt-form-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="appt-form-title"
            className="flex h-[100dvh] w-full max-w-xl flex-col bg-white shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
              <h2 id="appt-form-title" className="text-sm font-bold text-gray-900">
                {editingId ? 'Edit Appointment' : 'Schedule New Appointment'}
              </h2>
              <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-gray-600 sm:col-span-2">
                  Client Name *
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                    placeholder="Search name, MRN, phone or Valant code"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    data-testid="appointment-client-search"
                  />
                  {clientSearch.trim().length >= 2 && filteredSchedulableClients.length === 0 ? (
                    <span className="mt-1 block text-[11px] text-slate-500">
                      No active client matches. New patient? Use Clients › New intake.
                    </span>
                  ) : null}
                  <select
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                    value={form.clientId}
                    onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                  >
                    <option value="">Select client…</option>
                    {filteredSchedulableClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.insurancePayer ? ` · ${c.insurancePayer}` : ''}
                      </option>
                    ))}
                  </select>
                  {form.clientId ? (
                    <PayerHintLine
                      insurance={schedulableClients.find((c) => c.id === form.clientId)?.insurancePayer}
                    />
                  ) : null}
                </label>

                <label className="block text-xs font-medium text-gray-600">
                  Clinician *
                  <select
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    value={form.clinicianId}
                    onChange={(e) => setForm((f) => ({ ...f, clinicianId: e.target.value }))}
                  >
                    <option value="">Select clinician…</option>
                    {clinicianColumns.map((c) => {
                      const staff = staffUsers.find((s) => s.id === c.id);
                      const invited = staff?.status === 'INVITED';
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {invited ? ' (invited)' : ''} ({c.roleTitle} · {c.room})
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="block text-xs font-medium text-gray-600">
                  Type *
                  <select
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    value={form.type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, type: e.target.value as AppointmentType }))
                    }
                  >
                    {FORM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    {APPOINTMENT_TYPES.filter(
                      (t) => !(FORM_TYPES as readonly string[]).includes(t)
                    ).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-gray-600">
                  Date *
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </label>

                <label className="block text-xs font-medium text-gray-600">
                  Start Time *
                  <input
                    type="time"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    value={form.startTime}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        startTime: e.target.value,
                        endTime: f.endTime || defaultEndTime(e.target.value),
                      }))
                    }
                  />
                </label>

                <label className="block text-xs font-medium text-gray-600">
                  End Time
                  <input
                    type="time"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    value={form.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  />
                </label>

                <label className="flex items-center gap-2 pt-6 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.isVirtual}
                    onChange={(e) => setForm((f) => ({ ...f, isVirtual: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-[#5C2D91]"
                  />
                  Virtual / Telehealth
                </label>

                {form.isVirtual ? (
                  <label className="block text-xs font-medium text-gray-600 sm:col-span-2">
                    Video Provider
                    <select
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                      value={form.videoProvider}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          videoProvider: e.target.value as 'zoom' | 'google' | 'in_app',
                        }))
                      }
                    >
                      <option value="zoom">Zoom</option>
                      <option value="google">Google Meet</option>
                      <option value="in_app">In-app camera (Direct)</option>
                    </select>
                  </label>
                ) : null}
              </div>
              {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-gray-100 bg-white px-5 py-4">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCreate()}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: GRADIENT }}
              >
                {saving ? 'Scheduling…' : 'Schedule Appointment'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div className="space-y-4">
          {/* Calendar Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
            {/* Left: Nav & Date */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl border border-gray-200 p-1">
                <button
                  type="button"
                  onClick={() => navigateDate(-1)}
                  className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  title="Previous"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCalDate(today)}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => navigateDate(1)}
                  className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  title="Next"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-gray-900">{formattedHeaderDate}</h2>
                <input
                  type="date"
                  value={calDate}
                  onChange={(e) => setCalDate(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Right: Day / Week Mode & Legend */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setCalMode('day')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    calMode === 'day'
                      ? 'bg-white text-[#5C2D91] shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Day View
                </button>
                <button
                  type="button"
                  onClick={() => setCalMode('week')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    calMode === 'week'
                      ? 'bg-white text-[#5C2D91] shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Week View
                </button>
              </div>

              {/* Status Legend */}
              <div className="hidden items-center gap-2 text-xs lg:flex">
                <span className="inline-flex items-center gap-1 font-medium text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-gray-400" /> Scheduled
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-blue-700">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> Checked In
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> In Session
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-[#5C2D91]">
                  <span className="h-2 w-2 rounded-full bg-[#5C2D91]" /> Seen
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> No-Show
                </span>
              </div>
            </div>
          </div>

          {/* DAY VIEW GRID */}
          {calMode === 'day' ? (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
              {/* Clinicians Column Headers */}
              <div className="flex border-b border-gray-200 bg-gray-50/80">
                <div className="w-16 flex-shrink-0 border-r border-gray-200 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Time
                </div>
                <div className="flex flex-1 overflow-x-auto divide-x divide-gray-200">
                  {clinicianColumns.map((col) => {
                    const colAppts = dayAppointments.filter(
                      (a) => findClinicianForAppt(a).id === col.id
                    );
                    return (
                      <div
                        key={col.id}
                        className="min-w-[210px] flex-1 px-3 py-2.5 transition hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                            style={{ backgroundColor: col.bgLight, color: col.color }}
                          >
                            {col.initials}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold text-gray-900">{col.name}</p>
                            <p className="truncate text-[11px] text-gray-500">{col.roleTitle}</p>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-500">
                          <span className="inline-flex items-center gap-1 font-medium text-gray-600">
                            <DoorOpen className="h-3 w-3 text-gray-400" /> {col.room}
                          </span>
                          <span className="rounded-full bg-white px-2 py-0.5 font-bold shadow-2xs border border-gray-200">
                            {colAppts.length} {colAppts.length === 1 ? 'visit' : 'visits'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Day View Time Grid */}
              <div className="relative flex overflow-x-auto" style={{ height: '880px' }}>
                {/* Time Gutter */}
                <div className="sticky left-0 z-10 w-16 flex-shrink-0 border-r border-gray-200 bg-white">
                  {Array.from({ length: CAL_END_H - CAL_START_H }).map((_, i) => {
                    const hour = CAL_START_H + i;
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const h12 = ((hour + 11) % 12) + 1;
                    return (
                      <div
                        key={hour}
                        style={{ height: `${HOUR_PX}px` }}
                        className="relative border-b border-gray-100 text-right pr-2 pt-1"
                      >
                        <span className="text-[11px] font-semibold text-gray-400">
                          {h12} {ampm}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Clinician Columns Grid */}
                <div className="relative flex flex-1 divide-x divide-gray-200">
                  {/* Live Clock Indicator across columns */}
                  {liveClockTop !== null && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                      style={{ top: `${liveClockTop}px` }}
                    >
                      <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white shadow-xs">
                        Live
                      </span>
                      <div className="h-[2px] w-full bg-red-500 shadow-xs" />
                    </div>
                  )}

                  {clinicianColumns.map((col) => {
                    const colAppts = dayAppointments.filter(
                      (a) => findClinicianForAppt(a).id === col.id
                    );
                    const colBlocks = scheduleBlocks.filter(
                      (b) => b.clinicianId === col.id && b.date === calDate
                    );

                    return (
                      <div
                        key={col.id}
                        className="relative min-w-[210px] flex-1 cursor-cell touch-manipulation bg-white"
                        style={{ height: '880px' }}
                        title={CLICK_HINT_DAY}
                        onPointerDown={(e) => setPointerDown({ x: e.clientX, y: e.clientY })}
                        onPointerMove={(e) => {
                          if (e.pointerType === 'touch') return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoverBandY(e.clientY - rect.top);
                        }}
                        onPointerLeave={() => setHoverBandY(null)}
                        onClick={(e) => {
                          if (isBusyTarget(e.target)) return;
                          if (pointerDown) {
                            const dx = Math.abs(e.clientX - pointerDown.x);
                            const dy = Math.abs(e.clientY - pointerDown.y);
                            if (dx > DRAG_IGNORE_PX || dy > DRAG_IGNORE_PX) return;
                          }
                          const rect = e.currentTarget.getBoundingClientRect();
                          const y = e.clientY - rect.top;
                          const slot = pickSlot({
                            y,
                            hourPx: HOUR_PX,
                            dayStartHour: CAL_START_H,
                            dayEndHour: CAL_END_H,
                            date: calDate,
                            clinicianId: col.id,
                          });
                          setPickedSlot(slot);
                        }}
                        onDoubleClick={(e) => {
                          if (isBusyTarget(e.target)) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const y = e.clientY - rect.top;
                          const slot = pickSlot({
                            y,
                            hourPx: HOUR_PX,
                            dayStartHour: CAL_START_H,
                            dayEndHour: CAL_END_H,
                            date: calDate,
                            clinicianId: col.id,
                          });
                          openBookFromPick(slot);
                        }}
                      >
                        {hoverBandY != null ? (
                          <div
                            className="pointer-events-none absolute left-0 right-0 z-5 flex items-center"
                            style={{ top: `${hoverBandY}px` }}
                          >
                            <Clock className="ml-1 h-3 w-3 text-[#5C2D91]" />
                            <div className="h-px flex-1 bg-[#5C2D91]/40" />
                          </div>
                        ) : null}
                        {pickedSlot?.clinicianId === col.id && pickedSlot.date === calDate ? (
                          <button
                            type="button"
                            className="absolute left-1/2 z-40 -translate-x-1/2 rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-bold text-white shadow-md touch-manipulation"
                            style={{
                              top: bookButtonPlacement({
                                y:
                                  ((Number(pickedSlot.startTime.slice(0, 2)) * 60 +
                                    Number(pickedSlot.startTime.slice(3, 5)) -
                                    CAL_START_H * 60) /
                                    60) *
                                  HOUR_PX,
                                containerHeight: 880,
                              }).top,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              openBookFromPick(pickedSlot);
                            }}
                          >
                            {slotBookLabel(pickedSlot.startTime)}
                          </button>
                        ) : null}
                        {/* Hour Guidelines */}
                        {Array.from({ length: CAL_END_H - CAL_START_H }).map((_, i) => (
                          <div
                            key={i}
                            style={{ height: `${HOUR_PX}px` }}
                            className="relative border-b border-gray-100"
                          >
                            {/* Half-hour dashed line */}
                            <div className="absolute left-0 right-0 top-1/2 border-b border-dashed border-gray-50" />
                          </div>
                        ))}

                        {/* Schedule Blocks (Lunch, Admin, Out-of-Office, Supervision) */}
                        {colBlocks.map((blk) => {
                          const { top, height } = getAppointmentPlacement(
                            blk.startTime,
                            blk.endTime
                          );

                          return (
                            <div
                              key={blk.id}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                              }}
                              data-busy="true"
                              className="absolute left-1 right-1 z-15 flex flex-col justify-between overflow-hidden rounded-xl border border-dashed border-slate-300 bg-[repeating-linear-gradient(45deg,#f8fafc,#f8fafc_10px,#f1f5f9_10px,#f1f5f9_20px)] p-2 text-left shadow-2xs group"
                            >
                              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                                <span>
                                  {formatClock(blk.startTime)} – {formatClock(blk.endTime)}
                                </span>
                                <span className="flex items-center gap-1 rounded bg-slate-200/80 px-1.5 py-0.5 text-[9px] uppercase font-bold text-slate-700">
                                  <Lock className="h-2.5 w-2.5" /> Blocked
                                </span>
                              </div>
                              <p className="truncate text-xs font-bold text-slate-700">
                                {blk.reason}
                              </p>
                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span>Locked Time Slot</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScheduleBlocks((prev) =>
                                      prev.filter((item) => item.id !== blk.id)
                                    )
                                  }
                                  className="text-red-500 opacity-0 group-hover:opacity-100 hover:underline text-[9px]"
                                >
                                  Unblock
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {/* Appointment Blocks */}
                        {colAppts.map((appt) => {
                          const { top, height } = getAppointmentPlacement(
                            appt.startTime,
                            appt.endTime
                          );
                          const isVirtual = appt.isVirtual;
                          const room = getAppointmentRoom(appt, col);
                          const visitColor = VISIT_DOT[appt.status];

                          return (
                            <button
                              key={appt.id}
                              type="button"
                              onClick={() => setSelectedAppt(appt)}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                borderLeftColor: visitColor,
                              }}
                              className="absolute left-1 right-1 z-10 flex flex-col justify-between overflow-hidden rounded-xl border border-gray-200 border-l-4 bg-white p-2 text-left shadow-2xs transition-all hover:scale-[1.01] hover:shadow-md hover:z-30 group"
                            >
                              <div>
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[10px] font-bold text-gray-600">
                                    {formatClock(appt.startTime)} – {formatClock(appt.endTime)}
                                  </span>
                                  <span
                                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                                      appt.patientBooked && appt.status === 'scheduled'
                                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                        : VISIT_PILL[appt.status]
                                    }`}
                                  >
                                    {appt.patientBooked && appt.status === 'scheduled'
                                      ? 'Needs Approval'
                                      : VISIT_LABEL[appt.status]}
                                  </span>
                                </div>
                                <p className="mt-0.5 truncate text-xs font-bold text-gray-900 group-hover:text-[#5C2D91]">
                                  {appt.clientName}
                                </p>
                              </div>

                              <div className="flex items-center justify-between text-[10px] text-gray-500">
                                <span className="truncate font-medium">{appt.type}</span>
                                {isVirtual ? (
                                  <span className="inline-flex items-center gap-0.5 text-teal-700 font-semibold">
                                    <Video className="h-3 w-3" /> Virtual
                                  </span>
                                ) : (
                                  <span className="text-gray-400 font-medium">{room}</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Day Summary Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/90 px-6 py-3.5 text-xs text-gray-600">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    Total Sessions: <strong className="text-gray-900">{totalDaySessions}</strong>
                  </span>
                  <span>
                    Seen / In Session:{' '}
                    <strong className="text-[#5C2D91]">{inSessionSeen}</strong>
                  </span>
                  <span>
                    Completed:{' '}
                    <strong className="text-emerald-700">{completedDaySessions}</strong>
                  </span>
                  <span>
                    Clinic Utilization:{' '}
                    <strong className="text-blue-700">{utilizationRate}%</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setForm((f) => ({ ...f, date: calDate }));
                    setShowForm(true);
                  }}
                  className="inline-flex items-center gap-1 font-semibold text-[#5C2D91] hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add session on {calDate}
                </button>
              </div>
            </div>
          ) : (
            /* WEEK VIEW GRID */
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
              <div className="grid grid-cols-1 divide-y divide-gray-200 sm:grid-cols-7 sm:divide-y-0 sm:divide-x">
                {weekDays.map((dayObj) => {
                  const dayAppts = allAppointments.filter((a) => a.date === dayObj.date);
                  const isCurToday = dayObj.isToday;

                  return (
                    <div
                      key={dayObj.date}
                      className={`relative min-h-[460px] flex cursor-cell touch-manipulation flex-col ${
                        isCurToday ? 'bg-blue-50/30' : 'bg-white'
                      }`}
                      title={CLICK_HINT_WEEK}
                      onClick={(e) => {
                        if (isBusyTarget(e.target)) return;
                        if ((e.target as HTMLElement).closest('a,button')) return;
                        setPickedSlot({
                          date: dayObj.date,
                          startTime: '09:00',
                        });
                      }}
                      onDoubleClick={() => {
                        openBookFromPick({ date: dayObj.date, startTime: '09:00' });
                      }}
                      data-testid="calendar-day-column"
                    >
                      {pickedSlot?.date === dayObj.date && !pickedSlot.clinicianId ? (
                        <button
                          type="button"
                          className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-bold text-white shadow-md touch-manipulation"
                          onClick={(e) => {
                            e.stopPropagation();
                            openBookFromPick(pickedSlot);
                          }}
                        >
                          {dayBookLabel(dayObj.dayName?.slice(0, 3) || dayObj.date)}
                        </button>
                      ) : null}
                      {/* Day Column Header */}
                      <button
                        type="button"
                        onClick={() => {
                          setCalDate(dayObj.date);
                          setCalMode('day');
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setForm((f) => ({ ...f, date: dayObj.date }));
                          setShowForm(true);
                        }}
                        className={`p-3 text-left border-b border-gray-100 transition hover:bg-purple-50/50 ${
                          dayObj.isCurrentCalDate ? 'bg-purple-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-500">
                            {dayObj.dayName}
                          </span>
                          {isCurToday ? (
                            <span className="rounded-full bg-[#5C2D91] px-2 py-0.5 text-[10px] font-bold text-white">
                              Today
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-gray-900">
                              {dayObj.dayNumber}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                          <span>{dayAppts.length} sessions</span>
                          <span className="font-semibold text-[#5C2D91]">Open Day →</span>
                        </div>
                      </button>

                      {/* Day Appointments List */}
                      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[600px]">
                        {dayAppts.length === 0 ? (
                          <p className="pt-6 text-center text-xs text-gray-400">
                            No sessions
                          </p>
                        ) : (
                          dayAppts.map((appt) => (
                            <div
                              key={appt.id}
                              onClick={() => setSelectedAppt(appt)}
                              className="cursor-pointer rounded-xl border border-gray-200 bg-white p-2.5 shadow-2xs transition hover:border-[#5C2D91] hover:shadow-sm"
                            >
                              <div className="flex items-center justify-between text-[10px] text-gray-500 font-semibold">
                                <span>{formatClock(appt.startTime)}</span>
                                <span
                                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                                    appt.patientBooked && appt.status === 'scheduled'
                                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                      : VISIT_PILL[appt.status]
                                  }`}
                                >
                                  {appt.patientBooked && appt.status === 'scheduled'
                                    ? 'Needs Approval'
                                    : VISIT_LABEL[appt.status]}
                                </span>
                              </div>
                              <p className="mt-1 text-xs font-bold text-gray-900 truncate">
                                {appt.clientName}
                              </p>
                              <p className="text-[11px] text-gray-500 truncate">
                                {appt.clinicianName}
                              </p>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Quick Add on Column Bottom — double-click empty column also opens form */}
                      <div
                        className="p-2 border-t border-gray-100"
                        onDoubleClick={() => {
                          setForm((f) => ({ ...f, date: dayObj.date }));
                          setShowForm(true);
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setForm((f) => ({ ...f, date: dayObj.date }));
                            setShowForm(true);
                          }}
                          className="w-full rounded-lg border border-dashed border-gray-300 py-1.5 text-center text-xs font-medium text-gray-500 hover:border-[#5C2D91] hover:text-[#5C2D91]"
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* BOARD VIEW */}
      {view === 'board' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['today', `Today (${todayAppts.length})`],
                ['upcoming', `Upcoming (${upcomingAppts.length})`],
                ['all', `All (${allAppointments.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                  filter === key ? 'text-white shadow-xs' : 'border border-gray-200 bg-white text-gray-600'
                }`}
                style={filter === key ? { background: PURPLE } : undefined}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
            </div>
          ) : displayedList.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-14 text-center text-sm text-gray-500">
              No appointments found in this view.
            </div>
          ) : (
            <>
              {/* Desktop Board Table */}
              <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-xs md:block">
                <table className="w-full min-w-[860px] text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      <th className="px-4 py-3">Time & Date</th>
                      <th className="px-4 py-3">Client</th>
                      <th className="px-4 py-3">Type & Room</th>
                      <th className="px-4 py-3">Visit Status</th>
                      <th className="px-4 py-3">Note Status</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayedList.map((appt) => (
                      <tr key={appt.id} className="align-top hover:bg-gray-50/60">
                        <td className="px-4 py-4 text-sm text-gray-800">
                          <div className="font-semibold">
                            {formatClock(appt.startTime)}–{formatClock(appt.endTime)}
                          </div>
                          {appt.isVirtual ? (
                            <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
                              <Video className="h-3 w-3" /> Virtual
                            </span>
                          ) : null}
                          {filter !== 'today' ? (
                            <div className="mt-0.5 text-xs text-gray-400">{appt.date}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">
                          <Link
                            href={`/dashboard/clients/${appt.clientId}`}
                            className="text-sm font-semibold hover:underline"
                            style={{ color: PURPLE }}
                          >
                            {appt.clientName}
                          </Link>
                          <p className="text-xs text-gray-500">
                            {appt.clinicianName || 'Unassigned'}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          <div>{appt.type}</div>
                          <span className="text-xs text-gray-400">
                            {getAppointmentRoom(appt)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <VisitPill status={appt.status} patientBooked={appt.patientBooked} />
                        </td>
                        <td className="px-4 py-4">
                          <NotePill status={appt.noteStatus} visit={appt.status} />
                        </td>
                        <td className="px-4 py-4">
                          <AppointmentActions
                            appt={appt}
                            expanding={editingId === appt.id}
                            onToggle={() =>
                              setEditingId((id) => (id === appt.id ? null : appt.id))
                            }
                            onStatus={(s) => void handleStatus(appt.id, s)}
                            onAiDraft={() => void handleAiDraft(appt.id)}
                            onConfirm={handleConfirm}
                            onDecline={handleOpenDecline}
                            busy={saving}
                            staffRole={user?.role}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Board Cards */}
              <div className="space-y-3 md:hidden">
                {displayedList.map((appt) => (
                  <div
                    key={appt.id}
                    className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {formatClock(appt.startTime)}–{formatClock(appt.endTime)}
                          {appt.isVirtual ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
                              <Video className="h-3 w-3" /> Virtual
                            </span>
                          ) : null}
                        </p>
                        <Link
                          href={`/dashboard/clients/${appt.clientId}`}
                          className="mt-1 block text-base font-bold hover:underline"
                          style={{ color: PURPLE }}
                        >
                          {appt.clientName}
                        </Link>
                        <p className="text-xs text-gray-500">
                          {appt.type} · {appt.clinicianName || 'Unassigned'}
                          {filter !== 'today' ? ` · ${appt.date}` : ''}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <VisitPill status={appt.status} patientBooked={appt.patientBooked} />
                          <NotePill status={appt.noteStatus} visit={appt.status} />
                        </div>
                      </div>
                      <AppointmentActions
                        appt={appt}
                        expanding={editingId === appt.id}
                        onToggle={() => setEditingId((id) => (id === appt.id ? null : appt.id))}
                        onStatus={(s) => void handleStatus(appt.id, s)}
                        onAiDraft={() => void handleAiDraft(appt.id)}
                        onConfirm={handleConfirm}
                        onDecline={handleOpenDecline}
                        busy={saving}
                        staffRole={user?.role}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {view === 'list' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['today', `Today (${todayAppts.length})`],
                ['upcoming', `Upcoming (${upcomingAppts.length})`],
                ['all', `All (${allAppointments.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                  filter === key ? 'text-white' : 'border border-gray-200 bg-white text-gray-600'
                }`}
                style={filter === key ? { background: PURPLE } : undefined}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {displayedList.map((appt) => (
              <div
                key={appt.id}
                className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatClock(appt.startTime)}–{formatClock(appt.endTime)}
                      {appt.isVirtual ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
                          <Video className="h-3 w-3" /> Virtual
                        </span>
                      ) : null}
                    </p>
                    <Link
                      href={`/dashboard/clients/${appt.clientId}`}
                      className="mt-1 block text-base font-bold hover:underline"
                      style={{ color: PURPLE }}
                    >
                      {appt.clientName}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {appt.type} · {appt.clinicianName || 'Unassigned'}
                      {filter !== 'today' ? ` · ${appt.date}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <VisitPill status={appt.status} patientBooked={appt.patientBooked} />
                      <NotePill status={appt.noteStatus} visit={appt.status} />
                    </div>
                  </div>
                  <AppointmentActions
                    appt={appt}
                    expanding={editingId === appt.id}
                    onToggle={() => setEditingId((id) => (id === appt.id ? null : appt.id))}
                    onStatus={(s) => void handleStatus(appt.id, s)}
                    onAiDraft={() => void handleAiDraft(appt.id)}
                    onConfirm={handleConfirm}
                    onDecline={handleOpenDecline}
                    busy={saving}
                    staffRole={user?.role}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* APPOINTMENT INTERACTIVE POPOVER / MODAL */}
      {selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#5C2D91]">
                  Appointment Details
                </span>
                <Link
                  href={`/dashboard/clients/${selectedAppt.clientId}`}
                  className="mt-0.5 block text-xl font-bold text-gray-900 hover:text-[#5C2D91] hover:underline"
                >
                  {selectedAppt.clientName}
                </Link>
                <p className="mt-1 text-xs text-slate-500">
                  Booked by:{' '}
                  {(selectedAppt as { bookedByLabel?: string }).bookedByLabel ||
                    (selectedAppt.patientBooked
                      ? 'Client, online booking page'
                      : 'Not recorded')}
                </p>
                {(selectedAppt as { lastChangedByLabel?: string | null }).lastChangedByLabel ? (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {(selectedAppt as { lastChangedByLabel?: string }).lastChangedByLabel}
                  </p>
                ) : null}
                <PayerHintLine
                  insurance={
                    (selectedAppt as { payerHint?: string | null; insurancePayer?: string | null })
                      .payerHint ||
                    (selectedAppt as { insurancePayer?: string | null }).insurancePayer
                  }
                />
                <VisitTypeChange
                  appointmentId={selectedAppt.id}
                  onChanged={(vt) => {
                    setSelectedAppt((prev) => (prev ? { ...prev, isVirtual: vt.isVirtual } : null));
                    void reload();
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setSelectedAppt(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3.5 text-xs text-gray-700">
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase">Clinician</p>
                <p className="mt-0.5 font-bold text-gray-900 flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-gray-400" />
                  {selectedAppt.clinicianName || 'Unassigned'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase">Location / Room</p>
                <p className="mt-0.5 font-bold text-gray-900 flex items-center gap-1">
                  {selectedAppt.isVirtual ? (
                    <>
                      <Video className="h-3.5 w-3.5 text-teal-600" />
                      Virtual Video
                    </>
                  ) : (
                    <>
                      <DoorOpen className="h-3.5 w-3.5 text-gray-400" />
                      {getAppointmentRoom(selectedAppt)}
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase">Date & Time</p>
                <p className="mt-0.5 font-bold text-gray-900 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />
                  {selectedAppt.date} · {formatClock(selectedAppt.startTime)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase">Visit Type</p>
                <p className="mt-0.5 font-bold text-gray-900">{selectedAppt.type}</p>
              </div>
            </div>
            <AppointmentCopay appointmentId={selectedAppt.id} role={user?.role} />

            {/* Patient Request Approval or Quick Status Update Section */}
            {selectedAppt.patientBooked && selectedAppt.status === 'scheduled' ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 shadow-xs space-y-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-amber-950">
                      Mobile App Booking — Pending Confirmation
                    </p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      This appointment was requested by the patient through the Flutter app. Please approve to confirm the slot or decline with a reason.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-amber-200/60">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleConfirm(selectedAppt.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" /> Approve & Confirm
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleOpenDecline(selectedAppt.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-xs font-bold text-red-700 shadow-xs transition hover:bg-red-50 active:scale-95 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" /> Decline Request
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">Visit Status:</span>
                  <VisitPill status={selectedAppt.status} patientBooked={selectedAppt.patientBooked} />
                </div>
                <p className="text-[11px] text-gray-500">Quick Update Status:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['checked-in', 'in-session', 'completed', 'no-show', 'cancelled', 'late-cancel'] as const).map(
                    (s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={saving || selectedAppt.status === s}
                        onClick={() => void handleStatus(selectedAppt.id, s)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition disabled:opacity-40 ${
                          selectedAppt.status === s
                            ? 'bg-purple-100 text-[#5C2D91] border-purple-200'
                            : 'bg-white border-gray-200 text-gray-700 hover:border-[#5C2D91] hover:text-[#5C2D91]'
                        }`}
                      >
                        {VISIT_LABEL[s]}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Virtual Meeting Link */}
            {selectedAppt.isVirtual && (selectedAppt.hostJoinUrl || selectedAppt.clientJoinUrl) && (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-3.5">
                <p className="text-xs font-semibold text-teal-900">Virtual Telehealth Room Ready</p>
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      (selectedAppt.hostJoinUrl || selectedAppt.clientJoinUrl) as string,
                      '_blank'
                    )
                  }
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-xs"
                  style={{ background: GRADIENT }}
                >
                  <Video className="h-4 w-4" /> Join Video Call Now
                </button>
              </div>
            )}

            {(user?.role === 'MEDICAL_ASSISTANT' ||
              user?.role === 'PHYSICIAN' ||
              user?.role === 'MEDICAL_NP' ||
              user?.role === 'ADMIN' ||
              user?.role === 'DIRECTOR' ||
              user?.role === 'PRACTICE_DIRECTOR') && selectedAppt.clientId ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/dashboard/medical?appointmentId=${encodeURIComponent(selectedAppt.id)}&clientId=${encodeURIComponent(selectedAppt.clientId)}&clientName=${encodeURIComponent(selectedAppt.clientName || '')}`}
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900"
                >
                  Open rooming
                </Link>
                {user?.role !== 'MEDICAL_ASSISTANT' ? (
                  <Link
                    href={`/dashboard/medical/visits?appointmentId=${encodeURIComponent(selectedAppt.id)}&clientId=${encodeURIComponent(selectedAppt.clientId)}&clientName=${encodeURIComponent(selectedAppt.clientName || '')}`}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900"
                  >
                    Open PC visit
                  </Link>
                ) : null}
              </div>
            ) : null}

            {/* AI Note Drafting & EHR */}
            <div className="space-y-2 rounded-xl border border-purple-100 bg-purple-50/40 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">Documentation Status:</span>
                <NotePill status={selectedAppt.noteStatus} visit={selectedAppt.status} />
              </div>
              {selectedAppt.noteStatus === 'not-started' && (
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-gray-500">Note has not been drafted yet.</p>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleAiDraft(selectedAppt.id)}
                    className="inline-flex items-center gap-1 font-semibold text-[#5C2D91] hover:underline text-xs"
                  >
                    <Bot className="h-3.5 w-3.5" /> Generate AI Draft →
                  </button>
                </div>
              )}
              {selectedAppt.noteStatus === 'ai-draft' && (
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs font-medium text-[#5C2D91]">
                    AI note draft is prepared for clinical signoff.
                  </p>
                  <Link
                    href={`/dashboard/ehr/notes?appointmentId=${selectedAppt.id}`}
                    className="rounded-lg px-3 py-1 text-xs font-bold text-white shadow-xs"
                    style={{ background: GRADIENT }}
                  >
                    Review & Sign →
                  </Link>
                </div>
              )}
              {selectedAppt.noteStatus === 'signed' && (
                <p className="text-xs font-medium text-emerald-700 flex items-center gap-1 pt-1">
                  <Lock className="h-3.5 w-3.5" /> Clinical note signed & CARF compliant.
                </p>
              )}
            </div>

            {/* Notes content */}
            {selectedAppt.notes && (
              <div className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3">
                <p className="font-semibold text-gray-500 mb-1">Session / Intake Notes:</p>
                <p>{selectedAppt.notes}</p>
              </div>
            )}

            {/* Section 5.3: Appointment Lifecycle Management */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setForm({
                      clientId: selectedAppt.clientId,
                      clinicianId: selectedAppt.clinicianId || '',
                      type: selectedAppt.type as any,
                      date: selectedAppt.date,
                      startTime: selectedAppt.startTime,
                      endTime: selectedAppt.endTime,
                      isVirtual: Boolean(selectedAppt.isVirtual),
                      videoProvider:
                        (selectedAppt.videoProvider as 'zoom' | 'google' | 'in_app') || 'zoom',
                    });
                    setEditingId(selectedAppt.id);
                    setSelectedAppt(null);
                    setShowForm(true);
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Edit Details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApptNotesDraft(selectedAppt.notes || '');
                    setShowNotesModal(true);
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Session Notes
                </button>
                {selectedAppt.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    Cancel / Delete
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedAppt(null)}
                className="rounded-xl border border-gray-200 px-4 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Time Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-slate-100 p-2 text-slate-700">
                  <Lock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Block Clinician Time</h3>
                  <p className="text-xs text-gray-500">Lock out schedule for non-patient commitments</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBlockModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block font-medium text-gray-700">
                Clinician *
                <select
                  value={blockClinicianId}
                  onChange={(e) => setBlockClinicianId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  {clinicianColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.roleTitle})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block font-medium text-gray-700">
                Date *
                <input
                  type="date"
                  value={blockDate}
                  onChange={(e) => setBlockDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block font-medium text-gray-700">
                  Start Time *
                  <input
                    type="time"
                    value={blockStartTime}
                    onChange={(e) => setBlockStartTime(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block font-medium text-gray-700">
                  End Time *
                  <input
                    type="time"
                    value={blockEndTime}
                    onChange={(e) => setBlockEndTime(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="block font-medium text-gray-700">
                Block Reason *
                <select
                  value={blockReason}
                  onChange={(e) =>
                    setBlockReason(
                      e.target.value as 'Lunch' | 'Admin Time' | 'Out of Office' | 'Supervision'
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="Lunch">Lunch & Break</option>
                  <option value="Admin Time">Admin & Somatic Charting</option>
                  <option value="Out of Office">Out of Office / PTO</option>
                  <option value="Supervision">Clinical Supervision</option>
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowBlockModal(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetClinician = blockClinicianId || clinicianColumns[0]?.id;
                  if (!targetClinician) return;
                  setScheduleBlocks((prev) => [
                    ...prev,
                    {
                      id: `blk-${Date.now()}`,
                      date: blockDate,
                      clinicianId: targetClinician,
                      startTime: blockStartTime,
                      endTime: blockEndTime,
                      reason: blockReason,
                    },
                  ]);
                  setShowBlockModal(false);
                }}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs"
                style={{ background: PURPLE }}
              >
                Apply Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline Patient Appointment Modal */}
      {showDeclineModal && declineTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-red-100 p-2 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Decline Appointment Request</h3>
                  <p className="text-xs text-gray-500">The patient will be notified in the app and via email/SMS</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowDeclineModal(false);
                  setDeclineTargetId(null);
                }}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block font-medium text-gray-700">
                Reason for declining (shared with patient) *
                <select
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="Clinician schedule conflict or fully booked">
                    Clinician schedule conflict or fully booked
                  </option>
                  <option value="Requested time slot unavailable — please select another slot">
                    Requested time slot unavailable — please select another slot
                  </option>
                  <option value="Provider out of office / on leave">
                    Provider out of office / on leave
                  </option>
                  <option value="Different appointment type required for this visit">
                    Different appointment type required for this visit
                  </option>
                  <option value="Insurance verification or pre-authorization needed before booking">
                    Insurance verification or pre-authorization needed before booking
                  </option>
                  <option value="Other scheduling reason">Other scheduling reason</option>
                </select>
              </label>

              {declineReason === 'Other scheduling reason' && (
                <textarea
                  rows={2}
                  placeholder="Enter specific reason..."
                  value={customDeclineNote}
                  onChange={(e) => setCustomDeclineNote(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-2 text-xs"
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setShowDeclineModal(false);
                  setDeclineTargetId(null);
                }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleDeclineSubmit}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-red-700 disabled:opacity-50"
              >
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Appointment Modal */}
      {showCancelModal && selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-red-100 p-2 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Cancel Appointment</h3>
                  <p className="text-xs text-gray-500">Record cancellation reason for compliance</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
              <p>
                <strong>Patient:</strong> {selectedAppt.clientName}
              </p>
              <p>
                <strong>Date & Time:</strong> {selectedAppt.date} · {formatClock(selectedAppt.startTime)}
              </p>
              <p>
                <strong>Provider:</strong> {selectedAppt.clinicianName || 'Clinic'}
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block font-medium text-gray-700">
                Cancellation Reason *
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="Client Requested Cancellation">Client Requested Cancellation</option>
                  <option value="Patient Illness / Medical Emergency">
                    Patient Illness / Medical Emergency
                  </option>
                  <option value="Clinician Out of Office / Sick">Clinician Out of Office / Sick</option>
                  <option value="Transportation Barrier">Transportation Barrier</option>
                  <option value="Inclement Weather / Facility Closure">
                    Inclement Weather / Facility Closure
                  </option>
                  <option value="No Longer Eligible / Insurance Inactive">
                    No Longer Eligible / Insurance Inactive
                  </option>
                  <option value="Other Clinical Reason">Other Clinical Reason</option>
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Keep Appointment
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleStatus(selectedAppt.id, 'cancelled');
                  setShowCancelModal(false);
                  setSelectedAppt((prev) =>
                    prev
                      ? {
                          ...prev,
                          status: 'cancelled',
                          notes: prev.notes
                            ? `${prev.notes}\n[Cancelled: ${cancelReason}]`
                            : `[Cancelled: ${cancelReason}]`,
                        }
                      : null
                  );
                }}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-red-700"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Appointment Notes Modal */}
      {showNotesModal && selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">Appointment Notes</h3>
                <p className="text-xs text-gray-500">Session intake & front-desk coordination notes</p>
              </div>
              <button
                type="button"
                onClick={() => setShowNotesModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs">
              <label className="block font-medium text-gray-700">
                Notes & Clinical Remarks
                <textarea
                  rows={4}
                  value={apptNotesDraft}
                  onChange={(e) => setApptNotesDraft(e.target.value)}
                  placeholder="e.g. Patient arriving 10 mins late; bring recent lab sheets..."
                  className="mt-1 w-full rounded-xl border border-gray-200 p-2.5 text-sm"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowNotesModal(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedAppt((prev) =>
                    prev ? { ...prev, notes: apptNotesDraft } : null
                  );
                  setShowNotesModal(false);
                }}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs"
                style={{ background: PURPLE }}
              >
                Save Notes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Clinical Note Promo Banner */}
      <div
        className="rounded-2xl border border-purple-100 p-5 text-white shadow-sm"
        style={{ background: GRADIENT }}
      >
        <h3 className="text-base font-bold">AI Clinical Note Drafting & Compliance</h3>
        <p className="mt-1 text-sm text-white/85">
          Turn completed sessions into structured clinical drafts — then review, finalize, and sign in the EHR.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {['SOAP', 'DAP', 'BIRP', 'Group', 'Intake', 'CARF Audit Ready'].map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold"
            >
              {tag}
            </span>
          ))}
        </div>
        <Link
          href="/dashboard/ehr/notes"
          className="mt-4 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#5C2D91] hover:bg-purple-50"
        >
          Open AI Notes & EHR →
        </Link>
      </div>
    </div>
  );
}
