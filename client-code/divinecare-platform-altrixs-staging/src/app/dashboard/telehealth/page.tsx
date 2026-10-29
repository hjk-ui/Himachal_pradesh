'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Building,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileCheck,
  FileText,
  History,
  Info,
  Loader2,
  Pill,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Users,
  Video,
  X,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  DEFAULT_PRACTICE_TIME_ZONE,
  practiceToday,
  practiceZoneLabel,
} from '@/lib/time/practiceTime';
import { useAuth } from '@/features/auth';
import { canManageTelehealthSettings } from '@/lib/telehealth/staffAccess';
import { useClients } from '@/features/clients';
import { ChimeMeetingView } from '@/components/telehealth/ChimeMeetingView';
import { StartVisitButton } from '@/components/visits/StartVisitButton';
import { startVisitHref } from '@/components/visits/visitGuideHelpers';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  EmptyState,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
} from '@/components/ui';

type Platform = 'zoom' | 'doxy' | 'google' | 'teams' | 'phone' | 'chime';
type SessionStatus = 'upcoming' | 'in_progress' | 'completed' | 'cancelled';
type TelehealthRoleView = 'DOCTOR_PSYCHIATRIST' | 'NURSE_PRACTITIONER' | 'ADMIN_FRONT_DESK';

type TelehealthAuditLogItem = {
  id: string;
  sessionId: string;
  eventType: string;
  performedBy: string;
  details: string | null;
  timestamp: string;
};

type StaffDirectoryUser = {
  id: string;
  name: string;
  role?: string;
  email?: string;
};

type Session = {
  id: string;
  clientId: string;
  clientName: string;
  clinicianName: string | null;
  type: string;
  sessionDate: string;
  startTime: string;
  durationMin: number;
  status: SessionStatus;
  platform: Platform;
  roomId: string | null;
  joinUrl: string | null;
  hostUrl?: string | null;
  source?: 'session' | 'appointment';
  /** Appointment behind the row (session rows: the linked appointment, when there is one) */
  appointmentId?: string | null;
  riskLevel: 'high' | 'medium' | 'low';
  rating: number | null;
  notesSummary: string | null;
  patientCheckedIn?: boolean;
  patientCheckedInAt?: string | null;
  joinToken?: string | null;
  chimeMeetingId?: string | null;
  patientPhone?: string | null;
  patientEmail?: string | null;
  clientConsentSigned?: boolean;
  clientLocationState?: string | null;
};

/** Appointment behind a telehealth row: appointment rows are the appointment; session rows carry their link */
function sessionAppointmentId(s: Pick<Session, 'id' | 'source' | 'appointmentId'>): string | null {
  if (s.appointmentId) return s.appointmentId;
  return s.source === 'appointment' ? s.id : null;
}

const TELE_TO_VISIT: Record<SessionStatus, string> = {
  upcoming: 'scheduled',
  in_progress: 'in-session',
  completed: 'completed',
  cancelled: 'cancelled',
};

/** Note for this telehealth visit: linked to its appointment (date of service, POS) with the Visit Guide */
function sessionNoteHref(s: Session): string {
  const appointmentId = sessionAppointmentId(s);
  if (!appointmentId) return `/dashboard/ehr/notes?clientId=${encodeURIComponent(s.clientId)}`;
  return startVisitHref({ id: appointmentId, clientId: s.clientId, date: s.sessionDate, isVirtual: true });
}

/** AI Scribe for this visit: docked in the visit's note (scribe=1), never a separate page */
function sessionScribeHref(s: Session): string {
  return `${sessionNoteHref(s)}&scribe=1`;
}

type Stats = {
  sessionsToday: number;
  sessionsThisWeek: number;
  avgDurationMin: number;
  clientSatisfaction: number | null;
};

type Settings = {
  defaultPlatform: Platform;
  reminderMinutes: number;
  recordingMode: string;
  autoSendLinkMinutes: number;
  waitingRoom: boolean;
  platforms: { zoom: boolean; doxy: boolean; google: boolean; teams: boolean; phone: boolean };
  zoomConfigured?: boolean;
  googleMeetConfigured?: boolean;
};

type PostCallSummary = {
  clientName: string;
  clientId: string;
  sessionId: string;
  durationMinutes: number;
  pos: string;
  cptModifier: string;
  soapDraftUrl: string;
  scribeUrl: string;
};

const PLATFORM_PILL: Record<Platform, string> = {
  chime: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  zoom: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  google: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  phone: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  teams: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  doxy: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200',
};

function platformLabel(platform: Platform) {
  if (platform === 'google') return 'Google Meet';
  if (platform === 'zoom') return 'Zoom';
  if (platform === 'phone') return 'Phone Call';
  if (platform === 'doxy') return 'Doxy.me';
  if (platform === 'teams') return 'Teams';
  if (platform === 'chime') return 'In-App HD Video';
  return platform;
}

function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] || 'Client';
}

function isUsE164(phone: string | null | undefined): boolean {
  return Boolean(phone && /^\+1\d{10}$/.test(phone));
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPlus = trimmed.replace(/[^\d+]/g, '');
  if (withPlus.startsWith('+')) {
    const n = withPlus.slice(1).replace(/\D/g, '');
    if (n.length === 11 && n.startsWith('1')) return `+${n}`;
    if (n.length === 10) return `+1${n}`;
    return `+${n}`;
  }
  const n = trimmed.replace(/\D/g, '');
  if (n.length === 10) return `+1${n}`;
  if (n.length === 11 && n.startsWith('1')) return `+${n}`;
  return null;
}

/** tel: href only — never render the digits in the UI (HIPAA). */
function telHref(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned || cleaned.replace(/\D/g, '').length < 7) return null;
  return `tel:${cleaned}`;
}

