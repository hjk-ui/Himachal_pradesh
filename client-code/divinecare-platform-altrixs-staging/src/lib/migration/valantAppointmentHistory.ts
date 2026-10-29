/**
 * Valant appointment HISTORY import ("Biller Appointments" report, CSV export).
 * Pure: no prisma, no I/O. scripts/import-valant-appointment-history.ts loads the lookups and writes.
 *
 * Purpose: past visits so client "Last seen", session cadence and behavioral care-team links work from
 * go-live day. Rows become plain Appointment rows (source 'valant_history', stable externalKey) inserted
 * with createMany — never through createAppointment — so no reminder, telehealth room, charge, claim,
 * note or DrFirst hook runs.
 *
 * The real CSV headers are not known yet, so columns are found through a tolerant alias table
 * (HEADER_ALIASES). Layout quirks handled: BOM, quoted cells, a date given once as a day header row
 * ("Tuesday, July 1, 2025") and carried forward, "Notes: …" continuation rows, Excel serial dates,
 * 12h time ranges with one AM/PM ("11:30-12:20 PM"), separate start / end columns.
 *
 * Decisions (planValantHistory):
 *   - Client: Valant chart id (the "(ABC123)" in the patient cell, or a chart id column) -> Client.sourceId
 *     of a sourcePlatform 'valant' client (the client import's key). No match -> unmatched bucket; an exact
 *     name + DOB hit is a SUGGESTION only (never auto-linked).
 *   - NON-PATIENT rows (staff blocks) are skipped and counted.
 *   - Provider: ValantProviderMap first, then (optionally) the appointment importer's unique name match;
 *     otherwise the visit keeps clinicianId null + the Valant label in clinicianName.
 *   - Status: a status column (or status text in the code column) wins; else a procedure code means the
 *     visit happened (COMPLETED, which SEEN_APPOINTMENT_STATUSES / ATTENDED_APPOINTMENT_STATUSES count);
 *     else "unknown status": imported as COMPLETED only with treatUncodedAsAttended, otherwise skipped.
 *   - One appointment per visit: rows with the same chart id + date + start + provider are merged (an
 *     E/M + add-on code billed as two lines is one visit). The externalKey hashes exactly those four
 *     values, so it does not change when Valant later adds a code to the visit.
 */
import { createHash } from 'node:crypto';
import { parseCsvText } from '@/lib/migration/valantReportCommon';
import { normalizeDate } from '@/lib/migration/normalize';
import { TYPE_BY_CPT, zonedToUtc } from '@/lib/migration/valantAppointments';
import { mappedUserId, providerCodeKey, type ProviderCodeMap } from '@/lib/migration/valantProviderMap';
import { LEGACY_PRACTICE_LOCATION_NAMES } from '@/lib/locations/effectiveLocation';
import { VALANT_HISTORY_SOURCE } from '@/lib/appointments/importedHistory';

export { VALANT_HISTORY_SOURCE };
export const PRACTICE_TIME_ZONE = 'America/New_York';
export const GENERIC_VISIT_TYPE = 'Valant visit';
export const IMPORT_ACTOR_NAME = 'Valant history import';

export type HistoryStatus = 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'LATE_CANCEL';

// ─── Header mapping ───────────────────────────────────────────────────────────

export type HistoryField =
  | 'date' | 'time' | 'start' | 'end' | 'provider' | 'patient' | 'patientId' | 'dob' | 'diagnoses'
  | 'duration' | 'code' | 'units' | 'modifiers' | 'status' | 'facility' | 'pos' | 'notes';

/** Normalized header (lowercase, letters and digits only) -> field. First column wins per field. */
export const HEADER_ALIASES: Record<HistoryField, string[]> = {
  date: ['date', 'appointmentdate', 'apptdate', 'servicedate', 'dateofservice', 'dos', 'visitdate', 'day', 'scheduleddate'],
  time: ['time', 'appointmenttime', 'appttime', 'timerange', 'timeslot', 'scheduledtime'],
  start: ['starttime', 'start', 'begintime', 'begin', 'from', 'appointmentstart', 'apptstart'],
  end: ['endtime', 'end', 'to', 'appointmentend', 'apptend'],
  provider: ['provider', 'providername', 'clinician', 'clinicianname', 'renderingprovider', 'rendering', 'staff', 'staffname', 'therapist', 'resource', 'practitioner'],
  patient: ['patient', 'patientname', 'client', 'clientname', 'name', 'ptname'],
  patientId: ['patientid', 'ptid', 'chartid', 'chart', 'chartnumber', 'chartno', 'account', 'accountnumber', 'accountno', 'acct', 'acctno', 'mrn', 'valantid', 'patientnumber', 'clientid'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'patientdob', 'birthday'],
  diagnoses: ['diagnoses', 'diagnosis', 'dx', 'diagnosiscodes', 'dxcodes', 'icd10', 'icd'],
  duration: ['duration', 'minutes', 'mins', 'length', 'durationmin', 'durationminutes'],
  code: ['txcode', 'cpt', 'cptcode', 'cpts', 'procedure', 'procedurecode', 'proccode', 'code', 'servicecode', 'billingcode', 'hcpcs'],
  units: ['units', 'unit'],
  modifiers: ['modifiers', 'modifier', 'mods', 'mod'],
  status: ['status', 'apptstatus', 'appointmentstatus', 'visitstatus', 'attendance', 'attendancestatus'],
  facility: ['facility', 'location', 'office', 'site', 'clinic', 'servicelocation', 'facilityname', 'locationname'],
  pos: ['pos', 'placeofservice', 'poscode'],
  notes: ['notes', 'note', 'comments', 'comment', 'memo', 'apptnotes'],
};

