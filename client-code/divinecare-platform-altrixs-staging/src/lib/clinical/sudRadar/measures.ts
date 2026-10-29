/**
 * Substance-use measures assigned from the SUD Referral Radar. Pure module (no database).
 *
 * Assignments go on the MBC schedule (measure_assignments, source sud_radar; shown on
 * /dashboard/mbc/outcomes and given in session or from EHR > Assessments; AUDIT and CAGE-AID can be
 * sent to the patient, NIDA-Modified ASSIST and BAM stay in session until a licensed copy is added).
 * Screens are one-time; BAM repeats every 30 days. OUTCOME_SCHEDULES_MODULE is the legacy blob
 * (copied once by scripts/migrate-outcome-schedules-blob.ts).
 * A measure that is already on an active schedule for the client is never assigned again.
 */

export const OUTCOME_SCHEDULES_MODULE = 'outcome-schedules';
export const SUD_MEASURE_SOURCE = 'sud-radar';

export type SudMeasureKey = 'AUDIT' | 'CAGE-AID' | 'NIDA-ASSIST' | 'BAM';
export type MeasureFrequency = 'once' | 'weekly' | 'biweekly' | 'monthly';

export type SudMeasureDef = {
  key: SudMeasureKey;
  /** Label in the confirm dialog */
  label: string;
  /** Assessment catalog id (src/features/ehr/assessments/catalog.ts) */
  instrumentId: string;
  frequency: MeasureFrequency;
};

/** The four measures, in dialog order. All are pre-ticked. */
export const SUD_MEASURES: readonly SudMeasureDef[] = [
  { key: 'AUDIT', label: 'AUDIT (alcohol use assessment)', instrumentId: 'audit', frequency: 'once' },
  { key: 'CAGE-AID', label: 'CAGE-AID (alcohol and substance use)', instrumentId: 'cage-aid', frequency: 'once' },
  { key: 'NIDA-ASSIST', label: 'NIDA-Modified ASSIST (prescription and street substances)', instrumentId: 'nida-assist', frequency: 'once' },
  // Recovery monitor: repeats every 30 days on the MBC schedule (as in the programs)
  { key: 'BAM', label: 'BAM — Brief Addiction Monitor (repeats every 30 days)', instrumentId: 'bam', frequency: 'monthly' },
];

export const SUD_MEASURE_KEYS: readonly SudMeasureKey[] = SUD_MEASURES.map((m) => m.key);

/** Valid, de-duplicated measure keys from a request body (unknown keys are dropped) */
export function parseSudMeasureKeys(input: unknown): SudMeasureKey[] {
  if (!Array.isArray(input)) return [];
  const keys = new Set(input.map((v) => String(v)));
  return SUD_MEASURE_KEYS.filter((k) => keys.has(k));
}

/** One MBC outcome schedule row (same shape as the Schedule on /dashboard/mbc/outcomes) */
export type OutcomeSchedule = {
  scheduleId: string;
  patientId: string;
  patientName: string;
  measure: string;
  frequency: MeasureFrequency;
  deliveryMethod: 'sms' | 'email';
  nextSendDate: string;
  lastSentAt: string | null;
  active: boolean;
  completionRate: number;
  /** Set on rows created here */
  source?: string;
  instrumentId?: string;
  assignedById?: string | null;
  assignedAt?: string;
  trigger?: 'manual' | 'auto';
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** client id + measure keys already open (active schedule) */
export function openMeasuresByClient(existing: unknown): Map<string, Set<string>> {
  const open = new Map<string, Set<string>>();
  if (!Array.isArray(existing)) return open;
  for (const row of existing) {
    if (!isRecord(row)) continue;
    if (row.active === false) continue;
    const clientId = typeof row.patientId === 'string' ? row.patientId : typeof row.clientId === 'string' ? row.clientId : null;
    const measure = typeof row.measure === 'string' ? row.measure.trim().toUpperCase() : null;
    if (!clientId || !measure) continue;
    const set = open.get(clientId) ?? new Set<string>();
    set.add(measure);
    open.set(clientId, set);
  }
  return open;
}

export type AssignmentPlan = {
  add: OutcomeSchedule[];
  skipped: { clientId: string; measure: SudMeasureKey; reason: 'already_assigned' }[];
};

/**
 * New schedule rows for these clients and measures, skipping any measure the client already has
 * on an active schedule (or that appears twice in the request). `today` is YYYY-MM-DD: the first
 * administration is due now; BAM then repeats every 30 days.
 */
export function planSudMeasureAssignments(input: {
  existing: unknown;
  clients: { id: string; name: string }[];
  measures: SudMeasureKey[];
  today: string;
  actorUserId: string | null;
  trigger: 'manual' | 'auto';
  nowIso: string;
  /** Unique suffix for schedule ids (tests pass a fixed one) */
  idSeed: string;
}): AssignmentPlan {
  const open = openMeasuresByClient(input.existing);
  const defs = SUD_MEASURES.filter((m) => input.measures.includes(m.key));
  const add: OutcomeSchedule[] = [];
  const skipped: AssignmentPlan['skipped'] = [];
  const seenClients = new Set<string>();
  for (const c of input.clients) {
    if (seenClients.has(c.id)) continue;
    seenClients.add(c.id);
    const have = open.get(c.id) ?? new Set<string>();
    for (const m of defs) {
      if (have.has(m.key.toUpperCase())) {
        skipped.push({ clientId: c.id, measure: m.key, reason: 'already_assigned' });
        continue;
      }
      have.add(m.key.toUpperCase());
      add.push({
        scheduleId: `outcome-${c.id}-${m.key}-${input.idSeed}`,
        patientId: c.id,
        patientName: c.name,
        measure: m.key,
        frequency: m.frequency,
        // Delivery is not connected (the outcomes page says so); the measure is given in session
        deliveryMethod: 'sms',
        nextSendDate: input.today,
        lastSentAt: null,
        active: true,
        completionRate: 0,
        source: SUD_MEASURE_SOURCE,
        instrumentId: m.instrumentId,
        assignedById: input.actorUserId,
        assignedAt: input.nowIso,
        trigger: input.trigger,
      });
    }
  }
  return { add, skipped };
}

/** Plain-language result line for the radar */
export function assignmentSummary(plan: { add: { patientId: string }[]; skipped: unknown[] }): string {
  const clients = new Set(plan.add.map((a) => a.patientId)).size;
  if (!plan.add.length) {
    return plan.skipped.length ? 'Nothing new to assign: those measures are already assigned.' : 'Nothing assigned.';
  }
  return `Assigned ${plan.add.length} measure${plan.add.length === 1 ? '' : 's'} to ${clients} client${clients === 1 ? '' : 's'} on the MBC outcome schedule${
    plan.skipped.length ? ` (${plan.skipped.length} already assigned, skipped)` : ''
  }.`;
}
