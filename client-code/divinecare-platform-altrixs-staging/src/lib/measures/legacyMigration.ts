/**
 * One-time copy of the MBC schedule blob (ClinicModuleState 'outcome-schedules') into
 * measure_assignments (pure planning; scripts/migrate-outcome-schedules-blob.ts writes).
 *
 * Rules (nothing is invented):
 *  - measure name -> catalog id (PHQ-9 -> phq-9, Columbia -> c-ssrs-brief; a row's own
 *    instrumentId wins). Unknown measures are skipped and counted.
 *  - frequency once -> once; weekly / biweekly / monthly -> every 7 / 14 / 30 days.
 *  - start date = assignedAt day, else nextSendDate, else the run day.
 *  - active rows stay active; paused rows are copied paused. A second open row for the same client
 *    and measure is copied paused (one open assignment per client and measure).
 *  - source 'sud-radar' rows keep that source; everything else is 'legacy'.
 *  - legacySourceId = the blob scheduleId: a rerun skips rows already copied.
 *  - clients not in the organization are skipped and counted. The blob is never changed.
 */
import { activeKeyFor, type MeasureSchedule } from './schedule';
import { instrumentById } from './instruments';

export type LegacyAssignmentPlan = {
  legacySourceId: string;
  clientId: string;
  instrumentId: string;
  schedule: MeasureSchedule;
  everyDays: number | null;
  startDate: string;
  status: 'active' | 'paused';
  activeKey: string | null;
  source: 'legacy' | 'sud_radar';
  assignedById: string | null;
  lastSentAt: string | null;
};

export type LegacyMigrationCounts = {
  rows: number;
  planned: number;
  alreadyCopied: number;
  unknownMeasure: number;
  unknownClient: number;
  invalid: number;
  pausedDuplicate: number;
};

const NAME_TO_ID: Readonly<Record<string, string>> = Object.freeze({
  COLUMBIA: 'c-ssrs-brief',
  'C-SSRS': 'c-ssrs-brief',
  'NIDA-ASSIST': 'nida-assist',
});

export function legacyInstrumentId(row: { measure?: unknown; instrumentId?: unknown }): string | null {
  if (typeof row.instrumentId === 'string' && instrumentById(row.instrumentId)) return row.instrumentId;
  const name = typeof row.measure === 'string' ? row.measure.trim() : '';
  if (!name) return null;
  const mapped = NAME_TO_ID[name.toUpperCase()] ?? name.toLowerCase();
  return instrumentById(mapped) ? mapped : null;
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10)));

export function planLegacyScheduleMigration(
  blob: unknown,
  ctx: { clientIds: ReadonlySet<string>; existingLegacyIds: ReadonlySet<string>; existingActiveKeys: ReadonlySet<string>; today: string }
): { plan: LegacyAssignmentPlan[]; counts: LegacyMigrationCounts } {
  const counts: LegacyMigrationCounts = { rows: 0, planned: 0, alreadyCopied: 0, unknownMeasure: 0, unknownClient: 0, invalid: 0, pausedDuplicate: 0 };
  const plan: LegacyAssignmentPlan[] = [];
  if (!Array.isArray(blob)) return { plan, counts };
  const open = new Set(ctx.existingActiveKeys);
  const seenIds = new Set<string>();
  for (const raw of blob) {
    counts.rows++;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      counts.invalid++;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const legacyId = typeof r.scheduleId === 'string' ? r.scheduleId.trim() : '';
    const clientId = typeof r.patientId === 'string' ? r.patientId : typeof r.clientId === 'string' ? r.clientId : '';
    if (!legacyId || !clientId || seenIds.has(legacyId)) {
      counts.invalid++;
      continue;
    }
    seenIds.add(legacyId);
    if (ctx.existingLegacyIds.has(legacyId)) {
      counts.alreadyCopied++;
      continue;
    }
    if (!ctx.clientIds.has(clientId)) {
      counts.unknownClient++;
      continue;
    }
    const instrumentId = legacyInstrumentId(r);
    if (!instrumentId) {
      counts.unknownMeasure++;
      continue;
    }
    const freq = String(r.frequency ?? 'monthly');
    const schedule: MeasureSchedule = freq === 'once' ? 'once' : 'interval';
    const everyDays = freq === 'once' ? null : freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : 30;
    const startDate = isDay(r.assignedAt) ? r.assignedAt.slice(0, 10) : isDay(r.nextSendDate) ? r.nextSendDate.slice(0, 10) : ctx.today;
    let status: 'active' | 'paused' = r.active === false ? 'paused' : 'active';
    const key = activeKeyFor(clientId, instrumentId);
    if (status === 'active' && open.has(key)) {
      status = 'paused';
      counts.pausedDuplicate++;
    }
    if (status === 'active') open.add(key);
    plan.push({
      legacySourceId: legacyId,
      clientId,
      instrumentId,
      schedule,
      everyDays,
      startDate,
      status,
      activeKey: status === 'active' ? key : null,
      source: r.source === 'sud-radar' ? 'sud_radar' : 'legacy',
      assignedById: typeof r.assignedById === 'string' ? r.assignedById : null,
      lastSentAt: typeof r.lastSentAt === 'string' && !Number.isNaN(Date.parse(r.lastSentAt)) ? r.lastSentAt : null,
    });
    counts.planned++;
  }
  return { plan, counts };
}
