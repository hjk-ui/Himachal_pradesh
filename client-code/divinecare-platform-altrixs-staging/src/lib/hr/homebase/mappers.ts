/**
 * Tolerant mappers from Homebase JSON to the minimum fields Altrixs keeps.
 *
 * The exact Homebase field names are not in the documentation we have, so every mapper accepts
 * the common variants and never throws on a missing field: a record without an id is dropped,
 * anything else missing becomes null. Lines marked GUESSED are field names we have not seen in a
 * real Homebase response yet; confirm them against the first live sync (counts only in logs).
 *
 * Minimum necessary: pay rates / wages / phone numbers / addresses / SSNs are NEVER mapped, even
 * when Homebase returns them. HR's compensation record stays in Altrixs HR (StaffHrProfile) and
 * pay stays in Homebase.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) {
    if (k.includes('.')) {
      const [a, b] = k.split('.');
      const inner = o[a];
      if (isObj(inner) && inner[b] !== undefined && inner[b] !== null && inner[b] !== '') return inner[b];
      continue;
    }
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return undefined;
}

function str(v: unknown, max = 200): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim().slice(0, max) || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isObj(v)) return str(v.name ?? v.title ?? v.label, max);
  return null;
}

function idOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 100);
  return null;
}

/** ISO 8601 (or epoch seconds / ms) → Date; null when missing or unparseable. */
export function parseInstant(v: unknown): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v !== 'string') return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

// ─── Locations ───────────────────────────────────────────────────────────────

export type HbLocation = { homebaseId: string; name: string; city: string | null; state: string | null };

export function mapLocation(raw: unknown): HbLocation | null {
  if (!isObj(raw)) return null;
  const homebaseId = idOf(pick(raw, ['uuid', 'location_uuid', 'id']));
  if (!homebaseId) return null;
  return {
    homebaseId,
    name: str(pick(raw, ['name', 'location_name', 'title'])) ?? `Location ${homebaseId.slice(0, 8)}`,
    city: str(pick(raw, ['city', 'address.city' /* GUESSED */])),
    state: str(pick(raw, ['state', 'address.state' /* GUESSED */]), 20),
  };
}

// ─── Employees ───────────────────────────────────────────────────────────────

export type HbEmployee = {
  homebaseId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Homebase role / job title label, e.g. "Therapist" (not an Altrixs role) */
  jobTitle: string | null;
  /** active | archived | unknown */
  status: 'active' | 'archived' | 'unknown';
  locationIds: string[];
};

