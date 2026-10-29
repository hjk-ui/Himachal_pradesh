/**
 * Valant treatment plan grid (Clinical > Treatment Plans, exported as Excel or CSV).
 * Columns: Patient ID, First Name, Last Name, Treatment Plan Type, Status, Last Update,
 * Next Review, Owner, Supervisor, Other Providers, Active/Inactive Patient.
 *
 * The grid lists plans only: it has no goals, objectives, interventions, problems or diagnoses.
 * An imported plan records where it came from in its goals JSON (`source`) and keeps an empty
 * goal list, so the chart can say the plan content is still in Valant.
 *
 * Client-safe: no server imports (the treatment plan page reads ImportedPlanSource too).
 */
import { zonedToUtc } from '@/lib/migration/valantAppointments';
import { splitProviderList } from '@/lib/migration/providers';

export const VALANT_PLAN_TITLE = 'Valant Treatment Plan (imported)';

export type ImportedPlanSource = {
  platform: 'valant';
  planType: string;
  valantStatus: string;
  /** ISO instant of Valant's "Last Update" (wall clock in America/New_York) */
  lastUpdatedAt: string | null;
  /**
   * Plan start / effective date (YYYY-MM-DD) when the export has one. Valant's treatment plan
   * grid does not, so this is null for every plan imported so far: the plan says "Start: not in
   * Valant export" instead of showing the import date.
   */
  planStartDate: string | null;
  /** Names exactly as Valant shows them */
  owner: string | null;
  supervisor: string | null;
  otherProviders: string[];
  importedAt: string;
};

export type ValantTreatmentPlan = {
  sourcePatientId: string;
  planType: string;
  valantStatus: string;
  status: 'ACTIVE' | 'DRAFT';
  lastUpdatedAt: Date | null;
  /** Start / effective date column when the export has one (the plan grid does not) */
  planStartDate: Date | null;
  /** Next Review, noon UTC that day; null when blank */
  reviewDueAt: Date | null;
  owner: string | null;
  supervisor: string | null;
  otherProviders: string[];
};

export type ValantTreatmentPlanParse =
  | { kind: 'plan'; plan: ValantTreatmentPlan }
  | { kind: 'skip'; reason: 'footer' | 'blank' }
  | { kind: 'error'; error: string };

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '');

function get(row: Record<string, string>, ...names: string[]) {
  const wanted = new Set(names.map(key));
  for (const [k, v] of Object.entries(row)) if (wanted.has(key(k))) return String(v ?? '').trim();
  return '';
}

/** "Active" -> ACTIVE, "Draft (New)" -> DRAFT; anything else is not mapped */
export function mapValantPlanStatus(raw: string): 'ACTIVE' | 'DRAFT' | null {
  const s = raw.trim();
  if (/^active$/i.test(s)) return 'ACTIVE';
  if (/^draft(\s*\(new\))?$/i.test(s)) return 'DRAFT';
  return null;
}

/** "M/D/YYYY" -> noon UTC that day (date only, no time zone drift) */
export function parseValantDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