const ALIAS_TO_FIELD = new Map<string, HistoryField>(
  (Object.entries(HEADER_ALIASES) as [HistoryField, string[]][]).flatMap(([f, list]) => list.map((a) => [a, f] as const))
);

export function normalizeHeader(h: string): string {
  return String(h ?? '').replace(/^﻿/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type HeaderMap = Partial<Record<HistoryField, number>>;

export function mapHeaders(header: readonly string[]): HeaderMap {
  const map: HeaderMap = {};
  header.forEach((h, i) => {
    const f = ALIAS_TO_FIELD.get(normalizeHeader(h));
    if (f && map[f] === undefined) map[f] = i;
  });
  return map;
}

/**
 * Valant's SSRS "Biller Appointments" CSV: 29 columns named textBox1… (repeated) plus "Note", every
 * data row starting with the report filter text "Appointments between …". Columns by position:
 * 0-4 filter text, 5 day ("Tuesday, July 1, 2025"), 6 time range, 7 patient "Name (CHARTID)" or
 * NON-PATIENT, 8 diagnoses, 9 Tx code (also the status: RESCHEDULED / Cancelled / NSH…), 10-12 copay /
 * fee / balance, 13 "Notes: …", 14 "Comments: ", 15 provider (repeated in 19 and 24), 16 modifiers,
 * 17 units, 18 duration minutes, 22/27 add-on codes, 23/28 patient repeated.
 */
export const VALANT_BILLER_POSITIONS: HeaderMap = {
  date: 5, time: 6, patient: 7, diagnoses: 8, code: 9, notes: 13, provider: 15, modifiers: 16, units: 17, duration: 18,
};

export function isValantBillerLayout(records: readonly string[][]): boolean {
  const header = records[0];
  if (!header || header.length !== 29) return false;
  const generic = header.every((h) => /^(textbox\d+|note)$/.test(normalizeHeader(h)));
  const first = records[1]?.[0] ?? '';
  return generic && (!records[1] || /^appointments between/i.test(first.trim()));
}

function usableHeader(m: HeaderMap): boolean {
  const hasPatient = m.patient !== undefined || m.patientId !== undefined;
  const hasWhen = m.date !== undefined || m.time !== undefined || m.start !== undefined;
  return hasPatient && hasWhen && Object.keys(m).length >= 3;
}

// ─── Cell parsers ─────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export type LocalDate = { y: number; m: number; d: number };
export type ParsedDate = LocalDate & { minutes: number | null };

function validYmd(y: number, m: number, d: number): LocalDate | null {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}

const LONG_DATE_RE = /^(?:(?:mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i;

/** "Tuesday, July 1, 2025", "July 1, 2025", "7/1/2025", "7/1/25 10:00 AM", "2025-07-01", Excel serial 45839(.4166) */
export function parseHistoryDate(raw: string | null | undefined): ParsedDate | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const long = s.match(LONG_DATE_RE);
  if (long) {
    const m = MONTHS[long[1].toLowerCase().slice(0, long[1].toLowerCase().startsWith('sept') ? 4 : 3)];
    const v = m ? validYmd(+long[3], m, +long[2]) : null;
    return v ? { ...v, minutes: null } : null;
  }
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n < 20000 || n > 80000) return null;
    const day = Math.floor(n);
    const t = new Date(Date.UTC(1899, 11, 30) + day * 86_400_000);
    const frac = n - day;
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), minutes: frac > 0 ? Math.round(frac * 1440) : null };
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const v = validYmd(+iso[1], +iso[2], +iso[3]);
    return v ? { ...v, minutes: iso[4] ? +iso[4] * 60 + +iso[5] : null } : null;
  }
  const mdy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:\s+(.+))?$/);
  if (mdy) {
    let y = +mdy[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const v = validYmd(y, +mdy[1], +mdy[2]);
    if (!v) return null;
    const time = mdy[4] ? parseClock(mdy[4]) : null;
    return { ...v, minutes: time };
  }
  return null;
}

/** A day header row's date ("Tuesday, July 1, 2025") — long form only, so cell values never qualify */
function dayHeaderDate(raw: string): LocalDate | null {
  const s = raw.trim();
  if (!LONG_DATE_RE.test(s)) return null;
  const p = parseHistoryDate(s);
  return p ? { y: p.y, m: p.m, d: p.d } : null;
}

const AMPM = '([ap])\\.?\\s*m?\\.?';
const CLOCK_RE = new RegExp(`^(\\d{1,2})(?::(\\d{2}))?(?::\\d{2})?\\s*(?:${AMPM})?$`, 'i');
const RANGE_RE = new RegExp(
  `^(\\d{1,2})(?::(\\d{2}))?\\s*(?:${AMPM})?\\s*(?:-|–|—|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(?:${AMPM})?$`,
  'i'
);

/** "10:00 AM", "2:30pm", "14:00", "14:00:00", Excel time fraction "0.4166" -> minutes after midnight */
export function parseClock(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^0?\.\d+$/.test(s)) {
    const n = Math.round(Number(s) * 1440);
    return n >= 0 && n < 1440 ? n : null;
  }
  const m = s.match(CLOCK_RE);
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  if (mi > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + mi;
}

/**
 * "10:00-10:50 AM", "10:00 AM - 10:50 AM", "11:30-12:20 PM" (crosses noon), "10:00 - 11:00" (24h)
 * -> start / end minutes. With AM/PM on the end only, the start is the reading that matches the
 * duration when exactly one does ("12:00-10:00 AM", 600 min), else the latest reading not after the end.
 */
