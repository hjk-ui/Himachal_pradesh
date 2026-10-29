import { readTelehealthJoinToken } from '@/lib/telehealth/join-token';

export type SignalRole = 'staff' | 'client';
export type SignalType = 'offer' | 'answer' | 'ice' | 'hangup';

export type SignalMessage = {
  seq: number;
  from: SignalRole;
  type: SignalType;
  data: unknown;
};

type Room = {
  nextSeq: number;
  messages: SignalMessage[];
};

const rooms = new Map<string, Room>();

function roomKey(appointmentId: string) {
  return appointmentId;
}

export function resolveJoinToken(token: string) {
  const decoded = decodeURIComponent(token || '');
  return readTelehealthJoinToken(decoded);
}

export function pushSignal(appointmentId: string, msg: Omit<SignalMessage, 'seq'>) {
  const key = roomKey(appointmentId);
  const room = rooms.get(key) || { nextSeq: 1, messages: [] };
  const full: SignalMessage = { ...msg, seq: room.nextSeq };
  room.nextSeq += 1;
  room.messages.push(full);
  if (room.messages.length > 80) room.messages = room.messages.slice(-40);
  rooms.set(key, room);
  return full;
}

export function listSignals(appointmentId: string, afterSeq: number) {
  const room = rooms.get(roomKey(appointmentId));
  if (!room) return [];
  return room.messages.filter((m) => m.seq > afterSeq);
}
