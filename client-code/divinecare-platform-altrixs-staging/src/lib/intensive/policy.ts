/**
 * Intensive program policy: defaults per program type / age group, and the effective policy of a
 * program (its saved value, else the default). Pure.
 *
 * NOTHING here is a payer or regulatory rule. Every default is "practice policy, confirm": the
 * program page shows each one with that label until leadership confirms the program policy
 * (IntensiveProgram.policyConfirmedAt). Minimum weekly hours follow the levels the owner asked for
 * (IOP adult 9, adolescent 6; PHP 20); the plan / review / renewal / follow-up numbers are sensible
 * starting points for the practice to set. No fees anywhere.
 */
import {
  PROGRAM_TYPE_META,
  SESSION_TYPES,
  type AgeGroup,
  type BillingMode,
  type ProgramType,
  type ScheduleBlock,
  type ScheduleTemplate,
  type ServiceCodes,
  type SessionType,
  type UnitRounding,
  type UnitRule,
  type UnitType,
  UNIT_TYPES,
} from './types';

export const CONFIRM_LABEL = 'Practice policy — confirm';

export type PolicyKey =
  | 'minWeeklyHours'
  | 'initialPlanDays'
  | 'planReviewDays'
  | 'authRenewalLeadDays'
  | 'followUpWindowDays'
  | 'missedDayOutreachHours';

export const POLICY_LABEL: Record<PolicyKey, { label: string; help: string; unit: string }> = {
  minWeeklyHours: { label: 'Minimum weekly hours', help: 'Hours a client should attend each full program week; under it is flagged.', unit: 'hours' },
  initialPlanDays: { label: 'Initial treatment plan due', help: 'Days after admission by which the program treatment plan is signed.', unit: 'days' },
  planReviewDays: { label: 'Treatment plan review interval', help: 'Days between treatment plan reviews while in the program.', unit: 'days' },
  authRenewalLeadDays: { label: 'Authorization renewal lead time', help: 'Flag a concurrent review / renewal this many days before the authorization ends.', unit: 'days' },
  followUpWindowDays: { label: 'Post-discharge follow-up window', help: 'Follow-up appointment expected within this many days of discharge (HEDIS FUH-style 7-day measure).', unit: 'days' },
  missedDayOutreachHours: { label: 'Missed-day outreach due', help: 'Hours after a missed program day by which outreach is due.', unit: 'hours' },
};

/** Default per program type and age group. All "practice policy — confirm". */
export function defaultPolicy(type: ProgramType, ageGroup: AgeGroup): Record<PolicyKey, number> {
  const php = type === 'PHP';
  return {
    minWeeklyHours: php ? 20 : ageGroup === 'adolescent' ? 6 : 9,
    initialPlanDays: 7,
    planReviewDays: php ? 14 : 30,
    authRenewalLeadDays: 7,
    followUpWindowDays: 7,
    missedDayOutreachHours: 24,
  };
}

export type EffectiveValue = { value: number; isDefault: boolean };

export type ProgramPolicySource = {
  programType: string;
  ageGroup: string;
  minWeeklyHours?: number | null;
  initialPlanDays?: number | null;
  planReviewDays?: number | null;
  authRenewalLeadDays?: number | null;
  followUpWindowDays?: number | null;
  missedDayOutreachHours?: number | null;
};

function typeOf(p: { programType: string }): ProgramType {
  return p.programType === 'SUD_IOP' || p.programType === 'PHP' ? p.programType : 'MH_IOP';
}
function ageOf(p: { ageGroup: string }): AgeGroup {
  return p.ageGroup === 'adolescent' ? 'adolescent' : 'adult';
}

export function effectivePolicy(p: ProgramPolicySource): Record<PolicyKey, EffectiveValue> {
  const d = defaultPolicy(typeOf(p), ageOf(p));
  const pick = (k: PolicyKey): EffectiveValue => {
    const v = p[k];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? { value: v, isDefault: false } : { value: d[k], isDefault: true };
  };
  return {
    minWeeklyHours: pick('minWeeklyHours'),
    initialPlanDays: pick('initialPlanDays'),
    planReviewDays: pick('planReviewDays'),
    authRenewalLeadDays: pick('authRenewalLeadDays'),
    followUpWindowDays: pick('followUpWindowDays'),
    missedDayOutreachHours: pick('missedDayOutreachHours'),
  };
}

export function policyValues(p: ProgramPolicySource): Record<PolicyKey, number> {
  const e = effectivePolicy(p);
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.value])) as Record<PolicyKey, number>;
}

// ─── Billing codes & unit rules (defaults for billing to confirm) ───────────

export function defaultServiceCodes(type: ProgramType): ServiceCodes {
  if (type === 'SUD_IOP') return { group: 'H0005', individual: 'H0004', family: null, psychiatry: null };
  return { group: '90853', individual: '90834', family: '90847', psychiatry: null };
}

/**
 * Unit rule defaults. The per diem codes count one unit per day; the minimum minutes for a
 * billable day are NOT set (null) because they come from the payer contract / fee schedule, which
 * is not loaded here: drafts are held until billing sets them. Per-service codes follow their
 * HCPCS / CPT unit (H0004 per 15 minutes, the rest per session); rounding "midpoint" (a unit
 * counts at half its length) is a default for billing to confirm.
 */
export function defaultUnitRules(type: ProgramType): UnitRule[] {
  const perDiem = PROGRAM_TYPE_META[type].defaultPerDiemCode;
  const rules: UnitRule[] = [{ code: perDiem, unit: 'per_diem', minMinutes: null, rounding: 'whole' }];
  const codes = defaultServiceCodes(type);
  for (const s of SESSION_TYPES) {
    const c = codes[s];
    if (!c || rules.some((r) => r.code === c)) continue;
    rules.push({ code: c, unit: c === 'H0004' ? 'per_15_min' : 'per_session', minMinutes: null, rounding: 'midpoint' });
  }
  return rules;
}