export function parseClockRange(raw: string | null | undefined, durationMinutes?: number | null): { start: number; end: number } | null {
  const s = String(raw ?? '').trim();
  const m = s.match(RANGE_RE);
  if (!m) {
    const single = parseClock(s);
    return single == null ? null : { start: single, end: single };
  }
  const [sh, sm, sap, eh, em, eap] = [+m[1], m[2] ? +m[2] : 0, m[3]?.toLowerCase(), +m[4], m[5] ? +m[5] : 0, m[6]?.toLowerCase()];
  if (sm > 59 || em > 59) return null;
  const to24 = (h: number, ap: string) => (h % 12) + (ap === 'p' ? 12 : 0);
  let end: number;
  if (eap) {
    if (eh < 1 || eh > 12) return null;
    end = to24(eh, eap) * 60 + em;
  } else {
    if (eh > 23) return null;
    end = eh * 60 + em;
  }
  let start: number;
  if (sap) {
    if (sh < 1 || sh > 12) return null;
    start = to24(sh, sap) * 60 + sm;
  } else if (eap) {
    if (sh < 1 || sh > 12) return null;
    const both = [(sh % 12) * 60 + sm, ((sh % 12) + 12) * 60 + sm];
    const exact = durationMinutes && durationMinutes > 0 ? both.filter((t) => end - t === durationMinutes) : [];
    const options = both.filter((t) => t <= end);
    start = exact.length === 1 ? exact[0] : options.length ? Math.max(...options) : both[0];
  } else {
    if (sh > 23) return null;
    start = sh * 60 + sm;
  }
  return { start, end };
}

/** "Jane Q. Doe (ABC123)" -> chart id "ABC123" (last parenthesized group), name "Jane Q. Doe" */
export function extractChartId(cell: string | null | undefined): { chartId: string | null; name: string } {
  const s = String(cell ?? '').trim();
  const m = s.match(/^(.*?)\s*\(\s*([^()]+?)\s*\)\s*$/);
  if (!m) return { chartId: null, name: s };
  return { chartId: m[2].toUpperCase(), name: m[1].trim() };
}

export function isNonPatient(cell: string | null | undefined): boolean {
  return /^\s*non[\s-]*patient\b/i.test(String(cell ?? ''));
}

/** Procedure codes in a code cell: "90837T", "99215-Spravato", "90847C-ITPC", "99214, 90833", "H2017" -> base codes */
export function procedureCodes(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const tok of String(raw ?? '').toUpperCase().split(/[\s,;/|+]+/)) {
    const m = tok.match(/^(\d{5}|[A-Z]\d{4})[A-Z]{0,2}(?:-[A-Z0-9-]*)?$/);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Valant status text -> appointment status; null = no decision (scheduled / confirmed / unknown text) */
export function mapValantStatus(raw: string | null | undefined): HistoryStatus | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  // Valant no-show codes: "NSH - Thrpy", "NSHDOC", "NSHINT", "NSHINJ"
  if (/no[\s-]*show|^ns$|^nsh|did not (show|attend)|^dna$|failed/.test(s)) return 'NO_SHOW';
  if (/late[\s-]*cancel|cancel+ed?\s*(<|less than|within|under)\s*24|^lc$/.test(s)) return 'LATE_CANCEL';
  if (/cancel|rescheduled|resched|deleted|void|bumped/.test(s)) return 'CANCELLED';
  if (/checked[\s-]*out|check[\s-]*out|complete|kept|seen|attended|arrived|checked[\s-]*in|in session|billed|showed|^show$/.test(s)) return 'COMPLETED';
  return null;
}

/** True for status text that is a known "no decision" status (not worth reporting as unrecognized) */
function isPendingStatus(raw: string): boolean {
  return /^(scheduled|confirmed|unconfirmed|pending|booked|reminded|left message|open)$/i.test(raw.trim());
}

const TELE_MODIFIERS = new Set(['95', 'GT', 'GQ', 'FQ', '93']);
const AUDIO_MODIFIERS = new Set(['FQ', '93']);

export function splitModifiers(raw: string | null | undefined): string[] {
  return String(raw ?? '').toUpperCase().split(/[\s,;:|/]+/).map((m) => m.trim()).filter((m) => /^[A-Z0-9]{2}$/.test(m));
}

export type VirtualSignals = { codeSuffixT: boolean; notesTele: boolean; modifier: boolean; pos: boolean };

/** Telehealth: code suffix T ("99214T", Valant's telehealth marker), "tele" in notes, modifier 95/GT/GQ/FQ/93, POS 02/10 */
export function detectVirtual(input: { notes?: string | null; modifiers?: string[]; pos?: string | null; codeCell?: string | null }): {
  isVirtual: boolean;
  audioOnly: boolean;
  signals: VirtualSignals;
} {
  const mods = input.modifiers ?? [];
  const pos = String(input.pos ?? '').trim().replace(/^0+/, '');
  const signals: VirtualSignals = {
    codeSuffixT: /(?:^|[\s,;/|+])(?:\d{5}|[A-Z]\d{4})T(?=$|[\s,;/|+-])/i.test(String(input.codeCell ?? '')),
    notesTele: /\btele|\bvirtual\b|\bzoom\b|\bdoxy/i.test(String(input.notes ?? '')),
    modifier: mods.some((m) => TELE_MODIFIERS.has(m)),
    pos: pos === '2' || pos === '10',
  };
  // Audio-only only from the billing modifier (free-text notes are not reliable enough)
  const audioOnly = mods.some((m) => AUDIO_MODIFIERS.has(m));
  return { isVirtual: Object.values(signals).some(Boolean), audioOnly, signals };
}

