import type { Appointment } from './types';

/**
 * Day grid: pixel offset from the top of a clinician column -> "HH:MM" practice time, rounded down
 * to 15 minutes and kept inside the visible day (startHour..endHour, last slot 15 min before end).
 */
export function slotTimeFromOffset(y: number, hourPx: number, startHour: number, endHour: number): string {
  const minutes = Math.max(0, Math.floor(((y / hourPx) * 60) / 15) * 15);
  const total = Math.min(startHour * 60 + minutes, endHour * 60 - 15);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "Oct 22, 2026, 9:41 AM" in the practice time zone. */
export function formatStamp(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const VIA_TEXT: Record<string, string> = {
  online: 'Client, online booking page',
  portal: 'Client, patient portal',
  import: 'Imported from Valant',
  group: 'Added with the group session',
};

/** Appointment details "Booked by" line. */
export function bookedByText(appt: Pick<Appointment, 'bookedBy'>, timeZone: string, zoneLabel = ''): string {
  const b = appt.bookedBy;
  if (!b) return 'Not recorded';
  const when = b.at && b.via !== 'import' ? ` · ${formatStamp(b.at, timeZone)}${zoneLabel ? ` ${zoneLabel}` : ''}` : '';
  if (b.name) return `${b.name}${b.via === 'group' ? ' (group session)' : ''}${when}`;
  if (b.via && VIA_TEXT[b.via]) return `${VIA_TEXT[b.via]}${when}`;
  return 'Not recorded (booked before tracking started)';
}

// ---------------------------------------------------------------------------
// Click-to-book: one click (or tap) on empty calendar space selects a slot and
// shows a small "Book" button; double-click still opens the form directly.
// ---------------------------------------------------------------------------

export const SLOT_MINUTES = 15;

/** Day grid: snap a pixel offset to its 15-minute slot (clamped to calendar hours) and give its box. */
export function pickSlot(
  y: number,
  hourPx: number,
  startHour: number,
  endHour: number,
): { startTime: string; top: number; height: number } {
  const startTime = slotTimeFromOffset(y, hourPx, startHour, endHour);
  const [h, m] = startTime.split(':').map(Number);
  const top = ((h * 60 + m - startHour * 60) / 60) * hourPx;
  return { startTime, top, height: (SLOT_MINUTES / 60) * hourPx };
}

/**
 * Where the Book button goes: just below the selected slot, or above it when it would run past the
 * bottom of the column (never above the column top).
 */
export function bookButtonPlacement(
  slotTop: number,
  slotHeight: number,
  columnHeight: number,
  buttonHeight = 28,
  gap = 2,
): { top: number; flipped: boolean } {
  const below = slotTop + slotHeight + gap;
  if (below + buttonHeight <= columnHeight) return { top: below, flipped: false };
  return { top: Math.max(0, slotTop - buttonHeight - gap), flipped: true };
}

/** Week/month cell: keep the Book button inside the cell around where it was clicked. */
export function clampCellOffset(y: number, cellHeight: number, buttonHeight = 28, pad = 4): number {
  const max = Math.max(pad, cellHeight - buttonHeight - pad);
  return Math.round(Math.min(Math.max(y - buttonHeight / 2, pad), max));
}

/** "14:30" -> "2:30 PM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "Dr. Sarah Chen, LCPC" -> "Sarah". */
export function clinicianFirstName(name: string): string {
  const words = (name || '').split(',')[0].trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^(dr|mr|mrs|ms|mx|prof)\.?$/i.test(words[0])) words.shift();
  return words[0] || '';
}

/** Day view Book button: "Book 10:30 AM · Sarah" (no name for the unassigned column). */
export function slotBookLabel(startTime: string, clinicianName?: string): string {
  const first = clinicianName ? clinicianFirstName(clinicianName) : '';
  return `Book ${clock12(startTime)}${first ? ` · ${first}` : ''}`;
}

/** "2026-10-28" -> "Tue Oct 28". */
export function shortDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${wd} ${md}`;
}

/** Week/month Book button: "Book on Tue Oct 28". */
export function dayBookLabel(date: string): string {
  return `Book on ${shortDayLabel(date)}`;
}

/**
 * Schedule blocks are non-bookable (Lunch, Admin Time, Out of Office, Supervision) unless the block
 * marks open availability, which books like empty space.
 */
export function isBookableBlock(reasonOrType: string | null | undefined): boolean {
  return /^\s*(available|availability|open( time| slot| hours)?)\b/i.test(reasonOrType || '');
}

/** Elements inside the calendar that own their clicks; anything else is empty, bookable space. */
export const BOOK_BUSY_SELECTOR = 'button, a, input, select, textarea, label, [data-busy]';
