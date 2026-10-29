/**
 * Valant "Appointments between X and Y" report (CSV export of the scheduler report).
 *
 * The export repeats generic column names (textBox1 appears four times), so rows are
 * read as raw cells and each field is located by its content, not its header.
 */

export type ValantAppointmentRow =
  | { kind: 'block'; provider: string }
  | {
      kind: 'appointment';
      /** Valant Pt. ID, matched to Client.sourceId from the client import */
      sourcePatientId: string;
      patientName: string;
      provider: string;
      startsAt: Date;
      endsAt: Date;
      type: string;
      isVirtual: boolean;
      status: 'SCHEDULED' | 'CANCELLED';
      sourceCode: string | null;
      notes: string | null;
    };

export type ParseResult = { ok: true; value: ValantAppointmentRow } | { ok: false; error: string };

const DATE_RE = /^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, ([A-Za-z]+) (\d{1,2}), (\d{4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)$/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export const TYPE_BY_CPT: Record<string, string> = {
  '90791': 'Initial Assessment',
  '90792': 'Psychiatric Evaluation',
  '90832': 'Individual Therapy',
  '90834': 'Individual Therapy',
  '90837': 'Individual Therapy',
  '90846': 'Family Therapy',
  '90847': 'Family Therapy',
  '99204': 'Initial Evaluation',
  '99205': 'Initial Evaluation',
  '99212': 'Medication Management',
  '99213': 'Medication Management',
  '99214': 'Medication Management',
  '99215': 'Medication Management',
};

/** UTC instant for a wall-clock time in the clinic's time zone (handles DST). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone = 'America/New_York'): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value])
  );
  const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asZoned - guess));
}

/**
 * "06:00-05:00 PM" only gives AM/PM for the end. The start is the latest of its
 * AM/PM readings that is not after the end (12:00-01:00 PM → noon, 06:00-05:00 PM → 6 AM).
 */
export function parseTimeRange(raw: string): { start: [number, number]; end: [number, number] } | null {
  const m = raw.trim().match(TIME_RE);
  if (!m) return null;
  const [sh, sm, eh, em] = [+m[1], +m[2], +m[3], +m[4]];
  const pm = m[5].toUpperCase() === 'PM';
  const endH = (eh % 12) + (pm ? 12 : 0);
  const end = endH * 60 + em;
  const candidates = [(sh % 12) * 60 + sm, ((sh % 12) + 12) * 60 + sm].filter((t) => t <= end);
  const start = candidates.length ? Math.max(...candidates) : (sh % 12) * 60 + sm;
  return { start: [Math.floor(start / 60), start % 60], end: [endH, em] };
}

export function parseValantAppointmentRow(cells: string[], timeZone = 'America/New_York'): ParseResult {
  const c = cells.map((v) => (v ?? '').trim());
  const dateIdx = c.findIndex((v) => DATE_RE.test(v));
  const timeIdx = c.findIndex((v) => TIME_RE.test(v));
  if (dateIdx < 0) return { ok: false, error: 'No appointment date found' };
  if (timeIdx < 0) return { ok: false, error: 'No appointment time found' };

  const commentsIdx = c.findIndex((v) => /^Comments:/i.test(v));
  const provider = commentsIdx >= 0 ? c[commentsIdx + 1] || '' : '';
  const patientCell = c[timeIdx + 1] || '';
  if (/^NON-PATIENT$/i.test(patientCell)) return { ok: true, value: { kind: 'block', provider } };

  const idMatch = patientCell.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!idMatch) return { ok: false, error: 'Patient has no Valant ID in parentheses' };

  const dm = c[dateIdx].match(DATE_RE)!;
  const month = MONTHS.indexOf(dm[1].toLowerCase()) + 1;
  if (!month) return { ok: false, error: `Unrecognized month: ${dm[1]}` };
  const [year, day] = [+dm[3], +dm[2]];
  const range = parseTimeRange(c[timeIdx])!;
  const startsAt = zonedToUtc(year, month, day, range.start[0], range.start[1], timeZone);
  const endsAt = zonedToUtc(year, month, day, range.end[0], range.end[1], timeZone);

  // Procedure column: "99214T" (T = telehealth), "Cancelled", "RESCHEDULED", or blank
  const code = c[timeIdx + 3] || '';
  const cpt = code.match(/^(\d{5})/)?.[1];
  const cancelled = /^(cancel+ed|rescheduled)$/i.test(code);
  const noteText = (c.find((v) => /^Notes:/i.test(v)) || '').replace(/^Notes:\s*/i, '');
  const notes = [noteText, code ? `Valant code: ${code}` : ''].filter(Boolean).join('\n') || null;

  return {
    ok: true,
    value: {
      kind: 'appointment',
      sourcePatientId: idMatch[2].trim().toUpperCase(),
      patientName: idMatch[1].trim(),
      provider,
      startsAt,
      endsAt: endsAt > startsAt ? endsAt : new Date(startsAt.getTime() + 30 * 60_000),
      type: (cpt && TYPE_BY_CPT[cpt]) || 'Appointment',
      isVirtual: /^\d{5}T$/i.test(code),
      status: cancelled ? 'CANCELLED' : 'SCHEDULED',
      sourceCode: code || null,
      notes,
    },
  };
}

