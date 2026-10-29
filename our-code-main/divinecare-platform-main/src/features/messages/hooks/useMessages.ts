'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createOrGetThread,
  fetchThreadMessages,
  fetchThreads,
  patchThread,
  sendThreadMessage,
} from '../api/messagesApi';
import type { Message, Thread, ThreadStatus } from '../types';

export function useMessages() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Active thread ref to completely eliminate race conditions and message cross-contamination
  const activeThreadIdRef = useRef<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const list = await fetchThreads();
      setThreads(list);
      return list;
    } finally {
      setLoading(false);
    }
  }, []);

  const openThread = useCallback(async (threadId: string) => {
    // 1. Immediately track active thread
    activeThreadIdRef.current = threadId;
    setSelectedId(threadId);

    // 2. INSTANT CLEAN SLATE: wipe messages immediately so previous patient's chat NEVER bleeds through!
    setMessages([]);
    setThreadLoading(true);
    setError('');

    try {
      const data = await fetchThreadMessages(threadId, { limit: 50 });
      // If user quickly switched to another thread, discard this stale response
      if (activeThreadIdRef.current !== threadId) return;

      // 3. Strict thread isolation: only keep messages belonging to this thread
      const threadOnly = (data.messages || []).filter(
        (m) => !m.threadId || m.threadId === threadId
      );
      setMessages(threadOnly);
      setHasMore(!!data.hasMore);
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? { ...data.thread, unreadCount: 0 }
            : t
        )
      );
    } catch (err: unknown) {
      if (activeThreadIdRef.current === threadId) {
        setError(err instanceof Error ? err.message : 'Could not load conversation');
      }
    } finally {
      if (activeThreadIdRef.current === threadId) {
        setThreadLoading(false);
      }
    }
  }, []);

  const loadEarlierMessages = useCallback(async () => {
    if (!selectedId || loadingEarlier || !hasMore || messages.length === 0) return false;
    const oldestId = messages[0]?.id;
    if (!oldestId) return false;

    setLoadingEarlier(true);
    try {
      const data = await fetchThreadMessages(selectedId, { before: oldestId, limit: 40 });
      if (activeThreadIdRef.current !== selectedId) return false;

      if (data.messages && data.messages.length > 0) {
        const threadOnly = data.messages.filter(
          (m) => !m.threadId || m.threadId === selectedId
        );
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newEarlier = threadOnly.filter((m) => !existingIds.has(m.id));
          return [...newEarlier, ...prev];
        });
      }
      setHasMore(!!data.hasMore);
      return true;
    } catch {
      return false;
    } finally {
      setLoadingEarlier(false);
    }
  }, [selectedId, loadingEarlier, hasMore, messages]);

  const startThreadWithClient = useCallback(
    async (clientId: string) => {
      setError('');
      try {
        const thread = await createOrGetThread(clientId);
        setThreads((prev) => [thread, ...prev.filter((t) => t.id !== thread.id)]);
        await openThread(thread.id);
        return thread;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Could not start conversation';
        setError(msg);
        throw err;
      }
    },
    [openThread]
  );

  // Initial load: fetch sidebar threads immediately and select active thread
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const list = await fetchThreads();
        if (!isMounted) return;
        setThreads(list);
        setLoading(false); // Unblock sidebar immediately!

        const params = new URLSearchParams(window.location.search);
        const clientParam = params.get('client');
        let targetThreadId: string | null = null;
        if (clientParam) {
          const byClient = list.find((t) => t.clientId === clientParam);
          if (byClient) {
            targetThreadId = byClient.id;
          } else {
            try {
              const newThread = await createOrGetThread(clientParam);
              if (isMounted && newThread) {
                setThreads((prev) => [newThread, ...prev.filter((t) => t.id !== newThread.id)]);
                targetThreadId = newThread.id;
              }
            } catch {
              // Fallback to first thread if initialization fails
            }
          }
        }
        const first = targetThreadId || list[0]?.id || null;
        if (first && isMounted) await openThread(first);
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Could not load messages');
          setLoading(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [openThread]);

  // Real-time EventSource connection for instant (<50ms) message updates + resilient background sync
  useEffect(() => {
    if (!selectedId) return;

    let es: EventSource | null = null;
    let isMounted = true;

    try {
      es = new EventSource(`/api/messages/threads/${selectedId}/stream`);

      es.addEventListener('message', (event) => {
        if (!isMounted) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'new_message' && payload.staffMessage) {
            const incoming = payload.staffMessage as Message;
            // Strictly enforce: incoming message MUST belong to currently selected thread!
            if (incoming.threadId && incoming.threadId !== selectedId) return;

            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) {
                return prev;
              }
              return [...prev, incoming];
            });

            setThreads((prev) =>
              prev.map((t) =>
                t.id === selectedId
                  ? {
                      ...t,
                      lastMessage: incoming.content,
                      lastMessageAt: incoming.createdAt,
                      lastMessageTime: incoming.timestamp,
                    }
                  : t
              )
            );
          }
        } catch {
          // Ignore malformed event data
        }
      });
    } catch {
      // EventSource failed or unsupported; background poll below will handle it
    }

    // Safety fallback poll (runs every 6s to ensure synchronization even if connection is interrupted)
    const interval = setInterval(async () => {
      if (!isMounted || activeThreadIdRef.current !== selectedId) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const data = await fetchThreadMessages(selectedId, { limit: 20 });
        if (!isMounted || activeThreadIdRef.current !== selectedId) return;

        const threadOnly = (data.messages || []).filter(
          (m) => !m.threadId || m.threadId === selectedId
        );
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newOnes = threadOnly.filter((m) => !existingIds.has(m.id));
          if (newOnes.length === 0) return prev;
          return [...prev, ...newOnes];
        });
      } catch {
        // Silent error during background poll
      }
    }, 6000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      if (es) {
        es.close();
      }
    };
  }, [selectedId]);

  const send = async (content: string) => {
    if (!selectedId || !content.trim()) return;
    const text = content.trim();

    // 1. Instant Optimistic Message Append (0ms Latency)
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();
    const formattedNowTime = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const optimisticMsg: Message = {
      id: tempId,
      threadId: selectedId,
      senderType: 'front-office',
      senderId: 'staff',
      senderName: 'Front Office',
      content: text,
      read: true,
      createdAt: now.toISOString(),
      timestamp: formattedNowTime,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setError('');

    try {
      const data = await sendThreadMessage(selectedId, text);
      // Replace temp message with server confirmed message
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? data.message : m))
      );
      setThreads((prev) =>
        prev.map((t) => (t.id === selectedId ? data.thread : t))
      );
    } catch (err: unknown) {
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setError(err instanceof Error ? err.message : 'Could not send message');
      throw err;
    }
  };

  const updateThread = async (
    threadId: string,
    body: {
      status?: ThreadStatus;
      forwardedTo?: string;
      forwardNote?: string;
    }
  ) => {
    const updated = await patchThread(threadId, body);
    setThreads((prev) => prev.map((t) => (t.id === threadId ? updated : t)));
    if (body.forwardNote || body.forwardedTo) {
      await openThread(threadId);
    }
    return updated;
  };

  return {
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
    setError,
    loadThreads,
    openThread,
    send,
    updateThread,
    startThreadWithClient,
  };
}

/** @deprecated use useMessages */
export const useMessageInbox = useMessages;
