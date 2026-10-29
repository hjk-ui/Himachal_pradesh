/**
 * In-session safety alert (EHR > Assessments). A measure entered in session with a positive
 * critical item (PHQ-9 / PHQ-A item 9 above 0, EPDS item 10 at 1 or more, C-SSRS screener positive,
 * or any instrument whose scoring flags safety) raises the SAME high-priority RiskAlert as a patient
 * link or paper entry (safetyAlertsFor in safety.ts) for the treating clinician. One alert per
 * record: if an assessment alert already exists for the record, nothing new is created.
 *
 * The database is passed in (the route passes prisma), so this stays testable without a server.
 */
import { SAFETY_ITEMS } from './instruments';
import { safetyAlertsFor } from './safety';
import type { ScoredMeasure } from './scoring';

type AlertDb = {
  riskAlert: {
    findFirst: (args: { where: { organizationId: string; clientId: string; source: string; sourceId: string }; select: { id: true } }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        organizationId: string;
        clientId: string;
        clientName: string | null;
        clinicianId: string | null;
        type: string;
        severity: 'HIGH';
        source: string;
        sourceId: string;
        description: string;
        reviewed: boolean;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
};

/** The in-session result as the ScoredMeasure the shared alert helper reads */
export function sessionScored(input: {
  instrumentId: string;
  instrumentName: string;
  category: string;
  answers: Record<string, number>;
  result: { totalScore: number; severity: string; interpretation: string; safetyFlagged: boolean; safetyNotes?: string | null };
}): ScoredMeasure {
  const item = SAFETY_ITEMS[input.instrumentId];
  const itemScore = item && typeof input.answers[item] === 'number' ? input.answers[item] : null;
  const safetyItemPositive = (itemScore ?? 0) > 0;
  return {
    instrumentId: input.instrumentId,
    instrumentName: input.instrumentName,
    category: input.category,
    totalScore: input.result.totalScore,
    severity: input.result.severity,
    interpretation: input.result.interpretation,
    safetyFlagged: Boolean(input.result.safetyFlagged) || safetyItemPositive,
    safetyNotes: input.result.safetyNotes ?? null,
    safetyItemPositive,
    safetyItemScore: itemScore,
    answers: [],
  };
}

export type SessionAlertResult = { created: string[]; existing: string | null };

export async function raiseSessionSafetyAlert(
  db: AlertDb,
  input: {
    organizationId: string;
    client: { id: string; name: string | null; assignedToId?: string | null };
    actorUserId: string;
    recordId: string;
    scored: ScoredMeasure;
  },
): Promise<SessionAlertResult> {
  const plans = safetyAlertsFor([input.scored], 'session');
  if (!plans.length) return { created: [], existing: null };
  const already = await db.riskAlert.findFirst({
    where: { organizationId: input.organizationId, clientId: input.client.id, source: 'assessment', sourceId: input.recordId },
    select: { id: true },
  });
  if (already) return { created: [], existing: already.id };
  const created: string[] = [];
  for (const a of plans) {
    const row = await db.riskAlert.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.client.id,
        clientName: input.client.name,
        // Treating clinician: the client's assigned clinician, else the clinician who entered it
        clinicianId: input.client.assignedToId ?? input.actorUserId,
        type: a.type,
        severity: a.severity,
        source: 'assessment',
        sourceId: input.recordId,
        description: a.description,
        reviewed: false,
      },
      select: { id: true },
    });
    created.push(row.id);
  }
  return { created, existing: null };
}
