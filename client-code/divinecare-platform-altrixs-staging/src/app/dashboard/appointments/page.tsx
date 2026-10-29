'use client';

import { groupProviders, providerGroupLabel, sortProviders } from '@/features/appointments/providerGroups';
import { SCHEDULABLE_STAFF_STATUSES } from '@/lib/staff/schedulable';
import {
  BOOK_BUSY_SELECTOR,
  bookButtonPlacement,
  bookedByText,
  clampCellOffset,
  clock12,
  dayBookLabel,
  shortDayLabel,
  formatStamp,
  isBookableBlock,
  pickSlot,
  slotBookLabel,
  slotTimeFromOffset,
} from '@/features/appointments/calendarSlots';
import { AppointmentCopay } from '@/components/billing/AppointmentCopay';
import { PreVisitBriefButton } from '@/components/ai/PreVisitBriefButton';
import { StartVisitButton } from '@/components/visits/StartVisitButton';
import { DocLightDot, DocLightLegend, VisitPaymentIcon, docLightText } from '@/components/scheduling/DocLightDot';
import { VISIT_PAYMENT_LABEL } from '@/lib/appointments/docLight';
import { ConsentsDueBadge, useConsentsDue, type ConsentsDue } from '@/components/consents/ConsentsDueBadge';
import { CheckInConsentDialog, type CheckInConsentPrompt } from '@/components/consents/CheckInConsentDialog';
import { AppointmentFrontOfficePanel } from '@/components/frontOffice/AppointmentFrontOfficePanel';
import { canUseFrontOffice } from '@/lib/frontOffice/access';
import { LicenseExpiredBanner } from '@/components/hr/LicenseExpiredBanner';
import Link from 'next/link';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  cx,
  EmptyState,
  FOCUS_RING,
  IconButton,
  inputClasses,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  type Tone,
} from '@/components/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
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
  Lock,
  MousePointerClick,
  Plus,
  Sparkles,
  User,
  Video,
  X,
  Tag,
  FileSignature,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AudioOnlyToggle, OverbookPrompt, RepeatFields } from '@/components/scheduling/AppointmentRepeatFields';
import { AppointmentBillingCodes } from '@/components/scheduling/AppointmentBillingCodes';
import { codesPayload, emptyCodesDraft, shouldSaveCodes, type CodesDraft } from '@/features/appointments/billingCodesDraft';
import { WaitlistSuggestionsPanel } from '@/components/scheduling/WaitlistSuggestionsPanel';
import type { WaitlistSuggestion } from '@/lib/scheduling/waitlistSuggest';
import { useAuth } from '@/features/auth';
import {
  useAppointments,
  fetchAppointmentLabels,
  setAppointmentLabel,
  updateAppointment as updateAppointmentApi,
  DuplicateAppointmentError,
  ClinicianOverlapError,
  ConsentRequiredError,
  createAppointmentSeries,
  updateAppointmentSeries,
  seriesChangesFromForm,
  type SeriesEditScope,
  emptyAppointmentForm,
  formValuesFromAppointment,
  saveAppointmentForm,
  validateAppointmentForm,
  type AppointmentFormMode,
  type AppointmentFormValues,
  APPOINTMENT_TYPES,
  VISIT_TRANSITIONS,
  type Appointment,
  type AppointmentStatus,
  type AppointmentType,
  type NoteStatus,
} from '@/features/appointments';
import { fetchClient, useClients } from '@/features/clients';
import { ClientSearchField } from '@/features/appointments/ClientSearchField';
import type { StaffUser } from '@/features/staff/types';
import { apiJson } from '@/lib/api-client';
import { useLocation } from '@/context/LocationContext';
import { practiceToday, practiceZoneLabel, toPracticeWallTime } from '@/lib/time/practiceTime';
import { NoShowRiskPanel } from './NoShowRiskPanel';
import { AppointmentLabelLegend, NO_LABEL } from './AppointmentLabelLegend';
import { ScheduleFilterBar, type FilterOption } from './ScheduleFilterBar';
import {
  UNASSIGNED_KEY,
  applyScheduleFilters,
  defaultFilters,
  distinctOptions,
  filtersFromQuery,
  filtersToQuery,
  loadRememberedFilters,
  loadSavedViews,
  matchesClientSearch,
  rememberFilters,
  sameFilters,
  savedViewFilters,
  storeSavedViews,
  upsertSavedView,
  type FilterContext,
  type SavedView,
  type ScheduleFilters,
} from '@/features/appointments/filters';
import { isYmd, monthGrid, shiftDate, visibleDates, type CalMode } from '@/features/appointments/scheduleNav';
import {
  AppointmentLabelChip,
  AppointmentLabelPicker,
  LabelSuggestionChip,
} from '@/components/scheduling/AppointmentLabelChip';
import type { AppointmentLabelDto, LabelMeaning } from '@/lib/scheduling/appointmentLabels';

// Data-driven clinician column colour (brand purple) for clinicians without a configured colour.
const CLINICIAN_DEFAULT_COLOR = '#5C2D91';
const CLINICIAN_DEFAULT_BG = '#F3EEF8';

const FORM_TYPES = [
  'Individual Therapy',
  'Group Therapy',
  'Medication Review',
  'Initial Assessment',
  'Crisis Follow-up',
  'Telehealth Check-in',
] as const;

/** Visit status tone: checked in = info, in session = brand, seen = success, no-show / late cancel = warning, cancelled = danger. */
const VISIT_TONE: Record<AppointmentStatus, Tone> = {
  scheduled: 'neutral',
  'checked-in': 'info',
  'in-session': 'brand',
  completed: 'success',
  'no-show': 'warning',
  cancelled: 'danger',
  'late-cancel': 'warning',
};

