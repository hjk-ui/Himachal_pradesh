/**
 * Clinician "Today" panel (therapist / prescriber homes): pure helpers shared by
 * GET /api/dashboard/today, the TodayPanel component and tests. No I/O.
 */
import type { DocLight } from '@/lib/appointments/docLight';

export type TodayVisit = {
  id: string;
  /** null for a protected record the viewer cannot open */
  clientId: string | null;
  clientName: string;
  protected: boolean;
  type: string;
  /** HH:mm practice clock */
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  /** UI visit status (scheduled | checked-in | in-session | completed | no-show | late-cancel) */
  status: string;
  noteStatus: 'not-started' | 'ai-draft' | 'in-progress' | 'signed';
  isVirtual: boolean;
  groupSessionId: string | null;
  docLight: DocLight;
  /** Newest linked unsigned note, when any */
  draftNoteId: string | null;
  /** The draft has nothing blocking signature (same rule as "Awaiting my signature") */
  draftReady: boolean;
  /** Signing the draft now needs a late-entry reason (past the practice deadline) */
  lateEntryRequired: boolean;
  /** The client already has a future visit booked (no "Book follow-up" needed) */
  hasFollowUp: boolean;
};

export type TodayPanelData = {
  date: string;
  timeZone: string;
  generatedAt: string;
  visits: TodayVisit[];
  /** Visit highlighted as "Next" (in session, else the next one not yet started) */
  nextVisitId: string | null;
  notes: { done: number; total: number };
  /** Inbox items waiting (null when the role has no inbox or it could not load) */
  inbox: { toDo: number; urgent: number } | null;
};

export type TodayAction =
  | { kind: 'start'; label: 'Start session' }
  | { kind: 'finish'; label: 'Finish note' }
  | { kind: 'sign'; label: 'Sign' }
  | { kind: 'follow_up'; label: 'Book follow-up' }
  | { kind: 'none'; label: string };

const NO_NOTE_STATUSES = new Set(['cancelled', 'late-cancel']);

/** One primary action per visit, changing with its state. */
export function todayPrimaryAction(v: Pick<TodayVisit, 'status' | 'docLight' | 'draftNoteId' | 'draftReady' | 'hasFollowUp' | 'protected' | 'clientId'>): TodayAction {
  if (v.protected && !v.clientId) return { kind: 'none', label: 'Protected record' };
  if (v.docLight.tone === 'signed') return v.hasFollowUp ? { kind: 'none', label: 'Done' } : { kind: 'follow_up', label: 'Book follow-up' };
  if (v.docLight.label.startsWith('Signed')) return { kind: 'none', label: 'Waiting for co-signature' };
  if (NO_NOTE_STATUSES.has(v.status)) return { kind: 'none', label: 'No note needed' };
  if (v.draftNoteId && v.draftReady) return { kind: 'sign', label: 'Sign' };
  const ended = v.status === 'completed' || v.status === 'no-show' || v.docLight.dueAt !== null;
  if (v.draftNoteId || ended) return { kind: 'finish', label: 'Finish note' };
  return { kind: 'start', label: 'Start session' };
}

/** "Notes done today: 4 of 6": signed (and co-signed when required) of today's visits that need a note. */
export function todayNotesProgress(visits: Pick<TodayVisit, 'status' | 'docLight'>[]): { done: number; total: number } {
  const needing = visits.filter((v) => !NO_NOTE_STATUSES.has(v.status) || v.docLight.tone === 'signed');
  return { done: needing.filter((v) => v.docLight.tone === 'signed').length, total: needing.length };
}

/** In-session visit first, else the next visit that has not started (or the latest still running). */
export function nextTodayVisitId(visits: Pick<TodayVisit, 'id' | 'status' | 'startsAt' | 'endsAt'>[], now: Date): string | null {
  const live = visits.find((v) => v.status === 'in-session');
  if (live) return live.id;
  const t = now.getTime();
  const open = visits
    .filter((v) => v.status === 'scheduled' || v.status === 'checked-in')
    .filter((v) => new Date(v.endsAt).getTime() > t)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return open[0]?.id ?? null;
}

/** Everything for today is documented: at least one visit and every note signed. */
export function allCaughtUp(progress: { done: number; total: number }): boolean {
  return progress.total > 0 && progress.done === progress.total;
}

// ─── Celebration: once per day per user (localStorage) ──────────────────────

export const CELEBRATION_KEY_PREFIX = 'altrixs.today.celebrated.v1';

export function celebrationKey(userId: string): string {
  return `${CELEBRATION_KEY_PREFIX}:${userId}`;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * True the first time today's work is all signed, for this user and practice day; records it so
 * a reload (or the next poll) does not celebrate again. Storage errors never celebrate twice and
 * never throw.
 */
export function claimCelebration(storage: KeyValueStore | null, userId: string | null | undefined, ymd: string): boolean {
  if (!storage || !userId || !ymd) return false;
  try {
    const key = celebrationKey(userId);
    if (storage.getItem(key) === ymd) return false;
    storage.setItem(key, ymd);
    return true;
  } catch {
    return false;
  }
}
