'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Forward,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { useMessages, useSocketChat } from '@/features/messages';
import { apiJson } from '@/lib/api-client';
import { RiskWatchBanner } from '@/lib/ai/riskWatch/RiskWatchBanner';
import { compareByLastName } from '@/lib/clients/listQuery';
import type { MessageRisk, ThreadStatus, ThreadTopic } from '@/features/messages';
import {
  Alert,
  Button,
  EmptyState,
  FOCUS_RING,
  FormField,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  Tabs,
  buttonClasses,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';

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



const TOPIC_TONE: Record<ThreadTopic, Tone> = {
  scheduling: 'info',
  billing: 'neutral',
  general: 'neutral',
  clinical: 'brand',
  'rx-refill': 'warning',
};

const STATUS_META: Record<
  ThreadStatus,
  { label: string; tone: Tone; Icon: typeof Clock }
> = {
  waiting: { label: 'Waiting', tone: 'warning', Icon: Clock },
  'in-progress': {
    label: 'In Progress',
    tone: 'info',
    Icon: MessageSquare,
  },
  forwarded: {
    label: 'Forwarded',
    tone: 'brand',
    Icon: ArrowRight,
  },
  resolved: {
    label: 'Resolved',
    tone: 'success',
    Icon: CheckCircle2,
  },
};

const RISK_TONE: Record<MessageRisk, Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

const STATUS_FILTERS: Array<{ key: 'all' | ThreadStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'forwarded', label: 'Forwarded' },
  { key: 'resolved', label: 'Resolved' },
];

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

  const currentUser = useMemo(() => {
    if (!user) return null;
    return {
      id: user.id || 'staff',
      name: user.displayName || 'Front Office',
      role: 'staff' as const,
    };
  }, [user]);

  const {
    connected: socketConnected,
    isPartnerTyping,
    sendTyping,
    stopTyping,
  } = useSocketChat({
    threadId: selectedId,
    user: currentUser,
  });

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [allClients, setAllClients] = useState<Array<{ id: string; name: string; email?: string | null; legalFirstName?: string | null; legalLastName?: string | null }>>([]);
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
    // A–Z by last name, then first (same order as the client list)
    const sorted = [...allClients].sort(compareByLastName);
    if (!q) return sorted.slice(0, 25);
    return sorted
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
    <Page width="full" className="flex h-[calc(100dvh-8.5rem)] min-h-[560px] flex-col pb-2 md:min-h-[700px]">
      <PageHeader
        title="Patient Communication"
        description="Front Office Portal"
        badges={
          <>
            <StatusBadge tone="brand">{unreadCount} unread</StatusBadge>
            <StatusBadge tone="warning">{waitingCount} waiting for reply</StatusBadge>
          </>
        }
        actions={
          <Button icon={<Plus />} onClick={openNewMessageModal}>
            New Message
          </Button>
        }
      >
        <Tabs
          variant="pill"
          label="Filter conversations by status"
          controlsPanels={false}
          items={STATUS_FILTERS}
          value={statusFilter}
          onChange={(key) => setStatusFilter(key)}
        />
      </PageHeader>

      <Alert tone="brand">
        <strong>Front Office Hub</strong> — use Forward to Clinician for clinical/Rx questions.
        Scheduling and billing can stay with front office.
      </Alert>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <aside
          className={`min-h-0 w-full shrink-0 flex-col border-r border-slate-200 md:flex md:w-80 lg:w-96 ${
            showThreadOnMobile ? 'hidden' : 'flex'
          }`}
        >
          <div className="border-b border-slate-200 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patients…"
                aria-label="Search patients"
                className={cx(inputClasses, 'pl-9')}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <LoadingState label="Loading threads…" />
            ) : filtered.length === 0 ? (
              <EmptyState
                compact
                icon={<MessageSquare />}
                title="No conversations match."
                description="Conversations with patients appear here. Clear the search or status filter, or start a new message."
              />
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
                    aria-current={active ? 'true' : undefined}
                    className={cx(
                      'w-full border-b border-r-2 border-b-slate-100 px-3 py-3 text-left transition',
                      FOCUS_RING,
                      'focus-visible:ring-inset focus-visible:ring-offset-0',
                      active ? 'border-r-blue-600 bg-blue-50' : 'border-r-transparent hover:bg-slate-50',
                    )}
                  >
                    <div className="flex gap-2.5">
                      <div className="relative shrink-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                          {initials(t.clientName)}
                        </div>
                        {t.risk === 'high' ? (
                          <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 p-0.5 text-white" title="High risk">
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            <span className="sr-only">High risk</span>
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {t.clientName}
                          </p>
                          <span className="shrink-0 text-[11px] text-slate-500">
                            {formatThreadTime(t.lastMessageAt, t.lastMessageTime)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-500">{t.lastMessage}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge size="sm" tone={TOPIC_TONE[t.topic]} className="capitalize">
                            {t.topic}
                          </StatusBadge>
                          <StatusBadge size="sm" tone={STATUS_META[t.status].tone} icon={<StIcon />}>
                            {STATUS_META[t.status].label}
                          </StatusBadge>
                          {t.unreadCount > 0 ? (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-semibold text-white">
                              {t.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        {t.assignedStaff ? (
                          <p className="mt-1 truncate text-[11px] text-slate-500">
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
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<MessageSquare />}
                title="Select a conversation"
                description="Choose a patient thread on the left to read and reply, or start a new message."
              />
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ArrowLeft />}
                    onClick={() => setShowThreadOnMobile(false)}
                    className="md:hidden"
                  >
                    Inbox
                  </Button>
                  <div className="relative shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                      {initials(selected.clientName)}
                    </div>
                    <span aria-hidden className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 max-w-full truncate text-base font-semibold text-slate-900">
                        {selected.clientName}
                      </h2>
                      <StatusBadge size="sm" tone={RISK_TONE[selected.risk]} className="capitalize">
                        {selected.risk} risk
                      </StatusBadge>
                      <StatusBadge size="sm" tone={STATUS_META[selected.status].tone}>
                        {STATUS_META[selected.status].label}
                      </StatusBadge>
                      <StatusBadge size="sm" tone="success" dot>
                        Live
                      </StatusBadge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      Topic: <span className="font-semibold capitalize">{selected.topic}</span>
                      {selected.assignedStaff ? ` · Assigned: ${selected.assignedStaff}` : ' · Unassigned'}
                      {selected.forwardedTo ? ` · Forwarded to ${selected.forwardedTo}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/clients/${selected.clientId}`}
                    className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  >
                    <User className="h-4 w-4" aria-hidden />
                    View Profile
                  </Link>
                  <Button variant="secondary" size="sm" icon={<Forward />} onClick={() => setForwardOpen(true)}>
                    Forward
                  </Button>
                  {selected.status !== 'resolved' ? (
                    <Button
                      size="sm"
                      icon={<CheckCircle2 />}
                      disabled={actionBusy}
                      onClick={() => void handleResolve()}
                    >
                      Resolve
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<RotateCcw />}
                      disabled={actionBusy}
                      onClick={() => void handleReopen()}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              </div>

              {/* Message feed */}
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
                <div
                  ref={chatContainerRef}
                  onScroll={handleContainerScroll}
                  className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4 sm:px-6"
                >
                  {threadLoading ? (
                    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 py-12 text-slate-500" role="status" aria-live="polite">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white ring-1 ring-slate-200">
                        <RefreshCw className="h-5 w-5 animate-spin text-blue-600" aria-hidden />
                      </span>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-700">Loading conversation…</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Fetching secure message history for {selected?.clientName || 'patient'}
                        </p>
                      </div>
                    </div>
                  ) : conversationItems.length === 0 ? (
                    <div className="flex h-full min-h-[300px] items-center justify-center">
                      <EmptyState
                        icon={<MessageSquare />}
                        title="No messages yet"
                        description={
                          <>
                            This conversation with{' '}
                            <span className="font-semibold text-slate-700">{selected?.clientName || 'patient'}</span> is
                            end-to-end isolated and secure. Send a message below to start chatting.
                          </>
                        }
                      />
                    </div>
                  ) : (
                    <>
                      {/* Load earlier messages button */}
                      {hasMore ? (
                        <div className="flex justify-center py-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<RefreshCw className={loadingEarlier ? 'animate-spin' : undefined} />}
                            onClick={() => void handleLoadEarlier()}
                            disabled={loadingEarlier}
                            className="rounded-full"
                          >
                            {loadingEarlier
                              ? 'Loading earlier messages…'
                              : 'Load earlier messages'}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-3 py-2 text-xs text-slate-500">
                          <span className="h-px w-12 bg-slate-200" />
                          <span>Beginning of secure conversation</span>
                          <span className="h-px w-12 bg-slate-200" />
                        </div>
                      )}

                      {conversationItems.map((item) => {
                        if (item.kind === 'date-separator') {
                          return (
                            <div key={item.key} className="my-3 flex justify-center">
                              <span className="rounded-full bg-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600">
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
                              className="mx-auto my-3 max-w-lg rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-center text-xs text-blue-900"
                            >
                              <div className="flex items-center justify-center gap-1.5 font-semibold text-blue-800">
                                <Lock className="h-3.5 w-3.5" aria-hidden />
                                <span>Internal Clinician Note · {m.senderName}</span>
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-slate-700">{m.content}</p>
                              <p className="mt-1 text-[11px] text-blue-700">{getMessageExactTime(m)}</p>
                            </div>
                          );
                        }

                        const mine = type === 'front-office';

                        return (
                          <div
                            key={item.key}
                            className={`my-1 flex ${mine ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`relative max-w-[80%] px-4 py-2.5 text-sm shadow-xs sm:max-w-[70%] ${
                                mine
                                  ? 'rounded-xl rounded-tr-xs bg-blue-600 text-white'
                                  : 'rounded-xl rounded-tl-xs border border-slate-200 bg-white text-slate-800'
                              }`}
                            >
                              {!mine && (
                                <p className="mb-0.5 text-[11px] font-semibold text-blue-700">
                                  {m.senderName}
                                </p>
                              )}
                              <p className="select-text whitespace-pre-wrap break-words text-[13.5px] leading-relaxed [overflow-wrap:anywhere]">
                                {m.content}
                              </p>
                              <div
                                className={`mt-1 flex select-none items-center justify-end gap-1 text-[11px] font-medium ${
                                  mine ? 'text-blue-100' : 'text-slate-500'
                                }`}
                              >
                                <span>{getMessageExactTime(m)}</span>
                                {mine && (
                                  <CheckCheck className="h-3.5 w-3.5 shrink-0 text-blue-100" aria-hidden />
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

                {/* Floating "Jump to latest" button */}
                {showScrollBottom && (
                  <IconButton
                    label="Jump to latest message"
                    icon={<ChevronDown className="h-5 w-5" />}
                    onClick={scrollToBottomSmooth}
                    className="absolute bottom-4 right-6 z-20 h-10 w-10 rounded-full border border-slate-200 bg-white text-blue-700 shadow-lg hover:bg-slate-50"
                  />
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-slate-200 bg-white p-3 sm:px-4">
                <RiskWatchBanner kind="message" threadId={selected.id} />
                {selected.risk === 'high' ? (
                  <Alert
                    tone="danger"
                    icon={<AlertTriangle />}
                    className="mb-2.5"
                    actions={
                      <Button variant="danger" size="sm" onClick={() => setForwardOpen(true)}>
                        Forward Now
                      </Button>
                    }
                  >
                    <span className="font-semibold">High-risk client — escalate clinical concerns promptly.</span>
                  </Alert>
                ) : null}

                {selected.status === 'resolved' ? (
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Thread resolved. Sending a message will reopen it as In Progress.
                  </p>
                ) : null}

                {isPartnerTyping ? (
                  <div className="mb-2 flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-slate-600" aria-live="polite">
                    <span className="flex items-center gap-1" aria-hidden>
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:300ms]" />
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
                    aria-label="Message"
                    className={cx(inputClasses, 'min-w-0 flex-1 py-2.5')}
                  />
                  <IconButton
                    label="Send message"
                    icon={<Send className="h-4 w-4" />}
                    disabled={sending || !newMessage.trim()}
                    onClick={handleSend}
                    className="h-10 w-10 shrink-0 bg-blue-600 text-white shadow-xs hover:bg-blue-700"
                  />
                </div>
                <p className="mt-1.5 px-1 text-[11px] text-slate-500">
                  HIPAA-compliant communication · Press Enter to send
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {forwardOpen && selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setForwardOpen(false)}
          />
          <div role="dialog" aria-modal="true" aria-labelledby="forward-dialog-title" className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <h2 id="forward-dialog-title" className="text-base font-semibold text-slate-900">Forward to Clinician</h2>
              <IconButton
                label="Close forward dialog"
                icon={<X className="h-5 w-5" />}
                onClick={() => setForwardOpen(false)}
                showTooltip={false}
                className="p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              />
            </div>
            <div className="space-y-4 p-5">
              <FormField label="Clinician">
                <select
                  className={inputClasses}
                  value={forwardTo}
                  onChange={(e) => setForwardTo(e.target.value)}
                >
                  {(clinicianOptions.length > 0 ? clinicianOptions : ['No staff found']).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Internal note">
                <textarea
                  className={cx(inputClasses, 'h-24 resize-none')}
                  value={forwardNote}
                  onChange={(e) => setForwardNote(e.target.value)}
                  placeholder="Context for the clinician…"
                />
              </FormField>
              <Alert tone="warning" icon={<Lock />}>
                Patient won&apos;t see this internal note.
              </Alert>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
              <Button variant="secondary" onClick={() => setForwardOpen(false)}>
                Cancel
              </Button>
              <Button icon={<Forward />} disabled={actionBusy} onClick={() => void handleForward()}>
                Forward
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {newModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setNewModalOpen(false)}
          />
          <div role="dialog" aria-modal="true" aria-labelledby="new-conversation-title" className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
                  <MessageSquare className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 id="new-conversation-title" className="text-base font-semibold text-slate-900">Start New Conversation</h2>
                  <p className="text-xs text-slate-500">Select a patient to send a message</p>
                </div>
              </div>
              <IconButton
                label="Close new conversation dialog"
                icon={<X className="h-5 w-5" />}
                onClick={() => setNewModalOpen(false)}
                showTooltip={false}
                className="p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              />
            </div>

            <div className="p-5">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="text"
                  autoFocus
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search patient by name or email…"
                  aria-label="Search patient by name or email"
                  className={cx(inputClasses, 'pl-9')}
                />
              </div>

              <div className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {clientsLoading ? (
                  <LoadingState label="Loading patients…" className="py-6" />
                ) : filteredClients.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-500">
                    {clientSearch ? 'No patients found matching your search.' : 'No patients available.'}
                  </p>
                ) : (
                  filteredClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={startingChat}
                      onClick={() => void handleSelectClient(c.id)}
                      className={cx(
                        'flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-slate-50 disabled:opacity-50',
                        FOCUS_RING,
                        'focus-visible:ring-inset focus-visible:ring-offset-0',
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                        {c.email ? <p className="truncate text-xs text-slate-500">{c.email}</p> : null}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-blue-700">
                        Message
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 bg-slate-50/60 px-5 py-3">
              <Button variant="secondary" onClick={() => setNewModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
