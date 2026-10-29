'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Edit2,
  Laptop,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  Volume2,
  Building2,
  History,
  ShieldCheck,
  ShieldAlert,
  Users,
  Delete,
  Play,
  Pause,
  Sparkles,
  Radio,
  ArrowLeft,
  X,
  Voicemail,
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { useMessages } from '@/features/messages';
import type { ThreadStatus, ThreadTopic } from '@/features/messages';
import { apiJson } from '@/lib/api-client';
import { RiskWatchBanner } from '@/lib/ai/riskWatch/RiskWatchBanner';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  Tabs,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';

type TopTab = 'sms-calls' | 'secure' | 'dial-directory' | 'voicemail-ai';
type SmsSubTab = 'sms' | 'calls';

type OperationalCallItem = {
  id: string;
  calleeName: string;
  destinationPhone: string;
  callType: 'AGENT' | 'QUEUE' | 'EXTERNAL';
  purpose?: string | null;
  durationSeconds: number;
  status: string;
  createdAt: string;
};

type ConnectMessage = {
  id: string;
  body: string;
  direction: string;
  status: string;
  demoMode: boolean;
  createdAt: string;
};

type ConnectCall = {
  id: string;
  clientPhone: string;
  clinicianPhone?: string | null;
  clinicianName?: string | null;
  contactId?: string | null;
  status: string;
  demoMode: boolean;
  createdAt: string;
  durationSec?: number | null;
  recordingUrl?: string | null;
  analysisJson?: ContactLensAnalysis | null;
  analysis?: ContactLensAnalysis | null;
};

type ContactLensAnalysis = {
  sentiment?: string;
  summary?: string;
  keyPhrases?: string[];
  crisisKeywords?: string[];
  demoMode?: boolean;
};

type VoicemailItem = {
  id: string;
  callerName?: string;
  callerPhone: string;
  durationSeconds: number;
  transcript: string;
  intent: 'crisis' | 'reschedule' | 'refill' | 'billing' | 'general';
  confidence: number;
  routeTo: string;
  isRouted: boolean;
  createdAt: string;
};

const TOPIC_TONE: Record<ThreadTopic, Tone> = {
  scheduling: 'info',
  billing: 'success',
  general: 'neutral',
  clinical: 'brand',
  'rx-refill': 'warning',
};

const STATUS_META: Record<ThreadStatus, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting', tone: 'warning' },
  'in-progress': { label: 'In Progress', tone: 'info' },
  forwarded: { label: 'Forwarded', tone: 'brand' },
  resolved: { label: 'Resolved', tone: 'success' },
};

const OPERATIONAL_QUEUES: Array<{ id: string; name: string; phone: string; badge: string; tone: Tone }> = [
  { id: 'crisis-queue', name: 'Crisis Team (On-Call)', phone: '+12405550199', badge: 'Priority · 24/7', tone: 'danger' },
  { id: 'bowie-desk', name: 'Bowie Front Desk', phone: '+12405550101', badge: 'Site Desk (BW)', tone: 'neutral' },
  { id: 'ss-desk', name: 'Silver Spring Front Desk', phone: '+13015550102', badge: 'Site Desk (SS)', tone: 'neutral' },
  { id: 'lp-desk', name: 'Lexington Park Front Desk', phone: '+13015550103', badge: 'Site Desk (LP)', tone: 'neutral' },
  { id: 'balt-desk', name: 'Baltimore Front Desk', phone: '+14105550104', badge: 'Site Desk (BA)', tone: 'neutral' },
  { id: 'billing-queue', name: 'Billing & RCM Team', phone: '+12405550105', badge: 'Operations', tone: 'brand' },
];

const VM_INTENT_TONE: Record<VoicemailItem['intent'], Tone> = {
  crisis: 'danger',
  refill: 'warning',
  billing: 'success',
  reschedule: 'info',
  general: 'neutral',
};

// No hardcoded staff — real staff extensions will be loaded once configured.
const OPERATIONAL_STAFF: Array<{
  name: string;
  role: string;
  site: string;
  ext: string;
  phone: string;
  avatar: string;
}> = [];

const OPERATIONAL_EXTERNAL_DIRECTORY = [
  { category: 'Payers', name: 'Optum MD Provider Line', phone: '+18008881234', desc: 'Medicaid BH Pre-Auth & Claims Status' },
  { category: 'Payers', name: 'CareFirst BlueCross BlueShield', phone: '+18005448782', desc: 'Commercial Provider Appeals & Benefits' },
  { category: 'Payers', name: 'Aetna Behavioral Health', phone: '+18006240756', desc: 'Specialty Case Management & Utilization' },
  { category: 'Payers', name: 'Medicare Novitas Solutions', phone: '+18772524308', desc: 'Part B Jurisdiction L Claims Customer Service' },
  { category: 'Pharmacies', name: 'CVS Health — Bowie Plaza', phone: '+13018051200', desc: 'Prescription Verification & EPCS Sync' },
  { category: 'Pharmacies', name: 'Walgreens — Silver Spring', phone: '+13015882345', desc: '24/7 Controlled Substance Dispensing Desk' },
  { category: 'Pharmacies', name: 'Giant Pharmacy — Lexington Park', phone: '+13012624500', desc: 'Local Community Fill Desk' },
  { category: 'Laboratories', name: 'Quest Diagnostics Regional', phone: '+18666978378', desc: 'Stat Urine Drug Screening & Toxicology' },
  { category: 'Laboratories', name: 'Labcorp Mid-Atlantic Center', phone: '+18008590391', desc: 'Clinical Reference Blood & Lithium Levels' },
  { category: 'Courts & Legal', name: "Prince George's County District Court", phone: '+13019523211', desc: 'Mental Health Diversion Docket Clerk' },
  { category: 'Courts & Legal', name: 'Montgomery County District Court', phone: '+12407779200', desc: 'Behavioral Health Court Liaison Office' },
  { category: 'Vendor Support', name: 'DrFirst EPCS Support', phone: '+18662636511', desc: 'DEA Schedule II Token & Biometric Support' },
  { category: 'Vendor Support', name: 'Waystar EDI Clearinghouse', phone: '+18446927827', desc: '837P / 835 Electronic Payer Gateway Hotline' },
  { category: 'Vendor Support', name: 'Valant EHR Support Desk', phone: '+18887740532', desc: 'Clinical EHR Data Integrations' },
];

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
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

function formatDuration(sec?: number | null) {
  if (sec == null) return '< 1m';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  const s = (sentiment || 'Neutral').toLowerCase();
  let tone: Tone = 'neutral';
  let label = 'Neutral';
  if (s.includes('crisis')) {
    tone = 'danger';
    label = 'Crisis';
  } else if (s.includes('pos')) {
    tone = 'success';
    label = 'Positive';
  } else if (s.includes('neg')) {
    tone = 'warning';
    label = 'Negative';
  }
  return (
    <StatusBadge tone={tone} size="sm">
      {label}
    </StatusBadge>
  );
}

function sentimentBarColor(sentiment?: string) {
  const s = (sentiment || '').toLowerCase();
  if (s.includes('pos')) return 'bg-emerald-500';
  if (s.includes('crisis') || s.includes('neg')) return 'bg-rose-500';
  return 'bg-amber-500';
}

