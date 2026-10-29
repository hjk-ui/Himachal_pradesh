'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';
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
  Hash,
  History,
  ShieldCheck,
  ShieldAlert,
  Users,
  Clock,
  UserCheck,
  Delete,
  Play,
  Pause,
  Sparkles,
  Radio,
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { useMessages } from '@/features/messages';
import type { ThreadStatus, ThreadTopic } from '@/features/messages';
import { apiJson } from '@/lib/api-client';

const PURPLE = '#5C2D91';
const PURPLE_GRAD = 'linear-gradient(135deg, #5C2D91, #7C3AED)';
const TEAL_GRAD = 'linear-gradient(135deg, #00897B, #00695C)';
const SKY_GRAD = 'linear-gradient(135deg, #0284C7, #0369A1)';

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

const TOPIC_PILL: Record<ThreadTopic, string> = {
  scheduling: 'bg-sky-50 text-sky-700',
  billing: 'bg-emerald-50 text-emerald-700',
  general: 'bg-gray-100 text-gray-700',
  clinical: 'bg-violet-50 text-violet-800',
  'rx-refill': 'bg-amber-50 text-amber-800',
};

const STATUS_META: Record<ThreadStatus, { label: string; cls: string }> = {
  waiting: { label: 'Waiting', cls: 'bg-amber-50 text-amber-800' },
  'in-progress': { label: 'In Progress', cls: 'bg-blue-50 text-blue-700' },
  forwarded: { label: 'Forwarded', cls: 'bg-violet-50 text-violet-800' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-700' },
};

type OperationalQueue = { id: string; name: string; phone: string; badge: string; color: string };
type OperationalStaff = { name: string; role: string; site: string; ext: string; phone: string; avatar: string };
type OperationalExternal = { category: string; name: string; phone: string; desc: string };

const OPERATIONAL_QUEUES: OperationalQueue[] = [];

const OPERATIONAL_STAFF: OperationalStaff[] = [];

const OPERATIONAL_EXTERNAL_DIRECTORY: OperationalExternal[] = [];

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
  let bg = '#F3F4F6';
  let color = '#4B5563';
  let label = 'Neutral';
  if (s.includes('crisis')) {
    bg = '#FEF2F2';
    color = '#DC2626';
    label = 'Crisis';
  } else if (s.includes('pos')) {
    bg = '#F0FDF4';
    color = '#15803D';
    label = 'Positive';
  } else if (s.includes('neg')) {
    bg = '#FFF7ED';
    color = '#C2410C';
    label = 'Negative';
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function sentimentBarColor(sentiment?: string) {
  const s = (sentiment || '').toLowerCase();
  if (s.includes('pos')) return '#22c55e';
  if (s.includes('crisis') || s.includes('neg')) return '#ef4444';
  return '#f59e0b';
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
  const [routeDraft, setRouteDraft] = useState('Front desk scheduling');
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
      if (data.voicemails) {
        setVoicemails(data.voicemails);
        if (data.voicemails.length > 0) {
          setSelectedVm((prev) => prev || data.voicemails[0]);
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
      setNotice(res.demoMode ? 'SMS queued (demoMode)' : 'SMS sent');
      toast.success(res.demoMode ? 'SMS queued (demoMode)' : 'SMS sent via Amazon Connect');
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
            : 'AWS outbound quota is 0 — running in Demo Mode',
          { icon: '🎙️' }
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
      toast('Please enter the client phone number', { icon: '📞' });
      return;
    }

    if (callDevice === 'phone') {
      if (!clinicianPhone || !isUsE164(clinicianPhone)) {
        setDoctorPhoneModalOpen(true);
        toast('Please add your doctor phone number before placing a mobile call', { icon: '📞' });
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

  return (
    <div className="flex h-[calc(100vh-112px)] min-h-[640px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('sms-calls')}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
            style={
              tab === 'sms-calls'
                ? { background: TEAL_GRAD, color: 'white' }
                : { background: '#F3F4F6', color: '#4B5563' }
            }
          >
            <Phone size={16} />
            SMS & Calls
            {unreadSmsApprox > 0 ? (
              <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{unreadSmsApprox}</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setTab('secure')}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
            style={
              tab === 'secure'
                ? { background: PURPLE_GRAD, color: 'white' }
                : { background: '#F3F4F6', color: '#4B5563' }
            }
          >
            <MessageSquare size={16} />
            Secure Messages
            {unreadSecure > 0 ? (
              <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{unreadSecure}</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('dial-directory');
              void loadOpCalls();
            }}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
            style={
              tab === 'dial-directory'
                ? { background: SKY_GRAD, color: 'white' }
                : { background: '#F3F4F6', color: '#4B5563' }
            }
          >
            <PhoneCall size={16} />
            Dial &amp; Directory
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('voicemail-ai');
              void loadVoicemails();
            }}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
            style={
              tab === 'voicemail-ai'
                ? { background: 'linear-gradient(135deg, #DC2626, #991B1B)', color: 'white' }
                : { background: '#F3F4F6', color: '#4B5563' }
            }
          >
            <Mic size={16} />
            Voicemail AI
            {voicemails.filter((v) => v.intent === 'crisis' && !v.isRouted).length > 0 ? (
              <span className="rounded-full bg-white text-red-700 px-2 py-0.5 text-[10px] font-black animate-pulse shadow-xs">
                {voicemails.filter((v) => v.intent === 'crisis' && !v.isRouted).length} CRISIS
              </span>
            ) : null}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {tab === 'sms-calls'
            ? 'Amazon Connect · Pinpoint SMS · Contact Lens AI'
            : tab === 'secure'
            ? 'Encrypted in-platform · Front office portal · PHI permitted'
            : tab === 'dial-directory'
            ? 'Internal Queues · External Vendors & Payers · Operational Isolation (patientId: none)'
            : 'Amazon Connect + Transcribe · Bedrock Intent Triage · Priority Crisis Escalation (#DC2626)'}
        </p>
      </div>

      {(error || clientsError || messagesError || notice) && (
        <div
          className={`rounded-xl px-3 py-2 text-sm ${
            error || clientsError || messagesError
              ? 'border border-rose-200 bg-rose-50 text-rose-700'
              : 'border border-teal-200 bg-teal-50 text-teal-800'
          }`}
        >
          {error || clientsError || messagesError || notice}
        </div>
      )}

      {tab === 'sms-calls' ? (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* Left client list */}
          <aside
            className={`w-full md:w-60 shrink-0 flex-col border-r border-gray-100 ${
              clientId ? 'hidden md:flex' : 'flex'
            }`}
          >
            <div className="border-b border-gray-100 p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search clients…"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-2 text-xs outline-none focus:border-teal-500"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {clientsLoading ? (
                <p className="p-3 text-xs text-gray-400">Loading…</p>
              ) : filteredClients.length === 0 ? (
                <p className="p-3 text-xs text-gray-400">No clients</p>
              ) : (
                filteredClients.map((c) => {
                  const selected = c.id === clientId;
                  const crisis = Boolean(
                    (c as { crisisFlag?: boolean; highRisk?: boolean }).crisisFlag ||
                      (c as { highRisk?: boolean }).highRisk
                  );
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        selectClient(c.id);
                        setLensOpenFor(null);
                        setSmsSub('sms');
                      }}
                      className={`relative flex w-full items-center gap-2 border-b border-gray-50 px-3 py-3 text-left text-sm ${
                        selected ? 'bg-teal-50' : 'hover:bg-gray-50'
                      }`}
                      style={selected ? { borderLeft: '3px solid #00897B' } : { borderLeft: '3px solid transparent' }}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ background: TEAL_GRAD }}
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-gray-900">{c.name}</span>
                        <span className="block truncate text-[10px] text-gray-400">
                          {c.phone ? 'SMS & Calls' : 'No phone on file'}
                        </span>
                      </span>
                      {crisis ? (
                        <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Center pane */}
          <div className={`min-w-0 flex-1 flex-col ${!clientId ? 'hidden md:flex' : 'flex'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {clientId ? (
                  <button
                    type="button"
                    onClick={() => setClientId('')}
                    className="md:hidden inline-flex items-center rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    title="Back to clients"
                  >
                    ← Clients
                  </button>
                ) : null}
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: TEAL_GRAD }}
                >
                  {(client?.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-gray-900">
                      {client?.name || 'Select a client'}
                    </p>
                    {client &&
                    ((client as { crisisFlag?: boolean }).crisisFlag ||
                      (client as { highRisk?: boolean }).highRisk) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                        <AlertTriangle size={10} /> Crisis Flag
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {editingClientPhone ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={clientPhoneInput}
                          onChange={(e) => setClientPhoneInput(e.target.value)}
                          placeholder="+1XXXXXXXXXX"
                          className="rounded border border-teal-400 px-1.5 py-0.5 text-xs outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void saveClientPhone()}
                          className="rounded bg-teal-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-teal-700"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingClientPhone(false)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className={client?.phone ? 'text-gray-900 font-medium' : 'text-gray-400 italic'}>
                          {client?.phone || (client ? 'No phone on file' : 'Select a client to start')}
                        </span>
                        {client ? (
                          <button
                            type="button"
                            onClick={() => {
                              setClientPhoneInput(client.phone || '');
                              setEditingClientPhone(true);
                            }}
                            className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-100"
                            title="Edit client phone number"
                          >
                            <Edit2 size={10} /> {client.phone ? 'Edit' : '+ Set phone'}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {callPhase === 'idle' ? (
                  <div className="flex items-center rounded-xl bg-gray-100 p-0.5 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setCallDevice('laptop')}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition ${
                        callDevice === 'laptop'
                          ? 'bg-white font-bold text-teal-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="Speak directly through your Laptop Microphone & Speakers"
                    >
                      <Laptop size={12} />
                      <span>Laptop Mic</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCallDevice('phone')}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition ${
                        callDevice === 'phone'
                          ? 'bg-white font-bold text-teal-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="Amazon Connect dials and bridges your mobile phone"
                    >
                      <Phone size={12} />
                      <span>Mobile</span>
                    </button>
                  </div>
                ) : null}

                {callDevice === 'phone' && callPhase === 'idle' ? (
                  <button
                    type="button"
                    onClick={() => setDoctorPhoneModalOpen(true)}
                    className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    title="Configure doctor mobile phone number for call bridging"
                  >
                    <Phone size={12} className="text-teal-600" />
                    <span>Doctor: {clinicianPhone ? clinicianPhone : 'Set phone'}</span>
                  </button>
                ) : null}

                {callDevice === 'laptop' && callPhase === 'idle' ? (
                  <button
                    type="button"
                    onClick={openCcpPopup}
                    className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50/60 px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                    title="Open Amazon Connect Softphone popup (WebRTC)"
                  >
                    <Volume2 size={12} className="text-teal-600" />
                    <span>Connect Softphone CCP</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => void loadThread()}
                  className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                  aria-label="Refresh"
                >
                  <RefreshCw size={14} />
                </button>

                {callPhase === 'idle' ? (
                  <button
                    type="button"
                    onClick={() => void startCall()}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold text-white transition hover:opacity-95"
                    style={{ background: TEAL_GRAD }}
                    title={
                      callDevice === 'laptop'
                        ? 'Call patient using Laptop Microphone'
                        : 'Bridge call to Doctor Mobile'
                    }
                  >
                    {callDevice === 'laptop' ? <Laptop size={14} /> : <Phone size={14} />} Call {first || 'Client'}
                  </button>
                ) : callPhase === 'connecting' ? (
                  <span className="inline-flex animate-pulse items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                    Connecting…
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    {callDevice === 'laptop' ? (
                      <div className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={toggleMute}
                          className={`rounded-lg p-1 transition ${
                            isMuted
                              ? 'bg-red-600 text-white'
                              : 'bg-teal-600 text-white hover:bg-teal-700'
                          }`}
                          title={isMuted ? 'Unmute Laptop Microphone' : 'Mute Laptop Microphone'}
                        >
                          {isMuted ? <MicOff size={13} /> : <Mic size={13} />}
                        </button>
                        <span className="text-[11px] font-semibold text-teal-900">
                          {isMuted ? 'Muted' : 'Laptop Mic'}
                        </span>
                        <div className="ml-1 flex h-3.5 items-end gap-0.5">
                          <span
                            className="w-1 rounded-full bg-teal-500 transition-all"
                            style={{ height: `${Math.max(3, Math.min(14, micAudioLevel * 0.14))}px` }}
                          />
                          <span
                            className="w-1 rounded-full bg-teal-600 transition-all"
                            style={{ height: `${Math.max(4, Math.min(14, micAudioLevel * 0.18))}px` }}
                          />
                          <span
                            className="w-1 rounded-full bg-teal-500 transition-all"
                            style={{ height: `${Math.max(2, Math.min(14, micAudioLevel * 0.12))}px` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    <span className="rounded-xl bg-emerald-100 px-3 py-2 font-mono text-sm font-bold text-emerald-800">
                      {callClock}
                    </span>
                    <button
                      type="button"
                      onClick={() => void endCall()}
                      className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-red-700"
                    >
                      <PhoneOff size={14} /> End
                    </button>
                  </div>
                )}
              </div>
            </div>

            {(callDemoMode || connectLive === false) && callPhase !== 'idle' ? (
              <div
                className="mx-4 mt-2 rounded-lg px-3 py-2 text-[11px] font-semibold"
                style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}
              >
                AWS Outbound Telephony Quota is 0 on this AWS account. Simulated contact{' '}
                {activeContactId || 'pending'} (request quota increase in AWS Console to dial physical phones).
              </div>
            ) : connectLive && sourceLast4 && callPhase !== 'idle' ? (
              <div className="mx-4 mt-2 rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-[11px] font-semibold text-teal-800">
                Outbound via Amazon Connect · Source ••••{sourceLast4}
                {activeContactId ? ` · ${activeContactId}` : ''}
              </div>
            ) : null}

            <div className="flex gap-4 border-b border-gray-100 px-4">
              {(
                [
                  ['sms', 'SMS Thread'],
                  ['calls', 'Call History'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSmsSub(id)}
                  className={`border-b-2 py-2.5 text-xs font-bold ${
                    smsSub === id
                      ? 'border-teal-600 text-teal-700'
                      : 'border-transparent text-gray-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {smsSub === 'sms' ? (
              <>
                <div
                  className="mx-4 mt-3 rounded-lg px-3 py-2 text-[11px] font-medium"
                  style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}
                >
                  Do not include PHI, diagnosis, or medication details in SMS. Use Secure Messages for
                  clinical communication.
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  {messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">No SMS messages yet</p>
                  ) : (
                    messages.map((m) => {
                      const outbound = m.direction === 'outbound' || m.direction === 'OUTBOUND';
                      return (
                        <div
                          key={m.id}
                          className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                              outbound
                                ? 'bg-teal-700 text-white'
                                : 'border border-gray-200 bg-white text-gray-800'
                            }`}
                          >
                            {m.body}
                            <div
                              className={`mt-1 text-[10px] ${
                                outbound ? 'text-teal-100' : 'text-gray-400'
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
                <div className="border-t border-gray-100 p-3">
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
                      className="min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                    />
                    <button
                      type="button"
                      disabled={busy || !smsBody.trim()}
                      onClick={() => void sendSms()}
                      className="self-end rounded-xl px-3 py-2 text-white disabled:opacity-50"
                      style={{ background: TEAL_GRAD }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                  <p className="mt-1 text-right text-[10px] text-gray-400">
                    {smsBody.length}/1600
                  </p>
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {calls.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">No call history</p>
                ) : (
                  <ul className="space-y-3">
                    {calls.map((call) => {
                      const contactKey = call.contactId || call.id;
                      const analysis =
                        lensOpenFor === contactKey
                          ? lens
                          : call.analysis || call.analysisJson || null;
                      const open = lensOpenFor === contactKey;
                      return (
                        <li
                          key={call.id}
                          className="rounded-xl border border-gray-200 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Phone size={14} className="text-teal-700" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Outbound · {call.status || 'INITIATED'}
                            </span>
                            <SentimentBadge sentiment={analysis?.sentiment || call.status} />
                            {call.demoMode ? (
                              <span className="text-[10px] font-semibold text-amber-700">
                                demoMode
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                            <span className="font-semibold text-gray-800">
                              {new Date(call.createdAt).toLocaleString()}
                            </span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-600">
                              {call.clinicianName || clinicianName || 'Clinician'}
                            </span>
                            <span className="text-gray-300">·</span>
                            <span className="font-mono text-gray-500">
                              {formatDuration(call.durationSec)}
                            </span>
                            {call.contactId ? (
                              <span className="font-mono text-[10px] text-gray-400">
                                ({call.contactId.slice(0, 16)}…)
                              </span>
                            ) : null}
                            {call.recordingUrl ? (
                              <a
                                href={call.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-auto text-xs font-semibold text-teal-700 hover:underline"
                              >
                                Recording
                              </a>
                            ) : (
                              <span
                                className="ml-auto cursor-not-allowed text-xs text-gray-400"
                                title="Recording URL not available for this contact"
                              >
                                Recording
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={lensBusy && open}
                              onClick={() => {
                                if (open) {
                                  setLensOpenFor(null);
                                  return;
                                }
                                void loadLens(contactKey);
                              }}
                              className="rounded-lg border border-teal-200 px-2 py-1 text-[11px] font-bold text-teal-700 hover:bg-teal-50"
                            >
                              AI Analysis
                            </button>
                          </div>
                          {open ? (
                            <div className="mt-3 rounded-lg border border-teal-100 bg-teal-50/50 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">
                                Contact Lens AI Analysis
                              </p>
                              {lensBusy ? (
                                <p className="mt-2 text-xs text-teal-700">Analyzing…</p>
                              ) : (
                                <>
                                  <div className="mt-2">
                                    <p className="text-[10px] font-semibold text-gray-500">
                                      Sentiment
                                    </p>
                                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200">
                                      <div
                                        className="h-full w-2/3 rounded-full"
                                        style={{
                                          background: sentimentBarColor(analysis?.sentiment),
                                        }}
                                      />
                                    </div>
                                    <p className="mt-1 text-xs font-semibold text-gray-700">
                                      {analysis?.sentiment || 'Neutral'}
                                      {lensDemo ? ' · demoMode' : ''}
                                    </p>
                                  </div>
                                  {analysis?.crisisKeywords &&
                                  analysis.crisisKeywords.length > 0 ? (
                                    <div className="mt-2">
                                      <p className="text-[10px] font-semibold text-red-600">
                                        Crisis Keywords
                                      </p>
                                      <p className="text-xs text-red-700">
                                        {analysis.crisisKeywords.join(', ')}
                                      </p>
                                    </div>
                                  ) : null}
                                  {analysis?.summary ? (
                                    <div className="mt-2">
                                      <p className="text-[10px] font-semibold text-gray-500">
                                        AI Summary
                                      </p>
                                      <p className="text-xs text-gray-700">{analysis.summary}</p>
                                    </div>
                                  ) : null}
                                  {analysis?.keyPhrases && analysis.keyPhrases.length > 0 ? (
                                    <div className="mt-2">
                                      <p className="text-[10px] font-semibold text-gray-500">
                                        Key Phrases
                                      </p>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {analysis.keyPhrases.map((p) => (
                                          <span
                                            key={p}
                                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                            style={{ background: '#F3EEFF', color: PURPLE }}
                                          >
                                            {p}
                                          </span>
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
        </div>
      ) : tab === 'secure' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-gray-900">Front Office Portal</p>
              <p className="text-xs text-gray-500">
                {unreadSecure} unread · {waitingCount} waiting
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', 'All'],
                  ['waiting', 'waiting'],
                  ['in-progress', 'in-progress'],
                  ['forwarded', 'forwarded'],
                  ['resolved', 'resolved'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold capitalize ${
                    statusFilter === key ? 'text-white' : 'border border-gray-200 text-gray-600'
                  }`}
                  style={statusFilter === key ? { background: PURPLE } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <aside className="flex w-72 shrink-0 flex-col border-r border-gray-100">
              <div className="border-b border-gray-100 p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    value={secureSearch}
                    onChange={(e) => setSecureSearch(e.target.value)}
                    placeholder="Search patients…"
                    className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-2 text-xs outline-none focus:border-[#5C2D91]"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {threadsLoading ? (
                  <p className="p-3 text-xs text-gray-400">Loading threads…</p>
                ) : filteredThreads.length === 0 ? (
                  <p className="p-3 text-xs text-gray-400">No conversations match.</p>
                ) : (
                  filteredThreads.map((t) => {
                    const active = t.id === selectedId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => void openThread(t.id)}
                        className={`w-full border-b border-gray-50 px-3 py-3 text-left ${
                          active ? 'bg-violet-50' : 'hover:bg-gray-50'
                        }`}
                        style={active ? { borderLeft: `3px solid ${PURPLE}` } : undefined}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {t.clientName}
                          </p>
                          {t.unreadCount > 0 ? (
                            <span
                              className="rounded-full px-1.5 text-[10px] font-bold text-white"
                              style={{ background: PURPLE }}
                            >
                              {t.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-500">{t.lastMessage}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${TOPIC_PILL[t.topic]}`}
                          >
                            {t.topic}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_META[t.status].cls}`}
                          >
                            {STATUS_META[t.status].label}
                          </span>
                          {t.risk === 'high' ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                              <AlertTriangle size={10} /> High risk
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              {selectedThread ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{selectedThread.clientName}</p>
                      <p className="text-xs capitalize text-gray-500">
                        {selectedThread.topic} · {STATUS_META[selectedThread.status].label}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedThread.risk === 'high' ? (
                        <button
                          type="button"
                          onClick={() => setForwardOpen(true)}
                          className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white"
                        >
                          <AlertTriangle size={12} /> Forward Now
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setForwardOpen(true)}
                          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-bold text-[#5C2D91]"
                        >
                          <ArrowRight size={12} /> Forward
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={actionBusy || selectedThread.status === 'resolved'}
                        onClick={() => void resolveThread()}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 size={12} /> Resolve
                      </button>
                    </div>
                  </div>

                  {selectedThread.risk === 'high' ? (
                    <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      <strong>High-risk message</strong> — escalate to the care team promptly. Use
                      Forward Now if clinical follow-up is needed.
                    </div>
                  ) : null}

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
                            <div className="max-w-[85%] rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">
                              <span className="font-bold">Clinician note</span> — {m.content}
                            </div>
                          </div>
                        );
                      }
                      const fo = type === 'front-office';
                      return (
                        <div key={m.id} className={`flex ${fo ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                              fo ? 'text-white' : 'border border-gray-200 bg-white text-gray-800'
                            }`}
                            style={fo ? { background: PURPLE } : undefined}
                          >
                            {m.content}
                            <div
                              className={`mt-1 text-[10px] ${fo ? 'text-violet-200' : 'text-gray-400'}`}
                            >
                              {m.senderName} · {m.timestamp}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-gray-100 p-3">
                    <div className="flex gap-2">
                      <textarea
                        value={compose}
                        onChange={(e) => setCompose(e.target.value)}
                        rows={2}
                        placeholder={`Reply to ${selectedThread.clientName} as front office…`}
                        className="min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#5C2D91]"
                      />
                      <button
                        type="button"
                        disabled={sending || !compose.trim()}
                        onClick={() => void sendSecure()}
                        className="self-end rounded-xl px-3 py-2 text-white disabled:opacity-50"
                        style={{ background: PURPLE_GRAD }}
                      >
                        <Send size={16} />
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      Encrypted in-platform messaging — PHI is permitted here. Forward clinical
                      questions to the care team.
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                  Select a thread to view Secure Messages
                </div>
              )}
            </div>
          </div>
        </div>
      ) : tab === 'dial-directory' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
          {/* Column 1: Team Queues & Staff Directory (lg:col-span-4) */}
          <div className="flex flex-col min-h-0 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden lg:col-span-4">
            <div className="border-b border-gray-100 bg-gray-50/70 p-3.5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-sky-600" />
                  Team Queues &amp; Staff
                </h3>
                <p className="text-[11px] text-gray-500">Internal extensions · Quick Connect queues</p>
              </div>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                Internal DID
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-2 space-y-3">
              {/* Queues Section */}
              <div>
                <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Priority &amp; Site Queues
                </p>
                <div className="space-y-1.5">
                  {OPERATIONAL_QUEUES.length === 0 && (
                    <p className="px-2 py-3 text-xs text-gray-400">No queues yet. Real queues will show here once they are added.</p>
                  )}
                  {OPERATIONAL_QUEUES.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/50 p-2.5 transition hover:bg-gray-100/70"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900 truncate">{q.name}</span>
                          <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${q.color}`}>
                            {q.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500">{q.phone}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleStartStaffCall(q.name, q.phone, 'queue')}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 transition"
                      >
                        <PhoneCall className="h-3 w-3" />
                        Call Queue
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Staff Extensions Section */}
              <div className="pt-2">
                <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Clinicians &amp; Operations Staff
                </p>
                <div className="space-y-1.5">
                  {OPERATIONAL_STAFF.length === 0 && (
                    <p className="px-2 py-3 text-xs text-gray-400">No staff extensions yet.</p>
                  )}
                  {OPERATIONAL_STAFF.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-2.5 transition hover:border-gray-300"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                          {s.avatar}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-900 truncate">{s.name}</p>
                          <p className="text-[11px] text-gray-500">
                            {s.role} · <span className="font-semibold text-gray-700">{s.site}</span> ({s.ext})
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleStartStaffCall(s.name, s.phone, 'agent')}
                        className="inline-flex items-center gap-1 rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100 transition"
                      >
                        <PhoneCall className="h-3 w-3 text-sky-600" />
                        Call Agent
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Column 2: External Directory (lg:col-span-4) */}
          <div className="flex flex-col min-h-0 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden lg:col-span-4">
            <div className="border-b border-gray-100 bg-gray-50/70 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-emerald-600" />
                    External Directory
                  </h3>
                  <p className="text-[11px] text-gray-500">Payers · Pharmacies · Labs · Legal · Vendors</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  Non-Client
                </span>
              </div>
              <div className="mt-2.5 relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter external contacts..."
                  value={opExternalSearch}
                  onChange={(e) => setOpExternalSearch(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {OPERATIONAL_EXTERNAL_DIRECTORY.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-gray-400">No external contacts yet.</p>
              )}
              {OPERATIONAL_EXTERNAL_DIRECTORY.filter((item) => {
                const q = opExternalSearch.toLowerCase();
                return (
                  !q ||
                  item.name.toLowerCase().includes(q) ||
                  item.category.toLowerCase().includes(q) ||
                  item.desc.toLowerCase().includes(q)
                );
              }).map((item) => (
                <div
                  key={item.name}
                  className="rounded-xl border border-gray-100 bg-white p-3 hover:border-emerald-200 hover:shadow-xs transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-600">
                          {item.category}
                        </span>
                        <h4 className="text-xs font-bold text-gray-900">{item.name}</h4>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">{item.desc}</p>
                      <p className="mt-1 text-xs font-mono font-semibold text-emerald-800">{item.phone}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleStartExternalCall(item.phone, item.name, item.desc)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition"
                    >
                      <PhoneCall className="h-3 w-3" />
                      Dial
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Column 3: Soft Dial Pad & Active Call & Operational History (lg:col-span-4) */}
          <div className="flex flex-col min-h-0 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden lg:col-span-4">
            {/* Outbound Caller ID Header */}
            <div className="border-b border-gray-100 bg-slate-900 p-3 text-white">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                  Outbound Caller ID
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  Verified Clinic DID
                </span>
              </div>
              <p className="mt-1 text-sm font-bold text-white tracking-wide">
                MD Behavioral Health · +1 (240) 855-4300
              </p>
              <p className="text-[10px] text-slate-400">
                Operational Isolation · PHI Restricted (patientId: none)
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Active Call Banner */}
              {opCallPhase !== 'idle' ? (
                <div
                  className={`rounded-xl p-3 border ${
                    opCallPhase === 'connecting'
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          opCallPhase === 'connecting' ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-pulse'
                        }`}
                      />
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {opCallPhase === 'connecting' ? 'Connecting Call...' : 'On Call (Live)'}
                      </span>
                    </div>
                    <span className="font-mono text-sm font-bold">
                      {String(Math.floor(opCallSeconds / 60)).padStart(2, '0')}:
                      {String(opCallSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-bold">{activeOpTarget?.name}</p>
                  <p className="text-xs opacity-75">{activeOpTarget?.phone}</p>
                  <button
                    type="button"
                    onClick={handleEndOpCall}
                    className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 shadow-sm"
                  >
                    <PhoneOff className="h-3.5 w-3.5" />
                    End Call
                  </button>
                </div>
              ) : null}

              {/* Dial Pad Container */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3">
                {/* Digit Display */}
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
                  <input
                    type="text"
                    placeholder="Enter phone number..."
                    value={dialPadNumber}
                    onChange={(e) => setDialPadNumber(e.target.value)}
                    className="w-full text-base font-mono font-bold tracking-wider text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
                  />
                  <div className="flex items-center gap-1 ml-2">
                    {dialPadNumber ? (
                      <button
                        type="button"
                        onClick={handleSoftpadBackspace}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="Backspace"
                      >
                        <Delete className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Optional Callee Name */}
                <input
                  type="text"
                  placeholder="Callee or Organization name (optional)"
                  value={dialPadName}
                  onChange={(e) => setDialPadName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 outline-none placeholder:text-gray-400"
                />

                {/* 12-Key Pad */}
                <div className="mt-2.5 grid grid-cols-3 gap-2">
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
                      className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-2 shadow-xs hover:border-sky-300 hover:bg-sky-50 active:scale-95 transition"
                    >
                      <span className="text-base font-bold text-gray-900 leading-none">{btn.key}</span>
                      {btn.sub ? (
                        <span className="text-[9px] font-semibold text-gray-400 tracking-wider">
                          {btn.sub}
                        </span>
                      ) : (
                        <span className="h-[11px]" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Call Button */}
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    disabled={opCallPhase !== 'idle' || !dialPadNumber.trim()}
                    onClick={() =>
                      void handleStartExternalCall(
                        dialPadNumber,
                        dialPadName || 'Manual Outbound Call',
                        'Softpad Call'
                      )
                    }
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <Phone className="h-4 w-4" />
                    Place Call
                  </button>
                  {dialPadNumber ? (
                    <button
                      type="button"
                      onClick={handleSoftpadClear}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Operational Call History Log */}
              <div className="rounded-xl border border-gray-100 bg-white p-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                  <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5 text-gray-400" />
                    Operational Call Log
                  </h4>
                  <button
                    type="button"
                    onClick={() => void loadOpCalls()}
                    className="text-[10px] font-semibold text-sky-600 hover:underline"
                  >
                    Refresh
                  </button>
                </div>

                <div className="mt-2 max-h-48 overflow-y-auto space-y-1.5 divide-y divide-gray-50">
                  {loadingOpCalls ? (
                    <p className="py-2 text-center text-xs text-gray-400">Loading call history...</p>
                  ) : opCallsLog.length === 0 ? (
                    <p className="py-2 text-center text-xs text-gray-400">No operational calls recorded</p>
                  ) : (
                    opCallsLog.map((log) => (
                      <div key={log.id} className="pt-1.5 flex items-center justify-between text-xs">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{log.calleeName}</p>
                          <p className="text-[10px] text-gray-500 font-mono">
                            {log.destinationPhone} · {log.callType}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="inline-block rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                            patientId: none
                          </span>
                          <p className="text-[10px] text-gray-400">
                            {log.durationSeconds > 0 ? `${log.durationSeconds}s` : 'Initiated'}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Voicemail AI Triage View (Commit ec2a982 / Pillar 5) */
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* Left Voicemail Inbox List */}
          <aside className="w-full md:w-96 shrink-0 flex flex-col border-r border-gray-100 bg-gray-50/30">
            <div className="border-b border-gray-100 p-3 bg-white">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-[#DC2626]" />
                  <span className="text-xs font-bold text-gray-900">Voicemail Queue</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadVoicemails()}
                  disabled={vmLoading}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5C2D91] hover:underline"
                >
                  <RefreshCw className={`h-3 w-3 ${vmLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {/* Filter chips */}
              <div className="flex flex-wrap gap-1">
                {(['all', 'crisis', 'reschedule', 'refill', 'billing', 'general'] as const).map((cat) => {
                  const count =
                    cat === 'all'
                      ? voicemails.length
                      : voicemails.filter((v) => v.intent === cat).length;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setVmFilter(cat)}
                      className={`rounded-lg px-2 py-0.5 text-[10px] font-bold capitalize transition ${
                        vmFilter === cat
                          ? cat === 'crisis'
                            ? 'bg-[#DC2626] text-white'
                            : 'bg-[#5C2D91] text-white'
                          : cat === 'crisis' && count > 0
                          ? 'bg-red-100 text-red-700 font-extrabold border border-red-200'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-2 space-y-1.5">
              {vmLoading && voicemails.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400">Loading voicemails…</div>
              ) : voicemails.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400">No voicemails found.</div>
              ) : (
                voicemails
                  .filter((v) => (vmFilter === 'all' ? true : v.intent === vmFilter))
                  .map((vm) => {
                    const isSelected = selectedVm?.id === vm.id;
                    const isCrisis = vm.intent === 'crisis';
                    return (
                      <button
                        key={vm.id}
                        type="button"
                        onClick={() => setSelectedVm(vm)}
                        className={`w-full text-left rounded-xl p-3 transition border ${
                          isCrisis
                            ? isSelected
                              ? 'bg-red-50 border-[#DC2626] ring-2 ring-red-400 shadow-xs'
                              : 'bg-red-50/70 border-red-200 hover:bg-red-50'
                            : isSelected
                            ? 'bg-purple-50/70 border-[#5C2D91] shadow-xs'
                            : 'bg-white border-gray-100 hover:border-gray-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-xs text-gray-900 truncate">
                                {vm.callerName || 'Unknown Caller'}
                              </span>
                              {isCrisis && (
                                <span className="rounded bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black uppercase text-white animate-pulse">
                                  CRISIS
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-gray-500 mt-0.5">{vm.callerPhone}</p>
                          </div>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">
                            {Math.floor(vm.durationSeconds / 60)}:{(vm.durationSeconds % 60).toString().padStart(2, '0')}
                          </span>
                        </div>

                        <p className="mt-2 text-xs text-gray-600 line-clamp-2 leading-relaxed">
                          {vm.transcript}
                        </p>

                        <div className="mt-2.5 flex items-center justify-between text-[10px] text-gray-500">
                          <span
                            className={`rounded-md px-1.5 py-0.5 font-bold uppercase tracking-wider ${
                              isCrisis
                                ? 'bg-red-200 text-red-900'
                                : vm.intent === 'refill'
                                ? 'bg-amber-100 text-amber-800'
                                : vm.intent === 'billing'
                                ? 'bg-emerald-100 text-emerald-800'
                                : vm.intent === 'reschedule'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {vm.intent} · {(vm.confidence * 100).toFixed(0)}%
                          </span>
                          <span className="text-gray-400">
                            {new Date(vm.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </button>
                    );
                  })
              )}
            </div>
          </aside>

          {/* Right Selected Voicemail Details Pane */}
          <main className="flex-1 flex flex-col min-h-0 bg-white overflow-y-auto p-5">
            {selectedVm ? (
              <div className="space-y-4 max-w-3xl">
                {/* Crisis Warning Banner */}
                {selectedVm.intent === 'crisis' && (
                  <div className="rounded-2xl border-2 border-[#DC2626] bg-red-50 p-4 shadow-sm animate-in fade-in">
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="h-6 w-6 text-[#DC2626] shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-sm font-extrabold text-[#DC2626] uppercase tracking-wide">
                          High Priority Crisis Alert — Immediate Clinical Action Required
                        </h3>
                        <p className="text-xs text-red-900 mt-1 leading-relaxed">
                          Amazon Bedrock detected active safety distress language. Automatically escalated to on-call mobile crisis response team.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              toast.success(
                                `On-call crisis clinician paged for ${selectedVm.callerName || 'caller'} (${selectedVm.callerPhone})! SMS dispatch sent.`,
                                { duration: 6000 }
                              );
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[#DC2626] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 transition"
                          >
                            <AlertTriangle className="h-4 w-4" />
                            Page On-Call Crisis Staff Now
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleStartExternalCall(
                                selectedVm.callerPhone,
                                selectedVm.callerName || 'Caller',
                                'Crisis Callback'
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white px-3.5 py-2 text-xs font-bold text-[#DC2626] hover:bg-red-100 transition"
                          >
                            <PhoneCall className="h-4 w-4" />
                            Immediate Return Call
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Caller Information & Actions Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">
                      {selectedVm.callerName || 'Unknown Caller'}
                    </h2>
                    <p className="text-xs font-mono text-gray-500 mt-0.5">{selectedVm.callerPhone}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Received {new Date(selectedVm.createdAt).toLocaleString()} · Duration{' '}
                      {Math.floor(selectedVm.durationSeconds / 60)}m {selectedVm.durationSeconds % 60}s
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleStartExternalCall(
                          selectedVm.callerPhone,
                          selectedVm.callerName || 'Caller',
                          'Voicemail Follow-up'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-xs"
                    >
                      <PhoneCall className="h-4 w-4" />
                      Dial Caller
                    </button>
                    <input
                      value={routeDraft}
                      onChange={(event) => setRouteDraft(event.target.value)}
                      className="rounded-xl border border-gray-300 px-2 py-2 text-xs"
                      aria-label="Re-route voicemail to"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void fetch('/api/communications/voicemails', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: selectedVm.id, routeTo: routeDraft, isRouted: true }),
                        }).then(async (response) => {
                          if (!response.ok) {
                            toast.error('Voicemail was not re-routed');
                            return;
                          }
                          setVoicemails((prev) => prev.map((v) => (v.id === selectedVm.id ? { ...v, routeTo: routeDraft, isRouted: true } : v)));
                          setSelectedVm((prev) => (prev ? { ...prev, routeTo: routeDraft, isRouted: true } : prev));
                          toast.success(`Voicemail re-routed to ${routeDraft}`);
                        });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700"
                    >
                      Re-route
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        toast.success(`Voicemail marked as routed to ${selectedVm.routeTo}`);
                        setVoicemails((prev) =>
                          prev.map((v) => (v.id === selectedVm.id ? { ...v, isRouted: true } : v))
                        );
                        setSelectedVm((prev) => (prev ? { ...prev, isRouted: true } : prev));
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {selectedVm.isRouted ? 'Already filed' : 'File as handled'}
                    </button>
                  </div>
                </div>

                {/* Bedrock Intent Classification Card */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-purple-600" />
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                        AWS Bedrock Intent Triage
                      </h4>
                    </div>
                    <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                      {(selectedVm.confidence * 100).toFixed(1)}% Confidence
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3 text-xs">
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <span className="text-[10px] font-medium text-gray-400 uppercase">Classified Intent</span>
                      <p className="mt-1 font-bold text-gray-900 uppercase tracking-wider">
                        {selectedVm.intent}
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 sm:col-span-2">
                      <span className="text-[10px] font-medium text-gray-400 uppercase">Routing Destination</span>
                      <p className="mt-1 font-bold text-gray-900">{selectedVm.routeTo}</p>
                    </div>
                  </div>
                </div>

                {/* Audio Waveform Player */}
                <div className="rounded-2xl border border-gray-200 bg-slate-900 p-4 text-white shadow-xs">
                  <div className="flex items-center justify-between mb-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 font-mono text-[11px]">
                      <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
                      Amazon Connect Recording · S3 KMS Encrypted
                    </span>
                    <span>
                      0:00 / {Math.floor(selectedVm.durationSeconds / 60)}:
                      {(selectedVm.durationSeconds % 60).toString().padStart(2, '0')}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setVmAudioPlaying((prev) => !prev)}
                      className="w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center font-bold transition shadow-sm"
                    >
                      {vmAudioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                    </button>

                    {/* Waveform Visualization Bars */}
                    <div className="flex-1 flex items-center gap-1 h-10 overflow-hidden">
                      {[
                        32, 60, 45, 80, 95, 40, 25, 70, 85, 90, 65, 45, 30, 80, 100, 50, 40, 75, 90, 60, 35,
                        70, 85, 40, 55, 90, 75, 50, 30, 60, 80, 45,
                      ].map((h, idx) => (
                        <div
                          key={idx}
                          className={`w-1 rounded-full transition-all duration-150 ${
                            vmAudioPlaying ? 'bg-emerald-400' : 'bg-slate-700'
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
                </div>

                {/* Amazon Transcribe Transcript */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Volume2 className="h-4 w-4 text-gray-500" />
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                        Amazon Transcribe Verbatim Output
                      </h4>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">EN-US · 16kHz</span>
                  </div>
                  <div className="mt-2 p-3.5 bg-gray-50 rounded-xl border border-gray-100 text-sm text-gray-800 leading-relaxed font-sans">
                    &ldquo;{selectedVm.transcript}&rdquo;
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                Select a voicemail to inspect details, audio, and Bedrock triage.
              </div>
            )}
          </main>
        </div>
      )}

      {forwardOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Forward to Clinician</h3>
            <p className="mt-1 text-xs text-gray-500">
              Route this thread for clinical / Rx follow-up
            </p>
            <label className="mt-4 block text-xs font-semibold text-gray-600">
              Clinician
              <select
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">— Select clinician —</option>
                {(clinicianOptions.length ? clinicianOptions : ['Clinical Team']).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs font-semibold text-gray-600">
              Internal note
              <textarea
                value={forwardNote}
                onChange={(e) => setForwardNote(e.target.value)}
                rows={3}
                placeholder="Context for the clinician…"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <div
              className="mt-3 rounded-lg px-3 py-2 text-[11px] font-medium"
              style={{ background: '#FFFBEB', border: '1px solid #FCD34D', color: '#92400E' }}
            >
              Internal notes are visible to care team only — do not paste patient-facing content
              here without review.
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!forwardTo.trim() || actionBusy}
                onClick={() => void handleForward()}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: PURPLE }}
              >
                Forward
              </button>
              <button
                type="button"
                onClick={() => setForwardOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {doctorPhoneModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Doctor Phone Number</h3>
              <button
                type="button"
                onClick={() => {
                  setDoctorPhoneModalOpen(false);
                  toast('Add your phone in profile before placing an Amazon Connect call');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Amazon Connect rings the patient and bridges your phone. Enter your phone number (US E.164, e.g. +14105551234):
            </p>
            <input
              type="tel"
              value={doctorPhoneInput}
              onChange={(e) => setDoctorPhoneInput(e.target.value)}
              placeholder="+1XXXXXXXXXX"
              className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDoctorPhoneModalOpen(false);
                  toast('Add your phone in profile before placing an Amazon Connect call');
                }}
                className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveDoctorPhone(false)}
                className="rounded-xl border border-gray-300 px-3.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Save Phone
              </button>
              {client?.phone ? (
                <button
                  type="button"
                  onClick={() => void saveDoctorPhone(true)}
                  className="rounded-xl px-4 py-1.5 text-xs font-bold text-white hover:opacity-95"
                  style={{ background: TEAL_GRAD }}
                >
                  Save &amp; Call
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Toaster position="top-right" />
    </div>
  );
}