/**
 * Match Valant's short provider labels ("L.Willis", "Daniel K", "LBarefoot", "Dr. A Gbadehan",
 * "Mackenzie") to a staff member. Returns null unless exactly one staff member fits.
 */
export function matchProvider<T extends { id: string; name: string | null }>(raw: string, staff: T[]): T | null {
  const label = raw.replace(/^dr\.?\s*/i, '').trim();
  if (!label) return null;
  const people = staff
    .map((s) => ({ s, parts: (s.name || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean) }))
    .filter((p) => p.parts.length);
  const first = (p: { parts: string[] }) => p.parts[0];
  const last = (p: { parts: string[] }) => p.parts[p.parts.length - 1];
  const unique = (hits: typeof people) => (hits.length === 1 ? hits[0].s : null);
  const l = label.toLowerCase();

  // "Grace Tabi" — full name
  const full = unique(people.filter((p) => `${first(p)} ${last(p)}` === l.replace(/\s+/g, ' ')));
  if (full) return full;

  // "L.Willis", "Dr. A Gbadehan", "K. Gouch", "R.Betts-Walker" — initial + last name
  let m = l.match(/^([a-z])[.\s]\s*([a-z][a-z-]+)$/);
  if (m) return unique(people.filter((p) => first(p)[0] === m![1] && (last(p) === m![2] || p.parts.join(' ').endsWith(m![2].replace(/-/g, ' ')) || p.parts.includes(m![2]))));

  // "Daniel K", "Augustina A.", "S. Pete" is handled above — first name + last initial
  m = l.match(/^([a-z]{2,})\s+([a-z])\.?$/);
  if (m) return unique(people.filter((p) => first(p) === m![1] && last(p)[0] === m![2]));

  // "LBarefoot" — initial glued to last name; "KatrinK" — first name glued to last initial
  m = label.match(/^([A-Z])([A-Z][a-z]+)$/) || null;
  if (m) {
    const hit = unique(people.filter((p) => first(p)[0] === m![1].toLowerCase() && last(p) === m![2].toLowerCase()));
    if (hit) return hit;
  }
  m = label.match(/^([A-Z][a-z]+)([A-Z])$/) || null;
  if (m) {
    const hit = unique(people.filter((p) => first(p).startsWith(m![1].toLowerCase()) && last(p)[0] === m![2].toLowerCase()));
    if (hit) return hit;
  }

  // "Mackenzie", "Deameshia" — first name only
  if (/^[a-z]+$/.test(l)) return unique(people.filter((p) => first(p) === l)) || unique(people.filter((p) => last(p) === l));
  return null;
}