export function mapEmployee(raw: unknown, locationId?: string | null): HbEmployee | null {
  if (!isObj(raw)) return null;
  const homebaseId = idOf(pick(raw, ['id', 'employee_id', 'user_id' /* GUESSED */, 'uuid']));
  if (!homebaseId) return null;
  let first = str(pick(raw, ['first_name', 'firstName', 'user.first_name' /* GUESSED */]), 100);
  let last = str(pick(raw, ['last_name', 'lastName', 'user.last_name' /* GUESSED */]), 100);
  if (!first && !last) {
    const full = str(pick(raw, ['name', 'full_name' /* GUESSED */]), 200);
    if (full) {
      const parts = full.split(/\s+/);
      first = parts[0] ?? null;
      last = parts.length > 1 ? parts.slice(1).join(' ') : null;
    }
  }
  const emailRaw = str(pick(raw, ['email', 'email_address' /* GUESSED */, 'user.email' /* GUESSED */]), 254);
  const email = emailRaw && /@/.test(emailRaw) ? emailRaw.toLowerCase() : null;
  // Role / job: Homebase "role" may be a string, an object, or a list of jobs. GUESSED shapes.
  let jobTitle = str(pick(raw, ['job_title', 'title', 'role', 'job', 'job.name', 'role.name', 'position', 'department']), 120);
  const jobs = raw.jobs ?? raw.roles; // GUESSED
  if (!jobTitle && Array.isArray(jobs) && jobs.length) jobTitle = str(jobs[0], 120);
  // Archived: archived (bool) / archived_at / status / active. GUESSED variants.
  const archived = bool(raw.archived);
  const active = bool(raw.active);
  const statusStr = str(raw.status, 40)?.toLowerCase() ?? null;
  let status: HbEmployee['status'] = 'unknown';
  if (archived === true || raw.archived_at || raw.terminated_at || statusStr === 'archived' || statusStr === 'terminated' || statusStr === 'inactive' || active === false) status = 'archived';
  else if (archived === false || active === true || statusStr === 'active') status = 'active';
  const locIds = new Set<string>();
  if (locationId) locIds.add(locationId);
  const locField = pick(raw, ['location_uuid', 'location_id']);
  if (idOf(locField)) locIds.add(idOf(locField)!);
  return { homebaseId, firstName: first, lastName: last, email, jobTitle, status, locationIds: [...locIds] };
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

export type HbShift = {
  homebaseId: string;
  homebaseEmployeeId: string | null;
  homebaseLocationId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  roleLabel: string | null;
  published: boolean | null;
};

export function mapShift(raw: unknown, locationId?: string | null): HbShift | null {
  if (!isObj(raw)) return null;
  const homebaseId = idOf(pick(raw, ['id', 'shift_id', 'uuid']));
  if (!homebaseId) return null;
  return {
    homebaseId,
    homebaseEmployeeId: idOf(pick(raw, ['user_id', 'employee_id', 'employee.id' /* GUESSED */, 'user.id' /* GUESSED */])),
    homebaseLocationId: idOf(pick(raw, ['location_uuid', 'location_id'])) ?? locationId ?? null,
    startAt: parseInstant(pick(raw, ['start_at', 'starts_at', 'start_time', 'start'])),
    endAt: parseInstant(pick(raw, ['end_at', 'ends_at', 'end_time', 'end'])),
    roleLabel: str(pick(raw, ['role', 'job', 'role.name', 'job.name', 'department' /* GUESSED */]), 120),
    published: bool(raw.published), // GUESSED
  };
}

// ─── Timecards ───────────────────────────────────────────────────────────────

export type HbTimecard = {
  homebaseId: string;
  homebaseEmployeeId: string | null;
  homebaseLocationId: string | null;
  homebaseShiftId: string | null;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  /** Unpaid break minutes deducted from worked time */
  breakMinutes: number;
  /** Clocked minutes minus unpaid breaks; null while still clocked in */
  workedMinutes: number | null;
  approved: boolean | null;
};

/** Unpaid break minutes: a minutes field, or a list of breaks with start/end (paid ones skipped). */
export function breakMinutesOf(raw: Obj): number {
  const direct = num(pick(raw, ['break_minutes', 'unpaid_break_minutes', 'breaks_minutes', 'total_break_minutes'])); // GUESSED names
  if (direct !== null && direct >= 0) return Math.round(direct);
  const hours = num(pick(raw, ['break_hours', 'unpaid_break_hours'])); // GUESSED
  if (hours !== null && hours >= 0) return Math.round(hours * 60);
  const list = raw.timebreaks ?? raw.breaks ?? raw.time_breaks; // GUESSED
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const b of list) {
    if (!isObj(b)) continue;
    if (bool(b.paid) === true) continue;
    const m = num(pick(b, ['duration_minutes', 'minutes']));
    if (m !== null && m >= 0) {
      total += m;
      continue;
    }
    const s = parseInstant(pick(b, ['start_at', 'started_at', 'start']));
    const e = parseInstant(pick(b, ['end_at', 'ended_at', 'end']));
    if (s && e && e > s) total += (e.getTime() - s.getTime()) / 60_000;
  }
  return Math.round(total);
}

export function workedMinutes(clockIn: Date | null, clockOut: Date | null, breakMinutes: number): number | null {
  if (!clockIn || !clockOut) return null;
  const mins = (clockOut.getTime() - clockIn.getTime()) / 60_000;
  if (!Number.isFinite(mins) || mins <= 0) return 0;
  // A single timecard over 24 h is a data error (forgot to clock out); cap so totals stay sane.
  return Math.max(0, Math.round(Math.min(mins, 24 * 60) - breakMinutes));
}

export function mapTimecard(raw: unknown, locationId?: string | null): HbTimecard | null {
  if (!isObj(raw)) return null;
  const homebaseId = idOf(pick(raw, ['id', 'timecard_id', 'uuid']));
  if (!homebaseId) return null;
  const clockInAt = parseInstant(pick(raw, ['clock_in', 'clock_in_at', 'clocked_in_at', 'start_at', 'started_at']));
  const clockOutAt = parseInstant(pick(raw, ['clock_out', 'clock_out_at', 'clocked_out_at', 'end_at', 'ended_at']));
  const breakMinutes = breakMinutesOf(raw);
  return {
    homebaseId,
    homebaseEmployeeId: idOf(pick(raw, ['user_id', 'employee_id', 'employee.id' /* GUESSED */, 'user.id' /* GUESSED */])),
    homebaseLocationId: idOf(pick(raw, ['location_uuid', 'location_id'])) ?? locationId ?? null,
    homebaseShiftId: idOf(pick(raw, ['shift_id'])), // GUESSED
    clockInAt,
    clockOutAt,
    breakMinutes,
    workedMinutes: workedMinutes(clockInAt, clockOutAt, breakMinutes),
    approved: bool(raw.approved ?? raw.is_approved), // GUESSED
  };
}

/** /shifts/deleted, /timecards/deleted: a list of ids or of objects with an id. */
export function mapDeletedIds(items: unknown[]): string[] {
  const out = new Set<string>();
  for (const it of items) {
    const id = isObj(it) ? idOf(pick(it, ['id', 'shift_id', 'timecard_id', 'uuid'])) : idOf(it);
    if (id) out.add(id);
  }
  return [...out];
}