function cleanCode(v: unknown): string | null {
  const t = String(v ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,7}$/.test(t) ? t : null;
}

export function parseServiceCodes(raw: unknown, type: ProgramType): ServiceCodes {
  const base = defaultServiceCodes(type);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const out = { ...base };
  for (const s of SESSION_TYPES) if (s in o) out[s as SessionType] = cleanCode(o[s]);
  return out;
}

export function parseUnitRules(raw: unknown, type: ProgramType): UnitRule[] {
  if (!Array.isArray(raw)) return defaultUnitRules(type);
  const out: UnitRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const code = cleanCode(o.code);
    const unit = (UNIT_TYPES as readonly string[]).includes(String(o.unit)) ? (String(o.unit) as UnitType) : null;
    if (!code || !unit || out.some((x) => x.code === code)) continue;
    const m = Number(o.minMinutes);
    out.push({
      code,
      unit,
      minMinutes: o.minMinutes === null || o.minMinutes === undefined || o.minMinutes === '' || !Number.isFinite(m) || m <= 0 ? null : Math.round(m),
      rounding: (o.rounding === 'whole' ? 'whole' : 'midpoint') as UnitRounding,
    });
  }
  return out.length ? out : defaultUnitRules(type);
}

export function perDiemCodeOf(p: { programType: string; perDiemCode?: string | null }): string {
  return cleanCode(p.perDiemCode) ?? PROGRAM_TYPE_META[typeOf(p)].defaultPerDiemCode;
}

export function billingModeOf(v: unknown): BillingMode {
  return v === 'per_service' ? 'per_service' : 'per_diem';
}

// ─── Schedule template ───────────────────────────────────────────────────────

/** Default template: Mon/Wed/Thu (IOP, 3 h) or Mon-Fri (PHP, ~4 h+). A starting point to edit. */
export function defaultSchedule(type: ProgramType): ScheduleTemplate {
  if (type === 'PHP') {
    return {
      days: [1, 2, 3, 4, 5],
      blocks: [
        { key: 'b1', label: 'Group 1', start: '09:00', minutes: 60, sessionType: 'group' },
        { key: 'b2', label: 'Group 2', start: '10:15', minutes: 60, sessionType: 'group' },
        { key: 'b3', label: 'Individual / family', start: '11:30', minutes: 60, sessionType: 'individual' },
        { key: 'b4', label: 'Group 3', start: '13:00', minutes: 60, sessionType: 'group' },
      ],
    };
  }
  return {
    days: [1, 3, 4],
    blocks: [
      { key: 'b1', label: 'Group 1', start: '09:00', minutes: 90, sessionType: 'group' },
      { key: 'b2', label: 'Group 2', start: '10:45', minutes: 90, sessionType: 'group' },
    ],
  };
}

export function parseSchedule(raw: unknown, type: ProgramType): ScheduleTemplate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultSchedule(type);
  const o = raw as Record<string, unknown>;
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const blocks: ScheduleBlock[] = [];
  if (Array.isArray(o.blocks)) {
    o.blocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      const x = b as Record<string, unknown>;
      const minutes = Math.round(Number(x.minutes));
      const st = (SESSION_TYPES as readonly string[]).includes(String(x.sessionType)) ? (String(x.sessionType) as SessionType) : 'group';
      const start = /^\d{2}:\d{2}$/.test(String(x.start ?? '')) ? String(x.start) : '09:00';
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) return;
      const key = String(x.key ?? '').trim() || `b${i + 1}`;
      if (blocks.some((y) => y.key === key)) return;
      blocks.push({ key, label: String(x.label ?? '').trim().slice(0, 60) || `Session ${i + 1}`, start, minutes, sessionType: st });
    });
  }
  return days.length && blocks.length ? { days, blocks } : defaultSchedule(type);
}

/** Scheduled program minutes per program day and per week. */
export function scheduleMinutes(t: ScheduleTemplate): { perDay: number; perWeek: number; daysPerWeek: number } {
  const perDay = t.blocks.reduce((s, b) => s + b.minutes, 0);
  return { perDay, perWeek: perDay * t.days.length, daysPerWeek: t.days.length };
}

/** Problems with a program setup (shown on the setup form, not blocking save unless noted). */
export function scheduleWarnings(t: ScheduleTemplate, minWeeklyHours: number): string[] {
  const out: string[] = [];
  const { perWeek } = scheduleMinutes(t);
  if (perWeek < minWeeklyHours * 60) {
    out.push(`The schedule offers ${(perWeek / 60).toFixed(1)} hours a week, under the ${minWeeklyHours}-hour weekly minimum.`);
  }
  return out;
}

// ─── Program setup rules ─────────────────────────────────────────────────────

/** PHP cannot be active until the practice confirms PHP licensure. Null = OK. */
export function programActivationProblem(type: ProgramType, active: boolean, phpLicensureConfirmed: boolean): string | null {
  if (type === 'PHP' && active && !phpLicensureConfirmed) {
    return 'PHP requires PHP licensure: confirm the practice holds a PHP license before turning the program on.';
  }
  return null;
}

/** New programs: PHP starts inactive (requires PHP licensure); IOP starts active. */
export function defaultActive(type: ProgramType): boolean {
  return type !== 'PHP';
}

/** 42 CFR Part 2: SUD IOP always; a PHP when set up as a SUD (ASAM 2.5) program. */
export function programIsPart2(type: ProgramType, sudFocus: boolean): boolean {
  return type === 'SUD_IOP' || (type === 'PHP' && sudFocus);
}