export default function CommunicationsPage() {
  const searchParams = useSearchParams();
  const { clients, loading: clientsLoading, error: clientsError } = useClients();
  const {
    threads,
    selectedId,
    messages: secureMessages,
    loading: threadsLoading,
    sending,
    error: messagesError,
    loadThreads,
    openThread,
    send,
    updateThread,
  } = useMessages();

  const [tab, setTab] = useState<TopTab>('sms-calls');
  // Phones show the secure-thread list or the open thread, not both side by side.
  const [secureShowList, setSecureShowList] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [smsSub, setSmsSub] = useState<SmsSubTab>('sms');
  const [smsBody, setSmsBody] = useState('');
  const [messages, setMessages] = useState<ConnectMessage[]>([]);
  const [calls, setCalls] = useState<ConnectCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [clinicianPhone, setClinicianPhone] = useState<string>('');
  const [clinicianName, setClinicianName] = useState<string>('');
  const [editingClientPhone, setEditingClientPhone] = useState(false);
  const [clientPhoneInput, setClientPhoneInput] = useState('');
  const [doctorPhoneModalOpen, setDoctorPhoneModalOpen] = useState(false);
  const [doctorPhoneInput, setDoctorPhoneInput] = useState('');

  // Voicemail AI state
  const [voicemails, setVoicemails] = useState<VoicemailItem[]>([]);
  const [vmLoading, setVmLoading] = useState(false);
  const [selectedVm, setSelectedVm] = useState<VoicemailItem | null>(null);
  const [vmFilter, setVmFilter] = useState<'all' | 'crisis' | 'reschedule' | 'refill' | 'billing' | 'general'>('all');
  const [vmAudioPlaying, setVmAudioPlaying] = useState(false);

  const [callDevice, setCallDevice] = useState<'laptop' | 'phone'>('laptop');
  const [isMuted, setIsMuted] = useState(false);
  const [micAudioLevel, setMicAudioLevel] = useState(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const startLaptopAudio = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setMicAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();
      return true;
    } catch (e) {
      console.warn('Microphone permission not granted or not available:', e);
      return false;
    }
  };

  const stopLaptopAudio = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    setMicAudioLevel(0);
    setIsMuted(false);
  };

  const toggleMute = () => {
    if (mediaStreamRef.current) {
      const tracks = mediaStreamRef.current.getAudioTracks();
      tracks.forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!tracks[0]?.enabled);
    } else {
      setIsMuted(!isMuted);
    }
  };

  const openCcpPopup = () => {
    window.open(
      'https://altrixs-prod.my.connect.aws/ccp-v2/',
      'AmazonConnectCCP',
      'width=420,height=600,scrollbars=no,resizable=yes'
    );
  };

  const [callPhase, setCallPhase] = useState<'idle' | 'connecting' | 'active'>('idle');
  const [callSeconds, setCallSeconds] = useState(0);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [callDemoMode, setCallDemoMode] = useState(false);
  const [connectLive, setConnectLive] = useState<boolean | null>(null);
  const [sourceLast4, setSourceLast4] = useState<string | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [lensOpenFor, setLensOpenFor] = useState<string | null>(null);
  const [lens, setLens] = useState<ContactLensAnalysis | null>(null);
  const [lensDemo, setLensDemo] = useState(false);
  const [lensBusy, setLensBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState<'all' | ThreadStatus>('all');
  const [secureSearch, setSecureSearch] = useState('');
  const [compose, setCompose] = useState('');
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [clinicianOptions, setClinicianOptions] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);

  // ── Operational Dial & Directory State ─────────────────────────────────────
  const [dialPadNumber, setDialPadNumber] = useState('');
  const [dialPadName, setDialPadName] = useState('');
  const [opExternalSearch, setOpExternalSearch] = useState('');
  const [opCallPhase, setOpCallPhase] = useState<'idle' | 'connecting' | 'active'>('idle');
  const [opCallSeconds, setOpCallSeconds] = useState(0);
  const [activeOpTarget, setActiveOpTarget] = useState<{
    name: string;
    phone: string;
    type: 'agent' | 'queue' | 'external';
    purpose?: string;
  } | null>(null);
  const [opCallsLog, setOpCallsLog] = useState<OperationalCallItem[]>([]);
  const [loadingOpCalls, setLoadingOpCalls] = useState(false);
  const opCallTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOpCalls = useCallback(async () => {
    setLoadingOpCalls(true);
    try {
      const res = await apiJson<{ success: boolean; calls: OperationalCallItem[] }>(
        '/api/connect/operational-calls'
      );
      if (res.calls) setOpCallsLog(res.calls);
    } catch {
      // safe fallback
    } finally {
      setLoadingOpCalls(false);
    }
  }, []);

  const handleStartStaffCall = async (calleeName: string, calleePhone: string, target: 'agent' | 'queue') => {
    if (opCallPhase !== 'idle') {
      toast.error('Another call is currently active. End it first.');
      return;
    }
    setOpCallPhase('connecting');
    setActiveOpTarget({ name: calleeName, phone: calleePhone, type: target });
    setOpCallSeconds(0);
    try {
      const res = await apiJson<{
        success: boolean;
        call?: { destinationPhone: string; contactId?: string };
        callLog?: OperationalCallItem;
      }>('/api/connect/staff-call', {
        method: 'POST',
        body: JSON.stringify({ calleeName, calleePhone, target }),
      });
      setOpCallPhase('active');
      toast.success(`Connected to ${calleeName} (${target.toUpperCase()})`);
      if (res.callLog) {
        setOpCallsLog((prev) => [res.callLog!, ...prev]);
      }
      if (opCallTimerRef.current) clearInterval(opCallTimerRef.current);
      opCallTimerRef.current = setInterval(() => {
        setOpCallSeconds((sec) => sec + 1);
      }, 1000);
    } catch (e) {
      setOpCallPhase('idle');
      setActiveOpTarget(null);
      toast.error(e instanceof Error ? e.message : 'Failed to connect staff call');
    }
  };

  const handleStartExternalCall = async (destinationPhone: string, calleeName: string, purpose?: string) => {
    if (opCallPhase !== 'idle') {
      toast.error('Another call is currently active. End it first.');
      return;
    }
    const cleanPhone = destinationPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      toast.error('Please enter a valid 10-digit phone number');
      return;
    }
    setOpCallPhase('connecting');
    setActiveOpTarget({ name: calleeName || 'External Contact', phone: destinationPhone, type: 'external', purpose });
    setOpCallSeconds(0);
    try {
      const res = await apiJson<{
        success: boolean;
        call?: { destinationPhone: string; contactId?: string };
        callLog?: OperationalCallItem;
      }>('/api/connect/external-call', {
        method: 'POST',
        body: JSON.stringify({ destinationPhone, calleeName: calleeName || 'External Vendor', purpose: purpose || 'Operational Inquiry' }),
      });
      setOpCallPhase('active');
      toast.success(`Dialing external number: ${destinationPhone}`);
      if (res.callLog) {
        setOpCallsLog((prev) => [res.callLog!, ...prev]);
      }
      if (opCallTimerRef.current) clearInterval(opCallTimerRef.current);
      opCallTimerRef.current = setInterval(() => {
        setOpCallSeconds((sec) => sec + 1);
      }, 1000);
    } catch (e) {
      setOpCallPhase('idle');
      setActiveOpTarget(null);
      toast.error(e instanceof Error ? e.message : 'Failed to initiate external call');
    }
  };

  const handleEndOpCall = () => {
    if (opCallTimerRef.current) {
      clearInterval(opCallTimerRef.current);
      opCallTimerRef.current = null;
    }
    const duration = opCallSeconds;
    toast.success(`Call ended (${Math.floor(duration / 60)}m ${duration % 60}s)`);
    setOpCallPhase('idle');
    setOpCallSeconds(0);
    setActiveOpTarget(null);
    void loadOpCalls();
  };

  const handleSoftpadDialPress = (digit: string) => {
    setDialPadNumber((prev) => prev + digit);
  };

  const handleSoftpadBackspace = () => {
    setDialPadNumber((prev) => prev.slice(0, -1));
  };

  const handleSoftpadClear = () => {
    setDialPadNumber('');
    setDialPadName('');
  };

  useEffect(() => {
    const fromQuery = searchParams.get('clientId')?.trim();
    if (fromQuery) setClientId(fromQuery);
  }, [searchParams]);

  useEffect(() => {
    if (clients.length && !clientId) setClientId(clients[0].id);
  }, [clients, clientId]);

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
    apiJson<{ success: boolean; user?: { phone?: string | null; name?: string | null } }>(
      '/api/profile'
    )
      .then((res) => {
        if (res.user?.phone) {
          setClinicianPhone(res.user.phone);
          setDoctorPhoneInput(res.user.phone);
        }
        if (res.user?.name) setClinicianName(res.user.name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'secure') void loadThreads();
  }, [tab, loadThreads]);

  const loadVoicemails = useCallback(async () => {
    setVmLoading(true);
    try {
      const res = await fetch('/api/communications/voicemails');
      const data = await res.json();
      const list: VoicemailItem[] | undefined = Array.isArray(data.voicemails)
        ? data.voicemails
        : Array.isArray(data.data)
        ? data.data
        : undefined;
      if (list) {
        setVoicemails(list);
        if (list.length > 0) {
          setSelectedVm((prev) => prev || list[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load voicemails', e);
    } finally {
      setVmLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVoicemails();
  }, [loadVoicemails]);

  const [vmRouting, setVmRouting] = useState(false);
  const handleMarkVmRouted = async (id: string) => {
    setVmRouting(true);
    try {
      const res = await apiJson<{ success: true; voicemail: VoicemailItem }>('/api/communications/voicemails', {
        method: 'PATCH',
        body: JSON.stringify({ id, isRouted: true }),
      });
      const updated = { isRouted: res.voicemail.isRouted, routeTo: res.voicemail.routeTo };
      setVoicemails((prev) => prev.map((v) => (v.id === id ? { ...v, ...updated } : v)));
      setSelectedVm((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
      toast.success(`Voicemail marked as routed to ${res.voicemail.routeTo}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark voicemail as routed');
    } finally {
      setVmRouting(false);
    }
  };

  // Automated crisis paging (SMS/push/SNS) is not connected: /api/crisis/paging
  // records the attempt and answers 503 "unavailable". Never claim staff were paged.
  const [vmPaging, setVmPaging] = useState(false);
  const handlePageCrisisStaff = async () => {
    setVmPaging(true);
    try {
      const res = await fetch('/api/crisis/paging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No PHI in the page record — caller details stay in the voicemail.
        body: JSON.stringify({ trigger: 'voicemail_crisis' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.notificationsSent === true) {
        toast.success('On-call crisis staff paged.');
      } else {
        toast.error(
          `${data?.page ? 'Page attempt logged, but n' : 'N'}o one was notified automatically — paging is not connected yet. Phone the on-call crisis clinician now.`,
          { duration: 10000 }
        );
      }
    } catch {
      toast.error('Paging request failed — no one was notified. Phone the on-call crisis clinician now.', { duration: 10000 });
    } finally {
      setVmPaging(false);
    }
  };

  useEffect(() => {
    apiJson<{ success: true; users: Array<{ id: string; name: string; role: string }> }>(
      '/api/staff/directory'
    )
      .then((res) => {
        const names = (res.users || [])
          .filter((u) => /clinician|provider|therapist|psych|md|np|pa/i.test(u.role) || true)
          .map((u) => u.name)
          .filter(Boolean);
        setClinicianOptions(Array.from(new Set(names)).sort());
      })
      .catch(() => setClinicianOptions([]));
  }, []);

  const client = useMemo(() => clients.find((c) => c.id === clientId), [clients, clientId]);
  const first = client ? firstName(client.name) : '';

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  const unreadSmsApprox = messages.filter((m) => m.direction === 'inbound').length;
  const unreadSecure = threads.reduce((n, t) => n + (t.unreadCount || 0), 0);
  const waitingCount = threads.filter((t) => t.status === 'waiting').length;

  const loadThread = useCallback(async () => {
    if (!clientId) return;
    try {
      const [threadRes, callsRes] = await Promise.all([
        apiJson<{ messages: ConnectMessage[] }>(`/api/connect/thread/${clientId}`),
        apiJson<{ calls: ConnectCall[] }>(`/api/connect/calls/${clientId}`),
      ]);
      setMessages(threadRes.messages ?? []);
      setCalls(callsRes.calls ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load communications');
    }
  }, [clientId]);

  useEffect(() => {
    if (tab === 'sms-calls' && clientId) void loadThread();
  }, [tab, clientId, loadThread]);

  useEffect(() => {
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, []);

  async function sendSms() {
    if (!clientId || !smsBody.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiJson<{ demoMode?: boolean }>('/api/connect/sms', {
        method: 'POST',
        body: JSON.stringify({ clientId, body: smsBody.trim(), toPhone: client?.phone }),
      });
      setSmsBody('');
      setNotice(res.demoMode ? 'SMS queued (demo mode)' : 'SMS sent');
      toast.success(res.demoMode ? 'SMS queued (demo mode)' : 'SMS sent via Amazon Connect');
      await loadThread();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SMS failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function executeCall(cPhone?: string) {
    if (!clientId || !client?.phone) return;
    setCallPhase('connecting');
    setError(null);
    setNotice(null);
    setActiveContactId(null);

    if (callDevice === 'laptop') {
      await startLaptopAudio();
    }

    try {
      const res = await apiJson<{
        success?: boolean;
        demoMode?: boolean;
        contactId?: string | null;
        status?: string;
        quotaNotice?: string | null;
        call?: { id?: string; contactId?: string | null; status?: string };
      }>('/api/connect/call', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          clientPhone: client.phone,
          clinicianPhone: callDevice === 'laptop' ? '+18447727110' : cPhone,
          callDevice,
        }),
      });
      const demo = Boolean(res.demoMode);
      const cid = res.contactId || res.call?.contactId || null;
      setCallDemoMode(demo);
      setActiveContactId(cid);
      const noticeText = res.quotaNotice
        ? `Demo mode: AWS outbound quota is 0 on this AWS account · simulated call ${cid || ''}`
        : demo
        ? `Demo mode — simulated Connect call · ${cid || 'demo'}`
        : `Amazon Connect dialing… contact ${cid || 'started'}`;
      setNotice(noticeText);
      if (res.quotaNotice) {
        toast(
          callDevice === 'laptop'
            ? 'Laptop Mic active (simulated until AWS quota is increased)'
            : 'AWS outbound quota is 0 — running in Demo Mode'
        );
      } else {
        toast.success(
          callDevice === 'laptop'
            ? `Laptop Mic active · dialing ${client.phone}`
            : `Connect dialing ${client.phone}`
        );
      }
      setCallPhase('active');
      setCallSeconds(0);
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      callTimerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
      await loadThread();
    } catch (err) {
      stopLaptopAudio();
      setCallPhase('idle');
      setCallDemoMode(false);
      setActiveContactId(null);
      const msg = err instanceof Error ? err.message : 'Amazon Connect call could not start';
      setError(msg);
      toast.error(msg);
    }
  }

  async function saveDoctorPhone(andCall = false) {
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
      toast.success('Doctor phone saved');
      if (andCall && clientId && client?.phone) {
        void executeCall(formatted);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save doctor phone');
    }
  }

  async function startCall() {
    if (callPhase !== 'idle') return;
    if (!clientId || !client) {
      toast.error('Please select a client from the left list');
      return;
    }
    if (!client.phone) {
      setClientPhoneInput('');
      setEditingClientPhone(true);
      toast('Please enter the client phone number');
      return;
    }

    if (callDevice === 'phone') {
      if (!clinicianPhone || !isUsE164(clinicianPhone)) {
        setDoctorPhoneModalOpen(true);
        toast('Please add your doctor phone number before placing a mobile call');
        return;
      }
      await executeCall(clinicianPhone);
    } else {
      // Laptop mode: doctor uses laptop mic & speaker
      await executeCall();
    }
  }

  async function saveClientPhone() {
    const formatted = normalizePhone(clientPhoneInput);
    if (!formatted || !isUsE164(formatted)) {
      toast.error('Client phone must be US E.164 (+1XXXXXXXXXX)');
      return;
    }
    try {
      await apiJson('/api/connect/call', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          clientPhone: formatted,
          updateClientPhone: true,
        }),
      }).catch(() => undefined);
      if (client) {
        client.phone = formatted;
      }
      setEditingClientPhone(false);
      toast.success('Client phone updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save client phone');
    }
  }

  async function endCall() {
    stopLaptopAudio();
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = null;
    const duration = callSeconds;
    const contactId = activeContactId;
    setCallPhase('idle');
    setCallSeconds(0);
    setActiveContactId(null);
    setCallDemoMode(false);
    setSmsSub('calls');

    if (contactId) {
      const newRow: ConnectCall = {
        id: `call-${Date.now()}`,
        clientPhone: client?.phone || '',
        clinicianPhone,
        clinicianName: clinicianName || 'Clinician',
        contactId,
        status: 'COMPLETED',
        demoMode: callDemoMode,
        durationSec: duration,
        createdAt: new Date().toISOString(),
      };
      setCalls((prev) => [newRow, ...prev]);

      try {
        await apiJson('/api/connect/call', {
          method: 'PATCH',
          body: JSON.stringify({
            contactId,
            durationSec: duration,
            status: 'COMPLETED',
          }),
        });
      } catch {
        /* best-effort */
      }
    }

    void loadThread();
  }

  function selectClient(id: string) {
    if (id === clientId) return;
    if (callPhase !== 'idle') {
      const ok = window.confirm('End the active call before switching clients?');
      if (!ok) return;
      void endCall();
    }
    setClientId(id);
  }

  async function loadLens(contactId: string) {
    setLensBusy(true);
    setLensOpenFor(contactId);
    setLens(null);
    try {
      const res = await apiJson<{
        analysis?: ContactLensAnalysis | null;
        demoMode?: boolean;
      }>(`/api/connect/analysis/${encodeURIComponent(contactId)}`);
      setLens(res.analysis || null);
      setLensDemo(Boolean(res.demoMode || res.analysis?.demoMode));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Contact Lens unavailable');
      setLens(null);
    } finally {
      setLensBusy(false);
    }
  }

  const filteredThreads = useMemo(() => {
    const q = secureSearch.trim().toLowerCase();
    return threads.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.clientName.toLowerCase().includes(q) ||
        t.lastMessage.toLowerCase().includes(q) ||
        t.topic.includes(q)
      );
    });
  }, [threads, statusFilter, secureSearch]);

  const selectedThread = threads.find((t) => t.id === selectedId) || null;

  async function sendSecure() {
    if (!selectedId || !compose.trim()) return;
    await send(compose.trim());
    setCompose('');
  }

  async function resolveThread() {
    if (!selectedId) return;
    setActionBusy(true);
    try {
      await updateThread(selectedId, { status: 'resolved' });
      await loadThreads();
    } finally {
      setActionBusy(false);
    }
  }

  async function handleForward() {
    if (!selectedId || !forwardTo.trim()) return;
    setActionBusy(true);
    try {
      await updateThread(selectedId, {
        forwardedTo: forwardTo.trim(),
        forwardNote:
          forwardNote.trim() ||
          `Forwarded to ${forwardTo.trim()} — clinical / Rx follow-up requested.`,
        status: 'forwarded',
      });
      setForwardOpen(false);
      setForwardNote('');
      await loadThreads();
    } finally {
      setActionBusy(false);
    }
  }

  const callClock = `${String(Math.floor(callSeconds / 60)).padStart(2, '0')}:${String(
    callSeconds % 60
  ).padStart(2, '0')}`;

  const crisisUnrouted = voicemails.filter((v) => v.intent === 'crisis' && !v.isRouted).length;
  const filteredVoicemails = voicemails.filter((v) => (vmFilter === 'all' ? true : v.intent === vmFilter));
  const filteredExternal = OPERATIONAL_EXTERNAL_DIRECTORY.filter((item) => {
    const q = opExternalSearch.toLowerCase();
    return (
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.desc.toLowerCase().includes(q)
    );
  });

  return (
    <Page width="full">
      <PageHeader
        title="Communications"
        badges={
          crisisUnrouted > 0 ? (
            <StatusBadge tone="danger" dot>
              {crisisUnrouted} crisis voicemail{crisisUnrouted === 1 ? '' : 's'}
            </StatusBadge>
          ) : null
        }
        description={
          tab === 'sms-calls'
            ? 'Amazon Connect · Pinpoint SMS · Contact Lens AI'
            : tab === 'secure'
            ? 'Encrypted in-platform · Front office portal · PHI permitted'
            : tab === 'dial-directory'
            ? 'Internal Queues · External Vendors & Payers · Operational Isolation (no patient data)'
            : 'Amazon Connect + Transcribe · Bedrock Intent Triage · Priority Crisis Escalation'
        }
      >
        <Tabs<TopTab>
          label="Communication channels"
          controlsPanels={false}
          value={tab}
          onChange={(key) => {
            setTab(key);
            if (key === 'dial-directory') void loadOpCalls();
            if (key === 'voicemail-ai') void loadVoicemails();
          }}
          items={[
            {
              key: 'sms-calls',
              label: 'SMS & Calls',
              icon: <Phone />,
              count: unreadSmsApprox > 0 ? unreadSmsApprox : undefined,
            },
            {
              key: 'secure',
              label: 'Secure Messages',
              icon: <MessageSquare />,
              count: unreadSecure > 0 ? unreadSecure : undefined,
            },
            { key: 'dial-directory', label: 'Dial & Directory', icon: <PhoneCall /> },
            {
              key: 'voicemail-ai',
              label: 'Voicemail AI',
              icon: <Mic />,
              count: crisisUnrouted > 0 ? crisisUnrouted : undefined,
              countTone: 'attention',
              hint: crisisUnrouted > 0 ? `${crisisUnrouted} unrouted crisis voicemail(s)` : undefined,
            },
          ]}
        />
      </PageHeader>

      {error || clientsError || messagesError ? (
        <Alert tone="danger">{error || clientsError || messagesError}</Alert>
      ) : notice ? (
        <Alert tone="info">{notice}</Alert>
      ) : null}

      {tab === 'sms-calls' ? (
        <Card className="flex h-[calc(100dvh-280px)] min-h-[560px] overflow-hidden">
          {/* Left client list */}
          <aside
            className={`w-full md:w-60 shrink-0 flex-col border-r border-slate-200 ${
              clientId ? 'hidden md:flex' : 'flex'
            }`}
          >
            <div className="border-b border-slate-200 p-3">
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search clients…"
                  aria-label="Search clients"
                  className={cx(inputClasses, 'pl-8')}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {clientsLoading ? (
                <LoadingState label="Loading clients…" rows={4} />
              ) : filteredClients.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Users />}
                  title="No clients"
                  description="Clients matching your search appear here. Try a different name or phone number."
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredClients.map((c) => {
                    const selected = c.id === clientId;
                    const crisis = Boolean(
                      (c as { crisisFlag?: boolean; highRisk?: boolean }).crisisFlag ||
                        (c as { highRisk?: boolean }).highRisk
                    );
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            selectClient(c.id);
                            setLensOpenFor(null);
                            setSmsSub('sms');
                          }}
                          aria-current={selected ? 'true' : undefined}
                          className={cx(
                            'relative flex w-full items-center gap-2 border-l-2 px-3 py-3 text-left text-sm transition',
                            FOCUS_RING,
                            selected ? 'border-l-blue-600 bg-blue-50' : 'border-l-transparent hover:bg-slate-50'
                          )}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                            {c.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-slate-900">{c.name}</span>
                            <span className="block truncate text-xs text-slate-500">
                              {c.phone ? 'SMS & Calls' : 'No phone on file'}
                            </span>
                          </span>
                          {crisis ? (
                            <span className="ml-auto inline-flex shrink-0 items-center">
                              <span aria-hidden className="h-2 w-2 rounded-full bg-rose-500" />
                              <span className="sr-only">Crisis flag</span>
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Center pane */}
          <div className={`min-w-0 flex-1 flex-col ${!clientId ? 'hidden md:flex' : 'flex'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {clientId ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ArrowLeft />}
                    onClick={() => setClientId('')}
                    className="md:hidden"
                    title="Back to clients"
                  >
                    Clients
                  </Button>
                ) : null}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-blue-200">
                  {(client?.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {client?.name || 'Select a client'}
                    </p>
                    {client &&
                    ((client as { crisisFlag?: boolean }).crisisFlag ||
                      (client as { highRisk?: boolean }).highRisk) ? (
                      <StatusBadge tone="danger" size="sm" icon={<AlertTriangle />}>
                        Crisis Flag
                      </StatusBadge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {editingClientPhone ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <div className="w-40">
                          <input
                            value={clientPhoneInput}
                            onChange={(e) => setClientPhoneInput(e.target.value)}
                            placeholder="+1XXXXXXXXXX"
                            aria-label="Client phone number"
                            className={inputClasses}
                          />
                        </div>
                        <Button size="sm" onClick={() => void saveClientPhone()}>
                          Save
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingClientPhone(false)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className={client?.phone ? 'font-medium text-slate-900' : 'italic text-slate-500'}>
                          {client?.phone || (client ? 'No phone on file' : 'Select a client to start')}
                        </span>
                        {client ? (
                          <button
                            type="button"
                            onClick={() => {
                              setClientPhoneInput(client.phone || '');
                              setEditingClientPhone(true);
                            }}
                            className={cx(
                              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50',
                              FOCUS_RING
                            )}
                            title="Edit client phone number"
                          >
                            <Edit2 aria-hidden className="h-3 w-3" /> {client.phone ? 'Edit' : 'Set phone'}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {callPhase === 'idle' ? (
                  <Tabs<'laptop' | 'phone'>
                    variant="pill"
                    label="Call device"
                    controlsPanels={false}
                    value={callDevice}
                    onChange={(key) => setCallDevice(key)}
                    items={[
                      {
                        key: 'laptop',
                        label: 'Laptop Mic',
                        icon: <Laptop />,
                        hint: 'Speak directly through your Laptop Microphone & Speakers',
                      },
                      {
                        key: 'phone',
                        label: 'Mobile',
                        icon: <Phone />,
                        hint: 'Amazon Connect dials and bridges your mobile phone',
                      },
                    ]}
                  />
                ) : null}

                {callDevice === 'phone' && callPhase === 'idle' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Phone />}
                    onClick={() => setDoctorPhoneModalOpen(true)}
                    className="hidden sm:inline-flex"
                    title="Configure doctor mobile phone number for call bridging"
                  >
                    Doctor: {clinicianPhone ? clinicianPhone : 'Set phone'}
                  </Button>
                ) : null}

                {callDevice === 'laptop' && callPhase === 'idle' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Volume2 />}
                    onClick={openCcpPopup}
                    className="hidden sm:inline-flex"
                    title="Open Amazon Connect Softphone popup (WebRTC)"
                  >
                    Connect Softphone CCP
                  </Button>
                ) : null}

                <IconButton
                  label="Refresh"
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClick={() => void loadThread()}
                  className="h-10 w-10 md:h-8 md:w-8 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                />

                {callPhase === 'idle' ? (
                  <Button
                    size="sm"
                    icon={callDevice === 'laptop' ? <Laptop /> : <Phone />}
                    onClick={() => void startCall()}
                    title={
                      callDevice === 'laptop'
                        ? 'Call patient using Laptop Microphone'
                        : 'Bridge call to Doctor Mobile'
                    }
                  >
                    Call {first || 'Client'}
                  </Button>
                ) : callPhase === 'connecting' ? (
                  <StatusBadge tone="warning" dot>
                    Connecting…
                  </StatusBadge>
                ) : (
                  <div className="flex items-center gap-2">
                    {callDevice === 'laptop' ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                        <IconButton
                          label={isMuted ? 'Unmute Laptop Microphone' : 'Mute Laptop Microphone'}
                          icon={isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                          onClick={toggleMute}
                          aria-pressed={isMuted}
                          className={cx(
                            'h-7 w-7',
                            isMuted ? 'bg-rose-700 text-white hover:bg-rose-800' : 'bg-blue-600 text-white hover:bg-blue-700'
                          )}
                        />
                        <span className="text-xs font-medium text-slate-700">
                          {isMuted ? 'Muted' : 'Laptop Mic'}
                        </span>
                        <div aria-hidden className="ml-1 flex h-3.5 items-end gap-0.5">
                          <span
                            className="w-1 rounded-full bg-blue-400 transition-all"
                            style={{ height: `${Math.max(3, Math.min(14, micAudioLevel * 0.14))}px` }}
                          />
                          <span
                            className="w-1 rounded-full bg-blue-600 transition-all"
                            style={{ height: `${Math.max(4, Math.min(14, micAudioLevel * 0.18))}px` }}
                          />
                          <span
                            className="w-1 rounded-full bg-blue-400 transition-all"
                            style={{ height: `${Math.max(2, Math.min(14, micAudioLevel * 0.12))}px` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    <span className="rounded-lg bg-emerald-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-emerald-800 ring-1 ring-emerald-200">
                      {callClock}
                    </span>
                    <Button variant="danger" size="sm" icon={<PhoneOff />} onClick={() => void endCall()}>
                      End
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {(callDemoMode || connectLive === false) && callPhase !== 'idle' ? (
              <Alert tone="warning" className="mx-4 mt-3">
                AWS Outbound Telephony Quota is 0 on this AWS account. Simulated contact{' '}
                {activeContactId || 'pending'} (request quota increase in AWS Console to dial physical phones).
              </Alert>
            ) : connectLive && sourceLast4 && callPhase !== 'idle' ? (
              <Alert tone="info" className="mx-4 mt-3">
                Outbound via Amazon Connect · Source ending {sourceLast4}
                {activeContactId ? ` · ${activeContactId}` : ''}
              </Alert>
            ) : null}

            <Tabs<SmsSubTab>
              label="SMS and call history"
              controlsPanels={false}
              value={smsSub}
              onChange={(key) => setSmsSub(key)}
              className="px-4"
              items={[
                { key: 'sms', label: 'SMS Thread' },
                { key: 'calls', label: 'Call History' },
              ]}
            />

            {smsSub === 'sms' ? (
              <>
                <Alert tone="warning" className="mx-4 mt-3">
                  Do not include PHI, diagnosis, or medication details in SMS. Use Secure Messages for
                  clinical communication.
                </Alert>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  {messages.length === 0 ? (
                    <EmptyState
                      compact
                      icon={<MessageSquare />}
                      title="No SMS messages yet"
                      description="Texts you send to this client and their replies appear here. Write one below to start."
                    />
                  ) : (
                    messages.map((m) => {
                      const outbound = m.direction === 'outbound' || m.direction === 'OUTBOUND';
                      return (
                        <div
                          key={m.id}
                          className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                              outbound
                                ? 'bg-blue-600 text-white'
                                : 'border border-slate-200 bg-white text-slate-800'
                            }`}
                          >
                            {m.body}
                            <div
                              className={`mt-1 text-[11px] ${
                                outbound ? 'text-blue-100' : 'text-slate-500'
                              }`}
                            >
                              {new Date(m.createdAt).toLocaleString()}
                              {m.demoMode ? ' · demo' : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-slate-200 p-3">
                  <div className="flex gap-2">
                    <textarea
                      value={smsBody}
                      onChange={(e) => setSmsBody(e.target.value.slice(0, 1600))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void sendSms();
                        }
                      }}
                      rows={2}
                      placeholder={`Message ${first || 'client'}…`}
                      aria-label="SMS message"
                      className={cx(inputClasses, 'min-w-0 flex-1 resize-none')}
                    />
                    <IconButton
                      label="Send SMS"
                      icon={<Send className="h-4 w-4" />}
                      disabled={busy || !smsBody.trim()}
                      onClick={() => void sendSms()}
                      className="h-10 w-10 self-end bg-blue-600 text-white hover:bg-blue-700"
                    />
                  </div>
                  <p className="mt-1 text-right text-[11px] text-slate-500">
                    {smsBody.length}/1600
                  </p>
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {calls.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Phone />}
                    title="No call history"
                    description="Calls you place to this client appear here with their Contact Lens analysis."
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {calls.map((call) => {
                      const contactKey = call.contactId || call.id;
                      const analysis =
                        lensOpenFor === contactKey
                          ? lens
                          : call.analysis || call.analysisJson || null;
                      const open = lensOpenFor === contactKey;
                      return (
                        <li key={call.id} className="p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Phone aria-hidden className="h-4 w-4 text-slate-400" />
                            <span className="text-xs font-medium text-slate-600">
                              Outbound · {call.status || 'INITIATED'}
                            </span>
                            <SentimentBadge sentiment={analysis?.sentiment || call.status} />
                            {call.demoMode ? (
                              <span className="text-[11px] font-semibold text-amber-700">
                                demoMode
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            <span className="font-semibold text-slate-800">
                              {new Date(call.createdAt).toLocaleString()}
                            </span>
                            <span aria-hidden className="text-slate-500">·</span>
                            <span className="text-slate-600">
                              {call.clinicianName || clinicianName || 'Clinician'}
                            </span>
                            <span aria-hidden className="text-slate-500">·</span>
                            <span className="font-mono text-slate-500">
                              {formatDuration(call.durationSec)}
                            </span>
                            {call.contactId ? (
                              <span className="font-mono text-[11px] text-slate-500">
                                ({call.contactId.slice(0, 16)}…)
                              </span>
                            ) : null}
                            {call.recordingUrl ? (
                              <a
                                href={call.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={cx('ml-auto rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                              >
                                Recording
                              </a>
                            ) : (
                              <span
                                className="ml-auto cursor-not-allowed text-xs text-slate-500"
                                title="Recording URL not available for this contact"
                              >
                                Recording
                              </span>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={<Sparkles />}
                              disabled={lensBusy && open}
                              aria-expanded={open}
                              onClick={() => {
                                if (open) {
                                  setLensOpenFor(null);
                                  return;
                                }
                                void loadLens(contactKey);
                              }}
                            >
                              AI Analysis
                            </Button>
                          </div>
                          {open ? (
                            <div className="mt-3 rounded-lg bg-slate-50 p-3">
                              <p className="text-xs font-semibold text-slate-900">
                                Contact Lens AI Analysis
                              </p>
                              {lensBusy ? (
                                <LoadingState label="Analyzing…" className="py-4" />
                              ) : (
                                <>
                                  <div className="mt-2">
                                    <p className="text-xs font-medium text-slate-500">
                                      Sentiment
                                    </p>
                                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                                      <div
                                        className={cx(
                                          'h-full w-2/3 rounded-full',
                                          sentimentBarColor(analysis?.sentiment)
                                        )}
                                      />
                                    </div>
                                    <p className="mt-1 text-xs font-semibold text-slate-700">
                                      {analysis?.sentiment || 'Neutral'}
                                      {lensDemo ? ' · demoMode' : ''}
                                    </p>
                                  </div>
                                  {analysis?.crisisKeywords &&
                                  analysis.crisisKeywords.length > 0 ? (
                                    <div className="mt-2">
                                      <p className="text-xs font-semibold text-rose-700">
                                        Crisis Keywords
                                      </p>
                                      <p className="text-xs text-rose-700">
                                        {analysis.crisisKeywords.join(', ')}
                                      </p>
                                    </div>
                                  ) : null}
                                  {analysis?.summary ? (
                                    <div className="mt-2">
                                      <p className="text-xs font-medium text-slate-500">
                                        AI Summary
                                      </p>
                                      <p className="text-xs text-slate-700">{analysis.summary}</p>
                                    </div>
                                  ) : null}
                                  {analysis?.keyPhrases && analysis.keyPhrases.length > 0 ? (
                                    <div className="mt-2">
                                      <p className="text-xs font-medium text-slate-500">
                                        Key Phrases
                                      </p>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {analysis.keyPhrases.map((p) => (
                                          <StatusBadge key={p} tone="brand" size="sm">
                                            {p}
                                          </StatusBadge>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Card>
      ) : tab === 'secure' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Front Office Portal</h2>
              <p className="text-xs text-slate-500">
                {unreadSecure} unread · {waitingCount} waiting
              </p>
            </div>
            <Tabs<'all' | ThreadStatus>
              variant="pill"
              label="Filter threads by status"
              controlsPanels={false}
              value={statusFilter}
              onChange={(key) => setStatusFilter(key)}
              items={[
                { key: 'all', label: 'All' },
                { key: 'waiting', label: 'Waiting' },
                { key: 'in-progress', label: 'In progress' },
                { key: 'forwarded', label: 'Forwarded' },
                { key: 'resolved', label: 'Resolved' },
              ]}
            />
          </div>

          <Card className="flex h-[calc(100dvh-340px)] min-h-[520px] overflow-hidden">
            <aside className={cx('w-full shrink-0 flex-col border-r border-slate-200 md:flex md:w-72', secureShowList ? 'flex' : 'hidden')}>
              <div className="border-b border-slate-200 p-3">
                <div className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={secureSearch}
                    onChange={(e) => setSecureSearch(e.target.value)}
                    placeholder="Search patients…"
                    aria-label="Search patients"
                    className={cx(inputClasses, 'pl-8')}
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {threadsLoading ? (
                  <LoadingState label="Loading threads…" rows={4} />
                ) : filteredThreads.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<MessageSquare />}
                    title="No conversations match."
                    description="Patient threads appear here. Change the status filter or search to see more."
                  />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filteredThreads.map((t) => {
                      const active = t.id === selectedId;
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSecureShowList(false);
                              void openThread(t.id);
                            }}
                            aria-current={active ? 'true' : undefined}
                            className={cx(
                              'w-full border-l-2 px-3 py-3 text-left transition',
                              FOCUS_RING,
                              active ? 'border-l-blue-600 bg-blue-50' : 'border-l-transparent hover:bg-slate-50'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {t.clientName}
                              </p>
                              {t.unreadCount > 0 ? (
                                <span className="rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold tabular-nums text-white">
                                  {t.unreadCount}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{t.lastMessage}</p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <StatusBadge tone={TOPIC_TONE[t.topic]} size="sm" className="capitalize">
                                {t.topic}
                              </StatusBadge>
                              <StatusBadge tone={STATUS_META[t.status].tone} size="sm">
                                {STATUS_META[t.status].label}
                              </StatusBadge>
                              {t.risk === 'high' ? (
                                <StatusBadge tone="danger" size="sm" icon={<AlertTriangle />}>
                                  High risk
                                </StatusBadge>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>

            <div className={cx('min-w-0 flex-1 flex-col md:flex', secureShowList ? 'hidden' : 'flex')}>
              {selectedThread ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ArrowLeft />}
                      onClick={() => setSecureShowList(true)}
                      className="md:hidden"
                      title="Back to conversations"
                    >
                      Conversations
                    </Button>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{selectedThread.clientName}</p>
                      <p className="text-xs capitalize text-slate-500">
                        {selectedThread.topic} · {STATUS_META[selectedThread.status].label}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedThread.risk === 'high' ? (
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<AlertTriangle />}
                          onClick={() => setForwardOpen(true)}
                        >
                          Forward Now
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<ArrowRight />}
                          onClick={() => setForwardOpen(true)}
                        >
                          Forward
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<CheckCircle2 />}
                        disabled={actionBusy || selectedThread.status === 'resolved'}
                        onClick={() => void resolveThread()}
                      >
                        Resolve
                      </Button>
                    </div>
                  </div>

                  {selectedThread.risk === 'high' ? (
                    <Alert tone="danger" className="mx-4 mt-3">
                      <strong>High-risk message</strong> — escalate to the care team promptly. Use
                      Forward Now if clinical follow-up is needed.
                    </Alert>
                  ) : null}
                  <div className="mx-4 mt-3 empty:hidden"><RiskWatchBanner kind="message" threadId={selectedThread.id} /></div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                    {secureMessages.map((m) => {
                      const type =
                        m.senderType ||
                        (m.senderId === 'staff'
                          ? 'front-office'
                          : m.senderId === 'clinician-note'
                            ? 'clinician-note'
                            : 'patient');
                      if (type === 'clinician-note') {
                        return (
                          <div key={m.id} className="flex justify-center">
                            <div className="max-w-[85%] rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-900 ring-1 ring-amber-200">
                              <span className="font-semibold">Clinician note</span> — {m.content}
                            </div>
                          </div>
                        );
                      }
                      const fo = type === 'front-office';
                      return (
                        <div key={m.id} className={`flex ${fo ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                              fo ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-800'
                            }`}
                          >
                            {m.content}
                            <div
                              className={`mt-1 text-[11px] ${fo ? 'text-blue-100' : 'text-slate-500'}`}
                            >
                              {m.senderName} · {m.timestamp}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-slate-200 p-3">
                    <div className="flex gap-2">
                      <textarea
                        value={compose}
                        onChange={(e) => setCompose(e.target.value)}
                        rows={2}
                        placeholder={`Reply to ${selectedThread.clientName} as front office…`}
                        aria-label="Secure message reply"
                        className={cx(inputClasses, 'min-w-0 flex-1 resize-none')}
                      />
                      <IconButton
                        label="Send secure message"
                        icon={<Send className="h-4 w-4" />}
                        disabled={sending || !compose.trim()}
                        onClick={() => void sendSecure()}
                        className="h-10 w-10 self-end bg-blue-600 text-white hover:bg-blue-700"
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Encrypted in-platform messaging — PHI is permitted here. Forward clinical
                      questions to the care team.
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    icon={<MessageSquare />}
                    title="Select a thread to view Secure Messages"
                    description="Choose a patient conversation on the left to read and reply."
                  />
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : tab === 'dial-directory' ? (
        <div className="grid grid-cols-1 gap-4 lg:h-[calc(100dvh-280px)] lg:min-h-[560px] lg:grid-cols-12">
          {/* Column 1: Team Queues & Staff Directory (lg:col-span-4) */}
          <Card className="flex min-h-0 flex-col overflow-hidden lg:col-span-4">
            <CardHeader
              icon={<Users />}
              title="Team Queues & Staff"
              description="Internal extensions · Quick Connect queues"
              actions={<StatusBadge tone="info" size="sm">Internal DID</StatusBadge>}
            />

            <div className="max-h-[480px] flex-1 space-y-4 overflow-y-auto p-3 lg:max-h-none">
              {/* Queues Section */}
              <div>
                <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Priority &amp; Site Queues
                </p>
                <div className="space-y-1.5">
                  {OPERATIONAL_QUEUES.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-slate-900">{q.name}</span>
                          <StatusBadge tone={q.tone} size="sm">
                            {q.badge}
                          </StatusBadge>
                        </div>
                        <p className="text-xs text-slate-500">{q.phone}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<PhoneCall />}
                        onClick={() => void handleStartStaffCall(q.name, q.phone, 'queue')}
                      >
                        Call Queue
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Staff Extensions Section */}
              <div className="border-t border-slate-100 pt-3">
                <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Clinicians &amp; Operations Staff
                </p>
                <div className="space-y-1.5">
                  {OPERATIONAL_STAFF.length === 0 && (
                    <p className="px-1 py-3 text-xs text-slate-500">No staff extensions configured yet.</p>
                  )}
                  {OPERATIONAL_STAFF.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                          {s.avatar}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                          <p className="text-xs text-slate-500">
                            {s.role} · <span className="font-semibold text-slate-700">{s.site}</span> ({s.ext})
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<PhoneCall />}
                        onClick={() => void handleStartStaffCall(s.name, s.phone, 'agent')}
                      >
                        Call Agent
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Column 2: External Directory (lg:col-span-4) */}
          <Card className="flex min-h-0 flex-col overflow-hidden lg:col-span-4">
            <CardHeader
              icon={<Building2 />}
              title="External Directory"
              description="Payers · Pharmacies · Labs · Legal · Vendors"
              actions={<StatusBadge tone="neutral" size="sm">Non-Client</StatusBadge>}
            />
            <div className="border-b border-slate-200 p-3">
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Filter external contacts…"
                  aria-label="Filter external contacts"
                  value={opExternalSearch}
                  onChange={(e) => setOpExternalSearch(e.target.value)}
                  className={cx(inputClasses, 'pl-8')}
                />
              </div>
            </div>

            <div className="max-h-[480px] flex-1 overflow-y-auto lg:max-h-none">
              {filteredExternal.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Building2 />}
                  title="No contacts match"
                  description="Payers, pharmacies, labs, courts and vendors appear here. Clear the filter to see them all."
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredExternal.map((item) => (
                    <li key={item.name} className="flex items-start justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge tone="neutral" size="sm">
                            {item.category}
                          </StatusBadge>
                          <h3 className="text-sm font-medium text-slate-900">{item.name}</h3>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{item.desc}</p>
                        <p className="mt-1 font-mono text-xs font-semibold text-slate-700">{item.phone}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<PhoneCall />}
                        onClick={() => void handleStartExternalCall(item.phone, item.name, item.desc)}
                      >
                        Dial
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Column 3: Soft Dial Pad & Active Call & Operational History (lg:col-span-4) */}
          <Card className="flex min-h-0 flex-col overflow-hidden lg:col-span-4">
            {/* Outbound Caller ID Header */}
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Outbound Caller ID
                </span>
                <StatusBadge tone="success" size="sm" icon={<ShieldCheck />}>
                  Verified Clinic DID
                </StatusBadge>
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                MD Behavioral Health · +1 (240) 855-4300
              </p>
              <p className="text-xs text-slate-500">
                Operational Isolation · PHI Restricted (no patient data)
              </p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Active Call Banner */}
              {opCallPhase !== 'idle' ? (
                <Alert
                  tone={opCallPhase === 'connecting' ? 'warning' : 'success'}
                  icon={<PhoneCall />}
                  title={
                    <span className="flex items-center justify-between gap-2">
                      <span>{opCallPhase === 'connecting' ? 'Connecting Call…' : 'On Call (Live)'}</span>
                      <span className="font-mono tabular-nums">
                        {String(Math.floor(opCallSeconds / 60)).padStart(2, '0')}:
                        {String(opCallSeconds % 60).padStart(2, '0')}
                      </span>
                    </span>
                  }
                >
                  <p className="mt-1 font-semibold">{activeOpTarget?.name}</p>
                  <p className="text-xs">{activeOpTarget?.phone}</p>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<PhoneOff />}
                    onClick={handleEndOpCall}
                    className="mt-3 w-full"
                  >
                    End Call
                  </Button>
                </Alert>
              ) : null}

              {/* Dial Pad Container */}
              <div className="rounded-lg bg-slate-50 p-3">
                {/* Digit Display */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter phone number…"
                    aria-label="Phone number"
                    value={dialPadNumber}
                    onChange={(e) => setDialPadNumber(e.target.value)}
                    className={cx(inputClasses, 'font-mono text-base font-semibold tracking-wider')}
                  />
                  {dialPadNumber ? (
                    <IconButton
                      label="Backspace"
                      icon={<Delete className="h-4 w-4" />}
                      onClick={handleSoftpadBackspace}
                      className="h-9 w-9 shrink-0 text-slate-600 hover:bg-slate-200"
                    />
                  ) : null}
                </div>

                {/* Optional Callee Name */}
                <input
                  type="text"
                  placeholder="Callee or organization name (optional)"
                  aria-label="Callee or organization name (optional)"
                  value={dialPadName}
                  onChange={(e) => setDialPadName(e.target.value)}
                  className={cx(inputClasses, 'mt-2')}
                />

                {/* 12-key pad: a phone keypad is three columns at every width */}
                <div className="mt-3 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
                  {[
                    { key: '1', sub: '' },
                    { key: '2', sub: 'ABC' },
                    { key: '3', sub: 'DEF' },
                    { key: '4', sub: 'GHI' },
                    { key: '5', sub: 'JKL' },
                    { key: '6', sub: 'MNO' },
                    { key: '7', sub: 'PQRS' },
                    { key: '8', sub: 'TUV' },
                    { key: '9', sub: 'WXYZ' },
                    { key: '*', sub: '' },
                    { key: '0', sub: '+' },
                    { key: '#', sub: '' },
                  ].map((btn) => (
                    <button
                      key={btn.key}
                      type="button"
                      onClick={() => handleSoftpadDialPress(btn.key)}
                      aria-label={btn.sub ? `${btn.key} ${btn.sub}` : btn.key}
                      className={cx(
                        'flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-2 shadow-xs transition hover:bg-slate-50 active:bg-slate-100',
                        FOCUS_RING
                      )}
                    >
                      <span aria-hidden className="text-base font-semibold leading-none text-slate-900">{btn.key}</span>
                      {btn.sub ? (
                        <span aria-hidden className="text-[11px] font-medium tracking-wider text-slate-500">
                          {btn.sub}
                        </span>
                      ) : (
                        <span aria-hidden className="h-[11px]" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Call Button */}
                <div className="mt-3 flex gap-2">
                  <Button
                    icon={<Phone />}
                    disabled={opCallPhase !== 'idle' || !dialPadNumber.trim()}
                    onClick={() =>
                      void handleStartExternalCall(
                        dialPadNumber,
                        dialPadName || 'Manual Outbound Call',
                        'Softpad Call'
                      )
                    }
                    className="flex-1"
                  >
                    Place Call
                  </Button>
                  {dialPadNumber ? (
                    <Button variant="secondary" onClick={handleSoftpadClear}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* Operational Call History Log */}
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <History aria-hidden className="h-4 w-4 text-slate-400" />
                    Operational Call Log
                  </h3>
                  <Button variant="ghost" size="sm" icon={<RefreshCw />} onClick={() => void loadOpCalls()}>
                    Refresh
                  </Button>
                </div>

                <div className="mt-1 max-h-48 overflow-y-auto">
                  {loadingOpCalls ? (
                    <LoadingState label="Loading call history…" className="py-4" />
                  ) : opCallsLog.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-500">
                      No operational calls recorded. Calls to queues, staff and external contacts appear here.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {opCallsLog.map((log) => (
                        <li key={log.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{log.calleeName}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {log.destinationPhone} · {log.callType}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <StatusBadge tone="success" size="sm">
                              No patient data
                            </StatusBadge>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {log.durationSeconds > 0 ? `${log.durationSeconds}s` : 'Initiated'}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        /* Voicemail AI Triage View (Commit ec2a982 / Pillar 5) */
        <Card className="flex flex-col overflow-hidden md:h-[calc(100dvh-280px)] md:min-h-[560px] md:flex-row">
          {/* Left Voicemail Inbox List */}
          <aside className="flex max-h-[420px] w-full shrink-0 flex-col border-b border-slate-200 md:max-h-none md:w-96 md:border-b-0 md:border-r">
            <div className="border-b border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Voicemail aria-hidden className="h-4 w-4 text-slate-400" />
                  Voicemail Queue
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw className={vmLoading ? 'animate-spin' : ''} />}
                  onClick={() => void loadVoicemails()}
                  disabled={vmLoading}
                >
                  Refresh
                </Button>
              </div>

              {/* Filter chips */}
              <Tabs<typeof vmFilter>
                variant="pill"
                label="Filter voicemails by intent"
                controlsPanels={false}
                value={vmFilter}
                onChange={(key) => setVmFilter(key)}
                className="w-full"
                items={(['all', 'crisis', 'reschedule', 'refill', 'billing', 'general'] as const).map((cat) => {
                  const count =
                    cat === 'all'
                      ? voicemails.length
                      : voicemails.filter((v) => v.intent === cat).length;
                  return {
                    key: cat,
                    label: cat.charAt(0).toUpperCase() + cat.slice(1),
                    count,
                    countTone: cat === 'crisis' && count > 0 ? ('attention' as const) : ('neutral' as const),
                  };
                })}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {vmLoading && voicemails.length === 0 ? (
                <LoadingState label="Loading voicemails…" rows={4} />
              ) : voicemails.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Voicemail />}
                  title="No voicemails found."
                  description="New voicemails appear here, transcribed and triaged by intent."
                />
              ) : filteredVoicemails.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Voicemail />}
                  title="No voicemails in this category"
                  description="Choose another intent filter, or All, to see the rest of the queue."
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredVoicemails.map((vm) => {
                    const isSelected = selectedVm?.id === vm.id;
                    const isCrisis = vm.intent === 'crisis';
                    return (
                      <li key={vm.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedVm(vm)}
                          aria-current={isSelected ? 'true' : undefined}
                          className={cx(
                            'w-full border-l-2 p-3 text-left transition',
                            FOCUS_RING,
                            isCrisis ? 'border-l-rose-500' : isSelected ? 'border-l-blue-600' : 'border-l-transparent',
                            isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                          )}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-sm font-semibold text-slate-900">
                                  {vm.callerName || 'Unknown Caller'}
                                </span>
                                {isCrisis && (
                                  <StatusBadge tone="danger" size="sm" icon={<AlertTriangle />}>
                                    Crisis
                                  </StatusBadge>
                                )}
                              </div>
                              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{vm.callerPhone}</p>
                            </div>
                            <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-500">
                              {Math.floor(vm.durationSeconds / 60)}:{(vm.durationSeconds % 60).toString().padStart(2, '0')}
                            </span>
                          </div>

                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600">
                            {vm.transcript}
                          </p>

                          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
                            <StatusBadge tone={VM_INTENT_TONE[vm.intent]} size="sm" className="capitalize">
                              {vm.intent} · {(vm.confidence * 100).toFixed(0)}%
                            </StatusBadge>
                            <span className="text-slate-500">
                              {new Date(vm.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Right Selected Voicemail Details Pane */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-5">
            {selectedVm ? (
              <div className="max-w-3xl space-y-5">
                {/* Crisis Warning Banner */}
                {selectedVm.intent === 'crisis' && (
                  <Alert
                    tone="danger"
                    icon={<ShieldAlert />}
                    title="High Priority Crisis Alert — Immediate Clinical Action Required"
                  >
                    <p className="leading-relaxed">
                      Classified as possible crisis language. This has NOT been escalated to anyone automatically — call the caller back and phone the on-call crisis clinician.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<AlertTriangle />}
                        disabled={vmPaging}
                        onClick={() => void handlePageCrisisStaff()}
                      >
                        {vmPaging ? 'Recording page…' : 'Page On-Call Crisis Staff Now'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<PhoneCall />}
                        onClick={() =>
                          void handleStartExternalCall(
                            selectedVm.callerPhone,
                            selectedVm.callerName || 'Caller',
                            'Crisis Callback'
                          )
                        }
                      >
                        Immediate Return Call
                      </Button>
                    </div>
                  </Alert>
                )}

                {/* Caller Information & Actions Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900">
                      {selectedVm.callerName || 'Unknown Caller'}
                    </h2>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{selectedVm.callerPhone}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Received {new Date(selectedVm.createdAt).toLocaleString()} · Duration{' '}
                      {Math.floor(selectedVm.durationSeconds / 60)}m {selectedVm.durationSeconds % 60}s
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<CheckCircle2 />}
                      disabled={selectedVm.isRouted || vmRouting}
                      onClick={() => void handleMarkVmRouted(selectedVm.id)}
                    >
                      {selectedVm.isRouted ? 'Routed' : vmRouting ? 'Saving…' : 'Mark Routed'}
                    </Button>
                    <Button
                      size="sm"
                      icon={<PhoneCall />}
                      onClick={() =>
                        void handleStartExternalCall(
                          selectedVm.callerPhone,
                          selectedVm.callerName || 'Caller',
                          'Voicemail Follow-up'
                        )
                      }
                    >
                      Dial Caller
                    </Button>
                  </div>
                </div>

                {/* Bedrock Intent Classification */}
                <section>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Sparkles aria-hidden className="h-4 w-4 text-blue-600" />
                      AWS Bedrock Intent Triage
                    </h3>
                    <StatusBadge tone="brand" size="sm">
                      {(selectedVm.confidence * 100).toFixed(1)}% Confidence
                    </StatusBadge>
                  </div>
                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="text-xs font-medium text-slate-500">Classified Intent</span>
                      <p className="mt-1 font-semibold capitalize text-slate-900">
                        {selectedVm.intent}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2">
                      <span className="text-xs font-medium text-slate-500">Routing Destination</span>
                      <p className="mt-1 font-semibold text-slate-900">{selectedVm.routeTo}</p>
                    </div>
                  </div>
                </section>

                {/* Audio Waveform Player */}
                <section className="rounded-lg bg-slate-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5 font-mono text-[11px]">
                      <Radio aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                      Amazon Connect Recording · S3 KMS Encrypted
                    </span>
                    <span className="tabular-nums">
                      0:00 / {Math.floor(selectedVm.durationSeconds / 60)}:
                      {(selectedVm.durationSeconds % 60).toString().padStart(2, '0')}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <IconButton
                      label={vmAudioPlaying ? 'Pause recording' : 'Play recording'}
                      icon={vmAudioPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                      onClick={() => setVmAudioPlaying((prev) => !prev)}
                      aria-pressed={vmAudioPlaying}
                      className="h-10 w-10 shrink-0 rounded-full bg-blue-600 text-white hover:bg-blue-700"
                    />

                    {/* Waveform Visualization Bars */}
                    <div aria-hidden className="flex h-10 flex-1 items-center gap-1 overflow-hidden">
                      {[
                        32, 60, 45, 80, 95, 40, 25, 70, 85, 90, 65, 45, 30, 80, 100, 50, 40, 75, 90, 60, 35,
                        70, 85, 40, 55, 90, 75, 50, 30, 60, 80, 45,
                      ].map((h, idx) => (
                        <div
                          key={idx}
                          className={`w-1 rounded-full transition-all duration-150 ${
                            vmAudioPlaying ? 'bg-blue-600' : 'bg-slate-300'
                          }`}
                          style={{
                            height: vmAudioPlaying
                              ? `${Math.min(100, Math.max(15, h * (0.6 + Math.random() * 0.8)))}%`
                              : `${h * 0.4}%`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                {/* Amazon Transcribe Transcript */}
                <section>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Volume2 aria-hidden className="h-4 w-4 text-slate-400" />
                      Amazon Transcribe Verbatim Output
                    </h3>
                    <span className="font-mono text-[11px] text-slate-500">EN-US · 16kHz</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-800">
                    &ldquo;{selectedVm.transcript}&rdquo;
                  </div>
                </section>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={<Voicemail />}
                  title="Select a voicemail to inspect details, audio, and Bedrock triage."
                  description="Pick a voicemail from the queue to hear it, read the transcript and route it."
                />
              </div>
            )}
          </main>
        </Card>
      )}

      {forwardOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="forward-dialog-title"
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-xl"
          >
            <h2 id="forward-dialog-title" className="text-base font-semibold text-slate-900">Forward to Clinician</h2>
            <p className="mt-1 text-sm text-slate-500">
              Route this thread for clinical / Rx follow-up
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Clinician
              <select
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                className={cx(inputClasses, 'mt-1')}
              >
                <option value="">Select clinician</option>
                {(clinicianOptions.length ? clinicianOptions : ['Clinical Team']).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Internal note
              <textarea
                value={forwardNote}
                onChange={(e) => setForwardNote(e.target.value)}
                rows={3}
                placeholder="Context for the clinician…"
                className={cx(inputClasses, 'mt-1')}
              />
            </label>
            <Alert tone="warning" className="mt-4">
              Internal notes are visible to care team only — do not paste patient-facing content
              here without review.
            </Alert>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForwardOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!forwardTo.trim() || actionBusy}
                onClick={() => void handleForward()}
              >
                Forward
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {doctorPhoneModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="doctor-phone-dialog-title"
            className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="doctor-phone-dialog-title" className="text-base font-semibold text-slate-900">Doctor Phone Number</h2>
              <IconButton
                label="Close"
                icon={<X className="h-4 w-4" />}
                onClick={() => {
                  setDoctorPhoneModalOpen(false);
                  toast('Add your phone in profile before placing an Amazon Connect call');
                }}
                className="h-10 w-10 shrink-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:h-8 md:w-8"
              />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Amazon Connect rings the patient and bridges your phone. Enter your phone number (US E.164, e.g. +14105551234):
            </p>
            <input
              type="tel"
              value={doctorPhoneInput}
              onChange={(e) => setDoctorPhoneInput(e.target.value)}
              placeholder="+1XXXXXXXXXX"
              aria-label="Doctor phone number"
              className={cx(inputClasses, 'mt-3')}
            />
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDoctorPhoneModalOpen(false);
                  toast('Add your phone in profile before placing an Amazon Connect call');
                }}
              >
                Cancel
              </Button>
              <Button
                variant={client?.phone ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => void saveDoctorPhone(false)}
              >
                Save Phone
              </Button>
              {client?.phone ? (
                <Button size="sm" onClick={() => void saveDoctorPhone(true)}>
                  Save &amp; Call
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