// ─── CSV -> rows ──────────────────────────────────────────────────────────────

export type HistoryRow = {
  /** 1-based CSV record number */
  line: number;
  chartId: string;
  /** Patient name as exported (memory only: used for name + DOB suggestions, never printed) */
  patientName: string;
  dob: string | null;
  provider: string;
  /** Practice-local date YYYY-MM-DD */
  localDate: string;
  startMinutes: number;
  startsAt: Date;
  endsAt: Date;
  codeCell: string;
  codes: string[];
  modifiers: string[];
  statusText: string;
  facility: string;
  pos: string;
  notes: string;
};

export type ParseHistoryResult =
  | {
      ok: true;
      layout: 'valant_biller_positional' | 'headers';
      headers: string[];
      headerMap: HeaderMap;
      rows: HistoryRow[];
      recordsRead: number;
      nonPatient: number;
      noChartId: number;
      /** blank / total / footer lines without a patient or time */
      ignoredLines: number;
      errors: { line: number; error: string }[];
      error?: undefined;
    }
  | { ok: false; error: string; headers: string[] };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: LocalDate) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;

export function parseValantHistoryCsv(text: string, opts: { timeZone?: string } = {}): ParseHistoryResult {
  const tz = opts.timeZone ?? PRACTICE_TIME_ZONE;
  const records = parseCsvText(text);
  let headerIdx = -1;
  let headerMap: HeaderMap = {};
  let layout: 'valant_biller_positional' | 'headers' = 'headers';
  if (isValantBillerLayout(records)) {
    headerIdx = 0;
    headerMap = { ...VALANT_BILLER_POSITIONS };
    layout = 'valant_biller_positional';
  }
  for (let i = 0; headerIdx < 0 && i < Math.min(records.length, 25); i++) {
    const m = mapHeaders(records[i]);
    if (usableHeader(m)) {
      headerIdx = i;
      headerMap = m;
      break;
    }
  }
  const firstHeaders = (records[0] ?? []).map((h) => h.replace(/^﻿/, '').trim());
  if (headerIdx < 0) {
    return {
      ok: false,
      error: 'No header row with a patient / chart id column and a date or time column (see HEADER_ALIASES)',
      headers: firstHeaders,
    };
  }
  const headers = records[headerIdx].map((h) => h.replace(/^﻿/, '').trim());
  const cell = (r: string[], f: HistoryField) => (headerMap[f] === undefined ? '' : String(r[headerMap[f]!] ?? '').trim());

  const rows: HistoryRow[] = [];
  const errors: { line: number; error: string }[] = [];
  let carryDate: LocalDate | null = null;
  let nonPatient = 0;
  let noChartId = 0;
  let ignoredLines = 0;
  let last: HistoryRow | null = null;

  for (let i = headerIdx + 1; i < records.length; i++) {
    const r = records[i];
    const line = i + 1;
    const filled = r.map((c) => String(c ?? '').trim()).filter(Boolean);
    if (!filled.length) continue;
    // Repeated header row (page breaks in report exports)
    if (layout === 'headers' && usableHeader(mapHeaders(r))) continue;
    // Day header row: "Tuesday, July 1, 2025" alone on its line
    if (filled.length <= 2) {
      const dh = dayHeaderDate(filled[0]);
      if (dh) {
        carryDate = dh;
        continue;
      }
    }
    // "Notes: Tele" continuation line belongs to the previous visit
    if (layout === 'headers' && /^notes?:/i.test(filled[0])) {
      if (last) {
        const extra = filled.join(' ').replace(/^notes?:\s*/i, '').trim();
        if (extra) last.notes = [last.notes, extra].filter(Boolean).join(' ');
      }
      continue;
    }

    const patientCell = cell(r, 'patient');
    const idCell = cell(r, 'patientId');
    if (isNonPatient(patientCell) || isNonPatient(idCell)) {
      nonPatient += 1;
      last = null;
      continue;
    }
    const dateCell = cell(r, 'date');
    const parsedDate = dateCell ? parseHistoryDate(dateCell) : null;
    if (dateCell && !parsedDate) {
      // A date-only row in the date column ("Tuesday, July 1, 2025") with nothing else
      errors.push({ line, error: 'Unrecognized date' });
      last = null;
      continue;
    }
    const date: LocalDate | null = parsedDate ? { y: parsedDate.y, m: parsedDate.m, d: parsedDate.d } : carryDate;
    if (parsedDate && !patientCell && !idCell) {
      carryDate = date;
      ignoredLines += 1;
      continue;
    }
    if (!patientCell && !idCell) {
      ignoredLines += 1;
      last = null;
      continue;
    }

    const fromCell = extractChartId(patientCell);
    const chartId = (idCell ? idCell.replace(/^\(|\)$/g, '').trim().toUpperCase() : '') || fromCell.chartId;
    if (!chartId) {
      noChartId += 1;
      errors.push({ line, error: 'No Valant chart id' });
      last = null;
      continue;
    }
    if (!date) {
      errors.push({ line, error: 'No date' });
      last = null;
      continue;
    }

    // Time: range column, or start / end columns, or a time inside the date cell
    let start: number | null = null;
    let end: number | null = null;
    const duration = Number(cell(r, 'duration').replace(/[^\d.]/g, ''));
    const timeCell = cell(r, 'time');
    if (timeCell) {
      const range = parseClockRange(timeCell, duration);
      if (range) [start, end] = [range.start, range.end];
    }
    if (start == null && cell(r, 'start')) {
      const range = parseClockRange(cell(r, 'start'));
      if (range) [start, end] = [range.start, range.end];
    }
    if (cell(r, 'end')) {
      const e = parseClock(cell(r, 'end'));
      if (e != null) end = e;
    }
    if (start == null && parsedDate?.minutes != null) start = parsedDate.minutes;
    if (start == null) {
      errors.push({ line, error: 'No start time' });
      last = null;
      continue;
    }
    if (end == null || end <= start) end = start + (duration > 0 && duration < 24 * 60 ? Math.round(duration) : 30);

    const startsAt = zonedToUtc(date.y, date.m, date.d, Math.floor(start / 60), start % 60, tz);
    const endsAt = new Date(startsAt.getTime() + (end - start) * 60_000);
    const dobDate = normalizeDate(cell(r, 'dob'));
    const codeCell = cell(r, 'code');

    const row: HistoryRow = {
      line,
      chartId,
      patientName: fromCell.name || '',
      dob: dobDate ? dobDate.toISOString().slice(0, 10) : null,
      provider: cell(r, 'provider').replace(/\s+/g, ' '),
      localDate: ymd(date),
      startMinutes: start,
      startsAt,
      endsAt,
      codeCell,
      codes: procedureCodes(codeCell),
      modifiers: splitModifiers(cell(r, 'modifiers')),
      statusText: cell(r, 'status'),
      facility: cell(r, 'facility'),
      pos: cell(r, 'pos'),
      notes: cell(r, 'notes').replace(/^notes?:\s*/i, ''),
    };
    rows.push(row);
    last = row;
  }

  return { ok: true, layout, headers, headerMap, rows, recordsRead: Math.max(0, records.length - headerIdx - 1), nonPatient, noChartId, ignoredLines, errors };
}