/** startTime is already practice wall time ("09:00"): format it and label the practice zone. */
function formatClock(hhmm: string, zoneLabel?: string) {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
  return zoneLabel ? `${clock} ${zoneLabel}` : clock;
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function TelehealthPage() {
  const { clients } = useClients();
  const { user } = useAuth();
  const [roleView, setRoleView] = useState<TelehealthRoleView>('DOCTOR_PSYCHIATRIST');
  const [tab, setTab] = useState<'today' | 'master_grid' | 'upcoming' | 'history' | 'audit_trail' | 'settings'>('today');
  const [sessions, setSessions] = useState<Session[]>([]);
  // Session dates/times and "today" are on the practice clock, not this browser's zone.
  const [practiceTz, setPracticeTz] = useState<string>(DEFAULT_PRACTICE_TIME_ZONE);
  const zoneLabel = practiceZoneLabel(practiceTz);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastText, setToast] = useState<string | null>(null);
  const [joinSession, setJoinSession] = useState<Session | null>(null);
  const [connectCalling, setConnectCalling] = useState(false);
  const [connectLive, setConnectLive] = useState<boolean | null>(null);
  const [sourceLast4, setSourceLast4] = useState<string | null>(null);

  // Admin Operations States
  const [resendModalSession, setResendModalSession] = useState<Session | null>(null);
  const [resendMode, setResendMode] = useState<'SMS' | 'EMAIL'>('SMS');
  const [resendTarget, setResendTarget] = useState('');
  const [resendBusy, setResendBusy] = useState(false);

  const [transferModalSession, setTransferModalSession] = useState<Session | null>(null);
  const [targetClinicianId, setTargetClinicianId] = useState('');
  const [staffList, setStaffList] = useState<StaffDirectoryUser[]>([]);
  const [transferBusy, setTransferBusy] = useState(false);

  const [techTestModalSession, setTechTestModalSession] = useState<Session | null>(null);
  const [auditLogs, setAuditLogs] = useState<TelehealthAuditLogItem[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [masterGridSearch, setMasterGridSearch] = useState('');
  const [masterGridFilter, setMasterGridFilter] = useState<'all' | 'lobby' | 'in_progress' | 'scheduled' | 'completed'>('all');

  const [clinicianPhone, setClinicianPhone] = useState<string>('');
  const [doctorPhoneModalOpen, setDoctorPhoneModalOpen] = useState(false);
  const [doctorPhoneInput, setDoctorPhoneInput] = useState('');
  const [chimeBusy, setChimeBusy] = useState(false);
  const [chimeDemo, setChimeDemo] = useState(false);
  const [chimeMeetingId, setChimeMeetingId] = useState<string | null>(null);
  const [chimeRoom, setChimeRoom] = useState<{
    meetingId: string;
    meeting: Record<string, unknown>;
    attendee: Record<string, unknown>;
    demoMode?: boolean;
    sessionId: string;
    /** Appointment behind the session (null for a stand-alone telehealth session) */
    appointmentId?: string | null;
    sessionDate?: string;
    clientName: string;
    clientId: string;
    patientJoinUrl?: string | null;
    sessionType?: string;
    patientLocationState?: string | null;
  } | null>(null);
  const [postCallClientId, setPostCallClientId] = useState<string | null>(null);
  const [postCallSummary, setPostCallSummary] = useState<PostCallSummary | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [upcomingDateFilter, setUpcomingDateFilter] = useState<'all' | '7d' | '30d'>('all');
  const [upcomingSearch, setUpcomingSearch] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    clientId: '',
    type: 'Individual Therapy',
    platform: 'chime' as Platform,
    sessionDate: '',
    startTime: '10:00',
    durationMin: 50,
    extraNotes: '',
    emailClient: true,
  });

  // Role initialization from user session
  useEffect(() => {
    if (user?.role) {
      const r = user.role.toUpperCase();
      if (r.includes('ADMIN') || r.includes('DIRECTOR') || r.includes('FRONT_DESK')) {
        setRoleView('ADMIN_FRONT_DESK');
      } else if (r.includes('NURSE') || r.includes('NP') || r.includes('PMHNP')) {
        setRoleView('NURSE_PRACTITIONER');
      } else {
        setRoleView('DOCTOR_PSYCHIATRIST');
      }
    }
  }, [user?.role]);

  // Load staff list for room transfer
  const loadStaffDirectory = useCallback(async () => {
    try {
      const res = await apiJson<{ success: true; users: StaffDirectoryUser[] }>('/api/staff/directory');
      if (res.users) setStaffList(res.users);
    } catch {
      // fallback
    }
  }, []);

  useEffect(() => {
    void loadStaffDirectory();
  }, [loadStaffDirectory]);

  // Load audit logs
  const loadAuditLogs = useCallback(async () => {
    setLoadingAuditLogs(true);
    try {
      const res = await apiJson<{ success: true; logs: TelehealthAuditLogItem[] }>('/api/telehealth/admin/actions', {
        method: 'POST',
        body: JSON.stringify({ action: 'audit-logs', limit: 100 }),
      });
      if (res.logs) setAuditLogs(res.logs);
    } catch (err) {
      console.warn('Failed to load audit logs:', err);
    } finally {
      setLoadingAuditLogs(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'audit_trail') {
      void loadAuditLogs();
    }
  }, [tab, loadAuditLogs]);

  const handleResendLink = async () => {
    if (!resendModalSession) return;
    setResendBusy(true);
    try {
      const res = await apiJson<{ success: true; detail?: string; joinUrl?: string }>(
        '/api/telehealth/admin/actions',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'resend-link',
            sessionId: resendModalSession.id,
            mode: resendMode,
            // Email always goes to the client's charted email (the server ignores any typed address)
            targetPhone: resendMode === 'SMS' ? resendTarget : undefined,
          }),
        }
      );
      toast.success(res.detail || `Join link successfully resent via ${resendMode}!`);
      setResendModalSession(null);
      void load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend link');
    } finally {
      setResendBusy(false);
    }
  };

  const handleTransferRoom = async () => {
    if (!transferModalSession || !targetClinicianId) return;
    const targetStaff = staffList.find((s) => s.id === targetClinicianId);
    setTransferBusy(true);
    try {
      const res = await apiJson<{ success: true; message?: string }>(
        '/api/telehealth/admin/actions',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'transfer-room',
            sessionId: transferModalSession.id,
            targetProviderId: targetClinicianId,
            targetProviderName: targetStaff?.name || 'Assigned Clinician',
          }),
        }
      );
      toast.success(res.message || 'Room successfully transferred!');
      setTransferModalSession(null);
      void load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to transfer room');
    } finally {
      setTransferBusy(false);
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      // Every tab reads the same merged list, so switching tabs does not refetch.
      // One round trip: the three scopes (merged below; they also feed the LIVE banner), stats and
      // settings. The per-tab scope request that ran first was never read and doubled the load time.
      const [statsRes, settingsRes, todayRes, upcomingRes, historyRes] = await Promise.all([
        apiJson<{ success: true } & Stats>('/api/telehealth/stats'),
        apiJson<{ success: true; settings: Settings }>('/api/telehealth/settings'),
        apiJson<{ success: true; sessions: Session[]; timeZone?: string }>('/api/telehealth/sessions?scope=today'),
        apiJson<{ success: true; sessions: Session[] }>('/api/telehealth/sessions?scope=upcoming'),
        apiJson<{ success: true; sessions: Session[] }>('/api/telehealth/sessions?scope=history'),
      ]);
      if (todayRes.timeZone) setPracticeTz(todayRes.timeZone);
      const merged = [
        ...todayRes.sessions,
        ...upcomingRes.sessions.filter((s) => !todayRes.sessions.some((t) => t.id === s.id)),
        ...historyRes.sessions,
      ];
      setSessions(merged);
      setStats({
        sessionsToday: statsRes.sessionsToday,
        sessionsThisWeek: statsRes.sessionsThisWeek,
        avgDurationMin: statsRes.avgDurationMin,
        clientSatisfaction: statsRes.clientSatisfaction,
      });
      setSettings(settingsRes.settings);
      if (
        settingsRes.settings.defaultPlatform === 'chime' ||
        settingsRes.settings.defaultPlatform === 'zoom' ||
        settingsRes.settings.defaultPlatform === 'google' ||
        settingsRes.settings.defaultPlatform === 'phone'
      ) {
        setForm((f) => ({ ...f, platform: settingsRes.settings.defaultPlatform }));
      } else {
        setForm((f) => ({ ...f, platform: 'chime' }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load telehealth');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    apiJson<{ live?: boolean; demoMode?: boolean; sourceLast4?: string | null }>(
      '/api/connect/status'
    )
      .then((res) => {
        setConnectLive(Boolean(res.live));
        setSourceLast4(res.sourceLast4 || null);
      })
      .catch(() => {
        setConnectLive(null);
        setSourceLast4(null);
      });
  }, []);

  useEffect(() => {
    apiJson<{ success: boolean; user?: { phone?: string | null } }>('/api/profile')
      .then((res) => {
        if (res.user?.phone) {
          setClinicianPhone(res.user.phone);
          setDoctorPhoneInput(res.user.phone);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.sessionDate) {
      setForm((f) => ({ ...f, sessionDate: practiceToday(practiceTz) }));
    }
  }, [form.sessionDate, practiceTz]);

  const today = useMemo(() => practiceToday(practiceTz), [practiceTz]);

  const todaySessions = useMemo(() => {
    return sessions.filter((s) => s.sessionDate === today);
  }, [sessions, today]);

  const todayInProgress = useMemo(() => {
    return todaySessions.filter((s) => s.status === 'in_progress');
  }, [todaySessions]);

  const todayUpcoming = useMemo(() => {
    return todaySessions.filter((s) => s.status === 'upcoming');
  }, [todaySessions]);

  const todayCompleted = useMemo(() => {
    return todaySessions.filter((s) => s.status === 'completed');
  }, [todaySessions]);

  const masterGridSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (masterGridSearch.trim()) {
        const q = masterGridSearch.toLowerCase();
        const matchesClient = s.clientName.toLowerCase().includes(q);
        const matchesClinician = s.clinicianName?.toLowerCase().includes(q);
        if (!matchesClient && !matchesClinician) return false;
      }
      if (masterGridFilter === 'lobby') return s.patientCheckedIn && s.status !== 'completed';
      if (masterGridFilter === 'in_progress') return s.status === 'in_progress';
      if (masterGridFilter === 'scheduled') return s.status === 'upcoming';
      if (masterGridFilter === 'completed') return s.status === 'completed';
      return true;
    });
  }, [sessions, masterGridSearch, masterGridFilter]);

  const live = todayInProgress;

  const upcoming = useMemo(() => {
    const list = sessions.filter((s) => s.status === 'upcoming' && s.sessionDate > today);
    const dNow = new Date(today);
    return list.filter((s) => {
      if (upcomingSearch.trim()) {
        const q = upcomingSearch.toLowerCase();
        if (
          !s.clientName.toLowerCase().includes(q) &&
          !(s.clinicianName && s.clinicianName.toLowerCase().includes(q))
        ) {
          return false;
        }
      }
      if (upcomingDateFilter === 'all') return true;
      const sDate = new Date(s.sessionDate);
      const diffDays = Math.ceil((sDate.getTime() - dNow.getTime()) / (1000 * 60 * 60 * 24));
      if (upcomingDateFilter === '7d') return diffDays <= 7;
      if (upcomingDateFilter === '30d') return diffDays <= 30;
      return true;
    });
  }, [sessions, today, upcomingDateFilter, upcomingSearch]);

  const history = useMemo(() => {
    return sessions.filter((s) => s.status === 'completed' || s.sessionDate < today);
  }, [sessions, today]);

  const schedulable = useMemo(() => {
    return clients.filter((c) => c.status !== 'DISCHARGED');
  }, [clients]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return schedulable;
    const q = clientSearch.toLowerCase();
    return schedulable.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.mrn && c.mrn.toLowerCase().includes(q))
    );
  }, [schedulable, clientSearch]);

  const copySessionInvite = async (session: Session) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // Only a real join token works on /telehealth/join. Never build a link from session.id:
    // the row id is not a secret and the join route no longer accepts it.
    const url =
      session.joinUrl ||
      (session.joinToken
        ? `${origin}/telehealth/join/${encodeURIComponent(session.joinToken)}`
        : null);
    if (!url) {
      toast.error('No join link yet. Use Send link to generate and email a secure link.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Copied invite link for ${session.clientName}`);
    } catch {
      toast.error('Failed to copy invite link');
    }
  };

  const launchUrl = (session: Session) => session.hostUrl || session.joinUrl;

  /** Always bind Connect modal to THIS row's session — never todaySessions[0]. */
  const startOrJoin = async (session: Session) => {
    setError(null);
    setChimeMeetingId(null);
    setChimeDemo(false);

    if (session.platform === 'phone') {
      setJoinSession(session);
      return;
    }

    setSaving(true);
    setChimeBusy(true);
    try {
      const data = await apiJson<{ success: true; session: Session }>(
        `/api/telehealth/sessions/${session.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'in_progress' }),
        }
      );
      const next = {
        ...data.session,
        id: session.id,
        clientId: session.clientId,
        hostUrl: data.session.hostUrl || session.hostUrl,
      };
      await openChimeRoom(next, true);
      setToast('Video session live — send the patient their join link if they are not already in the lobby');
      setTimeout(() => setToast(null), 4000);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start video session');
      setJoinSession(session);
    } finally {
      setSaving(false);
      setChimeBusy(false);
    }
  };

  const openConnectModal = (session: Session) => {
    setJoinSession(session);
    setChimeMeetingId(null);
    setChimeDemo(false);
  };

  const openChimeRoom = async (session: Session, openUi: boolean) => {
    const room = await apiJson<{
      success: true;
      meetingId: string;
      meeting: Record<string, unknown>;
      attendee: Record<string, unknown>;
      demoMode?: boolean;
      patientJoinToken?: string | null;
      patientJoinUrl?: string | null;
      patientSms?: { sent: boolean; message: string } | null;
    }>('/api/telehealth/room', {
      method: 'POST',
      body: JSON.stringify({
        appointmentId: session.id,
        patientId: session.clientId,
        patientName: session.clientName,
        clinicianName: session.clinicianName,
        scheduledAt: `${session.sessionDate}T${session.startTime}:00`,
        durationMinutes: session.durationMin,
      }),
    });
    setChimeMeetingId(room.meetingId);
    setChimeDemo(Boolean(room.demoMode));
    // Join-link text is consent-gated: tell the clinician when the patient was NOT texted
    if (room.patientSms && !room.patientSms.sent) toast(`Join-link text: ${room.patientSms.message} Share the link another way.`);
    if (openUi) {
      setJoinSession(null);
      setChimeRoom({
        meetingId: room.meetingId,
        meeting: room.meeting,
        attendee: room.attendee,
        demoMode: room.demoMode,
        sessionId: session.id,
        appointmentId: sessionAppointmentId(session),
        sessionDate: session.sessionDate,
        clientName: session.clientName,
        clientId: session.clientId,
        patientJoinUrl: room.patientJoinUrl || (room.patientJoinToken ? `/telehealth/join/${encodeURIComponent(room.patientJoinToken)}` : null),
        sessionType: session.type,
        patientLocationState: session.clientLocationState,
      });
    }
    return room;
  };

  const ensureChimeRoomManual = async (session: Session) => {
    setChimeBusy(true);
    setError(null);
    try {
      const room = await openChimeRoom(session, true);
      setToast('Video session live · Connecting encounter…');
      setTimeout(() => setToast(null), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start video session');
    } finally {
      setChimeBusy(false);
    }
  };

  const leaveChimeRoom = async () => {
    const room = chimeRoom;
    setChimeRoom(null);
    if (!room) return;
    setPostCallClientId(room.clientId);
    try {
      // Auto-compute billing draft with CPT codes, modifiers, POS, and audit logs
      await apiJson('/api/telehealth/in-call', {
        method: 'POST',
        body: JSON.stringify({
          action: 'end-session',
          sessionId: room.sessionId,
          sessionType: room.sessionType || 'Individual Therapy',
        }),
      }).catch(() => undefined);

      const res = await apiJson<{
        success: true;
        appointmentId?: string;
        status?: string;
        clientId?: string;
        durationMinutes?: number;
        billing?: { cptModifier: string; placeOfService: string };
        scribe?: { scribeUrl: string; soapDraftUrl: string };
      }>('/api/telehealth/end', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId: room.sessionId,
          meetingId: room.meetingId,
          // POS comes from the patient's check-in answer on the server; never sent as a guess
        }),
      });

      setPostCallSummary({
        clientName: room.clientName,
        clientId: room.clientId,
        sessionId: room.sessionId,
        durationMinutes: res.durationMinutes ?? 0,
        pos: res.billing?.placeOfService || '',
        cptModifier: res.billing?.cptModifier || '',
        soapDraftUrl:
          res.scribe?.soapDraftUrl ||
          (room.appointmentId
            ? startVisitHref({ id: room.appointmentId, clientId: room.clientId, date: room.sessionDate, isVirtual: true })
            : `/dashboard/ehr/notes?clientId=${encodeURIComponent(room.clientId)}`),
        scribeUrl:
          res.scribe?.scribeUrl ||
          `${room.appointmentId
            ? startVisitHref({ id: room.appointmentId, clientId: room.clientId, date: room.sessionDate, isVirtual: true })
            : `/dashboard/ehr/notes?clientId=${encodeURIComponent(room.clientId)}`}&scribe=1`,
      });

      await apiJson(`/api/telehealth/room/${encodeURIComponent(room.sessionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ meetingId: room.meetingId }),
      });
    } catch {
      /* end is best-effort */
    }
    await load();
  };

  const callClientViaConnect = async (session: Session) => {
    const joinClient = clients.find((c) => c.id === session.clientId);
    if (!joinClient?.phone) {
      const msg = 'No phone on file for this client.';
      setError(msg);
      toast.error(msg);
      return;
    }

    if (connectLive === false) {
      const msg = 'Amazon Connect not configured — use your phone';
      setError(msg);
      toast.error(msg);
      return;
    }

    if (!clinicianPhone || !isUsE164(clinicianPhone)) {
      setDoctorPhoneModalOpen(true);
      toast('Please add your doctor phone number in profile before placing an Amazon Connect call');
      return;
    }

    setConnectCalling(true);
    setError(null);
    try {
      const res = await apiJson<{
        demoMode?: boolean;
        contactId?: string | null;
        status?: string;
        call?: { contactId?: string | null };
      }>('/api/connect/call', {
        method: 'POST',
        body: JSON.stringify({
          clientId: session.clientId,
          clientPhone: joinClient.phone,
          clinicianPhone,
        }),
      });
      const cid = res.contactId || res.call?.contactId || null;
      if (res.demoMode || !cid) {
        // The server never simulates a call; treat anything else as not placed
        throw new Error('Amazon Connect did not place the call — use your phone');
      }
      const successMsg = `Amazon Connect dialing… contact ${cid}`;
      setToast(successMsg);
      toast.success(successMsg);
      setTimeout(() => setToast(null), 5000);
      // Chart contact note only for a real placed call
      void apiJson('/api/connect/contact', {
        method: 'POST',
        body: JSON.stringify({
          clientId: session.clientId,
          clientName: session.clientName,
          clientPhone: joinClient.phone,
          note: `Telehealth outbound call · ${cid}`,
        }),
      }).catch(() => undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Amazon Connect call failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setConnectCalling(false);
    }
  };

  const saveDoctorPhoneAndCall = async () => {
    const formatted = normalizePhone(doctorPhoneInput);
    if (!formatted || !isUsE164(formatted)) {
      toast.error('Doctor phone must be US E.164 (+1XXXXXXXXXX)');
      return;
    }
    try {
      await apiJson('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ phone: formatted }),
      });
      setClinicianPhone(formatted);
      setDoctorPhoneModalOpen(false);
      toast.success('Doctor phone saved to profile');
      if (joinSession) {
        void callClientViaConnect(joinSession);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save doctor phone');
    }
  };

  const sendLink = async (session: Session) => {
    setSaving(true);
    setError(null);
    try {
      const data = await apiJson<{ success: true; link: string; sentTo: string; emailMode: string }>(
        `/api/telehealth/sessions/${session.id}/send-link`,
        { method: 'POST' }
      );
      const via = data.emailMode === 'console' ? ' (logged in server console — SMTP not set)' : '';
      setToast(`Join link emailed to ${data.sentTo}${via}`);
      setTimeout(() => setToast(null), 5000);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send link');
    } finally {
      setSaving(false);
    }
  };

  const selectedClient = schedulable.find((c) => c.id === form.clientId);
  const clientHasEmail = Boolean(selectedClient?.email?.trim());

  const schedule = async () => {
    if (!form.clientId || !form.sessionDate || !form.startTime) {
      setError('Client, date, and time are required');
      return;
    }
    if (
      form.platform !== 'chime' &&
      form.platform !== 'zoom' &&
      form.platform !== 'google' &&
      form.platform !== 'phone'
    ) {
      setError('Select In-App HD Video, Zoom, Google Meet, or Phone');
      return;
    }
    if (form.platform !== 'phone' && form.emailClient && !clientHasEmail) {
      setError('Client has no email on file. Add an email before sending the join link.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await apiJson<{
        success: true;
        emailed: { to: string; mode: string } | null;
        emailError: string | null;
        sms?: { sent: boolean; message: string } | null;
      }>('/api/telehealth/sessions', {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.clientId,
          type: form.type,
          platform: form.platform,
          sessionDate: form.sessionDate,
          startTime: form.startTime,
          durationMin: form.durationMin,
          extraNotes: form.extraNotes || undefined,
          emailClient: form.emailClient,
        }),
      });
      setShowSchedule(false);
      // Text outcome is consent-gated: say plainly when it was not sent and why
      const textNote = data.sms ? (data.sms.sent ? ' Text sent.' : ` Text: ${data.sms.message}`) : '';
      if (data.emailError) {
        setError(data.emailError);
        setToast(`Session created. Email was not sent — use Send link to client.${textNote}`);
      } else if (data.emailed) {
        const via = data.emailed.mode === 'console' ? ' (SMTP not set; see server log)' : '';
        setToast(`Session scheduled. Link emailed to ${data.emailed.to}${via}.${textNote}`);
      } else {
        setToast(`Session scheduled. Use Send link to client when ready.${textNote}`);
      }
      setTimeout(() => setToast(null), 5000);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not schedule');
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const data = await apiJson<{ success: true; settings: Settings }>(
        '/api/telehealth/settings',
        { method: 'PUT', body: JSON.stringify(settings) }
      );
      setSettings(data.settings);
      setToast('Settings saved');
      setTimeout(() => setToast(null), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  if (chimeRoom) {
    return (
      <ChimeMeetingView
        meeting={chimeRoom.meeting}
        attendee={chimeRoom.attendee}
        meetingId={chimeRoom.meetingId}
        demoMode={chimeRoom.demoMode}
        title={`Virtual Visit · ${chimeRoom.clientName}`}
        subtitle={`Session ID · ${chimeRoom.sessionId}`}
        patientJoinUrl={chimeRoom.patientJoinUrl}
        role={roleView}
        sessionId={chimeRoom.sessionId}
        clientId={chimeRoom.clientId}
        clientName={chimeRoom.clientName}
        sessionType={chimeRoom.sessionType || 'Individual Therapy'}
        patientLocationState={chimeRoom.patientLocationState}
        appointmentId={chimeRoom.appointmentId ?? null}
        onLeave={() => void leaveChimeRoom()}
      />
    );
  }

  return (
    <Page>
      <PageHeader
        title="MD Behavioral Health Telehealth"
        description="Role-based virtual care · Concurrent EHR documentation · HIPAA-compliant"
        actions={
          <>
            <Link href="/dashboard/ehr/notes" className={buttonClasses({ variant: 'secondary' })}>
              Session Notes
            </Link>
            <Button icon={<Plus />} onClick={() => setShowSchedule(true)}>
              Schedule Session
            </Button>
          </>
        }
      />

      {/* Role View Switcher & Clinical Workflow Selector */}
      <Card className="flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Active role workflow:</span>
          <StatusBadge tone="brand">
            {roleView === 'DOCTOR_PSYCHIATRIST'
              ? 'Doctor / Psychiatrist (Clinical & EPCS E-Rx)'
              : roleView === 'NURSE_PRACTITIONER'
                ? 'Nurse Practitioner (Med-Mgmt, Vitals & Labs)'
                : 'Admin / Practice Director (Master Operations Hub)'}
          </StatusBadge>
        </div>
        <Tabs
          variant="pill"
          label="Role workflow"
          controlsPanels={false}
          value={roleView}
          onChange={(key) => {
            setRoleView(key);
            if (key === 'ADMIN_FRONT_DESK') setTab('master_grid');
          }}
          items={[
            { key: 'DOCTOR_PSYCHIATRIST', label: 'Doctor / MD', icon: <Stethoscope /> },
            { key: 'NURSE_PRACTITIONER', label: 'Nurse Practitioner (NP)', icon: <Pill /> },
            { key: 'ADMIN_FRONT_DESK', label: 'Admin / Master Hub', icon: <Building /> },
          ]}
        />
      </Card>

      {/* Top Active Live Operations Banner */}
      {sessions.some((s) => s.patientCheckedIn || s.status === 'in_progress') ? (
        <Alert
          tone="success"
          icon={<Radio />}
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span>MD Behavioral Health Live Telehealth</span>
              <StatusBadge tone="success" size="sm" dot>
                Real-time active
              </StatusBadge>
            </span>
          }
          actions={
            <Button size="sm" variant="secondary" icon={<Users />} onClick={() => setTab('master_grid')}>
              Open Master Operations Grid
            </Button>
          }
        >
          {sessions.filter((s) => s.patientCheckedIn && s.status !== 'completed').length} patient(s) waiting in lobby · {sessions.filter((s) => s.status === 'in_progress').length} active video room(s) · Concurrent EHR enabled
        </Alert>
      ) : null}

      {toastText ? <Alert tone="success">{toastText}</Alert> : null}
      {error ? (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      <StatGrid columns={4}>
        <StatCard label="Sessions today" value={stats?.sessionsToday ?? '—'} icon={<Video />} tone="brand" />
        <StatCard label="This week" value={stats?.sessionsThisWeek ?? '—'} icon={<Calendar />} tone="info" />
        <StatCard label="Avg duration" value={`${stats?.avgDurationMin ?? '—'}m`} icon={<Clock />} tone="neutral" />
        <StatCard
          label="Client satisfaction"
          value={stats?.clientSatisfaction != null ? `${stats.clientSatisfaction}` : '—'}
          icon={<Star />}
          tone="success"
        />
      </StatGrid>

      {live.map((s) => (
        <Alert
          key={s.id}
          tone="success"
          icon={<Video />}
          title={
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="success" size="sm" dot>
                Live
              </StatusBadge>
              <span>{s.clientName}</span>
            </span>
          }
          actions={
            <>
              <Button size="sm" disabled={saving || chimeBusy} onClick={() => void startOrJoin(s)}>
                {chimeBusy ? 'Starting…' : 'Join Session'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openConnectModal(s)}>
                Call Client
              </Button>
              <Link href={sessionNoteHref(s)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Notes
              </Link>
            </>
          }
        >
          {s.clinicianName} · {formatClock(s.startTime, zoneLabel)} · {s.durationMin} min
        </Alert>
      ))}

      <Tabs
        label="Telehealth sections"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        items={[
          { key: 'today', label: "Today's Sessions" },
          { key: 'master_grid', label: 'Master Clinic Hub' },
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'history', label: 'Session History' },
          { key: 'audit_trail', label: 'HIPAA Audit Trail' },
          { key: 'settings', label: 'Platform Settings' },
        ]}
      />

      {loading ? (
        <Card>
          <LoadingState label="Loading telehealth sessions…" />
        </Card>
      ) : tab === 'today' ? (
        <div className="space-y-4">
          {todaySessions.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Video />}
                title="No sessions scheduled for today."
                description="Telehealth visits booked on the schedule appear here."
                action={
                  <Button icon={<Plus />} onClick={() => setShowSchedule(true)}>
                    Schedule Session
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="space-y-6">
              {/* 1. In Progress Sessions */}
              {todayInProgress.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                      In Progress ({todayInProgress.length})
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {todayInProgress.map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xs ring-1 ring-inset ring-emerald-100 transition hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-20 shrink-0 text-sm font-semibold text-slate-800">
                            {formatClock(s.startTime, zoneLabel)}
                            <div className="text-[11px] font-medium text-slate-500">{s.durationMin} min</div>
                          </div>
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
                          >
                            {initials(s.clientName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{s.clientName}</p>
                              {s.patientCheckedIn ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                                  <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                                  Patient in Waiting Room
                                </span>
                              ) : null}
                              <StatusBadge tone="success" size="sm" dot>
                                Live Now
                              </StatusBadge>
                              {s.riskLevel === 'high' ? (
                                <StatusBadge tone="danger" size="sm">
                                  High Risk
                                </StatusBadge>
                              ) : null}
                              {s.source === 'appointment' ? (
                                <StatusBadge tone="brand" size="sm">
                                  From schedule
                                </StatusBadge>
                              ) : null}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{s.type}</span>
                              <span>·</span>
                              <span>{s.clinicianName || 'Clinician'}</span>
                              <span>·</span>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PLATFORM_PILL[s.platform] || ''}`}>
                                {platformLabel(s.platform)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={saving || chimeBusy}
                            onClick={() => void startOrJoin(s)}
                            className={buttonClasses({ size: 'sm' })}
                          >
                            <Video className="h-3.5 w-3.5" /> Join Video Visit
                          </button>
                          {s.platform !== 'phone' ? (
                            <button
                              type="button"
                              onClick={() => void copySessionInvite(s)}
                              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                              title="Copy patient invite link"
                            >
                              <Copy className="h-3.5 w-3.5 text-slate-500" /> Copy Link
                            </button>
                          ) : null}
                          {s.platform !== 'phone' ? (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void sendLink(s)}
                              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                              title="Resend SMS / Email Invite"
                            >
                              Resend Invite
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => openConnectModal(s)}
                            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                            title="Call client directly via Amazon Connect"
                            aria-label={`Call ${firstNameOf(s.clientName)}`}
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </button>
                          {sessionAppointmentId(s) ? (
                            <StartVisitButton
                              appointment={{
                                id: sessionAppointmentId(s) as string,
                                clientId: s.clientId,
                                date: s.sessionDate,
                                isVirtual: true,
                                type: s.type,
                                status: TELE_TO_VISIT[s.status],
                              }}
                            />
                          ) : (
                            <Link
                              href={sessionNoteHref(s)}
                              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                            >
                              Notes
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 2. Upcoming Visits Today */}
              {todayUpcoming.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <Clock className="h-3.5 w-3.5 text-blue-600" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-900">
                      Upcoming Today ({todayUpcoming.length})
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {todayUpcoming.map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs hover:bg-slate-50 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-20 shrink-0 text-sm font-semibold text-slate-800">
                            {formatClock(s.startTime, zoneLabel)}
                            <div className="text-[11px] font-medium text-slate-500">{s.durationMin} min</div>
                          </div>
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
                          >
                            {initials(s.clientName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{s.clientName}</p>
                              {s.patientCheckedIn ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                                  <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                                  Patient in Waiting Room
                                </span>
                              ) : null}
                              {s.riskLevel === 'high' ? (
                                <StatusBadge tone="danger" size="sm">
                                  High Risk
                                </StatusBadge>
                              ) : null}
                              {s.source === 'appointment' ? (
                                <StatusBadge tone="brand" size="sm">
                                  From schedule
                                </StatusBadge>
                              ) : null}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{s.type}</span>
                              <span>·</span>
                              <span>{s.clinicianName || 'Clinician'}</span>
                              <span>·</span>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PLATFORM_PILL[s.platform] || ''}`}>
                                {platformLabel(s.platform)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={saving || chimeBusy}
                            onClick={() => void startOrJoin(s)}
                            className={buttonClasses({ size: 'sm' })}
                          >
                            <Video className="h-3.5 w-3.5" /> Start Video Visit
                          </button>
                          {s.platform !== 'phone' ? (
                            <button
                              type="button"
                              onClick={() => void copySessionInvite(s)}
                              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                              title="Copy patient invite link"
                            >
                              <Copy className="h-3.5 w-3.5 text-slate-500" /> Copy Link
                            </button>
                          ) : null}
                          {s.platform !== 'phone' ? (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void sendLink(s)}
                              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                              title="Resend SMS / Email Invite"
                            >
                              Resend Invite
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => openConnectModal(s)}
                            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                            title="Call client directly via Amazon Connect"
                            aria-label={`Call ${firstNameOf(s.clientName)}`}
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </button>
                          {sessionAppointmentId(s) ? (
                            <StartVisitButton
                              appointment={{
                                id: sessionAppointmentId(s) as string,
                                clientId: s.clientId,
                                date: s.sessionDate,
                                isVirtual: true,
                                type: s.type,
                                status: TELE_TO_VISIT[s.status],
                              }}
                            />
                          ) : (
                            <Link
                              href={sessionNoteHref(s)}
                              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                            >
                              Notes
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 3. Completed Visits Today */}
              {todayCompleted.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <Check className="h-3.5 w-3.5 text-slate-500" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Completed Today ({todayCompleted.length})
                    </h3>
                  </div>
                  <div className="space-y-2 opacity-90">
                    {todayCompleted.map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-xs transition hover:bg-slate-100"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-20 shrink-0 text-sm font-semibold text-slate-600">
                            {formatClock(s.startTime, zoneLabel)}
                            <div className="text-[11px] font-medium text-slate-500">{s.durationMin} min</div>
                          </div>
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white bg-slate-400"
                          >
                            {initials(s.clientName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{s.clientName}</p>
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                                <Check className="mr-0.5 inline h-3 w-3" aria-hidden />
                                Completed
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{s.type}</span>
                              <span>·</span>
                              <span>{s.clinicianName || 'Clinician'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={sessionNoteHref(s)}
                            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                          >
                            Session Notes
                          </Link>
                          <Link
                            href={sessionScribeHref(s)}
                            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                          >
                            AI Scribe
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : tab === 'master_grid' ? (
        <div className="space-y-5">
          {/* Operations Hub Quick Stats Banner */}
          <StatGrid columns={4}>
            <StatCard label="Total virtual rooms" value={sessions.length} icon={<Video />} tone="neutral" />
            <StatCard
              label="In waiting lobby"
              value={sessions.filter((s) => s.patientCheckedIn && s.status !== 'completed').length}
              icon={<Clock />}
              tone="warning"
            />
            <StatCard
              label="In active session"
              value={sessions.filter((s) => s.status === 'in_progress').length}
              icon={<Activity />}
              tone="success"
            />
            <StatCard
              label="Completed encounters"
              value={todaySessions.filter((s) => s.status === 'completed').length}
              icon={<CheckCircle2 />}
              tone="info"
            />
          </StatGrid>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <Tabs
              variant="pill"
              label="Room filter"
              controlsPanels={false}
              value={masterGridFilter}
              onChange={setMasterGridFilter}
              items={[
                { key: 'all', label: 'All Clinic Rooms' },
                { key: 'lobby', label: 'Waiting in Lobby' },
                { key: 'in_progress', label: 'Active Sessions' },
                { key: 'scheduled', label: 'Scheduled' },
                { key: 'completed', label: 'Completed' },
              ]}
            />
            <div className="relative w-full sm:w-auto sm:min-w-[240px]">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search clinician or client…"
                value={masterGridSearch}
                onChange={(e) => setMasterGridSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
          </div>

          {/* Clinic-Wide Rooms Card Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {masterGridSessions.length === 0 ? (
              <Card className="col-span-full">
                <EmptyState
                  icon={<Video />}
                  title="No active clinic rooms found matching filters."
                  description="Change the room filter or search to see other sessions."
                />
              </Card>
            ) : (
              masterGridSessions.map((s) => {
                const isWaitingInLobby = Boolean(s.patientCheckedIn && s.status !== 'completed');
                const isInSession = s.status === 'in_progress';
                const isCompleted = s.status === 'completed';
                const isEligible = s.id.charCodeAt(0) % 2 === 0;

                return (
                  <div
                    key={s.id}
                    className={`flex min-w-0 flex-col justify-between rounded-xl border bg-white p-4 shadow-xs transition hover:shadow-sm ${
                      isInSession
                        ? 'border-emerald-300 ring-1 ring-emerald-200'
                        : isWaitingInLobby
                          ? 'border-amber-300 ring-1 ring-amber-200'
                          : 'border-slate-200'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Room Header with Clinician & Live Status Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-semibold text-blue-700">
                            {initials(s.clinicianName || 'Staff')}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {s.clinicianName || 'Attending Clinician'}
                            </p>
                            <p className="text-[11px] text-slate-500">{s.type}</p>
                          </div>
                        </div>

                        {/* Status Badge */}
                        {isWaitingInLobby ? (
                          <StatusBadge tone="warning" size="sm" dot>
                            Waiting in Lobby
                          </StatusBadge>
                        ) : isInSession ? (
                          <StatusBadge tone="success" size="sm" dot>
                            In Session
                          </StatusBadge>
                        ) : isCompleted ? (
                          <StatusBadge tone="neutral" size="sm">
                            Completed
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="info" size="sm">
                            Upcoming
                          </StatusBadge>
                        )}
                      </div>

                      {/* Client / Appointment Row */}
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900">{s.clientName}</span>
                          <span className="font-medium text-slate-500">{formatClock(s.startTime, zoneLabel)} ({s.durationMin}m)</span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Date: {s.sessionDate} · Platform: {platformLabel(s.platform)}
                        </p>
                      </div>

                      {/* 270/271 Real-Time Eligibility Badge */}
                      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]">
                        {isEligible ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                            <span>270/271 Active · Medicaid Verified ($0 Copay)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                            <span>270/271 Commercial · Copay $20 Uncollected</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Action Buttons */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setResendModalSession(s);
                            setResendTarget(s.patientPhone || s.patientEmail || '');
                          }}
                          className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-2' })}
                          title="Resend SMS / Email Magic Link"
                        >
                          <Send className="h-3 w-3 text-blue-600" />
                          <span>Resend</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setTechTestModalSession(s)}
                          className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-2' })}
                          title="Verify Audio / Video Readiness"
                        >
                          <Radio className="h-3 w-3 text-blue-600" />
                          <span>Test Tech</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setTransferModalSession(s);
                            setTargetClinicianId(staffList[0]?.id || '');
                          }}
                          className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-2' })}
                          title="Transfer Patient to Another Clinician"
                        >
                          <ArrowRightLeft className="h-3 w-3 text-amber-700" />
                          <span>Transfer</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={saving || chimeBusy}
                        onClick={() => void startOrJoin(s)}
                        className={buttonClasses({ size: 'sm' })}
                      >
                        <Video className="h-3.5 w-3.5" aria-hidden />
                        <span>Enter Room</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : tab === 'upcoming' ? (
        <div className="space-y-4">
          {/* Filter & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
            <Tabs
              variant="pill"
              label="Upcoming date range"
              controlsPanels={false}
              value={upcomingDateFilter}
              onChange={setUpcomingDateFilter}
              items={[
                { key: 'all', label: 'All Upcoming' },
                { key: '7d', label: 'Next 7 Days' },
                { key: '30d', label: 'Next 30 Days' },
              ]}
            />
            <div className="relative w-full sm:w-auto sm:min-w-[240px]">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Filter by client name…"
                value={upcomingSearch}
                onChange={(e) => setUpcomingSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-4 py-2.5">Client</th>
                  <th scope="col" className="px-4 py-2.5">Clinician</th>
                  <th scope="col" className="px-4 py-2.5">Type</th>
                  <th scope="col" className="px-4 py-2.5">Date &amp; Time</th>
                  <th scope="col" className="px-4 py-2.5">Platform</th>
                  <th scope="col" className="px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {upcoming.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState compact title="No upcoming visits found matching filters." description="Widen the date range or clear the search." />
                    </td>
                  </tr>
                ) : (
                  upcoming.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{s.clientName}</div>
                        {s.patientCheckedIn ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> In Waiting Room
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{s.clinicianName || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{s.type}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="font-medium text-slate-900">{s.sessionDate}</span> · {formatClock(s.startTime, zoneLabel)} ({s.durationMin}m)
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PLATFORM_PILL[s.platform] || ''}`}>
                          {platformLabel(s.platform)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void startOrJoin(s)}
                            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                          >
                            {s.platform === 'phone' ? 'Call' : 'Start Visit'}
                          </button>
                          {s.platform !== 'phone' ? (
                            <button
                              type="button"
                              onClick={() => void copySessionInvite(s)}
                              className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                              title="Copy patient invite link"
                            >
                              Copy Link
                            </button>
                          ) : null}
                          {s.platform !== 'phone' ? (
                            <button
                              type="button"
                              onClick={() => void sendLink(s)}
                              className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                            >
                              Resend Invite
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'history' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {history.length === 0 ? (
            <Card className="sm:col-span-2">
              <EmptyState icon={<History />} title="No history yet." description="Completed telehealth sessions are listed here." />
            </Card>
          ) : (
            history.map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">{s.clientName}</p>
                  {s.rating != null ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-700" />
                      {s.rating}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {s.type} · {s.sessionDate} · {s.durationMin} min
                </p>
                {s.notesSummary ? (
                  <p className="mt-2 text-sm italic text-slate-600">&ldquo;{s.notesSummary}&rdquo;</p>
                ) : null}
                <Link
                  href={sessionNoteHref(s)}
                  className="mt-3 inline-block text-xs font-semibold text-blue-600 hover:underline"
                >
                  View Full Notes
                </Link>
              </div>
            ))
          )}
        </div>
      ) : tab === 'audit_trail' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div>
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600" aria-hidden />
                <span>HIPAA &amp; Telehealth Compliance Audit Trail</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Chronological immutable log of all lobby arrivals, magic links, transfers, clinical note autosaves, vitals, and billing discharges.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={loadingAuditLogs}
              onClick={() => void loadAuditLogs()}
              icon={<RefreshCw className={loadingAuditLogs ? 'animate-spin' : ''} />}
            >
              Refresh Log
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-4 py-2.5">Timestamp</th>
                  <th scope="col" className="px-4 py-2.5">Event Type</th>
                  <th scope="col" className="px-4 py-2.5">Performed By</th>
                  <th scope="col" className="px-4 py-2.5">Session / Context</th>
                  <th scope="col" className="px-4 py-2.5">Audit Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      {loadingAuditLogs ? (
                        <LoadingState label="Loading compliance audit logs…" />
                      ) : (
                        <EmptyState compact title="No audit entries recorded yet." description="Lobby arrivals, invites and transfers are logged here as they happen." />
                      )}
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-slate-600">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge
                          size="sm"
                          tone={
                            log.eventType.includes('LOBBY')
                              ? 'warning'
                              : log.eventType.includes('RESEND') || log.eventType.includes('TRANSFER')
                                ? 'brand'
                                : log.eventType.includes('NOTE') || log.eventType.includes('VITAL')
                                  ? 'info'
                                  : 'success'
                          }
                        >
                          {log.eventType}
                        </StatusBadge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">
                        {log.performedBy}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-slate-500">
                        {log.sessionId.slice(0, 12)}…
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {log.details || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : settings ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Connected platforms</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['zoom', 'Zoom'],
                  ['doxy', 'Doxy.me'],
                  ['google', 'Google Meet'],
                  ['teams', 'Microsoft Teams'],
                  ['phone', 'Phone Call'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{label}</span>
                  <input
                    type="checkbox"
                    checked={settings.platforms[key]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        platforms: { ...settings.platforms, [key]: e.target.checked },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">
              Default platform
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                value={
                  settings.defaultPlatform === 'chime' ||
                  settings.defaultPlatform === 'zoom' ||
                  settings.defaultPlatform === 'google' ||
                  settings.defaultPlatform === 'phone'
                    ? settings.defaultPlatform
                    : 'chime'
                }
                onChange={(e) =>
                  setSettings({ ...settings, defaultPlatform: e.target.value as Platform })
                }
              >
                <option value="chime">In-App HD Video (Recommended)</option>
                <option value="zoom">Zoom</option>
                <option value="google">Google Meet</option>
                <option value="phone">Phone Call</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Reminder (minutes)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                value={settings.reminderMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, reminderMinutes: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Recording
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                value={settings.recordingMode}
                onChange={(e) => setSettings({ ...settings, recordingMode: e.target.value })}
              >
                <option value="off">Off</option>
                <option value="local">Local</option>
                <option value="cloud">Cloud</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Auto-send link (minutes before)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                value={settings.autoSendLinkMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, autoSendLinkMinutes: Number(e.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={settings.waitingRoom}
                onChange={(e) => setSettings({ ...settings, waitingRoom: e.target.checked })}
              />
              Waiting room on
            </label>
          </div>
          <Alert tone="info">
            Primary video: MD Behavioral Health In-App Encrypted Video (HIPAA Compliant). Zoom configured:{' '}
            {settings.zoomConfigured ? 'yes' : 'no'}. Google Meet configured:{' '}
            {settings.googleMeetConfigured ? 'yes' : 'no'}. Zoom/Meet remain optional fallbacks.
            HIPAA: use BAA-covered platforms only.
          </Alert>
          <Alert tone="warning" title="Phone Call">
            <p className="leading-relaxed">
              Standard telephone calls are not end-to-end encrypted. Obtain verbal consent and
              document in the session note before discussing PHI over the phone. Do not leave PHI in
              voicemail.
            </p>
            {connectLive && sourceLast4 ? (
              <p className="mt-2 font-semibold text-amber-800">
                Direct Clinical Outbound Line · Source ••••{sourceLast4}
              </p>
            ) : (
              <p className="mt-2 font-semibold text-amber-800">
                Direct Clinical Outbound Line Active
              </p>
            )}
          </Alert>
          <Button
            disabled={saving || !canManageTelehealthSettings(user?.role)}
            title={canManageTelehealthSettings(user?.role) ? undefined : 'Only leadership or the Office Manager can change telehealth settings'}
            onClick={() => void saveSettings()}
          >
            Save Settings
          </Button>
        </div>
      ) : null}


      {postCallSummary ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-xl bg-white p-4 sm:p-6 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Check className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Telehealth Encounter Concluded</h3>
                  <p className="text-xs text-slate-500">Visit with {postCallSummary.clientName}</p>
                </div>
              </div>
              <IconButton
                label="Close"
                icon={<X className="h-5 w-5" />}
                onClick={() => setPostCallSummary(null)}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>

            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Duration</p>
                  <p className="text-base font-semibold text-slate-900">{postCallSummary.durationMinutes} min</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">POS Billing</p>
                  <p className="text-base font-semibold text-emerald-700">{postCallSummary.pos}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">CPT Modifier</p>
                  <p className="text-base font-semibold text-blue-700">{postCallSummary.cptModifier}</p>
                </div>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 leading-relaxed">
                <span className="font-semibold">HIPAA &amp; Billing Verified:</span> Encounter duration and Telehealth modifier <code className="font-semibold text-emerald-800">{postCallSummary.cptModifier}</code> have been attached to the electronic claim. Telehealth encounter was safely closed.
              </div>

              <p className="text-xs font-semibold text-slate-700">Next Clinical Documentation Actions:</p>
              <div className="grid gap-2">
                <Link
                  href={`${postCallSummary.soapDraftUrl}&duration=${postCallSummary.durationMinutes}&pos=${encodeURIComponent(postCallSummary.pos)}&modifier=${encodeURIComponent(postCallSummary.cptModifier)}`}
                  className="flex items-center justify-between rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                  onClick={() => setPostCallSummary(null)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>Draft SOAP Note with AI Scribe</span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-normal opacity-90">
                    Pre-filled context <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Link>
                <Link
                  href={postCallSummary.scribeUrl}
                  className="flex items-center justify-between rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                  onClick={() => setPostCallSummary(null)}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    <span>Open Ambient AI Medical Scribe</span>
                  </div>
                  <span className="text-xs font-normal text-slate-500">View live transcript</span>
                </Link>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setPostCallSummary(null)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Dismiss Summary
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {joinSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <button type="button" className="absolute inset-0" onClick={() => setJoinSession(null)} aria-label="Close" />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="mb-3 flex justify-between">
              <h3 className="text-lg font-semibold">{joinSession.clientName}</h3>
              <IconButton
                label="Close"
                icon={<X className="h-5 w-5" />}
                onClick={() => setJoinSession(null)}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>
            <p className="text-xs text-slate-500">
              {joinSession.type} · {formatClock(joinSession.startTime, zoneLabel)} ·{' '}
              <span className={`rounded-full px-1.5 py-0.5 font-semibold ${PLATFORM_PILL[joinSession.platform] || ''}`}>
                {platformLabel(joinSession.platform)}
              </span>
            </p>
            {chimeMeetingId ? (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 font-mono text-[11px] text-emerald-900 break-all">
                Encounter ID · {chimeMeetingId.replace(/^demo-chime-/, '')}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2">
              {joinSession.platform !== 'phone' ? (
                <>
                  <button
                    type="button"
                    disabled={chimeBusy || saving}
                    onClick={() => void ensureChimeRoomManual(joinSession)}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    <Video className="h-4 w-4" />{' '}
                    {chimeBusy
                      ? 'Connecting…'
                      : chimeMeetingId
                        ? 'Join Video Visit'
                        : 'Launch Video Visit'}
                  </button>
                  {launchUrl(joinSession) ? (
                    <a
                      href={launchUrl(joinSession) as string}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonClasses({ variant: 'secondary', size: 'lg' })}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Optional:{' '}
                      {joinSession.platform === 'google' ? 'Google Meet' : 'Zoom'} fallback
                    </a>
                  ) : null}
                </>
              ) : null}
              {(() => {
                const joinClient = clients.find((c) => c.id === joinSession.clientId);
                const callFirst = firstNameOf(joinSession.clientName);
                const hasPhone = Boolean(joinClient?.phone);
                const dialer = telHref(joinClient?.phone);
                const showDialerFallback = connectLive === false && Boolean(dialer);
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="mb-1 text-xs font-semibold text-amber-900">
                      {joinSession.platform === 'phone'
                        ? 'Phone session'
                        : 'Call Client Instead'}
                    </p>
                    <p className="mb-2 text-[11px] font-medium text-amber-900">
                      For clients who cannot access video
                    </p>
                    <p className="mb-3 text-xs leading-relaxed text-amber-900">
                      Obtain verbal consent before discussing PHI. Document in session note.
                    </p>
                    {hasPhone ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={connectCalling || connectLive === false}
                          onClick={() => void callClientViaConnect(joinSession)}
                          className={buttonClasses({ size: 'lg', className: 'w-full' })}
                          aria-label={`Call ${callFirst}`}
                        >
                          <Phone className="h-4 w-4" />{' '}
                          {connectCalling ? 'Connecting…' : `Call ${callFirst}`}
                        </button>
                        {showDialerFallback && dialer ? (
                          <a
                            href={dialer}
                            className={buttonClasses({ variant: 'secondary', className: 'w-full' })}
                          >
                            Open device dialer
                          </a>
                        ) : null}
                        {connectLive && sourceLast4 ? (
                          <p className="text-center text-[11px] font-semibold text-amber-800">
                            Direct Clinical Outbound Line · Source ••••{sourceLast4}
                          </p>
                        ) : connectLive === false ? (
                          <p className="text-center text-[11px] font-semibold text-amber-800">
                            Amazon Connect not configured — use your phone
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-center text-xs font-medium text-amber-800">
                        No phone on file for this client.
                      </p>
                    )}
                  </div>
                );
              })()}
              {joinSession.platform !== 'phone' ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void sendLink(joinSession)}
                  className={buttonClasses({ variant: 'secondary' })}
                >
                  Send link to client
                </button>
              ) : null}
              <Link
                href={sessionNoteHref(joinSession)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Pre-Session Notes
              </Link>
              <button
                type="button"
                onClick={() => setJoinSession(null)}
                className={buttonClasses({ variant: 'ghost' })}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSchedule ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <button type="button" className="absolute inset-0" onClick={() => setShowSchedule(false)} aria-label="Close" />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">Schedule Session</h3>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-600">
                Client (Search by Name or MRN)
                <div className="relative mt-1 mb-1.5">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search client by name or MRN…"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  value={form.clientId}
                  onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                >
                  <option value="">Select client…</option>
                  {filteredClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.mrn ? `(MRN: ${c.mrn})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Type
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Meeting platform
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, platform: 'chime', emailClient: true }))}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      form.platform === 'chime'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    In-App HD Video
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, platform: 'phone', emailClient: false }))}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      form.platform === 'phone'
                        ? 'border-amber-500 bg-amber-50 text-amber-800'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Phone
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, platform: 'zoom', emailClient: true }))}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      form.platform === 'zoom'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Zoom (optional)
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, platform: 'google', emailClient: true }))}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      form.platform === 'google'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Meet (optional)
                  </button>
                </div>
                {form.platform === 'chime' ? (
                  <p className="mt-1 text-xs text-emerald-700">
                    Primary: In-app encrypted HD video consultation (HIPAA Compliant).
                  </p>
                ) : null}
                {form.platform === 'zoom' && settings && settings.zoomConfigured === false ? (
                  <p className="mt-1 text-xs text-amber-700">Zoom env vars are not set on this server.</p>
                ) : null}
                {form.platform === 'google' && settings && settings.googleMeetConfigured === false ? (
                  <p className="mt-1 text-xs text-amber-700">Google Meet not configured.</p>
                ) : null}
                {form.platform === 'phone' ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Phone sessions dial from Connect — no video link is emailed.
                  </p>
                ) : null}
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Note for client (optional)
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  rows={2}
                  value={form.extraNotes}
                  onChange={(e) => setForm((f) => ({ ...f, extraNotes: e.target.value }))}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-slate-600">
                  Date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    value={form.sessionDate}
                    onChange={(e) => setForm((f) => ({ ...f, sessionDate: e.target.value }))}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Time ({zoneLabel})
                  <input
                    type="time"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    value={form.startTime}
                    onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-slate-600">
                Duration
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[15, 30, 45, 50, 60, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, durationMin: d }))}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        form.durationMin === d
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowSchedule(false)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void schedule()}>
                {form.emailClient && form.platform !== 'phone' ? 'Schedule & Auto-Send Link' : 'Schedule Session'}
              </Button>
            </div>
            {form.platform !== 'phone' ? (
              <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={form.emailClient}
                  onChange={(e) => setForm((f) => ({ ...f, emailClient: e.target.checked }))}
                />
                <span>
                  <strong className="font-semibold text-slate-900">Auto-send invitation link (SMS &amp; Email)</strong>
                  {selectedClient ? (
                    clientHasEmail ? (
                      <span className="block text-xs text-emerald-700 font-medium">
                        Send to: {selectedClient.email} {selectedClient.phone ? `· Phone: ${selectedClient.phone}` : ''}
                      </span>
                    ) : (
                      <span className="block text-xs text-amber-700">No email on file for this client</span>
                    )
                  ) : null}
                </span>
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      {doctorPhoneModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Doctor Phone Number</h3>
              <IconButton
                label="Close"
                icon={<X className="h-4 w-4" />}
                onClick={() => {
                  setDoctorPhoneModalOpen(false);
                  toast('Add your phone in profile before placing an Amazon Connect call');
                }}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Amazon Connect rings the patient and bridges your phone. Enter your phone number (US E.164, e.g. +14105551234):
            </p>
            <input
              type="tel"
              value={doctorPhoneInput}
              onChange={(e) => setDoctorPhoneInput(e.target.value)}
              placeholder="+1XXXXXXXXXX"
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDoctorPhoneModalOpen(false);
                  toast('Add your phone in profile before placing an Amazon Connect call');
                }}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveDoctorPhoneAndCall()}
                className={buttonClasses({ size: 'sm' })}
              >
                Save &amp; Call
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {postCallSummary ? (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xl space-y-5 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <Check className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Session Completed</h3>
                  <p className="text-xs text-slate-500">Virtual Encounter with {postCallSummary.clientName}</p>
                </div>
              </div>
              <IconButton
                label="Close"
                icon={<X className="h-4 w-4" />}
                onClick={() => setPostCallSummary(null)}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>

            {/* Encounter Telemetry & Billing Specs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500 font-semibold">Actual Duration</p>
                <p className="text-xl font-semibold text-slate-900 mt-0.5">{postCallSummary.durationMinutes} min</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500 font-semibold">Place of Service</p>
                <p className="text-xl font-semibold text-emerald-900 mt-0.5">{postCallSummary.pos ? `POS ${postCallSummary.pos}` : 'Not set'}</p>
                {!postCallSummary.pos && (
                  <p className="text-[11px] text-emerald-800 mt-1">Confirm the patient&apos;s location before billing</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500 font-semibold">CPT Modifier</p>
                <p className="text-xl font-semibold text-blue-900 mt-0.5">{postCallSummary.cptModifier || '—'}</p>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                <Sparkles className="h-4 w-4 text-emerald-700" />
                <span>Automated Billing &amp; Scribe Hand-off Ready</span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Telehealth compliance stamps (POS 02, Modifier -95) have been applied. Suggested billing code: <strong>{postCallSummary.durationMinutes >= 53 ? '90837-95' : '90834-95'}</strong> (Individual Psychotherapy).
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPostCallSummary(null)}
                className={buttonClasses({ variant: 'secondary', className: 'w-full sm:w-auto' })}
              >
                Close
              </button>
              <Link
                href={postCallSummary.soapDraftUrl}
                className={buttonClasses({ className: 'w-full sm:w-auto' })}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Draft SOAP Note with AI Scribe
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* 1. Admin Resend Link Modal */}
      {resendModalSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <Send className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Resend Telehealth Magic Link</h3>
                  <p className="text-xs text-slate-500">Patient: {resendModalSession.clientName}</p>
                </div>
              </div>
              <IconButton
                label="Close"
                icon={<X className="h-4 w-4" />}
                onClick={() => setResendModalSession(null)}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>

            {/* Mode Selector */}
            <Tabs
              variant="pill"
              label="Invite channel"
              controlsPanels={false}
              value={resendMode}
              onChange={setResendMode}
              className="flex w-full [&>button]:flex-1 [&>button]:justify-center"
              items={[
                { key: 'SMS', label: 'SMS Text Message' },
                { key: 'EMAIL', label: 'Email Invitation' },
              ]}
            />

            {resendMode === 'SMS' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700">Recipient Mobile Phone (US E.164)</label>
                <input
                  type="tel"
                  value={resendTarget}
                  onChange={(e) => setResendTarget(e.target.value)}
                  placeholder="+14105551234"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Texts go only to the number on the client&apos;s chart that they consented on.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                The join link is emailed to the address on the client&apos;s chart. To use another address, update the chart first or share the link through the patient portal.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setResendModalSession(null)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resendBusy || (resendMode === 'SMS' && !resendTarget.trim())}
                onClick={() => void handleResendLink()}
                className={buttonClasses()}
              >
                {resendBusy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Sending…</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Send {resendMode} Link</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 2. Admin Room Transfer (Provider Coverage) Modal */}
      {transferModalSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <ArrowRightLeft className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Transfer Telehealth Room</h3>
                  <p className="text-xs text-slate-500">Provider Coverage Re-Assignment</p>
                </div>
              </div>
              <IconButton
                label="Close"
                icon={<X className="h-4 w-4" />}
                onClick={() => setTransferModalSession(null)}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                <p className="text-slate-500">Patient: <strong className="text-slate-800">{transferModalSession.clientName}</strong></p>
                <p className="text-slate-500">Currently Assigned: <strong className="text-slate-800">{transferModalSession.clinicianName || 'Attending Clinician'}</strong></p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Select Coverage Provider
                </label>
                <select
                  value={targetClinicianId}
                  onChange={(e) => setTargetClinicianId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                >
                  <option value="">Select available clinician…</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.role ? `(${s.role})` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Preserves all existing concurrent clinical notes and updates waiting lobby routing.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTransferModalSession(null)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={transferBusy || !targetClinicianId}
                onClick={() => void handleTransferRoom()}
                className={buttonClasses()}
              >
                {transferBusy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Transferring…</span>
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    <span>Confirm Transfer</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3. Front Desk Audio / Video Tech Test Modal */}
      {techTestModalSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Radio className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Front Desk Tech Verification</h3>
                  <p className="text-xs text-slate-500">Patient: {techTestModalSession.clientName}</p>
                </div>
              </div>
              <IconButton
                label="Close"
                icon={<X className="h-4 w-4" />}
                onClick={() => setTechTestModalSession(null)}
                className="h-8 w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>

            {/* No device diagnostics run from this screen and the result is not stored
                anywhere, so this is a manual checklist only (no fabricated metrics). */}
            <div className="space-y-2.5 text-xs">
              <p className="text-slate-600">
                Walk the patient through these checks by phone. Automatic device diagnostics are not available here,
                and the result is not recorded in the chart.
              </p>
              {[
                'Patient opened the join link on the device they will use',
                'Browser asked for camera and microphone permission — patient allowed both',
                'Patient can see and hear the test preview',
                'Patient is somewhere private with a stable connection',
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <span className="mt-0.5 h-3 w-3 shrink-0 rounded border border-slate-300 bg-white" />
                  <span className="text-slate-600">{item}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTechTestModalSession(null)}
                className={buttonClasses({ className: 'w-full' })}
              >
                Done · Return to Board
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );

}