/** "09/01/2026, 12:40 PM" (clinic wall clock) -> UTC instant */
export function parseValantDateTime(raw: string, timeZone = 'America/New_York'): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return null;
  const [mo, d, y, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (!parseValantDate(`${mo}/${d}/${y}`) || h < 1 || h > 12 || mi > 59) return null;
  const hour24 = (h % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
  return zonedToUtc(y, mo, d, hour24, mi, timeZone);
}

export function parseValantTreatmentPlanRow(row: Record<string, string>): ValantTreatmentPlanParse {
  const id = get(row, 'Patient ID', 'Pt. ID').toUpperCase();
  if (!id) {
    const any = Object.values(row).some((v) => String(v ?? '').trim());
    return any ? { kind: 'error', error: 'Patient ID is missing' } : { kind: 'skip', reason: 'blank' };
  }
  // Valant ends the grid with "Count: 77" in the first column
  if (/^count:/i.test(id)) return { kind: 'skip', reason: 'footer' };

  const valantStatus = get(row, 'Status');
  const status = mapValantPlanStatus(valantStatus);
  if (!status) return { kind: 'error', error: `Patient ${id}: unknown plan status "${valantStatus || '(blank)'}"` };

  const lastUpdateRaw = get(row, 'Last Update', 'Last Updated');
  const lastUpdatedAt = lastUpdateRaw ? parseValantDateTime(lastUpdateRaw) : null;
  if (lastUpdateRaw && !lastUpdatedAt) {
    return { kind: 'error', error: `Patient ${id}: Last Update "${lastUpdateRaw}" is not a date and time` };
  }
  const nextReviewRaw = get(row, 'Next Review');
  const reviewDueAt = nextReviewRaw ? parseValantDate(nextReviewRaw) : null;
  if (nextReviewRaw && !reviewDueAt) {
    return { kind: 'error', error: `Patient ${id}: Next Review "${nextReviewRaw}" is not a date` };
  }

  const startRaw = get(row, 'Start Date', 'Effective Date', 'Plan Date', 'Plan Start Date', 'Created Date');
  const planStartDate = startRaw ? parseValantDate(startRaw.split(/[ ,]/)[0]) : null;
  if (startRaw && !planStartDate) {
    return { kind: 'error', error: `Patient ${id}: plan start date "${startRaw}" is not a date` };
  }

  return {
    kind: 'plan',
    plan: {
      sourcePatientId: id,
      planType: get(row, 'Treatment Plan Type') || 'Valant Treatment Plan',
      valantStatus,
      status,
      lastUpdatedAt,
      planStartDate,
      reviewDueAt,
      owner: get(row, 'Owner') || null,
      supervisor: get(row, 'Supervisor') || null,
      otherProviders: splitProviderList(get(row, 'Other Providers')),
    },
  };
}

/** One plan per patient: when a patient appears twice, the most recently updated row wins */
export function latestPlanPerPatient(plans: ValantTreatmentPlan[]) {
  const byPatient = new Map<string, ValantTreatmentPlan>();
  let duplicates = 0;
  for (const p of plans) {
    const prior = byPatient.get(p.sourcePatientId);
    if (prior) duplicates += 1;
    if (!prior || (p.lastUpdatedAt?.getTime() ?? 0) > (prior.lastUpdatedAt?.getTime() ?? 0)) byPatient.set(p.sourcePatientId, p);
  }
  return { plans: [...byPatient.values()], duplicates };
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** The import record stored in TreatmentPlan.goals, or null for plans written in Altrixs */
export function parsePlanSource(goals: unknown): ImportedPlanSource | null {
  const src = asObject(asObject(goals)?.source);
  if (!src || src.platform !== 'valant') return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    platform: 'valant',
    planType: str(src.planType) ?? 'Valant Treatment Plan',
    valantStatus: str(src.valantStatus) ?? '',
    lastUpdatedAt: str(src.lastUpdatedAt),
    planStartDate: typeof src.planStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.planStartDate) ? src.planStartDate : null,
    owner: str(src.owner),
    supervisor: str(src.supervisor),
    otherProviders: Array.isArray(src.otherProviders) ? src.otherProviders.filter((x): x is string => typeof x === 'string') : [],
    importedAt: str(src.importedAt) ?? '',
  };
}

export function buildPlanSource(plan: ValantTreatmentPlan, importedAt: Date): ImportedPlanSource {
  return {
    platform: 'valant',
    planType: plan.planType,
    valantStatus: plan.valantStatus,
    lastUpdatedAt: plan.lastUpdatedAt?.toISOString() ?? null,
    planStartDate: plan.planStartDate?.toISOString().slice(0, 10) ?? null,
    owner: plan.owner,
    supervisor: plan.supervisor,
    otherProviders: plan.otherProviders,
    importedAt: importedAt.toISOString(),
  };
}

/**
 * Which plan an import writes: the client's earlier Valant import, or a new plan.
 * Plans written in Altrixs (no Valant source) are never chosen.
 */
export function planUpsertTarget(existing: { id: string; goals: unknown }[]): { action: 'create' } | { action: 'update'; planId: string } {
  const prior = existing.find((p) => parsePlanSource(p.goals));
  return prior ? { action: 'update', planId: prior.id } : { action: 'create' };
}

/**
 * Goals JSON for an imported plan. A re-import replaces only `source`: goals or details a
 * clinician has since added in Altrixs stay. A new plan starts with no goals (none are exported).
 */
export function importedPlanGoals(existingGoals: unknown, source: ImportedPlanSource): Record<string, unknown> {
  const prior = asObject(existingGoals) ?? {};
  return { ...prior, items: Array.isArray(prior.items) ? prior.items : [], source };
}

/**
 * Status a re-import writes. A Valant plan that was closed in Altrixs (replaced by a plan written
 * here, or closed by staff) stays closed: running the import again must not reopen it.
 */
export function reimportStatus(priorStatus: string | null | undefined, valantStatus: 'ACTIVE' | 'DRAFT'): 'ACTIVE' | 'DRAFT' | 'CLOSED' {
  return priorStatus === 'CLOSED' ? 'CLOSED' : valantStatus;
}

/** "Last updated in Valant Sep 1, 2026 by <owner>" */
export function importedPlanSummary(source: ImportedPlanSource) {
  const when = source.lastUpdatedAt
    ? new Date(source.lastUpdatedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const parts = ['Last updated in Valant', when ? when : null, source.owner ? `by ${source.owner}` : null].filter(Boolean);
  return parts.length > 1 ? `${parts.join(' ')}.` : '';
}
