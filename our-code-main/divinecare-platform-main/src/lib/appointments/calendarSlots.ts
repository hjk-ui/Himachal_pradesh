/** Click-to-book helpers — Oct 26. SLOT_MINUTES = 15. */

export const SLOT_MINUTES = 15;
export const BOOK_BUSY_SELECTOR = '[data-busy="true"]';
export const CLICK_HINT_DAY = 'Click an empty time to book';
export const CLICK_HINT_WEEK = 'Click an empty spot to book on this day';
export const DRAG_IGNORE_PX = 6;

export type PickedSlot = {
  date: string;
  startTime: string; // HH:MM
  clinicianId?: string;
  clientFirstName?: string | null;
};

export function clock12(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(':');
  let h = Number(hRaw);
  const m = Number(mRaw) || 0;
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function clinicianFirstName(fullName?: string | null): string | null {
  if (!fullName?.trim()) return null;
  const cleaned = fullName.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
  return cleaned.split(/\s+/)[0] || null;
}

export function slotBookLabel(time: string, firstName?: string | null): string {
  const t = clock12(time);
  if (firstName) return `Book ${t} · ${firstName}`;
  return `Book ${t}`;
}

export function dayBookLabel(shortDay: string): string {
  return `Book on ${shortDay}`;
}

export function pickSlot(args: {
  y: number;
  hourPx: number;
  dayStartHour: number;
  dayEndHour: number;
  date: string;
  clinicianId?: string;
}): PickedSlot {
  const minutesFromStart = Math.max(0, Math.floor((args.y / args.hourPx) * 60));
  const snapped = Math.round(minutesFromStart / SLOT_MINUTES) * SLOT_MINUTES;
  const total = args.dayStartHour * 60 + snapped;
  const capped = Math.min(
    args.dayEndHour * 60 - SLOT_MINUTES,
    Math.max(args.dayStartHour * 60, total)
  );
  const hh = String(Math.floor(capped / 60)).padStart(2, '0');
  const mm = String(capped % 60).padStart(2, '0');
  return {
    date: args.date,
    startTime: `${hh}:${mm}`,
    clinicianId: args.clinicianId,
  };
}

export function bookButtonPlacement(args: {
  y: number;
  containerHeight: number;
  buttonHeight?: number;
}): { top: number } {
  const h = args.buttonHeight ?? 36;
  const top = Math.min(Math.max(args.y - h / 2, 4), Math.max(4, args.containerHeight - h - 4));
  return { top };
}

export function isBusyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(BOOK_BUSY_SELECTOR) || target.closest('button'));
}
