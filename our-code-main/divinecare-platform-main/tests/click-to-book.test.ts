import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  BOOK_BUSY_SELECTOR,
  bookButtonPlacement,
  CLICK_HINT_DAY,
  CLICK_HINT_WEEK,
  clock12,
  dayBookLabel,
  pickSlot,
  SLOT_MINUTES,
  slotBookLabel,
} from '../src/lib/appointments/calendarSlots';

describe('click-to-book', () => {
  it('helpers: 15-min slots, labels, busy selector', () => {
    assert.equal(SLOT_MINUTES, 15);
    assert.equal(BOOK_BUSY_SELECTOR, '[data-busy="true"]');
    assert.equal(CLICK_HINT_DAY, 'Click an empty time to book');
    assert.equal(CLICK_HINT_WEEK, 'Click an empty spot to book on this day');
    assert.equal(clock12('14:30'), '2:30 PM');
    assert.equal(slotBookLabel('09:00'), 'Book 9:00 AM');
    assert.equal(slotBookLabel('09:00', 'Maya'), 'Book 9:00 AM · Maya');
    assert.equal(dayBookLabel('Mon'), 'Book on Mon');
    const slot = pickSlot({
      y: 80,
      hourPx: 80,
      dayStartHour: 8,
      dayEndHour: 18,
      date: '2026-10-26',
      clinicianId: 'c1',
    });
    assert.equal(slot.startTime, '09:00');
    assert.equal(bookButtonPlacement({ y: 100, containerHeight: 880 }).top > 0, true);
  });

  it('appointments calendar uses single-click Book + side dialog', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/dashboard/appointments/page.tsx'), 'utf8');
    assert.match(page, /CLICK_HINT_DAY/);
    assert.match(page, /openBookFromPick/);
    assert.match(page, /role=\"dialog\"/);
    assert.match(page, /aria-labelledby=\"appt-form-title\"/);
    assert.match(page, /Schedule New Appointment/);
    assert.match(page, /Edit Appointment/);
    assert.match(page, /max-w-xl/);
    assert.match(page, /h-\[100dvh\]/);
    assert.match(page, /bg-slate-900\/30/);
    assert.match(page, /aria-modal=\"true\"/);
    assert.equal(/title=\"Double-click an empty time to book\"/.test(page), false);
  });
});
