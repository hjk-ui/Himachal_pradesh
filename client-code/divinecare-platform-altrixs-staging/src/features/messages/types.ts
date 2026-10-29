export type ThreadStatus = 'waiting' | 'in-progress' | 'forwarded' | 'resolved';
export type MessageRisk = 'high' | 'medium' | 'low';
export type ThreadTopic = 'scheduling' | 'billing' | 'general' | 'clinical' | 'rx-refill';
export type SenderType = 'front-office' | 'patient' | 'clinician-note';

export interface Message {
  id: string;
  threadId?: string;
  senderId: 'staff' | 'client' | 'clinician-note';
  senderType?: SenderType;
  senderName: string;
  content: string;
  timestamp: string;
  createdAt?: string;
  read: boolean;
}

export interface Thread {
  id: string;
  clientId: string;
  clientName: string;
  topic: ThreadTopic;
  status: ThreadStatus;
  risk: MessageRisk;
  assignedStaff: string | null;
  forwardedTo: string | null;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageAt?: string | null;
  unreadCount: number;
}