// ─── Visits (merged rows) ─────────────────────────────────────────────────────

/** Stable id of one visit: chart id + practice-local date + start time + provider label */
export function historyExternalKey(v: { chartId: string; localDate: string; startMinutes: number; provider: string }): string {
  const basis = [
    v.chartId.trim().toUpperCase(),
    v.localDate,
    `${pad(Math.floor(v.startMinutes / 60))}:${pad(v.startMinutes % 60)}`,
    providerCodeKey(v.provider),
  ].join('|');
  return `vh1:${createHash('sha256').update(basis).digest('hex').slice(0, 40)}`;
}

export type HistoryVisit = Omit<HistoryRow, 'line' | 'codeCell'> & {
  lines: number[];
  codeCells: string[];
  externalKey: string;
};

/** Psychotherapy / interactive-complexity add-ons go after the primary code */
const ADD_ON_CODES = new Set(['90833', '90836', '90838', '90785', '90840', '99354', '99355', 'G2212']);

export function mergeVisits(rows: readonly HistoryRow[]): HistoryVisit[] {
  const byKey = new Map<string, HistoryVisit>();
  for (const r of rows) {
    const externalKey = historyExternalKey(r);
    const v = byKey.get(externalKey);
    if (!v) {
      const { line, codeCell, ...rest } = r;
      byKey.set(externalKey, { ...rest, codes: [...r.codes], modifiers: [...r.modifiers], lines: [line], codeCells: codeCell ? [codeCell] : [], externalKey });
      continue;
    }
    v.lines.push(r.line);
    if (r.codeCell && !v.codeCells.includes(r.codeCell)) v.codeCells.push(r.codeCell);
    for (const c of r.codes) if (!v.codes.includes(c)) v.codes.push(c);
    for (const m of r.modifiers) if (!v.modifiers.includes(m)) v.modifiers.push(m);
    if (r.endsAt > v.endsAt) v.endsAt = r.endsAt;
    if (!v.statusText && r.statusText) v.statusText = r.statusText;
    if (!v.facility && r.facility) v.facility = r.facility;
    if (!v.pos && r.pos) v.pos = r.pos;
    if (!v.dob && r.dob) v.dob = r.dob;
    if (r.notes && !v.notes.includes(r.notes)) v.notes = [v.notes, r.notes].filter(Boolean).join(' ');
  }
  for (const v of byKey.values()) v.codes.sort((a, b) => Number(ADD_ON_CODES.has(a)) - Number(ADD_ON_CODES.has(b)));
  return [...byKey.values()];
}

export type StatusDecision =
  | { status: HistoryStatus; basis: 'status_column' | 'code_column_text' | 'procedure_code' | 'uncoded_flag' }
  | { status: null; basis: 'unknown_status' };

export function resolveHistoryStatus(
  v: Pick<HistoryVisit, 'statusText' | 'codes' | 'codeCells'>,
  opts: { treatUncodedAsAttended?: boolean } = {}
): StatusDecision {
  const fromColumn = mapValantStatus(v.statusText);
  if (fromColumn) return { status: fromColumn, basis: 'status_column' };
  // Valant puts "Cancelled" / "RESCHEDULED" / "No Show" in the procedure column of unbilled slots
  if (!v.codes.length) {
    for (const c of v.codeCells) {
      const s = mapValantStatus(c);
      if (s) return { status: s, basis: 'code_column_text' };
    }
  }
  if (v.codes.length) return { status: 'COMPLETED', basis: 'procedure_code' };
  if (opts.treatUncodedAsAttended) return { status: 'COMPLETED', basis: 'uncoded_flag' };
  return { status: null, basis: 'unknown_status' };
}

