/**
 * Huddle sheet: one-page summary of the clients on a provider's schedule for one practice day.
 * Pure (no prisma, no AWS) so it is unit-tested directly; the loader is server.ts.
 *
 *  - Date: today before 3 PM practice time, tomorrow after (defaultHuddleDate).
 *  - Scope: providers see only their own schedule; leadership may pick a provider
 *    (resolveHuddleProvider). Caseload rules still apply to the viewer (huddleAppointmentWhere).
 *  - Summary: one line copied from the existing chart history digest (no AI call here; Part 2 facts
 *    are dropped before this module sees the digest). No digest = "Summary not prepared yet".
 *  - Flags: deterministic, from structured chart rows only (deriveHuddleFlags); a flag is shown
 *    only when its data says so, never inferred.
 *  - Evening notice: counts and a link only (huddleNoticeEmail); never names, MRNs or flags.
 */
import type { Prisma, Role } from '@prisma/client';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { addDaysYmd } from '@/lib/dashboard/practiceDay';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { summarizeRisk, activeAuthSummaries, type AuthRow, type CssrsRow, type RiskAlertRow } from '@/lib/clients/chartBanner';
import { labsExtra, medChangeFacts, overdueMeasures, type MedLike, type RawLabOrder, type RawMeasureAssignment } from '@/lib/ai/previsit/enrich';
import { medTrialText } from '@/lib/ai/chartDigest/briefFacts';
import type { ChartDigest, Citation, DigestItem } from '@/lib/ai/chartDigest/types';
import type { MedicalDigest } from '@/lib/ai/chartDigest/medical/types';

const DAY_MS = 86_400_000;

export const HUDDLE_PATH = '/dashboard/huddle';
export const HUDDLE_RESOURCE = 'huddleSheet';
/** Practice-clock hour after which the default date is tomorrow */
export const HUDDLE_TOMORROW_FROM_HOUR = 15;
export const HUDDLE_SUMMARY_MAX_WORDS = 30;
export const HUDDLE_NOT_PREPARED = 'Summary not prepared yet';
/** Latest C-SSRS within this many days counts as "recent" */
export const HUDDLE_RECENT_SI_DAYS = 90;
/** Treatment plan review due within this many days of the visit */
export const HUDDLE_PLAN_DUE_SOON_DAYS = 14;
export const HUDDLE_MAX_VISITS = 60;

export { canPickHuddleProvider, canViewHuddle, resolveHuddleProvider } from './access';

// ─── Date ────────────────────────────────────────────────────────────────────

/** Today before 3 PM practice time, tomorrow from 3 PM on */
export function defaultHuddleDate(now: Date, timeZone: string): string {
  const wall = toPracticeWallTime(now, timeZone);
  const hour = Number.parseInt(wall.time.slice(0, 2), 10);
  return hour >= HUDDLE_TOMORROW_FROM_HOUR ? addDaysYmd(wall.date, 1) : wall.date;
}

/** ?date=YYYY-MM-DD | today | tomorrow | (missing → default). Invalid → default. */
export function parseHuddleDate(raw: string | null | undefined, now: Date, timeZone: string): string {
  const today = toPracticeWallTime(now, timeZone).date;
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'today') return today;
  if (v === 'tomorrow') return addDaysYmd(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))) return v;
  return defaultHuddleDate(now, timeZone);
}

/** 'today' | 'tomorrow' | null (another day) for the date toggle */
export function huddleDayLabel(date: string, now: Date, timeZone: string): 'today' | 'tomorrow' | null {
  const today = toPracticeWallTime(now, timeZone).date;
  return date === today ? 'today' : date === addDaysYmd(today, 1) ? 'tomorrow' : null;
}

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Cancelled (incl. late cancel) visits are not on the huddle */
export const HUDDLE_EXCLUDED_STATUSES = ['CANCELLED', 'LATE_CANCEL'] as const;

/**
 * The provider's own visits on the practice day, for clients the VIEWER may open under the caseload
 * rules (clientAccessWhere), never cancelled visits.
 */
export function huddleAppointmentWhere(
  viewer: { organizationId: string; userId: string; role: Role },
  providerId: string,
  window: { start: Date; end: Date }
): Prisma.AppointmentWhereInput {
  return {
    AND: [
      appointmentOrgWhere(viewer.organizationId),
      { clinicianId: providerId },
      { client: clientAccessWhere({ organizationId: viewer.organizationId, actorUserId: viewer.userId, actorRole: viewer.role }) },
      { startsAt: { gte: window.start, lt: window.end } },
      { status: { notIn: [...HUDDLE_EXCLUDED_STATUSES] } },
    ],
  };
}

