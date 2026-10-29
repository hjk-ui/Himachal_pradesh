import { apiJson } from '@/lib/api-client';
import type { Message, Thread, ThreadStatus } from '../types';

export async function fetchThreads(): Promise<Thread[]> {
  const data = await apiJson<{ success: true; threads: Thread[] }>('/api/messages/threads');
  return data.threads;
}

export async function createOrGetThread(
  clientId: string,
  topic?: string
): Promise<Thread> {
  const data = await apiJson<{ success: true; thread: Thread }>(
    '/api/messages/threads',
    { method: 'POST', body: JSON.stringify({ clientId, topic }) }
  );
  return data.thread;
}

export async function fetchThreadMessages(
  threadId: string,
  options?: { limit?: number; before?: string | null }
): Promise<{
  messages: Message[];
  thread: Thread;
  hasMore?: boolean;
  oldestMessageId?: string | null;
}> {
  const query = new URLSearchParams();
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.before) query.set('before', options.before);
  const qStr = query.toString() ? `?${query.toString()}` : '';
  const data = await apiJson<{
    success: true;
    messages: Message[];
    thread: Thread;
    hasMore?: boolean;
    oldestMessageId?: string | null;
  }>(`/api/messages/threads/${threadId}/messages${qStr}`);
  return {
    messages: data.messages,
    thread: data.thread,
    hasMore: !!data.hasMore,
    oldestMessageId: data.oldestMessageId ?? null,
  };
}

export async function sendThreadMessage(threadId: string, content: string): Promise<{
  message: Message;
  thread: Thread;
}> {
  const data = await apiJson<{ success: true; message: Message; thread: Thread }>(
    `/api/messages/threads/${threadId}/messages`,
    { method: 'POST', body: JSON.stringify({ content }) }
  );
  return { message: data.message, thread: data.thread };
}

export async function patchThread(
  threadId: string,
  body: {
    status?: ThreadStatus;
    forwardedTo?: string;
    forwardNote?: string;
    assignedStaff?: string;
  }
): Promise<Thread> {
  const data = await apiJson<{ success: true; thread: Thread }>(
    `/api/messages/threads/${threadId}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  );
  return data.thread;
}

/** @deprecated */
export async function fetchMessages(clientOrThreadId: string) {
  const data = await fetchThreadMessages(clientOrThreadId);
  return { messages: data.messages, clientName: data.thread.clientName };
}

/** @deprecated */
export async function sendMessage(threadId: string, content: string) {
  const data = await sendThreadMessage(threadId, content);
  return data.message;
}
