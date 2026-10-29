import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOOK_BUSY_SELECTOR,
  bookButtonPlacement,
  clampCellOffset,
  clinicianFirstName,
  clock12,
  dayBookLabel,
  isBookableBlock,
  pickSlot,
  shortDayLabel,
  slotBookLabel,
} from '../src/features/appointments/calendarSlots';

const PAGE = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/appointments/page.tsx'), 'utf8');

test('pickSlot snaps to 15 minutes and clamps to calendar hours', () => {
  assert.deepEqual(pickSlot(0, 80, 8, 19), { startTime: '08:00', top: 0, height: 20 });
  assert.deepEqual(pickSlot(19, 80, 8, 19), { startTime: '08:00', top: 0, height: 20 });
  assert.deepEqual(pickSlot(200, 80, 8, 19), { startTime: '10:30', top: 200, height: 20 });
  assert.deepEqual(pickSlot(219, 80, 8, 19), { startTime: '10:30', top: 200, height: 20 });
  assert.equal(pickSlot(-50, 80, 8, 19).startTime, '08:00');
  const last = pickSlot(99999, 80, 8, 19);
  assert.equal(last.startTime, '18:45');
  assert.equal(last.top, 860);
});

test('Book button sits below the slot, flips above near the bottom, never above the top', () => {
  assert.deepEqual(bookButtonPlacement(200, 20, 880), { top: 222, flipped: false });
  assert.deepEqual(bookButtonPlacement(860, 20, 880), { top: 830, flipped: true });
  assert.deepEqual(bookButtonPlacement(840, 20, 880), { top: 810, flipped: true });
  assert.deepEqual(bookButtonPlacement(0, 20, 30), { top: 0, flipped: true });
});

test('week/month cell offset stays inside the cell', () => {
  assert.equal(clampCellOffset(0, 120), 4);
  assert.equal(clampCellOffset(60, 120), 46);
  assert.equal(clampCellOffset(500, 120), 88);
  assert.equal(clampCellOffset(10, 20), 4);
});

test('button labels', () => {
  assert.equal(clock12('10:30'), '10:30 AM');
  assert.equal(clock12('12:00'), '12:00 PM');
  assert.equal(clock12('14:15'), '2:15 PM');
  assert.equal(clinicianFirstName('Dr. Sarah Chen, LCPC'), 'Sarah');
  assert.equal(clinicianFirstName('Marcus Lee'), 'Marcus');
  assert.equal(clinicianFirstName(''), '');
  assert.equal(slotBookLabel('10:30', 'Dr. Sarah Chen'), 'Book 10:30 AM · Sarah');
  assert.equal(slotBookLabel('15:45'), 'Book 3:45 PM');
  assert.equal(shortDayLabel('2026-10-28'), 'Wed Oct 28');
  assert.equal(dayBookLabel('2026-10-27'), 'Book on Tue Oct 27');
});

test('availability blocks are bookable; lunch, admin, out of office, supervision are not', () => {
  for (const r of ['Available', 'availability', 'Open time', 'Open slot']) assert.equal(isBookableBlock(r), true, r);
  for (const r of ['Lunch', 'Admin Time', 'Out of Office', 'Supervision', '', null, undefined, 'Unavailable']) {
    assert.equal(isBookableBlock(r), false, String(r));
  }
  assert.match(BOOK_BUSY_SELECTOR, /button/);
  assert.match(BOOK_BUSY_SELECTOR, /\[data-busy\]/);
});

test('schedule page: single click selects, double-click kept, touch, keyboard, Escape', () => {
  // Single click on empty space selects a slot (day) or a cell (week/month); drags are ignored.
  assert.match(PAGE, /onClick=\{\(e\) => \{\s*\/\/ Only empty space[^\n]*\n\s*if \(!isEmptyBookTarget\(e\.target\) \|\| wasDrag\(e\)\) return;/);
  assert.match(PAGE, /setSlotPick\(\{\s*kind: 'slot'/);
  assert.equal((PAGE.match(/onClick=\{onCellClick\(/g) || []).length, 2);
  // Double-click still opens the form directly in day, week and month.
  assert.equal((PAGE.match(/onDoubleClick=\{/g) || []).length, 3);
  // Book button opens the form with date, time and clinician; it is focused so Enter books.
  assert.match(PAGE, /openCreateAt\(\{ date: slotPick\.date, startTime: slotPick\.startTime, clinicianId: slotPick\.clinicianId \}\)/);
  assert.match(PAGE, /ref=\{focusBookButton\}/);
  // Touch: no double-tap zoom, fast taps.
  assert.ok((PAGE.match(/touch-manipulation/g) || []).length >= 3);
  // Keyboard: hidden-until-focus Book buttons per column/day.
  assert.match(PAGE, /Book with \$\{col\.name\} on/);
  assert.match(PAGE, /focus:not-sr-only/);
  // Escape, clicking elsewhere and scrolling clear the selection.
  assert.match(PAGE, /e\.key === 'Escape'\) setSlotPick\(null\)/);
  assert.match(PAGE, /addEventListener\('scroll', onScroll, true\)/);
  assert.match(PAGE, /closest\?\.\('\[data-book-surface\]'\)\) setSlotPick\(null\)/);
  // Non-bookable blocks own their clicks and explain why.
  assert.match(PAGE, /data-busy=\{bookable \? undefined : '1'\}/);
  assert.match(PAGE, /`Blocked: \$\{blk\.reason\}`/);
  // Hover highlight only for a mouse pointer.
  assert.match(PAGE, /e\.pointerType !== 'mouse'/);
  // Hint text.
  assert.match(PAGE, /Click an empty time to book/);
  assert.doesNotMatch(PAGE, /Double-click an empty time to book|Double-click to book on this day/);
});

test('booking form opens as a side panel over the calendar (no scrolling back to the top), Escape closes it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/dashboard/appointments/page.tsx'), 'utf8');
  assert.match(src, /className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="appt-form-title"/);
  assert.match(src, /if \(e\.key === 'Escape' && !e\.defaultPrevented\) closeForm\(\)/);
});