// ─── Summary (from the existing digest; no AI) ───────────────────────────────

export type HuddleSource = { key: string; label: string; href: string | null; page: number | null };
export type HuddleSummary = { text: string; generated: string; sources: HuddleSource[] } | null;

export function clipWords(text: string, max = HUDDLE_SUMMARY_MAX_WORDS): string {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ').replace(/[;,.:]+$/, '')}…`;
}

/** Most recent dated item (undated items count as oldest; ties keep the later array position) */
function latest<T extends { date: string | null; part2?: boolean }>(list: readonly T[] | undefined): T | null {
  let best: T | null = null;
  for (const it of list ?? []) {
    if (it.part2) continue;
    if (!best || (it.date ?? '') >= (best.date ?? '')) best = it;
  }
  return best;
}

type SummaryPick = { label: string; text: string; cites: Citation[] };

/**
 * One line from the digest, ≤ 30 words: the latest diagnosis / problem plus the latest open item
 * from the last visit (prescribers: the latest medication trial when there is no open item). The
 * text is copied from the digest (already redacted and cited); Part 2 facts are skipped.
 */
export function digestSummaryLine(
  input: { kind: 'bh'; digest: ChartDigest } | { kind: 'medical'; digest: MedicalDigest },
  audience: 'therapist' | 'prescriber' | 'primary_care'
): { text: string; cites: Citation[] } | null {
  const picks: SummaryPick[] = [];
  const add = (label: string, it: DigestItem | null) => {
    if (it?.text?.trim()) picks.push({ label, text: it.text.trim(), cites: it.cites ?? [] });
  };
  if (input.kind === 'medical') {
    const d = input.digest;
    add('Problem', latest(d.problems));
    add('Open item', latest(d.openItems));
  } else {
    const d = input.digest;
    add('Dx', latest(d.diagnoses));
    const open = latest(d.openItems);
    if (open) add('Open item', open);
    else if (audience === 'prescriber') {
      const trial = [...(d.medicationTrials ?? [])].filter((t) => !t.part2).pop();
      if (trial) picks.push({ label: 'Med', text: medTrialText(trial), cites: trial.cites ?? [] });
    } else add('Therapy', latest(d.therapy));
  }
  if (!picks.length) return null;
  return { text: clipWords(picks.map((p) => `${p.label}: ${p.text.replace(/[.;]+$/, '')}`).join('; ')), cites: picks.flatMap((p) => p.cites) };
}

/** Source chips for the summary (one per cited source; label = source label + date; link only if the viewer may open it) */
export function summarySources(
  cites: readonly Citation[],
  sources: Record<string, { date: string; label: string; part2: boolean }>,
  links: Record<string, string | null>
): HuddleSource[] {
  const out: HuddleSource[] = [];
  const seen = new Set<string>();
  for (const c of cites) {
    const src = sources[c.source];
    if (!src || src.part2 || seen.has(c.source)) continue;
    seen.add(c.source);
    const base = links[c.source] ?? null;
    const href = base && c.source.startsWith('doc:') && c.page ? `${base}#page=${c.page}` : base;
    out.push({ key: c.source, label: `${src.label} ${c.date || src.date}`.trim(), href, page: c.page });
    if (out.length >= 4) break;
  }
  return out;
}

// ─── Flags (deterministic, structured data only) ─────────────────────────────

export type HuddleFlagKey = 'risk' | 'med_change' | 'labs_due' | 'measures_due' | 'plan_due' | 'consent' | 'auth';
export type HuddleFlag = { key: HuddleFlagKey; label: string; detail: string; tone: 'danger' | 'warning' | 'info' };

export const HUDDLE_FLAG_ORDER: HuddleFlagKey[] = ['risk', 'med_change', 'labs_due', 'measures_due', 'plan_due', 'consent', 'auth'];

