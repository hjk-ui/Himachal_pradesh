/**
 * Population Health (/dashboard/population): pure aggregation for GET /api/reports/population.
 *
 * The loader (populationHealthQueries.ts) reads one fact row per ACTIVE client in the viewer's scope
 * (org; caseload roles only their assigned clients; location / clinician filters; locked Part 2 /
 * protected clients removed and only counted). Everything shown on the page is counted here from
 * those rows, so a number is always "x of the active clients in scope", never a count of one
 * page of the client list. No fabricated values: anything without a source is null / "unknown".
 */
import type { Prisma } from '@prisma/client';
import { summarizeRisk } from '@/lib/clients/chartBanner';
import { isCaseloadScope, rate, reportClientWhere, type Rate, type ReportScope } from '@/lib/reports/outcomesReports';

export const POPULATION_PATH = '/dashboard/population';
const DAY_MS = 86_400_000;
/** PHQ-9 at or above this is an MBC escalation (features/ehr/assessments/thresholds MBC_THRESHOLDS) */
export const PHQ9_SEVERE = 20;
export const MBC_WINDOW_DAYS = 90;
export const NO_VISIT_DAYS = 60;
export const PREVIEW_ROWS = 5;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

// ─── Filters ─────────────────────────────────────────────────────────────────

export const RISK_TIERS = ['high', 'moderate', 'low', 'unknown'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const ACTION_KINDS = ['high_no_safety_plan', 'high_overdue', 'phq9_severe_unacked', 'no_visit_60', 'not_measured_90'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type ListKey = `tier:${RiskTier}` | `action:${ActionKind}`;

export type PopulationFilters = {
  locationId: string | null;
  clinicianId: string | null;
  /** One list to return a full page of (the rest come back as previews) */
  list: ListKey | null;
  page: number;
  pageSize: number;
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parsePopulationFilters(sp: URLSearchParams): { ok: true; filters: PopulationFilters } | { ok: false; error: string } {
  const locationId = (sp.get('location') ?? '').trim() || null;
  const clinicianId = (sp.get('clinician') ?? '').trim() || null;
  if (locationId && !ID_RE.test(locationId)) return { ok: false, error: 'Invalid location' };
  if (clinicianId && !ID_RE.test(clinicianId)) return { ok: false, error: 'Invalid clinician' };
  const listRaw = (sp.get('list') ?? '').trim();
  let list: ListKey | null = null;
  if (listRaw) {
    const [kind, value] = listRaw.split(':');
    const ok =
      (kind === 'tier' && (RISK_TIERS as readonly string[]).includes(value)) ||
      (kind === 'action' && (ACTION_KINDS as readonly string[]).includes(value));
    if (!ok) return { ok: false, error: 'Unknown list' };
    list = listRaw as ListKey;
  }
  const page = Number.parseInt(sp.get('page') ?? '0', 10);
  const size = Number.parseInt(sp.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(page) || page < 0) return { ok: false, error: 'Invalid page' };
  if (!Number.isFinite(size) || size < 1) return { ok: false, error: 'Invalid pageSize' };
  return { ok: true, filters: { locationId, clinicianId, list, page, pageSize: Math.min(size, MAX_PAGE_SIZE) } };
}

/** Active clients the viewer may report on (reportClientWhere + status ACTIVE). */
export function populationClientWhere(scope: ReportScope): Prisma.ClientWhereInput {
  return { AND: [reportClientWhere(scope, { byAssignee: true }), { status: 'ACTIVE' }] };
}

// ─── Per-client facts ────────────────────────────────────────────────────────

export type PopulationClientFacts = {
  id: string;
  name: string;
  mrn: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  locationName: string | null;
  /** Client.riskLevel enum (HIGH / MEDIUM / LOW; LOW is also the column default) */
  riskLevel: string;
  createdAt: Date;
  importedAt: Date | null;
  /** Severities of unreviewed RiskAlerts */
  openAlertSeverities: string[];
  /** Latest C-SSRS: safety flag; null = no C-SSRS on file */
  latestCssrsFlagged: boolean | null;
  /** Any risk screen on file: C-SSRS, a RiskAlert (any status), an evaluation risk section, a safety plan */
  hasRiskScreen: boolean;
  /** Last attended visit (appointment, signed note or billed Valant charge) */
  lastVisitAt: Date | null;
  nextAppointmentAt: Date | null;
  /** Session-frequency cadence; null = the cadence could not be computed */
  therapyOverdue: boolean | null;
  medOverdue: boolean | null;
  therapyDaysOverdue: number;
  /** PHQ-9 or GAD-7 recorded in the last MBC_WINDOW_DAYS */
  measured90: boolean;
  hasSafetyPlan: boolean;
  /** Latest unacknowledged PHQ-9 ≥ 20 */
  severePhq9: { score: number; at: Date } | null;
  /** Protected (SensitiveRecord) client the viewer may open: lists show the alias only */
  protectedAlias: string | null;
  isProtected: boolean;
};

/**
 * Risk tier. Level = chartBanner.summarizeRisk (highest of chart risk, unreviewed alerts, a
 * safety-flagged latest C-SSRS). Client.riskLevel defaults to LOW, so a LOW with no risk screen
 * of any kind on file is "unknown", not low.
 */
export function riskTierOf(f: Pick<PopulationClientFacts, 'riskLevel' | 'openAlertSeverities' | 'latestCssrsFlagged' | 'hasRiskScreen'>): RiskTier {
  const summary = summarizeRisk({
    riskLevel: f.riskLevel,
    alerts: f.openAlertSeverities.map((severity, i) => ({ id: String(i), type: '', severity, reviewed: false, createdAt: new Date(0) })),
    latestCssrs:
      f.latestCssrsFlagged == null
        ? null
        : { id: '', instrumentName: 'C-SSRS', totalScore: null, severity: null, safetyFlagged: f.latestCssrsFlagged, createdAt: new Date(0) },
  });
  if (summary.level === 'high') return 'high';
  if (summary.level === 'medium') return 'moderate';
  const chartLow = (f.riskLevel || '').toUpperCase() === 'LOW' || !f.riskLevel;
  return chartLow && !f.hasRiskScreen ? 'unknown' : 'low';
}

/** Why a client sits in the high tier (for the list detail) */
function highReason(f: PopulationClientFacts): string {
  const parts: string[] = [];
  if ((f.riskLevel || '').toUpperCase() === 'HIGH') parts.push('chart risk High');
  const openHigh = f.openAlertSeverities.filter((s) => s.toUpperCase() === 'HIGH').length;
  if (openHigh) parts.push(`${openHigh} unreviewed high alert${openHigh === 1 ? '' : 's'}`);
  if (f.latestCssrsFlagged) parts.push('latest C-SSRS safety-flagged');
  return parts.join(' · ');
}

const daysSince = (at: Date | null, now: Date) => (at ? Math.floor((now.getTime() - at.getTime()) / DAY_MS) : null);
const within = (at: Date | null, now: Date, days: number) => Boolean(at && at.getTime() <= now.getTime() && now.getTime() - at.getTime() < days * DAY_MS);

// ─── Rows ────────────────────────────────────────────────────────────────────

export type PopulationRow = {
  clientId: string;
  /** Alias / "Protected client" for protected records */
  name: string;
  mrn: string | null;
  clinicianName: string | null;
  locationName: string | null;
  tier: RiskTier;
  lastVisit: string | null;
  nextAppointment: string | null;
  detail: string | null;
  isProtected: boolean;
  href: string;
};

export function toRow(f: PopulationClientFacts, tier: RiskTier, detail: string | null): PopulationRow {
  const hide = f.isProtected;
  return {
    clientId: f.id,
    name: hide ? f.protectedAlias || 'Protected client' : f.name,
    mrn: hide ? null : f.mrn,
    clinicianName: f.assignedToName,
    locationName: f.locationName,
    tier,
    lastVisit: hide ? null : f.lastVisitAt ? f.lastVisitAt.toISOString() : null,
    nextAppointment: hide ? null : f.nextAppointmentAt ? f.nextAppointmentAt.toISOString() : null,
    detail: hide ? null : detail,
    isProtected: hide,
    href: `/dashboard/clients/${encodeURIComponent(f.id)}`,
  };
}

export type RowPage = { total: number; page: number; pageSize: number; rows: PopulationRow[] };

export function paginate<T>(items: T[], page: number, pageSize: number): { total: number; page: number; pageSize: number; items: T[] } {
  const size = Math.max(1, Math.min(pageSize, MAX_PAGE_SIZE));
  const last = Math.max(0, Math.ceil(items.length / size) - 1);
  const p = Math.min(Math.max(0, page), last);
  return { total: items.length, page: p, pageSize: size, items: items.slice(p * size, p * size + size) };
}

// ─── Report ──────────────────────────────────────────────────────────────────

export type ClinicianBalanceRow = {
  clinicianId: string | null;
  name: string;
  activeClients: number;
  highRisk: number;
  /** null when the session-frequency cadence was unavailable */
  overdue: number | null;
  seen30: number;
  measured90: number;
};

export const ACTION_META: Record<ActionKind, { label: string; urgency: 'critical' | 'high' | 'routine'; source: string }> = {
  high_no_safety_plan: {
    label: 'High risk, no safety plan on file',
    urgency: 'critical',
    source: 'High tier with no linked Stanley-Brown plan (Safety Plans) and no safety plan section in a clinical evaluation',
  },
  high_overdue: {
    label: 'High risk, therapy overdue',
    urgency: 'critical',
    source: 'High tier and overdue for individual therapy per the Session Frequency rules',
  },
  phq9_severe_unacked: {
    label: `PHQ-9 ≥ ${PHQ9_SEVERE}, MBC alert not acknowledged`,
    urgency: 'high',
    source: 'Recorded PHQ-9 at or above the MBC threshold with no acknowledgement in Measurement-Based Care',
  },
  no_visit_60: {
    label: `No visit in ${NO_VISIT_DAYS} days`,
    urgency: 'routine',
    source: 'Active clients with no attended appointment, signed note or billed Valant charge in the last 60 days (or none on record)',
  },
  not_measured_90: {
    label: `No PHQ-9 or GAD-7 in ${MBC_WINDOW_DAYS} days`,
    urgency: 'routine',
    source: `Active clients with no scored PHQ-9 or GAD-7 recorded in the last ${MBC_WINDOW_DAYS} days (Measurement-Based Care)`,
  },
};

export type ActionGroup = { kind: ActionKind; label: string; urgency: 'critical' | 'high' | 'routine'; source: string; count: number; preview: PopulationRow[] };

export type PopulationReport = {
  generatedAt: string;
  scope: 'organization' | 'caseload';
  filters: { locationId: string | null; clinicianId: string | null };
  hiddenSensitiveClients: number;
  options: { locations: { id: string; name: string }[]; clinicians: { id: string; name: string }[] };
  activeCaseload: number;
  newIntakes: { d30: number; d90: number };
  imported: { d30: number; d90: number };
  risk: Record<RiskTier, number> & { escalatedByAlert: number; escalatedByCssrs: number };
  engagement: { seen30: number; seen60: number; seen90: number; notSeen90: number; neverSeen: number };
  overdue: { available: boolean; therapy: number | null; medManagement: number | null; either: number | null };
  mbc: { windowDays: number; activeMeasured: Rate; seenMeasured: Rate };
  clinicians: ClinicianBalanceRow[];
  tiers: Record<RiskTier, { count: number; preview: PopulationRow[] }>;
  actions: ActionGroup[];
  /** Present when ?list= asked for a full page */
  list: (RowPage & { key: ListKey }) | null;
  notes: string[];
};

type Built = { tier: RiskTier; f: PopulationClientFacts };

function actionMembers(kind: ActionKind, built: Built[], now: Date): { f: PopulationClientFacts; tier: RiskTier; detail: string }[] {
  const out: { f: PopulationClientFacts; tier: RiskTier; detail: string; sort: number }[] = [];
  for (const { f, tier } of built) {
    if (kind === 'high_no_safety_plan' && tier === 'high' && !f.hasSafetyPlan) {
      out.push({ f, tier, detail: highReason(f), sort: 0 });
    } else if (kind === 'high_overdue' && tier === 'high' && f.therapyOverdue) {
      out.push({ f, tier, detail: `${f.therapyDaysOverdue} day${f.therapyDaysOverdue === 1 ? '' : 's'} overdue for therapy`, sort: -f.therapyDaysOverdue });
    } else if (kind === 'phq9_severe_unacked' && f.severePhq9) {
      out.push({ f, tier, detail: `PHQ-9 ${f.severePhq9.score} on ${f.severePhq9.at.toISOString().slice(0, 10)}`, sort: -f.severePhq9.at.getTime() });
    } else if (kind === 'no_visit_60' && !within(f.lastVisitAt, now, NO_VISIT_DAYS)) {
      const d = daysSince(f.lastVisitAt, now);
      // Never seen first, then the longest gap
      out.push({ f, tier, detail: d == null ? 'No visit on record' : `Last visit ${d} days ago`, sort: d == null ? -Infinity : -d });
    } else if (kind === 'not_measured_90' && !f.measured90) {
      // High-risk clients first, then by name
      out.push({ f, tier, detail: `No PHQ-9 / GAD-7 in ${MBC_WINDOW_DAYS} days`, sort: tier === 'high' ? 0 : 1 });
    }
  }
  return out.sort((a, b) => a.sort - b.sort || a.f.name.localeCompare(b.f.name));
}

export function buildPopulationReport(input: {
  facts: PopulationClientFacts[];
  now: Date;
  scope: ReportScope;
  hiddenSensitiveClients: number;
  options: PopulationReport['options'];
  list: ListKey | null;
  page: number;
  pageSize: number;
  /** false when the session-frequency loader failed */
  cadenceAvailable: boolean;
  notes?: string[];
}): PopulationReport {
  const { facts, now } = input;
  const built: Built[] = facts
    .map((f) => ({ f, tier: riskTierOf(f) }))
    .sort((a, b) => a.f.name.localeCompare(b.f.name));

  const risk = { high: 0, moderate: 0, low: 0, unknown: 0, escalatedByAlert: 0, escalatedByCssrs: 0 };
  const eng = { seen30: 0, seen60: 0, seen90: 0, notSeen90: 0, neverSeen: 0 };
  let therapyOverdue = 0;
  let medOverdue = 0;
  let either = 0;
  let measured = 0;
  let seen90Measured = 0;
  const newIntakes = { d30: 0, d90: 0 };
  const imported = { d30: 0, d90: 0 };
  const byClin = new Map<string, ClinicianBalanceRow>();

  for (const { f, tier } of built) {
    risk[tier] += 1;
    if (tier === 'high' && (f.riskLevel || '').toUpperCase() !== 'HIGH') {
      if (f.openAlertSeverities.some((s) => s.toUpperCase() === 'HIGH')) risk.escalatedByAlert += 1;
      else if (f.latestCssrsFlagged) risk.escalatedByCssrs += 1;
    }
    const s30 = within(f.lastVisitAt, now, 30);
    const s90 = within(f.lastVisitAt, now, 90);
    if (s30) eng.seen30 += 1;
    if (within(f.lastVisitAt, now, 60)) eng.seen60 += 1;
    if (s90) eng.seen90 += 1;
    else eng.notSeen90 += 1;
    if (!f.lastVisitAt) eng.neverSeen += 1;
    if (f.therapyOverdue) therapyOverdue += 1;
    if (f.medOverdue) medOverdue += 1;
    if (f.therapyOverdue || f.medOverdue) either += 1;
    if (f.measured90) measured += 1;
    if (f.measured90 && s90) seen90Measured += 1;
    if (!f.importedAt && within(f.createdAt, now, 30)) newIntakes.d30 += 1;
    if (!f.importedAt && within(f.createdAt, now, 90)) newIntakes.d90 += 1;
    if (within(f.importedAt, now, 30)) imported.d30 += 1;
    if (within(f.importedAt, now, 90)) imported.d90 += 1;

    const key = f.assignedToId ?? '';
    const row = byClin.get(key) ?? {
      clinicianId: f.assignedToId,
      name: f.assignedToId ? f.assignedToName || 'Unnamed staff' : 'Unassigned',
      activeClients: 0,
      highRisk: 0,
      overdue: input.cadenceAvailable ? 0 : null,
      seen30: 0,
      measured90: 0,
    };
    row.activeClients += 1;
    if (tier === 'high') row.highRisk += 1;
    if (row.overdue != null && (f.therapyOverdue || f.medOverdue)) row.overdue += 1;
    if (s30) row.seen30 += 1;
    if (f.measured90) row.measured90 += 1;
    byClin.set(key, row);
  }

  const clinicians = [...byClin.values()].sort(
    (a, b) => Number(a.clinicianId == null) - Number(b.clinicianId == null) || b.activeClients - a.activeClients || a.name.localeCompare(b.name)
  );

  const tierRows = (t: RiskTier) =>
    built.filter((b) => b.tier === t).map((b) => toRow(b.f, t, t === 'high' ? highReason(b.f) : null));
  const tierLists = Object.fromEntries(RISK_TIERS.map((t) => [t, tierRows(t)])) as Record<RiskTier, PopulationRow[]>;
  const actionLists = Object.fromEntries(
    ACTION_KINDS.map((k) => [k, actionMembers(k, built, now).map((m) => toRow(m.f, m.tier, m.detail))])
  ) as Record<ActionKind, PopulationRow[]>;
  // Cadence-based action needs the session-frequency loader
  const actionKinds = ACTION_KINDS.filter((k) => input.cadenceAvailable || k !== 'high_overdue');

  let list: PopulationReport['list'] = null;
  if (input.list) {
    const [kind, value] = input.list.split(':') as ['tier' | 'action', string];
    const source = kind === 'tier' ? tierLists[value as RiskTier] : actionLists[value as ActionKind];
    const p = paginate(source ?? [], input.page, input.pageSize);
    list = { key: input.list, total: p.total, page: p.page, pageSize: p.pageSize, rows: p.items };
  }

  const active = built.length;
  return {
    generatedAt: now.toISOString(),
    scope: isCaseloadScope(input.scope) ? 'caseload' : 'organization',
    filters: { locationId: input.scope.locationId, clinicianId: input.scope.clinicianId },
    hiddenSensitiveClients: input.hiddenSensitiveClients,
    options: input.options,
    activeCaseload: active,
    newIntakes,
    imported,
    risk,
    engagement: eng,
    overdue: input.cadenceAvailable
      ? { available: true, therapy: therapyOverdue, medManagement: medOverdue, either }
      : { available: false, therapy: null, medManagement: null, either: null },
    mbc: { windowDays: MBC_WINDOW_DAYS, activeMeasured: rate(measured, active), seenMeasured: rate(seen90Measured, eng.seen90) },
    clinicians,
    tiers: Object.fromEntries(
      RISK_TIERS.map((t) => [t, { count: tierLists[t].length, preview: tierLists[t].slice(0, PREVIEW_ROWS) }])
    ) as PopulationReport['tiers'],
    actions: actionKinds.map((k) => ({ kind: k, ...ACTION_META[k], count: actionLists[k].length, preview: actionLists[k].slice(0, PREVIEW_ROWS) })),
    list,
    notes: input.notes ?? [],
  };
}