/** Left-edge colour of calendar blocks (visit status). */
const VISIT_EDGE: Record<AppointmentStatus, string> = {
  scheduled: 'border-l-slate-400',
  'checked-in': 'border-l-sky-500',
  'in-session': 'border-l-blue-600',
  completed: 'border-l-emerald-500',
  'no-show': 'border-l-amber-500',
  cancelled: 'border-l-rose-500',
  'late-cancel': 'border-l-amber-600',
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

const NOTE_META: Record<NoteStatus, { label: string; tone: Tone; icon?: 'bot' | 'lock' }> = {
  'not-started': { label: 'Note Due', tone: 'warning' },
  'ai-draft': { label: 'AI Draft Ready', tone: 'brand', icon: 'bot' },
  'in-progress': { label: 'In Progress', tone: 'info' },
  signed: { label: 'Signed', tone: 'success', icon: 'lock' },
};

export interface ClinicianConfig {
  id: string;
  name: string;
  roleTitle: string;
  /** Staff role key (THERAPIST, NP, ...): drives the role grouping in provider pickers */
  role?: string;
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

/** Click-to-book: true when the click landed on empty calendar space (not an appointment, block or control). */
function isEmptyBookTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !el.closest(BOOK_BUSY_SELECTOR);
}

/** Selected slot (day view) or day cell (week/month) awaiting a click on its Book button. */
type SlotPick =
  | { kind: 'slot'; key: string; date: string; startTime: string; top: number; height: number; clinicianId?: string; clinicianName?: string }
  | { kind: 'cell'; key: string; date: string; top: number };

const DAY_GRID_PX = (CAL_END_H - CAL_START_H) * HOUR_PX;

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

function VisitPill({ status, size }: { status: AppointmentStatus; size?: 'sm' | 'md' }) {
  return (
    <StatusBadge tone={VISIT_TONE[status]} dot size={size}>
      {VISIT_LABEL[status]}
    </StatusBadge>
  );
}

function NotePill({ status, visit }: { status: NoteStatus; visit: AppointmentStatus }) {
  if (visit === 'no-show' || visit === 'cancelled' || visit === 'late-cancel') {
    return <span className="text-xs text-slate-500">—</span>;
  }
  if (visit !== 'completed' && visit !== 'in-session') {
    return <span className="text-xs text-slate-500">—</span>;
  }
  const meta = NOTE_META[status];
  return (
    <StatusBadge
      tone={meta.tone}
      icon={meta.icon === 'bot' ? <Bot /> : meta.icon === 'lock' ? <Lock /> : undefined}
    >
      {meta.label}
    </StatusBadge>
  );
}

function AppointmentActions({
  appt,
  expanding,
  onToggle,
  onStatus,
  onAiDraft,
  busy,
  consentsDue,
}: {
  appt: Appointment;
  expanding: boolean;
  onToggle: () => void;
  onStatus: (s: AppointmentStatus) => void;
  onAiDraft: () => void;
  busy: boolean;
  consentsDue?: ConsentsDue;
}) {
  const next = VISIT_TRANSITIONS[appt.status] || [];
  const meetingUrl = appt.hostJoinUrl || appt.clientJoinUrl;
  const canStartMeeting =
    appt.isVirtual &&
    Boolean(meetingUrl) &&
    (appt.status === 'scheduled' ||
      appt.status === 'checked-in' ||
      appt.status === 'in-session');
  const meetingPrimary = appt.status === 'checked-in' || appt.status === 'in-session';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canStartMeeting ? (
          <Button
            size="sm"
            variant={meetingPrimary ? 'primary' : 'secondary'}
            icon={<Video />}
            onClick={() => window.open(meetingUrl as string, '_blank', 'noopener,noreferrer')}
          >
            {appt.status === 'in-session' ? 'Join meeting' : 'Start meeting'}
          </Button>
        ) : null}
        {next.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={onToggle} aria-expanded={expanding}>
            Update <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
        {/* Start visit: scheduled / checked-in / in-session, and completed visits without a signed note */}
        <StartVisitButton appointment={appt} />
        {consentsDue ? <ConsentsDueBadge clientId={appt.clientId} due={consentsDue} /> : null}
      </div>
      {expanding && next.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          {appt.isVirtual && appt.status === 'checked-in' ? (
            <p className="text-xs font-medium text-blue-700">
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
                className={cx(
                  'rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-blue-600 hover:text-blue-700 disabled:opacity-50',
                  FOCUS_RING,
                )}
              >
                {VISIT_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {(appt.status === 'completed' || appt.status === 'in-session') &&
      appt.noteStatus === 'not-started' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">Session complete — note not started</p>
          <button
            type="button"
            disabled={busy}
            onClick={onAiDraft}
            className={cx('mt-1.5 inline-flex items-center gap-1 rounded font-semibold text-blue-700 underline disabled:opacity-50', FOCUS_RING)}
          >
            Generate AI Draft <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Documentation light + copay status for a block's aria-label (the button label replaces its content). */
function docA11y(appt: Appointment): string {
  const light = appt.docLight ? `, ${docLightText(appt.docLight)}` : '';
  const pay = appt.payment ? `, ${VISIT_PAYMENT_LABEL[appt.payment]}` : '';
  return light + pay;
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
  const { isAllLocations, activeLocation } = useLocation();
  // Calendar view: load only the visible week (plus today, for the metrics); board / list views
  // use the server default window (90 days back .. 365 ahead). Navigating weeks refetches.
  const [visibleRange, setVisibleRange] = useState<{ from: string; to: string } | null>(null);
  // Perf: hold the first fetch until the view (role default / URL) and its range are known. Before,
  // the page fetched the full 90-day-back / 365-day-ahead window, then the calendar range, then
  // (caseload roles, board view) the full window again: up to three loads, two of them the largest.
  const [rangeReady, setRangeReady] = useState(false);
  const {
    appointments,
    timeZone: practiceTz,
    loading,
    error,
    reload,
    addAppointment,
    setStatus,
    generateAiDraft,
  } = useAppointments(visibleRange, { facets: true, enabled: rangeReady });
  // Calendar day and times are the PRACTICE clock (server-provided zone), not the browser's.
  const today = useMemo(() => practiceToday(practiceTz), [practiceTz]);
  const zoneLabel = practiceZoneLabel(practiceTz);
  const { clients, loading: clientsLoading, error: clientsError } = useClients();
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  useEffect(() => {
    let cancelled = false;
    void apiJson<{ users: StaffUser[] }>('/api/staff/directory')
      .then(({ users }) => {
        if (!cancelled) setStaffUsers(users.filter((staff) => (SCHEDULABLE_STAFF_STATUSES as string[]).includes(staff.status)));
      })
      .catch(() => { /* Scheduling still validates the assigned clinician on the server. */ });
    return () => { cancelled = true; };
  }, []);

  // Role based default view: Front-desk & Admin default to 'calendar', caseload to 'board'
  const userRole = user?.role;
  const isFrontDeskOrAdmin = useMemo(() => {
    if (!userRole) return true;
    const adminRoles = [
      'ADMIN',
      'PRACTICE_DIRECTOR',
      'OFFICE_MANAGER',
      'FRONT_DESK',
      'DIRECTOR',
      'SUPER_ADMIN',
    ];
    return adminRoles.includes(userRole);
  }, [userRole]);

  const [view, setView] = useState<'calendar' | 'board' | 'list'>('calendar');
  const [calMode, setCalMode] = useState<CalMode>('day');
  // Day view: the provider-name header and the time grid scroll sideways as one, so each
  // provider's name always sits over that provider's own column.
  const dayHeadScrollRef = useRef<HTMLDivElement>(null);
  const dayGridScrollRef = useRef<HTMLDivElement>(null);
  const [dayGridScrollbarW, setDayGridScrollbarW] = useState(0);
  const syncDayScroll = useCallback((from: 'head' | 'grid') => {
    const head = dayHeadScrollRef.current;
    const grid = dayGridScrollRef.current;
    if (!head || !grid) return;
    if (from === 'grid') {
      if (head.scrollLeft !== grid.scrollLeft) head.scrollLeft = grid.scrollLeft;
    } else if (grid.scrollLeft !== head.scrollLeft) {
      grid.scrollLeft = head.scrollLeft;
    }
  }, []);
  useEffect(() => {
    if (calMode !== 'day') return;
    const grid = dayGridScrollRef.current;
    if (!grid) return;
    // The grid's vertical scrollbar takes width the header doesn't have: pad the header by the same
    // amount so both reach the last column together.
    const measure = () => {
      setDayGridScrollbarW(Math.max(0, grid.offsetWidth - grid.clientWidth));
      syncDayScroll('grid');
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(grid);
    return () => ro?.disconnect();
  }, [calMode, syncDayScroll]);
  const [calDate, setCalDate] = useState<string>(today);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);

  const [showForm, setShowForm] = useState(false);
  // Create vs Edit Details. Edit is bound to one appointment id and saves via PATCH, never POST.
  const [formMode, setFormMode] = useState<AppointmentFormMode>({ kind: 'create' });
  // Set when the server answers 409: that slot already holds this appointment id ("Open existing").
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);
  // 409 CLINICIAN_OVERLAP: offer "book anyway" with a reason (intentional overbook, audited)
  const [overlapConflict, setOverlapConflict] = useState(false);
  // Recurring series: scope of an edit / cancel ("this visit", "this and following", "entire series")
  const [seriesScope, setSeriesScope] = useState<SeriesEditScope>('this');
  const [cancelScope, setCancelScope] = useState<SeriesEditScope>('this');
  // Waitlist entries that could take a freed slot (suggestion only)
  const [waitlistOffers, setWaitlistOffers] = useState<WaitlistSuggestion[]>([]);
  const loadWaitlistOffers = (appointmentId: string) => {
    void apiJson<{ suggestions: WaitlistSuggestion[] }>(`/api/appointments/${encodeURIComponent(appointmentId)}/waitlist-suggestions`)
      .then((r) => setWaitlistOffers(r.suggestions || []))
      .catch(() => setWaitlistOffers([]));
  };
  const [filter, setFilter] = useState<'today' | 'upcoming' | 'all'>('today');
  // Row whose "Update" status menu is expanded in board / list view (not the edit form).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  // Check-in soft stop: consent to treatment / telehealth consent missing (src/lib/consents/library/decisions.ts)
  const [consentPrompt, setConsentPrompt] = useState<CheckInConsentPrompt | null>(null);
  // Front desk huddle deep link: ?appt=<id>[&focus=<item>] opens that appointment's detail (with the
  // front desk checklist; focus=waitlist also loads waitlist matches for a cancelled slot).
  const [deepLink, setDeepLink] = useState<{ appt: string; focus: string | null } | null>(null);
  const [foFocus, setFoFocus] = useState<{ id: string; focus: string | null } | null>(null);
  const showFrontOffice = canUseFrontOffice(userRole);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const appt = params.get('appt');
    if (!appt || !/^[A-Za-z0-9_-]{1,64}$/.test(appt)) return;
    setDeepLink({ appt, focus: params.get('focus') });
    params.delete('appt');
    params.delete('focus');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);
  useEffect(() => {
    if (!deepLink || loading) return;
    const found = appointments.find((a) => a.id === deepLink.appt);
    if (!found) return;
    setDeepLink(null);
    setCalDate(found.date);
    setSelectedAppt(found);
    setFoFocus({ id: found.id, focus: deepLink.focus });
    if (deepLink.focus === 'waitlist' && (found.status === 'cancelled' || found.status === 'late-cancel')) loadWaitlistOffers(found.id);
  }, [deepLink, loading, appointments]);

  // Calendar color labels (Valant-style), set up in Admin > Scheduling settings
  const [labels, setLabels] = useState<AppointmentLabelDto[]>([]);
  const [labelsReady, setLabelsReady] = useState(true);
  const [formSuggestions, setFormSuggestions] = useState<LabelMeaning[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchAppointmentLabels()
      .then((r) => {
        if (cancelled) return;
        setLabels(r.labels);
        setLabelsReady(r.ready);
      })
      .catch(() => { /* Labels are optional decoration; the calendar works without them. */ });
    return () => { cancelled = true; };
  }, []);

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
  >([]);
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

  // Role default view; a view in the URL (?view=) wins on first load
  const defaultView: 'calendar' | 'board' = isFrontDeskOrAdmin ? 'calendar' : 'board';
  const [viewFromUrl, setViewFromUrl] = useState(false);
  useEffect(() => {
    if (user?.role && !viewFromUrl) setView(defaultView);
  }, [user?.role, defaultView, viewFromUrl]);

  // ---- Filters (src/features/appointments/filters.ts) -------------------------------------
  // One filter state for day / week / month / board / list. Kept in the URL (?f=1&prov=..), so a
  // schedule link is shareable and back/forward safe, and remembered per user in localStorage.
  // Filters only narrow what /api/appointments returned; scoping stays on the server.
  const roleDefaults = useMemo(
    () =>
      defaultFilters(user?.role, {
        leadership: Boolean((user as { medicalDirector?: boolean } | null)?.medicalDirector),
      }),
    [user]
  );
  const [filters, setFilters] = useState<ScheduleFilters>(() => defaultFilters(null));
  const [filtersReady, setFiltersReady] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const browserStorage = useCallback((): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    if (!user?.id || filtersReady) return;
    const params = new URLSearchParams(window.location.search);
    setFilters(filtersFromQuery(params) ?? loadRememberedFilters(browserStorage(), user.id) ?? roleDefaults);
    setSavedViews(loadSavedViews(browserStorage(), user.id));
    const v = params.get('view');
    if (v === 'calendar' || v === 'board' || v === 'list') {
      setViewFromUrl(true);
      setView(v);
    }
    const cal = params.get('cal');
    if (cal === 'day' || cal === 'week' || cal === 'month') setCalMode(cal);
    const d = params.get('d');
    if (isYmd(d)) setCalDate(d);
    setFiltersReady(true);
  }, [user?.id, filtersReady, roleDefaults, browserStorage]);

  const saveView = (name: string) => {
    if (!user?.id) return;
    const next = upsertSavedView(savedViews, name, filters);
    setSavedViews(next);
    storeSavedViews(browserStorage(), user.id, next);
    toast.success(`Saved view "${name.trim()}"`);
  };
  const applyView = (v: SavedView) => {
    const f = savedViewFilters(v);
    if (f) setFilters(f);
  };
  const deleteView = (name: string) => {
    if (!user?.id) return;
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    storeSavedViews(browserStorage(), user.id, next);
  };
  const resetFilters = () => {
    setFilters(roleDefaults);
    if (user?.id) rememberFilters(browserStorage(), user.id, null);
  };

  // Header location switcher: the visit has no reliable site of its own (Appointment.location_id is
  // a legacy column that defaults to Bowie), so the client's home site stands in. Applied only when
  // the switcher's site name matches a client site on this schedule; clients with no site stay visible.
  const siteNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of appointments) if (a.siteId && a.siteName) m.set(a.siteId, a.siteName);
    return m;
  }, [appointments]);
  const headerSiteIds = useMemo(() => {
    if (isAllLocations || !activeLocation) return null;
    const want = activeLocation.name.trim().toLowerCase();
    if (!want) return null;
    const ids = [...siteNames.entries()]
      .filter(([, n]) => {
        const name = n.trim().toLowerCase();
        return name.includes(want) || want.includes(name);
      })
      .map(([id]) => id);
    return ids.length ? ids : null;
  }, [isAllLocations, activeLocation, siteNames]);
  const locationNote = useMemo(() => {
    if (isAllLocations || !activeLocation) return null;
    if (!headerSiteIds) {
      return `Location switcher is set to ${activeLocation.name}, but no client home site on this schedule matches it, so all sites are shown.`;
    }
    return `Location switcher: ${activeLocation.name}. Showing clients whose home site is ${activeLocation.name}, plus clients with no site on file.`;
  }, [isAllLocations, activeLocation, headerSiteIds]);

  const allAppointments = useMemo(() => {
    if (!headerSiteIds) return appointments;
    return appointments.filter((a) => !a.siteId || headerSiteIds.includes(a.siteId));
  }, [appointments, headerSiteIds]);

  const clinicianRoles = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of staffUsers) if (s.role) m[s.id] = s.role;
    return m;
  }, [staffUsers]);
  const filterCtx = useMemo<FilterContext>(
    () => ({ userId: user?.id ?? null, today, clinicianRoles }),
    [user?.id, today, clinicianRoles]
  );

  // Every view (day, week, month, board, list) renders from these.
  const visibleAppointments = useMemo(
    () => applyScheduleFilters(allAppointments, filters, filterCtx),
    [allAppointments, filters, filterCtx]
  );
  // "Consents needed before the visit" for open visits on screen (one request, capped at 100 clients)
  const consentsDue = useConsentsDue(
    useMemo(
      () => visibleAppointments.filter((a) => a.status === 'scheduled' || a.status === 'checked-in' || a.status === 'in-session').map((a) => a.clientId),
      [visibleAppointments]
    )
  );
  // Same filters without "Hide cancelled / no-shows", so the header still counts no-shows
  const metricsAppointments = useMemo(
    () => applyScheduleFilters(allAppointments, filters, filterCtx, { ignoreHide: true }),
    [allAppointments, filters, filterCtx]
  );

  // Build full clinician columns from staff users and default clinicians
  const clinicianColumns = useMemo<ClinicianConfig[]>(() => {
    const map = new Map<string, ClinicianConfig>();

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
      const clinicalStaff = staffUsers.filter(
        (s) =>
          CLINICAL_ROLES.includes(s.role) ||
          (s.roles && s.roles.some((r) => CLINICAL_ROLES.includes(r)))
      );
      // Only real staff from the directory are shown. If no one holds a
      // clinical role yet, fall back to all active staff so scheduling works.
      (clinicalStaff.length > 0 ? clinicalStaff : staffUsers)
        .forEach((s, idx) => {
          const initials = s.name
            ? s.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)
            : 'CL';
          if (s.name) {
            const colors = ['#5C2D91', '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0D47A1', '#1565C0'];
            const color = colors[idx % colors.length];
            map.set(s.id, {
              id: s.id,
              name: s.name,
              role: s.role,
              roleTitle: s.role.replace(/_/g, ' '),
              initials,
              color,
              bgLight: `${color}10`,
              // No room/resource data exists yet: never invent one
              room: '',
            });
          }
        });
    }

    // Grouped by role (psychiatrists, NPs, therapists, ...), A-Z inside each group
    return sortProviders(Array.from(map.values()));
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
      color: CLINICIAN_DEFAULT_COLOR,
      bgLight: CLINICIAN_DEFAULT_BG,
      room: '',
    };
  };

  const getAppointmentRoom = (appt: Appointment, clinician?: ClinicianConfig): string => {
    if (appt.isVirtual) {
      if (appt.audioOnly) return 'Telehealth (audio only)';
      const provider =
        appt.videoProvider === 'google'
          ? 'Google Meet'
          : appt.videoProvider === 'in_app'
          ? 'In-App'
          : appt.videoProvider === 'zoom'
          ? 'Zoom'
          : null;
      return provider ? `Virtual (${provider})` : 'Virtual';
    }
    if (appt.notes?.includes('Group Room')) return 'Group Room';
    const match = appt.notes?.match(/Room\s+\d+/i);
    if (match) return match[0];
    if (clinician?.room) return clinician.room;
    // No room recorded: say so instead of inventing one
    return 'In person';
  };

  const [form, setForm] = useState<AppointmentFormValues>(() => emptyAppointmentForm(today));
  const isEditMode = formMode.kind === 'edit';
  // Billing codes section (planned codes; the signed note's codes bill). Fresh draft per opened form.
  const [codesDraft, setCodesDraft] = useState<CodesDraft>(emptyCodesDraft);
  const codesFormKey = showForm ? (formMode.kind === 'edit' ? formMode.appointment.id : 'new') : null;
  useEffect(() => {
    setCodesDraft(emptyCodesDraft());
  }, [codesFormKey]);

  /** Save planned codes after the booking / edit. The visit is already saved, so a failure only warns. */
  const savePlannedCodes = async (appointmentIds: string[], mode: 'create' | 'edit'): Promise<boolean> => {
    if (!appointmentIds.length || !shouldSaveCodes(codesDraft, mode)) return false;
    const body = JSON.stringify(codesPayload(codesDraft, { canSetDiscount: codesDraft.canSetDiscount }));
    const failed: string[] = [];
    for (const id of appointmentIds) {
      try {
        await apiJson(`/api/appointments/${encodeURIComponent(id)}/codes`, { method: 'PUT', body });
      } catch (err) {
        failed.push(err instanceof Error ? err.message : 'error');
      }
    }
    if (failed.length) toast.error(`Visit saved, but the billing codes were not: ${failed[0]}`, { duration: 9000 });
    return failed.length < appointmentIds.length;
  };

  /** Every "new appointment" entry point. Leaving edit mode clears the edited appointment's values. */
  const openCreateForm = (date?: string) => {
    setFormError('');
    setDuplicateOfId(null);
    if (formMode.kind === 'edit') {
      setForm((f) => emptyAppointmentForm(date || today, f.clientId));
    } else if (date) {
      setForm((f) => ({ ...f, date }));
    }
    setFormMode({ kind: 'create' });
    setShowForm(true);
  };

  /** Click-to-book (or double-click) on the calendar: new appointment with the date, start time and clinician filled in. */
  const openCreateAt = (slot: { date: string; startTime?: string; clinicianId?: string }) => {
    setSlotPick(null);
    openCreateForm(slot.date);
    setForm((f) => ({
      ...f,
      date: slot.date,
      ...(slot.startTime ? { startTime: slot.startTime, endTime: '' } : {}),
      ...(slot.clinicianId ? { clinicianId: slot.clinicianId } : {}),
    }));
  };

  // Click-to-book: a single click / tap on empty space selects a slot and shows a Book button.
  // Works with mouse, trackpad and touch (no double-tap needed); Escape, clicking elsewhere or scrolling clears it.
  const [slotPick, setSlotPick] = useState<SlotPick | null>(null);
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const notePointerDown = (e: React.PointerEvent) => {
    pointerDownAt.current = { x: e.clientX, y: e.clientY };
  };
  /** A click that ended a drag (text selection, scroll attempt) is not a booking click. */
  const wasDrag = (e: React.MouseEvent) => {
    const d = pointerDownAt.current;
    return !!d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6;
  };
  const focusBookButton = useCallback((el: HTMLButtonElement | null) => {
    el?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!slotPick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSlotPick(null);
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.('[data-book-surface]')) setSlotPick(null);
    };
    const onScroll = () => setSlotPick(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [slotPick]);
  useEffect(() => {
    setSlotPick(null);
  }, [calMode, calDate]);
  /** Day view hover (mouse only): a subtle slot highlight with its time, drawn without re-rendering the page. */
  const showHoverSlot = (e: React.PointerEvent<HTMLDivElement>) => {
    const hv = e.currentTarget.querySelector<HTMLElement>('[data-hover-slot]');
    if (!hv) return;
    if (e.pointerType !== 'mouse' || !isEmptyBookTarget(e.target)) {
      hv.style.display = 'none';
      return;
    }
    const s = pickSlot(e.clientY - e.currentTarget.getBoundingClientRect().top, HOUR_PX, CAL_START_H, CAL_END_H);
    hv.style.display = 'flex';
    hv.style.top = `${s.top}px`;
    hv.style.height = `${s.height}px`;
    hv.textContent = clock12(s.startTime);
  };
  const hideHoverSlot = (e: React.PointerEvent<HTMLDivElement>) => {
    const hv = e.currentTarget.querySelector<HTMLElement>('[data-hover-slot]');
    if (hv) hv.style.display = 'none';
  };
  /** Week/month: the Book button for a clicked day cell, kept inside the cell. */
  const cellBookButton = (date: string) =>
    slotPick?.kind === 'cell' && slotPick.key === date ? (
      <button
        ref={focusBookButton}
        type="button"
        onClick={() => openCreateAt({ date })}
        aria-label={dayBookLabel(date)}
        style={{ top: `${slotPick.top}px` }}
        className={cx(
          'absolute left-1 right-1 z-30 inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white shadow-md hover:bg-blue-700',
          FOCUS_RING,
        )}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{dayBookLabel(date)}</span>
      </button>
    ) : null;
  const onCellClick = (date: string) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEmptyBookTarget(e.target) || wasDrag(e)) return;
    const r = e.currentTarget.getBoundingClientRect();
    setSlotPick({ kind: 'cell', key: date, date, top: clampCellOffset(e.clientY - r.top, r.height) });
  };
  /** Keyboard: visually hidden until focused. */
  const SR_BOOK_BUTTON = cx(
    'sr-only focus:not-sr-only focus:absolute focus:left-1 focus:top-1 focus:z-40 focus:rounded-md focus:bg-blue-600 focus:px-2 focus:py-1 focus:text-xs focus:font-semibold focus:text-white focus:shadow-md',
    FOCUS_RING,
  );

  const openEditForm = (appt: Appointment) => {
    setFormError('');
    setDuplicateOfId(null);
    setForm(formValuesFromAppointment(appt));
    setFormMode({ kind: 'edit', appointment: appt });
    setSelectedAppt(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError('');
    setDuplicateOfId(null);
    if (formMode.kind === 'edit') {
      setForm((f) => emptyAppointmentForm(today, f.clientId));
      setFormMode({ kind: 'create' });
    }
  };
  // Booking side panel: Escape closes it; the first field gets focus so staff can type the client right away
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeForm();
    };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[aria-labelledby="appt-form-title"] input:not([type=hidden]), [aria-labelledby="appt-form-title"] select')?.focus({ preventScroll: true });
    }, 50);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
    // closeForm is recreated every render; only open/close matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  /** "Open existing" after a 409: show the appointment already holding that slot. */
  const openExistingAppointment = async (id: string) => {
    let found = appointments.find((a) => a.id === id);
    if (!found) {
      await reload();
      found = appointments.find((a) => a.id === id);
    }
    if (!found) {
      setFormError('The existing appointment is not on your calendar view. Search the schedule for it.');
      return;
    }
    closeForm();
    setCalDate(found.date);
    setSelectedAppt(found);
  };

  // Suggested label chips for the booking form (server knows first-visit / imported clients)
  useEffect(() => {
    if (!showForm || !labels.length) {
      setFormSuggestions([]);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ clientId: form.clientId, isVirtual: form.isVirtual ? '1' : '0' });
    void apiJson<{ suggestions: LabelMeaning[] }>(`/api/scheduling/appointment-labels/suggest?${qs}`)
      .then((r) => { if (!cancelled) setFormSuggestions(r.suggestions || []); })
      .catch(() => { if (!cancelled) setFormSuggestions([]); });
    return () => { cancelled = true; };
  }, [showForm, labels.length, form.clientId, form.isVirtual]);

  const schedulableClients = useMemo(
    () => clients.filter((c) => c.status !== 'DISCHARGED'),
    [clients]
  );
  /** Names of clients picked by search or prefilled by id (the roster list holds only the first page) */
  const [pickedClientNames, setPickedClientNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (clientsLoading || clientsError) return;
    const params = new URLSearchParams(window.location.search);
    const queryClientId = params.get('client');
    const storedClientId = sessionStorage.getItem('altrixs.schedule.clientId');
    const requestedClientId = queryClientId || storedClientId;
    const shouldOpenForm =
      params.get('new') === '1' || sessionStorage.getItem('altrixs.schedule.open') === '1';
    // Visit guide "Book follow-up": ?new=1&client=&after=YYYY-MM-DD[&type=] prefills the date and visit type
    const afterParam = params.get('after');
    const prefillDate = shouldOpenForm && isYmd(afterParam) ? afterParam : null;
    const typeParam = params.get('type');
    const prefillType =
      shouldOpenForm && typeParam && (APPOINTMENT_TYPES as readonly string[]).includes(typeParam) ? (typeParam as AppointmentType) : null;
    // Waitlist "Open in scheduler": &clinician=<id>&start=HH:MM&virtual=1 also prefill the form
    const clinicianParam = params.get('clinician');
    const prefillClinician = shouldOpenForm && clinicianParam && /^[A-Za-z0-9_-]{1,128}$/.test(clinicianParam) ? clinicianParam : null;
    const startParam = params.get('start');
    const prefillStart = shouldOpenForm && startParam && /^\d{2}:\d{2}$/.test(startParam) ? startParam : null;
    const prefillVirtual = shouldOpenForm && params.get('virtual') === '1';
    if (queryClientId || params.get('new')) {
      // Drop only the one-shot booking params; filter / view params stay in the URL
      params.delete('client');
      params.delete('new');
      params.delete('after');
      params.delete('type');
      params.delete('clinician');
      params.delete('start');
      params.delete('virtual');
      const qs = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
    sessionStorage.removeItem('altrixs.schedule.clientId');
    sessionStorage.removeItem('altrixs.schedule.open');
    if (shouldOpenForm) {
      setFormMode({ kind: 'create' });
      setShowForm(true);
      if (prefillDate || prefillType || prefillClinician || prefillStart || prefillVirtual) {
        setForm((f) => ({
          ...f,
          ...(prefillDate ? { date: prefillDate } : {}),
          ...(prefillType ? { type: prefillType } : {}),
          ...(prefillClinician ? { clinicianId: prefillClinician } : {}),
          ...(prefillStart ? { startTime: prefillStart, endTime: '' } : {}),
          ...(prefillVirtual ? { isVirtual: true } : {}),
        }));
      }
    }
    const requested = requestedClientId
      ? schedulableClients.find((c) => c.id === requestedClientId)
      : null;
    if (requested) {
      setForm((f) => ({ ...f, clientId: requested.id }));
      return;
    }
    // Not in the first roster page: load that one client. Never default to some other client.
    if (requestedClientId) {
      void fetchClient(requestedClientId)
        .then((c) => {
          if (!c || c.status === 'DISCHARGED') return;
          setPickedClientNames((m) => ({ ...m, [c.id]: c.name }));
          setForm((f) => ({ ...f, clientId: c.id }));
        })
        .catch(() => {});
    }
  }, [schedulableClients, form.clientId, clientsLoading, clientsError]);

  // Appointments for the active calendar date
  const dayAppointments = useMemo(
    () => visibleAppointments.filter((a) => a.date === calDate),
    [visibleAppointments, calDate]
  );

  // Today appointments for stats
  const todayAppts = useMemo(
    () => visibleAppointments.filter((a) => a.date === today),
    [visibleAppointments, today]
  );

  const upcomingAppts = useMemo(
    () =>
      visibleAppointments.filter(
        (a) =>
          a.date > today &&
          (a.status === 'scheduled' ||
            a.status === 'checked-in' ||
            a.status === 'in-session')
      ),
    [visibleAppointments, today]
  );

  const displayedList =
    filter === 'today' ? todayAppts : filter === 'upcoming' ? upcomingAppts : visibleAppointments;

  // Key metrics for the active calendar date (or today in board view). Same filters, but
  // cancelled / no-shows are counted even when hidden on the calendar.
  const activeMetricsSource = useMemo(
    () => metricsAppointments.filter((a) => a.date === (view === 'calendar' ? calDate : today)),
    [metricsAppointments, view, calDate, today]
  );
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
    const [nh, nm] = toPracticeWallTime(new Date(), practiceTz).time.split(':').map(Number);
    const currentMinutes = nh * 60 + nm;
    if (currentMinutes < CAL_START_H * 60 || currentMinutes > CAL_END_H * 60) {
      return null;
    }
    return ((currentMinutes - CAL_START_H * 60) / 60) * HOUR_PX;
  }, [calDate, today, practiceTz]);

  // Week days for Week View
  const weekDays = useMemo(() => getWeekDays(calDate, today), [calDate, today]);

  // Days the calendar shows (day, Monday-first week, or the 4-6 week month grid)
  const calRange = useMemo(() => visibleDates(calDate, calMode), [calDate, calMode]);
  const monthWeeks = useMemo(() => (calMode === 'month' ? monthGrid(calDate) : []), [calDate, calMode]);

  useEffect(() => {
    // The view is final once the URL / remembered filters are read (filtersReady)
    if (!filtersReady) return;
    setRangeReady(true);
    if (view !== 'calendar') {
      setVisibleRange(null);
      return;
    }
    const { from, to } = calRange;
    setVisibleRange((prev) => {
      const next = { from: from < today ? from : today, to: to > today ? to : today };
      return prev && prev.from === next.from && prev.to === next.to ? prev : next;
    });
  }, [filtersReady, view, calRange, today]);

  // What the current view covers before filters (calendar range, or the board / list tab):
  // the "Showing X of Y" total, legend counts and filter option counts.
  const inScope = useCallback(
    (a: Appointment) => {
      if (view === 'calendar') return a.date >= calRange.from && a.date <= calRange.to;
      if (filter === 'today') return a.date === today;
      if (filter === 'upcoming') {
        return a.date > today && (a.status === 'scheduled' || a.status === 'checked-in' || a.status === 'in-session');
      }
      return true;
    },
    [view, calRange, filter, today]
  );
  const rangeAppointments = useMemo(() => allAppointments.filter(inScope), [allAppointments, inScope]);
  const shownInScope = useMemo(() => visibleAppointments.filter(inScope).length, [visibleAppointments, inScope]);
  const scopeText =
    view === 'calendar'
      ? calMode === 'day'
        ? 'this day'
        : calMode === 'week'
          ? 'this week'
          : 'this month view'
      : filter === 'today'
        ? 'today'
        : filter === 'upcoming'
          ? 'upcoming'
          : 'in the loaded window';

  // Filter options come from the data on screen (plus every active clinician for Provider)
  const filterOptions = useMemo(() => {
    const count = (fn: (a: Appointment) => string | null | undefined) => {
      const m = new Map<string, number>();
      for (const o of distinctOptions(rangeAppointments, fn)) m.set(o.value, o.count);
      return m;
    };
    const provCounts = count((a) => a.clinicianId);
    const providers = new Map<string, FilterOption>();
    for (const c of clinicianColumns) providers.set(c.id, { value: c.id, label: c.name, group: providerGroupLabel(c.role), count: provCounts.get(c.id) ?? 0 });
    for (const a of allAppointments) {
      if (a.clinicianId && !providers.has(a.clinicianId)) {
        providers.set(a.clinicianId, { value: a.clinicianId, label: a.clinicianName || 'Unknown clinician', count: provCounts.get(a.clinicianId) ?? 0 });
      }
    }
    // Same order as the booking form: role group, then A-Z (staff no longer active go under "Other staff")
    const roleOf = new Map(clinicianColumns.map((c) => [c.id, c.role ?? null]));
    const providerList: FilterOption[] = sortProviders([...providers.values()].map((o) => ({ option: o, name: o.label, role: roleOf.get(o.value) ?? null })))
      .map(({ option, role }) => ({ ...option, group: providerGroupLabel(role) }));
    if (allAppointments.some((a) => !a.clinicianId)) {
      providerList.push({ value: UNASSIGNED_KEY, label: 'Unassigned', count: provCounts.get(UNASSIGNED_KEY) ?? 0 });
    }
    const siteCounts = count((a) => a.siteId);
    const locations: FilterOption[] = [...siteNames.entries()]
      .map(([id, name]) => ({ value: id, label: name, count: siteCounts.get(id) ?? 0 }))
      .sort((x, y) => x.label.localeCompare(y.label));
    if (allAppointments.some((a) => !a.siteId)) {
      locations.push({ value: UNASSIGNED_KEY, label: 'No site on file', count: siteCounts.get(UNASSIGNED_KEY) ?? 0 });
    }
    const typeCounts = count((a) => a.type);
    const types: FilterOption[] = distinctOptions(allAppointments, (a) => a.type)
      .filter((o) => o.value !== UNASSIGNED_KEY)
      .map((o) => ({ value: o.value, label: o.value, count: typeCounts.get(o.value) ?? 0 }));
    const labelCounts = count((a) => a.labelId || NO_LABEL);
    const labelOptions: FilterOption[] = labels.map((l) => ({
      value: l.id,
      label: l.displayName,
      color: l.color,
      textColor: l.textColor,
      count: labelCounts.get(l.id) ?? 0,
    }));
    if (labels.length) labelOptions.push({ value: NO_LABEL, label: 'No label', count: labelCounts.get(NO_LABEL) ?? 0 });
    const payerCounts = count((a) => a.payer);
    const payers: FilterOption[] = distinctOptions(allAppointments, (a) => a.payer).map((o) => ({
      value: o.value,
      label: o.value === UNASSIGNED_KEY ? 'No payer on file' : o.value,
      count: payerCounts.get(o.value) ?? 0,
    }));
    return { providers: providerList, locations, types, labels: labelOptions, payers };
  }, [rangeAppointments, allAppointments, clinicianColumns, siteNames, labels]);

  // Keep the URL and this user's remembered filters in step with the screen
  useEffect(() => {
    if (!filtersReady || !user?.id) return;
    const params = filtersToQuery(filters, new URLSearchParams(window.location.search));
    if (view !== defaultView) params.set('view', view);
    else params.delete('view');
    if (calMode !== 'day') params.set('cal', calMode);
    else params.delete('cal');
    if (calDate !== today) params.set('d', calDate);
    else params.delete('d');
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, '', next);
    }
    rememberFilters(browserStorage(), user.id, filters);
  }, [filters, filtersReady, user?.id, view, defaultView, calMode, calDate, today, browserStorage]);

  // Client search: jump the calendar to the next matching visit after the shown date
  const jumpToMatch = (qArg?: string) => {
    const q = (qArg ?? filters.q).trim();
    if (!q) return;
    const matches = appointments
      .filter((a) => matchesClientSearch(a, q))
      .sort((x, y) => `${x.date}${x.startTime}`.localeCompare(`${y.date}${y.startTime}`));
    const next = matches.find((a) => a.date > calDate) ?? matches.find((a) => a.date >= today) ?? matches[0];
    if (view === 'calendar' && next) {
      setCalDate(next.date);
      setCalMode('day');
      return;
    }
    // The calendar only loads the visible range; the list covers 90 days back to a year ahead
    setView('list');
    setFilter('all');
    if (!next) toast('No visit for that client in this range. Showing the full list.');
  };

  const [labelBusy, setLabelBusy] = useState(false);
  const handleSetLabel = async (appt: Appointment, labelId: string | null, viaSuggestion?: LabelMeaning) => {
    setActionError(null);
    setLabelBusy(true);
    try {
      const updated = await setAppointmentLabel(appt.id, labelId, viaSuggestion);
      setSelectedAppt((prev) => (prev && prev.id === appt.id ? { ...prev, ...updated } : prev));
      await reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Could not set label');
    } finally {
      setLabelBusy(false);
    }
  };

  const handleSubmitForm = async () => {
    setFormError('');
    setDuplicateOfId(null);
    setOverlapConflict(false);
    const invalid = validateAppointmentForm(form);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    try {
      if (formMode.kind === 'edit' && formMode.appointment.seriesId && seriesScope !== 'this') {
        const built = seriesChangesFromForm(formMode.appointment, form);
        if (built.ok === false) {
          setFormError(built.error);
          return;
        }
        const res = await updateAppointmentSeries(formMode.appointment.seriesId, {
          action: 'edit',
          appointmentId: formMode.appointment.id,
          scope: seriesScope,
          changes: built.changes,
        });
        setShowForm(false);
        setFormMode({ kind: 'create' });
        setSeriesScope('this');
        await reload();
        const unchanged = res.unchanged ?? [];
        toast.success(
          `Updated ${res.updated?.length ?? 0} visit${res.updated?.length === 1 ? '' : 's'}.` +
            (unchanged.length ? ` ${unchanged.length} not changed (${unchanged.map((u) => `${u.date}: ${u.reason.replace(/_/g, ' ')}`).join(', ')}).` : ''),
          { duration: unchanged.length ? 12000 : 4000 }
        );
        return;
      }
      const result = await saveAppointmentForm(
        formMode,
        form,
        {
          create: addAppointment,
          update: (id, patch) => updateAppointmentApi(id, patch),
          setLabel: (id, labelId) => setAppointmentLabel(id, labelId),
          createSeries: createAppointmentSeries,
        },
        practiceTz
      );
      const codesSaved = await savePlannedCodes(
        result.kind === 'series' ? result.result.created.map((c) => c.id) : [result.appointment.id],
        result.kind === 'updated' ? 'edit' : 'create'
      );
      setShowForm(false);
      setForm((f) => emptyAppointmentForm(today, f.clientId));
      setFormMode({ kind: 'create' });
      await reload();
      if (result.kind === 'updated') {
        toast.success(result.changed || codesSaved ? 'Appointment updated' : 'No changes to save');
      } else if (result.kind === 'series') {
        const { created, skipped } = result.result;
        const skippedText = skipped.length
          ? ` ${skipped.length} skipped (${skipped.map((x) => `${x.date}: ${x.reason.replace(/_/g, ' ')}`).join(', ')}).`
          : '';
        toast.success(`Booked ${created.length} recurring visit${created.length === 1 ? '' : 's'}.${skippedText}`, { duration: skipped.length ? 12000 : 4000 });
      }
    } catch (err: unknown) {
      if (err instanceof DuplicateAppointmentError) setDuplicateOfId(err.existingAppointmentId);
      if (err instanceof ClinicianOverlapError) setOverlapConflict(true);
      setFormError(
        err instanceof Error
          ? err.message
          : isEditMode
            ? 'Could not save changes'
            : 'Could not create appointment'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, newStatus: AppointmentStatus, notes?: string) => {
    setActionError(null);
    setSaving(true);
    try {
      if (notes !== undefined) {
        // Status + note in one PATCH (cancellation reason), so the reason is actually saved.
        await updateAppointmentApi(id, { visitStatus: newStatus, notes });
      } else {
        await setStatus(id, newStatus);
      }
      await reload();
      if (newStatus === 'cancelled' || newStatus === 'late-cancel') loadWaitlistOffers(id);
      if (selectedAppt && selectedAppt.id === id) {
        setSelectedAppt((prev) =>
          prev ? { ...prev, status: newStatus, ...(notes !== undefined ? { notes } : {}) } : null
        );
      }
      setEditingId(null);
    } catch (err: unknown) {
      if (err instanceof ConsentRequiredError && newStatus === 'checked-in') {
        const clientId = appointments.find((a) => a.id === id)?.clientId ?? selectedAppt?.clientId ?? '';
        setConsentPrompt({ appointmentId: id, clientId, missing: err.missing, flags: err.flags, isVirtual: err.isVirtual });
      } else {
        setActionError(err instanceof Error ? err.message : 'Could not update status');
      }
    } finally {
      setSaving(false);
    }
  };

  /** "Check in anyway" from the consent dialog: the reason is stored and audited server side. */
  const handleConsentOverride = async (reason: string) => {
    if (!consentPrompt) return;
    const id = consentPrompt.appointmentId;
    await updateAppointmentApi(id, { visitStatus: 'checked-in', consentOverrideReason: reason });
    setConsentPrompt(null);
    toast.success('Checked in. The override reason was recorded.');
    await reload();
    if (selectedAppt && selectedAppt.id === id) setSelectedAppt((prev) => (prev ? { ...prev, status: 'checked-in' } : null));
  };

  /** Session Notes modal: saved through PATCH (it used to only change local state). */
  const handleSaveApptNotes = async () => {
    if (!selectedAppt) return;
    setActionError(null);
    setSaving(true);
    try {
      const updated = await updateAppointmentApi(selectedAppt.id, { notes: apptNotesDraft.trim() || null });
      setSelectedAppt((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
      setShowNotesModal(false);
      await reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Could not save notes');
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

  const navigateDate = (step: number) => setCalDate(shiftDate(calDate, calMode, step));

  // Day view columns: the provider filter / My schedule pick the columns; a clinician with a
  // (filtered) visit that day but no directory column still gets one, so no visit is hidden.
  const dayColumns: ClinicianConfig[] = (() => {
    const byId = new Map(clinicianColumns.map((c) => [c.id, c]));
    let base = clinicianColumns;
    if (filters.mine && user?.id) {
      base = base.filter((c) => c.id === user.id);
      if (!base.length) {
        base = [{ id: user.id, name: user.name || 'My schedule', roleTitle: 'My schedule', initials: (user.name || 'Me').slice(0, 2).toUpperCase(), color: CLINICIAN_DEFAULT_COLOR, bgLight: CLINICIAN_DEFAULT_BG, room: '' }];
      }
    }
    if (filters.providers.length) base = base.filter((c) => filters.providers.includes(c.id));
    const extra = new Map<string, ClinicianConfig>();
    for (const a of dayAppointments) {
      const c = findClinicianForAppt(a);
      if (!byId.has(c.id) && !base.some((b) => b.id === c.id)) extra.set(c.id, c);
      else if (byId.has(c.id) && !base.some((b) => b.id === c.id)) extra.set(c.id, byId.get(c.id)!);
    }
    return [...base, ...extra.values()];
  })();

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
    if (calMode === 'month') {
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    const monday = weekDays[0];
    const sunday = weekDays[6];
    return `Week of ${monday.monthName} ${monday.dayNumber} – ${sunday.monthName} ${sunday.dayNumber}`;
  }, [calDate, calMode, weekDays]);

  return (
    <Page>
      <CheckInConsentDialog prompt={consentPrompt} onClose={() => setConsentPrompt(null)} onOverride={handleConsentOverride} />
      <PageHeader
        title="Appointments & Clinic Schedule"
        badges={isFrontDeskOrAdmin ? <StatusBadge tone="brand">Front-Desk Multi-Clinician</StatusBadge> : null}
        description={
          <>
            {inSessionSeen} seen/in-session · {checkedIn} checked in · {noShow} no-show ·{' '}
            {notesDue > 0 ? (
              <span className="font-semibold text-amber-700">{notesDue} note due</span>
            ) : (
              <span className="font-semibold text-emerald-700">notes complete</span>
            )}
          </>
        }
        actions={
          <>
            <Tabs
              variant="pill"
              label="Schedule view"
              controlsPanels={false}
              value={view}
              onChange={setView}
              items={[
                { key: 'calendar', label: 'Calendar', icon: <CalendarIcon /> },
                { key: 'board', label: 'Board', icon: <LayoutGrid /> },
                { key: 'list', label: 'List', icon: <List /> },
              ]}
            />
            <Button
              variant="secondary"
              icon={<Lock />}
              // Schedule blocks have no data store yet (SchedulingSettings has no block field), so a block
              // would vanish on reload and online booking would ignore it. Disabled until persisted.
              disabled
              title="Not connected yet: time blocks can't be saved, and online booking would not honor them. Book a placeholder appointment or adjust office hours in Scheduling Settings."
              onClick={() => {
                setBlockDate(calDate);
                setBlockClinicianId(clinicianColumns[0]?.id || '');
                setShowBlockModal(true);
              }}
            >
              Block Time
            </Button>
            <Button
              variant={showForm ? 'secondary' : 'primary'}
              icon={showForm ? <X /> : <Plus />}
              onClick={() => (showForm ? closeForm() : openCreateForm())}
            >
              {showForm ? 'Cancel' : 'New Appointment'}
            </Button>
          </>
        }
      />

      {(error || actionError) && (
        <Alert
          tone="danger"
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setActionError(null);
                void reload();
              }}
            >
              Retry
            </Button>
          }
        >
          {actionError || error}
        </Alert>
      )}

      {/* Expired clinician licenses (HR / leadership / office roles only; renders nothing otherwise) */}
      <LicenseExpiredBanner />

      <StatGrid columns={4}>
        <StatCard
          label="In session / seen"
          value={inSessionSeen}
          hint={`Active care delivered for ${calDate === today ? 'today' : calDate}`}
          tone="brand"
          icon={<Sparkles />}
        />
        <StatCard label="Checked in" value={checkedIn} hint="Waiting in clinic or virtual queue" tone="info" icon={<Check />} />
        <StatCard label="No-show" value={noShow} hint="Requires front-desk follow-up" tone="warning" icon={<Clock />} />
        <StatCard label="Notes due" value={notesDue} hint="EHR clinical documentation pending" tone="danger" icon={<AlertCircle />} />
      </StatGrid>

      {/* No-show risk: rule-based score from attendance history (src/lib/appointments/noShowRisk.ts) */}
      <NoShowRiskPanel date={calDate} />

      {/* New / edit appointment: a side panel over the calendar, so booking from any scroll position
          never sends the user back to the top of the page */}
      {showForm ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="appt-form-title">
          <div className="absolute inset-0 bg-slate-900/30" onClick={closeForm} aria-hidden />
          <div className="relative flex h-[100dvh] w-full max-w-xl flex-col overflow-y-auto overscroll-contain bg-white shadow-2xl sm:rounded-l-2xl">
        <Card className="border-0 p-5 shadow-none">
          <div className="sticky top-0 z-10 -mx-5 -mt-5 flex items-center justify-between border-b border-slate-200 bg-white px-5 pb-3 pt-5">
            <h2 id="appt-form-title" className="text-sm font-semibold text-slate-900">
              {isEditMode ? 'Edit Appointment' : 'Schedule New Appointment'}
            </h2>
            <IconButton
              label="Close form"
              icon={<X className="h-4 w-4" />}
              onClick={closeForm}
              className="p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm font-medium text-slate-700">
              Client Name *
              <ClientSearchField
                value={form.clientId}
                disabled={isEditMode}
                label={
                  pickedClientNames[form.clientId] ||
                  clients.find((c) => c.id === form.clientId)?.name ||
                  (formMode.kind === 'edit' ? formMode.appointment.clientName : null)
                }
                onChange={(c) => {
                  if (c) setPickedClientNames((m) => ({ ...m, [c.id]: c.name }));
                  setForm((f) => ({ ...f, clientId: c?.id ?? '' }));
                }}
              />
              {isEditMode ? (
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  To book a different client, create a new appointment.
                </span>
              ) : null}
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Clinician *
              <select
                className={cx(inputClasses, 'mt-1')}
                value={form.clinicianId}
                onChange={(e) => setForm((f) => ({ ...f, clinicianId: e.target.value }))}
              >
                <option value="">Select clinician…</option>
                {form.clinicianId && !clinicianColumns.some((c) => c.id === form.clinicianId) ? (
                  <option value={form.clinicianId}>
                    {(formMode.kind === 'edit' && formMode.appointment.clinicianName) || 'Current clinician'}
                  </option>
                ) : null}
                {groupProviders(clinicianColumns).map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.room ? ` · ${c.room}` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Type *
              <select
                className={cx(inputClasses, 'mt-1')}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {!(APPOINTMENT_TYPES as readonly string[]).includes(form.type) &&
                !(FORM_TYPES as readonly string[]).includes(form.type) ? (
                  <option value={form.type}>{form.type}</option>
                ) : null}
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

            <label className="block text-sm font-medium text-slate-700">
              Date *
              <input
                type="date"
                className={cx(inputClasses, 'mt-1')}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Start Time * <span className="font-normal text-slate-500">({zoneLabel})</span>
              <input
                type="time"
                className={cx(inputClasses, 'mt-1')}
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

            <label className="block text-sm font-medium text-slate-700">
              End Time <span className="font-normal text-slate-500">({zoneLabel})</span>
              <input
                type="time"
                className={cx(inputClasses, 'mt-1')}
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:pt-6">
              <input
                type="checkbox"
                checked={form.isVirtual}
                onChange={(e) => setForm((f) => ({ ...f, isVirtual: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Virtual / Telehealth
            </label>

            {form.isVirtual ? (
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Video Provider
                <select
                  className={cx(inputClasses, 'mt-1')}
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

            <AudioOnlyToggle form={form} setForm={setForm} />
            {!isEditMode ? <RepeatFields form={form} setForm={setForm} /> : null}
            {formMode.kind === 'edit' && formMode.appointment.seriesId ? (
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Apply to
                <select
                  className={cx(inputClasses, 'mt-1')}
                  value={seriesScope}
                  onChange={(e) => setSeriesScope(e.target.value as SeriesEditScope)}
                >
                  <option value="this">This visit only</option>
                  <option value="following">This and following visits</option>
                  <option value="all">Entire series (future visits)</option>
                </select>
              </label>
            ) : null}

            {labels.length > 0 ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-sm font-medium text-slate-700">Calendar label</p>
                <div className="mt-1.5">
                  <AppointmentLabelPicker
                    labels={labels}
                    value={form.labelId}
                    onChange={(labelId) => setForm((f) => ({ ...f, labelId }))}
                  />
                </div>
                {formSuggestions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {formSuggestions
                      .filter((m) => labels.find((l) => l.id === form.labelId)?.meaning !== m)
                      .slice(0, 2)
                      .map((m) => (
                        <LabelSuggestionChip
                          key={m}
                          meaning={m}
                          labels={labels}
                          onApply={(l) => setForm((f) => ({ ...f, labelId: l.id }))}
                        />
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {codesFormKey ? (
            <AppointmentBillingCodes
              key={codesFormKey}
              visit={{
                appointmentId: formMode.kind === 'edit' ? formMode.appointment.id : null,
                clientId: form.clientId,
                clinicianId: form.clinicianId,
                type: form.type,
                date: form.date,
                isVirtual: form.isVirtual,
                audioOnly: form.audioOnly,
              }}
              role={userRole}
              staff={clinicianColumns.map((c) => ({ id: c.id, name: c.name }))}
              draft={codesDraft}
              onDraft={setCodesDraft}
            />
          ) : null}
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Notes
            <textarea
              rows={2}
              maxLength={2000}
              className={cx(inputClasses, 'mt-1')}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          {formError ? (
            <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              <span>{formError}</span>
              {duplicateOfId ? (
                <Button size="sm" variant="secondary" onClick={() => void openExistingAppointment(duplicateOfId)}>
                  Open existing
                </Button>
              ) : null}
              {overlapConflict ? (
                <OverbookPrompt form={form} setForm={setForm} saving={saving} onBookAnyway={() => void handleSubmitForm()} />
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
            {isEditMode ? (
              <Button variant="secondary" disabled={saving} onClick={closeForm}>
                Cancel
              </Button>
            ) : null}
            <Button disabled={saving} onClick={() => void handleSubmitForm()}>
              {isEditMode
                ? saving
                  ? 'Saving…'
                  : 'Save changes'
                : saving
                  ? 'Scheduling…'
                  : 'Schedule Appointment'}
            </Button>
          </div>
        </Card>
          </div>
        </div>
      ) : null}

      {/* Filters: one bar for day / week / month / board / list */}
      <ScheduleFilterBar
        filters={filters}
        onChange={setFilters}
        options={filterOptions}
        canUseMine={Boolean(user?.id)}
        shown={shownInScope}
        total={rangeAppointments.length}
        rangeText={scopeText}
        savedViews={savedViews}
        onSaveView={saveView}
        onApplyView={applyView}
        onDeleteView={deleteView}
        onReset={resetFilters}
        isDefault={sameFilters(filters, roleDefaults)}
        note={locationNote}
        onJumpToMatch={jumpToMatch}
      />

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div className="space-y-4">
          {/* Calendar Toolbar */}
          <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
            {/* Left: Nav & Date */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
                <IconButton
                  label={`Previous ${calMode}`}
                  icon={<ChevronLeft className="h-4 w-4" />}
                  onClick={() => navigateDate(-1)}
                  className="h-10 w-10 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:h-8 md:w-8"
                />
                <button
                  type="button"
                  onClick={() => setCalDate(today)}
                  className={cx('min-h-10 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 md:min-h-8', FOCUS_RING)}
                >
                  Today
                </button>
                <IconButton
                  label={`Next ${calMode}`}
                  icon={<ChevronRight className="h-4 w-4" />}
                  onClick={() => navigateDate(1)}
                  className="h-10 w-10 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:h-8 md:w-8"
                />
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="min-w-0 text-base font-semibold text-slate-900">{formattedHeaderDate}</h2>
                <input
                  type="date"
                  aria-label="Go to date"
                  value={calDate}
                  onChange={(e) => {
                    if (isYmd(e.target.value)) setCalDate(e.target.value);
                  }}
                  className={cx(inputClasses, 'min-h-10 w-auto max-w-full px-2 py-1 text-xs md:min-h-0')}
                />
              </div>
            </div>

            {/* Right: Day / Week / Month mode & legend */}
            <div className="flex flex-wrap items-center gap-3">
              <Tabs
                variant="pill"
                label="Calendar range"
                controlsPanels={false}
                value={calMode}
                onChange={setCalMode}
                items={[
                  { key: 'day', label: 'Day View' },
                  { key: 'week', label: 'Week View' },
                  { key: 'month', label: 'Month View' },
                ]}
              />

              <DocLightLegend className="hidden xl:flex" />

              {/* Status Legend */}
              <div className="hidden items-center gap-3 text-xs text-slate-600 lg:flex" aria-label="Visit status colours">
                {(['scheduled', 'checked-in', 'in-session', 'completed', 'no-show'] as const).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 font-medium">
                    <span aria-hidden className={cx('h-2.5 w-1 rounded-full border-l-4', VISIT_EDGE[s])} />
                    {VISIT_LABEL[s]}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          {labels.length > 0 || !labelsReady ? (
            <AppointmentLabelLegend
              labels={labels}
              ready={labelsReady}
              appointments={rangeAppointments}
              rangeText={scopeText}
              selected={filters.labels}
              onChange={(labelsNext) => setFilters({ ...filters, labels: labelsNext })}
            />
          ) : null}

          {/* DAY VIEW GRID */}
          {calMode === 'month' ? (
            /* MONTH VIEW GRID */
            <Card className="overflow-hidden">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d} className="py-2">{d}</div>
                ))}
              </div>
              <div className="grid touch-manipulation grid-cols-7 divide-x divide-y divide-slate-100">
                {monthWeeks.flat().map((date) => {
                  const inMonth = date.slice(0, 7) === calDate.slice(0, 7);
                  const dayAppts = visibleAppointments
                    .filter((a) => a.date === date)
                    .sort((x, y) => x.startTime.localeCompare(y.startTime));
                  const isToday = date === today;
                  return (
                    <div
                      key={date}
                      data-book-surface
                      className={`relative flex min-h-[96px] min-w-0 cursor-cell flex-col p-1 sm:min-h-[120px] sm:p-1.5 ${inMonth ? 'bg-white' : 'bg-slate-50'}`}
                      title="Click an empty spot to book on this day"
                      onPointerDown={notePointerDown}
                      onClick={onCellClick(date)}
                      onDoubleClick={(e) => {
                        if (!isEmptyBookTarget(e.target)) return;
                        openCreateAt({ date });
                      }}
                    >
                      {cellBookButton(date)}
                      <button
                        type="button"
                        onClick={() => {
                          setCalDate(date);
                          setCalMode('day');
                        }}
                        aria-label={`Open ${date}, ${dayAppts.length} ${dayAppts.length === 1 ? 'appointment' : 'appointments'}`}
                        className={cx('flex min-h-8 w-full items-center justify-between rounded px-1 text-left text-xs hover:bg-blue-50 sm:min-h-0', FOCUS_RING)}
                      >
                        <span
                          className={`font-semibold ${isToday ? 'rounded-full bg-blue-600 px-1.5 text-white' : inMonth ? 'text-slate-900' : 'text-slate-500'}`}
                        >
                          {Number(date.slice(8, 10))}
                        </span>
                        {dayAppts.length ? (
                          <span className="text-[11px] font-semibold text-slate-500">{dayAppts.length}</span>
                        ) : null}
                      </button>
                      <button type="button" onClick={() => openCreateAt({ date })} className={SR_BOOK_BUTTON}>
                        {dayBookLabel(date)}
                      </button>
                      <div className="mt-1 hidden space-y-0.5 sm:block">
                        {dayAppts.slice(0, 3).map((appt) => (
                          <button
                            key={appt.id}
                            type="button"
                            onClick={() => setSelectedAppt(appt)}
                            aria-label={`${appt.clientName}, ${formatClock(appt.startTime)}, ${VISIT_LABEL[appt.status]}${docA11y(appt)}`}
                            className={cx(
                              'flex w-full items-center gap-1 truncate rounded border-l-2 px-1 py-0.5 text-left text-[11px] hover:bg-slate-50',
                              VISIT_EDGE[appt.status],
                              FOCUS_RING,
                            )}
                            // Data-driven: practice-configured label colours
                            style={appt.label ? { backgroundColor: appt.label.color, color: appt.label.textColor } : undefined}
                          >
                            <DocLightDot light={appt.docLight} />
                            <span className="font-semibold">{formatClock(appt.startTime)}</span>
                            <span className="truncate">{appt.clientName}</span>
                          </button>
                        ))}
                        {dayAppts.length > 3 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCalDate(date);
                              setCalMode('day');
                            }}
                            className={cx('rounded px-1 text-[11px] font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                          >
                            +{dayAppts.length - 3} more
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : calMode === 'day' ? (
            <Card className="overflow-hidden">
              {/* Clinicians Column Headers */}
              <div className="flex border-b border-slate-200 bg-slate-50">
                <div className="w-16 flex-shrink-0 border-r border-slate-200 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Time
                </div>
                <div
                  ref={dayHeadScrollRef}
                  onScroll={() => syncDayScroll('head')}
                  className="flex flex-1 overflow-x-auto divide-x divide-slate-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {dayColumns.map((col) => {
                    const colAppts = dayAppointments.filter(
                      (a) => findClinicianForAppt(a).id === col.id
                    );
                    return (
                      <div
                        key={col.id}
                        className="min-w-[210px] flex-1 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                            // Data-driven: per-clinician column colour
                            style={{ backgroundColor: col.bgLight, color: col.color }}
                          >
                            {col.initials}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-slate-900">{col.name}</p>
                            <p className="truncate text-[11px] text-slate-500">{col.roleTitle}</p>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                          {col.room ? (
                            <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                              <DoorOpen className="h-3 w-3 text-slate-500" aria-hidden /> {col.room}
                            </span>
                          ) : (
                            <span />
                          )}
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700">
                            {colAppts.length} {colAppts.length === 1 ? 'visit' : 'visits'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {dayGridScrollbarW > 0 ? <div aria-hidden className="flex-shrink-0" style={{ width: `${dayGridScrollbarW}px` }} /> : null}
                </div>
              </div>

              {/* Day View Time Grid (scrolls sideways together with the header above) */}
              <div
                ref={dayGridScrollRef}
                onScroll={() => syncDayScroll('grid')}
                className="relative flex h-[min(880px,calc(100dvh-9rem))] min-h-[22rem] touch-manipulation overflow-x-auto"
              >
                {/* Time Gutter */}
                <div className="sticky left-0 z-10 w-16 flex-shrink-0 border-r border-slate-200 bg-white">
                  {Array.from({ length: CAL_END_H - CAL_START_H }).map((_, i) => {
                    const hour = CAL_START_H + i;
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const h12 = ((hour + 11) % 12) + 1;
                    return (
                      <div
                        key={hour}
                        style={{ height: `${HOUR_PX}px` }}
                        className="relative border-b border-slate-100 text-right pr-2 pt-1"
                      >
                        <span className="text-[11px] font-semibold text-slate-500">
                          {h12} {ampm}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Clinician Columns Grid */}
                <div className="relative flex flex-1 divide-x divide-slate-200">
                  {/* Live Clock Indicator across columns */}
                  {liveClockTop !== null && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                      style={{ top: `${liveClockTop}px` }}
                    >
                      <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
                        Live
                      </span>
                      <div className="h-[2px] w-full bg-rose-500" />
                    </div>
                  )}

                  {dayColumns.map((col) => {
                    const colAppts = dayAppointments.filter(
                      (a) => findClinicianForAppt(a).id === col.id
                    );
                    const colBlocks = scheduleBlocks.filter(
                      (b) => b.clinicianId === col.id && b.date === calDate
                    );

                    return (
                      <div
                        key={col.id}
                        data-book-surface
                        className="relative min-w-[210px] flex-1 cursor-cell bg-white"
                        style={{ height: `${DAY_GRID_PX}px` }}
                        title="Click an empty time to book"
                        onPointerDown={notePointerDown}
                        onPointerMove={showHoverSlot}
                        onPointerLeave={hideHoverSlot}
                        onClick={(e) => {
                          // Only empty space (or an availability block): appointments and blocks handle their own clicks
                          if (!isEmptyBookTarget(e.target) || wasDrag(e)) return;
                          const slot = pickSlot(e.clientY - e.currentTarget.getBoundingClientRect().top, HOUR_PX, CAL_START_H, CAL_END_H);
                          setSlotPick({
                            kind: 'slot',
                            key: col.id,
                            date: calDate,
                            ...slot,
                            clinicianId: col.id !== 'unassigned' ? col.id : undefined,
                            clinicianName: col.id !== 'unassigned' ? col.name : undefined,
                          });
                        }}
                        onDoubleClick={(e) => {
                          if (!isEmptyBookTarget(e.target)) return;
                          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                          openCreateAt({
                            date: calDate,
                            startTime: slotTimeFromOffset(y, HOUR_PX, CAL_START_H, CAL_END_H),
                            clinicianId: col.id !== 'unassigned' ? col.id : undefined,
                          });
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => openCreateAt({ date: calDate, clinicianId: col.id !== 'unassigned' ? col.id : undefined })}
                          className={SR_BOOK_BUTTON}
                        >
                          {col.id !== 'unassigned' ? `Book with ${col.name} on ${shortDayLabel(calDate)}` : `Book on ${shortDayLabel(calDate)}`}
                        </button>
                        {/* Hover slot (mouse only), positioned directly by showHoverSlot */}
                        <div
                          data-hover-slot
                          aria-hidden
                          className="pointer-events-none absolute left-1 right-1 z-[5] hidden items-center rounded-md bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200"
                        />
                        {slotPick?.kind === 'slot' && slotPick.key === col.id ? (
                          <>
                            <div
                              aria-hidden
                              className="pointer-events-none absolute left-1 right-1 z-20 rounded-md border-2 border-blue-500 bg-blue-100/70"
                              style={{ top: `${slotPick.top}px`, height: `${slotPick.height}px` }}
                            />
                            <button
                              ref={focusBookButton}
                              type="button"
                              onClick={() => openCreateAt({ date: slotPick.date, startTime: slotPick.startTime, clinicianId: slotPick.clinicianId })}
                              aria-label={`${slotBookLabel(slotPick.startTime, slotPick.clinicianName)} on ${shortDayLabel(slotPick.date)}`}
                              style={{ top: `${bookButtonPlacement(slotPick.top, slotPick.height, DAY_GRID_PX).top}px` }}
                              className={cx(
                                'absolute left-1 z-40 inline-flex h-7 max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-md bg-blue-600 px-2 text-xs font-semibold text-white shadow-md hover:bg-blue-700',
                                FOCUS_RING,
                              )}
                            >
                              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              <span className="truncate">{slotBookLabel(slotPick.startTime, slotPick.clinicianName)}</span>
                            </button>
                          </>
                        ) : null}
                        {/* Hour Guidelines */}
                        {Array.from({ length: CAL_END_H - CAL_START_H }).map((_, i) => (
                          <div
                            key={i}
                            data-slot="1"
                            style={{ height: `${HOUR_PX}px` }}
                            className="relative border-b border-slate-100"
                          >
                            {/* Half-hour dashed line */}
                            <div data-slot="1" className="absolute left-0 right-0 top-1/2 border-b border-dashed border-slate-100" />
                          </div>
                        ))}

                        {/* Schedule Blocks (Lunch, Admin, Out-of-Office, Supervision) */}
                        {colBlocks.map((blk) => {
                          const { top, height } = getAppointmentPlacement(
                            blk.startTime,
                            blk.endTime
                          );
                          // Availability blocks book like empty space; everything else is blocked time.
                          const bookable = isBookableBlock(blk.reason);

                          return (
                            <div
                              key={blk.id}
                              data-busy={bookable ? undefined : '1'}
                              title={bookable ? `Available: ${blk.reason}. Click a time to book` : `Blocked: ${blk.reason}`}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                              }}
                              className={cx(
                                'absolute left-1 right-1 z-15 flex flex-col justify-between overflow-hidden rounded-lg border border-dashed p-2 text-left group',
                                bookable ? 'cursor-cell border-emerald-300 bg-emerald-50/70' : 'cursor-not-allowed border-slate-300 bg-slate-100',
                              )}
                            >
                              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                                <span>
                                  {formatClock(blk.startTime)} – {formatClock(blk.endTime)}
                                </span>
                                {bookable ? (
                                  <span className="flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                                    <Plus className="h-3 w-3" aria-hidden /> Available
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                                    <Lock className="h-3 w-3" aria-hidden /> Blocked
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-xs font-semibold text-slate-700">
                                {blk.reason}
                              </p>
                              <div className="flex items-center justify-between text-[11px] text-slate-600">
                                <span>{bookable ? 'Click a time to book' : 'Locked Time Slot'}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScheduleBlocks((prev) =>
                                      prev.filter((item) => item.id !== blk.id)
                                    )
                                  }
                                  className={cx('rounded text-[11px] text-rose-700 opacity-0 hover:underline group-hover:opacity-100 focus-visible:opacity-100', FOCUS_RING)}
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
                          const lbl = appt.label;

                          return (
                            <button
                              key={appt.id}
                              type="button"
                              onClick={() => setSelectedAppt(appt)}
                              aria-label={`${appt.clientName}, ${formatClock(appt.startTime)} to ${formatClock(appt.endTime)}, ${VISIT_LABEL[appt.status]}${lbl ? `, label ${lbl.displayName}` : ''}${docA11y(appt)}`}
                              title={appt.plannedCodes ? `Code ${appt.plannedCodes.split(' ')[0]}` : undefined}
                              // Dynamic placement; label colours are practice-configured (data-driven)
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                ...(lbl ? { backgroundColor: lbl.color, color: lbl.textColor, borderTopColor: lbl.color, borderRightColor: lbl.color, borderBottomColor: lbl.color } : {}),
                              }}
                              className={cx(
                                'absolute left-1 right-1 z-10 flex flex-col justify-between overflow-hidden rounded-lg border border-l-4 p-2 text-left transition-shadow hover:z-30 hover:shadow-sm group',
                                VISIT_EDGE[appt.status],
                                lbl ? '' : 'border-slate-200 bg-white',
                                FOCUS_RING,
                              )}
                            >
                              <div>
                                <div className="flex items-center justify-between gap-1">
                                  <span className={`text-[11px] font-semibold ${lbl ? '' : 'text-slate-600'}`}>
                                    {formatClock(appt.startTime)} – {formatClock(appt.endTime)}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1">
                                  <VisitPaymentIcon payment={appt.payment} />
                                  <DocLightDot light={appt.docLight} />
                                  <VisitPill status={appt.status} size="sm" />
                                </span>
                                </div>
                                <p className={`mt-0.5 truncate text-xs font-semibold ${lbl ? '' : 'text-slate-900 group-hover:text-blue-700'}`}>
                                  {appt.clientName}
                                  {appt.carelonAttestationNeeded ? (
                                    <span title="Carelon non-overlap attestation needed (Maryland Medicaid)" className={`ml-1 inline-flex align-middle ${lbl ? '' : 'text-blue-700'}`}>
                                      <FileSignature className="h-3 w-3" aria-hidden />
                                      <span className="sr-only">Carelon attestation needed</span>
                                    </span>
                                  ) : null}
                                </p>
                                {lbl ? (
                                  <p className="truncate text-[11px] font-semibold">
                                    <Tag className="mr-0.5 inline h-3 w-3" aria-hidden />
                                    {lbl.displayName}
                                  </p>
                                ) : null}
                              </div>

                              <div className={`flex items-center justify-between text-[11px] ${lbl ? '' : 'text-slate-500'}`}>
                                <span className="truncate font-medium">{appt.type}</span>
                                {isVirtual ? (
                                  <span className={`inline-flex items-center gap-0.5 font-semibold ${lbl ? '' : 'text-sky-700'}`}>
                                    <Video className="h-3 w-3" aria-hidden /> Virtual
                                  </span>
                                ) : (
                                  <span className={`font-medium ${lbl ? '' : 'text-slate-500'}`}>{room}</span>
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    Total Sessions: <strong className="tabular-nums text-slate-900">{totalDaySessions}</strong>
                  </span>
                  <span>
                    Seen / In Session:{' '}
                    <strong className="tabular-nums text-slate-900">{inSessionSeen}</strong>
                  </span>
                  <span>
                    Completed:{' '}
                    <strong className="tabular-nums text-slate-900">{completedDaySessions}</strong>
                  </span>
                  <span>
                    Clinic Utilization:{' '}
                    <strong className="tabular-nums text-slate-900">{utilizationRate}%</strong>
                  </span>
                </div>
                <span className="hidden items-center gap-1 text-slate-500 sm:inline-flex">
                  <MousePointerClick className="h-3.5 w-3.5" aria-hidden /> Click an empty time to book
                </span>
                <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => openCreateForm(calDate)}>
                  Add session on {calDate}
                </Button>
              </div>
            </Card>
          ) : (
            /* WEEK VIEW GRID */
            <Card className="overflow-hidden">
              <div className="clinic-scroll-x">
              <div className="grid touch-manipulation grid-cols-1 divide-y divide-slate-200 md:min-w-[49rem] md:grid-cols-7 md:divide-x md:divide-y-0">
                {weekDays.map((dayObj) => {
                  const dayAppts = visibleAppointments.filter((a) => a.date === dayObj.date);
                  const isCurToday = dayObj.isToday;

                  return (
                    <div
                      key={dayObj.date}
                      data-book-surface
                      className={`relative flex min-w-0 cursor-cell flex-col md:min-h-[460px] ${
                        isCurToday ? 'bg-blue-50/40' : 'bg-white'
                      }`}
                      title="Click an empty spot to book on this day"
                      onPointerDown={notePointerDown}
                      onClick={onCellClick(dayObj.date)}
                      onDoubleClick={(e) => {
                        if (!isEmptyBookTarget(e.target)) return;
                        openCreateAt({ date: dayObj.date });
                      }}
                    >
                      {cellBookButton(dayObj.date)}
                      {/* Day Column Header */}
                      <button
                        type="button"
                        onClick={() => {
                          setCalDate(dayObj.date);
                          setCalMode('day');
                        }}
                        className={cx(
                          'border-b border-slate-100 p-3 text-left transition hover:bg-blue-50',
                          dayObj.isCurrentCalDate ? 'bg-blue-50' : '',
                          FOCUS_RING,
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-500">
                            {dayObj.dayName}
                          </span>
                          {isCurToday ? (
                            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                              Today
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-slate-900">
                              {dayObj.dayNumber}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-1 text-[11px] text-slate-500">
                          <span>{dayAppts.length} sessions</span>
                          <span className="inline-flex items-center gap-0.5 font-semibold text-blue-700">
                            Open Day <ArrowRight className="h-3 w-3" aria-hidden />
                          </span>
                        </div>
                      </button>
                      <button type="button" onClick={() => openCreateAt({ date: dayObj.date })} className={SR_BOOK_BUTTON}>
                        {dayBookLabel(dayObj.date)}
                      </button>

                      {/* Day Appointments List */}
                      <div className="flex-1 space-y-2 p-2 md:max-h-[600px] md:overflow-y-auto">
                        {dayAppts.length === 0 ? (
                          <p className="pt-6 text-center text-xs text-slate-500">
                            No sessions
                          </p>
                        ) : (
                          dayAppts.map((appt) => (
                            <button
                              key={appt.id}
                              type="button"
                              onClick={() => setSelectedAppt(appt)}
                              aria-label={`${appt.clientName}, ${formatClock(appt.startTime)}, ${VISIT_LABEL[appt.status]}${appt.label ? `, label ${appt.label.displayName}` : ''}${docA11y(appt)}`}
                              // Valant-style: the whole block takes the label color; the left edge keeps the visit status color
                              className={cx(
                                'block w-full cursor-pointer rounded-lg border border-l-4 p-2.5 text-left transition hover:shadow-sm',
                                VISIT_EDGE[appt.status],
                                appt.label ? '' : 'border-slate-200 bg-white hover:border-blue-300',
                                FOCUS_RING,
                              )}
                              // Data-driven: practice-configured label colours (left edge keeps the visit status class)
                              style={
                                appt.label
                                  ? {
                                      backgroundColor: appt.label.color,
                                      color: appt.label.textColor,
                                      borderTopColor: appt.label.color,
                                      borderRightColor: appt.label.color,
                                      borderBottomColor: appt.label.color,
                                    }
                                  : undefined
                              }
                            >
                              <div className={`flex items-center justify-between gap-1 text-[11px] font-semibold ${appt.label ? '' : 'text-slate-500'}`}>
                                <span>{formatClock(appt.startTime)}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <VisitPaymentIcon payment={appt.payment} />
                                  <DocLightDot light={appt.docLight} />
                                  <VisitPill status={appt.status} size="sm" />
                                </span>
                              </div>
                              <p className={`mt-1 truncate text-xs font-semibold ${appt.label ? '' : 'text-slate-900'}`}>
                                {appt.clientName}
                              </p>
                              <p className={`truncate text-[11px] ${appt.label ? 'opacity-90' : 'text-slate-500'}`}>
                                {appt.clinicianName}
                              </p>
                              {appt.label ? (
                                <p className="mt-1 truncate text-[11px] font-semibold opacity-90">
                                  {appt.label.displayName}
                                </p>
                              ) : null}
                            </button>
                          ))
                        )}
                      </div>

                      {/* Quick Add on Column Bottom */}
                      <div className="border-t border-slate-100 p-2">
                        <button
                          type="button"
                          onClick={() => openCreateForm(dayObj.date)}
                          aria-label={`Add appointment on ${dayObj.date}`}
                          className={cx(
                            'inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-1.5 text-center md:min-h-8 text-xs font-medium text-slate-600 hover:border-blue-600 hover:text-blue-700',
                            FOCUS_RING,
                          )}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden /> Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* BOARD VIEW */}
      {view === 'board' && (
        <div className="space-y-4">
          <Tabs
            variant="pill"
            label="Appointment range"
            controlsPanels={false}
            value={filter}
            onChange={setFilter}
            items={[
              { key: 'today', label: `Today (${todayAppts.length})` },
              { key: 'upcoming', label: `Upcoming (${upcomingAppts.length})` },
              { key: 'all', label: `All (${visibleAppointments.length})` },
            ]}
          />

          {loading ? (
            <Card>
              <LoadingState label="Loading schedule…" />
            </Card>
          ) : displayedList.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarIcon />}
                title="No appointments found in this view."
                description="Try another range or clear the filters above, or book a new appointment."
              />
            </Card>
          ) : (
            <>
              {/* Desktop Board Table */}
              <Card className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th scope="col" className="px-4 py-3">Time & Date</th>
                      <th scope="col" className="px-4 py-3">Client</th>
                      <th scope="col" className="px-4 py-3">Type & Room</th>
                      <th scope="col" className="px-4 py-3">Visit Status</th>
                      <th scope="col" className="px-4 py-3">Note Status</th>
                      <th scope="col" className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedList.map((appt) => (
                      <tr key={appt.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm text-slate-700">
                          <div className="font-semibold text-slate-900 tabular-nums">
                            {formatClock(appt.startTime)}–{formatClock(appt.endTime)}
                          </div>
                          {appt.isVirtual ? (
                            <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
                              <Video className="h-3 w-3" aria-hidden /> Virtual
                            </span>
                          ) : null}
                          {filter !== 'today' ? (
                            <div className="mt-0.5 text-xs text-slate-500">{appt.date}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/clients/${appt.clientId}`}
                            className="rounded text-sm font-semibold text-blue-700 hover:underline"
                          >
                            {appt.clientName}
                          </Link>
                          {appt.carelonAttestationNeeded ? (
                            <span title="Carelon non-overlap attestation needed (Maryland Medicaid)" className="ml-1 inline-flex align-middle text-blue-700">
                              <FileSignature className="h-3 w-3" aria-hidden />
                              <span className="sr-only">Carelon attestation needed</span>
                            </span>
                          ) : null}
                          <p className="text-xs text-slate-500">
                            {appt.clinicianName || 'Unassigned'}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          <div>{appt.type}</div>
                          {appt.plannedCodes ? <div className="text-xs text-slate-500">Code {appt.plannedCodes}</div> : null}
                          <span className="text-xs text-slate-500">
                            {getAppointmentRoom(appt)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <VisitPill status={appt.status} />
                          {appt.label ? (
                            <div className="mt-1.5">
                              <AppointmentLabelChip label={appt.label} size="xs" />
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <DocLightDot light={appt.docLight} size="md" />
                            <NotePill status={appt.noteStatus} visit={appt.status} />
                            <VisitPaymentIcon payment={appt.payment} />
                          </div>
                          {appt.docLight ? <p className="mt-1 text-xs text-slate-500">{appt.docLight.label}</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <AppointmentActions
                            appt={appt}
                            expanding={editingId === appt.id}
                            onToggle={() =>
                              setEditingId((id) => (id === appt.id ? null : appt.id))
                            }
                            onStatus={(s) => void handleStatus(appt.id, s)}
                            onAiDraft={() => void handleAiDraft(appt.id)}
                            busy={saving}
                            consentsDue={consentsDue}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Mobile Board Cards */}
              <div className="space-y-3 md:hidden">
                {displayedList.map((appt) => (
                  <Card key={appt.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {formatClock(appt.startTime)}–{formatClock(appt.endTime)}
                          {appt.isVirtual ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
                              <Video className="h-3 w-3" aria-hidden /> Virtual
                            </span>
                          ) : null}
                        </p>
                        <Link
                          href={`/dashboard/clients/${appt.clientId}`}
                          className="mt-1 block break-words rounded text-base font-semibold text-blue-700 hover:underline"
                        >
                          {appt.clientName}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {appt.type} · {appt.clinicianName || 'Unassigned'}
                          {filter !== 'today' ? ` · ${appt.date}` : ''}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <DocLightDot light={appt.docLight} size="md" className="self-center" />
                          <VisitPill status={appt.status} />
                          <NotePill status={appt.noteStatus} visit={appt.status} />
                          <VisitPaymentIcon payment={appt.payment} className="self-center" />
                          <AppointmentLabelChip label={appt.label} />
                        </div>
                      </div>
                      <AppointmentActions
                        appt={appt}
                        expanding={editingId === appt.id}
                        onToggle={() => setEditingId((id) => (id === appt.id ? null : appt.id))}
                        onStatus={(s) => void handleStatus(appt.id, s)}
                        onAiDraft={() => void handleAiDraft(appt.id)}
                        busy={saving}
                        consentsDue={consentsDue}
                      />
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {view === 'list' && (
        <div className="space-y-4">
          <Tabs
            variant="pill"
            label="Appointment range"
            controlsPanels={false}
            value={filter}
            onChange={setFilter}
            items={[
              { key: 'today', label: `Today (${todayAppts.length})` },
              { key: 'upcoming', label: `Upcoming (${upcomingAppts.length})` },
              { key: 'all', label: `All (${visibleAppointments.length})` },
            ]}
          />

          <div className="space-y-3">
            {loading && displayedList.length === 0 ? (
              <Card>
                <LoadingState label="Loading schedule…" />
              </Card>
            ) : null}
            {!loading && displayedList.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<List />}
                  title="No appointments match these filters."
                  description="Try another range or clear the filters above, or book a new appointment."
                />
              </Card>
            ) : null}
            {displayedList.map((appt) => (
              <Card key={appt.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {formatClock(appt.startTime)}–{formatClock(appt.endTime)}
                      {appt.isVirtual ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
                          <Video className="h-3 w-3" aria-hidden /> Virtual
                        </span>
                      ) : null}
                    </p>
                    <Link
                      href={`/dashboard/clients/${appt.clientId}`}
                      className="mt-1 block break-words rounded text-base font-semibold text-blue-700 hover:underline"
                    >
                      {appt.clientName}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {appt.type} · {appt.clinicianName || 'Unassigned'}
                      {filter !== 'today' ? ` · ${appt.date}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <DocLightDot light={appt.docLight} size="md" className="self-center" />
                      <VisitPill status={appt.status} />
                      <NotePill status={appt.noteStatus} visit={appt.status} />
                      <VisitPaymentIcon payment={appt.payment} className="self-center" />
                      <AppointmentLabelChip label={appt.label} />
                    </div>
                  </div>
                  <AppointmentActions
                    appt={appt}
                    expanding={editingId === appt.id}
                    onToggle={() => setEditingId((id) => (id === appt.id ? null : appt.id))}
                    onStatus={(s) => void handleStatus(appt.id, s)}
                    onAiDraft={() => void handleAiDraft(appt.id)}
                    busy={saving}
                    consentsDue={consentsDue}
                  />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* APPOINTMENT INTERACTIVE POPOVER / MODAL */}
      {selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appointment-detail-title"
            className="w-full max-w-lg max-h-[calc(100dvh-2rem)] space-y-5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl sm:p-6"
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Appointment Details
                </span>
                <h2 id="appointment-detail-title" className="mt-0.5 text-lg font-semibold text-slate-900">
                  <Link
                    href={`/dashboard/clients/${selectedAppt.clientId}`}
                    className="rounded hover:text-blue-700 hover:underline"
                  >
                    {selectedAppt.clientName}
                  </Link>
                </h2>
              </div>
              <IconButton
                label="Close appointment details"
                icon={<X className="h-5 w-5" />}
                onClick={() => setSelectedAppt(null)}
                className="p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              />
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium text-slate-500">Clinician</p>
                <p className="mt-0.5 flex items-center gap-1 font-semibold text-slate-900">
                  <User className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                  {selectedAppt.clinicianName || 'Unassigned'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Location / Room</p>
                <p className="mt-0.5 flex items-center gap-1 font-semibold text-slate-900">
                  {selectedAppt.isVirtual ? (
                    <>
                      <Video className="h-3.5 w-3.5 text-sky-700" aria-hidden />
                      Virtual Video
                    </>
                  ) : (
                    <>
                      <DoorOpen className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                      {getAppointmentRoom(selectedAppt)}
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Date & Time</p>
                <p className="mt-0.5 flex items-center gap-1 font-semibold text-slate-900">
                  <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                  {selectedAppt.date} · {formatClock(selectedAppt.startTime)} {zoneLabel}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Visit Type</p>
                <p className="mt-0.5 font-semibold text-slate-900">{selectedAppt.type}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[11px] font-medium text-slate-500">Booked by</p>
                <p className="mt-0.5 font-semibold text-slate-900">{bookedByText(selectedAppt, practiceTz, zoneLabel)}</p>
                {selectedAppt.lastChangedBy && (
                  <p className="mt-0.5 text-slate-600">
                    Last changed by {selectedAppt.lastChangedBy.name || 'staff'} · {formatStamp(selectedAppt.lastChangedBy.at, practiceTz)} {zoneLabel}
                  </p>
                )}
              </div>
            </div>

            {labels.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">Calendar label:</span>
                  {selectedAppt.label ? (
                    <AppointmentLabelChip label={selectedAppt.label} />
                  ) : (
                    <span className="text-xs text-slate-500">None</span>
                  )}
                </div>
                <LabelSuggestionChip
                  meaning={selectedAppt.suggestedLabelMeaning}
                  labels={labels}
                  disabled={labelBusy}
                  onApply={(l, m) => void handleSetLabel(selectedAppt, l.id, m)}
                />
                <AppointmentLabelPicker
                  labels={labels}
                  value={selectedAppt.labelId ?? null}
                  disabled={labelBusy}
                  onChange={(labelId) => void handleSetLabel(selectedAppt, labelId)}
                />
              </div>
            ) : null}

            {selectedAppt.carelonAttestationNeeded ? (
              <Link
                href={`/dashboard/ehr/consents/carelon/${encodeURIComponent(selectedAppt.clientId)}`}
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                <FileSignature className="h-4 w-4 shrink-0" aria-hidden />
                Carelon non-overlap attestation needed (Maryland Medicaid): complete it at check-in
              </Link>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <StartVisitButton appointment={selectedAppt} size="md" />
              <ConsentsDueBadge clientId={selectedAppt.clientId} due={consentsDue} />
              <PreVisitBriefButton clientId={selectedAppt.clientId} clientLabel={selectedAppt.clientName} />
            </div>
            <AppointmentCopay appointmentId={selectedAppt.id} />
            {showFrontOffice ? (
              <AppointmentFrontOfficePanel
                key={selectedAppt.id}
                appointmentId={selectedAppt.id}
                statusKey={selectedAppt.status}
                focus={foFocus?.id === selectedAppt.id ? foFocus.focus : null}
                onCheckIn={() => void handleStatus(selectedAppt.id, 'checked-in')}
              />
            ) : null}

            {/* Quick Status Update Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Visit Status:</span>
                <VisitPill status={selectedAppt.status} />
              </div>
              <p className="text-xs text-slate-500">Quick Update Status:</p>
              <div className="flex flex-wrap gap-1.5">
                {(['checked-in', 'in-session', 'completed', 'no-show', 'cancelled', 'late-cancel'] as const).map(
                  (s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={saving || selectedAppt.status === s}
                      onClick={() => void handleStatus(selectedAppt.id, s)}
                      aria-pressed={selectedAppt.status === s}
                      className={cx(
                        'rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50',
                        selectedAppt.status === s
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-blue-600 hover:text-blue-700',
                        FOCUS_RING,
                      )}
                    >
                      {VISIT_LABEL[s]}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Virtual Meeting Link */}
            {selectedAppt.isVirtual && (selectedAppt.hostJoinUrl || selectedAppt.clientJoinUrl) && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3.5">
                <p className="text-xs font-semibold text-sky-900">Virtual Telehealth Room Ready</p>
                <Button
                  size="sm"
                  icon={<Video />}
                  className="mt-2"
                  onClick={() =>
                    window.open(
                      (selectedAppt.hostJoinUrl || selectedAppt.clientJoinUrl) as string,
                      '_blank'
                    )
                  }
                >
                  Join Video Call Now
                </Button>
              </div>
            )}

            {selectedAppt.plannedCodes ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs">
                <span className="font-semibold text-slate-700">Planned codes</span>
                <span className="font-mono text-slate-800">{selectedAppt.plannedCodes}</span>
                <span className="w-full text-slate-500">Prefills the note; the signed note&apos;s codes bill.</span>
              </div>
            ) : null}

            {/* AI Note Drafting & EHR */}
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">Documentation Status:</span>
                <NotePill status={selectedAppt.noteStatus} visit={selectedAppt.status} />
              </div>
              {selectedAppt.noteStatus === 'not-started' && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-xs text-slate-500">Note has not been drafted yet.</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Bot />}
                    disabled={saving}
                    onClick={() => void handleAiDraft(selectedAppt.id)}
                  >
                    Generate AI Draft
                  </Button>
                </div>
              )}
              {selectedAppt.noteStatus === 'ai-draft' && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-xs font-medium text-blue-700">
                    AI note draft is prepared for clinical sign-off.
                  </p>
                  <Link
                    href={`/dashboard/ehr/notes?clientId=${encodeURIComponent(selectedAppt.clientId)}&appointmentId=${encodeURIComponent(selectedAppt.id)}&dos=${selectedAppt.date}${selectedAppt.isVirtual ? '&telehealth=1' : ''}`}
                    className={buttonClasses({ size: 'sm' })}
                  >
                    Review & Sign <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              )}
              {selectedAppt.noteStatus === 'signed' && (
                <p className="flex items-center gap-1 pt-1 text-xs font-medium text-emerald-700">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Clinical note signed & CARF compliant.
                </p>
              )}
            </div>

            {/* Notes content */}
            {selectedAppt.notes && (
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                <p className="mb-1 font-semibold text-slate-600">Session / Intake Notes:</p>
                <p>{selectedAppt.notes}</p>
              </div>
            )}

            {/* Section 5.3: Appointment Lifecycle Management */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEditForm(selectedAppt)}>
                  Edit Details
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setApptNotesDraft(selectedAppt.notes || '');
                    setShowNotesModal(true);
                  }}
                >
                  Session Notes
                </Button>
                {selectedAppt.status !== 'cancelled' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    onClick={() => setShowCancelModal(true)}
                  >
                    Cancel / Delete
                  </Button>
                )}
              </div>
              <Button size="sm" variant="secondary" onClick={() => setSelectedAppt(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Block Time Modal */}
      {showBlockModal && (
        <Modal
          title="Block Clinician Time"
          size="sm"
          onClose={() => setShowBlockModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowBlockModal(false)}>
                Cancel
              </Button>
              <Button
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
              >
                Apply Block
              </Button>
            </>
          }
        >
            <p className="text-sm text-slate-500">Lock out schedule for non-patient commitments</p>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Clinician *
                <select
                  value={blockClinicianId}
                  onChange={(e) => setBlockClinicianId(e.target.value)}
                  className={cx(inputClasses, 'mt-1')}
                >
                  {groupProviders(clinicianColumns).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Date *
                <input
                  type="date"
                  value={blockDate}
                  onChange={(e) => setBlockDate(e.target.value)}
                  className={cx(inputClasses, 'mt-1')}
                />
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Start Time *
                  <input
                    type="time"
                    value={blockStartTime}
                    onChange={(e) => setBlockStartTime(e.target.value)}
                    className={cx(inputClasses, 'mt-1')}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  End Time *
                  <input
                    type="time"
                    value={blockEndTime}
                    onChange={(e) => setBlockEndTime(e.target.value)}
                    className={cx(inputClasses, 'mt-1')}
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Block Reason *
                <select
                  value={blockReason}
                  onChange={(e) =>
                    setBlockReason(
                      e.target.value as 'Lunch' | 'Admin Time' | 'Out of Office' | 'Supervision'
                    )
                  }
                  className={cx(inputClasses, 'mt-1')}
                >
                  <option value="Lunch">Lunch & Break</option>
                  <option value="Admin Time">Admin & Somatic Charting</option>
                  <option value="Out of Office">Out of Office / PTO</option>
                  <option value="Supervision">Clinical Supervision</option>
                </select>
              </label>
            </div>
        </Modal>
      )}

      {/* Cancel Appointment Modal */}
      <WaitlistSuggestionsPanel suggestions={waitlistOffers} onClose={() => setWaitlistOffers([])} />

      {showCancelModal && selectedAppt && (
        <Modal
          title="Cancel Appointment"
          size="sm"
          onClose={() => setShowCancelModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowCancelModal(false)}>
                Keep Appointment
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const notes = selectedAppt.notes
                    ? `${selectedAppt.notes}\n[Cancelled: ${cancelReason}]`
                    : `[Cancelled: ${cancelReason}]`;
                  setShowCancelModal(false);
                  if (selectedAppt.seriesId && cancelScope !== 'this') {
                    const seriesId = selectedAppt.seriesId;
                    const scope = cancelScope;
                    setCancelScope('this');
                    void updateAppointmentSeries(seriesId, { action: 'cancel', appointmentId: selectedAppt.id, scope })
                      .then(async (res) => {
                        await reload();
                        toast.success(`Cancelled ${res.cancelled?.length ?? 0} visit${res.cancelled?.length === 1 ? '' : 's'}`);
                        setWaitlistOffers((res.waitlistSuggestions as WaitlistSuggestion[] | undefined) ?? []);
                      })
                      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : 'Could not cancel the series'));
                    return;
                  }
                  void handleStatus(selectedAppt.id, 'cancelled', notes);
                }}
              >
                Confirm Cancellation
              </Button>
            </>
          }
        >
            <p className="text-sm text-slate-500">Record cancellation reason for compliance</p>
            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              <p>
                <strong>Patient:</strong> {selectedAppt.clientName}
              </p>
              <p>
                <strong>Date & Time:</strong> {selectedAppt.date} · {formatClock(selectedAppt.startTime)} {zoneLabel}
              </p>
              <p>
                <strong>Provider:</strong> {selectedAppt.clinicianName || 'Clinic'}
              </p>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Cancellation Reason *
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className={cx(inputClasses, 'mt-1')}
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
              {selectedAppt.seriesId ? (
                <label className="block text-sm font-medium text-slate-700">
                  Cancel
                  <select
                    value={cancelScope}
                    onChange={(e) => setCancelScope(e.target.value as SeriesEditScope)}
                    className={cx(inputClasses, 'mt-1')}
                  >
                    <option value="this">This visit only</option>
                    <option value="following">This and following visits</option>
                    <option value="all">Entire series (future visits)</option>
                  </select>
                </label>
              ) : null}
            </div>
        </Modal>
      )}

      {/* Appointment Notes Modal */}
      {showNotesModal && selectedAppt && (
        <Modal
          title="Appointment Notes"
          size="sm"
          onClose={() => setShowNotesModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowNotesModal(false)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void handleSaveApptNotes()}>
                Save Notes
              </Button>
            </>
          }
        >
            <p className="text-sm text-slate-500">Session intake & front-desk coordination notes</p>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Notes & Clinical Remarks
                <textarea
                  rows={4}
                  value={apptNotesDraft}
                  onChange={(e) => setApptNotesDraft(e.target.value)}
                  placeholder="e.g. Patient arriving 10 mins late; bring recent lab sheets…"
                  className={cx(inputClasses, 'mt-1')}
                />
              </label>
            </div>
        </Modal>
      )}

      {/* AI Clinical Note Promo Banner */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">AI Clinical Note Drafting & Compliance</h2>
            <p className="mt-1 text-sm text-slate-600">
              Turn completed sessions into structured clinical drafts — then review, finalize, and sign in the EHR.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['SOAP', 'DAP', 'BIRP', 'Group', 'Intake', 'CARF Audit Ready'].map((tag) => (
                <StatusBadge key={tag} tone="brand">
                  {tag}
                </StatusBadge>
              ))}
            </div>
            <Link href="/dashboard/ehr/notes" className={buttonClasses({ variant: 'secondary', className: 'mt-4' })}>
              Open AI Notes & EHR <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </Card>
    </Page>
  );
}