const EXTRA_TYPES: Record<string, string> = {
  H2017: 'PRP Session',
  H2018: 'PRP Session',
  '90853': 'Group Therapy',
  '90849': 'Group Therapy',
  '90839': 'Crisis Follow-up',
  '90840': 'Crisis Follow-up',
};

export function visitTypeForCodes(codes: readonly string[]): string {
  for (const c of codes) {
    const t = TYPE_BY_CPT[c] || EXTRA_TYPES[c];
    if (t) return t;
  }
  return GENERIC_VISIT_TYPE;
}

// ─── Planner ──────────────────────────────────────────────────────────────────

export type ClientRef = { id: string; name: string; locationName: string | null };
export type StaffRef = { id: string; name: string | null };

export type PlanLookups = {
  /** upper-cased Valant chart id (Client.sourceId) -> client */
  clientsByChartId: ReadonlyMap<string, ClientRef>;
  /** nameDobKey(name, dob) -> client ids (suggestions only) */
  clientsByNameDob?: ReadonlyMap<string, string[]>;
  providerMap: ProviderCodeMap;
  staff: readonly StaffRef[];
  /** externalKeys already imported for this organization */
  existingKeys: ReadonlySet<string>;
  /** Appointments NOT from this import: slotKey(clientId, startsAt) -> clinicians on them */
  existingSlots: ReadonlyMap<string, { id?: string; clinicianId: string | null; clinicianName: string | null; status: string }[]>;
};

export type PlanOptions = {
  organizationId: string;
  now: Date;
  /** YYYY-MM-DD practice-local, inclusive */
  since?: string | null;
  until?: string | null;
  treatUncodedAsAttended?: boolean;
  /** Use the appointment importer's unique name match when the code is not in ValantProviderMap (default true) */
  nameMatchProviders?: boolean;
};

export type AppointmentHistoryCreate = {
  organizationId: string;
  clientId: string;
  clientName: string;
  clinicianId: string | null;
  clinicianName: string | null;
  type: string;
  startsAt: Date;
  endsAt: Date;
  status: HistoryStatus;
  isVirtual: boolean;
  audioOnly: boolean;
  notes: string;
  locationId: string | null;
  createdVia: 'import';
  createdByName: string;
  source: typeof VALANT_HISTORY_SOURCE;
  externalKey: string;
};

export type UnmatchedVisit = { chartId: string; localDate: string; suggestedClientId: string | null };

/**
 * A past appointment already in Altrixs at the same slot, still SCHEDULED (never closed out): with
 * --close-out-scheduled it takes Valant's outcome and is stamped as imported history (source +
 * externalKey), so billing / AutoPay / work queues skip it and re-runs see it as already imported.
 */
export type HistoryCloseOut = { id: string; status: string; externalKey: string };

export type HistoryPlan = {
  creates: AppointmentHistoryCreate[];
  closeOuts: HistoryCloseOut[];
  counts: {
    visits: number;
    matchedVisits: number;
    matchedClients: number;
    unmatchedVisits: number;
    unmatchedChartIds: number;
    nameDobSuggestions: number;
    outsideDateRange: number;
    future: number;
    unknownStatusSkipped: number;
    uncodedImportedAsAttended: number;
    alreadyImported: number;
    existingAppointmentSkipped: number;
    existingPastScheduled: number;
    wouldCreate: number;
    virtual: number;
    audioOnly: number;
    providerByMap: number;
    providerByName: number;
    providerUnmatched: number;
    locationFromFacility: number;
    locationFromClient: number;
    locationNone: number;
  };
  byStatus: Record<string, number>;
  statusBasis: Record<string, number>;
  unrecognizedStatusText: Record<string, number>;
  unmatchedProviders: Record<string, number>;
  /** label -> staff name, for admins to confirm (or map differently) in the provider-code page */
  providersMatchedByName: Record<string, string>;
  unmatchedFacilities: Record<string, number>;
  /** created visits per telehealth signal (a visit can have several) */
  virtualSignals: Record<string, number>;
  dateRange: { first: string | null; last: string | null };
  unmatched: UnmatchedVisit[];
};

export function slotKey(clientId: string, startsAt: Date): string {
  return `${clientId}|${startsAt.toISOString()}`;
}

/** Name + DOB key for suggestions: first and last name tokens (middle initials dropped) + YYYY-MM-DD */
export function nameDobKey(name: string, dob: string | null): string | null {
  if (!dob) return null;
  let s = String(name ?? '').toLowerCase();
  // "Doe, Jane" -> "jane doe"
  if (s.includes(',')) {
    const [last, first] = s.split(',', 2);
    s = `${first} ${last}`;
  }
  const parts = s.replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((p) => p.length > 1);
  if (parts.length < 2) return null;
  return `${parts[0]} ${parts[parts.length - 1]}|${dob}`;
}

const normName = (s: string | null | undefined) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Facility / location name -> legacy practice_locations id (the FK target of Appointment.location_id) */
export function legacyLocationId(name: string | null | undefined): string | null {
  const n = normName(name);
  if (!n) return null;
  for (const [id, label] of Object.entries(LEGACY_PRACTICE_LOCATION_NAMES)) {
    const l = label.toLowerCase();
    if (n === l || n === id || n.includes(l)) return id;
  }
  return null;
}

export function maskChartId(chartId: string): string {
  const s = String(chartId ?? '');
  return s.length <= 2 ? '**' : `${'*'.repeat(Math.min(6, s.length - 2))}${s.slice(-2)}`;
}

function inc(rec: Record<string, number>, key: string) {
  rec[key] = (rec[key] || 0) + 1;
}