export type HuddleFlagInput = {
  /** Start of the visit day (practice clock): "due" is judged as of the visit */
  asOf: Date;
  asOfYmd: string;
  day: (d: Date) => string;
  riskLevel: string;
  riskAlerts: RiskAlertRow[];
  latestCssrs: CssrsRow | null;
  /** Stanley-Brown safety plan on file (module data); null = the viewer's role cannot see plans */
  safetyPlanOnFile: boolean | null;
  medications: (MedLike & { isAntipsychotic?: boolean | null })[];
  /** Last attended visit before this one (any type); null = none on file */
  lastVisitAt: Date | null;
  labOrders: RawLabOrder[] | null;
  measureAssignments: RawMeasureAssignment[] | null;
  /** instrument id (lower case) → latest score date YYYY-MM-DD */
  scoreDays: Map<string, string>;
  treatmentPlan: { status: string; reviewDueAt: Date | null } | null;
  /** Required consents that are not complete (front-desk standard): missing / expiring / expired / revoked */
  consentGaps: { title: string; standard: string }[] | null;
  auths: AuthRow[] | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deriveHuddleFlags(i: HuddleFlagInput): HuddleFlag[] {
  const flags: HuddleFlag[] = [];

  // Risk: an unreviewed risk alert, a safety-flagged C-SSRS in the last 90 days, or a safety plan on file
  const risk = summarizeRisk({ riskLevel: i.riskLevel, alerts: i.riskAlerts, latestCssrs: i.latestCssrs });
  const recentSi = Boolean(i.latestCssrs?.safetyFlagged && i.asOf.getTime() - i.latestCssrs.createdAt.getTime() <= HUDDLE_RECENT_SI_DAYS * DAY_MS);
  const riskParts: string[] = [];
  if (risk.openAlerts) riskParts.push(`${plural(risk.openAlerts, 'unreviewed risk alert')}`);
  if (recentSi) riskParts.push(`C-SSRS safety-flagged ${i.day(i.latestCssrs!.createdAt)}`);
  if (i.safetyPlanOnFile) riskParts.push('safety plan on file');
  if (riskParts.length) flags.push({ key: 'risk', label: 'Risk', detail: riskParts.join('; '), tone: risk.openAlerts || recentSi ? 'danger' : 'warning' });

  // Medication started / stopped since the last attended visit (90-day window when there is none)
  const changes = medChangeFacts(i.medications, i.asOf, i.day).filter((c) => !i.lastVisitAt || c.date > i.day(i.lastVisitAt));
  if (changes.length) {
    const first = changes[0];
    flags.push({
      key: 'med_change',
      label: 'Med change',
      detail: `${first.change} ${first.name}${first.dose ? ` ${first.dose}` : ''} ${first.date}${changes.length > 1 ? ` (+${changes.length - 1} more)` : ''}`,
      tone: 'info',
    });
  }

  // Monitoring labs overdue / none on file for an active medication (order-set schedules; enrich.ts)
  if (i.labOrders) {
    const active = i.medications.filter((m) => m.active && !/stop|discontinu|inactive|cancel/i.test(m.status || ''));
    const { monitoring } = labsExtra({
      audience: 'prescriber',
      orders: i.labOrders,
      activeMeds: active.map((m) => ({ name: `${m.medicationName} ${m.drugName ?? ''}`, isAntipsychotic: Boolean(m.isAntipsychotic) })),
      documentLabs: [],
      now: i.asOf,
      day: i.day,
      redact: (t) => t,
    });
    if (monitoring.length) {
      const m = monitoring[0];
      flags.push({
        key: 'labs_due',
        label: 'Labs due',
        detail: `${m.test.toUpperCase()} for ${m.medication}: ${m.state === 'overdue' ? `last ${m.lastDate}` : 'none on file'}${monitoring.length > 1 ? ` (+${monitoring.length - 1} more)` : ''}`,
        tone: 'warning',
      });
    }
  }

  // Measures due (PHQ-9 / GAD-7 / MBC interval assignments)
  if (i.measureAssignments) {
    const due = overdueMeasures(i.measureAssignments, (id) => i.scoreDays.get(id.toLowerCase()) ?? null, i.asOfYmd, i.day);
    if (due.length) flags.push({ key: 'measures_due', label: 'Measures due', detail: due.map((d) => d.instrument).join(', '), tone: 'info' });
  }

  // Treatment plan review overdue or due within 14 days of the visit
  const tp = i.treatmentPlan;
  if (tp?.reviewDueAt) {
    const due = i.day(tp.reviewDueAt);
    const soon = i.day(new Date(i.asOf.getTime() + HUDDLE_PLAN_DUE_SOON_DAYS * DAY_MS));
    if (due < i.asOfYmd) flags.push({ key: 'plan_due', label: 'Plan review', detail: `overdue since ${due}`, tone: 'warning' });
    else if (due <= soon) flags.push({ key: 'plan_due', label: 'Plan review', detail: `due ${due}`, tone: 'info' });
  }

  // Required consents missing / expiring / expired / revoked
  if (i.consentGaps?.length) {
    const missing = i.consentGaps.filter((g) => g.standard !== 'expiring').length;
    const expiring = i.consentGaps.length - missing;
    const parts = [missing ? `${missing} missing or expired` : '', expiring ? `${expiring} expiring` : ''].filter(Boolean);
    flags.push({ key: 'consent', label: 'Consent', detail: parts.join(', '), tone: missing ? 'warning' : 'info' });
  }

  // Active authorization nearly used up (< 3 visits left) or ending within 14 days
  if (i.auths) {
    const warn = activeAuthSummaries(i.auths, i.asOf).find((a) => a.warn);
    if (warn) {
      const parts = [warn.lowVisits ? `${plural(warn.unitsRemaining, 'visit')} left` : '', warn.endingSoon && warn.endDate ? `ends ${warn.endDate}` : ''].filter(Boolean);
      flags.push({ key: 'auth', label: 'Authorization', detail: parts.join(', '), tone: 'warning' });
    }
  }

  return flags.sort((a, b) => HUDDLE_FLAG_ORDER.indexOf(a.key) - HUDDLE_FLAG_ORDER.indexOf(b.key));
}

// ─── Sheet shape ─────────────────────────────────────────────────────────────

export type HuddleVisit = {
  id: string;
  /** null for a protected record the viewer cannot open */
  clientId: string | null;
  clientName: string;
  mrn: string | null;
  protected: boolean;
  /** HH:mm practice clock */
  startTime: string;
  endTime: string;
  type: string;
  status: string;
  isVirtual: boolean;
  locationName: string | null;
  summary: HuddleSummary;
  /** Why there is no summary (shown instead): "Summary not prepared yet" / role / protected */
  summaryNote: string | null;
  flags: HuddleFlag[];
};

export type HuddleSheet = {
  date: string;
  timeZone: string;
  day: 'today' | 'tomorrow' | null;
  provider: { id: string; name: string | null };
  visits: HuddleVisit[];
  counts: { visits: number; flagged: number; flags: number };
  generatedAt: string;
};

export function huddleCounts(visits: readonly Pick<HuddleVisit, 'flags'>[]): HuddleSheet['counts'] {
  return {
    visits: visits.length,
    flagged: visits.filter((v) => v.flags.length > 0).length,
    flags: visits.reduce((n, v) => n + v.flags.length, 0),
  };
}

// ─── Evening notice (no PHI) ─────────────────────────────────────────────────

export function huddleNoticeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.HUDDLE_EMAIL_NOTICE ?? '').trim().toLowerCase() === 'on';
}

