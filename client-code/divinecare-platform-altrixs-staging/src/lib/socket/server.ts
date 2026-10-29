import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'node:http';
import { subscribeToThread, type RealtimeMessageEvent } from '../messages/realtime';

export type SocketUser = {
  id: string;
  name: string;
  role: 'doctor' | 'clinician' | 'patient' | 'staff';
};

declare global {
  // eslint-disable-next-line no-var
  var __altrixsSocketIO: SocketIOServer | undefined;
}

/**
 * Initializes or returns the global Socket.io Server instance.
 */
export function getSocketIOServer(httpServer?: HTTPServer): SocketIOServer | null {
  if (globalThis.__altrixsSocketIO) {
    return globalThis.__altrixsSocketIO;
  }

  if (!httpServer) {
    return null;
  }

  const io = new SocketIOServer(httpServer, {
    path: '/api/socket/io',
    addTrailingSlash: false,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Track online users across threads
  const onlineUsers = new Map<string, { socketId: string; user: SocketUser }>();

  io.on('connection', (socket: Socket) => {
    // 1. Authenticate / Register User Presence
    socket.on('register_user', (user: SocketUser) => {
      if (!user?.id) return;
      socket.data.user = user;
      onlineUsers.set(user.id, { socketId: socket.id, user });

      // Broadcast user online status
      io.emit('presence_change', {
        userId: user.id,
        status: 'online',
        user,
      });
    });

    // 2. Join 1-on-1 Chat Thread Room
    socket.on('join_thread', ({ threadId, user }: { threadId: string; user?: SocketUser }) => {
      if (!threadId) return;
      const room = `thread:${threadId}`;
      socket.join(room);

      if (user) {
        socket.data.user = user;
      }

      // Subscribe local EventEmitter to push events to Socket.io room subscribers
      const unsubscribe = subscribeToThread(threadId, (event: RealtimeMessageEvent) => {
        io.to(room).emit('new_message', event);
      });

      socket.once('leave_thread', () => {
        socket.leave(room);
        unsubscribe();
      });
    });

    // 3. Typing Status Broadcast ("Doctor is typing...")
    socket.on('typing_start', ({ threadId, user }: { threadId: string; user: SocketUser }) => {
      if (!threadId) return;
      socket.to(`thread:${threadId}`).emit('typing_status', {
        threadId,
        isTyping: true,
        user,
      });
    });

    socket.on('typing_stop', ({ threadId, user }: { threadId: string; user: SocketUser }) => {
      if (!threadId) return;
      socket.to(`thread:${threadId}`).emit('typing_status', {
        threadId,
        isTyping: false,
        user,
      });
    });

    // 4. Handle Disconnect & Presence Cleanup
    socket.on('disconnect', () => {
      const user = socket.data.user as SocketUser | undefined;
      if (user?.id) {
        onlineUsers.delete(user.id);
        io.emit('presence_change', {
          userId: user.id,
          status: 'offline',
          user,
        });
      }
    });
  });

  globalThis.__altrixsSocketIO = io;
  return io;
}

/**
 * Broadcasts a new message directly to a Socket.io thread room.
 */
export function emitSocketMessage(threadId: string, event: RealtimeMessageEvent) {
  const io = globalThis.__altrixsSocketIO;
  if (io) {
    io.to(`thread:${threadId}`).emit('new_message', event);
  }
}