/**
 * Strict provider match for history (care-team access depends on it): only "K.Daniel", "S. Pete",
 * "Dr. A Gbadehan", "R.Betts-Walker" (first initial + full last name), and only when exactly one staff
 * member fits. "Daniel K", "Mackenzie", "LBarefoot" are never guessed — map them in ValantProviderMap.
 */
export function matchInitialLastName<T extends StaffRef>(label: string, staff: readonly T[]): T | null {
  const m = String(label ?? '').trim().replace(/^dr\.?\s*/i, '').toLowerCase().match(/^([a-z])\s*[.\s]\s*([a-z][a-z'-]+)$/);
  if (!m) return null;
  const [, initial, last] = m;
  const hits = staff.filter((s) => {
    const parts = String(s.name ?? '').toLowerCase().replace(/,.*$/, '').replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts[0][0] !== initial) return false;
    return parts[parts.length - 1] === last || parts.slice(1).join('-') === last;
  });
  return hits.length === 1 ? hits[0] : null;
}

export function planValantHistory(visits: readonly HistoryVisit[], lookups: PlanLookups, opts: PlanOptions): HistoryPlan {
  const counts: HistoryPlan['counts'] = {
    visits: visits.length,
    matchedVisits: 0,
    matchedClients: 0,
    unmatchedVisits: 0,
    unmatchedChartIds: 0,
    nameDobSuggestions: 0,
    outsideDateRange: 0,
    future: 0,
    unknownStatusSkipped: 0,
    uncodedImportedAsAttended: 0,
    alreadyImported: 0,
    existingAppointmentSkipped: 0,
    existingPastScheduled: 0,
    wouldCreate: 0,
    virtual: 0,
    audioOnly: 0,
    providerByMap: 0,
    providerByName: 0,
    providerUnmatched: 0,
    locationFromFacility: 0,
    locationFromClient: 0,
    locationNone: 0,
  };
  const plan: HistoryPlan = {
    creates: [],
    closeOuts: [],
    counts,
    byStatus: {},
    statusBasis: {},
    unrecognizedStatusText: {},
    unmatchedProviders: {},
    providersMatchedByName: {},
    unmatchedFacilities: {},
    virtualSignals: {},
    dateRange: { first: null, last: null },
    unmatched: [],
  };
  const staffById = new Map(lookups.staff.map((s) => [s.id, s]));
  const matchedClientIds = new Set<string>();
  const unmatchedCharts = new Set<string>();
  const providerCache = new Map<string, { id: string | null; name: string | null; basis: 'map' | 'name' | null }>();
  const nameMatch = opts.nameMatchProviders !== false;

  const resolveProvider = (label: string) => {
    const key = providerCodeKey(label);
    const hit = providerCache.get(key);
    if (hit) return hit;
    let out: { id: string | null; name: string | null; basis: 'map' | 'name' | null } = { id: null, name: null, basis: null };
    const mapped = mappedUserId(label, lookups.providerMap);
    if (mapped) out = { id: mapped, name: staffById.get(mapped)?.name ?? null, basis: 'map' };
    else if (nameMatch && key) {
      const m = matchInitialLastName(label, lookups.staff);
      if (m) out = { id: m.id, name: m.name, basis: 'name' };
    }
    providerCache.set(key, out);
    return out;
  };

  for (const v of visits) {
    if ((opts.since && v.localDate < opts.since) || (opts.until && v.localDate > opts.until)) {
      counts.outsideDateRange += 1;
      continue;
    }
    if (v.startsAt.getTime() > opts.now.getTime()) {
      counts.future += 1;
      continue;
    }
    const client = lookups.clientsByChartId.get(v.chartId.toUpperCase());
    if (!client) {
      counts.unmatchedVisits += 1;
      unmatchedCharts.add(v.chartId);
      const nk = nameDobKey(v.patientName, v.dob);
      const candidates = nk ? lookups.clientsByNameDob?.get(nk) ?? [] : [];
      const suggestedClientId = candidates.length === 1 ? candidates[0] : null;
      if (suggestedClientId) counts.nameDobSuggestions += 1;
      plan.unmatched.push({ chartId: v.chartId, localDate: v.localDate, suggestedClientId });
      continue;
    }
    counts.matchedVisits += 1;
    matchedClientIds.add(client.id);

    if (v.statusText && !mapValantStatus(v.statusText) && !isPendingStatus(v.statusText)) {
      inc(plan.unrecognizedStatusText, v.statusText.slice(0, 40));
    }
    const decision = resolveHistoryStatus(v, { treatUncodedAsAttended: opts.treatUncodedAsAttended });
    if (!decision.status) {
      counts.unknownStatusSkipped += 1;
      continue;
    }

    if (lookups.existingKeys.has(v.externalKey)) {
      counts.alreadyImported += 1;
      continue;
    }

    const provider = v.provider ? resolveProvider(v.provider) : { id: null, name: null, basis: null };
    const clinicianName = provider.name || v.provider || null;
    const existing = lookups.existingSlots.get(slotKey(client.id, v.startsAt)) ?? [];
    const clash = existing.find(
      (e) =>
        (!e.clinicianId && !e.clinicianName) ||
        (!clinicianName && !provider.id) ||
        (provider.id && e.clinicianId === provider.id) ||
        (e.clinicianName && (normName(e.clinicianName) === normName(clinicianName) || normName(e.clinicianName) === normName(v.provider)))
    );
    if (clash) {
      counts.existingAppointmentSkipped += 1;
      if (clash.status === 'SCHEDULED') {
        counts.existingPastScheduled += 1;
        if (clash.id) plan.closeOuts.push({ id: clash.id, status: decision.status, externalKey: v.externalKey });
      }
      continue;
    }

    if (provider.basis === 'map') counts.providerByMap += 1;
    else if (provider.basis === 'name') {
      counts.providerByName += 1;
      plan.providersMatchedByName[v.provider] = provider.name || provider.id || '';
    } else {
      counts.providerUnmatched += 1;
      inc(plan.unmatchedProviders, v.provider || '(blank)');
    }

    let locationId = legacyLocationId(v.facility);
    if (locationId) counts.locationFromFacility += 1;
    else {
      if (v.facility) inc(plan.unmatchedFacilities, v.facility.slice(0, 60));
      locationId = legacyLocationId(client.locationName);
      if (locationId) counts.locationFromClient += 1;
      else counts.locationNone += 1;
    }

    const tele = detectVirtual({ notes: v.notes, modifiers: v.modifiers, pos: v.pos, codeCell: v.codeCells.join(' ') });
    if (tele.isVirtual) counts.virtual += 1;
    for (const [k, on] of Object.entries(tele.signals)) if (on) inc(plan.virtualSignals, k);
    if (tele.audioOnly) counts.audioOnly += 1;
    if (decision.basis === 'uncoded_flag') counts.uncodedImportedAsAttended += 1;
    inc(plan.byStatus, decision.status);
    inc(plan.statusBasis, decision.basis);

    const codeText = v.codes.length ? v.codes.join(' ') : v.codeCells.join(' ');
    const notes = [
      'Imported from Valant appointment history',
      codeText ? `Valant code: ${codeText}` : '',
      v.modifiers.length ? `Modifiers: ${v.modifiers.join(' ')}` : '',
      v.statusText ? `Valant status: ${v.statusText}` : '',
      // Valant's free-text appointment notes are not copied (used only for the telehealth flag)
    ].filter(Boolean).join('\n');

    plan.creates.push({
      organizationId: opts.organizationId,
      clientId: client.id,
      clientName: client.name,
      clinicianId: provider.id,
      clinicianName,
      type: visitTypeForCodes(v.codes),
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      status: decision.status,
      isVirtual: tele.isVirtual,
      audioOnly: tele.audioOnly,
      notes,
      locationId,
      createdVia: 'import',
      createdByName: IMPORT_ACTOR_NAME,
      source: VALANT_HISTORY_SOURCE,
      externalKey: v.externalKey,
    });
    if (!plan.dateRange.first || v.localDate < plan.dateRange.first) plan.dateRange.first = v.localDate;
    if (!plan.dateRange.last || v.localDate > plan.dateRange.last) plan.dateRange.last = v.localDate;
  }
  counts.matchedClients = matchedClientIds.size;
  counts.unmatchedChartIds = unmatchedCharts.size;
  counts.wouldCreate = plan.creates.length;
  return plan;
}

// ─── Parse-only summary (no database) ─────────────────────────────────────────

/** Counts only: no names, notes or chart ids (provider labels and status codes are not PHI). */
export function summarizeParse(parsed: Extract<ParseHistoryResult, { ok: true }>, opts: { treatUncodedAsAttended?: boolean } = {}) {
  const visits = mergeVisits(parsed.rows);
  const byStatus: Record<string, number> = {};
  const statusBasis: Record<string, number> = {};
  const codeColumnStatusText: Record<string, number> = {};
  const unrecognizedCodeText: Record<string, number> = {};
  const virtualSignals: Record<string, number> = {};
  const providerLabels: Record<string, number> = {};
  const chartIdLengths: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const charts = new Set<string>();
  let virtual = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const v of visits) {
    const d = resolveHistoryStatus(v, opts);
    inc(byStatus, d.status ?? 'UNKNOWN (skipped)');
    inc(statusBasis, d.basis);
    if (!v.codes.length) {
      for (const c of v.codeCells) {
        if (mapValantStatus(c)) inc(codeColumnStatusText, c.slice(0, 30));
        else inc(unrecognizedCodeText, c.slice(0, 30));
      }
    }
    const tele = detectVirtual({ notes: v.notes, modifiers: v.modifiers, pos: v.pos, codeCell: v.codeCells.join(' ') });
    if (tele.isVirtual) virtual += 1;
    for (const [k, on] of Object.entries(tele.signals)) if (on) inc(virtualSignals, k);
    inc(providerLabels, v.provider || '(blank)');
    charts.add(v.chartId);
    inc(byYear, v.localDate.slice(0, 4));
    if (!first || v.localDate < first) first = v.localDate;
    if (!last || v.localDate > last) last = v.localDate;
  }
  for (const c of charts) inc(chartIdLengths, String(c.length));
  const errorKinds: Record<string, number> = {};
  for (const e of parsed.errors) inc(errorKinds, e.error);
  return {
    layout: parsed.layout,
    recordsRead: parsed.recordsRead,
    nonPatientSkipped: parsed.nonPatient,
    patientRows: parsed.rows.length,
    unparsableRows: parsed.errors.length,
    unparsableByReason: errorKinds,
    ignoredLines: parsed.ignoredLines,
    visitsAfterMerge: visits.length,
    rowsMergedIntoOtherVisits: parsed.rows.length - visits.length,
    distinctChartIds: charts.size,
    chartIdLengths,
    byStatus,
    statusBasis,
    codeColumnStatusText,
    unrecognizedCodeText,
    virtual,
    virtualSignals,
    providerLabels,
    visitsByYear: byYear,
    dateRange: { first, last },
  };
}