/**
 * The evening email: the visit COUNT and a link. Never client names, MRNs, diagnoses, visit types or
 * flags (tested). The link carries only the date.
 */
export function huddleNoticeEmail(input: { visits: number; date: string; baseUrl: string }): { subject: string; text: string; html: string } {
  const n = Math.max(0, Math.floor(input.visits));
  const url = `${input.baseUrl.replace(/\/$/, '')}${HUDDLE_PATH}?date=${encodeURIComponent(input.date)}`;
  const visits = `${n} visit${n === 1 ? '' : 's'}`;
  const subject = `Your summary for tomorrow (${visits}) is ready`;
  const text = [
    `Your summary for tomorrow (${visits}) is ready.`,
    '',
    `Open it in Altrixs: ${url}`,
    '',
    'Sign in to see the details. To stop these emails, turn off "Email me when tomorrow\'s summary is ready" on the huddle page.',
  ].join('\n');
  const html = `<p>Your summary for tomorrow (${visits}) is ready.</p><p><a href="${url}">Open it in Altrixs</a></p><p style="color:#64748b;font-size:12px">Sign in to see the details. To stop these emails, turn off &quot;Email me when tomorrow&#39;s summary is ready&quot; on the huddle page.</p>`;
  return { subject, text, html };
}

/** Visits per provider (non-cancelled, with a clinician); counts only */
export function visitsByProvider(appts: readonly { clinicianId: string | null; status: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of appts) {
    if (!a.clinicianId || (HUDDLE_EXCLUDED_STATUSES as readonly string[]).includes(a.status)) continue;
    out.set(a.clinicianId, (out.get(a.clinicianId) ?? 0) + 1);
  }
  return out;
}
