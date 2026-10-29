'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RealtimeMessageEvent } from '@/lib/messages/realtime';

export type SocketChatUser = {
  id: string;
  name: string;
  role: 'doctor' | 'clinician' | 'patient' | 'staff';
};

export type UseSocketChatOptions = {
  threadId: string | null;
  user: SocketChatUser | null;
  onNewMessage?: (event: RealtimeMessageEvent) => void;
};

export function useSocketChat({ threadId, user, onNewMessage }: UseSocketChatOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [partnerPresence, setPartnerPresence] = useState<'online' | 'offline'>('offline');
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Socket.io connection
  useEffect(() => {
    // `next start` has no socket server (a route handler can't reach the HTTP server), so the handshake always fails.
    // Messages already arrive through the thread stream + poll in useMessages; typing/presence stays off until a
    // standalone, authenticated socket service exists.
    if (typeof window === 'undefined' || process.env.NEXT_PUBLIC_SOCKET_CHAT !== '1') return;

    const socket = io({
      path: '/api/socket/io',
      addTrailingSlash: false,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (user) {
        socket.emit('register_user', user);
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('presence_change', (payload: { userId: string; status: 'online' | 'offline' }) => {
      if (user && payload.userId !== user.id) {
        setPartnerPresence(payload.status);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  // Join/Leave thread rooms when selected thread changes
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !threadId) return;

    socket.emit('join_thread', { threadId, user });
    setIsPartnerTyping(false);

    const handleNewMessage = (event: RealtimeMessageEvent) => {
      if (event.threadId === threadId && onNewMessage) {
        onNewMessage(event);
      }
    };

    const handleTypingStatus = (payload: { threadId: string; isTyping: boolean; user?: SocketChatUser }) => {
      if (payload.threadId === threadId && (!user || payload.user?.id !== user.id)) {
        setIsPartnerTyping(payload.isTyping);
      }
    };

    socket.on('new_message', handleNewMessage);
    socket.on('typing_status', handleTypingStatus);

    return () => {
      socket.emit('leave_thread', { threadId });
      socket.off('new_message', handleNewMessage);
      socket.off('typing_status', handleTypingStatus);
    };
  }, [threadId, user, onNewMessage]);

  // Handle local typing start & debounced auto-stop
  const sendTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !threadId || !user) return;

    socket.emit('typing_start', { threadId, user });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing_stop', { threadId, user });
    }, 2000);
  }, [threadId, user]);

  const stopTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !threadId || !user) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socket.emit('typing_stop', { threadId, user });
  }, [threadId, user]);

  return {
    connected,
    isPartnerTyping,
    partnerPresence,
    sendTyping,
    stopTyping,
  };
}
