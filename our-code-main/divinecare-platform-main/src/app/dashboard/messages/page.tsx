'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { AdminVendorLink } from '@/components/drfirst/AdminVendorLink';
import { useMessages } from '@/features/messages';
import { apiJson } from '@/lib/api-client';
import type { MessageRisk, ThreadStatus, ThreadTopic } from '@/features/messages';

const INDIGO = '#6366F1';
const PURPLE = '#7C3AED';
const GRADIENT = 'linear-gradient(135deg, #6366F1, #7C3AED)';

function getDayDateLabel(dateStr?: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  const msgDateStr = d.toDateString();

  if (msgDateStr === todayStr) return 'Today';
  if (msgDateStr === yesterdayStr) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/** Formats exact send time (e.g., "11:45 AM", "2:30 PM") exactly like WhatsApp / Instagram */
function getMessageExactTime(m: { createdAt?: string; timestamp?: string }): string {
  // 1. Try createdAt ISO date string
  if (m.createdAt) {
    const d = new Date(m.createdAt);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
  }

  // 2. Try timestamp field
  if (m.timestamp) {
    // If it's already an exact time like "10:30 AM" or "3:45 PM"
    if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(m.timestamp.trim())) {
      return m.timestamp.trim();
    }
    const d = new Date(m.timestamp);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
  }

  // 3. Fallback: use current time if newly sent or "Just now"
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** WhatsApp style relative timestamp in sidebar: "11:45 AM", "Yesterday", or "Sep 15" */
function formatThreadTime(lastMessageAt?: string | null, fallback?: string): string {
  if (lastMessageAt) {
    const d = new Date(lastMessageAt);
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
      }
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  if (fallback) {
    const trimmed = fallback.trim();
    if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
    return fallback;
  }

  return '';
}


const TOPIC_PILL: Record<ThreadTopic, string> = {
  scheduling: 'bg-indigo-50 text-indigo-700',
  billing: 'bg-emerald-50 text-emerald-700',
  general: 'bg-gray-100 text-gray-700',
  clinical: 'bg-purple-50 text-purple-700',
  'rx-refill': 'bg-amber-50 text-amber-800',
};

const STATUS_META: Record<
  ThreadStatus,
  { label: string; cls: string; Icon: typeof Clock }
> = {
  waiting: { label: 'Waiting', cls: 'bg-amber-50 text-amber-800', Icon: Clock },
  'in-progress': {
    label: 'In Progress',
    cls: 'bg-blue-50 text-blue-700',
    Icon: MessageSquare,
  },
  forwarded: {
    label: 'Forwarded',
    cls: 'bg-purple-50 text-purple-700',
    Icon: ArrowRight,
  },
  resolved: {
    label: 'Resolved',
    cls: 'bg-emerald-50 text-emerald-700',
    Icon: CheckCircle2,
  },
};

const RISK_PILL: Record<MessageRisk, string> = {
  high: 'bg-red-50 text-red-700',
  medium: 'bg-amber-50 text-amber-800',
  low: 'bg-emerald-50 text-emerald-700',
};

function initials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

export default function MessagesPage() {
  const { user } = useAuth();
  const {
    threads,
    selectedId,
    messages,
    hasMore,
    loadingEarlier,
    loadEarlierMessages,
    loading,
    threadLoading,
    sending,
    error,
    openThread,
    send,
    updateThread,
    loadThreads,
    startThreadWithClient,
  } = useMessages();

  const [newMessage, setNewMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ThreadStatus>('all');
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [clinicianOptions, setClinicianOptions] = useState<string[]>([]);
  const [forwardNote, setForwardNote] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);

  const isPartnerTyping = false;
  const sendTyping = () => {};
  const stopTyping = () => {};

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [allClients, setAllClients] = useState<Array<{ id: string; name: string; email?: string | null }>>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientsLoading, setClientsLoading] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const loadedThreadIdRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef<number>(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const openNewMessageModal = async () => {
    setNewModalOpen(true);
    setClientSearch('');
    if (allClients.length === 0) {
      setClientsLoading(true);
      try {
        const res = await apiJson<{ success: true; clients: Array<{ id: string; name: string; email?: string | null }> }>('/api/clients');
        if (res.success && Array.isArray(res.clients)) {
          setAllClients(res.clients);
        }
      } catch {
        // ignore
      } finally {
        setClientsLoading(false);
      }
    }
  };

  const handleSelectClient = async (clientId: string) => {
    setStartingChat(true);
    try {
      await startThreadWithClient(clientId);
      setNewModalOpen(false);
      setShowThreadOnMobile(true);
    } catch {
      // hook sets error
    } finally {
      setStartingChat(false);
    }
  };

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return allClients.slice(0, 25);
    return allClients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q))
      )
      .slice(0, 25);
  }, [allClients, clientSearch]);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ success: true; users: Array<{ id: string; name: string; role: string }> }>('/api/staff/directory')
      .then((res) => {
        if (cancelled) return;
        const names = res.users.map((u) => u.name).filter(Boolean);
        setClinicianOptions(names);
        setForwardTo((prev) => prev || names[0] || '');
      })
      .catch(() => {
        if (!cancelled) setClinicianOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // WhatsApp / Instagram Real-time Scroll Engine:
  // 1. On conversation opening / switching / initial message load:
  //    INSTANTLY position at the very bottom (latest message) with 0ms delay and NO top-to-bottom sliding animation.
  // 2. On new single message arriving / sent:
  //    Smoothly glide to the bottom only if the user is currently at the bottom.
  const scrollToBottomInstant = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  const scrollToBottomSmooth = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    if (!selectedId) return;

    // Check if thread switched
    if (loadedThreadIdRef.current !== selectedId) {
      loadedThreadIdRef.current = selectedId;
      prevMessageCountRef.current = messages.length;
      setShowScrollBottom(false);

      // Instantly position at the latest message
      scrollToBottomInstant();
      requestAnimationFrame(() => {
        scrollToBottomInstant();
      });
      return;
    }

    // Thread is the same, but messages just loaded from API (from 0 to N)
    if (prevMessageCountRef.current === 0 && messages.length > 0) {
      prevMessageCountRef.current = messages.length;
      scrollToBottomInstant();
      requestAnimationFrame(() => {
        scrollToBottomInstant();
      });
      return;
    }

    // New messages arrived in an already open thread
    if (messages.length > prevMessageCountRef.current) {
      const container = chatContainerRef.current;
      if (container) {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 180;
        if (isNearBottom) {
          scrollToBottomSmooth();
        } else {
          setShowScrollBottom(true);
        }
      }
      prevMessageCountRef.current = messages.length;
    }
  }, [messages, selectedId]);

  const handleLoadEarlier = async () => {
    if (loadingEarlier || !hasMore || !chatContainerRef.current) return;
    const container = chatContainerRef.current;
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    const ok = await loadEarlierMessages();
    if (ok) {
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
        }
      });
    }
  };

  const handleContainerScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollBottom(distanceFromBottom > 160);

    if (scrollTop <= 20 && hasMore && !loadingEarlier) {
      void handleLoadEarlier();
    }
  };

  const selected = threads.find((t) => t.id === selectedId) || null;

  const filtered = useMemo(
    () =>
      threads
        .filter((t) => t.clientName.toLowerCase().includes(search.toLowerCase()))
        .filter((t) => statusFilter === 'all' || t.status === statusFilter),
    [threads, search, statusFilter]
  );

  const unreadCount = threads.reduce((s, t) => s + t.unreadCount, 0);
  const waitingCount = threads.filter((t) => t.status === 'waiting').length;

  // WhatsApp / Instagram style grouping with date divider chips (Today, Yesterday, Date)
  const conversationItems = useMemo(() => {
    if (!selectedId) return [];
    const seen = new Set<string>();
    const deduplicated = messages
      .filter((m) => !m.threadId || m.threadId === selectedId)
      .filter((m) => {
        if (!m?.id) return false;
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

    const items: Array<
      | { kind: 'date-separator'; label: string; key: string }
      | { kind: 'message'; msg: (typeof messages)[0]; key: string }
    > = [];

    let lastLabel: string | null = null;
    deduplicated.forEach((m, idx) => {
      const label = getDayDateLabel(m.createdAt || m.timestamp);
      if (label && label !== lastLabel) {
        items.push({
          kind: 'date-separator',
          label,
          key: `sep-${label}-${idx}`,
        });
        lastLabel = label;
      }
      items.push({
        kind: 'message',
        msg: m,
        key: m.id ? `${m.id}-${idx}` : `msg-${idx}`,
      });
    });

    return items;
  }, [messages, selectedId]);

  const handleSend = () => {
    const text = newMessage.trim();
    if (!text) return;
    setNewMessage('');
    stopTyping();
    void send(text).catch(() => {
      /* hook stores error */
    });
    // Smooth glide down for sender's own new outgoing message
    requestAnimationFrame(() => {
      scrollToBottomSmooth();
    });
  };


  const handleResolve = async () => {
    if (!selectedId) return;
    setActionBusy(true);
    try {
      await updateThread(selectedId, { status: 'resolved' });
      await loadThreads();
    } finally {
      setActionBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!selectedId) return;
    setActionBusy(true);
    try {
      await updateThread(selectedId, { status: 'in-progress' });
      await loadThreads();
    } finally {
      setActionBusy(false);
    }
  };

  const handleForward = async () => {
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
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] min-h-[700px] w-full max-w-7xl flex-col space-y-3 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Communication</h1>
          <AdminVendorLink screen="message" />
          <p className="mt-0.5 text-sm text-gray-500">Front Office Portal</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <button
            type="button"
            onClick={openNewMessageModal}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            <Plus size={16} />
            New Message
          </button>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">
            {unreadCount} unread
          </span>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
            {waitingCount} waiting for reply
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['all', 'All'],
            ['waiting', 'Waiting'],
            ['in-progress', 'In Progress'],
            ['forwarded', 'Forwarded'],
            ['resolved', 'Resolved'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={`inline-flex items-center rounded-xl px-3 py-1.5 text-xs font-semibold ${
              statusFilter === key ? 'text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
            style={statusFilter === key ? { background: INDIGO } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-3.5 py-2 text-xs text-indigo-900">
        <strong>Front Office Hub</strong> — use Forward to Clinician for clinical/Rx questions.
        Scheduling and billing can stay with front office.
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-[550px] min-w-0 flex-1 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <aside
          className={`min-h-0 w-full shrink-0 flex-col border-r border-gray-100 md:flex md:w-80 lg:w-96 ${
            showThreadOnMobile ? 'hidden' : 'flex'
          }`}
        >
          <div className="border-b border-gray-100 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patients…"
                className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-gray-500">Loading threads…</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No conversations match.</p>
            ) : (
              filtered.map((t) => {
                const active = t.id === selectedId;
                const StIcon = STATUS_META[t.status].Icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setShowThreadOnMobile(true);
                      void openThread(t.id);
                    }}
                    className={`w-full border-b border-gray-50 px-3 py-3 text-left transition ${
                      active ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                    style={active ? { borderRight: `2px solid ${INDIGO}` } : undefined}
                  >
                    <div className="flex gap-2.5">
                      <div className="relative">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                          style={{ background: INDIGO }}
                        >
                          {initials(t.clientName)}
                        </div>
                        {t.risk === 'high' ? (
                          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white">
                            <AlertTriangle className="h-3 w-3" />
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {t.clientName}
                          </p>
                          <span className="shrink-0 text-[11px] text-gray-400">
                            {formatThreadTime(t.lastMessageAt, t.lastMessageTime)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-gray-500">{t.lastMessage}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${TOPIC_PILL[t.topic]}`}
                          >
                            {t.topic}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_META[t.status].cls}`}
                          >
                            <StIcon className="h-3 w-3" />
                            {STATUS_META[t.status].label}
                          </span>
                          {t.unreadCount > 0 ? (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
                              {t.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        {t.assignedStaff ? (
                          <p className="mt-1 text-[11px] text-gray-400">
                            Assigned: {t.assignedStaff}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section
          className={`min-h-0 min-w-0 flex-1 flex-col ${
            showThreadOnMobile ? 'flex' : 'hidden md:flex'
          }`}
        >
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              Select a conversation
            </div>
          ) : (
            <>
              {/* WhatsApp / Instagram Modern Chat Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowThreadOnMobile(false)}
                    className="inline-flex min-h-9 items-center rounded-xl border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 md:hidden"
                  >
                    &larr; Inbox
                  </button>
                  <div className="relative shrink-0">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-xs"
                      style={{ background: INDIGO }}
                    >
                      {initials(selected.clientName)}
                    </div>
                    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900 truncate">
                        {selected.clientName}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RISK_PILL[selected.risk]}`}
                      >
                        {selected.risk} risk
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_META[selected.status].cls}`}
                      >
                        {STATUS_META[selected.status].label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      Topic: <span className="font-semibold capitalize">{selected.topic}</span>
                      {selected.assignedStaff ? ` · Assigned: ${selected.assignedStaff}` : ' · Unassigned'}
                      {selected.forwardedTo ? ` · Forwarded to ${selected.forwardedTo}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/clients/${selected.clientId}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-xs"
                  >
                    <User size={13} />
                    View Profile
                  </Link>
                  <button
                    type="button"
                    onClick={() => setForwardOpen(true)}
                    className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-100 transition shadow-xs"
                  >
                    Forward
                  </button>
                  {selected.status !== 'resolved' ? (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleResolve()}
                      className="rounded-xl px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:opacity-95 transition"
                      style={{ background: INDIGO }}
                    >
                      Resolve
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleReopen()}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition shadow-xs"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>

              {/* Chat Feed Container - WhatsApp / Instagram Style */}
              <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden bg-slate-100/70">
                <div
                  ref={chatContainerRef}
                  onScroll={handleContainerScroll}
                  className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4 sm:px-6"
                >
                  {threadLoading ? (
                    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-slate-500 py-12">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-indigo-100 shadow-sm">
                        <RefreshCw className="h-5 w-5 text-indigo-600 animate-spin" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-700">Loading conversation…</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Fetching secure message history for {selected?.clientName || 'patient'}
                        </p>
                      </div>
                    </div>
                  ) : conversationItems.length === 0 ? (
                    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center px-4 py-12">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white border border-slate-200/80 shadow-xs">
                        <MessageSquare className="h-6 w-6 text-indigo-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">No messages yet</h3>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm">
                          This conversation with{' '}
                          <span className="font-semibold text-slate-700">{selected?.clientName || 'patient'}</span> is
                          end-to-end isolated and secure. Send a message below to start chatting.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Load earlier messages button */}
                      {hasMore ? (
                        <div className="flex justify-center py-2">
                          <button
                            type="button"
                            onClick={() => void handleLoadEarlier()}
                            disabled={loadingEarlier}
                            className="group inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/95 px-4 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 hover:border-indigo-300 active:scale-95 disabled:opacity-60"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 text-indigo-600 ${
                                loadingEarlier ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'
                              }`}
                            />
                            <span>
                              {loadingEarlier
                                ? 'Loading earlier messages…'
                                : 'Load earlier messages'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-3 py-2 text-xs text-slate-400">
                          <span className="h-px w-12 bg-slate-200" />
                          <span>Beginning of secure conversation</span>
                          <span className="h-px w-12 bg-slate-200" />
                        </div>
                      )}

                      {conversationItems.map((item) => {
                        if (item.kind === 'date-separator') {
                          return (
                            <div key={item.key} className="flex justify-center my-3">
                              <span className="rounded-full bg-slate-200/90 backdrop-blur-xs px-3 py-1 text-[11px] font-bold text-slate-600 shadow-2xs">
                                {item.label}
                              </span>
                            </div>
                          );
                        }

                        const m = item.msg;
                        const type =
                          m.senderType ||
                          (m.senderId === 'client'
                            ? 'patient'
                            : m.senderId === 'clinician-note'
                              ? 'clinician-note'
                              : 'front-office');

                        if (type === 'clinician-note') {
                          return (
                            <div
                              key={item.key}
                              className="my-3 mx-auto max-w-lg rounded-2xl border border-purple-200 bg-purple-50/90 p-3.5 text-center text-xs text-purple-950 shadow-xs"
                            >
                              <div className="flex items-center justify-center gap-1.5 font-bold text-purple-800">
                                <Lock size={13} />
                                <span>Internal Clinician Note · {m.senderName}</span>
                              </div>
                              <p className="mt-1 text-slate-700 whitespace-pre-wrap">{m.content}</p>
                              <p className="mt-1 text-[10px] text-purple-400">{getMessageExactTime(m)}</p>
                            </div>
                          );
                        }

                        const mine = type === 'front-office';

                        return (
                          <div
                            key={item.key}
                            className={`flex ${mine ? 'justify-end' : 'justify-start'} my-1`}
                          >
                            <div
                              className={`relative max-w-[80%] sm:max-w-[70%] px-4 py-2.5 text-sm shadow-xs ${
                                mine
                                  ? 'rounded-2xl rounded-tr-xs bg-gradient-to-r from-indigo-600 to-indigo-700 text-white'
                                  : 'rounded-2xl rounded-tl-xs bg-white border border-slate-200/80 text-slate-800'
                              }`}
                            >
                              {!mine && (
                                <p className="text-[11px] font-bold text-indigo-600 mb-0.5">
                                  {m.senderName}
                                </p>
                              )}
                              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed select-text">
                                {m.content}
                              </p>
                              <div
                                className={`mt-1 flex items-center justify-end gap-1 text-[10px] select-none ${
                                  mine ? 'text-indigo-200/90 font-medium' : 'text-slate-400 font-medium'
                                }`}
                              >
                                <span>{getMessageExactTime(m)}</span>
                                {mine && (
                                  <CheckCheck size={14} className="text-indigo-200 shrink-0" />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div ref={endRef} />
                </div>

                {/* WhatsApp Style Floating "Jump to Latest" Button */}
                {showScrollBottom && (
                  <button
                    type="button"
                    onClick={scrollToBottomSmooth}
                    className="absolute bottom-4 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg border border-slate-200 text-indigo-600 transition hover:bg-slate-50 hover:scale-105 active:scale-95 z-20"
                    title="Jump to latest message"
                  >
                    <ChevronDown size={20} />
                  </button>
                )}
              </div>

              {/* Modern WhatsApp / Instagram Style Input Area */}
              <div className="border-t border-slate-200 bg-white p-3 sm:px-4">
                {selected.risk === 'high' ? (
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50/90 px-3.5 py-2 text-xs text-red-800 shadow-2xs">
                    <span className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-red-600 shrink-0" />
                      High-risk client — escalate clinical concerns promptly.
                    </span>
                    <button
                      type="button"
                      onClick={() => setForwardOpen(true)}
                      className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700 transition"
                    >
                      Forward Now
                    </button>
                  </div>
                ) : null}

                {selected.status === 'resolved' ? (
                  <p className="mb-2 text-xs font-medium text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 size={13} />
                    Thread resolved. Sending a message will reopen it as In Progress.
                  </p>
                ) : null}

                {isPartnerTyping ? (
                  <div className="mb-2 flex items-center gap-2 rounded-full bg-slate-100 border border-slate-200 px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-2xs w-fit">
                    <span className="flex gap-1 items-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    <span>{selected.clientName} is typing…</span>
                  </div>
                ) : null}

                <div className="flex items-center gap-2.5">
                  <input
                    value={newMessage}
                    onChange={(e) => {
                      setNewMessage(e.target.value);
                      sendTyping();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={`Message as ${user?.displayName || 'Staff'}… (Enter to send)`}
                    className="flex-1 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/15"
                  />
                  <button
                    type="button"
                    disabled={sending || !newMessage.trim()}
                    onClick={handleSend}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-sm transition hover:opacity-95 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:hover:opacity-40"
                    title="Send message"
                  >
                    <Send size={17} />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400 px-1">
                  HIPAA-compliant communication · Press Enter to send
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {forwardOpen && selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setForwardOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Forward to Clinician</h3>
              <button type="button" onClick={() => setForwardOpen(false)}>
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <label className="block text-xs font-medium text-gray-600">
              Clinician
              <select
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
              >
                {(clinicianOptions.length > 0 ? clinicianOptions : ['No staff found']).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs font-medium text-gray-600">
              Internal note
              <textarea
                className="mt-1 h-24 w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                value={forwardNote}
                onChange={(e) => setForwardNote(e.target.value)}
                placeholder="Context for the clinician…"
              />
            </label>
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Patient won&apos;t see this internal note.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForwardOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleForward()}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ background: GRADIENT }}
              >
                Forward
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {newModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setNewModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                  style={{ background: INDIGO }}
                >
                  <MessageSquare size={16} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Start New Conversation</h3>
                  <p className="text-xs text-gray-500">Select a patient to send a message</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNewModalOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                autoFocus
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search patient by name or email…"
                className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50/50">
              {clientsLoading ? (
                <p className="p-4 text-center text-sm text-gray-500">Loading patients…</p>
              ) : filteredClients.length === 0 ? (
                <p className="p-4 text-center text-sm text-gray-500">
                  {clientSearch ? 'No patients found matching your search.' : 'No patients available.'}
                </p>
              ) : (
                filteredClients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={startingChat}
                    onClick={() => void handleSelectClient(c.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-white disabled:opacity-50"
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ background: INDIGO }}
                    >
                      {initials(c.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{c.name}</p>
                      {c.email ? <p className="truncate text-xs text-gray-400">{c.email}</p> : null}
                    </div>
                    <span className="text-xs font-medium text-indigo-600">Message &rarr;</span>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setNewModalOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
